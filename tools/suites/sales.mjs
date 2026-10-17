// sales.mjs - sales closed everywhere, behind one switch.
//
// Eric, 2026-10-12: "Remove free call. Stop sales everywhere. There are no
// chat subscribers. /open means open up all packages, remove the banner
// saying I'm sick. But leave the waitlist button for if my schedule is
// blocked off."
//
// The gate is the router line that refuses every purchase route while
// SALES_OPEN is false. It is lifted out of worker/index.js and RUN against
// the live host, a preview host, and routes that are not sales. The free
// call's retirement is pinned in fitcall.mjs (F3, F8 to F10).
//
// Run: node sales.mjs
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
import { readFileSync } from 'node:fs';

const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
const SRC = readFileSync(__j(__REPO, 'worker/index.js'), 'utf8');
const f = (p) => readFileSync(__j(__REPO, p), 'utf8');
const DASH = /[\u2013\u2014]/;

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
function konst(name) {
  const m = SRC.match(new RegExp(`\\nconst ${name} = [\\s\\S]*?;\\n`));
  if (!m) throw new Error(`could not lift const ${name}`);
  return m[0];
}
function sfn(name) {
  const m = SRC.match(new RegExp(`\\nfunction ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`could not lift ${name}`);
  return m[0];
}

const sales = await import('../../public/js/sales.js');
// RE-PINNED 2026-10-14 (v7.36): the gate runs over two lines now, so it is lifted through its return.
// RE-PINNED 2026-10-17 (v7.72): Eric, "My services are off. How do I toggle them back on in app?" One switch per service, kept
// in config/sales and read by the gate on every purchase. The gate is lifted with salesShut and the route Map, and run with
// readSwitches standing in for his stored switches.
const GATE = (SRC.match(/\n\s+if \(SALES_ROUTES\.has\(url\.pathname\)[\s\S]*?return json\([^\n]*\);\n/) || [''])[0];
const gateFor = (sw) => new Function('SALES_CLOSED_MESSAGE', 'readSwitches',
  `${konst('SALES_ROUTES')}${konst('DEMO_HOST')}${sfn('json')}${sfn('salesShut')}
   const env = {};
   return async (url) => { ${GATE} return null; };`)(sales.SALES_CLOSED_MESSAGE, async () => ({ ...sw }));
const ALL_OFF = { chat: false, case: false, full: false };
const ALL_ON = { chat: true, case: true, full: true };

console.log('\n--- A. the switch and the gate ---');
// NEGATIVE CONTROL (run 2026-10-12): SALES_OPEN set to true made this read
//   FAIL  A1 the switch is off, and the message offers the waitlist in plain words with no dash
// RE-PINNED 2026-10-14 (v7.36): Eric, "Unlock priority chat". Sales stay off; the chat line's switch is on.
// NEGATIVE CONTROL (run 2026-10-14, v7.36): CHAT_OPEN set to false made this read
//   FAIL  A1 sales are off and the chat line is on, and the message offers the waitlist in plain words with no dash
// RE-PINNED 2026-10-17 (v7.71): Eric, "For now, open up all my tier options." Sales are on; the chat line's switch
// stays on; the closed message and the gate stay for the day he turns them off again (A2 runs the gate shut).
// NEGATIVE CONTROL (run 2026-10-17, v7.71): SALES_OPEN set back to false made this read
//   FAIL  A1 sales are on and the chat line is on, and the closed message still offers the waitlist in plain words with no dash
// RE-PINNED 2026-10-17 (v7.72): the two lines are now only what a service is before he has touched its switch; the Worker
// takes the closed message and the switches from sales.js, not the two lines.
// NEGATIVE CONTROL (run 2026-10-17, v7.72): switchesFrom's `typeof d?.[k] === 'boolean'` made `d?.[k] !== undefined` made this read
//   FAIL  A1 untouched, every service is on; the closed message still offers the waitlist in plain words with no dash; the Worker reads the switches, not the two lines
check('A1 untouched, every service is on; the closed message still offers the waitlist in plain words with no dash; the Worker reads the switches, not the two lines',
  sales.SALES_OPEN === true && sales.CHAT_OPEN === true
  && JSON.stringify(sales.switchesFrom(null)) === '{"chat":true,"case":true,"full":true}'
  && JSON.stringify(sales.switchesFrom({ chat: true })) === '{"chat":true,"case":true,"full":true}'
  && JSON.stringify(sales.switchesFrom({ case: false, full: 'no', chat: 1 })) === '{"chat":true,"case":false,"full":true}'
  && /not currently offering/.test(sales.SALES_CLOSED_MESSAGE)
  && /Join the waitlist/.test(sales.SALES_CLOSED_MESSAGE) && !DASH.test(sales.SALES_CLOSED_MESSAGE)
  && /import \{ SALES_CLOSED_MESSAGE, SERVICES, switchesFrom \} from '\.\.\/public\/js\/sales\.js';/.test(SRC)
  && !/\bSALES_OPEN\b|\bCHAT_OPEN\b/.test(SRC.replace(/\/\/[^\n]*/g, '')));

// RE-PINNED 2026-10-14 (v7.36): /api/subscribe moved to its own switch; these are the case's routes.
// RE-PINNED 2026-10-17 (v7.72): every purchase route, the chat line's included, each with the services it sells.
const ROUTES = ['/api/checkout', '/api/chat-unlock', '/api/upgrade', '/api/followup', '/api/extend', '/api/telehealth',
  '/api/extend-request', '/api/addon-request'];
const CASE_ROUTES = ['/api/checkout', '/api/chat-unlock', '/api/followup'];
const FULL_ROUTES = ['/api/upgrade', '/api/extend', '/api/extend-request', '/api/addon-request'];
const at = (r) => new URL(`https://thepocketadvocates.com${r}`);
const refused = async (gate, r) => (await gate(at(r)))?.status === 409;
{
  const gate = gateFor(ALL_OFF);
  const live = [];
  for (const r of ROUTES.concat('/api/subscribe')) {
    const res = await gate(at(r));
    live.push(res && res.status === 409 ? (await res.json()) : null);
  }
  // NEGATIVE CONTROL (run 2026-10-12): '/api/extend' taken out of SALES_ROUTES made this read
  //   FAIL  A2 on the live site every purchase route is refused with a 409 and his message
  // RE-PINNED 2026-10-17 (v7.72): with every switch off.
  // NEGATIVE CONTROL (run 2026-10-17, v7.72): `['/api/extend', ['full']],` taken out of SALES_ROUTES made A2 read FAIL.
  check('A2 on the live site every purchase route is refused with a 409 and his message',
    live.every((o) => o && o.error === sales.SALES_CLOSED_MESSAGE && o.salesClosed === true), JSON.stringify(live));
  const others = [];
  for (const r of ['/api/tip', '/api/review', '/api/waitlist', '/api/portal', '/api/admin/case-charge', '/api/admin/schedule', '/api/sales', '/api/admin/sales', '/api/invite/confirm'])
    others.push(await gate(at(r)));
  // NEGATIVE CONTROL (run 2026-10-12): '/api/waitlist' added to SALES_ROUTES made this read
  //   FAIL  A3 the waitlist, reviews, the billing portal and his own admin charges are not touched
  // RE-PINNED 2026-10-17 (v7.72): nor are the switches' own routes, or an invitation he sent.
  // NEGATIVE CONTROL (run 2026-10-17, v7.72): `['/api/admin/sales', ['case']],` added to SALES_ROUTES made A3 read FAIL.
  check('A3 the waitlist, reviews, the billing portal and his own admin charges are not touched', others.every((r) => r === null));
  // Eric, 2026-10-14: "Unlock priority chat". The chat line answers on its own switch, either way round.
  const chatOnly = gateFor({ chat: true, case: false, full: false });
  const chatOff = gateFor({ chat: false, case: true, full: true });
  // NEGATIVE CONTROL (run 2026-10-14, v7.36): '/api/subscribe' put back into SALES_ROUTES made this read
  //   FAIL  A3b the chat line answers to its own switch: open now with the case shut, refused when its switch is off, and opening the case does not open it
  // RE-PINNED 2026-10-17 (v7.72): run against his switches.
  // NEGATIVE CONTROL (run 2026-10-17, v7.72): `['/api/subscribe', ['chat']]` made `['/api/subscribe', ['case']]` made A3b read FAIL.
  check('A3b the chat line answers to its own switch: open now with the case shut, refused when its switch is off, and opening the case does not open it',
    !(await refused(chatOnly, '/api/subscribe')) && await refused(chatOnly, '/api/checkout')
    && await refused(chatOff, '/api/subscribe') && !(await refused(chatOff, '/api/checkout')));
  // Eric, 2026-10-17: "My services are off. How do I toggle them back on in app?" Each service on its own switch, its add-ons with it.
  const caseOff = gateFor({ chat: true, case: false, full: true });
  const fullOff = gateFor({ chat: true, case: true, full: false });
  const bothOff = gateFor({ chat: true, case: false, full: false });
  const each = async (gate, list) => { const out = []; for (const r of list) out.push(await refused(gate, r)); return out; };
  const c1 = await each(caseOff, CASE_ROUTES); const c2 = await each(caseOff, FULL_ROUTES.concat('/api/telehealth', '/api/subscribe'));
  const f1 = await each(fullOff, FULL_ROUTES); const f2 = await each(fullOff, CASE_ROUTES.concat('/api/telehealth', '/api/subscribe'));
  const tele = await refused(bothOff, '/api/telehealth');
  // NEGATIVE CONTROL (run 2026-10-17, v7.72): `['/api/followup', ['case']]` made `['/api/followup', ['full']]` made this read
  //   FAIL  A3c each service answers to its own switch: the case's routes with the case, Full-Service's with Full-Service, a clinic visit refused only when both are off
  check('A3c each service answers to its own switch: the case\'s routes with the case, Full-Service\'s with Full-Service, a clinic visit refused only when both are off',
    c1.every(Boolean) && c2.every((x) => !x) && f1.every(Boolean) && f2.every((x) => !x) && tele === true,
    JSON.stringify({ c1, c2, f1, f2, tele }));
  const preview = [];
  for (const r of ROUTES) preview.push(await gate(new URL(`http://127.0.0.1:8787${r}`)));
  // NEGATIVE CONTROL (run 2026-10-12): `&& !DEMO_HOST.test(url.hostname)` taken out of the gate made this read
  //   FAIL  A4 a preview or local host is spared, as the maintenance window spares it
  check('A4 a preview or local host is spared, as the maintenance window spares it', preview.every((r) => r === null));
  const open = gateFor(ALL_ON);
  const opened = [];
  for (const r of ROUTES.concat('/api/subscribe')) opened.push(await open(at(r)));
  // NEGATIVE CONTROL (run 2026-10-12): `!SALES_OPEN &&` taken out of the gate made this read
  //   FAIL  A5 with the switch on, nothing is refused: /open is one line
  // RE-PINNED 2026-10-17 (v7.72): with every switch on.
  // NEGATIVE CONTROL (run 2026-10-17, v7.72): salesShut's `!of.some(` made `of.some(` made A5 read FAIL.
  check('A5 with the switch on, nothing is refused: /open is one line', opened.every((r) => r === null));
}
{
  // Above every one of the routes it guards, so no handler can reach Stripe first.
  const gateAt = SRC.indexOf('SALES_ROUTES.has(url.pathname)');
  const firsts = ROUTES.concat('/api/subscribe').map((r) => SRC.indexOf(`url.pathname === '${r}' && request.method`));
  // NEGATIVE CONTROL (run 2026-10-12): the gate moved below the /api/checkout route made this read
  //   FAIL  A6 the gate sits above every route it guards, and each of them is a real route
  check('A6 the gate sits above every route it guards, and each of them is a real route',
    gateAt > 0 && firsts.every((i) => i > gateAt), JSON.stringify({ gateAt, firsts }));
  // Every client-facing handler that opens a Stripe Checkout is behind it.
  const buyers = { handleCheckout: '/api/checkout', handleSubscribe: '/api/subscribe', handleChatUnlock: '/api/chat-unlock',
    handleUpgradeCheckout: '/api/upgrade', handleFollowUpCheckout: '/api/followup', handleExtendCheckout: '/api/extend',
    handleTelehealthRequest: '/api/telehealth' };
  const routed = Object.entries(buyers).every(([h, r]) =>
    new RegExp(`url\\.pathname === '${r.replace(/\//g, '\\/')}' && request\\.method === 'POST'\\)\\s*return await ${h}\\(`).test(SRC));
  // NEGATIVE CONTROL (run 2026-10-12): the /api/extend route pointed at handleFollowUpCheckout made this read
  //   FAIL  A7 every client-facing handler that opens a checkout is one of those routes
  check('A7 every client-facing handler that opens a checkout is one of those routes', routed);
}

console.log('\n--- D. his switches ---');
{
  // readSwitches, lifted with a stand-in store: afresh for the gate, a few seconds old for the pages, and an
  // unreadable store keeps the last answer (or the defaults), never shutting or opening anything by accident.
  const make = (reads) => new Function('switchesFrom', 'getDoc',
    `${konst('SALES_PATH')}${konst('SALES_TTL_MS')}let salesMemo = { at: 0, sw: null };
     ${SRC.match(/\nasync function readSwitches\([\s\S]*?\n\}/)[0]}
     return { readSwitches, setAt: (t) => { salesMemo.at = t; } };`)(sales.switchesFrom, async (env, path) => {
    reads.push(path);
    const next = reads.script.shift();
    if (next === 'throw') throw new Error('down');
    return next;
  });
  const reads = []; reads.script = [{ data: { case: false } }, { data: { case: true, full: false } }, 'throw', 'throw'];
  const r = make(reads);
  const first = await r.readSwitches({});
  const memo = await r.readSwitches({});
  const fresh = await r.readSwitches({}, { fresh: true });
  const down = await r.readSwitches({}, { fresh: true });
  const reads2 = []; reads2.script = ['throw'];
  const cold = await make(reads2).readSwitches({}, { fresh: true });
  // NEGATIVE CONTROL (run 2026-10-17, v7.72): readSwitches' `!fresh &&` taken out made this read
  //   FAIL  D1 the switches come from config/sales: the gate reads afresh, the pages may share a fifteen second answer, and an unreadable store keeps the last answer or the defaults
  check('D1 the switches come from config/sales: the gate reads afresh, the pages may share a fifteen second answer, and an unreadable store keeps the last answer or the defaults',
    /const SALES_PATH = 'config\/sales';/.test(SRC) && /const SALES_TTL_MS = 15_000;/.test(SRC)
    && reads.length === 3 && reads.every((p) => p === 'config/sales')
    && first.case === false && first.full === true && memo === first
    && fresh.case === true && fresh.full === false && down.case === true && down.full === false
    && JSON.stringify(cold) === '{"chat":true,"case":true,"full":true}',
    JSON.stringify({ reads, first, fresh, down, cold }));

  // handleSalesSwitches, lifted: his alone; on or off only; writes just what it names; answers what is stored.
  const writes = [];
  const run = async (who, method, body) => {
    const h = new Function('SERVICES', 'requireAdmin', 'patchDoc', 'readSwitches', 'json',
      `${konst('SALES_PATH')}${SRC.match(/\nasync function handleSalesSwitches\([\s\S]*?\n\}/)[0]} return handleSalesSwitches;`)(
      sales.SERVICES, async () => (who === 'admin' ? { uid: 'eric' } : null),
      async (env, path, data, opts) => { writes.push({ path, data, mask: opts.mask }); },
      async () => ({ chat: true, case: false, full: true }),
      (o, st = 200) => ({ status: st, body: o }));
    return h({ method, json: async () => body }, {});
  };
  const stranger = await run('advocate', 'POST', { case: false });
  const bad = await run('admin', 'POST', { case: 'off' });
  const none = await run('admin', 'POST', {});
  const one = await run('admin', 'POST', { case: false });
  const read = await run('admin', 'GET');
  // NEGATIVE CONTROL (run 2026-10-17, v7.72): handleSalesSwitches' mask made `['chat', 'case', 'full', 'setAt']` made this read
  //   FAIL  D2 the switches are his alone: anyone else gets the 404, only on or off is taken, a change writes just the switch it names, and the answer is what is stored
  check('D2 the switches are his alone: anyone else gets the 404, only on or off is taken, a change writes just the switch it names, and the answer is what is stored',
    stranger.status === 404 && bad.status === 400 && none.status === 400
    && writes.length === 1 && writes[0].path === 'config/sales' && writes[0].data.case === false && !('chat' in writes[0].data)
    && JSON.stringify(writes[0].mask) === '["case","setAt"]'
    && one.status === 200 && one.body.case === false && read.status === 200 && read.body.chat === true,
    JSON.stringify({ stranger, bad, writes, one }));

  // NEGATIVE CONTROL (run 2026-10-17, v7.72): the first-month Full-Service refusal taken out of handleCheckout made this read
  //   FAIL  D3 the pages read GET /api/sales, his settings GET and POST /api/admin/sales, and a first Full-Service month from chat answers to the Full-Service switch
  check('D3 the pages read GET /api/sales, his settings GET and POST /api/admin/sales, and a first Full-Service month from chat answers to the Full-Service switch',
    /if \(url\.pathname === '\/api\/sales' && request\.method === 'GET'\)\n\s+return json\(await readSwitches\(env\)\);/.test(SRC)
    && /if \(url\.pathname === '\/api\/admin\/sales'\)\n\s+return await handleSalesSwitches\(request, env\);/.test(SRC)
    && /if \(body\?\.tier === 'full' && !DEMO_HOST\.test\(new URL\(request\.url\)\.hostname\) && !\(await readSwitches\(env, \{ fresh: true \}\)\)\.full\)\n\s+return json\(\{ error: SALES_CLOSED_MESSAGE, salesClosed: true \}, 409\);/.test(SRC));

  const AS = f('public/js/admin-settings.js');
  const rows = (AS.match(/<div data-sales-rows>[\s\S]*?<\/div>\n\s+<p class="dim small" data-sales-said/) || [''])[0];
  const wire = (AS.match(/\nfunction wireSales\([\s\S]*?\n\}/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-17, v7.72): wireSales' `call().then(paint)` made `paint({ chat: true, case: true, full: true })` made this read
  //   FAIL  D4 his settings have a switch for each service, disabled until the Worker says what is on, a tap sends that one and paints the answer, in words without a dash
  check('D4 his settings have a switch for each service, disabled until the Worker says what is on, a tap sends that one and paints the answer, in words without a dash',
    /<h4 style="margin:1\.2rem 0 \.1rem;">Your services<\/h4>/.test(AS)
    && /\[\['chat', '24\/7 Priority Chat'\], \['case', 'Advocacy Case'\], \['full', 'Full-Service Case Management'\]\]/.test(rows)
    && /<button class="switch" data-sale="\$\{k\}" data-name="\$\{name\}" aria-pressed="false" aria-label="\$\{name\}" disabled><\/button>/.test(rows)
    && /wireSales\(overlay, user\);\n\s+wirePrices\(overlay, user\);/.test(AS)
    && /fetch\('\/api\/admin\/sales'/.test(wire) && /call\(\)\.then\(paint\)/.test(wire) && /const sw = await call\(\{ \[k\]: want \}\);\n\s+paint\(sw\);/.test(wire)
    && /Off means clients see Not\s+currently offering and the waitlist, and nobody can buy it/.test(AS)
    && !DASH.test(rows + wire + AS.slice(AS.indexOf('Your services'), AS.indexOf('<h4 style="margin:1.2rem 0 .1rem;">Prices</h4>'))));

  const API = f('public/js/demo/api.js');
  // NEGATIVE CONTROL (run 2026-10-17, v7.72): the demo's `if (role !== 'admin') return fail(404, 'Not found');` taken out of the switches made this read
  //   FAIL  D5 the practice copy keeps its own switches, his alone to change
  check('D5 the practice copy keeps its own switches, his alone to change',
    /if \(path === '\/api\/sales' \|\| path === '\/api\/admin\/sales'\) \{[\s\S]*?if \(role !== 'admin'\) return fail\(404, 'Not found'\);[\s\S]*?store\.docs\.set\('config\/sales'/.test(API));
}

console.log('\n--- B. the pages ---');
{
  const closed = f('public/js/sales-closed.js');
  const book = f('public/book.html');
  const sub = f('public/subscribe.html');
  const svc = f('public/services.html');
  // NEGATIVE CONTROL (run 2026-10-12): the sales-closed.js script tag taken off subscribe.html made this read
  //   FAIL  B1 book and subscribe hide their buying flow behind the notice, and services leads with it
  // RE-PINNED 2026-10-14 (v7.36): Eric, "Unlock priority chat". Each buying page names its package, so the
  // subscribe page opens with the chat line and book stays behind the notice.
  // NEGATIVE CONTROL (run 2026-10-14, v7.36): subscribe.html's main marked data-sales="case" made this read
  //   FAIL  B1 book names the case and subscribe names the chat line, both load the notice before their flow, and services loads it too
  check('B1 book names the case and subscribe names the chat line, both load the notice before their flow, and services loads it too',
    /<main data-sales="case">/.test(book) && /<main data-sales="chat">/.test(sub)
    && [book, sub, svc].every((h) => /<script type="module" src="\/js\/sales-closed\.js"><\/script>/.test(h))
    && book.indexOf('sales-closed.js') < book.indexOf('/js/book.js"') && sub.indexOf('sales-closed.js') < sub.indexOf('/js/subscribe.js"')
    && /main\.pa-closed-on > :not\(\.pa-closed\)/.test(closed));
  // NEGATIVE CONTROL (run 2026-10-12): `if (SALES_OPEN || inDemo()) return;` changed to `if (inDemo()) return;` made this read
  //   FAIL  B2 the notice follows the switch, says Not currently offering, and sends people to the waitlist
  // RE-PINNED 2026-10-14 (v7.36): package by package. packageOpen is lifted and run against both switches.
  // RE-PINNED 2026-10-15 (v7.37): Eric, "it should go to a page dedicated to what the chat is. Same with the other two options. They should never commingle information." packageOpen moved into sales.js, where the package pages read it too.
  // RE-PINNED 2026-10-17 (v7.72): Eric, "My services are off. How do I toggle them back on in app?" packageOpen reads the
  // switches the page asked the Worker for; run here by setting them.
  const setLive = (sw) => { Object.assign(sales.live, sw); return sales.packageOpen; };
  const now = setLive({ chat: true, case: false, full: false });
  const nowR = ['chat', 'case', 'full'].map((p) => now(p));
  const allOpen = setLive(ALL_ON);
  const openR = ['chat', 'case', 'full'].map((p) => allOpen(p));
  const allShut = setLive(ALL_OFF);
  const shutR = ['chat', 'case', 'full'].map((p) => allShut(p));
  const fullOnly = setLive({ chat: false, case: false, full: true });
  const fullR = ['chat', 'case', 'full'].map((p) => fullOnly(p));
  setLive(sales.switchesFrom(null));
  // NEGATIVE CONTROL (run 2026-10-14, v7.36): packageOpen made to answer SALES_OPEN for every package made this read
  //   FAIL  B2 each page follows its own package's switch, says Not currently offering, and sends people to the waitlist
  // NEGATIVE CONTROL (run 2026-10-17, v7.72): packageOpen made to answer `live.case` for every package made B2 read FAIL.
  check('B2 each page follows its own package\'s switch, says Not currently offering, and sends people to the waitlist',
    /import \{ packageOpen, loadSales \} from '\.\/sales\.js';/.test(closed) && /\n\s+await loadSales\(\);\n/.test(closed)
    && nowR.join() === 'true,false,false' && openR.join() === 'true,true,true' && shutR.join() === 'false,false,false' && fullR.join() === 'false,false,true'
    && /if \(packageOpen\(pkg\)\) return;/.test(closed)
    && /<h2>Not currently offering<\/h2>/.test(closed) && /href="\/#waitlist">Join the waitlist<\/a>/.test(closed) && !DASH.test(closed));
  // RE-PINNED 2026-10-15 (v7.37): Eric, "it should go to a page dedicated to what the chat is. Same with the other two options. They should never commingle information."
  // A closed card on services still opens its own page: that is information, not a sale.
  // NEGATIVE CONTROL (run 2026-10-15, v7.37): `card.removeAttribute('href');` put back into closeSales made this read
  //   FAIL  B2b on services each closed package's card says so and still opens its own page; the notice leads only when every package is closed
  check('B2b on services each closed package\'s card says so and still opens its own page; the notice leads only when every package is closed',
    /const closed = \['case', 'full', 'chat'\]\.filter\(\(p\) => !packageOpen\(p\)\);/.test(closed)
    && /tag\.insertAdjacentHTML\('afterend', '<span class="pa-off-badge">Not currently offering<\/span>'\);/.test(closed)
    && !/removeAttribute\('href'\)/.test(closed)
    && /if \(closed\.length === 3\) main\.insertAdjacentHTML\('afterbegin', NOTICE\);/.test(closed)
    && ['id="case"', 'id="full"', 'id="chat"'].every((id) => svc.includes(id)));
  // Eric, 2026-10-17: "My services are off. How do I toggle them back on in app?" The home and About follow the switches too:
  // a closed package's card goes back to the grey door to its own page, and the case's steps go while it is closed.
  // NEGATIVE CONTROL (run 2026-10-17, v7.72): ONLY_WHILE_OPEN's '#case-runs' taken out made this read
  //   FAIL  B5 the home and About load the notice too: a closed package's home card is its grey door again, and the case's steps go while the case is closed
  const idx = f('public/index.html');
  const about = f('public/about.html');
  check('B5 the home and About load the notice too: a closed package\'s home card is its grey door again, and the case\'s steps go while the case is closed',
    [idx, about].every((h) => /<script type="module" src="\/js\/sales-closed\.js"><\/script>/.test(h))
    && /const OWN_PAGE = \{ chat: '\/priority-chat\.html', case: '\/advocacy-case\.html', full: '\/full-service\.html' \};/.test(closed)
    && /const ONLY_WHILE_OPEN = \{ case: \['#how', 'a\[href="#how"\]', '#case-runs'\] \};/.test(closed)
    && /a\.className = 'opt opt-off';/.test(closed) && /<span class="opt-badge">Not currently offering<\/span>/.test(closed)
    && /<section class="land-sec" id="case-runs">\s*<h2>How a case runs<\/h2>/.test(about) && /<section class="land-sec ruled how" id="how">/.test(idx));
  const wl = f('public/js/waitlist.js');
  // NEGATIVE CONTROL (run 2026-10-12): the #waitlist opener deleted made this read
  //   FAIL  B3 the landing opens the waitlist itself when sent to /#waitlist
  check('B3 the landing opens the waitlist itself when sent to /#waitlist',
    /if \(location\.hash === '#waitlist'\) \{\s*dlg\.showModal\(\);/.test(wl));
  // The bubble stays, closed or open (his words for /open: "leave the waitlist button").
  // NEGATIVE CONTROL (run 2026-10-12): data-waitlist-open taken off the bubble made this read
  //   FAIL  B4 the waitlist bubble is still on the landing
  check('B4 the waitlist bubble is still on the landing', /<button type="button" class="wl-bubble" data-waitlist-open/.test(f('public/index.html')));
}

console.log('\n--- C. /open, written down ---');
{
  const md = f('CLAUDE.md');
  const sec = md.slice(md.indexOf('## "/open"'), md.indexOf('## Deploy ritual'));
  // NEGATIVE CONTROL (run 2026-10-12): the line about keeping the waitlist bubble deleted from CLAUDE.md made this read
  //   FAIL  C1 CLAUDE.md says what /open means, in his words, and what it does and does not bring back
  check('C1 CLAUDE.md says what /open means, in his words, and what it does and does not bring back',
    sec.includes("\"/open means open up all packages, remove the banner saying I'm sick. But leave the waitlist button for if my schedule is blocked off.\"")
    && /SALES_OPEN = true/.test(sec) && /out-banner/.test(sec) && /KEEPS the "Join the waitlist" bubble/.test(sec)
    && /does NOT bring back the free 15-minute call/.test(sec));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
