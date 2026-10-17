// chatline.mjs - Priority Chat per contractor: his switch, their price, their own chat line (v7.73).
//
// Eric, 2026-10-17, asked whether the chat tier is per contractor: "Yes, per contractor", at their price, switched
// on by him in Employer mode. A contractor's line is theirs: their name and photo, their door sign, their earnings.
// A chat history never changes hands: the thread, its files and its notes stay with the advocate it was with.
//
// The subscribe route, the activation and the rates are lifted from worker/index.js and RUN with Stripe and the store
// stood in; worker/staffsettings.js and worker/employer.js are lifted whole.
//
//   K1 what they offer: their chat line is off until he turns it on, only he can, and its month is one of their prices
//   K2 subscribing: his line at his price; theirs at their price, named, once he has turned it on; a moved price and a
//      history with someone else are refused
//   K3 the activation keeps the line's advocate and month, his price climbs only for his own new lines, and the mail names them
//   K4 the rates say whether a line can be bought: his always, theirs once he turns it on, nobody else's
//   K5 the team's earnings count each line at its own month, and their line takes no step up yet
//   K6 the pages: subscribe names them and sends their price, the chat names them, their booking page and settings link to it,
//      Employer mode switches it with a price, and the demo mirrors it
//   K7 their chat terms are his, word for word, with their name wherever his say me, my or I, and their price for his
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (p) => readFileSync(join(ROOT, p), 'utf8');
const DASH = new RegExp('[\\u2013\\u2014]');
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
const STAFF = await import(pathToFileURL(join(ROOT, 'worker/staff.js')).href);
const CHARGE = await import(pathToFileURL(join(ROOT, 'worker/charge.js')).href);
const ADDONS = await import(pathToFileURL(join(ROOT, 'worker/addons.js')).href);
const strip = (src) => src.replace(/^import [\s\S]*?from '[^']+';\n/gm, '').replace(/^export \{[^}]*\} from '[^']+';\n/gm, '')
  .replace(/^export (const|let|async function|function) /gm, '$1 ');
const W = f('worker/index.js');
const afn = (name) => { const m = W.match(new RegExp(`\\nasync function ${name}\\([\\s\\S]*?\\n\\}`)); if (!m) throw new Error(`could not lift ${name}`); return m[0]; };
const sfn = (name) => { const m = W.match(new RegExp(`\\nfunction ${name}\\([\\s\\S]*?\\n\\}`)); if (!m) throw new Error(`could not lift ${name}`); return m[0]; };

const ERIC = 'eric-uid';
const ENV = { ADMIN_UID: ERIC, PUBLIC_BASE_URL: 'https://example.invalid' };
const clone = (v) => JSON.parse(JSON.stringify(v));
function world() {
  const docs = new Map();
  const getDoc = async (env, p) => (docs.has(p) ? { id: p.split('/').pop(), data: clone(docs.get(p)) } : null);
  const writes = [];
  const patchDoc = async (env, p, data, opts = {}) => { writes.push({ p, data: clone(data), opts }); const cur = opts.mask ? (docs.get(p) || {}) : {}; docs.set(p, { ...cur, ...clone(data) }); return true; };
  const SS = new Function('getDoc', 'patchDoc', 'advocateIdOf',
    `${strip(f('worker/staffsettings.js'))}\nreturn { settingsFrom, offersFrom, contractorOf, contractorSettings, mergeRates, cleanSettingsChange, STAFF_RATE_KEYS };`)(
    getDoc, patchDoc, STAFF.advocateIdOf);
  docs.set('advocates/ana', { uid: 'ana', name: 'Ana Rivera', active: true, owner: false, settings: { offers: { chat: true }, rates: { subCents: 6500 } } });
  docs.set('advocates/ben', { uid: 'ben', name: 'Ben Cole', active: true, owner: false, settings: { rates: { subCents: 7000 } } });
  docs.set('advocates/off', { uid: 'off', name: 'Turned Off', active: false, owner: false, settings: { offers: { chat: true } } });
  return { docs, writes, getDoc, patchDoc, SS };
}
const readRates = async () => ({ caseCents: 210000, addonCents: 32500, subCents: 5000, fullCents: 440000 });
const firstName = new Function(`${sfn('firstName')} return firstName;`)();

