import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { runDue, STALE_MS } from '../src/cron.js';
import { bytesToB64u } from '../src/push.js';
import { snoozeSig } from '../src/auth.js';

// Tiny D1 look-alike over node:sqlite.
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => {
      const r = db.prepare(sql).run(...args);
      return { meta: { changes: r.changes } };
    },
    _run: () => db.prepare(sql).run(...args),
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (stmts) => {
      db.exec('BEGIN');
      try {
        for (const s of stmts) s._run();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
      return [];
    },
  };
}

function browserSub(n = 1) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`,
    keys: { p256dh: bytesToB64u(ecdh.getPublicKey()), auth: bytesToB64u(crypto.randomBytes(16)) },
  };
}

const api = (env, path, body, method = 'POST') =>
  worker.fetch(new Request(`https://ammmaa.test${path}`, { method, body: method === 'POST' ? JSON.stringify(body) : undefined }), env);

function setup() {
  const DB = fakeD1();
  const env = { DB, VAPID_PUBLIC_KEY: 'pub', VAPID_SUBJECT: 'mailto:t@t.t', APP_SECRET: 'test-secret', ASSETS: { fetch: async () => new Response('asset') } };
  return { DB, env };
}

test('api: config, subscribe, update, unsubscribe', async () => {
  const { DB, env } = setup();
  assert.equal((await (await api(env, '/api/config', null, 'GET')).json()).publicKey, 'pub');
  assert.equal(await (await worker.fetch(new Request('https://ammmaa.test/'), env)).text(), 'asset');

  const bad = await api(env, '/api/subscribe', { subscription: { endpoint: 'https://evil.example/x', keys: {} } });
  assert.equal(bad.status, 400);

  const res = await api(env, '/api/subscribe', { subscription: browserSub(), tz: 'Asia/Kolkata', settings: { lang: 'ta', tone: 'funny' } });
  assert.equal(res.status, 200);
  const { id, token } = await res.json();
  assert.ok(id && token);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) c FROM slots').get().c, 3 + 6 + 1); // meals + water + bedtime
  assert.equal(JSON.parse(DB.raw.prepare('SELECT settings FROM subs').get().settings).lang, 'ta');
  assert.notEqual(DB.raw.prepare('SELECT token_hash FROM subs').get().token_hash, token, 'token is stored hashed');

  assert.equal((await api(env, '/api/update', { id, token: 'wrong', settings: {} })).status, 401);
  const upd = await api(env, '/api/update', { id, token, settings: { reminders: { water: { on: false }, breaks: { on: true } } } });
  assert.equal(upd.status, 200);
  assert.equal(DB.raw.prepare("SELECT COUNT(*) c FROM slots WHERE kind='water'").get().c, 0);
  assert.ok(DB.raw.prepare("SELECT COUNT(*) c FROM slots WHERE kind='break'").get().c > 0);

  // Re-subscribing the same device keeps one row and rotates the token.
  const again = await (await api(env, '/api/subscribe', { subscription: browserSub(), tz: 'Asia/Kolkata', settings: {} })).json();
  assert.equal(again.id, id);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) c FROM subs').get().c, 1);
  assert.equal((await api(env, '/api/unsubscribe', { id, token })).status, 401, 'old token no longer works');
  assert.equal((await api(env, '/api/unsubscribe', { id, token: again.token })).status, 200);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) c FROM subs').get().c, 0);
  assert.equal(DB.raw.prepare('SELECT COUNT(*) c FROM slots').get().c, 0);
});

test('cron: sends due reminder, reschedules 24h later, drops stale, honours quiet hours and cap', async () => {
  const { DB, env } = setup();
  const sent = [];
  const send = async (_env, sub, payload, opts) => (sent.push({ sub, payload, opts }), { ok: true, status: 201 });

  await api(env, '/api/subscribe', { subscription: browserSub(), tz: 'Asia/Kolkata', settings: { lang: 'tanglish', tone: 'strict', reminders: { water: { on: false } } } });
  const lunch = DB.raw.prepare("SELECT * FROM slots WHERE kind='meal' AND local_time='13:00'").get();

  // Normal send
  let stats = await runDue(env, lunch.next_due + 3000, send);
  assert.equal(stats.sent, 1);
  assert.equal(sent[0].payload.title, 'Anbudan Amma');
  assert.equal(sent[0].payload.kind, 'meal');
  assert.equal(sent[0].opts.urgency, 'high', 'scheduled reminders must be high urgency so idle phones wake up');
  assert.match(sent[0].payload.sig, /^[0-9a-f]{64}$/);
  const after = DB.raw.prepare('SELECT next_due FROM slots WHERE id = ?').get(lunch.id).next_due;
  assert.equal(after, lunch.next_due + 86400000);
  assert.equal(DB.raw.prepare('SELECT sent_count FROM subs').get().sent_count, 1);

  // Nothing due right after
  stats = await runDue(env, lunch.next_due + 6000, send);
  assert.equal(stats.due, 0);

  // Stale (server was down >10 min): rescheduled but not sent
  const breakfast = DB.raw.prepare("SELECT * FROM slots WHERE kind='meal' AND local_time='08:30'").get();
  sent.length = 0;
  stats = await runDue(env, breakfast.next_due + STALE_MS + 60000, send);
  assert.equal(sent.length, 0);
  assert.ok(stats.skipped >= 1);
  assert.ok(DB.raw.prepare('SELECT next_due FROM slots WHERE id = ?').get(breakfast.id).next_due > breakfast.next_due);

  // Quiet hours: dinner at 23:30 (inside 22:00-07:00) is skipped, but bedtime at 22:30 still goes out
  await api(env, '/api/subscribe', {
    subscription: browserSub(),
    tz: 'Asia/Kolkata',
    settings: { reminders: { meals: { on: true, dinner: '23:30' }, water: { on: false }, bedtime: { on: true, time: '22:30' } } },
  });
  const dinner = DB.raw.prepare("SELECT * FROM slots WHERE kind='meal' AND local_time='23:30'").get();
  const bed = DB.raw.prepare("SELECT * FROM slots WHERE kind='bedtime'").get();
  sent.length = 0;
  await runDue(env, bed.next_due + 1000, send); // 22:30, inside quiet hours
  assert.equal(sent.filter((s) => s.payload.kind === 'bedtime').length, 1, 'bedtime is exempt from quiet hours');
  await runDue(env, dinner.next_due + 1000, send); // 23:30, inside quiet hours
  assert.equal(sent.filter((s) => s.payload.kind === 'meal').length, 0, 'meal in quiet hours is skipped');
});

