// drive-signonce.mjs - one signature, reused everywhere (Eric's spec 2A, 2B,
// 2D and 4), driven in a real browser at the size he actually holds.
//
//   PA_PORT=8931 node tools/drives/drive-signonce.mjs
//
// tools/suites/signonce.mjs pins the documents, the maths and the routes. This
// drives the thing the suites cannot: that a client can get through one
// signing sitting on a 390px screen, that ONE signature then attaches to TWO
// different providers without being asked for again, and that generating a
// narrowed form for a fussy office leaves the master listed and valid.
//
// The whole point of the feature is what does NOT happen: no second signing,
// no third form, no master quietly disappearing when a narrow one is made. So
// most of these assertions are about absence, and absence is exactly what a
// source check cannot see.
//
// 390x844 is an iPhone 14/15, which is what Eric and his clients use.
import { chromium } from 'playwright';

const P = `http://127.0.0.1:${process.env.PA_PORT || 8931}`;
const SHOTS = process.env.PA_SHOTS || '/tmp/pa-shots';
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => {
  if (c) { pass += 1; console.log('  ok   ', n, d ? `(${d})` : ''); } else { fail += 1; console.log('  FAIL ', n, d ? `(${d})` : ''); }
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addCookies([{ name: 'pa_demo', value: '1', domain: '127.0.0.1', path: '/' }]);
const errs = [];

// ===========================================================================
// 1. THE SIGNING SITTING: one name, one mark, two documents
// ===========================================================================
const client = await ctx.newPage();
client.on('pageerror', (e) => errs.push(`client: ${e.message}`));
await client.goto(`${P}/case.html?id=demo-case&demo=1`, { waitUntil: 'networkidle' });
await client.waitForSelector('[data-auth-panel]', { timeout: 25000 });

// The panel offers ONE thing to sign, not one per clinic. That is the change.
const panel0 = await client.evaluate(() => ({
  buttons: [...document.querySelectorAll('[data-auth-add]')].map((x) => x.dataset.authAdd),
  text: document.querySelector('[data-auth-panel]')?.textContent.replace(/\s+/g, ' ') || '',
}));
ok('the panel offers the universal authorisation, not a form per clinic',
  panel0.buttons.includes('universal'), panel0.buttons.join(',') || '(none)');
ok('and the old "one for each clinic" promise is gone from the panel',
  !/each clinic or hospital I need records from/i.test(panel0.text));
ok('it says the client signs once',
  /You sign this once/i.test(panel0.text));

await client.evaluate(() => document.querySelector('[data-auth-add="universal"]').click());
await client.waitForSelector('.settings-card.sig-sheet', { timeout: 15000 });
await client.evaluate(() => {
  const d = [...document.querySelectorAll('.settings-card details')]
    .find((x) => /Read both pages|Read the whole form/.test(x.textContent));
  if (d) d.open = true;
});
await client.waitForTimeout(600);

// BOTH DOCUMENTS ON SCREEN BEFORE THE SIGNATURE. A sitting that signs two
// documents while showing one is not consent to the second.
const sheet = await client.evaluate(() => {
  const doc = document.querySelector('.auth-doc');
  const t = doc?.textContent || '';
  return {
    heading: document.querySelector('.sig-sheet h3')?.textContent.trim() || '',
    h1s: [...(doc?.querySelectorAll('h1') || [])].map((h) => h.textContent.trim()),
    hasClinicField: !!document.querySelector('[data-f="clinicName"]'),
    hasExpiry: !!document.querySelector('[data-f="expiresAt"]'),
    expiryValue: document.querySelector('[data-f="expiresAt"]')?.value || '',
    expiryMin: document.querySelector('[data-f="expiresAt"]')?.min || '',
    expiryMax: document.querySelector('[data-f="expiresAt"]')?.max || '',
    signLabel: document.querySelector('[data-sign]')?.textContent.trim() || '',
    namesClass: /any health plan, physician/.test(t),
    namesNoClinic: !/Valley Neurology|Mountain Ridge/.test(t),
    saysNotDecisionMaker: /NOT my health-care decision maker/.test(t),
    // The sheet has to FIT. A control below the fold on a 390px screen is a
    // control that does not exist.
    bodyWide: document.body.scrollWidth > document.documentElement.clientWidth,
  };
});
ok('the sitting shows BOTH documents before anything is signed',
  sheet.h1s.length === 2
  && /UNIVERSAL AUTHORISATION/.test(sheet.h1s[0] || '')
  && /PATIENT DESIGNATION OF ADVOCATE/.test(sheet.h1s[1] || ''),
  sheet.h1s.join(' | ') || '(none)');
ok('the button says it signs both', /Sign both/.test(sheet.signLabel), sheet.signLabel);
ok('the universal form asks for no clinic at all', !sheet.hasClinicField);
ok('and names a class of providers rather than one clinic',
  sheet.namesClass && sheet.namesNoClinic);
ok('the designation states he is not the decision maker', sheet.saysNotDecisionMaker);
ok('the expiry is a real editable field, defaulted twelve months out',
  sheet.hasExpiry && /^\d{4}-\d{2}-\d{2}$/.test(sheet.expiryValue), sheet.expiryValue);
ok('with a floor of tomorrow and a ceiling, so no date can mean no expiry',
  sheet.expiryMin > new Date().toISOString().slice(0, 10) && !!sheet.expiryMax,
  `${sheet.expiryMin} .. ${sheet.expiryMax}`);
ok('nothing on the sheet overflows a 390px screen', !sheet.bodyWide);

await client.screenshot({ path: `${SHOTS}/01-signing-sheet.png`, fullPage: true });

// The client edits the expiry, because that is the half that has to be theirs.
const chosen = await client.evaluate(() => {
  const el = document.querySelector('[data-f="expiresAt"]');
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + 6);
  el.value = d.toISOString().slice(0, 10);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.value;
});
await client.waitForTimeout(400);
const previewShowsChosen = await client.evaluate(() => {
  const t = document.querySelector('.auth-doc')?.textContent || '';
  return /This authorisation expires on \w+ \d+, \d{4}/.test(t)
    && !/one year from the date signed/.test(t);
});
ok('editing the expiry updates the document they are about to sign',
  previewShowsChosen, chosen);

