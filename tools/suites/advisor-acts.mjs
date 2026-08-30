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
const STOR = read('worker/storage.js');

const results = [];
const ck = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};

const { validateAction, ALLOWED, DENYLIST, tierOf, dispatchFor, actionTools, tablesDisagree } = ACTS;

/**
 * THE FLOOR ON THE TABLE THIS SUITE IS ABOUT.
 *
 * Every list emptied in this file so far belonged to this file. The one list
 * never starved is the one the module hands over, which is what a bad merge or
 * a bad edit in worker/advisor-acts.js would actually empty.
 *
 * MEASURED on main, 2026-08-28, by replacing the ACTS table with {}:
 * 29 checks failed, and A1 and A2c named the break loudly, so the suite as a
 * whole was never going to miss it. But EIGHT checks whose whole job is to
 * assert something about that table passed on nothing:
 *
 *   A2  A3  A6  A8  A10c  A11  A25  A25b
 *
 * A loop that finds no failures reads as success, and so does a comparison of
 * two empty joins. Each was upheld by A1 and A2c standing next to it, which is
 * the shape A29c warns about a few hundred lines below and the same one
 * SLAB_FLOOR and uploads.mjs's LIFT_FLOOR were added for.
 *
 * Eight, not the four found on the branch this came from: main carries more
 * checks over the same table, so it carried more instances.
 *
 * AFTER, same break: all eight fail, each naming the empty table, and the
 * suite's failure count goes from 29 to 37.
 *
 * THE OTHER TWO SUITES that import an app module were starved the same way and
 * needed nothing. Emptying SENSITIVE_CATEGORIES and COMMUNICATION_SCOPES makes
 * authority.mjs throw, which is loud. Emptying SERVICE_ABOUT fails exactly the
 * two checks in checkins.mjs that read it, AB1 and AB4, and nothing else there
 * claims anything about it.
 *
 * THE LIMIT: this guards the eight actions that exist against quietly becoming
 * seven. A NINTH action added to the table is not conscripted by it.
 */
const ACTION_FLOOR = 8;
/**
 * AND THE SAME FOR THE DENYLIST, measured the same way. Emptying DENIED left
 * A7b and A8 green: a filter of nothing finds no mute refusals, and two tables
 * cannot disagree when one of them is empty. A7 and A7c caught the break, so
 * the suite was never going to miss it, but neither of those two was standing
 * on anything of its own. A7's own floor of 8 is folded in here so there is
 * one number rather than two that can drift apart.
 */
const DENY_FLOOR = 8;
/** What a check over ACTS prepends, so an empty table fails it on its own. */
const actionFault = () => (ALLOWED.length < ACTION_FLOOR
  ? [`${ALLOWED.length} actions, expected at least ${ACTION_FLOOR}`] : []);

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
/**
 * THE FLOOR, read by every A30 check rather than by A30e alone.
 *
 * MEASURED on main, 2026-08-28, by returning early from lifted() so the
 * registry is empty BEFORE any check reads it (clearing it inside the A30
 * block instead reads AFTER they have run, and tells the flattering story):
 *
 *   PASS A30   PASS A30b   PASS A30c   PASS A30d   PASS A30d2   FAIL A30e
 *
 * Five of the six passed on nothing at all. Each one filters SLABS and asserts
 * the result is empty, and an empty filter of an empty list is empty, so they
 * were upheld by A30e standing next to them and not by anything they checked.
 * A29c, four hundred lines below, says in as many words that a check safe only
 * while its neighbour survives is one deletion from going quiet. Saying it did
 * not prevent it; a shared number does.
 *
 * AFTER, same break, same placement:
 *
 *   FAIL A30    -- 0 lifts, expected at least 8
 *   FAIL A30b   -- 0 lifts, expected at least 8
 *   FAIL A30c   -- 0 lifts, expected at least 8
 *   FAIL A30d   -- 0 lifts, expected at least 8
 *   FAIL A30d2  -- 0 lifts, expected at least 8
 *   FAIL A30e   -- 0 lifts, expected at least 8
 *
 * Restored from a copy rather than from git, because the file held work that
 * was not committed yet and a checkout would have taken it.
 *
 * THE LIMIT, unchanged from A30e's own note: this guards the eight that are
 * here against quietly becoming seven. A NINTH slab added without going
 * through lifted() still leaves the count at eight and still passes.
 *
 * Same defect and same repair as LIFT_FLOOR in tools/suites/uploads.mjs.
 */
const SLAB_FLOOR = 8;
/** What each A30 check prepends, so an empty registry fails all six. */
const floorFault = () => (SLABS.length < SLAB_FLOOR
  ? [`${SLABS.length} lifts, expected at least ${SLAB_FLOOR}`] : []);
