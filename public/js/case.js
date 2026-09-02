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
import { helpButton, wireHelp, openCaseHelp } from './help.js';
import { GOOGLE_REVIEW_WRITE_URL } from './reviews-config.js';
import { officeCueHtml } from './office.js';
import { startNightShift } from './night-shift.js';
startNightShift();
import {
  recordsAuthorisation, representativeDesignation, SENSITIVE_CATEGORIES,
  COMMUNICATION_SCOPES, AUTHORITY_KINDS,
} from './authority.js';
import { FULL_ACCESS_TERMS, FULL_ACCESS_PLAIN } from './tier-terms.js';
import { wireAboutButtons } from './service-about.js';
import { handsOffReadiness, handsOffStartsLater } from './readiness.js';
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
  //
  // MOUNTED AT THE FOOT OF THE PAGE (2026-08-26). The guide prepends its
  // standing "Finish setup" reminder to whatever it is handed, and it was
  // handed <main>, so a nudge about installing the app to a home screen sat
  // above the page's own heading and above the case. It is a reminder about
  // this device, not news about this case. Same component, same words,
  // untouched: only the host it is given has changed.
  const setupHost = document.createElement('div');
  const mainEl = document.querySelector('main');
  mainEl?.insertBefore(setupHost, mainEl.querySelector('.footer-disclaimer'));
  initSetupGuide(user, setupHost);
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

  // NOTHING ABOVE THE TABS ANY MORE (2026-08-26).
  //
  // This page used to open with a case picker, a title, a "?" dot, a status
  // badge, a navigation hint and a payment banner stacked above the tab strip,
  // all at roughly one weight, before a frightened person reached a single
  // fact about their own case. Twenty-two things on one phone screen.
  //
  // The title and the badge moved INTO the appointment card, which is the one
  // thing the page is for; the picker moved below the folder, because
  // switching cases is rare and almost nobody has two; the "?" became a
  // labelled button at the foot of the first page rather than a glyph. Nothing
  // was deleted. All of it is one scroll or one tap away.
  container.innerHTML = `
    <div data-folder></div>
    <div data-page-footer></div>`;

  wireHelp(container);

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
      // A DIAMOND, NOT A PLUS (Eric, 2026-08-26: "enhancements need to be
      // their own shiny special diamond category. It's so plain Jane with a
      // gray cross"). A grey + is the language of a form, "add a row". This is
      // the only tab on the page where anything is offered, so it is also
      // styled apart from its four neighbours in glowup.css rather than being
      // one more identical pill.
      { id: 'addons', title: 'Enhance', icon: '💎', render: (pane) => renderAddons(pane, c) },
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
 *
 * MOVED 2026-08-26, from a two-part block above the tab strip to a single
 * dismissible line at the FOOT of the first page. The words are Eric's and
 * are unchanged. It used to be the first thing on the screen, above the fact
 * that the case exists, and it is one tap from gone forever, so it had no
 * business there. At the foot of page one it lands exactly where somebody
 * finishes reading and wonders whether that is all there is - and the tabs it
 * describes are still on screen above it.
 */
const NAV_HINT_KEY = 'pa-seen-nav-hint';