test('cron: daily cap, dead endpoints removed, transient failures kept', async () => {
  const { DB, env } = setup();
  const s1 = browserSub(1);
  const { id } = await (await api(env, '/api/subscribe', { subscription: s1, tz: 'Asia/Kolkata', settings: { cap: 1, reminders: { meals: { on: true, breakfast: '12:00', lunch: '12:00', dinner: '12:00' }, water: { on: false }, bedtime: { on: false } } } })).json();
  const due = DB.raw.prepare("SELECT MAX(next_due) d FROM slots WHERE kind='meal'").get().d;
  let n = 0;
  const ok = async () => (n++, { ok: true, status: 201 });
  const stats = await runDue(env, due + 1000, ok);
  assert.equal(n, 1, 'cap of 1 per day');
  assert.equal(stats.skipped, 2);

  // transient failure (500) keeps the subscription, counts a failure
  const { DB: DB2, env: env2 } = setup();
  await api(env2, '/api/subscribe', { subscription: browserSub(2), tz: 'Asia/Kolkata', settings: { reminders: { water: { on: false } } } });
  const l2 = DB2.raw.prepare("SELECT * FROM slots WHERE kind='meal' AND local_time='13:00'").get();
  await runDue(env2, l2.next_due + 1000, async () => ({ ok: false, status: 500 }));
  assert.equal(DB2.raw.prepare('SELECT COUNT(*) c FROM subs').get().c, 1);
  assert.equal(DB2.raw.prepare('SELECT fail_count f FROM subs').get().f, 1);
  assert.equal(DB2.raw.prepare('SELECT sent_count s FROM subs').get().s, 0);

  // 410 Gone removes the subscription and its slots
  const l3 = DB2.raw.prepare("SELECT * FROM slots WHERE kind='meal' AND local_time='20:00'").get();
  const st = await runDue(env2, l3.next_due + 1000, async () => ({ ok: false, status: 410 }));
  assert.equal(st.removed, 1);
  assert.equal(DB2.raw.prepare('SELECT COUNT(*) c FROM subs').get().c, 0);
  assert.equal(DB2.raw.prepare('SELECT COUNT(*) c FROM slots').get().c, 0);
  assert.ok(id);
});

test('api: snooze needs a valid signature and fires once', async () => {
  const { DB, env } = setup();
  // quiet hours off (start == end) and no other reminders, so the result does not depend on the time of day
  const { id } = await (await api(env, '/api/subscribe', { subscription: browserSub(), tz: 'Asia/Kolkata', settings: { quiet: { start: '00:00', end: '00:00' }, reminders: { meals: { on: false }, water: { on: false }, bedtime: { on: false } } } })).json();
  const sig = await snoozeSig(env, id, 'water');

  assert.equal((await api(env, '/api/snooze', { id, kind: 'water', sig: 'f'.repeat(64) })).status, 401);
  assert.equal((await api(env, '/api/snooze', { id, kind: 'hacking', sig })).status, 400);
  assert.equal((await api(env, '/api/snooze', { id, kind: 'water', sig, minutes: 30 })).status, 200);
  assert.equal((await api(env, '/api/snooze', { id, kind: 'water', sig, minutes: 30 })).status, 200);
  const once = DB.raw.prepare('SELECT * FROM slots WHERE once = 1').all();
  assert.equal(once.length, 1, 'repeat snoozes replace, never stack');

  const sent = [];
  await runDue(env, once[0].next_due + 1000, async (_e, _s, p) => (sent.push(p), { ok: true, status: 201 }));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, 'water');
  assert.equal(DB.raw.prepare('SELECT COUNT(*) c FROM slots WHERE once = 1').get().c, 0);
});

test('api: status shows the server-side schedule and spots a stuck scheduler', async () => {
  const { DB, env } = setup();
  assert.equal((await api(env, '/api/status', { id: 'nope', token: 'nope' })).status, 401);
  const { id, token } = await (await api(env, '/api/subscribe', { subscription: browserSub(), tz: 'Asia/Kolkata', settings: {} })).json();
  let st = await (await api(env, '/api/status', { id, token })).json();
  assert.equal(st.tz, 'Asia/Kolkata');
  assert.ok(st.slots.length > 0);
  assert.equal(st.overdue, 0);
  assert.ok(st.slots.every((s) => s.due > st.now - 1000 && typeof s.time === 'string'));
  // pretend the cron stopped: everything is 10 minutes overdue
  DB.raw.prepare('UPDATE slots SET next_due = ?').run(Date.now() - 10 * 60000);
  st = await (await api(env, '/api/status', { id, token })).json();
  assert.equal(st.overdue, st.slots.length);
});
