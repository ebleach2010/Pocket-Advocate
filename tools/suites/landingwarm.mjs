// landingwarm.mjs - the warm look on the public pages, and its switch.
//
// Eric, 2026-10-15: "try adding the same warm style from the preview suite to
// the landing page. Something I can easily undo." public/css/landing-warm.css
// is linked from no page; the Worker lays it over landing.css (the home and
// the three package pages) while his switch is on, and the switch is a row in
// his settings, so undoing it is one tap and no deploy.
//
// Run: node landingwarm.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath as f2 } from 'node:url';
import { dirname as d, join as j } from 'node:path';

const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const W = f('worker/index.js');
const CSS = f('public/css/landing-warm.css');
const DASH = new RegExp('[\\u2013\\u2014]');
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
function lift(src, decl) {
  const start = src.indexOf(decl);
  if (start < 0) return '';
  let depth = 0;
  for (let i = src.indexOf('{', start + decl.length - 1); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}

console.log('\n--- A. the switch ---');
{
  const docs = new Map();
  const writes = [];
  let admin = true;
  const make = new Function('requireAdmin', 'json', 'getDoc', 'patchDoc', `
    const LOOK_PATH = 'config/look';
    let lookCache = { at: 0, warm: true };
    ${lift(W, 'async function handleLook(request, env) {')}
    return handleLook;`);
  const handleLook = make(
    async () => (admin ? { uid: 'eric' } : null),
    (o, s = 200) => ({ s, o }),
    async (env, p) => (docs.has(p) ? { data: docs.get(p) } : null),
    async (env, p, data, opts) => { writes.push({ p, data, opts }); docs.set(p, { ...(docs.get(p) || {}), ...data }); return true; },
  );
  const req = (method, body) => ({ method, json: async () => body });
  const first = await handleLook(req('GET'), {});
  const off = await handleLook(req('POST', { landingWarm: false }), {});
  const read = await handleLook(req('GET'), {});
  const junk = await handleLook(req('POST', { landingWarm: 'no' }), {});
  admin = false;
  const stranger = await handleLook(req('POST', { landingWarm: true }), {});
  // NEGATIVE CONTROL (run 2026-10-15): handleLook asking nobody (`requireAdmin` call taken out, admin always true) made this read
  //   FAIL  A1 the switch is his alone: on until he turns it off, off reads back off, anything but on or off is refused, and anyone else gets the 404
  check('A1 the switch is his alone: on until he turns it off, off reads back off, anything but on or off is refused, and anyone else gets the 404',
    first.o.landingWarm === true && off.o.landingWarm === false && read.o.landingWarm === false && junk.s === 400
    && stranger.s === 404 && writes.length === 1 && JSON.stringify(writes[0].opts.mask) === '["landingWarm","setAt"]',
    JSON.stringify({ first, off, read, junk, stranger: stranger.s, writes: writes.length }));
  // His row: asked first, painted from the answer, then live.
  const SET = f('public/js/admin-settings.js');
  // NEGATIVE CONTROL (run 2026-10-15): the row's switch rendered without `disabled` made this read
  //   FAIL  A2 his settings carry the Warm public pages row, disabled until the server has said, posting to the switch
  check('A2 his settings carry the Warm public pages row, disabled until the server has said, posting to the switch',
    /<button class="switch" data-look-warm aria-pressed="false" aria-label="Warm public pages" disabled><\/button>/.test(SET)
    && /wireLook\(overlay, user\);/.test(SET) && /fetch\('\/api\/admin\/look', \{/.test(SET)
    && /if \(url\.pathname === '\/api\/admin\/look'\)\n\s+return await handleLook\(request, env\);/.test(W));
}

console.log('\n--- B. the pages ---');
{
  // The cached read, run: unset is on, his off is off, an unreadable switch keeps its last word, and it is asked again after a minute.
  let now = 1_000_000;
  let answer;
  let asked = 0;
  const realNow = Date.now;
  Date.now = () => now;
  const on = new Function('getDoc', `
    const LOOK_PATH = 'config/look';
    const LOOK_TTL_MS = 60_000;
    let lookCache = { at: 0, warm: true };
    ${lift(W, 'async function landingWarmOn(env) {')}
    return landingWarmOn;`)(async () => { asked++; if (answer === 'fail') throw new Error('down'); return answer; });
  answer = null; const unset = await on({});
  now += 61_000; answer = { data: { landingWarm: false } }; const turnedOff = await on({});
  now += 10_000; answer = { data: { landingWarm: true } }; const cached = await on({});
  now += 61_000; const backOn = await on({});
  now += 61_000; answer = 'fail'; const unreadable = await on({});
  Date.now = realNow;
  // NEGATIVE CONTROL (run 2026-10-15): landingWarmOn reading an unreadable switch as off made this read
  //   FAIL  B1 the switch is read once a minute: unset is on, off is off, and a switch that cannot be read keeps its last word
  check('B1 the switch is read once a minute: unset is on, off is off, and a switch that cannot be read keeps its last word',
    unset === true && turnedOff === false && cached === false && backOn === true && unreadable === true && asked === 4,
    JSON.stringify({ unset, turnedOff, cached, backOn, unreadable, asked }));
  const warm = lift(W, 'async function warmLook(env, res) {');
  // NEGATIVE CONTROL (run 2026-10-15): the rewrite keyed on every stylesheet (`link[rel="stylesheet"]`) made this read
  //   FAIL  B2 only a page that wears landing.css gets the warm sheet, right after it, and only an HTML page that answered
  check('B2 only a page that wears landing.css gets the warm sheet, right after it, and only an HTML page that answered',
    /if \(!res\.ok \|\| !\/\^text\\\/html\/i\.test\(res\.headers\.get\('content-type'\) \|\| ''\)\) return res;/.test(warm)
    && /if \(!\(await landingWarmOn\(env\)\.catch\(\(\) => false\)\)\) return res;/.test(warm)
    // RE-PINNED 2026-10-16 (v7.57): the sheet's address carries ?v=2, since it now stands down for Blue and purple.
    // NEGATIVE CONTROL (run 2026-10-16, v7.57): the rewrite keyed on every stylesheet again made B2 read FAIL.
    // RE-PINNED 2026-10-17 (v7.64): ?v=3, since the sheet now ends in the color wheel's block.
    // NEGATIVE CONTROL (run 2026-10-17, v7.64): the address put back to ?v=2 made B2 read FAIL.
    // RE-PINNED 2026-10-17 (v7.66): ?v=4, since the wheel's block is gone and the raised buttons' plum fill is in.
    // NEGATIVE CONTROL (run 2026-10-17, v7.66): the address put back to ?v=3 made B2 read FAIL.
    && /\.on\('link\[rel="stylesheet"\]\[href\^="\/css\/landing\.css"\]', \{\n\s+element\(el\) \{ el\.after\('<link rel="stylesheet" href="\/css\/landing-warm\.css\?v=4">', \{ html: true \}\); \},/.test(warm)
    && /return warmLook\(env, await env\.ASSETS\.fetch\(request\)\);\n  \},/.test(W),
    warm.slice(0, 200));
  const pages = readdirSync(j(ROOT, 'public')).filter((n) => n.endsWith('.html'));
  const linked = pages.filter((n) => /landing-warm\.css/.test(f(`public/${n}`)));
  const wearers = pages.filter((n) => /href="\/css\/landing\.css/.test(f(`public/${n}`))).sort();
  // RE-PINNED 2026-10-17 (v7.64): judged on the sheet as written by hand; the color wheel's block at its end is
  // generated from these rules behind the same guard, and hue.mjs checks it.
  // NEGATIVE CONTROL (run 2026-10-17, v7.64): `body.landing .opt { background: red; }` put just above the wheel's block
  // made B3 read FAIL.
  // RE-PINNED 2026-10-17 (v7.66): the wheel is gone, so the whole sheet is judged again.
  // NEGATIVE CONTROL (run 2026-10-17, v7.66): `body.landing .opt { background: red; }` added to the end of the sheet
  // made B3 read FAIL.
  const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.trim()).filter((r) => r && !r.startsWith('@keyframes') && !/^\d|^to|^from|^0%|^50%/.test(r));
  // A selector list split on its own commas, not the ones inside :is( ).
  const top = (sel) => { const out = []; let depth = 0; let cur = ''; for (const ch of sel) { if (ch === '(') depth++; if (ch === ')') depth--; if (ch === ',' && !depth) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; };
  const unguarded = rules.map((r) => r.split('{')[0].trim()).filter((sel) => sel && !/^(0%|50%|@keyframes)/.test(sel) && top(sel).some((x) => x.trim() && !x.trim().startsWith(':root:not([data-scheme="contrast"])')));
  // NEGATIVE CONTROL (run 2026-10-15): a `body.landing .opt { background: red; }` rule added without the guard made this read
  //   FAIL  B3 the warm sheet is linked from no page, reaches exactly the four that wear landing.css, leaves High contrast alone, and is the client side's warm
  check('B3 the warm sheet is linked from no page, reaches exactly the four that wear landing.css, leaves High contrast alone, and is the client side\'s warm',
    !linked.length && wearers.join() === 'advocacy-case.html,full-service.html,index.html,priority-chat.html'
    && !unguarded.length && /--bg: #1E1519;/.test(CSS) && /--cyan: #FFB27A;/.test(CSS)
    && /--warm-pop: linear-gradient\(110deg, #FFC48A 0%, #FF9E7D 50%, #F59BBF 100%\);/.test(CSS)
    && !DASH.test(CSS),
    JSON.stringify({ linked, wearers, unguarded: unguarded.slice(0, 3) }));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