/**
 * EVERY LIFT DECLARES WHAT LIES BEYOND ITS END, and the argument for that came
 * from the -forms branch on 2026-08-28, which I think is right and which lands
 * on three of the eight below.
 *
 * A tail assertion asks "does this slab end on the line it should?". For a
 * capture whose closing anchor is distinctive that has teeth. For one whose
 * anchor is generic it is close to tautological: renderActCard's tail was
 * '    });\n  }' and that pair occurs after every addEventListener in the
 * function, so a capture ending at a LATER '\n  }' would have satisfied it
 * just as happily. runQuestion's was '  }\n}'. adminAssetGate's was ';', which
 * is the regex's own closing character and could not fail at all.
 *
 * The question with teeth in those cases is not where the slab ends, it is
 * what should be OUTSIDE it. So each lift names a sentinel: a distinctive
 * string from past its intended end. It must not appear INSIDE the slab, which
 * is the swallow check, applied to all eight by construction rather than to
 * the two I had previously written out by hand in a list I maintained myself.
 *
 * AND THE SENTINEL MUST ITSELF BE FOUND, at or after the slab's end, in the
 * source the slab came from. Without that half, a sentinel with a typo in it
 * is absent from the slab for the wrong reason and the check passes on it,
 * which is the whole class of bug this exchange has been about. `hay` is
 * carried per lift for exactly that.
 *
 * The three tails named above are set to null below rather than kept as
 * decoration. A check that reads like a check and asserts nothing is the thing
 * A29 turned out to be; leaving one in place while a better one stands beside
 * it would be repeating that on purpose.
 */
const lifted = (name, hay, src, sentinel) => {
  SLABS.push({ name, hay, src: src || '', sentinel });
  return src || '';
};

