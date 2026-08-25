// stripe-params.mjs — every Checkout Session this Worker creates, checked
// against what Stripe will actually accept.
//
// WHY THIS EXISTS. pricing.mjs has 54 checks and calls exactly one Worker
// function; the rest are regexes over the source. So when two new routes -
// the Hands-Off approval and "another month", the only two that turn the tier
// into money - were written with `automatic_payment_methods` (a PaymentIntent
// parameter Checkout Sessions reject) and a 7-day `expires_at` (max is 24h),
// every suite stayed green while both routes would answer 500. A regex cannot
// see a parameter that should not be there.
//
// This parses the real call sites and judges the object, so a new route is
// checked the day it is written rather than the day a client cannot pay.
import { readFileSync } from 'node:fs';
import { fileURLToPath as f } from 'node:url';
import { dirname as d, join as j } from 'node:path';
const ROOT = j(d(f(import.meta.url)), '..', '..');
const SRC = readFileSync(j(ROOT, 'worker/index.js'), 'utf8');

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};

// Stripe's parameter list for POST /v1/checkout/sessions, restricted to the
// ones this Worker has any business sending. Anything outside it is refused
// by Stripe with a 400, which `stripePost` turns into a throw and the router
// into a 500.
const ALLOWED = new Set([
  'mode', 'customer', 'customer_email', 'customer_creation', 'client_reference_id',
  'line_items', 'success_url', 'cancel_url', 'return_url', 'expires_at',
  'metadata', 'payment_intent_data', 'subscription_data', 'allow_promotion_codes',
  'billing_address_collection', 'automatic_tax', 'currency', 'locale',
  'payment_method_types', 'phone_number_collection', 'ui_mode', 'consent_collection',
  'custom_text', 'invoice_creation', 'after_expiration', 'submit_type', 'discounts',
  'saved_payment_method_options', 'payment_method_collection',
]);
// Named because it is the exact mistake that shipped, so the failure reads as
// itself rather than as "unknown key".
const KNOWN_WRONG = {
  automatic_payment_methods: 'a PaymentIntent/SetupIntent parameter; Checkout Sessions reject it',
  payment_method_options_: 'typo',
};

/** Pull the top-level keys of each object literal passed to /checkout/sessions. */
function callSites() {
  const out = [];
  const needle = "stripePost(env, '/checkout/sessions', {";
  let i = SRC.indexOf(needle);
  while (i >= 0) {
    const open = SRC.indexOf('{', i + needle.length - 1);
    let depth = 0, end = -1;
    for (let k = open; k < SRC.length; k++) {
      const ch = SRC[k];
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (!depth) { end = k; break; } }
    }
    const body = SRC.slice(open + 1, end);
    // Top-level keys only. Judged by the depth at the START of each line: a
    // first pass counted the braces first, so `metadata: {` was already at
    // depth 1 by the time the key was tested and four routes were wrongly
    // reported as having no metadata at all.
    const keys = [];
    let dep = 0;
    for (const line of body.split('\n')) {
      if (dep === 0) {
        const m = line.match(/^\s*([a-z_][\w]*)\s*:/i);
        if (m) keys.push(m[1]);
      }
      for (const ch of line) {
        if ('{[('.includes(ch)) dep++;
        else if ('}])'.includes(ch)) dep--;
      }
    }
    out.push({ line: SRC.slice(0, i).split('\n').length, keys });
    i = SRC.indexOf(needle, end);
  }
  return out;
}

const sites = callSites();
console.log(`\nfound ${sites.length} Checkout Session call sites\n`);
check('S1 every checkout route was found', sites.length >= 7, String(sites.length));

for (const s of sites) {
  const bad = s.keys.filter((k) => !ALLOWED.has(k));
  check(`S2 line ${s.line}: no parameter Stripe would refuse`,
    bad.length === 0,
    bad.map((k) => `${k}${KNOWN_WRONG[k] ? ` (${KNOWN_WRONG[k]})` : ''}`).join(', '));
  check(`S3 line ${s.line}: says where to send them back`,
    s.keys.includes('success_url') && (s.keys.includes('cancel_url') || s.keys.includes('return_url')));
  check(`S4 line ${s.line}: carries metadata, so the webhook knows what was bought`,
    s.keys.includes('metadata'));
}

// expires_at: Stripe allows 30 minutes to 24 hours from creation. Read the
// real expressions rather than trusting that they look sensible.
const spans = [...SRC.matchAll(/const expiresAt = new Date\(Date\.now\(\) \+ ([^)]+)\);/g)]
  .map((m) => ({ expr: m[1].trim(), line: SRC.slice(0, m.index).split('\n').length }));
for (const s of spans) {
  // Strip only NUMERIC separators (1_000), never underscores inside a name -
  // a first pass turned DEVICE_TOKEN_TTL_DAYS into an undefined identifier and
  // took the whole suite down with it.
  const expr = s.expr.replace(/(\d)_(?=\d)/g, '$1');
  let ms = null;
  try {
    // eslint-disable-next-line no-new-func
    ms = Function(`"use strict";const HOLD_MINUTES=30;const DEVICE_TOKEN_TTL_DAYS=30;return ${expr}`)();
  } catch (err) {
    // A shape this cannot read is a FAILURE, never a quiet skip. Swallowing
    // it is how three real bugs stayed hidden today.
    check(`S5 line ${s.line}: the expiry expression could be read`, false, `${expr} -- ${err.message}`);
    continue;
  }
  const hours = ms / 3600000;
  // The device-token one is not a checkout expiry; it is allowed to be long.
  const isCheckout = /expiresAt/.test(SRC.slice(SRC.indexOf(s.expr), SRC.indexOf(s.expr) + 2500))
    && SRC.slice(SRC.indexOf(s.expr)).slice(0, 2500).includes('/checkout/sessions');
  if (!isCheckout) continue;
  check(`S5 line ${s.line}: expiry is inside Stripe's 24 hour ceiling`,
    hours > 0.5 && hours <= 24, `${hours}h from ${s.expr}`);
}

// And the one that shipped, named outright so it cannot come back quietly.
check('S6 automatic_payment_methods appears nowhere near a Checkout Session',
  !/automatic_payment_methods/.test(SRC));
check('S7 no checkout expiry is measured in days',
  !/expiresAt = new Date\(Date\.now\(\) \+ \d+ \* 24 \* 3600_000\)/.test(SRC));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const f2 of failed) console.log(`  FAILED: ${f2.name}`); process.exit(1); }
