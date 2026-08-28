// advisor-acts.mjs - what the advisor is allowed to ASK FOR, proved by
// running it rather than by looking at it.
//
// Eric, 2026-08-27: "Have the advisor have authority over settings in the app.
// Such as 'set the total price paid by this client to 3500' or 'notify client
// that there's a form he needs to fill out'." And, asked which of those should
// stop and ask him first: "Tap to confirm the ones that matter."
//
// SO THE VALIDATOR IS LIFTED AND RUN, and so is the route it guards. A regex
// cannot tell 3500 from 35000, cannot tell a refusal from a validator that
// refuses everything, and cannot tell an action that shows a card from one
// that does not. Every check below either imports the shipped module and calls
// it, or lifts the shipped route out of the Worker and executes it.
//
// Run: node tools/suites/advisor-acts.mjs
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath as f } from 'node:url';
import { dirname as d, join as j } from 'node:path';

const ROOT = j(d(f(import.meta.url)), '..', '..');
const read = (p) => readFileSync(j(ROOT, p), 'utf8');

const ACTS = await import(j(ROOT, 'worker/advisor-acts.js'));
const W = read('worker/index.js');
const ADV = read('worker/advisor.js');
const PANELSRC = read('public/js/advisor.js');
const ACTSRC = read('worker/advisor-acts.js');

const results = [];
const ck = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};

const { validateAction, ALLOWED, DENYLIST, tierOf, dispatchFor, actionTools, tablesDisagree } = ACTS;

/**
 * THE LIFT REGISTRY, and why every slab in this file goes through it.
 *
 * The -forms branch found the failure this guards on 2026-08-28, and it is
 * nastier than a lift that goes red: one of its checks was written as
 * `!/generator/.test(slab(...))` and a lost lift returns ''. A regex does not
 * match an empty string, the negation turns that into true, and the check
 * PASSED while asserting nothing at all, from the day it was written. Two of
 * mine were the same shape.
 *
 * So the slabs are lifted ONCE, here, and registered. A30 then asserts over
 * the whole registry rather than over whatever each block happened to
 * remember to guard. Lifting once also kills a second hazard that was already
 * live in this file: handleClientAlert and renderActCard were each matched by
 * TWO regexes in two places, and two copies of a pattern are two things that
 * can drift apart while both look right.
 */
const SLABS = [];
const lifted = (name, src) => { SLABS.push([name, src || '']); return src || ''; };

const LIFT = {
  handleClientAlert: lifted('handleClientAlert',
    (W.match(/async function handleClientAlert\(request, env\) \{[\s\S]*?\n\}/) || [''])[0]),
  alertConsts: lifted('alertConsts',
    (W.match(/const ALERT_MIN_GAP_MS = [^;]+;\nconst ALERT_MAX_PER_DAY = [^;]+;\nconst ALERT_TRAIL_KEEP = [^;]+;/) || [''])[0]),
  adminAssetGate: lifted('adminAssetGate', (W.match(/const ADMIN_ASSET =\n[^;]+;/) || [''])[0]),
  runQuestion: lifted('runQuestion', (ADV.match(/export async function runQuestion[\s\S]*?\n\}/) || [''])[0]),
  actDispatch: lifted('actDispatch',
    (PANELSRC.match(/export function actDispatch\(act\) \{[\s\S]*?\n\}/) || [''])[0]),
  carryAct: lifted('carryAct',
    (PANELSRC.match(/async function carryAct\(act\) \{[\s\S]*?\n  \}/) || [''])[0]),
  renderActCard: lifted('renderActCard',
    (PANELSRC.match(/function renderActCard\(act\) \{[\s\S]*?\n  \}/) || [''])[0]),
  handleAct: lifted('handleAct',
    (PANELSRC.match(/async function handleAct\(act, actError\) \{[\s\S]*?\n  \}/) || [''])[0]),
};

/**
 * The panel's dispatch, LIFTED out of the shipped file rather than imported.
 * public/js/advisor.js wires document listeners at module scope, so importing
 * it into node dies on `document is not defined`; the decision this file has
 * to run is a pure function and lifts cleanly. A lift that loses its target
 * comes back null and A10 goes red, which is the point.
 */
const PANEL = (() => {
  const src = LIFT.actDispatch.replace(/^export /, '');
  try { return { actDispatch: src ? new Function(`${src}\nreturn actDispatch;`)() : null }; }
  catch { return { actDispatch: null }; }
})();

// ---- A1: it lifts and runs at all ---------------------------------------
// NEGATIVE CONTROL (run 2026-08-28): renaming validateAction to validateAct in
// the shipped module made this read
//   FAIL  A1 the allowlist module lifts out of the Worker and runs  -- validateAction undefined
ck('A1 the allowlist module lifts out of the Worker and runs',
  typeof validateAction === 'function' && Array.isArray(ALLOWED) && ALLOWED.length > 0,
  typeof validateAction !== 'function' ? 'validateAction undefined' : `${ALLOWED?.length} actions`);

// ---- A2-A3: every allowlisted action, good arguments and bad -------------
// One row per action. `good` must validate; every entry in `bad` must not.
// Adding an action to the table without adding a row here fails A2c.
const TABLE = {
  'set-paid': {
    good: { dollars: 3500 },
    bad: [{}, { dollars: 0 }, { dollars: -100 }, { dollars: '3500' },
      { dollars: Number.NaN }, { dollars: 10_000_000 }, { dollars: null }],
  },
  'office-hours': {
    good: { manual: 'out' },
    bad: [{}, { manual: 'maybe' }, { manual: 3 }, { responseTime: 'x'.repeat(200) },
      { responseTime: '<b>soon</b>' }, { responseTime: 7 }],
  },
  'booking-closure': {
    good: { weeks: 2 },
    bad: [{}, { weeks: -1 }, { weeks: 27 }, { weeks: 1.5 }, { weeks: '2' }, { weeks: Number.NaN }],
  },
  'full-capacity': {
    good: { maxOpen: 2 },
    bad: [{}, { maxOpen: -1 }, { maxOpen: 100 }, { maxOpen: 2.5 }, { maxOpen: '2' }],
  },
  'work-clock': {
    good: { on: true },
    bad: [{}, { on: 'yes' }, { on: 1 }, { on: null }],
  },
  'work-correct': {
    good: { hours: 17.75 },
    bad: [{}, { hours: -1 }, { hours: 4001 }, { hours: '17' }, { hours: Number.NaN }],
  },
  'client-message': {
    good: { instruction: 'Tell him there is a form he needs to fill out.' },
    bad: [{}, { instruction: '' }, { instruction: '   ' }, { instruction: 'x'.repeat(1001) },
      { instruction: 42 }],
  },
  'client-alert': {
    good: { text: 'Your insurance form is due today. Please open your case.' },
    bad: [{}, { text: '' }, { text: '   ' }, { text: 'x'.repeat(141) },
      { text: '<img src=x onerror=alert(1)>' }, { text: 99 }],
  },
};