// ---- K1 ----------------------------------------------------------------------------------------------------------------
{
  const { SS } = world();
  const asHim = SS.cleanSettingsChange({ offers: { chat: true }, rates: { subCents: 6500 } }, { admin: true });
  const asThem = SS.cleanSettingsChange({ offers: { chat: true } });
  const theirPrice = SS.cleanSettingsChange({ rates: { subCents: 6500 } });
  // NEGATIVE CONTROL (run 2026-10-17, v7.73): offersFrom's `chat: o?.chat === true` made `chat: o?.chat !== false` made this read
  //   FAIL  K1 what they offer: their chat line is off until he turns it on, only he can, and its month is one of their prices
  check('K1 what they offer: their chat line is off until he turns it on, only he can, and its month is one of their prices',
    SS.offersFrom({}).chat === false && SS.offersFrom({ chat: true }).chat === true && SS.offersFrom({ case: false }).case === false
    && asHim.patch?.['settings.offers.chat'] === true && asHim.patch?.['settings.rates.subCents'] === 6500
    && asThem.error === 'What you offer is set by Eric.' && theirPrice.patch?.['settings.rates.subCents'] === 6500
    && SS.STAFF_RATE_KEYS.includes('subCents') && SS.settingsFrom({ settings: { rates: { subCents: 6500 } } }).rates.subCents === 6500,
    JSON.stringify({ asHim, asThem }));
}

// ---- K2 ----------------------------------------------------------------------------------------------------------------
async function subscribe(w, body, { existing = null } = {}) {
  if (existing) w.docs.set('subscriptions/c1', existing); else w.docs.delete('subscriptions/c1');
  const stripe = [];
  const h = new Function('requireUser', 'requireAdultProfile', 'getDoc', 'readRates', 'contractorSettings', 'mergeRates', 'firstName',
    'advocateIdOf', 'stripePost', 'json', `${afn('handleSubscribe')} return handleSubscribe;`)(
    async () => ({ uid: 'c1', email: 'c@example.invalid' }), async () => ({ email: 'c@example.invalid' }), w.getDoc, readRates,
    w.SS.contractorSettings, w.SS.mergeRates, firstName, STAFF.advocateIdOf,
    async (env, path, b) => { stripe.push({ path, b }); return { url: 'https://stripe.invalid/s' }; },
    (o, st = 200) => ({ status: st, body: o }));
  const res = await h({ json: async () => body }, ENV);
  return { res, stripe: stripe[0]?.b || null };
}
{
  const w = world();
  const his = await subscribe(w, { termsAckAt: 1 });
  const ana = await subscribe(w, { termsAckAt: 1, advocate: 'ana', quotedCents: 6500 });
  const ben = await subscribe(w, { termsAckAt: 1, advocate: 'ben' });
  const off = await subscribe(w, { termsAckAt: 1, advocate: 'off' });
  const junk = await subscribe(w, { termsAckAt: 1, advocate: '../users/x' });
  const moved = await subscribe(w, { termsAckAt: 1, advocate: 'ana', quotedCents: 5000 });
  const past = new Date(Date.now() - 86_400_000).toISOString();
  const elsewhere = await subscribe(w, { termsAckAt: 1, advocate: 'ana' }, { existing: { advocateId: ERIC, currentPeriodEnd: past } });
  const hisAgainFromAna = await subscribe(w, { termsAckAt: 1 }, { existing: { advocateId: 'ana', currentPeriodEnd: past } });
  const backToAna = await subscribe(w, { termsAckAt: 1, advocate: 'ana' }, { existing: { advocateId: 'ana', currentPeriodEnd: past } });
  const live = await subscribe(w, { termsAckAt: 1, advocate: 'ana' }, { existing: { advocateId: 'ana', currentPeriodEnd: new Date(Date.now() + 86_400_000).toISOString() } });
  const li = (s) => s?.line_items?.[0]?.price_data;
  // NEGATIVE CONTROL (run 2026-10-17, v7.73): handleSubscribe's `|| !own.offers.chat` taken out made this read
  //   FAIL  K2 subscribing: his line at his price; theirs at their price, named, once he has turned it on; a moved price and a history with someone else are refused
  check('K2 subscribing: his line at his price; theirs at their price, named, once he has turned it on; a moved price and a history with someone else are refused',
    his.res.status === 200 && li(his.stripe)?.unit_amount === 5000 && his.stripe.metadata.advocateId === ERIC && li(his.stripe).product_data.description === 'Anytime chat with me, your advocate'
    && /\/subscribe\.html\?canceled=1$/.test(his.stripe.cancel_url)
    && ana.res.status === 200 && li(ana.stripe)?.unit_amount === 6500 && ana.stripe.metadata.advocateId === 'ana' && ana.stripe.metadata.priceCents === '6500'
    && ana.stripe.subscription_data.metadata.advocateId === 'ana' && li(ana.stripe).product_data.description === 'Anytime chat with Ana, your advocate'
    && /\/subscribe\.html\?advocate=ana&canceled=1$/.test(ana.stripe.cancel_url)
    && ben.res.status === 404 && !ben.stripe && off.res.status === 404 && junk.res.status === 404
    && moved.res.status === 409 && moved.res.body.rateChanged === true && moved.res.body.priceCents === 6500 && !moved.stripe
    && elsewhere.res.status === 409 && /stays private to them/.test(elsewhere.res.body.error) && !elsewhere.stripe
    && hisAgainFromAna.res.status === 409 && backToAna.res.status === 200 && live.res.status === 409 && /already have an active/.test(live.res.body.error)
    && !DASH.test(elsewhere.res.body.error + moved.res.body.error),
    JSON.stringify({ his: his.res, ana: ana.res, ben: ben.res, moved: moved.res, elsewhere: elsewhere.res.status, back: backToAna.res.status }));
}