// Type the name, then make the mark. The typed route is the accessible one and
// is a real signature: the client applies it deliberately.
await client.fill('[data-f="signedName"]', 'Jordan Avery');
await client.evaluate(() => document.querySelector('[data-sig-open]').click());
await client.waitForSelector('[data-sig-typed]', { timeout: 10000 });
await client.evaluate(() => document.querySelector('[data-sig-typed]').click());
await client.evaluate(() => document.querySelector('[data-sig-done]').click());
await client.waitForTimeout(400);
await client.evaluate(() => document.querySelector('[data-sign]').click());
// Two sequential POSTs through the demo, each with its own beat.
await client.waitForTimeout(3000);

const afterSign = await client.evaluate(() => {
  const t = document.querySelector('[data-auth-panel]')?.textContent.replace(/\s+/g, ' ') || '';
  return {
    sheetGone: !document.querySelector('.settings-card.sig-sheet'),
    text: t,
    items: [...document.querySelectorAll('[data-auth-view]')].length,
    narrowButton: !!document.querySelector('[data-auth-narrow]'),
  };
});
ok('the sheet closes on a successful signing', afterSign.sheetGone);
ok('ONE sitting produced TWO signed documents',
  afterSign.items === 2, `${afterSign.items} listed`);
ok('and the panel names them both',
  /Your authorisation/.test(afterSign.text)
  && /The one page your clinics keep/.test(afterSign.text));
ok('the expiry is shown to the client, not left implied',
  /runs to \d/.test(afterSign.text), (afterSign.text.match(/runs to [^ ]+/) || [])[0] || '');
ok('a narrow per-clinic form is offered as an extra, once a master exists',
  afterSign.narrowButton);
await client.screenshot({ path: `${SHOTS}/02-panel-after-signing.png`, fullPage: true });

// The signature that was made, kept for the comparison further down.
const signed = await client.evaluate(async () => {
  const res = await fetch('/api/authority?caseId=demo-case');
  return (await res.json()).items || [];
});
const master = signed.find((i) => i.kind === 'universal');
const desig = signed.find((i) => i.kind === 'designation');
ok('both stored documents carry a signature',
  !!master?.hasSignature && !!desig?.hasSignature);
ok('both carry a real stored expiry, not an implied one',
  !!master?.expiresAt && !!desig?.expiresAt,
  `${master?.expiresAt || 'none'} / ${desig?.expiresAt || 'none'}`);
// Normalised through Date rather than sliced off the string. The demo hands
// back a real Date object where the Worker hands back a Firestore ISO string,
// so a naive `String(x).slice(0, 10)` reads "Sat Feb 27" from one and
// "2027-02-27" from the other, and the check fails on a value that is right.
const day = (x) => {
  const d = new Date(x);
  return Number.isNaN(d.getTime()) ? String(x) : d.toISOString().slice(0, 10);
};
ok('and it is the date the CLIENT chose, not the twelve month default',
  day(master?.expiresAt) === chosen, `${day(master?.expiresAt)} vs ${chosen}`);

