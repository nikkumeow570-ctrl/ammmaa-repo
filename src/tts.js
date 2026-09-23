// Sarvam Bulbul text-to-speech. Used only for AI chat replies (new sentences nobody pre-recorded) — Amma's own
// recordings and the pre-made Edge TTS clips never go through here, and never will: this is deliberately a
// separate, clearly-synthesized voice, not a clone of anyone's real voice.
//
// Endpoint shape follows Sarvam's published REST API (docs.sarvam.ai, /api-reference-docs/text-to-speech/api/rest-api,
// checked September 2026): POST https://api.sarvam.ai/text-to-speech, header api-subscription-key, JSON body with
// text/target_language_code/speaker/model/pace, JSON response { audios: [base64 wav, ...] }. This has NOT been
// exercised against a live account from here — verify the model name, speaker list and pricing in your own
// dashboard before relying on it, and read Sarvam's Commercial Licensing terms before shipping it publicly.

const LANG_CODE = { ta: 'ta-IN', tanglish: 'ta-IN', en: 'en-IN' }; // tanglish is Tamil in Latin letters, so the Tamil code gives correct pronunciation

export function sarvamLangCode(lang) {
  return LANG_CODE[lang] || 'en-IN';
}

/** Returns base64-encoded WAV audio, or throws. `env` needs SARVAM_API_KEY. */
export async function sarvamSpeak(env, text, lang, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  if (!env.SARVAM_API_KEY) throw new Error('SARVAM_API_KEY is not set');
  const body = String(text || '').trim();
  if (!body) throw new Error('no text to speak');

  const res = await fetchImpl('https://api.sarvam.ai/text-to-speech', {
    method: 'POST',
    headers: { 'api-subscription-key': env.SARVAM_API_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({
      text: body.slice(0, 500),
      target_language_code: sarvamLangCode(lang),
      speaker: env.SARVAM_TTS_SPEAKER || 'anushka',
      model: env.SARVAM_TTS_MODEL || 'bulbul:v2',
      pace: Number(env.SARVAM_TTS_PACE) || 1.0,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`sarvam tts ${res.status}`);
  const data = await res.json();
  const clip = data && Array.isArray(data.audios) && data.audios[0];
  if (!clip || typeof clip !== 'string') throw new Error('no audio in sarvam response');
  return clip;
}

/** base64 -> Uint8Array, for turning the response into a playable file. Workers' atob/btoa are global, like in push.js. */
export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