function navHint(host) {
  if (!host) return;
  try { if (localStorage.getItem(NAV_HINT_KEY)) return; } catch { return; }
  const note = document.createElement('p');
  note.className = 'nav-hint';
  // Tabs first, swipe second, and those are now the only two: tap-to-turn was
  // removed on 2026-08-25 because an idle click in the middle of a page threw
  // you onto a different one. This copy never advertised it, so the words
  // below are unchanged.
  note.innerHTML = 'Your case has tabs. Tap one to switch pages, or swipe '
    + 'left and right to move between them. '
    + '<button type="button" class="btn ghost pill" data-hint-ok>Got it</button>';
  host.append(note);
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
  // authorisation buttons that used to sit under the timeline.
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
 *
 * It used to be a panel of its own, a second heavy box between the tabs and
 * the date. It is a line inside the appointment card now: same sentence, same
 * amount, small print under the time it is confirming. "You're booked for
 * <date>" went because the date is the headline of that card, and the emailed
 * copy and the labs and imaging moved into the fold below, because that is
 * what those sentences are.
 */
function confirmedLine(c) {
  if (c.status === 'closed') return '';
  const paid = paidShownCents(c);
  // Grouped. This used to be toFixed(2) with the trailing zeroes trimmed,
  // which reads fine for the $175 it was only ever given and prints "$3400"
  // the moment a four-figure total reaches it. A missing comma on the one
  // number a client checks is not a rounding detail.
  const amount = typeof paid === 'number'
    ? `, $${(paid / 100).toLocaleString('en-US', {
      minimumFractionDigits: paid % 100 ? 2 : 0,
      maximumFractionDigits: paid % 100 ? 2 : 0,
    })} received`
    : '';
  return `Payment confirmed${amount}`;
}

/**
 * The whole of what this case has paid, for the line above.
 *
 * It used to read the card charge and nothing else. On a case where the money
 * arrived another way, or where more was agreed later, that made this line
 * understate the work by a wide margin: the hours below say seventeen and
 * three quarters, and anyone doing the division against a first booking gets
 * an answer that is nothing like the truth. So the figure here is the same
 * one the case itself records.
 *
 * In order of how much the source knows, and it REFUSES to guess. Nothing is
 * inferred from a price list: a case with none of these on it shows no amount
 * at all, which is what this line did before whenever the charge was missing.
 * Follow-ups, sessions and tips are separate purchases with their own
 * receipts and are not folded in here.
 */
function paidShownCents(c) {
  const recorded = Number(c?.paidOverrideCents);
  if (recorded > 0) return recorded;
  const tier = Number(c?.fullAccessRateCents);
  if (c?.fullAccess && tier > 0) return tier;
  const charged = Number(c?.stripe?.amountTotal);
  return charged > 0 ? charged : null;
}

/**
 * THE HOURS CARD, front and center on a Full-Service case (Eric, 2026-08-29:
 * "the client needs to be aware when I'm reaching my hours rough limit and
 * that I pace my work to be most efficient and not waste time. Front and
 * center."). It sits directly under the appointment card, not inside any
 * fold: the Full-Service clock against the month's included hours, a warmer
 * note as the rough limit nears, and the pacing sentence standing whether
 * or not anything is near anything.
 *
 * The thresholds are a pure function so the suite can lift and run them:
 * "close" from 80% of the low end of the envelope, "limit" from the high
 * end. A fulfillment marker, not a meter (Eric, 2026-09-01: "I want them to
 * know I've fulfilled my obligation for the month"): it moves when he clocks
 * out, never live, and past the included hours it says the work continues at
 * no extra charge.
 */
// KEEP IN STEP with FULL_INCLUDED_HOURS in the Worker; pricing.mjs pins the
// two equal. Eric, 2026-09-02 (cap-and-raise): 20 included hours, stated
// plainly, and past them the work continues at no extra charge.
const FULL_INCLUDED_HOURS = 20;
function hoursState(usedSec, months) {
  const m = Math.max(1, Math.floor(Number(months) || 1));
  if (usedSec >= m * FULL_INCLUDED_HOURS * 3600) return 'limit';
  if (usedSec >= 0.8 * m * FULL_INCLUDED_HOURS * 3600) return 'close';
  return 'ok';
}
function hoursCard(c) {
  if (!c.fullAccess || c.status === 'closed') return '';
  const w = c.work || {};
  const mark = Math.max(0, Number(w.tierMark) || 0);
  const banked = Math.max(0, (Number(w.seconds) || 0) - mark);
  // Banked time only: the card moves when he clocks out, never while the
  // clock runs, so it never reads as a meter ticking against the client.
  const used = banked;
  const months = Math.max(1, Math.floor(Number(c.fullAccessMonths) || 1));
  const state = hoursState(used, months);
  const includedH = months * FULL_INCLUDED_HOURS;
  const doneH = Math.floor(used / 3600);
  const fmt = (secs) => {
    const h = Math.floor(secs / 3600);
    const m2 = Math.floor((secs % 3600) / 60);
    return `${h ? `${h}h ` : ''}${m2}m`;
  };
  const pct = Math.min(100, Math.round((used / (includedH * 3600)) * 100));
  // The three sentences, Eric's choices (2026-09-01).
  const span = state !== 'limit'
    ? `Included hours: ${doneH} of ${includedH} delivered.`
    : doneH > includedH
      ? `${doneH} hours: ${doneH - includedH} beyond what your month includes, at no extra charge.`
      : `The ${includedH} hours included in your month are delivered. ✓ Work continues.`;
  const note = state === 'limit'
    ? 'Beyond the included hours the work carries on at no extra charge. If a month ever needs a great deal more, we talk first, exactly as your agreement says.'
    : state === 'close'
      ? 'We are getting close to the included hours. Past them the work carries on at no extra charge.'
      : '';
  return `
    <section class="card hours-card${state === 'ok' ? '' : ` is-${state}`}" data-hours-card>
      <p class="eyebrow">YOUR MONTH'S HOURS</p>
      <p class="hours-line"><strong style="color:var(--ink);">${fmt(used)}</strong> used${
  w.startedAt ? ' <span style="color:var(--cyan);">· working on it right now</span>' : ''
}</p>
      <div class="hours-meter" role="img" aria-label="${fmt(used)} of the ${includedH} included advocacy hours delivered"><span style="width:${pct}%;"></span></div>
      <p class="dim small" style="margin:0;">${span}</p>
      ${note ? `<p class="small hours-note" style="margin:.4rem 0 0;"><strong>${note}</strong></p>` : ''}
      <p class="dim small" style="margin:.4rem 0 0;">I pace this work to be as
        efficient as possible with your hours: nothing is padded, and no time
        is wasted.</p>
      ${mark >= 60 ? `<p class="dim small" style="margin:.4rem 0 0;">Your case review's ${fmt(mark)} came with the case and is not counted here.</p>` : ''}
    </section>`;
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
  // TWO CLOCKS, TWO TIERS (Eric, 2026-08-29). Everything up to work.tierMark
  // was the case review; the running figure is the current tier's own clock,
  // so a Full-Service month never opens looking half spent. The review hours
  // are not hidden - they get their own line - they are just not this clock.
  const mark = Math.max(0, Number(w.tierMark) || 0);
  const banked = Math.max(0, (Number(w.seconds) || 0) - mark);
  const live = w.startedAt
    ? Math.min(Math.floor((Date.now() - toDate(w.startedAt).getTime()) / 1000), 12 * 3600)
    : 0;
  const total = banked + live;
  if (total < 60 && mark < 60) return '';
  const fmt = (secs) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return `${h ? `${h}h ` : ''}${m}m`;
  };
  const main = total >= 60 || mark < 60
    ? `<p class="dim small" style="margin:.6rem 0 0;">⏱ Time I have worked on your case${
      mark >= 60 ? ' since Full-Service began' : ''}: <strong style="color:var(--ink);">${fmt(total)}</strong>${
      w.startedAt ? ' <span style="color:var(--cyan);">· working on it right now</span>' : ''
    }</p>` : '';
  const review = mark >= 60
    ? `<p class="dim small" style="margin:.2rem 0 0;">⏱ During your case review: <strong style="color:var(--ink);">${fmt(mark)}</strong></p>`
    : '';
  return main + review;
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
        would like to leave a review, that stays open too, here or
        <a href="${GOOGLE_REVIEW_WRITE_URL}" target="_blank" rel="noopener noreferrer">on Google</a>.</p>
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
    check-in calls at least twice a month. They are part of the service, so
    we never go long without speaking. None is on the books right now, so
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
  // ONE primary action, and it is whichever one the moment calls for. Joining
  // the call beats saving the date; with no link to join, saving the date is
  // the only thing there is to do, and it becomes the primary. When both
  // exist the calendar link keeps its full-width button (Eric, 2026-08-21:
  // "make the hyperlink section text larger... line it up.") but sits inside
  // the fold below, so the two are no longer twins competing for one tap.
  const joinHref = method !== 'phone' && c.appointment?.joinLink ? esc(c.appointment.joinLink) : '';
  const icsHtml = start ? '<a href="#" data-ics>📅 Add to calendar</a>' : '';
  const primaryAction = joinHref
    ? `<a class="btn cta" href="${joinHref}" rel="noopener">🎥 Join the video call</a>`
    : (start ? icsHtml.replace('<a href="#"', '<a class="btn cta" href="#"') : '');
  const secondAction = joinHref && start
    ? icsHtml.replace('<a href="#"', '<a class="btn quiet pill" href="#"')
    : '';
  const requestedNote = requested
    ? `<p class="small" style="margin:.4rem 0 0; color:var(--orange);">
         <strong>Awaiting confirmation.</strong> You asked for this time and it wasn't on my
         calendar. I'll confirm it, or offer you the nearest time that works, before the date.</p>`
    : '';
  const election = c.publicElection || { choice: 'private' };
  const revocable = election.choice === 'public' && !closed &&
    (!election.revocableUntil || toDate(election.revocableUntil) > new Date());
  const confirmed = confirmedLine(c);
  // The money and the method are the same kind of fact: small print under the
  // date, in one sentence rather than two paragraphs. An eyebrow is a label,
  // and "REPORT READY ADVOCACY CASE · PAYMENT CONFIRMED, $1200 RECEIVED" set
  // in micro-caps ran to three lines and read as shouting.
  // The banner's own sentence for a requested time is kept word for word, and
  // "See below" still points at the right thing: the awaiting-confirmation
  // note is the next line inside this same card.
  const requestedIntro = requested && !closed
    ? 'Your case file is open. The time you asked for still needs my confirmation. See below.'
    : '';
  const underLine = [confirmed ? `${confirmed}.` : '', requestedIntro, methodLine]
    .filter(Boolean).join(' ');
  const stepNow = STEPS[Math.min(Math.max(rank, 1), STEPS.length) - 1][1];

  // THE WHOLE FIRST SCREEN IS ONE CARD.
  //
  // Everything a frightened person opens this page to learn is on it: that
  // the money arrived, where the case stands, when we speak, and the one
  // button worth pressing today. The timeline, the paperwork note and the
  // session settings are all still here, one line lower, folded.
  el.innerHTML = `
    <div class="stack">
    ${pausedNotice(c)}
    ${closedNotice(c)}
    <section class="card card-lit stack-tight" data-appt>
      <p class="eyebrow">
        <span class="status-pill ${closed ? 'closed' : ''}" data-status-pill>${STATUS_LABEL[c.status] || c.status}</span>
        Advocacy Case
      </p>
      ${start ? `
        <h2 class="appt-when">${mtFmt.format(start)} MST<br>
        <span class="dim small">${localFmt.format(start)} your time</span></h2>`
    : '<h2 class="appt-when">Your case is open<br><span class="dim small">No call is on the books yet.</span></h2>'}
      ${underLine ? `<p class="dim small">${underLine}</p>` : ''}
      ${primaryAction}
      ${requestedNote}
    </section>
    ${hoursCard(c)}
    ${checkInLine(c, localFmt)}
    <hr class="divide">
    <!-- ONE fold, not two. "Progress" and "Session details" were two identical
         grey boxes sitting one under the other, and a person who had just
         been told where their case stands had to guess which of them held the
         rest of it. Everything that is not the appointment is in here, in the
         order it matters: where the case is, then the detail of how it runs.
         Both data hooks stay on this one element. -->
    <details class="faq card-quiet" data-steps data-more>
      <summary>Where your case is: ${esc(stepNow)}</summary>
      <div class="faq-a">
        <ul class="timeline">
          ${STEPS.map(([, label], i) => `
            <li class="${i + 1 < rank ? 'done' : i + 1 === rank ? (closed ? 'done' : 'now') : ''}">
              <span class="t-dot"></span>${label}</li>`).join('')}
        </ul>
        ${c.fullAccess ? '' : workLine(c)}
        ${closed ? '' : '<p class="dim small">A copy is in your email. Nothing else is needed from you before the call, though labs and imaging help if you have them.</p>'}
        ${secondAction ? `<p class="back-row">${secondAction}</p>` : ''}
        <hr class="divide">
        <p class="dim small">Session: <strong style="color:${election.choice === 'public' ? 'var(--magenta)' : 'var(--cyan)'};">
          ${election.choice === 'public' ? 'PUBLIC, streams live on YouTube' : 'PRIVATE'}</strong></p>
        ${revocable ? `<p><button class="btn ghost pill" data-private>Make it private</button></p>` : ''}
        ${followUpSection(c)}
      </div>
    </details>
    <div data-worklog></div>
    <div data-authority></div>
    <hr class="divide">
    <!-- The "?" dot was a bare glyph beside a heading at the top of the page,
         and Eric could not find the things it explained. It is a labelled
         button at the foot of page one now, beside the one-time hint about
         how the folder works. -->
    <p class="back-row"><button type="button" class="btn quiet pill" data-help="case">What is kept in this file</button></p>
    <div data-nav-hint></div>
    </div>`;

  wireHelp(el);
  navHint(el.querySelector('[data-nav-hint]'));

  // Sits directly under the timeline rather than behind a tab: the client tab
  // strip is already at four and three pills barely fit a 390px phone.
  //
  // TWO PANELS IN THIS SLOT SINCE 2026-08-27, in this order. The work log is
  // what the section is now; the permissions list under it is the half of the
  // old records panel that could not be parked, because a client who has
  // already signed must always be able to read it back and withdraw it.
  //
  // On EVERY case, not just Full-Service. He works standard cases too, and the
  // log is the answer to "what has he been up to" whichever tier they are on.
  const log = el.querySelector('[data-worklog]');
  if (log) mountCaseLog(log, c);
  const auth = el.querySelector('[data-authority]');
  if (auth) mountPermissions(auth, c);

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
    <p class="office-row" style="margin:.2rem 0 .3rem;">${officeCueHtml()}</p>
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
  // The "?" beside the in/out pill. This block repaints, so it is wired here
  // and not once at page load, or the button goes dead the first time the case
  // reloads underneath it.
  wireHelp(el);
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
        // What kind of document this is, when it is one of the ones written
        // for you rather than a file either of us happened to attach. It rides
        // on the file itself, so it arrives with the metadata already being
        // fetched on this line.
        rows.push({
          kind, name: item.name, url, ts: new Date(meta.timeCreated), size: meta.size,
          path: item.fullPath, cat: meta.customMetadata?.paCategory || '',
          starred: !!meta.customMetadata?.paStarred,
          starAt: Number(meta.customMetadata?.paStarred) || 0,
          // The name it was given AFTER it landed, if it was given one. It
          // arrives on the same metadata the category does, so it costs no
          // extra request either.
          display: meta.customMetadata?.paName || '',
        });
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
  // The name a person actually reads. A Storage object's name is its identity
  // and cannot be changed (see patchObjectMeta in worker/storage.js), so a
  // file renamed after it landed carries the new name beside its bytes and it
  // is preferred here. A file nobody renamed has none and reads exactly as it
  // always did.
  const readName = (r) => r.display || shownName(r.name);
  // A file long-pressed out of the chat exists twice: once where it was
  // shared and once in their own saved folder. One row, not two.
  const seen = new Set(rows.filter((r) => r.kind === 'chat')
    .map((r) => `${shownName(r.name)}|${r.size}`));
  const deduped = rows.filter((r) => !(r.kind === 'saved' && seen.has(`${shownName(r.name)}|${r.size}`)));
  rows.length = 0;
  rows.push(...deduped);

  // The documents written for you sit directly under the report, because that
  // is what they are. KEEP THIS MAP IN STEP with UPLOAD_CATEGORIES; the two
  // are pinned equal by tools/suites/uploads.mjs.
  const CATS = {
    report: { label: 'REPORT', at: 0 },
    callsummary: { label: 'CALL SUMMARY', at: 1 },
    visitfollowup: { label: 'VISIT FOLLOW-UP', at: 2 },
    apptsummary: { label: 'APPOINTMENT', at: 3 },
    formsent: { label: 'FORM SENT', at: 4 },
    formfilled: { label: 'FILLED FORM', at: 5 },
  };
  // The categories occupy 0 to 5, so everything else starts at 6. Leaving
  // these where they were would have sorted a form in among the recordings,
  // which is the off-by-one this map invites every time it grows.
  const order = { report: 0, recording: 6, upload: 7, chat: 8, saved: 9 };
  // A CATEGORY IS A LABEL ON A FILE, AND A FILE CAN BE FILED AFTER IT LANDS.
  //
  // This used to consult the category on report/ files alone, and that was
  // right at the time: the label was stamped on at upload, so report/ was the
  // only folder a labelled file could come from. A document can now be filed
  // after the fact, so the label has to be read wherever one can legitimately
  // be written - which is exactly the set of folders the filing route accepts.
  //
  // Your own saved shelf is deliberately not in that set. It follows you
  // rather than the case, and it is yours to keep.
  const FILEABLE = new Set(['report', 'upload', 'chat', 'recording']);
  const filedCat = (r) => (FILEABLE.has(r.kind) && CATS[r.cat] ? r.cat : '');
  // A missing rank sorts LAST rather than sorting as NaN, which would put
  // every row in an arbitrary place the moment an unfamiliar category appears.
  const rank = (r) => (filedCat(r) ? CATS[filedCat(r)].at : (order[r.kind] ?? 9));
  // Starred first (Eric, 2026-08-30): a pinned file is priority, like a form
  // that needs filling, and it outranks every category.
  rows.sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0)
    || (a.starred && b.starred ? (a.starAt || 0) - (b.starAt || 0) : 0)
    || rank(a) - rank(b) || b.ts - a.ts);
  const starredCount = rows.filter((r) => r.starred).length;
  const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  // The report gets a ✅ the moment the case is delivered. It is the one file
  // they have been waiting for, and "is this the final one" should not be a
  // question they have to work out from the filename.
  //
  // THE REPORT ONLY. A call summary is filed in the same place, so a tick
  // keyed on the folder alone put "delivered" beside every document written
  // during the case and made the mark meaningless on the one file it is for.
  // Caught by looking at the client's own screen at 320px.
  const delivered = c.status === 'delivered' || c.status === 'closed';
  listEl.innerHTML = rows.map((r, i) => `
    ${starredCount && i === 0 ? '<li class="log-day">⭐ Needs your attention first</li>' : ''}
    ${starredCount && i === starredCount ? '<li class="log-day">Everything else</li>' : ''}
    <li data-frow="${i}">
      <span class="fname">${r.starred ? '⭐ ' : ''}<span class="kind-pill ${filedCat(r) || r.kind}">${
        filedCat(r) ? CATS[filedCat(r)].label
          : r.kind === 'saved' || r.kind === 'chat' ? 'FROM CHAT' : r.kind.toUpperCase()}</span>
        ${r.kind === 'report' && !r.cat && delivered ? '<span class="delivered-tick" title="Delivered" role="img" aria-label="Delivered">✅</span>' : ''}
        <a href="${r.url}" target="_blank" rel="noopener">${esc(readName(r))}</a></span>
      <span class="fmeta">${fmt.format(r.ts)} · ${prettySize(r.size)}</span>
    </li>`).join('');

  // Long-press (or right-click) a file you put here to remove it. Offered on
  // your own kinds only; the report and the recording are the case record.
  // The Worker is the authority: a chat file is only deletable when a chat
  // message of YOURS carries it. (Eric, 2026-08-22: "They should too, so
  // long as they themselves uploaded it.")
  listEl.querySelectorAll('[data-frow]').forEach((li) => {
    const r = rows[Number(li.dataset.frow)];
    // Your own files only. Everything in report/ is the case record, including
    // the documents written for you, and the record is not something either of
    // us can quietly take back.
    //
    // AND NOTHING THAT HAS BEEN FILED. A file you shared in the chat is yours
    // to take back right up until it becomes a document in the case: a filled
    // form is exactly the file this list would otherwise let you remove, and
    // it is the one nobody can afford to lose. `r.cat` and not the known-label
    // check, so a label this page does not recognise still locks the row. The
    // Worker refuses it as well; this only stops the offer being made.
    if (!r?.path || !['upload', 'chat', 'saved'].includes(r.kind) || r.cat) return;
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
  const name = r.display || String(r.name).replace(/^\d{10,}-/, '');
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
      <!-- Eric, 2026-08-28: "any request for a review gets a link to my Google
           reviews". This is the request, so this is where it goes.
           BOTH stay. The stars and the box above are private and reach only
           him, which is the only channel someone gets to say a hard thing in.
           Google is public and is what a stranger deciding whether to call him
           actually reads. Offering one instead of the other would cost him the
           half he did not choose, so the card asks for both and says plainly
           which is which. -->
      <p class="dim small google-ask" style="margin:.6rem 0 0;">Or leave it on
        Google, where anyone deciding whether to call me can read it:
        <a href="${GOOGLE_REVIEW_WRITE_URL}" target="_blank" rel="noopener noreferrer">write a Google review</a>.
        The box above comes only to me; Google is public.</p>
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
const FOLLOWUP_PRICE_CENTS = 27500;
const followUpPrice = (c) =>
  (Number(c?.addonRateCents) > 0 ? Number(c.addonRateCents) : FOLLOWUP_PRICE_CENTS) / 100;

// The Full Access list price, in CENTS, corrected from /api/rates the moment
// it answers. The upgrade card subtracts what this case already paid, so the
// number on the button is the difference and never the list price.
let fullAccessCents = 440000;
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
  // The case picker lives here now, under the folder rather than above it.
  // Almost every client has exactly one case and the newest one is already
  // open; for the few with two, switching is a thing you go looking for, not
  // a thing that should cost the first screen two buttons before the case
  // itself appears.
  if (cases.length > 1) {
    const mtFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: MOUNTAIN_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    host.insertAdjacentHTML('beforeend', `
      <hr class="divide">
      <p class="eyebrow">Your cases</p>
      <div class="case-picker">
        ${cases.map((x) => `
          <button class="chip-label pill ${x.id === currentId ? 'selected' : ''}" data-case="${x.id}">
            ${x.appointment?.start ? mtFmt.format(toDate(x.appointment.start)) : 'Case'}
            ${x.status === 'closed' ? ' · closed' : ''}
          </button>`).join('')}
      </div>`);
    host.querySelectorAll('[data-case]').forEach((b) =>
      b.addEventListener('click', () => {
        if (b.dataset.case === currentId) return;
        currentId = b.dataset.case;
        render();
      }));
  }
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
 * Every enhancement card carries its About sheet (Eric, 2026-08-25) -
 * appended after each paint, because a repaint that rebuilds a host's
 * innerHTML would otherwise silently eat the button.
 */
function addAboutButton(host, id) {
  if (!host || !host.innerHTML.trim() || host.querySelector('[data-about]')) return;
  host.insertAdjacentHTML('beforeend',
    `<p style="margin:.2rem 0 .9rem;"><button type="button" class="btn quiet tiny" data-about="${id}">About this enhancement</button></p>`);
  wireAboutButtons(host);
}

/**
 * Another month on a Full-Service case, as many times as it needs. The SAME
 * price as the first month, because it is the same thing - the tier is
 * monthly all the way down. A flat price the Worker also holds, so the
 * compiled-in number here and the number Stripe charges are the same.
 */
const EXTEND_PRICE_CENTS = 350000;
// The Worker's rule, and the Worker's numbers. These are not decoration: this
// function tells a client the date their month runs to, and until now it said
// SIXTY DAYS for every case, hardcoded, while the Worker gives a case bought
// after the monthly reshape THIRTY. The advocate's own page said thirty too.
// So a client on the current tier was shown an end date a month later than
// the one the close sweep actually enforces, on the most expensive thing the
// app sells. A case sold before the reshape really did buy sixty days and
// keeps them, which is the only reason the legacy number is still here.
const FULL_WINDOW_DAYS = 30;
const FULL_LEGACY_WINDOW_DAYS = 60;
const FULL_MONTHLY_FROM_AT = Date.parse('2026-08-26T00:00:00Z');
const FULL_WINDOW_FROM_PURCHASE_AT = Date.parse('2026-08-25T00:00:00Z');
function windowEndOf(c) {
  // Mirrors worker/index.js fullAccessWindowEnd line for line, including the
  // start it measures from: a case bought before the rule changed was sold
  // sixty days FROM THE FIRST CALL, and moving that start under a live client
  // would silently take days off something they already acknowledged.
  const bought = c?.fullAccessAt ? toDate(c.fullAccessAt).getTime() : 0;
  const firstCall = c?.appointment?.start ? toDate(c.appointment.start).getTime() : 0;
  const boughtUnderNewRule = bought && bought >= FULL_WINDOW_FROM_PURCHASE_AT;
  const start = boughtUnderNewRule ? bought : (firstCall || bought);
  if (!start) return null;
  const held = Math.max(0, Number(c?.hold?.totalMs) || 0)
    + (c?.hold?.pausedAt ? Math.max(0, Date.now() - toDate(c.hold.pausedAt).getTime()) : 0);
  const base = bought && bought >= FULL_MONTHLY_FROM_AT
    ? FULL_WINDOW_DAYS : FULL_LEGACY_WINDOW_DAYS;
  const days = base + (Number(c.fullAccessExtraDays) || 0);
  return new Date(start + days * 86_400_000 + held);
}
// Stripe's success URL comes back as ?extended=1. Read it ONCE, at load, and
// strip it from the address bar. Left in place it made every later repaint
// claim success unconditionally - including for an extension that had not
// been confirmed yet - and it hid the buy button for the rest of the session,
// so a client who wanted a second thirty days could not buy one (audit,
// 2026-08-25).
let extendJustPaid = new URLSearchParams(location.search).get('extended') === '1';
if (extendJustPaid) {
  const u = new URL(location.href);
  u.searchParams.delete('extended');
  history.replaceState(null, '', u.pathname + u.search + u.hash);
}
function livePendingExtend(c) {
  // An expired Stripe session is not a checkout you can finish. Mirror the
  // Worker's own expiry rather than offering a dead link forever.
  const p = c?.pendingExtend;
  if (!p?.url) return null;
  if (p.expiresAt && toDate(p.expiresAt).getTime() <= Date.now()) return null;
  return p;
}
function extendOffer(c) {
  if (!c.fullAccess || c.status === 'closed') return '';
  const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' });
  const pending = livePendingExtend(c);
  if (extendJustPaid) {
    // Paid, but Stripe's webhook confirms it and can land a moment after the
    // browser does. While the pending session is still on the case, say what
    // is true right now instead of promising days it does not yet carry.
    if (pending) return `
      <div class="followup-offer">
        <h3>Payment received — putting the month on your case.</h3>
        <p>This takes a moment. Refresh in a minute if it hasn't updated;
          nothing is charged twice.</p>
      </div>`;
    const to = windowEndOf(c);
    return `
      <div class="followup-offer is-done">
        <h3><span class="fu-tick" aria-hidden="true">✓</span> Another month is on your case.</h3>
        <p>Same case, same file, same rhythm. Your coordination window now runs
          through <strong style="color:var(--ink)">${to ? esc(dateFmt.format(to)) : 'its new end date'}</strong>.</p>
        <p><button type="button" class="btn quiet" data-extend-again>Add another month</button></p>
      </div>`;
  }
  if (pending)
    return `
      <div class="followup-offer">
        <h3>Your next month is waiting to be started</h3>
        <p>Finish it or let it lapse; nothing is charged until you do.</p>
        <p><a class="btn glow" href="${esc(pending.url)}">Finish checkout</a></p>
      </div>`;
  const end = windowEndOf(c);
  return `
    <div class="followup-offer">
      <h3>Keep going another month?</h3>
      <p>Your coordination window ${end && end.getTime() < Date.now() ? 'ended' : 'runs through'}
        <strong style="color:var(--ink)">${end ? esc(dateFmt.format(end)) : 'its end date'}</strong>.
        Another month is the same price as the last one, and the check-ins, the
        calls on your behalf and the rest carry on exactly as they are. Take as
        many as your case needs, one at a time, and stop whenever you like.</p>
      <div class="fu-buy">
        <span class="price">$${(EXTEND_PRICE_CENTS / 100).toLocaleString()}</span>
        <button class="btn glow" data-buy-extend>Add another month</button>
      </div>
      <p class="error" data-extend-error hidden></p>
    </div>`;
}
function wireExtendOffer(el, c) {
  const again = el.querySelector('[data-extend-again]');
  if (again) again.addEventListener('click', () => {
    // Clearing the return flag is what un-blocks a second purchase; without
    // this the thank-you card owned the slot until a full reload.
    extendJustPaid = false;
    el.innerHTML = extendOffer(c);
    wireExtendOffer(el, c);
    addAboutButton(el, 'extension');
  });
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
  const addAbout = addAboutButton;
  const th = el.querySelector('[data-telehealth]');
  if (th) { th.innerHTML = telehealthCard(c); wireTelehealthCard(th, c); addAbout(th, 'telehealth'); }
  const ex = el.querySelector('[data-extend]');
  if (ex) { ex.innerHTML = extendOffer(c); wireExtendOffer(ex, c); addAbout(ex, 'extension'); }
  const offer = el.querySelector('[data-followup]');
  if (offer) {
    offer.innerHTML = followUpOffer(c);
    wireFollowUpOffer(offer, c);
    addAbout(offer, 'followup');
  }
  const up = el.querySelector('[data-upgrade]');
  if (up) {
    up.innerHTML = upgradeOffer(c);
    wireUpgradeOffer(up, c);
    addAbout(up, 'handsOff');
    // Repaint once the live price answers. Without this the card kept
    // whatever was compiled in, and the handshake would then bounce a buyer
    // who had done nothing wrong.
    ratesReady.then(() => {
      if (!up.isConnected || up.querySelector('[data-upgrade-ack]:checked')) return;
      up.innerHTML = upgradeOffer(c);
      wireUpgradeOffer(up, c);
      addAbout(up, 'handsOff');
    }).catch(() => {});
  }
}

/**
 * Telehealth Appointment Advocacy: Eric joins the client's own telehealth
 * visit by video and advocates live. The client names the appointment; he
 * confirms or declines every one; a decline - his or the clinic's - refunds
 * the payment in full, and the card says so before they type a thing.
 */
const TELEHEALTH_PRICE_CENTS = 45000;
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
        ? 'Included in your Full-Service Case Management. I confirm every appointment personally.'
        : 'I confirm every appointment personally. If I can\'t attend, or your provider doesn\'t allow it, you get every dollar back.'}
        I never record your provider's visit. My role on that screen is notes and advocacy only.</p>
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
 * What upgrading THIS case costs, in cents. One helper so the card and the
 * checkout POST cannot quote different numbers - which is the whole point
 * of the handshake below.
 *
 * NO CREDIT (Eric, 2026-08-29: "Clients don't get discounted their initial
 * cost for a case review. They pay 3400 separately."). The case fee bought
 * the review; a Full-Service month is a separate service at the full month
 * price. The credit this used to apply is in file history at v2.52. `c`
 * stays in the signature so the callers did not have to learn anything.
 */
function upgradeQuoteCents(c) {
  return Math.max(100, fullAccessPrice());
}

function upgradeOffer(c) {
  if (new URLSearchParams(location.search).get('upgraded') === '1' && !c.fullAccess)
    return `
      <div class="followup-offer is-done">
        <h3><span class="fu-tick" aria-hidden="true">\u2713</span> Full-Service Case Management is open on your case.</h3>
        <p>I will pick this up in your case chat and tell you exactly what I
          need from you to get started. Everything I do on your case appears
          on this page as I do it.</p>
      </div>`;
  if (c.fullAccess || c.status === 'closed') return '';

  const req = c.fullAccessRequest;
  // Approved and waiting to be paid. This is the ONLY payable link, and it
  // exists because he said yes - nothing takes a card before that.
  if (req?.state === 'approved' && c.pendingFullAccess?.url
    && toDate(c.pendingFullAccess.expiresAt).getTime() > Date.now()) return `
    <div class="followup-offer">
      <h3><span class="fu-tick" aria-hidden="true">\u2713</span> I can take your case.</h3>
      <p>Your first month is ready to start. Full-Service is its own service,
        priced on its own: your case fee paid for the review you already
        have, and the month below is the month.</p>
      <div class="fu-buy">
        <span class="price">$${Math.max(1, Math.round(Number(c.pendingFullAccess.cents) / 100)).toLocaleString()}</span>
        <a class="btn glow" href="${esc(c.pendingFullAccess.url)}">Start month one</a>
      </div>
      <p class="fu-fine">After this, it is $${Math.round(fullAccessCents / 100).toLocaleString()} a month for
        as long as your case needs me, and every month is your choice.</p>
    </div>`;
  // Asked, waiting on him. Nothing has been charged and no card was taken.
  if (req?.state === 'pending') return `
    <div class="followup-offer">
      <h3>Your request is with me</h3>
      <p>I read every one of these myself, because I only carry a limited
        number of these cases at a time and I would rather say no than do it
        badly.
        <strong style="color:var(--ink)">Nothing has been charged</strong> and
        I have not taken a card.</p>
      <p class="fu-fine">You will hear from me either way. If I say yes, you
        will get a link to start your first month.</p>
      <p><button type="button" class="btn quiet tiny" data-withdraw-upgrade>Withdraw my request</button></p>
      <p class="error" data-upgrade-error hidden></p>
    </div>`;
  // He said no. His words, verbatim, and nothing was charged.
  if (req?.state === 'declined') return `
    <div class="followup-offer">
      <h3>I could not take this one on</h3>
      ${req.declineReason ? `<p>${esc(req.declineReason)}</p>` : ''}
      <p class="fu-fine">Nothing was charged. Ask me again any time, in chat or
        from here, if things change.</p>
      <div class="fu-buy">
        <button class="btn quiet" data-ask-again>Ask again</button>
      </div>
    </div>`;

  const monthly = Math.max(1, Math.round(fullAccessCents / 100));
  const first = Math.max(1, Math.round(upgradeQuoteCents(c) / 100));
  return `
    <div class="followup-offer">
      <h3>Want me to deal with them directly?</h3>
      <p>Right now I work beside you: I read everything, we talk it through,
        and you carry it to your doctors and your insurer. Full-Service Case Management is where
        I do that part myself. I speak to your clinics, with you on the line or
        alone once you have given me permission in writing, and I write and file
        your insurance appeals.</p>
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
        <span class="price">$${monthly.toLocaleString()}<span style="font-size:.6em; font-weight:400;">/month</span></span>
        <button class="btn glow" data-buy-upgrade disabled>Ask me to take this case</button>
      </div>
      <p class="fu-fine"><strong style="color:var(--ink)">Asking costs nothing
        and takes no card.</strong> I answer every request myself. If I say yes,
        your first month is
        <strong style="color:var(--ink)">$${first.toLocaleString()}</strong>, the
        same as every month after it. Your case fee paid for the case review;
        this pays for the month. Every month is your choice, one at a time.
        Open the note above first: it is the whole of what I do, what I need
        from you, and where it stops.</p>
      <p class="error" data-upgrade-error hidden></p>
    </div>`;
}

function wireUpgradeOffer(el, c) {
  const errEl = el.querySelector('[data-upgrade-error]');
  const repaint = () => {
    el.innerHTML = upgradeOffer(c);
    wireUpgradeOffer(el, c);
    addAboutButton(el, 'handsOff');
  };

  // "Ask again" after a decline: clear the answered request locally and put
  // the asking card back. The Worker overwrites a declined request with a
  // fresh pending one, so nothing has to be deleted first.
  const again = el.querySelector('[data-ask-again]');
  if (again) {
    again.addEventListener('click', () => { c = { ...c, fullAccessRequest: null }; repaint(); });
    return;
  }

  // Withdrawing a pending ask. Theirs to take back for as long as it is still
  // waiting on him.
  const undo = el.querySelector('[data-withdraw-upgrade]');
  if (undo) {
    undo.addEventListener('click', async () => {
      undo.disabled = true;
      if (errEl) errEl.hidden = true;
      try {
        const idToken = await user.getIdToken();
        const res = await fetch('/api/upgrade', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ caseId: c.id, action: 'withdraw' }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || `Couldn't do that (${res.status})`);
        c = { ...c, fullAccessRequest: null };
        repaint();
      } catch (err) {
        if (errEl) { errEl.textContent = err.message; errEl.hidden = false; }
        undo.disabled = false;
      }
    });
    return;
  }

  const btn = el.querySelector('[data-buy-upgrade]');
  if (!btn) return;

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
      // An ASK, not a checkout. There is no quote handshake here any more and
      // there does not need to be: the Worker records the rate quoted at this
      // moment, and an approval days later charges THAT number rather than
      // whatever the live rate has climbed to since.
      const res = await fetch('/api/upgrade', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          caseId: c.id,
          acks: { [FULL_ACCESS_TERMS.id]: ackAt },
        }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `Couldn't send that (${res.status})`);
      c = { ...c, fullAccessRequest: { state: 'pending', at: out.at || new Date().toISOString() } };
      repaint();
      return;
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
 * THE WORK LOG, their side: what he has been doing on this case, by date.
 *
 * Eric, 2026-08-27: "I also do unlimited calls etc so that section should
 * just be a log of what I've been doing by date, so they can see what I've
 * been up to."
 *
 * A PROJECTION, NOT THE RECORD. His log lives under the case's private
 * subtree, which is `read, write: if false` for every browser including his
 * own, so this cannot be a Firestore read. /api/case-log builds a four-field
 * view of each entry in the Worker and ships that: the date, what kind of
 * thing it was, who it was with, and the one line he wrote for you. His
 * notes, the clinic's direct line and who else was on the call have no path
 * into it.
 *
 * An entry he has written no line on does not appear here at all.
 */
const LOG_PILLS = {
  call: 'CALL', appeal: 'APPEAL', investigation: 'INVESTIGATION', appointment: 'APPOINTMENT',
};
// The advocate's own activity types arrive on each entry as a label and a
// colour (never free-form CSS): one of six legacy token ids, or a bare hue
// h0-h359 from his slider (Eric, 2026-08-29: "Would like a color
// wheel/slider"). Either way the value resolves HERE, into a token or into
// hsl() built from digits plus the scheme's own --pill-s/--pill-l, so a
// custom pill is legible in every scheme and nothing from the network
// reaches a style attribute except through this function.
// KEEP IN STEP with pillColor in admin-case.js and validPillColor in the
// Worker; tools/suites/worklog.mjs pins them together.
const LOG_COLORS = {
  blue: '--cyan', deep: '--magenta', green: '--green',
  gold: '--gold', orange: '--orange', red: '--danger',
};
function pillColor(c) {
  if (LOG_COLORS[c]) return `var(${LOG_COLORS[c]})`;
  const m = /^h(\d{1,3})$/.exec(String(c || ''));
  if (m && Number(m[1]) <= 359) return `hsl(${Number(m[1])} var(--pill-s, 62%) var(--pill-l, 36%))`;
  return 'var(--cyan)';
}

async function mountCaseLog(host, c) {
  const full = !!c.fullAccess;
  // The checklist and the window sentence are Full-Service furniture, and they
  // used to sit on top of the records panel that was parked. They belong at
  // the head of the log now, which is the same place on the page.
  const ready = handsOffReadiness(c);
  const boughtAt = c.fullAccessAt ? toDate(c.fullAccessAt) : null;
  // Not "your 60 days": extensions and holds both move the end, so say the
  // date the window actually runs to rather than a number that goes stale
  // the moment somebody buys another thirty days.
  const dayFmt = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' });
  // The SHARED predicate, not a bare `> Date.now()`. A month can be set to
  // begin later than the day it was arranged, and the panel stores NOON
  // Mountain, so a case opened at nine in the morning to start today sits
  // three hours ahead. Three parties say this sentence; one predicate.
  const startsLater = handsOffStartsLater(c);
  const timeFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });

  const head = full ? `
    <ul class="ready-list" data-ready-list>
      ${ready.rows.map((r) => `
        <li class="${r.done ? 'is-done' : ''}">${r.done ? '✓' : '○'} ${esc(r.label)}</li>`).join('')}
    </ul>
    <p class="dim small">${boughtAt ? (startsLater
    ? `Your month starts ${esc(dayFmt.format(boughtAt))}${windowEndOf(c) ? ` and runs through ${esc(dayFmt.format(windowEndOf(c)))}` : ''}. Getting me your permission before then is worth doing: a records request can take weeks to come back, so the sooner it is in, the more of your month is spent on your case instead of on waiting.`
    : `Your window started ${esc(dayFmt.format(boughtAt))}${windowEndOf(c) ? `, and runs through ${esc(dayFmt.format(windowEndOf(c)))}` : ''}. The clock runs whether or not this is done.`) : ''}</p>` : '';

  const paint = (items, miles = []) => {
    host.innerHTML = `
      <div class="panel authority" data-worklog-panel>
        <h3>What I have been doing</h3>
        ${head}
        ${miles.length ? `
        <p class="log-day" style="margin:.6rem 0 .2rem;">🏁 Milestones</p>
        <ul class="filelist" data-milestones>
          ${miles.map((m) => {
    const at = m.at ? new Date(m.at) : null;
    const chue = pillColor(m.kindColor);
    return `
          <li>
            <span class="fname"><span class="kind-pill" style="border-color:${chue}; color:${chue}">${esc(String(m.kindLabel || '').toUpperCase())}</span>
              <span class="logline">${esc(String(m.what || ''))}</span></span>
            <span class="fmeta">${at && !Number.isNaN(at.getTime()) ? esc(at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })) : ''}</span>
          </li>`;
  }).join('')}
        </ul>` : ''}
        ${items.length ? `
        <ul class="filelist">
          ${(() => {
    // DAY BY DAY, same as Eric's own panel (2026-08-29): a dated heading
    // wherever the date changes, newest day first as this list has always
    // run, and the per-row date becomes a time because the heading now
    // carries the date.
    const dayLabel = (i) => {
      const d = i.at ? new Date(i.at) : null;
      return d && !Number.isNaN(d.getTime())
        ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
        : '';
    };
    const groups = [];
    for (const i of items) {
      const label = dayLabel(i);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.rows.push(i);
      else groups.push({ label, rows: [i] });
    }
    return groups.map((g) => (g.label ? `
          <li class="log-day">${esc(g.label)}</li>` : '') + g.rows.map((i) => {
    const at = i.at ? new Date(i.at) : null;
    const custom = !LOG_PILLS[i.kind] && typeof i.label === 'string' && i.label.trim();
    const kind = LOG_PILLS[i.kind] ? i.kind : 'call';
    const chue = pillColor(i.color);
    const pill = custom
      ? `<span class="kind-pill" style="border-color:${chue}; color:${chue}">${esc(i.label.trim().toUpperCase())}</span>`
      : `<span class="kind-pill ${kind}">${LOG_PILLS[kind]}</span>`;
    return `
            <li>
              <span class="fname">${pill}
                <span class="logline">${esc(i.summary)}${i.who ? `<span class="dim"> · ${esc(i.who)}</span>` : ''}</span></span>
              <span class="fmeta">${at && !Number.isNaN(at.getTime()) ? esc(timeFmt.format(at)) : ''}</span>
            </li>`;
  }).join('')).join('');
  })()}
        </ul>` : `
        <p class="dim small">This is where I write down the work I do on your
          case, by date.</p>`}
      </div>`;
  };

  paint([]);
  try {
    const idToken = await user.getIdToken();
    const res = await fetch(`/api/case-log?caseId=${encodeURIComponent(c.id)}`, {
      headers: { authorization: `Bearer ${idToken}` },
    });
    const out = res.ok ? await res.json() : {};
    paint(out.items || [], out.milestones || []);
  } catch { /* an unreachable log still shows the panel and says nothing yet */ }
}

