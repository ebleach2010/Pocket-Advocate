// drive-leads.mjs - a lead's messages beside them on Leads, on his phone (v7.68), and hold to delete or block (v7.69).
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-leads.mjs
//
// Eric, 2026-10-17: "It says my lead Rosemarie sent me a message but I don't see it. I think lead messages should
// appear next to the lead in an expandable chat", then "Ah, it's off screen. Please put it in an expandable chat box
// or email like container." The demo seeds Rosa Lind's question from the question box.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = process.env.PA_PORT || '9377';
const SHOTS = process.env.PA_SHOTS || '';
const P = `http://127.0.0.1:${PORT}`;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { if (c) { pass += 1; console.log(`  ok    ${n}${d ? ` (${d})` : ''}`); } else { fail += 1; console.log(`  FAIL  ${n}${d ? ` (${d})` : ''}`); } };
const errs = [];
const tryStep = async (fn) => { try { await fn(); return true; } catch { return false; } };
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addCookies([{ name: 'pa_demo', value: 'admin', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
const open = async (q = '') => {
  await page.goto(`${P}/admin-leads.html?demo=admin${q}`, { waitUntil: 'networkidle' }).catch(() => {});
  await tryStep(() => page.waitForSelector('.lead-card', { timeout: 8000 }));
  await page.waitForTimeout(600);
};
const rosa = () => page.evaluate(() => {
  const el = [...document.querySelectorAll('.lead-card')].find((c) => c.dataset.email === 'rosa@example.demo');
  if (!el) return null;
  const det = el.querySelector('[data-msgs]');
  const r = el.getBoundingClientRect();
  return {
    index: [...document.querySelectorAll('.lead-card')].indexOf(el),
    key: el.dataset.lead,
    isNew: el.classList.contains('is-new'),
    pill: !!el.querySelector('.lead-pill.new'),
    open: !!det?.open,
    them: [...el.querySelectorAll('.lm.them')].map((x) => x.textContent),
    mine: [...el.querySelectorAll('.lm.me')].map((x) => x.textContent),
    themIn: [...el.querySelectorAll('.lm.them')].every((x) => { const q = x.getBoundingClientRect(); return q.left >= 0 && q.right <= innerWidth; }),
    top: Math.round(r.top),
    reply: !!el.querySelector('[data-reply] textarea') && !!el.querySelector('[data-reply] button[type="submit"]'),
  };
}).catch(() => null);

console.log('\n--- A. her message, on his phone ---');
await open();
const first = await rosa();
const sideways = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1).catch(() => true);
const head = await page.evaluate(() => document.querySelector('.lead-new-head')?.textContent.trim() || '').catch(() => '');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/leads-a-new.png` });
// NEGATIVE CONTROL (run 2026-10-17): the card's `${l.unread ? ' open' : ''}` taken out made this read
//   FAIL  Leads is one card per person on his phone, nothing runs sideways, and her new message is first, open, every word of it on screen, with a reply box
ok('Leads is one card per person on his phone, nothing runs sideways, and her new message is first, open, every word of it on screen, with a reply box',
  !!first && first.index === 0 && first.isNew && first.pill && first.open && /dizzy spells/.test(first.them[0] || '') && first.themIn && first.reply
  && !sideways && /^1 new message$/i.test(head),
  JSON.stringify({ first, sideways, head }));

console.log('\n--- B. his reply ---');
await tryStep(() => page.fill('.lead-card.is-new [data-reply] textarea', 'Hi Rosa, yes. Start with a free call.', { timeout: 4000 }));
await tryStep(() => page.click('.lead-card.is-new [data-reply] button[type="submit"]', { timeout: 4000 }));
await page.waitForTimeout(1200);
const replied = await rosa();
await open();
const later = await rosa();
if (SHOTS) await page.screenshot({ path: `${SHOTS}/leads-b-replied.png` });
// NEGATIVE CONTROL (run 2026-10-17): the reply's `insertAdjacentHTML('beforeend', bubble(out.reply))` taken out made this read
//   FAIL  his reply shows in the conversation at once, and after a reload it is still there and she is no longer new
ok('his reply shows in the conversation at once, and after a reload it is still there and she is no longer new',
  !!replied && replied.mine.some((t) => /Start with a free call/.test(t)) && !replied.pill
  && !!later && later.mine.some((t) => /Start with a free call/.test(t)) && !later.isNew && !later.open,
  JSON.stringify({ replied, later }));

console.log('\n--- C. a push opens on her ---');
await open(`&lead=${encodeURIComponent(later?.key || '')}`);
const pushed = await rosa();
if (SHOTS) await page.screenshot({ path: `${SHOTS}/leads-c-pushed.png` });
// NEGATIVE CONTROL (run 2026-10-17): `if (det) det.open = true;` made `if (det) void 0;` made this read
//   FAIL  a push about her opens Leads on her card with her messages open
ok('a push about her opens Leads on her card with her messages open',
  !!pushed && pushed.open && pushed.top >= -2 && pushed.top < 200, JSON.stringify(pushed));

// Eric, 2026-10-17: "I should be able to hold to delete/block leads".
console.log('\n--- D. hold a card to delete or block ---');
await open();
const cards = () => page.evaluate(() => [...document.querySelectorAll('.lead-card')].map((c) => c.dataset.email)).catch(() => []);
const hold = async (email, ms, where = '.lead-name') => {
  const box = await page.evaluate(([e, w]) => {
    const el = [...document.querySelectorAll('.lead-card')].find((c) => c.dataset.email === e)?.querySelector(w);
    if (!el) return null;
    // Instant: the page scrolls smoothly, and a box measured mid-scroll is pressed where it no longer is.
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = el.getBoundingClientRect();
    return { x: r.left + Math.min(20, r.width / 2), y: r.top + r.height / 2 };
  }, [email, where]).catch(() => null);
  if (!box) return false;
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
  await page.waitForTimeout(300);
  return true;
};
const sheet = () => page.evaluate(() => {
  const m = document.querySelector('.msg-menu-overlay .msg-menu');
  return m ? { head: m.querySelector('.msg-menu-head')?.textContent.trim() || '', rows: [...m.querySelectorAll('.msg-menu-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()) } : null;
}).catch(() => null);
const before = await cards();
const victim = before.find((e) => e !== 'rosa@example.demo') || '';
await hold(victim, 120);
const tapOnly = await sheet();
await page.keyboard.press('Escape');
// Her messages open first: a press on her words is a press on words, not on the card under a closed box.
await tryStep(() => page.click('.lead-card[data-email="rosa@example.demo"] [data-msgs] > summary', { timeout: 3000 }));
await page.waitForTimeout(300);
await hold('rosa@example.demo', 900, '.lm.them');
const onWords = await sheet();
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
await hold(victim, 900);
const menu = await sheet();
if (SHOTS) await page.screenshot({ path: `${SHOTS}/leads-d-hold.png` });
await tryStep(() => page.click('.msg-menu-row[data-act="delete"]', { timeout: 3000 }));
await page.waitForTimeout(300);
const askDel = await page.evaluate(() => document.querySelector('dialog.ask-sheet[open] h2')?.textContent || '').catch(() => '');
await tryStep(() => page.click('dialog.ask-sheet[open] button[value="ok"]', { timeout: 3000 }));
await page.waitForTimeout(900);
const afterDel = await cards();
const countSaid = await page.evaluate(() => document.getElementById('leads-count')?.textContent || '').catch(() => '');
await open();
const afterDelReload = await cards();
// NEGATIVE CONTROL (run 2026-10-17): the page's HOLD_MS made 5000 (a hold never long enough) made this read
//   FAIL  holding a card's name opens Delete and Block under their name, a tap or a press on their words does not, and Delete asks, then takes them off for good
ok('holding a card\'s name opens Delete and Block under their name, a tap or a press on their words does not, and Delete asks, then takes them off for good',
  !!victim && !tapOnly && !onWords && !!menu && menu.rows.some((r) => /Delete from Leads/.test(r)) && menu.rows.some((r) => /^⛔\s*Block$/.test(r))
  && /^Delete .+\?$/.test(askDel) && !afterDel.includes(victim) && afterDel.length === before.length - 1
  && countSaid === `${before.length - 1} ${before.length - 1 === 1 ? 'person' : 'people'}` && !afterDelReload.includes(victim),
  JSON.stringify({ victim, tapOnly, onWords, menu, askDel, before: before.length, after: afterDel.length, countSaid }));

await hold('rosa@example.demo', 900);
await tryStep(() => page.click('.msg-menu-row[data-act="block"]', { timeout: 3000 }));
await page.waitForTimeout(300);
const askBlock = await page.evaluate(() => document.querySelector('dialog.ask-sheet[open] p')?.textContent || '').catch(() => '');
await tryStep(() => page.click('dialog.ask-sheet[open] button[value="ok"]', { timeout: 3000 }));
await page.waitForTimeout(900);
await open();
const blockedNow = await page.evaluate(() => ({
  rosa: [...document.querySelectorAll('.lead-card')].some((c) => c.dataset.email === 'rosa@example.demo'),
  list: document.querySelector('[data-blocked] summary')?.textContent.trim() || '',
  emails: [...document.querySelectorAll('[data-unblock]')].map((x) => x.dataset.unblock),
})).catch(() => null);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/leads-d-blocked.png`, fullPage: true });
await tryStep(() => page.click('[data-blocked] summary', { timeout: 3000 }));
await tryStep(() => page.click('[data-unblock="rosa@example.demo"]', { timeout: 3000 }));
await page.waitForTimeout(900);
await open();
const unblocked = await page.evaluate(() => !document.querySelector('[data-blocked]')).catch(() => false);
// NEGATIVE CONTROL (run 2026-10-17): the page's `paintBlocked();` first call taken out (the list never drawn) made this read
//   FAIL  Block says what it does, takes her off Leads into a Blocked list that stays after a reload, and Unblock takes her off it
ok('Block says what it does, takes her off Leads into a Blocked list that stays after a reload, and Unblock takes her off it',
  /can't send you a question, join the waitlist or book a free call again/.test(askBlock) && !!blockedNow && !blockedNow.rosa
  && blockedNow.list === 'Blocked (1)' && JSON.stringify(blockedNow.emails) === '["rosa@example.demo"]' && unblocked,
  JSON.stringify({ askBlock, blockedNow, unblocked }));

ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
console.log(`\n${pass} ok, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
