// Chat with Amma. One persistent panel: the app re-attaches it to the Chat tab after every render, so what was typed,
// the conversation and the microphone state survive re-renders.
import { icon } from './icons.js';
import { ammaSvg } from './amma.js';
import { pickLine } from './shared.js';
import { canHear, hear, canListen, listen, stopAudio } from './voice.js';

const STORE = 'ammmaa.chat.v1';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const langAttr = (l) => (l === 'ta' ? 'ta' : l === 'tanglish' ? 'ta-Latn' : 'en');

// Quick replies to start a conversation (the Tamil ones need a native speaker's review).
const STARTERS = {
  en: ['I skipped lunch', "I'm tired today", 'Tell me something nice'],
  tanglish: ['Innum saapadala Amma', 'Romba tired-a irukku', 'Edhavadhu nalladha sollu'],
  ta: ['இன்னும் சாப்பிடல அம்மா', 'ரொம்ப சோர்வா இருக்கு', 'நல்லதா ஏதாவது சொல்லு'],
};

function loadLog() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE));
    return Array.isArray(v) ? v.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string').slice(-30) : [];
  } catch {
    return [];
  }
}

/**
 * @param ctx { lang(), tone(), id(), token(), api(path, body), onLost() }
 */
export function createChat(ctx) {
  const el = document.createElement('section');
  el.className = 'chat-tab';
  el.setAttribute('aria-label', 'Chat with Amma');
  const sheet = { el, body: el };
  const msgs = loadLog();
  let busy = false;
  let left = null;
  let listening = null;

  const mood = () => ctx.tone();
  sheet.body.innerHTML = `
    <header class="chat-head">
      <div class="avatar">${ammaSvg(mood(), { decorative: true })}</div>
      <div class="chat-title"><b>Amma</b><small>An AI character, not a real person</small></div>
    </header>
    <p class="chat-disclose">Your messages are sent to an AI service so it can write Amma's reply. Please don't share private details. <button type="button" class="link" data-c="clear">Clear chat</button></p>
    <div class="chat-log" role="log" aria-live="polite"></div>
    <p class="chat-note" id="chat-note" role="status"></p>
    <form class="chat-form" autocomplete="off">
      <button type="button" class="mic" data-c="mic" aria-label="Speak instead of typing" ${canListen() ? '' : 'hidden'}>${icon('mic')}</button>
      <input class="chat-input" type="text" maxlength="300" enterkeyhint="send" aria-label="Message to Amma" placeholder="Say something to Amma">
      <button type="submit" class="chat-send" aria-label="Send">${icon('send')}</button>
    </form>`;
  const log = sheet.body.querySelector('.chat-log');
  const input = sheet.body.querySelector('.chat-input');
  const note = sheet.body.querySelector('#chat-note');
  const setNote = (t) => (note.textContent = t);
  const save = () => localStorage.setItem(STORE, JSON.stringify(msgs.slice(-30)));

  function bubble(m, i) {
    const say = m.role === 'assistant' && canHear({ text: m.text, lang: ctx.lang() }) ? `<button type="button" class="say" data-c="say" data-i="${i}" aria-label="Hear this">&#128266;</button>` : '';
    return `<div class="msg ${m.role === 'user' ? 'user' : 'amma'}${m.safety ? ' safety' : ''}"><p lang="${langAttr(ctx.lang())}">${esc(m.text)}</p>${say}</div>`;
  }

  function draw() {
    let html = msgs.map(bubble).join('');
    if (!msgs.length) {
      const hello = pickLine(ctx.lang(), ctx.tone(), 'morning');
      html =
        `<div class="msg amma"><p lang="${langAttr(ctx.lang())}">${esc(hello)}</p></div>` +
        `<div class="starters">${(STARTERS[ctx.lang()] || STARTERS.en).map((t) => `<button type="button" class="chip" data-c="starter" data-t="${esc(t)}" lang="${langAttr(ctx.lang())}">${esc(t)}</button>`).join('')}</div>`;
    }
    if (busy) html += `<div class="msg amma typing" aria-label="Amma is typing"><span class="dots"><i></i><i></i><i></i></span></div>`;
    log.innerHTML = html;
    log.scrollTop = log.scrollHeight;
  }

  async function send(raw) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!text || busy) return;
    const history = msgs.filter((m) => !m.safety).slice(-6).map((m) => ({ role: m.role, text: m.text }));
    msgs.push({ role: 'user', text });
    input.value = '';
    busy = true;
    setNote('');
    draw();
    try {
      const out = await ctx.api('/api/chat', { id: ctx.id(), token: ctx.token(), text, history, lang: ctx.lang(), tone: ctx.tone() });
      msgs.push({ role: 'assistant', text: out.reply, safety: !!out.safety });
      if (typeof out.left === 'number') left = out.left;
      if (out.limited) setNote("That's all the chatting for today. Amma will be back tomorrow, and her reminders keep coming.");
      else if (left !== null && left <= 3) setNote(`${left} chat message${left === 1 ? '' : 's'} left today.`);
    } catch (e) {
      if (e && e.status === 401) return ctx.onLost();
      msgs.pop(); // the message did not go through, so do not keep it in the conversation
      input.value = text;
      setNote("Amma can't hear you right now. Check your connection and try again.");
    } finally {
      busy = false;
      save();
      draw();
      input.focus({ preventScroll: true });
    }
  }

  // Called when the person leaves the Chat tab.
  const pause = () => {
    if (listening) listening.stop();
    stopAudio();
  };

  sheet.el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    switch (b.dataset.c) {
      case 'clear':
        msgs.length = 0;
        save();
        setNote('');
        return draw();
      case 'starter': return send(b.dataset.t);
      case 'say': {
        const m = msgs[Number(b.dataset.i)];
        return m && hear({ text: m.text, lang: ctx.lang() });
      }
      case 'mic':
        if (listening) {
          listening.stop();
          return;
        }
        b.classList.add('on');
        setNote('Listening... speak now.');
        listening = listen(ctx.lang(), {
          onText: (t) => (input.value = t),
          onEnd: () => {
            listening = null;
            b.classList.remove('on');
            setNote(input.value ? 'Check what I heard, then press Send.' : '');
          },
          onError: (code) => setNote(code === 'not-allowed' ? 'The microphone is blocked for this site.' : "Couldn't hear you. Try again."),
        });
    }
  });
  sheet.body.querySelector('.chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    send(input.value);
  });

  draw();

  const head = el.querySelector('.chat-head');
  // Language or mood may have changed on the More tab since the panel was last shown.
  const refresh = () => {
    head.querySelector('.avatar').innerHTML = ammaSvg(mood(), { decorative: true });
    draw();
  };
  return {
    el,
    pause,
    attached() {
      refresh();
      log.scrollTop = log.scrollHeight;
    },
    hasFocus: () => document.activeElement === input,
    focus: () => input.focus({ preventScroll: true }),
  };
}

export function clearChat() {
  localStorage.removeItem(STORE);
}
