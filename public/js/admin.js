// Admin case list: every case, status badges, and the "report due in N days"
// countdown that keeps the report promise (14 days since 2026-10-15) from silently slipping (SPEC §F).

import './admin-ledger.js';
import { db, collection, getDocs, query, where } from './firebase.js';
import { requireAdmin, hydrateNav, STAFF, staffCasesQuery, staffSubsQuery } from './auth.js';
import { initPushPrompt } from './push.js';
import {
  folderCardHtml, wireFolderOpen, wireFolderClocks, wireDxLongPress, openDxSheet,
} from './drawer.js';
import { unseenBadges } from './seen.js';
import { mountOfficeControl } from './admin-hours.js';
import { mountFitCalls } from './admin-fit.js';
import { pacingFlags } from './admin-pacing.js';
import { mountWaitlist } from './admin-waitlist.js';
import { mountPersonal } from './admin-personal.js';
import { mountInvites, leadFormHtml, wireLeadForm } from './admin-invites.js';
import { ask } from './sheet.js';

const MOUNTAIN_TZ = 'Etc/GMT+7';

// The step the shelf is on, for the net in admin.html (2026-09-24): it names the one that stalls.
window.__paStage = 'signin';
/** Settles within `ms`, or answers `fallback`; a step that can give up never holds the shelf. */
const TOO_SLOW = Symbol('too slow');
const within = (ms, work, fallback = TOO_SLOW) => new Promise((resolve) => {
  const t = setTimeout(() => resolve(fallback), ms);
  Promise.resolve().then(work).then((v) => { clearTimeout(t); resolve(v); }, (err) => { clearTimeout(t); resolve(fallback === TOO_SLOW ? Promise.reject(err) : fallback); });
});
/** The shelf is on screen, or an answer is: the net stands down, and the next stall may reload again. */
const painted = () => {
  window.__paStage = 'done';
  try { sessionStorage.removeItem('pa-list-retry'); } catch { /* nothing to clear */ }
};

hydrateNav();
const user = await requireAdmin();
let invites = { refresh() {} };
let leadForm = { prepare() {} };
// An advocate's shelf (2026-10-15): their own cases, and none of his
// platform-wide panels (office hours, free calls, the waitlist, his personal
// uploads, invitations, the +). Each of those routes refuses them anyway.
//
// QUIET VIEW (Eric, 2026-10-15: "I should then be able to tap in to each
// client and see everything they see without them knowing I'm there. This is
// strictly for quality control and safety."). /admin.html?as=<uid> is that
// advocate's shelf exactly as they see it, for his eyes: read from the
// database he can already read, nothing on it can be changed, and nothing
// on it tells them or their clients he looked.
const asUid = STAFF.role === 'admin' ? (new URLSearchParams(location.search).get('as') || '').replace(/[^\w-]/g, '').slice(0, 64) : '';
// Demo mode, his practice copy (2026-10-16): every client in it is invented.
const DEMO_LIVE = (() => { try { return sessionStorage.getItem('pa-demo-live') === '1'; } catch { return false; } })();
const advocate = STAFF.role === 'advocate' || !!asUid;
const caseHref = (id) => `/admin-case.html?id=${encodeURIComponent(id)}${asUid ? `&as=${encodeURIComponent(asUid)}` : ''}`;
if (user && advocate) {
  for (const id of ['office', 'fit-calls', 'waitlist', 'personal']) document.getElementById(id)?.remove();
  // A CONTRACTOR'S + (Eric, 2026-10-15: "Remove the ability to make their
  // own case or family case for contractors. The + sign under all cases
  // should only be there to schedule a case from any lead they themselves
  // acquire."). One door in it; his showcase, own and family doors go, and
  // the Worker refuses those routes to anyone but him.
  const menu = document.getElementById('add-menu');
  for (const item of menu ? [...menu.querySelectorAll('[role="menuitem"]')] : []) {
    if (item.dataset.openDoor !== 'lead') item.remove();
  }
  // With one door left, the + is that door (2026-10-15), not a one-line menu.
  const plus = document.querySelector('[data-add-open]');
  plus?.removeAttribute('aria-haspopup');
  plus?.setAttribute('aria-label', 'Schedule a case from a lead');
  if (asUid) {
    document.querySelector('[data-add-open]')?.closest('.add-wrap')?.remove();
    document.getElementById('invites')?.remove();
    mountQuietBar(asUid);
  } else {
    invites = mountInvites(document.getElementById('invites'), { getToken: () => user.getIdToken() });
    wireAddMenu();
    wireShelfDelete(document.getElementById('list'));
  }
  load();
} else if (user) {
  // EMPLOYER MODE (Eric, 2026-10-15: "Next to the big 'clients' on the all
  // cases page, I (and only I) need a button to enter employer mode.").
  mountEmployerDoor();
  // In or out, at the top of the page he actually opens. The same control is
  // on the availability page; both read and write settings/officeHours through
  // the Worker, so they cannot disagree.
  mountOfficeControl(document.getElementById('office'), { getToken: () => user.getIdToken() });
  // The free calls, off the Worker-only leads collection.
  mountFitCalls(document.getElementById('fit-calls'), { getToken: () => user.getIdToken() });
  // The waitlist from the landing page's bubble (Eric, 2026-10-12).
  mountWaitlist(document.getElementById('waitlist'), { getToken: () => user.getIdToken() });
  // Personal Uploads, across every case (Eric, 2026-09-03).
  mountPersonal(document.getElementById('personal'), { getToken: () => user.getIdToken(), scope: 'all' });
  // The invitations still waiting on a lead (Eric, 2026-10-15).
  invites = mountInvites(document.getElementById('invites'), { getToken: () => user.getIdToken() });
  wireAddMenu();
  wireShelfDelete(document.getElementById('list'));
  load();
}

/**
 * The covers, in one call. caseMeta is Worker-only by rule: a case doc is
 * client-readable and a working diagnosis is Eric's private material, never
 * something a patient should find on their own record.
 */