// ---- K3 ----------------------------------------------------------------------------------------------------------------
async function activate(w, metadata, { existing = null } = {}) {
  if (existing) w.docs.set('subscriptions/c1', existing); else w.docs.delete('subscriptions/c1');
  const raised = []; const mails = [];
  const READ_FAILED = Symbol('read failed');
  const h = new Function('tryGet', 'READ_FAILED', 'readFailedError', 'resolveClientEmail', 'patchDoc', 'advocateIdOf', 'contractorOf',
    'raiseSubRate', 'sendEmail', 'homeScreenTips', 'firstName', 'getDoc', 'escHtml', `${afn('activateSubscription')} return activateSubscription;`)(
    async (env, p) => (await w.getDoc(env, p)), READ_FAILED, (m) => new Error(m), async () => 'c@example.invalid', w.patchDoc,
    STAFF.advocateIdOf, w.SS.contractorOf, async () => { raised.push(1); }, async (env, m) => { mails.push(m); }, () => '', firstName, w.getDoc,
    new Function(`${sfn('escHtml')} return escHtml;`)());
  await h(ENV, { id: `cs_${Math.random()}`, customer: 'cus_1', subscription: 'sub_1', amount_total: 4900, metadata: { uid: 'c1', email: 'c@example.invalid', termsAckAt: '1', ...metadata } });
  return { doc: w.docs.get('subscriptions/c1'), raised: raised.length, mail: mails[0]?.html || '' };
}
{
  const w = world();
  const theirs = await activate(w, { advocateId: 'ana', priceCents: '6500' });
  const his = await activate(w, { advocateId: ERIC, priceCents: '5000' });
  const old = await activate(w, {});
  // NEGATIVE CONTROL (run 2026-10-17, v7.73): the price raise's `&& !theirs` taken out of activateSubscription made this read
  //   FAIL  K3 the activation keeps the line's advocate and month, his price climbs only for his own new lines, and the mail names them
  check('K3 the activation keeps the line\'s advocate and month, his price climbs only for his own new lines, and the mail names them',
    theirs.doc?.advocateId === 'ana' && theirs.doc.priceCents === 6500 && theirs.raised === 0 && /Your chat line to Ana is open\./.test(theirs.mail)
    && his.doc?.advocateId === ERIC && his.doc.priceCents === 5000 && his.raised === 1 && /Your chat line to me is open\./.test(his.mail)
    && old.doc?.advocateId === ERIC && old.doc.priceCents === 4900 && !DASH.test(theirs.mail + his.mail),
    JSON.stringify({ theirs: [theirs.doc?.advocateId, theirs.doc?.priceCents, theirs.raised], his: [his.doc?.priceCents, his.raised] }));
}