{
  const missing = ALLOWED.filter((n) => !TABLE[n]);
  const extra = Object.keys(TABLE).filter((n) => !ALLOWED.includes(n));
  // NEGATIVE CONTROL (run 2026-08-28): deleting the 'work-clock' row from
  // TABLE made this read
  //   FAIL  A2c every allowlisted action is exercised here, with no gaps  -- untested: work-clock
  ck('A2c every allowlisted action is exercised here, with no gaps',
    !missing.length && !extra.length,
    `untested: ${missing.join(', ') || 'none'}${extra.length ? ` / unknown: ${extra.join(', ')}` : ''}`);

  const goodFails = [];
  const badPasses = [];
  for (const name of ALLOWED) {
    const row = TABLE[name];
    if (!row) continue;
    const ok = validateAction(name, row.good);
    if (!ok.ok || !ok.args || !ok.summary || !ok.tier) goodFails.push(`${name}: ${ok.error || 'no args/summary/tier'}`);
    for (const args of row.bad) {
      const out = validateAction(name, args);
      if (out.ok) badPasses.push(`${name} ${JSON.stringify(args).slice(0, 40)}`);
    }
  }
  // NEGATIVE CONTROL (run 2026-08-28): changing set-paid's summary to an empty
  // string in the shipped module made this read
  //   FAIL  A2 every allowlisted action validates with arguments he would give  -- set-paid: no args/summary/tier
  ck('A2 every allowlisted action validates with arguments he would give',
    !goodFails.length, goodFails.join(' | '));
  // NEGATIVE CONTROL (run 2026-08-28): dropping the `cents < 100` half of the
  // money bound made this read
  //   FAIL  A3 and refuses every argument he would not  -- set-paid {"dollars":0} | set-paid {"dollars":-100}
  ck('A3 and refuses every argument he would not', !badPasses.length, badPasses.join(' | '));
}

// ---- A4-A5: HIS MONEY, to the cent --------------------------------------
// This is the check the whole file exists for. A regex passes on a version
// that stores a hundred times the figure he typed, and the version that stored
// the wrong figure is the version that would ship.
{
  const cents = (dollars) => {
    const out = validateAction('set-paid', { dollars });
    return out.ok ? out.args.paidCents : null;
  };
  // NEGATIVE CONTROL (run 2026-08-28): changing dollarsToCents to
  // Math.round(v * 1000) made this read
  //   FAIL  A4 3500 dollars is 350000 cents, and not 3500000  -- 3500000
  ck('A4 3500 dollars is 350000 cents, and not 3500000', cents(3500) === 350000, `${cents(3500)}`);
  // The neighbouring keystroke, named so it can never come back quietly.
  // NEGATIVE CONTROL (run 2026-08-28): renaming dollarsToCents to clamp at
  // Math.min(v, 3500) made this read
  //   FAIL  A4b and 35000 dollars is a different number entirely  -- 350000
  ck('A4b and 35000 dollars is a different number entirely',
    cents(35000) === 3500000 && cents(35000) !== cents(3500), `${cents(35000)}`);
  // NEGATIVE CONTROL (run 2026-08-28): raising the floor to `cents < 10000`
  // made this read
  //   FAIL  A5 one dollar passes and one hundred thousand passes  -- $1 -> null, $100,000 -> 10000000
  ck('A5 one dollar passes and one hundred thousand passes',
    cents(1) === 100 && cents(100_000) === 10_000_000,
    `$1 -> ${cents(1)}, $100,000 -> ${cents(100_000)}`);
  const refused = [0, -1, -3500, Number.NaN, Infinity, '3500', null, undefined, {}, [], 10_000_000]
    .filter((v) => cents(v) !== null);
  // NEGATIVE CONTROL (run 2026-08-28): the same raised-floor break instead
  // let nothing through, so this one was broken the other way, by removing the
  // `> 100_000_00` half of the bound, which made this read
  //   FAIL  A6 zero, negative, NaN, a string and ten million dollars are all refused  -- let through: 10000000
  ck('A6 zero, negative, NaN, a string and ten million dollars are all refused',
    !refused.length, `let through: ${refused.map(String).join(', ')}`);
  // And the boundary itself, in the unit the route stores: one cent over the
  // ceiling is refused, the ceiling exactly is not.
  // NEGATIVE CONTROL (run 2026-08-28): moving the ceiling to cents > 100_000_01
  // made this read
  //   FAIL  A6b the ceiling is exact: $100,000.00 passes, $100,000.01 does not  -- 10000000 / 10000001
  ck('A6b the ceiling is exact: $100,000.00 passes, $100,000.01 does not',
    cents(100_000) === 10_000_000 && cents(100_000.01) === null,
    `${cents(100_000)} / ${cents(100_000.01)}`);
}

