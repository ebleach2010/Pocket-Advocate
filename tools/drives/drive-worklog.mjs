// drive-worklog.mjs - he logs two things, and his client sees exactly one.
//
//   PA_PORT=8931 node tools/drives/drive-worklog.mjs
//
// Eric, 2026-08-27: the records section becomes "a log of what I've been doing
// by date, so they can see what I've been up to", every entry carries a short
// line he writes that is separate from his private notes, and NOTHING appears
// on it unless he logs it by hand.
//
// The suite lifts the projection and proves it drops the private fields. This
// drives the whole thing end to end in a real browser instead, because the
// question the suite cannot answer is whether the valve is usable: he has to
// be able to see, on his own screen, which entries his client is reading.
//
// TWO WIDTHS. 390x844 is the phone he works on; 320px is the width where four
// tabs stop fitting and where he has photographed the defect before.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const P = `http://127.0.0.1:${process.env.PA_PORT || 8931}`;
const SHOTS = process.env.PA_SHOTS || '/tmp/worklog-shots';
mkdirSync(SHOTS, { recursive: true });
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => {
  if (c) { pass += 1; console.log('  ok   ', n, d ? `(${d})` : ''); } else { fail += 1; console.log('  FAIL ', n, d ? `(${d})` : ''); }
};

// The private halves of the two entries. Every one of these strings has to be
// absent from the client's page, in the DOM and in the served bytes alike.
const PRIVATE_PHONE = '602-555-0184';
const PRIVATE_PARTIES = 'me, the client, Marcy the records clerk';
const PRIVATE_NOTES = 'She admitted the fax never went. Escalating Tuesday.';
const HIDDEN_CLINIC = 'Dr Okafor, private line';
const SHOWN_CLINIC = 'Valley Neurology';
const SHOWN_LINE = 'Called your neurology office and chased the notes.';

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addCookies([{ name: 'pa_demo', value: '1', domain: '127.0.0.1', path: '/' }]);
const errs = [];

// ---- his side: log two things ------------------------------------------
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(`admin: ${e.message}`));
page.on('dialog', (d) => d.accept());
await page.goto(`${P}/admin-case.html?id=demo-case-full&demo=admin`, { waitUntil: 'networkidle' });
await page.waitForSelector('button[data-group="case"]', { timeout: 20000 });
await page.click('button[data-group="case"]');
// FOUR TABS PER GROUP, and the log is the fourth. A page absent from every
// group renders no tab at all, which is how the call document once shipped
// invisible, so this waits for the tab rather than navigating by hash.
await page.waitForSelector('a[data-page="log"]', { timeout: 10000 });
ok('the Work log tab is in the Case group, where every case has it',
  await page.isVisible('a[data-page="log"]'));
await page.click('a[data-page="log"]');
await page.waitForSelector('[data-calls-root]', { timeout: 15000 });

const before = await page.$$eval('[data-calls-root] details.faq', (n) => n.length);

const logEntry = async ({ kind, clinic, summary, phone, parties }) => {
  await page.click('details[data-k="call-new"] summary');
  await page.selectOption('[data-c="kind"]', kind);
  await page.fill('[data-c="clinic"]', clinic);
  await page.fill('[data-c="summary"]', summary);
  if (phone) await page.fill('[data-c="phone"]', phone);
  if (parties) await page.fill('[data-c="parties"]', parties);
  await page.click('[data-call-add]');
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-calls-root] details.faq').length > n,
    before + (summary ? 0 : 1), { timeout: 15000 },
  ).catch(() => {});
  await page.waitForTimeout(600);
};

// ONE WITH A CLIENT LINE.
await logEntry({
  kind: 'call', clinic: SHOWN_CLINIC, summary: SHOWN_LINE,
  phone: PRIVATE_PHONE, parties: PRIVATE_PARTIES,
});
// ONE WITHOUT. This is the valve: he logged it, and they do not see it.
await logEntry({
  kind: 'investigation', clinic: HIDDEN_CLINIC, summary: '',
  phone: '602-555-0999', parties: 'me alone',
});

