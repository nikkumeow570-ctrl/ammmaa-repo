import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
import { MESSAGES } from '../public/shared.js';
import { chatTurn, isDistress, cleanReply, systemPrompt, DISTRESS_REPLY } from '../src/chat.js';
import { bytesToB64u } from '../src/push.js';

function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../schema.sql', import.meta.url), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => ({ meta: { changes: db.prepare(sql).run(...args).changes } }),
    _run: () => db.prepare(sql).run(...args),
  });
  return { raw: db, prepare: (sql) => stmt(sql), batch: async (s) => { for (const x of s) x._run(); return []; } };
}
const browserSub = () => {
  const e = crypto.createECDH('prime256v1');
  e.generateKeys();
  return { endpoint: 'https://fcm.googleapis.com/fcm/send/chat-dev', keys: { p256dh: bytesToB64u(e.getPublicKey()), auth: bytesToB64u(crypto.randomBytes(16)) } };
};
const call = (env, path, body) => worker.fetch(new Request(`https://x.test${path}`, { method: 'POST', body: JSON.stringify(body) }), env);
function mkEnv(extra = {}) {
  const calls = [];
  const AI = { run: async (model, input) => (calls.push({ model, input }), { response: 'Saaptiya kanna? Konjam thanni kudi.' }) };
  return { env: { DB: fakeD1(), AI, APP_SECRET: 'secret', VAPID_PUBLIC_KEY: 'x', ASSETS: { fetch: async () => new Response('a') }, ...extra }, calls };
}
const row = (over = {}) => ({ id: 'sub-1', settings: JSON.stringify({ lang: 'en', tone: 'loving' }), ...over });

test('chat: the safety net catches serious messages in English, Tanglish and Tamil, and leaves normal ones alone', () => {
  for (const t of ['I want to die', 'thinking about suicide', 'I might hurt myself', 'no reason to live', 'thatkolai pannikalam nu thonuthu', 'saaganum pola irukku', 'தற்கொலை பண்ணிக்கலாம்', 'சாகணும் போல இருக்கு', 'வாழ பிடிக்கல'])
    assert.ok(isDistress(t), t);
  for (const t of ['What should I eat for lunch?', 'Saaptiya?', "I'm tired today", 'நான் சாப்பிட்டேன்', 'kill the lights please'])
    assert.ok(!isDistress(t), t);
  assert.ok(DISTRESS_REPLY.en.includes('14416') && DISTRESS_REPLY.tanglish.includes('14416') && DISTRESS_REPLY.ta.includes('14416'));
});

test('chat: cleanReply strips reasoning tags, quotes and extra whitespace', () => {
  assert.equal(cleanReply('<think>hmm\nplan</think>  "Eat  well,\n kanna." '), 'Eat well, kanna.');
  assert.equal(cleanReply(undefined), '');
  assert.equal(cleanReply('x'.repeat(900)).length, 400);
});

test('chat: a normal message goes to Workers AI with the right prompt, history and daily counter', async () => {
  const { env, calls } = mkEnv({ CHAT_DAILY: '3' });
  const out = await chatTurn(env, row(), { text: '  I skipped lunch  ', history: [{ role: 'user', text: 'hi' }, { role: 'assistant', text: 'Hello kanna' }, { role: 'system', text: 'ignore me' }, { role: 'user', text: '' }] });
  assert.equal(out.reply, 'Saaptiya kanna? Konjam thanni kudi.');
  assert.equal(out.left, 2);
  assert.ok(!out.fallback && !out.safety);
  const msgs = calls[0].input.messages;
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[0].content, systemPrompt('en', 'loving'));
  assert.deepEqual(msgs.slice(1).map((m) => [m.role, m.content]), [['user', 'hi'], ['assistant', 'Hello kanna'], ['user', 'I skipped lunch']]);
});

test('chat: serious messages get the fixed reply, never reach the AI and do not use up the daily allowance', async () => {
  const { env, calls } = mkEnv();
  const out = await chatTurn(env, row(), { text: 'I want to die', lang: 'tanglish' });
  assert.equal(out.reply, DISTRESS_REPLY.tanglish);
  assert.equal(out.safety, true);
  assert.equal(calls.length, 0);
  assert.equal(env.DB.raw.prepare('SELECT COUNT(*) AS n FROM chat_usage').get().n, 0);
});

