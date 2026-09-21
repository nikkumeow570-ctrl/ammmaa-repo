#!/usr/bin/env node
// Writes (or checks) public/twa/assetlinks.json, the file that lets the Android app open this site without a browser bar.
//
//   node scripts/make-assetlinks.mjs com.example.anbudanamma AA:BB:...:FF [second fingerprint ...]
//   node scripts/make-assetlinks.mjs --check          # validate the file that is there now
//
// Use the SHA-256 fingerprint of the key that signed the app people install. If the app is on Google Play with Play App
// Signing, that is the key shown in Play Console (Setup, App integrity); list your own upload key as well while testing.
// The worker serves the file at /.well-known/assetlinks.json (see src/index.js).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => a.slice(2).split('=')).map(([k, v]) => [k, v ?? true]));
const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const OUT = resolve(flags.out || `${ROOT}/public/twa/assetlinks.json`);

const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

export function normaliseFingerprint(raw) {
  return String(raw).trim().replace(/^sha-?256\s*[:=]?\s*/i, '').replace(/[\s,]+/g, '').toUpperCase();
}

export function validate(list) {
  if (!Array.isArray(list)) return 'The file must be a JSON list.';
  for (const item of list) {
    const t = item && item.target;
    if (!item || !Array.isArray(item.relation) || !item.relation.includes('delegate_permission/common.handle_all_urls')) return 'Missing the handle_all_urls relation.';
    if (!t || t.namespace !== 'android_app') return 'The target namespace must be android_app.';
    if (!PACKAGE.test(t.package_name || '')) return `"${t && t.package_name}" is not a valid package name.`;
    if (!Array.isArray(t.sha256_cert_fingerprints) || !t.sha256_cert_fingerprints.length) return 'Add at least one fingerprint.';
    for (const f of t.sha256_cert_fingerprints) if (!FINGERPRINT.test(f)) return `"${f}" is not a SHA-256 fingerprint (32 pairs like AA:BB:...).`;
  }
  return '';
}

export function build(pkg, fingerprints) {
  return [{ relation: ['delegate_permission/common.handle_all_urls'], target: { namespace: 'android_app', package_name: pkg, sha256_cert_fingerprints: fingerprints } }];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (flags.check) {
    let list;
    try {
      list = JSON.parse(readFileSync(OUT, 'utf8'));
    } catch (e) {
      fail(`Cannot read ${OUT} as JSON: ${e.message}`);
    }
    if (Array.isArray(list) && list.length === 0) fail('The file is empty: no Android app is linked yet.');
    const problem = validate(list);
    if (problem) fail(`Problem: ${problem}`);
    const t = list[0].target;
    console.log(`OK: ${t.package_name} with ${t.sha256_cert_fingerprints.length} fingerprint(s)`);
  } else {
    const [pkg, ...raw] = positional;
    if (!pkg || !raw.length) fail('Usage: node scripts/make-assetlinks.mjs <package.name> <SHA-256 fingerprint> [more fingerprints...]\n       node scripts/make-assetlinks.mjs --check');
    if (!PACKAGE.test(pkg)) fail(`"${pkg}" is not a valid package name (like com.yourname.anbudanamma).`);
    const fingerprints = [...new Set(raw.map(normaliseFingerprint))];
    const bad = fingerprints.find((f) => !FINGERPRINT.test(f));
    if (bad) fail(`"${bad}" is not a SHA-256 fingerprint. It has 32 pairs of letters and digits separated by colons, like AA:BB:CC:...`);
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(build(pkg, fingerprints), null, 2) + '\n');
    console.log(`Wrote ${OUT}\nPush it, then open /.well-known/assetlinks.json on your site to see it.`);
  }
}
