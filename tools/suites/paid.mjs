// paid.mjs - what a case actually paid, on every screen that says so.
//
// Eric, on a live case: his dashboard said $175 and the client had paid
// $3,400. Every part of that was already recordable - the Worker route
// existed, the field existed, the arithmetic existed - and it still read $175,
// four ways at once:
//
//   the control was a 0.72rem dim monospace pill with no pointer, no role, no
//   accessible name and no verb, whose only explanation was a title attribute
//   an iPhone never renders, sitting on the Chat page;
//   a successful save was invisible, because say('paid', ...) wrote into a key
//   with no slot rendered anywhere in the file;
//   and even a save that landed changed nothing on screen, because
//   startWorkClock closed over the case document as it was at render time and
//   load() never re-renders the Chat pane;
//   and paidOverrideCents had exactly ONE reader in the whole app, so the
//   shelf, the Overview, the ledger and the client's own page all went on
//   quoting Stripe.
//
// SO THE ARITHMETIC IS LIFTED AND RUN, not pattern matched. This is his money.
// A regex passes on a version that computes the wrong number, and the version
// that computed the wrong number is the one that shipped.
import { readFileSync } from 'node:fs';
import { fileURLToPath as f } from 'node:url';
import { dirname as d, join as j } from 'node:path';

const ROOT = j(d(f(import.meta.url)), '..', '..');
const read = (p) => readFileSync(j(ROOT, p), 'utf8');
const ADMINCASE = read('public/js/admin-case.js');
const ADMIN = read('public/js/admin.js');
const CLIENT = read('public/js/case.js');
const SETTINGS = read('public/js/admin-settings.js');
const WORKER = read('worker/index.js');
const CSS = read('public/css/admin.css');

const results = [];
const ck = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};

/**
 * Comments stripped. There is no build step, so the comments ARE served bytes
 * and a regex looking for the absence of something finds it in the very
 * comment explaining why it was removed. M21 below asserted that say('paid')
 * is gone from the case page and went red against a comment that says
 * "say('paid', ...) wrote into a key with no slot" - the check was right, the
 * source it was reading was not.
 */
const bare = (src) => src.split('\n')
  .filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln)).join('\n');

/** A named declaration, verbatim out of the shipped file. */
const lift = (name, src) => {
  const m = src.match(new RegExp(`(?:function ${name}\\([\\s\\S]*?\\n\\}|const ${name} = [^;]+;)`));
  return m ? m[0] : '';
};
/** An arbitrary slab, anchor to anchor, so a production line can be executed
 *  even when it does not live inside a liftable function of its own. */
const slab = (src, from, to) => {
  const a = src.indexOf(from);
  if (a < 0) return '';
  const b = src.indexOf(to, a);
  return b < 0 ? '' : src.slice(a, b + to.length);
};

// THE CASE. Stripe took $175 on the booking, he collected $3,400 in total, and
// the clock says 17h 45m. Every number below is about this one case.
const STRIPE = 17500;
const RECORDED = 340000;
const SECONDS = 17 * 3600 + 45 * 60;
const HOURS = SECONDS / 3600;
const CASE = {
  clientName: 'Christopher', caseRateCents: 0, extraPayments: [],
  stripe: { amountTotal: STRIPE },
  paidOverrideCents: RECORDED,
  work: { seconds: SECONDS, startedAt: null },
};

// ---- M1-M4: the hourly ---------------------------------------------------
{
  const body = [
    'const CASE_PRICE_CENTS = 120000;',
    lift('caseRate', ADMINCASE),
    lift('paidCents', ADMINCASE),
    lift('effectiveHourly', ADMINCASE),
    'return { paidCents, effectiveHourly };',
  ].join('\n');
  let api = null;
  try { api = new Function(body)(); } catch { /* M1 reports it */ }
  // NEGATIVE CONTROL: renaming paidCents to paidTotal in the shipped file made
  // this read
  //   FAIL  M1 the money functions still lift out of the shipped page and run
  // A lift that has lost its target must go red, never quietly assert nothing.
  ck('M1 the money functions still lift out of the shipped page and run',
    !!api && typeof api.effectiveHourly === 'function');

  if (api) {
    // NEGATIVE CONTROL (run 2026-08-28): deleting the `if (recorded > 0)`
    // branch from paidCents made this read
    //   FAIL  M2 ... -- paidCents 17500, wanted 340000
    ck('M2 a recorded payment IS what the case has paid, over Stripe\'s receipt',
      api.paidCents(CASE) === RECORDED, `paidCents ${api.paidCents(CASE)}, wanted ${RECORDED}`);
    // THE NUMBER. $3,400 across 17h 45m is $191.55/hr.
    // NEGATIVE CONTROL: same break as M2 gave
    //   FAIL  M3 ... -- $9.86/hr, wanted $191.55/hr
    // which is the exact figure his screen was showing him.
    const hourly = api.effectiveHourly(CASE, SECONDS);
    ck('M3 and the hourly worked out from it is $191.55, to the cent',
      hourly === 19155, `$${(hourly / 100).toFixed(2)}/hr, wanted $191.55/hr`);
    // The wrong answer, named, so it can never come back quietly.
    // NEGATIVE CONTROL: same break as M2 gave
    //   FAIL  M4 ... -- the wrong figure is $9.86/hr
    const wrong = Math.round(STRIPE / HOURS);
    ck('M4 the $9.86/hr he was actually shown is no longer reachable',
      hourly !== wrong && wrong === 986, `the wrong figure is $${(wrong / 100).toFixed(2)}/hr`);
  }
}

