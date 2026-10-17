// EMPLOYER MODE (Eric, 2026-10-15): "Next to the big 'clients' on the all
// cases page, I (and only I) need a button to enter employer mode. This is
// where I can see all current employees (including myself) with a short
// brief of how many cases they're handling and if what type, and their
// current proposed income from clients they have retained." And: "send them
// a message as admin that appears as a temporary chat box at the top of
// their screen with a white background. I can close the chat at any time and
// it removes the chat completely and deletes all messages." And: "They can
// message me through the little bottom right chat icon in their dashboard."
// And: "Create a fake contractor so I can preview what it looks like from my
// end" (asked where: "My real dashboard").
//
// Routes (every one answers an unknown or refused caller with the same 404):
//   GET  /api/admin/team              his: every advocate, their cases by type, what they stand to earn
//   POST /api/admin/team              his: sample-create, sample-remove
//   GET  /api/staff/chat[?uid=]       the thread: his with any advocate, an advocate's with him
//   POST /api/staff/chat              send, read; close (his alone: every message deleted)
//
// The thread is one Worker-only document (staffChats/{advocate uid}); no
// browser reads it directly, and closing it deletes it.

import { getDoc, patchDoc, deleteDoc, listDocs, batchCreate, batchDelete } from './firestore.js';
import { notifyUser } from './push.js';
import { caseBookingCents } from './charge.js';
import { advocateIdOf, DEFAULT_COMMISSION_PCT } from './staff.js';
import { cleanPayout, sealPayout } from './payroll.js';
import { addonsOf } from './addons.js';

const UID_RE = /^[\w-]{1,64}$/;
const CHAT_MAX = 200;
const TEXT_MAX = 1000;
export const SAMPLE_UID = 'sample-contractor';

/** What a case's client has paid, in the case's own records. Tips apart. */
export function casePaid(c) {
  let paid = Number(c?.paidOverrideCents) || caseBookingCents(c);
  let tips = 0;
  for (const p of (Array.isArray(c?.extraPayments) ? c.extraPayments : [])) {
    const cents = Number(p?.amountCents) || 0;
    if (p?.duplicate) continue;
    if (p?.kind === 'tip') tips += cents;
    else paid += cents;
  }
  return { paid, tips };
}

/** Which kind of work a case is, in his words for it. */
export function caseKind(c) {
  // The sample's invented clients read as the work they stand for.
  if (c?.showcase && !c?.sample) return 'Showcase';
  if (c?.self) return 'Own case';
  if (c?.family) return 'Family';
  // Their own service (2026-10-17), by its own name.
  if (c?.service?.label) return String(c.service.label);
  if (c?.fullAccess) return 'Full-Service';
  return 'Advocacy Case';
}

/** A subscription that still renews: the same test the client's own page uses (auth.js renewing). */
export function renewing(s, now = Date.now()) {
  if (!s || s.status === 'canceled' || s.cancelAtPeriodEnd) return false;
  return new Date(s.currentPeriodEnd || 0).getTime() > now;
}

/**
 * Everyone who works cases, him first: their open cases by kind, their active
 * Priority Chat lines, and what they stand to earn from the clients they have
 * now: their share of everything those clients paid, plus their tips, plus
 * their share of one month of each chat line.
 */
