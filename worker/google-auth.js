// Service-account OAuth for Firestore REST calls, using WebCrypto (no SDK —
// firebase-admin does not run on Workers). Token is cached per isolate.

const cached = {}; // scope -> { token, expiresAt }

export async function getAccessToken(env, scope = 'https://www.googleapis.com/auth/datastore') {
  const now = Date.now();
  const hit = cached[scope];
  if (hit && hit.expiresAt - 60_000 > now) return hit.token;

  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const iat = Math.floor(now / 1000);
  const claims = {
    iss: sa.client_email,
    scope,
    aud: sa.token_uri,
    iat,
    exp: iat + 3600,
  };
  const enc = (obj) => base64url(new TextEncoder().encode(JSON.stringify(obj)));
  const signingInput = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(claims)}`;

  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  );
  const assertion = `${signingInput}.${base64url(new Uint8Array(sig))}`;

  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cached[scope] = { token: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return cached[scope].token;
}

// Mint a Firebase Auth custom token for a specific uid, signed with the
// service-account key (same mechanism firebase-admin uses). The browser trades
// it for a real session via signInWithCustomToken. Used by the PIN sign-in.
const CUSTOM_TOKEN_AUD =
  'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';

export async function mintCustomToken(env, uid) {
  const sa = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT);
  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    iss: sa.client_email,
    sub: sa.client_email,
    aud: CUSTOM_TOKEN_AUD,
    uid,
    iat,
    exp: iat + 3600,
  };
  const enc = (obj) => base64url(new TextEncoder().encode(JSON.stringify(obj)));
  const signingInput = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(claims)}`;
  const key = await importPrivateKey(sa.private_key);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput)
  );
  return `${signingInput}.${base64url(new Uint8Array(sig))}`;
}

async function importPrivateKey(pem) {
  const body = pem
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

function base64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
