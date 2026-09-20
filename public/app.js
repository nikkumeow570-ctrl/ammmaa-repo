import { LANGS, TONES, DEFAULTS, normalizeSettings, buildSlots, pickLine } from './shared.js';
import { ammaSvg } from './amma.js';
import * as V from './voice.js';
import { createChat } from './chat.js';
import { openRecorder, pickPhoto } from './own.js';

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

// ---------- Tabs (Home, Chat, Reminders, More) ----------
const TABS = ['home', 'chat', 'reminders', 'more'];
const tabFromHash = () => (TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home');
let chatPanel = null; // one persistent chat panel, re-attached to the Chat tab after every render

// ---------- Screen state (not persisted) ----------
const ui = {
  view: state.id ? 'home' : 'welcome',
  tab: tabFromHash(),
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
  status: null,
  voice: null,
  hear: null,
};

const PREVIEW_KINDS = ['meal', 'water', 'break', 'morning', 'bedtime'];
// Amma's face follows the mood the person picked; bedtime lines make her sleepy.
const mood = () => (ui.kind === 'bedtime' ? 'sleepy' : state.settings.tone);
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
  return `<label class="tfield wide"><span>${label}</span><select class="pick" data-path="${path}" data-num>${list
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
    `<div class="card">${seg('Language', 'l-lang', 'lang', LANGS, s.lang)}${seg('Mood', 'l-tone', 'tone', TONES, s.tone)}</div>` +
    (withPreview
      ? `<div class="preview"><p class="bubble own" lang="${langAttr(s.lang)}">${esc(ui.line)}</p><button type="button" class="link" data-act="another">Hear another</button></div>`
      : '')
  );
}

const KIND_EMOJI = { meals: '🍛', water: '💧', breaks: '🧘', call: '📞', bedtime: '🌙', morning: '☀️' };

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
        `<div class="rcard${r[k].on ? ' on' : ''}"><div class="row"><span class="badge" aria-hidden="true">${KIND_EMOJI[k]}</span><label class="row-main" for="sw-${k}"><span class="row-title">${title}</span><span class="row-hint">${hint}</span></label><input id="sw-${k}" class="switch" type="checkbox" role="switch" data-path="reminders.${k}.on" data-rerender${r[k].on ? ' checked' : ''}></div>${
          r[k].on ? `<div class="sub">${sub}</div>` : ''
        }</div>`,
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
  return `<main class="welcome">
    <div class="brand">Ammmaa<small lang="ta">அம்மா</small></div>
    <div class="stage">
      <div class="bubble pop" role="img" aria-label="Amma asks: Have you eaten?">
        <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="say" lang="ta">சாப்பிட்டியா?</span>
      </div>
      <div class="arch">${ammaSvg('loving', { label: 'Amma, smiling warmly' })}</div>
    </div>
    <div class="welcome-copy">
      <h1>Someone at home is thinking of you.</h1>
      <p>Gentle reminders in Tamil, Tanglish or English.</p>
    </div>
    <div class="welcome-foot">
      <button type="button" class="btn btn-gold btn-block" data-act="start">Set up Amma</button>
      <p class="fine">No sign-up. We keep only your reminder times and a push address. <a class="fine-link" href="/privacy.html">Privacy</a></p>
    </div>
  </main>`;
}

const ASKS = ['How should I talk to you, kanna?', 'What shall I remind you about?', 'Let me message you.'];

function setup() {
  const step = ui.step;
  const bodies = [
    `<p class="lede">Pick a language and a mood. You can change both later.</p>${talkForm(true)}`,
    `<p class="lede">Turn on what you need and set the times.</p>${remindersForm()}
     <section class="section"><h3>Quiet hours</h3><p>I stay quiet in this window, except for bedtime and good morning.</p>${quietForm()}</section>`,
    `<p class="lede">Reminders arrive as notifications, even when the app is closed. Your reminder times and a push address are stored so I know when to write. No account needed.</p>
     ${iosNote()}${errorNote()}<div class="stack">${installButton()}</div>`,
  ];
  const back = `<button type="button" class="btn btn-ghost" data-act="back" ${step === 0 ? 'hidden' : ''}>Back</button>`;
  const next =
    step < 2
      ? `<button type="button" class="btn btn-primary" data-act="next">Next</button>`
      : `<button type="button" class="btn btn-primary" data-act="enable" ${ui.busy ? 'disabled' : ''}>${ui.busy ? 'Setting up...' : 'Turn on notifications'}</button>`;
  return `<main class="setup">
    <div class="setup-main">
      <div class="progress" role="img" aria-label="Step ${step + 1} of 3">${[0, 1, 2].map((i) => `<span class="${i <= step ? 'on' : ''}"></span>`).join('')}</div>
      <div class="ask"><div class="avatar">${ammaSvg(mood(), { decorative: true })}</div><h2 class="bubble">${ASKS[step]}</h2></div>
      ${bodies[step]}
    </div>
    <div class="bar">${back}${next}</div>
  </main>`;
}

const TAB_META = [
  ['home', 'Home', '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M10 20v-5h4v5"/>'],
  ['chat', 'Chat', '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4v-4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z"/>'],
  ['reminders', 'Reminders', '<path d="M6 16v-5a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>'],
  ['more', 'More', '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'],
];

function tabbar() {
  return `<nav class="tabbar" aria-label="Main">${TAB_META.map(
    ([id, label, icon]) =>
      `<button type="button" class="tab" data-act="tab" data-tab="${id}"${ui.tab === id ? ' aria-current="page"' : ''}><span class="tab-ico"><svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg></span><span>${label}</span></button>`,
  ).join('')}</nav>`;
}

function blockedNote() {
  return ui.perm === 'denied'
    ? `<div class="note" role="alert">Notifications are blocked for this site, so Amma can't reach you. Turn them on in your browser's site settings.</div>`
    : ui.needsResub
      ? `<div class="note" role="alert">Amma lost her way to this phone. <button type="button" class="link" data-act="enable">Turn notifications back on</button></div>`
      : '';
}

function homeTab() {
  const s = state.settings;
  const n = nextUp();
  const banner = ui.hear && V.canHear({ kind: ui.hear.kind, text: ui.hear.text, lang: s.lang }) ? '<button type="button" class="hear-banner" data-act="hear-banner">🔊 Amma sent you a message. Tap to hear her</button>' : '';
  return `<header class="hero">
      <div class="brand">Ammmaa<small lang="ta">அம்மா</small></div>
      ${banner}
      <button type="button" class="say-big" data-act="another" lang="${langAttr(s.lang)}" aria-label="Amma says: ${esc(ui.line)}. Tap for another.">${esc(ui.line)}</button>
      <div class="hero-actions">${V.canHear({ kind: ui.kind, text: ui.line, lang: s.lang }) ? '<button type="button" class="chip" data-act="hear">🔊 Hear Amma</button>' : ''}<button type="button" class="chip chip-gold" data-act="chat">💬 Talk to Amma</button></div>
      <div class="hero-art">${V.own.photoUrl ? `<img class="own-photo" src="${V.own.photoUrl}" alt="Your Amma">` : ammaSvg(mood(), { label: 'Amma' })}</div>
    </header>
    <div class="next-card"><span class="ico" aria-hidden="true">⏰</span><div>${n ? `<small>Next reminder</small><b>${esc(n.label)}</b> ${esc(n.when)}` : 'No reminders are on. Turn one on in Reminders.'}</div></div>
    <div class="home-body">${blockedNote()}</div>`;
}

function remindersTab() {
  return `<main class="panel">
    <h1 class="page-title">Reminders</h1>
    <p class="page-sub">Turn on what you need and set the times.</p>
    ${blockedNote()}
    ${remindersForm()}
    <section class="section"><h3>Quiet hours</h3><p>Amma stays quiet in this window, except for bedtime and good morning.</p>${quietForm()}</section>
  </main>`;
}

function moreTab() {
  return `<main class="panel">
    <h1 class="page-title">More</h1>
    <section class="section"><h3>How Amma talks</h3>${talkForm(false)}</section>
    ${ownSection()}
    <section class="section"><h3>This phone</h3>
      <div class="stack">
        <button type="button" class="btn btn-primary btn-block" data-act="test" ${ui.busy ? 'disabled' : ''}>Send a test message</button>
        <button type="button" class="btn btn-ghost btn-block" data-act="status" ${ui.busy ? 'disabled' : ''}>Check my reminders</button>
        ${statusPanel()}
        <button type="button" class="btn btn-ghost btn-block" data-act="voice-check">Voice check</button>
        ${voicePanel()}
        ${installButton()}
        <button type="button" class="btn btn-danger btn-block" data-act="off">Turn off Amma on this phone</button>
      </div>
    </section>
    <p class="privacy-link"><a href="/privacy.html">Privacy: what Amma keeps and where it goes</a></p>
  </main>`;
}

function home() {
  const body = ui.tab === 'chat' ? '<div id="chat-slot"></div>' : ui.tab === 'reminders' ? remindersTab() : ui.tab === 'more' ? moreTab() : homeTab();
  return `<div class="home tab-${ui.tab}">${body}</div>${tabbar()}`;
}

function attachChat(refocus) {
  const slot = app.querySelector('#chat-slot');
  if (!slot) return;
  if (!chatPanel) {
    chatPanel = createChat({ lang: () => state.settings.lang, tone: () => state.settings.tone, id: () => state.id, token: () => state.token, api, onLost: lostServerRecord });
  }
  slot.replaceWith(chatPanel.el);
  chatPanel.attached();
  if (refocus) chatPanel.focus();
}

function render() {
  const y = window.scrollY;
  if (!ui.line) newLine(false);
  const chatHadFocus = !!(chatPanel && chatPanel.hasFocus());
  app.innerHTML = (ui.view === 'welcome' ? welcome() : ui.view === 'setup' ? setup() : home()) + (ui.toast ? `<div class="toast" role="status">${esc(ui.toast)}</div>` : '');
  app.classList.toggle('with-tabs', ui.view === 'home');
  if (ui.view === 'home' && ui.tab === 'chat') attachChat(chatHadFocus);
  if (ui.focusSel) {
    const el = app.querySelector(ui.focusSel);
    if (el) el.focus({ preventScroll: true });
    ui.focusSel = '';
  }
  window.scrollTo(0, y);
}

function setTab(tab) {
  if (!TABS.includes(tab) || ui.view !== 'home') return;
  if (tab === ui.tab) return window.scrollTo({ top: 0, behavior: 'smooth' });
  if (ui.tab === 'chat' && chatPanel) chatPanel.pause();
  ui.tab = tab;
  history.pushState(null, '', tab === 'home' ? location.pathname + location.search : `#${tab}`);
  render();
  window.scrollTo(0, 0);
}

