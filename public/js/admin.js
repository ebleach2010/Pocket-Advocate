// Admin case list: every case, status badges, and the "report due in N days"
// countdown that keeps the 7-day SLA from silently slipping (SPEC §F).

import './admin-ledger.js';
import { db, collection, getDocs } from './firebase.js';
import { requireAdmin, hydrateNav } from './auth.js';
import { initPushPrompt } from './push.js';
import {
  folderCardHtml, wireFolderOpen, wireFolderClocks, wireDxLongPress, openDxSheet,
} from './drawer.js';
import { unseenBadges } from './seen.js';
import { mountOfficeControl } from './admin-hours.js';
import { mountFitCalls } from './admin-fit.js';
import { mountPersonal } from './admin-personal.js';

const MOUNTAIN_TZ = 'Etc/GMT+7';

hydrateNav();
const user = await requireAdmin();
if (user) {
  // In or out, at the top of the page he actually opens. The same control is
  // on the availability page; both read and write settings/officeHours through
  // the Worker, so they cannot disagree.
  mountOfficeControl(document.getElementById('office'), { getToken: () => user.getIdToken() });
  // The free calls, off the Worker-only leads collection.
  mountFitCalls(document.getElementById('fit-calls'), { getToken: () => user.getIdToken() });
  // Personal Uploads, across every case (Eric, 2026-09-03).
  mountPersonal(document.getElementById('personal'), { getToken: () => user.getIdToken(), scope: 'all' });
  load();
}

/**
 * The covers, in one call. caseMeta is Worker-only by rule: a case doc is
 * client-readable and a working diagnosis is Eric's private material, never
 * something a patient should find on their own record.
 */