// ---- the printed universal document, as paper ----------------------------
const before = ctx.pages().length;
await client.evaluate((id) => document.querySelector(`[data-auth-view="${id}"]`).click(), master.id);
await client.waitForTimeout(1600);
ok('the signed document opens in its own window', ctx.pages().length === before + 1);
const doc = ctx.pages()[ctx.pages().length - 1];
doc.on('pageerror', (e) => errs.push(`doc: ${e.message}`));
await doc.waitForTimeout(600);
const paper = await doc.evaluate(() => ({
  title: document.querySelector('h1')?.textContent.replace(/\s+/g, ' ').trim() || '',
  font: getComputedStyle(document.body).fontFamily,
  pres: document.querySelectorAll('pre').length,
  ink: document.querySelectorAll('.sig-ink img').length,
  text: document.body.textContent.replace(/\s+/g, ' '),
  done: !!document.querySelector('[data-done]'),
}));
ok('it prints as the universal authorisation',
  /UNIVERSAL AUTHORISATION/.test(paper.title), paper.title);
ok('in a serif, with no preformatted block left on it',
  /Georgia|Times|serif/i.test(paper.font) && paper.pres === 0);
ok('the drawn mark is on the paper', paper.ink === 1);
ok('the class of providers is on the paper', /any health plan, physician/.test(paper.text));
ok('no single clinic is named anywhere on it',
  !/Valley Neurology|Mountain Ridge/.test(paper.text));
ok('and it carries a real expiry date, never a promise that it lasts forever',
  /This authorisation expires on \w+ \d+, \d{4}/.test(paper.text)
  && !/does not expire|never expires/i.test(paper.text));
ok('there is still a way out of the document window', paper.done);
await doc.screenshot({ path: `${SHOTS}/03-universal-document.png`, fullPage: true });
await doc.evaluate(() => document.querySelector('[data-done]').click()).catch(() => {});
await client.waitForTimeout(600);

// ---- the one page, as paper ----------------------------------------------
const before2 = ctx.pages().length;
await client.evaluate((id) => document.querySelector(`[data-auth-view="${id}"]`).click(), desig.id);
await client.waitForTimeout(1600);
ok('the designation opens too', ctx.pages().length === before2 + 1);
const dpage = ctx.pages()[ctx.pages().length - 1];
dpage.on('pageerror', (e) => errs.push(`designation: ${e.message}`));
await dpage.waitForTimeout(600);
const dpaper = await dpage.evaluate(() => ({
  title: document.querySelector('h1')?.textContent.trim() || '',
  text: document.body.textContent.replace(/\s+/g, ' '),
  ink: document.querySelectorAll('.sig-ink img').length,
  // One page: a front desk will not read three.
  height: document.documentElement.scrollHeight,
}));
ok('it prints as the patient designation, not as the insurer form',
  /PATIENT DESIGNATION OF ADVOCATE/.test(dpaper.title), dpaper.title);
ok('it says in terms that he is NOT the decision maker',
  /NOT my health-care decision maker/.test(dpaper.text));
ok('it carries the SAME signature, from the same sitting', dpaper.ink === 1);
await dpage.screenshot({ path: `${SHOTS}/04-patient-designation.png`, fullPage: true });
await dpage.evaluate(() => document.querySelector('[data-done]').click()).catch(() => {});
await client.waitForTimeout(600);

// ===========================================================================
// 2. THE NARROW PER-CLINIC EXCEPTION, and the master surviving it
// ===========================================================================
await client.evaluate(() => document.querySelector('[data-auth-narrow]').click());
await client.waitForSelector('.settings-card.sig-sheet', { timeout: 15000 });
const narrowSheet = await client.evaluate(() => ({
  heading: document.querySelector('.sig-sheet h3')?.textContent.trim() || '',
  blurb: document.querySelector('.sig-sheet p')?.textContent.replace(/\s+/g, ' ').trim() || '',
  clinic: !!document.querySelector('[data-f="clinicName"]'),
  // Pre-filled from the master rather than asked for again.
  scopes: [...document.querySelectorAll('[data-scope]:checked')].map((x) => x.dataset.scope),
  cats: [...document.querySelectorAll('[data-cat]:checked')].map((x) => x.dataset.cat),
  // It must NOT arrive pre-signed. A narrowed copy is a document to be signed.
  signaturePrefilled: !document.querySelector('[data-sig-img]')?.hidden,
}));
ok('the narrow form asks for the one clinic', narrowSheet.clinic);
ok('and says plainly that signing it cancels nothing',
  /does not cancel the authorisation you already signed/i.test(narrowSheet.blurb),
  narrowSheet.blurb.slice(0, 60));
