// drive-switches.mjs - his services, one switch each, from his settings, on his phone (v7.72).
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-switches.mjs
//
// Eric, 2026-10-17: "My services are off. How do I toggle them back on in app?" Priority Chat, the Advocacy
// Case and Full-Service each get an on or off row in his settings. Driven at 390px: the rows in the admin demo
// (read from the Worker, saved, read back after a reload), then the public pages with the Worker's answer
// (GET /api/sales) set by the drive, the way a real switch would set it: the home's card, its steps and its
// menu, About, the booking and chat pages, each package's own page, services, and the waitlist's picker.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const P = `http://127.0.0.1:${process.env.PA_PORT || 9377}`;
const SHOTS = process.env.PA_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { if (c) { pass += 1; console.log(`  ok    ${n}${d ? ` (${d})` : ''}`); } else { fail += 1; console.log(`  FAIL  ${n}${d ? ` (${d})` : ''}`); } };
const errs = [];

console.log('\n--- A. the rows in his settings ---');
const admin = await b.newContext({ viewport: { width: 390, height: 844 } });
await admin.addCookies([{ name: 'pa_demo', value: 'admin', domain: '127.0.0.1', path: '/' }]);
const page = await admin.newPage();
page.on('pageerror', (e) => errs.push(`admin: ${String(e).slice(0, 160)}`));
const rows = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-sale]')].map((x) => [x.dataset.sale, {
  on: x.classList.contains('on'), pressed: x.getAttribute('aria-pressed'), disabled: x.disabled,
  said: document.querySelector(`[data-sale-said="${x.dataset.sale}"]`)?.textContent || '',
}])));
const openCog = async () => {
  await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.click('.cog-btn');
  await page.waitForSelector('[data-sale]:not([disabled])', { timeout: 8000 }).catch(() => {});
};
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.removeItem('pa-demo-store'); });
await openCog();
const first = await rows();
// NEGATIVE CONTROL (run 2026-10-17, v7.72): wireSales' `b.disabled = false;` taken out of paint made this read
//   FAIL  three rows, Priority Chat, the Advocacy Case and Full-Service, each read from the Worker as on and only then tappable
ok('three rows, Priority Chat, the Advocacy Case and Full-Service, each read from the Worker as on and only then tappable',
  Object.keys(first).join() === 'chat,case,full' && Object.values(first).every((r) => r.on && r.pressed === 'true' && !r.disabled)
  && first.case.said === 'On. Clients can book it.' && first.chat.said === 'On. Clients can buy it.', JSON.stringify(first));
await page.evaluate(() => document.querySelector('[data-sales-rows]').scrollIntoView({ block: 'center' }));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/switches-1-rows.png` });
await page.click('[data-sale="case"]');
await page.waitForFunction(() => /is off/.test(document.querySelector('[data-sales-said]')?.textContent || ''), null, { timeout: 6000 }).catch(() => {});
const off = await rows();
const offSaid = await page.evaluate(() => document.querySelector('[data-sales-said]')?.textContent || '');
// NEGATIVE CONTROL (run 2026-10-17, v7.72): wireSales' POST body `{ [k]: want }` made `{ [k]: true }` made this read
//   FAIL  a tap turns the Advocacy Case off, says so in words, and leaves the other two on
ok('a tap turns the Advocacy Case off, says so in words, and leaves the other two on',
  !off.case.on && off.case.pressed === 'false' && off.case.said === 'Off. Clients see Not currently offering.'
  && off.chat.on && off.full.on && offSaid === 'Advocacy Case is off.', JSON.stringify({ off, offSaid }));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/switches-2-case-off.png` });
await openCog();
const back = await rows();
// NEGATIVE CONTROL (run 2026-10-17, v7.72): the demo's `store.docs.set('config/sales', ...)` taken out made this read
//   FAIL  it is still off when the settings are opened again: what shows is what is stored
ok('it is still off when the settings are opened again: what shows is what is stored', !back.case.on && back.chat.on && back.full.on, JSON.stringify(back));
await page.click('[data-sale="case"]');
await page.waitForFunction(() => /is on/.test(document.querySelector('[data-sales-said]')?.textContent || ''), null, { timeout: 6000 }).catch(() => {});
// NEGATIVE CONTROL (run 2026-10-17, v7.72): wireSales' `const want = !b.classList.contains('on');` made `const want = false;` made this read
//   FAIL  and a second tap turns it back on
ok('and a second tap turns it back on', (await rows()).case.on === true);

