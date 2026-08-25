// The client case dashboard (Phases 2-3): after booking, the case lives on
// one scrolling page in three stacked sections - Progress (timeline +
// appointment), Chat (live, with file sharing), and Documents (uploads from
// both ends + files saved from chat) - with a sticky jump-chip nav that
// scrolls to each section and highlights the one in view.

import {
  db, storage, collection, getDocs, query, where, doc, onSnapshot,
  ref, uploadBytesResumable, listAll, getDownloadURL, getMetadata,
} from './firebase.js';
import { requireUser, hydrateNav } from './auth.js';
import { mountChat, watchPresence } from './chat.js';
import { mountSaved } from './saved.js';
import { initSetupGuide } from './onboarding.js';
import { askName, safeName } from './rename.js';
import { HELP_BUTTON, helpButton, wireHelp, openCaseHelp } from './help.js';
import {
  recordsAuthorisation, representativeDesignation, SENSITIVE_CATEGORIES,
} from './authority.js';
import { FULL_ACCESS_TERMS, FULL_ACCESS_PLAIN } from './tier-terms.js';
import { mountFolder, folderEnter } from './folder.js';

// MST = fixed UTC-7 year-round (IANA 'Etc/GMT+7'; the sign is inverted by design).
const MOUNTAIN_TZ = 'Etc/GMT+7';
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic,.dcm,.dicom,.zip';
const MAX_BYTES = 25 * 1024 * 1024;

const STEPS = [
  ['paid', 'Paid'],
  ['forms', 'Forms acknowledged'],
  ['confirmed', 'Confirmed. Upload labs and imaging before the call'],
  ['call', 'The discussion'],
  ['awaiting_report', 'Recording lands in your file'],
  ['delivered', 'Report, within 7 days of the call'],
  ['closed', 'Closed. The file is yours forever'],
];
const STATUS_RANK = { paid: 1, forms: 1, confirmed: 2, awaiting_report: 4, delivered: 6, closed: 7 };
const STATUS_LABEL = {
  paid: 'OPEN', forms: 'FINISH FORMS', confirmed: 'CONFIRMED',
  awaiting_report: 'REPORT DUE', delivered: 'REPORT READY', closed: 'CLOSED',
};

hydrateNav();
let user = null;
let cases = [];
let currentId = null;
// Case id the current page shell (and its one chat mount) was built for.
// Refresh paths (makePrivate -> boot) must never rebuild the chat's DOM.
let renderedFor = null;
let folder = null;
// The live feed on the case doc itself, and the work clock's minute tick.
let caseUnsub = null;
let watchedFor = null;
let workTimer = null;

// A file saved from chat lands in Documents. The listener is permanent (the
// pages never unmount), so every save refreshes the list, not just the first.
document.addEventListener('pa-saved-file', () => {
  const el = folder?.el('docs');
  const c = cases.find((x) => x.id === currentId);
  if (el && c) refreshFiles(c, el);
});

user = await requireUser();
if (user) {
  boot();
  // Introductory setup guide (install + notifications) for any signed-in
  // client — not gated on having a case.
  initSetupGuide(user, document.querySelector('main'));
}

async function boot() {
  // The jar switch, read once before anything paints the footer.
  const container = document.getElementById('cases');
  try {
    const snapshot = await getDocs(query(collection(db, 'cases'), where('clientUid', '==', user.uid)));
    cases = [];
    snapshot.forEach((d) => cases.push({ id: d.id, ...d.data() }));
  } catch (err) {
    container.innerHTML = `<p class="error">Couldn't load your cases: ${err.message}</p>`;
    renderedFor = null;
    return;
  }
  if (!cases.length) {
    container.innerHTML =
      '<p class="dim">No cases yet.</p><p><a class="btn" href="/book.html">Book an Advocacy Case →</a></p>';
    renderedFor = null;
    return;
  }
  cases.sort((a, b) => toDate(b.createdAt) - toDate(a.createdAt));
  // ?id= comes from the post-checkout redirect and from emailed links — open
  // that case, not merely the newest one.
  const params = new URLSearchParams(location.search);
  const wanted = currentId || params.get('id');
  currentId = wanted && cases.some((c) => c.id === wanted) ? wanted : cases[0].id;
  // Re-boots for the same case (e.g. after makePrivate) refresh Progress and
  // Documents in place; the chat mounts once per case and stays untouched.
  if (renderedFor === currentId && folder?.el('chat')) {
    refreshSections();
  } else {
    render();
  }
  watchCase();

  // First arrival straight from checkout: open the explainer unprompted. It's
  // the one moment a client has no idea what they just bought access to.
  // Unless the first-run intro is already up — it covers the same ground, and
  // two stacked overlays is nobody's idea of a welcome.
  if (params.get('welcome') === '1') {
    history.replaceState(null, '', `/case.html?id=${currentId}`);
    if (!document.getElementById('pa-intro')) openCaseHelp();
  }
}

function render() {
  const container = document.getElementById('cases');
  const c = cases.find((x) => x.id === currentId);
  const mtFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  container.innerHTML = `
    ${cases.length > 1 ? `
      <div class="case-picker">
        ${cases.map((x) => `
          <button class="chip-label ${x.id === currentId ? 'selected' : ''}" data-case="${x.id}">
            ${x.appointment?.start ? mtFmt.format(toDate(x.appointment.start)) : 'Case'}
            ${x.status === 'closed' ? ' · closed' : ''}
          </button>`).join('')}
      </div>` : ''}
    <div class="row">
      <h2 style="margin:0;">Advocacy Case ${HELP_BUTTON}</h2>
      <span class="status-pill ${c.status === 'closed' ? 'closed' : ''}" data-status-pill>${STATUS_LABEL[c.status] || c.status}</span>
    </div>
    <div data-folder></div>
    <div data-page-footer></div>`;

  wireHelp(container);
  container.querySelectorAll('[data-case]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.dataset.case === currentId) return;
      currentId = b.dataset.case;
      render();
    }));

  // Same engine as Eric's side, and now the same manila. He looked at the
  // plain version and said the client side was still one long scroll; the card
  // stock is what makes it read as a folder with pages rather than a page with
  // headings, and it is the thing that was doing the work on his side.
  folder = mountFolder({
    container: container.querySelector('[data-folder]'),
    storageKey: `client-case-${currentId}`,
    initial: 'progress',
    pages: [
      { id: 'progress', title: 'Progress', icon: '📍', render: (pane) => renderProgress(pane, c) },
      {
        // fade, and opted out of tap-to-flip: the chat is mostly bubbles and
        // dead space you tap around in, and it is position:fixed when full
        // screen, which no transformed ancestor may touch.
        id: 'chat', title: 'Chat', icon: '💬', fade: true,
        render: (pane) => renderChat(pane, c),
        onShow: (pane) => {
          // The log fills while this page is hidden (display:none), where its
          // scrollHeight is 0 - so scrolling it then, or too early now, lands
          // on old history. Drop to the newest message once now and again a
          // frame later when layout has real heights. (Eric, 2026-08-21:
          // "have the chat scrolled down to the most recent message.")
          const drop = () => {
            const log = pane.querySelector('[data-log]');
            if (log) log.scrollTop = log.scrollHeight;
          };
          drop();
          requestAnimationFrame(() => requestAnimationFrame(drop));
        },
      },
      // 'Docs', not 'Documents': three pills have to fit across a 390px phone,
      // and a tab hanging half off the edge reads as a broken page rather than
      // as more to scroll to. The 📄 carries the rest of the word.
      { id: 'docs', title: 'Docs', icon: '📄', render: (pane) => renderDocs(pane, c) },
      // Everything purchasable, in one place with a ? beside each (Eric,
      // 2026-08-25: "an entire separate tab for add-ons"). The follow-up and
      // upgrade cards moved here from the bottom of Docs, where they were
      // easy to scroll past and crowded the file list.
      { id: 'addons', title: 'Enhance', icon: '➕', render: (pane) => renderAddons(pane, c) },
      {
        // Messages they bookmarked, each with a note of their own. Private:
        // Eric is not told what they save, and nothing is written back to the
        // message, so there is nothing for him to notice.
        id: 'saved', title: 'Saved', icon: '🔖',
        render: (pane) => {
          mountSaved({ container: pane, kind: 'case', id: c.id, user, myRole: 'client' });
        },
      },
    ],
  });
  showNavHint(container.querySelector('[data-folder]'));
  folderEnter(container.querySelector('[data-folder]'));
  renderPageFooter(container.querySelector('[data-page-footer]'), c);
  renderedFor = currentId;
}

/**
 * How to move around, said once and then never again.
 *
 * The tabs are a real interface and nobody arrives knowing that tapping the
 * paper turns the page. Dismissed permanently the same way the version card
 * is, because a hint that comes back is not a hint.
 */
const NAV_HINT_KEY = 'pa-seen-nav-hint';

function showNavHint(folderEl) {
  if (!folderEl) return;
  try { if (localStorage.getItem(NAV_HINT_KEY)) return; } catch { return; }
  const note = document.createElement('p');
  note.className = 'nav-hint';
  // Swipe first, because swipe works on every page. Tap-to-turn does not: a
  // page whose whole width is taken by the chat has no bare margin to tap, so
  // the tap lands on the chat and nothing happens, with no way to tell that
  // from the gesture being wrong.
  note.innerHTML = 'Your case has tabs. Tap one to switch pages, or swipe '
    + 'left and right to move between them. '
    + '<button type="button" class="btn ghost" data-hint-ok>Got it</button>';
  folderEl.parentElement?.insertBefore(note, folderEl);
  note.querySelector('[data-hint-ok]').addEventListener('click', () => {
    try { localStorage.setItem(NAV_HINT_KEY, '1'); } catch { /* blocked */ }
    note.remove();
  });
}

/**
 * The case doc, live, plus a minute tick for the work clock (Eric,
 * 2026-08-23: "does it update live?"). Two feeds:
 *
 *  - one onSnapshot on the case doc, so his work-clock toggle flips
 *    "working on it right now" on an OPEN client page the moment he presses
 *    it, banked time lands the moment he stops, and status changes paint
 *    without a reload;
 *  - a half-minute tick while the clock runs, so the minutes climb between
 *    writes.
 *
 * Both repaint Progress in place through the same path makePrivate already
 * uses; the chat's DOM is never touched (its own listener would orphan).
 */