ok('it is pre-filled from the master, not a second interview',
  narrowSheet.scopes.length === 3, narrowSheet.scopes.join(','));
ok('but it arrives UNSIGNED: a signature is never carried across',
  !narrowSheet.signaturePrefilled);

await client.fill('[data-f="clinicName"]', 'Valley Neurology');
await client.fill('[data-f="signedName"]', 'Jordan Avery');
await client.evaluate(() => document.querySelector('[data-sig-open]').click());
await client.waitForSelector('[data-sig-typed]', { timeout: 10000 });
await client.evaluate(() => document.querySelector('[data-sig-typed]').click());
await client.evaluate(() => document.querySelector('[data-sig-done]').click());
await client.waitForTimeout(400);
await client.evaluate(() => document.querySelector('[data-sign]').click());
await client.waitForTimeout(2500);

// THE CHECK THIS WHOLE SECTION EXISTS FOR.
const afterNarrow = await client.evaluate(async () => {
  const res = await fetch('/api/authority?caseId=demo-case');
  const items = (await res.json()).items || [];
  return {
    items: items.map((i) => ({
      id: i.id, kind: i.kind, revokedAt: i.revokedAt, expiresAt: i.expiresAt,
      clinicName: i.clinicName, narrowedFrom: i.narrowedFrom,
    })),
    text: document.querySelector('[data-auth-panel]')?.textContent.replace(/\s+/g, ' ') || '',
  };
});
const masterNow = afterNarrow.items.find((i) => i.id === master.id);
const narrow = afterNarrow.items.find((i) => i.kind === 'records');
ok('the narrowed copy is stored as its own document',
  !!narrow && narrow.clinicName === 'Valley Neurology');
ok('THE MASTER SURVIVES: still there, still not withdrawn',
  !!masterNow && !masterNow.revokedAt,
  masterNow ? `revokedAt=${masterNow.revokedAt}` : 'MASTER GONE');
ok('and its expiry is untouched by the narrowing',
  day(masterNow?.expiresAt) === day(master.expiresAt),
  `${day(masterNow?.expiresAt)} vs ${day(master.expiresAt)}`);
ok('the master is still listed on the client panel beside the narrow one',
  /Your authorisation/.test(afterNarrow.text) && /Valley Neurology/.test(afterNarrow.text));
ok('and the panel calls the narrow one an extra, not a replacement',
  /never replace the authorisation above/i.test(afterNarrow.text));
await client.screenshot({ path: `${SHOTS}/05-master-survives-narrowing.png`, fullPage: true });

// ===========================================================================
// 3. ONE SIGNATURE, TWO PROVIDERS: the packets
// ===========================================================================
const admin = await ctx.newPage();
admin.on('pageerror', (e) => errs.push(`admin: ${e.message}`));
await admin.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, { waitUntil: 'networkidle' });
await admin.waitForSelector('[data-providers]', { timeout: 25000 });

const card = await admin.evaluate(() => {
  const t = document.querySelector('[data-authority-status]')?.textContent.replace(/\s+/g, ' ') || '';
  return {
    text: t,
    saysAssembleOnly: /Nothing is transmitted from this page/.test(t),
    statuses: [...(document.querySelector('[data-provider-status]')?.options || [])].map((o) => o.textContent),
  };
});
ok('his card says the universal authorisation is signed once',
  /universal, signed once/.test(card.text), (card.text.match(/Authorisation: [^.]{0,50}/) || [])[0] || '');
ok('and shows the narrowed copy without implying the master is gone',
  /Narrowed copies: Valley Neurology/.test(card.text)
  && /The universal one is unaffected/.test(card.text));
ok('the panel says he sends the packet himself', card.saysAssembleOnly);