// His private notes go on the first entry, through the same one Save.
const first = await page.$('[data-call-summary]');
if (first) {
  const id = await first.getAttribute('data-call-summary');
  await page.click(`details[data-k="call-${id}"] summary`).catch(() => {});
  await page.fill(`[data-call-notes="${id}"]`, PRIVATE_NOTES);
  await page.click(`[data-call-save="${id}"]`);
  await page.waitForTimeout(900);
}

const adminText = await page.evaluate(() => document.querySelector('[data-calls-root]')?.innerText || '');
ok('both entries are on his own list', adminText.includes(SHOWN_CLINIC) && adminText.includes('Dr Okafor'),
  adminText.slice(0, 120).replace(/\n/g, ' '));
const badges = await page.$$eval('[data-calls-root] details.faq > summary',
  (n) => n.map((x) => x.innerText.replace(/\s+/g, ' ').trim()));
ok('and his screen says, per entry, which one the client is reading',
  badges.some((x) => /Shown to your client/.test(x)) && badges.some((x) => /Private, not shown/.test(x)),
  badges.join(' | ').slice(0, 200));
// The number his own screen claims the client can see. The demo case is
// seeded with one visible entry and one private one, so this is not the same
// as "the two I just logged" - and asserting on the WRONG number was the
// first version of this drive, which failed against working code.
const seenCount = badges.filter((x) => /Shown to your client/.test(x)).length;
const privateCount = badges.filter((x) => /Private, not shown/.test(x)).length;
ok('both of the two he just logged are on it, one of each',
  seenCount >= 2 && privateCount >= 2, `${seenCount} shown, ${privateCount} private`);
ok('the panel no longer counts calls it promised not to count',
  !/of 3 used|Three are included/.test(adminText));
await page.screenshot({ path: `${SHOTS}/admin-worklog-390.png`, fullPage: true });

// The form itself, open, because that is the screen he actually taps.
await page.click('details[data-k="call-new"] summary');
await page.waitForTimeout(300);
const form = await page.evaluate(() => ({
  labels: [...document.querySelectorAll('details[data-k="call-new"] label')]
    .map((l) => l.innerText.split('\n')[0].trim()),
  kinds: [...document.querySelectorAll('[data-c="kind"] option')].map((o) => o.textContent.trim()),
}));
ok('the form names his four categories in his own words',
  form.kinds.join(', ') === 'Call, Appeal, Investigation, Attended appointment',
  form.kinds.join(', '));
ok('and it asks for the client line without making it compulsory',
  form.labels.some((l) => /What your client sees/.test(l)),
  form.labels.join(' | ').slice(0, 160));
await page.screenshot({ path: `${SHOTS}/admin-logform-390.png`, fullPage: true });

// ---- their side: exactly one of the two --------------------------------
const client = await ctx.newPage();
client.on('pageerror', (e) => errs.push(`client: ${e.message}`));
await client.goto(`${P}/case.html?id=demo-case-full&demo=1`, { waitUntil: 'networkidle' });
await client.waitForSelector('[data-worklog-panel]', { timeout: 20000 });
await client.waitForTimeout(1200);

const panel = await client.evaluate(() => {
  const p = document.querySelector('[data-worklog-panel]');
  return {
    heading: p?.querySelector('h3')?.textContent.trim() || '',
    rows: [...(p?.querySelectorAll('.filelist li') || [])].map((li) => li.innerText.replace(/\s+/g, ' ').trim()),
    pills: [...(p?.querySelectorAll('.kind-pill') || [])].map((s) => s.textContent.trim()),
  };
});
ok('the log took the records section\'s place on their page',
  panel.heading === 'What I have been doing', panel.heading || '(no panel)');
// THE INVARIANT, and it is the whole feature: their page carries exactly the
// entries his page marks "Client sees this", and not one more.
ok('their log is exactly as long as the count his own screen claims',
  panel.rows.length === seenCount, `${panel.rows.length} rows vs ${seenCount} marked shown`);