// ---- A7-A9: the denylist ------------------------------------------------
// Never proposable, whatever the model says, and refused BEFORE the allowlist
// is consulted so the two tables can never race.
{
  const perfect = {
    close: {}, 'close-case': { reason: 'done' }, 'delete-file': { path: 'cases/abc/x.pdf' },
    'open-full': { tierCents: 340000 }, 'report-uploaded': {},
    'set-rates': { caseCents: 120000 }, rates: { caseCents: 120000 }, price: { dollars: 1200 },
    sign: { name: 'Jordan Avery' }, 'sign-authority': { name: 'Jordan Avery' },
    revoke: {}, 'revoke-authority': {},
  };
  const slipped = DENYLIST.filter((n) => validateAction(n, perfect[n] || {}).ok);
  // NEGATIVE CONTROL (run 2026-08-28): adding a working 'close' entry to ACTS
  // and moving the DENIED lookup to AFTER the ACTS lookup made this read
  //   FAIL  A7 a denylisted action is refused even when the model names it perfectly  -- got through: close
  ck('A7 a denylisted action is refused even when the model names it perfectly',
    !slipped.length && DENYLIST.length >= 8, `got through: ${slipped.join(', ')}`);
  // Each one refuses with a SENTENCE, because Eric is the one who reads it.
  const mute = DENYLIST.filter((n) => {
    const out = validateAction(n, {});
    return !out.denied || typeof out.error !== 'string' || out.error.length < 20;
  });
  // NEGATIVE CONTROL (run 2026-08-28): returning { ok: false, error: 'no' } for a
  // denylisted name instead of its sentence made this read
  //   FAIL  A7b and each refusal says why, in words he can read  -- close, close-case, delete-file, open-full, report-uploaded, set-rates, rates, price, sign, sign-authority, revoke, revoke-authority
  ck('A7b and each refusal says why, in words he can read', !mute.length, mute.join(', '));
  // The six he named, each present under whatever spelling the model reaches
  // for. A price is the CLAUDE.md iron rule; a signature is the one refusal
  // worker/index.js already makes against an admin and will not negotiate.
  const need = ['close', 'delete-file', 'open-full', 'report-uploaded', 'set-rates', 'sign', 'revoke'];
  // NEGATIVE CONTROL (run 2026-08-28): deleting the delete-file row from DENIED
  // made this read
  //   FAIL  A7c every category he ruled out is actually on the list  -- delete-file
  ck('A7c every category he ruled out is actually on the list',
    need.every((n) => DENYLIST.includes(n)), need.filter((n) => !DENYLIST.includes(n)).join(', '));
  // NEGATIVE CONTROL (run 2026-08-28): adding a `close` entry to ACTS made
  // this read
  //   FAIL  A8 the allowlist and the denylist cannot both claim a name  -- close
  ck('A8 the allowlist and the denylist cannot both claim a name',
    tablesDisagree().length === 0, tablesDisagree().join(', '));
}

// THE SILENT PASS. A validator that refused EVERYTHING would satisfy most of
// this file, and would also be completely useless: the advisor would have no
// authority at all and every check about refusals would go green.
{
  const passing = ALLOWED.filter((n) => validateAction(n, TABLE[n]?.good).ok);
  // NEGATIVE CONTROL (run 2026-08-28): making validateAction return
  // { ok: false, error: 'no' } as its first line made this read
  //   FAIL  A9 something is actually ALLOWED, not just everything refused  -- 0 of 8 actions accept good arguments
  ck('A9 something is actually ALLOWED, not just everything refused',
    passing.length === ALLOWED.length && passing.length >= 6,
    `${passing.length} of ${ALLOWED.length} actions accept good arguments`);
  // And it really does write something usable, not an empty shell.
  const paid = validateAction('set-paid', { dollars: 3500 });
  // NEGATIVE CONTROL (run 2026-08-28): dropping by: 'advisor' from the args
  // set-paid builds made this read
  //   FAIL  A9b and an allowed action comes back with a body a route would take  -- {"ok":true,"name":"set-paid","tier":"confirm",...
  ck('A9b and an allowed action comes back with a body a route would take',
    paid.ok && paid.args.action === 'set-paid' && paid.args.paidCents === 350000
      && paid.args.by === 'advisor' && paid.path === '/api/admin/case-update',
    JSON.stringify(paid).slice(0, 120));
}

// ---- A10-A12: THE CONFIRM CARD IS REQUIRED FOR MONEY --------------------
// The panel's dispatch is a pure exported function precisely so it can be run
// over every action the Worker knows about. If any code path could carry out a
// money change without a card, this is where it shows.
{
  // NEGATIVE CONTROL (run 2026-08-28): renaming actDispatch in the shipped panel
  // made this read
  //   FAIL  A10 the panel dispatch lifts out of the shipped panel and runs
  ck('A10 the panel dispatch lifts out of the shipped panel and runs',
    typeof PANEL.actDispatch === 'function');
  const parked = (name) => {
    const v = validateAction(name, TABLE[name]?.good);
    return v.ok ? { actId: 'x', name: v.name, tier: v.tier, via: v.via, scoped: v.scoped } : null;
  };
  const paidHow = PANEL.actDispatch(parked('set-paid'));
  // NEGATIVE CONTROL (run 2026-08-28): moving set-paid to the DESK tier in
  // the shipped module made this read
  //   FAIL  A10b set-paid can only ever reach a card, never a straight run  -- set-paid dispatches to run
  ck('A10b set-paid can only ever reach a card, never a straight run',
    paidHow === 'card', `set-paid dispatches to ${paidHow}`);
  // Every CONFIRM-tier action, not just the money one. Anything a client sees
  // is in the same boat and must not slip through on its own.
  const ranWithoutCard = ALLOWED
    .filter((n) => tierOf(n) === 'confirm')
    .filter((n) => PANEL.actDispatch(parked(n)) === 'run');
  // NEGATIVE CONTROL (run 2026-08-28): changing actDispatch's last line to
  // `return 'run';` made this read
  //   FAIL  A10c no confirm-tier action can be carried out without a card  -- set-paid, work-correct, client-alert
  ck('A10c no confirm-tier action can be carried out without a card',
    !ranWithoutCard.length, ranWithoutCard.join(', '));
  // And the two halves agree, so the panel can never be shown a tier the
  // Worker did not mean.
  const disagree = ALLOWED.filter((n) => {
    const p = parked(n);
    return PANEL.actDispatch(p) !== dispatchFor(p);
  });
  // NEGATIVE CONTROL (run 2026-08-28): deleting the via === 'draft' line from the
  // panel's actDispatch made this read
  //   FAIL  A11 the Worker and the panel dispatch every action the same way  -- client-message
  ck('A11 the Worker and the panel dispatch every action the same way',
    !disagree.length, disagree.join(', '));
  // A shape the panel has never seen falls through to a card, not to a run.
  // NEGATIVE CONTROL (run 2026-08-28): making actDispatch answer 'run' for a shape
  // it does not recognise made this read
  //   FAIL  A11b an unrecognised proposal falls through to a card, not to a run
  ck('A11b an unrecognised proposal falls through to a card, not to a run',
    PANEL.actDispatch({ actId: 'x', name: 'whatever', tier: 'something-new' }) === 'card'
      && PANEL.actDispatch(null) === 'none' && PANEL.actDispatch({}) === 'none');
  // The desk tier is exactly what he agreed could just happen: reversible
  // settings on his own desk that no client is told about.
  const desk = ALLOWED.filter((n) => tierOf(n) === 'desk').sort();
  // NEGATIVE CONTROL (run 2026-08-28): moving client-alert to the DESK tier
  // made this read
  //   FAIL  A12 the desk tier holds exactly the reversible settings, and nothing else  -- booking-closure, client-alert, full-capacity, office-hours, work-clock
  ck('A12 the desk tier holds exactly the reversible settings, and nothing else',
    desk.join(', ') === 'booking-closure, full-capacity, office-hours, work-clock',
    desk.join(', '));
}

