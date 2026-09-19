// Generates a VAPID key pair for Web Push.  Usage: npm run keys
import { generateKeyPairSync } from 'node:crypto';

const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const jwk = privateKey.export({ format: 'jwk' });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);

console.log('\nVAPID_PUBLIC_KEY  (goes in wrangler.jsonc -> vars):\n' + pub.toString('base64url'));
console.log('\nVAPID_PRIVATE_KEY (secret! run: npx wrangler secret put VAPID_PRIVATE_KEY):\n' + jwk.d);
console.log('\nFor local dev put these in .dev.vars:\nVAPID_PRIVATE_KEY=' + jwk.d + '\n');
