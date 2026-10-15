// Chat search, the down arrow, and the clear cancel, tapped in a browser
// (Eric, 2026-10-15). Run against a local Worker with the demo:
//   PA_PORT=9377 node tools/drives/drive-chatsearch.mjs
//  A. search on the client's chat and on his case chat: results pop out with
//     the words highlighted, a pick lands on the message, a tap off cancels,
//     and the down arrow returns to the newest message.
//  B. the cancel: the menu at the top right offers it, the sheet opens, and
//     once cancelled the menu stops offering it.
import { chromium } from 'playwright';
const PORT = process.env.PA_PORT || 9377;
const P = `http://127.0.0.1:${PORT}`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  ok    ${n}${d ? ' -- ' + d : ''}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' -- ' + d : ''}`)); };

async function open(role, path) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addCookies([{ name: 'pa_demo', value: role, domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => { if (!/firebase-real/.test(e.message)) errs.push(e.message.slice(0, 160)); });
  await page.goto(`${P}${path}${path.includes('?') ? '&' : '?'}demo=${role}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => e.checkVisibility() && /^(Got it|Not now|Skip|Done)$/i.test(e.textContent.trim())); x?.click(); });
  await page.waitForTimeout(300);
  return { ctx, page, errs };
}

console.log('\n--- A. chat search ---');
for (const [role, path, tab] of [['client', '/chat.html', false], ['admin', '/admin-case.html?id=demo-case', true]]) {
  const { ctx, page, errs } = await open(role, path);
  if (tab) {
    await page.evaluate(() => { const t = [...document.querySelectorAll('button, [role=tab]')].find((e) => e.checkVisibility() && /Chat$/.test(e.textContent.trim()) && !e.closest('.tabs')); t?.click(); });
    await page.waitForTimeout(800);
  }
  const word = await page.evaluate(() => { const t = [...document.querySelectorAll('.chat-log .msg .msg-text')].map((e) => e.textContent).join(' '); return (t.match(/\b[a-z]{6,}\b/gi) || ['case'])[2] || 'case'; });
  await page.locator('[data-search-open]:visible').first().click();
  await page.fill('[data-search-input]', word);
  await page.waitForTimeout(300);
  const found = await page.evaluate(() => ({ results: document.querySelectorAll('.chat-result').length, marks: document.querySelectorAll('.chat-result mark').length }));
  // NEGATIVE CONTROL (run 2026-10-15): the input listener on the search box taken out made this read
  //   FAIL  client: the words pop out highlighted in every matching message
  ok(`${role}: the words pop out highlighted in every matching message`, found.results >= 1 && found.marks >= found.results, `${word} ${JSON.stringify(found)}`);
  await page.click('.chat-result');
  await page.waitForTimeout(900);
  const landed = await page.evaluate(() => {
    const el = document.querySelector('.msg.chat-found');
    const log = document.querySelector('.chat-log');
    if (!el) return null;
    const r = el.getBoundingClientRect(); const l = log.getBoundingClientRect();
    return { inView: r.top >= l.top - 2 && r.top < l.bottom, marks: el.querySelectorAll('mark.chat-hit').length, popout: !document.querySelector('[data-results]').hidden };
  });
  ok(`${role}: picking one lands on that message with its words marked`, landed && landed.inView && landed.marks >= 1 && !landed.popout, JSON.stringify(landed));
  // The search has to be open, with words marked, right before the tap, or the check below passes on a search
  // that had already closed by itself (the first control run showed exactly that on the client side).
  const pre = await page.evaluate(() => ({ bar: !document.querySelector('[data-search]').hidden, marks: document.querySelectorAll('mark.chat-hit').length }));
  // Tapped inside the conversation itself, which does nothing else: a fixed point landed on the client's thread
  // switcher, which repaints the chat and closed the search on its own.
  const spot = await page.evaluate(() => { const r = document.querySelector('.chat-log').getBoundingClientRect(); return { x: r.left + 12, y: r.top + r.height / 2 }; });
  await page.mouse.click(spot.x, spot.y);
  await page.waitForTimeout(300);
  const off = await page.evaluate(() => ({ bar: !document.querySelector('[data-search]').hidden, marks: document.querySelectorAll('mark.chat-hit').length }));
  // NEGATIVE CONTROL (run 2026-10-15, after the tap moved into the log): the tap-off listener in chat-search.js taken out made this read
  //   FAIL  client: a tap anywhere off the search cancels it and clears the marks
  //   FAIL  admin: a tap anywhere off the search cancels it and clears the marks
  ok(`${role}: a tap anywhere off the search cancels it and clears the marks`, pre.bar && pre.marks >= 1 && !off.bar && off.marks === 0, JSON.stringify({ pre, off }));
  await page.evaluate(() => { const l = document.querySelector('.chat-log'); l.scrollTop = 0; l.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(300);
  const arrow = await page.evaluate(() => !document.querySelector('.chat-bottom').hidden);
  if (arrow) { await page.click('.chat-bottom'); await page.waitForTimeout(900); }
  const atEnd = await page.evaluate(() => { const l = document.querySelector('.chat-log'); return l.scrollHeight - l.scrollTop - l.clientHeight < 5; });
  ok(`${role}: up the thread the down arrow shows and takes them back to the newest message`, arrow && atEnd);
  ok(`${role}: no page errors`, errs.length === 0, errs.join(' | '));
  await ctx.close();
}

console.log('\n--- B. the clear cancel ---');
{
  const { ctx, page, errs } = await open('client', '/case.html');
  await page.evaluate(async () => { await fetch('/api/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); });
  await page.goto(`${P}/case.html?demo=client`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => e.checkVisibility() && /^(Got it|Not now|Skip|Done)$/i.test(e.textContent.trim())); x?.click(); });
  const toggle = await page.evaluate(() => { const t = document.querySelector('.nav-toggle'); const r = t?.getBoundingClientRect(); return t && t.checkVisibility() ? Math.round(innerWidth - r.right) : -1; });
  await page.click('.nav-toggle');
  await page.waitForTimeout(300);
  const item = await page.$('.tabs.open a[data-nav-cancel]:not([hidden])');
  // NEGATIVE CONTROL (run 2026-10-15): the showCancel call taken out of hydrateNav made this read
  //   FAIL  the menu at the top right of the case screen offers Cancel subscription
  ok('the menu at the top right of the case screen offers Cancel subscription', toggle >= 0 && toggle < 80 && !!item, `toggle ${toggle}px from the right`);
  if (item) {
    await item.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    const sheet = await page.evaluate(() => { const d = document.querySelector('dialog.cancel-sheet[open]'); return d ? d.innerText.replace(/\s+/g, ' ') : ''; });
    ok('it opens a plain cancel sheet that says what happens', /Cancel 24\/7 Priority Chat\?/.test(sheet) && /stays open until/.test(sheet), sheet.slice(0, 120));
    await page.click('[data-cancel-go]');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await page.click('.nav-toggle');
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({ offered: !!document.querySelector('.tabs a[data-nav-cancel]:not([hidden])'), says: /Canceled\. Your chat stays open until/.test(document.body.innerText) }));
    ok('once cancelled, the page says so and the menu stops offering it', !after.offered && after.says, JSON.stringify(after));
  }
  ok('no page errors in the cancel', errs.length === 0, errs.join(' | '));
  await ctx.close();
}

await b.close();
console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
