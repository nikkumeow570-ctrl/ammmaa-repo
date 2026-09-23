import test from 'node:test';
import assert from 'node:assert/strict';
import { sarvamSpeak, sarvamLangCode, b64ToBytes } from '../src/tts.js';

test('tts: language codes for the three app languages', () => {
  assert.equal(sarvamLangCode('ta'), 'ta-IN');
  assert.equal(sarvamLangCode('tanglish'), 'ta-IN'); // Latin-script Tamil still gets the Tamil code for correct pronunciation
  assert.equal(sarvamLangCode('en'), 'en-IN');
  assert.equal(sarvamLangCode('nonsense'), 'en-IN');
});

test('tts: calls the documented Sarvam REST endpoint with the right header and body, and decodes the reply', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ audios: ['aGVsbG8='] }), { status: 200 });
  };
  const audio = await sarvamSpeak({ SARVAM_API_KEY: 'sk_test' }, 'Saaptiya kanna?', 'tanglish', { fetchImpl });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.sarvam.ai/text-to-speech');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['api-subscription-key'], 'sk_test');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.text, 'Saaptiya kanna?');
  assert.equal(body.target_language_code, 'ta-IN');
  assert.equal(body.model, 'bulbul:v2');
  assert.equal(body.pace, 1);
  assert.equal(audio, 'aGVsbG8=');
  assert.equal(Buffer.from(b64ToBytes(audio)).toString('utf8'), 'hello');
});

test('tts: env vars override the speaker, model and pace', async () => {
  let sent;
  const fetchImpl = async (_url, init) => ((sent = JSON.parse(init.body)), new Response(JSON.stringify({ audios: ['YQ=='] }), { status: 200 }));
  await sarvamSpeak({ SARVAM_API_KEY: 'k', SARVAM_TTS_SPEAKER: 'shubh', SARVAM_TTS_MODEL: 'bulbul:v3', SARVAM_TTS_PACE: '1.4' }, 'hi', 'en', { fetchImpl });
  assert.equal(sent.speaker, 'shubh');
  assert.equal(sent.model, 'bulbul:v3');
  assert.equal(sent.pace, 1.4);
});

test('tts: fails clearly with no key, empty text, an HTTP error, or a response with no audio', async () => {
  await assert.rejects(() => sarvamSpeak({}, 'hi', 'en'), /SARVAM_API_KEY/);
  await assert.rejects(() => sarvamSpeak({ SARVAM_API_KEY: 'k' }, '   ', 'en'), /no text/);
  await assert.rejects(
    () => sarvamSpeak({ SARVAM_API_KEY: 'k' }, 'hi', 'en', { fetchImpl: async () => new Response('nope', { status: 429 }) }),
    /sarvam tts 429/,
  );
  await assert.rejects(
    () => sarvamSpeak({ SARVAM_API_KEY: 'k' }, 'hi', 'en', { fetchImpl: async () => new Response(JSON.stringify({ audios: [] }), { status: 200 }) }),
    /no audio/,
  );
});

test('tts: text is capped at 500 characters before it is sent', async () => {
  let sent;
  const fetchImpl = async (_url, init) => ((sent = JSON.parse(init.body)), new Response(JSON.stringify({ audios: ['YQ=='] }), { status: 200 }));
  await sarvamSpeak({ SARVAM_API_KEY: 'k' }, 'x'.repeat(900), 'en', { fetchImpl });
  assert.equal(sent.text.length, 500);
});
