import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { generateAiLines } from '../src/ai.js';
import { chooseText } from '../src/cron.js';
import { LANGS, TONES, KINDS, MESSAGES } from '../public/shared.js';

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
  return { raw: db, prepare: (s) => stmt(s), batch: async (ss) => { db.exec('BEGIN'); try { for (const s of ss) s._run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } return []; } };
}

const DAY = 86400000;
const langOn = (now) => LANGS[Math.floor(now / DAY) % LANGS.length].id;
const rows = (DB, lang) => DB.raw.prepare('SELECT * FROM ai_lines WHERE lang = ?').all(lang);

test('ai variations: off means nothing is generated and the model is never called', async () => {
  let calls = 0;
  const env = { DB: fakeD1(), AI: { run: async () => (calls++, { response: '[]' }) }, AI_VARIATIONS: 'off' };
  assert.deepEqual(await generateAiLines(env, DAY), { skipped: true });
  assert.equal(calls, 0);
});

test('ai variations: one language per day, Amma persona and style examples in the prompt, only good lines are kept', async () => {
  const DB = fakeD1();
  const now = DAY * 4; // a Tanglish day
  const lang = langOn(now);
  assert.equal(lang, 'tanglish');
  const prompts = [];
  const reply = ['Saaptiya kanna, eppo saapduve?', 'Ok', 'Saaptiya da? Vayiru kaaliya irukku?', 'This has far too many words in it to be a short line for a mother', 'சாப்பிட்டியா கண்ணா நீ', 'See www.example.com now please'];
  const env = { DB, AI_VARIATIONS: 'on', AI: { run: async (model, input) => (prompts.push(input.messages), { response: `Sure! ${JSON.stringify(reply)}` }) } };
  const out = await generateAiLines(env, now);
  assert.equal(out.lang, 'tanglish');
  assert.equal(prompts.length, TONES.length * KINDS.length);
  const [sys, user] = prompts[0].map((m) => m.content);
  assert.match(sys, /early fifties/);
  assert.match(user, /Saaptiya kanna\? Vayiru kaaliya irukka\?/, 'style examples are in the prompt');
  assert.match(user, /Never use "da" or "di"/);
  assert.match(user, /at most 8 words/);
  const saved = rows(DB, 'tanglish');
  assert.ok(saved.length > 0);
  // of the six candidate lines only the first and third are short, Latin-script, link-free (the third has "da": that is a prompt rule, not a filter)
  assert.deepEqual([...new Set(saved.map((r) => r.text))].sort(), ['Saaptiya da? Vayiru kaaliya irukku?', 'Saaptiya kanna, eppo saapduve?']);
  assert.equal(saved.length, 2 * TONES.length * KINDS.length);
  assert.equal(rows(DB, 'ta').length + rows(DB, 'en').length, 0, 'other languages are untouched today');
});

test('ai variations: a different language on the next day, and Tamil lines must be in Tamil script', async () => {
  const DB = fakeD1();
  const env = { DB, AI_VARIATIONS: 'on', AI: { run: async () => ({ response: JSON.stringify(['சாப்பிட்டியா கண்ணா நீ', 'Saaptiya kanna nee']) }) } };
  const out = await generateAiLines(env, DAY * 3); // LANGS[0] = ta
  assert.equal(out.lang, 'ta');
  assert.deepEqual([...new Set(rows(DB, 'ta').map((r) => r.text))], ['சாப்பிட்டியா கண்ணா நீ']);
});

test('ai variations: at most 30 lines are kept per language, tone and kind, newest first', async () => {
  const DB = fakeD1();
  for (let i = 0; i < 35; i++) DB.raw.prepare("INSERT INTO ai_lines (lang, tone, kind, text, created_at) VALUES ('en', 'loving', 'meal', ?, 0)").run(`old line number ${i}`);
  const env = { DB, AI_VARIATIONS: 'on', AI: { run: async () => ({ response: JSON.stringify(['Eat something now, kanna']) }) } };
  await generateAiLines(env, DAY * 5); // an English day
  const kept = DB.raw.prepare("SELECT text FROM ai_lines WHERE lang='en' AND tone='loving' AND kind='meal' ORDER BY id DESC").all();
  assert.equal(kept.length, 30);
  assert.equal(kept[0].text, 'Eat something now, kanna');
});

test('ai variations: if the model fails, nothing breaks and the hand-written lines stay', async () => {
  const env = { DB: fakeD1(), AI_VARIATIONS: 'on', AI: { run: async () => { throw new Error('over the free limit'); } } };
  const out = await generateAiLines(env, DAY * 4);
  assert.equal(out.added, 0);
});

test('ai variations: reminders use an AI line about a third of the time, never when switched off', async () => {
  const DB = fakeD1();
  DB.raw.prepare("INSERT INTO ai_lines (lang, tone, kind, text, created_at) VALUES ('en', 'loving', 'meal', 'AI wrote this one, kanna', 0)").run();
  const settings = { lang: 'en', tone: 'loving' };
  assert.equal(await chooseText({ DB, AI_VARIATIONS: 'on' }, settings, 'meal', () => 0.1), 'AI wrote this one, kanna');
  const bank = await chooseText({ DB, AI_VARIATIONS: 'on' }, settings, 'meal', () => 0.9);
  assert.ok(MESSAGES.en.loving.meal.includes(bank), 'the other times it is a hand-written line');
  const off = await chooseText({ DB, AI_VARIATIONS: 'off' }, settings, 'meal', () => 0.1);
  assert.ok(MESSAGES.en.loving.meal.includes(off));
});
