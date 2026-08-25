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
import { EMOJI_REACTIONS, STATUS_REACTIONS } from '../msg-actions.js';

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
    if (path === '/api/rates') return ok({ caseCents: 65000, addonCents: 17500, subCents: 9500, fullCents: 350000, chatOpenCents: 5000 });
    if (path === '/api/admin/rates') return ok({ caseCents: 65000, addonCents: 17500, subCents: 9500, fullCents: 350000, floorCents: 7500, bookings: 0, changed: false });
    // The nightly study, with a plausible history so the card on the dashboard
    // shows what it shows on a real night.
    if (path === '/api/work') {
      // Whichever case the caller named. Hardcoding the id meant every clock
      // on the shelf drove the same case's timer, which is exactly the thing
      // the shelf controls exist to avoid.
      const key = `cases/${body.caseId || DEMO_CASE_ID}`;
      const c = store.docs.get(key) || {};
      const w = c.work || { seconds: 0, startedAt: null };
      // MANUAL ONLY, mirroring the Worker (Eric, 2026-08-25): an `auto`
      // start answers with the current truth and changes nothing.
      if (body.on === true && body.auto === true) {
        return ok({
          seconds: w.seconds || 0, running: !!w.startedAt,
          auto: w.auto === true, startedAt: w.startedAt || null,
        });
      }
      if (body.on === true) {
        const startedAt = w.startedAt ? new Date(w.startedAt) : new Date();
        store.docs.set(key, { ...c, work: { ...w, startedAt, auto: false, nudged: 0 } });
        store.persist?.();
        // The ORIGINAL start comes back, matching the Worker: a caller that
        // assumed "running now means started now" would paint a long stretch
        // as nothing.
        return ok({ seconds: w.seconds || 0, running: true, auto: false, startedAt });
      }
      // The real one can bank to the last beacon when he answers "no, I
      // finished a while ago". The demo never pushes, so that answer never
      // arrives here and the stop is always simply now.
      const started = w.startedAt ? new Date(w.startedAt).getTime() : 0;
      const add = started ? Math.floor((Date.now() - started) / 1000) : 0;
      const seconds = (Number(w.seconds) || 0) + add;
      store.docs.set(key, { ...c, work: { seconds, startedAt: null, auto: false, nudged: 0 } });
      store.persist?.();
      return ok({ seconds, running: false, startedAt: null, bankedTo: null });
    }
    // The presence beacon. In the demo it stops an automatic stretch the same
    // way the Worker does, so walking from a chart back to the shelf behaves
    // the way it will in the real app rather than leaving a clock on.
    if (path === '/api/work/here') {
      const at = typeof body.caseId === 'string' ? body.caseId : '';
      const stopped = [];
      for (const [key, c] of store.docs) {
        if (!key.startsWith('cases/') || key.slice(6).includes('/')) continue;
        const w = c.work;
        if (!w?.startedAt || w.auto !== true || key.slice(6) === at) continue;
        const add = Math.floor((Date.now() - new Date(w.startedAt).getTime()) / 1000);
        const seconds = (Number(w.seconds) || 0) + add;
        store.docs.set(key, {
          ...c,
          work: { seconds, startedAt: null, auto: false, nudged: 0 },
        });
        stopped.push({ id: key.slice(6), seconds });
      }
      if (stopped.length) store.persist?.();
      return ok({ ok: true, stopped });
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
    // Pausing a case and closing one, mirrored so both are drivable in the
    // demo rather than dead buttons.
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
      const caseRate = Number(c.caseRateCents) || 65000;
      const amountCents = Math.round((pct * caseRate) / 100);
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
      store.docs.set(key, { ...c, pendingTelehealth: { ...req, state: 'requested', paidCents: 25000 } });
      store.persist?.();
      await beat(600);
      return ok({ ok: true, url: `/case.html?id=${body.caseId || DEMO_CASE_ID}&telehealth=1&demo=${role}` });
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
    if (path === '/api/checkout' || path === '/api/subscribe' || path === '/api/followup'
      || path === '/api/upgrade') {
      // The scope note is a real gate, not decoration, so the demo refuses
      // the same way the Worker does. A demo that waves the buyer through
      // teaches the wrong thing about the one screen that has to hold.
      if (path === '/api/upgrade' && typeof body?.acks?.fullAccess !== 'number')
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
          caseRateCents: 65000,
          addonRateCents: 17500,
          fullAccess: false,
          fullAccessAt: null,
          fullAccessRateCents: null,
          stripe: {
            sessionId: 'cs_demo_booked', paymentIntentId: 'pi_demo_booked',
            amountTotal: 65000,
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
              kind: 'followup', amountCents: Number(c.addonRateCents) || 17500,
              sessionId: `cs_demo_fu_${Date.now()}`, at: new Date(),
            }],
          });
                    store.fire?.(key);
        }
        return ok({ ok: true, url: `/case.html?id=${body.caseId || DEMO_CASE_ID}&followup=1&demo=1` });
      }
      if (path === '/api/upgrade') {
        const key = `cases/${body.caseId || DEMO_CASE_ID}`;
        const c = store.docs.get(key);
        if (c) {
          // Priced at the difference, like the real card; the total-paid field
          // still lands on the full tier price.
          const amount = Math.max(0, 350000 - (Number(c.caseRateCents) || 0));
          store.docs.set(key, {
            ...c, fullAccess: true, fullAccessAt: new Date(),
            fullAccessRateCents: (Number(c.caseRateCents) || 0) + amount,
            pendingFullAccess: null,
            forms: { ...(c.forms || {}), fullAccess: new Date(body.acks.fullAccess) },
            extraPayments: [...(Array.isArray(c.extraPayments) ? c.extraPayments : []), {
              kind: 'fullaccess', amountCents: amount,
              sessionId: `cs_demo_up_${Date.now()}`, at: new Date(),
            }],
          });
                    store.fire?.(key);
        }
        return ok({ ok: true, url: `/case.html?id=${body.caseId || DEMO_CASE_ID}&upgraded=1&demo=1` });
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
        const items = [...store.docs.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => ({ id: k.slice(prefix.length), ...v }))
          .sort((a, b) => new Date(b.signedAt || 0) - new Date(a.signedAt || 0));
        return ok({ items });
      }
      await beat(500);
      if (body.action === 'revoke') {
        const k = prefix + body.id;
        const cur = store.docs.get(k);
        if (cur) store.docs.set(k, { ...cur, revokedAt: new Date() });
        return ok({ ok: true });
      }
      const id = `demo-${Math.random().toString(36).slice(2, 8)}`;
      store.docs.set(prefix + id, {
        kind: body.kind, signedName: body.signedName, signedAt: new Date(),
        revokedAt: null, clinicName: body.clinicName || '', clinicAddress: body.clinicAddress || '',
        clinicPhone: body.clinicPhone || '', fromDate: body.fromDate || '', toDate: body.toDate || '',
        planName: body.planName || '', memberId: body.memberId || '',
        categories: Array.isArray(body.categories) ? body.categories : [],
      });
      return ok({ ok: true, id, signedAt: new Date().toISOString() });
    }
    if (path === '/api/clinic-calls') {
      const cid = body.caseId || q.get('caseId') || '';
      const prefix = `cases/${cid}/private/clinicCalls/items/`;
      if ((init.method || 'GET').toUpperCase() === 'GET') {
        const items = [...store.docs.entries()]
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => ({ id: k.slice(prefix.length), ...v }))
          .sort((a, b) => new Date(a.at || a.createdAt || 0) - new Date(b.at || b.createdAt || 0));
        return ok({ items });
      }
      await beat(400);
      if (body.action === 'notes') {
        const k = prefix + body.id;
        const cur = store.docs.get(k);
        if (cur) store.docs.set(k, { ...cur, notes: body.notes || '', notesAt: new Date() });
        return ok({ ok: true });
      }
      if (body.action === 'add') {
        store.docs.set(prefix + `c-${Math.random().toString(36).slice(2, 8)}`, {
          clinic: body.clinic || '', phone: body.phone || '', parties: body.parties || '',
          at: body.at ? new Date(body.at) : null, notes: '', createdAt: new Date(),
        });
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
        const mine = msg.from ? msg.from === myUid
          : (msg.role || 'client') === (role === 'admin' ? 'admin' : 'client');
        if (mine && !(role === 'admin' && (stat || reaction === null)))
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