export function teamSummary({ advocates, cases, subs, subCents, adminUid }) {
  const people = new Map();
  for (const a of advocates) {
    if (!a.data) continue;
    const owner = a.data.owner === true || a.id === adminUid;
    people.set(a.id, {
      uid: a.id,
      name: a.data.name || a.data.email || 'Advocate',
      owner,
      sample: a.data.sample === true,
      active: a.data.active === true,
      onboarded: !!a.data.onboardedAt || a.data.owner === true,
      hasPhoto: !!a.data.headshotPath || a.data.owner === true,
      // What he can change for them from here (2026-10-15): their card's words, and which photo is current.
      bio: String(a.data.bio || ''),
      credentials: String(a.data.credentials || ''),
      // What they offer on top of a Full-Service month, and at what price (2026-10-17).
      addons: addonsOf(a.data, { owner }),
      photoV: String(a.data.headshotPath || '').replace(/^.*headshot-(\d+)\..*$/, '$1').slice(0, 20),
      // He keeps all of his own, the way the payroll pays him.
      commissionPct: owner ? 100 : Number.isFinite(Number(a.data.commissionPct)) ? Number(a.data.commissionPct) : DEFAULT_COMMISSION_PCT,
      open: 0, closed: 0, kinds: {}, chatLines: 0,
      paidCents: 0, tipsCents: 0, proposedCents: 0,
      clients: [],
    });
  }
  const env = { ADMIN_UID: adminUid };
  for (const r of cases) {
    const c = r.data || {};
    const p = people.get(advocateIdOf(c, env));
    if (!p) continue;
    if (c.status === 'closed') { p.closed += 1; continue; }
    const kind = caseKind(c);
    p.open += 1;
    p.kinds[kind] = (p.kinds[kind] || 0) + 1;
    p.clients.push({ id: r.id, name: c.clientName || (c.self ? 'Your own case' : 'Client'), kind, status: c.status || '' });
    // Money only where a client really paid: his own, family, the showcase are none.
    if (c.self || c.family || (c.showcase && !c.sample)) continue;
    const { paid, tips } = casePaid(c);
    p.paidCents += paid;
    p.tipsCents += tips;
    p.proposedCents += Math.round(paid * p.commissionPct / 100) + tips;
  }
  for (const s of subs) {
    if (!renewing(s.data)) continue;
    const p = people.get(advocateIdOf(s.data, env));
    if (!p) continue;
    p.chatLines += 1;
    p.kinds['Priority Chat'] = (p.kinds['Priority Chat'] || 0) + 1;
    // The line's own month (2026-10-17: a contractor's chat is at their price); older lines are his price.
    const month = Number(s.data.priceCents) > 0 ? Number(s.data.priceCents) : subCents;
    p.paidCents += month;
    p.proposedCents += Math.round(month * p.commissionPct / 100);
  }
  return [...people.values()]
    .filter((p) => p.active || p.owner)
    .sort((a, b) => (b.owner - a.owner) || (a.sample - b.sample) || a.name.localeCompare(b.name));
}

// ---- the temporary chat -------------------------------------------------------

const cleanText = (v) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').trim().slice(0, TEXT_MAX) : '');

function threadView(doc, side) {
  const d = doc?.data || {};
  const messages = Array.isArray(d.messages) ? d.messages : [];
  return {
    open: messages.length > 0,
    messages: messages.map((m) => ({ id: m.id, from: m.from === 'admin' ? 'admin' : 'advocate', text: String(m.text || ''), at: m.at })),
    unread: side === 'admin' ? Number(d.adminUnread) || 0 : Number(d.advocateUnread) || 0,
  };
}