// ---- M5-M8: the shelf ----------------------------------------------------
// byKind('hand') read `extraPayments[].byHand` and nothing else, so on a case
// with no such row handCents was 0 and the ENTIRE "Recorded by you, paid
// another way" block did not render. His $3,400 was on the case and appeared
// nowhere on the screen he checks first.
{
  const code = slab(ADMIN, '  const handRecorded = (c) =>', "  const handCents = byKind('hand');");
  // NEGATIVE CONTROL: renaming handRecorded made this read
  //   FAIL  M5 the shelf sums lift out of the dashboard
  ck('M5 the shelf sums lift out of the dashboard', code.length > 0);
  let sums = null;
  try {
    sums = new Function('cases', `${code}\nreturn { cents, handCents };`)([CASE]);
  } catch { /* M5 reports it */ }
  if (sums) {
    // NEGATIVE CONTROL: putting `handRecorded` back to `0` for the hand side
    // made this read
    //   FAIL  M6 ... -- hand line $0, and the whole block does not render
    // which is the defect exactly.
    ck('M6 the hand line shows the money Stripe never saw, so the block renders',
      sums.handCents === RECORDED - STRIPE && sums.handCents > 0,
      `hand line $${(sums.handCents / 100).toLocaleString()}, and the whole block does not render`);
    // NEGATIVE CONTROL: folding the recorded figure into the 'stripe' side
    // made this read
    //   FAIL  M7 ... -- headline $3,400, but Stripe took $175
    ck('M7 the headline still means exactly what Stripe took, and nothing else',
      sums.cents === STRIPE, `headline $${(sums.cents / 100).toLocaleString()}, but Stripe took $${(STRIPE / 100).toLocaleString()}`);
    // NEGATIVE CONTROL: both breaks above hit this too, at
    //   FAIL  M8 ... -- $175, wanted $3,400        (hand line zeroed)
    //   FAIL  M8 ... -- $6,625, wanted $3,400      (recorded money counted twice)
    ck('M8 and the two lines add up to what the client really paid',
      sums.cents + sums.handCents === RECORDED,
      `$${((sums.cents + sums.handCents) / 100).toLocaleString()}, wanted $${(RECORDED / 100).toLocaleString()}`);
  }
  // NEGATIVE CONTROL: shortening the headline to "Case revenue" made this read
  //   FAIL  M8b the card still says the headline is Stripe money, in those words
  ck('M8b the card still says the headline is Stripe money, in those words',
    /Case revenue \(paid via Stripe\)/.test(ADMIN)
    && /Recorded by you, paid another way/.test(ADMIN));
}

// ---- M9-M10: the Overview PAID row ---------------------------------------
{
  const code = slab(ADMINCASE, '  const extraCents = Array.isArray(c.extraPayments)', "'var(--cyan)');");
  // NEGATIVE CONTROL: renaming extraCents made this read
  //   FAIL  M9 the PAID row lifts out of the info bar
  //   FAIL  M10 ... -- (nothing painted)
  // which is why M10's detail names the empty case rather than trusting a
  // regex against nothing.
  ck('M9 the PAID row lifts out of the info bar', code.length > 0);
  let painted = '';
  try {
    new Function('c', 'row', code)(CASE, (k, v) => { if (k === 'PAID') painted = v; });
  } catch { /* M9 reports it */ }
  // NEGATIVE CONTROL: putting the row back to `(c.stripe?.amountTotal || 0)`
  // made this read
  //   FAIL  M10 ... -- $175
  // which is what the page he opens first was printing.
  ck('M10 the Overview PAID row prints the recorded figure, not the booking',
    /\$3,400/.test(painted) && !/\$175/.test(painted), painted || '(nothing painted)');
  // NEGATIVE CONTROL: same break as M10 gave
  //   FAIL  M10b ... -- $175
  ck('M10b and it says on its face that the figure is his own',
    /recorded by you/.test(painted), painted.slice(0, 90));
}

