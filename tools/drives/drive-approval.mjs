// drive-approval.mjs - a booking that holds the card, and his approve, decline
// and comp, in a real browser at 390px, in the demo.
//
//   PA_PORT=9377 PA_SHOTS=/some/dir node tools/drives/drive-approval.mjs
//
// Eric, 2026-09-06: "they purchase a tier, but only once I approve their case
// do they get charged, and on the approval/denial screen I can tap on the
// amount charged and change it to any value." The suite proves the table,
// the route and the wiring; this proves the thumb's path: the client books
// and their case says AWAITING APPROVAL with the held words; on his shelf the
// row says APPROVE OR DECLINE with the hold; his overview opens on the card;
// he taps the amount, types 900, approves, and the card is gone and the
// client's page is an ordinary open case; a second booking he declines with
// a reason, and the client reads it with "nothing was charged"; a third he
// takes at no charge.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const PORT = process.env.PA_PORT || 8795;
const P = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.PA_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: 'pa_demo', value: 'admin', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
const errs = [];
const dialogs = [];
const REASON = 'I am full this month and cannot give your case the time it needs.';
page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 300)));
page.on('dialog', async (d) => {
  dialogs.push(`${d.type()}: ${d.message()}`);
  if (d.type() === 'prompt') await d.accept(REASON);
  else if (d.type() === 'confirm') await d.accept();
  else await d.dismiss();
});
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  ok    ${n}${d ? ' (' + d + ')' : ''}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' (' + d + ')' : ''}`)); };
const settle = async (pg, ms = 1500) => {
  await pg.waitForTimeout(ms);
  for (let i = 0; i < 6; i++) {
    const hit = await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => /^(Got it|Not now|Skip|Close)$/i.test((e.textContent || '').trim())); if (x) x.click(); return !!x; });
    await pg.waitForTimeout(250); if (!hit) break;
  }
};
const until = async (fn, ms = 15000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await page.waitForTimeout(400);
  }
};
const ACKS = { disclaimer: 1, privacy: 1, recording: 1, service: 1, phoneConsent: 1 };

/** Reset the demo, then book as the client through the demo's checkout. */
async function bookFresh() {
  await page.goto(`${P}/case.html?demo=1`, { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.removeItem('pa-demo-store'); localStorage.removeItem('pa-demo-store-advocate'); });
  await page.reload({ waitUntil: 'networkidle' });
  await settle(page);
  const out = await page.evaluate(async (acks) => {
    const res = await fetch('/api/checkout', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'video', phone: '+1 208 555 0100', address: '1 Demo St', acks: Object.fromEntries(Object.keys(acks).map((k) => [k, Date.now()])), tz: 'America/Denver', quotedCents: 120000 }),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }, ACKS);
  return out;
}
const clientView = async () => {
  await page.goto(`${P}/case.html?id=demo-case-booked&demo=1`, { waitUntil: 'networkidle' });
  await settle(page, 2000);
  return page.evaluate(() => ({
    pill: (document.querySelector('[data-status-pill]')?.textContent || '').trim(),
    notice: (document.querySelector('[data-charge-notice]')?.textContent || '').replace(/\s+/g, ' ').trim(),
    reason: (document.querySelector('.panel h3')?.textContent || '').trim(),
    released: (document.querySelector('[data-charge-released]')?.textContent || '').trim(),
    body: (document.body.textContent || '').replace(/\s+/g, ' '),
  }));
};
const adminCard = async () => {
  await page.goto(`${P}/admin-case.html?id=demo-case-booked&demo=admin`, { waitUntil: 'networkidle' });
  await settle(page, 2000);
  await page.evaluate(() => { document.querySelector('[data-group="case"]')?.click(); document.querySelector('[data-page="overview"]')?.click(); });
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const c = document.querySelector('[data-charge-card]');
    return c ? { text: (c.textContent || '').replace(/\s+/g, ' ').trim(), amount: (c.querySelector('[data-charge-show]')?.textContent || '').trim() } : null;
  });
};

console.log('\n--- A. the booking holds the card, and the client sees it ---');
const booked = await bookFresh();
ok('the demo takes the booking', booked.status === 200 && /return\.html/.test(booked.body.url || ''), JSON.stringify(booked));
const v1 = await clientView();
ok('the pill reads AWAITING APPROVAL', v1.pill === 'AWAITING APPROVAL', v1.pill);
ok('and the card says the card is held, not charged, in the Worker\'s words', /^Your card is held, not charged Your card is held, not charged\. I read every new case before I take it on, and you are charged only when I do\. If I cannot take your case, the hold is released and nothing is charged\.$/.test(v1.notice), v1.notice.slice(0, 120));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-client-held.png` });

