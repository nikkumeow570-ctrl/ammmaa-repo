// Everything about sound and the person's own Amma, all on this device:
//  - pre-made clips (public/voice/, made by scripts/make-voice.mjs)
//  - the phone's built-in speech (Web Speech API), used when there is no clip
//  - the person's own recordings and photo (IndexedDB; nothing is uploaded)
import { voiceKey } from './shared.js';

// ---------- Pre-made clips ----------
let clips = { ta: new Set(), tanglish: new Set(), en: new Set() };

export async function loadManifest() {
  try {
    const res = await fetch('/voice/manifest.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const m = await res.json();
    for (const lang of Object.keys(clips)) clips[lang] = new Set((m.clips && m.clips[lang]) || []);
  } catch {
    /* no clips yet: buttons simply fall back to the phone's own voice */
  }
}

const hasClip = (lang, text) => !!clips[lang] && clips[lang].has(voiceKey(lang, text));
const clipUrl = (lang, text) => `/voice/${lang}/${voiceKey(lang, text)}.mp3`;
export const clipCount = () => Object.values(clips).reduce((n, s) => n + s.size, 0);

// ---------- Phone's built-in speech ----------
const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

function voices() {
  return synth ? synth.getVoices() : [];
}

export function pickVoice(lang) {
  const all = voices();
  const starts = (v, p) => (v.lang || '').toLowerCase().replace('_', '-').startsWith(p);
  if (lang === 'ta') return all.find((v) => starts(v, 'ta')) || null;
  return all.find((v) => starts(v, 'en-in')) || all.find((v) => starts(v, 'en')) || null;
}

const canBrowserSpeak = (lang) => !!pickVoice(lang);

export function speakBrowser(text, lang) {
  const voice = pickVoice(lang);
  if (!synth || !voice) return false;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text.replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, ''));
  u.voice = voice;
  u.lang = voice.lang;
  u.rate = 0.95;
  synth.speak(u);
  return true;
}

// ---------- The person's own Amma (photo + recordings) ----------
export const own = { photoUrl: '', clips: new Set() };

const DB = 'ammmaa-own';
let dbPromise;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('clips');
        req.result.createObjectStore('photo');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const r = fn(t.objectStore(store));
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function loadOwn() {
  try {
    const keys = await tx('clips', 'readonly', (s) => s.getAllKeys());
    own.clips = new Set(keys);
    const photo = await tx('photo', 'readonly', (s) => s.get('photo'));
    if (photo) own.photoUrl = URL.createObjectURL(photo);
  } catch {
    /* private mode or storage blocked: the feature just stays empty */
  }
}

export const getClip = (kind) => tx('clips', 'readonly', (s) => s.get(kind));

export async function saveClip(kind, blob, ms) {
  await tx('clips', 'readwrite', (s) => s.put({ blob, type: blob.type, ms }, kind));
  own.clips.add(kind);
}

export async function removeClip(kind) {
  await tx('clips', 'readwrite', (s) => s.delete(kind));
  own.clips.delete(kind);
}

// The photo is also copied into Cache Storage so the service worker can use it as the notification icon.
export async function savePhoto(blob) {
  await tx('photo', 'readwrite', (s) => s.put(blob, 'photo'));
  if (own.photoUrl) URL.revokeObjectURL(own.photoUrl);
  own.photoUrl = URL.createObjectURL(blob);
  try {
    const cache = await caches.open('ammmaa-local');
    await cache.put('/local/amma.jpg', new Response(blob, { headers: { 'content-type': 'image/jpeg' } }));
  } catch {
    /* notifications keep the default icon */
  }
}

export async function removePhoto() {
  await tx('photo', 'readwrite', (s) => s.delete('photo'));
  if (own.photoUrl) URL.revokeObjectURL(own.photoUrl);
  own.photoUrl = '';
  try {
    await (await caches.open('ammmaa-local')).delete('/local/amma.jpg');
  } catch {
    /* nothing to remove */
  }
}

// ---------- Recording ----------
export const canRecord = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);

const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];

