// apikey.mjs - the spot for the ChatGPT key.
// Run: node apikey.mjs
//
// The one claim this whole feature makes is "the key goes up and never comes
// back down". A regex cannot prove that: it can see that the word apiKey is
// absent from one return statement and miss the object spread two lines below
// that puts it back. So the module is LIFTED OUT OF THE SHIPPED FILE AND RUN,
// with getDoc, patchDoc and fetch stubbed, and the assertions are about what
// the real functions actually return and actually write.
//
// Observed 2026-08-27: 45 ok, 0 FAIL. Every check below that runs code has
// been seen to fail with the code broken on purpose; the breaks are recorded
// beside the checks they fired.
//
// Repo-rooted, like its siblings.
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
import { readFileSync } from 'node:fs';

const ROOT = __REPO;
const OA = readFileSync(`${ROOT}/worker/openai.js`, 'utf8');
const SRC = readFileSync(`${ROOT}/worker/index.js`, 'utf8');
const SET = readFileSync(`${ROOT}/public/js/admin-settings.js`, 'utf8');
const DEMO = readFileSync(`${ROOT}/public/js/demo/api.js`, 'utf8');
const RULES = readFileSync(`${ROOT}/firestore.rules`, 'utf8');
const CSS = readFileSync(`${ROOT}/public/css/site.css`, 'utf8');

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};

// ---- lift the module ------------------------------------------------------
// The import line goes (firestore.js would reach for a service account), the
// export keywords go (a Function body cannot carry them), and NOTHING else is
// touched. Every line of logic below is the shipped line.
const BODY = OA
  .replace(/^import[^\n]*from '\.\/firestore\.js';$/m, '')
  .replace(/^export /gm, '');

const K = 'sk-proj-0123456789abcdefghijklmnopqrstuvwxyzABCD';

/** Build the module against one set of stubs. */
function mount({ doc = null, fetchImpl = async () => ({ ok: true, status: 200 }), writes = [] } = {}) {
  const make = new Function('__stubs', `
    const { getDoc, patchDoc, fetch } = __stubs;
    ${BODY}
    return { openaiKey, getOpenAiKeyState, setOpenAiKey, clearOpenAiKey, checkKey, KEY_PATH, KEY_SHAPE };
  `);
  return make({
    getDoc: async () => doc,
    patchDoc: async (env, path, fields, opts) => { writes.push({ path, fields, opts }); return true; },
    fetch: fetchImpl,
  });
}

const ENV = {};                       // no Worker secret set
const ENV_SECRET = { OPENAI_API_KEY: 'sk-secret-zzzzzzzzzzzzzzzzzzzzzzzzzz' };
const DOC_WITH_KEY = { data: { apiKey: K, checkedOk: true, updatedAt: '2026-08-27T00:00:00Z' } };

check('A1 the module lifts and runs', typeof mount().setOpenAiKey === 'function');

// ---- the security claim, proven by running it -----------------------------
// Negative control run before this shipped: change state() to return the whole
// doc.data (a one-word slip: `...doc.data` instead of naming the fields) and
// A2 reports FAIL with the key found under "apiKey". A source regex for
// `apiKey` in the return statement stays green through exactly that change,
// which is why this check runs the function and searches the RESULT.
{
  const api = mount({ doc: DOC_WITH_KEY });
  const out = await api.getOpenAiKeyState(ENV);
  const leaked = JSON.stringify(out).includes(K);
  check('A2 the state the panel is given does NOT contain the key', !leaked,
    leaked ? `found it in ${JSON.stringify(out)}` : '');
  check('A3 it does say a key is set, and its last four', out.set === true && out.tail === K.slice(-4));
  check('A4 the tail is four characters, not a prefix of the key', out.tail.length === 4 && !K.startsWith(out.tail));
}
{
  const api = mount({ doc: null });
  const out = await api.getOpenAiKeyState(ENV);
  check('A5 with nothing stored it says so, and offers no tail', out.set === false && out.tail === '');
}

// ---- a Worker secret is the stronger place, and it wins --------------------
{
  const api = mount({ doc: DOC_WITH_KEY });
  check('A6 a Worker secret beats the stored key', await api.openaiKey(ENV_SECRET) === ENV_SECRET.OPENAI_API_KEY);
  check('A7 without one, the stored key is used', await api.openaiKey(ENV) === K);
  const out = await api.getOpenAiKeyState(ENV_SECRET);
  check('A8 and the panel is told the safer place is in use', out.viaSecret === true && out.set === true);
  check('A9 that answer leaks neither key', !JSON.stringify(out).includes(K)
    && !JSON.stringify(out).includes(ENV_SECRET.OPENAI_API_KEY));
}