async function loadCovers() {
  // An advocate's shelf carries no covers: they are his private reading.
  if (advocate) return {};
  // Ten seconds, then no covers (2026-09-24): a shelf with no covers is still a usable shelf.
  return within(10_000, async () => {
    const token = await user.getIdToken();
    const res = await fetch('/api/advisor/covers', { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return {};
    return (await res.json()).covers || {};
  }, {});
}

/** Eric's own read of a case, typed onto the front of the folder. */
async function overrideDx(id, current) {
  const next = await openDxSheet(current);
  if (next === undefined) return;      // backed out; '' means hand it back
  const text = next.slice(0, 120);
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/advisor', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'case', id, action: 'dx', text }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Failed (${res.status})`);
    load();
  } catch (err) { alert(err.message); }
}

async function load() {
  const listEl = document.getElementById('list');
  // Not in the quiet view, where nothing is his to turn on (2026-10-17).
  if (!asUid) initPushPrompt(user, document.querySelector('main')).catch(() => {});
  let cases = [];
  window.__paStage = 'cases';
  try {
    // Fifteen seconds (2026-09-24): a read that never answers says so, with Try again, instead of Loading forever.
    // Every case for him, their own for an advocate (2026-10-15).
    const snapshot = await within(15_000, () => getDocs(asUid
      ? query(collection(db, 'cases'), where('advocateId', '==', asUid))
      : staffCasesQuery(user)));
    if (snapshot === TOO_SLOW) throw new Error('the database did not answer');
    // The retired trade desk's case (PR 420, gone 2026-10-04) stays out of
    // every shelf; its document is still in the database.
    snapshot.forEach((d) => { if (!d.data().trade) cases.push({ id: d.id, ...d.data() }); });
  } catch (err) {
    listEl.innerHTML = `<p class="error">Couldn't load cases: ${err.message}.</p><button type="button" class="btn" id="list-retry">Try again</button>`;
    listEl.querySelector('#list-retry').addEventListener('click', () => location.reload());
    painted();
    return;
  }
  // PRIORITY CHAT ON THIS PAGE (2026-10-15). Its one promise is a same-day
  // reply, and nothing here said a subscriber was waiting for one. A read
  // that fails leaves the shelf as it was.
  const subs = [];
  try {
    const got = await within(8_000, () => getDocs(asUid
      ? query(collection(db, 'subscriptions'), where('advocateId', '==', asUid))
      : staffSubsQuery(user)));
    if (got !== TOO_SLOW) got.forEach((d) => subs.push({ id: d.id, ...d.data() }));
  } catch { /* the shelf stands without them */ }
  paintAddForms(cases);
  if (!cases.length) {
    listEl.innerHTML = '<p class="dim">No clients yet. They appear here the moment a payment lands.</p>';
    painted();
    return;
  }

  const mtFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, month: 'short', day: 'numeric', year: 'numeric',
  });
  const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: MOUNTAIN_TZ, weekday: 'short' });
  const now = Date.now();

  // Three shelves (Eric, 2026-07-15): current clients (call happened, report
  // phase) on top, future booked calls next, former (closed) at the bottom.
  // HIS OWN CASE (Eric, 2026-09-03) sits on its own purple shelf above the
  // three, and is in none of them: it is not a client, so it is not current,
  // not booked, not former, and not a case in the revenue line.
  const mine = cases.filter((c) => c.self && c.status !== 'closed');
  const shelved = cases.filter((c) => !c.self);
  // The money lines count only what was paid for: not his own case, and not
  // a family member's free one, which sits on the ordinary shelves but is
  // not "backed by a confirmed payment".
  const billed = shelved.filter((c) => !c.family && !(c.invite && !(Number(c.invite.priceCents) > 0)));
  const former = shelved.filter((c) => c.status === 'closed');
  // BY WHAT THEY BOUGHT (Eric, 2026-10-15: "be sure that the admin case
  // actually matches what they purchased"). Full-Service owes the first
  // consult and the work, never a report, so it has a shelf of its own
  // instead of sitting under REPORT PHASE.
  const fullOpen = shelved.filter((c) => c.fullAccess && c.status !== 'closed');
  // A contractor's own service (2026-10-17: "Opens a case, no time") owes no
  // call and no report, so it has a shelf of its own too.
  const svcOpen = shelved.filter((c) => c.service && !c.fullAccess && c.status !== 'closed');
  const future = shelved.filter((c) => !fullOpen.includes(c) && !svcOpen.includes(c) &&
    c.status !== 'closed' && c.appointment?.start && toDate(c.appointment.start).getTime() > now);
  const current = shelved.filter((c) => !former.includes(c) && !future.includes(c) && !fullOpen.includes(c) && !svcOpen.includes(c));
  current.sort((a, b) => toDate(a.reportDueAt || 0) - toDate(b.reportDueAt || 0));
  future.sort((a, b) => toDate(a.appointment?.start) - toDate(b.appointment?.start));
  former.sort((a, b) => toDate(b.closedAt || 0) - toDate(a.closedAt || 0));
  // Money at a glance: every case is created by a confirmed Stripe payment,
  // so the sum of amountTotal IS confirmed case revenue. Subscriptions renew
  // monthly inside Stripe, and the dashboard there is the source of truth.
  //
  // TWO NUMBERS NOW, because there are two kinds of money. This card says
  // "paid via Stripe" and "every one backed by a confirmed payment", and it
  // has to keep being true: a payment recorded by hand is neither, and quietly
  // folding one in would make the sentence a lie on the one number here that
  // must stay honest. So a hand-recorded payment is counted on its own line
  // and the headline stays what Stripe actually took.
  window.__paStage = 'covers';
  const covers = await loadCovers();
  window.__paStage = 'extras';
  // A PAYMENT HE RECORDED BY HAND ON THE CASE COUNTS TOO, and until now it
  // did not: the hand line read `extraPayments[].byHand` and nothing else, so
  // on a case with no such row handCents was 0 and the WHOLE block below did
  // not render. His $3,400 was recorded, was on the case, and appeared
  // nowhere on this screen.
  //
  // What goes on the hand line is the part Stripe did not take:
  // paidOverrideCents is the whole of what they paid for the case, and
  // stripe.amountTotal is the slice of it that went through Stripe. The
  // difference is the money that arrived another way, which is exactly what
  // the line says it is. Never below zero: if he records LESS than Stripe
  // charged (a refund he settled outside the app) the headline still means
  // what Stripe took, which is the one sentence on this card that has to stay
  // literally true.
  // A HELD CARD IS NOT MONEY (2026-09-06): a case that opened on a hold
  // counts what was captured, nothing while it waits, nothing if it was
  // declined or comped. stripe.amountTotal on such a case is the hold.
  const stripeTook = (c) => (c.charge && c.charge.state
    ? (c.charge.state === 'captured' ? Number(c.charge.capturedCents) || 0 : 0)
    : (Number(c.stripe?.amountTotal) || 0));
  const handRecorded = (c) => Math.max(0,
    (Number(c.paidOverrideCents) || 0) - stripeTook(c));
  const byKind = (want) => billed.reduce((sum, c) => sum
    + (want === 'stripe' ? stripeTook(c) : handRecorded(c))
    // Tips excluded, the way handleLedger already excludes them. A tip is a
    // gift, and counting it flatters the same number.
    + (Array.isArray(c.extraPayments)
      ? c.extraPayments.reduce((x, p) => {
        if (p.kind === 'tip') return x;
        const hand = p.byHand === true;
        if (want === 'stripe' ? hand : !hand) return x;
        return x + (p.amountCents || 0);
      }, 0)
      : 0), 0);
  const cents = byKind('stripe');
  const handCents = byKind('hand');
  // The rate panel that sat here moved into the settings cog on 2026-10-15
  // (Eric: "In the settings tab for admin let me adjust price for each
  // effective immediately"), so this page no longer reads the rates at all.

  // The nightly voice study. It runs on its own; this is the switch and the
  // proof it is still running.
  // His alone: an advocate's shelf asks for neither the study nor the revenue line.
  let voice = advocate ? null : await within(10_000, async () => {
    const token = await user.getIdToken();
    const res = await fetch('/api/admin/voice', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    return res.ok ? res.json() : null;
  }, null);

  const ago = (iso) => {
    if (!iso) return 'never';
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 36) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
    return `${Math.round(hrs / 24)} days ago`;
  };
  const voiceBlock = voice ? `
    <details class="panel" style="margin-bottom:1rem;">
      <summary class="row" style="cursor:pointer;">
        <strong>Voice study</strong>
        <span class="dim small">${voice.lastRunAt ? `ran ${ago(voice.lastRunAt)}` : 'not run yet'}</span>
      </summary>
      <p class="dim small" style="margin:.5rem 0 .6rem;">Only when you tap Run one now
        (2026-09-25: nothing spends on its own any more): three passes read how you edit
        drafts and how you write to clients, and fold what they find into
        About&nbsp;you. ${voice.runs} run${voice.runs === 1 ? '' : 's'} so far.
        ${voice.lastError ? `<span style="color:var(--magenta);">Last one said: ${esc(voice.lastError)}</span>` : ''}</p>
      <div class="row" style="gap:.5rem; flex-wrap:wrap;">
        <button class="btn quiet" id="voice-now">Run one now</button>
      </div>
      <p class="dim small" id="voice-said" style="margin:.4rem 0 0;" hidden></p>
      ${aboutHtml(voice.about)}
    </details>` : '';

  const summary = advocate ? '' : `
    <div class="panel" style="margin-bottom:1rem;">
      <div class="row"><strong>Case revenue (paid via Stripe)</strong>
        <span class="price" style="color:var(--cyan);">$${(cents / 100).toLocaleString()}</span></div>
      <p class="dim small" style="margin:.3rem 0 0;">${billed.length} case${billed.length === 1 ? '' : 's'}, every one backed by a confirmed payment.
        Subscriptions and refunds live in the <a href="https://dashboard.stripe.com" target="_blank" rel="noopener">Stripe dashboard</a>.</p>
      ${handCents > 0 ? `
      <div class="row" style="margin-top:.6rem;"><strong>Recorded by you, paid another way</strong>
        <span class="price" style="color:var(--ink);">$${(handCents / 100).toLocaleString()}</span></div>
      <p class="dim small" style="margin:.3rem 0 0;">Money you told the app about, so your hourly is right. Stripe never saw it, so it is not in the number above and it will not be in your Stripe records.
        <strong style="color:var(--ink)">$${((cents + handCents) / 100).toLocaleString()}</strong> in total.</p>` : ''}
    </div>`;
  // A folder on the shelf. detail and the follow-up flag are markup the
  // caller built, so they ride in as `flags`; everything else is escaped by
  // folderCardHtml.
  const rowFor = (c, detail) => {
    const cover = covers[c.id] || {};
    const badges = unseenBadges(c.id, cover.at, {
      // The overview flag is not an activity stamp, it is a state: a case that
      // needs rescheduling wants his attention whether or not anything moved.
      // A stale check-in cadence and a telehealth request waiting on his
      // confirm are the same kind of state.
      overview: c.needsReschedule || dueSoon(c) || checkInDue(c)
        || c.pendingTelehealth?.state === 'requested' || c.addonRequest?.state === 'pending',
    });
    // The clock as it stands right now, so a card can paint "running" the
    // moment the shelf does rather than after a round trip.
    const w = c.work || {};
    // The TIER'S clock, not the case-lifetime total: everything behind
    // work.tierMark is the review phase, kept apart since the case went
    // Full-Service (Eric, 2026-08-29: "Two clocks for two different tiers").
    const banked = Math.max(0, (Number(w.seconds) || 0) - (Number(w.tierMark) || 0));
    const started = w.startedAt ? toDate(w.startedAt).getTime() : 0;
    const live = banked + (started ? (Date.now() - started) / 1000 : 0);
    const h = Math.floor(live / 3600);
    const m = Math.floor((live % 3600) / 60);
    return folderCardHtml({
      noRead: advocate,
      id: c.id,
      href: caseHref(c.id),
      // A closed case gets no clock at all: there is no more work to bill to
      // it, and a stray tap on the FORMER CLIENTS shelf used to start one.
      clock: c.status === 'closed' || asUid ? null : {
        running: !!started,
        // Never wordless. This used to be '' below sixty seconds, which is
        // every case the first time he goes looking - so the control was a
        // faint 8px ring with no text on manila, and he reported, correctly,
        // that there was no toggle on the file.
        label: live >= 60 ? (h ? `${h}h ${m}m` : `${m}m`) : (started ? '0m' : 'Start'),
        // The ticker reads these off the element; without them it found 0 and
        // skipped every card, so a running clock sat frozen until a reload.
        startedAt: started,
        banked,
        // Today's banked seconds, from the last presence beat - the beacon
        // stashes its answer on window exactly so a repaint between beats
        // does not blank the day line for up to a minute. Absent before the
        // first beat answers; the pa-day-log listener fills it in seconds.
        todayBanked: Number(window.__paDayLog?.[c.id]),
      },
      name: c.clientName || c.clientEmail || c.clientUid,
      self: !!c.self,
      // CASE STATE ON THE SHELF (Eric, 2026-10-15: "Closed files should look
      // like Chris's current aesthetic. But open ones should be highlighted in
      // that ease in ease out blue/purple. Paused will be the same sort of
      // aesthetic only yellow.").
      state: c.status === 'closed' ? 'closed' : c.hold?.pausedAt ? 'paused' : 'open',
      // His own cases and the showcase can go (Eric, 2026-10-15: "let me
      // delete my own cases"); a client's case is closed, never deleted.
      // Every fake one carries Delete on its folder, the sample contractor's
      // invented clients included (Eric, 2026-10-16: "'Delete' for sample fake
      // clients should be on the folders. For real clients it should be in
      // settings").
      // In Demo mode every client is invented, so every folder deletes.
      deletable: !asUid && (DEMO_LIVE || (!c.clientUid && !!(c.self || c.showcase))),
      dx: cover.text || '',
      dxIsMine: cover.by === 'eric',
      badge: badge(c),
      badgeClass: `${c.status === 'closed' ? 'closed' : ''} ${dueSoon(c) ? 'due' : ''}`.trim(),
      flags: `<span class="folder-note">${detail}${
        c.needsReschedule ? '<strong class="fld-alert">NEEDS RESCHEDULE</strong>' : ''
      }${checkInDue(c) ? ' <strong class="fld-alert">CHECK-IN DUE</strong>' : ''
      }${pacingFlags(c).length ? ' <strong class="fld-alert">CHECK THE PACE</strong>' : ''
      }${c.pendingTelehealth?.state === 'requested' ? ' <strong class="fld-alert">TELEHEALTH, CONFIRM</strong>' : ''
      }${c.addonRequest?.state === 'pending' ? ' <strong class="fld-alert">ENHANCEMENT ASKED FOR</strong>' : ''
      }${c.family ? ` <strong class="fld-family">FAMILY · FREE${c.familyRelation ? `, ${esc(c.familyRelation)}` : ''}</strong>` : ''
      }${c.sample ? ' <strong class="fld-family">SAMPLE · NOT A REAL CLIENT</strong>' : ''
      }</span>${badges ? `<span class="folder-badges" title="Not looked at yet">${badges}</span>` : ''}`,
    });
  };
  const section = (title, color, rows) => rows.length
    ? `<h2 style="font-size:.78rem; letter-spacing:.16em; color:${color}; margin:1.4rem 0 .6rem;">${title}</h2><div class="drawer">${rows.join('')}</div>`
    : '';

  // ---- THE COMMAND CENTER ORDER (visual director pass, 2026-08-29) ------
  //
  // The dashboard used to lead with the rate control, the voice study and
  // the revenue figure: settings and statistics, none of which is a reason
  // he opened the page. It leads with the decisions now. NEEDS ATTENTION is
  // every state flag the folders already carry, gathered into one tappable
  // list; TODAY is any call on today's calendar. Both are REORGANISATIONS of
  // state this file already computed for the folder cards: nothing here is
  // fetched or invented, so the two views can never disagree.
  const loops = [];
  for (const c of [...current, ...fullOpen, ...future]) {
    const name = c.clientName || c.clientEmail || c.clientUid;
    const href = caseHref(c.id);
    if (c.needsReschedule) loops.push({ href, name, label: 'Needs rescheduling', tone: 'hot' });
    if (checkInDue(c)) loops.push({ href, name, label: 'Check-in due', tone: 'hot' });
    // The pace of a Full-Service month (2026-10-17): admin-pacing.js.
    for (const f of pacingFlags(c)) loops.push({ href, name, label: f.label, tone: 'warm' });
    if (c.pendingTelehealth?.state === 'requested')
      loops.push({ href, name, label: 'Telehealth to confirm', tone: 'hot' });
    // An enhancement asked for on top of a Full-Service month (2026-10-17).
    if (c.addonRequest?.state === 'pending')
      loops.push({ href, name, label: c.addonRequest.kind === 'appeal' ? 'Asking for an insurance appeal' : `Asking for ${c.addonRequest.label || 'an enhancement'}`, tone: 'hot' });
    // The call has happened and nothing says so (2026-10-15): the report
    // clock, or a Full-Service consult, waits on this one tap.
    const callAt = c.appointment?.start ? toDate(c.appointment.start).getTime() : 0;
    const callMissing = !c.self && !c.showcase && callAt && callAt + 3600_000 < Date.now()
      && (c.fullAccess ? !c.consultDoneAt && c.status === 'confirmed' : !c.reportDueAt && ['confirmed', 'awaiting_report'].includes(c.status));
    if (callMissing) loops.push({ href, name, label: `Call was ${dayFmt.format(new Date(callAt))}: mark it done`, tone: 'warm' });
    if (!c.fullAccess && c.status === 'awaiting_report' && c.reportDueAt) {
      const days = Math.ceil((toDate(c.reportDueAt) - Date.now()) / 86_400_000);
      if (days < 0) loops.push({ href, name, label: `Report overdue ${-days}d`, tone: 'hot' });
      else if (days <= 3) loops.push({ href, name, label: `Report due in ${days}d`, tone: 'warm' });
    }
  }
  // Another month asked for after one ended (2026-10-17): the case is closed,
  // so it sits with the former ones, and the ask comes up here.
  for (const c of former) {
    if (c.extendRequest?.state === 'pending') loops.push({ href: caseHref(c.id), name: c.clientName || c.clientEmail || c.clientUid, label: 'Asking for another month', tone: 'hot' });
  }
  for (const sub of subs) {
    if (sub.status !== 'active' || sub.lastMessage?.role !== 'client') continue;
    // From a team member's shelf it stays their view, read only (audit,
    // 2026-10-16: the plain link opened a box he could write to their client in).
    loops.push({ href: `/admin-chats.html?sub=${encodeURIComponent(sub.id)}${asUid ? `&as=${encodeURIComponent(asUid)}` : ''}`, name: sub.name || sub.email || 'A subscriber', label: 'Priority Chat: reply today', tone: 'hot' });
  }
  // One row per case, its reasons joined, in the hottest tone it has. The same
  // name twice in a list this short read as two different people.
  const byCase = new Map();
  for (const l of loops) {
    const row = byCase.get(l.href);
    if (!row) byCase.set(l.href, { ...l });
    else {
      row.label += ` · ${l.label}`;
      if (l.tone === 'hot') row.tone = 'hot';
    }
  }
  const attention = [...byCase.values()];
  const attBlock = attention.length ? `
    <section class="cmd" aria-label="Needs attention">
      <h2 class="cmd-h hot">NEEDS ATTENTION <span class="cmd-count">${attention.length}</span></h2>
      ${attention.map((a) => `
      <a class="cmd-row ${a.tone}" href="${a.href}">
        <strong>${esc(a.name)}</strong>
        <span class="cmd-what">${a.label}</span>
        <span class="cmd-go" aria-hidden="true">&#8250;</span>
      </a>`).join('')}
    </section>` : `
    <p class="cmd-clear dim small">Nothing is waiting on you right now.</p>`;
  const today = future.filter((c) => {
    const d = toDate(c.appointment.start);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
      && d.getDate() === now.getDate();
  });
  const todayBlock = today.length ? `
    <section class="cmd" aria-label="Today">
      <h2 class="cmd-h">TODAY</h2>
      ${today.map((c) => `
      <a class="cmd-row" href="${caseHref(c.id)}">
        <strong>${esc(c.clientName || c.clientEmail || c.clientUid)}</strong>
        <span class="cmd-what">${mtFmt.format(toDate(c.appointment.start))} MST &#183; ${esc(c.appointment.method || '')}</span>
        <span class="cmd-go" aria-hidden="true">&#8250;</span>
      </a>`).join('')}
    </section>` : '';

  const ownClosed = cases.filter((c) => c.self && c.status === 'closed');
  const selfBlock = ((mine.length || ownClosed.length)
    ? section('MY OWN CASE', 'var(--self)', [
      ...mine.map((c) => rowFor(c, 'nobody on the other end')),
      ...ownClosed.map((c) => rowFor(c, `closed <strong style="color:var(--manila-strong)">${c.closedAt ? dateFmt.format(toDate(c.closedAt)) : 'no date'}</strong>${c.confirmedDx?.name ? ` · confirmed ${esc(c.confirmedDx.name)}` : ''}`)),
    ])
    : '');
  listEl.innerHTML = attBlock + todayBlock + selfBlock +
    section('ADVOCACY CASES: REPORT PHASE', 'var(--cyan)', current.map((c) => rowFor(c,
      `${chargeTag(c)}${c.showcase ? '<strong style="color:var(--orange)">SHOWCASE, nobody behind it</strong> · ' : ''}${c.status === 'delivered'
        ? `delivered <strong style="color:var(--manila-strong)">${c.reportDeliveredAt ? dateFmt.format(toDate(c.reportDeliveredAt)) : 'no date'}</strong>`
        : c.reportDueAt ? `report due <strong style="color:var(--manila-strong)">${dateFmt.format(toDate(c.reportDueAt))}</strong>` : 'report clock not started'}
       ${followUpFlag(c)}`))) +
    section('FULL-SERVICE', 'var(--gold)', fullOpen.map((c) => rowFor(c,
      `${chargeTag(c)}${c.showcase ? '<strong style="color:var(--orange)">SHOWCASE, nobody behind it</strong> · ' : ''}month ${Number(c.fullAccessMonths) || 1}${fullNextLine(c, dateFmt)}`))) +
    section('OWN SERVICES', 'var(--violet)', svcOpen.map((c) => rowFor(c,
      `${chargeTag(c)}<strong style="color:var(--manila-strong)">${esc(c.service.label)}</strong> · ${c.serviceMonthly ? svcMonthLine(c, dateFmt) : `opened ${c.createdAt ? dateFmt.format(toDate(c.createdAt)) : 'no date'}`}`))) +
    section('BOOKED: UPCOMING CALLS', 'var(--green)', future.map((c) => rowFor(c,
      `${chargeTag(c)}${buyTag(c)}<strong style="color:var(--manila-strong)">${mtFmt.format(toDate(c.appointment.start))} MST</strong> · ${esc(c.appointment.method)}
       ${followUpFlag(c)}`))) +
    section('FORMER CLIENTS: CLOSED', 'var(--dim)', former.map((c) => rowFor(c,
      `${buyTag(c)}closed <strong style="color:var(--manila-strong)">${c.closedAt ? dateFmt.format(toDate(c.closedAt)) : 'no date'}</strong>`))) +
    `<div class="cmd-quiet">` + voiceBlock + summary + `</div>`;
  painted();
  const voiceSay = listEl.querySelector('#voice-said');
  const voicePost = async (btn, body, done) => {
    btn.disabled = true;
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/voice', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `Failed (${res.status})`);
      voiceSay.textContent = done(d);
    } catch (err) {
      voiceSay.textContent = err.message;
    }
    voiceSay.hidden = false;
    btn.disabled = false;
  };
  const voiceNow = listEl.querySelector('#voice-now');
  if (voiceNow) {
    voiceNow.addEventListener('click', () => voicePost(voiceNow, { run: true }, (d) => {
      const r = d.lastRun || {};
      if (r.ran && r.wrote) return `Done. ${(r.readers || []).length} passes read, About you is updated.`;
      if (r.ran) return `Read it, but wrote nothing: ${r.reason || 'no change worth making'}.`;
      return `Nothing to do: ${r.reason || 'not enough to read yet'}.`;
    }));
  }

  // Tap a folder and it opens in the hand before the case page loads; press
  // and hold the diagnosis line to write your own over the advisor's.
  wireFolderOpen(listEl);
  // The switch on each card. Flipping it out here PINS the clock, so it keeps
  // running while he moves around the app, which is the entire reason the
  // control lives on the shelf and not only inside the chart. The long-press
  // work menu that used to sit beside it is gone (Eric, 2026-08-29: "long
  // pressing the chart isn't the way to go about toggling on if I'm working
  // ... I want a toggle-able pill like a light switch"); the switch is the
  // one door on the shelf now. The diagnosis long press below is a different
  // feature and stays.
  if (asUid) return;
  wireFolderClocks(listEl, { getToken: () => user.getIdToken() });
  wireDxLongPress(listEl, overrideDx);
}