/** Starts recording. Resolves with a controller { stop(): Promise<{blob, ms}>, cancel() }. Auto-stops at maxMs. */
export async function startRecording(maxMs, onTick) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  const type = TYPES.find((t) => window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  const started = Date.now();
  let timer;
  let finish;
  const done = new Promise((r) => (finish = r));
  rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    finish({ blob: new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' }), ms: Date.now() - started });
  };
  rec.start();
  timer = setInterval(() => {
    const ms = Date.now() - started;
    if (onTick) onTick(ms);
    if (ms >= maxMs && rec.state === 'recording') rec.stop();
  }, 200);
  return {
    stop: () => {
      if (rec.state === 'recording') rec.stop();
      return done;
    },
    cancel: () => {
      chunks.length = 0;
      if (rec.state === 'recording') rec.stop();
    },
    finished: done,
  };
}

// ---------- Playing ----------
let current = null;

export function stopAudio() {
  if (current) {
    current.pause();
    if (current._url) URL.revokeObjectURL(current._url);
    current = null;
  }
  if (synth) synth.cancel();
}

/** Plays a URL or Blob. Resolves when it ends; rejects if the browser cannot play it. */
export function play(source) {
  stopAudio();
  return new Promise((resolve, reject) => {
    const a = new Audio();
    if (source instanceof Blob) {
      a._url = URL.createObjectURL(source);
      a.src = a._url;
    } else {
      a.src = source;
    }
    current = a;
    a.onended = () => {
      if (current === a) stopAudio();
      resolve();
    };
    a.onerror = () => {
      if (current === a) stopAudio();
      reject(new Error('audio failed'));
    };
    a.play().catch(reject);
  });
}

/** Can we say something for this line? (own recording for the kind, a pre-made clip, or the phone's voice) */
export const canHear = ({ kind, text, lang }) => (!!kind && own.clips.has(kind)) || (!!text && hasClip(lang, text)) || canBrowserSpeak(lang);

/**
 * Says a line. Order: the person's own recording for this kind, then the pre-made clip, then the phone's voice.
 * Returns which one was used: 'own' | 'clip' | 'browser' | 'none'.
 */
export async function hear({ kind, text, lang }) {
  if (kind && own.clips.has(kind)) {
    try {
      const c = await getClip(kind);
      if (c && c.blob) {
        await play(c.blob);
        return 'own';
      }
    } catch {
      /* fall through to the next option */
    }
  }
  if (text && hasClip(lang, text)) {
    try {
      await play(clipUrl(lang, text));
      return 'clip';
    } catch {
      /* fall through */
    }
  }
  return text && speakBrowser(text, lang) ? 'browser' : 'none';
}

// ---------- Speech to text (the microphone button in chat) ----------
const Recognition = typeof window !== 'undefined' ? window.SpeechRecognition || window.webkitSpeechRecognition : null;
export const canListen = () => !!Recognition;

/** Listens once. Tamil and Tanglish speakers are recognised as Tamil, English speakers as Indian English. */
export function listen(lang, { onText, onEnd, onError }) {
  const rec = new Recognition();
  rec.lang = lang === 'en' ? 'en-IN' : 'ta-IN';
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  rec.continuous = false;
  rec.onresult = (e) => onText(Array.from(e.results).map((r) => r[0].transcript).join(' ').trim(), e.results[e.results.length - 1].isFinal);
  rec.onerror = (e) => onError && onError(e.error || 'error');
  rec.onend = () => onEnd && onEnd();
  rec.start();
  return { stop: () => rec.stop() };
}

// ---------- "Voice check" for the home screen ----------
export async function voiceCheck() {
  if (synth && !voices().length) {
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 1200);
      synth.addEventListener('voiceschanged', () => (clearTimeout(t), resolve()), { once: true });
    });
  }
  let mic = 'unknown';
  try {
    mic = (await navigator.permissions.query({ name: 'microphone' })).state;
  } catch {
    /* not supported everywhere */
  }
  const ta = pickVoice('ta');
  const en = pickVoice('en');
  return {
    tamilVoice: ta ? ta.name : null,
    englishVoice: en ? en.name : null,
    canListen: canListen(),
    canRecord: canRecord(),
    mic,
    clips: clipCount(),
    ownClips: own.clips.size,
    ownKinds: [...own.clips],
  };
}
