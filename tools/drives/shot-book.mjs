// Photograph the booking flow the way a client sees it: a 390x844 phone, the
// demo scaffolding taken off first, and each of the three steps measured so a
// restyle can be argued about in pixels rather than adjectives.
//
// Not part of the drive suite. PA_PORT picks the static server, PA_OUT the
// directory to write into.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = process.env.PA_PORT || 8812;
const P = `http://127.0.0.1:${PORT}`;
const OUT = process.env.PA_OUT || '/tmp/book-shots';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

/** Take the demo scaffolding off before anything is photographed. */
async function undemo() {
  for (const re of [/not now/i, /done/i, /dismiss/i, /close/i]) {
    const btn = page.locator('button', { hasText: re }).first();
    if (await btn.count().catch(() => 0)) {
      await btn.click({ timeout: 800 }).catch(() => {});
      await page.waitForTimeout(200);
    }
  }
  await page.evaluate(() => {
    document.querySelectorAll('.demo-bar, .pa-demo-bar, dialog[open]').forEach((e) => e.remove());
    // The demo suite's own "Start the demo" card is bolted on after #step and
    // is worth 300px of the page height. It is not part of the flow.
    document.querySelector('[data-suite-go]')?.closest('#step + div')?.remove();
    document.documentElement.style.setProperty('--demo-bar-h', '0px');
  });
  await page.waitForTimeout(250);
}

const rows = [];
async function shot(name) {
  await undemo();
  // Instant, not smooth: site.css sets scroll-behavior:smooth and a screenshot
  // taken mid-animation photographs the page halfway there.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => ({
    doc: document.documentElement.scrollHeight,
    step: document.getElementById('step')?.getBoundingClientRect().height || 0,
  }));
  // The fold first: a fullPage capture resizes the viewport and leaves the
  // scroll position somewhere else, so taking it second photographs mid-page.
  await page.screenshot({ path: `${OUT}/${name}-fold.png` });
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  // 44px is the floor for anything a thumb has to hit.
  const small = await page.evaluate(() => [...document.querySelectorAll(
    '#step button, #step a, #step summary, #step input, #step label.chip-label, #step .agreement-check')]
    .map((e) => ({ e, r: e.getBoundingClientRect() }))
    .filter(({ e, r }) => r.width > 0 && r.height > 0 && r.height < 44 && e.type !== 'hidden')
    .map(({ e, r }) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${e.className || ''} ${Math.round(r.width)}x${Math.round(r.height)}`));
  rows.push({ name, ...m, small });
  console.log(`  ${name.padEnd(22)} doc ${String(Math.round(m.doc)).padStart(5)}px  (${(m.doc / 844).toFixed(2)} screens)  step ${Math.round(m.step)}px`);
  if (small.length) console.log(`    under 44px: ${small.join(' | ')}`);
  return m;
}

await page.goto(`${P}/book.html?demo=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await shot('step1');

// The refusal a client meets: pick a time, leave the phone number empty, tap.
const slot = page.locator('#step button').filter({ hasText: /AM|PM/ }).first();
if (await slot.count()) { await slot.click(); await page.waitForTimeout(900); }
if (await page.locator('#pf-first').count()) {
  await page.fill('#pf-first', 'Jordan');
  await page.fill('#pf-last', 'Avery');
  await page.fill('#pf-dob', '1988-03-14');
}
if (await page.locator('#phone-consent').count()) await page.check('#phone-consent');
await page.waitForTimeout(300);
// Tap it where it actually sits, at the bottom of the page, the way a client
// does. Do NOT scroll to the top first: the whole question is whether the
// reason for the refusal ends up somewhere they can see.
await page.locator('#continue').scrollIntoViewIfNeeded().catch(() => {});
await page.locator('#continue').click({ timeout: 3000 }).catch(() => {});
await page.waitForTimeout(900);
const seen = await page.evaluate(() => {
  const errors = [...document.querySelectorAll('.error, .field-error')].filter((e) => !e.hidden);
  return errors.map((e) => {
    const r = e.getBoundingClientRect();
    return { text: e.textContent.trim().slice(0, 70), top: Math.round(r.top),
      inView: r.bottom > 0 && r.top < innerHeight };
  });
});
console.log('  refusal:', JSON.stringify(seen));
await page.screenshot({ path: `${OUT}/step1-refused-fold.png` });

// Now finish it properly and walk on.
if (await page.locator('#phone').isVisible().catch(() => false))
  await page.fill('#phone', '+1 555 555 5555');
await page.locator('#continue').click().catch(() => {});
await page.waitForTimeout(1600);
await shot('step2');

const partShots = await page.evaluate(async () => {
  const parts = [...document.querySelectorAll('#step details.agreement')];
  const out = [];
  for (const d of parts) {
    d.open = true;
    await new Promise((r) => setTimeout(r, 150));
    const body = d.querySelector('.agreement-body');
    if (body) {
      body.scrollTop = Math.round(body.scrollHeight / 2);
      body.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 150));
    out.push(d.dataset.id);
  }
  return out;
});
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/step2-open-fold.png` });
await page.screenshot({ path: `${OUT}/step2-open.png`, fullPage: true });
console.log('  parts opened:', partShots.join(', '));

await page.evaluate(async () => {
  for (const d of document.querySelectorAll('#step details.agreement')) {
    const body = d.querySelector('.agreement-body');
    if (body) {
      body.scrollTop = body.scrollHeight;
      body.dispatchEvent(new Event('scroll', { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 120));
    const box = d.querySelector('.agreement-check input');
    if (box && !box.disabled && !box.checked) {
      box.checked = true;
      box.dispatchEvent(new Event('change', { bubbles: true }));
    }
    d.open = false;
  }
});
await page.waitForTimeout(400);
await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/step2-done-fold.png` });
await page.locator('#continue').click().catch(() => {});
await page.waitForTimeout(1600);
await shot('step3');

writeFileSync(`${OUT}/heights.json`, JSON.stringify(rows, null, 2));
if (errs.length) console.log('  page errors:', errs.slice(0, 3));
await b.close();