// ---- the public pages, with the Worker's answer set by the drive ---------------------------------------------
const pub = await b.newContext({ viewport: { width: 390, height: 844 } });
let answer = { chat: true, case: true, full: true };
await pub.route('**/api/sales', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) }));
const p2 = await pub.newPage();
// Outside the demo a page loads the real sign-in library from Google's servers, which the local Worker cannot reach;
// that one refusal is the test machine's, not the page's.
p2.on('pageerror', (e) => { if (!/firebase-real\.js/.test(String(e))) errs.push(`public: ${String(e).slice(0, 160)}`); });
const visit = async (path, sw) => {
  answer = sw;
  await p2.goto(`${P}${path}`, { waitUntil: 'networkidle' });
  await p2.waitForTimeout(1200);
};
const home = () => p2.evaluate(() => {
  const cards = [...document.querySelectorAll('#options .opt')].map((c) => ({
    tag: c.tagName, cls: c.className, href: c.getAttribute('href') || '',
    name: c.querySelector('h3')?.textContent.trim() || '', badge: !!c.querySelector('.opt-badge'),
    links: [...c.querySelectorAll('a')].map((a) => a.getAttribute('href')), price: c.querySelector('[data-rate], .svc-price')?.textContent.trim() || '',
  }));
  // Not hidden by the page's rule, whether or not the menu holding it is open.
  const bookShown = [...document.querySelectorAll('a[href^="/book.html"]')].filter((a) => getComputedStyle(a).display !== 'none').length;
  return {
    cards, how: !!document.getElementById('how'), howLink: !!document.querySelector('a[href="#how"]'), bookShown,
    sideways: document.documentElement.scrollWidth > innerWidth + 1,
  };
});

console.log('\n--- B. the home ---');
await visit('/', { chat: true, case: true, full: true });
const allOn = await home();
// NEGATIVE CONTROL (run 2026-10-17, v7.72): closeSales' `.filter((p) => !packageOpen(p))` on the home made `.filter(() => true)` made this read
//   FAIL  with everything on, the three cards are open with their doors, and How it works is there with its menu link
ok('with everything on, the three cards are open with their doors, and How it works is there with its menu link',
  allOn.cards.length === 3 && allOn.cards.every((c) => c.tag === 'DIV' && /opt-live/.test(c.cls) && !c.badge)
  && allOn.cards[1].links.join() === '/book.html,/advocacy-case.html' && allOn.how && allOn.howLink && allOn.bookShown >= 2, JSON.stringify({ cards: allOn.cards.map((c) => c.cls), book: allOn.bookShown }));
await visit('/', { chat: true, case: false, full: true });
const caseOff = await home();
const caseCard = caseOff.cards.find((c) => /Advocacy Case/.test(c.name)) || {};
// NEGATIVE CONTROL (run 2026-10-17, v7.72): closeHomeCard's `a.href = OWN_PAGE[pkg];` taken out made this read
//   FAIL  with the case off, its card is the grey door to its own page again, with its badge and price and no Book a case, and How it works and its menu link are gone
ok('with the case off, its card is the grey door to its own page again, with its badge and price and no Book a case, and How it works and its menu link are gone',
  caseCard.tag === 'A' && caseCard.cls === 'opt opt-off' && caseCard.href === '/advocacy-case.html' && caseCard.badge
  && /\$/.test(caseCard.price) && caseCard.links.length === 0 && !caseOff.how && !caseOff.howLink, JSON.stringify({ caseCard, how: caseOff.how }));
// NEGATIVE CONTROL (run 2026-10-17, v7.72): nav-menu's `m.packageOpen('case')` made `true` made this read
//   FAIL  and the other two stay open, and no link to booking shows anywhere on the page
ok('and the other two stay open, and no link to booking shows anywhere on the page',
  caseOff.cards.filter((c) => c !== caseCard).every((c) => c.tag === 'DIV' && /opt-live/.test(c.cls)) && caseOff.bookShown === 0, JSON.stringify({ cards: caseOff.cards.map((c) => c.cls), book: caseOff.bookShown }));
if (SHOTS) await p2.screenshot({ path: `${SHOTS}/switches-3-home-case-off.png`, fullPage: true });
await visit('/', { chat: false, case: true, full: false });
const twoOff = await home();
// NEGATIVE CONTROL (run 2026-10-17, v7.72): OWN_PAGE's full made '/fullservice.html' made this read
//   FAIL  with the chat and Full-Service off, each is its own grey door and the case keeps its booking
ok('with the chat and Full-Service off, each is its own grey door and the case keeps its booking',
  twoOff.cards[0].tag === 'A' && twoOff.cards[0].href === '/priority-chat.html' && twoOff.cards[0].badge
  && twoOff.cards[2].tag === 'A' && twoOff.cards[2].href === '/full-service.html'
  && twoOff.cards[1].tag === 'DIV' && twoOff.cards[1].links.includes('/book.html') && twoOff.how && !twoOff.sideways,
  JSON.stringify(twoOff.cards.map((c) => [c.tag, c.href])));