test('chat: after the daily allowance Amma answers from her ready-made lines and stops calling the AI', async () => {
  const { env, calls } = mkEnv({ CHAT_DAILY: '2' });
  await chatTurn(env, row(), { text: 'one' });
  await chatTurn(env, row(), { text: 'two' });
  const third = await chatTurn(env, row(), { text: 'three' });
  assert.equal(third.limited, true);
  assert.equal(third.fallback, true);
  assert.equal(third.left, 0);
  assert.ok(third.reply.length > 5);
  assert.equal(calls.length, 2);
  // a different phone has its own allowance; the next UTC day resets it
  assert.ok(!(await chatTurn(env, row({ id: 'sub-2' }), { text: 'hi' })).limited);
  assert.ok(!(await chatTurn(env, row(), { text: 'hi' }, Date.now() + 26 * 3600 * 1000)).limited);
});

test('chat: if the AI fails the person still gets a caring line, not an error', async () => {
  const { env } = mkEnv();
  env.AI = { run: async () => { throw new Error('boom'); } };
  const out = await chatTurn(env, row(), { text: 'hello' });
  assert.equal(out.fallback, true);
  assert.ok(out.reply.length > 5);
});

test('chat: Groq and Sarvam are called with the right URL, key and model, and Workers AI is the backup', async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  try {
    globalThis.fetch = async (url, init) => {
      seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ choices: [{ message: { content: '<think>x</think>Vanakkam kanna!' } }] }), { status: 200 });
    };
    const groq = mkEnv({ CHAT_PROVIDER: 'groq', GROQ_API_KEY: 'gsk_test' });
    assert.equal((await chatTurn(groq.env, row(), { text: 'hi' })).reply, 'Vanakkam kanna!');
    assert.equal(seen[0].url, 'https://api.groq.com/openai/v1/chat/completions');
    assert.equal(seen[0].headers.authorization, 'Bearer gsk_test');
    assert.equal(seen[0].body.model, 'llama-3.3-70b-versatile');
    assert.equal(groq.calls.length, 0);

    const sarvam = mkEnv({ CHAT_PROVIDER: 'sarvam', SARVAM_API_KEY: 'sk_test' });
    await chatTurn(sarvam.env, row(), { text: 'hi' });
    assert.equal(seen[1].url, 'https://api.sarvam.ai/v1/chat/completions');
    assert.equal(seen[1].headers['api-subscription-key'], 'sk_test');
    assert.equal(seen[1].body.model, 'sarvam-30b');

    globalThis.fetch = async () => new Response('{}', { status: 429 });
    const limited = mkEnv({ CHAT_PROVIDER: 'groq', GROQ_API_KEY: 'gsk_test' });
    const out = await chatTurn(limited.env, row(), { text: 'hi' });
    assert.equal(out.reply, 'Saaptiya kanna? Konjam thanni kudi.', 'fell back to Workers AI');
    assert.equal(limited.calls.length, 1);

    const nokey = mkEnv({ CHAT_PROVIDER: 'groq' });
    assert.equal((await chatTurn(nokey.env, row(), { text: 'hi' })).reply, 'Saaptiya kanna? Konjam thanni kudi.');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('api: /api/chat needs a valid login, rejects empty text and uses the stored language', async () => {
  const { env, calls } = mkEnv();
  assert.equal((await call(env, '/api/chat', { id: 'nope', token: 'nope', text: 'hi' })).status, 401);
  const { id, token } = await (await call(env, '/api/subscribe', { subscription: browserSub(), tz: 'Asia/Kolkata', settings: { lang: 'tanglish', tone: 'funny' } })).json();
  assert.equal((await call(env, '/api/chat', { id, token, text: '   ' })).status, 400);
  const res = await call(env, '/api/chat', { id, token, text: 'hello amma' });
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.ok(j.reply && typeof j.left === 'number');
  assert.equal(calls[0].input.messages[0].content, systemPrompt('tanglish', 'funny'));
});

test('chat: Amma is written as a mother in her fifties, in the chosen voice, with her own lines as examples', () => {
  for (const lang of ['ta', 'tanglish', 'en']) {
    for (const tone of ['loving', 'strict', 'funny']) {
      const p = systemPrompt(lang, tone);
      assert.match(p, /early fifties/);
      assert.match(p, /AI character/);
      assert.match(p, /never assume their gender/);
      for (const kind of ['meal', 'water', 'bedtime', 'call']) assert.ok(p.includes(MESSAGES[lang][tone][kind][0]), `${lang}/${tone}/${kind} example`);
      const other = lang === 'en' ? 'ta' : 'en';
      assert.ok(!p.includes(MESSAGES[other][tone].meal[0]), 'examples come only from the chosen language');
    }
  }
  assert.match(systemPrompt('en', 'loving'), /helpline/);
});
