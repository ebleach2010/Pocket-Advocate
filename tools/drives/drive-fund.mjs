// drive-fund.mjs - the Community Assistance Fund, driven end to end in the
// demo at phone width (2026-10-04).
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-fund.mjs
//
// A: the applicant walks all six steps: names, an ID, two medical documents
//    picked together, the Discord box, Yes, a photo with its consent, Venmo.
//    A card number typed as a payment handle is refused and stays in the box.
//    A reload resumes on the step they were on. Submit lands on the status.
// B: the reviewer's queue lists it; opening it starts the review; a document
//    opens in place as a blob; Decline with no reason is stopped; Verify on
//    someone else's works and sets the status; on his own application Verify
//    is greyed out with Eric's sentence.
// C: nothing on either page is wider than a 390px screen.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const P = `http://127.0.0.1:${process.env.PA_PORT || 8795}`;
const SHOTS = process.env.PA_SHOTS || '/tmp/pa-shots';
mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};
const pdf = (n) => ({ name: `labs-${n}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4\n% demo ${n}\n%%EOF\n`) });
const png = (name) => ({ name, mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a5f50000000049454e44ae426082', 'hex') });

const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: 'pa_demo', value: 'admin', domain: '127.0.0.1', path: '/' }]);
const errors = [];
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(`client: ${e.message}`));
const wide = async (pg) => pg.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
const text = async (pg) => (await pg.textContent('#fund')) || '';
const step = async (n) => page.waitForFunction((k) => document.querySelector('.fund-progress-label')?.textContent === `Step ${k} of 6`, n, { timeout: 8000 }).then(() => true).catch(() => false);