const LIFT = {
  handleClientAlert: lifted('handleClientAlert', W,
    (W.match(/async function handleClientAlert\(request, env\) \{[\s\S]*?\n\}/) || [''])[0],
    'async function releaseHold(env, session)'),
  alertConsts: lifted('alertConsts', W,
    (W.match(/const ALERT_MIN_GAP_MS = [^;]+;\nconst ALERT_MAX_PER_DAY = [^;]+;\nconst ALERT_TRAIL_KEEP = [^;]+;/) || [''])[0],
    'async function handleClientAlert(request, env)'),
  adminAssetGate: lifted('adminAssetGate', W,
    (W.match(/const ADMIN_ASSET =\n[^;]+;/) || [''])[0],
    'const DEMO_ASSET ='),
  runQuestion: lifted('runQuestion', ADV,
    (ADV.match(/export async function runQuestion[\s\S]*?\n\}/) || [''])[0],
    'export async function runDraft('),
  actDispatch: lifted('actDispatch', PANELSRC,
    (PANELSRC.match(/export function actDispatch\(act\) \{[\s\S]*?\n\}/) || [''])[0],
    'const SECTION_ICON_RAW = {'),
  carryAct: lifted('carryAct', PANELSRC,
    (PANELSRC.match(/async function carryAct\(act\) \{[\s\S]*?\n  \}/) || [''])[0],
    'async function actFinish(act)'),
  renderActCard: lifted('renderActCard', PANELSRC,
    (PANELSRC.match(/function renderActCard\(act\) \{[\s\S]*?\n  \}/) || [''])[0],
    'async function handleAct(act, actError)'),
  handleAct: lifted('handleAct', PANELSRC,
    (PANELSRC.match(/async function handleAct\(act, actError\) \{[\s\S]*?\n  \}/) || [''])[0],
    'function renderDraftCard(text)'),
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
  // Takes no arguments at all: WHICH forms is the sender's to decide, not the
  // model's. So there is nothing it can be given that it must refuse, and its
  // `bad` list is empty by design rather than by omission. What it must not do
  // is let a stray argument through into the body, which A31c covers by
  // pinning the shape validate returns.
  'send-forms': { good: {}, bad: [] },
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
  const goodFailsF = [...actionFault(), ...goodFails];
  ck('A2 every allowlisted action validates with arguments he would give',
    !goodFailsF.length, goodFailsF.join(' | '));
  // NEGATIVE CONTROL (run 2026-08-28): dropping the `cents < 100` half of the
  // money bound made this read
  //   FAIL  A3 and refuses every argument he would not  -- set-paid {"dollars":0} | set-paid {"dollars":-100}
  // A REFUSAL ONLY MEANS SOMETHING IF SOMETHING IS ACCEPTED. A validator that
  // refused EVERYTHING would satisfy this check perfectly, and no count of any
  // list detects that: ALLOWED stays full while nothing gets through it. So
  // the acceptance rides along with the refusal, in the same check.
  //
  // MEASURED on main, 2026-08-28, by making validateAction return
  // { ok: false } on its first line: A3, A6, A13 and A20 all passed. A9 caught
  // it, and A9 exists for exactly this reason, which is the point: it guarded
  // the file and not one of its neighbours.
  const badPassesF = [...actionFault(), ...badPasses,
    ...(goodFails.length === ALLOWED.length && ALLOWED.length
      ? ['nothing is accepted either, so a refusal proves nothing'] : [])];
  ck('A3 and refuses every argument he would not', !badPassesF.length, badPassesF.join(' | '));
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
  // The floor is not decoration here: with no table at all every one of these
  // is "refused" because the ACTION ITSELF is unknown, which proves nothing
  // about the money bound this check is named for.
  // AND A GOOD FIGURE IS STILL ACCEPTED, in the same check: a validator that
  // refuses every number refuses these too, and would read green here.
  const takesMoney = cents(3500) === 350_000;
  ck('A6 zero, negative, NaN, a string and ten million dollars are all refused',
    !actionFault().length && !refused.length && takesMoney,
    actionFault().length ? actionFault().join('')
      : !takesMoney ? '$3,500 is not accepted either, so this proves nothing'
        : `let through: ${refused.map(String).join(', ')}`);
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
  // AND SOMETHING ON THE ALLOWLIST STILL GETS THROUGH, or this proves nothing:
  // a validator that refused every name would refuse these too. Same shape as
  // A3, A6, A13 and A20, and found in the same run, on the second look at the
  // same output.
  const anyAllowed = ALLOWED.some((n) => validateAction(n, TABLE[n]?.good).ok);
  ck('A7 a denylisted action is refused even when the model names it perfectly',
    !slipped.length && DENYLIST.length >= DENY_FLOOR && anyAllowed,
    !anyAllowed ? 'nothing is allowed either, so this proves nothing'
      : `got through: ${slipped.join(', ')}`);
  // Each one refuses with a SENTENCE, because Eric is the one who reads it.
  const mute = DENYLIST.filter((n) => {
    const out = validateAction(n, {});
    return !out.denied || typeof out.error !== 'string' || out.error.length < 20;
  });
  // NEGATIVE CONTROL (run 2026-08-28): returning { ok: false, error: 'no' } for a
  // denylisted name instead of its sentence made this read
  //   FAIL  A7b and each refusal says why, in words he can read  -- close, close-case, delete-file, open-full, report-uploaded, set-rates, rates, price, sign, sign-authority, revoke, revoke-authority
  const muteF = [...(DENYLIST.length < DENY_FLOOR
    ? [`${DENYLIST.length} denied names, expected at least ${DENY_FLOOR}`] : []), ...mute];
  ck('A7b and each refusal says why, in words he can read', !muteF.length, muteF.join(', '));
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
  const disagreeF = [...actionFault(),
    ...(DENYLIST.length < DENY_FLOOR
      ? [`${DENYLIST.length} denied names, expected at least ${DENY_FLOOR}`] : []),
    ...tablesDisagree()];
  ck('A8 the allowlist and the denylist cannot both claim a name',
    !disagreeF.length, disagreeF.join(', '));
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
  // AND EVERY ONE OF THEM COULD ACTUALLY BE BUILT. This is the sentence the
  // whole branch exists to guarantee, and it was the weakest check in the file.
  //
  // `parked(n)` returns NULL when validation fails, actDispatch(null) is
  // 'none', and 'none' is not 'run', so the filter finds nothing and this
  // reads green while the validator parks nothing at all.
  //
  // MEASURED on main, 2026-08-28, with validateAction returning { ok: false }
  // on its first line: 29 checks failed and A10c passed. I had run that exact
  // break an hour earlier, seen this line in the output, and reasoned that
  // ALLOWED being intact made it safe. It does not: the tier comes off the
  // table, but the PROPOSAL comes off the validator.
  const confirmActs = ALLOWED.filter((n) => tierOf(n) === 'confirm');
  const unbuildable = confirmActs.filter((n) => !parked(n));
  const ranWithoutCardF = [...actionFault(), ...ranWithoutCard,
    ...(unbuildable.length
      ? [`${confirmActs.length - unbuildable.length} of ${confirmActs.length} confirm-tier proposals could even be built`]
      : [])];
  ck('A10c no confirm-tier action can be carried out without a card',
    !ranWithoutCardF.length, ranWithoutCardF.join(', '));
  // And the two halves agree, so the panel can never be shown a tier the
  // Worker did not mean.
  const disagree = ALLOWED.filter((n) => {
    const p = parked(n);
    return PANEL.actDispatch(p) !== dispatchFor(p);
  });
  // NEGATIVE CONTROL (run 2026-08-28): deleting the via === 'draft' line from the
  // panel's actDispatch made this read
  //   FAIL  A11 the Worker and the panel dispatch every action the same way  -- client-message
  const bothWaysF = [...actionFault(), ...disagree];
  ck('A11 the Worker and the panel dispatch every action the same way',
    !bothWaysF.length, bothWaysF.join(', '));
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
  // AND A PLAIN SENTENCE STILL GETS THROUGH. Without this half, a check on a
  // gate that refuses everything reads green while nothing can ever be sent.
  const plainPasses = alert('Your forms are ready to sign.').ok;
  ck('A13 a notification body cannot carry markup',
    !leaked.length && plainPasses,
    leaked.length ? leaked.join(', ')
      : 'no plain sentence is accepted either, so this proves nothing');
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
  // AND THE ROUTE STILL TAKES THE NARROW BODY. `sent` above is that same route
  // answering { caseId, text } and nothing else, so a route that answered 400
  // to everything fails here instead of passing on its refusals. A20 below
  // rests on the same one send, which is deliberate: two checks about what the
  // route refuses, one proof that it still accepts.
  const routeTakesNarrow = sent.res?.status === 200 && sent.pushes.length > 0;
  ck('A19 the body may carry caseId and text and nothing else',
    !widened.length && routeTakesNarrow,
    !routeTakesNarrow ? 'the route refuses a good body too, so this proves nothing'
      : widened.join(', '));

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
  // AND THE ROUTE STILL TAKES A GOOD ONE. `sent` below is that same route
  // answering a real sentence, so a route that refused everything would fail
  // here rather than pass on its refusals.
  const routeTakesGood = sent.res?.status === 200 && sent.pushes.length > 0;
  ck('A20 the route refuses markup and overlength on its own',
    !bad.length && routeTakesGood,
    bad.length ? bad.join(', ')
      : 'the route refuses a good sentence too, so this proves nothing');

  // THE TRAIL. There is no admin audit log in this app and this route was not
  // going to be the second thing without one.
  const trail = sent.writes.find((w) => w.fields.clientAlerts);
  // COUNT THE ROWS BEFORE INDEXING THEM. An empty array is TRUTHY, so a route
  // writing `clientAlerts: []` is found by that `find` and then `.at(-1)` is
  // undefined and `.text` throws.
  //
  // MEASURED on main, 2026-08-28, by making the route write an empty trail:
  // the file died at this line with `TypeError: Cannot read properties of
  // undefined`, having produced 31 of its 70 lines. Everything from A21b to
  // A32c stopped existing. run.mjs marks the suite failed, so it is loud, but
  // a stack trace is not a verdict and 39 checks went unasked.
  //
  // The rule this came from, arrived at across two branches tonight: assert
  // the ABSOLUTE before the RELATIVE, and make the absolute a NUMBER. "A trail
  // was written" is satisfied by an empty one; "the trail has a row in it" is
  // not.
  const rows = trail?.fields.clientAlerts?.length ?? 0;
  // NEGATIVE CONTROL (run 2026-08-28): deleting the caseMeta patchDoc made
  // this read
  //   FAIL  A21 every sentence sent is recorded, with the time  -- nothing recorded
  ck('A21 every sentence sent is recorded, with the time',
    rows >= 1 && trail.path === 'caseMeta/abc'
      && trail.fields.clientAlerts.at(-1).text === SENTENCE
      && trail.fields.clientAlerts.at(-1).at instanceof Date,
    !trail ? 'nothing recorded'
      : rows === 0 ? '0 rows recorded'
        : JSON.stringify(trail.fields.clientAlerts.at(-1)).slice(0, 90));
  // NEGATIVE CONTROL (run 2026-08-28): swapping the patchDoc and notifyUser
  // calls made this read
  //   FAIL  A21b recorded BEFORE it is sent, so nothing can reach a phone unlogged
  //
  // BOTH ENDS HAVE TO BE FOUND, and that is not pedantry. String.indexOf
  // returns -1 for a string that is not there, and -1 is less than every real
  // index, so deleting the trail write entirely made this read GREEN while
  // nothing was being recorded at all: the exact condition the check is named
  // for.
  //
  // MEASURED on main, 2026-08-28, by renaming `clientAlerts` in the shipped
  // Worker so the trail write no longer matches: A21 failed, and this passed.
  // Found by reading every line that survived the refuse-everything break
  // rather than only the lines I suspected, which is how A10c was missed an
  // hour earlier.
  const recordedAt = W.indexOf('clientAlerts: [...prior');
  const sentAt = W.indexOf("title: 'Pocket Advocate',\n    body: text,");
  ck('A21b recorded BEFORE it is sent, so nothing can reach a phone unlogged',
    recordedAt >= 0 && sentAt >= 0 && recordedAt < sentAt,
    recordedAt < 0 ? 'the trail write is not there at all'
      : sentAt < 0 ? 'the send is not there at all'
        : `recorded at ${recordedAt}, sent at ${sentAt}`);
  // And it lands where no browser can read it. caseMeta is denied to every
  // browser by the catch-all in firestore.rules; cases/{id} is not.
  // NEGATIVE CONTROL (run 2026-08-28): pointing the trail write at cases/{caseId}
  // made this read
  //   FAIL  A21c and the trail is on caseMeta, never on the case a client can read  -- ["cases/abc"]
  // AND SOMETHING WAS ACTUALLY WRITTEN. "Never on the case a client can read"
  // is satisfied perfectly by a route that writes NOWHERE, and nothing is
  // empty in that break so no floor sees it, and it is not a refusal so the
  // acceptance clauses elsewhere do not reach it.
  //
  // MEASURED on main, 2026-08-28, by returning json({ ok: true }) from the
  // first line of handleClientAlert: thirteen checks failed and this one
  // passed.
  // The absolute here is the ROW COUNT, not the write count: a route writing
  // an empty trail writes SOMETHING, and "never on the case" would have gone
  // on passing over a record with nothing in it.
  ck('A21c and the trail is on caseMeta, never on the case a client can read',
    rows >= 1 && !sent.writes.some((w) => w.path.startsWith('cases/')),
    rows === 0 ? `it recorded ${rows} rows, so this proves nothing`
      : JSON.stringify(sent.writes.map((w) => w.path)));

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
    !actionFault().length && offered.join(', ') === [...ALLOWED].sort().join(', '),
    actionFault().length ? actionFault().join('') : `offered: ${offered.join(', ')}`);
  // NEGATIVE CONTROL (run 2026-08-28): blanking a tool description made this read
  //   FAIL  A25b and every tool carries a description and a schema the model can read
  ck('A25b and every tool carries a description and a schema the model can read',
    !actionFault().length
      && actionTools().every((t) => t.description && t.input_schema?.type === 'object'),
    actionFault().join(''));
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

