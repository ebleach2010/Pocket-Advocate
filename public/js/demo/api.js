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
// The Community Assistance Fund (2026-10-04): its routes, mirrored with the
// Worker's own rules.
import { fundDemo } from './fund.js';
import { caseDay } from '../service-day.js';
import { hoursOf, needsChoice, extraCents, EXTRA_HOUR_CENTS } from '../extra-hours.js';
// DEMO MODE (2026-10-16): his practice copy's team, and what its clients ask back.
import { LIVE_TEAM, LIVE_QUESTIONS, LIVE_CHAT_QUESTIONS, firstRead } from './live.js';
const LIVE = (() => { try { return sessionStorage.getItem('pa-demo-live') === '1'; } catch { return false; } })();

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
// The trading categories the retired desk saved (PR 420, gone 2026-10-04),
// kept off every glossary as the Worker keeps them off.
const LEGACY_TRADE_CATS = ['Setup', 'Indicator', 'Level', 'Order', 'Risk', 'Options', 'Market', 'Instrument'];
const beat = (ms = 320) => new Promise((r) => setTimeout(r, ms));
/** A lead's conversation key in the demo: steady per email, never the address itself. */
const demoLeadKey = (email) => { let h = 2166136261; for (const ch of `lead:${email}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return `d${h.toString(16)}`; };
/** Blocked from his Leads (2026-10-17), as leadBlocked in the Worker. */
const demoBlocked = (store, email) => store.docs.has(`leadBlocks/${demoLeadKey(email)}`);

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
  // Staff are him or an advocate (2026-10-15); `me` is whoever is signed in.
  const staffBase = role === 'admin' || role === 'advocate';
  const me = role === 'advocate' ? 'demo-advocate' : role === 'admin' ? 'demo-admin' : 'demo-client';
  // Setup first (2026-10-16), as worker/staff.js setupPending: an advocate who
  // must choose a password or finish their profile reaches only these.
  const SETUP_PATHS = new Set(['/api/staff/me', '/api/staff/headshot', '/api/staff/payout', '/api/staff/chat']);
  const setupPending = () => {
    if (role !== 'advocate') return false;
    const a = store.docs.get('advocates/demo-advocate') || {};
    return !!a.demoMustChange || !a.onboardedAt;
  };
  // The Worker's password rule (staff.js passwordProblem).
  const passwordProblem = (pw) => {
    if (typeof pw !== 'string' || pw.length < 10) return 'Use at least 10 characters.';
    if (pw.length > 200) return 'Use at most 200 characters.';
    if (/^\s|\s$/.test(pw)) return 'No spaces at the start or the end.';
    return '';
  };
  // A contractor's record, when the uid names an active one that is not his.
  // What an advocate offers on top of a Full-Service month (worker/addons.js addonsOf, 2026-10-17).
  const demoAddons = (uid) => {
    const id = uid && /^[\w-]{1,64}$/.test(uid) ? uid : 'demo-admin';
    const rec = store.docs.get(`advocates/${id}`);
    const owner = id === 'demo-admin' || rec?.owner === true;
    const set = rec?.addons || (owner ? { attend: { on: true, cents: 52500 }, appeal: { on: true, cents: 35000 } } : {});
    const one = (v) => ({ on: v?.on === true, cents: Number.isInteger(v?.cents) && v.cents >= 0 ? v.cents : 0 });
    // His own extras for them (2026-10-17), as worker/addons.js keeps them.
    const custom = (Array.isArray(set.custom) ? set.custom : []).filter((x) => /^x[a-z0-9]{8}$/.test(String(x?.id)) && String(x.label || '').trim().length >= 2)
      .slice(0, 6).map((x) => ({ id: x.id, label: String(x.label).trim().slice(0, 60), on: x.on === true, cents: Number.isInteger(x.cents) && x.cents >= 0 ? x.cents : 0 }));
    return { attend: one(set.attend), appeal: one(set.appeal), custom };
  };
  const cleanDemoAddons = (input) => {
    const out = {};
    for (const [id, label] of [['attend', 'Attending an appointment'], ['appeal', 'Writing an insurance appeal']]) {
      const v = input?.[id] || {};
      const cents = Number(v.cents);
      if (v.on === true && (!Number.isInteger(cents) || cents < 0 || cents > 2_000_000)) return { error: `${label}: a price from $0 to $20,000.` };
      out[id] = { on: v.on === true, cents: Number.isInteger(cents) && cents >= 0 ? cents : 0 };
    }
    if (Array.isArray(input?.custom)) {
      const rows = input.custom.filter((x) => x && (String(x.label || '').trim() || x.on === true));
      if (rows.length > 6) return { error: 'Up to 6 of your own add-ons.' };
      out.custom = [];
      for (const x of rows) {
        const name = String(x.label || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        if (name.length < 2) return { error: 'Each add-on of your own needs a name.' };
        const cents = Number(x.cents);
        if (x.on === true && (!Number.isInteger(cents) || cents < 0 || cents > 2_000_000)) return { error: `${name}: a price from $0 to $20,000.` };
        out.custom.push({ id: /^x[a-z0-9]{8}$/.test(String(x.id)) ? x.id : `x${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`, label: name, on: x.on === true, cents: Number.isInteger(cents) && cents >= 0 ? cents : 0 });
      }
    }
    return { value: out };
  };
  // How a team member is paid, checked the way worker/payroll.js cleanPayout does; the demo keeps it unsealed.
  const PAY_METHODS = { ach: 'Direct deposit (ACH)', check: 'Paper check', zelle: 'Zelle', paypal: 'PayPal', venmo: 'Venmo', other: 'Other' };
  const demoPayout = (m, fl = {}) => {
    if (!PAY_METHODS[m]) return { error: 'Choose how you want to be paid.' };
    if (m === 'ach') {
      const acct = String(fl.account || '').replace(/\D/g, '');
      if (!fl.name || String(fl.routing || '').replace(/\D/g, '').length !== 9 || acct.length < 4 || acct.length > 17) return { error: 'The name on the account, a 9 digit routing number and the account number, please.' };
      return { method: m, hint: `${fl.type === 'savings' ? 'Savings' : 'Checking'} ending ${acct.slice(-4)}`, details: fl };
    }
    if (m === 'check') {
      if (!fl.name || String(fl.address || '').length < 8) return { error: 'The name for the check and the address to mail it to, please.' };
      return { method: m, hint: `Mailed to ${String(fl.address).split(/[,\n]/)[0]}`, details: fl };
    }
    if (m === 'other') {
      if (String(fl.text || '').length < 3) return { error: 'Say how you want to be paid.' };
      return { method: m, hint: 'Other, as written', details: fl };
    }
    const h = String(fl.handle || '');
    if (h.length < 3) return { error: `The ${PAY_METHODS[m]} email, phone or handle, please.` };
    return { method: m, hint: `${PAY_METHODS[m]} to ${h.slice(0, 2)}…${h.slice(-2)}`, details: fl };
  };
  // What his pages set (worker/staffsettings.js cleanSettingsChange, admin), checked enough for the demo.
  const demoSettings = (s, prev = {}) => {
    if (!s || typeof s !== 'object') return { value: prev };
    const next = { ...prev };
    if (s.rates) {
      next.rates = { ...(prev.rates || {}) };
      for (const k of ['caseCents', 'addonCents', 'fullCents', 'subCents']) {
        if (s.rates[k] === undefined) continue;
        if (s.rates[k] === null) { delete next.rates[k]; continue; }
        const v = Number(s.rates[k]);
        if (!Number.isInteger(v) || v < 50 || v > 2_000_000) return { error: 'A price from $0.50 to $20,000.' };
        next.rates[k] = v;
      }
    }
    if (s.fullCap !== undefined) { if (s.fullCap !== null && !(Number.isInteger(s.fullCap) && s.fullCap >= 0 && s.fullCap <= 99)) return { error: 'A number from 0 (no limit) to 99.' }; next.fullCap = s.fullCap; }
    if (s.offers) next.offers = { case: s.offers.case !== false, full: s.offers.full !== false, chat: s.offers.chat === true };
    if (s.hours !== undefined) next.hours = s.hours;
    if (s.office) next.office = { ...(prev.office || {}), ...(s.office.responseTime !== undefined ? { responseTime: s.office.responseTime || null } : {}) };
    return { value: next };
  };
  // THEIR OWN SERVICES (2026-10-17), as worker/services.js keeps them: his to switch, theirs to ask for.
  const demoServices = (rec) => (Array.isArray(rec?.services) ? rec.services : [])
    .filter((x) => x && /^s[a-z0-9]{8}$/.test(String(x.id)) && String(x.label || '').trim().length >= 2).slice(0, 6)
    .map((x) => ({ id: x.id, label: String(x.label).trim().slice(0, 60), about: String(x.about || '').trim().slice(0, 240), kind: x.kind === 'month' ? 'month' : 'once', cents: Number.isInteger(x.cents) ? x.cents : 0, on: x.on === true, askedAt: x.askedAt || null }));
  const cleanDemoServices = (input, prev = [], admin = false) => {
    if (!Array.isArray(input)) return { error: 'Bad services.' };
    const before = new Map((prev || []).map((x) => [x.id, x]));
    const rows = input.filter((x) => x && (String(x.label || '').trim() || String(x.about || '').trim()));
    if (rows.length > 6) return { error: 'Up to 6 services of their own.' };
    const value = [];
    for (const x of rows) {
      const name = String(x.label || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if (name.length < 2) return { error: 'Each service needs a name.' };
      if (!['once', 'month'].includes(x.kind)) return { error: `${name}: one-time or monthly.` };
      const cents = Number(x.cents);
      if (!Number.isInteger(cents) || cents < 50 || cents > 2_000_000) return { error: `${name}: a price from $0.50 to $20,000.` };
      const id = /^s[a-z0-9]{8}$/.test(String(x.id)) ? x.id : `s${Math.random().toString(36).slice(2, 10).padEnd(8, '0')}`;
      const was = before.get(id);
      // A changed name or kind goes back to him, as in worker/services.js.
      const same = !!was && String(was.label || '').toLowerCase() === name.toLowerCase() && was.kind === x.kind;
      value.push({ id, label: name, about: String(x.about || '').trim().slice(0, 240), kind: x.kind, cents, on: admin ? x.on === true : same && was.on === true, askedAt: admin || same ? was?.askedAt || null : new Date().toISOString() });
    }
    return { value };
  };
  const demoContractor = (uid) => {
    if (!uid || !/^[\w-]{1,64}$/.test(uid) || uid === 'demo-admin') return null;
    const rec = store.docs.get(`advocates/${uid}`);
    return rec && rec.active === true && rec.owner !== true ? rec : null;
  };
  // BOOKABLE HOURS AND THE BUFFER (2026-10-17), as worker/booking.js: a
  // contractor's hours become their open times, and no paid appointment sits
  // inside an advocate's buffer (3 hours unless set) of another. Free calls make none.
  const demoBuffer = (rec) => { const v = rec?.bufferHours; return typeof v === 'number' && v >= 0 && v <= 12 && Math.round(v * 2) === v * 2 ? v : 3; };
  const demoMs = (v) => { const t = v?.toDate ? v.toDate().getTime() : new Date(v || 0).getTime(); return Number.isFinite(t) ? t : 0; };
  const whoseDemo = (d) => (typeof d?.advocateId === 'string' && d.advocateId) || 'demo-admin';
  const demoPaid = (uid) => {
    const out = [];
    const now = Date.now();
    for (const [k, d] of store.docs.entries()) {
      const [coll, id, more] = k.split('/');
      if (more || !d || whoseDemo(d) !== uid) continue;
      if (coll === 'availability' && d.kind !== 'fit' && (d.state === 'booked' || (d.state === 'held' && demoMs(d.holdExpiresAt) > now))) {
        const a = demoMs(d.start); if (a) out.push({ a, b: a + (Number(d.durationMin) || 60) * 60_000, id: `slot:${id}` });
      } else if (coll === 'invites' && d.state === 'sent') {
        const a = demoMs(d.start); if (a) out.push({ a, b: a + 3_600_000, id: `invite:${id}` });
      } else if (coll === 'cases' && d.status !== 'closed' && !d.self && !d.showcase && d.appointment && !d.appointment.requested) {
        const a = demoMs(d.appointment.start); if (a) out.push({ a, b: a + (Number(d.appointment.durationMin) || 60) * 60_000, id: `case:${id}` });
      }
    }
    return out;
  };
  const inDemoBuffer = (list, bufMs, s, e, except = '') => list.some((x) => x.id !== except && s < x.b + bufMs && e > x.a - bufMs);
  const demoTimes = (uid) => {
    const rec = demoContractor(uid);
    const hours = rec?.settings?.hours;
    if (!rec || rec.settings?.offers?.case === false || !hours) return null;
    const f = new Intl.DateTimeFormat('en-US', { timeZone: rec.tz || 'America/Boise', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
    const paid = demoPaid(uid);
    const buf = demoBuffer(rec) * 3_600_000;
    const now = Date.now();
    const out = [];
    for (let t = Math.ceil((now + 72 * 3_600_000) / 900_000) * 900_000; t <= now + 252 * 3_600_000; t += 900_000) {
      const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
      const min = (Number(p.hour) % 24) * 60 + Number(p.minute);
      const span = hours[String(p.weekday).slice(0, 3).toLowerCase()];
      if (min % 30 || !span || min < toMin(span.from) || min + 60 > toMin(span.to)) continue;
      if (!inDemoBuffer(paid, buf, t, t + 3_600_000)) out.push(new Date(t).toISOString());
    }
    return { name: rec.name || '', times: out };
  };

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const path = url.startsWith('http') ? new URL(url).pathname : url.split('?')[0];
    if (!path.startsWith('/api/')) return real(input, init);
    const staff = staffBase && (!setupPending() || SETUP_PATHS.has(path));

    const body = (() => {
      try { return init.body ? JSON.parse(init.body) : {}; } catch { return {}; }
    })();
    const q = new URLSearchParams((url.split('?')[1] || ''));
    const fund = await fundDemo({ path, q, body, init, role, store, real });
    if (fund) return fund;

    // ---- signing in takes anything at all --------------------------------
    // "I'll use any series of letters to fill the email box/code box. No email
    // needs to be sent."
    if (path === '/api/auth/request-code') { await beat(); return ok({ ok: true }); }
    if (path === '/api/auth/verify-code') { await beat(); return ok({ token: 'demo', deviceToken: 'demo' }); }
    if (path === '/api/auth/device-signin') return ok({ token: 'demo' });
    if (path === '/api/admin/login' || path === '/api/admin/pin') {
      // An advocate's door answers with who they are, and whether they still
      // hold the password they were given (2026-10-15).
      if (role === 'advocate') return ok({ token: 'demo', deviceToken: 'demo', role: 'advocate', mustChange: !!store.docs.get('advocates/demo-advocate')?.demoMustChange });
      return ok({ token: 'demo', deviceToken: 'demo' });
    }
    if (path === '/api/admin/session') return ok({ ok: true });
    // The Clients page's stall report (2026-09-24, v7.16): kept on the page for the drive, sent nowhere.
    if (path === '/api/admin/stall') { (window.__paDemoStalls ||= []).push(body); return ok({ ok: true }); }

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
    // Prices, as one stored doc (2026-10-15), so a save in his settings is
    // read back by every page the way the real rates doc is. Same rails and
    // the same refusal words as handleSetRates.
    // The warm public pages switch (2026-10-15), kept so the row in his settings works in the demo.
    if (path === '/api/admin/look') {
      if (role !== 'admin') return fail(404, 'Not found');
      if ((init.method || 'GET') === 'POST') {
        if (typeof body.landingWarm !== 'boolean') return fail(400, 'On or off.');
        store.docs.set('config/look', { landingWarm: body.landingWarm });
        store.persist?.();
      }
      return ok({ landingWarm: store.docs.get('config/look')?.landingWarm !== false });
    }
    // His services, one switch each (2026-10-17), kept in the practice copy
    // so the row in his settings works there too.
    if (path === '/api/sales' || path === '/api/admin/sales') {
      const KEYS = ['chat', 'case', 'full'];
      const now = () => { const d = store.docs.get('config/sales') || {}; return Object.fromEntries(KEYS.map((k) => [k, d[k] !== false])); };
      if (path === '/api/admin/sales') {
        if (role !== 'admin') return fail(404, 'Not found');
        if ((init.method || 'GET') === 'POST') {
          const keys = KEYS.filter((k) => body[k] !== undefined);
          if (!keys.length || keys.some((k) => typeof body[k] !== 'boolean')) return fail(400, 'On or off.');
          store.docs.set('config/sales', { ...now(), ...Object.fromEntries(keys.map((k) => [k, body[k]])) });
          store.persist?.();
        }
      }
      return ok(now());
    }
    // A contractor's open times, and his open slots inside his buffer (2026-10-17).
    if (path === '/api/advocate-times') {
      const got = demoTimes(q.get('advocate'));
      if (!got) return fail(404, 'That calendar is not open for booking.');
      return ok({ name: got.name, durationMin: 60, times: got.times });
    }
    if (path === '/api/slots/buffered') {
      const fit = q.get('kind') === 'fit';
      const paid = demoPaid('demo-admin');
      const buf = demoBuffer(store.docs.get('advocates/demo-admin')) * 3_600_000;
      const blocked = [];
      for (const [k, d] of store.docs.entries()) {
        const [coll, id, more] = k.split('/');
        if (coll !== 'availability' || more || !d || d.state !== 'open' || whoseDemo(d) !== 'demo-admin' || (d.kind === 'fit') !== fit) continue;
        const a = demoMs(d.start);
        if (a && inDemoBuffer(paid, buf, a, a + (Number(d.durationMin) || (fit ? 15 : 60)) * 60_000, `slot:${id}`)) blocked.push(id);
      }
      return ok({ blocked });
    }
    if (path === '/api/rates' || path === '/api/admin/rates') {
      const SEEDS = { caseCents: 210000, addonCents: 32500, subCents: 5000, fullCents: 440000, floorCents: 7500 };
      const now = { ...SEEDS, ...(store.docs.get('config/rates') || {}) };
      if (path === '/api/rates') {
        // A contractor's own prices over his, as the Worker does (2026-10-15).
        const own = demoContractor(q.get('advocate'));
        for (const k of ['caseCents', 'addonCents', 'fullCents', 'subCents']) if (Number(own?.settings?.rates?.[k]) > 0) now[k] = own.settings.rates[k];
        // Their own chat line, once he has turned it on (2026-10-17).
        const askedFor = q.get('advocate');
        const chatOffered = own ? own.settings?.offers?.chat === true : !askedFor || askedFor === 'demo-admin';
        const services = own ? demoServices(own).filter((x) => x.on && ['once', 'month'].includes(x.kind) && x.cents >= 50).map(({ id, label, about, kind, cents }) => ({ id, label, about, kind, cents })) : [];
        return ok({ caseCents: now.caseCents, addonCents: now.addonCents, subCents: now.subCents, fullCents: now.fullCents, chatOpenCents: 5000, teleCents: 52500, fullHours: 20, addons: demoAddons(q.get('advocate')), chatOffered, services });
      }
      const want = { ...now };
      for (const k of Object.keys(SEEDS)) if (body && body[k] !== undefined) want[k] = Number(body[k]);
      for (const [k, v] of Object.entries(want)) {
        const [min, max] = k === 'subCents' ? [1000, 100000] : k === 'floorCents' ? [1000, 100000] : [5000, 2000000];
        if (!Number.isInteger(v) || v < min || v > max) return fail(400, `${k} has to be a whole number of cents between ${min} and ${max}.`);
      }
      const changed = Object.keys(SEEDS).some((k) => want[k] !== now[k]);
      if (changed) { store.docs.set('config/rates', want); store.persist?.(); }
      return ok({ ...want, bookings: 0, changed, teleCents: 52500, fullHours: 20, caps: { caseCents: 180000, addonCents: 42500, subCents: 10000, fullCents: 440000 } });
    }
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
    // The waitlist (2026-10-12). Mirrors handleWaitlist: the same refusals in
    // the same order, one row per email, to waitlist/ where no client page looks.
    if (path === '/api/waitlist' && init.method === 'POST') {
      if (typeof body?.website === 'string' && body.website.trim()) return ok({ ok: true });
      const first = String(body?.first || '').trim().slice(0, 60);
      const last = String(body?.last || '').trim().slice(0, 60);
      const email = String(body?.email || '').trim().toLowerCase();
      const phone = String(body?.phone || '').trim();
      if (!first) return fail(400, 'Your first name, please.');
      if (!last) return fail(400, 'Your last name, please.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(400, 'A working email address, please.');
      if (!/^\+?[\d\s().-]{7,20}$/.test(phone)) return fail(400, 'A valid phone number, please.');
      if (!['chat', 'case', 'full'].includes(body?.package)) return fail(400, 'Pick the package you want.');
      if (demoBlocked(store, email)) return ok({ ok: true, first });
      await beat(500);
      const key = `waitlist/${email.replace(/[^a-z0-9]/g, '').padEnd(32, '0').slice(0, 32)}`;
      const prior = store.docs.get(key);
      const now = new Date();
      store.docs.set(key, { ...(prior || { createdAt: now }), first, last, email, phone, package: body.package, state: 'waiting', updatedAt: now });
      return ok({ ok: true, first });
    }
    if (path === '/api/admin/waitlist') {
      if (role !== 'admin') return fail(404, 'Not found');
      if (init.method !== 'POST') {
        const people = [...store.docs.entries()].filter(([k]) => k.startsWith('waitlist/'))
          .map(([k, v]) => ({ id: k.slice(9), ...v }))
          .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
        return ok({ people });
      }
      const k = `waitlist/${body?.id || ''}`;
      if (!store.docs.get(k)) return fail(404, 'Not on the list');
      if (body.action === 'remove') { store.docs.delete(k); return ok({ ok: true }); }
      if (body.action === 'contacted' || body.action === 'waiting') {
        store.docs.set(k, { ...store.docs.get(k), state: body.action, stateAt: new Date() });
        return ok({ ok: true });
      }
      return fail(400, 'Bad action');
    }
    // The question box (2026-10-14). Mirrors handleQuestion's refusals, and
    // keeps the question in questions/ for the Leads tab.
    if (path === '/api/question' && init.method === 'POST') {
      if (typeof body?.website === 'string' && body.website.trim()) return ok({ ok: true });
      const name = String(body?.name || '').trim().slice(0, 80);
      const email = String(body?.email || '').trim().toLowerCase();
      const question = String(body?.question || '').trim();
      if (!name) return fail(400, 'Your name, please.');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return fail(400, 'A working email address, please. My answer goes there.');
      if (question.length < 2) return fail(400, 'Type your question, please.');
      if (question.length > 2000) return fail(400, 'Keep it under 2000 characters, please.');
      if (demoBlocked(store, email)) return ok({ ok: true });
      await beat(500);
      store.docs.set(`questions/q-${Date.now()}`, { name, email, question, createdAt: new Date() });
      return ok({ ok: true });
    }
    // Leads (2026-10-14): one row per email across every route, as the Worker builds it.
    if (path === '/api/admin/leads') {
      if (role !== 'admin') return fail(404, 'Not found');
      const names = { chat: '24/7 Priority Chat', case: 'Advocacy Case', full: 'Full-Service Case Management' };
      const rows = [];
      for (const [k, d] of store.docs.entries()) {
        const coll = k.split('/')[0];
        if (k.split('/').length !== 2) continue;
        if (coll === 'waitlist') rows.push({ when: d.createdAt, name: `${d.first} ${d.last}`, email: d.email, phone: d.phone, interest: names[d.package], words: '', source: 'Waitlist' });
        else if (coll === 'questions') rows.push({ when: d.createdAt, name: d.name, email: d.email, phone: '', interest: '', words: d.question, source: 'Question' });
        else if (coll === 'leads') rows.push({ when: d.createdAt, name: d.name, email: d.email, phone: d.phone, interest: 'Free call', words: d.note, source: 'Free call' });
        else if (coll === 'cases' && d.clientEmail && !d.self && !d.showcase) rows.push({ when: d.createdAt, name: d.clientName, email: d.clientEmail, phone: d.clientPhone, interest: d.fullAccess ? names.full : names.case, words: '', source: 'Booked a case', link: `/admin-case.html?id=${k.split('/')[1]}&page=chat` });
        else if (coll === 'subscriptions' && d.email) rows.push({ when: d.startedAt, name: '', email: d.email, phone: '', interest: names.chat, words: '', source: 'Priority Chat', link: `/admin-chats.html?sub=${k.split('/')[1]}` });
      }
      const by = new Map();
      for (const r of rows) {
        const e = String(r.email).toLowerCase();
        const t = new Date(r.when || 0).getTime() || 0;
        const p = by.get(e) || { email: e, name: '', phone: '', first: t, last: t, sources: [], interests: [], words: [], messages: [], link: '' };
        if (r.name && (!p.name || t >= p.last)) p.name = r.name;
        if (r.phone && (!p.phone || t >= p.last)) p.phone = r.phone;
        p.first = Math.min(p.first || t, t || p.first); p.last = Math.max(p.last, t);
        if (!p.sources.includes(r.source)) p.sources.push(r.source);
        if (r.interest && !p.interests.includes(r.interest)) p.interests.push(r.interest);
        if (r.words) { p.words.push(r.words); p.messages.push({ from: 'them', text: String(r.words), at: t ? new Date(t).toISOString() : null, via: r.source }); }
        if (r.link && !p.link) p.link = r.link;
        by.set(e, p);
      }
      // Their messages and his replies as one conversation, as the Worker sends them (2026-10-17).
      const everyone = [...by.values()].sort((a, b) => b.last - a.last).map((p) => {
        const key = demoLeadKey(p.email);
        const th = store.docs.get(`leadThreads/${key}`) || {};
        const replies = (th.replies || []).map((r) => ({ from: 'me', text: r.text, at: new Date(r.at).toISOString() }));
        const newest = Math.max(0, ...p.messages.map((m) => new Date(m.at || 0).getTime()));
        const mine = Math.max(0, ...replies.map((r) => new Date(r.at).getTime()));
        return {
          firstContact: p.first ? new Date(p.first).toISOString() : null, lastContact: p.last ? new Date(p.last).toISOString() : null,
          name: p.name, email: p.email, phone: p.phone, interestedIn: p.interests.join('; '), cameThrough: p.sources.join('; '), notes: p.words.join(' | '),
          key, appLink: p.link, unread: newest > Math.max(mine, new Date(th.seenAt || 0).getTime()),
          messages: [...p.messages, ...replies].sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0)),
          hiddenAt: th.hiddenAt || null,
        };
      });
      // Blocked, or deleted with nothing from them since (2026-10-17).
      const leads = everyone.filter((l) => !demoBlocked(store, l.email)
        && !(l.hiddenAt && new Date(l.hiddenAt).getTime() >= new Date(l.lastContact || 0).getTime()))
        .map(({ hiddenAt, ...l }) => l);
      if (init.method === 'POST') {
        const body = JSON.parse(init.body || '{}');
        const email = String(body.email || '').trim().toLowerCase();
        const bkey = `leadBlocks/${demoLeadKey(email)}`;
        if (body.action === 'unblock') {
          if (!store.docs.has(bkey)) return fail(404, 'That email is not blocked.');
          store.docs.delete(bkey); store.persist?.();
          return ok({ ok: true });
        }
        if (body.action === 'delete' || body.action === 'block') {
          if (!everyone.some((l) => l.email === email)) return fail(404, 'That person is not on your Leads.');
          await beat(300);
          for (const [k, d] of [...store.docs.entries()]) {
            if (/^(questions|waitlist)\/[^/]+$/.test(k) && String(d.email || '').trim().toLowerCase() === email) store.docs.delete(k);
          }
          store.docs.set(`leadThreads/${demoLeadKey(email)}`, { email, hiddenAt: new Date() });
          if (body.action === 'block') store.docs.set(bkey, { email, at: new Date() });
          store.persist?.();
          return ok({ ok: true });
        }
        const lead = leads.find((l) => l.email === email);
        if (!lead) return fail(404, 'That person is not on your Leads.');
        const path = `leadThreads/${lead.key}`;
        const th = store.docs.get(path) || { email, replies: [] };
        if (body.action === 'seen') { store.docs.set(path, { ...th, seenAt: new Date() }); store.persist?.(); return ok({ ok: true }); }
        const text = String(body.text || '').trim();
        if (!text) return fail(400, 'Type your reply first.');
        await beat(400);
        const at = new Date();
        store.docs.set(path, { ...th, replies: [...(th.replies || []), { text, at }], seenAt: at });
        store.persist?.();
        // Demo mode: nothing is sent; the reply is kept so the conversation shows it.
        return ok({ ok: true, reply: { from: 'me', text, at: at.toISOString() } });
      }
      const blocked = [...store.docs.entries()].filter(([k]) => k.startsWith('leadBlocks/'))
        .map(([, d]) => ({ email: d.email, at: new Date(d.at).toISOString() })).sort((a, b) => new Date(b.at) - new Date(a.at));
      return ok({ leads, missing: [], blocked });
    }
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
      if (demoBlocked(store, email)) return ok({ ok: true });
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
      // A contractor's own door sign on their client's page (2026-10-15).
      const own = path === '/api/availability' ? demoContractor(q.get('advocate')) : null;
      const raw = own ? (own.settings?.office || {}) : (store.docs.get(key) || {});
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
      const own = [...store.docs.entries()].filter(([k, v]) => /^cases\/[^/]+$/.test(k) && v?.self);
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
          sources.push([`cases/${pid}`, c]);
        }
        const newest = sources[0]?.[1];
        if (!who.name && newest) who = { name: newest.clientName, dob: newest.clientDob || null, phone: newest.clientPhone || null, address: newest.clientAddress || null };
        if (!who.name) who.name = 'Eric Leach';
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
        // Full-Service owes no report (2026-10-15): the consult is stamped done.
        if (c.fullAccess) {
          if (!c.consultDoneAt) {
            store.docs.set(key, { ...c, consultDoneAt: now, ...(c.status === 'confirmed' ? { status: 'awaiting_report' } : {}) });
            store.persist?.();
            store.fire?.(key);
          }
          return ok({ ok: true, consult: true });
        }
        // The clock starts once (2026-10-15), as the Worker's does: a later
        // recording is filed and moves nothing.
        if (!c.reportDueAt) {
          const next = { ...c, reportDueAt: new Date(now.getTime() + 14 * 86400000) };
          if (c.status !== 'delivered') next.status = 'awaiting_report';
          store.docs.set(key, next);
        }
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
        if (c.fullAccess) return fail(409, 'Full-Service has no written report. File it as another type.');
        if (!c.self && !c.reportDueAt) return fail(409, 'Mark the call done first. The report comes after the call.');
        // The new-enhancement stamp the Worker writes (2026-10-17); the page shows its dot only while sales are open.
        store.docs.set(key, { ...c, status: 'delivered', reportDeliveredAt: now, ...(c.family ? {} : { enhancementAt: now }) });
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
          // Full-Service replaces a report not yet delivered, as the Worker's reportReplaced does.
          ...(c.reportDueAt && c.status !== 'delivered' && c.status !== 'closed' ? { reportDueAt: null } : {}),
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
        // The confirmed telehealth visit and the next-call list, as the
        // Worker's showcase builds them (2026-10-15).
        telehealthVisits: [{
          when: ago(-6, 13), clinicName: 'Owyhee Neurology Associates', provider: 'Dr. Okafor',
          paidCents: 0, sessionId: null, attestAt: ago(3, 11), confirmedAt: ago(2, 15),
        }],
      });
      [
        [3, 18, 'client', 'How long does the first round of treatment last, and what do the infusions involve?'],
        [2, 16, 'admin', 'Go through the angiography report line by line: which branches, which eye, and what it changes.'],
        [1, 20, 'client', 'A hearing test again before treatment starts, so there is a baseline?'],
      ].forEach(([days, h, who, text], i) => store.docs.set(`${key}/agenda/a${i}`, {
        text, by: who === 'admin' ? 'demo-admin' : 'showcase-joe-bloe', role: who, at: ago(days, h), done: false, doneAt: null,
      }));
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
      // As the Worker (2026-10-16): nobody real behind it goes from the
      // folder; a real client's case only with their name typed in Settings.
      // In his practice copy every client is invented, so every folder deletes.
      const fake = LIVE || (!c.clientUid && !!(c.self || c.showcase));
      if (!fake) {
        const norm = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
        const typed = norm(body.confirmName);
        if (body.real !== true || !typed || ![norm(c.clientName), norm(c.clientEmail)].filter(Boolean).includes(typed))
          return fail(409, `To delete a client's case, type ${c.clientName || 'their name'} exactly, in Settings on their case.`);
      }
      let docs = 0;
      for (const k of [...store.docs.keys()]) {
        if (k === `cases/${id}` || k.startsWith(`cases/${id}/`) || k === `caseMeta/${id}`) { store.docs.delete(k); docs++; }
      }
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
      // On Full-Service, the advocate's own price for attending, or not offered (2026-10-17).
      const attend = c.fullAccess ? demoAddons(c.advocateId).attend : null;
      if (attend && !attend.on) return fail(409, 'Your advocate does not come to appointments on Full-Service. Ask in chat.');
      const cents = attend ? attend.cents : 52500;
      if (!cents) {
        store.docs.set(key, { ...c, pendingTelehealth: { ...req, state: 'requested', paidCents: 0 } });
        store.persist?.();
        return ok({ ok: true, requested: true });
      }
      // Straight past Stripe, landing as a paid request.
      store.docs.set(key, { ...c, pendingTelehealth: { ...req, state: 'requested', paidCents: cents } });
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
      // About you rides the study's answer (2026-10-16), as the Worker's aboutYou does.
      const style = store.docs.get('advisorStyle/profile') || {};
      return ok({ ...demoVoice, about: { voice: style.voice || '', stances: style.stances || '', coaching: style.coaching || '', updatedAt: style.updatedAt || null } });
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
      // The month price, the same as the first (Eric, 2026-10-17: "$4,400").
      const cents = 440000;
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
    // PAST THE MONTH'S HOURS (2026-10-17, v7.78), as worker/hours.js answers
    // it: the client's choice, and the advocate's bill, which lands paid here
    // because there is no Stripe to pay it through.
    if (path === '/api/hours-choice') {
      const key = `cases/${body.caseId || ''}`;
      const c = store.docs.get(key);
      if (!c) return fail(404, 'Not found');
      if (!needsChoice(c)) return fail(409, 'There is nothing to choose right now.');
      const choice = body.choice === 'hourly' ? 'hourly' : body.choice === 'end' ? 'end' : '';
      if (!choice) return fail(400, 'Bad request');
      const at = new Date();
      const picked = { kind: choice, month: hoursOf(c).months, at, ...(choice === 'hourly' ? { rateCents: EXTRA_HOUR_CENTS } : {}) };
      store.docs.set(key, choice === 'hourly' ? { ...c, hoursChoice: picked } : {
        ...c, hoursChoice: picked, status: 'closed', closedAt: at, closedBy: 'client', closedFromStatus: c.status || 'confirmed',
        closedReason: 'You ended the case after your month\'s 20 hours. Everything in it stays here for your reference.',
        pendingExtend: null, extendRequest: null, work: { ...(c.work || {}), startedAt: null },
      });
      store.persist?.(); store.fire?.(key);
      return ok({ ok: true, choice });
    }
    if (path === '/api/admin/bill-hours') {
      const key = `cases/${body.caseId || ''}`;
      const c = store.docs.get(key);
      if (!c) return fail(404, 'Not found');
      const h = hoursOf(c);
      if (c.hoursChoice?.kind !== 'hourly' || Number(c.hoursChoice.month) !== h.months) return fail(409, 'They have not chosen to continue by the hour.');
      const seconds = Math.floor(h.extra / 60) * 60;
      if (seconds < 60) return fail(409, 'Nothing past the month\'s hours is left to bill.');
      const cents = extraCents(seconds);
      const at = new Date();
      store.docs.set(key, {
        ...c,
        hoursBilledSec: h.billed + seconds,
        extraPayments: [...(Array.isArray(c.extraPayments) ? c.extraPayments : []), { kind: 'hours', amountCents: cents, sessionId: `cs_demo_hours_${at.getTime()}`, at, seconds }],
      });
      store.persist?.(); store.fire?.(key);
      return ok({ ok: true, seconds, cents, paid: true });
    }
    // ANOTHER MONTH, ASKED FOR AFTER ONE ENDED (2026-10-17), as
    // worker/monthend.js answers it. There is no Stripe here, so a yes lands
    // where paying would have: the case open again, thirty days from today.
    // Their own monthly service has its own door (2026-10-17, v7.75), on its own switch.
    if (path === '/api/extend-request' || path === '/api/service-month-request') {
      const key = `cases/${body.caseId || ''}`;
      const c = store.docs.get(key);
      if (!c) return fail(404, 'Not found');
      const svcDoor = path === '/api/service-month-request';
      const label = String(c.service?.label || 'your service');
      if (svcDoor ? (c.serviceMonthly !== true || c.status !== 'closed' || !c.monthEndedAt) : (!c.fullAccess || c.status !== 'closed' || !c.monthEndedAt))
        return fail(409, svcDoor ? `Another month can be asked for once a month of ${label} has ended.` : 'Another month can be asked for once a month of Full-Service has ended.');
      // The Worker reads the service as it stands now. A client's demo tab may not hold the advocate's list, so the demo
      // refuses only one it can see switched off, and otherwise quotes the month at the price it was sold at.
      const svcRow = svcDoor ? demoServices(demoContractor(c.advocateId) || {}).find((x) => x.id === c.service?.id) : null;
      const svcCents = !svcDoor ? 0 : svcRow ? (svcRow.on && svcRow.kind === 'month' && svcRow.cents >= 50 ? svcRow.cents : 0) : Number(c.service?.cents) || 0;
      const req = c.extendRequest;
      if (body.action === 'withdraw') {
        if (req?.state !== 'pending') return fail(409, 'There is no request to withdraw.');
        store.docs.set(key, { ...c, extendRequest: null });
        store.persist?.(); store.fire?.(key);
        return ok({ ok: true, withdrawn: true });
      }
      if (req?.state === 'pending') return ok({ ok: true, state: 'pending', at: req.at });
      if (svcDoor && !svcCents) return fail(409, 'That service is not offered right now.');
      const next = { state: 'pending', at: new Date(), monthCents: svcDoor ? svcCents : 440000, decidedAt: null, declineReason: '' };
      store.docs.set(key, { ...c, extendRequest: next });
      store.persist?.(); store.fire?.(key);
      return ok({ ok: true, state: 'pending', at: next.at });
    }
    // A step up from chat (worker/stepup.js, 2026-10-17): the $50 chat month off a case or a first Full-Service month.
    if (path === '/api/step-up') {
      const sub = store.docs.get(`subscriptions/${me}`);
      const renewingSub = sub && (sub.status === 'active' || sub.status === 'trialing') && sub.cancelAtPeriodEnd !== true && !sub.stepUpCaseId;
      if (!renewingSub) return ok({ eligible: false, creditCents: 0 });
      const r = { caseCents: 210000, fullCents: 440000, ...(store.docs.get('config/rates') || {}) };
      return ok({ eligible: true, creditCents: 5000, caseCents: Math.max(100, r.caseCents - 5000), fullCents: Math.max(100, r.fullCents - 5000) });
    }
    // An appeal on a Full-Service case (worker/addons.js, 2026-10-17): asked, then answered.
    if (path === '/api/addon-request') {
      const key = `cases/${body.caseId || ''}`;
      const c = store.docs.get(key);
      if (!c) return fail(404, 'Not found');
      const req = c.addonRequest;
      if (body.action === 'withdraw') {
        if (req?.state !== 'pending') return fail(409, 'There is no request to withdraw.');
        store.docs.set(key, { ...c, addonRequest: null });
        store.persist?.(); store.fire?.(key);
        return ok({ ok: true, withdrawn: true });
      }
      if (!c.fullAccess) return fail(409, 'These are enhancements on Full-Service Case Management.');
      if (c.status === 'closed') return fail(409, 'This case is closed.');
      if (body.kind !== 'appeal' && !/^x[a-z0-9]{8}$/.test(String(body.kind || ''))) return fail(400, 'Bad add-on');
      if (req?.state === 'pending') return fail(409, 'You already have a request waiting on your advocate.');
      const all = demoAddons(c.advocateId);
      const mine = body.kind === 'appeal' ? null : all.custom.find((x) => x.id === body.kind);
      if (body.kind !== 'appeal' && !mine) return fail(400, 'Bad add-on');
      const offered = mine || all.appeal;
      if (!offered.on) return fail(409, 'Your advocate does not offer this one. Ask in chat.');
      const next = { kind: body.kind, label: mine ? mine.label : 'Writing an insurance appeal', state: 'pending', at: new Date(), cents: offered.cents, note: String(body.note || '').trim().slice(0, 600), decidedAt: null, declineReason: '' };
      store.docs.set(key, { ...c, addonRequest: next });
      store.persist?.(); store.fire?.(key);
      return ok({ ok: true, state: 'pending', at: next.at, cents: next.cents });
    }
    if (path === '/api/admin/addon-request') {
      const key = `cases/${body.caseId || ''}`;
      const c = store.docs.get(key);
      const req = c?.addonRequest;
      if (!c || req?.state !== 'pending') return fail(409, 'There is no request waiting.');
      if (body.decision === 'decline') {
        const reason = String(body.reason || '').trim();
        if (!reason) return fail(400, 'Write the reason. The client reads it word for word.');
        store.docs.set(key, { ...c, addonRequest: { ...req, state: 'declined', decidedAt: new Date(), declineReason: reason } });
        store.persist?.(); store.fire?.(key);
        return ok({ ok: true, state: 'declined' });
      }
      if (body.decision !== 'approve') return fail(400, 'Bad request');
      const asked = body.amountCents === undefined || body.amountCents === null ? null : Number(body.amountCents);
      if (asked !== null && (!Number.isInteger(asked) || asked < 0)) return fail(400, 'The amount has to be a whole number of cents, zero or more, under $20,000.');
      const cents = asked === null ? (Number(req.cents) || 0) : asked;
      const now = new Date();
      // No checkout in the demo: a yes is the paid landing at once.
      store.docs.set(key, {
        ...c,
        addonRequest: { ...req, state: 'started', decidedAt: now, startedAt: now },
        addonsBought: [...(Array.isArray(c.addonsBought) ? c.addonsBought : []), { kind: req.kind, label: req.label || '', cents, at: now, sessionId: `cs_demo_addon_${now.getTime()}` }],
        extraPayments: [...(Array.isArray(c.extraPayments) ? c.extraPayments : []), { kind: 'addon', addon: req.kind, label: req.label || '', amountCents: cents, sessionId: `cs_demo_addon_${now.getTime()}`, at: now }],
      });
      store.persist?.(); store.fire?.(key);
      return ok({ ok: true, state: 'started', cents });
    }
    if (path === '/api/admin/extend-request') {
      const key = `cases/${body.caseId || ''}`;
      const c = store.docs.get(key);
      const req = c?.extendRequest;
      if (!c || req?.state !== 'pending' || c.status !== 'closed') return fail(409, 'There is no request waiting.');
      if (body.decision === 'decline') {
        const reason = String(body.reason || '').trim();
        if (!reason) return fail(400, 'Write the reason. The client reads it word for word.');
        store.docs.set(key, { ...c, extendRequest: { ...req, state: 'declined', decidedAt: new Date(), declineReason: reason } });
        store.persist?.(); store.fire?.(key);
        return ok({ ok: true, state: 'declined' });
      }
      if (body.decision !== 'approve') return fail(400, 'Bad request');
      const asked = body.amountCents === undefined || body.amountCents === null ? null : Number(body.amountCents);
      if (asked !== null && (!Number.isInteger(asked) || asked < 0)) return fail(400, 'The amount has to be a whole number of cents, zero or more, under $20,000.');
      const cents = asked === null ? (Number(req.monthCents) || 0) : asked;
      const DAY = 86_400_000;
      if (c.serviceMonthly === true) {
        // Their own monthly service: its own clock, from the day it was taken on (worker/services.js serviceWindowEnd).
        const from = new Date(c.charge?.decidedAt || c.charge?.capturedAt || c.serviceAt || Date.now()).getTime();
        const endS = from + (30 + (Number(c.serviceExtraDays) || 0)) * DAY;
        const lapsedS = Math.max(0, Math.ceil((Date.now() - endS) / DAY));
        const at = new Date();
        store.docs.set(key, {
          ...c,
          status: c.closedFromStatus || 'confirmed', closedAt: null, closedBy: null, closedReason: null, monthNotice: null,
          serviceExtraDays: (Number(c.serviceExtraDays) || 0) + lapsedS + 30, serviceMonths: (Number(c.serviceMonths) || 1) + 1,
          extendRequest: { ...req, state: 'started', decidedAt: at, startedAt: at },
          extraPayments: [...(Array.isArray(c.extraPayments) ? c.extraPayments : []), { kind: 'extend', amountCents: cents, sessionId: `cs_demo_month_${at.getTime()}`, at, days: 30 }],
        });
        store.persist?.(); store.fire?.(key);
        return ok({ ok: true, state: 'started', cents });
      }
      const end0 = new Date(c.fullAccessAt || Date.now()).getTime() + (30 + (Number(c.fullAccessExtraDays) || 0)) * DAY;
      const lapsed = Math.max(0, Math.ceil((Date.now() - end0) / DAY));
      const now = new Date();
      store.docs.set(key, {
        ...c,
        status: c.closedFromStatus || 'confirmed', closedAt: null, closedBy: null, closedReason: null, monthNotice: null,
        fullAccessExtraDays: (Number(c.fullAccessExtraDays) || 0) + lapsed + 30,
        fullAccessMonths: (Number(c.fullAccessMonths) || 1) + 1,
        fullAccessRateCents: (Number(c.fullAccessRateCents) || 0) + cents,
        extendRequest: { ...req, state: 'started', decidedAt: now, startedAt: now },
        work: { ...(c.work || {}), monthStartSeconds: Math.max(0, Number(c.work?.seconds) || 0) },
        extraPayments: [...(Array.isArray(c.extraPayments) ? c.extraPayments : []), {
          kind: 'extend', amountCents: cents, sessionId: `cs_demo_month_${now.getTime()}`, at: now, days: 30,
        }],
      });
      store.persist?.(); store.fire?.(key);
      return ok({ ok: true, state: 'started', cents });
    }
    // SCHEDULE A CASE FROM A LEAD (2026-10-15): the Worker's five routes, on
    // the store, with its refusals in its words. The confirm writes the case
    // the way the webhook does for an invitation: confirmed and paid at once,
    // at his time and his price, under the invitation's own id.
    // A contractor schedules from their own leads too (2026-10-15); theirs are theirs alone.
    if (path === '/api/staff/leads') {
      if (!staff) return fail(404, 'Not found');
      const by = new Map();
      for (const [k, d] of store.docs.entries()) {
        if (!/^(invites|leads)\/[^/]+$/.test(k) || (d.advocateId || 'demo-admin') !== me || !d.email) continue;
        if (!by.has(d.email)) by.set(d.email, { email: d.email, name: d.name || '' });
      }
      return ok({ leads: [...by.values()] });
    }
    if (path === '/api/admin/lead-invite' || path === '/api/admin/lead-invites' || path === '/api/admin/lead-invite/cancel') {
      if (!staff) return fail(404, 'Not found');
      await beat(300);
      const sees = (d) => role === 'admin' || (d.advocateId || 'demo-admin') === me;
      if (path === '/api/admin/lead-invites') {
        const now = Date.now();
        const invites = [...store.docs.entries()]
          .filter(([k, d]) => /^invites\/[^/]+$/.test(k) && d.state === 'sent' && sees(d))
          .map(([k, d]) => ({ id: k.split('/')[1], mine: (d.advocateId || 'demo-admin') === me, email: d.email, name: d.name || '', start: new Date(d.start).toISOString(), priceCents: Number(d.priceCents) || 0, past: new Date(d.start).getTime() <= now }))
          .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
        return ok({ invites });
      }
      if (path === '/api/admin/lead-invite/cancel') {
        const key = `invites/${String(body.id || '')}`;
        const d = store.docs.get(key);
        if (!d) return ok({ ok: true, gone: true });
        if (!sees(d)) return fail(404, 'Not found');
        if (d.state === 'confirmed') return fail(409, 'They already confirmed it. The case is open.');
        store.docs.set(key, { ...d, state: 'canceled', canceledAt: new Date() });
        store.persist?.();
        return ok({ ok: true, canceled: true });
      }
      const email = String(body?.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, 'Their email address, please.');
      const start = new Date(typeof body?.start === 'string' ? body.start : NaN);
      if (Number.isNaN(start.getTime())) return fail(400, 'Pick a date and a time.');
      if (start.getTime() - Date.now() < 3600_000) return fail(400, 'Pick a time at least an hour from now.');
      const priceCents = Number(body?.priceCents);
      if (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 2000000) return fail(400, 'The price, from $0 to $20,000.');
      if (priceCents > 0 && priceCents < 50) return fail(400, 'Stripe cannot charge less than $0.50. Use 0 for no charge.');
      const id = `demo-invite-${Date.now().toString(36)}`;
      const name = String(body?.name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
      store.docs.set(`invites/${id}`, { email, name: name || null, start, priceCents, state: 'sent', createdAt: new Date(), by: me, caseId: null, advocateId: me });
      store.persist?.();
      // No mail leaves the demo; the link is what the email would carry.
      return ok({ ok: true, id, email, name, start, priceCents, emailed: true, link: `/book.html?invite=${id}&demo=client` });
    }
    if (path === '/api/invite' || path === '/api/invite/confirm') {
      await beat(300);
      const id = String(body?.id || '');
      const key = `invites/${id}`;
      const inv = /^[\w-]{6,64}$/.test(id) ? store.docs.get(key) : null;
      if (!inv) return fail(404, 'That invitation could not be found. Reply to the email and I will send another.');
      const profile = store.docs.get(`users/${me}`) || {};
      const mine = String(profile.email || 'jordan@example.demo').toLowerCase();
      if (mine !== String(inv.email).toLowerCase()) {
        const [u, h] = String(inv.email).split('@');
        return fail(403, `This invitation was sent to ${u.slice(0, 1)}***@${h}. Sign in with that address to confirm it.`);
      }
      if (inv.state === 'confirmed') return new Response(JSON.stringify({ error: 'This time is already confirmed, and your case is open.', caseId: inv.caseId }), { status: 409, headers: { 'content-type': 'application/json' } });
      if (inv.state !== 'sent') return fail(410, 'This invitation was withdrawn. Reply to the email and I will set up another time.');
      if (new Date(inv.start).getTime() <= Date.now()) return fail(410, 'The time on this invitation has passed. Reply to the email and I will set up another.');
      if (path === '/api/invite') return ok({ start: new Date(inv.start).toISOString(), priceCents: Number(inv.priceCents) || 0, name: inv.name || '' });
      if (!['phone', 'video'].includes(body.method)) return fail(400, 'Choose a meeting method.');
      if (!/^\+?[\d\s().-]{7,20}$/.test(String(body.phone || '').trim())) return fail(400, 'A valid phone number is required so I can reach you.');
      if (!['disclaimer', 'privacy', 'recording', 'service', 'phoneConsent'].every((f) => typeof body?.acks?.[f] === 'number'))
        return fail(400, 'All acknowledgment forms must be completed first.');
      const now = new Date();
      const cents = Number(inv.priceCents) || 0;
      store.docs.set(`cases/${id}`, {
        clientUid: 'demo-client',
        clientEmail: inv.email,
        clientName: profile.name || inv.name || 'Jordan Avery',
        clientDob: profile.dob || null,
        clientTz: body.tz || 'America/Denver',
        clientPhone: String(body.phone || '').trim() || null,
        clientAddress: String(body.address || '').trim().slice(0, 300) || null,
        status: 'confirmed',
        createdAt: now,
        appointment: { start: new Date(inv.start), durationMin: 60, method: body.method, phone: String(body.phone || '').trim() || null, joinLink: null, requested: false },
        publicElection: { choice: 'private', history: [{ choice: 'private', at: now }] },
        addOnFollowUp: false,
        forms: Object.fromEntries(Object.entries(body.acks || {}).map(([k, v]) => [k, new Date(v)])),
        files: [],
        reportDueAt: null,
        caseRateCents: cents,
        addonRateCents: 32500,
        fullAccess: false, fullAccessAt: null, fullAccessRateCents: null,
        stripe: { sessionId: `cs_demo_invite_${id}`, paymentIntentId: cents ? `pi_demo_invite_${id}` : null, amountTotal: cents || null },
        charge: null,
        invite: { id, priceCents: cents },
        work: { seconds: 0, startedAt: null },
      });
      store.docs.set(key, { ...inv, state: 'confirmed', confirmedAt: now, caseId: id });
      store.persist?.();
      store.fire?.(`cases/${id}`);
      // Paid: the walk comes back through the return page, as from Stripe. Free: straight to the case.
      return cents ? ok({ url: `/return.html?session_id=cs_demo_invite_${id}` }) : ok({ ok: true, caseId: id });
    }
    // A contractor's own service, bought once (2026-10-17: "Opens a case, no time"), as the Worker checks it.
    if (path === '/api/service-checkout') {
      const adv = typeof body.advocate === 'string' ? body.advocate : '';
      const rec = demoContractor(adv);
      const svc = rec ? demoServices(rec).find((x) => x.id === body.service) : null;
      if (!svc || !svc.on || !['once', 'month'].includes(svc.kind) || svc.cents < 50) return fail(404, 'That service is not offered right now.');
      if (!/^\+?[\d\s().-]{7,20}$/.test(String(body.phone || ''))) return fail(400, 'A valid phone number is required so your advocate can reach you.');
      if (!['disclaimer', 'privacy', 'recording', 'service', 'phoneConsent'].every((f) => typeof body?.acks?.[f] === 'number'))
        return fail(400, 'All acknowledgment forms must be completed first.');
      if (body.quotedCents !== undefined && Number(body.quotedCents) !== svc.cents) return fail(409, 'rate-changed', { priceCents: svc.cents });
      await beat(600);
      const profile = store.docs.get('users/demo-client') || {};
      const now = new Date();
      const id = 'demo-case-booked';
      store.docs.set(`cases/${id}`, {
        advocateId: adv, clientUid: 'demo-client', clientEmail: profile.email || 'jordan@example.demo', clientName: profile.name || 'Jordan Avery',
        clientDob: profile.dob || null, clientTz: body.tz || 'America/Denver', clientPhone: body.phone || null,
        clientAddress: String(body.address || '').trim().slice(0, 300) || null,
        status: 'confirmed', createdAt: now, appointment: null,
        service: { id: svc.id, label: svc.label, kind: svc.kind, cents: svc.cents }, chatUnlocked: true,
        // A month at a time (2026-10-17, v7.75), as createCaseFromSession writes it.
        ...(svc.kind === 'month' ? { serviceMonthly: true, serviceAt: now, serviceMonths: 1, serviceExtraDays: 0 } : {}),
        publicElection: { choice: 'private', history: [{ choice: 'private', at: now }] }, addOnFollowUp: false,
        forms: Object.fromEntries(Object.entries(body.acks || {}).map(([k, v]) => [k, new Date(v)])),
        files: [], reportDueAt: null, caseRateCents: svc.cents, addonRateCents: 32500,
        fullAccess: false, fullAccessAt: null, fullAccessRateCents: null,
        stripe: { sessionId: 'cs_demo_booked', paymentIntentId: 'pi_demo_booked', amountTotal: svc.cents },
        charge: {
          state: 'held', kind: 'case', authorizedCents: svc.cents, capturedCents: 0, paymentIntentId: 'pi_demo_booked', sessionId: 'cs_demo_booked',
          heldAt: now, expiresAt: new Date(now.getTime() + 7 * 86_400_000), decidedAt: null, capturedAt: null, remindedAt: null, ratedAt: null,
        },
        work: { seconds: 0, startedAt: null },
      });
      store.persist?.();
      store.fire?.(`cases/${id}`);
      return ok({ ok: true, url: '/return.html?session_id=cs_demo_booked' });
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
        // A time off a contractor's own hours (2026-10-17): checked against their hours and buffer.
        const advUid = typeof body.advocate === 'string' && body.advocate ? body.advocate : '';
        if (advUid) {
          const got = demoTimes(advUid);
          if (!got) return fail(404, 'That calendar is not open for booking.');
          const want = new Date(typeof body.start === 'string' ? body.start : NaN);
          if (Number.isNaN(want.getTime()) || !got.times.includes(want.toISOString())) return fail(409, 'That time is no longer available. Pick another.');
        }
        const profile = store.docs.get('users/demo-client') || {};
        const slot = body.slotId && !advUid ? store.docs.get(`availability/${body.slotId}`) : null;
        // The Worker refuses a slot taken out from under the buyer; a stale
        // tab re-paying here must not silently re-point a booked one.
        if (body.slotId && slot && slot.state !== 'open')
          return fail(409, 'That time was just taken. Pick another.');
        const isRequest = !advUid && !body.slotId && !!body.requestedStart;
        const start = advUid ? new Date(body.start) : isRequest ? new Date(body.requestedStart)
          : slot ? new Date(slot.start) : new Date();
        const now = new Date();
        const id = 'demo-case-booked';
        // The case price as the demo's settings hold it (2026-10-15), the
        // number the payment step quoted.
        const liveCase = (advUid && Number(demoContractor(advUid)?.settings?.rates?.caseCents)) || Number((store.docs.get('config/rates') || {}).caseCents) || 210000;
        store.docs.set(`cases/${id}`, {
          ...(advUid ? { advocateId: advUid } : {}),
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
          caseRateCents: liveCase,
          addonRateCents: 32500,
          fullAccess: false,
          fullAccessAt: null,
          fullAccessRateCents: null,
          stripe: {
            sessionId: 'cs_demo_booked', paymentIntentId: 'pi_demo_booked',
            amountTotal: liveCase,
          },
          // The hold (2026-09-06): held, not charged, waiting on his approval,
          // the way the Worker writes it.
          charge: {
            state: 'held', kind: 'case', authorizedCents: liveCase, capturedCents: 0,
            paymentIntentId: 'pi_demo_booked', sessionId: 'cs_demo_booked',
            heldAt: now, expiresAt: new Date(now.getTime() + 7 * 86_400_000),
            decidedAt: null, capturedAt: null, remindedAt: null, ratedAt: null,
          },
          work: { seconds: 0, startedAt: null },
        });
        if (slot) store.docs.set(`availability/${body.slotId}`, { ...slot, state: 'booked', caseId: id });
        if (advUid) {
          const sid = `${start.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 16)}-${advUid}`.slice(0, 64);
          store.docs.set(`availability/${sid}`, { start, durationMin: 60, state: 'booked', caseId: id, advocateId: advUid, adminCreated: true, fromHours: true });
        }
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
        const monthCents = 440000;
        const at = new Date();
        // Mirroring the Worker's upgradeCents (Eric, 2026-10-17): before the
        // report, the month less the case fee; after it, the full month.
        const delivered = !!c.reportDeliveredAt || c.status === 'delivered';
        store.docs.set(key, {
          ...c,
          fullAccessRequest: {
            state: 'pending', at, monthCents,
            firstMonthCents: delivered ? monthCents : Math.max(100, monthCents - Math.max(0, Number(c.caseRateCents) || 0)),
            ackAt: body.acks?.fullAccess || Date.now(),
            decidedAt: null, declineReason: '',
          },
        });
        store.persist?.();
        store.fire?.(key);
        return ok({ ok: true, state: 'pending', at });
      }
      // /api/subscribe: straight past Stripe to where paying would have landed.
      // The Worker's success_url is the subscriber's chat, and the webhook is
      // what opens the subscription; the demo does both (2026-10-10: it used
      // to land on the case return page, which is not where a chat
      // subscriber goes, so the chat flow could not be walked).
      if (path === '/api/subscribe') {
        const uid = me;
        const now = Date.now();
        // A contractor's own line (2026-10-17), as the Worker checks it.
        const adv = typeof body?.advocate === 'string' && body.advocate && body.advocate !== 'demo-admin' ? body.advocate : '';
        const theirs = adv ? demoContractor(adv) : null;
        if (adv && theirs?.settings?.offers?.chat !== true) return fail(404, 'That chat line is not open.');
        const prev = store.docs.get(`subscriptions/${uid}`);
        if (prev && (prev.advocateId || 'demo-admin') !== (adv || 'demo-admin'))
          return fail(409, 'Your earlier chat line was with another advocate, and that history stays private to them, so a line with someone else cannot start on this account yet. Ask through the Contact page and it will be sorted out.');
        const std = { subCents: 5000, ...(store.docs.get('config/rates') || {}) };
        store.docs.set(`subscriptions/${uid}`, {
          uid, status: 'active', termsAckAt: body?.termsAckAt || now,
          advocateId: adv || 'demo-admin', priceCents: Number(theirs?.settings?.rates?.subCents) > 0 ? theirs.settings.rates.subCents : std.subCents,
          createdAt: new Date(now), currentPeriodEnd: new Date(now + 30 * 86_400_000), stripeCustomerId: 'cus_demo',
        });
        store.persist?.();
        store.fire?.(`subscriptions/${uid}`);
        return ok({ ok: true, url: `/subscription.html?session_id=cs_demo_sub&demo=${role}` });
      }
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
      const invited = sid.startsWith('cs_demo_invite_') && store.docs.get(`cases/${sid.slice('cs_demo_invite_'.length)}`);
      if (invited) return ok({ ready: true, caseId: sid.slice('cs_demo_invite_'.length) });
      return ok({ ready: true, caseId: booked ? 'demo-case-booked' : DEMO_CASE_ID });
    }
    if (path === '/api/portal') {
      // The clear cancel (2026-10-15): the demo plays Stripe's cancel step,
      // ending the subscription at its period's end as Stripe would.
      if (body?.flow === 'cancel') {
        const key = `subscriptions/${me}`;
        const s = store.docs.get(key);
        if (s) { store.docs.set(key, { ...s, cancelAtPeriodEnd: true }); store.persist?.(); store.fire?.(key); }
      }
      return ok({ url: `/subscription.html?demo=${role}` });
    }
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
      let state = store.docs.get(`cases/${cid}/advisor/state`) || {};
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
        // One of a few answers, picked by the question (2026-10-17): the same
        // one on every case read as canned.
        const ANSWERS = [
          'I would give the clinic until Thursday before chasing it, because the fax went Monday and their intake takes three working days to log anything. If nothing is on the portal by then, I would call the department directly rather than the main line, since that is who actually holds the referral. You have what you need for the call; the next move is theirs.',
          'The file already answers part of that. What is missing is the date things changed, so I would ask for it on the next call before anyone orders another test. Once that date is down, the order of events tells most of the story.',
          'I would lead with the record that shows the pattern, not the newest one. Two lines on what has been tried, one on what is still open, and the single question you want answered. A short ask gets a straight answer more often than a long history does.',
        ];
        const answer = ANSWERS[[...String(d.question || '')].reduce((t, ch) => t + ch.charCodeAt(0), 0) % ANSWERS.length];
        store.docs.set(p, { ...d, status: 'done', batch: null, answer });
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
        // The medical half of the dictionary only, as the Worker filters it.
        glossary: [...store.docs.entries()]
          .filter(([p, d]) => p.startsWith('advisorKnowledge/') && !LEGACY_TRADE_CATS.includes(d.category || 'General'))
          .map(([p, d]) => ({ id: p.split('/').pop(), ...d, learned: !!d.learnedAt })),
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
          // A case with no read yet gets a first one (2026-10-17): Update on
          // a new case used to spin and settle back on "No assessment yet".
          store.docs.set(`cases/${cid}/advisor/state`, {
            ...state, ...(state.analysis ? {} : firstRead(store.docs.get(`cases/${cid}`) || {})), status: 'idle', updatedAt: new Date(),
          });
          store.persist?.();
          // His own case: the read's questions land in his chat, one bubble
          // each, once (2026-09-03). Mirrors askInChat in the Worker.
          const c = store.docs.get(`cases/${cid}`) || {};
          const asked = [...store.docs.keys()].some((k) => k.startsWith(`cases/${cid}/chat/`) && store.docs.get(k)?.role === 'question');
          if (c.self && !asked) {
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
            : cid === DEMO_CASE_ID
              ? 'Thanks for sending those through. I have read all three, and the discharge summary says more than anyone told you at the time. I will walk you through it on our call, and I am chasing the referral that was mentioned but never confirmed. Nothing for you to do today.'
              // Every other case its own words (2026-10-17): this one's files are not theirs.
              : `Thanks for sending that through, ${String(c.clientName || '').split(' ')[0] || 'and thank you'}. I have read everything in your file so far, and I will walk you through what it says on our next call. If anything changes before then, tell me here. Nothing for you to do today.`,
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
        // Kept (2026-10-17): it said Saved and was gone after a reload.
        store.persist?.();
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
      // Every other cover, from the mirror the Worker keeps on caseMeta.
      for (const [k, v] of store.docs.entries()) {
        if (!k.startsWith('caseMeta/')) continue;
        covers[k.slice('caseMeta/'.length)] = { text: v.workingDx?.text || '', by: v.workingDx?.by || 'advisor', at: { advisor: v.advisorAt || null } };
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

    // ---- saved messages ---------------------------------------------------
    // Per-case, like the routes it serves: hardcoding the fixture id meant a
    // save on the booked case landed under the fixture and listed there.
    if (path === '/api/saved') {
      const uid = me;
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
          by: me,
          // Normalised: the seamless door's role string is '1', and storing
          // it raw hid the Remove button (case.js gates on role === 'client').
          role: staff ? 'admin' : 'client',
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
      if (!staff) return fail(404, 'Not found');
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

    // ---- many advocates (2026-10-15) ----------------------------------------
    // His Advocates tab, an advocate's own account page and their notes,
    // mirrored over the demo store: the same answers and refusals as
    // worker/advocates.js, with nothing hashed because nothing is real.
    const advView = (uid, a = {}) => {
      const missing = [];
      if (!a.name) missing.push('name');
      if (!a.headshotPath) missing.push('headshot');
      if (!a.credentials) missing.push('credentials');
      if (!a.primarySpecialty) missing.push('primary specialty');
      if (!a.bio) missing.push('bio');
      return {
        uid, name: a.name || '', email: a.email || '', active: a.active === true, owner: a.owner === true,
        credentials: a.credentials || '', bio: a.bio || '', primarySpecialty: a.primarySpecialty || '',
        specialties: a.specialties || [], hasHeadshot: !!a.headshotPath, commissionPct: Number(a.commissionPct ?? 60),
        advisorOptIn: a.advisor?.optedIn === true, advisorEnabled: a.advisor?.enabled === true,
        acceptingNew: a.acceptingNew !== false, tz: a.tz || 'America/Boise', onboardedAt: a.onboardedAt || null, createdAt: a.createdAt || null, missing,
      };
    };
    const SPECIALTIES = ['Neurology', 'Autoimmune / Rheumatology', 'Cardiology', 'Oncology', 'Rare Disease', 'Complex / Undiagnosed Cases'];
    const ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Boise', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];
    // ---- employer mode, the temporary chat and payroll (2026-10-15) -------
    // The demo's own answers in the Worker's shapes (worker/employer.js and
    // worker/payroll.js): his alone where the Worker's are his alone, and an
    // advocate's thread is their own whatever the address says.
    const docsUnder = (prefix) => [...store.docs.entries()].filter(([k]) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map(([k, v]) => ({ id: k.slice(prefix.length), data: v }));
    const advOf = (c) => (typeof c?.advocateId === 'string' && c.advocateId) || 'demo-admin';
    const paidOf = (c) => {
      const base = Number(c?.paidOverrideCents) || (c?.charge?.state ? (c.charge.state === 'captured' ? Number(c.charge.capturedCents) || 0 : 0) : Number(c?.stripe?.amountTotal) || Number(c?.caseRateCents) || 0);
      let paid = base; let tips = 0;
      for (const p of (Array.isArray(c?.extraPayments) ? c.extraPayments : [])) {
        if (p?.duplicate) continue;
        if (p?.kind === 'tip') tips += Number(p.amountCents) || 0; else paid += Number(p?.amountCents) || 0;
      }
      return { base, paid, tips };
    };
    const kindOf = (c) => (c?.showcase && !c?.sample ? 'Showcase' : c?.self ? 'Own case' : c?.family ? 'Family' : c?.fullAccess ? 'Full-Service' : 'Advocacy Case');
    const pctOf = (a, id) => (a?.owner || id === 'demo-admin' ? 100 : Number.isFinite(Number(a?.commissionPct)) ? Number(a.commissionPct) : 60);
    // The sample contractor's three invented clients, as worker/employer.js sampleRecords writes them.
    const sampleCases = () => {
      const now = Date.now();
      const at = (d) => new Date(now + d * 86_400_000).toISOString();
      const mk = (id, name, extra) => store.docs.set(`cases/${id}`, { sample: true, showcase: true, sampleOf: 'demo-sample', advocateId: 'demo-sample', clientName: name, clientEmail: `${id}@example.com`, createdAt: at(-20), ...extra });
      mk('demo-sample-dana', 'Dana Whitfield', { status: 'confirmed', charge: { state: 'captured', capturedCents: 210000, capturedAt: at(-6) }, appointment: { start: at(4), method: 'video' } });
      mk('demo-sample-luis', 'Luis Ortega', { status: 'delivered', fullAccess: true, charge: { state: 'captured', capturedCents: 210000, capturedAt: at(-18) }, extraPayments: [{ kind: 'fullaccess', amountCents: 230000, at: at(-12) }] });
      mk('demo-sample-grace', 'Grace Kim', { status: 'awaiting_report', charge: { state: 'captured', capturedCents: 210000, capturedAt: at(-9) }, extraPayments: [{ kind: 'tip', amountCents: 5000, at: at(-2) }] });
    };
    // DEMO MODE: the practice team's clients, set from the payroll screen
    // (Eric, 2026-10-16: "allow me to adjust each fake contractor's amount of
    // clients and type before I run fake payroll"). Demo mode only, his only.
    // Each person's book is replaced with that many clients of that kind, paid
    // inside the dates he chose, so the payroll he runs next shows exactly it.
    if (path === '/api/demo/practice') {
      if (!LIVE || role !== 'admin') return fail(404, 'Not found');
      const rates = { caseCents: 210000, addonCents: 32500, subCents: 5000, fullCents: 440000, ...(store.docs.get('config/rates') || {}) };
      const team = LIVE_TEAM.filter((t) => store.docs.get(`advocates/${t.uid}`)?.active === true);
      const bookOf = (uid) => {
        const cases = docsUnder('cases/').filter((r) => r.data.advocateId === uid && !r.data.self);
        const subs = docsUnder('subscriptions/').filter((r) => r.data.advocateId === uid);
        return { cases, subs };
      };
      const kindNow = ({ cases, subs }) => (subs.length && !cases.length ? 'chat'
        : cases.some((r) => r.data.fullAccess) ? 'full'
          : cases.some((r) => (r.data.extraPayments || []).some((p) => p?.kind === 'followup')) ? 'followup' : 'case');
      if ((init.method || 'GET') === 'GET') {
        const saved = store.docs.get('demo/practice') || {};
        return ok({
          people: team.map((t) => {
            const b = bookOf(t.uid);
            const a = store.docs.get(`advocates/${t.uid}`) || {};
            return { uid: t.uid, name: a.name || t.name, pct: pctOf(a, t.uid), clients: saved[t.uid]?.clients ?? (b.cases.length + b.subs.length), kind: saved[t.uid]?.kind || kindNow(b) };
          }),
        });
      }
      const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
      const s = DAY_RE.test(String(body.start || '')) ? new Date(`${body.start}T12:00:00-07:00`).getTime() : NaN;
      const e = DAY_RE.test(String(body.end || '')) ? new Date(`${body.end}T12:00:00-07:00`).getTime() : NaN;
      if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return fail(400, 'Choose the payroll dates first, the end after the start.');
      const want = new Map((Array.isArray(body.people) ? body.people : []).map((p) => [String(p?.uid || ''), p]));
      const KINDS = ['case', 'full', 'followup', 'chat'];
      // No name on two people's books (2026-10-17): each team member draws from
      // their own surnames, and the first names turn over within a book.
      const FIRSTS = ['Avery', 'Mina', 'Owen', 'Ruth', 'Theo', 'Lena', 'Caleb', 'Iris', 'Felix', 'Hana', 'Jonah', 'Nora'];
      const LASTS = [['Brooks', 'Patel', 'Hughes'], ['Alvarez', 'Grant', 'Novak'], ['Ward', 'Moreno', 'Chen'], ['Sato', 'Reyes', 'Quinn'], ['Lund', 'Okoro', 'Vance']];
      const saved = { ...(store.docs.get('demo/practice') || {}) };
      let total = 0;
      team.forEach((t, ti) => {
        const p = want.get(t.uid);
        if (!p) return;
        const clients = Math.max(0, Math.min(12, Math.round(Number(p.clients) || 0)));
        const kind = KINDS.includes(p.kind) ? p.kind : 'case';
        // Their old book goes, with everything under it.
        const { cases, subs } = bookOf(t.uid);
        for (const r of [...cases.map((x) => `cases/${x.id}`), ...subs.map((x) => `subscriptions/${x.id}`)]) {
          for (const k of [...store.docs.keys()]) if (k === r || k.startsWith(`${r}/`)) store.docs.delete(k);
          for (const k of [...store.files.keys()]) if (k.startsWith(`${r}/`)) store.files.delete(k);
        }
        const first = (store.docs.get(`advocates/${t.uid}`)?.name || t.name).split(' ')[0];
        for (let n = 0; n < clients; n++) {
          const at = new Date(s + ((n + 1) / (clients + 1)) * (e - s + 86_400_000 / 2));
          const id = `practice-${t.uid.replace(/^demo-/, '')}-${n + 1}`;
          const name = `${FIRSTS[(ti * 3 + n) % FIRSTS.length]} ${LASTS[ti % LASTS.length][n % 3]}`;
          const client = `${id}-client`;
          const email = `${name.split(' ')[0].toLowerCase()}.${n + 1}@example.demo`;
          if (kind === 'chat') {
            store.docs.set(`subscriptions/${client}`, {
              uid: client, email, name, advocateId: t.uid, status: 'active', createdAt: at,
              currentPeriodEnd: new Date(at.getTime() + 30 * 86_400_000), stripeCustomerId: `cus_${id}`,
              demoInvoices: [{ cents: rates.subCents, at }],
              lastMessage: { text: `Hi ${first}, thank you for taking me on.`, from: client, role: 'client', ts: at, emailed: true },
            });
            store.docs.set(`subscriptions/${client}/chat/p001`, { from: client, role: 'client', text: `Hi ${first}, thank you for taking me on.`, ts: at });
            total += 1;
            continue;
          }
          // A follow-up call is paid in this period on a case bought before it.
          const booked = kind === 'followup' ? new Date(s - 20 * 86_400_000) : at;
          const c = {
            advocateId: t.uid, clientUid: client, clientEmail: email, clientName: name, clientTz: 'America/Denver',
            status: kind === 'followup' ? 'delivered' : kind === 'full' ? 'awaiting_report' : 'confirmed',
            createdAt: booked, publicElection: { choice: 'private', history: [{ choice: 'private', at: booked }] },
            forms: { disclaimer: booked, privacy: booked, recording: booked }, files: [],
            caseRateCents: rates.caseCents, addonRateCents: rates.addonCents, addOnFollowUp: kind === 'followup',
            charge: { state: 'captured', capturedCents: kind === 'full' ? rates.fullCents : rates.caseCents, capturedAt: booked },
            work: { seconds: 0, startedAt: null },
            appointment: { start: new Date(booked.getTime() + 4 * 86_400_000), durationMin: 60, method: 'video', joinLink: null, requested: false },
            lastMessage: { text: `Hi ${first}, thank you for taking my case.`, from: client, role: 'client', ts: at, emailed: true },
          };
          if (kind === 'full') Object.assign(c, { fullAccess: true, fullAccessAt: booked, fullAccessMonths: 1, consultDoneAt: booked, reportDueAt: null });
          if (kind === 'followup') Object.assign(c, { reportDeliveredAt: new Date(s - 6 * 86_400_000), extraPayments: [{ kind: 'followup', amountCents: rates.addonCents, at }] });
          store.docs.set(`cases/${id}`, c);
          store.docs.set(`cases/${id}/chat/p001`, { from: client, role: 'client', text: `Hi ${first}, thank you for taking my case.`, ts: at });
          total += 1;
        }
        saved[t.uid] = { clients, kind };
      });
      store.docs.set('demo/practice', saved);
      store.persist?.();
      store.fire?.('');
      return ok({ ok: true, clients: total });
    }
    if (path === '/api/admin/team') {
      if (role !== 'admin') return fail(404, 'Not found');
      // Her clients put back when she has none left (2026-10-16), as the Worker does.
      if ((init.method || 'GET') === 'GET' && store.docs.get('advocates/demo-sample')?.sample && !docsUnder('cases/').some((r) => r.data.sample === true)) { sampleCases(); store.persist?.(); }
      if ((init.method || 'GET') === 'POST') {
        if (body.action === 'sample-create') {
          if (store.docs.has('advocates/demo-sample')) return ok({ ok: true, existing: true });
          const now = Date.now();
          const at = (d) => new Date(now + d * 86_400_000).toISOString();
          store.docs.set('advocates/demo-sample', { uid: 'demo-sample', name: 'Maya Torres', email: 'maya.torres@example.com', sample: true, active: true, owner: false, commissionPct: 60, onboardedAt: at(0), credentials: 'RN, BSN. Board Certified Patient Advocate', primarySpecialty: 'Neurology', specialties: ['Neurology', 'Rare Disease'], headshotPath: null });
          sampleCases();
          store.docs.set('payouts/demo-sample', { method: 'zelle', hint: 'Zelle to ma…om (sample)', details: { name: 'Maya Torres', handle: 'maya.torres@example.com' } });
          store.persist?.();
          return ok({ ok: true });
        }
        if (body.action === 'sample-remove') {
          for (const k of [...store.docs.keys()]) if (/^(advocates|payouts|staffChats)\/demo-sample$/.test(k) || /^cases\/demo-sample-/.test(k)) store.docs.delete(k);
          store.persist?.();
          return ok({ ok: true });
        }
        return fail(400, 'Bad request');
      }
      const people = new Map();
      for (const { id, data: a } of docsUnder('advocates/')) {
        if (a.active !== true && !a.owner) continue;
        people.set(id, { uid: id, name: a.name || a.email || 'Advocate', owner: !!a.owner, sample: !!a.sample, active: true, onboarded: !!a.onboardedAt || !!a.owner, hasPhoto: !!a.headshotPath || !!a.owner, bio: a.bio || '', credentials: a.credentials || '', photoV: String(a.photoV || ''), addons: demoAddons(id), commissionPct: pctOf(a, id), open: 0, closed: 0, kinds: {}, chatLines: 0, late: 0, paidCents: 0, tipsCents: 0, proposedCents: 0, clients: [] });
      }
      for (const { id, data: c } of docsUnder('cases/')) {
        const p = people.get(advOf(c));
        if (!p) continue;
        if (c.status === 'closed') { p.closed += 1; continue; }
        const k = kindOf(c);
        p.open += 1; p.kinds[k] = (p.kinds[k] || 0) + 1;
        // A report past its due day marks them (as worker/employer.js counts it).
        const late = caseDay(c)?.late === true;
        if (late) p.late += 1;
        p.clients.push({ id, name: c.clientName || 'Client', kind: k, status: c.status || '', late });
        if (c.self || c.family || (c.showcase && !c.sample)) continue;
        const { paid, tips } = paidOf(c);
        p.paidCents += paid; p.tipsCents += tips; p.proposedCents += Math.round(paid * p.commissionPct / 100) + tips;
      }
      // Priority Chat, as worker/employer.js teamSummary counts it (2026-10-16).
      const subCents = Number({ subCents: 5000, ...(store.docs.get('config/rates') || {}) }.subCents) || 0;
      for (const { data: sb } of docsUnder('subscriptions/')) {
        if (!sb || sb.status === 'canceled' || sb.cancelAtPeriodEnd || !(new Date(sb.currentPeriodEnd || 0).getTime() > Date.now())) continue;
        const p = people.get(advOf(sb));
        if (!p) continue;
        p.chatLines += 1;
        p.kinds['Priority Chat'] = (p.kinds['Priority Chat'] || 0) + 1;
        p.paidCents += subCents;
        p.proposedCents += Math.round(subCents * p.commissionPct / 100);
      }
      const team = [...people.values()].sort((a, b) => (b.owner - a.owner) || (a.sample - b.sample) || a.name.localeCompare(b.name))
        .map((p) => {
          const chat = store.docs.get(`staffChats/${p.uid}`);
          const pay = store.docs.get(`payouts/${p.uid}`);
          return { ...p, unread: Number(chat?.adminUnread) || 0, chatOpen: !!chat?.messages?.length, payout: pay ? { method: pay.method, hint: pay.hint } : null };
        });
      return ok({ team, sample: team.some((p) => p.sample) });
    }
    if (path === '/api/staff/chat') {
      if (!staff) return fail(404, 'Not found');
      const side = role === 'admin' ? 'admin' : 'advocate';
      const who = side === 'admin' ? String(q.get('uid') || body.uid || '') : me;
      const adv = store.docs.get(`advocates/${who}`);
      if (!who || !adv || (side === 'admin' && adv.owner)) return fail(404, 'Not found');
      const key = `staffChats/${who}`;
      const d = store.docs.get(key) || {};
      const view = (x) => ({ open: !!(x.messages || []).length, messages: (x.messages || []).slice(), unread: side === 'admin' ? Number(x.adminUnread) || 0 : Number(x.advocateUnread) || 0 });
      if ((init.method || 'GET') === 'GET') return ok(view(d));
      if (body.action === 'close') {
        if (side !== 'admin') return fail(404, 'Not found');
        store.docs.delete(key); store.persist?.();
        return ok({ ok: true, open: false });
      }
      if (body.action === 'read') {
        if (store.docs.has(key)) store.docs.set(key, { ...d, [side === 'admin' ? 'adminUnread' : 'advocateUnread']: 0 });
        store.persist?.();
        return ok({ ok: true });
      }
      if (body.action === 'send') {
        const text = String(body.text || '').trim().slice(0, 1000);
        if (!text) return fail(400, 'Write something first.');
        const next = {
          messages: [...(d.messages || []), { id: `m${Date.now().toString(36)}`, from: side, text, at: new Date().toISOString() }].slice(-200),
          adminUnread: side === 'advocate' ? (Number(d.adminUnread) || 0) + 1 : 0,
          advocateUnread: side === 'admin' ? (Number(d.advocateUnread) || 0) + 1 : 0,
        };
        store.docs.set(key, next); store.persist?.();
        return ok({ ok: true, ...view(next) });
      }
      return fail(400, 'Bad request');
    }
    // A contractor's own settings (2026-10-15), mirroring worker/staffsettings.js.
    if (path === '/api/staff/settings') {
      // Setup first, as the Worker's requireStaff (2026-10-16).
      if (role !== 'advocate' || !staff) return fail(404, 'Not found');
      const key = `advocates/${me}`;
      const rec = store.docs.get(key) || {};
      const set = { ...(rec.settings || {}), office: { ...(rec.settings?.office || {}) }, rates: { ...(rec.settings?.rates || {}) }, fullCap: rec.settings?.fullCap ?? null, hours: rec.settings?.hours || null };
      if ((init.method || 'GET') === 'POST') {
        if (body.office?.manual !== undefined) {
          if (![null, 'in', 'out'].includes(body.office.manual)) return fail(400, 'In office, out of office, or follow the office hours.');
          set.office.manual = body.office.manual;
        }
        if (body.office?.responseTime !== undefined) set.office.responseTime = String(body.office.responseTime ?? '').trim().slice(0, 160) || null;
        for (const k of ['caseCents', 'addonCents', 'fullCents', 'subCents']) {
          const v = body.rates?.[k];
          if (v === undefined) continue;
          if (v !== null && !(Number.isInteger(v) && v >= 50 && v <= 2_000_000)) return fail(400, 'A price from $0.50 to $20,000.');
          set.rates[k] = v;
        }
        if (body.fullCap !== undefined) {
          if (body.fullCap !== null && !(Number.isInteger(body.fullCap) && body.fullCap >= 0 && body.fullCap <= 99)) return fail(400, 'A number from 0 (no limit) to 99.');
          set.fullCap = body.fullCap;
        }
        // Their own week (2026-10-17); what they offer is his to set, never theirs.
        if (body.offers !== undefined) return fail(400, 'What you offer is set by Eric.');
        if (body.hours !== undefined) {
          if (body.hours !== null) {
            for (const [d, v] of Object.entries(body.hours)) {
              if (v && (!/^\d\d:\d\d$/.test(String(v.from)) || !/^\d\d:\d\d$/.test(String(v.to)) || v.to <= v.from)) return fail(400, 'Each working day ends after it starts.');
              if (!['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].includes(d)) return fail(400, 'Their hours, day by day.');
            }
          }
          set.hours = body.hours;
        }
        let services = rec.services;
        if (body.services !== undefined) {
          const sv = cleanDemoServices(body.services, demoServices(rec), false);
          if (sv.error) return fail(400, sv.error);
          services = sv.value;
        }
        store.docs.set(key, { ...rec, settings: set, ...(services !== undefined ? { services } : {}) });
        store.persist?.();
      }
      const SEEDS = { caseCents: 210000, addonCents: 32500, fullCents: 440000 };
      const std = { ...SEEDS, ...(store.docs.get('config/rates') || {}) };
      const manual = set.office.manual || null;
      const now = new Date();
      const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Boise', weekday: 'short' }).format(now);
      const hr = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Boise', hour: 'numeric', hour12: false }).format(now)) % 24;
      let scheduled = !['Fri', 'Sat', 'Sun'].includes(wd) && hr >= 8 && hr < 19;
      // Their own week, on their clock, when they have one (worker/schedule.js openByHours).
      if (set.hours) {
        const tz = rec.tz || 'America/Boise';
        const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now).slice(0, 3).toLowerCase();
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(now);
        const hh = Number(parts.find((p) => p.type === 'hour').value) % 24; const mm = Number(parts.find((p) => p.type === 'minute').value);
        const span = set.hours[day];
        const at = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
        scheduled = !!span && at >= span.from && at < span.to;
      }
      const rates = Object.fromEntries(Object.entries(set.rates).filter(([, v]) => Number(v) > 0));
      return ok({
        office: { inOffice: manual ? manual === 'in' : scheduled, scheduled, manual, responseTime: set.office.responseTime || null },
        rates, standard: { caseCents: std.caseCents, addonCents: std.addonCents, fullCents: std.fullCents }, fullCap: set.fullCap,
        hours: set.hours || null, tz: rec.tz || 'America/Boise', offers: { case: set.offers?.case !== false, full: set.offers?.full !== false, chat: set.offers?.chat === true },
        bookingPath: `/book.html?advocate=${encodeURIComponent(me)}`, bufferHours: demoBuffer(rec),
        chatPath: set.offers?.chat === true ? `/subscribe.html?advocate=${encodeURIComponent(me)}` : null,
        services: demoServices(store.docs.get(key)),
      });
    }
    if (path === '/api/staff/payout') {
      if (!staff) return fail(404, 'Not found');
      const METHODS = { ach: 'Direct deposit (ACH)', check: 'Paper check', zelle: 'Zelle', paypal: 'PayPal', venmo: 'Venmo', other: 'Other' };
      if ((init.method || 'GET') === 'GET') {
        const p = store.docs.get(`payouts/${me}`);
        return ok({ method: p?.method || '', label: METHODS[p?.method] || '', hint: p?.hint || '', methods: METHODS });
      }
      const m = String(body.method || '');
      const fl = body.fields || {};
      const got = demoPayout(m, fl);
      if (got.error) return fail(400, got.error);
      const hint = got.hint;
      store.docs.set(`payouts/${me}`, { method: m, hint, details: fl });
      store.persist?.();
      return ok({ ok: true, method: m, label: METHODS[m], hint });
    }
    if (path === '/api/admin/payroll') {
      if (role !== 'admin') return fail(404, 'Not found');
      const METHODS = { ach: 'Direct deposit (ACH)', check: 'Paper check', zelle: 'Zelle', paypal: 'PayPal', venmo: 'Venmo', other: 'Other' };
      const payoutFor = (uid) => { const p = store.docs.get(`payouts/${uid}`); return p ? { method: p.method, label: METHODS[p.method] || '', hint: p.hint, details: p.details } : null; };
      const totalsOf = (rows) => {
        const s = (k) => rows.filter((r) => !r.sample).reduce((t, r) => t + r[k], 0);
        return { cases: s('cases'), salesCents: s('salesCents'), commissionCents: s('commissionCents'), tipsCents: s('tipsCents'), deductionsCents: s('deductionsCents'), adjustmentsCents: s('adjustmentsCents'), totalCents: s('totalCents') };
      };
      const shown = (run) => ({ ...run, rows: (run.rows || []).map((r) => ({ ...r, payout: payoutFor(r.uid) })) });
      const runs = () => docsUnder('payrollRuns/');
      if ((init.method || 'GET') === 'GET') {
        const id = q.get('id');
        if (id) { const r = store.docs.get(`payrollRuns/${id}`); return r ? ok({ run: shown({ id, ...r }) }) : fail(404, 'Not found'); }
        return ok({ runs: runs().map(({ id, data: r }) => ({ id, status: r.status, start: r.start, end: r.end, preset: r.preset, createdAt: r.createdAt, confirmedAt: r.confirmedAt || null, editedAt: r.editedAt || null, totals: r.totals, people: (r.rows || []).filter((x) => !x.sample).length, sampleCents: (r.rows || []).filter((x) => x.sample).reduce((t, x) => t + (Number(x.totalCents) || 0), 0) })).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))) });
      }
      if (body.action === 'generate') {
        const s = new Date(`${body.start}T00:00:00-07:00`).getTime();
        const e = new Date(`${body.end}T00:00:00-07:00`).getTime() + 86_400_000;
        if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return fail(400, 'Choose a start and an end day, the end after the start.');
        const inR = (v) => { const t = new Date(v).getTime(); return Number.isFinite(t) && t >= s && t < e; };
        const rows = new Map();
        for (const { id, data: a } of docsUnder('advocates/')) {
          // Turned off keeps a row for what they earned (2026-10-16), as the Worker does.
          rows.set(id, { uid: id, name: a.name || 'Advocate', owner: !!a.owner, sample: !!a.sample, off: a.active !== true && !a.owner, commissionPct: pctOf(a, id), cases: 0, salesCents: 0, commissionCents: 0, tipsCents: 0, deductionsCents: 0, adjustmentsCents: 0, totalCents: 0, lines: [], adjustments: [] });
        }
        const seen = new Map();
        const cases = docsUnder('cases/');
        for (const { id, data: c } of cases) {
          // The sample contractor's money is made for the period below, as worker/payroll.js sampleLines does.
          if (c.self || c.family || c.showcase || c.sample) continue;
          const row = rows.get(advOf(c)) || rows.get('demo-admin');
          if (!row) continue;
          const add = (kind, label, cents, at) => {
            const pay = kind === 'tip' ? cents : Math.round(cents * row.commissionPct / 100);
            if (kind === 'tip') row.tipsCents += cents; else { row.salesCents += cents; row.commissionCents += pay; if (!seen.has(row.uid)) seen.set(row.uid, new Set()); seen.get(row.uid).add(id); }
            row.lines.push({ caseId: id, client: c.clientName || 'Client', kind, label, cents, payCents: pay, at: new Date(at).toISOString() });
          };
          const { base } = paidOf(c);
          const bookedAt = c.charge?.capturedAt || c.createdAt;
          if (base > 0 && inR(bookedAt)) add('booking', c.fullAccess ? 'Full-Service month' : 'Advocacy Case', base, bookedAt);
          for (const p of (c.extraPayments || [])) if (!p?.duplicate && Number(p?.amountCents) && inR(p.at)) add(p.kind || 'extra', p.kind === 'tip' ? 'Tip' : p.kind === 'fullaccess' ? 'Full-Service month' : p.kind === 'followup' ? 'Follow-up call' : 'Payment', Number(p.amountCents), p.at);
        }
        // Priority Chat months. The real report asks Stripe for these; in the
        // demo each subscription carries its own invoices (`demoInvoices`).
        for (const { id, data: sb } of docsUnder('subscriptions/')) {
          const row = rows.get(advOf(sb)) || rows.get('demo-admin');
          if (!row) continue;
          for (const inv of (Array.isArray(sb.demoInvoices) ? sb.demoInvoices : [])) {
            const cents = Number(inv?.cents) || 0;
            if (!cents || !inR(inv.at)) continue;
            const pay = Math.round(cents * row.commissionPct / 100);
            row.salesCents += cents; row.commissionCents += pay;
            if (!seen.has(row.uid)) seen.set(row.uid, new Set());
            seen.get(row.uid).add(`sub-${id}`);
            row.lines.push({ caseId: '', client: sb.name || sb.email || 'Priority Chat', kind: 'sub', label: 'Priority Chat month', cents, payCents: pay, at: new Date(inv.at).toISOString() });
          }
        }
        const hers = cases.find((r) => r.data.sample === true);
        const maya = hers && rows.get(advOf(hers.data));
        if (maya) {
          const NAMES = ['Dana Whitfield', 'Priya Shah', 'Grace Kim', 'Tom Becker', 'Ruth Alvarez', 'Sam Okafor', 'Nina Patel', 'Owen Hughes'];
          const TIPS = [5000, 7500, 10000];
          const SHIFT = 7 * 3_600_000; const DAY = 86_400_000;
          const add = (caseId, client, kind, label, cents, at) => {
            const pay = kind === 'tip' ? cents : Math.round(cents * maya.commissionPct / 100);
            if (kind === 'tip') maya.tipsCents += cents; else { maya.salesCents += cents; maya.commissionCents += pay; if (!seen.has(maya.uid)) seen.set(maya.uid, new Set()); seen.get(maya.uid).add(caseId); }
            maya.lines.push({ caseId, client, sample: true, kind, label, cents, payCents: pay, at: at.toISOString() });
          };
          for (let n = Math.ceil((s - SHIFT) / DAY); n * DAY + SHIFT < e; n++) {
            const week = Math.floor(n / 7);
            const at = new Date(n * DAY + SHIFT + 10 * 3_600_000);
            if (!inR(at)) continue;
            const who = NAMES[week % NAMES.length];
            if (n % 7 === 2) add(`sample-week-${week}`, who, 'booking', 'Advocacy Case', 210000, at);
            if (n % 7 === 5 && week % 4 !== 3) add(`sample-week-${week}`, who, 'tip', 'Tip', TIPS[week % TIPS.length], at);
            if (n % 28 === 16) add('sample-luis-ortega', 'Luis Ortega', 'extend', 'Full-Service extra month', 440000, at);
          }
          maya.lines.sort((a, b) => a.at.localeCompare(b.at));
        }
        for (const [uid, set] of seen) rows.get(uid).cases = set.size;
        const list = [...rows.values()].map((r) => ({ ...r, totalCents: r.commissionCents + r.tipsCents - r.deductionsCents })).filter((r) => (body.includeAll !== false && !r.off) || r.lines.length)
          .sort((a, b) => (b.owner - a.owner) || (a.sample - b.sample) || a.name.localeCompare(b.name));
        const id = `pr-${body.start}-${body.end}-${Date.now().toString(36)}`;
        const run = { status: 'draft', start: body.start, end: body.end, preset: body.preset || 'custom', createdAt: new Date().toISOString(), rows: list, adjustments: [], totals: totalsOf(list), notes: ['In the demo, refunds, chargebacks and chat renewals come from nowhere; the real report asks Stripe for them.'] };
        store.docs.set(`payrollRuns/${id}`, run); store.persist?.();
        return ok({ run: shown({ id, ...run }) });
      }
      const id = String(body.id || '');
      const run = store.docs.get(`payrollRuns/${id}`);
      if (!run) return fail(404, 'Not found');
      if (body.action === 'delete') {
        if (run.status !== 'draft') return fail(409, 'A paid payroll stays in its month.');
        store.docs.delete(`payrollRuns/${id}`); store.persist?.();
        return ok({ ok: true });
      }
      // Paid, and still editable once he says he is sure (2026-10-15), as the Worker does.
      const paid = run.status !== 'draft';
      if (paid && body.action === 'confirm') return fail(409, 'This payroll is already paid.');
      if (paid && body.editPaid !== true) return fail(409, 'This payroll is paid. Say you are sure you want to edit it first.');
      const recompute = (adjustments) => {
        const rows = run.rows.map((r) => { const mine = adjustments.filter((a) => a.uid === r.uid); const adj = mine.reduce((t, a) => t + a.cents, 0); return { ...r, adjustments: mine, adjustmentsCents: adj, totalCents: r.commissionCents + r.tipsCents - r.deductionsCents + adj }; });
        return { rows, totals: totalsOf(rows) };
      };
      if (body.action === 'adjust' || body.action === 'unadjust') {
        let adjustments = run.adjustments || [];
        if (body.action === 'adjust') {
          const cents = Math.round(Number(body.cents));
          if (!Number.isFinite(cents) || !cents) return fail(400, 'An amount, please. A minus sign takes it off.');
          adjustments = [...adjustments, { id: Date.now().toString(36), uid: String(body.uid), type: body.type || 'Pay adjustment', cents, note: String(body.note || '').slice(0, 200), at: new Date().toISOString() }];
        } else adjustments = adjustments.filter((a) => a.id !== body.adjId);
        const stamp = paid ? { editedAt: new Date().toISOString(), edits: [...(run.edits || []), { at: new Date().toISOString(), action: body.action }] } : {};
        const next = { ...run, adjustments, ...recompute(adjustments), ...stamp };
        store.docs.set(`payrollRuns/${id}`, next); store.persist?.();
        return ok({ run: shown({ id, ...next }) });
      }
      if (body.action === 'confirm') {
        const rows = run.rows.filter((r) => !r.sample);
        const next = { ...run, status: 'confirmed', confirmedAt: new Date().toISOString(), rows, totals: totalsOf(rows) };
        store.docs.set(`payrollRuns/${id}`, next); store.persist?.();
        return ok({ run: shown({ id, ...next }) });
      }
      return fail(400, 'Bad request');
    }
    if (path === '/api/admin/advocates') {
      if (role !== 'admin') return fail(404, 'Not found');
      const action = body.action || 'list';
      if (action === 'list') {
        const list = [...store.docs.entries()].filter(([k]) => /^advocates\/[^/]+$/.test(k)).map(([k, v]) => advView(k.split('/')[1], v))
          .sort((a, b) => (b.owner - a.owner) || (b.active - a.active) || a.name.localeCompare(b.name));
        return ok({ advocates: list, specialties: SPECIALTIES, defaultCommissionPct: 60 });
      }
      if (action === 'create') {
        const email = String(body.email || '').trim().toLowerCase();
        const name = String(body.name || '').trim();
        if (!name) return fail(400, 'Their name, please.');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, 'Enter a valid email address.');
        if (email === 'eric@thepocketadvocates.com') return fail(409, 'That is your own address.');
        if (passwordProblem(body.password)) return fail(400, passwordProblem(body.password));
        if ([...store.docs.entries()].some(([k, v]) => /^advocates\//.test(k) && v.email === email)) return fail(409, 'That address already has an advocate account.');
        // A client's address stays a client's (2026-10-16), as the Worker refuses it.
        if ([...store.docs.entries()].some(([k, v]) => /^users\/[^/]+$/.test(k) && v?.email === email && (v.role || 'client') === 'client')) return fail(409, 'That address already belongs to a client here. Use another email for their advocate account.');
        // Everything his pages set (2026-10-17), checked before anything is kept.
        const ad = cleanDemoAddons(body.addons || {});
        if (ad.error) return fail(400, ad.error);
        const pct = body.commissionPct === undefined ? 60 : Number(body.commissionPct);
        if (!Number.isInteger(pct) || pct < 0 || pct > 100) return fail(400, 'Their share is a whole percent, 0 to 100.');
        const set = demoSettings(body.settings, {});
        if (set.error) return fail(400, set.error);
        const pay = body.payout?.method ? demoPayout(body.payout.method, body.payout.fields || {}) : null;
        if (pay?.error) return fail(400, pay.error);
        const pr = body.profile || {};
        const uid = `demo-adv-${Date.now().toString(36)}`;
        store.docs.set(`advocates/${uid}`, {
          uid, name, email, active: true, owner: false, commissionPct: pct, payroll: true,
          primarySpecialty: String(pr.primarySpecialty || ''), specialties: pr.primarySpecialty ? [String(pr.primarySpecialty)] : [],
          credentials: String(pr.credentials || '').trim().slice(0, 200), bio: String(pr.bio || '').trim().slice(0, 1500), headshotPath: null,
          acceptingNew: true, tz: ZONES.includes(pr.tz) ? pr.tz : 'America/Boise', settings: set.value, addons: ad.value,
          services: body.services === undefined ? [] : (cleanDemoServices(body.services, [], true).value || []),
          ...(Number.isFinite(Number(body.bufferHours)) && body.bufferHours !== '' && body.bufferHours !== null ? { bufferHours: Math.min(12, Math.max(0, Math.round(Number(body.bufferHours) * 2) / 2)) } : {}),
          advisor: { optedIn: false, enabled: false }, createdAt: new Date().toISOString(), onboardedAt: null, demoMustChange: true,
        });
        store.docs.set(`users/${uid}`, { email, name, role: 'advocate' });
        if (pay) store.docs.set(`payouts/${uid}`, { method: pay.method, hint: pay.hint, details: pay.details, setBy: 'demo-admin' });
        store.persist?.();
        return ok({ ok: true, uid, emailed: true, payout: pay ? { method: pay.method, hint: pay.hint } : null });
      }
      const uid = String(body.uid || '');
      const a = store.docs.get(`advocates/${uid}`);
      if (!a) return fail(404, 'Not found');
      if (action === 'get') {
        const p = store.docs.get(`payouts/${uid}`);
        const s = a.settings || {};
        return ok({
          advocate: advView(uid, a), addons: demoAddons(uid), services: demoServices(a),
          settings: { rates: s.rates || {}, fullCap: s.fullCap ?? null, offers: { case: s.offers?.case !== false, full: s.offers?.full !== false, chat: s.offers?.chat === true }, hours: s.hours || null, office: { responseTime: s.office?.responseTime || null } },
          bufferHours: demoBuffer(a),
          payout: p?.method ? { method: p.method, label: PAY_METHODS[p.method] || '', hint: p.hint || '' } : null,
          methods: PAY_METHODS, zones: ZONES, specialties: SPECIALTIES,
        });
      }
      if (action === 'deactivate' || action === 'activate') {
        if (a.owner) return fail(409, 'You are the owner; your account stays on.');
        store.docs.set(`advocates/${uid}`, { ...a, active: action === 'activate' });
      } else if (action === 'reset-password') {
        if (a.owner) return fail(409, 'Your own sign-in is your PIN.');
        if (passwordProblem(body.password)) return fail(400, passwordProblem(body.password));
        store.docs.set(`advocates/${uid}`, { ...a, demoMustChange: true });
        store.docs.set(`users/${uid}`, { ...(store.docs.get(`users/${uid}`) || {}), setupPending: true });
      } else if (action === 'update') {
        const next = { ...a };
        if ('commissionPct' in body) {
          const pct = Number(body.commissionPct);
          if (!Number.isInteger(pct) || pct < 0 || pct > 100) return fail(400, 'Commission is a whole percent, 0 to 100.');
          next.commissionPct = pct;
        }
        // Their card's words, from employer mode (2026-10-15).
        if ('name' in body) { const n = String(body.name || '').trim().slice(0, 80); if (!n) return fail(400, 'Their name, please.'); next.name = n; }
        if ('credentials' in body) next.credentials = String(body.credentials || '').trim().slice(0, 200);
        if ('bio' in body) next.bio = String(body.bio || '').trim().slice(0, 1500);
        if ('addons' in body) { const ad = cleanDemoAddons(body.addons); if (ad.error) return fail(400, ad.error); next.addons = ad.value; }
        if ('services' in body && !a.owner) { const sv = cleanDemoServices(body.services, demoServices(a), true); if (sv.error) return fail(400, sv.error); next.services = sv.value; }
        if ('primarySpecialty' in body) next.primarySpecialty = String(body.primarySpecialty || '');
        if ('tz' in body && ZONES.includes(body.tz)) next.tz = body.tz;
        // The buffer (2026-10-17), his own card included.
        if (body.bufferHours !== undefined && body.bufferHours !== null && body.bufferHours !== '') {
          const b = Number(body.bufferHours);
          if (!Number.isFinite(b) || b < 0 || b > 12 || Math.round(b * 2) !== b * 2) return fail(400, 'The buffer is hours, from 0 to 12, in half hours.');
          next.bufferHours = b;
        }
        if (body.settings && Object.keys(body.settings).length) {
          if (a.owner) return fail(400, 'Your own prices and hours are in your settings.');
          const set = demoSettings(body.settings, a.settings || {});
          if (set.error) return fail(400, set.error);
          next.settings = set.value;
        }
        if (body.payout?.method) {
          if (a.owner) return fail(400, 'You are not on the payroll.');
          const pay = demoPayout(body.payout.method, body.payout.fields || {});
          if (pay.error) return fail(400, pay.error);
          store.docs.set(`payouts/${uid}`, { method: pay.method, hint: pay.hint, details: pay.details, setBy: 'demo-admin' });
        }
        if ('advisorEnabled' in body) {
          if (body.advisorEnabled === true && !a.owner && a.advisor?.optedIn !== true) return fail(409, 'They have not opted in. It can be switched on once they do.');
          next.advisor = { ...(a.advisor || {}), enabled: body.advisorEnabled === true };
        }
        store.docs.set(`advocates/${uid}`, next);
      } else return fail(400, 'Bad request');
      store.persist?.();
      return ok({ ok: true, advocate: advView(uid, store.docs.get(`advocates/${uid}`)) });
    }
    if (path === '/api/staff/me') {
      if (!staff) return fail(404, 'Not found');
      const key = `advocates/${me}`;
      const a = store.docs.get(key) || {};
      if ((init.method || 'GET') === 'GET') {
        return ok({ advocate: advView(me, a), role, mustChange: !!a.demoMustChange, specialties: SPECIALTIES, zones: ZONES, payoutSet: !!store.docs.get(`payouts/${me}`)?.method });
      }
      if (body.action === 'profile') {
        const next = { ...a };
        for (const f of ['name', 'credentials', 'bio', 'primarySpecialty']) if (f in body) next[f] = String(body[f] || '').trim();
        if ('specialties' in body) next.specialties = [...new Set((body.specialties || []).map((x) => String(x).trim()).filter(Boolean))].slice(0, 7);
        if ('tz' in body && ZONES.includes(body.tz)) next.tz = body.tz;
        if ('advisorOptIn' in body) next.advisor = { ...(a.advisor || {}), optedIn: body.advisorOptIn === true, ...(body.advisorOptIn ? {} : { enabled: a.owner ? a.advisor?.enabled === true : false }) };
        if ('name' in body && !next.name) return fail(400, 'Your name, please.');
        store.docs.set(key, next);
        store.persist?.();
        return ok({ ok: true, advocate: advView(me, next) });
      }
      if (body.action === 'password') {
        if (role === 'admin') return fail(409, 'Your own sign-in is your PIN.');
        if (!body.current) return fail(403, 'Your current password is not right.');
        if (passwordProblem(body.next)) return fail(400, passwordProblem(body.next));
        if (body.next === body.current) return fail(400, 'Choose a password that is new.');
        store.docs.set(key, { ...a, demoMustChange: false });
        store.docs.set(`users/${me}`, { ...(store.docs.get(`users/${me}`) || {}), setupPending: !a.onboardedAt });
        store.persist?.();
        return ok({ ok: true });
      }
      if (body.action === 'onboarded') {
        const missing = [...advView(me, a).missing, ...(role === 'advocate' && !store.docs.get(`payouts/${me}`)?.method ? ['how you get paid'] : [])];
        if (missing.length) return fail(409, `Still needed: ${missing.join(', ')}.`);
        if (a.demoMustChange) return fail(409, 'Choose your own password first.');
        store.docs.set(key, { ...a, onboardedAt: a.onboardedAt || new Date().toISOString() });
        store.docs.set(`users/${me}`, { ...(store.docs.get(`users/${me}`) || {}), setupPending: false });
        store.persist?.();
        return ok({ ok: true });
      }
      return fail(400, 'Bad request');
    }
    if (path === '/api/staff/headshot') {
      if (!staff) return fail(404, 'Not found');
      const type = String(init.headers?.['content-type'] || init.headers?.get?.('content-type') || '').split(';')[0];
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return fail(415, 'A JPEG, PNG or WebP photo, please.');
      const blob = init.body instanceof Blob ? init.body : new Blob([init.body || ''], { type });
      if (blob.size > 3 * 1024 * 1024) return fail(413, 'That photo is over 3 MB.');
      const key = `advocates/${me}`;
      const url = URL.createObjectURL(blob);
      (window.__paDemoHeadshots ||= {})[me] = url;
      store.docs.set(key, { ...(store.docs.get(key) || {}), headshotPath: `advocates/${me}/headshot` });
      store.persist?.();
      return ok({ ok: true });
    }
    // His upload of a contractor's photo from employer mode (2026-10-15).
    if (path === '/api/admin/advocates/headshot') {
      if (role !== 'admin') return fail(404, 'Not found');
      const uid = q.get('uid') || '';
      const key = `advocates/${uid}`;
      if (!store.docs.get(key)) return fail(404, 'Not found');
      const type = String(init.headers?.['content-type'] || init.headers?.get?.('content-type') || '').split(';')[0];
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(type)) return fail(415, 'A JPEG, PNG or WebP photo, please.');
      const blob = init.body instanceof Blob ? init.body : new Blob([init.body || ''], { type });
      if (blob.size > 3 * 1024 * 1024) return fail(413, 'That photo is over 3 MB.');
      (window.__paDemoHeadshots ||= {})[uid] = URL.createObjectURL(blob);
      const v = String(Date.now());
      store.docs.set(key, { ...store.docs.get(key), headshotPath: `advocates/${uid}/headshot-${v}`, photoV: v });
      store.persist?.();
      return ok({ ok: true, photoV: v });
    }
    if (path === '/api/advocates/name') {
      const d = demoContractor(q.get('uid') || '');
      return ok({ name: d ? String(d.name || '').trim() || null : null });
    }
    if (path === '/api/advocates/headshot') {
      const uid = q.get('uid') || '';
      const url = window.__paDemoHeadshots?.[uid];
      if (url) return real(url);
      // A plain stand-in when the page was reloaded since the photo was picked.
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#1B1B21"/><circle cx="48" cy="38" r="18" fill="#3DDCF5"/><rect x="20" y="62" width="56" height="26" rx="13" fill="#3DDCF5"/></svg>';
      return new Response(svg, { headers: { 'content-type': 'image/svg+xml' } });
    }
    if (path === '/api/notes') {
      if (!staff) return fail(404, 'Not found');
      const caseId = String(body.caseId || q.get('caseId') || '');
      const c = store.docs.get(`cases/${caseId}`);
      if (!c || (role === 'advocate' && c.advocateId !== me)) return fail(404, 'Not found');
      const key = `cases/${caseId}/private/notes/doc`;
      if ((init.method || 'GET') === 'GET') return ok({ html: store.docs.get(key)?.html || '' });
      store.docs.set(key, { html: String(body.html || ''), updatedAt: new Date().toISOString() });
      store.persist?.();
      return ok({ ok: true, savedAt: new Date().toISOString() });
    }

    // ---- everything else --------------------------------------------------
    if (path === '/api/version') return ok({ tag: 'demo', version: '2.27' });
    if (path === '/api/changelog') {
      return role === 'admin'
        ? ok({ admin: { '2.2': ['Everything on your side, in one place, with nothing real behind it.'] } })
        : fail(403, 'Admin only');
    }
    if (path === '/api/reviews') return ok({ reviews: [] });
    // DEMO MODE (Eric, 2026-10-16: "the chat sends basic questions back when
    // asked"): in his practice copy, a message he sends to a client is
    // answered a moment later with the kind of question a client asks next.
    if (path === '/api/notify' && LIVE && role === 'admin') {
      const col = body?.kind === 'sub' ? 'subscriptions' : body?.kind === 'case' ? 'cases' : '';
      const id = String(body?.id || '');
      const parent = col && /^[\w-]{1,64}$/.test(id) ? store.docs.get(`${col}/${id}`) : null;
      const client = parent && !parent.self && parent.status !== 'closed' ? (col === 'cases' ? parent.clientUid : id) : '';
      if (client) {
        const asked = [...store.docs.entries()].filter(([k, m]) => k.startsWith(`${col}/${id}/chat/`) && m?.demoAsked).length;
        // Priority Chat has no calls (2026-10-17), so its people ask a chat's questions.
        const list = col === 'subscriptions' ? LIVE_CHAT_QUESTIONS : LIVE_QUESTIONS;
        const text = list[asked % list.length];
        setTimeout(() => {
          const at = new Date();
          const k = `${col}/${id}/chat/q${at.getTime().toString(36)}`;
          store.docs.set(k, { from: client, role: 'client', text, ts: at, demoAsked: true });
          store.docs.set(`${col}/${id}`, { ...store.docs.get(`${col}/${id}`), lastMessage: { text, from: client, role: 'client', ts: at, emailed: false } });
          store.fire?.(k);
          store.fire?.(`${col}/${id}`);
        }, 2500);
      }
      return ok({ ok: true });
    }
    if (path === '/api/push/test') return ok({ ok: true, devices: 1 });
    if (path === '/api/uploaded' || path === '/api/notify') return ok({ ok: true });
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
    // HIS THREE ACTS ON SOMEONE ELSE'S CASE (2026-10-16), mirrored from
    // worker/oversee.js: remove a message, remove a file, send the crisis
    // message from him. His alone; his own case refused; "Removed by Eric".
    if (path === '/api/admin/oversee') {
      if (role !== 'admin') return fail(404, 'Not found');
      const cid = String(body.caseId || '');
      const c = /^[\w-]{1,64}$/.test(cid) ? store.docs.get(`cases/${cid}`) : null;
      if (!c) return fail(404, 'Not found');
      if (c.self) return fail(400, 'This is your own case.');
      const removed = { by: 'Eric', at: new Date() };
      const strip = (p) => {
        store.docs.set(p, { ...store.docs.get(p), text: '', attachment: null, quote: null, removed });
        store.fire?.(p);
      };
      if (body.action === 'remove-message') {
        const msgId = String(body.msgId || '');
        const p = `cases/${cid}/chat/${msgId}`;
        const m = /^[\w-]{1,64}$/.test(msgId) ? store.docs.get(p) : null;
        if (!m) return fail(404, 'Not found');
        if (m.removed) return ok({ ok: true, already: true });
        const fp = m.attachment?.path || '';
        if (fp.startsWith(`cases/${cid}/chat-files/`)) { store.files.delete(fp); store.fire?.(fp); }
        strip(p);
        return ok({ ok: true });
      }
      if (body.action === 'remove-file') {
        const fp = String(body.path || '');
        const mm = fp.match(/^cases\/([\w-]{1,64})\/([\w-]+)\/[^/]{1,300}$/);
        if (!mm || mm[1] !== cid || !['uploads', 'report', 'recording', 'chat-files'].includes(mm[2]) || fp.includes('..')) return fail(400, 'Bad request');
        store.files.delete(fp);
        store.fire?.(fp);
        if (mm[2] === 'chat-files') {
          for (const [p, m] of [...store.docs.entries()]) {
            if (p.startsWith(`cases/${cid}/chat/`) && !m?.removed && m?.attachment?.path === fp) strip(p);
          }
        }
        store.docs.set(`cases/${cid}`, { ...c, removedFiles: [...(c.removedFiles || []), { kind: mm[2], by: 'Eric', at: new Date() }].slice(-50) });
        store.fire?.(`cases/${cid}`);
        return ok({ ok: true });
      }
      if (body.action === 'crisis') {
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text || text.length > 4000) return fail(400, 'The message is empty or too long.');
        if (c.status === 'closed') return fail(409, 'This case is closed, so its chat is too.');
        const id = `eric-${Date.now().toString(36)}`;
        const now = new Date();
        store.docs.set(`cases/${cid}/chat/${id}`, { from: me, role: 'admin', text, ts: now, byName: 'Eric' });
        store.fire?.(`cases/${cid}/chat/${id}`);
        store.docs.set(`cases/${cid}`, { ...c, lastMessage: { text: text.slice(0, 120), from: me, role: 'admin', ts: now, emailed: false } });
        store.fire?.(`cases/${cid}`);
        return ok({ ok: true, id });
      }
      return fail(400, 'Bad request');
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
        const myUid = me;
        const reaction = body.reaction ?? null;
        const emo = EMOJI_REACTIONS.find((r) => r.id === reaction);
        const stat = STATUS_REACTIONS.find((r) => r.id === reaction);
        if (reaction !== null && !emo && !stat) return fail(400, 'Unknown reaction');
        if (stat && !staff) return fail(403, 'That reaction is not available.');
        // Live demo messages carry `from`; seeded fixtures always do too,
        // but the role fallback keeps any stray legacy doc behaving.
        // handleChatReact's rules, mirrored line for line. Where this file
        // has ever been KINDER than the Worker it has hidden a real refusal:
        // an invented admin carve-out here is what let drive-status.mjs run
        // green while Eric's own dropdown was refusing him live.
        const mine = msg.from ? msg.from === myUid
          : (msg.role || 'client') === (staff ? 'admin' : 'client');
        const adminStatus = staff && (stat || reaction === null);
        if (mine && !adminStatus)
          return fail(403, "You can only react to the other person's messages.");
        if (msg.reaction?.kind === 'status' && !staff)
          return fail(403, 'That message is showing a status note.');
        const rec = emo
          ? { id: reaction, emoji: emo.emoji, kind: 'emoji', by: myUid, at: new Date() }
          : stat
            // An advocate's status carries their first name, as the Worker's statusLabelFor does.
            ? { id: reaction, label: role === 'advocate' ? stat.label.replace(/^Eric\b/, String(store.docs.get(`users/${myUid}`)?.name || '').split(' ')[0] || 'Your advocate') : stat.label, kind: 'status', by: myUid, at: new Date() }
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