// Two providers, added the way he would.
for (const name of ['Valley Neurology', 'Sonoran Imaging']) {
  await admin.fill('[data-provider-name]', name);
  await admin.evaluate(() => document.querySelector('[data-provider-add]').click());
  await admin.waitForTimeout(1400);
}
await admin.waitForTimeout(600);
const list = await admin.evaluate(() => ({
  names: [...document.querySelectorAll('[data-providers] strong')].map((x) => x.textContent.trim()),
  statuses: [...document.querySelectorAll('[data-provider-status]')]
    .map((s) => s.options[s.selectedIndex].textContent),
  options: [...(document.querySelector('[data-provider-status]')?.options || [])].map((o) => o.textContent),
  packetButtons: document.querySelectorAll('[data-provider-packet]').length,
}));
ok('two providers are on the list', list.names.length === 2, list.names.join(', '));
ok('each starts at NOT SENT, never at an unknown state',
  list.statuses.every((s) => s === 'NOT SENT'), list.statuses.join(', '));
ok('all nine statuses are offered', list.options.length === 9, String(list.options.length));
ok('and each provider has its own packet button', list.packetButtons === 2);
await admin.screenshot({ path: `${SHOTS}/06-provider-list.png`, fullPage: true });

// THE CENTRAL CLAIM: one signature, two providers, both packets carry it, and
// nobody was asked to sign again.
const ink = [];
for (let n = 0; n < 2; n += 1) {
  const was = ctx.pages().length;
  await admin.evaluate((i) => document.querySelectorAll('[data-provider-packet]')[i].click(), n);
  await admin.waitForTimeout(2200);
  if (ctx.pages().length <= was) { ok(`packet ${n + 1} opens`, false, 'no window'); continue; }
  const pk = ctx.pages()[ctx.pages().length - 1];
  pk.on('pageerror', (e) => errs.push(`packet${n}: ${e.message}`));
  await pk.waitForTimeout(700);
  const got = await pk.evaluate(() => ({
    title: document.querySelector('h1')?.textContent.trim() || '',
    text: document.body.textContent.replace(/\s+/g, ' '),
    inkSrc: [...document.querySelectorAll('.sig-ink img')].map((i) => i.src),
    h1s: [...document.querySelectorAll('h1')].map((h) => h.textContent.trim()),
  }));
  ok(`packet ${n + 1} opens as a cover sheet`,
    /PATIENT ADVOCATE COVER SHEET/.test(got.title), got.title);
  ok(`packet ${n + 1} carries the patient and the request`,
    /Jordan Avery/.test(got.text) && /Records\./.test(got.text));
  ok(`packet ${n + 1} carries the decision-maker disclaimer`,
    /does not appoint the advocate as the patient's health-care decision maker/.test(got.text));
  ok(`packet ${n + 1} names the document ids and the expiry`,
    /Document ID [A-Z0-9]{4,}/.test(got.text) && /valid to \w+ \d+, \d{4}/.test(got.text));
  ok(`packet ${n + 1} has the authorisation and the one page behind the cover`,
    got.h1s.length === 3, got.h1s.join(' | '));
  ok(`packet ${n + 1} CARRIES THE SIGNATURE`, got.inkSrc.length === 2,
    `${got.inkSrc.length} marks`);
  ink.push(got.inkSrc[0] || '');
  if (n === 0) await pk.screenshot({ path: `${SHOTS}/07-provider-packet.png`, fullPage: true });
  await pk.close();
  await admin.waitForTimeout(400);
}
// The same mark, byte for byte, on both. This is sign-once made observable:
// the client signed one time and two clinics get a packet with that signature.
ok('BOTH PACKETS CARRY THE SAME ONE SIGNATURE',
  ink.length === 2 && ink[0].length > 100 && ink[0] === ink[1],
  ink.length === 2 ? `${ink[0] === ink[1] ? 'identical' : 'DIFFERENT'}, ${ink[0].length} chars` : 'missing');

// And the client was never asked for a second signature: the document count is
// still the three they actually signed.
const finalCount = await client.evaluate(async () => {
  const res = await fetch('/api/authority?caseId=demo-case');
  return ((await res.json()).items || []).length;
});
ok('and the client signed three times in total, not once per provider',
  finalCount === 3, `${finalCount} documents`);

// A status Eric sets is what he reads back.
await admin.evaluate(() => {
  const s = document.querySelector('[data-provider-status]');
  s.value = 'providerForm';
  s.dispatchEvent(new Event('change', { bubbles: true }));
});
await admin.waitForTimeout(1800);
const stuck = await admin.evaluate(() => {
  const s = document.querySelector('[data-provider-status]');
  return s.options[s.selectedIndex].textContent;
});
ok('a status he sets survives the repaint', stuck === 'PROVIDER FORM REQUIRED', stuck);

ok('no page threw', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`\n${pass} ok, ${fail} FAIL`);
await b.close();
process.exit(fail ? 1 : 0);