console.log('\n--- B. his shelf and his card ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(page);
const row = await page.evaluate(() => {
  const a = [...document.querySelectorAll('a[href*="admin-case"]')].find((x) => /demo-case-booked/.test(x.getAttribute('href') || ''));
  const r = a?.closest('li, .row, .case-row, div');
  return (r?.textContent || a?.textContent || '').replace(/\s+/g, ' ');
});
ok('the shelf row says APPROVE OR DECLINE with the hold', /APPROVE OR DECLINE · \$1,200 held/.test(row), row.slice(0, 100));
const card1 = await adminCard();
ok('his overview opens on the approval card, holding $1,200', !!card1 && /holding \$1,200 since/.test(card1.text) && card1.amount === '1,200', JSON.stringify(card1));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-admin-card.png` });

console.log('\n--- C. tap the amount, type 900, approve ---');
await page.click('[data-charge-tap]');
await page.fill('[data-charge-in]', '900');
const shown = await page.evaluate(() => ({ show: document.querySelector('[data-charge-show]')?.textContent, btn: document.querySelector('[data-charge-btn]')?.textContent }));
ok('the amount and the button follow what he typed', shown.show === '900' && shown.btn === '900', JSON.stringify(shown));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-amount-typed.png` });
const before = dialogs.length;
await page.click('[data-charge="approve"]');
await page.waitForTimeout(1500);
ok('approving asks first, naming the figure', dialogs.slice(before).some((m) => /^confirm: Charge \$900 and take the case\?/.test(m)), dialogs.slice(before).join(' | '));
const gone = await until(() => !document.querySelector('[data-charge-card]') ? 'gone' : null);
ok('and the card is gone', gone === 'gone');
const v2 = await clientView();
ok('the client\'s case is an ordinary open case now', v2.pill !== 'AWAITING APPROVAL' && !v2.notice, JSON.stringify({ pill: v2.pill, notice: v2.notice.slice(0, 40) }));
const paid = await page.evaluate(() => { try { const s = JSON.parse(localStorage.getItem('pa-demo-store') || '{}'); const e = (s.docs || []).find(([p]) => p === 'cases/demo-case-booked'); return e ? e[1]?.charge : null; } catch { return null; } });
ok('the record says captured, $900', !!paid && paid.state === 'captured' && paid.capturedCents === 90000, JSON.stringify(paid));

console.log('\n--- D. a second booking, declined with his reason ---');
await bookFresh();
await adminCard();
const before2 = dialogs.length;
await page.click('[data-charge="decline"]');
await page.waitForTimeout(1500);
ok('declining asks for the reason', dialogs.slice(before2).some((m) => /^prompt: Why can't you take this one\?/.test(m)), dialogs.slice(before2).join(' | '));
await until(() => !document.querySelector('[data-charge-card]') ? 'gone' : null);
const v3 = await clientView();
ok('the client reads CLOSED, the reason word for word, and that nothing was charged', v3.pill === 'CLOSED' && v3.body.includes(REASON) && v3.released === 'Nothing was charged. The hold on your card is released.', JSON.stringify({ pill: v3.pill, released: v3.released }));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/04-client-declined.png` });

console.log('\n--- E. a third booking, taken at no charge ---');
await bookFresh();
await adminCard();
await page.click('[data-charge-tap]');
await page.fill('[data-charge-in]', '0');
const before3 = dialogs.length;
await page.click('[data-charge="approve"]');
await page.waitForTimeout(1500);
ok('zero asks about no charge', dialogs.slice(before3).some((m) => /^confirm: Take the case at no charge\?/.test(m)), dialogs.slice(before3).join(' | '));
await until(() => !document.querySelector('[data-charge-card]') ? 'gone' : null);
const comped = await page.evaluate(() => { try { const s = JSON.parse(localStorage.getItem('pa-demo-store') || '{}'); const e = (s.docs || []).find(([p]) => p === 'cases/demo-case-booked'); return e ? e[1]?.charge : null; } catch { return null; } });
ok('the record says comped, nothing captured', !!comped && comped.state === 'comped' && comped.capturedCents === 0, JSON.stringify(comped));
const v4 = await clientView();
ok('and the client\'s case is open with no hold card', v4.pill !== 'AWAITING APPROVAL' && !v4.notice, v4.pill);

await b.close();
console.log(`\n${pass} ok, ${fail} failed${errs.length ? `\n${errs.join('\n')}` : ''}`);
if (fail || errs.length) process.exit(1);