// ---- M11: the ledger -----------------------------------------------------
{
  const fn = (WORKER.match(/async function handleLedger\(request, env\) \{[\s\S]*?\n\}/) || [''])[0];
  // NEGATIVE CONTROL: renaming handleLedger made this read
  //   FAIL  M11a handleLedger lifts out of the shipped Worker
  //   FAIL  M11 ... -- ledger says $0
  ck('M11a handleLedger lifts out of the shipped Worker', fn.length > 0);
  const make = new Function('__rows', `
    const json = (o) => ({ status: 200, body: o });
    const requireAdmin = async () => ({ uid: 'admin' });
    const listDocs = async () => __rows;
    ${fn}
    return handleLedger;
  `);
  let out = null;
  try {
    out = (await make([{ id: 'c1', data: CASE }])({}, {})).body;
  } catch { /* M11 reports it */ }
  // NEGATIVE CONTROL: dropping `Number(c.paidOverrideCents) ||` from the chain
  // made this read
  //   FAIL  M11 ... -- ledger says $175
  ck('M11 the ledger counts what he recorded, not the card charge',
    out?.totals?.paidCents === RECORDED,
    `ledger says $${((out?.totals?.paidCents || 0) / 100).toLocaleString()}`);
}

// ---- M12-M14: what the CLIENT sees ---------------------------------------
// Eric's answer, verbatim: keep the hours, fix the money. A client dividing
// $175 by 17h 45m gets $9.86/hr, and the hours line is staying, so the money
// line is the half that has to stop understating him.
{
  const body = [
    lift('confirmedLine', CLIENT),
    lift('paidShownCents', CLIENT),
    'return { confirmedLine, paidShownCents };',
  ].join('\n');
  let api = null;
  try { api = new Function(body)(); } catch { /* M12 reports it */ }
  // NEGATIVE CONTROL: renaming paidShownCents made this read
  //   FAIL  M12a the client's payment line lifts and runs
  ck('M12a the client\'s payment line lifts and runs', !!api);
  if (api) {
    const line = api.confirmedLine({ ...CASE, status: 'awaiting_report' });
    // NEGATIVE CONTROL: putting confirmedLine back to `c.stripe?.amountTotal`
    // made this read
    //   FAIL  M12 ... -- Payment confirmed, $175 received
    ck('M12 the client is told the real total, not the first card charge',
      /\$3,400 received/.test(line), line);
    // It must still REFUSE to guess. A case with nothing on it but a price
    // list is the sevenfold error that started all of this.
    const blind = { status: 'open', caseRateCents: 120000 };
    // NEGATIVE CONTROL: adding a caseRateCents rung to paidShownCents made
    // this read
    //   FAIL  M13 ... -- Payment confirmed, $1,200 received
    ck('M13 and a case with no payment on it names no figure at all',
      api.confirmedLine(blind) === 'Payment confirmed',
      api.confirmedLine(blind));
    // NEGATIVE CONTROL: deleting the tier rung made this read
    //   FAIL  M13b a tier case reads its tier total rather than the booking
    ck('M13b a tier case reads its tier total rather than the booking',
      api.paidShownCents({ fullAccess: true, fullAccessRateCents: 460000, stripe: { amountTotal: 120000 } }) === 460000);
  }
  // THE HOURS STAY. His explicit answer.
  ck('M14 the client still sees the hours, live, with the working badge',
    /Time I have worked on your case/.test(CLIENT)
    && /working on it right now/.test(CLIENT)
    && /function workLine/.test(CLIENT));
}

