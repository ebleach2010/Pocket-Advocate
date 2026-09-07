// drive-terms.mjs - a painted term into the dictionary, and a draft that
// lands, in a real browser at 390px, in the demo.
//
//   PA_PORT=9377 PA_SHOTS=/some/dir node tools/drives/drive-terms.mjs
//
// Eric, 2026-09-06: "Drafting has stopped working. Tapping on a term does not
// bring me to it in the dictionary." The suite pins the reads and the copy;
// this proves the thumb's path: a painted term in the reading, tapped, opens
// the dictionary AT that term and lights it; a term the dictionary does not
// hold says so at the top instead of leaving him at the top of the page; the
// Key terms page's link lands the same way; Prepare a response lands a draft
// on the Drafts page; the chat's message maker turns his rough line into the
// full message in the box; and his own case (which is how the showcase was
// built) offers neither, and refuses a draft asked for straight with why.
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
page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 300)));
page.on('dialog', async (d) => { dialogs.push(d.message()); if (d.type() === 'confirm') await d.accept(); else await d.dismiss(); });
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  ok    ${n}${d ? ' (' + d + ')' : ''}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' (' + d + ')' : ''}`)); };
const idOf = (u) => new URL(u.toString()).searchParams.get('id');
const settle = async (pg, ms = 1500) => {
  await pg.waitForTimeout(ms);
  for (let i = 0; i < 6; i++) {
    const hit = await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => /^(Got it|Not now|Skip|Close)$/i.test((e.textContent || '').trim())); if (x) x.click(); return !!x; });
    await pg.waitForTimeout(250); if (!hit) break;
  }
};
const show = async (group, pg) => {
  await page.evaluate(([g, p]) => { document.querySelector(`[data-group="${g}"]`)?.click(); document.querySelector(`[data-page="${p}"]`)?.click(); }, [group, pg]);
  await page.waitForTimeout(600);
};
const until = async (fn, ms = 20000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await page.waitForTimeout(400);
  }
};

console.log('\n--- A. a painted term is a door into the dictionary ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.removeItem('pa-demo-store'); localStorage.removeItem('pa-demo-store-advocate'); });
await page.reload({ waitUntil: 'networkidle' });
await settle(page);
// A client's case: the first on the shelf that is neither his own nor the showcase.
const caseHref = await page.evaluate(() => [...document.querySelectorAll('a[href*="admin-case"]')]
  .map((a) => a.getAttribute('href')).find((h) => !/mine|showcase/.test(h || '')));
ok('the shelf lists a client\'s case', !!caseHref, caseHref || '');
const caseUrl = /^https?:/.test(caseHref || '') ? caseHref : `${P}${caseHref}`;
await page.goto(caseUrl, { waitUntil: 'networkidle' });
await settle(page, 2000);
await show('read', 'advisor');
const term = await until(() => document.querySelector('mark.tm[data-tm]')?.dataset.tm || null);
ok('the reading paints a term', !!term, term || '');
if (term) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-painted-term.png` });
  await page.click('mark.tm[data-tm]');
  await page.waitForURL((u) => /admin-dictionary/.test(u.toString()), { timeout: 15000 });
  await page.waitForSelector('.gloss-item', { timeout: 15000 });
  await page.waitForTimeout(500);
  const landed = await page.evaluate(() => {
    const h = document.querySelector('.gloss-item.dict-hit');
    return { hash: location.hash, hit: h ? (h.querySelector('strong')?.textContent || '').trim().toLowerCase() : '', missing: !!document.querySelector('[data-dict-missing]') };
  });
  ok('and the dictionary opens at that term, lit', landed.hit === term && !landed.missing, JSON.stringify(landed));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-dictionary-lit.png` });
}

console.log('\n--- B. a term the dictionary does not hold says so ---');
await page.goto(`${P}/admin-dictionary.html?demo=admin#k=no%20such%20term`, { waitUntil: 'networkidle' });
await page.waitForSelector('.gloss-item', { timeout: 15000 });
await page.waitForTimeout(400);
const missing = await page.evaluate(() => ({
  note: (document.querySelector('[data-dict-missing]')?.textContent || '').trim(),
  lit: !!document.querySelector('.dict-hit'),
  first: (document.querySelector('#dict p')?.textContent || '').trim(),
}));
ok('the line at the top names the word and says how a term gets in', /^"no such term" is not in your dictionary\. A term is added when it comes up in your chat, in a question you ask or the answer you get, or in a document, a little after the reading that met it there\.$/.test(missing.note) && !missing.lit && missing.first === missing.note, JSON.stringify(missing));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-dictionary-missing.png` });

console.log('\n--- C. the Key terms page links the same way ---');
await page.goto(caseUrl, { waitUntil: 'networkidle' });
await settle(page, 2000);
await show('read', 'education');
const jump = await until(() => document.querySelector('a.term-jump')?.getAttribute('href') || null);
ok('a term on the Key terms page is a link into the dictionary', /^\/admin-dictionary\.html#k=/.test(jump || ''), jump || '');
if (jump) {
  await page.click('a.term-jump');
  await page.waitForURL((u) => /admin-dictionary/.test(u.toString()), { timeout: 15000 });
  await page.waitForSelector('.gloss-item', { timeout: 15000 });
  await page.waitForTimeout(500);
  const lit = await page.evaluate(() => !!document.querySelector('.gloss-item.dict-hit') && !document.querySelector('[data-dict-missing]'));
  ok('and lands lit', lit);
}

console.log('\n--- D. Prepare a response lands a draft ---');
await page.goto(caseUrl, { waitUntil: 'networkidle' });
await settle(page, 2000);
// The panel's foot (Prepare a response and the Ask box) lives on the Ask page.
await show('read', 'advisor-chat');
const prep = await until(() => { const b = document.querySelector('[data-prep]'); return b && !b.disabled ? (b.textContent || '').trim() : null; });
ok('the Ask page offers Prepare a response', /Prepare a response/.test(prep || ''), prep || '');
await page.click('[data-prep]');
await page.waitForSelector('#pa-prep [data-inst]', { timeout: 5000 });
await page.fill('#pa-prep [data-inst]', 'Tell them I will chase the referral by Thursday');
await page.click('#pa-prep [data-go]');
const drafting = await until(() => /Drafting/.test(document.querySelector('[data-prep]')?.textContent || '') ? 'drafting' : null, 5000);
ok('the button says Drafting while it runs', drafting === 'drafting');
// Drafts live on their own page (Mine, Drafts): the panel hands the card to
// #draft-panel there and walks him to it when the draft he asked for lands.
const draftText = await until(() => {
  const card = document.querySelector('#draft-panel') || document.querySelector('[data-draft-card]');
  // The draft sits in an editable box, so it is the box's value, not text.
  const t = (card && !card.hidden) ? (card.querySelector('[data-dtext]')?.value || '') : '';
  return /Thursday/.test(t) ? t.replace(/\s+/g, ' ').slice(0, 160) : null;
});
ok('and the draft lands in its box on the Drafts page, built from the instruction', !!draftText, draftText || 'no draft within 20 s');
const onDrafts = await page.evaluate(() => { const p = document.querySelector('#draft-panel'); return !!p && p.getBoundingClientRect().height > 0; });
ok('and the page walked him to it', onDrafts);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/04-draft-landed.png` });