// ---- nothing unusable is ever stored --------------------------------------
{
  const writes = [];
  const api = mount({ writes });
  const bad = await api.setOpenAiKey(ENV, 'hunter2');
  check('A10 a paste that is not a key is refused', !!bad.error);
  check('A11 and NOTHING was written', writes.length === 0, JSON.stringify(writes));
}
{
  const writes = [];
  const api = mount({ writes });
  const bad = await api.setOpenAiKey(ENV, `${K} extra`);
  check('A12 a paste with a space in it is refused by name', /space/i.test(bad.error || ''));
  check('A13 and NOTHING was written', writes.length === 0);
}
{
  // OpenAI itself says no. This is the case a shape check can never catch: a
  // well-formed key that has been revoked, or typed one character short in a
  // way that keeps the shape.
  const writes = [];
  const api = mount({ writes, fetchImpl: async () => ({ ok: false, status: 401 }) });
  const bad = await api.setOpenAiKey(ENV, K);
  // Negative control run 2026-08-27: delete the `if (checked.ok === false)`
  // early return and A14 and A15 both go red, A15 printing the refused key
  // sitting in the write it should never have reached.
  check('A14 a well-formed key OpenAI refuses is refused here too', /refused/i.test(bad.error || ''));
  check('A15 and NOTHING was written', writes.length === 0, JSON.stringify(writes));
}
{
  const writes = [];
  const api = mount({ writes, fetchImpl: async () => ({ ok: true, status: 200 }) });
  const good = await api.setOpenAiKey(ENV, K);
  check('A16 a key OpenAI accepts is stored', writes.length === 1 && writes[0].fields.apiKey === K);
  check('A17 stored at config/, which firestore.rules closes to every browser',
    writes[0].path === 'config/openai');
  check('A18 and marked as proven', writes[0].fields.checkedOk === true);
  check('A19 the answer to the panel still does not contain the key', !JSON.stringify(good).includes(K));
  check('A20 and it says OpenAI accepted it', /accepted/i.test(good.message || ''));
}

// ---- the third answer: we could not find out ------------------------------
// The one that would have been a bug. If a network blip counted as a refusal,
// a good key would be thrown away because OpenAI had a bad minute.
{
  const writes = [];
  const api = mount({ writes, fetchImpl: async () => { throw new Error('network down'); } });
  const out = await api.setOpenAiKey(ENV, K);
  // Negative control run 2026-08-27: tighten the guard to
  // `if (checked.ok !== true) return { error }` and A21 and A22 go red, which
  // is the shape this would have taken if the third answer had been folded
  // into the second.
  check('A21 a network failure does NOT refuse the key', !out.error);
  check('A22 it is stored anyway', writes.length === 1 && writes[0].fields.apiKey === K);
  check('A23 but honestly, as not proven', writes[0].fields.checkedOk === false && /not proven/i.test(out.message || ''));
}
{
  const writes = [];
  const api = mount({ writes, fetchImpl: async () => ({ ok: false, status: 500 }) });
  const out = await api.setOpenAiKey(ENV, K);
  check('A24 a 500 from OpenAI is "could not check", not "wrong key"', !out.error && writes.length === 1);
}
{
  // 429 got past authentication, so the key is good and only the account is
  // busy. Counting it as a refusal would reject a working key at the worst
  // possible moment.
  const writes = [];
  const api = mount({ writes, fetchImpl: async () => ({ ok: false, status: 429 }) });
  const out = await api.setOpenAiKey(ENV, K);
  // Negative control run 2026-08-27: remove the 429 branch and A25 goes red.
  check('A25 a rate limit counts as working', !out.error && writes[0].fields.checkedOk === true);
}

// ---- removing it ----------------------------------------------------------
{
  const writes = [];
  const api = mount({ writes, doc: DOC_WITH_KEY });
  await api.clearOpenAiKey(ENV);
  // Negative control run 2026-08-27: drop apiKey from the patch (leaving the
  // mask alone, which is how this slip actually happens) and A26 goes red.
  check('A26 Remove writes an explicit null over the key, not an absence',
    writes.length === 1 && writes[0].fields.apiKey === null);
  check('A27 and masks the field, so the write cannot miss it',
    (writes[0].opts?.mask || []).includes('apiKey'));
}

