import { normalizeSettings, buildSlots, KINDS, TEST_LINES, TITLES, ACTIONS } from '../public/shared.js';
import { isValidTz, nextOccurrence } from './time.js';
import { isAllowedEndpoint, sendPush } from './push.js';
import { randomId, sha256hex, safeEqual, snoozeSig } from './auth.js';
import { runDue } from './cron.js';
import { generateAiLines } from './ai.js';
import { chatTurn } from './chat.js';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

async function readJson(request) {
  const text = await request.text();
  if (text.length > 16 * 1024) throw new HttpError(413, 'Request too large');
  try {
    const v = JSON.parse(text || '{}');
    if (v && typeof v === 'object') return v;
  } catch {
    /* fall through */
  }
  throw new HttpError(400, 'Invalid JSON');
}

function readSubscription(sub) {
  const ok =
    sub &&
    typeof sub.endpoint === 'string' &&
    isAllowedEndpoint(sub.endpoint) &&
    sub.keys &&
    typeof sub.keys.p256dh === 'string' &&
    sub.keys.p256dh.length >= 80 &&
    sub.keys.p256dh.length <= 100 &&
    typeof sub.keys.auth === 'string' &&
    sub.keys.auth.length >= 16 &&
    sub.keys.auth.length <= 32;
  if (!ok) throw new HttpError(400, 'Invalid push subscription');
  return { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth };
}

async function authed(env, body) {
  if (typeof body.id !== 'string' || typeof body.token !== 'string') throw new HttpError(401, 'Not signed in');
  const row = await env.DB.prepare('SELECT * FROM subs WHERE id = ?').bind(body.id).first();
  if (!row || !safeEqual(await sha256hex(body.token), row.token_hash)) throw new HttpError(401, 'Not signed in');
  return row;
}

function slotStatements(env, id, settings, tz, now) {
  const stmts = [env.DB.prepare('DELETE FROM slots WHERE sub_id = ? AND once = 0').bind(id)];
  for (const s of buildSlots(settings)) {
    const due = nextOccurrence(s.time, tz, now, s.dow);
    if (due === null) continue;
    stmts.push(
      env.DB.prepare('INSERT INTO slots (sub_id, kind, local_time, dow, once, next_due) VALUES (?, ?, ?, ?, 0, ?)').bind(id, s.kind, s.time, s.dow, due),
    );
  }
  return stmts;
}

async function subscribe(request, env) {
  const b = await readJson(request);
  const sub = readSubscription(b.subscription);
  const tz = isValidTz(b.tz) ? b.tz : 'Asia/Kolkata';
  const settings = normalizeSettings(b.settings);
  const token = randomId(24);
  const tokenHash = await sha256hex(token);
  const now = Date.now();

  const existing = await env.DB.prepare('SELECT id FROM subs WHERE endpoint = ?').bind(sub.endpoint).first();
  const id = existing ? existing.id : randomId(12);
  const stmts = [];
  if (existing) {
    stmts.push(
      env.DB.prepare('UPDATE subs SET token_hash = ?, p256dh = ?, auth = ?, tz = ?, settings = ?, fail_count = 0 WHERE id = ?').bind(
        tokenHash, sub.p256dh, sub.auth, tz, JSON.stringify(settings), id,
      ),
    );
  } else {
    stmts.push(
      env.DB.prepare(
        'INSERT INTO subs (id, token_hash, endpoint, p256dh, auth, tz, settings, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(id, tokenHash, sub.endpoint, sub.p256dh, sub.auth, tz, JSON.stringify(settings), now),
    );
  }
  stmts.push(...slotStatements(env, id, settings, tz, now));
  await env.DB.batch(stmts);
  return json({ id, token });
}

async function update(request, env) {
  const b = await readJson(request);
  const row = await authed(env, b);
  const settings = normalizeSettings(b.settings !== undefined ? b.settings : JSON.parse(row.settings || '{}'));
  const tz = b.tz !== undefined && isValidTz(b.tz) ? b.tz : row.tz;
  const sub = b.subscription ? readSubscription(b.subscription) : { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth };
  const stmts = [
    env.DB.prepare('UPDATE subs SET endpoint = ?, p256dh = ?, auth = ?, tz = ?, settings = ?, fail_count = 0 WHERE id = ?').bind(
      sub.endpoint, sub.p256dh, sub.auth, tz, JSON.stringify(settings), row.id,
    ),
    ...slotStatements(env, row.id, settings, tz, Date.now()),
  ];
  await env.DB.batch(stmts);
  return json({ ok: true });
}

async function unsubscribe(request, env) {
  const row = await authed(env, await readJson(request));
  await env.DB.batch([
    env.DB.prepare('DELETE FROM slots WHERE sub_id = ?').bind(row.id),
    env.DB.prepare('DELETE FROM subs WHERE id = ?').bind(row.id),
  ]);
  return json({ ok: true });
}

async function test(request, env) {
  const row = await authed(env, await readJson(request));
  const now = Date.now();
  if (row.last_test && now - row.last_test < 15000) throw new HttpError(429, 'Please wait a few seconds before testing again');
  const settings = normalizeSettings(JSON.parse(row.settings || '{}'));
  const payload = {
    title: TITLES[settings.lang],
    body: TEST_LINES[settings.lang],
    kind: 'test',
    id: row.id,
    sig: await snoozeSig(env, row.id, 'test'),
    actions: ACTIONS[settings.lang],
  };
  const res = await sendPush(env, { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth }, payload, { urgency: 'high', ttl: 120 });
  await env.DB.prepare('UPDATE subs SET last_test = ? WHERE id = ?').bind(now, row.id).run();
  if (res.status === 404 || res.status === 410) throw new HttpError(410, 'This device is no longer subscribed. Turn notifications on again.');
  return json({ ok: res.ok, status: res.status });
}

async function snooze(request, env) {
  const b = await readJson(request);
  const kind = typeof b.kind === 'string' ? b.kind : '';
  if (typeof b.id !== 'string' || typeof b.sig !== 'string' || !(KINDS.includes(kind) || kind === 'test')) throw new HttpError(400, 'Bad request');
  if (!safeEqual(await snoozeSig(env, b.id, kind), b.sig)) throw new HttpError(401, 'Bad signature');
  const sub = await env.DB.prepare('SELECT id FROM subs WHERE id = ?').bind(b.id).first();
  if (!sub) throw new HttpError(404, 'Not found');
  const minutes = Math.min(120, Math.max(5, Math.round(Number(b.minutes) || 30)));
  const sendKind = kind === 'test' ? 'morning' : kind;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM slots WHERE sub_id = ? AND kind = ? AND once = 1').bind(sub.id, sendKind),
    env.DB.prepare('INSERT INTO slots (sub_id, kind, local_time, dow, once, next_due) VALUES (?, ?, NULL, NULL, 1, ?)').bind(
      sub.id, sendKind, Date.now() + minutes * 60000,
    ),
  ]);
  return json({ ok: true });
}