// ---- THE + ON THE CLIENTS SCREEN (Eric, 2026-10-15) -----------------------
//
// "There should be an example case I can open and shut... It will be a + at
// the top of my 'all cases' screen and then a drop down that says 'showcase',
// 'my own case' and 'schedule a case from a lead'." His three, in his order,
// and the family case after them: an earlier door of his, kept rather than
// quietly dropped. The menu is in admin.html, so it is there even before the
// first case exists; the forms it opens are painted here.

/** The forms the + opens, folded. Painted on every load: the own-case picker lists his cases. */
function paintAddForms(cases) {
  const addEl = document.getElementById('add-forms');
  if (!addEl) return;
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, month: 'short', day: 'numeric', year: 'numeric',
  });
  // THE TWO DOORS (Eric, 2026-09-03): his own case, which asks for his own
  // details first, and a family case, which asks for theirs and the email
  // they will sign in with. Each is a button that unfolds a short form.
  //
  // MORE THAN ONE OF HIS OWN, IN SEQUENCE (Eric, 2026-09-05: "A + -> open
  // new personal cases -> pull information from [select other personal
  // cases]"). Its form carries a picker of every personal case he has, open
  // or closed, each with what was confirmed on it. The ticked ones hand their
  // information over to the new case.
  const person = (p, withEmail, extra = '') => `
      <div class="open-form" data-open-form="${p}" hidden>
        <h3 class="open-form-h">${withEmail ? 'Family case' : 'My own case'}</h3>
        <label class="dim small">First name<input type="text" data-of="${p}:firstName" maxlength="60" autocomplete="off"></label>
        <label class="dim small">Last name<input type="text" data-of="${p}:lastName" maxlength="60" autocomplete="off"></label>
        ${withEmail ? `<label class="dim small">The email they will sign in with<input type="email" data-of="${p}:email" maxlength="200" autocomplete="off"></label>
        <label class="dim small">Who they are to you, if you like<input type="text" data-of="${p}:relation" maxlength="40" placeholder="e.g. my mother"></label>` : ''}
        <label class="dim small">Date of birth<input type="date" data-of="${p}:dob"></label>
        <label class="dim small">Phone<input type="tel" data-of="${p}:phone" maxlength="40" placeholder="+1 555 555 5555"></label>
        <label class="dim small">Home address<input type="text" data-of="${p}:address" maxlength="300" placeholder="Street, city, state, ZIP"></label>
        ${extra}
        <p class="row"><button type="button" class="btn self-open" data-open-go="${p}">${withEmail ? 'Open their case, free' : 'Open my case'}</button>
          <span class="dim small" data-open-said="${p}"></span></p>
      </div>`;
  const ownAll = cases.filter((c) => c.self).sort((a, b) => toDate(b.createdAt) - toDate(a.createdAt));
  const pullPicker = ownAll.length ? `
        <fieldset class="pull-from">
          <legend class="dim small">Pull information from</legend>
          ${ownAll.map((c) => `<label class="pull-row"><input type="checkbox" data-pull="${esc(c.id)}"> <span>${esc(c.clientName || 'Me')} · opened ${c.createdAt ? dateFmt.format(toDate(c.createdAt)) : 'no date'}${c.status === 'closed' ? ` · closed${c.confirmedDx?.name ? `, confirmed ${esc(c.confirmedDx.name)}` : ''}` : ' · open'}</span></label>`).join('')}
        </fieldset>` : '';
  // Whichever form he had open stays open across a repaint.
  const open = addEl.querySelector('[data-open-form]:not([hidden])')?.dataset.openForm || '';
  // A contractor's + opens one form: a case from a lead of their own.
  addEl.innerHTML = advocate ? leadFormHtml() : person('self', false, pullPicker) + person('family', true) + leadFormHtml();
  if (open) addEl.querySelector(`[data-open-form="${open}"]`).hidden = false;
  leadForm = wireLeadForm(addEl, {
    getToken: () => user.getIdToken(), onSent: () => invites.refresh(),
    leadsPath: advocate ? '/api/staff/leads' : '/api/admin/leads',
    ratesPath: advocate ? `/api/rates?advocate=${encodeURIComponent(user.uid)}` : '/api/rates',
  });
  if (open === 'lead') leadForm.prepare();
  // Open sends the form to its route and walks into the case it made.
  for (const go of addEl.querySelectorAll('[data-open-go]')) {
    go.addEventListener('click', async () => {
      const which = go.dataset.openGo;
      const said = addEl.querySelector(`[data-open-said="${which}"]`);
      const val = (n) => addEl.querySelector(`[data-of="${which}:${n}"]`)?.value.trim() || '';
      const payload = {
        firstName: val('firstName'), lastName: val('lastName'), dob: val('dob'), phone: val('phone'), address: val('address'),
      };
      if (which === 'family') {
        payload.email = val('email'); payload.relation = val('relation');
        // Set by the confirm button below, for an address that already
        // belongs to a client here (audit, 2026-09-03).
        if (go.dataset.confirm === '1') payload.confirmExisting = true;
      }
      if (which === 'self') {
        // The personal cases he ticked to pull information from (2026-09-05).
        payload.pullFrom = [...addEl.querySelectorAll('[data-open-form="self"] [data-pull]:checked')].map((i) => i.dataset.pull);
      }
      // A blank name on his own door is fine when he is pulling from a case
      // that already carries it; the route fills it from there.
      if (!payload.firstName && !(which === 'self' && payload.pullFrom?.length)) { if (said) said.textContent = 'First name, please.'; return; }
      if (which === 'family' && !payload.email) { if (said) said.textContent = 'The email they will sign in with, please.'; return; }
      go.disabled = true;
      if (said) said.textContent = 'Opening…';
      try {
        const token = await user.getIdToken();
        const res = await fetch(which === 'family' ? '/api/admin/family-case' : '/api/admin/self-case', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const out = await res.json().catch(() => ({}));
        if (res.status === 409 && out.existing && said) {
          // The address already has a case here. Say so, and offer one
          // button that sends the same form again as confirmed.
          said.textContent = `${out.error} `;
          const yes = document.createElement('button');
          yes.type = 'button';
          yes.className = 'btn quiet';
          yes.setAttribute('data-open-confirm', which);
          yes.textContent = 'Yes, it is them';
          yes.addEventListener('click', () => { go.dataset.confirm = '1'; go.click(); });
          said.appendChild(yes);
          go.disabled = false;
          return;
        }
        if (!res.ok || !out.id) throw new Error(out.error || `Failed (${res.status})`);
        location.href = `/admin-case.html?id=${encodeURIComponent(out.id)}`;
      } catch (err) {
        if (said) said.textContent = err.message;
        go.disabled = false;
      }
    });
  }
}

