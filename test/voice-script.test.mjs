import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MESSAGES, voiceKey } from '../public/shared.js';

const SCRIPT = new URL('../scripts/make-voice.mjs', import.meta.url).pathname;

// A stand-in for the real `edge-tts` command: lists voices, "speaks" by writing a small file, logs every request.
function makeStub(dir, { voices = ['ta-IN-PallaviNeural', 'ta-IN-ValluvarNeural', 'en-IN-NeerjaNeural'] } = {}) {
  const stub = join(dir, 'edge-tts-stub');
  writeFileSync(stub, `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
if (a.includes('--list-voices')) { console.log('Name Gender'); for (const v of ${JSON.stringify(voices)}) console.log(v + ' Female General'); process.exit(0); }
const get = (f) => a[a.indexOf(f) + 1];
const text = get('--text'), out = get('--write-media'), voice = get('--voice');
const rate = a.find((x) => x.startsWith('--rate='));
fs.appendFileSync(process.env.STUB_LOG, JSON.stringify({ voice, rate, text }) + '\\n');
const fail = process.env.STUB_FAIL_ONCE;
if (fail && text.includes(fail) && !fs.existsSync(process.env.STUB_LOG + '.failed')) { fs.writeFileSync(process.env.STUB_LOG + '.failed', '1'); console.error('simulated network error'); process.exit(1); }
fs.writeFileSync(out, Buffer.alloc(2048, 7));
`);
  chmodSync(stub, 0o755);
  return stub;
}
const run = (dir, stub, extra = [], env = {}) =>
  spawnSync('node', [SCRIPT, `--out=${join(dir, 'voice')}`, ...extra], { encoding: 'utf8', env: { ...process.env, EDGE_TTS: stub, STUB_LOG: join(dir, 'log.jsonl'), PACE_MS: '0', RETRY_MS: '1', ...env } });
const logOf = (dir) => (existsSync(join(dir, 'log.jsonl')) ? readFileSync(join(dir, 'log.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

test('voice script: makes one clip per line, names them with the shared key, and writes a matching manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-'));
  const r = run(dir, makeStub(dir));
  assert.equal(r.status, 0, r.stderr);
  const manifest = JSON.parse(readFileSync(join(dir, 'voice', 'manifest.json'), 'utf8'));
  let lines = 0;
  for (const lang of Object.keys(MESSAGES)) {
    const want = new Set();
    for (const tone of Object.keys(MESSAGES[lang])) for (const kind of Object.keys(MESSAGES[lang][tone])) for (const t of MESSAGES[lang][tone][kind]) { want.add(voiceKey(lang, t)); lines++; }
    assert.deepEqual(manifest.clips[lang], [...want].sort(), `manifest for ${lang}`);
    assert.deepEqual(readdirSync(join(dir, 'voice', lang)).sort(), [...want].sort().map((k) => `${k}.mp3`));
  }
  assert.equal(lines, 108);
  const log = logOf(dir);
  assert.equal(log.length, 108);
  assert.ok(log.every((l) => !/[\p{Extended_Pictographic}]/u.test(l.text)), 'emoji are not spoken');
  assert.ok(log.every((l) => l.rate === '--rate=-5%'));
  assert.ok(log.some((l) => l.voice === 'ta-IN-PallaviNeural') && log.some((l) => l.voice === 'en-IN-NeerjaNeural'));
});

test('voice script: retries a failed request, resumes without redoing finished clips, and can be limited to one language', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-'));
  const stub = makeStub(dir);
  let r = run(dir, stub, ['--lang=en'], { STUB_FAIL_ONCE: 'water' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(existsSync(join(dir, 'log.jsonl.failed')), 'a failure really happened');
  const manifest = JSON.parse(readFileSync(join(dir, 'voice', 'manifest.json'), 'utf8'));
  assert.equal(manifest.clips.en.length, 36);
  assert.equal(manifest.clips.ta.length, 0);
  const calls = logOf(dir).length;
  r = run(dir, stub, ['--lang=en']);
  assert.equal(r.status, 0);
  assert.equal(logOf(dir).length, calls, 'nothing is made twice');
  assert.match(r.stdout, /36 already done, 0 to make/);
});

test('voice script: a missing voice or a missing edge-tts command gives a clear message and makes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-'));
  let r = run(dir, makeStub(dir, { voices: ['ta-IN-ValluvarNeural', 'en-IN-NeerjaNeural'] }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not available: ta-IN-PallaviNeural/);
  assert.match(r.stderr, /ta-IN-ValluvarNeural/);
  assert.equal(logOf(dir).length, 0);
  r = run(dir, join(dir, 'does-not-exist'));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /pip install edge-tts/);
});

test('voice script: --dry only prints the plan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-'));
  const r = run(dir, makeStub(dir), ['--dry']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /108 lines, \d+ characters/);
  assert.equal(logOf(dir).length, 0);
  assert.ok(!existsSync(join(dir, 'voice', 'manifest.json')));
});

test('voice script: TANGLISH_FROM=ta speaks the Tamil twin of every Tanglish line with the Tamil voice, under the Tanglish key', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-'));
  const r = run(dir, makeStub(dir), ['--lang=tanglish'], { TANGLISH_FROM: 'ta' });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const log = logOf(dir);
  assert.equal(log.length, 36);
  assert.ok(log.every((l) => l.voice === 'ta-IN-PallaviNeural'), 'the Tamil voice is used');
  assert.ok(log.every((l) => /[\u0B80-\u0BFF]/.test(l.text)), 'Tamil text is spoken');
  const strip = (x) => x.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/\s+/g, ' ').trim();
  const twins = [];
  const keys = [];
  for (const tone of Object.keys(MESSAGES.tanglish)) for (const kind of Object.keys(MESSAGES.tanglish[tone])) MESSAGES.tanglish[tone][kind].forEach((line, i) => { keys.push(voiceKey('tanglish', line)); twins.push(strip(MESSAGES.ta[tone][kind][i])); });
  assert.deepEqual(log.map((l) => l.text).sort(), twins.sort());
  const manifest = JSON.parse(readFileSync(join(dir, 'voice', 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.clips.tanglish, [...new Set(keys)].sort());
  assert.equal(manifest.voices.tanglish, 'ta-IN-PallaviNeural');
});

test('voice script: without TANGLISH_FROM the Tanglish clips keep using the English voice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'voice-'));
  const r = run(dir, makeStub(dir), ['--lang=tanglish']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.ok(logOf(dir).every((l) => l.voice === 'en-IN-NeerjaNeural' && !/[\u0B80-\u0BFF]/.test(l.text)));
});