// ---- A13-A16: the urgent notification -----------------------------------
// He asked for this one in his own words and asked for it to carry HIS words.
// The guardrail on caller-supplied notification text was moved for it, once,
// deliberately, and the narrowness is structural rather than a promise.
{
  const alert = (text) => validateAction('client-alert', { text });
  const markup = [
    '<b>Urgent</b>', 'Urgent <script>x</script>', 'Form due > today',
    'a < b', '<img src=x onerror=alert(1)>', '</p><p>',
  ];
  const leaked = markup.filter((t) => alert(t).ok);
  // NEGATIVE CONTROL (run 2026-08-28): deleting the MARKUP test from
  // client-alert's check made this read
  //   FAIL  A13 a notification body cannot carry markup  -- <b>Urgent</b>, Urgent <script>x</script>, Form due > today, a < b, <img src=x onerror=alert(1)>, </p><p>
  ck('A13 a notification body cannot carry markup', !leaked.length, leaked.join(', '));
  // The bound is PINNED at the number, not read back off the module. Asserting
  // `ALERT_MAX_CHARS + 1 is refused` is a check that agrees with whatever the
  // constant happens to say, so raising the constant to four thousand would
  // have kept it green. 140 is about two lines on a phone, which is the whole
  // reason for the number.
  // NEGATIVE CONTROL (run 2026-08-28): raising ALERT_MAX_CHARS to 4000 made
  // this read
  //   FAIL  A14 and cannot exceed its bound, which is 140 and stays 140  -- bound is 4000
  ck('A14 and cannot exceed its bound, which is 140 and stays 140',
    ACTS.ALERT_MAX_CHARS === 140 && alert('x'.repeat(140)).ok && !alert('x'.repeat(141)).ok,
    `bound is ${ACTS.ALERT_MAX_CHARS}`);
  // Flattened, the same treatment the upload file name already gets, so it
  // cannot rearrange a notification with its own line breaks.
  const flat = alert('Your form\n\nis  due\ttoday.');
  // NEGATIVE CONTROL (run 2026-08-28): dropping the whitespace flatten from flat()
  // made this read
  //   FAIL  A15 and its line breaks are flattened before anything sees it  -- "Your form\n\nis  due\ttoday."
  ck('A15 and its line breaks are flattened before anything sees it',
    flat.ok && flat.alertText === 'Your form is due today.', JSON.stringify(flat.alertText));
  // The summary a card shows IS the sentence the client will read, character
  // for character. Anything else and the card is not showing him the thing.
  const sample = 'Your insurance form is time sensitive. Please open your case today.';
  // NEGATIVE CONTROL (run 2026-08-28): summarising the alert as 'An urgent
  // notification.' instead of its own words made this read
  //   FAIL  A16 the card is shown the exact words the client will read
  ck('A16 the card is shown the exact words the client will read',
    alert(sample).summary === sample && alert(sample).alertText === sample);
}