/**
 * PARKED, NOT DELETED (Eric, 2026-08-27: "Remove the release of records and
 * park that."). Flip this back to true and the two Sign buttons and the sheet
 * behind them come back exactly as they were; nothing else was removed.
 *
 * WHAT COULD NOT BE PARKED WITH THEM, and the reason this panel still exists.
 * View and Withdraw lived inside the same markup as the offer, `Withdraw` is
 * the only revoke control anywhere on the client side, and the advocate
 * cannot revoke on a client's behalf: the Worker answers 403 "Only the client
 * can revoke this", under a comment saying revocation is the client's right
 * and is not negotiable. Deleting the block would have left everyone who has
 * already signed with no way to withdraw, while the agreement they signed
 * promises them in writing that either document can be withdrawn at any time.
 *
 * So the offer is gone and the record of what they have given is not.
 */
const OFFER_AUTHORITY_SIGNING = false;

/**
 * The permissions this client has already given, with the two things they can
 * still do about them: read it back, and take it away.
 *
 * Renders NOTHING at all on a case that has signed nothing, which since the
 * offer was parked is every new case. No empty box, no explanation of a thing
 * that is not there.
 *
 * Worker-mediated like everything else: the documents live under the case's
 * private subtree, which the browser cannot read or write directly by rule.
 */