async function staffChat(request, env, url, h) {
  // A contractor still setting up can still write to him (2026-10-16).
  const staff = await h.requireStaff(request, env, { setup: true });
  if (!staff) return h.json({ error: 'Not found' }, 404);
  const side = staff.isAdmin ? 'admin' : 'advocate';
  // His thread with an advocate is named by the advocate; an advocate's is their own.
  const body = request.method === 'POST' ? ((await request.json().catch(() => null)) || {}) : {};
  const who = side === 'admin' ? String(url.searchParams.get('uid') || body.uid || '') : staff.uid;
  if (!UID_RE.test(who) || (side === 'admin' && who === staff.uid)) return h.json({ error: 'Not found' }, 404);
  const adv = await getDoc(env, `advocates/${who}`).catch(() => null);
  if (!adv || (side === 'admin' && adv.data?.owner === true)) return h.json({ error: 'Not found' }, 404);
  const path = `staffChats/${who}`;
  const doc = await getDoc(env, path).catch(() => null);

  if (request.method === 'GET') return h.json(threadView(doc, side));
  if (request.method !== 'POST') return h.json({ error: 'Not found' }, 404);

  if (body.action === 'close') {
    if (side !== 'admin') return h.json({ error: 'Not found' }, 404);
    // Closed is gone: the document holds every message, and it is deleted.
    await deleteDoc(env, path).catch(() => {});
    return h.json({ ok: true, open: false });
  }
  if (body.action === 'read') {
    if (doc) await patchDoc(env, path, { [side === 'admin' ? 'adminUnread' : 'advocateUnread']: 0 }, { mask: [side === 'admin' ? 'adminUnread' : 'advocateUnread'] }).catch(() => {});
    return h.json({ ok: true });
  }
  if (body.action === 'send') {
    const text = cleanText(body.text);
    if (!text) return h.json({ error: 'Write something first.' }, 400);
    const d = doc?.data || {};
    const messages = (Array.isArray(d.messages) ? d.messages : []).concat({
      id: crypto.randomUUID(), from: side, text, at: new Date().toISOString(),
    }).slice(-CHAT_MAX);
    const next = {
      messages,
      adminUnread: side === 'advocate' ? (Number(d.adminUnread) || 0) + 1 : 0,
      advocateUnread: side === 'admin' ? (Number(d.advocateUnread) || 0) + 1 : 0,
      updatedAt: new Date(),
    };
    await patchDoc(env, path, next);
    const name = adv.data?.name || 'An advocate';
    if (side === 'admin') {
      await notifyUser(env, who, { title: 'Eric', body: text.slice(0, 140), link: '/admin.html' }).catch(() => {});
    } else if (env.ADMIN_UID) {
      await notifyUser(env, env.ADMIN_UID, { title: name, body: text.slice(0, 140), link: '/admin-employer.html' }).catch(() => {});
    }
    return h.json({ ok: true, ...threadView({ data: next }, side) });
  }
  return h.json({ error: 'Bad request' }, 400);
}

// ---- the sample contractor ------------------------------------------------------

