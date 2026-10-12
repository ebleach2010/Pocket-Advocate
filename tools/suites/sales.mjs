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
const GATE = (SRC.match(/\n\s+if \([^\n]*SALES_ROUTES\.has\(url\.pathname\)[^\n]*\n[^\n]*\n/) || [''])[0];
const gateFor = (open) => new Function('SALES_OPEN', 'SALES_CLOSED_MESSAGE',
  `${konst('SALES_ROUTES')}${konst('DEMO_HOST')}${sfn('json')}
   return (url) => { ${GATE} return null; };`)(open, sales.SALES_CLOSED_MESSAGE);

console.log('\n--- A. the switch and the gate ---');
// NEGATIVE CONTROL (run 2026-10-12): SALES_OPEN set to true made this read
//   FAIL  A1 the switch is off, and the message offers the waitlist in plain words with no dash
check('A1 the switch is off, and the message offers the waitlist in plain words with no dash',
  sales.SALES_OPEN === false && /not currently offering/.test(sales.SALES_CLOSED_MESSAGE)
  && /Join the waitlist/.test(sales.SALES_CLOSED_MESSAGE) && !DASH.test(sales.SALES_CLOSED_MESSAGE)
  && /import \{ SALES_OPEN, SALES_CLOSED_MESSAGE \} from '\.\.\/public\/js\/sales\.js';/.test(SRC));

const ROUTES = ['/api/checkout', '/api/subscribe', '/api/chat-unlock', '/api/upgrade', '/api/followup', '/api/extend', '/api/telehealth'];
{
  const gate = gateFor(false);
  const live = [];
  for (const r of ROUTES) {
    const res = gate(new URL(`https://thepocketadvocates.com${r}`));
    live.push(res && res.status === 409 ? (await res.json()) : null);
  }
  // NEGATIVE CONTROL (run 2026-10-12): '/api/extend' taken out of SALES_ROUTES made this read
  //   FAIL  A2 on the live site every purchase route is refused with a 409 and his message
  check('A2 on the live site every purchase route is refused with a 409 and his message',
    live.every((o) => o && o.error === sales.SALES_CLOSED_MESSAGE && o.salesClosed === true), JSON.stringify(live));
  const others = ['/api/tip', '/api/review', '/api/waitlist', '/api/portal', '/api/admin/case-charge', '/api/admin/schedule']
    .map((r) => gate(new URL(`https://thepocketadvocates.com${r}`)));
  // NEGATIVE CONTROL (run 2026-10-12): '/api/waitlist' added to SALES_ROUTES made this read
  //   FAIL  A3 the waitlist, reviews, the billing portal and his own admin charges are not touched
  check('A3 the waitlist, reviews, the billing portal and his own admin charges are not touched', others.every((r) => r === null));
  const preview = ROUTES.map((r) => gate(new URL(`http://127.0.0.1:8787${r}`)));
  // NEGATIVE CONTROL (run 2026-10-12): `&& !DEMO_HOST.test(url.hostname)` taken out of the gate made this read
  //   FAIL  A4 a preview or local host is spared, as the maintenance window spares it
  check('A4 a preview or local host is spared, as the maintenance window spares it', preview.every((r) => r === null));
  const open = gateFor(true);
  // NEGATIVE CONTROL (run 2026-10-12): `!SALES_OPEN &&` taken out of the gate made this read
  //   FAIL  A5 with the switch on, nothing is refused: /open is one line
  check('A5 with the switch on, nothing is refused: /open is one line',
    ROUTES.every((r) => open(new URL(`https://thepocketadvocates.com${r}`)) === null));
}
{
  // Above every one of the routes it guards, so no handler can reach Stripe first.
  const at = SRC.indexOf('if (!SALES_OPEN && SALES_ROUTES.has(url.pathname)');
  const firsts = ROUTES.map((r) => SRC.indexOf(`url.pathname === '${r}' && request.method`));
  // NEGATIVE CONTROL (run 2026-10-12): the gate moved below the /api/checkout route made this read
  //   FAIL  A6 the gate sits above every route it guards, and each of them is a real route
  check('A6 the gate sits above every route it guards, and each of them is a real route',
    at > 0 && firsts.every((i) => i > at), JSON.stringify({ at, firsts }));
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

console.log('\n--- B. the pages ---');
{
  const closed = f('public/js/sales-closed.js');
  const book = f('public/book.html');
  const sub = f('public/subscribe.html');
  const svc = f('public/services.html');
  // NEGATIVE CONTROL (run 2026-10-12): the sales-closed.js script tag taken off subscribe.html made this read
  //   FAIL  B1 book and subscribe hide their buying flow behind the notice, and services leads with it
  check('B1 book and subscribe hide their buying flow behind the notice, and services leads with it',
    /<main data-sales="buy">/.test(book) && /<main data-sales="buy">/.test(sub)
    && [book, sub, svc].every((h) => /<script type="module" src="\/js\/sales-closed\.js"><\/script>/.test(h))
    && book.indexOf('sales-closed.js') < book.indexOf('/js/book.js"') && sub.indexOf('sales-closed.js') < sub.indexOf('/js/subscribe.js"')
    && /main\[data-sales="buy"\]\.pa-closed-on > :not\(\.pa-closed\)/.test(closed));
  // NEGATIVE CONTROL (run 2026-10-12): `if (SALES_OPEN || inDemo()) return;` changed to `if (inDemo()) return;` made this read
  //   FAIL  B2 the notice follows the switch, says Not currently offering, and sends people to the waitlist
  check('B2 the notice follows the switch, says Not currently offering, and sends people to the waitlist',
    /import \{ SALES_OPEN \} from '\.\/sales\.js';/.test(closed) && /if \(SALES_OPEN \|\| inDemo\(\)\) return;/.test(closed)
    && /<h2>Not currently offering<\/h2>/.test(closed) && /href="\/#waitlist">Join the waitlist<\/a>/.test(closed) && !DASH.test(closed));
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
