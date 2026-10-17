// steps.mjs - every step up an enhancement, a contractor's add-ons, Act is Log, and his voice alone (v7.65).
//
// Eric, 2026-10-17: "No voice study for contractors besides myself. Also, make every step up an enhancement. ...
// Get rid of the specific 'appeals' tab in 'act'. So just replace that whole tab with simply 'log'"
//
//   V1 the voice study, the draft writer's sample and the profile read only what Eric sent, by his own uid
//   U1 the client's upgrade card quotes what the Worker charges: the difference before the report, the month after
//   N1 a delivered report tells the client of a new enhancement and lights Enhance, only while there is one to buy
//   A1 each advocate's add-ons: his own on his word, a contractor's off until set, every price checked
//   A2 an appeal is asked for, answered by the case's advocate, and lands on the case once paid
//   A3 attending an appointment on Full-Service is the advocate's own price, or not offered
//   A4 Employer mode sets them: toggles with a price when adding, and their photo opens the profile to change them
//   A5 the client's appeal card, in its states, and gone while sales are off
//   B1 a renewing chat line steps up with its $50 month off, and only an accepted case ends it
//   B2 the booking page and the chat page offer it, quoting the Worker's figures
//   M1 another month is the case's own month price, on the card and at checkout
//   C1 the package words: appeals and attending are enhancements on top; the new files carry no dash
//   G1 no module a client loads imports one the Worker only serves to staff
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
/** One top-level declaration of a file, from its first line to the line that closes it. */
const lift = (src, head) => {
  const at = src.indexOf(head);
  if (at < 0) return '';
  const end = src.indexOf('\n}\n', at);
  const semi = src.indexOf(';\n', at);
  return head.startsWith('const ') ? src.slice(at, semi + 1) : src.slice(at, end + 2);
};

