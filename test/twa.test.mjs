import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import worker from '../src/index.js';
import { normaliseFingerprint, validate, build } from '../scripts/make-assetlinks.mjs';

const SCRIPT = new URL('../scripts/make-assetlinks.mjs', import.meta.url).pathname;
const FP1 = Array.from({ length: 32 }, (_, i) => (i * 7 + 3).toString(16).padStart(2, '0').toUpperCase()).join(':');
const FP2 = Array.from({ length: 32 }, (_, i) => (255 - i * 5).toString(16).padStart(2, '0').toUpperCase()).join(':');
const run = (...args) => spawnSync('node', [SCRIPT, ...args], { encoding: 'utf8' });

test('twa: /.well-known/assetlinks.json is served from public/twa with the right type, and 404s if there is none', async () => {
  const seen = [];
  const env = { ASSETS: { fetch: async (req) => (seen.push(new URL(req.url).pathname), new URL(req.url).pathname === '/twa/assetlinks.json' ? new Response('[{"ok":true}]') : new Response('asset')) } };
  const res = await worker.fetch(new Request('https://ammmaa.test/.well-known/assetlinks.json'), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.equal(await res.text(), '[{"ok":true}]');
  assert.deepEqual(seen, ['/twa/assetlinks.json']);
  const head = await worker.fetch(new Request('https://ammmaa.test/.well-known/assetlinks.json', { method: 'HEAD' }), env);
  assert.equal(head.status, 200);
  const none = await worker.fetch(new Request('https://ammmaa.test/.well-known/assetlinks.json'), { ASSETS: { fetch: async () => new Response('x', { status: 404 }) } });
  assert.equal(none.status, 404);
  // other paths still go to the normal assets
  assert.equal(await (await worker.fetch(new Request('https://ammmaa.test/'), env)).text(), 'asset');
});

test('twa: the shipped placeholder is a valid, empty list and the manifest has shortcuts to the tabs', () => {
  assert.deepEqual(JSON.parse(readFileSync(new URL('../public/twa/assetlinks.json', import.meta.url), 'utf8')), []);
  const m = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.deepEqual(m.shortcuts.map((s) => s.url), ['/#chat', '/#reminders']);
  assert.equal(m.id, '/');
  assert.equal(m.start_url, '/');
});

test('assetlinks script: normalises pasted fingerprints and builds the standard structure', () => {
  assert.equal(normaliseFingerprint(`SHA256: ${FP1.toLowerCase()} ,`), FP1);
  assert.equal(normaliseFingerprint(`sha-256=${FP1}`), FP1);
  const list = build('com.example.ammmaa', [FP1, FP2]);
  assert.equal(validate(list), '');
  assert.deepEqual(list[0].relation, ['delegate_permission/common.handle_all_urls']);
  assert.equal(list[0].target.namespace, 'android_app');
});

test('assetlinks script: writes the file, accepts two fingerprints, and --check agrees', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'twa-')), 'a', 'assetlinks.json');
  const r = run('com.example.ammmaa', FP1.toLowerCase(), `SHA256:${FP2}`, FP1, `--out=${out}`);
  assert.equal(r.status, 0, r.stderr);
  const written = JSON.parse(readFileSync(out, 'utf8'));
  assert.deepEqual(written[0].target.sha256_cert_fingerprints, [FP1, FP2], 'upper-cased and de-duplicated');
  const c = run('--check', `--out=${out}`);
  assert.equal(c.status, 0, c.stderr);
  assert.match(c.stdout, /OK: com\.example\.ammmaa with 2 fingerprint/);
});

test('assetlinks script: bad input gives a clear message and writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'twa-'));
  const out = join(dir, 'assetlinks.json');
  let r = run('not a package', FP1, `--out=${out}`);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not a valid package name/);
  r = run('com.example.ammmaa', 'AA:BB:CC', `--out=${out}`);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /not a SHA-256 fingerprint/);
  r = run('com.example.ammmaa', `--out=${out}`);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Usage/);
  writeFileSync(out, '[{"relation": ["delegate_permission/common.handle_all_urls"], "target": {"namespace": "android_app", "package_name": "com.x.y", "sha256_cert_fingerprints": ["AA:BB"]}}]');
  assert.match(run('--check', `--out=${out}`).stderr, /not a SHA-256 fingerprint/);
  writeFileSync(out, '[]');
  assert.match(run('--check', `--out=${out}`).stderr, /no Android app is linked yet/);
  writeFileSync(out, '{"oops": true');
  assert.match(run('--check', `--out=${out}`).stderr, /as JSON/);
});