/** One form open at a time; choosing the open one again folds it. */
function openForm(which) {
  const addEl = document.getElementById('add-forms');
  if (!addEl) return;
  let shown = null;
  for (const f of addEl.querySelectorAll('[data-open-form]')) {
    if (f.dataset.openForm === which) { f.hidden = !f.hidden; if (!f.hidden) shown = f; } else f.hidden = true;
  }
  if (!shown) return;
  if (which === 'lead') leadForm.prepare();
  shown.scrollIntoView({ block: 'start', behavior: 'smooth' });
  shown.querySelector('input, select')?.focus({ preventScroll: true });
}

/** The + and its menu: opens on a tap, closes on a choice, a tap outside, or Escape. */
function wireAddMenu() {
  const btn = document.querySelector('[data-add-open]');
  const menu = document.getElementById('add-menu');
  const said = document.getElementById('add-said');
  if (!btn || !menu) return;
  const setOpen = (on) => {
    menu.hidden = !on;
    btn.setAttribute('aria-expanded', on ? 'true' : 'false');
  };
  btn.addEventListener('click', () => {
    // One door (a contractor's +, 2026-10-15): the + opens it straight away.
    const items = menu.querySelectorAll('[role="menuitem"]');
    if (items.length === 1) { items[0].click(); return; }
    setOpen(menu.hidden);
    if (!menu.hidden) menu.querySelector('[role="menuitem"]')?.focus();
  });
  document.addEventListener('click', (e) => { if (!menu.hidden && !e.target.closest?.('.add-wrap')) setOpen(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menu.hidden) { setOpen(false); btn.focus(); }
  });
  for (const door of menu.querySelectorAll('[data-open-door]')) {
    door.addEventListener('click', () => { setOpen(false); openForm(door.dataset.openDoor); });
  }
  // The Showcase door (Joe Bloe, 2026-09-06) went on 2026-10-16: Demo mode
  // has invented clients of its own, apart from his real ones.
}