async function mountPermissions(host, c) {
  const paint = (items) => {
    // NOTHING HERE OFFERS A SIGNATURE, and nothing may (Eric, 2026-08-29:
    // "Do NOT send him any forms whatsoever including the one you just
    // created"). Every document reaches the client by hand and comes back
    // the same way; the advocate records their return with his own Forms
    // submitted tick on his side. The scope-agreement offer that shipped for
    // a few hours on 2026-08-29 is gone with the rest. What remains is the
    // record: anything that WAS signed in the app stays readable, the
    // agreement with a View button and no Withdraw (it is the contract the
    // case runs on, and the Worker refuses a revoke posted straight at the
    // route), the permissions with View and Withdraw as always.
    const scopeItem = items.find((i) => i.kind === 'scope' && !i.revokedAt);
    const perms = items.filter((i) => i.kind !== 'scope');
    if (!perms.length && !scopeItem && !OFFER_AUTHORITY_SIGNING) {
      host.innerHTML = '';
      return;
    }
    const live = perms.filter((i) => !i.revokedAt);
    const gone = perms.filter((i) => i.revokedAt);
    const named = (r) => (r.kind === 'records'
      ? `Records release${r.clinicName ? `, ${esc(r.clinicName)}` : ''}`
      : `Insurer form${r.planName ? `, ${esc(r.planName)}` : ''}`);
    const scopeBlock = scopeItem ? `
      <div class="panel authority" data-scope-panel>
        <h3>Your scope of work agreement</h3>
        <p class="auth-item">
          <span>Signed ${new Date(scopeItem.signedAt).toLocaleDateString()}<span class="dim small"> · the agreement your case runs on</span></span>
          <span class="auth-item-acts">
            <button type="button" class="btn ghost tiny" data-auth-view="${esc(scopeItem.id)}">View</button>
          </span>
        </p>
      </div>` : '';
    const permBlock = (perms.length || OFFER_AUTHORITY_SIGNING) ? `
      <div class="panel authority" data-auth-panel>
        <h3>Permissions you have given me</h3>
        <p class="dim small">Read any of these back whenever you like. You can
          withdraw one at any time and I stop using it straight away, though
          withdrawing cannot unmake a disclosure already made under it.</p>
        ${live.map((r) => `
          <p class="auth-item">
            <span>${named(r)}<span class="dim small"> · signed ${new Date(r.signedAt).toLocaleDateString()}</span></span>
            <span class="auth-item-acts">
              <button type="button" class="btn ghost tiny" data-auth-view="${esc(r.id)}">View</button>
              <button type="button" class="btn ghost tiny" data-auth-revoke="${esc(r.id)}">Withdraw</button>
            </span>
          </p>`).join('')}
        ${gone.map((r) => `
          <p class="auth-item">
            <span class="dim">${named(r)}<span class="dim small"> · withdrawn ${new Date(r.revokedAt).toLocaleDateString()}</span></span>
            <span class="auth-item-acts">
              <button type="button" class="btn ghost tiny" data-auth-view="${esc(r.id)}">View</button>
            </span>
          </p>`).join('')}
        ${OFFER_AUTHORITY_SIGNING ? `
          <p><button class="btn ghost" data-auth-add="records">Sign a records authorisation</button></p>
          ${c.fullAccess ? '<p><button class="btn ghost" data-auth-add="representative">Sign the insurance form</button></p>' : ''}` : ''}
        <p class="error" data-auth-error hidden></p>
      </div>` : '';
    host.innerHTML = scopeBlock + permBlock;

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
      paint([]); // an unreachable list renders nothing rather than a broken box
    }
  }
  load();
}