// ---- A28: the form sender, now wired ------------------------------------
//
// EXPECTATION UPDATED 2026-08-28, and NOT relaxed. This check was written on
// the advisor branch, where the sender it needs did not exist: it asserted the
// act was a NAMED SEAM THAT REFUSED, so a card could never be offered for
// something nothing could carry out. That was the right assertion while it was
// true, and it went red the moment the two branches met in one tree and the
// seam was joined, which is the check doing its job rather than failing.
//
// What it guarded is still guarded, one step further along: the act is offered
// only when the sender is genuinely reachable, and the two ends still have to
// agree. A31d and A31e now hold the other half of that, by reading
// admin-case.js directly.
{
  const seam = validateAction('send-forms', {});
  // NEGATIVE CONTROL (run 2026-08-28): setting enabled false again made this
  // read
  //   FAIL  A28 the form sender is offered, and the model is given the tool
  //         -- refused: Sending the forms is not wired up yet
  ck('A28 the form sender is offered, and the model is given the tool',
    seam.ok && ALLOWED.includes('send-forms')
      && actionTools().some((t) => t.name === 'send-forms'),
    seam.ok ? '' : `refused: ${seam.error}`);
  // NEGATIVE CONTROL (run 2026-08-28): deleting the event name from the act
  // made this read
  //   FAIL  A28b and it still names the event both sides agreed on
  ck('A28b and it still names the event both sides agreed on',
    /event: 'pa-send-forms'/.test(ACTSRC) && /'send-forms': \{/.test(ACTSRC));
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
    handleAct: '    renderActCard(act);\n  }',
    // NULL, DELIBERATELY, all four. These captures close on an anchor that is
    // not distinctive, so a tail assertion on them agrees with a slab that ran
    // on to a later occurrence just as readily as with a correct one:
    //   renderActCard  '    });\n  }'  follows every addEventListener in it
    //   runQuestion    '  }\n}'        is two closing braces
    //   adminAssetGate ';'             is the regex's own last character and
    //                                  could not have failed at all
    //   alertConsts    its last line carries ALERT_TRAIL_KEEP, which A22d owns
    // Their sentinels carry them instead, which is a question with teeth: not
    // where the slab ends, but what has to lie outside it.
    renderActCard: null,
    runQuestion: null,
    adminAssetGate: null,
    alertConsts: null,
  };
  const LIFTS = SLABS.map(({ name, src }) => [name, src, TAIL[name]]);
  const short = LIFTS.filter(([, src]) => src.length < 60).map(([n]) => n);
  // NEGATIVE CONTROL (run 2026-08-28), two of them:
  //   renaming carryAct in the shipped panel
  //     FAIL  A30 every lift in this file actually found its function  -- carryAct
  //   renaming ALERT_MAX_PER_DAY in the shipped Worker, which is the middle
  //   line of the three the harness lifts and so takes the whole slab with it
  //     FAIL  A30 every lift in this file actually found its function  -- alertConsts
  //   and the size line said `alertConsts 0` in the same breath, which is the
  //   half that tells you WHICH kind of failure you are looking at.
  const shortF = [...floorFault(), ...short];
  ck('A30 every lift in this file actually found its function', !shortF.length, shortF.join(', '));
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
  const ranOnF = [...floorFault(), ...ranOn];
  ck('A30b and ends exactly where that function ends, not later', !ranOnF.length, ranOnF.join(', '));
  // AND WHAT SHOULD LIE BEYOND IT REALLY DOES. Each lift names a sentinel from
  // past its intended end; finding that string INSIDE the capture means the
  // slab ran on and took it. This replaces a hand-written list of neighbouring
  // headers, which covered whichever neighbours I had remembered to type: a
  // per-lift declaration covers all eight by construction and cannot silently
  // miss one.
  const swallowed = SLABS.filter(({ src, sentinel }) => sentinel && src.includes(sentinel))
    .map(({ name }) => name);
  // NEGATIVE CONTROL (run 2026-08-28), one run-on per lift whose tail rule is
  // now null, because for those three this check is the ONLY thing standing:
  //   renderActCard's anchor loosened from '\n  }' to '\n}'  (2,875 -> 11,769)
  //     FAIL  A30c and swallowed no other function on the way  -- renderActCard
  //   runQuestion's slab made greedy                          (8,227 -> 49,952)
  //     FAIL  A30c and swallowed no other function on the way  -- runQuestion
  //   adminAssetGate run on to the next constant                 (141 -> 583)
  //     FAIL  A30c and swallowed no other function on the way  -- adminAssetGate
  //
  // THE LAST TWO ARE NOT HYPOTHETICAL AND WERE NOT COVERED BEFORE. Measured
  // rather than assumed, by running both captures against the checks as they
  // stood an hour ago:
  //   adminAssetGate 583 chars   PASSES old A30b   old A30c: PASSES
  //   runQuestion  49,952 chars  PASSES old A30b   old A30c: PASSES
  // The old tail for adminAssetGate was ';', which a run-on ends with too, and
  // the old header list held function names only, so a slab swallowing a CONST
  // matched nothing in it. Both would have run on in silence.
  //
  // An early-truncation break does NOT show up here, and should not: a slab
  // that stops short has swallowed nothing. That is A30b's job, on the lifts
  // whose tails still have teeth.
  const swallowedF = [...floorFault(), ...swallowed];
  ck('A30c and swallowed no other function on the way', !swallowedF.length, swallowedF.join(', '));
  // EVERY REGISTERED SLAB IS ACCOUNTED FOR, twice over. A new lift with no
  // TAIL entry would skip A30b in silence; one with no sentinel would skip
  // A30c the same way, and that is the "passes by asserting nothing" shape
  // this whole block exists to end.
  const unowned = SLABS.map(({ name }) => name).filter((n) => !(n in TAIL));
  const unguarded = SLABS.filter(({ sentinel }) => !sentinel).map(({ name }) => name);
  // AND THE SENTINEL MUST ITSELF BE FOUND, at or after the slab's end, in the
  // source that slab came from. Without this half a sentinel with a typo in it
  // is absent from the capture for the wrong reason and A30c passes on it,
  // which is precisely the bug class this exchange has been chasing. `hay` is
  // carried per lift so the question can be asked at all.
  const misplaced = SLABS.filter(({ hay, src, sentinel }) => {
    if (!sentinel || !src) return false;
    const at = hay.indexOf(sentinel);
    return at < 0 || at < hay.indexOf(src) + src.length;
  }).map(({ name }) => name);
  // NEGATIVE CONTROL (run 2026-08-28): removing adminAssetGate's sentinel
  // argument made this read
  //   FAIL  A30d every registered slab declares a tail rule and a sentinel  -- adminAssetGate: no sentinel
  const ownedF = [...floorFault(), ...unowned.map((n) => `${n}: no tail rule`),
    ...unguarded.map((n) => `${n}: no sentinel`)];
  ck('A30d every registered slab declares a tail rule and a sentinel',
    !ownedF.length, ownedF.join(', '));
  // NEGATIVE CONTROL (run 2026-08-28), both halves of the claim:
  //   a typo in handleClientAlert's sentinel, so the string exists nowhere
  //     FAIL  A30d2 and every sentinel is real, and really lies beyond its slab  -- handleClientAlert
  //   alertConsts pointed at 'const ADMIN_ASSET =', which is real but sits
  //   EARLIER in the file, so it proves nothing about where that slab stops
  //     FAIL  A30d2 ... -- alertConsts
  const misplacedF = [...floorFault(), ...misplaced];
  ck('A30d2 and every sentinel is real, and really lies beyond its slab',
    !misplacedF.length, misplacedF.join(', '));
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
    SLABS.length >= SLAB_FLOOR, `${SLABS.length} lifts, expected at least ${SLAB_FLOOR}`);
  console.log(`      lift sizes: ${LIFTS.map(([n, src]) => `${n} ${src.length}`).join(', ')}`);
}