async function loadCovers() {
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/advisor/covers', { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return {};
    return (await res.json()).covers || {};
  } catch { return {}; }   // a shelf with no covers is still a usable shelf
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
  initPushPrompt(user, document.querySelector('main')).catch(() => {});
  let cases = [];
  try {
    const snapshot = await getDocs(collection(db, 'cases'));
    snapshot.forEach((d) => cases.push({ id: d.id, ...d.data() }));
  } catch (err) {
    listEl.innerHTML = `<p class="error">Couldn't load cases: ${err.message}</p>`;
    return;
  }
  if (!cases.length) {
    listEl.innerHTML = '<p class="dim">No clients yet. They appear here the moment a payment lands.</p>';
    return;
  }

  const mtFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, month: 'short', day: 'numeric', year: 'numeric',
  });
  const now = Date.now();

  // Three shelves (Eric, 2026-07-15): current clients (call happened, report
  // phase) on top, future booked calls next, former (closed) at the bottom.
  const former = cases.filter((c) => c.status === 'closed');
  const future = cases.filter((c) =>
    c.status !== 'closed' && c.appointment?.start && toDate(c.appointment.start).getTime() > now);
  const current = cases.filter((c) => !former.includes(c) && !future.includes(c));
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
  const covers = await loadCovers();
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
  const handRecorded = (c) => Math.max(0,
    (Number(c.paidOverrideCents) || 0) - (Number(c.stripe?.amountTotal) || 0));
  const byKind = (want) => cases.reduce((sum, c) => sum
    + (want === 'stripe' ? (c.stripe?.amountTotal || 0) : handRecorded(c))
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
  // What a case costs right now. It rises by $10 on every completed booking,
  // silently, so this is the only place the current number is stated.
  let rate = null;
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/admin/rates', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    if (res.ok) rate = await res.json();
  } catch { /* the shelf is still a shelf without it */ }

  // The nightly voice study. It runs on its own; this is the switch and the
  // proof it is still running.
  let voice = null;
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/admin/voice', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    if (res.ok) voice = await res.json();
  } catch { /* same */ }

  // Grouped, the same as the case page's. Without the separator the shelf's
  // headline rate read "$1200" and "$3400", which is the one number on this
  // screen he reads at a glance and the one where a missing digit costs the
  // most. Display only: the rate inputs below take their value straight from
  // the cents, so the comma never reaches a parser.
  const dollars = (c) => (c / 100).toLocaleString('en-US', {
    minimumFractionDigits: c % 100 ? 2 : 0,
    maximumFractionDigits: c % 100 ? 2 : 0,
  });
  const rateBlock = rate ? `
    <details class="panel" style="margin-bottom:1rem;">
      <summary class="row" style="cursor:pointer;">
        <strong>Today's rate</strong>
        <span class="price" style="color:var(--magenta);">$${dollars(rate.caseCents)}</span>
      </summary>
      <p class="dim small" style="margin:.5rem 0 .6rem;">Follow-up
        <strong style="color:var(--ink)">$${dollars(rate.addonCents)}</strong>,
        Priority Chat <strong style="color:var(--ink)">$${dollars(rate.subCents || 5000)}/mo</strong>,
        Full-Service <strong style="color:var(--ink)">$${dollars(rate.fullCents || 440000)}/mo</strong>
        with ${rate.fullHours || 20} included hours, Telehealth <strong style="color:var(--ink)">$${dollars(rate.teleCents || 52500)}</strong> flat.
        Case and follow-up grow 10% per booking (to $${dollars(rate.caps?.caseCents || 180000)} and $${dollars(rate.caps?.addonCents || 42500)} caps); chat
        climbs $5 per new client of any type (to $${dollars(rate.caps?.subCents || 10000)}); Full-Service grows 5% to
        the nearest $25 (to $${dollars(rate.caps?.fullCents || 440000)}). ${rate.bookings} booking${rate.bookings === 1 ? ' has' : 's have'}
        counted so far. Everyone already booked keeps what they were quoted.</p>
      <div class="row" style="gap:.5rem; flex-wrap:wrap;">
        <label class="dim small">Case $
          <input type="number" id="rate-case" min="50" step="1" value="${(rate.caseCents / 100)}"
            style="width:6rem;"></label>
        <label class="dim small">Follow-up $
          <input type="number" id="rate-addon" min="50" step="1" value="${(rate.addonCents / 100)}"
            style="width:6rem;"></label>
        <label class="dim small">Chat $/mo
          <input type="number" id="rate-sub" min="10" max="100" step="1" value="${((rate.subCents || 5000) / 100)}"
            style="width:5rem;"></label>
        <label class="dim small">Full-Service $/mo
          <input type="number" id="rate-full" min="50" step="25" value="${((rate.fullCents || 440000) / 100)}"
            style="width:7rem;"></label>
      </div>
      <p class="dim small" style="margin:.7rem 0 .35rem;">Tell me when a case
        has dropped below this much an hour, against the clock I ran on it.</p>
      <div class="row" style="gap:.5rem; flex-wrap:wrap; align-items:center;">
        <label class="dim small">Floor $/hr
          <input type="number" id="rate-floor" min="10" max="1000" step="5" value="${((rate.floorCents || 7500) / 100)}"
            style="width:5rem;"></label>
        <button class="btn quiet" id="rate-save">Set</button>
      </div>
      <p class="dim small" id="rate-said" style="margin:.4rem 0 0;" hidden></p>
    </details>` : '';

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
        <span class="dim small">${voice.enabled ? `ran ${ago(voice.lastRunAt)}` : 'off'}</span>
      </summary>
      <p class="dim small" style="margin:.5rem 0 .6rem;">Every night at
        ${voice.hour > 12 ? voice.hour - 12 : voice.hour}pm your time, three passes read how
        you edit drafts and how you write to clients, and fold what they find into
        About&nbsp;you. ${voice.runs} run${voice.runs === 1 ? '' : 's'} so far.
        ${voice.lastError ? `<span style="color:var(--magenta);">Last one said: ${esc(voice.lastError)}</span>` : ''}</p>
      <div class="row" style="gap:.5rem; flex-wrap:wrap;">
        <button class="btn quiet" id="voice-toggle">${voice.enabled ? 'Stop it' : 'Start it again'}</button>
        <button class="btn quiet" id="voice-now">Run one now</button>
      </div>
      <p class="dim small" id="voice-said" style="margin:.4rem 0 0;" hidden></p>
    </details>` : '';

  const summary = `
    <div class="panel" style="margin-bottom:1rem;">
      <div class="row"><strong>Case revenue (paid via Stripe)</strong>
        <span class="price" style="color:var(--cyan);">$${(cents / 100).toLocaleString()}</span></div>
      <p class="dim small" style="margin:.3rem 0 0;">${cases.length} case${cases.length === 1 ? '' : 's'}, every one backed by a confirmed payment.
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
        || c.pendingTelehealth?.state === 'requested',
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
      id: c.id,
      href: `/admin-case.html?id=${c.id}`,
      // A closed case gets no clock at all: there is no more work to bill to
      // it, and a stray tap on the FORMER CLIENTS shelf used to start one.
      clock: c.status === 'closed' ? null : {
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
      dx: cover.text || '',
      dxIsMine: cover.by === 'eric',
      badge: badge(c),
      badgeClass: `${c.status === 'closed' ? 'closed' : ''} ${dueSoon(c) ? 'due' : ''}`.trim(),
      flags: `<span class="folder-note">${detail}${
        c.needsReschedule ? '<strong class="fld-alert">NEEDS RESCHEDULE</strong>' : ''
      }${checkInDue(c) ? ' <strong class="fld-alert">CHECK-IN DUE</strong>' : ''
      }${c.pendingTelehealth?.state === 'requested' ? ' <strong class="fld-alert">TELEHEALTH, CONFIRM</strong>' : ''
      }</span>${badges ? `<span class="folder-badges" title="Not looked at yet">${badges}</span>` : ''}`,
    });
  };
  const section = (title, color, rows) => rows.length
    ? `<h2 style="font-size:.78rem; letter-spacing:.16em; color:${color}; font-family:ui-monospace,monospace; margin:1.4rem 0 .6rem;">${title}</h2><div class="drawer">${rows.join('')}</div>`
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
  for (const c of [...current, ...future]) {
    const name = c.clientName || c.clientEmail || c.clientUid;
    const href = `/admin-case.html?id=${c.id}`;
    if (c.needsReschedule) loops.push({ href, name, label: 'Needs rescheduling', tone: 'hot' });
    if (checkInDue(c)) loops.push({ href, name, label: 'Check-in due', tone: 'hot' });
    if (c.pendingTelehealth?.state === 'requested')
      loops.push({ href, name, label: 'Telehealth to confirm', tone: 'hot' });
    if (c.status === 'awaiting_report' && c.reportDueAt) {
      const days = Math.ceil((toDate(c.reportDueAt) - Date.now()) / 86_400_000);
      if (days < 0) loops.push({ href, name, label: `Report overdue ${-days}d`, tone: 'hot' });
      else if (days <= 3) loops.push({ href, name, label: `Report due in ${days}d`, tone: 'warm' });
    }
  }
  const attBlock = loops.length ? `
    <section class="cmd" aria-label="Needs attention">
      <h2 class="cmd-h hot">NEEDS ATTENTION <span class="cmd-count">${loops.length}</span></h2>
      ${loops.map((a) => `
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
      <a class="cmd-row" href="/admin-case.html?id=${c.id}">
        <strong>${esc(c.clientName || c.clientEmail || c.clientUid)}</strong>
        <span class="cmd-what">${mtFmt.format(toDate(c.appointment.start))} MST &#183; ${esc(c.appointment.method || '')}</span>
        <span class="cmd-go" aria-hidden="true">&#8250;</span>
      </a>`).join('')}
    </section>` : '';

  listEl.innerHTML = attBlock + todayBlock +
    section('CURRENT CLIENTS: REPORT PHASE', 'var(--cyan)', current.map((c) => rowFor(c,
      `${c.reportDueAt ? `report due <strong style="color:var(--manila-strong)">${dateFmt.format(toDate(c.reportDueAt))}</strong>` : 'report clock not started'}
       ${followUpFlag(c)}`))) +
    section('BOOKED: UPCOMING CALLS', 'var(--green)', future.map((c) => rowFor(c,
      `<strong style="color:var(--manila-strong)">${mtFmt.format(toDate(c.appointment.start))} MST</strong> · ${esc(c.appointment.method)}
       ${followUpFlag(c)}`))) +
    section('FORMER CLIENTS: CLOSED', 'var(--dim)', former.map((c) => rowFor(c,
      `closed <strong style="color:var(--manila-strong)">${c.closedAt ? dateFmt.format(toDate(c.closedAt)) : 'no date'}</strong>`))) +
    `<div class="cmd-quiet">` + rateBlock + voiceBlock + summary + `</div>`;

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
  const toggleVoice = listEl.querySelector('#voice-toggle');
  if (toggleVoice) {
    toggleVoice.addEventListener('click', () => voicePost(toggleVoice, { enabled: !voice.enabled }, (d) => {
      voice = d;
      toggleVoice.textContent = d.enabled ? 'Stop it' : 'Start it again';
      return d.enabled ? 'Back on. Next one tonight.' : 'Stopped. Nothing runs until you start it again.';
    }));
  }
  const voiceNow = listEl.querySelector('#voice-now');
  if (voiceNow) {
    voiceNow.addEventListener('click', () => voicePost(voiceNow, { run: true }, (d) => {
      const r = d.lastRun || {};
      if (r.ran && r.wrote) return `Done. ${(r.readers || []).length} passes read, About you is updated.`;
      if (r.ran) return `Read it, but wrote nothing: ${r.reason || 'no change worth making'}.`;
      return `Nothing to do: ${r.reason || 'not enough to read yet'}.`;
    }));
  }

  const saveRate = listEl.querySelector('#rate-save');
  if (saveRate) {
    saveRate.addEventListener('click', async () => {
      const said = listEl.querySelector('#rate-said');
      saveRate.disabled = true;
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/admin/rates', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            caseCents: Math.round(Number(listEl.querySelector('#rate-case').value) * 100),
            addonCents: Math.round(Number(listEl.querySelector('#rate-addon').value) * 100),
            subCents: Math.round(Number(listEl.querySelector('#rate-sub').value) * 100),
            fullCents: Math.round(Number(listEl.querySelector('#rate-full').value) * 100),
            floorCents: Math.round(Number(listEl.querySelector('#rate-floor').value) * 100),
          }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || `Failed (${res.status})`);
        said.textContent = d.changed
          ? `Set. A case is $${dollars(d.caseCents)}, a follow-up $${dollars(d.addonCents)}, chat $${dollars(d.subCents)}/mo, full access $${dollars(d.fullCents)}. Warning below $${dollars(d.floorCents)}/hr.`
          : 'Already those numbers.';
        said.hidden = false;
      } catch (err) {
        said.textContent = err.message;
        said.hidden = false;
      }
      saveRate.disabled = false;
    });
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
  wireFolderClocks(listEl, { getToken: () => user.getIdToken() });
  wireDxLongPress(listEl, overrideDx);
}

function badge(c) {
  if (c.status === 'awaiting_report' && c.reportDueAt) {
    const days = Math.ceil((toDate(c.reportDueAt) - Date.now()) / 86_400_000);
    return days >= 0 ? `REPORT DUE ${days}d` : `OVERDUE ${-days}d`;
  }
  return (c.status || '?').replace('_', ' ').toUpperCase();
}
/** Loud follow-up state in the list: paid+countdown, booked, or expired. */
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
  if (!c?.fullAccess || c.status === 'closed' || c.hold?.pausedAt) return false;
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

function dueSoon(c) {
  if (c.status !== 'awaiting_report' || !c.reportDueAt) return false;
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