function watchCase() {
  if (watchedFor === currentId) return;
  watchedFor = currentId;
  if (caseUnsub) { try { caseUnsub(); } catch { /* already gone */ } caseUnsub = null; }
  try {
    caseUnsub = onSnapshot(doc(db, 'cases', currentId), (snap) => {
      const data = snap.data ? snap.data() : null;
      if (!data) return;
      const i = cases.findIndex((x) => x.id === currentId);
      if (i < 0) return;
      cases[i] = { id: currentId, ...data };
      refreshSections();
      armWorkTick();
    });
  } catch { /* live updates are a nicety; the load-time truth stands */ }
  armWorkTick();
}

function armWorkTick() {
  clearInterval(workTimer);
  const c = cases.find((x) => x.id === currentId);
  if (!c?.work?.startedAt) return;
  workTimer = setInterval(() => {
    const cc = cases.find((x) => x.id === currentId);
    const el = folder?.el('progress');
    if (el && cc) renderProgress(el, cc);
  }, 30_000);
}

/**
 * Refresh path: update Progress and Documents in place, plus the status pill.
 * The chat section's DOM is never touched here - rebuilding it would orphan
 * its live onSnapshot listener and wipe a half-typed message.
 */
function refreshSections() {
  const container = document.getElementById('cases');
  const c = cases.find((x) => x.id === currentId);
  if (!c) return render();
  const pill = container.querySelector('[data-status-pill]');
  if (pill) {
    pill.className = `status-pill ${c.status === 'closed' ? 'closed' : ''}`;
    pill.textContent = STATUS_LABEL[c.status] || c.status;
  }
  const progress = folder?.el('progress');
  const docs = folder?.el('docs');
  // Never rebuild a pane the client is part way through using.
  //
  // These panes are refreshed from an onSnapshot on the case document, and
  // /api/work writes to that document - so every time Eric started or
  // stopped a clock, ANY client with their Docs page open had it rebuilt
  // underneath them. Somebody who had opened the Full Access scope note,
  // scrolled it to the end and ticked the box watched the accordion snap
  // shut, the tick clear and the button grey out, with their tap landing on
  // a dead control. Same for a half-written review, and for the two
  // authorisation buttons a tier client cannot start without.
  if (progress && !busyInside(progress)) renderProgress(progress, c);
  if (docs && !busyInside(docs)) renderDocs(docs, c);
  const addons = folder?.el('addons');
  if (addons && !busyInside(addons)) renderAddons(addons, c);
}

/** Is the client mid-interaction in here? Then leave it alone. */
function busyInside(pane) {
  if (pane.querySelector('details[open]')) return true;
  if (pane.querySelector('input:checked')) return true;
  const a = document.activeElement;
  return !!a && a !== document.body && pane.contains(a);
}

/**
 * "Did it actually go through?" answered before anything else on the page.
 * A paying client who lands here and sees only a status timeline has no plain
 * statement that their money arrived and their slot is theirs — one asked for
 * exactly that on day one. Closed cases don't need it.
 */
function confirmationBanner(c, start, localFmt) {
  if (c.status === 'closed' || !start) return '';
  const cents = c.stripe?.amountTotal;
  const paid = typeof cents === 'number'
    ? `, $${(cents / 100).toFixed(2).replace(/\.00$/, '')} received`
    : '';
  const requested = !!c.appointment?.requested;
  return `
    <div class="panel confirm-banner">
      <p style="margin:0;"><strong>Payment confirmed${paid}.</strong>
        ${requested
          ? 'Your case file is open. The time you asked for still needs my confirmation. See below.'
          : `You're booked for <strong>${localFmt.format(start)}</strong>.`}</p>
      <p class="dim small" style="margin:.35rem 0 0;">A copy is in your email. Nothing else is needed from you before the call, though labs and imaging help if you have them.</p>
    </div>`;
}

// ---- Progress section ----
/**
 * Hours worked on this case, shown to the CLIENT. Eric clocks the time on
 * himself and they see the total (his call, 2026-08-22: "They can see
 * this"). It is a plain statement of work done, not a bill and not a
 * countdown: nothing about it changes what the case includes.
 *
 * Nothing is shown until there is something real to show, because "0m" on a
 * case somebody just paid for reads as neglect rather than as honesty.
 */
function workLine(c) {
  const w = c.work || {};
  const banked = Math.max(0, Number(w.seconds) || 0);
  const live = w.startedAt
    ? Math.min(Math.floor((Date.now() - toDate(w.startedAt).getTime()) / 1000), 12 * 3600)
    : 0;
  const total = banked + live;
  if (total < 60) return '';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const spent = `${h ? `${h}h ` : ''}${m}m`;
  return `<p class="dim small" style="margin:.6rem 0 0;">⏱ Time I have worked on your case: <strong style="color:var(--ink);">${spent}</strong>${
    w.startedAt ? ' <span style="color:var(--cyan);">· working on it right now</span>' : ''
  }</p>`;
}

/**
 * What a client sees while their case is paused.
 *
 * Said plainly, at the top, before anything else on the page - because the
 * alternative is somebody watching a date slide past with no explanation and
 * concluding they have been dropped. It says what stopped, that their dates
 * moved with it, and the one thing that did NOT stop, which is the part that
 * could actually hurt them if they assumed otherwise.
 *
 * It does not say why. His health and his family are not the client's
 * business, and `hold.reason` is never sent to this page.
 */
function pausedNotice(c) {
  if (!c?.hold?.pausedAt) return '';
  const back = c.hold.backBy ? toDate(c.hold.backBy) : null;
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'long', month: 'long', day: 'numeric',
  });
  return `
    <div class="panel" style="border-color:var(--magenta);">
      <h3 style="margin:0 0 .3rem;">Your case is paused</h3>
      <p style="margin:0 0 .5rem;">I have had to stop work for a short while.
        Every date on your case has stopped with it, so nothing is running
        down while I am away and you lose no time.${
        back ? ` I expect to pick it back up around <strong>${fmt.format(back)}</strong>.` : ''}</p>
      <p class="dim small" style="margin:0 0 .5rem;">Your case page, your files
        and your chat all stay open. Message me any time; I will read it when
        I am back.</p>
      <p class="dim small" style="margin:0;"><strong>One thing does not
        pause.</strong> If your insurer has given you a deadline to appeal,
        that clock is theirs and it keeps running. If one is close, tell me
        and I will deal with it before anything else.</p>
    </div>`;
}

/**
 * Why a closed case closed, in Eric's own words - documented in the case for
 * both parties (his rule, 2026-08-25). Every close writes one: his hand
 * closes carry what he typed, the automatic sweep writes its plain sentence.
 * Older cases closed before the field existed simply have nothing to show.
 */
function closedNotice(c) {
  if (c.status !== 'closed' || !c.closedReason) return '';
  return `
    <div class="panel" style="margin:0 0 1rem;">
      <h3 style="margin:0 0 .35rem;">Why this case closed</h3>
      <p style="margin:0;">${esc(c.closedReason)}</p>
      <p class="dim small" style="margin:.5rem 0 0;">Everything in the case
        stays yours to read and download, for as long as you want it. If you
        would like to leave a review, that stays open too.</p>
    </div>`;
}

/**
 * The tier's cadence, on the client's own card: the next check-in call if
 * one is booked, or the standing promise if not. Standard cases show
 * nothing - their shape is one call and a report.
 */
function checkInLine(c, localFmt) {
  if (!c.fullAccess || c.status === 'closed') return '';
  const now = Date.now();
  const future = (Array.isArray(c.checkIns) ? c.checkIns : [])
    .map((x) => toDate(x.start).getTime()).filter((t) => t > now).sort((a, b) => a - b);
  if (future.length) {
    const next = new Date(future[0]);
    return `<p class="dim" style="margin:.4rem 0 0;">🗓 Next check-in:
      <strong style="color:var(--ink)">${esc(localFmt.format(next))}</strong> your time.</p>`;
  }
  return `<p class="dim small" style="margin:.4rem 0 0;">🗓 Your case includes
    check-in calls at least twice a month — they are part of the service, so
    we never go long without speaking. None is on the books right now —
    message me in chat and we'll set the next one.</p>`;
}

