// drive-nudge.mjs - moving an appointment without fighting the calendar.
//
//   PA_PORT=8901 node tools/drives/drive-nudge.mjs
//
// Eric, 2026-08-26: "Let me reschedule sessions without the scheduling blocks
// stopping me. That way I can reschedule for an hour later on the same day if
// I needed to."
//
// Three things stopped him and they compounded:
//   cleanupStaleSlots deleted every OPEN slot inside the 72h lead window every
//   15 minutes, including ones he had opened himself;
//   handleCreateSlots refused to open a slot inside that window at all;
//   so the reschedule dropdown had nothing sooner than three days out, and the
//   only way through was knowing the custom field existed and typing a date.
//
// This drives the one-tap path: read the appointment, tap +1 hour, and check
// the case really moved by exactly an hour AND that the client's own page
// shows the new time. The last part is the point: a reschedule he cannot see
// on their screen is not a reschedule.
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

await page.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Open the scheduling panel. It is a <details>.
await page.evaluate(() => {
  const d = [...document.querySelectorAll('details')].find((x) => /Schedule a session/i.test(x.textContent || ''));
  if (d) d.open = true;
});
await page.waitForTimeout(900);

const before = await page.evaluate(() => {
  const row = document.querySelector('[data-nudge-row]');
  return {
    hasRow: !!row,
    buttons: row ? [...row.querySelectorAll('[data-nudge]')].map((x) => x.textContent.trim()) : [],
    // Every button must be a real tap target at 390px.
    small: row ? [...row.querySelectorAll('[data-nudge]')]
      .filter((x) => x.getBoundingClientRect().height < 44).length : -1,
  };
});
ok('the move-it row is on the panel', before.hasRow);
ok('it offers the four shifts', before.buttons.join(' ') === '+1 hour +2 hours +1 day +1 week', before.buttons.join(' '));
ok('every button is a 44px tap target', before.small === 0, `${before.small} under 44px`);

const was = await page.evaluate(() => {
  for (const k of Object.keys(localStorage)) {
    const v = localStorage.getItem(k) || '';
    const m = v.match(/"appointment":\{[^}]*"start":"([^"]+)"/);
    if (m) return m[1];
  }
  return null;
});
ok('the case has an appointment to move', !!was, was || 'none found');

await page.evaluate(() => document.querySelector('[data-nudge="60"]')?.click());
await page.waitForTimeout(3500);

// The confirmation is rendered by the module-level say(), which survives the
// repaint load() does. A line written into the panel itself would be destroyed
// by that repaint, which is how this panel used to confirm and then delete its
// own confirmation.
const said = await page.evaluate(() => {
  const n = [...document.querySelectorAll('.saved-note')]
    .find((x) => /Moved to|Not moved|still shows the old time/i.test(x.textContent || ''));
  return n ? n.textContent.trim().slice(0, 140) : '(said nothing)';
});
ok('it confirms in words', /Moved to /.test(said), said);

const now = await page.evaluate(() => {
  for (const k of Object.keys(localStorage)) {
    const v = localStorage.getItem(k) || '';
    const m = v.match(/"appointment":\{[^}]*"start":"([^"]+)"/);
    if (m) return m[1];
  }
  return null;
});
// An hour later than PLANNED when the appointment is still ahead, an hour from
// NOW when it has already gone. The demo fixture's call is in the past, which
// is the missed-call case and the one he is most likely to be rescheduling.
const wasPast = was && new Date(was).getTime() < Date.now();
const target = wasPast ? Date.now() + 3600000 : new Date(was).getTime() + 3600000;
const driftMin = now ? Math.abs(new Date(now).getTime() - target) / 60000 : null;
ok(wasPast ? 'a missed call moves to an hour from now' : 'the case moves an hour later than planned',
   driftMin !== null && driftMin < 2, `${driftMin === null ? '?' : driftMin.toFixed(1)} minutes off target`);

// The half that matters: their screen.
await page.goto(`${P}/case.html?id=demo-case&demo=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const onClient = await page.evaluate((iso) => {
  const want = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Etc/GMT+7', hour: 'numeric', minute: '2-digit',
  }).format(new Date(iso)).replace(/ /g, ' ');
  const body = (document.body.innerText || '').replace(/ /g, ' ');
  return { want, shown: body.includes(want) };
}, now);
ok('and the CLIENT page shows the new time', onClient.shown, onClient.want);

ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

await b.close();
console.log(`\n${pass} ok, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