console.log('\n--- E. the chat\'s message maker fills the box ---');
await show('case', 'chat');
const maker = await until(() => {
  const btn = document.querySelector('[data-extra][title="Make what I typed a full message"]');
  const box = btn?.closest('form')?.querySelector('textarea') || btn?.closest('.composer')?.querySelector('textarea');
  return btn && box ? 'ready' : null;
});
ok('the composer carries the maker beside a box', maker === 'ready');
await page.evaluate(() => {
  const btn = document.querySelector('[data-extra][title="Make what I typed a full message"]');
  const box = btn.closest('form')?.querySelector('textarea') || btn.closest('.composer')?.querySelector('textarea');
  box.value = 'chasing the referral, will know Thursday';
  box.dispatchEvent(new Event('input', { bubbles: true }));
  btn.click();
});
const made = await until(() => {
  const btn = document.querySelector('[data-extra][title="Make what I typed a full message"]');
  const box = btn?.closest('form')?.querySelector('textarea') || btn?.closest('.composer')?.querySelector('textarea');
  const v = box?.value || '';
  return /Thursday/.test(v) && v.length > 80 ? v.slice(0, 120) : null;
});
ok('and the rough line comes back as the full message, in the box', !!made, made || 'nothing within 20 s');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/05-maker-filled.png` });

console.log('\n--- F. his own case says why it will not draft ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(page);
await page.click('[data-open-door="self"]');
await page.waitForTimeout(300);
await page.fill('[data-of="self:firstName"]', 'Eric');
await page.fill('[data-of="self:lastName"]', 'Bleach');
await page.click('[data-open-go="self"]');
await page.waitForURL((u) => /admin-case(\.html)?\?id=/.test(u.toString()), { timeout: 15000 });
await settle(page, 2000);
await show('read', 'advisor-chat');
const ownPrep = await page.evaluate(() => !!document.querySelector('[data-prep]'));
ok('the Ask page does not offer Prepare a response on his own case', !ownPrep);
await show('case', 'chat');
const ownMaker = await page.evaluate(() => !!document.querySelector('[data-extra][title="Make what I typed a full message"]'));
ok('and the chat carries no message maker there', !ownMaker);
// The route itself, asked straight: the same refusal the Worker gives.
const refused = await page.evaluate(async (id) => {
  const res = await fetch('/api/advisor', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'draft', kind: 'case', id, instruction: 'x' }) });
  return { status: res.status, error: (await res.json().catch(() => ({}))).error || '' };
}, idOf(page.url()));
ok('and a draft asked for straight is refused with why', refused.status === 409 && refused.error === 'Your own case has nobody to write to.', JSON.stringify(refused));

await b.close();
console.log(`\n${pass} ok, ${fail} failed${errs.length ? `\n${errs.join('\n')}` : ''}`);
if (fail || errs.length) process.exit(1);