/**
 * What a signature data URL is allowed to look like, in one place. The
 * Worker enforces the same shape independently; this is the copy the page
 * uses before it stores one and before it writes one into a print window.
 */
const SIG_DATA_URL = /^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/;

/**
 * Today, in the zone the documents are executed in. The forms print in MST
 * (see authority.js) precisely because two zones produced two execution
 * dates on one document; the gate that refuses a future date has to read the
 * same clock, or a client in Honolulu is refused a date that is already
 * today on the paper they are signing.
 */
function mstToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Etc/GMT+7', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/**
 * The Worker's name check, mirrored: case, spacing and punctuation are all
 * forgiven, everything else has to be the name on the case.
 */
function nameMatches(typed, onCase) {
  const flat = (v) => String(v || '').toLowerCase().replace(/[^a-z]+/g, '');
  return flat(typed) === flat(onCase);
}

/** The signing sheet. Same overlay furniture as everything else on this page. */
function openAuthoritySheet(c, kind, onDone) {
  const isRecords = kind === 'records';
  // The scope of work agreement has no fields to fill: the document is
  // complete as written, and the whole job here is reading it and signing.
  const isScope = kind === 'scope';
  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-card sig-sheet" role="dialog" aria-modal="true" aria-label="Sign">
      <h3 style="margin:0 0 .3rem;">${AUTHORITY_KINDS[kind]?.title || 'Sign'}</h3>
      <p class="dim small" style="margin:0 0 .8rem;">${isRecords
    ? 'One clinic per form. Fill in what you know; I can chase the rest.'
    : isScope
      ? 'What I do on your case, what I need from you, and where the work stops. Read it, then sign at the bottom.'
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
            <input type="date" data-f="fromDate" max="${esc(mstToday())}"></label>
          <label class="dim small" style="flex:1;">Through
            <input type="date" data-f="toDate" max="${esc(mstToday())}"></label>
        </div>
        <p class="dim small" style="margin:.8rem 0 .3rem;">Some records need your
          specific permission and are left out unless you tick them. Nothing here
          is required, and leaving one unticked never stops the rest.</p>
        ${SENSITIVE_CATEGORIES.map((cat) => `
          <label class="agreement-check" style="align-items:flex-start;">
            <input type="checkbox" data-cat="${cat.id}">
            <span><strong>${esc(cat.label)}</strong><br><span class="dim small">${esc(cat.note)}</span></span>
          </label>`).join('')}
      ` : isScope ? '' : `
        <label class="dim small">Insurance plan or company
          <input type="text" data-f="planName" maxlength="200" placeholder="e.g. Blue Cross of Arizona"></label>
        <label class="dim small">Member or policy ID
          <input type="text" data-f="memberId" maxlength="80"></label>
      `}
      ${isRecords ? `
        <p class="dim small" style="margin:.8rem 0 .3rem;">What you are letting
          me do with this clinic. All three are usually what makes the case
          work; untick anything you want left out.</p>
        ${COMMUNICATION_SCOPES.map((sc) => `
          <label class="agreement-check" style="align-items:flex-start;">
            <input type="checkbox" data-scope="${sc.id}" checked>
            <span><strong>${esc(sc.label)}</strong><br><span class="dim small">${esc(sc.note)}</span></span>
          </label>`).join('')}
      ` : ''}
      ${isScope ? `
        <!-- ARRIVES UNTICKED, on purpose. Ticking it is part of signing
             (Eric, 2026-08-29: "a tick box saying that he agrees I can
             contact him via phone by text or phone call"), and a consent
             that arrives pre-ticked is not one the client gave. -->
        <label class="agreement-check" style="align-items:flex-start;">
          <input type="checkbox" data-contact>
          <span><strong>Contact me by phone, call or text, about my case</strong><br>
          <span class="dim small">I can return the calls the same way. Anything
            that is not urgent goes through my case chat instead, so the whole
            case stays in one place.</span></span>
        </label>
      ` : ''}
      <details class="agreement"${isScope ? ' open' : ''} style="margin:.9rem 0 .6rem;">
        <summary><span class="agreement-title">${isScope ? 'The agreement' : 'Read the whole form'}</span></summary>
        <div class="agreement-body"><pre class="auth-doc" data-preview></pre></div>
      </details>
      <label class="dim small">Type your full name to sign
        <input type="text" data-f="signedName" maxlength="120" placeholder="${esc(c.clientName || 'Your full name')}"></label>
      <p class="dim small" style="margin:.6rem 0 .3rem;">Then sign with your finger:</p>
      <button type="button" class="sig-box" data-sig-open aria-label="Tap to sign with your finger">
        <span class="dim small" data-sig-hint>Tap here to sign</span>
        <img data-sig-img alt="Your signature" hidden style="max-width:100%; max-height:70px;">
      </button>
      <p class="dim small" style="margin:.4rem 0 0;">Your typed name and your
        drawn signature together are your signature. The date and time are
        recorded when you press Sign.</p>
      <p class="error" data-sheet-error hidden></p>
      <div class="actions">
        <button class="btn quiet" data-x>Cancel</button>
        <button class="btn glow" data-sign>Sign</button>
      </div>
    </div>`;

  const val = (name) => overlay.querySelector(`[data-f="${name}"]`)?.value.trim() || '';
  const cats = () => [...overlay.querySelectorAll('[data-cat]:checked')].map((i) => i.dataset.cat);
  const scopesOf = () => [...overlay.querySelectorAll('[data-scope]:checked')].map((i) => i.dataset.scope);
  let signatureImage = '';
  const preview = overlay.querySelector('[data-preview]');
  const repaint = () => {
    const o = {
      clientName: c.clientName, clientDob: c.clientDob,
      clinicName: val('clinicName'), clinicAddress: val('clinicAddress'),
      fromDate: val('fromDate'), toDate: val('toDate'),
      planName: val('planName'), memberId: val('memberId'),
      categories: cats(), scopes: scopesOf(), signedName: val('signedName'),
      contactOk: !!overlay.querySelector('[data-contact]:checked'),
    };
    preview.textContent = (AUTHORITY_KINDS[kind]?.build || recordsAuthorisation)(o);
  };
  overlay.addEventListener('input', repaint);
  overlay.addEventListener('change', repaint);
  repaint();

  // The finger-signature pad: tap the box, sign in the sheet that opens, and
  // the drawing lands back in the box (Eric, 2026-08-25: "tap to pull up a
  // box for them to sign with their finger").
  overlay.querySelector('[data-sig-open]').addEventListener('click', () => {
    openSignaturePad((dataUrl) => {
      // A degenerate canvas returns "data:," and the Worker would then
      // answer "That signature did not come through" with nothing marked.
      // Refuse it here, where the pad is still open to try again.
      if (!SIG_DATA_URL.test(String(dataUrl || '').trim())) return false;
      signatureImage = dataUrl;
      const img = overlay.querySelector('[data-sig-img]');
      const hint = overlay.querySelector('[data-sig-hint]');
      const box = overlay.querySelector('[data-sig-open]');
      img.src = dataUrl;
      img.hidden = false;
      if (hint) hint.textContent = 'Tap to sign again';
      box.classList.remove('field-bad');
      box.removeAttribute('aria-invalid');
      box.setAttribute('aria-label', 'Signature captured. Tap to sign again.');
      return true;
    }, val('signedName') || c.clientName || '');
  });

  // Every field clears its own red the moment it is corrected.
  overlay.addEventListener('input', (e) => e.target.classList?.remove('field-bad'));

  /**
   * The completeness gate (Eric, 2026-08-25, his wording verbatim in the
   * message below): required fields present, dates parseable, no future
   * dates, from before through. Offenders turn red; nothing is sent until
   * the document is whole. The Worker re-checks everything - this is the
   * half that explains, not the half that enforces.
   */
  const validateSheet = () => {
    const bad = [];
    // Clear first, then re-mark. It only ever added red, so resolving a
    // from > to conflict by editing one date left the OTHER one red through
    // a successful submit.
    for (const el of overlay.querySelectorAll('.field-bad')) {
      el.classList.remove('field-bad');
      el.removeAttribute('aria-invalid');
    }
    const mark = (sel) => {
      const el = overlay.querySelector(sel);
      if (!el) return;
      el.classList.add('field-bad');
      // Colour alone is not an error message. On contrast the border is a
      // one-pixel luminance step, and a screen reader saw nothing at all.
      el.setAttribute('aria-invalid', 'true');
      bad.push(el);
    };
    const need = isScope ? ['signedName']
      : isRecords ? ['clinicName', 'signedName'] : ['planName', 'memberId', 'signedName'];
    for (const f of need) if (!val(f)) mark(`[data-f="${f}"]`);
    // The Worker requires the typed name to match the name on the case, and
    // requires two characters. Mirror both here: without them the button
    // disabled, the POST 400ed, and the message landed as plain text with
    // nothing reddened and nothing scrolled to - the dead end this gate
    // exists to remove.
    const typed = val('signedName');
    if (typed && (typed.length < 2 || (c.clientName && !nameMatches(typed, c.clientName))))
      mark('[data-f="signedName"]');
    if (isRecords) {
      // MST, the same clock the document prints in. Comparing YYYY-MM-DD
      // strings keeps Date parsing out of the gate entirely, and stops a
      // client in Honolulu being refused a date that is already today in the
      // zone the document is executed in.
      const today = mstToday();
      for (const f of ['fromDate', 'toDate']) {
        const v = val(f);
        if (!v) continue;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v > today) mark(`[data-f="${f}"]`);
      }
      const from = val('fromDate'); const to = val('toDate');
      if (from && to && from > to) { mark('[data-f="fromDate"]'); mark('[data-f="toDate"]'); }
      // A document that authorises nothing is not a document. The boxes
      // arrive ticked, so this only fires for someone who deliberately
      // cleared all three - and it tells them so rather than silently
      // signing them up to all of it.
      if (!scopesOf().length) mark('[data-scope="discuss"]');
    }
    // The contact tick is part of the agreement, not an extra: the Worker
    // refuses the signature without it, so the sheet says so here, in red,
    // instead of letting the POST come back as plain text.
    if (isScope && !overlay.querySelector('[data-contact]:checked'))
      mark('[data-contact]');
    if (!signatureImage) mark('[data-sig-open]');
    return bad;
  };

  const opener = document.activeElement;
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (opener?.isConnected) opener.focus();
  };
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-x]').addEventListener('click', close);
  overlay.querySelector('[data-sign]').addEventListener('click', async () => {
    const btn = overlay.querySelector('[data-sign]');
    const err = overlay.querySelector('[data-sheet-error]');
    err.hidden = true;
    const bad = validateSheet();
    if (bad.length) {
      err.textContent = 'Your document is incomplete. please review the full document and be sure you did not miss any areas requiring your selection or signature.';
      err.hidden = false;
      bad[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    btn.disabled = true;
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
          categories: cats(), scopes: scopesOf(),
          contactOk: !!overlay.querySelector('[data-contact]:checked'),
          signatureImage,
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
 * The drawing pad itself. Pointer events cover finger, stylus and mouse, and
 * a keyboard route renders the typed name instead - a signature nobody can
 * make is not an accessible product, and both gates hard-require this mark.
 * The canvas is scaled for the device's pixel ratio so a signature drawn on
 * a phone is not a staircase; Done downsamples to at most 600px wide and
 * hands back a PNG dataURL small enough to live on the stored document.
 *
 * onDone returns false if it refuses the image, and the pad stays open.
 */
function openSignaturePad(onDone, typedName = '') {
  if (document.getElementById('pa-sigpad')) return;
  const opener = document.activeElement;
  const overlay = document.createElement('div');
  overlay.id = 'pa-sigpad';
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-card" role="dialog" aria-modal="true" aria-label="Sign with your finger">
      <h3 style="margin:0 0 .3rem;">Sign with your finger</h3>
      <p class="dim small" style="margin:0 0 .5rem;">Sign the way you would on
        paper. Clear starts over.</p>
      <canvas data-sig-canvas class="sig-canvas" tabindex="0"
        aria-label="Signature area. Draw with a finger, a stylus or a mouse."></canvas>
      ${typedName ? `<p style="margin:.5rem 0 0;"><button type="button" class="btn quiet tiny" data-sig-typed>Can't draw? Use my typed name as my mark</button></p>` : ''}
      <div class="actions" style="margin-top:.7rem;">
        <button class="btn quiet" data-sig-clear>Clear</button>
        <button class="btn quiet" data-sig-cancel>Cancel</button>
        <button class="btn glow" data-sig-done disabled>Done</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const canvas = overlay.querySelector('[data-sig-canvas]');
  const doneBtn = overlay.querySelector('[data-sig-done]');
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  // Measured, not arithmetic. The old line subtracted a hardcoded 20px for
  // card padding that is actually 42px, and under border-box clientWidth had
  // already accounted for it - so the canvas ran ~22px wider than the card
  // that held it and the overlay grew a horizontal scrollbar. Letting the
  // stylesheet's width:100% size it and reading the result back also means
  // it survives a rotation and any future padding change.
  const cssH = 180;
  canvas.style.height = `${cssH}px`;
  const cssW = Math.max(200, Math.round(canvas.clientWidth) || 320);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  // The document colours, from the tokens, so the five places that draw this
  // surface cannot drift apart.
  const css = getComputedStyle(document.documentElement);
  const PAPER = css.getPropertyValue('--sig-paper').trim() || '#FFFFFF';
  const INK = css.getPropertyValue('--sig-ink').trim() || '#101828';
  const g = canvas.getContext('2d');
  const blank = () => {
    g.fillStyle = PAPER;
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.strokeStyle = INK;
  };
  blank();
  g.lineWidth = 2.2 * dpr;
  g.lineCap = 'round';
  g.lineJoin = 'round';

  // One pointer owns the stroke. Tracking a bare boolean meant a second
  // finger's pointerdown moved the pen, and the first finger's next move drew
  // a line from wherever the second one landed.
  let activeId = null;
  let drew = false;
  let last = null;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr];
  };
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (activeId !== null) return;
    activeId = e.pointerId;
    const [x, y] = pos(e);
    g.beginPath();
    g.moveTo(x, y);
    // A dot is a mark too: a tap without a drag still leaves ink.
    g.lineTo(x + 0.1, y + 0.1);
    g.stroke();
    last = [x, y];
    drew = true;
    doneBtn.disabled = false;
    // After the state flags, not before: a NotFoundError on an already-ended
    // pointer used to throw away the whole stroke, Done included.
    try { canvas.setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activeId || !last) return;
    const [x, y] = pos(e);
    // One segment per move. beginPath ran once per stroke, so segment n was
    // re-rasterising all n before it - at 120 events a second that is a
    // visibly laggy signature on a mid-range phone.
    g.beginPath();
    g.moveTo(last[0], last[1]);
    g.lineTo(x, y);
    g.stroke();
    last = [x, y];
  });
  const stop = (e) => { if (!e || e.pointerId === activeId) { activeId = null; last = null; } };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (opener?.isConnected) opener.focus();
  };
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  // The backdrop deliberately does NOT close this one. Every other overlay in
  // the app closes on a backdrop tap, but here a stray tap beside the pad
  // would throw away a signature somebody just drew.
  overlay.querySelector('[data-sig-cancel]').addEventListener('click', close);
  overlay.querySelector('[data-sig-clear]').addEventListener('click', () => {
    blank();
    // The in-flight stroke has to end too. Without this, a second finger
    // tapping Clear left the first one's path alive, and its next move
    // re-stroked everything back onto the cleared canvas while Done stayed
    // disabled: visible ink you could not submit.
    activeId = null;
    last = null;
    g.beginPath();
    drew = false;
    doneBtn.disabled = true;
  });
  // The keyboard and no-motor-control route. The sheet already collected the
  // legal name; rendering it in a script face is a mark the client chose to
  // apply, which is what an electronic signature is.
  overlay.querySelector('[data-sig-typed]')?.addEventListener('click', () => {
    blank();
    g.fillStyle = INK;
    g.textBaseline = 'middle';
    const size = Math.min(canvas.height * 0.42, (canvas.width * 0.85) / Math.max(6, typedName.length) * 1.9);
    g.font = `italic ${Math.round(size)}px "Snell Roundhand", "Apple Chancery", "Segoe Script", cursive`;
    g.fillText(typedName, canvas.width * 0.08, canvas.height * 0.55, canvas.width * 0.84);
    g.strokeStyle = INK;
    activeId = null;
    last = null;
    drew = true;
    doneBtn.disabled = false;
  });
  doneBtn.addEventListener('click', () => {
    if (!drew) return;
    const outW = Math.min(600, canvas.width);
    const outH = Math.round(canvas.height * (outW / canvas.width));
    const small = document.createElement('canvas');
    small.width = outW;
    small.height = outH;
    const sg = small.getContext('2d');
    sg.imageSmoothingQuality = 'high';
    sg.fillStyle = PAPER;
    sg.fillRect(0, 0, outW, outH);
    sg.drawImage(canvas, 0, 0, outW, outH);
    // PNG, not JPEG. This is two-tone line art on white: JPEG rings around
    // every stroke on a document a records department reads, and for flat
    // white it is usually the LARGER file of the two.
    const dataUrl = small.toDataURL('image/png');
    if (onDone(dataUrl) === false) return; // refused - stay open, try again
    close();
  });
  canvas.focus();
}

