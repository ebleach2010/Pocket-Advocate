// drive-leads.mjs - a lead's messages beside them on Leads, on his phone (v7.68).
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

ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
console.log(`\n${pass} ok, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
