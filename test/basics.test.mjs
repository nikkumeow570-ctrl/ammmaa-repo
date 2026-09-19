import test from 'node:test';
import assert from 'node:assert/strict';
import { nextOccurrence, inQuiet, localToUtc, localParts, isValidTz } from '../src/time.js';
import { buildSlots, normalizeSettings, MESSAGES, LANGS, TONES, KINDS, DEFAULTS, pickLine } from '../public/shared.js';

test('nextOccurrence: Asia/Kolkata (UTC+5:30, no DST)', () => {
  const after = Date.UTC(2026, 8, 19, 6, 0); // 11:30 IST
  const t = nextOccurrence('13:00', 'Asia/Kolkata', after);
  assert.equal(new Date(t).toISOString(), '2026-09-19T07:30:00.000Z');
  const t2 = nextOccurrence('11:00', 'Asia/Kolkata', after); // already passed today -> tomorrow
  assert.equal(new Date(t2).toISOString(), '2026-09-20T05:30:00.000Z');
});

test('nextOccurrence: strictly after, and weekday filter', () => {
  const at = Date.UTC(2026, 8, 19, 7, 30); // exactly 13:00 IST Saturday
  const t = nextOccurrence('13:00', 'Asia/Kolkata', at);
  assert.equal(new Date(t).toISOString(), '2026-09-20T07:30:00.000Z');
  const sun = nextOccurrence('18:00', 'Asia/Kolkata', at, 0); // next Sunday 18:00 IST
  assert.equal(new Date(sun).toISOString(), '2026-09-20T12:30:00.000Z');
  const wed = nextOccurrence('18:00', 'Asia/Kolkata', at, 3);
  assert.equal(new Date(wed).toISOString(), '2026-09-23T12:30:00.000Z');
});

test('nextOccurrence: DST-aware (America/New_York)', () => {
  // US DST ends 2026-11-01. 08:00 local on Oct 31 = 12:00Z (EDT), on Nov 2 = 13:00Z (EST).
  const t1 = nextOccurrence('08:00', 'America/New_York', Date.UTC(2026, 9, 30, 20, 0));
  assert.equal(new Date(t1).toISOString(), '2026-10-31T12:00:00.000Z');
  const t2 = nextOccurrence('08:00', 'America/New_York', Date.UTC(2026, 10, 1, 20, 0));
  assert.equal(new Date(t2).toISOString(), '2026-11-02T13:00:00.000Z');
});

test('localParts / localToUtc round trip', () => {
  const ms = Date.UTC(2026, 2, 8, 15, 45);
  for (const tz of ['Asia/Kolkata', 'America/Los_Angeles', 'Europe/London', 'Asia/Singapore', 'Australia/Sydney']) {
    const p = localParts(ms, tz);
    assert.equal(localToUtc(p.y, p.m, p.d, p.h, p.min, tz), ms);
  }
  assert.ok(isValidTz('Asia/Kolkata'));
  assert.ok(!isValidTz('Mars/Olympus'));
});

test('inQuiet handles wrap past midnight', () => {
  assert.ok(inQuiet(23 * 60, '22:00', '07:00'));
  assert.ok(inQuiet(3 * 60, '22:00', '07:00'));
  assert.ok(!inQuiet(7 * 60, '22:00', '07:00'));
  assert.ok(!inQuiet(12 * 60, '22:00', '07:00'));
  assert.ok(inQuiet(13 * 60, '12:00', '14:00'));
  assert.ok(!inQuiet(5, '00:00', '00:00'));
});

test('normalizeSettings rejects junk and clamps numbers', () => {
  const s = normalizeSettings({ lang: 'klingon', tone: 5, cap: 9999, quiet: { start: '25:99' }, reminders: { water: { everyMin: 1, from: 'x' } } });
  assert.equal(s.lang, DEFAULTS.lang);
  assert.equal(s.tone, DEFAULTS.tone);
  assert.equal(s.cap, 20);
  assert.equal(s.quiet.start, DEFAULTS.quiet.start);
  assert.equal(s.reminders.water.everyMin, 30);
  assert.equal(s.reminders.water.from, DEFAULTS.reminders.water.from);
  assert.deepEqual(normalizeSettings(null), normalizeSettings(undefined));
});

test('buildSlots: defaults give meals, water, bedtime', () => {
  const slots = buildSlots(DEFAULTS);
  assert.equal(slots.filter((s) => s.kind === 'meal').length, 3);
  assert.deepEqual(slots.filter((s) => s.kind === 'water').map((s) => s.time), ['09:00', '11:00', '13:00', '15:00', '17:00', '19:00']);
  assert.equal(slots.filter((s) => s.kind === 'bedtime').length, 1);
  assert.equal(slots.filter((s) => s.kind === 'break').length, 0);
  const call = buildSlots({ reminders: { call: { on: true, day: 3, time: '19:15' } } }).find((s) => s.kind === 'call');
  assert.equal(call.dow, 3);
});

test('message bank is complete for every language, tone and kind', () => {
  for (const l of LANGS) for (const t of TONES) for (const k of KINDS) {
    const lines = MESSAGES[l.id][t.id][k];
    assert.ok(Array.isArray(lines) && lines.length >= 2, `${l.id}/${t.id}/${k}`);
    for (const line of lines) assert.ok(typeof line === 'string' && line.length > 5 && line.length < 90);
    if (l.id === 'ta') for (const line of lines) assert.match(line, /[\u0B80-\u0BFF]/);
    else for (const line of lines) assert.doesNotMatch(line, /[\u0B80-\u0BFF]/);
  }
  assert.ok(pickLine('ta', 'loving', 'meal', () => 0).length > 0);
});