// ---- K4 ----------------------------------------------------------------------------------------------------------------
{
  const w = world();
  const rates = async (q) => {
    const h = new Function('contractorSettings', 'readRates', 'fullAccessCapacity', 'mergeRates', 'caseAddons', 'advocateIdOf', 'json',
      'CHAT_OPEN_CENTS', 'TELEHEALTH_PRICE_CENTS', 'FULL_INCLUDED_HOURS', `${afn('handleRates')} return handleRates;`)(
      w.SS.contractorSettings, readRates, async () => ({ room: true }), w.SS.mergeRates, async () => null, STAFF.advocateIdOf,
      (o) => o, 5000, 52500, 20);
    return h(ENV, new URL(`https://example.invalid/api/rates${q}`));
  };
  const r = { his: await rates(''), hisNamed: await rates(`?advocate=${ERIC}`), ana: await rates('?advocate=ana'), ben: await rates('?advocate=ben'), ghost: await rates('?advocate=nobody') };
  // NEGATIVE CONTROL (run 2026-10-17, v7.73): handleRates' `chatOffered: own ? own.offers.chat === true : ...` made `chatOffered: true` made this read
  //   FAIL  K4 the rates say whether a line can be bought: his always, theirs once he turns it on, nobody else's
  check('K4 the rates say whether a line can be bought: his always, theirs once he turns it on, nobody else\'s',
    r.his.chatOffered === true && r.hisNamed.chatOffered === true && r.ana.chatOffered === true && r.ana.subCents === 6500
    && r.ben.chatOffered === false && r.ben.subCents === 7000 && r.ghost.chatOffered === false && r.ghost.subCents === 5000,
    JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, [v.chatOffered, v.subCents]]))));
}

// ---- K5 ----------------------------------------------------------------------------------------------------------------
{
  const w = world();
  const EMP = new Function('getDoc', 'patchDoc', 'deleteDoc', 'listDocs', 'batchCreate', 'batchDelete', 'notifyUser', 'caseBookingCents',
    'advocateIdOf', 'DEFAULT_COMMISSION_PCT', 'cleanPayout', 'sealPayout', 'addonsOf',
    `${strip(f('worker/employer.js'))}\nreturn { teamSummary };`)(w.getDoc, w.patchDoc, null, null, null, null, null, CHARGE.caseBookingCents,
    STAFF.advocateIdOf, STAFF.DEFAULT_COMMISSION_PCT, null, null, ADDONS.addonsOf);
  const advocates = [{ id: ERIC, data: { owner: true, active: true, name: 'Eric Leach' } }, { id: 'ana', data: { active: true, name: 'Ana Rivera', commissionPct: 50, onboardedAt: 1 } }];
  const subs = [
    { id: 'c1', data: { advocateId: 'ana', status: 'active', priceCents: 6500, currentPeriodEnd: new Date(Date.now() + 86_400_000).toISOString() } },
    { id: 'c2', data: { advocateId: ERIC, status: 'active', currentPeriodEnd: new Date(Date.now() + 86_400_000).toISOString() } },
  ];
  const team = EMP.teamSummary({ advocates, cases: [], subs, subCents: 5000, adminUid: ERIC });
  const ana = team.find((p) => p.uid === 'ana');
  const eric = team.find((p) => p.uid === ERIC);
  const stepSrc = f('worker/stepup.js');
  // NEGATIVE CONTROL (run 2026-10-17, v7.73): teamSummary's `const month = Number(s.data.priceCents) > 0 ? ...` made `const month = subCents;` made this read
  //   FAIL  K5 the team's earnings count each line at its own month, and their line takes no step up yet
  check('K5 the team\'s earnings count each line at its own month, and their line takes no step up yet',
    ana?.paidCents === 6500 && ana.proposedCents === 3250 && ana.chatLines === 1 && eric?.paidCents === 5000
    && /if \(sub\.data\.advocateId && sub\.data\.advocateId !== env\.ADMIN_UID\) return null;/.test(stepSrc),
    JSON.stringify({ ana: [ana?.paidCents, ana?.proposedCents], eric: eric?.paidCents }));
}

