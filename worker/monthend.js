// THE END OF A FULL-SERVICE MONTH (Eric, 2026-10-17).
//
// Asked what should happen when a month of Full-Service runs out: "Close, with
// a heads up. If they pass closing, under [Case Enhancements] there's a
// shining upgrade for an additional month request. This goes to the advocate
// he accepts or declines. All case requests get accepted or declined by the
// advocate they choose." And while sales are off: "No, keep it off".
//
// Three days before the month ends, the client is told and so is their
// advocate. When it ends the case closes on its own: the chat closes and the
// file stays theirs. It waits while an appeal is filed and undecided (closing
// would block the upload of the answer it is waiting on), and while a month
// they started paying for is still in checkout. After it closes the client can
// ask their advocate for another month. The advocate says yes, with a link to
// pay or at no charge, or no, in their own words; paying reopens the case with
// thirty days from that day.
//
// A contractor's own monthly service runs the same way (2026-10-17, v7.75:
// "Like Full-Service"), on its own clock and in its own name, and another
// month of it is offered while that service is switched on.
//
//   cron: sweepFullServiceMonths(env, h), sweepServiceMonths(env, h)
//   POST /api/extend-request          { caseId } | { caseId, action: 'withdraw' }   the client, Full-Service
//   POST /api/service-month-request   the same, for their own monthly service
//   POST /api/admin/extend-request    { caseId, decision, reason, amountCents, overrideCap }   their advocate

import { getDoc, patchDoc, queryDocs } from './firestore.js';

const ID = /^[\w-]{1,64}$/;
export const HEADS_UP_MS = 3 * 86_400_000;
export const MONTH_CLOSED_REASON = 'The month of Full-Service reached its end, so the case wrapped up on schedule.';
const DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'Etc/GMT+7', month: 'long', day: 'numeric' });
const first = (v) => String(v || '').trim().split(/\s+/)[0] || '';
const esc = (v) => String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/**
 * Every open Full-Service case, once a quarter hour: the heads-up three days
 * out (once for each end date, so a month added after it re-arms), and the
 * close once the month is over.
 *
 * `h` carries what lives in index.js: windowEnd (fullAccessWindowEnd),
 * notifyUser, sendEmail, pingCase (the case's advocate, or him), salesOpen and
 * baseUrl.
 */
export async function sweepFullServiceMonths(env, h) {
  const out = { told: 0, closed: 0 };
  let rows;
  try {
    rows = await queryDocs(env, 'cases', [['fullAccess', 'EQUAL', true]], 200);
  } catch { return out; }
  const now = Date.now();
  for (const row of rows) {
    const c = row.data || {};
    // A delivered case is an older one with a report, and closeDeliveredCases
    // ends it on the same clock. His own case, the showcase and a held case
    // never end on their own.
    if (['closed', 'delivered'].includes(c.status) || c.self || c.showcase || c.sample || c.hold?.pausedAt) continue;
    const until = h.windowEnd(c);
    if (!until) continue;
    const end = until.getTime();
    const endKey = until.toISOString();
    const name = first(c.clientName) || 'Your client';
    const link = `${h.baseUrl}/case.html?id=${row.id}`;
    if (end > now) {
      if (end - now > HEADS_UP_MS || c.monthNotice?.for === endKey) continue;
      // Stamped first: a second sweep finds it and says nothing.
      await patchDoc(env, `cases/${row.id}`, { monthNotice: { for: endKey, at: new Date() } }, { mask: ['monthNotice'] }).catch(() => {});
      const day = DAY.format(until);
      if (c.clientUid) {
        await h.notifyUser(env, c.clientUid, {
          title: 'Pocket Advocate', body: `Your month of Full-Service ends ${day}.`, link: `/case.html?id=${row.id}`,
        }).catch(() => {});
      }
      if (c.clientEmail) {
        await h.sendEmail(env, {
          to: c.clientEmail,
          subject: `Your month of Full-Service ends ${day}`,
          html: `<p>Your month of Full-Service Case Management runs through <strong>${day}</strong>.</p>
            ${h.salesOpen
    ? '<p>If you want to keep going, add another month from Case Enhancements on your case before then. If not, your case closes that day, and your file, documents and chat log stay yours.</p>'
    : '<p>Your case closes that day. Your file, documents and chat log stay yours to keep.</p>'}
            <p><a href="${link}">Open your case</a></p>`,
        }).catch(() => {});
      }
      await h.pingCase(env, c, `${name}'s Full-Service month ends ${day}.`, `/admin-case.html?id=${row.id}`).catch(() => {});
      out.told += 1;
      continue;
    }
    // Over. An appeal filed and not yet answered keeps it open; so does a
    // month they are part way through paying for.
    const st = await getDoc(env, `cases/${row.id}/advisor/state`).catch(() => null);
    const appeal = st?.data?.appealMeta;
    if (appeal?.filedAt && !appeal.decidedAt) continue;
    const p = c.pendingExtend;
    if (p?.url && new Date(p.expiresAt || 0).getTime() > now) continue;
    await patchDoc(env, `cases/${row.id}`, {
      status: 'closed', closedAt: new Date(), closedBy: 'automatic', closedReason: MONTH_CLOSED_REASON,
      // What it was, so a month asked for afterwards opens it as it stood.
      closedFromStatus: c.status || 'confirmed', monthEndedAt: new Date(),
      pendingExtend: null, extendRequest: null,
    }, { mask: ['status', 'closedAt', 'closedBy', 'closedReason', 'closedFromStatus', 'monthEndedAt', 'pendingExtend', 'extendRequest'] });
    if (c.clientUid) {
      await h.notifyUser(env, c.clientUid, {
        title: 'Pocket Advocate', body: 'Your month of Full-Service has ended. Your file stays yours.', link: `/case.html?id=${row.id}`,
      }).catch(() => {});
    }
    if (c.clientEmail) {
      await h.sendEmail(env, {
        to: c.clientEmail,
        subject: 'Your month of Full-Service has ended',
        html: `<p>Your month of Full-Service Case Management has ended, so your case is closed. Your file, documents and the whole chat log stay yours to keep.</p>
          ${h.salesOpen ? '<p>If you want another month, ask for one from Case Enhancements on your case. Your advocate says yes or no, and nothing is charged unless they say yes.</p>' : ''}
          <p><a href="${link}">Open your case</a></p>`,
      }).catch(() => {});
    }
    await h.pingCase(env, c, `${name}'s Full-Service month ended, and the case is closed.`, `/admin-case.html?id=${row.id}`).catch(() => {});
    out.closed += 1;
  }
  return out;
}

