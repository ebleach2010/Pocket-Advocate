// packages.mjs - one package, one page.
//
// Eric, 2026-10-15: "When you tap on 'what's included' with the chat it
// describes an advocacy case. Keep the shiny blue/purple aesthetic
// throughout. But it should go to a page dedicated to what the chat is. Same
// with the other two options. They should never commingle information."
//
// Pinned here: every door to a package's information opens that package's
// own page and no other; each page names one package, paints that package's
// About copy and nothing else, and offers the right way in for the switch it
// answers to; the services page no longer sends anyone to a shared sheet;
// the pages wear the home's look. package-page.js's two painters are lifted
// and RUN against every package and both switch positions.
//
// Run: node packages.mjs
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
import { readFileSync } from 'node:fs';
import { SERVICE_ABOUT } from '../../public/js/service-about.js';

const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
const f = (p) => readFileSync(__j(__REPO, p), 'utf8');
const DASH = /[\u2013\u2014]/;

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}

const PAGES = [
  { pkg: 'chat', file: 'priority-chat', title: '24/7 Priority Chat', rate: 'sub' },
  { pkg: 'case', file: 'advocacy-case', title: 'Advocacy Case', rate: 'case' },
  { pkg: 'full', file: 'full-service', title: 'Full-Service Case Management', rate: 'full' },
];
const PKG = f('public/js/package-page.js');
const lift = (name) => (PKG.match(new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}`)) || [''])[0].replace('export ', '');
const { statusHtml, bodyHtml, PAGE_COPY } = new Function(`
  ${(PKG.match(/export const PAGE_COPY = [^;]+;/) || [''])[0].replace('export ', '')}
  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  ${lift('statusHtml')}
  ${lift('bodyHtml')}
  return { statusHtml, bodyHtml, PAGE_COPY };`)();

console.log('\n--- A. the doors ---');
{
  const idx = f('public/index.html');
  const opts = idx.slice(idx.indexOf('id="options"'), idx.indexOf('<section class="land-sec ruled needs"'));
  // NEGATIVE CONTROL (run 2026-10-15): the chat card's door put back on /services.html#chat made this read
  //   FAIL  A1 on the home, each card's information opens its own page: chat's What is included, and each closed card whole
  check('A1 on the home, each card\'s information opens its own page: chat\'s What is included, and each closed card whole',
    /<a class="opt-more" href="\/priority-chat\.html">What is included<\/a>/.test(opts)
    && /<a class="opt opt-off" href="\/advocacy-case\.html">[\s\S]*?Advocacy Case<\/h3>[\s\S]*?<\/a>/.test(opts)
    && /<a class="opt opt-off" href="\/full-service\.html">[\s\S]*?Full-Service Case Management<\/h3>[\s\S]*?<\/a>/.test(opts)
    && !/services\.html#/.test(idx));
  const svc = f('public/services.html');
  // NEGATIVE CONTROL (run 2026-10-15): a `data-about="chat"` button put back on services.html made this read
  //   FAIL  A2 on services, each card opens its own page, no shared sheet is left, and the case's own steps moved to the case's page
  check('A2 on services, each card opens its own page, no shared sheet is left, and the case\'s own steps moved to the case\'s page',
    /id="case" href="\/advocacy-case\.html"/.test(svc) && /id="full" href="\/full-service\.html"/.test(svc) && /id="chat" href="\/priority-chat\.html"/.test(svc)
    && !/data-about=/.test(svc) && !/wireAboutButtons/.test(svc)
    && !/What happens after you book/.test(svc) && /What happens after you book/.test(f('public/advocacy-case.html')));
}

console.log('\n--- B. the pages ---');
for (const p of PAGES) {
  const html = f(`public/${p.file}.html`);
  const others = PAGES.filter((o) => o !== p);
  const ownRates = [...html.matchAll(/data-rate="(\w+)"/g)].map((m) => m[1]);
  // NEGATIVE CONTROL (run 2026-10-15): `<span data-rate="case">$1,200</span>` added to the chat page made this read
  //   FAIL  B1 priority-chat: names its own package and no other, shows only its own price, and loads its painter
  check(`B1 ${p.file}: names its own package and no other, shows only its own price, and loads its painter`,
    new RegExp(`<body class="landing pkg" data-package="${p.pkg}">`).test(html)
    && html.includes(`<h1>${p.title}</h1>`) && html.includes(`<title>${p.title} · Pocket Advocate</title>`)
    && others.every((o) => !html.includes(o.title))
    && ownRates.length >= 1 && ownRates.every((r) => r === p.rate || (p.pkg === 'case' && r === 'addon'))
    && /<script type="module" src="\/js\/package-page\.js\?v=1"><\/script>/.test(html) && !DASH.test(html),
    JSON.stringify(ownRates));
}
{
  // Each page paints its own About entry, and that entry's words alone.
  const painted = PAGES.map((p) => bodyHtml(SERVICE_ABOUT[PAGE_COPY[p.pkg]]));
  const own = PAGES.every((p, i) => painted[i].includes(SERVICE_ABOUT[PAGE_COPY[p.pkg]].tldr.replace(/'/g, '&#39;').slice(0, 40)));
  const notOthers = PAGES.every((p, i) => PAGES.filter((o) => o !== p)
    .every((o) => !painted[i].includes(SERVICE_ABOUT[PAGE_COPY[o.pkg]].tldr.replace(/'/g, '&#39;').slice(0, 40))));
  // NEGATIVE CONTROL (run 2026-10-15): PAGE_COPY's chat pointed at 'case' made this read
  //   FAIL  B2 each page paints its own package's TL;DR, details and points, and never another's
  check('B2 each page paints its own package\'s TL;DR, details and points, and never another\'s',
    JSON.stringify(PAGE_COPY) === '{"chat":"chat","case":"case","full":"handsOff"}' && own && notOthers
    && painted.every((h) => /<h2>TL;DR<\/h2>/.test(h) && /<h2>What it is<\/h2>/.test(h) && /<h2>Point by point<\/h2>/.test(h)));
  // NEGATIVE CONTROL (run 2026-10-15): the closed branch's waitlist link pointed at /book.html made this read
  //   FAIL  B3 the way in follows the switch: chat to its own checkout, the case to booking, full service through a case first, and a closed one says so and offers the waitlist
  check('B3 the way in follows the switch: chat to its own checkout, the case to booking, full service through a case first, and a closed one says so and offers the waitlist',
    /href="\/subscribe\.html">Start chatting</.test(statusHtml('chat', true))
    && /href="\/book\.html">Book a case</.test(statusHtml('case', true))
    && /href="\/book\.html">Book a case first</.test(statusHtml('full', true))
    && ['chat', 'case', 'full'].every((k) => /Not currently offering/.test(statusHtml(k, false)) && /href="\/#waitlist">Join the waitlist</.test(statusHtml(k, false)) && !/subscribe|book/.test(statusHtml(k, false)))
    && /import \{ packageOpen \} from '\.\/sales\.js';/.test(PKG) && /statusHtml\(pkg, packageOpen\(pkg\)\)/.test(PKG));
}

console.log('\n--- C. the look ---');
{
  const css = f('public/css/landing.css');
  // NEGATIVE CONTROL (run 2026-10-15): `opt-gold` taken off the full-service page's hero made this read
  //   FAIL  C1 every package page wears the home's look: black, its type, the ringed hero and the bubble's gradient on its words
  check('C1 every package page wears the home\'s look: black, its type, the ringed hero and the bubble\'s gradient on its words',
    PAGES.every((p) => {
      const h = f(`public/${p.file}.html`);
      return /<html lang="en" data-default-scheme="calm">/.test(h) && /landing\.css\?v=b6/.test(h)
        && /<section class="pkg-hero opt-gold">/.test(h);
    })
    && /body\.landing \.pkg-tag,\s*body\.landing \.pkg-price \{[\s\S]*?linear-gradient\(110deg, #3DDCF5 0%, #9BEBFA 48%, #B9A6FF 100%\)/.test(css));
  const audit = f('tools/blindness-audit.mjs');
  // NEGATIVE CONTROL (run 2026-10-15): the three pages taken out of the audit's CLIENT_PAGES made this read
  //   FAIL  C2 the audit crawls all three pages and the sideways sweep measures them
  check('C2 the audit crawls all three pages and the sideways sweep measures them',
    /'\/priority-chat', '\/advocacy-case', '\/full-service',/.test(audit)
    && /'\/priority-chat\.html', '\/advocacy-case\.html', '\/full-service\.html',/.test(f('tools/drives/drive-nosideways.mjs')));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