function renderProgress(el, c) {
  const start = c.appointment && toDate(c.appointment.start);
  const closed = c.status === 'closed';
  const rank = STATUS_RANK[c.status] ?? 1;
  const mtFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const localFmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  const requested = !!c.appointment?.requested;
  const method = c.appointment?.method;
  // The two things a person actually does from this card - get it on their
  // calendar, get into the call - used to be a tiny "+ calendar" tacked onto
  // the date line and a "join link" buried mid-sentence in dim small print.
  // (Eric, 2026-08-21: "make the hyperlink section text larger... line it
  // up.") They are two matching buttons on one row now; what stays a sentence
  // is only what is not tappable.
  const methodLine = method === 'phone'
    ? `Phone. I call you at <strong>${esc(c.appointment.phone || 'your number')}</strong>.`
    : c.appointment?.joinLink
      ? ''
      : 'Video call. Your join link appears here before the call.';
  const joinBtn = method !== 'phone' && c.appointment?.joinLink
    ? `<a class="btn ghost" style="text-align:center;" href="${esc(c.appointment.joinLink)}" rel="noopener">🎥 Join the video call</a>`
    : '';
  const requestedNote = requested
    ? `<p class="small" style="margin:.4rem 0 0; color:var(--orange);">
         <strong>Awaiting confirmation.</strong> You asked for this time and it wasn't on my
         calendar. I'll confirm it, or offer you the nearest time that works, before the date.</p>`
    : '';
  const election = c.publicElection || { choice: 'private' };
  const revocable = election.choice === 'public' && !closed &&
    (!election.revocableUntil || toDate(election.revocableUntil) > new Date());

  el.innerHTML = `
    ${confirmationBanner(c, start, localFmt)}
    ${pausedNotice(c)}
    ${closedNotice(c)}
    <h2 class="case-sec-h">Progress</h2>
    <div class="panel">
      ${start ? `
        <p style="margin:0 0 .3rem;"><strong>${mtFmt.format(start)} MST</strong><br>
        <span class="dim small">${localFmt.format(start)} your time</span></p>` : ''}
      ${methodLine ? `<p class="dim" style="margin:.2rem 0 0;">${methodLine}</p>` : ''}
      ${start || joinBtn ? `
        <p class="actions" style="margin:.7rem 0 .2rem; flex-direction:column; align-items:stretch; gap:.5rem; max-width:22rem;">
          ${joinBtn}
          ${start ? '<a href="#" class="btn ghost" style="text-align:center;" data-ics>📅 Add to calendar</a>' : ''}
        </p>` : ''}
      ${requestedNote}
      ${checkInLine(c, localFmt)}
      ${workLine(c)}
      <ul class="timeline">
        ${STEPS.map(([, label], i) => `
          <li class="${i + 1 < rank ? 'done' : i + 1 === rank ? (closed ? 'done' : 'now') : ''}">
            <span class="t-dot"></span>${label}</li>`).join('')}
      </ul>
    </div>
    <div data-authority></div>
    <details class="faq" data-more>
      <summary>Session details</summary>
      <div class="faq-a">
        <p class="dim small">Session: <strong style="color:${election.choice === 'public' ? 'var(--magenta)' : 'var(--cyan)'};">
          ${election.choice === 'public' ? 'PUBLIC, streams live on YouTube' : 'PRIVATE'}</strong></p>
        ${revocable ? `<p><button class="btn ghost" data-private>Make it private</button></p>` : ''}
        ${followUpSection(c)}
      </div>
    </details>`;

  // Full Access cannot start until this is signed, so it sits directly under
  // the timeline rather than behind a tab: the client tab strip is already at
  // four and three pills barely fit a 390px phone.
  const auth = el.querySelector('[data-authority]');
  if (auth && c.fullAccess) mountAuthority(auth, c);

  el.querySelector('[data-ics]')?.addEventListener('click', (e) => {
    e.preventDefault();
    downloadIcs(c, start);
  });
  el.querySelector('[data-private]')?.addEventListener('click', (e) => makePrivate(c.id, e.target));
  return;

  /** Second-session state: scheduled follow-up, a pay-to-confirm prompt, or a purchased-but-unused follow-up with its deadline. */
  function followUpSection(c) {
    const mt = new Intl.DateTimeFormat('en-US', {
      timeZone: MOUNTAIN_TZ, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    if (c.followUp) {
      const s = toDate(c.followUp.start);
      return `<p class="small" style="margin-top:.5rem;"><strong style="color:var(--cyan)">
        ${c.followUp.kind === 'followup' ? 'Follow-up session' : esc(c.followUp.label || 'Session')}:</strong>
        ${mt.format(s)} MST</p>`;
    }
    if (c.pendingExtra) {
      const s = toDate(c.pendingExtra.start);
      return `<div style="border:1px solid var(--magenta); border-radius:10px; padding:.6rem .8rem; margin-top:.6rem;">
        <p class="small" style="margin:0 0 .4rem;"><strong>${esc(c.pendingExtra.label)}</strong> —
          ${mt.format(s)} MST · $${(c.pendingExtra.amountCents / 100).toLocaleString()}</p>
        <p class="dim small" style="margin:0 0 .5rem;">I scheduled this for you. The time is held for 24 hours. Pay to confirm it.</p>
        <a class="btn" href="${esc(c.pendingExtra.url)}">Pay & confirm</a>
      </div>`;
    }
    if (c.addOnFollowUp) {
      const base = c.addOnFollowUpAt
        ? toDate(c.addOnFollowUpAt).getTime()
        : (c.appointment?.start ? toDate(c.appointment.start).getTime() : null);
      const expires = base ? base + 30 * 86_400_000 : null;
      const lapsed = expires && Date.now() > expires;
      if (lapsed) return '';
      return `<p class="dim small">Your follow-up session is paid for: message me in chat to schedule it.${
        expires && Date.now() > base
          ? ` Use it by <strong style="color:var(--ink)">${mt.format(new Date(expires))} MST</strong>.`
          : ' It must be used within 30 days.'
      }</p>`;
    }
    return '';
  }
}

// ---- Chat section (mounted once per case id; never re-rendered by refresh paths) ----
function renderChat(el, c) {
  const closed = c.status === 'closed';
  // Chat opens one week before the booked call. Booking far out used to buy
  // the whole wait as free chat runway; now the wait is quiet, the next-call
  // list stays open, and $50 (the direct line price) opens chat immediately
  // for the life of the case. (Eric, 2026-08-22: "explicitly for avoiding
  // chat abuse by booking two months in advance.")
  const startMs = c.appointment?.start ? toDate(c.appointment.start).getTime() : null;
  const justOpened = new URLSearchParams(location.search).get('chatopen') === '1';
  const chatLocked = !closed && !c.chatUnlocked && !justOpened
    && startMs && (startMs - Date.now() > 7 * 86_400_000);
  const opensOn = startMs ? new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric',
  }).format(new Date(startMs - 7 * 86_400_000)) : '';
  el.innerHTML = `
    <h2 class="case-sec-h">Chat</h2>
    <p class="dim small" style="margin:.1rem 0 .3rem;">Chat keeps your case moving between calls: records, scheduling, and anything new or urgent with your health. The analysis itself happens on our calls, and everything else goes on the list for the next one.</p>
    <p style="margin:.2rem 0 .3rem;"><span class="p-dot"></span><span class="p-label">Checking…</span></p>
    <div class="panel" data-chat></div>
    ${chatLocked ? `
    <div class="panel" data-chat-unlock style="margin-top:.7rem;">
      <h3 style="margin:.1rem 0 .2rem;">Want a direct line before then?</h3>
      <p class="dim small" style="margin:0 0 .5rem;">Open chat now for a one-time <span data-unlock-price>$50</span> and it stays open for the life of your case. Otherwise it opens on its own, one week before we talk.</p>
      <button class="btn" data-unlock-go>Open chat now · <span data-unlock-price>$50</span></button>
      <p class="error" data-unlock-err hidden style="margin:.5rem 0 0;"></p>
    </div>` : ''}
    ${justOpened && !c.chatUnlocked ? '<p class="dim small" data-unlock-thanks style="margin:.4rem 0 0;">✓ Chat is open. Thank you.</p>' : ''}
    <div class="panel" data-nextcall hidden style="margin-top:.7rem;">
      <h3 style="margin:.1rem 0 .2rem;">🗓 For our next call</h3>
      <p class="dim small" style="margin:0 0 .5rem;">Anything you add here is captured, and we go through the list together on the call, where it gets real attention instead of a rushed reply.</p>
      <ul class="agenda-list" data-agenda-list></ul>
      ${closed ? '' : `<form data-agenda-form style="display:flex; gap:.4rem; margin-top:.5rem;">
        <input type="text" maxlength="500" placeholder="Add something for the call…" style="flex:1; min-width:0;">
        <button class="btn quiet" type="submit">Add</button>
      </form>
      <p class="error" data-agenda-err hidden></p>`}
    </div>`;
  watchPresence(el);
  // Just a chat (Eric, 2026-08-22: "Have it just be a chat"). The next-call
  // list keeps its own panel and add box below; the composer stays clean.
  mountChat({
    container: el.querySelector('[data-chat]'),
    parentPath: ['cases', c.id],
    user,
    myRole: 'client',
    saveUid: user.uid,
    disabled: closed || chatLocked,
    notice: closed
      ? 'This chat ended when the case closed. Your documents remain yours forever.'
      : `Chat opens ${opensOn}, one week before our call. Your "For our next call" list below is always open, and I read it.`,
  });
  if (justOpened) history.replaceState(null, '', `/case.html?id=${c.id}`);
  // The figure comes from the worker, per the never-hardcode-a-price rule;
  // the markup's $50 is only the first paint while this answers.
  if (chatLocked) {
    fetch('/api/rates').then((r) => r.json()).then((r) => {
      if (Number(r.chatOpenCents) > 0) {
        el.querySelectorAll('[data-unlock-price]').forEach((sp) => {
          sp.textContent = `$${(r.chatOpenCents / 100).toFixed(0)}`;
        });
      }
    }).catch(() => {});
  }
  el.querySelector('[data-unlock-go]')?.addEventListener('click', async (e) => {
    const err = el.querySelector('[data-unlock-err]');
    if (err) err.hidden = true;
    e.target.disabled = true;
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/chat-unlock', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ caseId: c.id }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
      location.href = out.url;
    } catch (ex) {
      e.target.disabled = false;
      if (err) { err.textContent = ex.message; err.hidden = false; }
    }
  });
  mountAgenda(el, c.id);
}

// ---- the next-call list (the shared agenda; the Worker holds it) ----
// New Firestore paths cannot be read from the browser (rules ship by CLI,
// which the owner of this project has no way to run), so the whole list
// lives behind /api/agenda and the Worker enforces whose case it is.

