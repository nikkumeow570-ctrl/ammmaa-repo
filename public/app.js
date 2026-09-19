import { LANGS, TONES, DEFAULTS, normalizeSettings, buildSlots, pickLine } from './shared.js';

const KEY = 'ammmaa.v1';
const app = document.getElementById('app');

const IS_IOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const deviceTz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
const langAttr = (l) => (l === 'ta' ? 'ta' : l === 'tanglish' ? 'ta-Latn' : 'en');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---------- Persistent state (this device only) ----------
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s === 'object') {
      return { id: s.id || null, token: s.token || null, endpoint: s.endpoint || null, tz: s.tz || null, settings: normalizeSettings(s.settings) };
    }
  } catch {
    /* first run */
  }
  return { id: null, token: null, endpoint: null, tz: null, settings: normalizeSettings(DEFAULTS) };
}
let state = load();
const save = () => localStorage.setItem(KEY, JSON.stringify(state));

// ---------- Screen state (not persisted) ----------
const ui = {
  view: state.id ? 'home' : 'welcome',
  step: 0,
  kind: 'meal',
  line: '',
  busy: false,
  error: '',
  errorMsg: '',
  toast: '',
  perm: 'Notification' in window ? Notification.permission : 'unsupported',
  needsResub: false,
  installEvent: null,
  focusSel: '',
};

const PREVIEW_KINDS = ['meal', 'water', 'break', 'morning'];
function newLine(vary) {
  const s = state.settings;
  if (vary) ui.kind = PREVIEW_KINDS[Math.floor(Math.random() * PREVIEW_KINDS.length)];
  let line = '';
  for (let i = 0; i < 8; i++) {
    line = pickLine(s.lang, s.tone, ui.kind);
    if (line !== ui.line) break;
  }
  ui.line = line;
}

// ---------- Small helpers ----------
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

function urlB64ToBytes(s) {
  const b64 = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

async function api(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Try again.'), { status: res.status });
  return data;
}

let toastTimer;
function toast(msg) {
  ui.toast = msg;
  render();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast = '';
    render();
  }, 4500);
}

const inQuiet = (min, start, end) => {
  const m = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const a = m(start), b = m(end);
  if (a === b) return false;
  return a < b ? min >= a && min < b : min >= a || min < b;
};

// The next reminder that will really fire (mirrors the server: quiet hours skip everything but bedtime and morning).
function nextUp() {
  const now = new Date();
  const q = state.settings.quiet;
  let best = null;
  for (const s of buildSlots(state.settings)) {
    const hh = Number(s.time.slice(0, 2)), mm = Number(s.time.slice(3));
    const bookend = s.kind === 'bedtime' || s.kind === 'morning';
    if (!bookend && inQuiet(hh * 60 + mm, q.start, q.end)) continue;
    for (let d = 0; d < 8; d++) {
      const at = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d, hh, mm);
      if (at <= now || (s.dow !== null && at.getDay() !== s.dow)) continue;
      if (!best || at < best.at) best = { at, label: s.label };
      break;
    }
  }
  if (!best) return null;
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((startOf(best.at) - startOf(now)) / 864e5);
  const time = best.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const when = diff === 0 ? `at ${time}` : diff === 1 ? `tomorrow at ${time}` : `${best.at.toLocaleDateString([], { weekday: 'long' })} at ${time}`;
  return { label: best.label, when };
}

// ---------- Form pieces ----------
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => [i, d]);
const WATER = [[60, 'Every hour'], [90, 'Every 1½ hours'], [120, 'Every 2 hours'], [180, 'Every 3 hours']];
const BREAKS = [[45, 'Every 45 min'], [60, 'Every hour'], [90, 'Every 1½ hours'], [120, 'Every 2 hours']];
const CAPS = [3, 5, 8, 12, 20].map((n) => [n, `${n} a day`]);

const tf = (label, path, value) =>
  `<label class="tfield"><span>${label}</span><input class="time" type="time" value="${esc(value)}" data-path="${path}" required></label>`;

function sel(label, path, options, current) {
  const list = options.some(([v]) => v === current) ? options : [[current, String(current)], ...options];
  return `<label class="tfield"><span>${label}</span><select class="pick" data-path="${path}" data-num>${list
    .map(([v, t]) => `<option value="${v}"${v === current ? ' selected' : ''}>${t}</option>`)
    .join('')}</select></label>`;
}

function seg(label, id, path, items, current) {
  return `<div class="field"><div class="label" id="${id}">${label}</div><div class="seg" role="group" aria-labelledby="${id}">${items
    .map(
      (it) =>
        `<button type="button" data-act="set" data-path="${path}" data-val="${it.id}" aria-pressed="${current === it.id}"${it.id === 'ta' ? ' lang="ta"' : ''}>${it.label}</button>`,
    )
    .join('')}</div></div>`;
}