/**
 * Every open monthly service case, on the same quarter hour: the heads-up
 * three days out and the close, in the service's own name. `h`: windowEnd
 * (serviceWindowEnd with the case's paused time), notifyUser, sendEmail,
 * pingCase, offered (whether another month of it can be asked for now), and
 * baseUrl.
 */
export async function sweepServiceMonths(env, h) {
  const out = { told: 0, closed: 0 };
  let rows;
  try {
    rows = await queryDocs(env, 'cases', [['serviceMonthly', 'EQUAL', true]], 200);
  } catch { return out; }
  const now = Date.now();
  for (const row of rows) {
    const c = row.data || {};
    if (c.status === 'closed' || c.self || c.showcase || c.sample || c.hold?.pausedAt) continue;
    // Not taken on yet: the month waits on its advocate's yes, as the case does.
    if (c.charge?.state === 'held') continue;
    const until = h.windowEnd(c);
    if (!until) continue;
    const end = until.getTime();
    const endKey = until.toISOString();
    const label = String(c.service?.label || 'your service');
    const name = first(c.clientName) || 'Your client';
    const link = `${h.baseUrl}/case.html?id=${row.id}`;
    if (end > now) {
      if (end - now > HEADS_UP_MS || c.monthNotice?.for === endKey) continue;
      await patchDoc(env, `cases/${row.id}`, { monthNotice: { for: endKey, at: new Date() } }, { mask: ['monthNotice'] }).catch(() => {});
      const day = DAY.format(until);
      const more = await h.offered(c).catch(() => false);
      if (c.clientUid) {
        await h.notifyUser(env, c.clientUid, { title: 'Pocket Advocate', body: `Your month of ${label} ends ${day}.`, link: `/case.html?id=${row.id}` }).catch(() => {});
      }
      if (c.clientEmail) {
        await h.sendEmail(env, {
          to: c.clientEmail,
          subject: `Your month of ${label} ends ${day}`,
          html: `<p>Your month of <strong>${esc(label)}</strong> runs through <strong>${day}</strong>.</p>
            <p>Your case closes that day, and your file, documents and chat log stay yours.${more ? ' If you want another month, ask for one from Case Enhancements on your case once it closes. Your advocate says yes or no, and nothing is charged unless they say yes.' : ''}</p>
            <p><a href="${link}">Open your case</a></p>`,
        }).catch(() => {});
      }
      await h.pingCase(env, c, `${name}'s month of ${label} ends ${day}.`, `/admin-case.html?id=${row.id}`).catch(() => {});
      out.told += 1;
      continue;
    }
    const p = c.pendingExtend;
    if (p?.url && new Date(p.expiresAt || 0).getTime() > now) continue;
    await patchDoc(env, `cases/${row.id}`, {
      status: 'closed', closedAt: new Date(), closedBy: 'automatic', closedReason: `The month of ${label} reached its end, so the case wrapped up on schedule.`,
      closedFromStatus: c.status || 'confirmed', monthEndedAt: new Date(),
      pendingExtend: null, extendRequest: null,
    }, { mask: ['status', 'closedAt', 'closedBy', 'closedReason', 'closedFromStatus', 'monthEndedAt', 'pendingExtend', 'extendRequest'] });
    const more = await h.offered(c).catch(() => false);
    if (c.clientUid) {
      await h.notifyUser(env, c.clientUid, { title: 'Pocket Advocate', body: `Your month of ${label} has ended. Your file stays yours.`, link: `/case.html?id=${row.id}` }).catch(() => {});
    }
    if (c.clientEmail) {
      await h.sendEmail(env, {
        to: c.clientEmail,
        subject: `Your month of ${label} has ended`,
        html: `<p>Your month of <strong>${esc(label)}</strong> has ended, so your case is closed. Your file, documents and the whole chat log stay yours to keep.</p>
          ${more ? '<p>If you want another month, ask for one from Case Enhancements on your case. Your advocate says yes or no, and nothing is charged unless they say yes.</p>' : ''}
          <p><a href="${link}">Open your case</a></p>`,
      }).catch(() => {});
    }
    await h.pingCase(env, c, `${name}'s month of ${label} ended, and the case is closed.`, `/admin-case.html?id=${row.id}`).catch(() => {});
    out.closed += 1;
  }
  return out;
}