async function agendaPost(payload) {
  const token = await user.getIdToken();
  const res = await fetch('/api/agenda', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
  return out;
}

async function mountAgenda(el, caseId) {
  const box = el.querySelector('[data-nextcall]');
  if (!box) return;
  // Listeners FIRST, fetch second. They used to be wired only after a
  // successful load, but addAgendaItem un-hides this box on a composer add
  // even when the load failed - and then Add was a bare form submit that
  // reloaded the page and ate the typed text.
  box.querySelector('[data-agenda-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const ok = await addAgendaItem(el, caseId, text);
    if (!ok) input.value = text;
  });
  box.addEventListener('click', async (e) => {
    const id = e.target.closest?.('[data-agenda-remove]')?.dataset.agendaRemove;
    if (!id) return;
    try {
      await agendaPost({ id: caseId, action: 'remove', itemId: id });
      paintAgenda(box, (box._items || []).filter((i) => i.id !== id));
    } catch { /* leave it; the next load resolves it */ }
  });
  try {
    const token = await user.getIdToken();
    const res = await fetch(`/api/agenda?id=${encodeURIComponent(caseId)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error('unavailable');
    // Visible even when empty: the door matters as much as the list.
    box.hidden = false;
    paintAgenda(box, (await res.json()).items || []);
  } catch {
    // Fail-soft: an unreachable list must not break the chat above it.
    box.hidden = true;
  }
}

async function addAgendaItem(el, caseId, text) {
  const box = el.querySelector('[data-nextcall]');
  const err = box?.querySelector('[data-agenda-err]');
  if (err) err.hidden = true;
  try {
    const out = await agendaPost({ id: caseId, action: 'add', text });
    if (box) {
      paintAgenda(box, [...(box._items || []), out.item]);
      box.hidden = false;
      // Their words, visibly on the list: captured, not refused.
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    return true;
  } catch (e) {
    if (err) { err.textContent = e.message; err.hidden = false; }
    return false;
  }
}

function paintAgenda(box, items) {
  box._items = items;
  const list = box.querySelector('[data-agenda-list]');
  if (!list) return;
  if (!items.length) {
    list.innerHTML = '<li class="dim small" style="list-style:none; margin-left:-1rem;">Nothing on the list yet.</li>';
    return;
  }
  const open = items.filter((i) => !i.done);
  const covered = items.filter((i) => i.done);
  list.innerHTML = [
    ...open.map((i) => `<li data-item="${esc(i.id)}" style="display:flex; gap:.4rem; align-items:flex-start; margin:.3rem 0; list-style:none;">
      <span style="flex:1; min-width:0;">• ${esc(i.text)}</span>${
      i.role === 'client'
        ? `<button type="button" class="btn quiet" style="font-size:.68rem; padding:.15rem .5rem; flex:none;" data-agenda-remove="${esc(i.id)}">Remove</button>`
        : ''
    }</li>`),
    ...covered.map((i) => `<li class="dim" style="margin:.3rem 0; list-style:none;">✓ ${esc(i.text)} <span class="small">· covered</span></li>`),
  ].join('');
}

// ---- Documents section ----
function renderDocs(el, c) {
  const closed = c.status === 'closed';
  el.innerHTML = `
    <h2 class="case-sec-h">Documents</h2>
    ${closed
      ? '<p class="dim small">This case is closed. Your documents stay here forever. Download or print any of them.</p>'
      : `<label class="dropzone" data-drop>
           Tap to add labs, imaging, or records<br>
           <span class="small">PDF · JPEG · PNG · HEIC · DICOM · ZIP, 25 MB max each</span>
           <input type="file" accept="${ACCEPT}" multiple hidden data-file-input>
         </label>
         <progress data-progress max="100" value="0" hidden></progress>
         <p class="error" data-upload-error hidden></p>`}
    <ul class="filelist" data-files><li class="dim small">Loading files…</li></ul>
    <div data-review hidden></div>`;
  const input = el.querySelector('[data-file-input]');
  input?.addEventListener('change', () => uploadFiles(c, el, [...input.files]));
  refreshFiles(c, el);
  renderReview(el, c);
  // Chat saves refresh this list via the permanent pa-saved-file listener at the top.
}

async function refreshFiles(c, el) {
  const listEl = el.querySelector('[data-files]');
  if (!listEl) return;
  // Anything shared in the chat lands here as well as in the thread. It is
  // the same document either way, and having to remember which of two places
  // you put something is not a filing system.
  const kinds = [
    ['report', `cases/${c.id}/report`],
    ['recording', `cases/${c.id}/recording`],
    ['upload', `cases/${c.id}/uploads`],
    ['chat', `cases/${c.id}/chat-files`],
    ['saved', `profiles/${user.uid}/saved`],
  ];
  const rows = [];
  for (const [kind, path] of kinds) {
    try {
      const res = await listAll(ref(storage, path));
      for (const item of res.items) {
        const [url, meta] = await Promise.all([getDownloadURL(item), getMetadata(item)]);
        rows.push({ kind, name: item.name, url, ts: new Date(meta.timeCreated), size: meta.size, path: item.fullPath });
      }
    } catch { /* folder may not exist yet */ }
  }
  if (!rows.length) {
    listEl.innerHTML = '<li class="dim small">Nothing here yet. Add files above, or share them in chat and long-press to save.</li>';
    return;
  }
  // Uploads are stored as `${Date.now()}-${name}` so two files called the same
  // thing cannot collide. That is a storage detail, and printing it put a
  // thirteen-digit number in front of every filename a client reads.
  const shownName = (n) => String(n).replace(/^\d{10,}-/, '');
  // A file long-pressed out of the chat exists twice: once where it was
  // shared and once in their own saved folder. One row, not two.
  const seen = new Set(rows.filter((r) => r.kind === 'chat')
    .map((r) => `${shownName(r.name)}|${r.size}`));
  const deduped = rows.filter((r) => !(r.kind === 'saved' && seen.has(`${shownName(r.name)}|${r.size}`)));
  rows.length = 0;
  rows.push(...deduped);

  const order = { report: 0, recording: 1, upload: 2, chat: 3, saved: 4 };
  rows.sort((a, b) => order[a.kind] - order[b.kind] || b.ts - a.ts);
  const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  // The report gets a ✅ the moment the case is delivered. It is the one file
  // they have been waiting for, and "is this the final one" should not be a
  // question they have to work out from the filename.
  const delivered = c.status === 'delivered' || c.status === 'closed';
  listEl.innerHTML = rows.map((r, i) => `
    <li data-frow="${i}">
      <span class="fname"><span class="kind-pill ${r.kind}">${r.kind === 'saved' || r.kind === 'chat' ? 'FROM CHAT' : r.kind.toUpperCase()}</span>
        ${r.kind === 'report' && delivered ? '<span class="delivered-tick" title="Delivered" role="img" aria-label="Delivered">✅</span>' : ''}
        <a href="${r.url}" target="_blank" rel="noopener">${esc(shownName(r.name))}</a></span>
      <span class="fmeta">${fmt.format(r.ts)} · ${prettySize(r.size)}</span>
    </li>`).join('');

  // Long-press (or right-click) a file you put here to remove it. Offered on
  // your own kinds only; the report and the recording are the case record.
  // The Worker is the authority: a chat file is only deletable when a chat
  // message of YOURS carries it. (Eric, 2026-08-22: "They should too, so
  // long as they themselves uploaded it.")
  listEl.querySelectorAll('[data-frow]').forEach((li) => {
    const r = rows[Number(li.dataset.frow)];
    if (!r?.path || !['upload', 'chat', 'saved'].includes(r.kind)) return;
    wireFileDelete(li, r, async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/file/delete', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'case', id: c.id, path: r.path }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
        refreshFiles(c, el);
      } catch (err) { alert(`Couldn't delete: ${err.message}`); }
    });
  });
}

/** Long-press (550ms) or right-click asks, then runs the delete. */
function wireFileDelete(li, r, doDelete) {
  const name = String(r.name).replace(/^\d{10,}-/, '');
  const askThen = () => {
    if (confirm(`Delete "${name}"? This removes the file for both of us.`)) doDelete();
  };
  let timer = null;
  li.addEventListener('touchstart', () => { timer = setTimeout(askThen, 550); }, { passive: true });
  for (const ev of ['touchend', 'touchmove', 'touchcancel']) {
    li.addEventListener(ev, () => clearTimeout(timer), { passive: true });
  }
  li.addEventListener('contextmenu', (e) => { e.preventDefault(); askThen(); });
}

/**
 * The review card, under the documents, once the report has landed.
 *
 * The copy is Eric's, near enough word for word, with one change he asked for
 * afterwards: the line offering a free week of priority chat for leaving a
 * review is gone. Paying for reviews is the kind of thing that makes the
 * honest ones worth less, and it would have meant a disclosure on the reviews
 * page for the rest of time. What is left of that sentence is the fact it
 * carried: the chat closes 48 hours after the report lands.
 */
const REVIEW_PROMPT = [
  'Please leave feedback for me. This helps better improve the patient experience, app development, and future cases.',
  'Thank You!',
];
// Said only where it is true. A standard case closes 48 hours after the
// report; a Full Access case does not, and a case Eric closed by hand has
// already closed. Telling either of them to hurry was wrong.
const REVIEW_48H = 'The chat closes 48hrs after you receive your advocacy case review.';

function renderReview(el, c) {
  const delivered = c.status === 'delivered' || c.status === 'closed';
  const host = el.querySelector('[data-review]');
  if (!host) return;
  host.hidden = false;
  if (host.dataset.done === c.id) return;   // never rebuild a card mid-typing

  // Before delivery the card opens with his standing invitation instead of
  // the wrap-up prompt. (Eric, 2026-08-21, verbatim.)
  const ANYTIME = [
    'If The Pocket Advocate has helped you, you\u2019re welcome to leave a review at any point along the way. You don\u2019t need to wait until your case is finished.',
    'Share what the experience has been like, what\u2019s been helpful, or anything you think future clients should know.',
  ];

  host.dataset.done = c.id;
  host.innerHTML = `
    <div class="review-card">
      <h3>${delivered ? 'How did it go?' : 'Leave a Review Anytime'}</h3>
      ${(delivered ? REVIEW_PROMPT : ANYTIME).map((t) => `<p>${esc(t)}</p>`).join('')}
      ${delivered && c.status !== 'closed' && !c.fullAccess
        ? `<p>${esc(REVIEW_48H)}</p>` : ''}
      ${c.status === 'closed'
        ? '<p>Your case is closed, and this stays open. If you have something to say about how it went, I would rather hear it than not.</p>'
        : ''}
      ${delivered ? `<p class="dim small"><em>You still keep all chat logs and documents for your case, untouched.</em></p>` : ''}
      <div class="stars" data-stars role="radiogroup" aria-label="Rating out of five">
        ${[1, 2, 3, 4, 5].map((n) => `
          <button type="button" class="star" data-star="${n}" role="radio" aria-checked="false"
            aria-label="${n} star${n === 1 ? '' : 's'}">★</button>`).join('')}
      </div>
      <textarea data-review-text rows="4" maxlength="1000" placeholder="A few words, if you have them"></textarea>
      <div class="actions">
        <button class="btn glow" data-review-send disabled>Submit</button>
      </div>
      <p class="error" data-review-error hidden></p>
      ${delivered && c.addOnFollowUp && !c.followUp && !justBoughtFollowUp() ? `
        <p class="dim small follow-note">Your follow-up case review is still on the books. If it's still not scheduled, Eric will promptly discuss with you the best time to follow up with a second review.</p>` : ''}
      ${delivered ? `
      <p class="dim small"><em>Note: You can export this as a PDF for your records and can hand select which sections you want to export.</em></p>
      <div class="actions">
        <button class="btn quiet" data-export>Export as PDF</button>
      </div>` : ''}
    </div>`;

  let stars = 0;
  const sendBtn = host.querySelector('[data-review-send]');
  const errEl = host.querySelector('[data-review-error]');
  host.querySelectorAll('[data-star]').forEach((b) =>
    b.addEventListener('click', () => {
      stars = Number(b.dataset.star);
      host.querySelectorAll('[data-star]').forEach((x) => {
        const on = Number(x.dataset.star) <= stars;
        x.classList.toggle('on', on);
        x.setAttribute('aria-checked', String(Number(x.dataset.star) === stars));
      });
      sendBtn.disabled = false;
    }));

  host.querySelector('[data-export]')?.addEventListener('click', () => openExport(c));

  sendBtn.addEventListener('click', async () => {
    if (!stars) return;
    sendBtn.disabled = true;
    errEl.hidden = true;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          caseId: c.id, stars,
          text: host.querySelector('[data-review-text]').value.trim(),
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `Couldn't send that (${res.status})`);
      thankYou(host);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      sendBtn.disabled = false;
    }
  });
}