/** A contractor nobody is, with three invented clients, for him to look around with. */
export function sampleRecords(now = new Date(), adminUid = 'eric') {
  const day = 86_400_000;
  const at = (d, h = 10) => { const t = new Date(now.getTime() + d * day); t.setUTCHours(h + 7, 0, 0, 0); return t; };
  const base = (id, name, extra) => ({
    path: `cases/${id}`,
    data: {
      sample: true, showcase: true, sampleOf: SAMPLE_UID, advocateId: SAMPLE_UID,
      clientName: name, clientEmail: `${id}@example.com`, clientTz: 'America/Boise',
      createdAt: at(-20), forms: {}, files: [], publicElection: { choice: 'private', history: [] },
      ...extra,
    },
  });
  const cases = [
    base('sample-dana-whitfield', 'Dana Whitfield', {
      status: 'confirmed', caseRateCents: 210000, stripe: { sessionId: 'sample', paymentIntentId: null, amountTotal: 210000 },
      charge: { state: 'captured', capturedCents: 210000, capturedAt: at(-6) },
      appointment: { start: at(4, 11), durationMin: 60, method: 'video', phone: null, joinLink: null, requested: false },
    }),
    base('sample-luis-ortega', 'Luis Ortega', {
      status: 'delivered', caseRateCents: 210000, fullAccess: true, fullAccessAt: at(-12), fullAccessMonths: 1, fullAccessRateCents: 440000,
      stripe: { sessionId: 'sample', paymentIntentId: null, amountTotal: 210000 },
      charge: { state: 'captured', capturedCents: 210000, capturedAt: at(-18) },
      extraPayments: [{ kind: 'fullaccess', amountCents: 230000, sessionId: 'sample-full', at: at(-12) }],
      appointment: { start: at(-15, 9), durationMin: 60, method: 'video', phone: null, joinLink: null, requested: false },
      reportDeliveredAt: at(-9), reportDueAt: at(-1),
    }),
    base('sample-grace-kim', 'Grace Kim', {
      status: 'awaiting_report', caseRateCents: 210000, stripe: { sessionId: 'sample', paymentIntentId: null, amountTotal: 210000 },
      charge: { state: 'captured', capturedCents: 210000, capturedAt: at(-9) },
      extraPayments: [{ kind: 'tip', amountCents: 5000, sessionId: 'sample-tip', at: at(-2) }],
      appointment: { start: at(-3, 14), durationMin: 60, method: 'phone', phone: '555-0100', joinLink: null, requested: false },
      reportDueAt: at(11),
    }),
  ];
  const chat = [
    ['sample-dana-whitfield', 'client', 'Hi Maya, I uploaded my last two MRIs. The neurologist keeps saying it is migraine.', -5, 9],
    ['sample-dana-whitfield', 'staff', 'Got them, thank you. I will go through both before our call on Thursday.', -5, 11],
    ['sample-luis-ortega', 'client', 'The insurance denied the infusion again. What do I do?', -2, 15],
    ['sample-luis-ortega', 'staff', 'I have the denial letter. I am calling them tomorrow and starting the appeal.', -2, 16],
    ['sample-grace-kim', 'client', 'Thank you for the call yesterday. I feel heard for the first time.', -2, 18],
    ['sample-grace-kim', 'staff', 'That means a lot. Your report is coming within two weeks.', -1, 9],
  ].map(([id, who, text, d, h], i) => ({
    path: `cases/${id}/chat/s${i + 1}`,
    data: { from: who === 'staff' ? SAMPLE_UID : `${id}-client`, role: who === 'staff' ? 'admin' : 'client', text, ts: at(d, h) },
  }));
  const advocate = {
    path: `advocates/${SAMPLE_UID}`,
    data: {
      uid: SAMPLE_UID, name: 'Maya Torres', email: 'maya.torres@example.com', sample: true,
      active: true, owner: false, commissionPct: DEFAULT_COMMISSION_PCT, payroll: true,
      credentials: 'RN, BSN. Board Certified Patient Advocate', bio: 'An invented contractor, here so you can see how the team looks with someone on it. Remove her any time.',
      primarySpecialty: 'Neurology', specialties: ['Neurology', 'Rare Disease'], headshotPath: null,
      acceptingNew: true, tz: 'America/Boise', advisor: { optedIn: false, enabled: false },
      createdAt: now, createdBy: adminUid, onboardedAt: now,
    },
  };
  return { advocate, cases, chat };
}

