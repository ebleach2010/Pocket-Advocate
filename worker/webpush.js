// Native Web Push (RFC 8291 aes128gcm + RFC 8292 VAPID), no Firebase. Works on
// iOS Home-Screen PWAs, Android, and desktop alike. The Worker signs and
// encrypts each push itself using our VAPID keypair.
//
// Secrets/config (wrangler):
//   VAPID_PRIVATE_JWK  secret  — the EC P-256 private key, JWK JSON
//   VAPID_PUBLIC_KEY   var     — applicationServerKey (uncompressed point, base64url)
//   VAPID_SUBJECT      var     — mailto: contact for push services

const te = (s) => new TextEncoder().encode(s);
function cat(...arrs) {
  const len = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
function b64uToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  s += '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
function bytesToB64u(b) {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(keyBytes, dataBytes) {
  const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, dataBytes));
}
// HKDF with a single expand block (all our outputs are <= 32 bytes).
async function hkdf(salt, ikm, info, length) {
  const prk = await hmac(salt, ikm);
  const okm = await hmac(prk, cat(info, new Uint8Array([1])));
  return okm.slice(0, length);
}

/**
 * Encrypt `plaintext` (Uint8Array) for a subscription per RFC 8291.
 * `test` optionally injects a fixed ephemeral key + salt so we can check the
 * output against the RFC's known test vector.
 */
export async function encryptPayload(uaPublicRaw, authSecret, plaintext, test) {
  const uaKey = await crypto.subtle.importKey('raw', uaPublicRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, []);

  let asPublicRaw, ecdhSecret, salt;
  if (test) {
    salt = test.salt;
    asPublicRaw = test.asPublicRaw;
    const asPriv = await crypto.subtle.importKey('jwk', test.asPrivateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPriv, 256));
  } else {
    salt = crypto.getRandomValues(new Uint8Array(16));
    const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    asPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
    ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, kp.privateKey, 256));
  }

  // Stage 1 (RFC 8291): mix in the auth secret + both public keys.
  const keyInfo = cat(te('WebPush: info'), new Uint8Array([0]), uaPublicRaw, asPublicRaw);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  // Stage 2 (RFC 8188): derive the content-encryption key and nonce.
  const cek = await hkdf(salt, ikm, cat(te('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, cat(te('Content-Encoding: nonce'), new Uint8Array([0])), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const record = cat(plaintext, new Uint8Array([2])); // 0x02 = last-record padding delimiter
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, aesKey, record));

  // aes128gcm header: salt(16) | rs(4) | idlen(1) | keyid(as_public, 65)
  const rs = new Uint8Array([0, 0, 0x10, 0]); // 4096
  const header = cat(salt, rs, new Uint8Array([asPublicRaw.length]), asPublicRaw);
  return cat(header, cipher);
}

async function vapidAuth(env, endpoint) {
  const aud = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const header = bytesToB64u(te(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = bytesToB64u(te(JSON.stringify({ aud, exp: now + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:pocketadvocate.eric@gmail.com' })));
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, te(signingInput)));
  return `vapid t=${signingInput}.${bytesToB64u(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}

/** Send one push. Returns the HTTP status (201 = delivered; 404/410 = gone). */
export async function sendWebPush(env, sub, message) {
  const body = await encryptPayload(
    b64uToBytes(sub.p256dh),
    b64uToBytes(sub.auth),
    te(JSON.stringify(message))
  );
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      authorization: await vapidAuth(env, sub.endpoint),
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
      ttl: '2419200',
    },
    body,
  });
  return res.status;
}
