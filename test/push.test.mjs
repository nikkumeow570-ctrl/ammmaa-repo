import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { encryptPayload, sendPush, isAllowedEndpoint, bytesToB64u, b64uToBytes } from '../src/push.js';

function makeBrowserKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, p256dh: bytesToB64u(ecdh.getPublicKey()), authB64: bytesToB64u(auth) };
}

// Independent RFC 8291 decryption (what a browser does).
function decrypt(body, ecdh, auth) {
  const salt = body.subarray(0, 16);
  const rs = body.readUInt32BE(16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  assert.equal(rs, 4096);
  const shared = ecdh.computeSecret(asPublic);
  const uaPublic = ecdh.getPublicKey();
  const prk = Buffer.from(
    crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32),
  );
  const cek = Buffer.from(crypto.hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', prk, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, 'last-record delimiter');
  return plain.subarray(0, plain.length - 1).toString('utf8');
}

test('encryptPayload output decrypts correctly (Tamil + emoji safe)', async () => {
  const { ecdh, auth, p256dh, authB64 } = makeBrowserKeys();
  const msg = JSON.stringify({ title: 'அம்மா', body: 'சாப்பிட்டியா கண்ணா? 🍛' });
  const body = await encryptPayload(new TextEncoder().encode(msg), p256dh, authB64);
  assert.equal(decrypt(Buffer.from(body), ecdh, auth), msg);
});

test('sendPush builds a valid VAPID request', async () => {
  const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = kp.privateKey.export({ format: 'jwk' });
  const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
  const env = { VAPID_PUBLIC_KEY: bytesToB64u(pub), VAPID_PRIVATE_KEY: jwk.d, VAPID_SUBJECT: 'mailto:test@example.com' };
  const { ecdh, auth, p256dh, authB64 } = makeBrowserKeys();

  let captured;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response(null, { status: 201 });
  };
  try {
    const res = await sendPush(env, { endpoint: 'https://fcm.googleapis.com/fcm/send/abc123', p256dh, auth: authB64 }, { body: 'hi' }, { ttl: 60 });
    assert.deepEqual(res, { ok: true, status: 201 });
  } finally {
    globalThis.fetch = realFetch;
  }

  const h = captured.init.headers;
  assert.equal(h['Content-Encoding'], 'aes128gcm');
  assert.equal(h.TTL, '60');
  const m = h.Authorization.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=(\S+)$/);
  assert.ok(m, 'Authorization header shape');
  assert.equal(m[4], env.VAPID_PUBLIC_KEY);

  const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString());
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'mailto:test@example.com');
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 13 * 3600);

  const ok = crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key: kp.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url'));
  assert.ok(ok, 'JWT signature verifies with the VAPID public key');
  assert.equal(JSON.parse(decrypt(Buffer.from(captured.init.body), ecdh, auth)).body, 'hi');
});

test('endpoint allow-list blocks non push-service hosts', () => {
  assert.ok(isAllowedEndpoint('https://fcm.googleapis.com/fcm/send/x'));
  assert.ok(isAllowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/x'));
  assert.ok(isAllowedEndpoint('https://web.push.apple.com/x'));
  assert.ok(!isAllowedEndpoint('http://fcm.googleapis.com/x'));
  assert.ok(!isAllowedEndpoint('https://evil.example.com/x'));
  assert.ok(!isAllowedEndpoint('https://fcm.googleapis.com.evil.com/x'));
  assert.ok(!isAllowedEndpoint('https://169.254.169.254/latest'));
  assert.ok(!isAllowedEndpoint('not a url'));
});

test('base64url helpers round-trip', () => {
  const bytes = crypto.randomBytes(65);
  assert.deepEqual(Buffer.from(b64uToBytes(bytesToB64u(bytes))), bytes);
});