// ---- K6 ----------------------------------------------------------------------------------------------------------------
{
  const SUB = f('public/js/subscribe.js');
  const SUBN = f('public/js/subscription.js');
  const CP = f('public/js/chat-page.js');
  const BOOK = f('public/js/book.js');
  const WIZ = f('public/js/admin-wizard.js');
  const SSET = f('public/js/admin-staffsettings.js');
  const SSW = f('worker/staffsettings.js');
  const API = f('public/js/demo/api.js');
  // NEGATIVE CONTROL (run 2026-10-17, v7.73): subscribe.js's `advocate: ADVOCATE, quotedCents: subCents` taken out of the POST made this read
  //   FAIL  K6 the pages: subscribe names them and sends their price, the chat names them, their booking page and settings link to it, Employer mode switches it with a price, and the demo mirrors it
  check('K6 the pages: subscribe names them and sends their price, the chat names them, their booking page and settings link to it, Employer mode switches it with a price, and the demo mirrors it',
    /fetch\(`\/api\/rates\?advocate=\$\{encodeURIComponent\(ADVOCATE\)\}`\)/.test(SUB) && /if \(ADVOCATE\) offered = r\?\.chatOffered === true;/.test(SUB)
    && /\.\.\.\(ADVOCATE \? \{ advocate: ADVOCATE, quotedCents: subCents \} : \{\}\)/.test(SUB)
    && /\$\{advName \? termsFor\(SUBSCRIPTION_TERMS\.body, advName, subCents\) : SUBSCRIPTION_TERMS\.body\}/.test(SUB)
    && /'s chat line` : 'This chat line'\} is not open right now\./.test(SUB)
    && /const first = await advocateFirstName\(sub\.advocateId\);/.test(SUBN) && /otherName: first,/.test(SUBN) && /officeFor\(sub\.advocateId \|\| ''\);/.test(SUBN)
    && /advocateId: s\.advocateId \|\| '',/.test(CP)
    && /href="\/subscribe\.html\?advocate=\$\{encodeURIComponent\(ADVOCATE\)\}">Or start a 24\/7 Priority Chat line/.test(BOOK) && (BOOK.match(/addChatLink\(el\)\.catch/g) || []).length === 2
    && /data-offer="chat"/.test(WIZ) && /data-rate="subCents"/.test(WIZ) && /for \(const k of \['case', 'full', 'chat'\]\) st\.offers\[k\]/.test(WIZ) && !/Priority Chat stays yours/.test(WIZ)
    && /\['subCents', '24\/7 Priority Chat, \$ a month'/.test(SSET) && /data-ssh-chat/.test(SSET)
    && /chatPath: mine\.offers\.chat \? `\/subscribe\.html\?advocate=\$\{encodeURIComponent\(staff\.uid\)\}` : null,/.test(SSW)
    && /if \(adv && theirs\?\.settings\?\.offers\?\.chat !== true\) return fail\(404, 'That chat line is not open\.'\);/.test(API) && /chatOffered \}\);/.test(API)
    && ![SUB, SUBN, (BOOK.match(/\nasync function addChatLink\([\s\S]*?\n\}/) || ['-'])[0], SSET].some((x) => DASH.test(x)));
}

// ---- K7 ----------------------------------------------------------------------------------------------------------------
// Eric, 2026-10-17, on a contractor's chat terms: "Simply replace 'me' with the advocate's name". His terms are lifted
// from waivers.js (frozen, unchanged) and run through the page's own termsFor.
{
  const { SUBSCRIPTION_TERMS } = await import(pathToFileURL(join(ROOT, 'public/js/waivers.js')).href);
  const SUB = f('public/js/subscribe.js');
  const src = (SUB.match(/\nfunction termsFor\([\s\S]*?\n\}/) || [''])[0];
  const money = (c) => (c / 100).toLocaleString('en-US', c % 100 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {});
  const esc = (v) => String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const termsFor = src ? new Function('esc', 'money', `${src} return termsFor;`)(esc, money) : () => '';
  const theirs = termsFor(SUBSCRIPTION_TERMS.body, 'Ana Rivera', 6500);
  const words = theirs.replace(/<[^>]+>/g, ' ');
  const same = (h) => theirs.includes(h);
  // NEGATIVE CONTROL (run 2026-10-17, v7.73): termsFor's `nothing I write` replacement taken out made this read
  //   FAIL  K7 their chat terms are his, word for word, with their name wherever his say me, my or I, and their price for his
  check('K7 their chat terms are his, word for word, with their name wherever his say me, my or I, and their price for his',
    !/\b(me|my|I)\b/.test(words)
    && same("an always-open chat line to Ana Rivera, with Ana's live online status visible. Ana replies on their own time, when they are available.")
    && same('nothing Ana writes is a diagnosis') && same('$65 per month through Stripe') && !same('$50')
    && same('<p>The subscription is independent of any Advocacy Case. Case chats live in their case file and close with the case; this chat lives with your subscription.</p>')
    && termsFor(SUBSCRIPTION_TERMS.body, 'Ana Rivera', 6500).length > SUBSCRIPTION_TERMS.body.length - 40,
    words.slice(0, 300));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