console.log('\n--- his voice, his alone ---');
{
  const ADV = f('worker/advisor.js');
  let mine = null;
  try {
    mine = new Function(`${lift(ADV, 'const ericWrote = ')}\n${lift(ADV, 'function myVoice(env, rows) {')}\nreturn myVoice;`)();
  } catch { /* read below */ }
  const rows = [
    { data: { role: 'admin', from: 'eric', text: 'From Eric, one.' } },
    { data: { role: 'admin', from: 'ana', text: 'From a contractor.' } },
    { data: { role: 'client', from: 'kim', text: 'From the client.' } },
    { data: { role: 'admin', text: 'No sender at all.' } },
    { data: { role: 'admin', from: 'eric', text: 'From Eric, two.' } },
  ];
  const got = mine ? mine({ ADMIN_UID: 'eric' }, rows) : '';
  const unset = mine ? mine({}, rows) : 'x';
  const corpus = ADV.slice(ADV.indexOf('export async function voiceCorpus('), ADV.indexOf('export async function voiceCorpus(') + 4000);
  const distill = ADV.slice(ADV.indexOf('export async function runStyleDistill('), ADV.indexOf('export async function runStyleDistill(') + 3000);
  // NEGATIVE CONTROL (run 2026-10-17): voiceCorpus's filter put back to `r.data.role === 'admin' && r.data.text` made this read
  //   FAIL  V1 the voice study, the draft writer's sample and the profile read only what Eric sent, by his own uid
  check('V1 the voice study, the draft writer\'s sample and the profile read only what Eric sent, by his own uid',
    got === 'From Eric, one.\n---\nFrom Eric, two.' && unset === ''
    && /const mine = rows\.filter\(\(r\) => ericWrote\(env, r\) && r\.data\.text\)/.test(corpus)
    && /\.filter\(\(r\) => ericWrote\(env, r\) && r\.data\.text\n\s+&& !sentSet\.has/.test(distill)
    && /const hisVoice = myVoice\(env, rows\);/.test(ADV) && !/role === 'admin' && r\.data\.text/.test(corpus + distill),
    JSON.stringify({ got, unset }));
}

console.log('\n--- the step up from a case ---');
{
  const CASE = f('public/js/case.js');
  let quote = null;
  try {
    quote = new Function('fullAccessPrice', `${lift(CASE, 'const reportDelivered = ')}\n${lift(CASE, 'function upgradeQuoteCents(c) {')}\nreturn upgradeQuoteCents;`)(() => 440000);
  } catch { /* read below */ }
  const before = quote ? quote({ caseRateCents: 210000, status: 'awaiting_report' }) : 0;
  const after = quote ? quote({ caseRateCents: 210000, status: 'confirmed', reportDeliveredAt: '2026-10-01' }) : 0;
  // NEGATIVE CONTROL (run 2026-10-17): case.js's `if (reportDelivered(c)) return month;` taken out made this read
  //   FAIL  U1 the client's upgrade card quotes what the Worker charges: the difference before the report, the month after
  check('U1 the client\'s upgrade card quotes what the Worker charges: the difference before the report, the month after',
    before === 230000 && after === 440000
    && /Full-Service takes the place of your written report, so the report is not written\./.test(CASE)
    && /Your case fee paid for the review and the report you have; this pays for the month\./.test(CASE),
    JSON.stringify({ before, after }));

  const W = f('worker/index.js');
  // NEGATIVE CONTROL (run 2026-10-17): report-uploaded's `const enhance = SALES_OPEN && !doc.data.family;` made `const enhance = !doc.data.family;` made this read
  //   FAIL  N1 a delivered report tells the client of a new enhancement and lights Enhance, only while there is one to buy
  check('N1 a delivered report tells the client of a new enhancement and lights Enhance, only while there is one to buy',
    // RE-PINNED 2026-10-17 (v7.72): Eric, "My services are off. How do I toggle them back on in app?" There is one to buy while the
    // Advocacy Case or Full-Service switch is on, read from his store; the client's page asks the same before it lights the tab.
    // NEGATIVE CONTROL (run 2026-10-17, v7.72): report-uploaded's `(sw.case || sw.full) && ` taken out made N1 read FAIL.
    /const sw = await readSwitches\(env\);\n\s+const enhance = \(sw\.case \|\| sw\.full\) && !doc\.data\.family;\n\s+await patchDoc\(env, `cases\/\$\{caseId\}`, \{\n\s+status: 'delivered', reportDeliveredAt: now, \.\.\.\(enhance \? \{ enhancementAt: now \} : \{\}\),/.test(W)
    && /body: enhance \? 'Your report is ready\. You have a new enhancement on your case\.' : 'Your report is ready\.',\n\s+link: `\/case\.html\?id=\$\{caseId\}\$\{enhance \? '&page=addons' : ''\}`,/.test(W)
    && /folder\?\.mark\?\.\('addons', anyOpen\(\) && !c\.family && !c\.fullAccess && isUnseen\(enhanceKey\(c\), toDate\(c\.enhancementAt\)\.getTime\(\)\)\);/.test(CASE)
    && /onShow: \(id\) => \{ if \(id === 'addons'\) \{ markSeen\(enhanceKey\(c\)\); folder\?\.mark\('addons', false\); \} \},/.test(CASE)
    // seen.js is his, and the Worker never serves it to a client: imported here it stopped the whole case page loading.
    && !/from '\.\/seen\.js'/.test(CASE)
    && /if \(folder\.el\(asked\)\) folder\.show\(asked\);/.test(CASE)
    && !DASH.test((W.match(/subject: 'Your Pocket Advocate report is ready',[\s\S]{0,900}/) || [''])[0]));
}

console.log('\n--- the add-ons ---');
const ADD = await import(pathToFileURL(join(ROOT, 'worker/addons.js')).href);
{
  const his = ADD.addonsOf(null, { owner: true });
  const theirs = ADD.addonsOf({ name: 'Ana' });
  const set = ADD.addonsOf({ addons: { attend: { on: true, cents: 30000 }, appeal: { on: false, cents: 9 } } });
  const bad = [ADD.cleanAddons({ appeal: { on: true, cents: 49 } }), ADD.cleanAddons({ attend: { on: true, cents: -1 } }), ADD.cleanAddons({ attend: { on: true, cents: 2_000_001 } }), ADD.cleanAddons(null)];
  const good = ADD.cleanAddons({ attend: { on: true, cents: 0 }, appeal: { on: false, cents: '' } });
  // NEGATIVE CONTROL (run 2026-10-17): OWNER_ADDONS's appeal set to 30000 made this read
  //   FAIL  A1 each advocate's add-ons: his own on his word, a contractor's off until set, every price checked
  // RE-PINNED 2026-10-17 (v7.68): every advocate's add-ons carry a list of his own extras for them, empty until set.
  // NEGATIVE CONTROL (run 2026-10-17, v7.68): OWNER_ADDONS's appeal set to 30000 made A1 read FAIL.
  check('A1 each advocate\'s add-ons: his own on his word, a contractor\'s off until set, every price checked',
    JSON.stringify(his) === '{"attend":{"on":true,"cents":52500},"appeal":{"on":true,"cents":35000},"custom":[]}'
    && JSON.stringify(theirs) === '{"attend":{"on":false,"cents":0},"appeal":{"on":false,"cents":0},"custom":[]}'
    && set.attend.on && set.attend.cents === 30000 && !set.appeal.on
    && bad.every((r) => !!r.error) && !good.error && good.value.attend.on && good.value.attend.cents === 0 && !good.value.appeal.on,
    JSON.stringify({ his, theirs, bad, good }));

  // The request and the answer, run against a stand-in store.
  const SRC = f('worker/addons.js').replace(/^import [\s\S]*?from '[^']+';\n/gm, '').replace(/^export (const|async function|function) /gm, '$1 ');
  const docs = new Map();
  const calls = { stripe: [], pings: [], pushes: [] };
  const mod = new Function('getDoc', 'patchDoc', `${SRC}\nreturn { handleAddonRequest, handleAddonDecision, confirmAddonPurchase };`)(
    async (env, p) => (docs.has(p) ? { data: docs.get(p), updateTime: 't' } : null),
    async (env, p, fields) => { docs.set(p, { ...(docs.get(p) || {}), ...fields }); return true; });
  const env = { ADMIN_UID: 'eric' };
  const req = (body) => ({ json: async () => body });
  const json = (o, s = 200) => ({ status: s, body: o });
  const hUser = (uid) => ({ requireUser: async () => ({ uid }), json, pingCase: async (e, c, text) => calls.pings.push(text), advocateIdOf: (c) => c.advocateId || 'eric' });
  const confirm = (e, s) => mod.confirmAddonPurchase(e, s, { pingCase: async () => {} });
  const hStaff = { requireStaff: async () => ({ uid: 'eric', isAdmin: true }), staffSees: () => true, json, notifyUser: async (e, uid, m) => calls.pushes.push(m), stripePost: async (e, path, p) => { calls.stripe.push(p); return { id: 'cs_1', url: 'https://pay.test/1' }; }, confirm, baseUrl: 'https://app.test' };
  docs.set('advocates/eric', { owner: true });
  docs.set('advocates/ana', { active: true, addons: { attend: { on: false, cents: 0 }, appeal: { on: false, cents: 0 } } });
  docs.set('cases/c1', { clientUid: 'kim', clientName: 'Kim Lee', fullAccess: true, status: 'confirmed' });
  docs.set('cases/c2', { clientUid: 'kim', fullAccess: false, status: 'confirmed' });
  docs.set('cases/c3', { clientUid: 'kim', fullAccess: true, status: 'confirmed', advocateId: 'ana' });
  const notFull = await mod.handleAddonRequest(req({ caseId: 'c2', kind: 'appeal' }), env, hUser('kim'));
  const notOffered = await mod.handleAddonRequest(req({ caseId: 'c3', kind: 'appeal' }), env, hUser('kim'));
  const stranger = await mod.handleAddonRequest(req({ caseId: 'c1', kind: 'appeal' }), env, hUser('zed'));
  const asked = await mod.handleAddonRequest(req({ caseId: 'c1', kind: 'appeal', note: 'The MRI denial' }), env, hUser('kim'));
  const twice = await mod.handleAddonRequest(req({ caseId: 'c1', kind: 'appeal' }), env, hUser('kim'));
  const noReason = await mod.handleAddonDecision(req({ caseId: 'c1', decision: 'decline', reason: '' }), env, hStaff);
  const yes = await mod.handleAddonDecision(req({ caseId: 'c1', decision: 'approve' }), env, hStaff);
  const pend = docs.get('cases/c1');
  await mod.confirmAddonPurchase(env, { id: 'cs_1', amount_total: 35000, metadata: { kind: 'addon', caseId: 'c1', addon: 'appeal' } }, { pingCase: async () => {} });
  await mod.confirmAddonPurchase(env, { id: 'cs_1', amount_total: 35000, metadata: { kind: 'addon', caseId: 'c1', addon: 'appeal' } }, { pingCase: async () => {} });
  const paid = docs.get('cases/c1');
  // A second appeal, given at no charge.
  await mod.handleAddonRequest(req({ caseId: 'c1', kind: 'appeal' }), env, hUser('kim'));
  const comp = await mod.handleAddonDecision(req({ caseId: 'c1', decision: 'approve', amountCents: 0 }), env, hStaff);
  const comped = docs.get('cases/c1');
  // NEGATIVE CONTROL (run 2026-10-17): handleAddonRequest's `if (!c.data.fullAccess)` refusal taken out made this read
  //   FAIL  A2 an appeal is asked for, answered by the case's advocate, and lands on the case once paid
  check('A2 an appeal is asked for, answered by the case\'s advocate, and lands on the case once paid',
    notFull.status === 409 && notOffered.status === 409 && stranger.status === 404
    && asked.status === 200 && asked.body.cents === 35000 && twice.status === 409 && calls.pings.some((x) => /asking for writing an insurance appeal/.test(x))
    && noReason.status === 400
    && yes.status === 200 && yes.body.cents === 35000 && calls.stripe[0]?.metadata?.kind === 'addon' && calls.stripe[0]?.metadata?.addon === 'appeal' && calls.stripe[0]?.line_items?.[0]?.price_data?.unit_amount === 35000
    && pend.addonRequest.state === 'approved' && pend.pendingAddon?.url === 'https://pay.test/1'
    && paid.addonsBought?.length === 1 && paid.addonsBought[0].cents === 35000 && paid.extraPayments.filter((x) => x.kind === 'addon').length === 1 && paid.pendingAddon === null && paid.addonRequest.state === 'started'
    && comp.body.comped === true && comped.addonsBought.length === 2 && comped.addonsBought[1].cents === 0
    && calls.pushes.some((m) => /said yes to writing an insurance appeal/.test(m.body)),
    JSON.stringify({ notFull: notFull.status, notOffered: notOffered.status, asked: asked.body, yes: yes.body, bought: paid.addonsBought?.length, comped: comped.addonsBought?.length }));

  const W = f('worker/index.js');
  // NEGATIVE CONTROL (run 2026-10-17): handleTelehealthRequest's `if (!attend.on) return json(` refusal taken out made this read
  //   FAIL  A3 attending an appointment on Full-Service is the advocate's own price, or not offered
  check('A3 attending an appointment on Full-Service is the advocate\'s own price, or not offered',
    /if \(c\.data\.fullAccess\) \{\n\s+const attend = \(await caseAddons\(env, c\.data, advocateIdOf\)\)\.attend;\n\s+if \(!attend\.on\) return json\(\{ error: 'Your advocate does not come to appointments on Full-Service\. Ask in chat\.' \}, 409\);\n\s+cents = attend\.cents;\n\s+\}/.test(W)
    && /line_items: telehealthLineItems\(cents\),/.test(W)
    && /else if \(obj\.metadata\?\.kind === 'addon'\) await confirmAddonPurchase\(env, obj, \{ pingCase \}\);/.test(W)
    // RE-PINNED 2026-10-17 (v7.72): the purchase routes name their service; an add-on asked for is Full-Service's.
    // NEGATIVE CONTROL (run 2026-10-17, v7.72): `['/api/addon-request', ['full']]` taken out of SALES_ROUTES made A3 read FAIL.
    && /\['\/api\/addon-request', \['full'\]\],?\n\]\);/.test(W)
    && /\.\.\.\(addons \? \{ addons \} : \{\}\),/.test(W));

  const EMP = f('public/js/admin-employer.js');
  const ACC = f('public/js/admin-accounts.js');
  const ADV = f('worker/advocates.js');
  // NEGATIVE CONTROL (run 2026-10-17): the team card's `data-face` listener taken out made this read
  //   FAIL  A4 Employer mode sets them: toggles with a price when adding, and their photo opens the profile to change them
  // RE-PINNED 2026-10-17 (v7.68): adding them, and their photo, open the page by page wizard (admin-wizard.js), whose
  // add-ons page has the same toggles with a price.
  // NEGATIVE CONTROL (run 2026-10-17, v7.68): the wizard's `${addonFields(st.addons)}` taken out made A4 read FAIL.
  const WIZ = f('public/js/admin-wizard.js');
  check('A4 Employer mode sets them: toggles with a price when adding, and their photo opens the profile to change them',
    /\$\{addonFields\(st\.addons\)\}/.test(WIZ) && /const picked = readAddonFields\(dlg\);/.test(WIZ) && /settings, addons, payout,/.test(WIZ)
    && /return openAdvocateWizard\(user, \{ mode: 'add', say, done \}\);/.test(ACC)
    && /<button type="button" class="tm-face" data-face aria-label=/.test(EMP) && /el\.querySelector\('\[data-face\]'\)\?\.addEventListener\('click', \(\) => editProfile\(p\)\);/.test(EMP)
    && /return openAdvocateWizard\(user, \{ mode: 'edit', uid: p\.uid, say: teamSay, done: load \}\);/.test(EMP)
    && /const addons = body\.addons === undefined \? \{ value: addonsOf\(null\) \} : cleanAddons\(body\.addons\);/.test(ADV) && /addons: addons\.value,/.test(ADV)
    && /if \('addons' in body\) \{\n\s+const addons = cleanAddons\(body\.addons\);/.test(ADV)
    && /addons: addonsOf\(a\.data, \{ owner \}\),/.test(f('worker/employer.js'))
    && f('tools/blindness-audit.mjs').includes("'/js/admin-addons.js'"));

  const CASE = f('public/js/case.js');
  const card = lift(CASE, 'function appealCard(c) {');
  // NEGATIVE CONTROL (run 2026-10-17): appealCard's `if (!offer?.on) return` line made it offer whatever the advocate set made this read
  //   FAIL  A5 the client's appeal card, in its states, and gone while sales are off
  check('A5 the client\'s appeal card, in its states, and gone while sales are off',
    ['approved', 'pending', 'declined', 'offer', 'done'].every((s) => card.includes(`data-appeal-state="${s}"`))
    && /if \(!c\.fullAccess\) return '';/.test(card) && /if \(!offer\?\.on\) return done/.test(card)
    && /Asking costs nothing and takes no card\. Nothing is\s+charged unless \$\{adv\} says yes\./.test(card)
    // RE-PINNED 2026-10-17 (v7.68): SELLING goes on past the appeal's buttons, to his own extras'.
    // NEGATIVE CONTROL (run 2026-10-17, v7.68): `[data-appeal-again],` taken out of SELLING made A5 read FAIL.
    // RE-PINNED 2026-10-17 (v7.72): the appeal card goes with the Full-Service switch.
    // NEGATIVE CONTROL (run 2026-10-17, v7.72): `keepCard(ap, fullOpen())` made `keepCard(ap, caseOpen())` (both places) made A5 read FAIL.
    && /\[data-request-appeal\],\[data-appeal-again\],/.test(CASE) && (CASE.match(/ap\.innerHTML = appealCard\(c\); wireAppealCard\(ap, c\); keepCard\(ap, fullOpen\(\)\);/g) || []).length === 2);
}

console.log('\n--- from chat ---');
{
  const STEP = f('worker/stepup.js').replace(/^import [\s\S]*?from '[^']+';\n/gm, '').replace(/^export (const|async function|function) /gm, '$1 ');
  const docs = new Map();
  const stripe = [];
  const m = new Function('getDoc', 'patchDoc', `${STEP}\nreturn { chatStepUp, stepUpPrice, endChatForStepUp, CHAT_STEP_CREDIT_CENTS };`)(
    async (env, p) => (docs.has(p) ? { data: docs.get(p) } : null),
    async (env, p, fields) => { docs.set(p, { ...(docs.get(p) || {}), ...fields }); return true; });
  docs.set('subscriptions/kim', { status: 'active', subscriptionId: 'sub_1' });
  docs.set('subscriptions/ended', { status: 'canceled', subscriptionId: 'sub_2' });
  docs.set('subscriptions/used', { status: 'active', subscriptionId: 'sub_3', stepUpCaseId: 'old' });
  const kim = await m.chatStepUp({}, 'kim');
  const none = [await m.chatStepUp({}, 'ended'), await m.chatStepUp({}, 'used'), await m.chatStepUp({}, 'nobody')];
  const rates = { caseCents: 210000, fullCents: 440000 };
  const prices = [m.stepUpPrice(rates, { step: kim }), m.stepUpPrice(rates, { full: true, step: kim }), m.stepUpPrice(rates, {})];
  docs.set('cases/k1', { clientUid: 'kim', chatStepUp: { creditCents: 5000, subscriptionId: 'sub_1', endedAt: null } });
  const ended = await m.endChatForStepUp({}, 'k1', docs.get('cases/k1'), { stripePost: async (e, path, p) => { stripe.push([path, p]); return {}; } });
  const again = await m.endChatForStepUp({}, 'k1', docs.get('cases/k1'), { stripePost: async (e, path, p) => { stripe.push([path, p]); return {}; } });
  const W = f('worker/index.js');
  // NEGATIVE CONTROL (run 2026-10-17): chatStepUp's `|| sub.data.stepUpCaseId` taken out (a credit spent twice) made this read
  //   FAIL  B1 a renewing chat line steps up with its $50 month off, and only an accepted case ends it
  check('B1 a renewing chat line steps up with its $50 month off, and only an accepted case ends it',
    m.CHAT_STEP_CREDIT_CENTS === 5000 && kim?.creditCents === 5000 && kim.subscriptionId === 'sub_1' && none.every((x) => x === null)
    && prices.join() === '205000,435000,210000'
    && ended === true && again === false && stripe.length === 1 && stripe[0][0] === '/subscriptions/sub_1' && stripe[0][1].cancel_at_period_end === 'true'
    && docs.get('subscriptions/kim').stepUpCaseId === 'k1' && !!docs.get('cases/k1').chatStepUp.endedAt
    && /if \(body\?\.tier === 'full' && !step\)\n\s+return json\(\{/.test(W) && /if \(body\?\.tier === 'full' && typeof body\?\.acks\?\.\[FULL_ACCESS_ACK\] !== 'number'\)/.test(W)
    && (W.match(/const priceCents = stepUpPrice\(live, \{ full, step \}\);/g) || []).length === 2
    && (W.match(/\.\.\.stepMeta\(step, full\),/g) || []).length === 2
    && /\.\.\.\(Number\(m\.chatCredit\) > 0 \? \{ chatStepUp: \{ creditCents: Number\(m\.chatCredit\), subscriptionId: m\.chatSub \|\| null, at: now, endedAt: null \} \} : \{\}\),/.test(W)
    && /if \(approved && c\.data\.chatStepUp\) await endChatForStepUp\(env, caseId, c\.data, \{ stripePost \}\)/.test(W)
    && /url\.pathname === '\/api\/step-up' && request\.method === 'GET'/.test(W),
    JSON.stringify({ kim, none, prices, ended, again, stripe }));

  const BOOK = f('public/js/book.js');
  const SUB = f('public/js/subscription.js');
  // NEGATIVE CONTROL (run 2026-10-17): book.js's `quotedCents: shownCents(),` made `quotedCents: caseCents,` made this read
  //   FAIL  B2 the booking page and the chat page offer it, quoting the Worker's figures
  check('B2 the booking page and the chat page offer it, quoting the Worker\'s figures',
    /const shownCents = \(\) => \(stepUp \? \(stepFull\(\) \? stepUp\.fullCents : stepUp\.caseCents\) : caseCents\);/.test(BOOK)
    && /quotedCents: shownCents\(\),/.test(BOOK) && /\.\.\.\(stepFull\(\) \? \{ tier: 'full' \} : \{\}\),/.test(BOOK)
    && /<input type="checkbox" data-step-ack disabled> I have read and acknowledge this/.test(BOOK)
    && /data-step-credit>Your \$\$\{money\(stepUp\.creditCents\)\} chat month comes off\./.test(BOOK)
    // RE-PINNED 2026-10-17 (v7.72): Eric, "My services are off. How do I toggle them back on in app?" The chat page offers each
    // way up only while his switch for it is on, and the panel only while one is.
    // NEGATIVE CONTROL (run 2026-10-17, v7.72): the step=full link's `${sales.full ? ` made `${true ? ` made B2 read FAIL.
    && /if \(renewing\(sub\) && !sub\.stepUpCaseId\) loadSales\(\)\.then\(\(\) => \(sales\.case \|\| sales\.full\) && paintStepUp\(/.test(SUB)
    && /\$\{sales\.case \? `<a class="btn glow" href="\/book\.html\?step=case"/.test(SUB) && /\$\{sales\.full \? `<a class="btn \$\{sales\.case \? 'quiet' : 'glow'\}" href="\/book\.html\?step=full"/.test(SUB));
}

console.log('\n--- another month, and the words ---');
{
  const W = f('worker/index.js');
  const CASE = f('public/js/case.js');
  // NEGATIVE CONTROL (run 2026-10-17): handleExtendCheckout's price put back to `const cents = FULL_EXTEND[30];` made this read
  //   FAIL  M1 another month is the case's own month price, on the card and at checkout
  check('M1 another month is the case\'s own month price, on the card and at checkout',
    /const cents = Number\(\(await ratesForCase\(env, c\.data\)\.catch\(\(\) => null\)\)\?\.fullCents\) \|\| FULL_EXTEND\[30\];/.test(W)
    && !/EXTEND_PRICE_CENTS/.test(CASE) && /<span class="price" data-extend-price>\$\$\{Math\.round\(fullAccessPrice\(\) \/ 100\)\.toLocaleString\(\)\}<\/span>/.test(CASE)
    && /body: JSON\.stringify\(\{ caseId: c\.id, quotedCents: fullAccessPrice\(\) \}\),/.test(CASE));

  const TT = f('public/js/tier-terms.js');
  const SA = f('public/js/service-about.js');
  const BK = f('public/js/book.js');
  const fresh = ['worker/addons.js', 'worker/stepup.js', 'public/js/admin-addons.js', 'tools/suites/steps.mjs'];
  // NEGATIVE CONTROL (run 2026-10-17): service-about.js's 'Telehealth advocacy included' bullet put back made this read
  //   FAIL  C1 the package words: appeals and attending are enhancements on top; the new files carry no dash
  check('C1 the package words: appeals and attending are enhancements on top; the new files carry no dash',
    /<h3>Enhancements on top<\/h3>/.test(TT) && !/Telehealth appointment advocacy, included/.test(TT) && !/and I write your insurance appeals\./.test(TT)
    && !/Telehealth advocacy included/.test(SA) && !/Included at no charge on Full-Service/.test(SA)
    && /Writing an insurance appeal and coming to an appointment with you: enhancements on top, at the price on your case page/.test(SA)
    && /are enhancements on top\. Most cases take about two months/.test(BK) && !/Included with Full-Service Case Management\.<\/p>/.test(BK)
    && fresh.every((p) => !DASH.test(f(p))), fresh.filter((p) => DASH.test(f(p))).join(' '));
}

console.log('\n--- what a client loads ---');
{
  // Found 2026-10-17 by drive-steps: case.js imported seen.js, which the Worker serves only to staff, so a client's
  // case page stopped at Loading. The gate is ADMIN_ASSET in worker/index.js; walked from every client page's
  // module scripts through their static imports.
  const { readdirSync } = await import('node:fs');
  const W = f('worker/index.js');
  const gate = new Function(`return ${(W.match(/const ADMIN_ASSET =\s*(\/[^\n]+\/);/) || [])[1]}`)();
  const pages = readdirSync(join(ROOT, 'public')).filter((n) => n.endsWith('.html') && !gate.test(`/${n}`));
  const seen = new Set();
  const bad = [];
  const walk = (rel, from) => {
    if (seen.has(rel)) return;
    seen.add(rel);
    if (gate.test(rel)) { bad.push(`${from} -> ${rel}`); return; }
    if (/^\/js\/demo\//.test(rel)) return; // the demo has its own gate
    let src = '';
    try { src = f(`public${rel}`); } catch { return; }
    for (const m of src.matchAll(/^\s*import\s[^'"]*['"](\.\/[\w./-]+\.js)['"]/gm)) {
      const next = new URL(m[1], `https://x${rel}`).pathname;
      walk(next, rel);
    }
  };
  for (const n of pages) {
    const html = f(`public/${n}`);
    for (const m of html.matchAll(/<script[^>]+type="module"[^>]+src="(\/js\/[\w./-]+\.js)/g)) walk(m[1], n);
  }
  // NEGATIVE CONTROL (run 2026-10-17): case.js importing `markSeen` from './seen.js' again made this read
  //   FAIL  G1 no module a client loads imports one the Worker only serves to staff
  check('G1 no module a client loads imports one the Worker only serves to staff',
    !!gate && pages.length > 15 && seen.size > 20 && !bad.length, bad.slice(0, 4).join(' | '));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