// The phone's back button walks back through the tabs instead of closing the app.
window.addEventListener('popstate', () => {
  if (ui.view !== 'home') return;
  const t = tabFromHash();
  if (t === ui.tab) return;
  if (ui.tab === 'chat' && chatPanel) chatPanel.pause();
  ui.tab = t;
  render();
  window.scrollTo(0, 0);
});

function go(view, step = 0) {
  if (view === 'home' && ui.view !== 'home') {
    ui.tab = 'home';
    history.replaceState(null, '', location.pathname + location.search);
  }
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

// ---------- "Check my reminders": what the server actually has for this phone ----------
const KIND_NAME = { meal: 'Meal', water: 'Water', break: 'Break', call: 'Call home', bedtime: 'Bedtime', morning: 'Good morning' };

function statusPanel() {
  const st = ui.status;
  if (!st) return '';
  const missing = buildSlots(state.settings).filter((w) => !st.slots.some((s) => s.kind === w.kind && s.time === w.time)).length;
  let cls = 'ok';
  let verdict = "Amma's scheduler is running and your times are saved on the server.";
  if (!st.slots.length) {
    cls = 'bad';
    verdict = 'The server has no reminders for this phone.';
  } else if (st.overdue > 0) {
    cls = 'bad';
    verdict = `${st.overdue} reminder${st.overdue > 1 ? 's were' : ' was'} due but never processed. The every-minute scheduler is not running.`;
  } else if (missing) {
    cls = 'bad';
    verdict = 'The server has different times from this phone.';
  }
  const fmt = (ms) => new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  const rows = st.slots
    .slice(0, 6)
    .map((s) => `<li><b>${esc(KIND_NAME[s.kind] || s.kind)}</b> ${esc(fmt(s.due))}${s.once ? ' (snoozed)' : ''}</li>`)
    .join('');
  const serverTime = new Date(st.now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `<div class="card status ${cls}" role="status">
    <p class="verdict">${cls === 'ok' ? '✅' : '⚠️'} ${esc(verdict)}</p>
    ${rows ? `<ul>${rows}</ul>` : ''}
    <p class="fine-dark">Server clock ${esc(serverTime)} · sent today ${Number(st.sentToday)} · failed sends in a row ${Number(st.fails)}</p>
    ${cls === 'bad' && st.overdue === 0 ? `<button type="button" class="btn btn-primary btn-block" data-act="resync">Sync my times now</button>` : ''}
  </div>`;
}

async function checkStatus() {
  if (ui.busy) return;
  ui.busy = true;
  render();
  try {
    ui.status = await api('/api/status', { id: state.id, token: state.token });
  } catch (e) {
    if (e.status === 401) return lostServerRecord();
    toast(e.message);
  } finally {
    ui.busy = false;
    render();
  }
}

async function resync() {
  try {
    await api('/api/update', { id: state.id, token: state.token, settings: state.settings, tz: deviceTz() });
    toast('Times synced.');
  } catch (e) {
    if (e.status === 401) return lostServerRecord();
    toast(e.message);
  }
  return checkStatus();
}

// ---------- Your own Amma (photo + recordings, all on this phone) and voice ----------
const OWN_KINDS = [
  ['morning', '☀️', 'Good morning'],
  ['meal', '🍛', 'Meals'],
  ['water', '💧', 'Water'],
  ['break', '🧘', 'Breaks'],
  ['call', '📞', 'Call home'],
  ['bedtime', '🌙', 'Bedtime'],
];

function ownSection() {
  const photo = V.own.photoUrl;
  const rows = OWN_KINDS.map(([k, icon, label]) => {
    const has = V.own.clips.has(k);
    return `<div class="rcard own-row${has ? ' on' : ''}"><div class="row"><span class="badge" aria-hidden="true">${icon}</span><div class="row-main"><span class="row-title">${label}</span><span class="row-hint">${has ? "Amma's voice is saved" : 'Not recorded yet'}</span></div>${
      has ? `<button type="button" class="icon-btn" data-act="rec-play" data-kind="${k}" aria-label="Play the ${label} recording">▶</button><button type="button" class="icon-btn" data-act="rec-del" data-kind="${k}" aria-label="Delete the ${label} recording">🗑</button>` : ''
    }<button type="button" class="btn btn-ghost btn-sm" data-act="rec" data-kind="${k}" data-label="${label}">${has ? 'Redo' : 'Record'}</button></div></div>`;
  }).join('');
  return `<section class="section"><h3>Your own Amma</h3>
    <p>Add her photo and her real voice. Everything stays on this phone and is never uploaded.</p>
    <div class="card photo-card"><div class="photo-preview">${photo ? `<img src="${photo}" alt="Your Amma">` : ammaSvg('loving', { decorative: true })}</div>
      <div class="photo-actions"><button type="button" class="btn btn-ghost" data-act="photo">${photo ? 'Change photo' : 'Add her photo'}</button>${photo ? '<button type="button" class="link" data-act="photo-del">Remove</button>' : ''}</div></div>
    ${V.canRecord() ? `<div class="rows">${rows}</div>` : `<div class="note">This browser can't record audio, so only the photo is available.</div>`}
  </section>`;
}

function voicePanel() {
  const v = ui.voice;
  if (!v) return '';
  const li = (ok, yes, no) => `<li>${ok ? '✅' : '⚠️'} ${esc(ok ? yes : no)}</li>`;
  const good = v.clips > 0 || v.tamilVoice;
  return `<div class="card status ${good ? 'ok' : 'bad'}" role="status"><p class="verdict">Voice check</p><ul>
    ${li(v.clips > 0, `${v.clips} pre-made Amma clips are installed.`, 'No pre-made Amma clips are installed yet.')}
    ${li(!!v.tamilVoice, `Tamil voice on this phone: ${v.tamilVoice}.`, "No Tamil voice on this phone. Install Tamil voice data in your phone's text-to-speech settings.")}
    ${li(!!v.englishVoice, `English voice on this phone: ${v.englishVoice}.`, 'No English voice found on this phone.')}
    ${li(v.canRecord, 'Recording your own Amma works here.', "This browser can't record audio.")}
    ${li(v.canListen, 'Speaking to Amma with the microphone button is available.', 'Speaking to Amma is not available in this browser. Typing works.')}
  </ul><p class="fine-dark">Microphone permission: ${esc(v.mic)}. Your own recordings: ${Number(v.ownClips)}.</p></div>`;
}

async function doHear({ kind, text }) {
  const how = await V.hear({ kind, text, lang: state.settings.lang });
  if (how === 'none') toast("Amma can't speak on this phone yet. Try the Voice check below.");
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
    case 'status': return checkStatus();
    case 'resync': return resync();
    case 'hear': return doHear({ kind: ui.kind, text: ui.line });
    case 'hear-banner': {
      const h = ui.hear;
      ui.hear = null;
      render();
      return doHear(h);
    }
    case 'chat': return setTab('chat');
    case 'tab': return setTab(el.dataset.tab);
    case 'photo': return pickPhoto(() => toast('Photo saved on this phone.'), () => toast("Couldn't use that photo. Try another one."));
    case 'photo-del': return V.removePhoto().then(render);
    case 'rec': return openRecorder({ kind: el.dataset.kind, label: el.dataset.label, onSaved: () => toast("Saved on this phone. Tap Hear Amma to try it.") });
    case 'rec-play': return V.getClip(el.dataset.kind).then((c) => c && c.blob && V.play(c.blob)).catch(() => toast("Couldn't play that recording."));
    case 'rec-del':
      if (confirm('Delete this recording from this phone?')) V.removeClip(el.dataset.kind).then(render);
      return;
    case 'voice-check': return V.voiceCheck().then((v) => { ui.voice = v; render(); });
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

// A tap on a reminder notification opens the app with ?hear=<kind>&t=<the line>, so Amma can say it out loud.
const launch = new URLSearchParams(location.search);
if (launch.has('hear')) {
  ui.hear = { kind: launch.get('hear'), text: launch.get('t') || '' };
  history.replaceState(null, '', '/');
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'hear') {
      ui.hear = { kind: e.data.kind, text: e.data.text || '' };
      render();
    }
  });
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
V.loadManifest().then(render);
V.loadOwn().then(render);
if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', render);
render();
syncOnOpen();