// What the server believes about this phone: lets the app show whether the scheduler is alive.
async function status(request, env) {
  const row = await authed(env, await readJson(request));
  const now = Date.now();
  const { results } = await env.DB.prepare('SELECT kind, local_time, dow, once, next_due FROM slots WHERE sub_id = ? ORDER BY next_due LIMIT 60').bind(row.id).all();
  return json({
    now,
    tz: row.tz,
    slots: results.map((s) => ({ kind: s.kind, time: s.local_time, dow: s.dow, once: !!s.once, due: s.next_due })),
    // due more than 2 minutes ago and still waiting: the every-minute cron is not processing slots
    overdue: results.filter((s) => now - s.next_due > 2 * 60 * 1000).length,
    sentToday: row.sent_count || 0,
    fails: row.fail_count || 0,
  });
}

async function chat(request, env) {
  const body = await readJson(request);
  const row = await authed(env, body);
  const out = await chatTurn(env, row, body);
  if (out.error) throw new HttpError(out.status || 400, out.error);
  return json(out);
}

async function route(request, env) {
  const { pathname } = new URL(request.url);
  const post = request.method === 'POST';
  if (pathname === '/api/config' && request.method === 'GET') {
    if (!env.VAPID_PUBLIC_KEY) throw new HttpError(500, 'Server is not configured yet');
    return json({ publicKey: env.VAPID_PUBLIC_KEY });
  }
  if (post && pathname === '/api/subscribe') return subscribe(request, env);
  if (post && pathname === '/api/update') return update(request, env);
  if (post && pathname === '/api/unsubscribe') return unsubscribe(request, env);
  if (post && pathname === '/api/test') return test(request, env);
  if (post && pathname === '/api/snooze') return snooze(request, env);
  if (post && pathname === '/api/status') return status(request, env);
  if (post && pathname === '/api/chat') return chat(request, env);
  throw new HttpError(404, 'Not found');
}

// Android (Trusted Web Activity) checks https://<site>/.well-known/assetlinks.json to hide the browser bar.
// The file lives at public/twa/assetlinks.json, because static-asset uploads can skip dot-folders; we serve it here.
async function assetLinks(request, env) {
  const res = await env.ASSETS.fetch(new Request(new URL('/twa/assetlinks.json', request.url), { method: 'GET' }));
  if (!res.ok) return new Response('Not found', { status: 404 });
  return new Response(request.method === 'HEAD' ? null : res.body, {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=300' },
  });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/.well-known/assetlinks.json' && (request.method === 'GET' || request.method === 'HEAD')) return assetLinks(request, env);
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, env);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error('api error', e && e.stack ? e.stack : e);
      return json({ error: 'Something went wrong. Try again.' }, 500);
    }
  },

  async scheduled(event, env, ctx) {
    if (event.cron === '0 21 * * *') {
      ctx.waitUntil(generateAiLines(env).then((r) => console.log('ai', JSON.stringify(r))));
    } else {
      ctx.waitUntil(runDue(env).then((s) => s.due && console.log('cron', JSON.stringify(s))));
    }
  },
};
