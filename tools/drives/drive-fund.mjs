// drive-fund.mjs - the Community Assistance Fund, driven end to end in the
// demo at phone width (2026-10-04).
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-fund.mjs
//
// A: the applicant walks all six steps: names, an ID, two medical documents
//    picked together, why they are in need, the Discord box beside its
//    invite, Yes, a photo with its consent, a check in the mail with the
//    address. A card number typed as a payment handle is refused and stays in
//    the box. A reload resumes on the step they were on. Submit lands on the
//    status with the Home Screen steps. (2026-10-04, v7.25: check only, so the
//    card number goes in the street address, and there is no method to pick.)
// B: the reviewer's queue lists it; opening it starts the review; a document
//    opens in place as a blob; Decline with no reason is stopped; Verify
//    works and sets the status. Then the week's pool is posted, shared by the
//    two taking part, and River's check is marked sent with its ID. The
//    applicant sees the share and the payout. (2026-10-04, v7.24: Eric never
//    applies, so his own application is held by fund.mjs F6 alone.) v7.25:
//    the pool is monthly and the payout a check with its number; the alerts
//    card sends a test; the nav is Fund and PR 1, and PR 1 opens the hub,
//    which opens Clients and Services.
// C: nothing on either page is wider than a 390px screen.
// D (v7.25): a client who opens /services.html lands on the fund page.
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
await page.click('#fund-next');
check('A5b Step 3 asks why they are in need before moving on', /Tell us briefly why you are in need\./.test(await text(page)) && await step(3));
await page.fill('#f-needStatement', 'I stopped working in May and the copays take what is left.');
check('A5c the counter counts down from 1500', /1442 characters left/.test(await text(page)));
await page.fill('#f-applicantNote', 'My portal letter is the second one.');
await page.screenshot({ path: `${SHOTS}/fund-3.png`, fullPage: true });
await page.click('#fund-next');
await step(4);
await page.click('#fund-next');
check('A6 Step 4 asks for the Discord box first, with the invite beside it', /Confirm that you are a member of the Discord community\./.test(await text(page))
  && (await page.getAttribute('a:has-text("Join the Discord")', 'href')) === 'https://discord.gg/YZXYQFjUGa');
await page.check('[data-c="discordMember"]');
await page.click('.fund-choice:has(input[value="yes"])');
await page.setInputFiles('[data-file="photo"]', png('me.png'));
await page.waitForSelector('[data-c="photoPublicConsent"]', { timeout: 8000 }).catch(() => {});
await page.click('#fund-next');
check('A7 a photo without its public-use consent is held at Step 4 with the reason', await step(4) && /Tick the box that lets the photo be shown on the GoFundMe page/.test(await text(page)));
await page.check('[data-c="photoPublicConsent"]');
await page.click('#fund-next');
// RE-PINNED 2026-10-04 (v7.25): check only. Step 5 asks for the check straight away, with no method
// to pick, and says when checks are mailed; the card number is typed into the street address.
check('A8 then Step 5, Payment Information', await step(5) && /Never enter passwords, PINs, card numbers or bank details\./.test(await text(page))
  && /Distributions are mailed by check on the 1st of each month, starting November 1\./.test(await text(page)) && !(await page.$('input[name="method"]')));