ok('the one he wrote a client line on is on it',
  panel.rows.some((r) => r.includes(SHOWN_LINE) && r.includes(SHOWN_CLINIC)),
  panel.rows.join(' | ').slice(0, 160) || '(nothing)');
ok('and the one he did not is not, which is the whole point',
  !panel.rows.some((r) => r.includes('Okafor')), panel.rows.join(' | ').slice(0, 160));
ok('every row carries its category as a pill, like the documents list does',
  panel.pills.length === panel.rows.length
  && panel.pills.every((x) => ['CALL', 'APPEAL', 'INVESTIGATION', 'APPOINTMENT'].includes(x)),
  panel.pills.join(','));

// THE PRIVACY CHECK, against the whole rendered page rather than the panel:
// a leak into a title attribute or a data attribute is still a leak.
const html = await client.content();
const leaks = [PRIVATE_PHONE, PRIVATE_PARTIES, PRIVATE_NOTES, HIDDEN_CLINIC, '602-555-0999']
  .filter((x) => html.includes(x));
ok('no number, no parties, no notes and no unlogged entry anywhere on their page',
  leaks.length === 0, leaks.join(' | '));
// And through the route itself, not merely through the paint.
const api = await client.evaluate(async () => {
  const res = await fetch('/api/case-log?caseId=demo-case-full');
  return JSON.stringify(await res.json());
});
ok('and none of it in what the route actually returns',
  !['phone', 'parties', 'notes'].some((k) => api.includes(`"${k}"`))
  && !api.includes(PRIVATE_PHONE) && !api.includes('Okafor'),
  api.slice(0, 200));

// The parked offer, and the promise that outlived it.
const parked = await client.evaluate(() => ({
  sign: document.querySelectorAll('[data-auth-add]').length,
  withdraw: document.querySelectorAll('[data-auth-revoke]').length,
  view: document.querySelectorAll('[data-auth-view]').length,
  permHeading: document.querySelector('[data-auth-panel] h3')?.textContent.trim() || '',
}));
ok('nothing offers them a records form to sign', parked.sign === 0, `${parked.sign} buttons`);
// The Full Access demo case has both documents signed, so the list is there
// and both controls are on it. This is the client the parking could have
// stranded, and the one this panel exists for.
ok('but everything they already signed is still listed', parked.permHeading === 'Permissions you have given me',
  parked.permHeading || '(no permissions panel)');
ok('with View and Withdraw on it, which is the promise the agreement makes',
  parked.withdraw >= 1 && parked.view >= 1, `${parked.view} view, ${parked.withdraw} withdraw`);

await client.screenshot({ path: `${SHOTS}/client-worklog-390.png`, fullPage: true });

// ---- 320px, the width where things stop fitting -------------------------
await client.setViewportSize({ width: 320, height: 844 });
await client.waitForTimeout(500);
const overflow = await client.evaluate(() => ({
  doc: document.documentElement.scrollWidth,
  win: window.innerWidth,
}));
ok('the client page does not scroll sideways at 320px',
  overflow.doc <= overflow.win + 1, `${overflow.doc} > ${overflow.win}`);
await client.screenshot({ path: `${SHOTS}/client-worklog-320.png`, fullPage: true });

await page.setViewportSize({ width: 320, height: 844 });
await page.waitForTimeout(500);
const tabs = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.fgrp')].length;
  const pageTabs = [...document.querySelectorAll('a[data-page]')].filter((a) => a.offsetParent);
  const nav = document.querySelector('.ftabs') || document.querySelector('nav');
  return {
    groups: rows,
    shown: pageTabs.length,
    navOverflow: nav ? nav.scrollWidth - nav.clientWidth : 0,
  };
});
ok('four tabs in the open group still fit across 320px', tabs.shown <= 4, `${tabs.shown} tabs shown`);
ok('and the tab strip does not scroll sideways', tabs.navOverflow <= 1, `${tabs.navOverflow}px over`);
await page.screenshot({ path: `${SHOTS}/admin-worklog-320.png`, fullPage: true });

ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await b.close();
console.log(`\n${pass} ok, ${fail} FAIL   shots in ${SHOTS}`);
process.exit(fail ? 1 : 0);