// ---- M15-M17: the control that was not there -----------------------------
// Lifted and EXECUTED, because the requirement is about what renders. The
// state that most needs the box is the one where nothing is recorded, and a
// regex cannot tell that state from any other.
{
  const body = [
    lift('onCase', SETTINGS),
    // slab, not lift: `const esc = ... ;` cannot be matched with [^;]+ when
    // the body contains '&amp;', which ends in a semicolon. The first attempt
    // did exactly that and blew up with a SyntaxError inside new Function,
    // which is the right way for a broken lift to behave and the reason the
    // shape of every lift here is checked before it is trusted.
    slab(SETTINGS, 'const esc = ', '[ch]));'),
    (SETTINGS.match(/export function adminSettingsHtml\(\) \{[\s\S]*?\n\}/) || [''])[0]
      .replace('export function', 'function'),
    'return adminSettingsHtml;',
  ].join('\n');
  const render = (pathname, search, name) => {
    const fn = new Function('location', 'document', 'localStorage', body)(
      { pathname, search },
      { querySelector: () => (name === null ? null : { textContent: name }) },
      { getItem: () => '1' },
    );
    return fn();
  };
  // NEGATIVE CONTROL: gating the row on a recorded amount (the shape the old
  // pill had, which hid itself whenever the hourly was null) made this read
  //   FAIL  M15 ... -- (no money row)
  const onCasePage = render('/admin-case.html', '?id=demo-case', 'Christopher Reeve');
  // The Worker redirects /admin-case.html to /admin-case, so the extensionless
  // path is the one he is ever actually on. The first version of onCase()
  // matched the filename only and rendered NOTHING on the real page; the
  // browser drive caught it, and this is here so it cannot come back.
  const onRealPath = render('/admin-case', '?id=demo-case', 'Christopher Reeve');
  ck('M15 the pay control renders on a case page with NOTHING recorded yet',
    /data-paid-amount/.test(onCasePage) && /data-paid-save/.test(onCasePage),
    onCasePage.includes('data-paid-amount') ? '' : '(no money row)');
  // NEGATIVE CONTROL: same break as M15 gave
  //   FAIL  M15b ... -- (no heading)
  // NEGATIVE CONTROL: matching only /admin-case\.html$ made this read
  //   FAIL  M15a the pay control renders on the path the Worker actually serves
  ck('M15a the pay control renders on the path the Worker actually serves',
    /data-paid-amount/.test(onRealPath), '(no money row on /admin-case)');
  ck('M15b and it names the client, so it cannot be about the wrong case',
    /Christopher Reeve/.test(onCasePage),
    (onCasePage.match(/<h4[^>]*>([^<]*)</) || [])[1] || '(no heading)');
  // NEGATIVE CONTROL: dropping min-height:44px from the button made this read
  //   FAIL  M15c it carries a verb and a 44px target, which the old pill had neither of
  ck('M15c it carries a verb and a 44px target, which the old pill had neither of',
    /min-height:44px/.test(onCasePage) && />Record</.test(onCasePage));
  // NEGATIVE CONTROL: removing the pathname test from onCase() made this read
  //   FAIL  M16 ... -- the money row is on the dashboard
  const onDashboard = render('/admin.html', '', null);
  ck('M16 and it is absent from the dashboard, where there is no one case',
    !/data-paid-amount/.test(onDashboard), 'the money row is on the dashboard');
  // NEGATIVE CONTROL: same break as M16 gave
  //   FAIL  M16b a case page with a junk id gets no money row either
  ck('M16b a case page with a junk id gets no money row either',
    !/data-paid-amount/.test(render('/admin-case.html', '?id=../../etc', 'x')));
  // The asset gate matches js/admin[\w-]*.js. This row is the one place a
  // client could learn what he charges by hand, so it lives behind that name.
  // NEGATIVE CONTROL: putting the string data-paid-amount into settings.js,
  // even inside a comment, made this read
  //   FAIL  M17 the control ships in an admin-named file, never in settings.js
  // A comment is a served byte here; that is the point of checking the file
  // rather than the runtime.
  ck('M17 the control ships in an admin-named file, never in settings.js',
    WORKER.includes('(admin[\\w-]*|advisor')
    && !/paid-amount/.test(read('public/js/settings.js'))
    && !/paidOverride/.test(read('public/js/settings.js')));
}

