import { LANGS, TONES, KINDS, MESSAGES, normalizeSettings, pickLine } from '../public/shared.js';

// ---------- Prompt ----------
const LANG_DESC = {
  ta: 'Tamil, written in Tamil script, colloquial spoken style',
  tanglish: 'Tamil written in English letters (Tanglish), colloquial spoken style',
  en: 'simple, warm English with an occasional Tamil endearment such as kanna or chellam',
};
const TONE_DESC = {
  loving: 'loving and gentle, like a mother who worries about you',
  strict: 'strict and bossy in a caring way, like a mother who will not take no for an answer',
  funny: 'playful and teasing, with light humour',
};

// Amma's own ready-made lines are shown to the model as examples of how she talks (there is no trained model:
// the persona and these examples are what make the replies sound like her).
const EXAMPLE_KINDS = ['meal', 'water', 'bedtime', 'call'];

export function systemPrompt(lang, tone) {
  const examples = EXAMPLE_KINDS.map((k) => MESSAGES[lang]?.[tone]?.[k]?.[0])
    .filter(Boolean)
    .map((l) => `- ${l}`)
    .join('\n');
  return (
    `You are Amma, a Tamil mother in her early fifties, chatting with her grown-up child who lives away from home. You are an AI character inside a small reminder app.\n` +
    `Who you are: warm, practical and a little dramatic. You have spent years cooking, worrying and waiting for phone calls. You think in homely things: food, water, sleep, rest, the weather, calling home, what the elders say. You notice when they sound tired or have skipped a meal. You are not modern or techy, and you never use slang, hashtags, bullet points or business English.\n` +
    `How you speak: reply in ${LANG_DESC[lang]}. Tone: ${TONE_DESC[tone]}. Call them "kanna" or "chellam" and never assume their gender. Use 1 to 3 short sentences, at most one gentle question, and at most one emoji.\n` +
    `Your own words sound like these, so keep this style:\n${examples}\n` +
    `Never give medical, legal or financial advice: say what a mother would, and tell them to ask a doctor or an elder. You are an AI, not a real person: if asked, say so kindly and say you are here to look after them. ` +
    `If the person sounds very sad or hopeless, or mentions hurting themselves, respond with warmth, tell them they matter, and encourage them to talk to someone they trust or a local helpline right now.`
  );
}