// ---- A17-A23: the route itself, lifted and run --------------------------
{
  const fn = LIFT.handleClientAlert;
  const consts = LIFT.alertConsts;
  // NEGATIVE CONTROL (run 2026-08-28): renaming the route to
  // handleClientPush made this read
  //   FAIL  A17 handleClientAlert lifts out of the shipped Worker
  ck('A17 handleClientAlert lifts out of the shipped Worker', fn.length > 0 && consts.length > 0);

  const writes = [];
  const pushes = [];
  const make = (caseDoc, metaDoc) => new Function('__w', '__p', '__validateAction', `
    const json = (o, s) => ({ status: s || 200, body: o });
    const requireAdmin = async () => ({ uid: 'admin' });
    const validateAction = __validateAction;
    const getDoc = async (env, path) => {
      if (path.startsWith('caseMeta/')) return ${JSON.stringify(metaDoc)} ? { data: ${JSON.stringify(metaDoc)} } : null;
      return ${JSON.stringify(caseDoc)} ? { data: ${JSON.stringify(caseDoc)} } : null;
    };
    const patchDoc = async (env, path, fields) => { __w.push({ path, fields }); return true; };
    const notifyUser = async (env, uid, msg) => { __p.push({ uid, msg }); };
    ${consts}
    ${fn}
    return handleClientAlert;
  `)(writes, pushes, validateAction);
  const run = async (body, caseDoc, metaDoc = null) => {
    writes.length = 0; pushes.length = 0;
    const handler = make(caseDoc, metaDoc);
    try {
      const res = await handler({ json: async () => body }, {});
      return { res, writes: writes.slice(), pushes: pushes.slice() };
    } catch (e) {
      return { threw: `${e.constructor.name}: ${e.message}`, writes: [], pushes: [] };
    }
  };
  const CASE = { status: 'open', clientUid: 'client-uid-1', clientName: 'Jordan Avery' };
  const SENTENCE = 'Your insurance form is time sensitive. Please open your case today.';

  const sent = await run({ caseId: 'abc', text: SENTENCE }, CASE);
  // NEGATIVE CONTROL (run 2026-08-28): gating the notifyUser call off made this read
  //   FAIL  A18 one sentence to one case actually sends  -- status 200, 0 push(es)
  ck('A18 one sentence to one case actually sends',
    !sent.threw && sent.res?.status === 200 && sent.pushes.length === 1,
    sent.threw || `status ${sent.res?.status}, ${sent.pushes.length} push(es)`);
  // NEGATIVE CONTROL (run 2026-08-28): reading the title from
  // `body.title || 'Pocket Advocate'` made this read
  //   FAIL  A18b the title and the link are literals in the route, never the body's  -- {"title":"Bank of America","body":"Your insurance form is time sensitive. Please open your
  ck('A18b the title and the link are literals in the route, never the body\'s',
    sent.pushes[0]?.msg.title === 'Pocket Advocate'
      && sent.pushes[0]?.msg.link === '/case.html?id=abc'
      && sent.pushes[0]?.msg.body === SENTENCE,
    JSON.stringify(sent.pushes[0]?.msg || {}).slice(0, 90));
  // NEGATIVE CONTROL (run 2026-08-28): removing the extra-key refusal AND
  // passing `body.uid || doc.data.clientUid` to notifyUser made this read
  //   FAIL  A18c it reaches the case's own client and cannot be pointed elsewhere  -- pushed to somebody-else
  const aimed = await run({ caseId: 'abc', text: SENTENCE, uid: 'somebody-else' }, CASE);
  ck('A18c it reaches the case\'s own client and cannot be pointed elsewhere',
    sent.pushes[0]?.uid === 'client-uid-1'
      && aimed.res?.status === 400 && aimed.pushes.length === 0,
    aimed.pushes.length ? `pushed to ${aimed.pushes[0].uid}` : `extra key answered ${aimed.res?.status}`);

  // THE PIN. This is the one that stops it quietly becoming a general purpose
  // caller-supplied-body route: an extra field is a refusal, not a shrug.
  const wide = [
    { caseId: 'abc', text: SENTENCE, title: 'Your bank' },
    { caseId: 'abc', text: SENTENCE, link: 'https://example.invalid' },
    { caseId: 'abc', text: SENTENCE, html: '<b>x</b>' },
    { caseId: 'abc', text: SENTENCE, uid: 'someone' },
  ];
  const widened = [];
  for (const b of wide) {
    const out = await run(b, CASE);
    if (out.res?.status !== 400 || out.pushes.length) widened.push(Object.keys(b).slice(2).join('+'));
  }
  // NEGATIVE CONTROL (run 2026-08-28): deleting the extra-key refusal made
  // this read
  //   FAIL  A19 the body may carry caseId and text and nothing else  -- title, link, html, uid
  ck('A19 the body may carry caseId and text and nothing else',
    !widened.length, widened.join(', '));

  // Markup and length, at the ROUTE, not just at the validator: the trust
  // boundary is the route, and it must refuse the same things on its own.
  const bad = [];
  for (const t of ['<b>x</b>', 'x'.repeat(ACTS.ALERT_MAX_CHARS + 1), '', '   ', 42]) {
    const out = await run({ caseId: 'abc', text: t }, CASE);
    if (out.res?.status !== 400 || out.writes.length || out.pushes.length)
      bad.push(JSON.stringify(t).slice(0, 30));
  }
  // NEGATIVE CONTROL (run 2026-08-28): replacing the validateAction call in
  // the route with a bare `const text = String(body?.text || '')` made this
  // read
  //   FAIL  A20 the route refuses markup and overlength on its own  -- "<b>x</b>", "xxxxxxxxxxxxxxxxxxxxxxxxxxxxx, "", "   ", 42
  ck('A20 the route refuses markup and overlength on its own', !bad.length, bad.join(', '));

  // THE TRAIL. There is no admin audit log in this app and this route was not
  // going to be the second thing without one.
  const trail = sent.writes.find((w) => w.fields.clientAlerts);
  // NEGATIVE CONTROL (run 2026-08-28): deleting the caseMeta patchDoc made
  // this read
  //   FAIL  A21 every sentence sent is recorded, with the time  -- nothing recorded
  ck('A21 every sentence sent is recorded, with the time',
    !!trail && trail.path === 'caseMeta/abc'
      && trail.fields.clientAlerts.at(-1).text === SENTENCE
      && trail.fields.clientAlerts.at(-1).at instanceof Date,
    trail ? JSON.stringify(trail.fields.clientAlerts.at(-1)).slice(0, 90) : 'nothing recorded');
  // NEGATIVE CONTROL (run 2026-08-28): swapping the patchDoc and notifyUser
  // calls made this read
  //   FAIL  A21b recorded BEFORE it is sent, so nothing can reach a phone unlogged
  ck('A21b recorded BEFORE it is sent, so nothing can reach a phone unlogged',
    W.indexOf('clientAlerts: [...prior') < W.indexOf("title: 'Pocket Advocate',\n    body: text,"));
  // And it lands where no browser can read it. caseMeta is denied to every
  // browser by the catch-all in firestore.rules; cases/{id} is not.
  // NEGATIVE CONTROL (run 2026-08-28): pointing the trail write at cases/{caseId}
  // made this read
  //   FAIL  A21c and the trail is on caseMeta, never on the case a client can read  -- ["cases/abc"]
  ck('A21c and the trail is on caseMeta, never on the case a client can read',
    !sent.writes.some((w) => w.path.startsWith('cases/')), JSON.stringify(sent.writes.map((w) => w.path)));

  // THE SOFT RATE LIMIT. A client cannot be buzzed repeatedly.
  const justNow = { clientAlerts: [{ text: 'earlier', at: new Date().toISOString(), by: 'advisor' }] };
  const tooSoon = await run({ caseId: 'abc', text: SENTENCE }, CASE, justNow);
  // NEGATIVE CONTROL (run 2026-08-28): setting ALERT_MIN_GAP_MS to 0 made
  // this read
  //   FAIL  A22 a client is not buzzed twice inside half an hour  -- status 200, 1 push(es)
  ck('A22 a client is not buzzed twice inside half an hour',
    tooSoon.res?.status === 429 && tooSoon.pushes.length === 0 && tooSoon.writes.length === 0,
    `status ${tooSoon.res?.status}, ${tooSoon.pushes.length} push(es)`);
  const hourAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
  const threeToday = { clientAlerts: [
    { text: 'a', at: hourAgo(6), by: 'advisor' },
    { text: 'b', at: hourAgo(4), by: 'advisor' },
    { text: 'c', at: hourAgo(2), by: 'advisor' },
  ] };
  const capped = await run({ caseId: 'abc', text: SENTENCE }, CASE, threeToday);
  // NEGATIVE CONTROL (run 2026-08-28): raising ALERT_MAX_PER_DAY to 99 made
  // this read
  //   FAIL  A22b nor more than three times in a day  -- status 200
  ck('A22b nor more than three times in a day',
    capped.res?.status === 429 && capped.pushes.length === 0, `status ${capped.res?.status}`);
  // Yesterday's three do not count against today.
  const yesterday = { clientAlerts: [
    { text: 'a', at: hourAgo(30), by: 'advisor' },
    { text: 'b', at: hourAgo(29), by: 'advisor' },
    { text: 'c', at: hourAgo(28), by: 'advisor' },
  ] };
  const fresh = await run({ caseId: 'abc', text: SENTENCE }, CASE, yesterday);
  // NEGATIVE CONTROL (run 2026-08-28): widening the daily window to thirty days
  // made this read
  //   FAIL  A22c but a quiet day starts clean, so the limit is soft and not a wall  -- status 429
  ck('A22c but a quiet day starts clean, so the limit is soft and not a wall',
    fresh.res?.status === 200 && fresh.pushes.length === 1, `status ${fresh.res?.status}`);
  // And the trail is bounded, so it cannot grow without limit on one case.
  const many = { clientAlerts: Array.from({ length: 40 }, (_, i) => ({ text: `n${i}`, at: hourAgo(100 + i), by: 'advisor' })) };
  const bounded = await run({ caseId: 'abc', text: SENTENCE }, CASE, many);
  // NEGATIVE CONTROL (run 2026-08-28): raising ALERT_TRAIL_KEEP to 500 made this read
  //   FAIL  A22d the trail is bounded rather than growing for ever  -- 41 rows
  ck('A22d the trail is bounded rather than growing for ever',
    bounded.writes.find((w) => w.fields.clientAlerts)?.fields.clientAlerts.length === 20,
    `${bounded.writes.find((w) => w.fields.clientAlerts)?.fields.clientAlerts.length} rows`);

  // A closed case, and a client who has never signed in, are both refusals
  // rather than a push into nothing.
  const closed = await run({ caseId: 'abc', text: SENTENCE }, { ...CASE, status: 'closed' });
  const nophone = await run({ caseId: 'abc', text: SENTENCE }, { ...CASE, clientUid: null });
  // NEGATIVE CONTROL (run 2026-08-28): removing the closed-case and no-phone
  // refusals made this read
  //   FAIL  A23 a closed case and a client with no phone are refused, not pushed at  -- 200 / 200
  ck('A23 a closed case and a client with no phone are refused, not pushed at',
    closed.res?.status === 409 && nophone.res?.status === 409
      && !closed.pushes.length && !nophone.pushes.length,
    `${closed.res?.status} / ${nophone.res?.status}`);
  // 404, not 403, like every other admin route in the file.
  // NEGATIVE CONTROL (run 2026-08-28): answering a stranger 403 instead of 404
  // made this read
  //   FAIL  A23b it answers a stranger the way an unknown route answers
  ck('A23b it answers a stranger the way an unknown route answers',
    /const admin = await requireAdmin\(request, env\);\n  if \(!admin\) return json\(\{ error: 'Not found' \}, 404\);/.test(fn));
}

