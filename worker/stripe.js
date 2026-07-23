// Stripe over plain fetch — no SDK needed on Workers. Card data never touches
// this app; we only create Checkout Sessions and verify webhook signatures.

const API = 'https://api.stripe.com/v1';

export async function stripePost(env, path, params) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: encodeForm(params),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`stripe ${path}: ${data.error ? data.error.message : res.status}`);
  return data;
}

/** Flattens nested objects/arrays into Stripe's bracketed form encoding. */
function encodeForm(params) {
  const pairs = [];
  const walk = (prefix, value) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(`${prefix}[${i}]`, v));
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) walk(prefix ? `${prefix}[${k}]` : k, v);
    } else {
      pairs.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(value)}`);
    }
  };
  walk('', params);
  return pairs.join('&');
}

/**
 * Verifies a Stripe webhook signature (v1 scheme, 5-minute tolerance).
 * Returns the parsed event, or null if the signature is invalid.
 */
export async function verifyWebhook(payload, sigHeader, secret) {
  if (!sigHeader) return null;
  const parts = Object.fromEntries(
    sigHeader.split(',').map((kv) => {
      const i = kv.indexOf('=');
      return [kv.slice(0, i), kv.slice(i + 1)];
    })
  );
  const timestamp = Number(parts.t);
  if (!timestamp || Math.abs(Date.now() / 1000 - timestamp) > 300) return null;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${parts.t}.${payload}`)
  );
  const expected = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');

  const given = sigHeader
    .split(',')
    .filter((kv) => kv.startsWith('v1='))
    .map((kv) => kv.slice(3));
  if (!given.some((sig) => timingSafeEqual(sig, expected))) return null;
  return JSON.parse(payload);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