check('A10a a check in the mail asks for the name and the address and says Mercury, 7 to 10 business days', /Checks are sent from Mercury and take 7 to 10 business days to arrive\./.test(await text(page)) && !!(await page.$('#f-addr-zip')));
await page.fill('#f-accountName', 'River Kowalski');
await page.fill('#f-addr-line1', '4111 1111 1111 1111');
await page.fill('#f-addr-city', 'Boise');
await page.fill('#f-addr-state', 'ID');
await page.fill('#f-addr-zip', '83702');
await page.click('#fund-next');
await page.waitForFunction(() => !document.querySelector('#fund-error')?.hidden, null, { timeout: 8000 }).catch(() => {});
check('A9 a card number in the street address is refused in plain words and stays in the box', /leave out passwords, PINs, card numbers/.test(await text(page)) && (await page.inputValue('#f-addr-line1')) === '4111 1111 1111 1111' && await step(5));
await page.fill('#f-addr-line1', '88 Pin Oak Dr');
await page.fill('#f-addr-zip', '');
await page.click('#fund-next');
check('A10b a missing ZIP is asked for and nothing typed is lost', /Add the five-digit ZIP code\./.test(await text(page)) && (await page.inputValue('#f-addr-line1')) === '88 Pin Oak Dr');
await page.fill('#f-addr-zip', '83702');
await page.screenshot({ path: `${SHOTS}/fund-5.png`, fullPage: true });
await page.click('#fund-next');
check('A10 the check with its address moves on to Step 6', await step(6));
await page.reload({ waitUntil: 'networkidle' });
check('A11 a reload resumes on Step 6, with the summary of what is being sent', await step(6) && /2 medical documents/.test(await text(page)) && /Payment: Check to Boise/.test(await text(page)));
await page.click('#fund-next');
check('A12 Submit with the statements unticked is stopped', /Tick all five statements\./.test(await text(page)));
for (const k of ['accurate', 'noGuarantee', 'notMedical', 'reviewerView', 'formula']) await page.check(`[data-c="consent:${k}"]`);
await page.screenshot({ path: `${SHOTS}/fund-6.png`, fullPage: true });
await page.click('#fund-next');
await page.waitForSelector('.fund-pill', { timeout: 8000 }).catch(() => {});
const ts = await text(page);
check('A13 Submit for Verification lands on the status page: Submitted, nothing more to do', /Submitted/i.test(ts) && /Thank you\. Your application is in\./.test(ts) && !/medically approved/i.test(ts));
await page.screenshot({ path: `${SHOTS}/fund-status.png`, fullPage: true });
check('A14 the help line is on the page, and the Home Screen steps and the notifications card are on the status', /Need help\? Email office@pocketadvocacy\.com/.test((await page.textContent('body')) || '')
  && /Get updates on your phone/.test(ts) && /Add this page to your Home Screen/.test(ts) && /Without notifications, the same updates come to your email\./.test(ts));
const wideClient = await wide(page);