/**
 * "You can export this as a PDF for your records and can hand select which
 * sections you want to export." So: a picker, then a print window holding only
 * the chosen sections, and Share > Print > Save to Files gives them a PDF on
 * their phone. No library, no upload, and nothing leaves the device.
 */
const EXPORT_SECTIONS = [
  { id: 'summary', label: 'Case summary', blurb: 'Dates, status, what was bought' },
  { id: 'chat', label: 'Chat log', blurb: 'Every message, in order' },
  { id: 'docs', label: 'Documents list', blurb: 'What is in the file, with dates' },
];

function openExport(c) {
  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-card">
      <div class="row"><h3 style="margin:0;">Export as PDF</h3><button class="btn quiet" data-close>Cancel</button></div>
      <p class="dim small">Pick what to include. Your phone's Share menu turns the print view into a PDF you can save.</p>
      ${EXPORT_SECTIONS.map((x) => `
        <label class="toggle-row">
          <span><strong>${esc(x.label)}</strong><br><span class="dim small">${esc(x.blurb)}</span></span>
          <input type="checkbox" data-sec="${esc(x.id)}" checked>
        </label>`).join('')}
      <div class="actions" style="margin-top:.6rem;">
        <button class="btn glow" data-go>Open the print view</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-close]').addEventListener('click', close);
  overlay.querySelector('[data-go]').addEventListener('click', () => {
    const want = new Set([...overlay.querySelectorAll('[data-sec]:checked')].map((x) => x.dataset.sec));
    close();
    printExport(c, want);
  });
}

function printExport(c, want) {
  const mtFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  // The chat log comes off the DOM that is already on screen rather than a
  // fresh read: it is the same messages, and a second query would need rules
  // this page does not have open.
  const msgs = [...document.querySelectorAll('.msg')].map((m) => ({
    // chat.js writes 'me', never 'mine' - every exported message was
    // attributed to Eric, including the client's own.
    mine: m.classList.contains('me'),
    text: (m.querySelector('.msg-text')?.textContent || m.textContent || '').trim(),
    // There is no <time> in chat.js; the stamp lives in .msg-meta.
    when: m.querySelector('.msg-meta')?.textContent?.trim() || '',
  })).filter((m) => m.text);
  const files = [...document.querySelectorAll('[data-files] li')]
    .map((li) => li.textContent.replace(/\s+/g, ' ').trim())
    .filter((t) => t && !/^Loading|^Nothing here/.test(t));

  const win = window.open('', '_blank');
  if (!win) { alert("Your browser blocked the print window. Allow pop-ups for this site and try again."); return; }
  const sec = (id, title, inner) => (want.has(id) ? `<h2>${title}</h2>${inner}` : '');
  win.document.write(`<!doctype html><html><head><meta charset="utf-8">
    <title>Pocket Advocate case record</title>
    <style>
      body { font: 15px/1.55 -apple-system, system-ui, sans-serif; color: #111; margin: 2rem 1.4rem; }
      h1 { font-size: 1.5rem; margin: 0 0 .2rem; }
      h2 { font-size: 1.05rem; margin: 1.6rem 0 .4rem; border-bottom: 1px solid #ccc; padding-bottom: .2rem; }
      .meta { color: #555; font-size: .9rem; margin: 0 0 1rem; }
      .m { margin: 0 0 .55rem; padding-left: .7rem; border-left: 3px solid #ddd; }
      .m.mine { border-left-color: #0E6E86; }
      .who { font-size: .78rem; color: #666; }
      ul { padding-left: 1.1rem; } li { margin: 0 0 .25rem; }
      @page { margin: 14mm; }
    </style></head><body>
    <h1>Advocacy Case</h1>
    <p class="meta">Pocket Advocate · exported ${new Date().toLocaleDateString()}</p>
    ${sec('summary', 'Case summary', `<ul>
      <li>Status: ${esc(STATUS_LABEL[c.status] || c.status)}</li>
      ${c.appointment?.start ? `<li>Discussion: ${esc(mtFmt.format(toDate(c.appointment.start)))} MST</li>` : ''}
      ${c.reportDeliveredAt ? `<li>Report delivered: ${esc(toDate(c.reportDeliveredAt).toLocaleDateString())}</li>` : ''}
      ${c.addOnFollowUp ? '<li>Follow-up session: purchased</li>' : ''}
    </ul>`)}
    ${sec('chat', 'Chat log', msgs.length
      ? msgs.map((m) => `<p class="m ${m.mine ? 'mine' : ''}"><span class="who">${m.mine ? 'You' : 'Eric'}${m.when ? ' · ' + esc(m.when) : ''}</span><br>${esc(m.text)}</p>`).join('')
      : '<p>No messages.</p>')}
    ${sec('docs', 'Documents', files.length
      ? `<ul>${files.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`
      : '<p>No documents.</p>')}
    </body></html>`);
  win.document.close();
  // Give the new document a beat to lay out before the print sheet opens over it.
  setTimeout(() => win.print(), 350);
}

/**
 * The follow-up, offered from the case rather than at checkout (Eric,
 * 2026-08-20). It appears once there is something to follow up ON - after the
 * discussion has happened - and disappears the moment one is bought.
 *
 * Buying it sets the same flag a checkout add-on used to set, so every part of
 * the follow-up machinery works unchanged from here: Eric's scheduler, the
 * expiry warning, the line above.
 */
// The fallback only. What a follow-up costs THIS client is the price they
// were quoted when they booked, which the case carries as addonRateCents.
// Everyone booked before that field existed falls back to this, and since the
// rate only moves upward that errs in their favour.
const FOLLOWUP_PRICE_CENTS = 17500;
const followUpPrice = (c) =>
  (Number(c?.addonRateCents) > 0 ? Number(c.addonRateCents) : FOLLOWUP_PRICE_CENTS) / 100;

// The Full Access list price, in CENTS, corrected from /api/rates the moment
// it answers. The upgrade card subtracts what this case already paid, so the
// number on the button is the difference and never the list price.
let fullAccessCents = 350000;
const fullAccessPrice = () => fullAccessCents;
// Named, because the upgrade card has to know when this has landed. It used
// to be fire-and-forget, so a slow or failed fetch left the compiled-in price
// on a card that the Worker would then refuse.
const ratesReady = fetch('/api/rates')
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => { if (Number(d?.fullCents) > 0) fullAccessCents = Number(d.fullCents); })
  .catch(() => { /* the compiled-in price is right at deploy time */ });

/**
 * True on the one page load that comes straight back from Stripe. The offer
 * card is already saying the follow-up is reserved; the review card below it
 * saying the same thing in different words reads as a glitch.
 */
function renderPageFooter(host, c) {
  if (!host) return;
  // The tip jar was retired here on 2026-08-24 at Eric's word. Past tips stay
  // in the ledger - that money was really received - but nothing on a client
  // surface asks for another one.
  //
  // The review card is NOT here either. renderDocs already mounts one, and
  // having a second in the footer meant an undelivered case showed the same
  // card twice, each independently wired, so answering one left the other
  // still asking.
  host.innerHTML = '';
  // The version line rides just above the jar (Eric, 2026-08-21). It mounts
  // itself at the end of main before this footer exists; before() MOVES the
  // node, click wiring intact. Idempotent across repaints.
  const verline = document.getElementById('pa-verline');
  if (verline) host.before(verline);
}

/**
 * The Add-ons page: everything purchasable on a running case, in one place,
 * each with a ? explainer. The prices are the same live ones the cards have
 * always used - nothing here is typed.
 */
/**
 * Thirty more days on a Hands-Off window, stacking (Eric, 2026-08-25: "they
 * can choose to add 30 days at a time under the same tab"). Flat price, off
 * the ratchet, so the compiled-in number IS the number.
 */
