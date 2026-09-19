import { LANGS, TONES, KINDS, MESSAGES } from '../public/shared.js';

const KEEP_PER_COMBO = 30;

const KIND_HINT = {
  meal: 'asking if they have eaten',
  water: 'reminding them to drink water',
  break: 'telling them to take a break from the screen and move',
  call: 'asking them to call home',
  bedtime: 'telling them to sleep',
  morning: 'a morning greeting that also tells them to eat',
};
const TONE_HINT = {
  loving: 'warm, gentle and affectionate',
  strict: 'firm and scolding, but still caring',
  funny: 'playful and teasing, light humour, no insults',
};
const LANG_HINT = {
  ta: 'Tamil, written in Tamil script only (no English letters)',
  tanglish: 'Tamil written in Latin letters (Tanglish), the way people text on WhatsApp',
  en: 'simple Indian English, with the occasional Tamil pet name like kanna or chellam',
};

const TAMIL = /[\u0B80-\u0BFF]/;

function isValid(lang, line) {
  if (typeof line !== 'string') return false;
  const t = line.trim();
  if (t.length < 8 || t.length > 110) return false;
  if (/https?:|@|#/.test(t)) return false;
  const hasTamil = TAMIL.test(t);
  return lang === 'ta' ? hasTamil : !hasTamil;
}

function extractText(out) {
  if (!out) return '';
  if (typeof out.response === 'string') return out.response;
  const c = out.choices && out.choices[0] && out.choices[0].message && out.choices[0].message.content;
  return typeof c === 'string' ? c : '';
}

function extractLines(text) {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  try {
    const arr = JSON.parse(m[0]);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// One language per day (rotating) keeps us inside the free plan's per-run subrequest limit.
export async function generateAiLines(env, now = Date.now()) {
  if (env.AI_VARIATIONS !== 'on' || !env.AI) return { skipped: true };
  const model = env.AI_MODEL || '@cf/meta/llama-3.2-3b-instruct';
  const lang = LANGS[Math.floor(now / 86400000) % LANGS.length].id;
  const stmts = [];
  let added = 0;

  for (const tone of TONES) {
    for (const kind of KINDS) {
      const examples = MESSAGES[lang][tone.id][kind].map((l) => `"${l}"`).join(', ');
      const messages = [
        {
          role: 'system',
          content:
            'You write short reminder messages in the voice of a Tamil mother texting her grown-up child. ' +
            'Reply with ONLY a JSON array of 5 strings. No explanation, no emojis, no hashtags.',
        },
        {
          role: 'user',
          content:
            `Language: ${LANG_HINT[lang]}.\nTone: ${TONE_HINT[tone.id]}.\nPurpose: ${KIND_HINT[kind]}.\n` +
            `Each message must be under 90 characters and different from these examples: ${examples}.`,
        },
      ];
      let lines = [];
      try {
        lines = extractLines(extractText(await env.AI.run(model, { messages, max_tokens: 400 })));
      } catch {
        continue; // model unavailable or over the free limit: keep the hand-written bank
      }
      for (const line of lines.filter((l) => isValid(lang, l)).slice(0, 5)) {
        stmts.push(
          env.DB.prepare('INSERT INTO ai_lines (lang, tone, kind, text, created_at) VALUES (?, ?, ?, ?, ?)').bind(lang, tone.id, kind, line.trim(), now),
        );
        added++;
      }
      stmts.push(
        env.DB.prepare(
          `DELETE FROM ai_lines WHERE lang = ? AND tone = ? AND kind = ? AND id NOT IN
             (SELECT id FROM ai_lines WHERE lang = ? AND tone = ? AND kind = ? ORDER BY id DESC LIMIT ?)`,
        ).bind(lang, tone.id, kind, lang, tone.id, kind, KEEP_PER_COMBO),
      );
    }
  }
  if (stmts.length) await env.DB.batch(stmts);
  return { lang, added };
}