/**
 * Delete, on the card itself (Eric, 2026-10-15: "let me delete my own cases").
 * Only his own cases and the showcase carry the control, and the Worker
 * refuses any other case whatever a page sends. It asks first, in the app's
 * own sheet; the shelf repaints without the case.
 */
function wireShelfDelete(listEl) {
  if (!listEl || listEl.__paDel) return;
  listEl.__paDel = true;
  const run = async (el) => {
    const name = el.dataset.delName || 'this case';
    const yes = await ask({
      title: `Delete ${name}?`,
      body: 'The whole case goes: the chat, the files, the reading, the log and the milestones. Nothing is kept and nothing can bring it back.',
      okLabel: 'Delete it', cancelLabel: 'Keep it', danger: true,
    });
    if (!yes) return;
    el.textContent = 'Deleting…';
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/delete-case', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ caseId: el.dataset.del }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
      load();
    } catch (err) {
      el.textContent = err.message;
    }
  };
  listEl.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-del]');
    if (!el || !listEl.contains(el)) return;
    e.preventDefault();
    run(el);
  });
  listEl.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-del]')) {
      e.preventDefault();
      run(e.target);
    }
  });
}

function badge(c) {
  if (c.self) return 'MY OWN CASE';
  // What they bought, until it closes (2026-10-15): a Full-Service case is
  // never REPORT DUE or OVERDUE, because it owes no report.
  if (c.fullAccess && c.status !== 'closed') return 'FULL-SERVICE';
  if (c.status === 'awaiting_report' && c.reportDueAt) {
    const days = Math.ceil((toDate(c.reportDueAt) - Date.now()) / 86_400_000);
    return days >= 0 ? `REPORT DUE ${days}d` : `OVERDUE ${-days}d`;
  }
  return (c.status || '?').replace('_', ' ').toUpperCase();
}
/** Loud follow-up state in the list: paid+countdown, booked, or expired. */
/** THE HOLD on the shelf (2026-09-06): a case waiting on his approve or
 *  decline says so first, with what the card is holding. */