const EXTEND_PRICE_CENTS = 175000;
function windowEndOf(c) {
  // The Worker's fullAccessWindowEnd, mirrored: purchase start (first-call
  // fallback), plus extensions, plus every stretch spent on hold.
  const bought = c?.fullAccessAt ? toDate(c.fullAccessAt).getTime() : 0;
  const start = bought || (c?.appointment?.start ? toDate(c.appointment.start).getTime() : 0);
  if (!start) return null;
  const held = Math.max(0, Number(c?.hold?.totalMs) || 0)
    + (c?.hold?.pausedAt ? Math.max(0, Date.now() - toDate(c.hold.pausedAt).getTime()) : 0);
  const days = 60 + (Number(c.fullAccessExtraDays) || 0);
  return new Date(start + days * 86_400_000 + held);
}
function extendOffer(c) {
  if (!c.fullAccess || c.status === 'closed') return '';
  const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' });
  // Straight back from Stripe: say thank you from the URL rather than a flag
  // that might still be false for another second.
  if (new URLSearchParams(location.search).get('extended') === '1')
    return `
      <div class="followup-offer is-done">
        <h3><span class="fu-tick" aria-hidden="true">✓</span> Thirty more days are on your case.</h3>
        <p>Same case, same file, same rhythm. Your case page shows the new dates.</p>
      </div>`;
  if (c.pendingExtend?.url)
    return `
      <div class="followup-offer">
        <h3>Your extension checkout is still open</h3>
        <p>Finish it or let it lapse; nothing is charged until you do.</p>
        <p><a class="btn glow" href="${esc(c.pendingExtend.url)}">Finish checkout</a></p>
      </div>`;
  const end = windowEndOf(c);
  return `
    <div class="followup-offer">
      <h3>Need more time on the clock?</h3>
      <p>Your coordination window ${end && end.getTime() < Date.now() ? 'ended' : 'runs through'}
        <strong style="color:var(--ink)">${end ? esc(dateFmt.format(end)) : 'its end date'}</strong>.
        Add 30 days at a time, as often as your case needs it — the check-ins,
        the calls on your behalf, and the rest keep running exactly as they are.</p>
      <div class="fu-buy">
        <span class="price">$${(EXTEND_PRICE_CENTS / 100).toLocaleString()}</span>
        <button class="btn glow" data-buy-extend>Add 30 days</button>
      </div>
      <p class="error" data-extend-error hidden></p>
    </div>`;
}
function wireExtendOffer(el, c) {
  const btn = el.querySelector('[data-buy-extend]');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const err = el.querySelector('[data-extend-error]');
    btn.disabled = true;
    if (err) err.hidden = true;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/extend', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ caseId: c.id }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.url) throw new Error(out.error || `Couldn't start that (${res.status})`);
      location.href = out.url;
    } catch (e) {
      if (err) { err.textContent = e.message; err.hidden = false; }
      btn.disabled = false;
    }
  });
}

function renderAddons(el, c) {
  el.innerHTML = `
    <h2 class="case-sec-h">Case Enhancements</h2>
    <p class="dim small" style="margin:.2rem 0 .8rem;">Extras you can put on
      this case whenever you need them. Nothing here is required, and nothing
      is charged until you choose it.</p>
    <div data-telehealth></div>
    <div data-followup></div>
    <div data-upgrade></div>
    <div data-extend></div>`;
  const th = el.querySelector('[data-telehealth]');
  if (th) { th.innerHTML = telehealthCard(c); wireTelehealthCard(th, c); }
  const ex = el.querySelector('[data-extend]');
  if (ex) { ex.innerHTML = extendOffer(c); wireExtendOffer(ex, c); }
  const offer = el.querySelector('[data-followup]');
  if (offer) {
    offer.innerHTML = followUpOffer(c);
    wireFollowUpOffer(offer, c);
  }
  const up = el.querySelector('[data-upgrade]');
  if (up) {
    up.innerHTML = upgradeOffer(c);
    wireUpgradeOffer(up, c);
    // Repaint once the live price answers. Without this the card kept
    // whatever was compiled in, and the handshake would then bounce a buyer
    // who had done nothing wrong.
    ratesReady.then(() => {
      if (!up.isConnected || up.querySelector('[data-upgrade-ack]:checked')) return;
      up.innerHTML = upgradeOffer(c);
      wireUpgradeOffer(up, c);
    }).catch(() => {});
  }
}

/**
 * Telehealth Appointment Advocacy: Eric joins the client's own telehealth
 * visit by video and advocates live. The client names the appointment; he
 * confirms or declines every one; a decline - his or the clinic's - refunds
 * the payment in full, and the card says so before they type a thing.
 */
const TELEHEALTH_PRICE_CENTS = 25000;
function telehealthCard(c) {
  const p = c.pendingTelehealth;
  const visits = (Array.isArray(c.telehealthVisits) ? c.telehealthVisits : [])
    .filter((v) => toDate(v.when).getTime() > Date.now() - 3600_000)
    .sort((a, b) => toDate(a.when) - toDate(b.when));
  const fmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const upcoming = visits.length ? `
    <p class="dim small" style="margin:.4rem 0 0;">Confirmed:
      ${visits.map((v) => `<strong style="color:var(--ink)">${esc(fmt.format(toDate(v.when)))}</strong> · ${esc(v.clinicName || '')}`).join('<br>')}</p>` : '';

  // Straight back from Stripe: paid, on Eric's desk to confirm.
  if (new URLSearchParams(location.search).get('telehealth') === '1' && (!p || p.state !== 'requested') && !visits.length)
    return `
      <div class="followup-offer is-done">
        <h3><span class="fu-tick" aria-hidden="true">✓</span> Paid — your appointment is on my desk.</h3>
        <p>I confirm every appointment personally. You'll hear from me shortly,
          and if I can't make it, every dollar comes straight back.</p>
      </div>`;
  if (p?.state === 'requested') return `
    <div class="followup-offer">
      <h3>Appointment advocacy — waiting on my confirmation</h3>
      <p><strong>${esc(fmt.format(toDate(p.when)))}</strong> · ${esc(p.clinicName || '')}${p.provider ? ` · ${esc(p.provider)}` : ''}</p>
      <p class="dim small">I confirm every appointment personally. If I can't
        make it${p.paidCents ? ', your payment comes back in full' : ''}.</p>
      ${upcoming}
    </div>`;
  if (p?.state === 'checkout' && p.url && toDate(p.expiresAt).getTime() > Date.now()) return `
    <div class="followup-offer">
      <h3>Your appointment advocacy checkout is still open</h3>
      <p>Pick up where you left off, or ignore this and it expires on its own.</p>
      <div class="fu-buy"><a class="btn glow" href="${esc(p.url)}">Finish that</a></div>
    </div>`;

  if (c.status === 'closed') return '';
  const denied = c.telehealthDenied && !visits.length ? `
    <p class="dim small" style="margin:0 0 .6rem;">I couldn't make your last
      request${Number(c.telehealthDenied.refundCents) > 0 ? ' — your refund is on its way' : ''}.
      You're welcome to ask again for another appointment.</p>` : '';
  const price = c.fullAccess
    ? '<span class="price" style="font-size:1rem;">Included</span>'
    : `<span class="price">$${(TELEHEALTH_PRICE_CENTS / 100).toFixed(0)}</span>`;
  return `
    <div class="followup-offer">
      <h3>Bring me to your appointment ${helpButton('telehealth', 'What appointment advocacy is, and the ground rules')}</h3>
      <p>Have a telehealth visit coming up? I join it with you by video and
        advocate on your behalf, live — the questions get asked, the answers
        get written down, and you are not in that room alone.</p>
      ${denied}${upcoming}
      <div style="margin:.6rem 0 0;">
        <label class="dim small" style="display:block; margin-bottom:.4rem;">When is the appointment? <span style="color:var(--magenta)">*</span>
          <input type="datetime-local" data-th-when style="display:block; width:100%; margin-top:.2rem;"></label>
        <label class="dim small" style="display:block; margin-bottom:.4rem;">Clinic <span style="color:var(--magenta)">*</span>
          <input type="text" data-th-clinic maxlength="200" placeholder="e.g. Riverside Neurology" style="width:100%; margin-top:.2rem;"></label>
        <label class="dim small" style="display:block; margin-bottom:.5rem;">Provider we're seeing <span style="color:var(--magenta)">*</span>
          <input type="text" data-th-provider maxlength="200" placeholder="e.g. Dr. Alvarez" style="width:100%; margin-top:.2rem;"></label>
        <label class="agreement-check" style="margin:.2rem 0 .6rem;">
          <input type="checkbox" data-th-attest> I am inviting my advocate into my appointment, and I'll tell my provider's office he is joining.</label>
      </div>
      <div class="fu-buy">
        ${price}
        <button class="btn glow" data-th-request>${c.fullAccess ? 'Request it' : 'Pay and request'}</button>
      </div>
      <p class="fu-fine">${c.fullAccess
        ? 'Included in your Hands-Off Case Management. I confirm every appointment personally.'
        : 'I confirm every appointment personally. If I can\'t attend, or your provider doesn\'t allow it, you get every dollar back.'}
        I never record your provider's visit — my role on that screen is notes and advocacy only.</p>
      <p class="error" data-th-error hidden></p>
    </div>`;
}

function wireTelehealthCard(el, c) {
  wireHelp(el);
  const btn = el.querySelector('[data-th-request]');
  if (!btn) return;
  const errEl = el.querySelector('[data-th-error]');
  const say = (m) => { errEl.textContent = m; errEl.hidden = !m; };
  btn.addEventListener('click', async () => {
    say('');
    const whenRaw = el.querySelector('[data-th-when]')?.value || '';
    const when = whenRaw ? new Date(whenRaw) : null;
    const clinicName = (el.querySelector('[data-th-clinic]')?.value || '').trim();
    const provider = (el.querySelector('[data-th-provider]')?.value || '').trim();
    const attest = el.querySelector('[data-th-attest]')?.checked;
    if (!when || Number.isNaN(when.getTime())) return say('Pick the date and time of your appointment.');
    if (!clinicName) return say('Name the clinic.');
    if (!provider) return say("Name the provider we'll be seeing.");
    if (!attest) return say('Tick the box - it is your invitation, and your provider will want to know.');
    btn.disabled = true;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/telehealth', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          caseId: c.id, when: when.toISOString(), clinicName, provider, attestAt: Date.now(),
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `Couldn't send that (${res.status})`);
      if (out.url) { location.assign(out.url); return; }
      // Tier: requested directly. Repaint into the waiting state.
      el.innerHTML = telehealthCard({ ...c, pendingTelehealth: {
        state: 'requested', when, clinicName, provider, paidCents: 0,
      } });
      wireTelehealthCard(el, c);
    } catch (err) {
      say(err.message);
      btn.disabled = false;
    }
  });
}

function justBoughtFollowUp() {
  return new URLSearchParams(location.search).get('followup') === '1';
}

