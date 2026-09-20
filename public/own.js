// "Your own Amma": a record sheet for one voice clip, and a photo picker. Both work only on this device.
import { startRecording, saveClip, savePhoto, play, stopAudio } from './voice.js';

const MAX_MS = 12000;
const MIN_MS = 700;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (ms) => `0:${String(Math.min(99, Math.floor(ms / 1000))).padStart(2, '0')}`;

// A modal sheet that lives outside the app's own render loop, so toasts and re-renders cannot wipe it.
export function mountSheet(label) {
  const opener = document.activeElement;
  const el = document.createElement('div');
  el.className = 'overlay';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', label);
  el.innerHTML = '<div class="sheet"></div>';
  document.body.appendChild(el);
  document.body.classList.add('no-scroll');
  const close = () => {
    document.removeEventListener('keydown', onKey);
    el.remove();
    if (!document.querySelector('.overlay')) document.body.classList.remove('no-scroll');
    if (opener && opener.focus) opener.focus({ preventScroll: true });
  };
  const onKey = (e) => e.key === 'Escape' && el.dispatchEvent(new CustomEvent('sheet-close'));
  document.addEventListener('keydown', onKey);
  return { el, body: el.querySelector('.sheet'), close };
}

/** Record one clip of the person's Amma saying something for `kind`. */
export function openRecorder({ kind, label, onSaved }) {
  const sheet = mountSheet(`Record Amma: ${label}`);
  let state = 'idle'; // idle | recording | review | short | error
  let ctl = null;
  let take = null;
  let err = '';

  const closeAll = () => {
    state = 'closed';
    if (ctl) ctl.cancel();
    stopAudio();
    sheet.close();
  };
  sheet.el.addEventListener('sheet-close', closeAll);

  const views = {
    idle: () => `<h2>Record Amma: ${esc(label)}</h2>
      <p class="lede">Ask your amma to say a few words, or use a recording you already love. Up to 12 seconds. It stays on this phone and is never uploaded.</p>
      <button type="button" class="rec-btn" data-r="start" aria-label="Start recording"><span></span></button>
      <button type="button" class="btn btn-ghost btn-block" data-r="close">Cancel</button>`,
    recording: () => `<h2>Recording...</h2>
      <p class="rec-time" id="rec-time" aria-live="off">0:00 / ${fmt(MAX_MS)}</p>
      <button type="button" class="rec-btn on" data-r="stop" aria-label="Stop recording"><span></span></button>
      <p class="lede">Tap to stop.</p>`,
    review: () => `<h2>Listen, then keep it</h2>
      <p class="lede">${fmt(take.ms)} recorded.</p>
      <div class="stack">
        <button type="button" class="btn btn-ghost btn-block" data-r="play">Play it</button>
        <button type="button" class="btn btn-primary btn-block" data-r="save">Keep this recording</button>
        <button type="button" class="btn btn-ghost btn-block" data-r="retry">Try again</button>
      </div>`,
    short: () => `<h2>That was very short</h2><p class="lede">Hold on a little longer and try again.</p>
      <button type="button" class="btn btn-primary btn-block" data-r="retry">Try again</button>`,
    error: () => `<h2>Couldn't record</h2><div class="note" role="alert">${esc(err)}</div>
      <button type="button" class="btn btn-ghost btn-block" data-r="close">Close</button>`,
  };
  const draw = () => {
    sheet.body.innerHTML = views[state]();
    const first = sheet.body.querySelector('button');
    if (first) first.focus({ preventScroll: true });
  };

  async function start() {
    try {
      ctl = await startRecording(MAX_MS, (ms) => {
        const t = sheet.el.querySelector('#rec-time');
        if (t) t.textContent = `${fmt(ms)} / ${fmt(MAX_MS)}`;
      });
    } catch (e) {
      err = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
        ? "The microphone is blocked for this site. Allow it in your browser's site settings, then try again."
        : "Couldn't start the microphone on this device.";
      state = 'error';
      return draw();
    }
    state = 'recording';
    draw();
    ctl.finished.then((r) => {
      if (state !== 'recording') return;
      take = r;
      state = r.ms < MIN_MS ? 'short' : 'review';
      draw();
    });
  }

  sheet.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-r]');
    if (!b) return;
    switch (b.dataset.r) {
      case 'start': return start();
      case 'stop': return ctl && ctl.stop();
      case 'play': return play(take.blob).catch(() => {});
      case 'retry': stopAudio(); state = 'idle'; return draw();
      case 'save':
        try {
          await saveClip(kind, take.blob, take.ms);
        } catch {
          err = 'This device would not let the app save the recording.';
          state = 'error';
          return draw();
        }
        closeAll();
        return onSaved && onSaved();
      case 'close': return closeAll();
    }
  });
  draw();
}

// ---------- Photo ----------
async function squareJpeg(file, size) {
  let bmp;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bmp = await createImageBitmap(file);
  }
  const s = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  if (bmp.close) bmp.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), 'image/jpeg', 0.85));
}

/** Opens the photo chooser. The photo is cropped to a square and shrunk before it is kept on this phone. */
export function pickPhoto(onSaved, onError) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      await savePhoto(await squareJpeg(file, 384));
      onSaved();
    } catch {
      if (onError) onError();
    }
  };
  input.click();
}
