// Everything the app asks the Worker for, answered locally.
//
// Two things this makes true. Signing up takes any letters he likes, because
// the auth calls never leave the browser - and so there is NO demo branch in
// the Worker at all, no magic code, no bypass in handleVerifyCode. And
// pressing Analyze produces the ten sections instantly from a fixture, so the
// panel can be driven without a single model call.
//
// UI, not AI: nothing in the demo calls a model.

import { DEMO_CASE_ID } from './seed.js';
// The Trade portal's arithmetic (2026-09-21): the same module the Worker uses, so the demo's numbers are the real numbers.
// PR 420 (2026-09-23) took the positions, the calculator, the stats and the scan off the desk, so two are left.
import { tradeMetrics, rulesOf, planFor, positionKey, screenTrades, scalePosition } from '../trade-math.js';
// The desk makes a PDF (2026-09-22): the same writer the Worker files with, so the demo's document is a real one.
import { textPdf } from '../textpdf.js';
// The same two vocabularies the pages read, so the demo cannot answer with a
// reaction the UI has no name for.
import { EMOJI_REACTIONS, STATUS_REACTIONS } from '../msg-actions.js';

/**
 * The document types a file can be FILED as, mirroring FILING_CATEGORIES in
 * worker/index.js, which in turn mirrors UPLOAD_CATEGORIES in admin-case.js.
 * All three are pinned equal by tools/suites/filing.mjs: a demo that accepted
 * a label the Worker refuses would show Eric a filing that cannot happen.
 */
const FILING_CATEGORIES = ['report', 'callsummary', 'visitfollowup',
  'apptsummary', 'formsent', 'formfilled'];

/** A little delay, so states that only exist while something is in flight
 *  (the button disabling, the progress bar, "Reading…") are visible. */
// The trade desk (2026-09-22): the eight categories the Worker keeps to the
// desk, its standing line in the Worker's words (trade-desk.js
// standingLine), and the block the panel gets on the desk's poll. Nothing
// here reads a market.
const TRADE_CATS = ['Setup', 'Indicator', 'Level', 'Order', 'Risk', 'Options', 'Market', 'Instrument'];
const deskMoney = (c) => `$${(Number(c || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const deskToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Boise' }).format(new Date());
const deskRows = (store, prefix) => [...store.docs.entries()].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => ({ id: k.slice(prefix.length), ...v }));
function deskStanding(store) {
  const s = store.docs.get('trade/settings') || {};
  const rows = deskRows(store, 'trade/balances/items/').map((b) => ({ date: b.date || b.id, cents: b.cents, note: b.note || '' }));
  const R = rulesOf(s);
  const m = tradeMetrics(rows, { startedAt: s.startedAt || null, startCents: Number.isInteger(s.startCents) && s.startCents > 0 ? s.startCents : 200000, target: R.dayAimPct / 100 });
  const text = m.days && m.entries.length
    ? `${deskMoney(m.currentCents)} · ${m.days} trading day${m.days === 1 ? '' : 's'} · ${Math.abs(m.offTargetPoints).toFixed(2)} pts ${m.offTargetCents < 0 ? 'under' : 'over'} ${Math.round(R.dayAimPct * 100) / 100}% a day`
    : `${deskMoney(m.currentCents)} · no entries yet`;
  return { text, at: new Date() };
}
function deskRefreshStanding(store) {
  const s = store.docs.get('trade/settings') || {};
  if (!s.caseId) return null;
  const st = deskStanding(store);
  const meta = store.docs.get(`caseMeta/${s.caseId}`) || {};
  store.docs.set(`caseMeta/${s.caseId}`, { ...meta, tradeStanding: st });
  return st;
}
// PR 420 (2026-09-23): the folder's panel gets nothing from the desk but the
// fact that it is the desk, as the Worker's tradePanelBlock.
function deskPanelBlock(store) {
  const s = store.docs.get('trade/settings') || {};
  return { caseId: s.caseId || null, pr420: true };
}

// The live prices the demo's cards read (2026-09-22; PR 420 added the names
// its runs file).
const DEMO_QUOTES = {
  NVDA: { ticker: 'NVDA', last: 651.2, chg: 2.8, chgPct: 0.43, open: 648.9, high: 653.8, low: 646.1, prevClose: 648.4 },
  SPY: { ticker: 'SPY', last: 574.1, chg: 1.2, chgPct: 0.21, open: 573.2, high: 575.4, low: 572.4, prevClose: 572.9 },
  TSLA: { ticker: 'TSLA', last: 409.8, chg: -2.3, chgPct: -0.56, open: 412.4, high: 413.1, low: 408.2, prevClose: 412.1 },
  AAPL: { ticker: 'AAPL', last: 232.6, chg: 1.5, chgPct: 0.65, open: 231, high: 233.2, low: 230.6, prevClose: 231.1 },
  AMD: { ticker: 'AMD', last: 168.4, chg: 1.1, chgPct: 0.66, open: 167.2, high: 169.1, low: 166.8, prevClose: 167.3 },
  QQQ: { ticker: 'QQQ', last: 498.3, chg: 1.9, chgPct: 0.38, open: 496.8, high: 498.9, low: 495.7, prevClose: 496.4 },
  MU: { ticker: 'MU', last: 118.9, chg: 6.2, chgPct: 5.5, open: 117.5, high: 119.6, low: 116.9, prevClose: 112.7 },
  SOFI: { ticker: 'SOFI', last: 15.62, chg: 0.31, chgPct: 2.02, open: 15.35, high: 15.7, low: 15.28, prevClose: 15.31 },
  PLTR: { ticker: 'PLTR', last: 41.35, chg: 0.82, chgPct: 2.02, open: 40.6, high: 41.5, low: 40.4, prevClose: 40.53 },
};
// THE NEWS PAGE'S FIXTURES (2026-09-22, the desk as one app). Eight headlines
// and three earnings chips, invented, in the shape the Worker's news route
// returns so the page cannot tell the difference.
const DEMO_NEWS = [
  { headline: 'Fed minutes show a split on the pace of cuts into year end', source: 'Reuters', mins: 41, related: ['SPY', 'QQQ'], summary: 'Several officials wanted to hold; the market is pricing one cut by December.' },
  { headline: 'Nvidia raises data center guidance at its developer conference', source: 'Bloomberg', mins: 130, related: ['NVDA'], summary: 'The guidance came at 07:00 Eastern and the stock gapped up at the open.' },
  { headline: 'Tesla third quarter deliveries land below the street estimate', source: 'CNBC', mins: 200, related: ['TSLA'], summary: 'Deliveries were 4% under consensus; the shares opened down and rejected the day average twice.' },
  { headline: 'AMD supply agreement reported ahead of the open', source: 'WSJ', mins: 260, related: ['AMD'], summary: 'A multi year supply deal reported before the bell; the base above the fifty day is holding.' },
  { headline: 'Oil slips for a third day as inventories build', source: 'Reuters', mins: 320, related: [], summary: '' },
  { headline: 'Ten year yield steady near 4.1% ahead of the auction', source: 'Bloomberg', mins: 410, related: [], summary: '' },
  { headline: 'Micron reports after the close, memory pricing in focus', source: 'MarketWatch', mins: 480, related: ['MU'], summary: '' },
  { headline: 'Retail sales revised higher for August', source: 'AP', mins: 900, related: [], summary: '' },
];
const DEMO_EARNINGS = [
  { symbol: 'MU', hour: 'bmo', epsEstimate: 1.12, epsActual: 1.26, revenueEstimate: 7700000000, revenueActual: 7900000000, quarter: 4, year: 2026 },
  { symbol: 'AMD', hour: 'bmo', epsEstimate: 0.92, epsActual: null, revenueEstimate: 6900000000, revenueActual: null, quarter: 3, year: 2026 },
  { symbol: 'NKE', hour: 'amc', epsEstimate: 0.7, epsActual: null, revenueEstimate: 12100000000, revenueActual: null, quarter: 1, year: 2027 },
];
const beat = (ms = 320) => new Promise((r) => setTimeout(r, ms));

const ok = (body) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});
/** The brief the demo hands a new personal case a few seconds after it opens
 *  (2026-09-05). Invented, in the shape the Worker's handover writes. */
const DEMO_BRIEF = `### Confirmed at close
Autoimmune encephalitis, relapse [55%].
### Timeline
- 2023: first episode, hospital, steroids then IVIG.
- 2025-03: second relapse, milder, steroids only.
- 2026-08-26: a cold. 2026-09-05: cognition down, right hand tremor back.
### Medications
- Prednisone 60 mg taper, 2023 and 2025: worked both times.
- IVIG, 2023: held for 18 months.
### Tests and results
- NMDA receptor antibody, 2023: positive, titre not recorded.
- MRI with contrast, 2025-03: normal.
### Treatments tried
- Steroids: fast response both times. IVIG: held longest.
### Ruled out
- Stroke: 2023 MRI clean.
### Still open
- Repeat antibody panel not yet drawn this relapse.
### Mechanistic causes and next treatments as they stood
- Causes: an antibody against a nerve cell receptor [50%]; a virus reactivating [20%].
- Treatments: a steroid course, then IVIG if it does not hold [45%]; rituximab [25%].`;

const fail = (status, error, extra = null) => ({
  ok: false,
  status,
  headers: { get: () => 'application/json' },
  json: async () => ({ error, ...(extra || {}) }),
  text: async () => JSON.stringify({ error, ...(extra || {}) }),
});

const SUMMARY = `## Key points
- She has called the practice twice for the March panel and not got through.
- The rheumatology referral was mentioned by the second doctor and never confirmed.
- She has been photographing the hand rash herself, which is the best evidence in the file.

## Progress
The script for the phone call went out and she said she would use it. Nothing
has come back yet.

## Loose ends
- The full March blood panel with reference ranges.
- Written confirmation the rheumatology referral was sent.
potentially forgot to or have not provided. Helpful, but optional.