function followUpOffer(c) {
  // Straight back from Stripe. The webhook may not have landed yet, so say
  // thank you from the URL rather than from a flag that might still be false
  // for another second.
  if (new URLSearchParams(location.search).get('followup') === '1' && !c.followUp)
    // The same card, resolved. Not a second, louder box shouting at somebody
    // who has just paid: a small tick and the two things they need to know.
    return `
      <div class="followup-offer is-done">
        <h3><span class="fu-tick" aria-hidden="true">✓</span> Your follow-up is reserved.</h3>
        <p>I'll message you in chat to schedule it. Use your session anytime
          within the next 30 days.</p>
      </div>`;
  if (c.addOnFollowUp || c.followUp || c.pendingExtra) return '';
  if (!['awaiting_report', 'delivered', 'closed'].includes(c.status)) return '';
  // With a dollar sign. Every other price in the product carries one, and a
  // bare "75" beside a button, wrapped onto its own line on a narrow phone, is
  // seventy-five of nothing.
  const price = `$${followUpPrice(c).toFixed(0)}`;
  // Copy is Eric's, word for word (2026-08-20). Do not paraphrase it.
  return `
    <div class="followup-offer">
      <h3>Want to go deeper?</h3>
      <p>Once you've had time to read your report, come back for a full
        follow-up session to dig into what it raised, what's changed, and where
        to go next.</p>
      <p class="fu-emphasis">Same case. Same file. No starting over.</p>
      <div class="fu-buy">
        <span class="price">${price}</span>
        <button class="btn glow" data-buy-followup>Book a follow-up</button>
      </div>
      <p class="fu-fine">Use your follow-up within 30 days of purchase. I'll
        message you in chat to find a time.</p>
      <p class="error" data-followup-error hidden></p>
    </div>`;
}

/**
 * Moving an open case up to Full Access. Same shape as the follow-up offer
 * because it is the same kind of thing: something sold from inside a case
 * that is already running, to somebody who has already met him.
 *
 * The price shown is the difference, not the list price. They have already
 * paid for the case part and should never be asked for it twice.
 */
/**
 * What upgrading THIS case costs, in cents: the live tier price less what the
 * case has already paid toward it. One helper so the card and the checkout
 * POST cannot quote different numbers - which is the whole point of the
 * handshake below.
 */
function upgradeQuoteCents(c) {
  return Math.max(100, fullAccessPrice() - (Number(c.caseRateCents) || 0));
}

function upgradeOffer(c) {
  if (new URLSearchParams(location.search).get('upgraded') === '1' && !c.fullAccess)
    return `
      <div class="followup-offer is-done">
        <h3><span class="fu-tick" aria-hidden="true">\u2713</span> Hands-Off Case Management is open on your case.</h3>
        <p>There is an authorisation waiting for you on this page. Nothing can
          start until it is signed, so it is the one thing I need from you now.</p>
      </div>`;
  if (c.fullAccess || c.status === 'closed') return '';
  // Not offered while a checkout for it is already live: two payable links
  // for the same thing is how somebody pays twice.
  if (c.pendingFullAccess?.url) return `
    <div class="followup-offer">
      <h3>Your Hands-Off checkout is still open</h3>
      <p>Pick up where you left off, or ignore this and it expires on its own.</p>
      <div class="fu-buy">
        <a class="btn glow" href="${esc(c.pendingFullAccess.url)}">Finish that</a>
      </div>
    </div>`;
  const diff = Math.max(1, Math.round(upgradeQuoteCents(c) / 100));
  return `
    <div class="followup-offer">
      <h3>Want me to deal with them directly?</h3>
      <p>Right now I work beside you: I read everything, we talk it through,
        and you carry it to your doctors and your insurer. Hands-Off Case Management is where
        I do that part myself. I speak to your clinics, with you on the line or
        under your written authorisation, and I write and file your insurance
        appeals.</p>
      <p class="fu-emphasis">Same case. Same file. I just stop handing it back to you.</p>
      <details class="agreement" data-id="${esc(FULL_ACCESS_TERMS.id)}">
        <summary>
          <span class="agreement-title">${esc(FULL_ACCESS_TERMS.title)}</span>
          <span class="agreement-plain">${esc(FULL_ACCESS_PLAIN)}</span>
        </summary>
        <div class="agreement-body">${FULL_ACCESS_TERMS.body}</div>
        <label class="agreement-check">
          <input type="checkbox" data-upgrade-ack disabled> I have read and acknowledge this
        </label>
      </details>
      <div class="fu-buy">
        <span class="price">$${diff}</span>
        <button class="btn glow" data-buy-upgrade disabled>Upgrade this case</button>
      </div>
      <p class="fu-fine">That is the difference between what you have already
        paid and the Hands-Off price. Open the note above first: it is the
        whole of what I do, what I need from you, and where it stops, and the
        button unlocks once you have read it through.</p>
      <p class="error" data-upgrade-error hidden></p>
    </div>`;
}

function wireUpgradeOffer(el, c) {
  const btn = el.querySelector('[data-buy-upgrade]');
  if (!btn) return;
  const errEl = el.querySelector('[data-upgrade-error]');

  // Proof of exposure, exactly as booking does it (book.js): the box unlocks
  // only once the note has been opened AND scrolled to its end, and the buy
  // button only once the box is ticked. Never measured while closed - a
  // hidden body reads 0/0 and would unlock for free.
  const det = el.querySelector('details.agreement');
  const body = det?.querySelector('.agreement-body');
  const box = el.querySelector('[data-upgrade-ack]');
  let ackAt = 0;
  if (det && body && box) {
    const checkScrolled = () => {
      if (!det.open) return;
      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 8) box.disabled = false;
    };
    body.addEventListener('scroll', checkScrolled);
    det.addEventListener('toggle', () => { if (det.open) requestAnimationFrame(checkScrolled); });
    box.addEventListener('change', () => {
      // The timestamp is the moment the box is ticked; the Worker stores it
      // on the case beside the three booking acknowledgments.
      ackAt = box.checked ? Date.now() : 0;
      btn.disabled = !ackAt;
    });
  } else {
    btn.disabled = false;
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    errEl.hidden = true;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/upgrade', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        // The number the card is SHOWING, so a stale one is refused rather
        // than silently charged. The card paints once from a compiled-in
        // price and a fire-and-forget /api/rates; with that fetch slow or
        // failing, and the ratchet having moved the tier, Stripe would have
        // taken a different figure from the one he read. Booking has had this
        // handshake since the $150 experiment; the upgrade never did.
        body: JSON.stringify({
          caseId: c.id,
          quotedCents: upgradeQuoteCents(c),
          acks: { [FULL_ACCESS_TERMS.id]: ackAt },
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (res.status === 409 && out.error === 'full-booked') {
        errEl.textContent = 'I am at capacity for this right now and cannot take another one honestly. Ask me in chat and I will tell you when a place opens.';
        errEl.hidden = false;
        btn.disabled = true;
        return;
      }
      if (!res.ok || !out.url) throw new Error(out.error || `Couldn't start that (${res.status})`);
      location.assign(out.url);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      // Back to whatever the gate says, not unconditionally open: a failed
      // attempt must not become the way past the scope note.
      btn.disabled = !!(det && body && box) && !ackAt;
    }
  });
}