function talkForm(withPreview) {
  const s = state.settings;
  return (
    seg('Language', 'l-lang', 'lang', LANGS, s.lang) +
    seg('Mood', 'l-tone', 'tone', TONES, s.tone) +
    (withPreview
      ? `<div class="preview"><p class="bubble own" lang="${langAttr(s.lang)}">${esc(ui.line)}</p><button type="button" class="link" data-act="another">Hear another</button></div>`
      : '')
  );
}

function remindersForm() {
  const r = state.settings.reminders;
  const rows = [
    ['meals', 'Meals', 'Breakfast, lunch and dinner', tf('Breakfast', 'reminders.meals.breakfast', r.meals.breakfast) + tf('Lunch', 'reminders.meals.lunch', r.meals.lunch) + tf('Dinner', 'reminders.meals.dinner', r.meals.dinner)],
    ['water', 'Water', 'A sip through the day', sel('How often', 'reminders.water.everyMin', WATER, r.water.everyMin) + tf('From', 'reminders.water.from', r.water.from) + tf('Until', 'reminders.water.to', r.water.to)],
    ['breaks', 'Breaks', 'Stand up, rest your eyes', sel('How often', 'reminders.breaks.everyMin', BREAKS, r.breaks.everyMin) + tf('From', 'reminders.breaks.from', r.breaks.from) + tf('Until', 'reminders.breaks.to', r.breaks.to)],
    ['call', 'Call home', 'Once a week', sel('Day', 'reminders.call.day', DAYS, r.call.day) + tf('Time', 'reminders.call.time', r.call.time)],
    ['bedtime', 'Bedtime', 'Time to put the phone down', tf('Time', 'reminders.bedtime.time', r.bedtime.time)],
    ['morning', 'Good morning', 'A hello to start the day', tf('Time', 'reminders.morning.time', r.morning.time)],
  ];
  return `<div class="rows">${rows
    .map(
      ([k, title, hint, sub]) =>
        `<div class="row"><label class="row-main" for="sw-${k}"><span class="row-title">${title}</span><span class="row-hint">${hint}</span></label><input id="sw-${k}" class="switch" type="checkbox" role="switch" data-path="reminders.${k}.on" data-rerender${r[k].on ? ' checked' : ''}></div>${
          r[k].on ? `<div class="sub">${sub}</div>` : ''
        }`,
    )
    .join('')}</div>`;
}

function quietForm() {
  const s = state.settings;
  return `<div class="rows"><div class="sub">${tf('Quiet from', 'quiet.start', s.quiet.start)}${tf('Until', 'quiet.end', s.quiet.end)}${sel('At most', 'cap', CAPS, s.cap)}</div></div>`;
}

function iosNote() {
  return IS_IOS && !isStandalone()
    ? `<div class="note"><strong>One step on iPhone.</strong> Tap the Share button, choose Add to Home Screen, then open Ammmaa from your Home Screen. Notifications only work from there.</div>`
    : '';
}

function errorNote() {
  const msg = {
    denied: "Notifications are blocked for this site. Turn them on in your browser's site settings, then try again.",
    unsupported: "This browser can't receive notifications. Try Chrome on Android, or add Ammmaa to your Home Screen on iPhone.",
    fail: ui.errorMsg || 'Something went wrong. Try again.',
  }[ui.error];
  return msg ? `<div class="note" role="alert">${esc(msg)}</div>` : '';
}

const installButton = () =>
  ui.installEvent ? `<button type="button" class="btn btn-ghost btn-block" data-act="install">Install Ammmaa</button>` : '';

// ---------- Screens ----------
function welcome() {
  return `<main class="screen welcome dark">
    <div class="zari" aria-hidden="true"></div>
    <div class="welcome-body">
      <span class="wordmark">Ammmaa</span>
      <h1 class="amma" lang="ta">அம்மா</h1>
      <div class="thread" role="img" aria-label="Amma asks: Have you eaten?">
        <div class="typing" aria-hidden="true"><i></i><i></i><i></i></div>
        <p class="bubble in" lang="ta">சாப்பிட்டியா?</p>
      </div>
      <p class="gloss">Have you eaten?</p>
    </div>
    <div class="welcome-foot">
      <button type="button" class="btn btn-primary btn-block" data-act="start">Set up Amma</button>
      <p class="fine">No sign-up. We keep only your reminder times and a push address.</p>
    </div>
  </main>`;
}