// ---- A31: the form sending seam, now that both halves are in one tree -----
//
// The advisor branch shipped this act refused (`enabled: false`) because the
// sender it needs lives on the forms branch, and the forms branch shipped the
// listener with nothing calling it. Neither could test the join. This is the
// first commit where both exist, so this is the first place the join can be
// checked at all.
//
// Eric named this one himself: "send the hands-off forms to the client".
{
  const r = ACTS.validateAction('send-forms', {});
  // NEGATIVE CONTROL (2026-08-28): setting enabled back to false made this read
  //   FAIL  A31 the advisor can offer to send the forms  -- Sending the forms
  //         is not wired up yet, so I cannot offer it.
  ck('A31 the advisor can offer to send the forms', r.ok, r.error || '');

  // NEGATIVE CONTROL (2026-08-28): tier DESK made this read
  //   FAIL  A31b and it is CONFIRM tier, because it puts documents on a
  //         client's case and buzzes their phone  -- desk / run
  ck("A31b and it is CONFIRM tier, because it puts documents on a client's case and buzzes their phone",
    r.tier === 'confirm' && ACTS.dispatchFor(r) === 'card',
    `${r.tier} / ${ACTS.dispatchFor(r)}`);

  // The panel cannot POST this one anywhere, so it must carry the event name
  // and the list. Both come off this module's tables, never off the model.
  // NEGATIVE CONTROL (2026-08-28): dropping `event` from the validate return
  // made this read
  //   FAIL  A31c it travels by page event, with the name and the forms on it
  //         -- via page, event undefined, kinds records,representative
  ck('A31c it travels by page event, with the name and the forms on it',
    r.via === 'page' && r.event === 'pa-send-forms'
      && Array.isArray(r.kinds) && r.kinds.length === 2,
    `via ${r.via}, event ${r.event}, kinds ${r.kinds}`);

  // The two ends have to agree on the event NAME or the dispatch lands nowhere
  // and the card says "not on this page" forever. admin-case.js is read here
  // rather than assumed, because it is the other branch's file.
  const ADMINCASE = read('public/js/admin-case.js');
  // NEGATIVE CONTROL (2026-08-28): renaming the listener's event to
  // 'pa-send-forms-x' made this read
  //   FAIL  A31d and admin-case.js listens for exactly that name  -- listener
  //         for pa-send-forms: false
  ck('A31d and admin-case.js listens for exactly that name',
    ADMINCASE.includes(`addEventListener('${r.event}'`),
    `listener for ${r.event}: ${ADMINCASE.includes(`addEventListener('${r.event}'`)}`);

  // NEGATIVE CONTROL (2026-08-28): making the listener `async` made this read
  //   FAIL  A31e the listener assigns the promise synchronously, so a real
  //         send is never read as "no sender here"
  const lis = ADMINCASE.slice(ADMINCASE.indexOf(`addEventListener('${r.event}'`));
  ck('A31e the listener assigns the promise synchronously, so a real send is never read as "no sender here"',
    /addEventListener\('pa-send-forms', \(e\) => \{/.test(lis.slice(0, 120))
      && !/addEventListener\('pa-send-forms', async/.test(lis.slice(0, 120)));

  // And the panel end: a page act must never fall through to fetch(null).
  // NEGATIVE CONTROL (2026-08-28): deleting the `via === 'page'` branch from
  // carryAct made this read
  //   FAIL  A31f the panel routes a page act to the event, not to fetch(null)
  ck('A31f the panel routes a page act to the event, not to fetch(null)',
    /if \(act\.via === 'page'\)/.test(PANELSRC)
      && PANELSRC.indexOf("act.via === 'page'") < PANELSRC.indexOf('fetch(act.path'));

  // Resendable, per Eric, on this side too.
  // NEGATIVE CONTROL (2026-08-28): adding an "already sent" refusal to check()
  // made this read
  //   FAIL  A31g sending the forms again is never refused as already sent
  ck('A31g sending the forms again is never refused as already sent',
    ACTS.validateAction('send-forms', {}).ok
      && ACTS.validateAction('send-forms', {}).ok
      && !/already sent/i.test(ACTSRC.slice(ACTSRC.indexOf("'send-forms'"), ACTSRC.indexOf("'send-forms'") + 1400)));
}

// ---- A32: the confirm card, LIFTED AND RUN ------------------------------
//
// Until now this file matched renderActCard as TEXT and never called it. That
// is how a comment claiming the card shows "both figures, side by side" for a
// money change survived: nothing ever ran the function to see.
//
// Measured 2026-08-28 by lifting it and rendering the real output of
// validateAction('set-paid', { dollars: 3500 }). The act carries ok, name,
// tier, via, scoped, path, args, summary and amountCents. There is no `before`
// and no `after`, from the allowlist or from anywhere else, so both lines are
// skipped and the card renders three things.
//
// THIS CHECK PINS WHAT HE ACTUALLY SEES, not what the comment wished for. The
// figure is in the summary, spelled out, which is what keeps $3,500 and
// $35,000 apart. If someone later supplies before/after, A32b goes red and is
// updated deliberately rather than the change landing unnoticed.
{
  const mk = (tag) => ({
    tagName: tag.toUpperCase(), className: '', id: '', hidden: false,
    style: {}, dataset: {}, children: [], _text: '',
    set textContent(t) { this._text = t; }, get textContent() { return this._text; },
    set innerHTML(h) { this.children = []; }, get innerHTML() { return ''; },
    appendChild(c) { this.children.push(c); return c; },
    append(...c) { this.children.push(...c); },
    addEventListener() {}, scrollIntoView() {},
  });
  // A LOST LIFT IS A CLEAN FAIL, NOT A STACK TRACE. Renaming renderActCard in
  // the shipped panel leaves the slab empty, and running an empty slab threw
  // `ReferenceError: renderActCard is not defined`, killing the process with
  // no verdict for this block. Loud, but the same "the tool is broken" shape
  // the blindness audit had against a dead origin. Measured 2026-08-28.
  const render = (act) => {
    if (!LIFT.renderActCard) return null;
    const host = mk('div');
    const actLine = (h, text) => { const el = mk('p'); el.textContent = text; h.appendChild(el); return el; };
    let fn;
    try {
      fn = new Function('actCard', 'actLine', 'document', 'actFinish', 'actBusy',
        `${LIFT.renderActCard}\n return renderActCard;`)(
        host, actLine, { createElement: mk }, async () => {}, false);
      fn(act);
    } catch (e) { return { threw: `${e.constructor.name}: ${e.message}` }; }
    const flat = (n, out = []) => { if (n._text) out.push(n._text); n.children.forEach((c) => flat(c, out)); return out; };
    return flat(host);
  };
  const paid = validateAction('set-paid', TABLE['set-paid']?.good);
  const rendered = render({ ...paid, name: 'set-paid' });
  const shown = Array.isArray(rendered) ? rendered : [];
  const why = rendered === null ? 'the lift came back empty'
    : rendered?.threw ? rendered.threw : '';

  // NEGATIVE CONTROL (run 2026-08-28): renaming renderActCard in the shipped
  // panel made this read
  //   FAIL  A32 the confirm card lifts out of the shipped panel and renders
  ck('A32 the confirm card lifts out of the shipped panel and renders',
    !why && shown.length > 0, why || `${shown.length} lines`);

  // FOUR LINES: the heading, the summary, and the two buttons. I first wrote
  // three here and this check told me so on its first run, which is the whole
  // argument for pinning a rendered count rather than describing it.
  //
  // NEGATIVE CONTROL (run 2026-08-28): giving the act a `before` string made
  // this read
  //   FAIL  A32b -- 5 lines: ... | This case records $175 paid. | Not now | Do it
  ck('A32b the two-figure lines are NOT rendered, because nothing supplies them',
    !paid.before && !paid.after && shown.length === 4,
    `${shown.length} lines: ${shown.join(' | ')}`);

  // AND THE FIGURE HE CONFIRMS IS ON THE CARD, spelled out, which is the half
  // that does the work. NEGATIVE CONTROL (2026-08-28): blanking the summary in
  // the shipped module made this read
  //   FAIL  A32c the amount he is confirming is on the card, in full
  ck('A32c the amount he is confirming is on the card, in full',
    shown.some((t) => /\$3,500/.test(t)), shown.join(' | '));
}

// ---- A33-A36: the voice fix (Eric, 2026-08-29) ---------------------------
//
// "The app still isn't picking up my tone at all and it has 30 pages of my
// writing. It still reeks of AI, not my voice, and doesn't take in immediate
// emotional tone or context." Three causes, each pinned and proven able to
// fail: the draft writer never saw his writing from other threads, the
// distilled profile outranked his verbatim messages, and nothing told the
// writer to read the moment.
{
  // NEGATIVE CONTROL (run 2026-08-29): lowering the thin-thread threshold to
  // 0 (so the fallback never fires) made this read
  //   FAIL  A33 a thin thread pulls his real messages from every other thread, echo-guarded
  ck('A33 a thin thread pulls his real messages from every other thread, echo-guarded',
    /voice\.length < 2500/.test(ADV)
    && /voiceCorpus\(env, \{ exclude: style\.echo \}\)/.test(ADV)
    && /<his_voice_elsewhere>/.test(ADV)
    && /echo: new Set\(editsRaw\.map\(\(r\) => r\.data\.sent\)\.filter\(Boolean\)\.map\(flatText\)\)/.test(ADV));

  // NEGATIVE CONTROL (run 2026-08-29): restoring the old authority line
  // ("the profile wins" with no messages-win clause) made this read
  //   FAIL  A34 his verbatim messages outrank the learned profile, in both places that rank them
  ck('A34 his verbatim messages outrank the learned profile, in both places that rank them',
    /THEY are the styling authority/.test(ADV)
    && /Where the profile and his verbatim messages disagree, the messages win/.test(ADV)
    && /a draft more polished than his own writing is a\nfailed draft/.test(ADV));

  // NEGATIVE CONTROL (run 2026-08-29): cutting the moment paragraph from the
  // draft prompt made this read
  //   FAIL  A35 the draft writer reads where the client is RIGHT NOW and answers that state
  ck('A35 the draft writer reads where the client is RIGHT NOW and answers that state',
    /where they are RIGHT\nNOW: scared, flat, angry, hopeful, done/.test(ADV)
    && /The first sentence meets that state/.test(ADV)
    && /match what Eric actually sent back in that moment/.test(ADV));

  // NEGATIVE CONTROL (run 2026-08-29): deleting the em-dash entry from the
  // tells list made this read
  //   FAIL  A36 the machine tells are banned by name, the dashes included
  ck('A36 the machine tells are banned by name, the dashes included',
    /Machine tells, banned because he never writes them/.test(ADV)
    && /an em dash or en dash anywhere/.test(ADV)
    && /If a sentence could open any support email ever written, it is\nnot his/.test(ADV)
    && /\.slice\(0, 5\)\n      \.map\(\(r\) => \(\{ draft: r\.data\.draft, sent: r\.data\.sent \}\)\)/.test(ADV));
}

// ---- A37-A38: the draft obeys his brief and can see the shelf (2026-08-30)
{
  // NEGATIVE CONTROL (run 2026-08-30): cutting the brief paragraph from the
  // draft prompt made this read
  //   FAIL  A37 an instruction is the whole brief: nothing is folded in that he did not ask for
  ck('A37 an instruction is the whole brief: nothing is folded in that he did not ask for',
    /THE\nINSTRUCTION IS THE WHOLE BRIEF/.test(ADV)
    && /do\nnot fold in next steps, recommendations, or case updates he did not ask for/.test(ADV)
    && /expand it faithfully rather than answering it or replacing it/.test(ADV)
    && /It is the whole brief; build the entire message from it and nothing else/.test(ADV));

  // NEGATIVE CONTROL (run 2026-08-30): dropping listShelf from the draft's
  // Promise.all made this read
  //   FAIL  A38 the draft writer sees the whole shelf by name, his folders included, and may not invent one
  ck('A38 the draft writer sees the whole shelf by name, his folders included, and may not invent one',
    /listShelf\(env, kind, id\)\.catch\(\(\) => \[\]\)/.test(ADV)
    && /<case_files>/.test(ADV)
    && /Never invent a file name/.test(ADV)
    && /export async function listShelf/.test(STOR)
    && /\[\.\.\.INTAKE_FOLDERS, 'report', 'recording'\]/.test(STOR));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