function wireFollowUpOffer(el, c) {
  const btn = el.querySelector('[data-buy-followup]');
  if (!btn) return;
  const errEl = el.querySelector('[data-followup-error]');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    errEl.hidden = true;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/followup', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ caseId: c.id }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.url) throw new Error(out.error || `Couldn't start that (${res.status})`);
      // Stripe, in this tab: coming back is a normal page load, and the case
      // reads the flag the webhook set.
      location.assign(out.url);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      btn.disabled = false;
    }
  });
}

/** "Thank you for your input", which fades in and then drifts away on its own. */
function thankYou(host) {
  host.innerHTML = '<p class="thanks" role="status">Thank you for your input</p>';
  const el = host.querySelector('.thanks');
  // The class drives a CSS animation that ends at opacity 0; removing the node
  // afterwards keeps an invisible paragraph from holding the layout open.
  setTimeout(() => { host.innerHTML = ''; host.hidden = true; }, 4200);
  void el;
}

async function uploadFiles(c, el, files) {
  const bar = el.querySelector('[data-progress]');
  const err = el.querySelector('[data-upload-error]');
  const zone = el.querySelector('[data-drop]');
  err.hidden = true;
  let uploaded = 0;
  const names = [];
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      err.textContent = `${file.name} is over 25 MB. Compress it or split it up.`;
      err.hidden = false;
      continue;
    }
    // Their words, asked for once, while they still remember what it is.
    // Skipping keeps the original name; the upload never depends on this.
    const named = await askName(file);
    names.push(named);
    zone.classList.add('busy');
    bar.hidden = false;
    const task = uploadBytesResumable(
      ref(storage, `cases/${c.id}/uploads/${Date.now()}-${safeName(named)}`), file);
    try {
      await new Promise((resolve, reject) => {
        task.on('state_changed',
          (snap) => { bar.value = (snap.bytesTransferred / snap.totalBytes) * 100; },
          reject, resolve);
      });
      uploaded++;
    } catch (e) {
      err.textContent = `Upload of ${file.name} failed: ${e.message}`;
      err.hidden = false;
    }
  }
  zone.classList.remove('busy');
  bar.hidden = true;
  el.querySelector('[data-file-input]').value = '';
  refreshFiles(c, el);

  // Tell the Worker a file landed. This page uploads straight to Storage and
  // otherwise leaves no trace on the server at all, so without this nothing
  // knows to go and look until the next time the case is opened on the other
  // side. Fire and forget: the upload has already succeeded, and a failed
  // nudge only costs a delay.
  if (uploaded) {
    try {
      const idToken = await user.getIdToken();
      await fetch('/api/uploaded', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ kind: 'case', id: c.id, names: names.slice(0, 10) }),
      });
    } catch { /* it will be found on the next pass regardless */ }
  }
}

// ---- actions ----

async function makePrivate(caseId, btn) {
  btn.disabled = true;
  try {
    const idToken = await user.getIdToken();
    const res = await fetch('/api/make-private', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ caseId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not update.');
    boot();
  } catch (err) {
    btn.disabled = false;
    alert(err.message);
  }
}

function downloadIcs(c, start) {
  const end = new Date(start.getTime() + (c.appointment.durationMin || 60) * 60_000);
  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z/, 'Z');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pocket Advocate//EN',
    'BEGIN:VEVENT',
    `UID:${c.id}@pocket-advocate`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    'SUMMARY:Pocket Advocate: your advocacy discussion',
    `DESCRIPTION:Method: ${c.appointment.method}. Details on your case page.`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
  a.download = 'pocket-advocate.ics';
  a.click();
}

// ---- utils ----

function toDate(v) {
  if (!v) return new Date(0);
  if (v.toDate) return v.toDate();
  return new Date(v);
}
function prettySize(bytes) {
  if (!bytes) return '';
  if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes > 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/**
 * The authorisations, on the client's own case page. Two documents, because
 * they do two different legal jobs: one lets a clinic release records to
 * Eric, the other lets Eric argue with the insurer. Signing one does not
 * grant the other, and clients conflate them constantly, so they are two
 * cards with two buttons and never a single "I agree".
 *
 * Everything is Worker-mediated: the records live under the case's private
 * subtree, which the browser cannot read or write directly by rule.
 */
async function mountAuthority(host, c) {
  const paint = (items) => {
    const signed = (kind) => items.find((i) => i.kind === kind && !i.revokedAt);
    const rep = signed('representative');
    const recs = items.filter((i) => i.kind === 'records' && !i.revokedAt);
    host.innerHTML = `
      <div class="panel authority" data-auth-panel>
        <h3>What I need signed</h3>
        <p class="dim small">Nothing on your case can start until these are in
          place. They are two separate permissions, and you can withdraw either
          one at any time.</p>

        <div class="auth-row">
          <div class="auth-head">
            <strong>Your clinics</strong>
            ${recs.length
              ? `<span class="auth-on">✓ ${recs.length} signed</span>`
              : '<span class="auth-off">Not signed</span>'}
          </div>
          <p class="dim small">Lets a clinic release your records to me. One for
            each clinic or hospital I need records from.</p>
          ${recs.map((r) => `
            <p class="auth-item">
              <span>${esc(r.clinicName || 'Clinic')}<span class="dim small"> · signed ${new Date(r.signedAt).toLocaleDateString()}</span></span>
              <span class="auth-item-acts">
                <button type="button" class="btn ghost tiny" data-auth-view="${esc(r.id)}">View</button>
                <button type="button" class="btn ghost tiny" data-auth-revoke="${esc(r.id)}">Withdraw</button>
              </span>
            </p>`).join('')}
          <p><button class="btn${recs.length ? ' ghost' : ' glow'}" data-auth-add="records">
            ${recs.length ? 'Add another clinic' : 'Sign a records authorisation'}</button></p>
        </div>

        <div class="auth-row">
          <div class="auth-head">
            <strong>Your insurer</strong>
            ${rep ? '<span class="auth-on">✓ Signed</span>' : '<span class="auth-off">Not signed</span>'}
          </div>
          <p class="dim small">Lets me file appeals and speak to your plan on
            your behalf. It is not a power of attorney and it is not legal
            representation.</p>
          ${rep ? `
            <p class="auth-item">
              <span>${esc(rep.planName || 'Your plan')}<span class="dim small"> · signed ${new Date(rep.signedAt).toLocaleDateString()}</span></span>
              <span class="auth-item-acts">
                <button type="button" class="btn ghost tiny" data-auth-view="${esc(rep.id)}">View</button>
                <button type="button" class="btn ghost tiny" data-auth-revoke="${esc(rep.id)}">Withdraw</button>
              </span>
            </p>` : `
            <p><button class="btn glow" data-auth-add="representative">Sign the insurance form</button></p>`}
        </div>
        <p class="error" data-auth-error hidden></p>
      </div>`;

    for (const b of host.querySelectorAll('[data-auth-add]'))
      b.addEventListener('click', () => openAuthoritySheet(c, b.dataset.authAdd, load));
    for (const b of host.querySelectorAll('[data-auth-view]'))
      b.addEventListener('click', () => printAuthority(c, items.find((i) => i.id === b.dataset.authView)));
    for (const b of host.querySelectorAll('[data-auth-revoke]')) {
      b.addEventListener('click', async () => {
        if (!confirm('Withdraw this authorisation? I will stop using it straight away. It cannot undo anything already sent to me under it.')) return;
        b.disabled = true;
        try {
          const idToken = await user.getIdToken();
          const res = await fetch('/api/authority', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
            body: JSON.stringify({ caseId: c.id, action: 'revoke', id: b.dataset.authRevoke }),
          });
          if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed');
          load();
        } catch (err) {
          const e = host.querySelector('[data-auth-error]');
          e.textContent = err.message;
          e.hidden = false;
          b.disabled = false;
        }
      });
    }
  };

  async function load() {
    try {
      const idToken = await user.getIdToken();
      const res = await fetch(`/api/authority?caseId=${encodeURIComponent(c.id)}`, {
        headers: { authorization: `Bearer ${idToken}` },
      });
      paint(res.ok ? ((await res.json()).items || []) : []);
    } catch {
      paint([]); // an unreachable list still shows the two buttons
    }
  }
  load();
}

/** The signing sheet. Same overlay furniture as everything else on this page. */
function openAuthoritySheet(c, kind, onDone) {
  const isRecords = kind === 'records';
  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-card" role="dialog" aria-modal="true" aria-label="Sign">
      <h3 style="margin:0 0 .3rem;">${isRecords ? 'Records authorisation' : 'Insurance representative'}</h3>
      <p class="dim small" style="margin:0 0 .8rem;">${isRecords
        ? 'One clinic per form. Fill in what you know; I can chase the rest.'
        : 'This lets me deal with your plan about your claims and appeals.'}</p>
      ${isRecords ? `
        <label class="dim small">Clinic or hospital name
          <input type="text" data-f="clinicName" maxlength="200" placeholder="e.g. Valley Neurology"></label>
        <label class="dim small">Their address, if you have it
          <input type="text" data-f="clinicAddress" maxlength="400"></label>
        <label class="dim small">Their phone, if you have it
          <input type="tel" data-f="clinicPhone" maxlength="40"></label>
        <div class="row" style="gap:.5rem;">
          <label class="dim small" style="flex:1;">Records from
            <input type="date" data-f="fromDate"></label>
          <label class="dim small" style="flex:1;">Through
            <input type="date" data-f="toDate"></label>
        </div>
        <p class="dim small" style="margin:.8rem 0 .3rem;">Some records need your
          specific permission and are left out unless you tick them. Nothing here
          is required, and leaving one unticked never stops the rest.</p>
        ${SENSITIVE_CATEGORIES.map((cat) => `
          <label class="agreement-check" style="align-items:flex-start;">
            <input type="checkbox" data-cat="${cat.id}">
            <span><strong>${esc(cat.label)}</strong><br><span class="dim small">${esc(cat.note)}</span></span>
          </label>`).join('')}
      ` : `
        <label class="dim small">Insurance plan or company
          <input type="text" data-f="planName" maxlength="200" placeholder="e.g. Blue Cross of Arizona"></label>
        <label class="dim small">Member or policy ID
          <input type="text" data-f="memberId" maxlength="80"></label>
      `}
      <details class="agreement" style="margin:.9rem 0 .6rem;">
        <summary><span class="agreement-title">Read the whole form</span></summary>
        <div class="agreement-body"><pre class="auth-doc" data-preview></pre></div>
      </details>
      <label class="dim small">Type your full name to sign
        <input type="text" data-f="signedName" maxlength="120" placeholder="${esc(c.clientName || 'Your full name')}"></label>
      <p class="dim small" style="margin:.4rem 0 0;">Typing your name here is your
        signature. The date and time are recorded when you press Sign.</p>
      <p class="error" data-sheet-error hidden></p>
      <div class="actions">
        <button class="btn quiet" data-x>Cancel</button>
        <button class="btn glow" data-sign>Sign</button>
      </div>
    </div>`;

  const val = (name) => overlay.querySelector(`[data-f="${name}"]`)?.value.trim() || '';
  const cats = () => [...overlay.querySelectorAll('[data-cat]:checked')].map((i) => i.dataset.cat);
  const preview = overlay.querySelector('[data-preview]');
  const repaint = () => {
    const o = {
      clientName: c.clientName, clientDob: c.clientDob,
      clinicName: val('clinicName'), clinicAddress: val('clinicAddress'),
      fromDate: val('fromDate'), toDate: val('toDate'),
      planName: val('planName'), memberId: val('memberId'),
      categories: cats(), signedName: val('signedName'),
    };
    preview.textContent = isRecords ? recordsAuthorisation(o) : representativeDesignation(o);
  };
  overlay.addEventListener('input', repaint);
  overlay.addEventListener('change', repaint);
  repaint();

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-x]').addEventListener('click', close);
  overlay.querySelector('[data-sign]').addEventListener('click', async () => {
    const btn = overlay.querySelector('[data-sign]');
    const err = overlay.querySelector('[data-sheet-error]');
    btn.disabled = true;
    err.hidden = true;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/authority', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          caseId: c.id, kind,
          signedName: val('signedName'),
          clinicName: val('clinicName'), clinicAddress: val('clinicAddress'),
          clinicPhone: val('clinicPhone'),
          fromDate: val('fromDate'), toDate: val('toDate'),
          planName: val('planName'), memberId: val('memberId'),
          categories: cats(),
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `Couldn't sign that (${res.status})`);
      close();
      onDone?.();
    } catch (e2) {
      err.textContent = e2.message;
      err.hidden = false;
      btn.disabled = false;
    }
  });
  document.body.appendChild(overlay);
  overlay.querySelector('[data-f]')?.focus();
}

/**
 * A paper copy, on demand, for either side. Same window.open + print pattern
 * the case export and the prep sheet already use; there is no PDF library in
 * this stack and none is being added for this.
 */
function printAuthority(c, item) {
  if (!item) return;
  const o = {
    ...item,
    clientName: c.clientName, clientDob: c.clientDob,
    advocateName: 'Eric Bleach',
  };
  const text = item.kind === 'records' ? recordsAuthorisation(o) : representativeDesignation(o);
  const win = window.open('', '_blank');
  if (!win) {
    alert('Your browser blocked the print window. Allow pop-ups for this site and try again.');
    return;
  }
  win.document.write(`<!doctype html><html><head><meta charset="utf-8">
    <title>${item.kind === 'records' ? 'Records authorisation' : 'Insurance representative'}</title>
    <style>
      @page { margin: 16mm; }
      body { font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; color: #000; }
      pre { white-space: pre-wrap; word-wrap: break-word; margin: 0; }
    </style></head><body><pre>${text.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))}</pre></body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 350);
}