function setup() {
  const step = ui.step;
  const bodies = [
    `<h2 class="title">How should Amma talk to you?</h2><p class="lede">Pick a language and a mood. You can change both later.</p>${talkForm(true)}`,
    `<h2 class="title">What should she remind you about?</h2><p class="lede">Turn on what you need and set the times.</p>${remindersForm()}
     <section class="section"><h3>Quiet hours</h3><p>Amma stays quiet in this window, except for bedtime and good morning.</p>${quietForm()}</section>`,
    `<h2 class="title">Let Amma message you</h2><p class="lede">Reminders arrive as notifications, even when the app is closed. Your reminder times and a push address are stored so she knows when to write. No account needed.</p>
     ${iosNote()}${errorNote()}<div class="stack">${installButton()}</div>`,
  ];
  const back = `<button type="button" class="btn btn-ghost" data-act="back" ${step === 0 ? 'hidden' : ''}>Back</button>`;
  const next =
    step < 2
      ? `<button type="button" class="btn btn-primary" data-act="next">Next</button>`
      : `<button type="button" class="btn btn-primary" data-act="enable" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Setting up…' : 'Turn on notifications'}</button>`;
  return `<main class="screen light">
    <div class="zari" aria-hidden="true"></div>
    <div class="setup-main">
      <div class="progress" role="img" aria-label="Step ${step + 1} of 3">${[0, 1, 2].map((i) => `<span class="${i <= step ? 'on' : ''}"></span>`).join('')}</div>
      ${bodies[step]}
    </div>
    <div class="bar">${back}${next}</div>
  </main>`;
}

function home() {
  const s = state.settings;
  const n = nextUp();
  const blocked =
    ui.perm === 'denied'
      ? `<div class="note" role="alert">Notifications are blocked for this site, so Amma can't reach you. Turn them on in your browser's site settings.</div>`
      : ui.needsResub
        ? `<div class="note" role="alert">Amma lost her way to this phone. <button type="button" class="link" data-act="enable">Turn notifications back on</button></div>`
        : '';
  return `<div class="screen">
    <header class="hero dark">
      <div class="zari" aria-hidden="true"></div>
      <div class="hero-in">
        <span class="wordmark">Ammmaa</span>
        <button type="button" class="bubble in" data-act="another" lang="${langAttr(s.lang)}" aria-label="Amma says: ${esc(ui.line)}. Tap for another.">${esc(ui.line)}</button>
        <p class="next">${n ? `Next: <b>${esc(n.label)}</b> ${esc(n.when)}` : 'No reminders are on. Turn one on below.'}</p>
      </div>
    </header>
    <main class="sheet light"><div class="sheet-in">
      ${blocked}
      <section class="section"><h3>How Amma talks</h3>${talkForm(false)}</section>
      <section class="section"><h3>Reminders</h3>${remindersForm()}</section>
      <section class="section"><h3>Quiet hours</h3><p>Amma stays quiet in this window, except for bedtime and good morning.</p>${quietForm()}</section>
      <section class="section"><h3>This phone</h3>
        <div class="stack">
          <button type="button" class="btn btn-primary btn-block" data-act="test" ${ui.busy ? 'disabled' : ''}>Send a test message</button>
          ${installButton()}
          <button type="button" class="btn btn-danger btn-block" data-act="off">Turn off Amma on this phone</button>
        </div>
      </section>
    </div></main>
  </div>`;
}

function render() {
  const y = window.scrollY;
  if (!ui.line) newLine(false);
  app.innerHTML = (ui.view === 'welcome' ? welcome() : ui.view === 'setup' ? setup() : home()) + (ui.toast ? `<div class="toast" role="status">${esc(ui.toast)}</div>` : '');
  if (ui.focusSel) {
    const el = app.querySelector(ui.focusSel);
    if (el) el.focus({ preventScroll: true });
    ui.focusSel = '';
  }
  window.scrollTo(0, y);
}

function go(view, step = 0) {
  ui.view = view;
  ui.step = step;
  ui.error = '';
  render();
  window.scrollTo(0, 0);
}

// ---------- Server sync ----------
let syncTimer;
function scheduleSync() {
  if (!state.id) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      await api('/api/update', { id: state.id, token: state.token, settings: state.settings, tz: deviceTz() });
      state.tz = deviceTz();
      save();
    } catch (e) {
      if (e.status === 401) return lostServerRecord();
      toast("Couldn't save your changes. Check your connection.");
    }
  }, 700);
}

function lostServerRecord() {
  state.id = null;
  state.token = null;
  state.endpoint = null;
  save();
  go('setup', 2);
}

