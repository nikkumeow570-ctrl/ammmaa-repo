#!/usr/bin/env node
// Makes a voice clip (MP3) for every line in Amma's message bank using the `edge-tts` command line tool,
// then writes public/voice/manifest.json so the app knows which clips exist.
//
//   pip install edge-tts            (Termux: pkg install python && pip install edge-tts)
//   node scripts/make-voice.mjs     (safe to re-run: existing clips are skipped, so it resumes after a failure)
//
// Options:  --lang=ta,en   only these languages     --dry   show the plan and character count, make nothing
//           --out=DIR      output folder (default public/voice)
// Env:      VOICE_TA, VOICE_TANGLISH, VOICE_EN (voice names), RATE (default -5%), EDGE_TTS (command name),
//           TANGLISH_FROM=ta  make the Tanglish clips by speaking each line's Tamil-script twin with the Tamil voice
//                             (usually sounds more natural than an English voice reading Tanglish; listen and compare),
//           PACE_MS / RETRY_MS (pauses, only useful for tests)
//
// NOTE: edge-tts uses Microsoft Edge's read-aloud service through an unofficial client. Microsoft publishes nothing
// about commercial use, so treat these clips as a prototype and replace them with a licensed voice before a public launch.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MESSAGES, voiceKey } from '../public/shared.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map((a) => (a.startsWith('--') ? a.slice(2).split('=') : [a, true])).map(([k, v]) => [k, v ?? true]));
const OUT = resolve(args.out || join(ROOT, 'public', 'voice'));
const EDGE = process.env.EDGE_TTS || 'edge-tts';
const RATE = process.env.RATE || '-5%';
const VOICES = {
  ta: process.env.VOICE_TA || 'ta-IN-PallaviNeural',
  tanglish: process.env.VOICE_TANGLISH || 'en-IN-NeerjaNeural', // an Indian-English voice reads Tanglish naturally
  en: process.env.VOICE_EN || 'en-IN-NeerjaNeural',
};
const onlyLangs = args.lang ? String(args.lang).split(',') : Object.keys(MESSAGES);
const TANGLISH_FROM_TA = process.env.TANGLISH_FROM === 'ta'; // the Tamil and Tanglish banks are line-for-line twins

// The text we speak: no emoji (they would be read out loud), tidy spaces. The clip's key still comes from the original line.
const spoken = (t) => t.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').replace(/\s+/g, ' ').trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PACE_MS = Number(process.env.PACE_MS ?? 250); // pause between requests, to be gentle with the service
const RETRY_MS = Number(process.env.RETRY_MS ?? 1200);

function plan() {
  const seen = new Set();
  const jobs = [];
  for (const lang of onlyLangs) {
    for (const tone of Object.keys(MESSAGES[lang] || {})) {
      for (const kind of Object.keys(MESSAGES[lang][tone])) {
        MESSAGES[lang][tone][kind].forEach((text, i) => {
          const key = voiceKey(lang, text);
          if (seen.has(lang + key)) return;
          seen.add(lang + key);
          let say = spoken(text);
          let voice = VOICES[lang];
          const twin = lang === 'tanglish' && TANGLISH_FROM_TA ? MESSAGES.ta?.[tone]?.[kind]?.[i] : null;
          if (twin) {
            say = spoken(twin);
            voice = VOICES.ta;
          }
          jobs.push({ lang, key, text, say, voice, file: join(OUT, lang, `${key}.mp3`) });
        });
      }
    }
  }
  return jobs;
}

function listVoices() {
  const r = spawnSync(EDGE, ['--list-voices'], { encoding: 'utf8' });
  if (r.error || r.status !== 0) {
    console.error(`Could not run "${EDGE} --list-voices".\nInstall it first:  pip install edge-tts   (Termux: pkg install python && pip install edge-tts)`);
    if (r.stderr) console.error(String(r.stderr).split('\n').slice(-4).join('\n'));
    process.exit(1);
  }
  return new Set(String(r.stdout).split('\n').map((l) => l.trim().split(/\s+/)[0]).filter((n) => /Neural$/.test(n)));
}

function synth(voice, text, file) {
  return new Promise((ok, fail) => {
    const tmp = `${file}.part`;
    const p = spawn(EDGE, ['--voice', voice, `--rate=${RATE}`, '--text', text, '--write-media', tmp], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', fail);
    p.on('close', (code) => {
      if (code === 0 && existsSync(tmp) && statSync(tmp).size > 1000) {
        renameSync(tmp, file);
        ok();
      } else {
        rmSync(tmp, { force: true });
        fail(new Error(err.trim().split('\n').pop() || `exit ${code}`));
      }
    });
  });
}

async function withRetry(job) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await synth(job.voice, job.say, job.file);
      return true;
    } catch (e) {
      job.lastError = e.message;
      await sleep(RETRY_MS * attempt);
    }
  }
  return false;
}

function writeManifest() {
  const clips = {};
  for (const lang of Object.keys(MESSAGES)) {
    const dir = join(OUT, lang);
    clips[lang] = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.mp3') && statSync(join(dir, f)).size > 1000).map((f) => f.slice(0, -4)).sort() : [];
  }
  const voices = { ...VOICES, ...(TANGLISH_FROM_TA ? { tanglish: VOICES.ta } : {}) };
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ version: 1, voices, clips }, null, 1) + '\n');
  return clips;
}

async function main() {
  const jobs = plan();
  const chars = jobs.reduce((n, j) => n + [...j.say].length, 0);
  console.log(`${jobs.length} lines, ${chars} characters, voices: ${JSON.stringify(VOICES)}, rate ${RATE}`);
  if (args.dry) return;

  const have = listVoices();
  const missing = [...new Set(jobs.map((j) => j.voice))].filter((v) => !have.has(v));
  if (missing.length) {
    console.error(`These voices are not available: ${missing.join(', ')}`);
    console.error('Tamil voices this tool offers: ' + ([...have].filter((v) => v.startsWith('ta-')).join(', ') || '(none found)'));
    console.error('Pick one and run again, e.g.  VOICE_TA=ta-IN-ValluvarNeural node scripts/make-voice.mjs');
    process.exit(1);
  }

  for (const lang of onlyLangs) mkdirSync(join(OUT, lang), { recursive: true });
  const todo = jobs.filter((j) => !(existsSync(j.file) && statSync(j.file).size > 1000));
  console.log(`${jobs.length - todo.length} already done, ${todo.length} to make`);

  let done = 0;
  const failed = [];
  const queue = [...todo];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      if (await withRetry(job)) done++;
      else failed.push(job);
      process.stdout.write(`\r${done + failed.length}/${todo.length}`);
      await sleep(PACE_MS);
    }
  };
  await Promise.all([worker(), worker()]);
  if (todo.length) process.stdout.write('\n');

  const clips = writeManifest();
  const total = Object.values(clips).reduce((n, l) => n + l.length, 0);
  const bytes = Object.entries(clips).reduce((n, [lang, l]) => n + l.reduce((m, k) => m + statSync(join(OUT, lang, `${k}.mp3`)).size, 0), 0);
  console.log(`Made ${done}, failed ${failed.length}. ${total} clips in the manifest (${(bytes / 1048576).toFixed(1)} MB).`);
  if (failed.length) {
    console.error('Failed lines (run again to retry only these):');
    for (const j of failed.slice(0, 5)) console.error(` - [${j.lang}] ${j.say.slice(0, 40)}...  (${j.lastError})`);
    process.exit(2);
  }
  console.log('Next: git add public/voice && git commit -m "Amma voice clips" && git push');
}

main();
