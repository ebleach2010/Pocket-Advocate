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
const beat = (ms = 320) => new Promise((r) => setTimeout(r, ms));

const ok = (body) => ({
  ok: true,
  status: 200,
  headers: { get: () => 'application/json' },
  json: async () => body,
  text: async () => JSON.stringify(body),
});
const fail = (status, error) => ({
  ok: false,
  status,
  headers: { get: () => 'application/json' },
  json: async () => ({ error }),
  text: async () => JSON.stringify({ error }),
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
    if (path === '/api/rates') return ok({ caseCents: 120000, addonCents: 27500, subCents: 5000, fullCents: 350000, chatOpenCents: 5000 });
    if (path === '/api/admin/rates') return ok({ caseCents: 120000, addonCents: 27500, subCents: 5000, fullCents: 350000, floorCents: 7500, bookings: 0, changed: false });
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
      // everything on the clock becomes the review side and the Hands-Off
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
        store.docs.set(key, { ...c, work: { ...w, startedAt, auto: false, nudged: 0 } });
        store.persist?.();
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
      store.docs.set(key, { ...c, work: { ...w, seconds, startedAt: null, auto: false, nudged: 0 } });
      store.persist?.();
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
    // How many Hands-Off cases at once. Backed by the same config document the
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
        if (c.fullAccess) return fail(409, 'This case is already on Hands-Off Case Management.');
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
            label: 'Hands-Off Case Management, paid outside the app',
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
            reason: body.reason || '', backBy: body.backBy ? new Date(body.backBy) : null,
          },
        });
        store.persist?.();
        return ok({ ok: true, paused: true });
      }
      const stretch = hold.pausedAt
        ? Math.max(0, Date.now() - new Date(hold.pausedAt).getTime()) : 0;
      store.docs.set(key, {
        ...c,
        hold: { pausedAt: null, totalMs: (Number(hold.totalMs) || 0) + stretch, reason: '', backBy: null },
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
        if (!c.fullAccess) return fail(409, 'Check-ins are part of Hands-Off Case Management. Use "charge" for a standard case.');
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
      // so the "checkout" lands straight where paying would have.
      const amount = Number(req.firstMonthCents) || 0;
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
        store.docs.set(key, {
          ...c, pendingTelehealth: null,
          telehealthVisits: [...visits, { ...p, state: undefined, confirmedAt: new Date() }],
        });
        store.persist?.();
        return ok({ ok: true, confirmed: true });
      }
      store.docs.set(key, {
        ...c, pendingTelehealth: null,
        telehealthDenied: { when: p.when, clinicName: p.clinicName, at: new Date(), refundCents: p.paidCents || 0 },
      });
      store.persist?.();
      return ok({ ok: true, denied: true });
    }
    if (path === '/api/admin/effort') {
      if (init.method === 'POST') demoEffort = body.effort === 'max' ? 'max' : 'high';
      return ok({ effort: demoEffort });
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
    // One more month on a Hands-Off case, stacking. Straight past Stripe,
    // written down, so the demo's window guard actually moves.
    //
    // EVERY field the Worker's confirmExtensionPurchase writes has to be
    // written here too. fullAccessMonths and fullAccessRateCents were missed
    // when the tier went monthly, and the demo silently dropped them: the
    // window moved, the month counter did not, and the ledger under-counted.
    if (path === '/api/extend') {
      const key = `cases/${body.caseId || DEMO_CASE_ID}`;
      const c = store.docs.get(key) || {};
      if (!c.fullAccess) return fail(409, 'Extensions are part of Hands-Off Case Management.');
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
          return fail(400, 'Hands-Off Case Management is added from inside an open case now. '
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
          addonRateCents: 27500,
          fullAccess: false,
          fullAccessAt: null,
          fullAccessRateCents: null,
          stripe: {
            sessionId: 'cs_demo_booked', paymentIntentId: 'pi_demo_booked',
            amountTotal: 120000,
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
              kind: 'followup', amountCents: Number(c.addonRateCents) || 27500,
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
      // work agreement are the Hands-Off half. The demo never checked the
      // tier at all, so it would happily sign a designation a real case would
      // have refused.
      if ((body.kind === 'representative' || body.kind === 'scope')
        && !store.docs.get(`cases/${cid}`)?.fullAccess)
        return fail(409, 'This case is not on Hands-Off Case Management.');
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
      return ok({ items });
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

    // ---- the advisor, from a fixture -------------------------------------
    if (path === '/api/advisor/state') {
      // Whichever case is open, not always the first one: the Full Access
      // case carries its own assessment and its own appeal letter, and
      // hardcoding the id showed the wrong case's work on the right case's
      // page.
      const cid = q.get('id') || body.id || DEMO_CASE_ID;
      const state = store.docs.get(`cases/${cid}/advisor/state`) || {};
      const style = store.docs.get('advisorStyle/profile') || {};
      const notes = store.docs.get(`cases/${cid}/private/notes/doc`) || {};
      const { readFiles, pendingMedia, ...panelState } = state;
      void readFiles; void pendingMedia;
      return ok({
        state: panelState,
        qa: [],
        glossary: [...store.docs.entries()]
          .filter(([p]) => p.startsWith('advisorKnowledge/'))
          .map(([p, d]) => ({ id: p.split('/').pop(), ...d, learned: !!d.learnedAt })),
        keyConfigured: true,
        notes: notes.html || '',
        notesUpdatedAt: notes.updatedAt || null,
        workingLine: state.workingDx || '',
        dxOverride: null,
        differential: state.differential || [],
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
        }, 4000);
        return ok({ ok: true });
      }
      if (body.action === 'dx') {
        store.docs.set(`cases/${cid}/advisor/state`, {
          ...state, dxOverride: body.text || null, dxOverrideAt: new Date(),
        });
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
            '"Jordan, the next sixty days are the heavy lift on this case. If you want me on every call and every portal message while that happens, the Hands-Off Case Management tier covers exactly that. You have seen this week what it looks like."',
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
      return ok({ covers: { [DEMO_CASE_ID]: { text: 'Two years unexplained, bloods never actually seen', by: 'advisor', at: new Date() } } });
    }
    if (path === '/api/advisor/dictionary') return ok({ terms: [] });

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