async function syncOnOpen() {
  if (!state.id || !('serviceWorker' in navigator)) return;
  ui.perm = 'Notification' in window ? Notification.permission : 'unsupported';
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    ui.needsResub = ui.perm === 'granted' && !sub;
    const changedEndpoint = sub && sub.endpoint !== state.endpoint;
    if (ui.perm === 'granted' && sub && (changedEndpoint || state.tz !== deviceTz())) {
      await api('/api/update', { id: state.id, token: state.token, subscription: sub.toJSON(), settings: state.settings, tz: deviceTz() });
      state.endpoint = sub.endpoint;
      state.tz = deviceTz();
      save();
    }
  } catch (e) {
    if (e.status === 401) return lostServerRecord();
  }
  if (ui.view === 'home') render();
}

// ---------- Actions ----------
async function enable() {
  if (ui.busy) return;
  ui.error = '';
  const needsHomeScreen = IS_IOS && !isStandalone();
  if (needsHomeScreen) return toast('Add Ammmaa to your Home Screen first, then open it from there.');
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    ui.error = 'unsupported';
    return render();
  }
  ui.busy = true;
  render();
  try {
    const perm = await Notification.requestPermission();
    ui.perm = perm;
    if (perm !== 'granted') {
      ui.error = 'denied';
      return;
    }
    const cfg = await (await fetch('/api/config')).json();
    if (!cfg.publicKey) throw new Error(cfg.error || 'Server is not configured yet.');
    const key = urlB64ToBytes(cfg.publicKey);
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (sub && sub.options && sub.options.applicationServerKey && !sameBytes(new Uint8Array(sub.options.applicationServerKey), key)) {
      await sub.unsubscribe();
      sub = null;
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    const res = await api('/api/subscribe', { subscription: sub.toJSON(), settings: state.settings, tz: deviceTz() });
    state.id = res.id;
    state.token = res.token;
    state.endpoint = sub.endpoint;
    state.tz = deviceTz();
    save();
    ui.needsResub = false;
    ui.view = 'home';
    window.scrollTo(0, 0);
    api('/api/test', { id: state.id, token: state.token })
      .then(() => toast('Amma sent you a hello. Check your notifications.'))
      .catch(() => {});
  } catch (e) {
    ui.error = 'fail';
    ui.errorMsg = e.message || '';
  } finally {
    ui.busy = false;
    render();
  }
}

async function sendTest() {
  if (ui.busy) return;
  ui.busy = true;
  render();
  try {
    await api('/api/test', { id: state.id, token: state.token });
    toast('Sent. It should arrive in a few seconds.');
  } catch (e) {
    if (e.status === 401) return lostServerRecord();
    toast(e.message);
  } finally {
    ui.busy = false;
    render();
  }
}

async function turnOff() {
  if (!confirm('Turn off Amma on this phone? You can set her up again any time.')) return;
  try {
    await api('/api/unsubscribe', { id: state.id, token: state.token });
  } catch {
    /* server already forgot us */
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch {
    /* nothing to remove */
  }
  state.id = null;
  state.token = null;
  state.endpoint = null;
  save();
  go('welcome');
}

const setAndSync = (path, value) => {
  setPath(state.settings, path, value);
  state.settings = normalizeSettings(state.settings);
  save();
  scheduleSync();
};

app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  switch (el.dataset.act) {
    case 'start': return go('setup', 0);
    case 'next': return go('setup', Math.min(2, ui.step + 1));
    case 'back': return go('setup', Math.max(0, ui.step - 1));
    case 'set':
      setAndSync(el.dataset.path, el.dataset.val);
      newLine(false);
      ui.focusSel = `[data-act="set"][data-path="${el.dataset.path}"][data-val="${el.dataset.val}"]`;
      return render();
    case 'another':
      newLine(true);
      ui.focusSel = '[data-act="another"]';
      return render();
    case 'enable': return enable();
    case 'test': return sendTest();
    case 'off': return turnOff();
    case 'install':
      if (ui.installEvent) {
        ui.installEvent.prompt();
        ui.installEvent.userChoice.finally(() => {
          ui.installEvent = null;
          render();
        });
      }
  }
});

app.addEventListener('change', (e) => {
  const t = e.target;
  const path = t.dataset && t.dataset.path;
  if (!path) return;
  const value = t.type === 'checkbox' ? t.checked : 'num' in t.dataset ? Number(t.value) : t.value;
  setAndSync(path, value);
  if ('rerender' in t.dataset) {
    ui.focusSel = `[data-path="${path}"]`;
    render();
  }
});

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  ui.installEvent = e;
  render();
});
window.addEventListener('appinstalled', () => {
  ui.installEvent = null;
  render();
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') syncOnOpen();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
render();
syncOnOpen();