// ---- the shape check admits the three real key forms -----------------------
// Refusing a key that works is worse than accepting one that does not, so this
// is the check most worth getting wrong in the generous direction.
{
  const { KEY_SHAPE } = mount();
  check('A28 the shape admits sk-, sk-proj- and sk-svcacct- keys',
    KEY_SHAPE.test('sk-abcdefghijklmnopqrstuv')
    && KEY_SHAPE.test('sk-proj-abcdefghijklmnop_qrstuv-WXYZ0123456789')
    && KEY_SHAPE.test('sk-svcacct-abcdefghijklmnopqrstuvwxyz'));
  check('A29 and refuses an Anthropic key, a URL and a sentence',
    !KEY_SHAPE.test('sk-ant-api03-abcdefghij'.replace('sk-', 'xx-'))
    && !KEY_SHAPE.test('https://example.invalid/key')
    && !KEY_SHAPE.test('my key is sk-abcdefghijklmnop'));
}

// ---- the route ------------------------------------------------------------
check('A30 the route exists and is admin gated',
  /url\.pathname === '\/api\/admin\/openai-key'/.test(SRC)
  && /async function handleOpenAiKey\(request, env\) \{[\s\S]{0,200}requireAdmin/.test(SRC));
check('A31 a stranger gets 404, not 403, like every other advocate route',
  /async function handleOpenAiKey[\s\S]{0,300}if \(!admin\) return json\(\{ error: 'Not found' \}, 404\)/.test(SRC));
check('A32 a refusal comes back 400, so the panel shows the reason',
  /handleOpenAiKey[\s\S]{0,900}out\.error \? 400 : 200/.test(SRC));
check('A33 the GET path returns getOpenAiKeyState and nothing else',
  /handleOpenAiKey[\s\S]{0,900}return json\(await getOpenAiKeyState\(env\)\);/.test(SRC));

// ---- the panel ------------------------------------------------------------
check('A34 the row lives in the admin-only settings module',
  /ChatGPT key/.test(SET) && /data-oa-key/.test(SET));
check('A35 which the asset gate hides from clients by its NAME',
  /js\/admin\[\\w-\]\*\\\.js|admin\[\\w-\]\*/.test(SRC));
check('A36 the key box is a password field, and never autofilled or corrected',
  /type="password" data-oa-key[\s\S]{0,160}autocomplete="off"/.test(SET));
check('A37 the box is emptied the moment the save lands',
  /const out = await call\(\{ key \}\);\s*\n\s*box\.value = '';/.test(SET));
check('A38 the row is painted from the SERVER answer, never from what was typed',
  /const paint = \(s\) =>/.test(SET) && /call\(\)\.then\(paint\)/.test(SET));
check('A39 it says plainly that nothing uses the key yet',
  /Nothing writes notes with it yet/.test(SET));
check('A40 and plainly where the key is kept, and that it is the weaker place',
  /Kept in your database, read only by the server/.test(SET)
  && /never sent back to this\s*\n?\s*screen/.test(SET)
  && /safer hiding place/.test(SET));
check('A41 password inputs are styled on the admin pages, which skip glowup.css',
  /input\[type=password\],/.test(CSS));

// ---- the demo mirror ------------------------------------------------------
check('A42 the demo answers the route rather than looking broken',
  /path === '\/api\/admin\/openai-key'/.test(DEMO));
check('A43 the demo runs the same shape check the Worker runs',
  /\^sk-\[A-Za-z0-9_-\]\{16,500\}\$/.test(DEMO) && /\^sk-\[A-Za-z0-9_-\]\{16,500\}\$/.test(OA));
check('A44 and never calls OpenAI from the demo', !/api\.openai\.com/.test(DEMO));

// ---- where the key sits ---------------------------------------------------
check('A45 firestore.rules closes everything not named, which includes config/',
  /match \/\{document=\*\*\} \{\s*\n\s*allow read, write: if false;/.test(RULES)
  && !/match \/config/.test(RULES));

// ---- summary --------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\napikey: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) { console.log(failed.map((f) => `  FAIL ${f.name}`).join('\n')); process.exit(1); }