// ---- A: the applicant ----------------------------------------------------------
await page.goto(`${P}/fund.html?demo=1`, { waitUntil: 'networkidle' });
check('A1 a new applicant lands on Step 1 of 6, Community Information', await step(1) && /Community Information/.test(await text(page)));
await page.click('#fund-next');
check('A2 Continue with nothing typed says what is missing and moves nowhere', /Add your Discord username or display name\./.test(await text(page)) && await step(1));
await page.fill('#f-discordUsername', 'river_k');
await page.fill('#f-preferredName', 'River');
await page.fill('#f-legalName', 'River Kowalski');
await page.screenshot({ path: `${SHOTS}/fund-1.png`, fullPage: true });
await page.click('#fund-next');
check('A3 Continue saves and moves to Step 2, Identity Verification, and says it saved', await step(2) && /Saved\. You can stop here and come back any time\./.test(await text(page)) && /redact information we do not need/.test(await text(page)));
await page.setInputFiles('[data-file="id"]', png('license.png'));
await page.waitForFunction(() => /Uploaded/.test(document.querySelector('[data-upmsg="id"]')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
const t2 = await text(page);
check('A4 the ID lands with a tick, its type and size, and never its file name', /✓ Uploaded\./.test(t2) && /ID document/.test(t2) && /PNG/.test(t2) && !/license\.png/.test(t2));
await page.click('#fund-next');
await step(3);
await page.setInputFiles('[data-file="medical"]', [pdf(1), pdf(2)]);
await page.waitForFunction(() => /2 files uploaded/.test(document.querySelector('[data-upmsg="medical"]')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
const t3 = await text(page);
check('A5 two medical documents picked together both land, numbered, with no names', /2 files uploaded/.test(t3) && /Medical document 1/.test(t3) && /Medical document 2/.test(t3) && !/labs-1/.test(t3) && /You may redact diagnoses, medications, test results/.test(t3));
await page.fill('#f-applicantNote', 'My portal letter is the second one.');
await page.screenshot({ path: `${SHOTS}/fund-3.png`, fullPage: true });
await page.click('#fund-next');
await step(4);
await page.click('#fund-next');
check('A6 Step 4 asks for the Discord box first', /Confirm that you are a member of the Discord community\./.test(await text(page)));
await page.check('[data-c="discordMember"]');
await page.click('.fund-choice:has(input[value="yes"])');
await page.setInputFiles('[data-file="photo"]', png('me.png'));
await page.waitForSelector('[data-c="photoPublicConsent"]', { timeout: 8000 }).catch(() => {});
await page.click('#fund-next');
check('A7 a photo without its public-use consent is held at Step 4 with the reason', await step(4) && /Tick the box that lets the photo be shown on the GoFundMe page/.test(await text(page)));
await page.check('[data-c="photoPublicConsent"]');
await page.click('#fund-next');
check('A8 then Step 5, Payment Information', await step(5) && /Never enter passwords, PINs, card numbers or bank login details\./.test(await text(page)));
await page.click('.fund-choice:has(input[value="paypal"])');
await page.fill('#f-handle', '4111 1111 1111 1111');
await page.click('#fund-next');
await page.waitForFunction(() => !document.querySelector('#fund-error')?.hidden, null, { timeout: 8000 }).catch(() => {});
check('A9 a card number as a payment handle is refused in plain words and stays in the box', /leave out passwords, PINs, card numbers/.test(await text(page)) && (await page.inputValue('#f-handle')) === '4111 1111 1111 1111' && await step(5));
await page.click('.fund-choice:has(input[value="venmo"])');
await page.fill('#f-handle', '@river-k');
await page.click('#fund-next');
check('A10 Venmo with a username moves on to Step 6', await step(6));
await page.reload({ waitUntil: 'networkidle' });
check('A11 a reload resumes on Step 6, with the summary of what is being sent', await step(6) && /2 medical documents/.test(await text(page)) && /Payment: Venmo/.test(await text(page)));
await page.click('#fund-next');
check('A12 Submit with the statements unticked is stopped', /Tick all five statements\./.test(await text(page)));
for (const k of ['accurate', 'noGuarantee', 'notMedical', 'reviewerView', 'formula']) await page.check(`[data-c="consent:${k}"]`);
await page.screenshot({ path: `${SHOTS}/fund-6.png`, fullPage: true });
await page.click('#fund-next');
await page.waitForSelector('.fund-pill', { timeout: 8000 }).catch(() => {});
const ts = await text(page);
check('A13 Submit for Verification lands on the status page: Submitted, nothing more to do', /Submitted/i.test(ts) && /Thank you\. Your application is in\./.test(ts) && !/medically approved/i.test(ts));
await page.screenshot({ path: `${SHOTS}/fund-status.png`, fullPage: true });
check('A14 the help line is on the page', /Need help\? Email office@pocketadvocacy\.com/.test((await page.textContent('body')) || ''));
const wideClient = await wide(page);

// ---- B: the reviewer -----------------------------------------------------------
const adm = await ctx.newPage();
adm.on('pageerror', (e) => errors.push(`admin: ${e.message}`));
await adm.goto(`${P}/admin-fund.html?demo=admin`, { waitUntil: 'networkidle' });
await adm.waitForSelector('.fq-row', { timeout: 8000 }).catch(() => {});
const q = (await adm.textContent('#fq')) || '';
check('B1 the queue lists the new application under Waiting with his own flagged', /River/.test(q) && /Sam/.test(q) && /your own/.test(q));
await adm.screenshot({ path: `${SHOTS}/fund-queue.png`, fullPage: true });
await adm.click('.fq-row:has-text("River")');
await adm.waitForSelector('.fq-head', { timeout: 8000 }).catch(() => {});
const v = (await adm.textContent('#fq')) || '';
check('B2 opening it starts the review and shows everything a reviewer needs', /Under Review/i.test(v) && /River Kowalski/.test(v) && /Medical document 2/.test(v) && /Venmo · @river-k/.test(v) && /My portal letter is the second one\./.test(v) && /Opened the application/.test(v) && /Review started/.test(v));
await adm.click('[data-open][data-kind="medical"]');
await adm.waitForSelector('.fq-preview iframe, .fq-preview img', { timeout: 8000 }).catch(() => {});
const src = await adm.getAttribute('.fq-preview iframe, .fq-preview img', 'src').catch(() => '');
check('B3 a document opens in place from a blob, never a storage address', /^blob:/.test(src || ''));
await adm.click('[data-act="decline"]');
await adm.click('#fq-go');
check('B4 Decline with no internal reason is stopped', /Write a brief internal reason first\./.test((await adm.textContent('#fq')) || ''));
await adm.click('#fq-cancel');
await adm.click('[data-act="verify"]');
await adm.click('#fq-go');
await adm.waitForFunction(() => /Verified/.test(document.querySelector('.fq-head')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
const vv = (await adm.textContent('#fq')) || '';
check('B5 Verify on someone else\'s application verifies it, sets a reverification date and writes the history', /Verified/.test(vv) && /Reverification due/.test(vv) && /You Verified/.test(vv));
await adm.screenshot({ path: `${SHOTS}/fund-review.png`, fullPage: true });
const wideAdmin = await wide(adm);
await adm.goto(`${P}/admin-fund.html?demo=admin#uid=demo-admin`, { waitUntil: 'networkidle' });
await adm.waitForSelector('.fq-head', { timeout: 8000 }).catch(() => {});
const ownDisabled = await adm.isDisabled('[data-act="verify"]').catch(() => false);
check('B6 on his own application Verify is greyed out with Eric\'s sentence', ownDisabled && /Your verification must be completed by another authorized reviewer\./.test((await adm.textContent('#fq')) || ''));
await adm.screenshot({ path: `${SHOTS}/fund-own.png`, fullPage: true });

await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.fund-pill', { timeout: 8000 }).catch(() => {});
const tv = await text(page);
check('B7 the applicant\'s status page then reads Verified with the date, participation and next reverification', /You are a verified participant\./.test(tv) && /Verification date/.test(tv) && /Active: receiving distributions/.test(tv) && /Next reverification/.test(tv));
await page.screenshot({ path: `${SHOTS}/fund-verified.png`, fullPage: true });

check('C1 nothing is wider than the screen on the form or the queue', !wideClient && !wideAdmin && !(await wide(page)));
check('C2 no script error on either page', errors.length === 0, errors.join(' | '));
await b.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
