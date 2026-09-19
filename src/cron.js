import { nextOccurrence, localDateStr, localMinutes, inQuiet } from './time.js';
import { normalizeSettings, pickLine, TITLES, ACTIONS } from '../public/shared.js';
import { sendPush } from './push.js';
import { snoozeSig } from './auth.js';

export const STALE_MS = 10 * 60 * 1000; // a reminder that is >10 min late is dropped, never queued
export const MAX_PER_RUN = 25; // keeps each run inside the free plan's subrequest limit
const MAX_FAILS = 20;

const parse = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
};

export async function chooseText(env, settings, kind, rand = Math.random) {
  if (env.AI_VARIATIONS === 'on' && rand() < 0.35) {
    try {
      const r = await env.DB.prepare('SELECT text FROM ai_lines WHERE lang = ? AND tone = ? AND kind = ? ORDER BY RANDOM() LIMIT 1')
        .bind(settings.lang, settings.tone, kind)
        .first();
      if (r && r.text) return r.text;
    } catch {
      /* fall back to the hand-written bank */
    }
  }
  return pickLine(settings.lang, settings.tone, kind, rand);
}

export async function buildPayload(env, subId, settings, kind, text) {
  return {
    title: TITLES[settings.lang],
    body: text,
    kind,
    id: subId,
    sig: await snoozeSig(env, subId, kind),
    actions: ACTIONS[settings.lang],
  };
}

export async function runDue(env, now = Date.now(), send = sendPush) {
  const { results } = await env.DB.prepare(
    `SELECT sl.id AS slot_id, sl.kind AS kind, sl.local_time AS local_time, sl.dow AS dow, sl.once AS once, sl.next_due AS next_due,
            s.id AS id, s.endpoint AS endpoint, s.p256dh AS p256dh, s.auth AS auth, s.tz AS tz, s.settings AS settings,
            s.sent_day AS sent_day, s.sent_count AS sent_count, s.fail_count AS fail_count
       FROM slots sl JOIN subs s ON s.id = sl.sub_id
      WHERE sl.next_due <= ? ORDER BY sl.next_due LIMIT ?`,
  )
    .bind(now, MAX_PER_RUN)
    .all();

  const stats = { due: results.length, sent: 0, skipped: 0, removed: 0, failed: 0 };
  const writes = [];
  const state = new Map();
  const jobs = [];

  // Phase 1: reschedule every due slot and decide who actually gets a message.
  for (const row of results) {
    if (row.once) {
      writes.push(env.DB.prepare('DELETE FROM slots WHERE id = ?').bind(row.slot_id));
    } else {
      const nx = nextOccurrence(row.local_time, row.tz, now, row.dow);
      writes.push(
        nx === null
          ? env.DB.prepare('DELETE FROM slots WHERE id = ?').bind(row.slot_id)
          : env.DB.prepare('UPDATE slots SET next_due = ? WHERE id = ?').bind(nx, row.slot_id),
      );
    }

    if (now - row.next_due > STALE_MS) {
      stats.skipped++;
      continue;
    }
    const settings = normalizeSettings(parse(row.settings));
    const day = localDateStr(now, row.tz);
    let st = state.get(row.id);
    if (!st) {
      st = { day, count: row.sent_day === day ? row.sent_count : 0, fails: row.fail_count, dirty: false, dead: false };
      state.set(row.id, st);
    }
    // Quiet hours silence everything except the two day-boundary nudges the person chose on purpose.
    const bookend = row.kind === 'bedtime' || row.kind === 'morning';
    const quiet = !bookend && inQuiet(localMinutes(now, row.tz), settings.quiet.start, settings.quiet.end);
    if (quiet || st.count >= settings.cap) {
      stats.skipped++;
      continue;
    }
    st.count++;
    const text = await chooseText(env, settings, row.kind);
    jobs.push({ row, st, payload: await buildPayload(env, row.id, settings, row.kind, text) });
  }

  // Phase 2: send in parallel.
  const outcomes = await Promise.all(
    jobs.map((j) =>
      send(env, { endpoint: j.row.endpoint, p256dh: j.row.p256dh, auth: j.row.auth }, j.payload, { urgency: 'high' }).catch(() => ({ ok: false, status: 0 })),
    ),
  );

  // Phase 3: bookkeeping.
  jobs.forEach((j, i) => {
    const res = outcomes[i];
    const st = j.st;
    st.dirty = true;
    if (res.ok) {
      stats.sent++;
      st.fails = 0;
      return;
    }
    st.count--;
    if (res.status === 404 || res.status === 410) {
      st.dead = true;
      return;
    }
    stats.failed++;
    st.fails++;
    if (st.fails >= MAX_FAILS) st.dead = true;
  });

  for (const [id, st] of state) {
    if (st.dead) {
      stats.removed++;
      writes.push(env.DB.prepare('DELETE FROM slots WHERE sub_id = ?').bind(id));
      writes.push(env.DB.prepare('DELETE FROM subs WHERE id = ?').bind(id));
    } else if (st.dirty) {
      writes.push(env.DB.prepare('UPDATE subs SET sent_day = ?, sent_count = ?, fail_count = ? WHERE id = ?').bind(st.day, st.count, st.fails, id));
    }
  }
  if (writes.length) await env.DB.batch(writes);
  return stats;
}