function chargeTag(c) {
  const ch = c.charge;
  if (!ch || !['held', 'lapsed', 'invoiced'].includes(ch.state)) return '';
  const cents = ch.state === 'invoiced' ? Number(ch.invoice?.cents || ch.invoiceCents) || 0 : Number(ch.authorizedCents) || 0;
  const what = ch.state === 'held' ? `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })} held`
    : ch.state === 'lapsed' ? 'hold lapsed' : 'payment link out';
  return `<strong style="color:var(--orange)">APPROVE OR DECLINE · ${what}</strong> · `;
}

function followUpFlag(c) {
  if (c.followUp) {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: MOUNTAIN_TZ, month: 'short', day: 'numeric' });
    return `· <strong style="color:var(--manila-note)">FOLLOW-UP ${fmt.format(toDate(c.followUp.start))}</strong>`;
  }
  if (c.pendingExtra) return '· <strong style="color:var(--manila-flag)">AWAITING PAYMENT</strong>';
  if (!c.addOnFollowUp) return '';
  // Same base the Worker enforces (followUpBase): purchase date first, the
  // call as fallback. Counting from the appointment marked every follow-up
  // expired early, since one is always bought after the call.
  const bought = c.addOnFollowUpAt ? toDate(c.addOnFollowUpAt).getTime() : null;
  const base = bought || (c.appointment?.start ? toDate(c.appointment.start).getTime() : null);
  if (!base) return '· <strong style="color:var(--manila-flag)">FOLLOW-UP PAID</strong>';
  const days = Math.ceil((base + 30 * 86_400_000 - Date.now()) / 86_400_000);
  if (days <= 0) return '· <strong style="color:var(--manila-alert)">FOLLOW-UP EXPIRED</strong>';
  return `· <strong style="color:var(--manila-flag)">FOLLOW-UP PAID · ${days}d left</strong>`;
}