async function teamRoute(request, env, url, h) {
  const admin = await h.requireAdmin(request, env);
  if (!admin) return h.json({ error: 'Not found' }, 404);
  if (request.method === 'GET') {
    const [advocates, cases, subs, rates, chats] = await Promise.all([
      listDocs(env, 'advocates', { pageSize: 100, all: true }).catch(() => []),
      listDocs(env, 'cases', { pageSize: 300, all: true }).catch(() => []),
      listDocs(env, 'subscriptions', { pageSize: 300, all: true }).catch(() => []),
      h.readRates(env).catch(() => ({})),
      listDocs(env, 'staffChats', { pageSize: 100, all: true }).catch(() => []),
    ]);
    // HIS NAME (Eric, 2026-10-16: "Why is my name gg gg here"). His record
    // took the name on his profile the day the team began, a test entry, and
    // his profile still had it. Both are put right once; he can change it any
    // time under Your photo and bio. And the name put there was wrong
    // (2026-10-17: "my name is Eric Leach. Not Eric Bleach"), so that one is
    // put right the same way.
    const WRONG_NAME = /^\s*(gg\s+gg|eric\s+bleach)\s*$/i;
    const mine = advocates.find((a) => a.id === env.ADMIN_UID);
    if (mine?.data && WRONG_NAME.test(String(mine.data.name || ''))) {
      mine.data.name = 'Eric Leach';
      await patchDoc(env, `advocates/${env.ADMIN_UID}`, { name: 'Eric Leach' }, { mask: ['name'] }).catch(() => {});
      const prof = await getDoc(env, `users/${env.ADMIN_UID}`).catch(() => null);
      if (prof && WRONG_NAME.test(String(prof.data?.name || ''))) await patchDoc(env, `users/${env.ADMIN_UID}`, { name: 'Eric Leach' }, { mask: ['name'] }).catch(() => {});
    }
    // HER CLIENTS, PUT BACK (2026-10-16). His screenshot showed Maya with "No
    // clients right now": her three invented cases were gone while she stayed
    // (they could be deleted one by one from his shelf; now they go only with
    // her). A sample with none of her cases gets them back, written only where
    // nothing is, since batchCreate skips what exists.
    if (advocates.some((a) => a.id === SAMPLE_UID && a.data?.sample === true) && !cases.some((r) => r.data?.sample === true)) {
      const { cases: back, chat } = sampleRecords(new Date(), admin.uid);
      await batchCreate(env, [...back, ...chat]).catch(() => {});
      cases.push(...back.map((c) => ({ id: c.path.split('/').pop(), data: c.data })));
    }
    // How each wants to be paid, as a label and a masked hint: the details
    // themselves are opened only on the payroll.
    const payouts = new Map((await listDocs(env, 'payouts', { pageSize: 100, all: true }).catch(() => []))
      .map((r) => [r.id, { method: r.data?.method || '', hint: r.data?.hint || '' }]));
    const team = teamSummary({ advocates, cases, subs, subCents: Number(rates?.subCents) || 0, adminUid: env.ADMIN_UID });
    const unread = new Map(chats.map((c) => [c.id, Number(c.data?.adminUnread) || 0]));
    const open = new Set(chats.filter((c) => Array.isArray(c.data?.messages) && c.data.messages.length).map((c) => c.id));
    return h.json({
      team: team.map((p) => ({ ...p, unread: unread.get(p.uid) || 0, chatOpen: open.has(p.uid), payout: payouts.get(p.uid) || null })),
      sample: team.some((p) => p.sample),
    });
  }
  if (request.method !== 'POST') return h.json({ error: 'Not found' }, 404);
  const body = (await request.json().catch(() => null)) || {};
  if (body.action === 'sample-create') {
    const have = await getDoc(env, `advocates/${SAMPLE_UID}`).catch(() => null);
    if (have) return h.json({ ok: true, existing: true });
    const { advocate, cases, chat } = sampleRecords(new Date(), admin.uid);
    await batchCreate(env, [advocate, ...cases, ...chat]);
    // Her way to be paid, sealed like anyone's, so the payroll shows one.
    const pay = cleanPayout({ method: 'zelle', fields: { name: 'Maya Torres', handle: 'maya.torres@example.com' } });
    await patchDoc(env, `payouts/${SAMPLE_UID}`, { method: pay.method, hint: `${pay.hint} (sample)`, sealed: await sealPayout(env, pay.details), updatedAt: new Date() }).catch(() => {});
    return h.json({ ok: true });
  }
  if (body.action === 'sample-remove') {
    const paths = [`advocates/${SAMPLE_UID}`, `staffChats/${SAMPLE_UID}`, `payouts/${SAMPLE_UID}`];
    const { cases } = sampleRecords(new Date(), admin.uid);
    for (const c of cases) {
      const rows = await listDocs(env, `${c.path}/chat`, { pageSize: 100, all: true }).catch(() => []);
      for (const r of rows) paths.push(`${c.path}/chat/${r.id}`);
      paths.push(c.path);
    }
    await batchDelete(env, paths);
    return h.json({ ok: true });
  }
  return h.json({ error: 'Bad request' }, 400);
}

/** The one entry point the Worker's router calls for everything above. */
export async function handleEmployer(request, env, url, h) {
  if (url.pathname === '/api/admin/team') return teamRoute(request, env, url, h);
  if (url.pathname === '/api/staff/chat') return staffChat(request, env, url, h);
  return h.json({ error: 'Not found' }, 404);
}