## Where it stands
Waiting on paperwork she has to prise out of a practice that does not answer
the phone. The referral question is the one that changes the shape of the case.`;

// A plausible running total for the chat-hours meter, so the admin suite
// shows the number doing its job the moment the page opens. Demo only.
let demoChatSecs = 3 * 3600 + 40 * 60;
let demoEffort = 'high';

// What the study looks like after a few nights. Demo only.
const demoVoice = {
  enabled: true,
  lastRunAt: new Date(Date.now() - 13 * 3_600_000).toISOString(),
  runs: 6,
  lastError: null,
  hour: 22,
};

export function demoApi(role, store) {
  const real = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const path = url.startsWith('http') ? new URL(url).pathname : url.split('?')[0];
    if (!path.startsWith('/api/')) return real(input, init);

    const body = (() => {
      try { return init.body ? JSON.parse(init.body) : {}; } catch { return {}; }
    })();
    const q = new URLSearchParams((url.split('?')[1] || ''));

    // ---- signing in takes anything at all --------------------------------
    // "I'll use any series of letters to fill the email box/code box. No email
    // needs to be sent."
    if (path === '/api/auth/request-code') { await beat(); return ok({ ok: true }); }
    if (path === '/api/auth/verify-code') { await beat(); return ok({ token: 'demo', deviceToken: 'demo' }); }
    if (path === '/api/auth/device-signin') return ok({ token: 'demo' });
    if (path === '/api/admin/login' || path === '/api/admin/pin') return ok({ token: 'demo', deviceToken: 'demo' });
    if (path === '/api/admin/session') return ok({ ok: true });

    // ---- money, without any -----------------------------------------------
    // By the numbers: the shapes the approved mock used (2026-09-02). The
    // real page's figures come off the daily walk in the Worker.
    if (path === '/api/stats' || path === '/api/admin/stats') {
      const stats = {
        computedAt: new Date(Date.now() - 5 * 3600_000).toISOString(), since: 'July 2026', cases: 6,
        replies: 231, replyMedianMin: 3, withinHourPct: 84, floor: false, messages: 412,
        reportsOnTime: 4, reportsTotal: 4, hoursLogged: 61,
        milestones: { appointment: 4, referral: 3, authorization: 2, other: 0, total: 9 },
        logged: { call: 18, appeal: 3, investigation: 6, appointment: 4, other: 2, total: 33 },
      };
      return path === '/api/stats' ? ok(stats) : ok({ ok: true, stats });
    }
    if (path === '/api/rates') return ok({ caseCents: 120000, addonCents: 32500, subCents: 5000, fullCents: 440000, chatOpenCents: 5000, teleCents: 52500, fullHours: 20 });
    if (path === '/api/admin/rates') return ok({ caseCents: 120000, addonCents: 32500, subCents: 5000, fullCents: 440000, floorCents: 7500, bookings: 0, changed: false, teleCents: 52500, fullHours: 20, caps: { caseCents: 180000, addonCents: 42500, subCents: 10000, fullCents: 440000 } });
    // The nightly study, with a plausible history so the card on the dashboard
    // shows what it shows on a real night.
    if (path === '/api/work') {
      // Whichever case the caller named. Hardcoding the id meant every clock
      // on the shelf drove the same case's timer, which is exactly the thing
      // the shelf controls exist to avoid.
      const key = `cases/${body.caseId || DEMO_CASE_ID}`;
      const caseKey = body.caseId || DEMO_CASE_ID;
      const c = store.docs.get(key) || {};
      const w = c.work || { seconds: 0, startedAt: null };
      // Today's bucket, mirroring the Worker's CLOCK_DOC: any other day's
      // bucket reads empty, banking clips the stretch at his midnight.
      const dayString = () =>
        new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Boise' }).format(new Date());
      const dayBucket = () => {
        const t = (store.docs.get('admin/clock') || {}).today;
        return t && t.d === dayString() && t.byCase && typeof t.byCase === 'object'
          ? { ...t.byCase } : {};
      };
      const bankDay = (add) => {
        const byCase = dayBucket();
        const next = Math.max(0, (Number(byCase[caseKey]) || 0) + (Math.floor(add) || 0));
        if (next > 0) byCase[caseKey] = next; else delete byCase[caseKey];
        store.docs.set('admin/clock', {
          ...(store.docs.get('admin/clock') || {}),
          today: { d: dayString(), byCase },
        });
        store.persist?.();
        return next;
      };
      const daySecNow = () => {
        const p = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Boise', hour12: false,
          hour: 'numeric', minute: 'numeric', second: 'numeric',
        }).formatToParts(new Date());
        const g = (t) => Number(p.find((x) => x.type === t)?.value) || 0;
        return (g('hour') % 24) * 3600 + g('minute') * 60 + g('second');
      };
      const wMark = Math.max(0, Number(w.tierMark) || 0);
      // The tier mark, by hand, mirroring the Worker (Eric, 2026-08-29):
      // everything on the clock becomes the review side and the Full-Service
      // clock starts over. A running stretch banks by re-anchor.
      if (body.setTierMark !== undefined) {
        const st = w.startedAt ? new Date(w.startedAt).getTime() : 0;
        const str = st ? Math.max(0, Math.floor((Date.now() - st) / 1000)) : 0;
        const tot = Math.max(0, Number(w.seconds) || 0) + str;
        const mark = body.setTierMark === false ? 0 : tot;
        const anchored = body.setTierMark === false ? w : {
          ...w, seconds: tot, startedAt: st ? new Date() : null,
        };
        store.docs.set(key, { ...c, work: { ...anchored, tierMark: mark } });
        store.persist?.();
        if (str && body.setTierMark !== false) bankDay(Math.min(str, daySecNow()));
        return ok({
          seconds: body.setTierMark === false ? (Number(w.seconds) || 0) : tot,
          running: !!st, auto: w.auto === true,
          startedAt: anchored.startedAt || null, tierMark: mark,
          todaySeconds: dayBucket()[caseKey] || 0,
        });
      }
      // Correcting a total, mirroring the Worker: the only thing besides
      // start and stop that can move this number, and the answer to a clock
      // left running by mistake.
      if (body.setSeconds !== undefined) {
        const want = Number(body.setSeconds);
        if (!Number.isFinite(want) || want < 0 || want > 4000 * 3600)
          return fail(400, 'Give a whole number of seconds, zero or more.');
        const next = Math.floor(want);
        // Re-anchor a running clock, mirroring the Worker: the number the page
        // sends is what the page SHOWS, so leaving the start where it was
        // counts the running stretch twice and the correction reads as a no-op.
        const stillRunning = !!w.startedAt;
        const anchor = new Date();
        store.docs.set(key, {
          ...c,
          work: {
            ...w, seconds: next, startedAt: stillRunning ? anchor : null,
            correction: { from: w.seconds || 0, to: next, at: new Date() },
          },
        });
        store.persist?.();
        // Today moves with the total, mirroring the Worker: the stretch the
        // re-anchor just banked plus the adjustment itself, floored at zero.
        const cStretch = stillRunning
          ? Math.max(0, Math.floor((Date.now() - new Date(w.startedAt).getTime()) / 1000)) : 0;
        const todaySeconds = bankDay(
          (next - (w.seconds || 0) - cStretch) + Math.min(cStretch, daySecNow()));
        return ok({
          seconds: next, running: stillRunning, auto: w.auto === true,
          startedAt: stillRunning ? anchor : null, correctedFrom: w.seconds || 0,
          todaySeconds, tierMark: wMark,
        });
      }
      // The doing line (2026-09-03), mirroring the Worker: on its own while
      // the clock runs, on a start, gone on a stop.
      const doingIn = body.doing === undefined ? undefined
        : String(body.doing ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
      if (doingIn !== undefined && body.on === undefined) {
        if (!w.startedAt) return fail(409, 'Start the clock first.');
        store.docs.set(key, { ...c, work: { ...w, doing: doingIn || null } });
        store.persist?.(); store.fire?.(key);
        return ok({
          seconds: w.seconds || 0, running: true, auto: w.auto === true, startedAt: w.startedAt,
          tierMark: wMark, doing: doingIn || null, todaySeconds: dayBucket()[caseKey] || 0,
        });
      }
      // MANUAL ONLY, mirroring the Worker (Eric, 2026-08-25): an `auto`
      // start answers with the current truth and changes nothing.
      if (body.on === true && body.auto === true) {
        return ok({
          seconds: w.seconds || 0, running: !!w.startedAt,
          auto: w.auto === true, startedAt: w.startedAt || null,
          todaySeconds: dayBucket()[caseKey] || 0, tierMark: wMark,
        });
      }
      if (body.on === true) {
        const startedAt = w.startedAt ? new Date(w.startedAt) : new Date();
        store.docs.set(key, { ...c, work: { ...w, startedAt, auto: false, nudged: 0, doing: w.startedAt ? (w.doing || null) : (doingIn || null) } });
        store.persist?.(); store.fire?.(key);
        // The ORIGINAL start comes back, matching the Worker: a caller that
        // assumed "running now means started now" would paint a long stretch
        // as nothing.
        return ok({
          seconds: w.seconds || 0, running: true, auto: false, startedAt,
          todaySeconds: dayBucket()[caseKey] || 0, tierMark: wMark,
        });
      }
      // The real one can bank to the last beacon when he answers "no, I
      // finished a while ago". The demo never pushes, so that answer never
      // arrives here and the stop is always simply now.
      const started = w.startedAt ? new Date(w.startedAt).getTime() : 0;
      const add = started ? Math.floor((Date.now() - started) / 1000) : 0;
      const seconds = (Number(w.seconds) || 0) + add;
      // Spread first, like the Worker: a stop that rebuilds the object
      // would drop tierMark and merge the two tier clocks back together.
      store.docs.set(key, { ...c, work: { ...w, seconds, startedAt: null, auto: false, nudged: 0, doing: null } });
      store.persist?.(); store.fire?.(key);
      // The stretch banks into today too, clipped at his midnight like the
      // Worker does, so an overnight demo stretch cannot claim the morning.
      const todaySeconds = bankDay(Math.min(add, daySecNow()));
      return ok({ seconds, running: false, startedAt: null, bankedTo: null, todaySeconds, tierMark: wMark });
    }
    // The presence beacon. In the demo it stops an automatic stretch the same
    // way the Worker does, so walking from a chart back to the shelf behaves
    // the way it will in the real app rather than leaving a clock on.
    if (path === '/api/work/here') {
      // The beacon stops NOTHING (Eric, 2026-08-25: "no automatic
      // start/stops"). It used to end any `auto` stretch on a case he was not
      // looking at, mirroring a Worker branch that is now gone. A forgotten
      // clock is answered by the hourly reminder and the correction control,
      // both of which leave the number in his hands.
      //
      // What it DOES carry, like the real one: today's per-case hours, from
      // the same bucket /api/work banks into. Any other day's bucket is
      // presented empty rather than rolled by a job.
      const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Boise' }).format(new Date());
      const t = (store.docs.get('admin/clock') || {}).today;
      const byCase = t && t.d === d && t.byCase && typeof t.byCase === 'object' ? t.byCase : {};
      return ok({ ok: true, day: { d, byCase } });
    }
    // Shutting the books. Backed by the same settings document the booking
    // page reads, so closing here really does empty the calendar in the demo.
    if (path === '/api/admin/booking-closure') {
      const key = 'settings/booking';
      if (init.method === 'POST') {
        const weeks = Number(body.weeks);
        if (!Number.isFinite(weeks) || weeks < 0 || weeks > 26)
          return fail(400, 'Pick between 0 and 26 weeks.');
        const mst = new Date(Date.now() - 7 * 3600_000);
        const midnight = Date.UTC(mst.getUTCFullYear(), mst.getUTCMonth(), mst.getUTCDate() + 1)
          + 7 * 3600_000;
        const until = weeks === 0 ? null : new Date(midnight + weeks * 7 * 86_400_000);
        store.docs.set(key, { closedUntil: until, setByHand: true });
        store.persist?.();
      }
      const raw = store.docs.get(key)?.closedUntil;
      const t = raw ? new Date(raw).getTime() : 0;
      const live = Number.isFinite(t) && t > Date.now() ? t : 0;
      const when = live && new Intl.DateTimeFormat('en-US', {
        timeZone: 'Etc/GMT+7', weekday: 'long', month: 'long', day: 'numeric',
      }).format(new Date(live));
      return ok({
        closedUntil: live ? new Date(live) : null,
        message: live ? `I am not taking new cases until ${when}. Existing clients are unaffected.` : null,
      });
    }
    // How many Full-Service cases at once. Backed by the same config document the
    // Worker reads, so a limit set here really does change what the demo's
    // approval prompt says, and 0 really does mean no limit on the way back.
    if (path === '/api/admin/full-capacity') {
      const key = 'config/fullAccess';
      if (init.method === 'POST') {
        const want = typeof body.maxOpen === 'number' ? body.maxOpen : NaN;
        if (!Number.isInteger(want) || want < 0 || want > 99)
          return fail(400, 'Pick a whole number from 1 to 99, or no limit.');
        store.docs.set(key, { maxOpen: want, setByHand: true });
        store.persist?.();
      }
      const cfg = store.docs.get(key);
      const chosen = cfg?.setByHand === true ? Number(cfg.maxOpen) : NaN;
      const max = Number.isInteger(chosen) && chosen >= 0 && chosen <= 99 ? chosen : 2;
      const open = [...store.docs.entries()]
        .filter(([k, v]) => /^cases\/[^/]+$/.test(k) && v?.fullAccess && v.status !== 'closed')
        .length;
      const room = max === 0 || open < max;
      return ok({
        open,
        max,
        room,
        counted: true,
        message: max === 0 ? `${open} open, no limit set.` : `${open} of ${max} open.`,
      });
    }
    // IN OFFICE / OUT OF OFFICE, both halves, off one document, so flipping the
    // switch on the demo shelf really does change the pill on the demo case
    // page.
    //
    // THE SCHEDULE IS REIMPLEMENTED HERE and that is worth naming out loud: it
    // is the one thing in the demo that is a copy rather than the real code,
    // because the real one lives in the Worker and the demo never reaches a
    // Worker. It is a copy of the RULE, not of the hours - the hours are read
    // off the same OPEN/CLOSE numbers the availability editor above uses. A
    // suite check pins the two together so this cannot quietly drift; if it
    // ever does, the demo is what is wrong.
    //
    // The zone is Eric's own, America/Boise, and NOT the fixed offset the
    // booking calendar above is anchored to. Same reason the real one changed:
    // the light answers what time it is where he is standing.
    // Bulk slot clearing (Eric, 2026-08-30): same fence as the Worker, only
    // docs that are open right now go.
    // The free 15-minute call (2026-09-01). Mirrors handleFitCall: the same
    // refusals in the same order, the slot taken with only a leadId on it,
    // the person written to leads/ where no client page looks. A demo that
    // waved a bad form through would show him a door the Worker keeps shut.
    if (path === '/api/fit-call' && init.method === 'POST') {
      if (typeof body?.website === 'string' && body.website.trim()) return ok({ ok: true });
      const name = String(body?.name || '').trim();
      const email = String(body?.email || '').trim().toLowerCase();
      const phone = String(body?.phone || '').trim();
      if (name.length < 2) return fail(400, 'Your name, please.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
        return fail(400, 'A working email address, please. The details of the call go there.');
      if (!['phone', 'video'].includes(body?.method)) return fail(400, 'Phone or video?');
      if (body.method === 'phone' && !/^\+?[\d\s().-]{7,20}$/.test(phone))
        return fail(400, 'A valid phone number is required for a phone call.');
      if (body.us !== true) return fail(400, 'I can only work with people in the United States and Canada.');
      const key = `availability/${body.slotId || ''}`;
      const slot = store.docs.get(key);
      if (!slot || slot.kind !== 'fit' || slot.state !== 'open')
        return fail(409, 'That time is no longer available.');
      const taken = [...store.docs.entries()].some(([k, v]) => k.startsWith('leads/')
        && v.email === email && v.state === 'booked' && new Date(v.start) > new Date());
      if (taken) return fail(409, 'You already have a call booked with me. The time is in your email.');
      await beat(500);
      const leadId = `lead-${Date.now()}`;
      store.docs.set(key, { ...slot, state: 'booked', leadId });
      store.docs.set(`leads/${leadId}`, {
        name, email, phone: body.method === 'phone' ? phone : '', method: body.method,
        note: String(body.note || '').trim().slice(0, 280), tz: body.tz || '',
        slotId: body.slotId, start: new Date(slot.start), durationMin: 15,
        state: 'booked', joinLink: null, createdAt: new Date(),
      });
      store.fire?.(key);
      return ok({ ok: true, leadId, start: slot.start });
    }
    if (path === '/api/admin/fit-calls') {
      if (role !== 'admin') return fail(404, 'Not found');
      const leads = [...store.docs.entries()].filter(([k]) => k.startsWith('leads/'))
        .map(([k, v]) => ({ id: k.slice(6), ...v }));
      if (init.method !== 'POST') {
        const since = Date.now() - 14 * 86_400_000;
        return ok({ calls: leads.filter((l) => new Date(l.start).getTime() > since)
          .sort((a, b) => new Date(a.start) - new Date(b.start)) });
      }
      const k = `leads/${body?.leadId || ''}`;
      const l = store.docs.get(k);
      if (!l) return fail(404, 'No such call');
      const now = new Date();
      if (body.action === 'join-link') {
        const joinLink = String(body.joinLink || '').trim();
        if (!/^https:\/\/\S+$/.test(joinLink)) return fail(400, 'Paste a full https link.');
        store.docs.set(k, { ...l, joinLink, joinLinkAt: now });
      } else if (body.action === 'done' || body.action === 'no-show') {
        store.docs.set(k, { ...l, state: body.action, endedAt: now });
      } else if (body.action === 'cancel') {
        if (l.state !== 'booked') return fail(409, 'That call is not booked.');
        store.docs.set(k, { ...l, state: 'canceled', endedAt: now });
        const sk = `availability/${l.slotId}`;
        const slot = store.docs.get(sk);
        if (slot && slot.leadId === body.leadId && new Date(l.start) > now)
          store.docs.set(sk, { ...slot, state: 'open', leadId: null });
        store.fire?.(sk);
      } else return fail(400, 'Bad action');
      store.fire?.(k);
      return ok({ ok: true });
    }
    if (path === '/api/admin/slots-clear' && init.method === 'POST') {
      const ids = Array.isArray(body.ids) ? body.ids : [];
      let deleted = 0;
      for (const id of ids) {
        const k = `availability/${id}`;
        const slot = store.docs.get(k);
        if (slot && slot.state === 'open') { store.docs.delete(k); deleted++; }
      }
      return ok({ deleted, refused: ids.length - deleted });
    }
    if (path === '/api/availability' || path === '/api/admin/office-hours') {
      const key = 'config/officeHours';
      if (path === '/api/admin/office-hours' && init.method === 'POST') {
        const want = body.manual;
        if (want !== 'in' && want !== 'out' && want !== null && want !== undefined)
          return fail(400, "Set 'in', 'out', or null to follow the schedule.");
        const cur = store.docs.get(key) || {};
        const next = { ...cur, setByHand: true, setAt: new Date() };
        if (want !== undefined) next.manual = want ?? null;
        if (body.responseTime !== undefined) {
          const typed = String(body.responseTime ?? '').trim();
          next.responseTime = typed ? typed.slice(0, 160) : null;
        }
        store.docs.set(key, next);
        store.persist?.();
      }
      const raw = store.docs.get(key) || {};
      const manual = raw.manual === 'in' || raw.manual === 'out' ? raw.manual : null;
      const typed = typeof raw.responseTime === 'string' ? raw.responseTime.trim() : '';
      const responseTime = typed ? typed.slice(0, 160) : null;
      const now = new Date();
      const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Boise', weekday: 'short' }).format(now);
      const p = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Boise', hour: 'numeric', minute: 'numeric', hour12: false,
      }).formatToParts(now);
      const num = (t) => Number(p.find((x) => x.type === t).value);
      const mins = (num('hour') % 24) * 60 + num('minute');
      // Friday joined the weekend, mirroring the Worker (Eric, 2026-08-29:
      // "we're now doing Fri-Sun out of office").
      const scheduled = wd !== 'Fri' && wd !== 'Sat' && wd !== 'Sun' && mins >= 8 * 60 && mins < 19 * 60;
      const inOffice = manual ? manual === 'in' : scheduled;
      // No `by` on the public answer, and the demo mirrors that: whether the
      // clock or his hand decided it is not a stranger's business. See the
      // comment on handleAvailability in worker/index.js.
      if (path === '/api/availability')
        return ok({ inOffice, responseTime });
      return ok({
        inOffice, scheduled, manual, responseTime,
        overriding: !!manual && inOffice !== scheduled,
      });
    }
    // Pausing a case and closing one, mirrored so both are drivable in the
    // demo rather than dead buttons.
    // THE SHIM USED TO FALL THROUGH TO ok({ ok: true }) HERE, writing nothing.
    // That is the route behind "I put meeting link in but it didn't visually
    // confirm that it saved" (Eric, 2026-08-26). The fix for that re-reads the
    // case and only claims the client can see the link once the case really
    // holds it - so against a route that accepts and does not write, the fix
    // correctly reports failure, and the demo could not show him it working.
    // Mirrors handleCaseUpdate in worker/index.js.
    // A family case (2026-09-03), mirroring the Worker: free, chat open from
    // the first day, the typed email as the login, waiting for its uid.
    if (path === '/api/admin/family-case') {
      await beat(300);
      const email = String(body.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, 'The email they will sign in with, please.');
      const name = [body.firstName, body.lastName].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
      if (!name) return fail(400, 'Their name, please.');
      // An address that already owns a case here is refused once and needs
      // his confirmation (audit, 2026-09-03). Mirrors handleFamilyCase.
      const owned = [...store.docs.entries()].some(([k, d]) => /^cases\/[^/]+$/.test(k) && d?.clientEmail === email);
      if (owned && body.confirmExisting !== true) {
        const error = 'That address already belongs to a client with a case here. If it really is them, confirm below.';
        return { ...fail(409, error), json: async () => ({ error, existing: true }), text: async () => JSON.stringify({ error, existing: true }) };
      }
      const id = `demo-case-family-${Math.random().toString(36).slice(2, 6)}`;
      const now = new Date();
      store.docs.set(`cases/${id}`, {
        family: true,
        familyRelation: String(body.relation || '').trim().slice(0, 40) || null,
        clientUid: null,
        clientEmail: email,
        clientName: name,
        clientDob: String(body.dob || '') || null,
        clientTz: 'America/Boise',
        clientPhone: String(body.phone || '').trim().slice(0, 40) || null,
        clientAddress: String(body.address || '').trim().slice(0, 300) || null,
        status: 'confirmed',
        createdAt: now,
        bookingEmailSentAt: now,
        appointment: null,
        publicElection: { choice: 'private', history: [{ choice: 'private', at: now }] },
        addOnFollowUp: false,
        forms: {},
        files: [],
        reportDueAt: null,
        caseRateCents: 0,
        addonRateCents: 0,
        fullAccess: false,
        fullAccessAt: null,
        fullAccessRateCents: null,
        stripe: null,
        work: { seconds: 0, startedAt: null },
        hold: null,
        chatUnlocked: true,
        chatUnlockedAt: now,
        chatOpenNotified: true,
      });
      store.persist?.();
      store.fire?.(`cases/${id}`);
      return ok({ ok: true, id, claimed: false });
    }

    // His own case (2026-09-03), mirroring the Worker: one per admin, the
    // same shape as every other case with self on, nobody on the other end.
    if (path === '/api/admin/self-case' || path === '/api/admin/self-case/next') {
      await beat(300);
      // MORE THAN ONE, IN SEQUENCE (2026-09-05). The first is demo-case-mine,
      // the next demo-case-mine-2, and so on. /next closes the case named
      // with its top diagnosis confirmed and opens the next one from it; the
      // plain route opens one that pulls from the cases ticked. Either way an
      // invented brief lands on the new case a few seconds later, the way
      // the Worker's drain would write a real one.
      const base = 'cases/demo-case-mine';
      const own = [...store.docs.entries()].filter(([k, v]) => /^cases\/[^/]+$/.test(k) && v?.self && !v?.trade);
      const now = new Date();
      const s = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
      let sources = [];
      let who = {
        name: [s(body.firstName, 60), s(body.lastName, 60)].filter(Boolean).join(' '),
        dob: s(body.dob, 10) || null, phone: s(body.phone, 40) || null, address: s(body.address, 300) || null,
      };
      if (path.endsWith('/next')) {
        const oldKey = `cases/${body.caseId}`;
        const old = store.docs.get(oldKey);
        if (!old?.self) return fail(409, 'Only your own case continues into a next one.');
        if (old.trade) return fail(409, 'The trade desk does not continue into a next case. Close it or delete it.');
        if (old.status === 'closed') return fail(409, 'That case is already closed.');
        const st = store.docs.get(`${oldKey}/advisor/state`) || {};
        const top = (st.differential || [])[0];
        const name = s(body.confirmedDx, 120) || top?.name || '';
        if (!name) return fail(400, 'Name the diagnosis to confirm, or run a read first.');
        const confirmedDx = { name, pct: top && top.name === name ? top.pct : null, at: now };
        store.docs.set(oldKey, {
          ...old, confirmedDx, status: 'closed', closedAt: now, closedBy: 'advocate',
          closedReason: 'Continued in the next case.',
        });
        sources = [[oldKey, store.docs.get(oldKey)]];
        who = { name: old.clientName, dob: old.clientDob || null, phone: old.clientPhone || null, address: old.clientAddress || null };
      } else {
        for (const pid of (Array.isArray(body.pullFrom) ? body.pullFrom : [])) {
          const c = store.docs.get(`cases/${pid}`);
          if (!c?.self) return fail(400, 'One of the cases to pull from is not one of your own.');
          if (c.trade) return fail(400, 'The trade desk cannot be pulled from.');
          sources.push([`cases/${pid}`, c]);
        }
        const newest = sources[0]?.[1];
        if (!who.name && newest) who = { name: newest.clientName, dob: newest.clientDob || null, phone: newest.clientPhone || null, address: newest.clientAddress || null };
        if (!who.name) who.name = 'Eric Bleach';
      }
      const key = own.length ? `${base}-${own.length + 1}` : base;
      const id = key.slice(6);
      const priorCases = sources.map(([k]) => k.slice(6));
      const carriedDx = [];
      for (const [k, c] of sources) {
        for (const d of (Array.isArray(c.carriedDx) ? c.carriedDx : [])) carriedDx.push(d);
        if (c.confirmedDx?.name) carriedDx.push({ ...c.confirmedDx, fromCase: k.slice(6) });
      }
      store.docs.set(key, {
        self: true,
        clientUid: null,
        clientEmail: null,
        clientName: who.name,
        clientDob: who.dob,
        clientTz: 'America/Boise',
        clientPhone: who.phone,
        clientAddress: who.address,
        status: 'confirmed',
        createdAt: now,
        bookingEmailSentAt: now,
        appointment: null,
        publicElection: { choice: 'private', history: [{ choice: 'private', at: now }] },
        addOnFollowUp: false,
        forms: {},
        files: [],
        reportDueAt: null,
        caseRateCents: 0,
        addonRateCents: 0,
        fullAccess: true,
        fullAccessAt: now,
        fullAccessRateCents: 0,
        fullAccessMonths: 0,
        fullAccessByHand: true,
        stripe: null,
        work: { seconds: 0, startedAt: null },
        hold: null,
        priorCases,
        carriedDx,
      });
      if (path.endsWith('/next')) {
        const oldKey = `cases/${body.caseId}`;
        store.docs.set(oldKey, { ...store.docs.get(oldKey), continuedIn: id });
      }
      // The brief lands on the next state read a few seconds from now (the
      // state route below writes it), the way the Worker's drain would. A
      // timer would die with this page when it walks into the new case.
      const handoverPending = sources.map(([k, c]) => ({
        fromCase: k.slice(6), openedAt: c.createdAt || now, closedAt: c.closedAt || null,
        confirmedDx: c.confirmedDx?.name ? { name: c.confirmedDx.name, pct: c.confirmedDx.pct ?? null } : null,
      }));
      // The 🧬 page on his own case carries two lists under the differential
      // (2026-09-05): underlying major mechanistic causes and the likely best
      // next treatments. Invented rows so the page has something to paint
      // before the demo's read runs; the read keeps them.
      store.docs.set(`${key}/advisor/state`, {
        status: 'idle', updatedAt: now,
        priorCases, carriedDx, handovers: [],
        handoverStatus: priorCases.length ? 'running' : null,
        handoverPending, handoverQueuedAt: now,
        workingDx: 'Autoimmune encephalitis, early relapse',
        differential: [
          { name: 'Autoimmune encephalitis, relapse', pct: 55, why: 'Same order as 2023 and 2025: cognition first, then the tremor, then sleep.', moves: 'A repeat antibody panel and an MRI with contrast.' },
          { name: 'Post-viral flare', pct: 20, why: 'Started ten days after the cold.', moves: 'Whether the fever comes back.' },
        ],
        causes: [
          { name: 'An antibody against a nerve cell receptor', pct: 50, why: 'An antibody attacking receptors on nerve cells is the mechanism the earlier episodes followed.', moves: 'The repeat antibody panel.' },
          { name: 'A virus reactivating', pct: 20, why: 'Fits the timing after the cold.', moves: 'A viral panel, and whether the fever returns.' },
        ],
        treatments: [
          { name: 'A steroid course, then IVIG if it does not hold', pct: 45, why: 'What worked in 2023, and the fastest test of the read.', moves: 'How the first week on it goes.' },
          { name: 'Rituximab', pct: 25, why: 'The next step if this is the third relapse in two years.', moves: 'The antibody result.' },
        ],
      });
      store.persist?.();
      store.fire?.(key);
      return ok({ ok: true, id, created: true });
    }

    if (path === '/api/admin/case-update') {
      const key = `cases/${body.caseId || DEMO_CASE_ID}`;
      const c = store.docs.get(key);
      if (!c) return fail(404, 'No such case');
      const now = new Date();
      if (body.action === 'join-link') {
        const link = typeof body.joinLink === 'string' ? body.joinLink : '';
        if (link.length > 500) return fail(400, 'Bad link');
        store.docs.set(key, {
          ...c,
          appointment: { ...(c.appointment || {}), joinLink: link || null },
        });
      } else if (body.action === 'details') {
        // Who the case is for, by his hand (2026-09-03), mirroring the
        // Worker: only his own case and a family case take typed details.
        if (!c.self && !c.family) return fail(409, 'Only your own case and a family case take typed details.');
        const name = String(body.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
        if (!name) return fail(400, 'A name, please.');
        store.docs.set(key, {
          ...c,
          clientName: name,
          clientDob: String(body.dob || '') || null,
          clientPhone: String(body.phone || '').trim().slice(0, 40) || null,
          clientAddress: String(body.address || '').trim().slice(0, 300) || null,
        });
        store.persist?.();
        store.fire?.(key);
        return ok({ ok: true, name });
      } else if (body.action === 'contact') {
        // The client's phone and home address, by his hand (2026-09-03),
        // mirroring the Worker: the same number rule, the same lengths, an
        // empty field clears the value.
        const phone = String(body.phone || '').replace(/\s+/g, ' ').trim().slice(0, 40);
        if (phone && !/^\+?[\d\s().-]{7,20}$/.test(phone))
          return fail(400, 'That does not look like a phone number.');
        const address = String(body.address || '').replace(/\s+/g, ' ').trim().slice(0, 300);
        store.docs.set(key, { ...c, clientPhone: phone || null, clientAddress: address || null });
        store.persist?.();
        store.fire?.(key);
        return ok({ ok: true, phone: phone || null, address: address || null });
      } else if (body.action === 'recording-uploaded') {
        if (c.status === 'closed') return fail(409, 'Case is closed.');
        const next = { ...c, reportDueAt: new Date(now.getTime() + 7 * 86400000) };
        // Delivered stays delivered: a second recording on a finished case
        // restarts the clock without undoing the delivery, same as the Worker.
        if (c.status !== 'delivered') next.status = 'awaiting_report';
        store.docs.set(key, next);
      } else if (body.action === 'summary-uploaded') {
        // A document he wrote, filed on the case under its own label. The
        // Worker's rules, mirrored: the case does NOT move, the label comes
        // from a map here rather than from the caller, and an unknown one is
        // refused. Where this shim has ever been kinder than the Worker it has
        // hidden a real refusal.
        if (c.status === 'closed') return fail(409, 'Case is closed.');
        const kinds = {
          callsummary: 'call summary', visitfollowup: 'visit follow-up',
          apptsummary: 'appointment summary',
          formsent: 'form to fill in', formfilled: 'filled form',
        };
        if (!kinds[body.category]) return fail(400, 'That is not a document type I know.');
        return ok({ ok: true, category: body.category, notified: true });
      } else if (body.action === 'report-uploaded') {
        if (c.status === 'closed') return fail(409, 'Case is closed.');
        store.docs.set(key, { ...c, status: 'delivered', reportDeliveredAt: now });
      } else if (body.action === 'set-paid') {
        // Missing entirely until now, which is how a demo can agree with a
        // Worker that was itself throwing: neither one recorded anything.
        const cents = Math.round(Number(body.paidCents));
        if (!Number.isFinite(cents) || cents <= 0 || cents > 100000 * 100)
          return fail(400, 'Give an amount between $1 and $100,000.');
        // The figure it displaces comes back the way the Worker sends it, so
        // the control says the same sentence on both sides of the mirror.
        const priorCents = Number(c.paidOverrideCents) > 0 ? Math.round(Number(c.paidOverrideCents)) : 0;
        store.docs.set(key, { ...c, paidOverrideCents: cents, paidOverrideAt: now });
        return ok({ ok: true, correctedFrom: priorCents, by: body.by === 'advisor' ? 'advisor' : 'eric' });
      } else if (body.action === 'forms-on-file') {
        // The Forms submitted tick, mirrored from the Worker (2026-08-29):
        // his record that the signed forms are back, untickable on purpose.
        store.docs.set(key, { ...c, formsOnFileAt: body.on === true ? new Date() : null });
      } else if (body.action === 'open-full') {
        // The tier, opened by hand. Same rules as the Worker, so the demo
        // cannot show a case the live app would refuse to make.
        if (c.fullAccess) return fail(409, 'This case is already on Full-Service Case Management.');
        if (c.status === 'closed') return fail(409, 'Case is closed.');
        const tier = Math.round(Number(body.tierCents));
        if (!Number.isFinite(tier) || tier < 0 || tier > 100000 * 100)
          return fail(400, 'Give an amount between $0 and $100,000.');
        // The month can begin later than the day it is arranged. fullAccessAt
        // IS the start: it is what fullAccessWindowEnd and both its mirrors
        // read as the window's origin.
        let startAt = now;
        if (body.startAt) {
          const t = new Date(body.startAt);
          if (Number.isNaN(t.getTime())) return fail(400, 'That start date did not make sense.');
          if (Math.abs(t.getTime() - now.getTime()) > 365 * 86400000)
            return fail(400, 'Pick a start date within a year either side of today.');
          startAt = t;
        }
        const paidForCase = Number(c.caseRateCents) > 0
          ? Number(c.caseRateCents) : (Number(c.stripe?.amountTotal) || 0);
        const payments = Array.isArray(c.extraPayments) ? [...c.extraPayments] : [];
        if (tier > 0) {
          payments.push({
            kind: 'fullaccess', amountCents: tier, at: now, byHand: true,
            label: 'Full-Service Case Management, paid outside the app',
          });
        }
        store.docs.set(key, {
          ...c,
          fullAccess: true,
          fullAccessAt: startAt,
          fullAccessOpenedAt: now,
          fullAccessRateCents: paidForCase + tier,
          fullAccessMonths: 1,
          fullAccessByHand: true,
          pendingFullAccess: null,
          fullAccessRequest: c.fullAccessRequest
            ? { ...c.fullAccessRequest, state: 'started', startedAt: now } : null,
          extraPayments: payments,
        });
      } else {
        return fail(400, 'Bad request');
      }
      store.persist?.();
      store.fire?.(key);
      return ok({ ok: true });
    }

    // THE SHOWCASE and DELETE (2026-09-06). The demo's Joe Bloe is a sketch
    // of the Worker's: the same man, a few of the fifty messages, no files.
    if (path === '/api/admin/showcase-case') {
      await beat(300);
      const key = 'cases/demo-case-showcase';
      if (store.docs.get(key)) return ok({ ok: true, id: 'demo-case-showcase', existing: true });
      const now = Date.now();
      const ago = (days, h = 9) => { const t = new Date(now - days * 86400000); t.setUTCHours(h + 7, 0, 0, 0); return t; };
      store.docs.set(key, {
        showcase: true, clientUid: null, clientEmail: 'joe.bloe@example.com',
        clientName: 'Joe Bloe', clientDob: '1979-04-12', clientTz: 'America/Boise',
        clientPhone: '+1 208 555 0147', clientAddress: '1188 Juniper Ridge Rd, Nampa, ID 83686',
        status: 'delivered', createdAt: ago(22, 16), bookingEmailSentAt: ago(22, 16),
        appointment: { start: ago(14, 10), durationMin: 60, method: 'video', phone: null, joinLink: null, requested: false },
        publicElection: { choice: 'private', history: [{ choice: 'private', at: ago(22, 16) }] },
        addOnFollowUp: false, forms: {}, files: [],
        reportDueAt: ago(7, 17), reportDeliveredAt: ago(7, 12),
        caseRateCents: 120000, addonRateCents: 32500,
        fullAccess: true, fullAccessAt: ago(10), fullAccessRateCents: 440000, fullAccessMonths: 1, fullAccessByHand: true,
        stripe: null, work: { seconds: 24000, startedAt: null, tierMark: 3600 }, hold: null,
        chatUnlocked: true, chatOpenNotified: true,
      });
      const lines = [
        ['client', 20, 'Hi Eric. Thanks for taking this on. Quick version: five months of headaches, a blind spot in my right eye that comes and goes, and my left ear went muffled three weeks ago. Two doctors said migraine and stress. I do not buy it.'],
        ['admin', 20, 'Good. I do not buy it either, not yet. Three things, in order: what happened first, what has been tested, and who has seen you. Start with the first symptom and the date.'],
        ['client', 15, 'MRI report from the portal.'],
        ['admin', 15, 'This is the most useful thing so far. The report describes small lesions in the middle of the corpus callosum (the bridge between the two halves of the brain). That location is not typical for migraine.'],
        ['client', 2, 'Dye test done. The doctor said there were several blocked small artery branches in the right eye and one in the left I did not even know about. She used the word Susac.'],
        ['admin', 2, 'Yes. Susac syndrome. Brain, eye, ear, all three, and it is treatable. This is not a diagnosis from me, it is from her, and she is the right person to make it.'],
      ];
      lines.forEach(([role, days, text], i) => store.docs.set(`${key}/chat/s${i}`, {
        from: role === 'admin' ? 'demo-admin' : 'showcase-joe-bloe', role, text, ts: ago(days, 9 + i),
      }));
      store.persist?.();
      store.fire?.(key);
      return ok({ ok: true, id: 'demo-case-showcase', existing: false });
    }
    if (path === '/api/admin/delete-case') {
      await beat(300);
      const id = String(body.caseId || '');
      const c = store.docs.get(`cases/${id}`);
      if (!c) return ok({ ok: true, gone: true });
      if (c.clientUid || !(c.self || c.showcase))
        return fail(409, 'Only a case with nobody real behind it can be deleted: your own, or the showcase. A client\'s case is closed, never deleted.');
      let docs = 0;
      for (const k of [...store.docs.keys()]) {
        if (k === `cases/${id}` || k.startsWith(`cases/${id}/`) || k === `caseMeta/${id}`) { store.docs.delete(k); docs++; }
      }
      // The trade desk (2026-09-22): a deleted desk leaves the settings
      // pointing at nothing, so the shelf's door comes back.
      const ts = store.docs.get('trade/settings');
      if (ts?.caseId === id) store.docs.set('trade/settings', { ...ts, caseId: null });
      store.persist?.();
      return ok({ ok: true, docs, files: 0 });
    }
    // THE APPROVAL SCREEN (2026-09-06): approve at the amount he set, zero
    // included, or decline with his reason. No Stripe here, so the capture
    // and the release are the record alone, shaped as the Worker shapes it.
    if (path === '/api/admin/case-charge') {
      const key = `cases/${body.caseId || DEMO_CASE_ID}`;
      const c = store.docs.get(key);
      const ch = c?.charge;
      if (!c) return fail(404, 'Not found');
      if (!ch || !['held', 'lapsed', 'invoiced'].includes(ch.state)) return fail(409, 'This case has no held payment to decide.');
      const now = new Date();
      if (body.decision === 'decline') {
        const reason = String(body.reason || '').trim().slice(0, 500);
        if (!reason) return fail(400, 'Write the reason. The client reads it word for word.');
        store.docs.set(key, {
          ...c, status: 'closed', closedAt: now, closedBy: 'advocate', closedReason: reason,
          charge: { ...ch, state: 'declined', decidedAt: now, releasedAt: now, reason },
        });
        store.persist?.(); store.fire?.(key);
        return ok({ ok: true, charge: store.docs.get(key).charge });
      }
      if (body.decision !== 'approve') return fail(400, 'Bad request');
      const cap = Number(ch.authorizedCents) || 0;
      const amount = body.amountCents === undefined || body.amountCents === null ? cap : Number(body.amountCents);
      if (!Number.isInteger(amount) || amount < 0) return fail(400, 'The amount has to be a whole number of cents, zero or more.');
      if (ch.state === 'held' && amount > cap)
        return fail(400, `Up to $${(cap / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}, the amount their card is holding. For more, approve at that and charge the rest from Schedule a session.`);
      const next = amount === 0
        ? { ...ch, state: 'comped', capturedCents: 0, decidedAt: now, releasedAt: now, ratedAt: now }
        : ch.state === 'held'
          ? { ...ch, state: 'captured', capturedCents: amount, decidedAt: now, capturedAt: now, ratedAt: now }
          : { ...ch, state: 'invoiced', invoiceCents: amount, decidedAt: now, invoice: { sessionId: `cs_demo_link_${Date.now()}`, url: '#', cents: amount, createdAt: now, expiresAt: new Date(now.getTime() + 23 * 3600_000) } };
      store.docs.set(key, { ...c, charge: next });
      store.persist?.(); store.fire?.(key);
      return ok({ ok: true, charge: next });
    }
    if (path === '/api/admin/hold' || path === '/api/admin/close-case') {
      const key = `cases/${body.caseId || DEMO_CASE_ID}`;
      const c = store.docs.get(key) || {};
      const hold = c.hold || {};
      if (path === '/api/admin/close-case') {
        // Same rule as the Worker: no reason, no close. The client reads it.
        const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
        if (!reason) return fail(400, 'Write the reason for closing. The client reads it word for word.');
        store.docs.set(key, {
          ...c, status: 'closed', closedAt: new Date(), closedBy: 'advocate', closedReason: reason,
          hold: { pausedAt: null, totalMs: Number(hold.totalMs) || 0, reason: '', backBy: null },
        });
        store.persist?.();
        return ok({ ok: true });
      }
      if (body.on === true) {
        store.docs.set(key, {
          ...c,
          hold: {
            pausedAt: new Date(), totalMs: Number(hold.totalMs) || 0,
            // The client's note rides the document; his own reason stays off it
            // (2026-09-03), as in the Worker.
            reason: '', note: String(body.note || '').trim().slice(0, 400),
            backBy: body.backBy ? new Date(body.backBy) : null,
          },
        });
        store.persist?.();
        return ok({ ok: true, paused: true });
      }
      const stretch = hold.pausedAt
        ? Math.max(0, Date.now() - new Date(hold.pausedAt).getTime()) : 0;
      store.docs.set(key, {
        ...c,
        hold: { pausedAt: null, totalMs: (Number(hold.totalMs) || 0) + stretch, reason: '', note: '', backBy: null },
      });
      store.persist?.();
      return ok({ ok: true, paused: false, addedMs: stretch });
    }
    // The admin scheduler, whole: reschedule, follow-up, check-in, charge.
    // Added so the check-in cadence drives end to end in the suite - book one
    // on the Full Access case and the client page shows it, the CHECK-IN DUE
    // flag clears, and the window guard refuses a date past 60 days.
    if (path === '/api/admin/schedule') {
      const key = `cases/${body.caseId || DEMO_CASE_ID}`;
      const c = store.docs.get(key) || {};
      const mode = body.mode;
      if (!['reschedule', 'followup', 'checkin', 'charge'].includes(mode))
        return fail(400, 'Bad mode');
      let start; let durationMin = 60; let slotId = body.slotId || null;
      if (body.customStart) {
        start = new Date(body.customStart);
        durationMin = Number(body.customDurationMin) > 0 ? Number(body.customDurationMin) : 60;
      } else {
        const slot = store.docs.get(`availability/${slotId}`);
        if (!slot) return fail(404, 'No such slot');
        start = new Date(slot.start);
        durationMin = slot.durationMin || 60;
        store.docs.set(`availability/${slotId}`, { ...slot, state: 'booked', caseId: key.slice(6) });
      }
      if (Number.isNaN(start.getTime())) return fail(400, 'Pick a valid date and time.');
      const when = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Etc/GMT+7', weekday: 'long', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      }).format(start) + ' MST';

      if (mode === 'checkin') {
        if (!c.fullAccess) return fail(409, 'Check-ins are part of Full-Service Case Management. Use "charge" for a standard case.');
        if (c.status === 'closed') return fail(409, 'This case is closed.');
        // Same 60-day rule the Worker enforces, minus the hold arithmetic the
        // demo does not need: the refusal is the thing worth driving. From
        // PURCHASE, first-call fallback, matching fullAccessWindowEnd.
        const first = c.fullAccessAt ? new Date(c.fullAccessAt).getTime()
          : c.appointment?.start ? new Date(c.appointment.start).getTime() : 0;
        const extra = (Number(c.fullAccessExtraDays) || 0) * 86_400_000;
        if (first && start.getTime() > first + 60 * 86_400_000 + extra)
          return fail(409, 'That lands after the window ends. Extend the case first.');
        const checkIns = Array.isArray(c.checkIns) ? c.checkIns : [];
        store.docs.set(key, {
          ...c,
          checkIns: [...checkIns, { start, durationMin, slotId, scheduledAt: new Date() }],
        });
        store.persist?.();
        return ok({ ok: true, scheduled: when });
      }
      if (mode === 'reschedule') {
        store.docs.set(key, {
          ...c, appointment: { ...c.appointment, start, durationMin }, needsReschedule: null,
        });
        store.persist?.();
        return ok({ ok: true, scheduled: when });
      }
      if (mode === 'followup') {
        if (!c.addOnFollowUp) return fail(409, 'This case has no follow-up session on it.');
        if (c.followUp) return fail(409, 'The follow-up is already scheduled.');
        store.docs.set(key, {
          ...c,
          followUp: { start, durationMin, slotId, kind: 'followup', label: 'Follow-up discussion', amountCents: 0, scheduledAt: new Date() },
        });
        store.persist?.();
        return ok({ ok: true, scheduled: when });
      }
      // charge: 0% books it outright; a percentage writes the client's
      // pay-to-confirm prompt so that side of the loop is drivable too.
      const pct = Number(body.pct) || 0;
      const caseRate = Number(c.caseRateCents) || 120000;
      // A typed amount wins, matching the Worker. Without this the demo falls
      // back to a percentage and shows the wrong number for the one thing this
      // control exists to do.
      const typed = body.amountCents === undefined ? null : Math.round(Number(body.amountCents));
      if (typed !== null && (!Number.isFinite(typed) || typed < 100 || typed > 100000 * 100))
        return fail(400, 'Give an amount between $1 and $100,000.');
      const amountCents = typed !== null ? typed : Math.round((pct * caseRate) / 100);
      const label = (body.tagline || '').trim() || 'Additional session';
      if (amountCents === 0) {
        store.docs.set(key, {
          ...c,
          followUp: { start, durationMin, slotId, kind: 'extra', label, amountCents: 0, scheduledAt: new Date() },
        });
        store.persist?.();
        return ok({ ok: true, scheduled: when });
      }
      store.docs.set(key, {
        ...c,
        // `url` included: the client card renders it as the Pay link, and
        // without one the button read href="undefined".
        pendingExtra: {
          label, amountCents, start, durationMin, slotId, sessionId: 'demo',
          url: `/case.html?id=${key.slice(6)}&demo=1`,
        },
      });
      store.persist?.();
      return ok({ ok: true, checkoutUrl: `/case.html?id=${key.slice(6)}&demo=client` });
    }
    // Telehealth appointment advocacy, both sides, so the whole loop drives.
    if (path === '/api/telehealth') {
      const key = `cases/${body.caseId || DEMO_CASE_ID}`;
      const c = store.docs.get(key) || {};
      if (c.status === 'closed') return fail(409, 'This case is closed.');
      if (!body.when || Number.isNaN(new Date(body.when).getTime()))
        return fail(400, 'Pick the date and time of your appointment.');
      if (!body.clinicName) return fail(400, 'Name the clinic.');
      if (!body.provider) return fail(400, "Name the provider we'll be seeing.");
      if (typeof body.attestAt !== 'number')
        return fail(400, 'Tick the box confirming you are inviting me into your appointment.');
      const req = {
        when: new Date(body.when), clinicName: body.clinicName, provider: body.provider,
        attestAt: new Date(body.attestAt), requestedAt: new Date(),
      };
      if (c.fullAccess) {
        store.docs.set(key, { ...c, pendingTelehealth: { ...req, state: 'requested', paidCents: 0 } });
        store.persist?.();
        return ok({ ok: true, requested: true });
      }
      // Standard case: straight past Stripe, landing as a paid request.
      store.docs.set(key, { ...c, pendingTelehealth: { ...req, state: 'requested', paidCents: 45000 } });
      store.persist?.();
      await beat(600);
      return ok({ ok: true, url: `/case.html?id=${body.caseId || DEMO_CASE_ID}&telehealth=1&demo=${role}` });
    }
    if (path === '/api/admin/full-request') {
      const key = `cases/${body.caseId || DEMO_CASE_ID}`;
      const c = store.docs.get(key);
      const req = c?.fullAccessRequest;
      if (!c || req?.state !== 'pending') return fail(409, 'There is no request waiting.');
      if (body.decision === 'decline') {
        const reason = String(body.reason || '').trim();
        if (!reason) return fail(400, 'Write the reason. The client reads it word for word.');
        store.docs.set(key, {
          ...c,
          fullAccessRequest: { ...req, state: 'declined', decidedAt: new Date(), declineReason: reason },
        });
        store.persist?.();
        store.fire?.(key);
        return ok({ ok: true, state: 'declined' });
      }
      // Approving is what starts month one. In the demo there is no Stripe,
      // so the "checkout" lands straight where paying would have. The amount
      // is the one he typed (2026-09-06), the quoted figure by default, and
      // zero opens the month at no charge.
      const asked = body.amountCents === undefined || body.amountCents === null ? null : Number(body.amountCents);
      if (asked !== null && (!Number.isInteger(asked) || asked < 0))
        return fail(400, 'The amount has to be a whole number of cents, zero or more, under $20,000.');
      const amount = asked === null ? (Number(req.firstMonthCents) || 0) : asked;
      // The clock resets at the flip, mirroring the Worker (Eric,
      // 2026-08-29): review hours behind work.tierMark, a running stretch
      // banked by re-anchor.
      const w0 = c.work || {};
      const st0 = w0.startedAt ? new Date(w0.startedAt).getTime() : 0;
      const str0 = st0 ? Math.max(0, Math.floor((Date.now() - st0) / 1000)) : 0;
      const tot0 = Math.max(0, Number(w0.seconds) || 0) + str0;
      store.docs.set(key, {
        ...c,
        fullAccess: true,
        fullAccessAt: new Date(),
        fullAccessMonths: 1,
        fullAccessRateCents: (Number(c.caseRateCents) || 0) + amount,
        work: { ...w0, seconds: tot0, startedAt: st0 ? new Date() : null, tierMark: tot0 },
        pendingFullAccess: null,
        fullAccessRequest: { ...req, state: 'started', decidedAt: new Date(), startedAt: new Date() },
        forms: { ...(c.forms || {}), fullAccess: new Date(Number(req.ackAt) || Date.now()) },
        extraPayments: [...(Array.isArray(c.extraPayments) ? c.extraPayments : []), {
          kind: 'fullaccess', amountCents: amount,
          sessionId: `cs_demo_up_${Date.now()}`, at: new Date(),
        }],
      });
      store.persist?.();
      store.fire?.(key);
      return ok({ ok: true, state: 'approved', cents: amount });
    }
    if (path === '/api/admin/telehealth') {
      const key = `cases/${body.caseId || DEMO_CASE_ID}`;
      const c = store.docs.get(key) || {};
      const p = c.pendingTelehealth;
      if (!p || p.state !== 'requested') return fail(409, 'No telehealth request is waiting on this case.');
      if (body.action === 'confirm') {
        const visits = Array.isArray(c.telehealthVisits) ? c.telehealthVisits : [];
        // A held card (2026-09-06) is captured at the amount he set, up to
        // the hold; zero confirms at no charge.
        let paidCents = p.paidCents || 0;
        if (p.paymentIntentId && p.holdState === 'held') {
          const cap = Number(p.heldCents) || 0;
          const asked = body.amountCents === undefined || body.amountCents === null ? cap : Number(body.amountCents);
          if (!Number.isInteger(asked) || asked < 0 || asked > cap)
            return fail(400, `Up to $${(cap / 100).toFixed(0)}, the amount their card is holding; 0 confirms at no charge.`);
          paidCents = asked;
        }
        store.docs.set(key, {
          ...c, pendingTelehealth: null,
          telehealthVisits: [...visits, { ...p, state: undefined, paidCents, confirmedAt: new Date() }],
          extraPayments: paidCents > 0 && p.holdState === 'held'
            ? [...(Array.isArray(c.extraPayments) ? c.extraPayments : []), { kind: 'telehealth', amountCents: paidCents, sessionId: p.sessionId || null, at: new Date() }]
            : c.extraPayments,
        });
        store.persist?.();
        return ok({ ok: true, confirmed: true });
      }
      store.docs.set(key, {
        ...c, pendingTelehealth: null,
        telehealthDenied: {
          when: p.when, clinicName: p.clinicName, at: new Date(), refundCents: p.paidCents || 0,
          released: !!p.paymentIntentId && !p.paidCents,
        },
      });
      store.persist?.();
      return ok({ ok: true, denied: true });
    }
    if (path === '/api/admin/voice') {
      if (typeof body.enabled === 'boolean') demoVoice.enabled = body.enabled;
      if (body.run === true) {
        demoVoice.runs += 1;
        demoVoice.lastRunAt = new Date().toISOString();
        return ok({ ...demoVoice, lastRun: { ran: true, wrote: true, readers: ['diction', 'syntax', 'cadence', 'tone', 'detail', 'beliefs', 'mechanics'] } });
      }
      return ok({ ...demoVoice });
    }
    // One more month on a Full-Service case, stacking. Straight past Stripe,
    // written down, so the demo's window guard actually moves.
    //
    // EVERY field the Worker's confirmExtensionPurchase writes has to be
    // written here too. fullAccessMonths and fullAccessRateCents were missed
    // when the tier went monthly, and the demo silently dropped them: the
    // window moved, the month counter did not, and the ledger under-counted.
    if (path === '/api/extend') {
      const key = `cases/${body.caseId || DEMO_CASE_ID}`;
      const c = store.docs.get(key) || {};
      if (!c.fullAccess) return fail(409, 'Extensions are part of Full-Service Case Management.');
      if (c.status === 'closed') return fail(409, 'This case is closed.');
      await beat(600);
      const cents = 350000;
      store.docs.set(key, {
        ...c,
        fullAccessExtraDays: (Number(c.fullAccessExtraDays) || 0) + 30,
        fullAccessMonths: (Number(c.fullAccessMonths) || 1) + 1,
        fullAccessRateCents: (Number(c.fullAccessRateCents) || 0) + cents,
        pendingExtend: null,
        extraPayments: [...(Array.isArray(c.extraPayments) ? c.extraPayments : []), {
          kind: 'extend', amountCents: cents, sessionId: `cs_demo_ext_${Date.now()}`, at: new Date(), days: 30,
        }],
      });
      store.persist?.();
      store.fire?.(key);
      return ok({ ok: true, url: `/case.html?id=${body.caseId || DEMO_CASE_ID}&extended=1&demo=1` });
    }
    if (path === '/api/checkout' || path === '/api/subscribe' || path === '/api/followup'
      || path === '/api/upgrade') {
      // The scope note is a real gate, not decoration, so the demo refuses
      // the same way the Worker does. A demo that waves the buyer through
      // teaches the wrong thing about the one screen that has to hold.
      if (path === '/api/upgrade' && body?.action !== 'withdraw'
        && typeof body?.acks?.fullAccess !== 'number')
        return fail(400, 'Read the scope note and acknowledge it first.');
      // Same five the Worker requires, phoneConsent included - the demo
      // refuses the same way so the booking drive proves the gate.
      if (path === '/api/checkout'
        && !['disclaimer', 'privacy', 'recording', 'service', 'phoneConsent']
          .every((f) => typeof body?.acks?.[f] === 'number'))
        return fail(400, 'All acknowledgment forms must be completed first.');
      await beat(600);

      // THE SEAMLESS DEMO (Eric, 2026-08-25): "your booking becomes a real
      // case in the demo store." The checkout writes the same case document
      // the Stripe webhook would, so the return page lands him on the case
      // he just booked, the client view is the normal one, and the advocate
      // shelf grows the new card the moment he switches sides.
      if (path === '/api/checkout') {
        // Booking sells ONE service (mirrors the Worker's refusal).
        if (body.tier === 'full')
          return fail(400, 'Full-Service Case Management is added from inside an open case now. '
            + 'Book an Advocacy Case, then add it from your case page.');
        const profile = store.docs.get('users/demo-client') || {};
        const slot = body.slotId ? store.docs.get(`availability/${body.slotId}`) : null;
        // The Worker refuses a slot taken out from under the buyer; a stale
        // tab re-paying here must not silently re-point a booked one.
        if (body.slotId && slot && slot.state !== 'open')
          return fail(409, 'That time was just taken. Pick another.');
        const isRequest = !body.slotId && !!body.requestedStart;
        const start = isRequest ? new Date(body.requestedStart)
          : slot ? new Date(slot.start) : new Date();
        const now = new Date();
        const id = 'demo-case-booked';
        store.docs.set(`cases/${id}`, {
          clientUid: 'demo-client',
          clientEmail: profile.email || 'jordan@example.demo',
          clientName: profile.name || 'Jordan Avery',
          clientDob: profile.dob || null,
          clientTz: body.tz || 'America/Denver',
          clientPhone: body.phone || null,
          clientAddress: String(body.address || '').trim().slice(0, 300) || null,
          status: 'confirmed',
          createdAt: now,
          appointment: {
            start, durationMin: slot?.durationMin || 60, method: body.method || 'video',
            phone: body.phone || null, joinLink: null, requested: isRequest,
          },
          publicElection: { choice: 'private', history: [{ choice: 'private', at: now }] },
          addOnFollowUp: false,
          forms: Object.fromEntries(Object.entries(body.acks || {})
            .map(([k, v]) => [k, new Date(v)])),
          files: [],
          reportDueAt: null,
          caseRateCents: 120000,
          addonRateCents: 32500,
          fullAccess: false,
          fullAccessAt: null,
          fullAccessRateCents: null,
          stripe: {
            sessionId: 'cs_demo_booked', paymentIntentId: 'pi_demo_booked',
            amountTotal: 120000,
          },
          // The hold (2026-09-06): held, not charged, waiting on his approval,
          // the way the Worker writes it.
          charge: {
            state: 'held', kind: 'case', authorizedCents: 120000, capturedCents: 0,
            paymentIntentId: 'pi_demo_booked', sessionId: 'cs_demo_booked',
            heldAt: now, expiresAt: new Date(now.getTime() + 7 * 86_400_000),
            decidedAt: null, capturedAt: null, remindedAt: null, ratedAt: null,
          },
          work: { seconds: 0, startedAt: null },
        });
        if (slot) store.docs.set(`availability/${body.slotId}`, { ...slot, state: 'booked', caseId: id });
                store.fire?.(`cases/${id}`);
        return ok({ ok: true, url: '/return.html?session_id=cs_demo_booked' });
      }

      // Add-on purchases write the case the way the webhook's confirmers do,
      // so the client card flips AND the advocate chart shows the purchase.
      if (path === '/api/followup') {
        const key = `cases/${body.caseId || DEMO_CASE_ID}`;
        const c = store.docs.get(key);
        if (c) {
          store.docs.set(key, {
            ...c, addOnFollowUp: true, addOnFollowUpAt: new Date(), pendingFollowUp: null,
            extraPayments: [...(Array.isArray(c.extraPayments) ? c.extraPayments : []), {
              kind: 'followup', amountCents: Number(c.addonRateCents) || 32500,
              sessionId: `cs_demo_fu_${Date.now()}`, at: new Date(),
            }],
          });
                    store.fire?.(key);
        }
        return ok({ ok: true, url: `/case.html?id=${body.caseId || DEMO_CASE_ID}&followup=1&demo=1` });
      }
      if (path === '/api/upgrade') {
        // A REQUEST now, not a purchase - Eric approves before anything is
        // charged, so the demo has to make him do it too or the drive would
        // skip the only new decision in the flow.
        const key = `cases/${body.caseId || DEMO_CASE_ID}`;
        const c = store.docs.get(key);
        if (!c) return ok({ ok: true, state: 'pending' });
        if (body.action === 'withdraw') {
          store.docs.set(key, { ...c, fullAccessRequest: null });
          store.persist?.();
          store.fire?.(key);
          return ok({ ok: true, withdrawn: true });
        }
        const monthCents = 350000;
        const at = new Date();
        store.docs.set(key, {
          ...c,
          fullAccessRequest: {
            state: 'pending', at, monthCents,
            // NO CREDIT, mirroring the Worker (Eric, 2026-08-29: "They pay
            // 3400 separately.").
            firstMonthCents: monthCents,
            ackAt: body.acks?.fullAccess || Date.now(),
            decidedAt: null, declineReason: '',
          },
        });
        store.persist?.();
        store.fire?.(key);
        return ok({ ok: true, state: 'pending', at });
      }
      // /api/subscribe: straight past Stripe to where paying would have landed.
      return ok({ ok: true, url: `/return.html?session_id=demo&demo=${role}` });
    }
    // ready, not just the id: the return page polls on that flag, and without
    // it the demo sat on "opening your case now" until it gave up.
    // Full Access authorisations. The demo case is a standard one, so the
    // list is empty and the two Sign buttons are what a real client sees.
    // The signed authorisations, read out of the store so the Full Access
    // demo case shows real ones and the standard case correctly shows none.
    if (path === '/api/authority') {
      const cid = body.caseId || q.get('caseId') || '';
      const prefix = `demoAuthority/${cid}/items/`;
      if ((init.method || 'GET').toUpperCase() === 'GET') {
        // Mirrors the Worker: the list omits the signature blobs, and one
        // document's ink comes back only when it is asked for by id.
        const want = q.get('id') || '';
        const items = [...store.docs.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => {
            const { signatureImage, ...rest } = v;
            const rowId = k.slice(prefix.length);
            return {
              id: rowId,
              ...rest,
              hasSignature: !!signatureImage,
              ...(want && rowId === want ? { signatureImage } : {}),
            };
          })
          .sort((a, b) => new Date(b.signedAt || 0) - new Date(a.signedAt || 0));
        return ok({ items });
      }
      await beat(500);
      if (body.action === 'revoke') {
        const k = prefix + body.id;
        const cur = store.docs.get(k);
        // Mirrors the Worker (2026-08-29): the scope of work agreement is the
        // contract the case runs on, not a permission, and cannot be revoked
        // by one tap.
        if (cur?.kind === 'scope')
          return fail(409, 'This is the agreement your case runs on, not a permission. '
            + 'If something in it needs to change, tell me in your case chat and we will settle it together.');
        if (cur) store.docs.set(k, { ...cur, revokedAt: new Date() });
        store.persist?.(); // without this a withdrawn authorisation came back on reload
        return ok({ ok: true });
      }
      // The Worker's gates, in the Worker's ORDER - the demo used to refuse a
      // missing signature first, so the same bad POST got two different
      // answers depending on which side you were driving.
      const kinds = ['records', 'representative', 'scope'];
      if (!kinds.includes(body.kind)) return fail(400, 'Bad request');
      // Per DOCUMENT, matching the Worker as of 2026-08-26. A records release
      // can be signed on any case; the insurance designation and the scope of
      // work agreement are the Full-Service half. The demo never checked the
      // tier at all, so it would happily sign a designation a real case would
      // have refused.
      if ((body.kind === 'representative' || body.kind === 'scope')
        && !store.docs.get(`cases/${cid}`)?.fullAccess)
        return fail(409, 'This case is not on Full-Service Case Management.');
      const typed = String(body.signedName || '').trim();
      if (typed.length < 2) return fail(400, 'Type your full name to sign.');
      const flat = (v) => String(v || '').toLowerCase().replace(/[^a-z]+/g, '');
      const onCase = store.docs.get(`cases/${cid}`)?.clientName;
      if (onCase && flat(typed) !== flat(onCase))
        return fail(400, 'Sign with the same name that is on this case.');
      const scopes = Array.isArray(body.scopes)
        ? body.scopes.filter((x) => ['discuss', 'records', 'admin'].includes(x)).slice(0, 8) : [];
      if (body.kind === 'records' && !body.clinicName)
        return fail(400, 'Name the clinic this authorisation is for.');
      if (body.kind === 'representative' && !body.planName)
        return fail(400, 'Name your insurance plan.');
      if (body.kind === 'records' && !scopes.length)
        return fail(400, 'Tick at least one thing you are authorising me to do.');
      // Mirrors the Worker (2026-08-29): the contact tick is part of the
      // scope of work agreement, refused in the same order.
      if (body.kind === 'scope' && body.contactOk !== true)
        return fail(400, 'Tick the box that lets me phone and text you about your case.');
      if (!body.signatureImage
        || !/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/.test(String(body.signatureImage).trim()))
        return fail(400, 'Sign the document with your finger before sending it.');
      const id = `demo-${Math.random().toString(36).slice(2, 8)}`;
      // The field list is hardcoded here, so anything new on the real
      // document has to be added or the demo silently drops it.
      store.docs.set(prefix + id, {
        kind: body.kind, signedName: body.signedName, signedAt: new Date(),
        revokedAt: null, clinicName: body.clinicName || '', clinicAddress: body.clinicAddress || '',
        clinicPhone: body.clinicPhone || '', fromDate: body.fromDate || '', toDate: body.toDate || '',
        planName: body.planName || '', memberId: body.memberId || '',
        categories: Array.isArray(body.categories) ? body.categories : [],
        scopes,
        contactOk: body.contactOk === true,
        signatureImage: body.signatureImage || '',
      });
      // Mirrors the Worker (2026-08-29): a scope signature stamps the case
      // itself, which is where the readiness checklist reads from.
      if (body.kind === 'scope') {
        const ck = `cases/${cid}`;
        const cc = store.docs.get(ck);
        if (cc) store.docs.set(ck, { ...cc, scopeSignedAt: new Date() });
      }
      store.persist?.();
      return ok({ ok: true, id, signedAt: new Date().toISOString() });
    }
    // The client's view of the work log.
    //
    // READS THE MIRROR, NEVER THE RECORD, and that is not a shortcut. The
    // record lives under `/private/`, which this store's NOT_FOR_CLIENTS list
    // keeps out of a client-side tab entirely, so there is nothing there to
    // read and there must not be: it holds a clinic's direct line, who was on
    // the call, and his own notes. In production the Worker builds the
    // projection server-side and the browser never sees the record. Here the
    // Worker is a shim in the same tab, so the projection is written down as
    // its own client-safe document when the entry is saved (below), and this
    // route serves that. Same four fields, same guarantee, same place to
    // break it.
    if (path === '/api/case-log') {
      const cid = q.get('caseId') || '';
      const prefix = `cases/${cid}/caseLog/`;
      const kinds = ['call', 'appeal', 'investigation', 'appointment'];
      const items = [];
      for (const [k, v] of store.docs.entries()) {
        if (!k.startsWith(prefix)) continue;
        const summary = typeof v.summary === 'string' ? v.summary.trim().slice(0, 400) : '';
        if (!summary) continue;
        // A custom type's label and colour ride the entry, mirroring the
        // Worker's stamped-at-write rule (2026-08-29).
        const custom = typeof v.kindLabel === 'string' && v.kindLabel;
        items.push({
          id: k.slice(prefix.length),
          at: v.at || null,
          kind: kinds.includes(v.kind) ? v.kind : (custom ? String(v.kind) : 'call'),
          ...(custom ? { label: v.kindLabel, color: v.kindColor || 'blue' } : {}),
          who: typeof v.who === 'string' ? v.who.slice(0, 200) : '',
          summary,
        });
      }
      items.sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
      // The milestones ride along, four fields wide, mirroring the Worker
      // (2026-08-31).
      const mprefix = `cases/${cid}/private/milestones/items/`;
      const milestones = [...store.docs.entries()]
        .filter(([k]) => k.startsWith(mprefix))
        .map(([, v]) => ({
          what: String(v.what || ''), kindLabel: String(v.kindLabel || v.kind || ''),
          kindColor: String(v.kindColor || 'blue'), at: v.at || v.createdAt || null,
        }))
        .filter((m) => m.what.trim())
        .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
      return ok({ items, milestones });
    }
    // Milestones (Eric, 2026-08-30): the achievements feed, mirroring the
    // Worker: same base kinds, same colour rules, one time-stamped list.
    if (path === '/api/milestones') {
      const cid = body.caseId || q.get('caseId') || '';
      const prefix = `cases/${cid}/private/milestones/items/`;
      const base = [
        { id: 'appointment', label: 'Appointment scheduled', color: 'blue' },
        { id: 'referral', label: 'Referral out', color: 'deep' },
        { id: 'authorization', label: 'Insurance authorization', color: 'green' },
      ];
      const colorIds = ['blue', 'deep', 'green', 'gold', 'orange', 'red'];
      const validColor = (c) => colorIds.includes(c)
        || (/^h\d{1,3}$/.test(String(c || '')) && Number(String(c).slice(1)) <= 359);
      const customKinds = () => {
        const rows = store.docs.get('config/milestones')?.kinds;
        return (Array.isArray(rows) ? rows : []).filter((k) => k && k.id && k.label
          && validColor(k.color));
      };
      if ((init.method || 'GET').toUpperCase() === 'GET') {
        const items = [...store.docs.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => ({ id: k.slice(prefix.length), ...v }))
          .sort((a, b) => new Date(b.at || b.createdAt || 0) - new Date(a.at || a.createdAt || 0));
        return ok({ items, kinds: customKinds() });
      }
      await beat(400);
      if (body.action === 'kind-add') {
        const label = String(body.label || '').trim().replace(/\s+/g, ' ').slice(0, 24);
        if (!/^[A-Za-z][A-Za-z0-9 &-]{1,23}$/.test(label))
          return fail(400, 'Name it in plain words: letters and numbers, up to 24 characters.');
        if (!validColor(body.color)) return fail(400, 'Pick one of the colours.');
        const kid = label.toLowerCase().replace(/[^a-z0-9]+/g, '');
        if (kid.length < 2) return fail(400, 'Name it in plain words first.');
        const existing = customKinds();
        if (base.some((k) => k.id === kid) || existing.some((k) => k.id === kid))
          return fail(409, 'That milestone type already exists.');
        if (existing.length >= 12)
          return fail(400, 'That is 12 of your own types already. Remove one you no longer use first.');
        store.docs.set('config/milestones', { kinds: [...existing, { id: kid, label, color: body.color }] });
        store.persist?.();
        return ok({ ok: true, id: kid });
      }
      if (body.action === 'kind-remove') {
        const kid = String(body.id || '');
        if (base.some((k) => k.id === kid)) return fail(400, 'The built-in types stay.');
        store.docs.set('config/milestones', { kinds: customKinds().filter((k) => k.id !== kid) });
        store.persist?.();
        return ok({ ok: true });
      }
      if (body.action === 'add') {
        const what = String(body.what || '').trim().slice(0, 300);
        if (!what) return fail(400, 'Say what was achieved.');
        const k = base.find((x) => x.id === body.kind)
          || customKinds().find((x) => x.id === body.kind) || base[0];
        store.docs.set(`${prefix}m${Date.now()}`, {
          what, kind: k.id, kindLabel: k.label, kindColor: k.color,
          at: body.at ? new Date(body.at) : new Date(), createdAt: new Date(),
        });
        store.persist?.();
        return ok({ ok: true });
      }
      if (body.action === 'remove') {
        store.docs.delete(`${prefix}${String(body.id || '')}`);
        store.persist?.();
        return ok({ ok: true });
      }
      return fail(400, 'Bad request');
    }
    if (path === '/api/clinic-calls') {
      const cid = body.caseId || q.get('caseId') || '';
      const prefix = `cases/${cid}/private/clinicCalls/items/`;
      const kinds = ['call', 'appeal', 'investigation', 'appointment'];
      // His own activity types, mirroring the Worker (2026-08-29): stored in
      // one config doc, colours off the same allowlist, base ids protected.
      const colorIds = ['blue', 'deep', 'green', 'gold', 'orange', 'red'];
      // A legacy id or a slider hue h0-h359, mirroring the Worker's
      // validPillColor (2026-08-29).
      const validColor = (c) => colorIds.includes(c)
        || (/^h\d{1,3}$/.test(String(c || '')) && Number(String(c).slice(1)) <= 359);
      const customKinds = () => {
        const rows = store.docs.get('config/workLog')?.kinds;
        return (Array.isArray(rows) ? rows : []).filter((k) => k && k.id && k.label
          && validColor(k.color));
      };
      if ((init.method || 'GET').toUpperCase() === 'GET') {
        const items = [...store.docs.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => ({ id: k.slice(prefix.length), ...v }))
          .sort((a, b) => new Date(a.at || a.createdAt || 0) - new Date(b.at || b.createdAt || 0));
        return ok({ items, kinds: customKinds() });
      }
      await beat(400);
      if (body.action === 'kind-add') {
        const label = String(body.label || '').trim().replace(/\s+/g, ' ').slice(0, 24);
        if (!/^[A-Za-z][A-Za-z0-9 &-]{1,23}$/.test(label))
          return fail(400, 'Name it in plain words: letters and numbers, up to 24 characters.');
        if (!validColor(body.color)) return fail(400, 'Pick one of the colours.');
        const kid = label.toLowerCase().replace(/[^a-z0-9]+/g, '');
        if (kid.length < 2) return fail(400, 'Name it in plain words first.');
        const existing = customKinds();
        if (kinds.includes(kid) || existing.some((k) => k.id === kid))
          return fail(409, 'That activity type already exists.');
        if (existing.length >= 12)
          return fail(400, 'That is 12 of your own types already. Remove one you no longer use first.');
        store.docs.set('config/workLog', { kinds: [...existing, { id: kid, label, color: body.color }] });
        store.persist?.();
        return ok({ ok: true, id: kid });
      }
      if (body.action === 'kind-remove') {
        const kid = String(body.id || '');
        if (kinds.includes(kid)) return fail(400, 'The built-in types stay.');
        store.docs.set('config/workLog', { kinds: customKinds().filter((k) => k.id !== kid) });
        store.persist?.();
        return ok({ ok: true });
      }
      // The client-safe half, rewritten from the record every time the record
      // changes. Built by naming fields, never by spreading the record; and an
      // entry with no client line has no mirror at all rather than an empty
      // one, so removing the line takes the row off their page.
      const mirror = (id, rec) => {
        const key = `cases/${cid}/caseLog/${id}`;
        const summary = String(rec.summary || '').trim().slice(0, 400);
        if (!summary) { store.docs.delete(key); return; }
        const custom = typeof rec.kindLabel === 'string' && rec.kindLabel;
        store.docs.set(key, {
          at: rec.at || rec.createdAt || null,
          kind: kinds.includes(rec.kind) ? rec.kind : (custom ? String(rec.kind) : 'call'),
          ...(custom ? { kindLabel: rec.kindLabel, kindColor: rec.kindColor || 'blue' } : {}),
          who: String(rec.clinic || '').slice(0, 200),
          summary,
        });
      };
      if (body.action === 'edit') {
        // The correction (2026-09-03), mirroring the Worker: the same fields
        // as add, the type resolved and stamped the same way, nothing sent,
        // and an entry that is gone is a 404 rather than a stub.
        const k = prefix + body.id;
        const cur = store.docs.get(k);
        if (!cur) return fail(404, 'That entry is gone.');
        if (!String(body.clinic || '').trim()) return fail(400, 'Say who it was with.');
        let kind = 'call';
        let kindLabel = '';
        let kindColor = '';
        if (kinds.includes(body.kind)) {
          kind = body.kind;
        } else {
          const cu = customKinds().find((x) => x.id === body.kind);
          if (cu) { kind = cu.id; kindLabel = cu.label; kindColor = cu.color; }
        }
        const next = {
          ...cur,
          clinic: String(body.clinic || '').trim().slice(0, 200),
          phone: String(body.phone || '').slice(0, 40), parties: String(body.parties || '').slice(0, 200),
          kind, kindLabel, kindColor,
          at: body.at ? new Date(body.at) : null, editedAt: new Date(),
        };
        store.docs.set(k, next);
        mirror(body.id, next);
        store.persist?.();
        return ok({ ok: true });
      }
      if (body.action === 'notes') {
        const k = prefix + body.id;
        const cur = store.docs.get(k);
        // The summary joins only when the caller sent one, matching the
        // Worker's mask: a request that knows nothing about it must not blank
        // the line a client is already reading.
        if (cur) {
          const next = {
            ...cur, notes: body.notes || '', notesAt: new Date(),
            ...(typeof body.summary === 'string' ? { summary: body.summary.slice(0, 400) } : {}),
          };
          store.docs.set(k, next);
          mirror(body.id, next);
        }
        store.persist?.();
        return ok({ ok: true });
      }
      if (body.action === 'add') {
        const id = `c-${Math.random().toString(36).slice(2, 8)}`;
        // Base kind by id, custom kind resolved and STAMPED, junk folds to
        // 'call': the Worker's rule, mirrored.
        let kind = 'call';
        let kindLabel = '';
        let kindColor = '';
        if (kinds.includes(body.kind)) {
          kind = body.kind;
        } else {
          const cu = customKinds().find((k) => k.id === body.kind);
          if (cu) { kind = cu.id; kindLabel = cu.label; kindColor = cu.color; }
        }
        const rec = {
          clinic: body.clinic || '', phone: body.phone || '', parties: body.parties || '',
          kind, kindLabel, kindColor,
          summary: String(body.summary || '').slice(0, 400),
          at: body.at ? new Date(body.at) : null, notes: '', createdAt: new Date(),
        };
        store.docs.set(prefix + id, rec);
        mirror(id, rec);
        store.persist?.();
      }
      return ok({ ok: true });
    }
    if (path === '/api/case-for-session') {
      // The seamless walk returns from its own checkout marker and lands on
      // the case that booking just created; anything else keeps the fixture.
      const sid = q.get('session_id') || '';
      const booked = sid === 'cs_demo_booked' && store.docs.get('cases/demo-case-booked');
      return ok({ ready: true, caseId: booked ? 'demo-case-booked' : DEMO_CASE_ID });
    }
    if (path === '/api/portal') return ok({ url: `/subscription.html?demo=${role}` });
    // Retired with the jar itself. The ledger branch below still reports
    // tips, because a real ledger still has to reconcile ones already given.
    if (path === '/api/tip') return fail(404, 'Not found');
    if (path === '/api/chat-unlock') {
      // Straight past Stripe AND written down: ?chatopen=1 only fakes the
      // unlock for one paint, so without the flag on the case doc a reload
      // re-locked the chat the demo just sold.
      const key = `cases/${body.caseId || DEMO_CASE_ID}`;
      const c = store.docs.get(key);
      if (c) {
        store.docs.set(key, { ...c, chatUnlocked: true, chatUnlockedAt: new Date() });
        store.persist?.();
      }
      return ok({ url: `/case.html?id=${body.caseId || DEMO_CASE_ID}&demo=1&chatopen=1` });
    }

    // ---- PR 420, the trading desk (2026-09-23) ----------------------------------
    // The desk's routes, mirrored with the Worker's own refusal sentences
    // (worker/trade-desk.js SAY) and the shapes worker/trade.js answers with.
    // A run walks the same stages production does, on a timer: queued, the
    // five researchers coming back one by one, the desk deciding, then fresh
    // trades on the board. Nothing here reaches a market or the Worker.
    if (path.startsWith('/api/admin/trade/')) {
      if (role !== 'admin') return fail(404, 'Not found');
      const sub = path.slice('/api/admin/trade/'.length);
      const SAY = {
        notFound: 'Not found',
        deskOpen: 'The trade desk is already open.',
        badDate: 'Pick a date like 2026-09-21, not in the future.',
        badCents: 'Enter the balance in dollars, 0 or more, under ten million.',
        badKey: 'That key does not look like a Finnhub key.',
        badAccount: 'Account type is cash or margin.',
        badWatchlist: 'Watchlist: up to 20 tickers, letters and dots only.',
        badTicker: 'Ticker: letters and dots only, up to six.',
        noDesk: 'The trade desk is not open.',
        noQuoteKey: 'No market data key on file. Add it in Settings.',
        quoteMany: 'Quotes: up to 10 tickers at a time.',
        runStalled: 'The desk run stopped partway and did not recover. Tap RUN TRADING DESK to start a fresh one.',
        noRec: 'That trade is not on the desk any more.',
        notOpen: 'That trade is no longer open to take.',
        notTaken: 'Tap YES on this trade before marking how it ended.',
        badResult: 'Mark it PROFIT or LOSS.',
        notAdjustable: 'That trade is closed, so its size can no longer change.',
        notDeclinable: 'Only a new suggestion can be passed on.',
        notScalable: 'Tap YES on this trade before adding to it or trimming it.',
        scaledNoReset: 'You have added to or trimmed this trade, so the desk\'s plan no longer fits it. Change its size instead.',
        badRisk: 'Risk per trade: 0.1 to 5 percent of the balance.',
      };
      const DEFAULT_WATCHLIST = ['SPY', 'QQQ', 'IWM', 'NVDA', 'AMD', 'SOFI', 'PLTR', 'F', 'INTC', 'BAC'];
      const TICKER_RE = /^[A-Z][A-Z.]{0,5}$/;
      const ID_RE = /^[\w-]{1,40}$/;
      const todayMT = deskToday();
      const realDate = (k) => /^\d{4}-\d{2}-\d{2}$/.test(k) && new Date(`${k}T12:00:00Z`).toISOString().slice(0, 10) === k;
      const settings = () => store.docs.get('trade/settings') || {};
      const tstate = () => store.docs.get('trade/state') || {};
      const keyOf = (s) => String(s.finnhubKey || '');
      const riskOf = (s) => { const v = Number(s.riskPct); return Number.isFinite(v) && v >= 0.1 && v <= 5 ? v : 3; };
      const pub = (s) => ({
        accountType: s.accountType === 'margin' ? 'margin' : 'cash',
        riskPct: riskOf(s),
        pushOn: s.pushOn !== false,
        debugResearch: s.debugResearch === true,
        watchlist: Array.isArray(s.watchlist) && s.watchlist.length ? s.watchlist : DEFAULT_WATCHLIST,
        hasKey: !!keyOf(s), keyTail: keyOf(s).slice(-4),
      });
      const iso = (v) => (v ? new Date(v).toISOString() : null);
      const recRow = (id, d) => ({
        id, ticker: d.ticker, side: d.side === 'short' ? 'short' : 'long',
        horizon: ['scalp', 'intraday', 'swing'].includes(d.horizon) ? d.horizon : 'intraday',
        instrument: ['stock', 'call', 'put'].includes(d.instrument) ? d.instrument : 'stock',
        entryLow: d.entryLow ?? d.entry ?? null, entryHigh: d.entryHigh ?? d.entry ?? null, entry: d.entry ?? null,
        stop: d.stop ?? null, targets: Array.isArray(d.targets) ? d.targets : [],
        holdMinutes: d.holdMinutes ?? null, holdDays: d.holdDays ?? null, allocPct: d.allocPct ?? null,
        profitLow: d.profitLow ?? null, profitHigh: d.profitHigh ?? null,
        setup: d.setup || d.picture || '', catalyst: d.catalyst || '', invalidation: d.invalidation || d.watch || '',
        strike: d.strike ?? null, expiry: d.expiry ?? null, agreement: d.agreement ?? null,
        lastPrice: d.lastPrice ?? null, priceNow: d.priceNow ?? null, priceAt: iso(d.priceAt),
        status: String(d.status || 'open'),
        result: d.result === 'profit' || d.result === 'loss' ? d.result
          : d.status === 'closed' && Number(d.outcomeCents) ? (Number(d.outcomeCents) > 0 ? 'profit' : 'loss') : null,
        at: iso(d.at), tookAt: iso(d.tookAt), closedAt: iso(d.closedAt), expiresAt: iso(d.expiresAt), runId: d.runId || null,
        mine: d.mine && Number(d.mine.amountCents) > 0 && Number(d.mine.riskCents) > 0 ? {
          amountCents: Number(d.mine.amountCents), riskCents: Number(d.mine.riskCents), stop: d.mine.stop ?? null,
          targets: Array.isArray(d.mine.targets) ? d.mine.targets : [], qty: d.mine.qty ?? null, costCents: d.mine.costCents ?? null, at: iso(d.mine.at),
          entry: Number.isFinite(Number(d.mine.entry)) && Number(d.mine.entry) > 0 ? Number(d.mine.entry) : null,
          legs: Array.isArray(d.mine.legs) ? d.mine.legs.slice(-20).map((l) => ({ kind: l.kind === 'trim' ? 'trim' : 'add', qty: Number(l.qty) || 0, price: Number(l.price) || 0, at: iso(l.at) })) : [],
        } : null,
        adds: d.adds === true,
        reoffered: d.reoffered && Number.isFinite(Number(d.reoffered.was)) ? { was: Number(d.reoffered.was), now: Number(d.reoffered.now) || 0 } : null,
        tookAgreement: Number.isFinite(Number(d.tookAgreement)) && d.tookAgreement !== null ? Number(d.tookAgreement) : null,
        agreedAt: iso(d.agreedAt),
        dropped: d.dropped ? { at: iso(d.dropped.at), runId: d.dropped.runId || null } : null,
        verdict: d.verdict && (d.verdict.call === 'hold' || d.verdict.call === 'sell') ? { call: d.verdict.call, why: String(d.verdict.why || ''), at: iso(d.verdict.at), runId: d.verdict.runId || null } : null,
      });
      const BUSY_RUN = ['queued', 'researching', 'decide', 'deciding'];
      const runBlock = (run) => (run ? {
        status: ['queued', 'researching', 'decide', 'deciding', 'error', 'idle'].includes(run.status) ? run.status : 'idle',
        alive: BUSY_RUN.includes(run.status), trigger: run.trigger || 'manual',
        queuedAt: iso(run.queuedAt), startedAt: iso(run.startedAt), finishedAt: iso(run.finishedAt),
        decideAt: iso(run.decideAt), claimedAt: iso(run.claimedAt),
        done: Number(run.done) || 0, of: 5,
        count: Number.isFinite(Number(run.count)) ? Number(run.count) : null,
        error: run.status === 'error' ? (run.error || SAY.runStalled) : null,
      } : { status: 'idle', alive: false });
      const balanceOf = (s) => {
        const rows = deskRows(store, 'trade/balances/items/').sort((a, b) => String(b.date || b.id).localeCompare(String(a.date || a.id)));
        const c = rows[0]?.cents;
        if (Number.isFinite(Number(c))) return { cents: Math.round(Number(c)), date: rows[0].date || rows[0].id, typed: true };
        return { cents: Number.isInteger(s.startCents) && s.startCents > 0 ? s.startCents : 200000, date: null, typed: false };
      };
      const readRec = (id) => (ID_RE.test(id) ? store.docs.get(`trade/plays/items/${id}`) || null : null);
      const editActive = (fn) => {
        const st = tstate();
        store.docs.set('trade/state', { ...st, activeIds: fn(Array.isArray(st.activeIds) ? st.activeIds : []) });
      };

      if (sub === 'state' && init.method !== 'POST') {
        const s = settings();
        const st = tstate();
        const now = Date.now();
        const activeIds = Array.isArray(st.activeIds) ? st.activeIds : [];
        const deskIds = Array.isArray(st.desk?.ids) ? st.desk.ids : [];
        const ids = [...new Set([...activeIds, ...deskIds])];
        const rows = ids.map((id) => { const d = readRec(id); return d ? recRow(id, d) : null; }).filter(Boolean);
        const live = (r) => r.status === 'open' && (!r.expiresAt || new Date(r.expiresAt).getTime() > now);
        return ok({
          open: !!s.caseId, caseId: s.caseId || null,
          settings: pub(s), balance: balanceOf(s), run: runBlock(st.run),
          desk: st.desk ? {
            at: iso(st.desk.at), trigger: st.desk.trigger || 'manual', read: st.desk.read || '', none: st.desk.none || '',
            count: Number(st.desk.count) || 0, reports: Number(st.desk.reports) || 0,
            verdicts: Array.isArray(st.desk.verdicts) ? st.desk.verdicts.slice(0, 12).map((x) => ({ ticker: String(x?.ticker || ''), horizon: ['scalp', 'intraday', 'swing'].includes(x?.horizon) ? x.horizon : 'intraday', side: x?.side === 'short' ? 'short' : 'long', instrument: ['stock', 'call', 'put'].includes(x?.instrument) ? x.instrument : 'stock', call: x?.call === 'sell' ? 'sell' : 'hold', why: String(x?.why || '') })) : [],
          } : null,
          recs: rows.filter((r) => deskIds.includes(r.id) && live(r)),
          active: rows.filter((r) => r.status === 'took').sort((a, b) => String(b.tookAt).localeCompare(String(a.tookAt))),
          timedOut: rows.filter((r) => deskIds.includes(r.id) && r.status === 'open' && !live(r)).length,
          // The demo's market is always open, so the live prices and the scalps always have something to show.
          market: { today: todayMT, tradingDay: 'full', open: true, beforeOpen: false, closeAt: '14:00' },
          now: new Date(now).toISOString(),
        });
      }
      if (sub === 'history' && init.method !== 'POST') {
        const plays = deskRows(store, 'trade/plays/items/').filter((r) => r.status === 'closed').map((r) => ({ ...recRow(r.id, r), source: 'desk' }));
        const logged = deskRows(store, 'trade/positions/items/').filter((p) => p.status === 'closed').map((p) => {
          const pnl = Number(p.pnlCents);
          return {
            ...recRow(p.id, { ...p, targets: p.target ? [p.target] : [], setup: p.note || p.structure || '' }),
            status: 'closed', result: Number.isFinite(pnl) && pnl !== 0 ? (pnl > 0 ? 'profit' : 'loss') : null,
            tookAt: iso(p.openedAt), source: 'logged',
          };
        });
        const rows = [...plays, ...logged].sort((a, b) => String(b.closedAt || '').localeCompare(String(a.closedAt || ''))).slice(0, 200);
        return ok({ rows, count: rows.length });
      }
      if (sub === 'news' && init.method !== 'POST') {
        const s = settings();
        const st = tstate();
        const now = Date.now();
        const ids = [...new Set([...(st.activeIds || []), ...(st.desk?.ids || [])])];
        const tickers = [...new Set(ids.map(readRec).filter((d) => d && ['open', 'took'].includes(d.status)).map((d) => d.ticker))];
        const base = {
          hasKey: !!keyOf(s), asOf: new Date(now).toISOString(), today: todayMT, tradingDay: 'full', marketOpen: true, tickers,
          desk: Array.isArray(st.desk?.news) ? st.desk.news : [], deskAt: iso(st.desk?.at),
        };
        if (!keyOf(s)) return ok({ ...base, headlines: [], earnings: [], throttled: false });
        // The Worker's relevance rule, word for word (worker/trade.js relevantNews and relevantEarnings).
        const MACRO_RE = /\b(fed|fomc|powell|rate (?:cut|hike|decision)s?|interest rates?|treasur(?:y|ies)|yields?|inflation|cpi|ppi|pce|jobs report|payrolls?|unemployment|jobless|gdp|recession|tariffs?|trade war|oil|opec|crude|shutdown|debt ceiling|stimulus|central bank|ecb|boj|volatility|vix|sell-?off|rally)\b/i;
        const headlines = DEMO_NEWS.map((n) => {
          const onDesk = tickers.filter((t) => (n.related || []).includes(t) || new RegExp(`\\b${t.replace('.', '\\.')}\\b`).test(n.headline));
          return {
            headline: n.headline, source: n.source, url: 'https://example.invalid/story',
            at: new Date(now - n.mins * 60_000).toISOString(), summary: n.summary, related: n.related, onDesk,
            score: onDesk.length ? 2 : MACRO_RE.test(`${n.headline} ${n.summary || ''}`) ? 1 : 0,
          };
        }).filter((n) => n.score > 0).sort((a, b) => b.score - a.score || b.at.localeCompare(a.at)).slice(0, 12).map(({ score, ...n }) => n);
        const earnings = DEMO_EARNINGS.filter((e) => tickers.includes(e.symbol) || (e.revenueEstimate || 0) >= 5e9)
          .sort((a, b) => Number(tickers.includes(b.symbol)) - Number(tickers.includes(a.symbol)) || (b.revenueEstimate || 0) - (a.revenueEstimate || 0))
          .slice(0, 12).map((e) => ({ ...e, onDesk: tickers.includes(e.symbol) }));
        return ok({ ...base, headlines, earnings, throttled: false });
      }
      if (sub === 'quote' && init.method !== 'POST') {
        const s = settings();
        if (!keyOf(s)) return fail(404, SAY.noQuoteKey);
        const list = [...new Set(String(q.get('symbols') || '').split(/[\s,]+/).map((t) => t.toUpperCase().trim()).filter(Boolean))];
        if (!list.length || list.length > 10) return fail(400, SAY.quoteMany);
        if (!list.every((t) => TICKER_RE.test(t))) return fail(400, SAY.badTicker);
        return ok({ quotes: list.map((t) => DEMO_QUOTES[t]).filter(Boolean), missing: list.filter((t) => !DEMO_QUOTES[t]), at: new Date().toISOString() });
      }
      if (sub === 'research' && init.method !== 'POST') {
        if (settings().debugResearch !== true) return fail(404, SAY.notFound);
        const d = store.docs.get('trade/research') || {};
        // The five beats by the names the Worker's research route gives them (worker/desk-run.js LENSES).
        const BEATS = ['Momentum and the tape', 'Catalysts', 'Macro and sectors', 'Swing structure', 'Options, volatility and risk'];
        return ok({
          runId: d.runId || null, at: iso(d.at),
          reports: BEATS.map((beat, i) => { const r = d[`r${i + 1}`]; return { n: i + 1, beat, status: r?.status || 'missing', text: r?.text || '', err: r?.err || '', ms: Number(r?.ms) || null }; }),
        });
      }
      if (init.method !== 'POST') return fail(404, SAY.notFound);
      if (sub === 'open') {
        // One open desk at a time, as the Worker: a second call is refused
        // with the open one's id, and the shelf walks into it.
        await beat(300);
        const s = settings();
        const cur = s.caseId ? store.docs.get(`cases/${s.caseId}`) : null;
        if (cur && cur.status !== 'closed') return fail(409, SAY.deskOpen, { existing: s.caseId });
        const desks = [...store.docs.keys()].filter((k) => /^cases\/demo-case-trade(-\d+)?$/.test(k)).length;
        const id = desks ? `demo-case-trade-${desks + 1}` : 'demo-case-trade';
        const now = new Date();
        store.docs.set(`cases/${id}`, {
          self: true, trade: true, clientUid: null, clientEmail: null, clientName: 'PR 420', clientDob: null,
          clientTz: 'America/Boise', clientPhone: null, clientAddress: null, status: 'confirmed', createdAt: now,
          bookingEmailSentAt: now, appointment: null,
          publicElection: { choice: 'private', history: [{ choice: 'private', at: now }] },
          addOnFollowUp: false, forms: {}, files: [], reportDueAt: null, caseRateCents: 0, addonRateCents: 0,
          fullAccess: true, fullAccessAt: now, fullAccessRateCents: 0, fullAccessMonths: 0, fullAccessByHand: true,
          stripe: null, work: { seconds: 0, startedAt: null }, hold: null, priorCases: [], carriedDx: [],
        });
        store.docs.set(`cases/${id}/advisor/state`, { trade: true, status: 'idle', priorCases: [], carriedDx: [], handovers: [], handoverStatus: null });
        store.docs.set('trade/settings', { ...s, caseId: id, openedAt: now, startedAt: s.startedAt || todayMT });
        store.persist?.();
        store.fire?.(`cases/${id}`);
        return ok({ ok: true, id, created: true });
      }
      if (sub === 'balance') {
        const date = body.date === undefined || body.date === '' ? todayMT : String(body.date).trim();
        if (!realDate(date) || date > todayMT) return fail(400, SAY.badDate);
        if (body.remove === true) {
          store.docs.delete(`trade/balances/items/${date}`);
          store.persist?.();
          return ok({ ok: true, removed: date });
        }
        const cents = Number(body.cents);
        if (!Number.isInteger(cents) || cents < 0 || cents >= 1e9) return fail(400, SAY.badCents);
        store.docs.set(`trade/balances/items/${date}`, { date, at: new Date(), cents, note: '', source: 'typed' });
        store.persist?.();
        return ok({ ok: true, balance: { cents, date, typed: true } });
      }
      if (sub === 'settings') {
        const s = settings();
        const patch = {};
        if (body.finnhubKey !== undefined) {
          const key = String(body.finnhubKey || '').trim();
          if (key && !/^[A-Za-z0-9_-]{16,64}$/.test(key)) return fail(400, SAY.badKey);
          patch.finnhubKey = key;
        }
        if (body.accountType !== undefined) {
          if (!['cash', 'margin'].includes(body.accountType)) return fail(400, SAY.badAccount);
          patch.accountType = body.accountType;
        }
        if (body.riskPct !== undefined) {
          const v = Number(body.riskPct);
          if (!Number.isFinite(v) || v < 0.1 || v > 5) return fail(400, SAY.badRisk);
          patch.riskPct = Math.round(v * 100) / 100;
        }
        if (body.watchlist !== undefined) {
          const raw = Array.isArray(body.watchlist) ? body.watchlist : String(body.watchlist || '').split(/[\s,]+/);
          const list = [...new Set(raw.map((t) => String(t || '').toUpperCase().trim()).filter(Boolean))];
          if (list.length > 20 || !list.every((t) => TICKER_RE.test(t))) return fail(400, SAY.badWatchlist);
          patch.watchlist = list.length ? list : DEFAULT_WATCHLIST;
        }
        if (body.pushOn !== undefined) patch.pushOn = body.pushOn === true;
        if (body.debugResearch !== undefined) patch.debugResearch = body.debugResearch === true;
        const next = { ...s, ...patch, updatedAt: new Date() };
        store.docs.set('trade/settings', next);
        store.persist?.();
        return ok({ ok: true, settings: pub(next) });
      }
      if (sub === 'take') {
        const id = String(body.id || '');
        const d = readRec(id);
        if (!d) return fail(404, SAY.noRec);
        if (d.status === 'took') return ok({ ok: true, rec: recRow(id, d) });
        if (d.status !== 'open') return fail(409, SAY.notOpen);
        const next = { ...d, status: 'took', tookAt: new Date() };
        store.docs.set(`trade/plays/items/${id}`, next);
        editActive((ids) => [...new Set([id, ...ids])].slice(0, 20));
        store.persist?.();
        return ok({ ok: true, rec: recRow(id, next) });
      }
      if (sub === 'result') {
        const id = String(body.id || '');
        const result = String(body.result || '');
        if (!['profit', 'loss'].includes(result)) return fail(400, SAY.badResult);
        const d = readRec(id);
        if (!d) return fail(404, SAY.noRec);
        if (d.status === 'closed' && d.result === result) return ok({ ok: true, rec: recRow(id, d) });
        if (d.status !== 'took') return fail(409, SAY.notTaken);
        const next = { ...d, status: 'closed', result, closedAt: new Date() };
        store.docs.set(`trade/plays/items/${id}`, next);
        editActive((ids) => ids.filter((x) => x !== id));
        store.persist?.();
        return ok({ ok: true, rec: recRow(id, next) });
      }
      // NO (2026-09-24): the Worker's tradeDecline. The position is remembered with its agreement.
      if (sub === 'decline') {
        const id = String(body.id || '');
        const d = readRec(id);
        if (!d) return fail(404, SAY.noRec);
        if (d.status !== 'open' && d.status !== 'declined') return fail(409, SAY.notDeclinable);
        const key = positionKey(d);
        const agreement = Math.max(0, Number(d.agreement) || 0);
        const next = d.status === 'open' ? { ...d, status: 'declined', declinedAt: new Date() } : d;
        store.docs.set(`trade/plays/items/${id}`, next);
        const st = tstate();
        store.docs.set('trade/state', { ...st, declined: { ...(st.declined || {}), [key]: { agreement, at: new Date(), recId: id } } });
        store.persist?.();
        return ok({ ok: true, rec: recRow(id, next), key, agreement });
      }
      // His own size (2026-09-23): the Worker's tradeAdjust, on the same planFor.
      if (sub === 'adjust') {
        const id = String(body.id || '');
        const d = readRec(id);
        if (!d) return fail(404, SAY.noRec);
        if (d.status !== 'open' && d.status !== 'took') return fail(409, SAY.notAdjustable);
        const legs = Array.isArray(d.mine?.legs) ? d.mine.legs : [];
        if (legs.length && body.reset === true) return fail(409, SAY.scaledNoReset);
        let mine = null;
        if (body.reset !== true) {
          const p = planFor({ rec: d, amountCents: body.amountCents, riskCents: body.riskCents, entry: legs.length ? d.mine.entry : null });
          if (!p.ok) return fail(400, p.why);
          mine = { amountCents: p.amountCents, riskCents: p.askedRiskCents, stop: p.stop, targets: p.targets, qty: p.qty, costCents: p.costCents, at: new Date() };
          if (legs.length) Object.assign(mine, { entry: d.mine.entry, legs });
        }
        const next = { ...d, mine };
        store.docs.set(`trade/plays/items/${id}`, next);
        store.persist?.();
        return ok({ ok: true, rec: recRow(id, next) });
      }
      // ADD/TRIM (2026-09-24): the Worker's tradeScale, on the same scalePosition.
      if (sub === 'scale') {
        const id = String(body.id || '');
        const d = readRec(id);
        if (!d) return fail(404, SAY.noRec);
        if (d.status !== 'took') return fail(409, SAY.notScalable);
        const s = settings();
        const bal = balanceOf(s);
        const p = scalePosition({ rec: d, kind: body.kind, amountCents: body.amountCents, contracts: body.contracts, price: body.price,
          riskCents: body.riskCents, accountCents: bal.typed ? bal.cents : 0, rules: { riskPct: riskOf(s) } });
        if (!p.ok) return fail(400, p.why);
        const legs = [...(Array.isArray(d.mine?.legs) ? d.mine.legs : []), { kind: p.kind, qty: p.changeQty, price: p.price, at: new Date() }].slice(-20);
        const mine = { amountCents: p.costCents, riskCents: p.askedRiskCents, stop: p.stop, targets: p.targets, qty: p.qty, costCents: p.costCents, entry: p.entry, legs, at: new Date() };
        const next = { ...d, mine };
        store.docs.set(`trade/plays/items/${id}`, next);
        store.persist?.();
        return ok({ ok: true, rec: recRow(id, next) });
      }
      // RUN TRADING DESK: queued at once, answered at once, and the stages
      // walk on a timer the way the cron walks them in production.
      if (sub === 'run') {
        const s0 = settings();
        if (!s0.caseId) return fail(404, SAY.noDesk);
        const st0 = tstate();
        if (BUSY_RUN.includes(st0.run?.status)) return ok({ ok: true, already: true, run: runBlock(st0.run) });
        const runId = `run-demo-${Date.now().toString(36)}`;
        const put = (patch) => {
          const st = tstate();
          if (st.run?.id !== runId) return false;
          store.docs.set('trade/state', { ...st, run: { ...st.run, ...patch } });
          store.persist?.();
          return true;
        };
        store.docs.set('trade/state', { ...st0, run: { id: runId, status: 'queued', trigger: 'manual', queuedAt: new Date(), done: 0, attempt: 0 } });
        store.persist?.();
        setTimeout(() => put({ status: 'researching', startedAt: new Date(), claimedAt: new Date(), done: 0 }), 900);
        for (let n = 1; n <= 5; n++) setTimeout(() => put({ done: n }), 900 + n * 650);
        // The handover and the desk's claim, as the cron does them a firing apart.
        setTimeout(() => put({ status: 'decide', decideAt: new Date() }), 900 + 5 * 650 + 150);
        setTimeout(() => put({ status: 'deciding', claimedAt: new Date() }), 900 + 5 * 650 + 700);
        setTimeout(() => {
          const st = tstate();
          if (st.run?.id !== runId) return;
          const now = Date.now();
          // What the last run left open is expired, as the Worker's fileRecs does.
          for (const id of st.desk?.ids || []) {
            const d = readRec(id);
            if (d && d.status === 'open') store.docs.set(`trade/plays/items/${id}`, { ...d, status: 'expired', expiredAt: new Date(now) });
          }
          const expiry = (days) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Boise' }).format(new Date(now + days * 86_400_000));
          const FRESH = [
            { horizon: 'intraday', ticker: 'QQQ', side: 'long', instrument: 'stock', entryLow: 497.6, entryHigh: 498.2, stop: 495.9, targets: [501.5, 504], holdMinutes: 180, allocPct: 30, profitLow: 55, profitHigh: 63, agreement: 4, lastPrice: 498.1, priceNow: 498.1,
              setup: 'Broke the opening range and held it on the retest, with volume rising into the break.', catalyst: 'Semis leading after the guidance raise.', invalidation: 'A close back under 496 on volume.' },
            { horizon: 'swing', ticker: 'MU', side: 'long', instrument: 'stock', entryLow: 118.2, entryHigh: 119, stop: 113.9, targets: [126, 131], holdDays: 3, allocPct: 22, profitLow: 51, profitHigh: 60, agreement: 3, lastPrice: 118.7, priceNow: 118.7,
              setup: 'Beat on memory pricing before the open and is basing above the gap.', catalyst: 'Earnings beat and a raised outlook this morning.', invalidation: 'Filling the gap below 114.' },
            { horizon: 'scalp', ticker: 'AMD', side: 'long', instrument: 'call', strike: 170, expiry: expiry(2), entryLow: 2.05, entryHigh: 2.2, stop: 1.6, targets: [2.9, 3.4], holdMinutes: 15, allocPct: 12, profitLow: 52, profitHigh: 59, agreement: 3, lastPrice: 168.4,
              setup: 'Pressing the day high at 169 with the supply news behind it.', catalyst: 'Supply agreement reported before the open.', invalidation: 'Losing 167.8, the morning low of the push.' },
          ];
          // THE RE-CHECK, as the Worker's run does it (2026-09-24). The demo has no researchers, so their
          // count is stood in for: a held position the run brings again takes that trade's count, and the
          // demo's own table does the rest. HOLD or SELL (v7.12) follows the count, SOFI at none of the five
          // so a SELL can be seen; nothing leaves his list until he marks it.
          const DEMO_BACKING = { PLTR: 3, SOFI: 0 };
          const verdicts = [];
          for (const hid of tstate().activeIds || []) {
            const d = readRec(hid);
            if (!d || d.status !== 'took') continue;
            const again = FRESH.find((t) => positionKey(t) === positionKey(d));
            const backs = again ? again.agreement : DEMO_BACKING[d.ticker];
            if (backs == null) continue;
            const call = backs >= 3 ? 'hold' : 'sell';
            const why = backs === 0 ? 'None of the five back it any more.' : call === 'hold' ? 'Still holding its level with volume behind it.' : 'Lost the level it was built on.';
            store.docs.set(`trade/plays/items/${hid}`, { ...d, agreement: backs, agreedAt: new Date(now), agreedRunId: runId, tookAgreement: d.tookAgreement ?? d.agreement ?? null, verdict: { call, why, at: new Date(now), runId } });
            verdicts.push({ ticker: d.ticker, horizon: d.horizon, side: d.side, instrument: d.instrument, call, why });
          }
          verdicts.sort((a, b) => (b.call === 'sell') - (a.call === 'sell'));
          // Screened as the Worker's desk firing screens them: against what he holds and what he passed on.
          const held = (tstate().activeIds || []).map((x) => readRec(x)).filter((d) => d && d.status === 'took').map(positionKey);
          const { keep } = screenTrades(FRESH, { held, declined: tstate().declined || {} });
          const ids = [];
          keep.forEach((t, i) => {
            const id = `${runId}-${i + 1}`;
            ids.push(id);
            const hold = t.horizon === 'swing' ? 3 * 86_400_000 : t.horizon === 'scalp' ? 2 * 3600_000 : 4 * 3600_000;
            store.docs.set(`trade/plays/items/${id}`, {
              ...t, entry: Math.round(((t.entryLow + t.entryHigh) / 2) * 10000) / 10000, runId, slot: i + 1, caseId: s0.caseId,
              at: new Date(now), priceAt: new Date(now), status: 'open', expiresAt: new Date(now + hold), tookAt: null, closedAt: null, result: null,
            });
          });
          store.docs.set('trade/research', {
            runId, at: new Date(now),
            ...Object.fromEntries([1, 2, 3, 4, 5].map((n) => [`r${n}`, { status: 'ok', ms: 60_000 + n * 9000, text: `Report ${n}: the tape, the names worth a look and why, with levels.` }])),
          });
          store.docs.set('trade/state', {
            ...tstate(),
            run: { ...st.run, status: 'idle', finishedAt: new Date(now), count: ids.length, error: null, done: 5 },
            desk: {
              runId, at: new Date(now), trigger: 'manual', count: ids.length, reports: 5, ids, none: '', verdicts,
              read: 'Semis are leading and the index is holding its opening range on better volume than yesterday. Buy strength that holds a retest; skip anything extended.',
              news: [
                { headline: 'Micron beats on memory pricing and raises its outlook', why: 'Fuel for the whole chip group today, and the reason MU is on the board.', tickers: ['MU', 'NVDA'] },
                { headline: 'Ten year yield steady ahead of the auction', why: 'A quiet bond market lets the morning trend run.', tickers: ['QQQ'] },
              ],
            },
          });
          store.persist?.();
        }, 900 + 5 * 650 + 1500);
        return ok({ ok: true, already: false, run: runBlock(tstate().run) });
      }
      return fail(404, SAY.notFound);
    }

    // ---- the advisor, from a fixture -------------------------------------
    if (path === '/api/advisor/state') {
      // Whichever case is open, not always the first one: the Full Access
      // case carries its own assessment and its own appeal letter, and
      // hardcoding the id showed the wrong case's work on the right case's
      // page.
      const cid = q.get('id') || body.id || DEMO_CASE_ID;
      let state = store.docs.get(`cases/${cid}/advisor/state`) || {};
      // The trade desk (2026-09-22): its own block, the trading half of the
      // dictionary, and a desk answer to a desk question.
      const isTrade = !!(state.trade || store.docs.get(`cases/${cid}`)?.trade);
      // A handover queued a few seconds ago lands now (2026-09-05): the
      // demo's stand-in for the Worker's drain writing the brief.
      if (state.handoverStatus === 'running' && Array.isArray(state.handoverPending)
        && Date.now() - new Date(state.handoverQueuedAt || 0).getTime() > 2500) {
        state = {
          ...state,
          handovers: state.handoverPending.map((h) => ({ ...h, at: new Date(), brief: DEMO_BRIEF })),
          handoverPending: [],
          handoverStatus: 'ready',
        };
        store.docs.set(`cases/${cid}/advisor/state`, state);
        store.persist?.();
      }
      // A draft asked for a few seconds ago lands now (2026-09-06), the same
      // way: the demo's stand-in for the Worker writing it.
      if (state.draftStatus === 'running' && typeof state.draftPending === 'string'
        && Date.now() - new Date(state.draftQueuedAt || 0).getTime() > 2500) {
        state = {
          ...state,
          draft: state.draftPending, draftStatus: 'ready', draftError: null, draftAt: new Date(),
          draftStartedAt: null, draftProgressAt: null, draftPending: null,
        };
        store.docs.set(`cases/${cid}/advisor/state`, state);
        store.persist?.();
      }
      // A question asked a few seconds ago lands now (2026-09-07), the same
      // way the draft does: the demo's stand-in for the poll collecting the
      // batch. Newest first, as the Worker hands them back.
      const qaPrefix = `cases/${cid}/advisor/state/qa/`;
      for (const [p, d] of [...store.docs.entries()]) {
        if (!p.startsWith(qaPrefix) || d.status !== 'running') continue;
        if (Date.now() - new Date(d.at || 0).getTime() < 4000) continue;
        let answer = 'I would give the clinic until Thursday before chasing it, because the fax went Monday and their intake takes three working days to log anything. If nothing is on the portal by then, I would call the department directly rather than the main line, since that is who actually holds the referral. You have what you need for the call; the next move is theirs.';
        let doc = null;
        if (isTrade) {
          answer = d.file
            ? 'Your positions are NVDA and SPY, both above their stops. NVDA is holding 650 on volume; the next level I would watch is 652, and a break of 648 ends it. SPY is drifting on light volume with 570 under it; nothing to do there until 573 or 570 breaks.'
            : 'NVDA is holding above the opening range on twice its normal volume, so the long side is the side with the wind. The 650 to 655 call debit spread for this Friday costs about 2.10 and pays 5.00 at 655 by the close. The trade is invalidated on a break back below 648 on the stock. Chance of profit 55 to 62%. At 2 contracts the risk is $420, about 2% of the account.';
          // A portfolio total on the screenshot becomes that day's balance
          // unless he typed one, as the Worker's finishQuestion does it.
          if (d.file) {
            const today = deskToday();
            const cur = store.docs.get(`trade/balances/items/${today}`);
            if (!cur || cur.source === 'screenshot') {
              store.docs.set(`trade/balances/items/${today}`, { date: today, at: new Date(), cents: 241000, note: 'from a screenshot', source: 'screenshot' });
              deskRefreshStanding(store);
              answer += `\n\nLogged $2,410.00 as the balance for ${today}.`;
            } else {
              answer += `\n\nYou typed a balance for ${today}, so the screenshot's total was not logged over it.`;
            }
          }
          // THE DESK MAKES A PDF (2026-09-22): asked for a document, the demo
          // builds a real one with the writer the Worker uses, files it where
          // the Uploads page looks, and hangs the link under the answer. A data
          // URL, so the file survives a reload; the first write to store.files
          // from this mirror.
          if (!d.file && /\b(pdf|document|sheet|playbook|checklist|write.?up|print)\b/i.test(d.question || '')) {
            const lines = [
              'Every entry has a stop before the order goes in.', '',
              '# Sizing', '- Size to the stop, never to the target.', '- Options: the whole premium is the risk, so size as if it goes to zero.', '',
              '# Adds and exits', '- No adds to a loser.', '- The 10:30 bar decides the morning: a setup that has not worked by then is closed.', '- A target hit is a sale, not a hold for more.', '',
              '# Before the open', '- Check the spread on the options before the order.', '- Write the exit plan in the log before the entry.',
            ];
            const bytes = textPdf(lines, { title: 'Rules to hold', footer: `Trade desk · ${deskToday()} · Ideas, not orders. Every trade is your decision.` });
            let bin = '';
            for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
            const url = `data:application/pdf;base64,${btoa(bin)}`;
            const path = `cases/${cid}/report/${Date.now()}-Rules to hold.pdf`;
            const at = new Date().toISOString();
            store.files.set(path, { name: 'Rules to hold.pdf', type: 'application/pdf', size: bytes.length, at, url, persisted: true });
            doc = { name: 'Rules to hold.pdf', path, url, size: bytes.length, at };
            answer = 'Your rules to hold, on one page: every entry has a stop before the order goes in, size to the stop and never to the target, no adds to a loser, and the 10:30 bar decides the morning.\n\nFiled as Rules to hold.pdf on Uploads.';
          }
        }
        store.docs.set(p, { ...d, status: 'done', batch: null, answer, ...(doc ? { doc } : {}) });
        store.persist?.();
      }
      const qaRows = [...store.docs.entries()]
        .filter(([p]) => p.startsWith(qaPrefix))
        .map(([, d]) => d)
        .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
      const style = store.docs.get('advisorStyle/profile') || {};
      const notes = store.docs.get(`cases/${cid}/private/notes/doc`) || {};
      const { readFiles, pendingMedia, ...panelState } = state;
      void readFiles; void pendingMedia;
      return ok({
        state: panelState,
        qa: qaRows,
        // The desk sees the trading half of the dictionary and every other
        // case the medical half (2026-09-22), as the Worker filters it.
        glossary: [...store.docs.entries()]
          .filter(([p, d]) => p.startsWith('advisorKnowledge/') && TRADE_CATS.includes(d.category || 'General') === isTrade)
          .map(([p, d]) => ({ id: p.split('/').pop(), ...d, learned: !!d.learnedAt })),
        trade: isTrade ? deskPanelBlock(store) : null,
        keyConfigured: true,
        notes: notes.html || '',
        notesUpdatedAt: notes.updatedAt || null,
        workingLine: state.workingDx || '',
        dxOverride: null,
        differential: state.differential || [],
        // The two lists under the differential on his own case (2026-09-05).
        causes: state.causes || [],
        treatments: state.treatments || [],
        corrections: (state.corrections || []).filter((c) => !c.dismissed),
        unanswered: (state.unanswered || []).filter((r) => !r.answered),
        mediaReport: state.mediaReport || null,
        queuedFiles: [],
        about: {
          voice: style.voice || '',
          stances: style.stances || '',
          coaching: style.coaching || '',
          updatedAt: style.updatedAt || null,
        },
      });
    }
    if (path === '/api/advisor') {
      // Whichever case the caller named. The state ROUTE reads per-case and
      // the appeal/call-notes branches write per-case; these five writing to
      // the fixture regardless meant that on the freshly booked case,
      // Analyze kicked the wrong doc (the button read as broken) and Eric's
      // private notes saved onto the wrong client.
      const cid = body.id || DEMO_CASE_ID;
      const state = store.docs.get(`cases/${cid}/advisor/state`) || {};
      if (body.action === 'analyze') {
        // A visible run, so the progress bar and the running state are real
        // things he can watch, then the same sections settle back.
        store.docs.set(`cases/${cid}/advisor/state`, {
          ...state, status: 'running', startedAt: new Date(), progressAt: new Date(),
        });
        setTimeout(() => {
          store.docs.set(`cases/${cid}/advisor/state`, {
            ...state, status: 'idle', updatedAt: new Date(),
          });
          // His own case: the read's questions land in his chat, one bubble
          // each, once (2026-09-03). Mirrors askInChat in the Worker.
          const c = store.docs.get(`cases/${cid}`) || {};
          const asked = [...store.docs.keys()].some((k) => k.startsWith(`cases/${cid}/chat/`) && store.docs.get(k)?.role === 'question');
          // Never on the desk (Eric, 2026-09-22): the trade log is his to
          // write in, so the reading puts nothing into it.
          if (c.self && !c.trade && !asked) {
            const qs = [
              'What time did the tremor start today, and is it the right hand only?',
              'How many hours did you sleep last night, and did you wake with a headache?',
            ];
            for (const q of qs) {
              const p = `cases/${cid}/chat/q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
              store.docs.set(p, { from: 'reading', role: 'question', text: q, ts: new Date(), askedAt: new Date() });
              store.fire?.(p);
            }
          }
        }, 4000);
        return ok({ ok: true });
      }
      if (body.action === 'dx') {
        store.docs.set(`cases/${cid}/advisor/state`, {
          ...state, dxOverride: body.text || null, dxOverrideAt: new Date(),
        });
        return ok({ ok: true });
      }
      // A question (2026-09-07, "The server answered with something this
      // page could not read"): the row is written running with a batch on
      // it, exactly as the Worker submits one, and the state route lands the
      // answer a few seconds later, the demo's stand-in for the poll.
      if (body.action === 'ask') {
        const question = String(body.question || '').trim();
        if (!question) return fail(400, 'Ask something, up to 2000 characters.');
        const qid = `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        store.docs.set(`cases/${cid}/advisor/state/qa/${qid}`, {
          question, answer: null, status: 'running', at: new Date(), progressAt: new Date(),
          batch: { batchId: 'demo-batch', submittedAt: new Date() },
          ...(body.attachment?.name ? { file: body.attachment.name } : {}),
        });
        store.persist?.();
        return ok({ ok: true });
      }
      // Prepare a response (2026-09-06, "Drafting has stopped working"): the
      // demo used to answer a bare ok and nothing ever landed, which is the
      // one thing the real button must never do. The run is marked, and the
      // state route lands the draft a few seconds later (a timer would die
      // with the page). His own case refuses, exactly as the Worker does.
      if (body.action === 'draft') {
        const c = store.docs.get(`cases/${cid}`) || {};
        if (c.self) return fail(409, 'Your own case has nobody to write to.');
        const rough = String(body.instruction || '').trim();
        store.docs.set(`cases/${cid}/advisor/state`, {
          ...state,
          draftStatus: 'running', draftError: null, draftStartedAt: new Date(), draftProgressAt: new Date(),
          draftPending: rough
            ? `${rough}\n\nI will have the referral chased by Thursday and I will tell you what they say the same day. If anything in that is wrong, tell me and I will fix it before it goes anywhere.`
            : 'Thanks for sending those through. I have read all three, and the discharge summary says more than anyone told you at the time. I will walk you through it on our call, and I am chasing the referral that was mentioned but never confirmed. Nothing for you to do today.',
          draftQueuedAt: new Date(),
        });
        store.persist?.();
        return ok({ ok: true });
      }
      if (body.action === 'unanswered-answered') {
        const flat = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
        store.docs.set(`cases/${cid}/advisor/state`, {
          ...state,
          unanswered: (state.unanswered || []).map((r) => ({
            ...r, answered: flat(r.ask) === flat(body.ask) ? true : r.answered,
          })),
        });
        return ok({ ok: true });
      }
      if (body.action === 'correction-dismiss') {
        store.docs.set(`cases/${cid}/advisor/state`, {
          ...state,
          corrections: (state.corrections || []).map((c) => ({
            ...c, dismissed: c.msgId === body.msgId ? true : c.dismissed,
          })),
        });
        return ok({ ok: true });
      }
      if (body.action === 'note') {
        store.docs.set(`cases/${cid}/private/notes/doc`, {
          html: body.html || '', updatedAt: new Date(),
        });
        return ok({ ok: true });
      }
      // The appeal workbench. Without a branch here the buttons answer a bare
      // ok, the state never moves, and the page looks broken rather than
      // demonstrative.
      if (body.action === 'appeal-draft') {
        await beat(900);
        const path = `cases/${body.id || DEMO_CASE_ID}/advisor/state`;
        store.docs.set(path, {
          ...(store.docs.get(path) || {}),
          appealStatus: 'ready',
          appealAt: new Date(),
          appeal: `RE: Demo Member | ID DEMO-1 | claim 44821 | dates of service 12 Jun 2026\n\n1. WHAT WAS DENIED AND WHY\nThe plan denied the study as not medically necessary, citing policy MP-114.\n\n2. WHY THAT REASON DOES NOT APPLY HERE\nMP-114 requires two documented failed conservative measures. The record shows both, on 3 Feb and 19 Apr, each with the ordering clinician named.\n\n3. WHAT IS REQUESTED\nOverturn and pay, a peer to peer review, and the reviewer's specialty and credentials.\n\n[NEEDS: the denial letter's reference number]\n\nThis is demonstration text.`,
          appealMeta: {
            planName: 'Demo Health', memberId: 'DEMO-1', claimNumber: '44821',
            trackLabel: 'Commercial or employer plan, internal appeal',
            dueAt: new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10),
          },
        });
        store.fire?.(path);
        return ok({ ok: true });
      }
      if (body.action === 'clear-appeal' || body.action === 'appeal-filed') {
        const path = `cases/${body.id || DEMO_CASE_ID}/advisor/state`;
        const cur = store.docs.get(path) || {};
        store.docs.set(path, body.action === 'clear-appeal'
          ? { ...cur, appeal: null, appealStatus: null, appealMeta: null }
          : { ...cur, appealMeta: { ...(cur.appealMeta || {}), filedAt: new Date() } });
        store.fire?.(path);
        return ok({ ok: true });
      }
      // Notes for the call. Same reason as the appeal: without a branch the
      // Draft button answers a bare ok, the state never moves, and the panel
      // looks broken rather than demonstrative. The bracket line is there on
      // purpose so the PDF's visual frame can be seen from the demo too.
      if (body.action === 'call-notes') {
        await beat(900);
        const path = `cases/${body.id || DEMO_CASE_ID}/advisor/state`;
        const cur = store.docs.get(path) || {};
        const notes = body.revise
          ? `${body.base || cur.callNotes || ''}\n\n(Revised for the demo per your note: "${String(body.instruction || '').slice(0, 120)}")`
          : [
            'ACTION PLAN',
            '1. Get the endocrinology referral moving at the university center. Highest impact, longest wait.',
            '2. Ask the PCP office to resend the February labs with the fax confirmation attached.',
            '3. Book the blood draw before the visit so the results arrive first.',
            '',
            '[Line chart: TSH results across the last six months]',
            '',
            'THE PITCH',
            '"Jordan, the next sixty days are the heavy lift on this case. If you want me on every call and every portal message while that happens, the Full-Service Case Management tier covers exactly that. You have seen this week what it looks like."',
            '',
            'RESOURCES NEARBY',
            'University Medical Center, endocrinology and rheumatology, about 15 minutes out (verify current wait times).',
            'The teaching hospital second opinion clinic takes outside records by portal upload (verify).',
            '',
            'WORTH REMEMBERING',
            'He answers fastest by text before noon.',
            'This is demonstration text.',
          ].join('\n');
        store.docs.set(path, {
          ...cur, callNotes: notes, callNotesStatus: 'ready',
          callNotesAt: new Date(), callNotesError: null,
        });
        // fire() persists too - without it the drafted notes lived only in
        // this tab's memory and vanished on the next navigation.
        store.fire?.(path);
        return ok({ ok: true });
      }
      // The call document (Eric, 2026-08-26). Mirrored so the demo shows the
      // real shape: the flagged lines gathered first, his document reformatted
      // into call order, the questions he did not ask, what the case adds, and
      // sources. The asterisks are the point of the feature, so the fixture
      // carries several.
      if (body.action === 'call-doc') {
        const path = `cases/${body.id || DEMO_CASE_ID}/advisor/state`;
        const names = (body.sources || []).map((a) => a.name).filter(Boolean);
        // THROUGH 'running' FIRST, which this used to skip entirely: it waited
        // 1400ms and wrote 'ready'. So the running state, the stall rule, the
        // heartbeat and "your current document stays up while the new one
        // builds" had never been exercised by any test in the repo - the one
        // path where a real run spends minutes was the one the demo could not
        // show. Keep the wait short; the point is that the state EXISTS.
        {
          const cur0 = store.docs.get(path) || {};
          store.docs.set(path, {
            ...cur0,
            callDocStatus: 'running',
            callDocStartedAt: new Date(),
            callDocProgressAt: new Date(),
            callDocError: null,
          });
          store.fire?.(path);
        }
        // Longer than one poll of the panel (2.5s while busy), so the
        // running state is actually OBSERVABLE. At 1400ms the demo finished
        // before the panel ever looked, so "your document stays up while the
        // new one builds" could not be seen or tested even once the state
        // existed. A real run takes minutes; four seconds is the smallest
        // number that tells the truth about the shape of it.
        await beat(4000);
        const cur = store.docs.get(path) || {};
        // THE SEEDED CASE, not another one. This fixture used to describe a
        // thyroid patient - TSH 6.8, levothyroxine, an endocrinology referral,
        // a February panel - while the demo client is Jordan Avery: two years
        // of moving joint pain, a MARCH serology panel, a rash on the hands,
        // and a RHEUMATOLOGY referral. It was the only worked example of this
        // feature anywhere in the repo, and it was about somebody else.
        //
        // It also carried the error it was demonstrating: it claimed "the week
        // after my birthday" resolved to March 11, while the seeded date of
        // birth is 1988-03-14. The sample proving the feature catches drifting
        // dates had a drifting date in it.
        //
        // Exactly three numbered flags, which is what the panel's count reads.
        const doc = body.revise
          ? `${body.base || cur.callDoc || ''}\n\n(Revised for the demo per your note: "${String(body.instruction || '').slice(0, 120)}")`
          : [
            'REVIEW BEFORE YOU CALL',
            '1. *The March panel result is quoted from her memory of a phone call, not from the panel. She has never been sent it. Do not repeat a number back to her as fact.',
            '2. *Your document dates the hospital visit to March 4; the chat says "the week after my birthday", and her birthday is March 14. One of the two is wrong.',
            '3. *"Referral was made" is your inference. The record says the second doctor mentioned it, and nothing says it was sent.',
            '',
            'THE CALL, IN ORDER',
            'Open with the referral, because it is the longest clock.',
            '  Rheumatology, raised by the second doctor, never confirmed sent.',
            '  Ask: "Did anyone ever call you to book rheumatology?"',
            '  If no: the practice sends it again, and you want the referral number.',
            '',
            'Then the March panel.',
            '  She was told it was normal. She has never seen it.',
            '  What you want is the values AND the reference ranges, not the word normal.',
            '',
            '[Line chart: her recorded joint pain against the dates of each appointment]',
            '',
            'QUESTIONS THAT ARE MISSING',
            '"When the rash comes up, does anything else change with it, the same week?" The photographs are dated but nothing says what else was happening.',
            '"Has anyone repeated the panel since March?" It is mentioned once at intake and never again.',
            '',
            'FROM THE CASE, NOT IN YOUR DOCUMENT',
            'She has been photographing the rash herself since before the March visit. Your document does not mention the photographs at all, and they are the only dated evidence in the file.',
            'The discharge summary she uploaded covers the March visit your document dates to the 4th. It is the document that settles flag 2.',
            '',
            'SOURCES',
            'March panel: her account in chat, 4 days ago. No document in the file.',
            'Hospital visit date: your document, page 1; contradicted by chat, 2 days ago.',
            'Rash photographs: case uploads, staged with the discharge summary.',
            'Referral: chat, 4 days ago, "the second doctor mentioned".',
            '',
            'This is demonstration text.',
          ].join('\n');
        store.docs.set(path, {
          ...cur,
          callDoc: doc,
          callDocStatus: 'ready',
          callDocAt: new Date(),
          callDocError: null,
          callDocStartedAt: null,
          callDocProgressAt: null,
          callDocSources: names,
          callDocSkipped: [],
        });
        store.fire?.(path);
        return ok({ ok: true });
      }
      if (body.action === 'clear-call-doc') {
        const path = `cases/${body.id || DEMO_CASE_ID}/advisor/state`;
        const cur = store.docs.get(path) || {};
        store.docs.set(path, {
          ...cur, callDoc: null, callDocStatus: null, callDocAt: null,
          callDocError: null, callDocSources: null, callDocSkipped: null,
        });
        store.fire?.(path);
        return ok({ ok: true });
      }
      if (body.action === 'clear-call-notes') {
        const path = `cases/${body.id || DEMO_CASE_ID}/advisor/state`;
        const cur = store.docs.get(path) || {};
        store.docs.set(path, {
          ...cur, callNotes: null, callNotesStatus: null,
          callNotesAt: null, callNotesError: null,
        });
        store.fire?.(path);
        return ok({ ok: true });
      }
      await beat(700);
      return ok({ ok: true });
    }
    if (path === '/api/advisor/covers') {
      const covers = { [DEMO_CASE_ID]: { text: 'Two years unexplained, bloods never actually seen', by: 'advisor', at: new Date() } };
      // The trade desk's cover and its standing line (2026-09-22), from the
      // mirror the Worker keeps on caseMeta.
      for (const [k, v] of store.docs.entries()) {
        if (!k.startsWith('caseMeta/')) continue;
        covers[k.slice('caseMeta/'.length)] = { text: v.workingDx?.text || '', by: v.workingDx?.by || 'advisor', at: { advisor: v.advisorAt || null }, tradeStanding: v.tradeStanding?.text || '' };
      }
      return ok({ covers });
    }
    // The dictionary page reads the same terms the reading paints (2026-09-06):
    // an empty list here meant a tapped term could never land anywhere in
    // the demo, so the door could not be driven.
    if (path === '/api/advisor/dictionary') {
      if (init.method === 'POST') {
        const p = `advisorKnowledge/${body.termId}`;
        const t = store.docs.get(p);
        if (t) { store.docs.set(p, { ...t, learnedAt: body.learned ? new Date() : null }); store.persist?.(); }
        return ok({ ok: true });
      }
      return ok({
        terms: [...store.docs.entries()]
          .filter(([p]) => p.startsWith('advisorKnowledge/'))
          .map(([p, d]) => ({
            id: p.split('/').pop(), term: d.term, definition: d.definition,
            category: d.category || 'General', learned: !!d.learnedAt, learnedVia: d.learnedVia || null,
          })),
      });
    }

    // ---- one day, read back ----------------------------------------------
    if (path === '/api/summary') {
      await beat(900);
      return ok({ day: body.day, text: SUMMARY, cached: false });
    }

    // ---- saved messages ---------------------------------------------------
    // Per-case, like the routes it serves: hardcoding the fixture id meant a
    // save on the booked case landed under the fixture and listed there.
    if (path === '/api/saved') {
      const uid = role === 'admin' ? 'demo-admin' : 'demo-client';
      const sc = body.id || q.get('id') || DEMO_CASE_ID;
      const base = `cases/${sc}/private/saved/${uid}`;
      if (!init.method || init.method === 'GET') {
        return ok({
          saved: [...store.docs.entries()]
            .filter(([p]) => p.startsWith(`${base}/`))
            .map(([p, d]) => ({ msgId: p.split('/').pop(), ...d })),
        });
      }
      const at = `${base}/${body.msgId}`;
      if (body.delete) { store.docs.delete(at); return ok({ ok: true }); }
      const msg = store.docs.get(`cases/${sc}/chat/${body.msgId}`) || {};
      store.docs.set(at, {
        text: msg.text || '', role: msg.role || 'client',
        sentAt: msg.ts || null, note: body.note || '',
        savedAt: store.docs.get(at)?.savedAt || new Date(),
      });
      return ok({ ok: true, msgId: body.msgId });
    }

    // ---- the next-call agenda + the chat-hours meter ----------------------
    if (path === '/api/agenda') {
      const base = `cases/${body.id || q.get('id') || DEMO_CASE_ID}/agenda`;
      const list = () => [...store.docs.entries()]
        .filter(([p]) => p.startsWith(`${base}/`))
        .map(([p, d]) => ({ id: p.split('/').pop(), ...d }))
        .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
      if (!init.method || init.method === 'GET') return ok({ items: list() });
      if (body.action === 'add') {
        const id = `a${Date.now()}`;
        const item = {
          text: String(body.text || '').slice(0, 500),
          by: role === 'admin' ? 'demo-admin' : 'demo-client',
          // Normalised: the seamless door's role string is '1', and storing
          // it raw hid the Remove button (case.js gates on role === 'client').
          role: role === 'admin' ? 'admin' : 'client',
          at: new Date(), done: false, doneAt: null,
        };
        store.docs.set(`${base}/${id}`, item);
        return ok({ ok: true, item: { id, ...item } });
      }
      if (body.action === 'done') {
        const it = store.docs.get(`${base}/${body.itemId}`);
        if (it) {
          store.docs.set(`${base}/${body.itemId}`, {
            ...it, done: body.done !== false, doneAt: body.done !== false ? new Date() : null,
          });
        }
        return ok({ ok: true });
      }
      if (body.action === 'remove') { store.docs.delete(`${base}/${body.itemId}`); return ok({ ok: true }); }
      if (body.action === 'clear') {
        for (const it of list().filter((x) => x.done)) store.docs.delete(`${base}/${it.id}`);
        return ok({ ok: true });
      }
      return ok({ ok: true });
    }
    if (path === '/api/chattime') {
      demoChatSecs += Math.max(0, Math.min(120, Number(body.seconds) || 0));
      return ok({ total: demoChatSecs });
    }

    // ---- the ledger + file deletion ---------------------------------------
    if (path === '/api/admin/ledger') {
      // Every case, not the one fixture: the shelf's revenue tile sums them
      // all, and two money numbers on adjacent screens must not disagree.
      const byClient = new Map();
      for (const [key, c] of store.docs) {
        if (!key.startsWith('cases/') || key.slice(6).includes('/')) continue;
        let paid = Number(c.stripe?.amountTotal) || Number(c.caseRateCents) || 0;
        let tips = 0;
        for (const pmt of (Array.isArray(c.extraPayments) ? c.extraPayments : [])) {
          if (pmt?.kind === 'tip') tips += Number(pmt.amountCents) || 0;
          else paid += Number(pmt.amountCents) || 0;
        }
        const name = c.clientName || 'Client';
        const row = byClient.get(name) || { name, paidCents: 0, tipCents: 0, cases: 0 };
        row.paidCents += paid; row.tipCents += tips; row.cases += 1;
        byClient.set(name, row);
      }
      const clients = [...byClient.values()];
      // A little tip on the demo books, so the column shows its job.
      if (clients.length && !clients.some((r) => r.tipCents)) clients[0].tipCents = 2500;
      return ok({
        clients,
        totals: {
          paidCents: clients.reduce((s, r) => s + r.paidCents, 0),
          tipCents: clients.reduce((s, r) => s + r.tipCents, 0),
        },
      });
    }
    if (path === '/api/file/delete') {
      if (typeof body.path === 'string') { store.files.delete(body.path); store.fire?.(body.path); }
      return ok({ ok: true });
    }
    // Renaming a file, and filing it. Eric drives the demo himself, and a shim
    // that could not carry a new name or a new label would show him a long
    // press that appears to do nothing.
    //
    // MIRRORED, NOT APPROXIMATED. Where this file has ever been KINDER than
    // the Worker it has hidden a real refusal, so the admin-only 404, the
    // folder check that keeps the client's own shelf out of it, and the
    // refusal of a document type the server does not know are all repeated
    // here rather than assumed.
    // PERSONAL UPLOADS (2026-09-03), mirrored: the same three verbs, the
    // same prefix shape under a demo uid, bytes kept as object URLs so a
    // tap opens what he picked. Admin only, like the real thing.
    if (path === '/api/admin/personal') {
      if (role !== 'admin') return fail(404, 'Not found');
      const uid = 'demo-admin';
      const prefixOf = (scope, caseId) => {
        if (scope === 'case') {
          if (!/^[\w-]{1,64}$/.test(caseId || '')) throw new Error('Bad case id');
          return `personal/${uid}/case/${caseId}/`;
        }
        if (scope !== 'all') throw new Error('Bad scope');
        return `personal/${uid}/all/`;
      };
      const method = (init.method || 'GET').toUpperCase();
      if (method === 'GET') {
        const u = new URL(String(typeof input === 'string' ? input : input.url), location.origin);
        let prefix;
        try { prefix = prefixOf(u.searchParams.get('scope') || 'all', u.searchParams.get('caseId') || ''); } catch (e) { return fail(400, e.message); }
        const files = [...store.files.entries()]
          .filter(([k]) => k.startsWith(prefix) && k.slice(prefix.length).indexOf('/') < 0)
          .map(([k, f]) => ({ name: f.name, path: k, contentType: f.type, size: f.size, at: new Date(f.at).getTime(), url: f.url }))
          .sort((a, b) => b.at - a.at);
        return ok({ files });
      }
      if (method === 'POST') {
        const h = new Headers(init.headers || {});
        let prefix;
        try { prefix = prefixOf(h.get('x-pa-scope') || 'all', h.get('x-pa-case') || ''); } catch (e) { return fail(400, e.message); }
        const blob = init.body;
        const size = blob?.size || 0;
        if (!size) return fail(400, 'Empty file.');
        if (size > 50 * 1024 * 1024) return fail(413, 'That file is over 50 MB.');
        let name = 'file';
        try { name = decodeURIComponent(h.get('x-pa-name') || '') || 'file'; } catch { /* keep */ }
        const key = `${prefix}${Date.now()}-${name.replace(/[/\\]+/g, ' ').slice(0, 80)}`;
        let url = '';
        try { url = URL.createObjectURL(blob); } catch { /* no preview */ }
        const row = { name, type: blob.type || h.get('content-type') || '', size, at: new Date().toISOString(), url, meta: null };
        store.files.set(key, row);
        store.persist?.();
        return ok({ ok: true, file: { name, path: key, contentType: row.type, size, at: Date.now(), url } });
      }
      if (method === 'DELETE') {
        const target = String(body.path || '');
        if (!target.startsWith(`personal/${uid}/`) || target.includes('..')) return fail(400, 'Bad path');
        store.files.delete(target);
        store.persist?.();
        return ok({ ok: true });
      }
      return fail(404, 'Not found');
    }
    if (path === '/api/file/meta') {
      if (role !== 'admin') return fail(404, 'Not found');
      const target = String(body.path || '');
      if (!/^(cases|subscriptions)\/[\w-]+\/(report|recording|uploads|chat-files)\//.test(target))
        return fail(400, 'Bad path');
      const f = store.files.get(target);
      if (!f) return fail(400, 'Bad path');
      const meta = { ...(f.meta || {}) };
      if ('name' in body) {
        const name = String(body.name ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ')
          .replace(/\s+/g, ' ').trim().slice(0, 80);
        if (name) meta.paName = name; else delete meta.paName;
      }
      if ('category' in body) {
        const category = String(body.category ?? '');
        if (category && !FILING_CATEGORIES.includes(category))
          return fail(400, 'That is not a document type I know.');
        if (category) meta.paCategory = category; else delete meta.paCategory;
      }
      // The star (2026-08-30), mirrored: boolean in, the starring moment or
      // gone in the map, so the pinned order is the order he starred them.
      if ('starred' in body) {
        if (body.starred === true) meta.paStarred = String(Date.now()); else delete meta.paStarred;
      }
      // The bytes and the path are untouched, which is the whole shape of the
      // real thing: only the metadata map is written.
      store.files.set(target, { ...f, meta });
      store.fire?.(target);
      return ok({
        ok: true, path: target,
        name: meta.paName || '', category: meta.paCategory || '',
        starred: !!meta.paStarred,
      });
    }

    // ---- everything else --------------------------------------------------
    if (path === '/api/version') return ok({ tag: 'demo', version: '2.27' });
    if (path === '/api/changelog') {
      return role === 'admin'
        ? ok({ admin: { '2.2': ['Everything on your side, in one place, with nothing real behind it.'] } })
        : fail(403, 'Admin only');
    }
    if (path === '/api/reviews') return ok({ reviews: [] });
    if (path === '/api/uploaded' || path === '/api/notify' || path === '/api/push/test') return ok({ ok: true });
    if (path === '/api/chat/reply') {
      // His answer to a question in his own chat (2026-09-03). Mirrors
      // handleChatReply: the answer carries the question, the question is
      // stamped answered, and nothing pings.
      const cid = body.id || 'demo-case-mine';
      const c = store.docs.get(`cases/${cid}`) || {};
      if (!c.self) return fail(409, 'Only your own case takes an answer to a question.');
      const q = store.docs.get(`cases/${cid}/chat/${body.msgId}`);
      if (!q || q.role !== 'question') return fail(404, 'No such question');
      const text = String(body.text || '').trim();
      if (!text || text.length > 2000) return fail(400, 'Message must be 1 to 2000 characters.');
      const rid = `r${Date.now().toString(36)}`;
      const p = `cases/${cid}/chat/${rid}`;
      store.docs.set(p, {
        from: 'demo-admin', role: 'admin', text, ts: new Date(),
        replyTo: body.msgId, quote: String(q.text || '').slice(0, 200),
      });
      store.docs.set(`cases/${cid}/chat/${body.msgId}`, { ...q, answeredAt: new Date(), answerId: rid });
      store.fire?.(p);
      return ok({ ok: true, id: rid });
    }
    if (path === '/api/chat/react' || path === '/api/chat/pass' || path === '/api/chat/edit') {
      // These write to the message, and in the demo the store is the message.
      // The caller names its case: hardcoding DEMO_CASE_ID here sent the Full
      // Access case's reactions (and the booked case's) to a path that does
      // not exist, which answered 404 for a message plainly on the screen.
      const msgPath = `cases/${body.id || DEMO_CASE_ID}/chat/${body.msgId}`;
      const msg = store.docs.get(msgPath);
      if (!msg) return fail(404, 'No such message');
      if (path === '/api/chat/react') {
        // The Worker's rules, mirrored - INCLUDING the record shape the
        // pages render ({ id, kind, label/emoji, by, at }). A bare id string
        // here meant no chip ever drew in the demo, so the feature the demo
        // exists to show was invisible in it.
        const myUid = role === 'admin' ? 'demo-admin' : 'demo-client';
        const reaction = body.reaction ?? null;
        const emo = EMOJI_REACTIONS.find((r) => r.id === reaction);
        const stat = STATUS_REACTIONS.find((r) => r.id === reaction);
        if (reaction !== null && !emo && !stat) return fail(400, 'Unknown reaction');
        if (stat && role !== 'admin') return fail(403, 'That reaction is not available.');
        // Live demo messages carry `from`; seeded fixtures always do too,
        // but the role fallback keeps any stray legacy doc behaving.
        // handleChatReact's rules, mirrored line for line. Where this file
        // has ever been KINDER than the Worker it has hidden a real refusal:
        // an invented admin carve-out here is what let drive-status.mjs run
        // green while Eric's own dropdown was refusing him live.
        const mine = msg.from ? msg.from === myUid
          : (msg.role || 'client') === (role === 'admin' ? 'admin' : 'client');
        const adminStatus = role === 'admin' && (stat || reaction === null);
        if (mine && !adminStatus)
          return fail(403, "You can only react to the other person's messages.");
        if (msg.reaction?.kind === 'status' && role !== 'admin')
          return fail(403, 'That message is showing a status note.');
        const rec = emo
          ? { id: reaction, emoji: emo.emoji, kind: 'emoji', by: myUid, at: new Date() }
          : stat
            ? { id: reaction, label: stat.label, kind: 'status', by: myUid, at: new Date() }
            : null;
        store.docs.set(msgPath, { ...msg, reaction: rec });
      }
      if (path === '/api/chat/pass') store.docs.set(msgPath, { ...msg, pass: body.pass ? { by: 'demo-client', at: new Date() } : null });
      if (path === '/api/chat/edit') store.docs.set(msgPath, { ...msg, text: body.text, editedAt: new Date() });
      store.fire?.(msgPath);
      return ok({ ok: true });
    }
    if (path === '/api/review') return ok({ ok: true });
    if (path === '/api/make-private') return ok({ ok: true });

    return ok({ ok: true, demo: true });
  };
}
