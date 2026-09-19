import { bytesToB64u } from './push.js';

const enc = new TextEncoder();

export function randomId(bytes = 12) {
  return bytesToB64u(crypto.getRandomValues(new Uint8Array(bytes)));
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function sha256hex(text) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

export async function hmacHex(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Signature carried inside each notification so the "in 30 min" button can snooze
// without the service worker needing the device token.
export function snoozeSig(env, subId, kind) {
  return hmacHex(env.APP_SECRET, `snooze.${subId}.${kind}`);
}