// ---- M18-M21: one control, and it repaints -------------------------------
{
  // NEGATIVE CONTROL: re-adding the pill's rateEl click handler made this read
  //   FAIL  M18 ... -- 2 writers of set-paid on the case page
  const writers = (bare(ADMINCASE).match(/'set-paid'/g) || []).length
    + (bare(SETTINGS).match(/'set-paid'/g) || []).length;
  ck('M18 exactly ONE control writes what a client paid',
    writers === 1, `${writers} writers of set-paid on the case page`);
  // NEGATIVE CONTROL: same break as M18 gave
  //   FAIL  M18b and the pill beside the clock is a readout with no click handler
  ck('M18b and the pill beside the clock is a readout with no click handler',
    !/rateEl\?\.addEventListener/.test(bare(ADMINCASE))
    && !/rateEl\.addEventListener/.test(bare(ADMINCASE)));
  // NEGATIVE CONTROL: putting `cursor: pointer` back into .work-rate.unknown
  // made this read
  //   FAIL  M18c the dead .unknown style is live now, and no longer claims a cursor
  ck('M18c the dead .unknown style is live now, and no longer claims a cursor',
    /\.work-rate\.unknown \{[^}]*\}/.test(CSS)
    && !/\.work-rate\.unknown \{[^}]*cursor: pointer/.test(CSS)
    && /classList\.toggle\('unknown'/.test(ADMINCASE));

  // THE BUG THAT STARTED THIS. startWorkClock is called once, from render(),
  // and closed over `c`. load() reassigns `data` and does not re-render the
  // Chat pane, so the pill kept printing the pre-save hourly for as long as
  // the page stayed open.
  const paint = slab(ADMINCASE, '    const live = data || c;', '    }\n    btn.textContent =');
  // NEGATIVE CONTROL: putting `effectiveHourly(c, t)` back made this read
  //   FAIL  M19 ... -- the pill still reads the closed-over case
  ck('M19 the pill reads the CURRENT case document, not the one it closed over',
    /const live = data \|\| c;/.test(paint)
    && /effectiveHourly\(live, t\)/.test(paint)
    && /paidCents\(live\)/.test(paint)
    && !/effectiveHourly\(c, t\)/.test(bare(paint)),
    'the pill still reads the closed-over case');
  // NEGATIVE CONTROL: deleting the listener made this read
  //   FAIL  M20 ... -- nothing repaints the case after a save
  // UPDATED in the same change that added it, after the browser drive found
  // half of it missing. The first version pinned the listener's exact one-line
  // body, and re-reading the case turned out not to be enough on its own: the
  // rate pill is repainted by the 30-second clock tick, so it sat on the old
  // hourly for up to half a minute after a save. The listener awaits load()
  // and then calls paintClock(); the check asserts the three things that have
  // to be true rather than the shape of the line they are written on.
  const listener = slab(ADMINCASE, "document.addEventListener('pa-case-money'", '});');
  ck('M20 recording a payment repaints the case with no reload',
    /await load\(\);/.test(listener)
    && /paintClock\(\);/.test(listener)
    && /new CustomEvent\('pa-case-money'\)/.test(SETTINGS),
    'nothing repaints the case after a save');
  // The old control's confirmation was written into a key with no slot. The
  // new one paints into its own element, which is on screen when it writes.
  ck('M21 a save says so, and a refusal says so, in a spot that renders',
    /data-paid-said/.test(SETTINGS)
    && /Recorded\. This case now reads/.test(SETTINGS)
    && /Not recorded: /.test(SETTINGS)
    && !/say\('paid'/.test(bare(ADMINCASE)));
  // And it re-reads before it claims anything, the way saveLink does.
  // NEGATIVE CONTROL: trusting the 200 instead of re-reading made this read
  //   FAIL  M21b it re-reads the case before claiming the client can see it
  ck('M21b it re-reads the case before claiming the client can see it',
    /const stored = Number\(\(await readCase\(\)\)\.paidOverrideCents\)/.test(SETTINGS)
    && /the case still shows the old figure/.test(SETTINGS));
  // A failed write puts the control back rather than leaving his typing in a
  // box nothing agrees with.
  // NEGATIVE CONTROL: re-enabling the box without repainting it made this read
  //   FAIL  M21c a failed write reverts the control instead of lying about it
  ck('M21c a failed write reverts the control instead of lying about it',
    /paint\(confirmed\);/.test(SETTINGS) && /Nothing on the case changed/.test(SETTINGS));
}

// ---- M22: one number, not two -------------------------------------------
// `set-paid` with 3400 stores $3,400. `open-full` with 3400 stores
// stripe.amountTotal + 3400. Two controls, two answers for one real event.
{
  ck('M22 the open-by-hand box says which figure it is NOT setting',
    /This adds to the case\n\s*fee already on the record/.test(ADMINCASE)
    && /set the whole figure in Settings instead/.test(ADMINCASE));
  // And the arithmetic backs the sentence: the recorded figure is read first,
  // ahead of the tier total, so Settings really is the single answer.
  const order = ADMINCASE.indexOf('const recorded = Number(c?.paidOverrideCents);');
  const tier = ADMINCASE.indexOf('if (c?.fullAccess && Number(c.fullAccessRateCents) > 0)');
  // NEGATIVE CONTROL: moving the recorded rung below the tier rung made this
  // read
  //   FAIL  M22b ... -- recorded at 5182, tier at 5071
  ck('M22b and the recorded figure is read before the tier total, not after',
    order > 0 && tier > order, `recorded at ${order}, tier at ${tier}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