// ---------- Safety net ----------
// Best-effort keyword net for the most serious messages. It is NOT a classifier: the system prompt above also
// tells the model how to respond. When it matches, we skip the AI and send a fixed, caring, reviewed reply.
const DISTRESS = [
  /suicid/i, /kill\s+my\s*self/i, /want(ed)?\s+to\s+die/i, /wanna\s+die/i, /end\s+(my\s+life|it\s+all)/i, /self[\s-]?harm/i,
  /hurt\s+my\s*self/i, /no\s+reason\s+to\s+live/i, /(don'?t|do\s+not)\s+want\s+to\s+(live|be\s+alive)/i, /better\s+off\s+dead/i,
  /th?atkolai/i, /\bsa+g(a|u)?\s*(num|nu|poren|porean|porein)/i, /\bsaavanum\b/i, /uyir\s+(vida|vitudalam)/i, /vazha\s+pidikala/i,
  /தற்கொலை/, /சாக\s*(வேண்டும்|வேணும்|ணும்|போறேன்|போகிறேன்|லாம்)/, /செத்து\s*(விடலாம்|டலாம்|டணும்)/, /உயிரை\s*(விட|மாய்)/, /வாழ\s*(பிடிக்க|வே\s*பிடிக்க)/,
];

export const isDistress = (text) => DISTRESS.some((re) => re.test(text));

// Tele-MANAS: Government of India's free 24x7 helpline, 14416 or 1-800-891-4416. Have a native speaker review the Tamil.
export const DISTRESS_REPLY = {
  en: "I'm so glad you told me, kanna, and I'm right here. You matter. Please talk to someone you trust right now: a family member or a friend. If you are in India, you can call Tele-MANAS on 14416, it is free and open 24 hours. If you are somewhere else, please call your local emergency number or helpline. If you are in danger right now, call emergency services.",
  tanglish:
    "Nee sonnadhu romba nalladhu kanna, naan inga dhaan irukken. Nee romba mukkiyam. Ippove nambura oruthar kitta pesu: veetula yaaraavadhu, illa nanbar. India-la irundha Tele-MANAS 14416 ku phone pannalam, free, 24 mani neram. Veliyoor-la irundha ungal oor emergency number ku call pannunga. Aabathunna udane emergency service ku call pannu.",
  ta: 'நீ சொன்னது ரொம்ப நல்லது கண்ணு, நான் இங்கதான் இருக்கேன். நீ எனக்கு ரொம்ப முக்கியம். இப்பவே நம்புறவங்க கிட்ட பேசு, வீட்டுல யாராவது இல்ல நண்பர்கள். இந்தியாவுல இருந்தா Tele-MANAS 14416 க்கு போன் பண்ணலாம், இலவசம், 24 மணி நேரமும். வேற நாட்டுல இருந்தா அங்க இருக்கிற அவசர எண்ணுக்கு அழைப்பு பண்ணு. ஆபத்துன்னா உடனே அவசர சேவைக்கு போன் பண்ணு.',
};

// ---------- Providers ----------
const CF_MODELS = ['@cf/meta/llama-3.2-3b-instruct', '@cf/google/gemma-3-12b-it'];
const MAX_TOKENS = 200;

const textOf = (out) =>
  typeof out === 'string' ? out : out?.response ?? out?.result?.response ?? out?.choices?.[0]?.message?.content ?? '';

export function cleanReply(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^["'`\s]+|["'`\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 400)
    .trim();
}

async function viaWorkersAI(env, messages) {
  if (!env.AI) throw new Error('Workers AI is not bound');
  let lastErr;
  for (const model of [env.AI_MODEL, ...CF_MODELS].filter(Boolean)) {
    try {
      const t = cleanReply(textOf(await env.AI.run(model, { messages, max_tokens: MAX_TOKENS, temperature: 0.8 })));
      if (t) return t;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('empty reply');
}

async function viaOpenAICompatible(url, headers, model, messages) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ model, messages, max_tokens: MAX_TOKENS, temperature: 0.8 }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`provider ${res.status}`);
  const t = cleanReply(textOf(await res.json()));
  if (!t) throw new Error('empty reply');
  return t;
}

const PROVIDERS = {
  'workers-ai': (env, messages) => viaWorkersAI(env, messages),
  groq: (env, messages) => {
    if (!env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not set');
    return viaOpenAICompatible('https://api.groq.com/openai/v1/chat/completions', { authorization: `Bearer ${env.GROQ_API_KEY}` }, env.GROQ_MODEL || 'llama-3.3-70b-versatile', messages);
  },
  sarvam: (env, messages) => {
    if (!env.SARVAM_API_KEY) throw new Error('SARVAM_API_KEY is not set');
    return viaOpenAICompatible(
      'https://api.sarvam.ai/v1/chat/completions',
      { authorization: `Bearer ${env.SARVAM_API_KEY}`, 'api-subscription-key': env.SARVAM_API_KEY },
      env.SARVAM_MODEL || 'sarvam-30b',
      messages,
    );
  },
};

async function generate(env, messages) {
  const primary = PROVIDERS[env.CHAT_PROVIDER] ? env.CHAT_PROVIDER : 'workers-ai';
  const order = primary === 'workers-ai' ? ['workers-ai'] : [primary, 'workers-ai']; // Workers AI is the backup
  let lastErr;
  for (const name of order) {
    try {
      return { text: await PROVIDERS[name](env, messages), provider: name };
    } catch (e) {
      lastErr = e;
      console.error('chat provider failed', name, e && e.message);
    }
  }
  throw lastErr || new Error('no provider');
}

// ---------- Daily cap (per phone) ----------
// Created on first use, once per database binding (so the live database needs no manual migration).
const usageTableReady = new WeakSet();
async function countUse(env) {
  if (!usageTableReady.has(env.DB)) {
    await env.DB.prepare('CREATE TABLE IF NOT EXISTS chat_usage (sub_id TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (sub_id, day))').run();
    usageTableReady.add(env.DB);
  }
}

async function bumpUsage(env, subId, now) {
  await countUse(env);
  const day = new Date(now).toISOString().slice(0, 10);
  const row = await env.DB.prepare('INSERT INTO chat_usage (sub_id, day, n) VALUES (?, ?, 1) ON CONFLICT(sub_id, day) DO UPDATE SET n = n + 1 RETURNING n').bind(subId, day).first();
  const n = row ? row.n : 1;
  if (n === 1) await env.DB.prepare('DELETE FROM chat_usage WHERE day < ?').bind(new Date(now - 3 * 864e5).toISOString().slice(0, 10)).run();
  return n;
}

// ---------- One chat turn ----------
const clip = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

function fallbackLine(lang, tone) {
  const kind = KINDS[Math.floor(Math.random() * KINDS.length)];
  return pickLine(lang, tone, kind);
}

/**
 * @param row  the authenticated `subs` row
 * @param body { text, history?: [{role:'user'|'assistant', text}], lang?, tone? }
 * @returns { reply, left, fallback?, safety? } or { error, status }
 */
export async function chatTurn(env, row, body, now = Date.now()) {
  const text = clip(body.text, 300);
  if (!text) return { error: 'Say something to Amma first.', status: 400 };

  let settings = {};
  try {
    settings = normalizeSettings(JSON.parse(row.settings || '{}'));
  } catch {
    settings = normalizeSettings({});
  }
  const lang = LANGS.some((l) => l.id === body.lang) ? body.lang : settings.lang;
  const tone = TONES.some((t) => t.id === body.tone) ? body.tone : settings.tone;
  const cap = Math.max(1, Number(env.CHAT_DAILY) || 12);

  if (isDistress(text)) return { reply: DISTRESS_REPLY[lang] || DISTRESS_REPLY.en, safety: true, left: cap };

  const used = await bumpUsage(env, row.id, now);
  const left = Math.max(0, cap - used);
  if (used > cap) return { reply: fallbackLine(lang, tone), fallback: true, limited: true, left: 0 };

  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((h) => h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string')
    .slice(-6)
    .map((h) => ({ role: h.role, content: clip(h.text, 300) }))
    .filter((h) => h.content);
  const messages = [{ role: 'system', content: systemPrompt(lang, tone) }, ...history, { role: 'user', content: text }];

  try {
    const { text: reply } = await generate(env, messages);
    return { reply, left };
  } catch (e) {
    console.error('chat failed', e && e.message);
    return { reply: fallbackLine(lang, tone), fallback: true, left };
  }
}
