// The ChatGPT key, and nothing else.
//
// Eric asked for "a spot for a ChatGPT API token to take over the SOAPS
// creation". This file is the spot. It stores the key, proves the key works
// before storing it, and reports on it without ever handing it back.
//
// WHY THE KEY LIVES IN THE DATABASE, WHICH IS THE WEAKER PLACE.
// The strong place for a secret is a Worker secret (`wrangler secret put
// OPENAI_API_KEY`): it never touches Firestore and nothing but the running
// Worker can read it. Eric runs this business from a phone and cannot run
// wrangler, so a secret he cannot set is a secret he does not have. The key
// therefore lives at config/openai, which the catch-all rule in
// firestore.rules (`match /{document=**} { allow read, write: if false }`)
// closes to every browser, his own included: only the Worker's service
// account reads it. That is weaker than a Worker secret and stronger than
// anything he can otherwise do from a phone, and it is written down here
// rather than glossed over.
//
// A Worker secret still wins if one is ever set: OPENAI_API_KEY in the
// environment is preferred over the stored key by openaiKey() below, so
// moving to the strong place later costs one `wrangler secret put` and no
// code change.
//
// It is never served back. The panel is told whether a key is set and what
// its last four characters are, which is enough to tell one key from another
// and not enough to spend anybody's money.

import { getDoc, patchDoc } from './firestore.js';

const KEY_PATH = 'config/openai';

// Every OpenAI key begins sk-, including the project (sk-proj-) and service
// account (sk-svcacct-) forms, so this admits all three and refuses a paste
// that is plainly something else (an Anthropic key, a URL, a password).
// Deliberately loose: refusing a key that works would be worse than accepting
// one that does not, and the live check below is what actually decides.
const KEY_SHAPE = /^sk-[A-Za-z0-9_-]{16,500}$/;

// One cheap authenticated call. It lists models, changes nothing, and costs
// nothing, so it is safe to run on every save.
const CHECK_URL = 'https://api.openai.com/v1/models';
const CHECK_TIMEOUT_MS = 8000;

/**
 * What the panel is allowed to know. Note what is NOT here: the key.
 */
function state(doc) {
  const key = typeof doc?.data?.apiKey === 'string' ? doc.data.apiKey : '';
  return {
    set: key.length > 0,
    tail: key ? key.slice(-4) : '',
    updatedAt: doc?.data?.updatedAt || null,
    checked: doc?.data?.checkedOk === true,
  };
}

/**
 * The key to use, or ''. A Worker secret wins over the stored one, so this
 * keeps working unchanged the day the key moves to the strong place.
 * Never throws, never logs the key.
 */
export async function openaiKey(env) {
  if (typeof env.OPENAI_API_KEY === 'string' && env.OPENAI_API_KEY) return env.OPENAI_API_KEY;
  const doc = await getDoc(env, KEY_PATH).catch(() => null);
  const key = doc?.data?.apiKey;
  return typeof key === 'string' ? key : '';
}

/**
 * Ask OpenAI whether it will accept this key.
 *
 * Three answers, not two, and the third is the one that matters: a refusal
 * from OpenAI means the key is wrong and must not be stored, but a network
 * failure or a 500 means WE could not find out, and throwing away a good key
 * because OpenAI had a bad minute would be its own bug. So 401 and 403 are
 * the only refusals; everything else that is not a clean 200 is "unknown",
 * which stores the key and says so.
 */
async function checkKey(key) {
  let res;
  try {
    res = await fetch(CHECK_URL, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: null, why: `Could not reach OpenAI to check it (${err.message || 'no answer'}).` };
  }
  if (res.ok) return { ok: true, why: '' };
  if (res.status === 401 || res.status === 403) {
    return { ok: false, why: 'OpenAI refused that key. Check you copied all of it.' };
  }
  if (res.status === 429) {
    // Throttled, but it got past authentication, so the key itself is good.
    return { ok: true, why: '' };
  }
  return { ok: null, why: `OpenAI answered ${res.status} when asked to check it.` };
}

/** Read the state, for the settings panel. */
export async function getOpenAiKeyState(env) {
  const doc = await getDoc(env, KEY_PATH).catch(() => null);
  const out = state(doc);
  // A Worker secret is invisible to the panel otherwise, and "no key" would
  // be a lie in the one case where the key is in the safer place.
  if (typeof env.OPENAI_API_KEY === 'string' && env.OPENAI_API_KEY) {
    return { set: true, tail: env.OPENAI_API_KEY.slice(-4), updatedAt: null, checked: true, viaSecret: true };
  }
  return { ...out, viaSecret: false };
}

/** Forget it. */
export async function clearOpenAiKey(env) {
  await patchDoc(env, KEY_PATH, { apiKey: null, checkedOk: null, updatedAt: new Date() },
    { mask: ['apiKey', 'checkedOk', 'updatedAt'] });
  return { ...(await getOpenAiKeyState(env)), message: 'Key removed.' };
}

/**
 * Store a key, after asking OpenAI whether it works.
 * Returns { error } on a refusal, so nothing unusable is ever saved.
 */
export async function setOpenAiKey(env, raw) {
  const key = typeof raw === 'string' ? raw.trim() : '';
  if (!key) return { error: 'Paste a key first.' };
  if (/\s/.test(key)) return { error: 'That has a space in it, so something got cut off in the copy.' };
  if (!KEY_SHAPE.test(key)) return { error: 'An OpenAI key starts with sk- and is one long line. That does not look like one.' };

  const checked = await checkKey(key);
  if (checked.ok === false) return { error: checked.why };

  await patchDoc(env, KEY_PATH, { apiKey: key, checkedOk: checked.ok === true, updatedAt: new Date() },
    { mask: ['apiKey', 'checkedOk', 'updatedAt'] });
  return {
    ...(await getOpenAiKeyState(env)),
    message: checked.ok === true
      ? 'Saved. OpenAI accepted it.'
      : `Saved, but not proven. ${checked.why}`,
  };
}