/**
 * The tier's every-two-weeks promise, as a shelf flag. Same rule as
 * checkInState in admin-case.js (keep the two in step): 14+ days since the
 * last call of any kind, nothing booked ahead, case open and not paused.
 */
function checkInDue(c) {
  if (!c?.fullAccess || c.self || c.status === 'closed' || c.hold?.pausedAt) return false;
  const now = Date.now();
  const all = Array.isArray(c.checkIns) ? c.checkIns : [];
  if (all.some((x) => toDate(x.start).getTime() > now)) return false;
  const past = all.map((x) => toDate(x.start).getTime()).filter((t) => t <= now);
  // THE MONTH IS THE FLOOR. The two-week cadence is a promise the TIER makes,
  // so it cannot start running before the tier does. The anchor here is the
  // advocacy call, which on a case opened by hand is usually weeks old: with a
  // month set to begin later, this lit CHECK-IN DUE the instant he pressed the
  // button and kept the case in the overview list for the whole wait, telling
  // him to book a check-in for an engagement that had not started.
  const started = c.fullAccessAt ? toDate(c.fullAccessAt).getTime() : 0;
  if (started > now) return false;
  const first = c.appointment?.start ? toDate(c.appointment.start).getTime() : 0;
  const last = Math.max(first, started, ...past, 0);
  if (!last || last > now) return false;
  return now - last >= 14 * 86_400_000;
}

/**
 * ABOUT YOU, beside the study that writes it (2026-10-16). It was a tab on
 * every case under Track, the same page each time; Track is retired and this
 * is its one home. Text only: each line is escaped, list markers dropped.
 */