/**
 * One document, with its signature. The list GET omits the blobs; passing an
 * id asks for that one back with its ink attached.
 */
async function withSignature(c, item) {
  try {
    const idToken = await user.getIdToken();
    const res = await fetch(
      `/api/authority?caseId=${encodeURIComponent(c.id)}&id=${encodeURIComponent(item.id)}`,
      { headers: { authorization: `Bearer ${idToken}` } },
    );
    if (!res.ok) return item;
    const found = ((await res.json()).items || []).find((i) => i.id === item.id);
    return found?.signatureImage ? found : item;
  } catch {
    return item; // the form still prints, just without the mark
  }
}

/**
 * The drawn signature, as printable HTML - or nothing at all.
 *
 * Re-checked here as well as server-side, because this string is about to
 * be written into a document: anything that is not plainly a base64 png or
 * jpeg never reaches document.write. It goes AFTER the </pre>, never inside
 * it, so the text of the document (which a records department reads, and
 * which the suite pins line by line) is untouched.
 */
function signatureInk(item) {
  const src = typeof item?.signatureImage === 'string' ? item.signatureImage.trim() : '';
  if (!src || !SIG_DATA_URL.test(src)) return '';
  return `<figure class="sig-ink"><img src="${esc(src)}" alt="Signature">
    <figcaption>Signature of the person named above.</figcaption></figure>`;
}