// ---- A24-A26: the advisor proposes and does not execute -----------------
{
  // No tool_result is ever BUILT in the advisor, which is the whole reason
  // there is no execution loop: a turn ends with the request written down and
  // nothing is handed back to the model. Comments and the server-side
  // web_search_tool_result the search turn already reads are not that; a
  // literal in code is, so this looks for the literal.
  // NEGATIVE CONTROL (run 2026-08-28): adding
  // `convo.push({ type: 'tool_result' })` to collectActs made this read
  //   FAIL  A24 the advisor never answers a tool, so there is no execution loop  -- 1 tool_result literal(s)
  const answersTools = (ADV.match(/(?<!web_search_)['"`]tool_result['"`]/g) || []).length;
  ck('A24 the advisor never answers a tool, so there is no execution loop',
    answersTools === 0 && /function collectActs/.test(ADV),
    `${answersTools} tool_result literal(s)`);
  // The Worker's advisor module never calls an admin route. Everything is
  // parked; the panel, holding his own admin token, is what calls a route.
  // NEGATIVE CONTROL (run 2026-08-28): putting an /api/admin/ string into
  // collectActs made this read
  //   FAIL  A24b and the advisor module never calls an admin route itself
  // The presence half is not decoration. A negated regex over a source that
  // came back empty or wrong passes by asserting nothing, which is the exact
  // failure the -forms branch found in one of its own checks on 2026-08-28.
  // So this requires the file to be the file first, and only then says what
  // is absent from it.
  // NEGATIVE CONTROL (run 2026-08-28), two of them, and the second is the one
  // that matters:
  //   putting an /api/admin/ string into collectActs
  //     FAIL  A24b ... -- 1 admin route(s)
  //   reading worker/advisor.js as an empty string, which is what a rename
  //   would do. The OLD version of this check PASSED that, because a regex
  //   does not match '' and the negation made it true. The new one reads
  //     FAIL  A24b ... -- that is not the advisor module
  const adminCalls = (ADV.match(/\/api\/admin\//g) || []).length;
  ck('A24b and the advisor module never calls an admin route itself',
    /export async function runQuestion/.test(ADV) && adminCalls === 0,
    /export async function runQuestion/.test(ADV) ? `${adminCalls} admin route(s)` : 'that is not the advisor module');
  // The tools offered to the model ARE the allowlist, by construction, so a
  // tool it can see and an action that would validate are the same list.
  const offered = actionTools().map((t) => t.name).sort();
  // NEGATIVE CONTROL (run 2026-08-28): dropping the first entry with
  // ALLOWED.slice(1) inside actionTools made this read
  //   FAIL  A25 the tools the model is offered are exactly the allowlist  -- offered: booking-closure, client-alert, client-message, full-capacity, office-hours, work-clock, work-correct
  ck('A25 the tools the model is offered are exactly the allowlist',
    offered.join(', ') === [...ALLOWED].sort().join(', '), `offered: ${offered.join(', ')}`);
  // NEGATIVE CONTROL (run 2026-08-28): blanking a tool description made this read
  //   FAIL  A25b and every tool carries a description and a schema the model can read
  ck('A25b and every tool carries a description and a schema the model can read',
    actionTools().every((t) => t.description && t.input_schema?.type === 'object'));
  // Only the ASK flow carries them. An analysis is a background read of a case
  // nobody tapped for, and a read that can propose to change the app is a
  // different thing from a read.
  const q = LIFT.runQuestion;
  // NEGATIVE CONTROL (run 2026-08-28): commenting out the tools on the question
  // turn made this read
  //   FAIL  A26 only the question flow is given tools, not the background analysis
  ck('A26 only the question flow is given tools, not the background analysis',
    /tools: actionTools\(\)/.test(q)
      && (ADV.match(/tools: actionTools\(\)/g) || []).length === 1);
}

// ---- A27: the panel never invents a destination -------------------------
{
  // The route a proposal goes to comes from the parked proposal, which came
  // from the allowlist. The panel does not hold a table of its own.
  const carry = LIFT.carryAct;
  // NEGATIVE CONTROL (run 2026-08-28): hardcoding
  // fetch('/api/admin/case-update') in carryAct made this read
  //   FAIL  A27 the panel posts where the proposal says, and holds no route table of its own
  ck('A27 the panel posts where the proposal says, and holds no route table of its own',
    carry.length > 0 && /fetch\(act\.path,/.test(carry) && !/'\/api\/admin\//.test(carry));
  // Text as a VALUE. The card builds its lines with textContent, never with
  // innerHTML holding a model-written or Eric-written string.
  const card = LIFT.renderActCard;
  // NEGATIVE CONTROL (run 2026-08-28): building the summary line with
  // `said.innerHTML = act.summary` made this read
  //   FAIL  A27b the card puts text in as a value, never as markup
  ck('A27b the card puts text in as a value, never as markup',
    card.length > 0 && /said\.textContent =/.test(card)
      && !/innerHTML\s*=\s*[^']*act\./.test(card));
  // And a failed act leaves the card up with the reason on it. A card that
  // vanishes on a failure is a card that looks like it worked.
  // NEGATIVE CONTROL (run 2026-08-28): replacing the reason with a flat
  // 'It did not work.' made this read
  //   FAIL  A27c a refused act leaves the card up, with the reason on it
  ck('A27c a refused act leaves the card up, with the reason on it',
    /Not done: \$\{e\.message\}/.test(card));
}

// ---- A28: the seam for the form sender ----------------------------------
// Another branch is building it. The id is reserved and the tier is decided;
// wiring it up is three lines and no thinking.
{
  const seam = validateAction('send-forms', {});
  // NEGATIVE CONTROL (run 2026-08-28): setting enabled true on send-forms
  // made this read
  //   FAIL  A28 the form sender is a named seam that refuses until it is wired
  ck('A28 the form sender is a named seam that refuses until it is wired',
    !seam.ok && !ALLOWED.includes('send-forms') && !actionTools().some((t) => t.name === 'send-forms'),
    seam.ok ? 'validated with no route behind it' : '');
  // NEGATIVE CONTROL (run 2026-08-28): changing the TODO to name no branch
  // made this read
  //   FAIL  A28b and the TODO names the branch that is building it
  ck('A28b and the TODO names the branch that is building it',
    /TODO\(claude\/pocketai-webhooks-triggers-a96dea-forms\)/.test(ACTSRC)
      && /'send-forms': \{/.test(ACTSRC));
}

// ---- A29: still invisible to a client -----------------------------------
{
  // The allowlist lives in worker/, which is never served. If it ever moved
  // under public/ it would need naming in ADMIN_ASSET, and this is the check
  // that would notice.
  // THIS CHECK USED TO TEST A HARDCODED STRING. It read
  //   !/public\//.test('worker/advisor-acts.js')
  // which is a regex against a literal spelled out three characters earlier,
  // so it was true on every run this file will ever have and could not have
  // been anything else. It looked like a check and was a decoration. Found
  // while auditing for the vacuous-negation shape the -forms branch reported
  // on 2026-08-28, and it is the worse cousin of that bug: theirs asserted
  // nothing when a lift was lost, this one asserted nothing ever.
  //
  // What it should have been asking is whether the file is where it claims to
  // be, so ask the filesystem.
  // NEGATIVE CONTROL (run 2026-08-28): copying advisor-acts.js into public/js/
  // made this read
  //   FAIL  A29 the allowlist is Worker-side and no client can download it  -- a copy is sitting in public/
  const inWorker = existsSync(j(ROOT, 'worker/advisor-acts.js'));
  const inPublic = existsSync(j(ROOT, 'public/js/advisor-acts.js'))
    || existsSync(j(ROOT, 'public/advisor-acts.js'));
  ck('A29 the allowlist is Worker-side and no client can download it',
    inWorker && !inPublic && ACTSRC.length > 0,
    inPublic ? 'a copy is sitting in public/' : 'worker/advisor-acts.js is not there');
  // The panel is already named in ADMIN_ASSET; the card lives inside it.
  // NEGATIVE CONTROL (run 2026-08-28): dropping `advisor` from the ADMIN_ASSET
  // alternation made this read
  //   FAIL  A29b the confirm card lives in the panel, which 404s to a client  -- advisor is not in ADMIN_ASSET
  const gate = LIFT.adminAssetGate;
  ck('A29b the confirm card lives in the panel, which 404s to a client',
    /\|advisor\|/.test(gate) && /data-act-card/.test(PANELSRC),
    /\|advisor\|/.test(gate) ? 'no act card in the panel' : 'advisor is not in ADMIN_ASSET');
  // No em or en dash in anything NEW that a person reads. Scoped to the
  // surfaces this change added: public/js/advisor.js carries sixteen of them
  // from before this branch and rewriting somebody else's prose to satisfy a
  // check is how a check starts causing damage.
  const NEW = [
    ['worker/advisor-acts.js', ACTSRC],
    ['the panel dispatch', LIFT.actDispatch],
    ['the confirm card', LIFT.renderActCard],
    ['the act handler', LIFT.handleAct],
    ['the alert route', LIFT.handleClientAlert],
  ];
  // AN EMPTY SLAB CONTAINS NO DASH, so a lost lift would satisfy this check by
  // asserting nothing. A29d catches that, but a check that is only safe while
  // its NEIGHBOUR survives is one deletion away from going quietly vacuous, so
  // the presence requirement is inline as well.
  const dashes = NEW.filter(([, src]) => !src || /[–—]/.test(src)).map(([n]) => n);
  // NEGATIVE CONTROL (run 2026-08-28), two of them:
  //   putting an em dash in the confirm card's heading
  //     FAIL  A29c ... -- the confirm card
  //   pointing renderActCard's lift at a name that does not exist, so the slab
  //   comes back empty. That used to pass here and be caught only by A29d
  //   next door; it now fails in BOTH, which is the point of the inline guard
  //     FAIL  A29c ... -- the confirm card
  //     FAIL  A29d ... -- the confirm card
  ck('A29c no em or en dash in anything this change added', !dashes.length, dashes.join(', '));
  // And the lifts above actually found something, so a rename cannot turn A29c
  // into a check on four empty strings.
  // NEGATIVE CONTROL (run 2026-08-28): renaming renderActCard in the shipped
  // panel made this read
  //   FAIL  A29d and every surface it checks was actually found  -- the confirm card
  ck('A29d and every surface it checks was actually found',
    NEW.every(([, src]) => src.length > 40), NEW.filter(([, s2]) => s2.length <= 40).map(([n]) => n).join(', '));
}

// ---- A30: the lifts themselves, measured ---------------------------------
// Every lift above is a non-greedy slab between two anchors, and a slab whose
// closing anchor moves runs ON to the next match and captures the rest of the
// file. The -forms branch hit exactly that on 2026-08-28: a lift meant to be
// 5,144 characters silently became 16,234, and five checks stayed green on it
// because the swallowed code happened to be inert. So the lifts are MEASURED,
// not trusted: each one has to end where its own function ends and carry no
// other function's header.
//
// THREE DIFFERENT FAILURES, WHICH IS WHY THERE ARE THREE CHECKS. A lift can be
// LOST (its anchor renamed, and it quietly asserts nothing), it can RUN ON
// past its own end, or it can SWALLOW exactly one neighbour and come back a
// wholly plausible size ending on a wholly plausible line. Only naming the
// neighbours catches the third, and the third is the one that hides.
//
// The sizes are PRINTED on every run as well as checked, because a lift that
// legitimately moves is a thing somebody has to notice. That mattered the same
// day it was written: the -forms branch measured its own handleCaseUpdate lift
// at 15,915 on its branch and 18,060 merged with this one, and the 2,145
// character difference is the set-paid provenance block below. Every check
// stayed green and correctly so, because that block reaches only for patchDoc,
// json and doc.data and all three were already stubbed there. Nothing but the
// size said the lift had grown. IF ANYTHING HERE EVER EDITS INSIDE
// handleCaseUpdate AGAIN and reaches for a helper that suite does not stub,
// U13 to U16d in tools/suites/uploads.mjs all die at one ReferenceError: add
// the stub to its harness in the same commit.
{
  // [name, captured source, the exact tail it must end on or null to skip]
  // The tails, by name. Not a second lift table: the slabs come from the one
  // registry, and this only says where each is required to END.
  //
  // alertConsts has no tail on purpose. Its last line carries the trail bound,
  // and A22d owns that number; pinning it twice would make a deliberate change
  // to the bound fail HERE, in a check about lifts, which is a check going off
  // about somebody else's business.
  const TAIL = {
    handleClientAlert: "  return json({ ok: true, sent: text, at: now.toISOString() });\n}",
    actDispatch: "  return act.tier === 'desk' ? 'run' : 'card';\n}",
    carryAct: '    return out;\n  }',
    renderActCard: '    });\n  }',
    handleAct: '    renderActCard(act);\n  }',
    runQuestion: '  }\n}',
    adminAssetGate: ';',
    alertConsts: null,
  };
  const LIFTS = SLABS.map(([n, src]) => [n, src, TAIL[n]]);
  const short = LIFTS.filter(([, src]) => src.length < 60).map(([n]) => n);
  // NEGATIVE CONTROL (run 2026-08-28), two of them:
  //   renaming carryAct in the shipped panel
  //     FAIL  A30 every lift in this file actually found its function  -- carryAct
  //   renaming ALERT_MAX_PER_DAY in the shipped Worker, which is the middle
  //   line of the three the harness lifts and so takes the whole slab with it
  //     FAIL  A30 every lift in this file actually found its function  -- alertConsts
  //   and the size line said `alertConsts 0` in the same breath, which is the
  //   half that tells you WHICH kind of failure you are looking at.
  ck('A30 every lift in this file actually found its function', !short.length, short.join(', '));
  // ENDS WHERE ITS OWN FUNCTION ENDS. This is the one that catches a slab that
  // ran on: the last line of the capture has to be the last line of the thing
  // it was meant to capture.
  const ranOn = LIFTS.filter(([, src, tail]) => tail && !src.endsWith(tail)).map(([n]) => n);
  // NEGATIVE CONTROL (run 2026-08-28), THREE OF THEM, because this check has
  // to catch a slab that stops early as well as one that runs on, and because
  // handleClientAlert is a function this branch ADDED and its slab has no
  // history behind it to have proved itself against:
  //   loosening renderActCard's closing anchor from '\n  }' to '\n}'
  //     FAIL  A30b and ends exactly where that function ends, not later  -- renderActCard
  //   making handleClientAlert's slab GREEDY ([\s\S]* not [\s\S]*?), which
  //   took it from 3,358 characters to 27,106
  //     FAIL  A30b and ends exactly where that function ends, not later  -- handleClientAlert
  //   tightening handleClientAlert's close to '\n  }', which STOPPED IT EARLY
  //   at 2,453 characters, the failure in the other direction
  //     FAIL  A30b and ends exactly where that function ends, not later  -- handleClientAlert
  ck('A30b and ends exactly where that function ends, not later', !ranOn.length, ranOn.join(', '));
  // And carries nobody else's header. A slab that swallowed the next function
  // fails here even if its tail happened to match.
  const HEADERS = ['async function carryAct(', 'function renderActCard(', 'async function handleAct(',
    'async function actFinish(', 'function renderDraftCard(', 'async function handleClientAlert(',
    'async function releaseHold('];
  const swallowed = LIFTS.filter(([name, src]) =>
    HEADERS.filter((h) => src.includes(h)).some((h) => !h.includes(`${name}(`))).map(([n]) => n);
  // NEGATIVE CONTROL (run 2026-08-28), two of them:
  //   the same loosened renderActCard anchor
  //     FAIL  A30c and swallowed no other function on the way  -- renderActCard
  //   the greedy handleClientAlert slab, which swallowed releaseHold and every
  //   function after it
  //     FAIL  A30c and swallowed no other function on the way  -- handleClientAlert
  // The early-truncation break above does NOT show up here, and should not:
  // a slab that stops short has swallowed nothing. That is A30b's job alone.
  ck('A30c and swallowed no other function on the way', !swallowed.length, swallowed.join(', '));
  // EVERY REGISTERED SLAB IS ACCOUNTED FOR. A new lift added to the registry
  // without a TAIL entry would otherwise skip A30b in silence, which is the
  // same "passes by asserting nothing" this whole block exists to end.
  const unowned = SLABS.map(([n]) => n).filter((n) => !(n in TAIL));
  // NEGATIVE CONTROL (run 2026-08-28): deleting the runQuestion line from TAIL
  // made this read
  //   FAIL  A30d every registered slab has a tail rule, even if that rule is none  -- runQuestion
  ck('A30d every registered slab has a tail rule, even if that rule is none',
    !unowned.length, unowned.join(', '));
  // AND THE REGISTRY CANNOT QUIETLY SHRINK. A lift deleted, or one that stops
  // being registered, takes its checks with it and nothing else would say so.
  //
  // The limit, stated so nobody mistakes this for more than it is: a NEW slab
  // added without going through lifted() leaves the count at eight and passes.
  // This guards the eight that are here. It does not conscript the ninth.
  // NEGATIVE CONTROL (run 2026-08-28): removing adminAssetGate from the
  // registry made this read
  //   FAIL  A30e the registry still holds every lift it was built with  -- 7 lifts, expected at least 8
  ck('A30e the registry still holds every lift it was built with',
    SLABS.length >= 8, `${SLABS.length} lifts, expected at least 8`);
  console.log(`      lift sizes: ${LIFTS.map(([n, src]) => `${n} ${src.length}`).join(', ')}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