// ---- B: the reviewer -----------------------------------------------------------
const adm = await ctx.newPage();
adm.on('pageerror', (e) => errors.push(`admin: ${e.message}`));
await adm.goto(`${P}/admin-fund.html?demo=admin`, { waitUntil: 'networkidle' });
await adm.waitForSelector('.fq-row', { timeout: 8000 }).catch(() => {});
const q = (await adm.textContent('#fq')) || '';
// RE-PINNED 2026-10-04 (v7.24): he never applies, so nothing in the demo queue is his own.
check('B1 the queue lists the new application under Waiting beside Sam, and none is his own', /River/.test(q) && /Sam/.test(q) && !/your own/.test(q));
await adm.screenshot({ path: `${SHOTS}/fund-queue.png`, fullPage: true });
await adm.click('.fq-row:has-text("River")');
await adm.waitForSelector('.fq-head', { timeout: 8000 }).catch(() => {});
const v = (await adm.textContent('#fq')) || '';
// RE-PINNED 2026-10-04 (v7.25): the mailing line is the shared checkTo() words, with commas.
check('B2 opening it starts the review and shows everything a reviewer needs', /Under Review/i.test(v) && /River Kowalski/.test(v) && /Medical document 2/.test(v) && /Check to River Kowalski, 88 Pin Oak Dr, Boise, ID 83702/.test(v) && /I stopped working in May/.test(v) && /My portal letter is the second one\./.test(v) && /Opened the application/.test(v) && /Review started/.test(v));
await adm.click('[data-open][data-kind="medical"]');
await adm.waitForSelector('.fq-preview iframe, .fq-preview img', { timeout: 8000 }).catch(() => {});
const src = await adm.getAttribute('.fq-preview iframe, .fq-preview img', 'src').catch(() => '');
check('B3 a document opens in place from a blob, never a storage address', /^blob:/.test(src || ''));
await adm.click('[data-act="decline"]');
await adm.click('#fq-go');
check('B4 Decline with no reason for the applicant is stopped', /Write why it was denied first\. It is emailed to them\./.test((await adm.textContent('#fq')) || ''));
await adm.click('#fq-cancel');
await adm.click('[data-act="verify"]');
await adm.click('#fq-go');
await adm.waitForFunction(() => /Verified/.test(document.querySelector('.fq-head')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
const vv = (await adm.textContent('#fq')) || '';
check('B5 Verify on someone else\'s application verifies it, sets a reverification date and writes the history', /Verified/.test(vv) && /Reverification due/.test(vv) && /You Verified/.test(vv));
await adm.screenshot({ path: `${SHOTS}/fund-review.png`, fullPage: true });
const wideAdmin = await wide(adm);
await adm.goto(`${P}/admin-fund.html?demo=admin`, { waitUntil: 'networkidle' });
await adm.waitForSelector('#fq-total', { timeout: 8000 }).catch(() => {});
await adm.fill('#fq-total', '1000');
await adm.click('#fq-post');
await adm.waitForFunction(() => /Each share/.test(document.querySelector('#fq-pool')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
const pl = (await adm.textContent('#fq-pool')) || '';
check('B6 the month\'s pool is shared by the two taking part, never by him: $1,000.00 is $500.00 each', /This month\$1,000\.00/.test(pl) && /2 participants/.test(pl) && /\$500\.00/.test(pl) && /River/.test(pl) && /Jo/.test(pl));
const riverRow = adm.locator('.fq-payout:has-text("River")');
await riverRow.locator('[data-pay]').click();
check('B7a Mark mailed with no check number is stopped', /Add the check number\./.test((await riverRow.textContent()) || ''));
await riverRow.locator('[data-ref]').fill('1042');
await riverRow.locator('[data-pay]').click();
await adm.waitForFunction(() => /Mailed \$500\.00/.test(document.querySelector('#fq-pool')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
check('B7b River\'s check is marked mailed with its check number', /\u2713 Mailed \$500\.00 .* Check #1042/.test((await adm.textContent('#fq-pool')) || ''));
await adm.screenshot({ path: `${SHOTS}/fund-pool.png`, fullPage: true });
const al = (await adm.textContent('#fq-alerts')) || '';
await adm.click('#fq-test');
await adm.waitForFunction(() => /Sent to/.test(document.querySelector('#fq-alert-said')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
check('B9 the alerts card says every application notifies him and emails him, and the test reports where it went', /Application alerts/.test(al) && /Every new application sends a notification to your phone and an email to your inbox\./.test(al)
  && /Sent to your email\. No device has alerts on yet/.test((await adm.textContent('#fq-alert-said')) || ''));
const navs = await adm.$$eval('nav.tabs > a', (as) => as.map((a) => a.getAttribute('href')));
await adm.goto(`${P}${navs[1]}`, { waitUntil: 'networkidle' });
const hub = (await adm.textContent('main')) || '';
await adm.screenshot({ path: `${SHOTS}/fund-pr1.png`, fullPage: true });
await adm.click('.pr1-doors a:has-text("Services")');
await adm.waitForLoadState('networkidle');
const svcUrl = adm.url();
await adm.goto(`${P}${navs[1]}`, { waitUntil: 'networkidle' });
await adm.click('.pr1-doors a:has-text("Clients")');
await adm.waitForLoadState('networkidle');
check('B10 the queue\'s nav is Fund and PR 1; PR 1 opens the hub, and the hub opens Services and Clients', navs.join() === '/admin-fund.html,/admin-pr1.html'
  && /Parked\. Everything that is not the fund\. Nothing was deleted\./.test(hub) && /\/services(\.html)?$/.test(new URL(svcUrl).pathname) && /\/admin(\.html)?$/.test(new URL(adm.url()).pathname),
  JSON.stringify({ navs, svcUrl, clients: adm.url() }));

await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.fund-pill', { timeout: 8000 }).catch(() => {});
const tv = await text(page);
check('B8 the applicant\'s status page then reads Verified with the date, participation, next reverification, this month\'s pool and share, the next check date, and the check that was mailed with its number', /You are a verified participant\./.test(tv) && /Verification date/.test(tv) && /Active: receiving distributions/.test(tv) && /Next reverification/.test(tv)
  && /This month/.test(tv) && /Donation pool\$1,000\.00/.test(tv) && /Your share\$500\.00/.test(tv) && /Next check(November|December|January) 1, 202[67]/.test(tv)
  && /\$500\.00 check mailed/.test(tv) && /Check #1042\. Checks are sent from Mercury/.test(tv));
await page.screenshot({ path: `${SHOTS}/fund-verified.png`, fullPage: true });

check('C1 nothing is wider than the screen on the form or the queue', !wideClient && !wideAdmin && !(await wide(page)));
check('C2 no script error on either page', errors.length === 0, errors.join(' | '));

// ---- D: the old public pages, as a client (v7.25) --------------------------------
const cctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await cctx.addCookies([{ name: 'pa_demo', value: 'client', domain: '127.0.0.1', path: '/' }]);
const cp = await cctx.newPage();
await cp.goto(`${P}/services.html`, { waitUntil: 'networkidle' });
check('D1 a client who opens Services lands on the fund page', new URL(cp.url()).pathname === '/' && /Community Assistance Fund/.test((await cp.textContent('h1')) || ''), cp.url());
await b.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