/**
 * Their month asked for again, after the case closed. `h`: requireUser, json,
 * pingCase, monthCentsFor (the case's own month price; for their own service,
 * 0 when it is no longer offered), and kind: 'service' on
 * /api/service-month-request, which takes only a monthly service case, and
 * Full-Service otherwise, so neither door opens the other's month.
 */
export async function handleExtendRequest(request, env, h) {
  const user = await h.requireUser(request, env);
  if (!user) return h.json({ error: 'Sign in required' }, 401);
  const body = await request.json().catch(() => ({}));
  const caseId = typeof body?.caseId === 'string' ? body.caseId : '';
  if (!ID.test(caseId)) return h.json({ error: 'Bad case' }, 400);
  const c = await getDoc(env, `cases/${caseId}`);
  if (!c || c.data.clientUid !== user.uid) return h.json({ error: 'Not found' }, 404);
  const svc = h.kind === 'service';
  const label = String(c.data.service?.label || 'your service');
  if (svc ? c.data.serviceMonthly !== true || c.data.status !== 'closed' || !c.data.monthEndedAt
    : !c.data.fullAccess || c.data.status !== 'closed' || !c.data.monthEndedAt)
    return h.json({ error: svc ? `Another month can be asked for once a month of ${label} has ended.` : 'Another month can be asked for once a month of Full-Service has ended.' }, 409);
  const req = c.data.extendRequest;
  if (body?.action === 'withdraw') {
    if (req?.state !== 'pending') return h.json({ error: 'There is no request to withdraw.' }, 409);
    await patchDoc(env, `cases/${caseId}`, { extendRequest: null }, { mask: ['extendRequest'] });
    return h.json({ ok: true, withdrawn: true });
  }
  if (req?.state === 'pending') return h.json({ ok: true, state: 'pending', at: req.at });
  const live = c.data.pendingExtend;
  if (req?.state === 'approved' && live?.url && new Date(live.expiresAt || 0).getTime() > Date.now())
    return h.json({ ok: true, state: 'approved', url: live.url });
  const monthCents = Math.max(0, Math.round(Number(await h.monthCentsFor(c.data).catch(() => 0)) || 0));
  // Their service switched off since: no month of it to ask for.
  if (svc && !monthCents) return h.json({ error: 'That service is not offered right now.' }, 409);
  const next = { state: 'pending', at: new Date(), monthCents, decidedAt: null, declineReason: '' };
  await patchDoc(env, `cases/${caseId}`, { extendRequest: next }, { mask: ['extendRequest'] });
  await h.pingCase(env, c.data, `${first(c.data.clientName) || 'A client'} is asking for another month of ${svc ? label : 'Full-Service'}.`, `/admin-case.html?id=${caseId}`).catch(() => {});
  return h.json({ ok: true, state: 'pending', at: next.at });
}

