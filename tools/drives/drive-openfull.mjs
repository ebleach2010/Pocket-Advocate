// drive-openfull.mjs - opening Hands-Off Case Management by hand.
//
//   PA_PORT=8901 node tools/drives/drive-openfull.mjs
//
// Eric, 2026-08-26: "I need to charge a client 3400 (verbally agreed to on
// call)... idk where to change his amount paid... and then where to start the
// clock and send forms as if he paid for the enhancement through the app."
//
// The money half already worked. The other half did not exist: the tier flag
// had exactly ONE writer in the whole system, a Stripe webhook, so a client
// who agreed on a call and paid another way could not be given the thing he
// had bought. Everything that matters here is gated on that flag.
//
// So the check that counts is the LAST one: the client's own page. The admin
// panel saying a nice sentence proves nothing if the tier furniture did not
// actually open on the client's side.
//
// UPDATED 2026-08-27, not deleted. That furniture used to BE the two
// authorisation forms, and signing them on the case page was parked on Eric's
// word ("Remove the release of records and park that"). What the client's page
// carries in that slot now is the work log, with the readiness row and the
// window sentence at the head of it, so this drive follows the panel rather
// than being loosened to "is anything there". The three things it has always
// really asserted are unchanged: the tier flag reached the client's browser,
// their page says their month STARTS rather than started, and it tells them
// why getting the permission in early is still worth it.
import { chromium } from 'playwright';
const P = `http://127.0.0.1:${process.env.PA_PORT || 8901}`;
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ', n, d ? `(${d})` : ''); } else { fail++; console.log('  FAIL ', n, d ? `(${d})` : ''); } };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addCookies([{ name: 'pa_demo', value: '1', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
const dialogs = [];
// message() is a METHOD. Pushing the bare property captured the function
// source, so the confirm check compared a regex against "message() { return
// this._initializer.message; }" and could never match anything.
page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });

// The case as the demo store actually holds it. Same reasoning as
// drive-charge: the demo replaces window.fetch outright, so asserting on the
// stored document is both the only option and the better test.
//
// TWO THINGS THIS GETS RIGHT that the obvious version gets wrong.
//
// `docs` is persisted as an ARRAY of [path, value] pairs, not an object
// (public/js/demo/store.js:94, `[...docs.entries()]`). Walking it with
// Object.entries yields "0", "1", "2" as the keys, so a path test never
// matches and the helper quietly answers null: every assertion below would
// then read `undefined`, and a drive that cannot see the case would report
// FAIL on a feature that worked, or worse, pass a check written the other way
// round.
//
// And the case is addressed by NAME. The seed holds a second case that is
// already on Full Access (public/js/demo/seed.js:353), so first-match-wins
// could answer with a case that was on the tier before this drive started,
// which is exactly the silent pass this drive exists to rule out.
const stored = () => page.evaluate(() => {
  const raw = localStorage.getItem('pa-demo-store');
  if (!raw) return null;
  try {
    const all = JSON.parse(raw);
    return new Map(all.docs || []).get('cases/demo-case') || null;
  } catch { return null; }
});

const openPanel = () => page.evaluate(() => {
  const d = [...document.querySelectorAll('details')].find((x) => /Open Hands-Off by hand/i.test(x.textContent || ''));
  if (d) d.open = true;
  return !!d;
});

await page.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

const before = await stored();
ok('the demo case starts OFF the tier, so this is a real opening',
   !!before && !before.fullAccess, before ? `fullAccess=${before.fullAccess}` : 'no case found');

ok('there is a panel to open it by hand', await openPanel());
await page.waitForTimeout(500);