/**
 * A paper copy, on demand, for either side. Same window.open + print pattern
 * the case export and the prep sheet already use; there is no PDF library in
 * this stack and none is being added for this.
 */
async function printAuthority(c, item) {
  if (!item) return;
  // The list no longer carries the signature blobs, so the one document
  // being printed asks for its own. A failed fetch prints the form without
  // the ink rather than not printing at all.
  if (item.hasSignature && !item.signatureImage) item = await withSignature(c, item);
  const o = {
    ...item,
    clientName: c.clientName, clientDob: c.clientDob,
    advocateName: 'Eric Bleach',
  };
  const text = (AUTHORITY_KINDS[item.kind]?.build || recordsAuthorisation)(o);
  const win = window.open('', '_blank');
  if (!win) {
    alert('Your browser blocked the print window. Allow pop-ups for this site and try again.');
    return;
  }
  win.document.write(`<!doctype html><html><head><meta charset="utf-8">
    <title>${AUTHORITY_KINDS[item.kind]?.title || 'Records authorisation'}</title>
    <style>
      @page { margin: 16mm; }
      body { font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; color: #000; }
      pre { white-space: pre-wrap; word-wrap: break-word; margin: 0; }
      .sig-ink { margin: 6mm 0 0; page-break-inside: avoid; }
      .sig-ink img { max-width: 78mm; max-height: 26mm; display: block; }
      .sig-ink figcaption { font-size: 10px; color: #444; margin-top: 1mm; }
    </style></head><body><pre>${text.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))}</pre>${signatureInk(item)}</body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 350);
}