const picker = await p2.evaluate(() => [...document.querySelectorAll('#waitlist select[name="package"] option')].map((o) => o.value).filter(Boolean));
// NEGATIVE CONTROL (run 2026-10-17, v7.72): waitlist.js's loop made to remove every package made this read
//   FAIL  the waitlist offers only what is off: the chat and Full-Service
ok('the waitlist offers only what is off: the chat and Full-Service', picker.join() === 'chat,full' || picker.join() === 'full,chat', picker.join());

console.log('\n--- C. About ---');
await visit('/about.html', { chat: true, case: true, full: true });
const aboutOn = await p2.evaluate(() => !!document.getElementById('case-runs'));
await visit('/about.html', { chat: true, case: false, full: true });
const aboutOff = await p2.evaluate(() => ({ runs: !!document.getElementById('case-runs'), chat: /24\/7 Priority Chat/.test(document.body.textContent) }));
// NEGATIVE CONTROL (run 2026-10-17, v7.72): ONLY_WHILE_OPEN's '#case-runs' taken out made this read
//   FAIL  About's How a case runs is there while the case is on, and gone while it is off
ok('About\'s How a case runs is there while the case is on, and gone while it is off', aboutOn && !aboutOff.runs && aboutOff.chat, JSON.stringify({ aboutOn, aboutOff }));

console.log('\n--- D. the pages that sell ---');
const notice = () => p2.evaluate(() => ({ notice: !!document.querySelector('.pa-closed'), text: document.querySelector('.pa-closed')?.textContent.replace(/\s+/g, ' ').trim() || '' }));
await visit('/book.html', { chat: true, case: false, full: true });
const bookOff = await notice();
await visit('/book.html', { chat: true, case: true, full: true });
const bookOn = await notice();
await visit('/subscribe.html', { chat: false, case: true, full: true });
const subOff = await notice();
// NEGATIVE CONTROL (run 2026-10-17, v7.72): sales-closed.js's `await loadSales();` taken out made this read
//   FAIL  booking says Not currently offering with the waitlist while the case is off and not while it is on; the chat page does the same on the chat's switch
ok('booking says Not currently offering with the waitlist while the case is off and not while it is on; the chat page does the same on the chat\'s switch',
  bookOff.notice && /Not currently offering/.test(bookOff.text) && /Join the waitlist/.test(bookOff.text) && !bookOn.notice && subOff.notice,
  JSON.stringify({ bookOff, bookOn, subOff }));
const door = () => p2.evaluate(() => document.querySelector('[data-pkg-status]')?.textContent.replace(/\s+/g, ' ').trim() || '');
await visit('/full-service.html', { chat: true, case: true, full: false });
const fullOff = await door();
await visit('/full-service.html', { chat: true, case: true, full: true });
const fullOn = await door();
// NEGATIVE CONTROL (run 2026-10-17, v7.72): package-page's `statusHtml(pkg, packageOpen(pkg))` made `statusHtml(pkg, true)` made this read
//   FAIL  Full-Service's own page says Not currently offering while it is off, and its way in while it is on
ok('Full-Service\'s own page says Not currently offering while it is off, and its way in while it is on',
  /Not currently offering/.test(fullOff) && /Join the waitlist/.test(fullOff) && /Book a case first/.test(fullOn) && !/Not currently/.test(fullOn), JSON.stringify({ fullOff, fullOn }));
await visit('/services.html', { chat: true, case: true, full: false });
const svc = await p2.evaluate(() => ['case', 'full', 'chat'].map((id) => !!document.getElementById(id)?.querySelector('.pa-off-badge')));
// NEGATIVE CONTROL (run 2026-10-17, v7.72): the services branch's filter made `(p) => p === 'case'` made this read
//   FAIL  services marks only Full-Service Not currently offering
ok('services marks only Full-Service Not currently offering', svc.join() === 'false,true,false', svc.join());

// NEGATIVE CONTROL (run 2026-10-17, v7.72): `throw new Error('control');` added after sales-closed.js's closeSales() call made this read
//   FAIL  no page threw
ok('no page threw', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`\n${pass} ok, ${fail} FAIL`);
await b.close();
process.exit(fail ? 1 : 0);