// THE PREVIEW IS THE FEATURE. He asked "where do I change his amount paid
// (totaling 3400)", which is a question about a total, and the case fee is
// added to whatever he types. A control that hides that arithmetic is how a
// case that had been paid $175 came to claim $76.12/hr.
const typed = async (v) => {
  await page.evaluate((val) => {
    const el = document.getElementById('openfull-amt');
    el.value = val;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
  await page.waitForTimeout(250);
  return page.evaluate(() => document.getElementById('openfull-total')?.textContent.trim() || '');
};
const at0 = await typed('');
ok("with nothing typed it still says what the case shows", /\$1,200/.test(at0), at0);
const at3400 = await typed('3400');
ok('typing 3400 says the TOTAL out loud, case fee included',
   /\$4,600/.test(at3400), at3400);

// Refuse a fat finger, and change nothing.
await typed('999999999');
await page.evaluate(() => document.getElementById('openfull-go').click());
await page.waitForTimeout(600);
const refused = await page.evaluate(() => {
  const e = document.getElementById('openfull-err');
  return e && !e.hidden ? e.textContent.trim() : '';
});
ok('an impossible amount is refused before it is sent',
   /between \$0 and \$100,000/.test(refused), refused || '(sent it anyway)');
const midway = await stored();
ok('and the case is still off the tier', !!midway && !midway.fullAccess);

// THE START DATE. Eric, 2026-08-26: "I want to be prompted to set the clock or
// when the start time is. This one is going to be delayed slightly." Driven
// with a DELAYED start on purpose, because that is his actual case and because
// a start of "today" would pass whether the field worked or not.
const DAY = 14;
const startDay = await page.evaluate((d) => {
  const el = document.getElementById('openfull-start');
  if (!el) return null;
  const was = el.value;
  const t = new Date(`${was}T12:00:00-07:00`);
  t.setDate(t.getDate() + d);
  const next = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Etc/GMT+7', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(t);
  el.value = next;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { was, next };
}, DAY);
ok('there is a field for the day their month begins', !!startDay);
const todayMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Etc/GMT+7', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
ok('it is prefilled to today, so the common case is no taps',
   startDay?.was === todayMT, `${startDay?.was} vs ${todayMT}`);
const whenLine = await page.evaluate(() => document.getElementById('openfull-when')?.textContent.trim() || '');
ok('and it says the month it is about to create, both ends',
   /runs .+ to .+/.test(whenLine) && /forms go live today/.test(whenLine), whenLine.slice(0, 110));

// The real thing.
await typed('3400');
await page.evaluate(() => document.getElementById('openfull-go').click());
await page.waitForTimeout(2500);

const after = await stored();
ok('the case is on Hands-Off Case Management', !!after && after.fullAccess === true);
// fullAccessAt IS the window origin, so the delayed start has to land THERE.
ok('the month runs from the day he picked, not the day he pressed the button',
   String(after?.fullAccessAt || '').slice(0, 10) === startDay?.next,
   `stored ${String(after?.fullAccessAt || '').slice(0, 10)}, picked ${startDay?.next}`);
ok('and the day he pressed it is still on the record',
   !!after?.fullAccessOpenedAt
   && String(after.fullAccessOpenedAt).slice(0, 10) !== startDay?.next,
   String(after?.fullAccessOpenedAt || 'missing').slice(0, 10));
ok('month one of however many he takes', Number(after?.fullAccessMonths) === 1, `months=${after?.fullAccessMonths}`);
ok('what the case has paid is the case fee plus what he typed, to the cent',
   Number(after?.fullAccessRateCents) === 460000, `fullAccessRateCents=${after?.fullAccessRateCents}`);
const line = (after?.extraPayments || []).find((x) => x.kind === 'fullaccess');
ok('the ledger line says the money came in outside the app',
   !!line && line.byHand === true && Number(line.amountCents) === 340000,
   line ? JSON.stringify(line).slice(0, 90) : 'no ledger line');
ok('he was asked to confirm, with the total named',
   dialogs.some((d) => /\$4,600/.test(d)), dialogs.join(' | ').slice(0, 120));
ok('and the confirm named the start date too, not just the money',
   dialogs.some((d) => /Their month starts \w+ \d+/.test(d)),
   dialogs.join(' | ').slice(0, 160));

const said = await page.evaluate(() =>
  [...document.querySelectorAll('.saved-note')].map((n) => n.textContent.trim()).join(' | '));
ok('and the panel says so where he can still read it after it vanishes',
   /work log and the check-in booking are live/i.test(said), said.slice(0, 110));
ok('the panel itself is gone, because the case is on the tier now',
   !(await openPanel()));

// THE POINT OF ALL OF IT: the client's own page.
const client = await ctx.newPage();
// `&demo=1` is REQUIRED, not decoration. Loading the admin half sets the demo
// cookie to `admin` for the whole context, and with that cookie the client
// page does not mount the demo at all: it reaches for /js/firebase-real.js,
// fails, and sits on "Loading…" for ever. The query string wins over the
// cookie in demoRole (worker/index.js:636) and sets it back. Same browser, so
// the demo store is the one the admin half just wrote to.
await client.goto(`${P}/case.html?id=demo-case&demo=1`, { waitUntil: 'networkidle' });
// WAIT ON THE ELEMENT, not on a stopwatch. mountCaseLog is async and fetches
// the log before it repaints, so a fixed pause races it: at 3500ms the old
// version of this reported "(no panel)" on a page that renders correctly,
// which is a drive accusing working code. A timeout here is a real failure; a
// slow paint is not.
await client.waitForSelector('[data-worklog-panel]', { timeout: 20000 }).catch(() => {});
const seen = await client.evaluate(() => {
  const p = document.querySelector('[data-worklog-panel]');
  return {
    heading: p?.querySelector('h3')?.textContent.trim() || '',
    ready: !!p?.querySelector('[data-ready-list]'),
    // The offer is parked, so there must be no Sign button anywhere on the
    // client's page - and no empty permissions box either, because this demo
    // case has signed nothing.
    signButtons: document.querySelectorAll('[data-auth-add]').length,
    emptyPermissions: (document.querySelector('[data-auth-panel]')?.textContent || '').trim().length,
  };
});
// THE SENTENCE A FUTURE START BREAKS. It used to read "Your window started
// [date], the day you bought Hands-Off", which on a case opened today for a
// start two weeks out is false twice over, on the client's own page, about the
// thing they paid for.
const windowLine = await client.evaluate(() =>
  document.querySelector('[data-worklog-panel]')?.textContent.replace(/\s+/g, ' ') || '');
ok('the client is told their month STARTS, not that it already started',
   /Your month starts \w+ \d+/.test(windowLine) && !/window started/.test(windowLine),
   (windowLine.match(/Your (?:month|window) starte?s? [^.]*/) || ['(no window sentence)'])[0].slice(0, 110));
ok('and is told why getting it in early is still worth it',
   /records request can take weeks/.test(windowLine));

ok('the tier furniture reached the client\'s own page',
   seen.heading === 'What I have been doing', seen.heading || '(no panel)');
ok('and the readiness checklist is there with it', seen.ready === true);
// The parking, driven rather than grepped.
ok('nothing offers them a form to sign, because that is parked',
   seen.signButtons === 0, `${seen.signButtons} Sign buttons`);
ok('and a case that has signed nothing shows no empty permissions box',
   seen.emptyPermissions === 0, `${seen.emptyPermissions} chars of permissions panel`);

ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await b.close();
console.log(`\n${pass} ok, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