function aboutHtml(a) {
  if (!a) return '';
  const lines = (t) => String(t || '').split('\n').map((x) => x.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean);
  const block = (title, body, empty) => {
    const ls = lines(body);
    return `<h4 class="about-h" style="margin:.9rem 0 .3rem;">${title}</h4>${ls.length
      ? `<ul style="margin:0; padding-left:1.1rem;">${ls.map((x) => `<li class="small">${esc(x)}</li>`).join('')}</ul>`
      : `<p class="dim small" style="margin:0;">${empty}</p>`}`;
  };
  return `
      <div class="about-you" data-about-you style="margin-top:.8rem; border-top:1px solid var(--line); padding-top:.6rem;">
        <p style="margin:0;"><strong>About you</strong> <span class="dim small">What it has learned. Nobody else sees this.</span></p>
        ${block('How you write', a.voice, 'Not enough edits yet.')}
        ${block('Where you stand', a.stances, 'No standing positions yet.')}
        ${block('Strong suits, and things to work on', a.coaching, 'Not enough to say yet.')}
        ${a.updatedAt ? `<p class="dim small" style="margin:.7rem 0 0;">Last updated ${esc(new Date(a.updatedAt).toLocaleDateString())}.</p>` : ''}
      </div>`;
}

/** What they bought, where the shelf's title does not already say it (2026-10-15). */
function buyTag(c) {
  if (c.self) return '';
  // The folder's own ink (2026-10-16): the page's grey read about 2:1 on tan.
  return `<strong style="color:var(--manila-ink);opacity:.78">${c.service?.label ? esc(String(c.service.label).toUpperCase()) : c.fullAccess ? 'FULL-SERVICE' : 'ADVOCACY CASE'}</strong> · `;
}

/** What comes next on a Full-Service case, for its shelf line (2026-10-15). */
/**
 * Where a monthly service case's month stands (2026-10-17, v7.75), mirroring
 * worker/services.js serviceWindowEnd: thirty days a month from the day it was
 * taken on, plus any paused time.
 */
function svcMonthLine(c, fmt) {
  if (c.charge?.state === 'held') return 'its month starts when you take it on';
  const from = toDate(c.charge?.decidedAt || c.charge?.capturedAt || c.serviceAt || c.createdAt);
  if (!from || Number.isNaN(from.getTime())) return `month ${Number(c.serviceMonths) || 1}`;
  const held = Math.max(0, Number(c.hold?.totalMs) || 0) + (c.hold?.pausedAt ? Math.max(0, Date.now() - toDate(c.hold.pausedAt).getTime()) : 0);
  const until = new Date(from.getTime() + (30 + (Number(c.serviceExtraDays) || 0)) * 86_400_000 + held);
  return `month ${Number(c.serviceMonths) || 1} · through <strong style="color:var(--manila-strong)">${fmt.format(until)}</strong>`;
}

function fullNextLine(c, fmt) {
  // A check-in due already wears its own CHECK-IN DUE flag on the card.
  if (checkInDue(c)) return '';
  const ahead = (Array.isArray(c.checkIns) ? c.checkIns : []).map((x) => toDate(x.start).getTime())
    .filter((t) => t > Date.now()).sort((a, b) => a - b)[0];
  if (ahead) return ` · next check-in <strong style="color:var(--manila-strong)">${fmt.format(new Date(ahead))}</strong>`;
  return c.consultDoneAt ? ' · consult done' : ' · consult not yet marked done';
}

function dueSoon(c) {
  // Full-Service owes no report (2026-10-15), so no report is ever due on it.
  if (c.self || c.fullAccess || c.status !== 'awaiting_report' || !c.reportDueAt) return false;
  return toDate(c.reportDueAt) - Date.now() < 3 * 86_400_000;
}
function toDate(v) {
  if (!v) return new Date(0);
  if (v.toDate) return v.toDate();
  return new Date(v);
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/**
 * The door to employer mode, beside the Clients heading, his alone; a red
 * count when an advocate has written to him (2026-10-15).
 */
function mountEmployerDoor() {
  const head = document.querySelector('.clients-head');
  if (!head || head.querySelector('[data-employer]')) return;
  const a = document.createElement('a');
  a.className = 'btn quiet employer-btn';
  a.href = '/admin-employer.html';
  a.dataset.employer = '';
  a.textContent = 'Employer mode';
  const group = document.createElement('div');
  group.className = 'clients-acts';
  const plus = head.querySelector('.add-wrap');
  head.insertBefore(group, plus || null);
  group.append(a);
  if (plus) group.append(plus);
  const paint = async () => {
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/team', { headers: { authorization: `Bearer ${token}` } });
      if (!res.ok) return;
      const n = ((await res.json()).team || []).reduce((t, p) => t + (Number(p.unread) || 0), 0);
      a.querySelector('.tm-badge')?.remove();
      if (n) a.insertAdjacentHTML('beforeend', ` <span class="tm-badge" aria-label="${n} new">${n}</span>`);
    } catch { /* the door still works */ }
  };
  paint();
  setInterval(() => { if (document.visibilityState === 'visible') paint(); }, 60_000);
  mountDemoDoor(head);
}

/**
 * DEMO MODE (Eric, 2026-10-16: "There should also be a button at the top
 * called 'demo mode' where you press it and 4 of these clients appear"). His
 * choice the same day: a separate practice copy, his real clients hidden
 * until he taps Exit on its strip. The tap only sets this tab's switch and
 * reloads; firebase.js opens the copy (js/demo/live.js) from there.
 */
function mountDemoDoor(head) {
  let live = false;
  try { live = sessionStorage.getItem('pa-demo-live') === '1'; } catch { /* no storage, no copy to open */ return; }
  if (live || document.querySelector('[data-demo-mode]')) return;
  const row = document.createElement('p');
  row.className = 'demo-door-row';
  row.innerHTML = '<button type="button" class="btn quiet demo-door" data-demo-mode>Demo mode</button>';
  row.querySelector('[data-demo-mode]').addEventListener('click', () => {
    try { sessionStorage.setItem('pa-demo-live', '1'); } catch { return; }
    location.reload();
  });
  head.after(row);
}

/** The strip across the top of a quiet view: whose shelf this is, that they cannot tell, and the way out. */
function mountQuietBar(uid) {
  const main = document.querySelector('main');
  const bar = document.createElement('div');
  bar.className = 'quiet-bar';
  bar.setAttribute('role', 'status');
  bar.innerHTML = '<span>Seeing what <strong data-quiet-name>this advocate</strong> sees. They cannot tell you are here, and nothing here can be changed.</span> <a class="btn quiet" href="/admin-employer.html">Exit</a>';
  main?.prepend(bar);
  document.body.classList.add('quiet');
  document.title = 'Their shelf · Pocket Advocate';
  user.getIdToken().then((token) => fetch('/api/admin/advocates', {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{"action":"list"}',
  })).then((r) => r.json()).then((out) => {
    const a = (out.advocates || []).find((x) => x.uid === uid);
    if (a) bar.querySelector('[data-quiet-name]').textContent = a.name || a.email;
  }).catch(() => {});
}