/**
 * Their advocate's answer. `h`: requireStaff, staffSees, json, notifyUser,
 * stripePost, lineItems, capacity, contractorOf, confirm, baseUrl.
 */
export async function handleExtendDecision(request, env, h) {
  const staff = await h.requireStaff(request, env);
  if (!staff) return h.json({ error: 'Not found' }, 404);
  const body = await request.json().catch(() => ({}));
  const caseId = typeof body?.caseId === 'string' ? body.caseId : '';
  if (!ID.test(caseId)) return h.json({ error: 'Bad case' }, 400);
  const decision = body?.decision === 'approve' ? 'approve' : body?.decision === 'decline' ? 'decline' : '';
  if (!decision) return h.json({ error: 'Bad request' }, 400);
  const c = await getDoc(env, `cases/${caseId}`);
  if (!c || !h.staffSees(staff, c.data, env)) return h.json({ error: 'Not found' }, 404);
  const req = c.data.extendRequest;
  if (req?.state !== 'pending' || c.data.status !== 'closed') return h.json({ error: 'There is no request waiting.' }, 409);
  const tell = (text) => (c.data.clientUid
    ? h.notifyUser(env, c.data.clientUid, { title: 'Pocket Advocate', body: text, link: `/case.html?id=${caseId}` }).catch(() => {})
    : null);

  if (decision === 'decline') {
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 600) : '';
    if (!reason) return h.json({ error: 'Write the reason. The client reads it word for word.' }, 400);
    await patchDoc(env, `cases/${caseId}`, {
      extendRequest: { ...req, state: 'declined', decidedAt: new Date(), declineReason: reason, decidedBy: staff.uid },
    }, { mask: ['extendRequest'] });
    await tell('Your advocate answered your request for another month. Nothing was charged.');
    return h.json({ ok: true, state: 'declined' });
  }

  // Opening it again takes one of their Full-Service places; their own service takes none.
  const cap = c.data.serviceMonthly === true ? { room: true } : await h.capacity(env, h.contractorOf(c.data, env));
  if (!cap.room && !body?.overrideCap) return h.json({ error: 'full-booked', open: cap.open, max: cap.max }, 409);
  const quoted = Number(req.monthCents) || 0;
  const asked = body?.amountCents;
  const cents = asked === undefined || asked === null ? quoted : Number(asked);
  if (!Number.isInteger(cents) || cents < 0 || cents > 2_000_000)
    return h.json({ error: 'The amount has to be a whole number of cents, zero or more, under $20,000.' }, 400);
  if (cents === 0) {
    await patchDoc(env, `cases/${caseId}`, {
      extendRequest: { ...req, state: 'approved', decidedAt: new Date(), compedAt: new Date(), decidedBy: staff.uid },
    }, { mask: ['extendRequest'] });
    await h.confirm(env, { id: `comp_month_${caseId}_${Date.now()}`, amount_total: 0, metadata: { kind: 'extend', caseId, days: '30', reopen: '1' } });
    await tell('Good news: another month is on your case, at no charge.');
    return h.json({ ok: true, state: 'started', cents: 0, comped: true });
  }
  // 23 hours, the most a Checkout Session may stay open.
  const expiresAt = new Date(Date.now() + 23 * 3600_000);
  const session = await h.stripePost(env, '/checkout/sessions', {
    mode: 'payment',
    customer_email: c.data.clientEmail || undefined,
    line_items: h.lineItems(cents, c.data),
    success_url: `${h.baseUrl}/case.html?id=${caseId}&extended=1`,
    cancel_url: `${h.baseUrl}/case.html?id=${caseId}`,
    expires_at: Math.floor(expiresAt.getTime() / 1000),
    metadata: { kind: 'extend', caseId, uid: c.data.clientUid || '', days: '30', reopen: '1' },
  });
  await patchDoc(env, `cases/${caseId}`, {
    extendRequest: { ...req, state: 'approved', decidedAt: new Date(), decidedBy: staff.uid },
    pendingExtend: { sessionId: session.id, url: session.url, cents, createdAt: new Date(), expiresAt },
  }, { mask: ['extendRequest', 'pendingExtend'] });
  await tell('Good news: your advocate said yes. Your next month is ready to start.');
  return h.json({ ok: true, state: 'approved', url: session.url, cents });
}

