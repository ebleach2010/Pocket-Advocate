// Admin case workspace: the case folder. Everything the client sees, plus the
// levers, rehoused into flip pages: Overview, Chat, Advisor, Differential,
// Files, Notes, Drafts. Chat and advisor mount ONCE per case; refresh paths
// only repaint the Overview and Files contents in place, so the chat's live
// onSnapshot and the advisor's poll survive every action on this page.

import './admin-ledger.js';
import {
  db, storage, doc, getDoc, collection, getDocs, query, where,
  ref, uploadBytesResumable, listAll, getDownloadURL, getMetadata, deleteObject,
} from './firebase.js';
import { requireAdmin, hydrateNav } from './auth.js';
import { mountChat, openLightbox } from './chat.js';
import { STATUS_REACTIONS, openMessageMenu } from './msg-actions.js';
import { mountAdvisor, sendToClient } from './advisor.js';
import { mountNotes } from './notes.js';
import { mountSaved } from './saved.js';
import { mountPersonal } from './admin-personal.js';
import { markSeen, isUnseen, PAGE_BADGES } from './seen.js';
import { openDutyDraft } from './duty.js';
import { openPrepSheet } from './prep.js';
import { mountFolder } from './folder.js';
import {
  recordsAuthorisation, representativeDesignation, scopeOfWork,
  APPEAL_DEADLINES, appealDueAt,
} from './authority.js';
import { handsOffReadiness, handsOffStartsLater } from './readiness.js';

const MOUNTAIN_TZ = 'Etc/GMT+7';
// Keep in sync with CASE_PRICE_CENTS in worker/index.js — the custom-rate
// percentages below are a share of the standard Advocacy Case fee.
const CASE_PRICE_CENTS = 120000;

/**
 * The rate a given client booked at. Recorded on the case at checkout, so a
 * percentage charge later is a share of what they actually paid rather than of
 * whatever the rate has moved to since (Eric: "current client gets
 * grandfathered in", 2026-08-20).
 *
 * A case from before the field existed has NO recorded rate, and today's price
 * is the wrong guess for it. This used to fall back to CASE_PRICE_CENTS with a
 * comment saying rates had only ever come down, so the fallback erred in the
 * client's favour. That stopped being true: $175, then $265, then $1,200. On
 * a real case (Eric, 2026-08-26) it read a client who paid $175 as having paid
 * $1,200, which is 7x, and it did it on the ONE number in this file built to
 * reveal a loss.
 *
 * So it is used for two different questions now, and they get different
 * answers. This one is "what is a percentage charge a share of", where today's
 * rate is a defensible base for a case with nothing recorded. What they
 * ACTUALLY paid is paidCents() below, which refuses to guess.
 */
const caseRate = (c) => (c && c.caseRateCents) || CASE_PRICE_CENTS;
// Money, grouped. Without the separator a four-figure sum renders "$4600",
// while the charge panel three inches away renders "$3,400" because it reaches
// for toLocaleString itself: two formatters on one screen, on the numbers he
// is least able to check at a glance. Cents show only when there are any,
// which is the behaviour this already had and the reason it is not plain
// toLocaleString. Every caller adds its own "$", and none of them puts the
// result inside an input value or a data attribute, so the comma is
// display-only and can never reach a parser.
const dollars = (cents) => (cents / 100).toLocaleString('en-US', {
  minimumFractionDigits: cents % 100 ? 2 : 0,
  maximumFractionDigits: cents % 100 ? 2 : 0,
});

/**
 * What this case has actually paid, tips excluded. A tip is a gift, and
 * counting it would flatter the one number here that has to stay honest.
 *
 * RETURNS NULL WHEN IT DOES NOT KNOW. A case with no caseRateCents predates
 * the field, and there is no honest way to infer what that client paid: the
 * price has been $175, $265 and $1,200 within the year. Guessing today's rate
 * turned a $175 client at fifteen hours into "$76.19/hr, comfortably above
 * your floor" when the truth was $11.11/hr, which is the exact error this
 * figure exists to catch, running in the direction that hides it.
 *
 * Null means the caller says so instead of printing a number. There is a
 * control on the Overview to record what they paid, which turns the unknown
 * into a fact rather than a better guess.
 */
function paidCents(c) {
  const extras = Array.isArray(c?.extraPayments) ? c.extraPayments : [];
  const addOns = () => extras.filter((x) => x.kind !== 'tip' && x.kind !== 'fullaccess')
    .reduce((n, x) => n + (Number(x.amountCents) || 0), 0);
  // In order of how much the source actually knows.
  //
  // 1. What Eric recorded by hand. His explicit correction beats every
  //    inference, including Stripe, because only he knows about money that
  //    moved outside it.
  const recorded = Number(c?.paidOverrideCents);
  if (recorded > 0) return recorded + addOns();
  // 2. THE TIER TOTAL, on a case that is on the tier. This has to come before
  //    the Stripe receipt below, and did not: `stripe.amountTotal` is the
  //    ORIGINAL booking, so an upgraded case answered with the case fee and
  //    dropped the whole Full-Service payment. A $1,200 booking that then paid
  //    $3,400 for the tier read as $1,200 paid, which is the direction that
  //    HIDES a loss on the one figure built to reveal one.
  if (c?.fullAccess && Number(c.fullAccessRateCents) > 0)
    return Number(c.fullAccessRateCents) + addOns();
  // 3. WHAT STRIPE ACTUALLY CHARGED. This was sitting on the case the whole
  //    time and this file never read it, while worker/advisor.js did. The
  //    hourly was inferred from a price list when the receipt was right there.
  const charged = Number(c?.stripe?.amountTotal);
  if (charged > 0) return charged + addOns();
  // 4. The rate recorded at checkout.
  const known = c?.fullAccess ? Number(c.fullAccessRateCents) > 0 : Number(c.caseRateCents) > 0;
  if (!known) return null;
  // A Full Access case paid its own price, which INCLUDES everything in the
  // standard case. caseRateCents on such a case is the standard-case rate
  // kept as the base for percentage charges, so the two are never summed.
  const base = c?.fullAccess && Number(c.fullAccessRateCents) > 0
    ? Number(c.fullAccessRateCents) : caseRate(c);
  return base
      // 'fullaccess' is excluded alongside tips, for the opposite reason. An
      // upgrade writes fullAccessRateCents = caseRateCents + amountCents (the
      // WHOLE tier price) and ALSO pushes that same amountCents into
      // extraPayments, so summing both counted the upgrade twice: a $1,500
      // engagement read as $2,350 paid. That error runs in the direction that
      // HIDES a loss, on the one figure built to reveal one.
    + extras.filter((x) => x.kind !== 'tip' && x.kind !== 'fullaccess')
      .reduce((n, x) => n + (Number(x.amountCents) || 0), 0);
}

/**
 * Eric, 2026-08-23: "I've lost money on my current client." He found that out
 * afterwards. The clock beside this already counts his worked minutes, so the
 * app can say it while the case is still open: what this case pays him per
 * hour, right now, against the hours he has actually put in.
 *
 * Null under six minutes of clock: a case fee over one recorded minute is a
 * meaningless five-figure hourly, and a number that silly teaches him to
 * ignore the line.
 */
let floorCents = 7500;
function effectiveHourly(c, liveSeconds) {
  const secs = Math.max(0, Number(liveSeconds) || 0);
  if (secs < 360) return null;
  // No recorded payment, no hourly. A confident wrong number here is worse
  // than none: it is the figure he uses to decide whether a case is worth
  // continuing.
  const paid = paidCents(c);
  if (paid === null) return null;
  return Math.round(paid / (secs / 3600));
}

const caseId = new URLSearchParams(location.search).get('id');
// Sentinel value for "a time that isn't on the calendar" in the slot dropdown.
const CUSTOM = '__custom__';
const CUSTOM_OPTION = `<option value="${CUSTOM}">A time not on the calendar…</option>`;

hydrateNav();
const user = await requireAdmin();
// askIfStillWorking is called from inside load(), not here: prepending its
// card moments before render() replaced #case's innerHTML made the prompt
// Eric taps from a push notification flash and vanish. It is the safety
// valve on over-billing; it has to survive.
if (user && caseId) { loadFloor(); load(); }

let data = null;
// Case id the folder shell (and its one chat + advisor mount) was built for.
// Refresh paths must never rebuild the chat's or the advisor's DOM.
let renderedFor = null;
let folder = null;
// The notes sheet and the last html the server gave us. The sheet is built
// with whatever we already hold, then kept current by the state poll.
let notes = null;
// The advisor's latest read, kept for the prep sheet: it is assembled from
// these rather than from a second model call.
let lastAnalysis = '';
let lastDifferential = [];
// Set once the chat mounts; the Drafts page tools send through it.
let chatSend = null;
let notesHtml = '';

/**
 * His margin floor, read once per page load from the admin rates route. It
 * never reaches a client surface: /api/rates deliberately omits it, and this
 * module is behind the admin asset gate.
 */
async function loadFloor() {
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/admin/rates', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    if (!res.ok) return;
    const d = await res.json();
    if (Number(d.floorCents) > 0) floorCents = Number(d.floorCents);
  } catch { /* the default floor stands */ }
}

let autoClockTried = false;
async function load() {
  const el = document.getElementById('case');
  try {
    const snapshot = await getDoc(doc(db, 'cases', caseId));
    if (!snapshot.exists()) throw new Error('No such case.');
    data = snapshot.data();
  } catch (err) {
    el.innerHTML = `<p class="error">${err.message}</p>`;
    renderedFor = null;
    folder = null;
    return;
  }
  // Re-loads for the same case (after a milestone, an upload, a scheduling
  // run) refresh the header, Overview, and Files in place. The chat and the
  // advisor mount once and are never touched again.
  if (renderedFor === caseId && folder) {
    refreshHeader();
    refreshOverview();
  } else {
    render(el);
  }
  refreshFiles();
  // Now that the case is loaded and the shell exists: put up the "Still
  // working?" prompt if a push sent him here to answer it. Once per page
  // load, never on a refresh. Nothing starts a clock here - the clock is
  // manual, and its switches are on the page.
  if (!autoClockTried) {
    autoClockTried = true;
    askIfStillWorking();
  }
}

function render(el) {
  const c = data;

  el.innerHTML = '<div data-folder></div>';

  folder = mountFolder({
    // Tappable furniture that must not turn the page. These selectors used to
    // live inside folder.js, which every client downloads.
    container: el.querySelector('[data-folder]'),
    storageKey: `case-${caseId}`,
    initial: 'overview',
    // Eleven pages in one strip meant scrolling sideways to reach half of
    // them. Three groups of four: the group row never changes, the page row
    // shows one group, and everything is two taps away.
    //
    // Four per group is the constraint, not a coincidence. Four tabs fit
    // across a 320px screen with their labels whole; five do not.
    //
    // ASKED AND ANSWERED (Eric, 2026-08-26): leave them as Track and Mine.
    //
    // A pass had renamed these to Before and After and moved six pages while
    // it was in there, on the argument that 'Track' and 'Mine' name a source
    // rather than a moment. The argument is not wrong. It is also not his: he
    // refers to "under mine" by name, he knows where everything is, and the
    // last time his furniture moved without asking, the answer was that the
    // result was a wall of confusion. Putting the old words back on the new
    // contents would have been the worst of both, because "Mine" would no
    // longer have meant his own notes. So the whole block is as it was.
    //
    //   Case     the client, the conversation, files
    //   Advisor  its read, its differential, asking it, the terms in play
    //   Track    where the case stands and what is outstanding
    //   Mine     the things he wrote himself
    groups: [
      { id: 'case', label: 'Case', icon: '📁', pages: ['overview', 'chat', 'files'] },
      { id: 'read', label: 'Advisor', icon: '👨‍⚕️', pages: ['advisor', 'dx', 'advisor-chat', 'education'] },
      { id: 'track', label: 'Track', icon: '🗒', pages: ['summary', 'unanswered', 'agenda', 'about'] },
      // 'calldoc' sits in Mine, beside Notes: both start from something Eric
      // wrote himself. A page absent from every group renders no tab at all,
      // which is how the call document first shipped invisible.
      // A FIFTH TAB UNDER MINE (Eric, 2026-09-03: "a 'Personal Uploads' tab...
      // one for the 'Mine' tab"). The four-per-group rule above is a 320px
      // constraint; he asked for a tab by name, on his own phone, so the tab
      // exists and the strip may wrap on the narrowest screens. Its label is
      // the shortest word that says what it is.
      { id: 'mine', label: 'Mine', icon: '🔒', pages: ['notes', 'calldoc', 'drafts', 'saved', 'personal'] },
      // THE ACT GROUP, ON EVERY CASE NOW (Eric, 2026-08-30: "This and work
      // log should be tabs under 'act' since it has so much space"). The log
      // lived under Case since 2026-08-27 because Act only rendered on a
      // Full-Service case; rather than hide the log behind the tier gate
      // again, the gate moved: Act now exists everywhere, carrying the log
      // and the milestones feed, and only Appeals stays Full-Service.
      { id: 'act', label: 'Act', icon: '⚖️', pages: [...(data.fullAccess ? ['appeals'] : []), 'log', 'milestones'] },
    ],
    // Landing on a page IS having seen it. The badge clears here rather than
    // on some later save, so it never outlives the thing it was pointing at.
    onShow: (id) => { markSeen(caseId, id); folder?.mark(id, false); },
    pages: [
      ...(data.fullAccess ? [
        {
          id: 'appeals', title: 'Appeals', icon: '⚖️',
          render: (pane) => paintAppeals(pane),
          onShow: (pane) => pane._reload?.(),
        },
      ] : []),
      {
        id: 'overview', title: 'Overview', icon: '⚡',
        render: (pane) => { paintOverview(pane); paintAuthorityStatus(pane); },
      },
      {
        id: 'chat', title: 'Chat', icon: '💬', fade: true,
        render: (pane) => {
          pane.innerHTML = `
            <div class="panel">
              <!-- Eric, 2026-08-25: the statuses "should sit to the right of
                   'chat with client' as a dropdown so I can have it be the
                   status of what I'm working on." They were reachable only by
                   long-pressing a message, or by a 0.72rem "▾ What I'm doing"
                   floating above the log that he never found. A standing
                   state belongs where the state is, not inside a menu you
                   have to know about. -->
              <div class="chat-head">
                <h3>Chat with the client</h3>
                <label class="status-pick">
                  <span class="dim small">Working on</span>
                  <select data-status-pick aria-label="What you are working on">
                    <option value="">Nothing right now</option>
                  </select>
                </label>
              </div>
              <div class="row" data-workclock style="gap:.5rem; align-items:center; margin:.1rem 0 .5rem;">
                <button class="btn quiet" data-work-toggle style="flex:none;">▶ Start working</button>
                <!-- The total is a BUTTON and it did not look like one: 30px
                     tall, dim, a dotted underline, and a title attribute a
                     phone never shows. That is the same failure as the clock
                     switch he could not see - a control that reads as a
                     readout. It now carries the word for what it does, on the
                     face, at 44px. -->
                <button class="btn quiet work-total-btn" data-work-total
                  style="flex:none;" title="Add or subtract time on this case"></button>
                <span class="work-rate" data-work-rate hidden></span>
              </div>
              <p class="dim small" data-client-gate style="margin:.1rem 0 .4rem;" hidden></p>
              <div id="chat"></div>
            </div>`;
        },
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
      {
        // "Read", not "Advisor". The group chip above it already says Advisor
        // and carries the same 👨‍⚕️, so the two rows read as "Advisor ›
        // Advisor" with nothing to tell a tired person which is which.
        id: 'advisor', title: 'Read', icon: '📖',
        render: (pane) => { pane.innerHTML = '<div class="panel advisor-panel" id="advisor"></div>'; },
      },
      {
        // "Dx", because four tabs share this row now and "Differential" ate
        // half of it. Same page, same 🧬; Eric writes Dx everywhere anyway.
        id: 'dx', title: 'Dx', icon: '🧬',
        // The advisor owns this page and repaints it on every state poll.
        render: (pane) => { pane.innerHTML = '<p class="dim">Loading…</p>'; },
      },
      {
        // Talking to the advisor, out of the bottom of Read and onto its own
        // page. mountAdvisor moves its Q&A here when given the container.
        //
        // "Ask", not "Chat". Two tabs in this workspace were both called Chat
        // with the same 💬, one for the client and one for the advisor, and
        // nothing on either said which was which. The client one keeps the
        // word, because that is the one a client conversation is called.
        id: 'advisor-chat', title: 'Ask', icon: '🗣',
        render: (pane) => { pane.innerHTML = '<div id="advisor-chat"></div>'; },
      },
      {
        // The page id stays 'files' so a remembered tab still resolves; the
        // page itself is now everything shared on the case, from either side.
        id: 'files', title: 'Uploads', icon: '📎',
        render: (pane) => paintFiles(pane),
      },
      // AFTER 'files', NOT BEFORE 'overview'. The strip renders in THIS array's
      // order and the first page of a group in it is the tab the group opens
      // on, which is written down thirty lines below and which this ignored on
      // the first pass: defined at the top of the array, the work log became
      // the landing page of the whole chart. Two browser drives caught it,
      // measuring controls on Overview that were suddenly not on screen
      // (drive-charge: "it is a 44px target (0px)"). Opening a case lands on
      // Overview, as it always has.
      {
        id: 'log', title: 'Work log', icon: '🗒',
        render: (pane) => paintWorkLog(pane),
        onShow: (pane) => pane._reload?.(),
      },
      // The achievements feed (Eric, 2026-08-30), beside the log under Act.
      {
        id: 'milestones', title: 'Milestones', icon: '🏁',
        render: (pane) => paintMilestones(pane),
        onShow: (pane) => pane._reload?.(),
      },
      {
        id: 'about', title: 'About you', icon: '🪞',
        render: (pane) => { pane.innerHTML = '<p class="dim">Loading…</p>'; },
      },
      // THE STRIP RENDERS IN THIS ARRAY'S ORDER, not in the order a group
      // lists its pages, so the array is what decides which tab a group opens
      // on. 'calldoc' therefore comes first in Before: it is the page he asked
      // for twice and could not find, and it should be the one already open
      // when he taps the group.
      {
        // Eric, 2026-08-26. Beside Notes, because this is the other page that
        // starts from something HE wrote rather than something the app made.
        // "My doc". It is the page where HE uploads what he wrote, and that
        // is the sentence he used when he asked for it twice. "Call doc"
        // named the output; the thing he was hunting for was the input.
        id: 'calldoc', title: 'My doc', icon: '📄',
        render: (pane) => {
          pane.innerHTML = [
            '<div data-calldoc-host></div>',
            // ALSO MOVED HERE FROM DRAFTS, and for the same reason as the
            // printable below it: its own first line is "a sheet to have open
            // while you talk". That is this page's subject. It was filed on
            // the page he opens after a call, next to the drafts he sends.
            '<div data-callnotes-host></div>',
            // MOVED HERE FROM DRAFTS. All three of these end up as the sheet
            // in his hand on the call, so all three belong on the page named
            // for it. On Drafts, three tabs and a group away, this button was
            // the one he kept finding when he was hunting for the upload.
            '<div class="panel">',
            '  <h3>Print a plain prep sheet</h3>',
            '  <p class="dim small">No upload needed. Built from the read the advisor',
            '    already has, laid out to print. Nothing here decides anything for you.</p>',
            '  <button class="btn quiet" data-prep-sheet>🖨 Print a prep sheet</button>',
            '</div>',
          ].join('');
          // Built from the advisor's own sections rather than a fresh model
          // call: that read already exists and is already the one he trusts,
          // and asking twice would produce a second version to reconcile.
          pane.querySelector('[data-prep-sheet]').addEventListener('click', () => {
            const c2 = data;
            const at = c2.appointment?.start ? toDate(c2.appointment.start) : null;
            openPrepSheet({
              name: c2.clientName || c2.clientEmail || 'Call prep',
              when: at
                ? new Intl.DateTimeFormat('en-US', {
                  timeZone: MOUNTAIN_TZ, weekday: 'long', month: 'long', day: 'numeric',
                  hour: 'numeric', minute: '2-digit',
                }).format(at) + ' MST'
                : '',
              analysis: lastAnalysis,
              differential: lastDifferential,
            });
          });
          paintCallNotes(pane.querySelector('[data-callnotes-host]'));
        },
        onShow: (pane) => paintCallDoc(pane.querySelector('[data-calldoc-host]')),
      },
      {
        // fade, and so opted out of tap-to-flip: on the notes sheet a tap has
        // to place the cursor, never turn the page.
        id: 'notes', title: 'Notes', icon: '📝', fade: true,
        render: (pane) => {
          // COMPILE THE CASE FILE (Eric, 2026-08-26). He asked for this "on
          // the Mine page", and Mine already holds four tabs, which is the
          // hard width constraint at 320px: a fifth slices its own label, and
          // that is a defect he has already photographed once. So it is a card
          // at the top of Notes, which is the page in this group he opens most
          // and the one that is already his own working space, rather than a
          // tab that would break the strip to exist.
          const compileCard = document.createElement('div');
          compileCard.className = 'panel compile-card';
          compileCard.innerHTML = `
            <h3>📚 The whole case file, as one PDF</h3>
            <p class="dim small">Every file on this case in one document, grouped
              by type and then by date inside each type. Images print in full.
              A PDF, a recording or a Word file is listed with a link instead:
              a browser cannot print one document inside another.</p>
            <p><button type="button" class="btn" data-compile>Compile it</button></p>
            ${saidHtml('compile')}`;
          pane.appendChild(compileCard);
          compileCard.querySelector('[data-compile]')?.addEventListener('click', async (ev) => {
            const b = ev.currentTarget;
            b.disabled = true;
            const was = b.textContent;
            b.textContent = 'Gathering…';
            try { await compileCaseFile(); } finally { b.disabled = false; b.textContent = was; }
          });
          const notesHost = document.createElement('div');
          pane.appendChild(notesHost);
          // Private to Eric: stored under `private/`, which is browser-denied
          // in both directions, so it only ever moves through the admin-gated
          // Worker route. The saved html arrives with the advisor state poll
          // and lands via setHtml, which refuses to clobber live typing.
          notes = mountNotes({
            container: notesHost,
            initialHtml: notesHtml,
            onSave: async (html) => {
              const token = await user.getIdToken();
              const res = await fetch('/api/advisor', {
                method: 'POST',
                headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
                body: JSON.stringify({ kind: 'case', id: caseId, action: 'note', html }),
              });
              if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Save failed (${res.status})`);
            },
          });
        },
      },
      {
        // The next call's plan, built from the queue the chat lanes feed.
        // Re-fetched every time the page opens: the client adds to the list
        // from their side and a stale agenda defeats the point.
        id: 'agenda', title: 'Agenda', icon: '🗓',
        render: (pane) => paintAgendaPage(pane),
        onShow: (pane) => pane._reload?.(),
      },
      {
        // "Terms", not "Education". Education is what a syllabus is called;
        // what this page holds is the terms in THIS case, which is the thing
        // he goes looking for.
        id: 'education', title: 'Terms', icon: '📚',
        // Painted from the advisor's state poll, same as the differential.
        render: (pane) => { pane.innerHTML = '<p class="dim">Loading…</p>'; },
      },
      {
        // His bookmarks on this thread, each with a note. Private by path: a
        // client cannot read them, and nothing is written back to the message,
        // so saving one tells them nothing.
        id: 'saved', title: 'Saved', icon: '🔖',
        render: (pane) => {
          mountSaved({ container: pane, kind: 'case', id: caseId, user, myRole: 'admin' });
        },
      },
      {
        // His documents on this case, for his eyes only (Eric, 2026-09-03).
        // Through the Worker into a prefix no browser can read; nothing on
        // the client's page, nothing the advisor walks.
        id: 'personal', title: 'Personal', icon: '🤫',
        render: (pane) => {
          const host = document.createElement('div');
          pane.appendChild(host);
          mountPersonal(host, { getToken: () => user.getIdToken(), scope: 'case', caseId, open: true });
        },
      },
      {
        // One day of the thread, read back to him. His side only: he took this
        // off the client's side deliberately.
        id: 'summary', title: 'Summary', icon: '🗒',
        render: (pane) => paintSummary(pane),
      },
      {
        id: 'drafts', title: 'Drafts', icon: '✍️',
        // Today's draft panel, relocated. The advisor renders into it and
        // owns its heading and its hidden state.
        render: (pane) => {
          pane.innerHTML = [
            // The draft panel below is hidden until there is a draft, which
            // left this page reading as nothing but "Duty of care" and told
            // him nothing about why the tab is called Drafts. One line, always
            // true whether or not a draft is showing.
            '<p class="dim small" style="margin:0 0 .9rem;">Text you edit and then send.',
            '  A reply the advisor writes for you lands at the top of this page,',
            '  and you are walked here the moment it does.</p>',
            '<div class="panel draft-panel advisor-draft" id="draft-panel" hidden></div>',
            // THE PRINTABLE PREP SHEET USED TO LIVE HERE, on the page he opens
            // AFTER a call, three tabs away from the place he uploads his own
            // notes. Two different things sharing the word "prep" is what cost
            // him the notes upload for weeks; two things doing the same job on
            // two different pages is the same fault one step later. Both now
            // sit together on My doc, which is the page for the sheet he holds
            // during the call. Nothing was dropped: the same button, the same
            // openPrepSheet, one tab to the left of where it was.
            //
            // What is left on this page is one thing, said once: text you edit
            // and then send.
            '<div class="panel">',
            '  <h3>Duty of care</h3>',
            '  <p class="dim small">A draft you can edit before it goes anywhere. Also on the',
            '    composer in Chat, so it is one tap away when you want it.</p>',
            // "Draft it" only means anything if you have already read the
            // heading above it, and he scans buttons, not headings.
            '  <button class="btn" data-duty>⚕️ Draft a duty of care note</button>',
            '</div>',
          ].join('');
          // Always present, never suggested. It says nothing about this client
          // and looks identical on every case; Eric decides when he is
          // obligated, and this only saves him writing the same thing under
          // pressure at the moment he is least able to.
          pane.querySelector('[data-duty]').addEventListener('click', () => openDutyDraft({
            tz: data.clientTz || '',
            onSend: (text) => chatSend?.(text),
          }));
        },
      },
      {
        // What he asked the client for and never got. Painted from the poll.
        id: 'unanswered', title: 'Unanswered', icon: '⚠️',
        render: (pane) => { pane.innerHTML = '<p class="dim">Loading…</p>'; },
      },
    ],
  });

  // ---- who this is, and whether the clock is running -----------------------
  //
  // THIS USED TO SIT ABOVE THE TAB STRIP AND WAS NEVER ON SCREEN. folder.js
  // brings the tab strip up under the header on every page flip, and on the
  // first mount too, so anything above the strip is scrolled off before he
  // has looked at the page once. Measured at 390x844 on the demo case: the
  // header sat at y = -40 the moment the page settled. The client's name, the
  // status, and the clock switch he circled in red on a screenshot were all
  // above the fold he never sees.
  //
  // That is the whole of the "it exists but I cannot find it" complaint, in
  // one element. So it moves BELOW the strip, where the folder's own dock
  // puts it first in view, on arrival and after every single tab tap.
  const head = document.createElement('div');
  head.className = 'case-head';
  // THE MASTHEAD ANSWERS THE FIVE QUESTIONS (visual director pass,
  // 2026-08-29): who, what state, what is waiting, what happens next, when.
  // Everything below is read off the case document this page already holds;
  // nothing is fetched and nothing is new state, so the masthead can never
  // disagree with the panes underneath it.
  const nowMs = Date.now();
  const nextOf = [];
  if (c.appointment?.start && toDate(c.appointment.start).getTime() > nowMs)
    nextOf.push({ t: toDate(c.appointment.start), what: 'Call' });
  if (Array.isArray(c.checkIns))
    for (const x of c.checkIns) {
      const t = toDate(x.start);
      if (t.getTime() > nowMs) nextOf.push({ t, what: 'Check-in' });
    }
  if (c.status === 'awaiting_report' && c.reportDueAt)
    nextOf.push({ t: toDate(c.reportDueAt), what: 'Report due' });
  nextOf.sort((a, b) => a.t - b.t);
  const nextFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Phoenix', weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  const nextLine = nextOf.length && c.status !== 'closed'
    ? `<p class="case-next"><span class="case-next-k">NEXT</span> ${esc(nextOf[0].what)} &#183; ${nextFmt.format(nextOf[0].t)} MST</p>`
    : '';
  // OPEN LOOPS: the states that end only when he acts. Same flags the
  // dashboard gathers, painted where the case itself is open.
  const loops = [];
  if (c.needsReschedule) loops.push(['hot', 'Needs rescheduling']);
  if (c.pendingTelehealth?.state === 'requested') loops.push(['hot', 'Telehealth to confirm']);
  if (c.status === 'awaiting_report' && c.reportDueAt) {
    const days = Math.ceil((toDate(c.reportDueAt).getTime() - nowMs) / 86_400_000);
    if (days < 0) loops.push(['hot', `Report overdue ${-days}d`]);
  }
  if (c.hold?.pausedAt) loops.push(['warm', 'Case paused']);
  const loopRow = loops.length && c.status !== 'closed'
    ? `<p class="loop-chips">${loops.map(([tone, t]) =>
      `<span class="loop-chip ${tone}">${esc(t)}</span>`).join('')}</p>`
    : '';
  head.innerHTML = `
    <div class="case-who">
      <span class="case-name" data-client>${esc(c.clientName || c.clientEmail || c.clientUid)}</span>
      <span class="status-pill" data-status>${(c.status || '?').replace('_', ' ').toUpperCase()}</span>
    </div>
    ${loopRow}
    ${nextLine}
    ${c.status === 'closed' ? '' : `
    <button type="button" class="btn quiet work-head" data-work-head
      aria-label="Clock in or out of this case">⏱</button>`}
    <p class="dim small working-line" data-working hidden></p>
    <div class="doing-row" data-doing-row hidden>
      <span class="dim small">The client reads:</span>
      <span class="doing-pills" data-doing-pills></span>
    </div>`;
  const strip = el.querySelector('[data-folder] .folder-tabs');
  if (strip) strip.after(head);
  else el.prepend(head);          // no strip is not a reason to lose the clock
  // The clock-in switch beside the client's name (Eric, 2026-08-25: "Three
  // places for this, all linked"). Mounted here so it works without ever
  // opening Chat.
  startHeadClock(c);

  // The dropdown beside the heading. Built from STATUS_REACTIONS so it can
  // never drift from the long-press menu or from the Worker's wording.
  const statusPick = folder.el('chat').querySelector('[data-status-pick]');
  if (statusPick) {
    for (const r of STATUS_REACTIONS) {
      const o = document.createElement('option');
      o.value = r.id;
      o.textContent = `${r.emoji} ${r.label}`;
      statusPick.appendChild(o);
    }
  }

  const chat = mountChat({
    // Show what is already set, so it reads as a state and not as a button
    // that fires and forgets.
    onStatus: (id) => { if (statusPick && statusPick.value !== id) statusPick.value = id; },
    container: folder.el('chat').querySelector('#chat'),
    // Show what is already set, so the control reads as a state rather than
    // as a button that fires and forgets.
    onStatus: (id) => { if (statusPick && statusPick.value !== id) statusPick.value = id; },
    parentPath: ['cases', caseId],
    user,
    myRole: 'admin',
    saveUid: c.clientUid,
    disabled: c.status === 'closed',
    notice: 'Chat ended when this case closed.',
    // Always there, on every case, saying nothing about anyone. The point is
    // that it is one tap from the conversation rather than four taps away on
    // the last page, because the moment he wants it is not a moment for
    // navigating.
    composerButton: [{
      icon: '⚕️',
      title: 'Duty of care draft',
      onClick: () => openDutyDraft({
        tz: data.clientTz || '',
        onSend: (text) => chatSend?.(text),
      }),
    }, {
      // THE MESSAGE MAKER, WHERE HE TYPES (Eric, 2026-08-30: "So it should
      // be on the chat page. Not advisor."). He writes the rough message in
      // the box he was already in; this turns it into the full one, in
      // place, through the same machinery as the Read page's Prepare a
      // response. His rough text is the whole brief, per 2026-08-30's rule.
      icon: '✍️',
      title: 'Make what I typed a full message',
      onClick: async ({ input, button }) => {
        if (!input || button.disabled) return;
        const rough = input.value.trim();
        if (!rough) {
          alert('Type your rough message first. I turn what is in the box into the full message.');
          return;
        }
        button.disabled = true;
        const was = button.textContent;
        button.textContent = '⏳';
        const started = Date.now();
        let earlyErr = null;
        try {
          const token = await user.getIdToken();
          const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
          // Fire the run without waiting out its whole life: the state poll
          // below owns the outcome, and a proxy that cuts a long request
          // must not read as failure. A refusal that comes back fast (bad
          // request, signed out) still surfaces through earlyErr.
          fetch('/api/advisor', {
            method: 'POST', headers: auth,
            body: JSON.stringify({ action: 'draft', kind: 'case', id: caseId, instruction: rough }),
          }).then(async (res) => {
            if (!res.ok) earlyErr = (await res.json().catch(() => ({}))).error || `Failed (${res.status})`;
          }).catch(() => { /* the poll decides; a dropped connection is not a verdict */ });
          for (;;) {
            await new Promise((r) => setTimeout(r, 2500));
            if (earlyErr) throw new Error(earlyErr);
            if (Date.now() - started > 180_000)
              throw new Error('Still working on it. When it finishes, the message will be waiting under Prepare a response on the Read page.');
            const st = await fetch(`/api/advisor/state?kind=case&id=${encodeURIComponent(caseId)}`,
              { headers: { authorization: `Bearer ${token}` } }).catch(() => null);
            const out = st && st.ok ? await st.json().catch(() => ({})) : {};
            const d = out.state || {};
            if (d.draftStatus === 'ready' && d.draft
              && new Date(d.draftAt || 0).getTime() >= started - 5000) {
              input.value = d.draft;
              input.style.height = 'auto';
              input.style.height = `${input.scrollHeight}px`;
              input.focus();
              return;
            }
            if (d.draftStatus === 'error' && d.draftError
              && new Date(d.draftStartedAt || d.draftAt || 0).getTime() >= started - 5000)
              throw new Error(d.draftError);
          }
        } catch (e) {
          alert(e.message);
        } finally {
          button.disabled = false;
          button.textContent = was;
        }
      },
    }],
  });

  // Setting it: the chat module owns the write, because it knows which
  // message is newest and the status still lands there.
  statusPick?.addEventListener('change', async () => {
    const want = statusPick.value;
    const was = chat.currentStatus();
    statusPick.disabled = true;
    try {
      await chat.setStatus(want);
    } catch (err) {
      statusPick.value = was;          // put it back rather than lie
      alert(err.message || "Couldn't set that");
    }
    statusPick.disabled = false;
  });

  chatSend = (text) => chat.send(text);
  startWorkClock(c);
  // Whether THEIR side of this chat is open yet, so silence before a far-out
  // call reads as the gate doing its job rather than a client ignoring him.
  {
    const gateEl = document.querySelector('[data-client-gate]');
    const startMs = c.appointment?.start ? toDate(c.appointment.start).getTime() : null;
    if (gateEl && !c.chatUnlocked && startMs && startMs - Date.now() > 7 * 86_400_000) {
      const opens = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' })
        .format(new Date(startMs - 7 * 86_400_000));
      gateEl.textContent = `🔒 Their chat opens ${opens} (one week before the call). They can open it early for the $50 direct line fee.`;
      gateEl.hidden = false;
    } else if (gateEl && c.chatUnlocked) {
      gateEl.textContent = '🔓 They paid the $50 to open chat early.';
      gateEl.hidden = false;
    }
  }

  // Admin-only, and admin-only by rule — see the `advisor` match in
  // firestore.rules. An approved draft goes out through the same send path as
  // anything I type, so it lands as an ordinary message from me.
  mountAdvisor({
    container: folder.el('advisor').querySelector('#advisor'),
    kind: 'case',
    id: caseId,
    user,
    onSend: (text) => chat.send(text),
    // Drafts live on their own page, not buried inside the panel.
    draftContainer: folder.el('drafts').querySelector('#draft-panel'),
    // The differential renders onto its own page too.
    diffContainer: folder.el('dx'),
    // And the Q&A - asking the advisor - onto its own Chat page.
    qaContainer: folder.el('advisor-chat').querySelector('#advisor-chat'),
    // Lets the panel walk him to a page - today, to Drafts the moment the
    // draft he asked for lands, instead of leaving it to appear silently.
    goTo: (page) => folder.show(page),
  });

  renderedFor = caseId;
}

/**
 * The client's review of this case, and the decision to publish it or not.
 *
 * Publishing a client's words under their own name is not a decision that
 * belongs to a checkbox they ticked while still upset or still grateful, so
 * nothing reaches the reviews page until Eric says so, and he can take it back
 * afterwards.
 */
let reviewKey = null;
async function paintCaseReview(pane) {
  const host = pane?.querySelector('[data-case-review]');
  if (!host) return;
  let review = null;
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/reviews/admin', { headers: { authorization: `Bearer ${token}` } });
    if (res.ok) review = ((await res.json()).reviews || []).find((r) => r.caseId === caseId) || null;
  } catch { /* the overview is still usable without it */ }

  const key = JSON.stringify(review);
  // paintOverview rebuilds this pane first, so the key can match while the
  // host is empty - which left "Loading..." on screen permanently.
  if (key === reviewKey && host.dataset.painted === '1') return;
  reviewKey = key;
  host.dataset.painted = '1';

  if (!review) {
    host.innerHTML = '<p class="dim small">No review yet. The card opens on their side once the report is delivered.</p>';
    return;
  }
  host.innerHTML = `
    <div class="row">
      <span class="review-stars" role="img" aria-label="${review.stars} out of 5">${'★'.repeat(review.stars)}${'☆'.repeat(5 - review.stars)}</span>
      <span class="status-pill ${review.published ? '' : 'closed'}">${review.published ? 'PUBLISHED' : 'PRIVATE'}</span>
    </div>
    ${review.text ? `<blockquote class="review-quote"></blockquote>` : '<p class="dim small">Stars only, no words.</p>'}
    <div class="actions">
      <button class="btn ${review.published ? 'quiet' : 'glow'}" data-publish="${review.published ? '0' : '1'}">
        ${review.published ? 'Take it off the reviews page' : 'Publish to the reviews page'}
      </button>
    </div>`;
  // Their words as text, never as markup.
  const quote = host.querySelector('.review-quote');
  if (quote) quote.textContent = review.text;

  host.querySelector('[data-publish]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/reviews/admin', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ id: review.id, publish: btn.dataset.publish === '1' }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Failed (${res.status})`);
      reviewKey = null;
      paintCaseReview(pane);
    } catch (err) {
      btn.disabled = false;
      alert(err.message);
    }
  });
}

/**
 * 📚 Education. Every term and disease the advisor has raised, grouped by what
 * kind of thing it is. Ticking one stops it being highlighted and stops it
 * being explained again anywhere, and tells the advisor where his knowledge
 * actually is. Diseases carry mechanism, treatment and outlook, because a
 * definition alone does not help him argue with a specialist.
 */
const CATEGORY_ORDER = ['Condition', 'Symptom', 'Test or lab', 'Medication', 'Procedure', 'Anatomy', 'Concept', 'General'];

let eduKey = null;
/**
 * Things he asked for and has not received, oldest first, because the oldest
 * is the one quietly holding the case up.
 *
 * Two actions per row, both reusing what already works: asking again is the
 * same long-press-to-send that "Worth asking" has, and marking one answered is
 * the same dismissal as a correction.
 */
/**
 * One day of the thread. He picks a date, presses once, and reads it. Once per
 * day per case: the first press generates and caches it, every press after
 * that serves the same words back, because a record of a day that changes
 * every time you look at it is not a record.
 */
// ---- the Agenda page: the next-call queue becomes the call plan ----
// The lanes on the client's composer send everything that is not logistics
// or urgent here instead of into the chat. This page is where that time
// comes back: check items off during the call, export the post-call summary,
// clear the covered ones for next time.
function paintAgendaPage(pane) {
  if (!pane) return;
  pane.innerHTML = `
    <div class="panel">
      <h3>🗓 Next call agenda</h3>
      <p class="dim small">Built from what you and the client put on the list.
        Check things off during the call; Export writes the post-call summary
        for you.</p>
      <ul data-alist style="margin:.4rem 0 0; padding-left:0;"><li class="dim small" style="list-style:none;">Loading…</li></ul>
      <form data-aform style="display:flex; gap:.4rem; margin-top:.6rem;">
        <input type="text" maxlength="500" placeholder="Add an item…" style="flex:1; min-width:0;">
        <button class="btn quiet" type="submit">Add</button>
      </form>
      <div class="row" style="gap:.5rem; margin-top:.7rem; flex-wrap:wrap;">
        <button class="btn" data-aexport>⬇ Export call summary</button>
        <button class="btn quiet" data-aclear>Clear covered items</button>
      </div>
      <p class="error" data-aerr hidden style="margin:.5rem 0 0;"></p>
      <div data-aout hidden style="margin-top:.7rem;">
        <textarea data-atext rows="10" style="width:100%;"></textarea>
        <div class="row" style="gap:.5rem; margin-top:.4rem;">
          <button class="btn quiet" data-acopy>Copy</button>
          <button class="btn quiet" data-asend>Send to client</button>
        </div>
      </div>
    </div>`;

  let items = [];
  const listEl = pane.querySelector('[data-alist]');
  const errEl = pane.querySelector('[data-aerr]');
  const showE = (e) => { errEl.textContent = e.message || String(e); errEl.hidden = false; };

  const post = async (payload) => {
    const token = await user.getIdToken();
    const res = await fetch('/api/agenda', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: caseId, ...payload }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
    return out;
  };

  const paint = () => {
    if (!items.length) {
      listEl.innerHTML = '<li class="dim small" style="list-style:none;">Nothing queued yet. What the client files under "Bring to next call" lands here, and you can add your own.</li>';
      return;
    }
    listEl.innerHTML = items.map((i) => `
      <li style="margin:.3rem 0; list-style:none;">
        <label style="display:flex; gap:.45rem; align-items:flex-start; cursor:pointer;">
          <input type="checkbox" data-adone="${esc(i.id)}" ${i.done ? 'checked' : ''} style="margin-top:.2rem;">
          <span${i.done ? ' class="dim" style="text-decoration:line-through;"' : ''}>${esc(i.text)}
            <span class="dim small">· ${i.role === 'admin' ? 'you' : 'client'}</span></span>
        </label>
      </li>`).join('');
  };

  const load = async () => {
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/agenda?id=${encodeURIComponent(caseId)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      items = (await res.json()).items || [];
      paint();
    } catch (e) { showE(e); }
  };
  pane._reload = load;
  load();

  listEl.addEventListener('change', async (e) => {
    const id = e.target?.dataset?.adone;
    if (!id) return;
    const done = e.target.checked;
    try {
      await post({ action: 'done', itemId: id, done });
      const it = items.find((x) => x.id === id);
      if (it) it.done = done;
      paint();
    } catch (err) { e.target.checked = !done; showE(err); }
  });

  pane.querySelector('[data-aform]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    errEl.hidden = true;
    try {
      const out = await post({ action: 'add', text });
      items.push(out.item);
      paint();
    } catch (err) { input.value = text; showE(err); }
  });

  pane.querySelector('[data-aexport]').addEventListener('click', () => {
    const day = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      .format(new Date());
    const covered = items.filter((i) => i.done);
    const open = items.filter((i) => !i.done);
    const text = [
      `Call summary, ${day}`,
      '',
      'What we covered:',
      covered.length ? covered.map((i) => `- ${i.text}`).join('\n') : '- (nothing checked off yet)',
      '',
      'Still on the list for next time:',
      open.length ? open.map((i) => `- ${i.text}`).join('\n') : '- Nothing. The list is clear.',
      '',
    ].join('\n');
    const out = pane.querySelector('[data-aout]');
    out.hidden = false;
    out.querySelector('[data-atext]').value = text;
  });

  pane.querySelector('[data-acopy]').addEventListener('click', async (e) => {
    try {
      await navigator.clipboard.writeText(pane.querySelector('[data-atext]').value);
      e.target.textContent = 'Copied ✓';
      setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
    } catch { /* the textarea is right there to select by hand */ }
  });

  pane.querySelector('[data-asend]').addEventListener('click', async (e) => {
    // The chat rejects messages over 2000 characters; a call summary that
    // long should be trimmed in the box first anyway.
    const text = pane.querySelector('[data-atext]').value.trim().slice(0, 1900);
    if (!text) return;
    e.target.disabled = true;
    try {
      await chatSend?.(text);
      e.target.textContent = 'Sent ✓';
      setTimeout(() => { e.target.textContent = 'Send to client'; e.target.disabled = false; }, 1500);
    } catch (err) { e.target.disabled = false; showE(err); }
  });

  pane.querySelector('[data-aclear]').addEventListener('click', async () => {
    try {
      await post({ action: 'clear' });
      items = items.filter((i) => !i.done);
      paint();
    } catch (err) { showE(err); }
  });
}

/**
 * The work clock. The client sees the total on their own page (Eric,
 * 2026-08-22: "the cost is a toggle per client... They can see this").
 *
 * MANUAL, both directions (Eric, 2026-08-25: "All clocks in/clock out
 * buttons are manual. Nothing automatic." - superseding his earlier
 * chart-entry auto-start order). Three switches, one clock: the shelf card,
 * the button beside the status pill in this chart's header, and the row in
 * the Chat pane. They all talk to /api/work through postWork and paint from
 * ONE module-level state object, so no two of them can ever disagree.
 *
 * The painters live in a Set keyed by their root element: the header button
 * exists from page load, the chat row only once that pane renders, and a
 * poll that repainted only one of them showed two different clocks.
 */
let workTick = null;
// `mark` is work.tierMark: where the case-review clock ended and the
// Full-Service clock began (Eric, 2026-08-29: "Two clocks for two different
// tiers"). Zero on a case that never went Full-Service.
const clock = { seconds: 0, startedAt: 0, mark: 0, loaded: false, doing: '' };
const clockPaints = new Set();
const paintClock = () => {
  for (const f of [...clockPaints]) {
    if (f.root && !f.root.isConnected) { clockPaints.delete(f); continue; }
    f();
  }
};

/**
 * TODAY'S HOURS beside the total (Eric, 2026-08-29: "a daily hours/min
 * logged for the day for a running clock, seen next to the total. Only seen
 * on my side."). The banked half lives on the worker-only clock doc and
 * arrives two ways: the presence beacon's answer (relayed as pa-day-log by
 * admin-presence.js, stashed on window for anything that painted first) and
 * every /api/work reply. NaN means no answer has carried it yet, and the
 * painters say nothing rather than a made-up zero.
 */
const dayLog = { seconds: Number(window.__paDayLog?.[caseId]) };
window.addEventListener('pa-day-log', (e) => {
  const got = Number(e.detail?.byCase?.[caseId]);
  dayLog.seconds = Number.isFinite(got) ? Math.max(0, Math.floor(got)) : 0;
  paintClock();
});
/** Banked-today plus the live stretch, the stretch clipped at HIS midnight
 *  (America/Boise, matching the Worker) so an overnight accident never reads
 *  as this morning's work. NaN through and through while unknown. */
const liveDaySeconds = () => {
  if (!Number.isFinite(dayLog.seconds)) return NaN;
  if (!clock.startedAt) return dayLog.seconds;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Boise', hour12: false,
    hour: 'numeric', minute: 'numeric', second: 'numeric',
  }).formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t)?.value) || 0;
  const sinceMidnight = (get('hour') % 24) * 3600 + get('minute') * 60 + get('second');
  const stretch = Math.min(Math.floor((Date.now() - clock.startedAt) / 1000), 12 * 3600);
  return dayLog.seconds + Math.max(0, Math.min(stretch, sinceMidnight));
};
/** The " · 2h 10m today" tail, or nothing while unknown or under a minute. */
const dayTail = () => {
  const d = liveDaySeconds();
  return Number.isFinite(d) && d >= 60 ? ` · ${fmtHm(d)} today` : '';
};
/** Banked plus the live stretch, clamped like every sibling renderer:
 *  clock.startedAt is the SERVER's clock (a phone seconds behind it rendered
 *  "-1h -1m · running"), and a stretch forgotten over a weekend banks at most
 *  twelve hours, so all three switches and the bank agree on one number. */
const liveStretch = () => (clock.startedAt
  ? Math.max(0, Math.min(Math.floor((Date.now() - clock.startedAt) / 1000), 12 * 3600))
  : 0);
const liveClockSeconds = () => Math.max(0, clock.seconds - (clock.mark || 0)) + liveStretch();
/** The case-lifetime total, review hours included. The hourly instrument
 *  reads THIS one: the money paid covers both tiers, so dividing it by only
 *  the Full-Service clock would flatter every rate on the page. */
const liveTotalSeconds = () => Math.max(0, clock.seconds) + liveStretch();
/** One ticking repaint for however many switches exist. A minute is plenty. */
function armClockTick() {
  clearInterval(workTick);
  workTick = setInterval(() => { if (clock.startedAt) paintClock(); }, 30_000);
}

/**
 * WHAT HE IS DOING, told to the client (Eric, 2026-09-03: "Add 'Eric is on
 * the phone with a clinic department...' for 'working on' in the chat").
 * Six presets and a free line, shown under the ⏱ while the clock runs. The
 * client's page and chat header read the line in place of "working on it
 * right now"; the Worker clears it on every stop.
 */
const DOING_PRESETS = [
  'on the phone with a clinic department',
  'reading your records',
  'writing your report',
  'working on an appeal',
  'chasing a records request',
  'scheduling with a clinic',
];
function paintDoing() {
  const row = document.querySelector('[data-doing-row]');
  if (!row) return;
  row.hidden = !clock.startedAt;
  if (!clock.startedAt) return;
  const host = row.querySelector('[data-doing-pills]');
  const current = clock.doing || '';
  host.innerHTML = DOING_PRESETS.map((t) =>
    `<button type="button" class="pill${t === current ? ' on' : ''}" data-doing="${esc(t)}">${esc(t)}</button>`).join('')
    + `<button type="button" class="pill${current && !DOING_PRESETS.includes(current) ? ' on' : ''}" data-doing-other>${
      current && !DOING_PRESETS.includes(current) ? esc(current) : 'something else…'}</button>`
    + (current ? '<button type="button" class="pill" data-doing-clear>clear</button>' : '');
  host.querySelectorAll('[data-doing]').forEach((b) => b.addEventListener('click', () =>
    postWork({ doing: b.dataset.doing }).catch((e) => alert(e.message))));
  host.querySelector('[data-doing-other]')?.addEventListener('click', () => {
    const typed = prompt('In a few words, what are you doing? The client reads this beside the clock.', current || '');
    if (typed === null) return;
    postWork({ doing: typed.trim().slice(0, 80) }).catch((e) => alert(e.message));
  });
  host.querySelector('[data-doing-clear]')?.addEventListener('click', () =>
    postWork({ doing: '' }).catch((e) => alert(e.message)));
}
clockPaints.add(paintDoing);

/** One place that talks to /api/work, so every path updates the same state. */
async function postWork(payload) {
  const token = await user.getIdToken();
  const res = await fetch('/api/work', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ caseId, ...payload }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
  clock.seconds = Number(out.seconds) || 0;
  // The Worker sends the ORIGINAL start when the clock was already running,
  // so re-entering a chart mid-stretch keeps counting rather than appearing
  // to reset to the banked total.
  clock.startedAt = out.startedAt ? new Date(out.startedAt).getTime() : 0;
  if (out.tierMark !== undefined) clock.mark = Math.max(0, Number(out.tierMark) || 0);
  // The doing line rides on every answer that carries it; a stop carries none
  // and the clock's own start clears it, so the pills follow the truth.
  if (out.doing !== undefined) clock.doing = out.doing || '';
  if (out.running === false) clock.doing = '';
  clock.loaded = true;
  // Every answer carries today's banked figure, so a stop or a correction
  // moves the day line in the same paint as the total.
  if (out.todaySeconds !== undefined) {
    dayLog.seconds = Math.max(0, Math.floor(Number(out.todaySeconds) || 0));
  }
  paintClock();
  return out;
}

// The chart-entry auto-start that used to live here is retired (Eric,
// 2026-08-25: "All clocks in/clock out buttons are manual. Nothing
// automatic."), along with the per-session suppress flag whose only job was
// stopping the auto-start from undoing a hand stop. The Worker refuses
// `auto` starts too, so a stale tab running the old code changes nothing.

/**
 * The answer half of the reminder. Rungs at 5, 10 and 30 minutes and then
 * every hour for as long as the clock runs - the ladder used to stop at 30
 * and go silent, which is how ten hours banked themselves. The push lands on
 * `?clock=ask`, and the honest thing to offer is a stop that banks to when
 * the app was last open rather than to now - otherwise saying "no, I
 * finished a while ago" would still charge the client for the while.
 */
function askIfStillWorking() {
  const params = new URLSearchParams(location.search);
  if (params.get('clock') !== 'ask') return;
  // Take it out of the URL immediately: a reload or a shared link should not
  // ask again about a question already answered.
  params.delete('clock');
  history.replaceState({}, '', `${location.pathname}?${params}`);

  // NOT #case: render() replaces that element's innerHTML wholesale, and this
  // card has to outlive it.
  const el = document.querySelector('main') || document.body;
  const card = document.createElement('div');
  card.className = 'panel';
  card.style.cssText = 'margin:.6rem 0;';
  card.innerHTML = `
    <h3 style="margin:0 0 .3rem;">Still working on this one?</h3>
    <p class="dim small" style="margin:0 0 .6rem;">The clock is running and the
      app had been closed a while. If you finished earlier, stopping here banks
      the time up to when you last had the app open, not up to now.</p>
    <div class="row" style="gap:.5rem; flex-wrap:wrap;">
      <button class="btn glow" data-clock-yes style="flex:none;">Yes, still on it</button>
      <button class="btn quiet" data-clock-no style="flex:none;">No, stop it</button>
    </div>
    <p class="dim small" data-clock-said style="margin:.5rem 0 0;" hidden></p>`;
  el.prepend(card);

  const said = card.querySelector('[data-clock-said]');
  card.querySelector('[data-clock-yes]').addEventListener('click', () => {
    // Being here is the answer: this page's beacon has already re-armed the
    // ladder, so the next absence asks again from five minutes.
    card.remove();
  });
  card.querySelector('[data-clock-no]').addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      const out = await postWork({ on: false, backdate: true });
      const to = out.bankedTo ? new Date(out.bankedTo) : null;
      said.textContent = to
        ? `Stopped. Banked up to ${to.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}, when you last had the app open.`
        : 'Stopped.';
      said.hidden = false;
      setTimeout(() => card.remove(), 6000);
    } catch (err) {
      said.textContent = `Couldn't stop it: ${err.message}`;
      said.hidden = false;
      e.currentTarget.disabled = false;
    }
  });
}

/** Seed the shared state from the case doc, once. */
function seedClock(c) {
  if (clock.loaded) return;
  const w = c?.work || {};
  clock.seconds = Math.max(0, Number(w.seconds) || 0);
  clock.startedAt = w.startedAt ? toDate(w.startedAt).getTime() : 0;
  clock.mark = Math.max(0, Number(w.tierMark) || 0);
  clock.doing = w.startedAt && typeof w.doing === 'string' ? w.doing : '';
}

/** The tap every switch shares: flip, tell the Worker, repaint them all. */
function wireClockToggle(btn) {
  btn.addEventListener('click', async () => {
    const want = !clock.startedAt;
    btn.disabled = true;
    try {
      await postWork({ on: want, auto: false });
    } catch (err) {
      alert(`Couldn't change the clock: ${err.message}`);
    }
    btn.disabled = false;
  });


  // The tap-to-correct sheet is NOT wired here. It belongs to the total,
  // not the toggle, and lives in wireClockFix below. Merging main into this
  // branch dropped main's older copy of that sheet into this function, where
  // its totalEl / live() / paint() bindings do not exist - the page threw
  // "totalEl is not defined" and rendered nothing at all. Removed, not moved:
  // wireClockFix already does the same job against the shared clock state.
}

/** Seconds as "10h 40m", the one shape the clock is written in. */
function fmtHm(sec) {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${h ? `${h}h ` : ''}${m}m`;
}

/**
 * The switch beside the status pill, above all the tabs (Eric, 2026-08-25,
 * with the spot circled in red on a screenshot). Compact: the glyph, the
 * total, and a running glow; the chat row below carries the words and the
 * margin badge.
 */
function startHeadClock(c) {
  const btn = document.querySelector('[data-work-head]');
  if (!btn) return;
  seedClock(c);
  // IT HAS TO SAY WHICH WAY IT IS, IN A WORD (Eric, 2026-08-26: "a toggle
  // on/off switch for working on a client from their Manila envelope").
  //
  // This control was already here, in the spot he circled in red. What it was
  // not was legible as a SWITCH. It read `▶ 15h 25m`, and a play glyph beside
  // a running total is genuinely ambiguous: it can be read as "this is
  // playing" just as easily as "tap to play". Fifteen hours on the face makes
  // the wrong reading the natural one.
  //
  // That ambiguity has already cost him once. Ten hours ran on his only client
  // because a toggle was left on and nothing on the screen said so loudly
  // enough. So the state is now a word, not a glyph to interpret: WORKING when
  // it is on, Start when it is not, with the total kept beside it either way
  // because the total is the number a client can see.
  const paint = () => {
    const t = liveClockSeconds();
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const total = `${h ? `${h}h ` : ''}${m}m`;
    const on = !!clock.startedAt;
    // The day tail rides beside the total (Eric, 2026-08-29), on the face,
    // because a title attribute is invisible on the phone this is used from.
    btn.textContent = on ? `● WORKING · ${total}${dayTail()}` : `▶ Start · ${total}${dayTail()}`;
    btn.classList.toggle('glow', on);
    btn.classList.toggle('clock-on', on);
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
    btn.setAttribute('aria-label', on
      ? `On the clock for this case, ${total} so far. Tap to clock out.`
      : `Off the clock. ${total} banked. Tap to clock in.`);
    btn.title = on
      ? 'On the clock for this case. Tap to clock out.'
      : 'Tap to clock in on this case.';
  };
  paint.root = btn;
  clockPaints.add(paint);
  paint();
  armClockTick();
  wireClockToggle(btn);
}

function startWorkClock(c) {
  const row = document.querySelector('[data-workclock]');
  if (!row) return;
  const btn = row.querySelector('[data-work-toggle]');
  const totalEl = row.querySelector('[data-work-total]');
  seedClock(c);

  const rateEl = row.querySelector('[data-work-rate]');
  const paint = () => {
    const t = liveClockSeconds();
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const total = `${h ? `${h}h ` : ''}${m}m`;
    totalEl.innerHTML = `${esc(total)} ${clock.mark ? 'since Full-Service began' : 'on this case'}${esc(dayTail())}${clock.startedAt ? ' · running' : ''}<span class="fixit">✎ fix</span>`;
    totalEl.setAttribute('aria-label',
      `${total} banked on this case.${dayTail() ? `${dayTail().replace(' · ', ' ')} of that was logged today.` : ''} Tap to add or subtract time.`);
    totalEl.classList.toggle('on', !!clock.startedAt);
    // The margin line, live beside the clock that produces it.
    //
    // IT READS `data`, NOT THE `c` THIS FUNCTION WAS HANDED. startWorkClock
    // runs ONCE per case, from render(), and closed over the case document as
    // it stood at that moment. load() reassigns `data` and deliberately does
    // not re-render the Chat pane, so once a payment was recorded this pill
    // went on printing the old hourly for as long as the page stayed open.
    // The save worked and the screen said otherwise, which is the one pair
    // that must never be made to look identical.
    const live = data || c;
    if (rateEl) {
      const hourly = effectiveHourly(live, liveTotalSeconds());
      const paid = paidCents(live);
      // THREE STATES, and the third is the one that most needs saying. It used
      // to hide itself whenever there was no hourly, so a case with no
      // recorded payment showed nothing at all in the one spot built to tell
      // him about his money. The .unknown style was written for exactly this
      // case and nothing had ever set it.
      //
      // It is a READOUT, not a control. It carries no click handler: the
      // control is the labelled row in Settings, and two controls writing one
      // number is how they end up disagreeing. The cog glyph says where to go.
      rateEl.hidden = false;
      rateEl.classList.toggle('unknown', paid === null);
      rateEl.classList.toggle('under', hourly !== null && hourly < floorCents);
      if (paid === null) {
        rateEl.textContent = '⚙ no payment recorded';
        rateEl.title = 'Settings has a box for what this client actually paid. Fill it in and the hourly appears here.';
      } else if (hourly === null) {
        rateEl.textContent = `$${dollars(paid)} paid`;
        rateEl.title = 'The hourly appears once six minutes are on the clock.';
      } else {
        rateEl.textContent = `$${dollars(hourly)}/hr`;
        rateEl.title = hourly < floorCents
          ? `Below your $${dollars(floorCents)}/hr floor. $${dollars(paid)} paid so far.`
          : `$${dollars(paid)} paid so far.`;
      }
    }
    btn.textContent = clock.startedAt ? '⏸ Stop working' : '▶ Start working';
    btn.classList.toggle('glow', !!clock.startedAt);
  };
  paint.root = row;
  clockPaints.add(paint);
  paint();
  armClockTick();
  wireClockToggle(btn);
  // The time itself opens the sheet (Eric, 2026-08-25: "tap on the time").
  wireClockFix(totalEl);
  // THE PILL NO LONGER TAKES A TAP. It used to open a prompt() that wrote
  // paidOverrideCents, and that control failed him in every way a control can:
  // 0.72rem dim monospace with no pointer, no role, no accessible name and no
  // verb, explained only by a title attribute a phone never renders, sitting
  // on the Chat page rather than anywhere he would look for money. Worse, it
  // said nothing back - say('paid', ...) wrote into a key with no slot on the
  // page, so both failures and the success were silent, and the stale closure
  // above meant even a save that landed changed nothing on screen.
  //
  // The replacement is a labelled row in Settings with the client's name on
  // it. Leaving this one wired as well would be two controls for one number,
  // which is the thing that must not happen, so it is a readout now.
}

/**
 * A payment was recorded from the Settings cog. Re-read the case and repaint.
 *
 * The number it changes shows in three places on this page - the rate pill on
 * Chat, the PAID row on Overview, and the hourly the pill is worked out from -
 * and NONE of them repaint on their own. load() re-reads the document, then
 * refreshes the header and the Overview; the pill above now reads `data`, so
 * it follows the same re-read. Registered once, at module scope, beside the
 * other document listener rather than inside a paint function.
 */
document.addEventListener('pa-case-money', async () => {
  await load();
  // load() refreshes the header and the Overview and deliberately leaves the
  // Chat pane alone, so the rate pill would sit on the old hourly until the
  // 30-second tick came round. Thirty seconds of a stale number after a save
  // is the same silence in a smaller size.
  paintClock();
});

/**
 * Correcting a total, for a clock left running by mistake.
 *
 * Eric, 2026-08-25: "I should be able to tap on the time and subtract time or
 * add time (hours + minutes with the iOS scroll wheel widget)."
 *
 * So the TIME ITSELF is the control, and the amount is picked rather than
 * typed. Two <select>s, because on iOS that is precisely the native wheel he
 * means - a text box asking for "2h 15m" is the wrong shape on a phone and
 * makes him do arithmetic while annoyed.
 *
 * He adds or subtracts an AMOUNT rather than setting a total, which is how
 * the mistake actually presents: "that ran about ten hours too long". The
 * page does the arithmetic and sends the finished total, so the Worker still
 * takes one absolute number and a retry cannot double-apply.
 */
function wireClockFix(btn) {
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (document.getElementById('pa-clock-fix')) return;
    const now = liveClockSeconds();
    const opt = (n, sel) => `<option value="${n}"${n === sel ? ' selected' : ''}>${n}</option>`;
    const hours = Array.from({ length: 25 }, (_, n) => opt(n, 0)).join('');
    const mins = Array.from({ length: 60 }, (_, n) => opt(n, 0)).join('');

    const overlay = document.createElement('div');
    overlay.id = 'pa-clock-fix';
    overlay.className = 'settings-overlay';
    overlay.innerHTML = `
      <div class="settings-card" role="dialog" aria-modal="true" aria-label="Fix the clock">
        <div class="row"><h3 style="margin:0;">⏱ Fix the clock</h3>
          <button class="btn quiet" data-x>Cancel</button></div>
        <p class="dim small" style="margin:.2rem 0 .8rem;">This case reads
          <strong style="color:var(--ink)" data-cur>${fmtHm(now)}</strong>.
          Your client can see this number, so the change is written onto the case.</p>
        <div class="row" style="gap:.5rem; align-items:flex-end;">
          <label class="dim small" style="flex:1;">Hours
            <select data-h>${hours}</select></label>
          <label class="dim small" style="flex:1;">Minutes
            <select data-m>${mins}</select></label>
        </div>
        <p class="dim small" style="margin:.7rem 0 .2rem;">New total:
          <strong style="color:var(--ink)" data-preview>${fmtHm(now)}</strong></p>
        ${(data || {}).fullAccess ? `
        <p class="dim small" data-markrow style="margin:.8rem 0 .2rem; border-top:1px solid rgba(127,127,127,.25); padding-top:.6rem;">${
  clock.mark
    ? `Case review clock: <strong style="color:var(--ink)">${fmtHm(clock.mark)}</strong>, kept apart since the case went Full-Service. The number above is the Full-Service clock.`
    : 'This number still includes the case review hours.'
} <button type="button" class="btn quiet tiny" data-markhere style="margin-left:.3rem;">${
  clock.mark ? 'Restart the Full-Service clock from here' : 'Start the Full-Service clock from here'
}</button></p>` : ''}
        <p class="error" data-err hidden></p>
        <div class="actions" style="margin-top:.5rem;">
          <button class="btn" data-sub>− Subtract</button>
          <button class="btn" data-add>+ Add</button>
        </div>
      </div>`;

    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('[data-x]').addEventListener('click', close);

    const picked = () => (Number(overlay.querySelector('[data-h]').value) * 3600)
      + (Number(overlay.querySelector('[data-m]').value) * 60);
    const preview = overlay.querySelector('[data-preview]');
    const err = overlay.querySelector('[data-err]');
    // Which button he is heading for decides the preview, so hovering or
    // focusing one shows what it would do before he commits.
    let sign = -1;
    const repaint = () => {
      const next = Math.max(0, liveClockSeconds() + (sign * picked()));
      preview.textContent = fmtHm(next);
      if (err) err.hidden = true;
    };
    for (const el of overlay.querySelectorAll('select')) el.addEventListener('change', repaint);
    for (const [sel, s2] of [['[data-sub]', -1], ['[data-add]', 1]]) {
      const b = overlay.querySelector(sel);
      b.addEventListener('pointerenter', () => { sign = s2; repaint(); });
      b.addEventListener('focus', () => { sign = s2; repaint(); });
    }

    const apply = async (direction, button) => {
      const amount = picked();
      if (!amount) {
        if (err) { err.textContent = 'Pick an amount first.'; err.hidden = false; }
        return;
      }
      const live = liveClockSeconds();
      const next = live + (direction * amount);
      if (next < 0) {
        if (err) {
          err.textContent = `That is more than the ${fmtHm(live)} on the clock. `
            + 'Subtract that much or less, or set it to zero.';
          err.hidden = false;
        }
        return;
      }
      button.disabled = true;
      try {
        // postWork banks the answer and repaints every switch on the page.
        // The sheet works in the TIER'S clock; the Worker stores the
        // case-lifetime total, so the review hours ride along untouched.
        await postWork({ setSeconds: clock.mark + next });
        close();
      } catch (e2) {
        if (err) { err.textContent = e2.message || 'That did not save. Try again.'; err.hidden = false; }
        button.disabled = false;
      }
    };
    overlay.querySelector('[data-sub]').addEventListener('click', (e) => apply(-1, e.currentTarget));
    overlay.querySelector('[data-add]').addEventListener('click', (e) => apply(1, e.currentTarget));

    // The clock reset, by hand (Eric, 2026-08-29: "if they upgrade to a
    // full-service, the clock resets"). New upgrades get the mark stamped by
    // the Worker at the flip; this button backfills a case that went
    // Full-Service before the mark existed, or restarts the count on his word.
    // Everything on the clock right now becomes the review side of the mark.
    const markBtn = overlay.querySelector('[data-markhere]');
    if (markBtn) {
      markBtn.addEventListener('click', async () => {
        markBtn.disabled = true;
        try {
          await postWork({ setTierMark: true });
          close();
        } catch (e2) {
          if (err) { err.textContent = e2.message || 'That did not save. Try again.'; err.hidden = false; }
          markBtn.disabled = false;
        }
      });
    }

    document.body.appendChild(overlay);
    overlay.querySelector('[data-h]').focus();
  });
}

// fmtHm lived here until the work clock grew three linked switches and moved
// it up beside them. The merge from main brought main's copy back alongside
// the moved one; this is the stale duplicate, removed.

// ---- the old automatic chat meter (retired; kept for reference) ----
// 30 seconds at a time, only while the chat page is the open page in a
// visible tab. What it buys: a per-client number for what chat actually
// costs, which is the fact the whole scoped-chat layer exists to manage.
let meterTimer = null;
function startChatMeter() {
  const paint = (total) => {
    const el = document.querySelector('[data-chattime]');
    if (!el) return;
    const h = Math.floor(total / 3600);
    const m = Math.round((total % 3600) / 60);
    el.textContent = `🕐 Your time in this chat so far: ${h ? `${h}h ` : ''}${m}m`;
    el.hidden = false;
  };
  const beat = async (seconds) => {
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/chattime', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ id: caseId, seconds }),
      });
      if (res.ok) paint((await res.json()).total || 0);
    } catch { /* the meter is a nicety, never a blocker */ }
  };
  beat(0); // read the running total without adding to it
  clearInterval(meterTimer);
  meterTimer = setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    if (folder?.current() !== 'chat') return;
    beat(30);
  }, 30_000);
}

function paintSummary(pane) {
  if (!pane) return;
  const today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  pane.innerHTML = `
    <div class="panel">
      <h3>Day summary</h3>
      <p class="dim small">One day of this thread, read back to you: what was
        said, what moved, and what is still hanging. Once per day, and the same
        day always reads the same.</p>
      <div class="row" style="gap:.5rem; flex-wrap:wrap; align-items:center;">
        <input type="date" data-day value="${iso(today)}" max="${iso(today)}">
        <button class="btn glow" data-go>Read that day</button>
      </div>
      <p class="error" data-err hidden style="margin:.5rem 0 0;"></p>
      <div class="sum-out" data-out hidden></div>
    </div>`;

  const dayEl = pane.querySelector('[data-day]');
  const errEl = pane.querySelector('[data-err]');
  const outEl = pane.querySelector('[data-out]');
  const btn = pane.querySelector('[data-go]');

  btn.addEventListener('click', async () => {
    const day = dayEl.value;
    if (!day) return;
    btn.disabled = true;
    btn.textContent = 'Reading…';
    errEl.hidden = true;
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/summary', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'case', id: caseId, day }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || `Failed (${res.status})`);
      // Rendered as text, section by section: this came back from a model and
      // never goes near innerHTML as markup.
      outEl.innerHTML = '';
      for (const block of String(d.text || '').split(/\n(?=## )/)) {
        const head = block.match(/^## (.+)$/m);
        const sec = document.createElement('section');
        sec.className = 'sum-sec';
        if (head) {
          const h = document.createElement('h4');
          h.textContent = head[1].trim();
          sec.appendChild(h);
        }
        const body = document.createElement('p');
        body.textContent = block.replace(/^## .+$/m, '').trim();
        sec.appendChild(body);
        outEl.appendChild(sec);
      }
      const note = document.createElement('p');
      note.className = 'dim small';
      note.textContent = d.cached
        ? 'Read earlier today; this is the same one.'
        : 'Saved. Opening this day again shows exactly this.';
      outEl.appendChild(note);
      outEl.hidden = false;
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
    btn.disabled = false;
    btn.textContent = 'Read that day';
  });
}

let unKey = null;
function paintUnanswered(pane, rows, readAt) {
  if (!pane) return;
  const key = JSON.stringify([rows, readAt || null]);
  if (key === unKey) return;    // a poll that changed nothing must not steal a tap
  unKey = key;

  const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  const days = (v) => {
    const t = v ? new Date(v).getTime() : 0;
    if (!t) return '';
    const n = Math.floor((Date.now() - t) / 86_400_000);
    return n <= 0 ? 'today' : n === 1 ? '1 day' : `${n} days`;
  };
  const open = rows.filter((r) => r && r.ask && !r.answered)
    .sort((a, b) => new Date(a.firstAskedAt || 0) - new Date(b.firstAskedAt || 0));

  pane.innerHTML = `
    <div class="panel">
      <h3>Unanswered</h3>
      ${open.length ? `
        <p class="dim small">Things you asked for that have not come back.
          Oldest first.</p>
        <ul class="un-list">
          ${open.map((r) => `
            <li class="un-item">
              <p class="un-ask">${esc(r.ask)}</p>
              <p class="un-meta">
                <span>Asked ${esc(fmt.format(new Date(r.firstAskedAt || Date.now())))}</span>
                <span class="un-age">${esc(days(r.firstAskedAt))} ago</span>
                ${r.times > 1 ? `<span class="un-times">${r.times}×</span>` : ''}
              </p>
              <div class="un-acts">
                <button class="btn quiet" data-again="${esc(r.ask)}">Ask again</button>
                <button class="btn ghost" data-done="${esc(r.ask)}">Got it</button>
              </div>
            </li>`).join('')}
        </ul>
        <p class="dim small un-limit">Read off the transcript, not a ledger.
          Check it before you lean on it.</p>`
        : readAt
          ? `<p class="dim small">Nothing outstanding as of the last read, ${esc(new Date(readAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))}.
             This list is rebuilt each time the advisor reads the thread; if you have asked for things since, press Update on the Read page and check back.</p>`
          : `<p class="dim small">No completed read yet, so there is nothing to show. Press Update on the Read page; this list is built from it.</p>`}
    </div>`;

  pane.querySelectorAll('[data-again]').forEach((b) => {
    b.addEventListener('click', () => sendToClient?.(b.dataset.again, 'Unanswered'));
  });
  pane.querySelectorAll('[data-done]').forEach((b) => {
    b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/advisor', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'case', id: caseId, action: 'unanswered-answered', ask: b.dataset.done }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Failed (${res.status})`);
        b.closest('.un-item')?.remove();
        unKey = null;   // the next poll repaints from the truth
      } catch (err) {
        alert(err.message);
        b.disabled = false;
      }
    });
  });
}

function paintEducation(pane, glossary) {
  if (!pane) return;
  const key = JSON.stringify(glossary);
  if (key === eduKey) return;   // a poll that changed nothing must not steal a tap
  eduKey = key;

  const fresh = glossary.filter((g) => !g.learned);
  const known = glossary.filter((g) => g.learned);
  const byCat = new Map();
  for (const g of fresh) {
    const cat = CATEGORY_ORDER.includes(g.category) ? g.category : 'General';
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(g);
  }

  const detail = (label, value) => (value
    ? `<p class="edu-line"><span class="edu-k">${label}</span> ${esc(value)}</p>` : '');
  // The term NAME jumps to its own row in the full dictionary (Eric,
  // 2026-08-23); the box and the definition text still tick it.
  const termKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const entry = (g) => `
    <div class="edu-item">
      <label class="gloss-item">
        <input type="checkbox" data-term="${esc(g.id)}" ${g.learned ? 'checked' : ''}>
        <span class="gloss-text"><strong><a class="term-jump" href="/admin-dictionary.html#k=${encodeURIComponent(termKey(g.term))}">${esc(g.term)}</a></strong>: ${esc(g.definition)}</span>
      </label>
      ${detail('How it works', g.mechanism)}
      ${detail('Treatment', g.treatment)}
      ${detail('Outlook', g.outcome)}
    </div>`;

  pane.innerHTML = `
    <div class="panel">
      <h3>📚 Terms in this case</h3>
      <p class="dim small">Tick a term once you own it. It stops being highlighted, it is never explained to you again, and the advisor pitches everything after that to what you actually know.</p>
      ${byCat.size
        ? [...byCat.entries()]
            .sort((a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]))
            .map(([cat, items]) => `
              <h4 class="edu-cat">${esc(cat)}<span class="edu-n">${items.length}</span></h4>
              ${items.map(entry).join('')}`).join('')
        : '<p class="dim small">Nothing new to learn right now. The advisor adds terms here as they come up in a case.</p>'}
      ${known.length ? `
        <details class="gloss-known">
          <summary>✓ ${known.length} term${known.length === 1 ? '' : 's'} you know</summary>
          ${known.map(entry).join('')}
        </details>` : ''}
      <p class="small" style="margin:.8rem 0 0;"><a href="/admin-dictionary.html">📚 Full dictionary, by type and A to Z →</a></p>
    </div>`;

  pane.querySelectorAll('[data-term]').forEach((cb) =>
    cb.addEventListener('change', async () => {
      cb.disabled = true;
      try {
        const token = await user.getIdToken();
        await fetch('/api/advisor', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'case', id: caseId, action: 'term', termId: cb.dataset.term, learned: cb.checked }),
        });
        // Let the next poll repaint rather than rebuilding here: the checkbox
        // already shows the new state, and a rebuild mid-tap loses the scroll.
        eduKey = null;
      } finally { cb.disabled = false; }
    }));
}

/**
 * 🪞 About you. What the advisor has worked out about Eric from months of
 * watching him edit its drafts: how he writes, the calls he has made, and an
 * honest read on what he does well with clients and what he could work on. He
 * asked for the last part and he asked for it honest.
 */
let aboutKey = null;
function paintAbout(pane, about) {
  if (!pane) return;
  const a = about || {};
  const key = JSON.stringify(a);
  if (key === aboutKey) return;
  aboutKey = key;
  const block = (icon, title, body, empty) => `
    <h4 class="about-h">${icon} ${title}</h4>
    ${body ? mdList(body) : `<p class="dim small">${empty}</p>`}`;
  pane.innerHTML = `
    <div class="panel">
      <h3>🪞 What the advisor has learned about you</h3>
      <p class="dim small">Built from the difference between what it drafts and what you actually send. Nobody else can see this.</p>
      ${block('✍️', 'How you write', a.voice, 'Not enough edits yet. Change a draft before you send it and it starts learning.')}
      ${block('⚖️', 'Where you stand', a.stances, 'No standing positions yet. Say "override" to the advisor to settle one permanently.')}
      ${block('🎯', 'Strong suits, and things to work on', a.coaching, 'Not enough to say yet.')}
      ${a.updatedAt ? `<p class="dim small" style="margin-top:.8rem;">Last updated ${esc(new Date(a.updatedAt).toLocaleDateString())}.</p>` : ''}
    </div>`;
}

/** Bullets as bullets, everything else as a line. Nothing here is markup. */
function mdList(text) {
  const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
  let html = '';
  let open = false;
  for (const line of lines) {
    const b = line.match(/^[-*]\s+(.*)$/);
    if (b) {
      if (!open) { html += '<ul>'; open = true; }
      html += `<li>${esc(b[1])}</li>`;
    } else {
      if (open) { html += '</ul>'; open = false; }
      html += `<p>${esc(line)}</p>`;
    }
  }
  return html + (open ? '</ul>' : '');
}

/** The always-visible bit above the tabs: name and status pill. */
function refreshHeader() {
  const c = data;
  const name = document.querySelector('[data-client]');
  const pill = document.querySelector('[data-status]');
  if (name) name.textContent = c.clientName || c.clientEmail || c.clientUid;
  if (pill) pill.textContent = (c.status || '?').replace('_', ' ').toUpperCase();
}

// The working line under the client's name, kept current by the advisor's
// state poll. Eric's override wins and carries his ✎ mark.
// The advisor panel's own poll broadcasts the whole state; the appeals page
// reads its letter and status from here rather than running a second poll.
let panelState = {};
/** paintCallDoc's repainter, set while that page is mounted so the state poll
 *  can drive it. Declared up here beside panelState rather than under the
 *  function that assigns it: the poll listener below reads it, and a reader
 *  should not have to scroll 1,600 lines to find out whether that is safe. */
let callDocRepaint = null;

document.addEventListener('pa-panel-state', (e) => {
  const d = e.detail || {};
  if (d.id && d.id !== caseId) return;
  panelState = d;
  if (folder?.el('appeals')) folder.el('appeals')._reload?.();
  // The call-notes workbench reads from the same broadcast. It moved to the
  // My doc page, beside the other two sheets he holds on a call.
  folder?.el('calldoc')?.querySelector('[data-callnotes-host]')?._reload?.();
  // So does the call document, which is a long run: without this the panel
  // would sit on "Building…" until he changed pages, for a document that had
  // been ready for minutes.
  if (folder?.el('calldoc')?.querySelector('[data-calldoc-host]')) callDocRepaint?.();

  // The saved notes ride the same poll. setHtml refuses to overwrite work in
  // progress, so this is safe to call on every tick.
  if (typeof d.notes === 'string') {
    notesHtml = d.notes;
    notes?.setHtml(d.notes);
  }
  // A dot on any tab holding something he has not looked at. The shelf says
  // WHICH page changed, as an emoji; in here the strip only has to say "this
  // one", and the page he is on never carries one.
  const stamps = {
    chat: d.clientMsgAt, advisor: d.advisorAt, dx: d.diffAt,
    drafts: d.draftAt, files: d.fileAt,
    // Only a FINISHED one. callDocAt is written when the document lands, so a
    // run still going does not sit there wearing a "ready" dot.
    calldoc: d.callDocStatus === 'ready' ? d.callDocAt : null,
  };
  for (const { page } of PAGE_BADGES) {
    if (page in stamps) folder?.mark(page, isUnseen(caseId, page, stamps[page]));
  }
  if (typeof d.analysis === 'string') lastAnalysis = d.analysis;
  if (Array.isArray(d.differential)) lastDifferential = d.differential;
  if (Array.isArray(d.glossary)) paintEducation(folder?.el('education'), d.glossary);
  if (d.about) paintAbout(folder?.el('about'), d.about);
  if (Array.isArray(d.unanswered)) paintUnanswered(folder?.el('unanswered'), d.unanswered, d.updatedAt);

  const wl = document.querySelector('[data-working]');
  if (!wl) return;
  const over = d.dxOverride && d.dxOverride.text;
  const text = over || d.workingLine || '';
  wl.textContent = text ? text + (over ? ' ✎' : '') : '';
  wl.hidden = !text;
});

/**
 * SAYING SO. Eric, 2026-08-26, on a live case: "I put meeting link in but it
 * didn't visually confirm that it saved. So idk if my client is seeing it."
 *
 * Every lever on this page posted, called load(), and said nothing. load()
 * repaints the whole Overview, so anything written onto the panel at the
 * moment of a save was destroyed a few hundred milliseconds later by the very
 * repaint that proved it had worked. A successful save and a dead button
 * looked identical, which is the worst possible pair to make identical.
 *
 * So a confirmation cannot live in the DOM: it has to live OUTSIDE the paint
 * and be re-rendered BY it. This map is that. paintOverview asks for each
 * panel's line as it builds, refreshOverview re-opens any panel holding one,
 * and the line ages out on its own so a stale "Saved" is not still sitting
 * there half an hour later making a claim about the current state.
 *
 * The second half of his sentence is the half that matters. He does not want
 * to be told a write succeeded; he wants to know WHAT THE CLIENT NOW SEES.
 * Every message below answers that, or says plainly that the client sees
 * nothing.
 */
const said = new Map();
const SAID_MS = 30_000;
let saidTimer = null;
/** `html` is only ever markup this file built and escaped itself. */
function say(key, text, { tone = 'ok', html = '' } = {}) {
  said.set(key, { text, html, tone, at: Date.now() });
  clearTimeout(saidTimer);
  // One repaint when the line expires, so it clears itself rather than
  // waiting for whatever he happens to do next.
  saidTimer = setTimeout(() => { said.clear(); refreshOverview(); }, SAID_MS + 500);
}
function saidHtml(key) {
  const s = said.get(key);
  if (!s) return '';
  if (Date.now() - s.at > SAID_MS) { said.delete(key); return ''; }
  // The tick is a CSS ::before, so a plain-text confirmation set with
  // textContent elsewhere in this file gets the same mark without markup.
  return `<p class="saved-note ${s.tone === 'ok' ? 'ok' : 'warn'}" role="status">
    <span>${esc(s.text)}${s.html || ''}</span></p>`;
}

/**
 * The blank forms he can put in front of a client, and the only list of them.
 *
 * The `id` is the kind the two pure functions in authority.js answer to, and
 * the `label` is both what the tick box says and the front of the file name
 * the client reads. One field for both on purpose: a form whose row said one
 * thing and whose file said another is a form he cannot talk about on a call.
 *
 * Adding a third form is one row here. Everything else follows: the picker,
 * the Print button beside it, the send, and the file name.
 */
const SENDABLE_FORMS = [
  { id: 'records', label: 'Records authorisation' },
  { id: 'representative', label: 'Insurance representative' },
];

/**
 * The Overview page: the info bar, whatever is waiting on his answer, then
 * every lever on the case.
 *
 * THE LEVERS ARE ORDERED BY WHEN HE REACHES FOR THEM, not by which route they
 * post to. Six identical rows, every one the same size and the same weight,
 * is a list you have to read end to end every time to find one thing; the
 * eyebrows below turn it into three short lists with a moment attached to
 * each. Nothing moved out of reach, nothing was dropped: the same six rows,
 * under three headings and with air between them.
 */
function paintOverview(pane) {
  const c = data;
  const start = c.appointment && toDate(c.appointment.start);
  const mtFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const due = c.reportDueAt
    ? Math.ceil((toDate(c.reportDueAt) - Date.now()) / 86_400_000)
    : null;

  // Anything a client is waiting on him for. It goes ABOVE every standing
  // lever, because it is the only part of this page with someone else's clock
  // attached to it, and it used to sit fourth in a stack of identical rows.
  const waiting = `
    ${c.appointment?.requested ? `
    <div class="panel" style="border-color:var(--orange); box-shadow:var(--glow-o);">
      <h3 style="margin:0 0 .3rem; color:var(--orange);">Booking request — not on your calendar</h3>
      <p class="small" style="margin:0 0 .2rem;">They asked for
        <strong>${start ? esc(mtFmt.format(start)) : 'an unknown time'} MST</strong>, paid in full.
        Nothing is reserved until you confirm.</p>
      <p class="dim small" style="margin:0 0 .7rem;">Declining keeps the case and the payment;
        it just flags the case so you can offer another time below.</p>
      <button class="btn" data-action="confirm-request">Confirm this time</button>
      <button class="btn quiet" data-action="deny-request">Can't make it</button>
    </div>` : ''}
    ${c.fullAccessRequest?.state === 'pending' ? `
    <div class="panel" style="border-color:var(--cyan); box-shadow:var(--glow-c);">
      <h3 style="margin:0 0 .3rem; color:var(--cyan);">Full-Service request: your call</h3>
      <p class="small" style="margin:0 0 .2rem;">
        First month <strong>$${((Number(c.fullAccessRequest.firstMonthCents) || 0) / 100).toLocaleString()}</strong>
        (their case fee is already off it), then
        <strong>$${((Number(c.fullAccessRequest.monthCents) || 0) / 100).toLocaleString()}/mo</strong>.</p>
      <p class="dim small" style="margin:0 0 .7rem;">Nothing has been charged and no
        card was taken. Approving sends them a link to start month one at the rate
        quoted above — the one they were shown when they asked, not today's.
        You carry a set number of these at once, which you choose in
        Settings, and if you are full, approving tells you so and asks before
        it goes ahead.</p>
      <button class="btn" data-full-request="approve">Approve — send the link</button>
      <button class="btn quiet" data-full-request="decline">Can't take it</button>
      <p class="error" data-full-request-error hidden></p>
    </div>` : ''}
    ${c.pendingTelehealth?.state === 'requested' ? `
    <div class="panel" style="border-color:var(--orange); box-shadow:var(--glow-o);">
      <h3 style="margin:0 0 .3rem; color:var(--orange);">Telehealth appointment — they want you there</h3>
      <p class="small" style="margin:0 0 .2rem;">
        <strong>${esc(mtFmt.format(toDate(c.pendingTelehealth.when)))} MST</strong>
        · ${esc(c.pendingTelehealth.clinicName || '(clinic)')}
        ${c.pendingTelehealth.provider ? ` · ${esc(c.pendingTelehealth.provider)}` : ''}</p>
      <p class="dim small" style="margin:0 0 .7rem;">
        ${c.pendingTelehealth.paidCents
          ? `Paid $${(c.pendingTelehealth.paidCents / 100).toFixed(0)}. Declining pings you to refund it — the copy promises every dollar back.`
          : 'Included in their Full Access — no payment moved.'}
        They attested to inviting you in. You never record their clinic's visit.</p>
      <button class="btn" data-telehealth="confirm">I'll be there</button>
      <button class="btn quiet" data-telehealth="deny">Can't make it</button>
    </div>` : ''}`;

  // The contact Edit on the card (2026-09-03): one delegated listener per
  // pane, so it survives every repaint of this innerHTML. Saves through
  // case-update and repaints the two links in place, no reload.
  if (!pane._contactWired) {
    pane._contactWired = true;
    pane.addEventListener('click', async (e) => {
      if (e.target.closest('[data-contact-edit]')) {
        const f = pane.querySelector('[data-contact-form]');
        if (f) f.hidden = !f.hidden;
        return;
      }
      const save = e.target.closest('[data-contact-save]');
      if (!save) return;
      const said = pane.querySelector('[data-contact-said]');
      const g = (n) => pane.querySelector(`[data-contact-in="${n}"]`)?.value.trim() || '';
      save.disabled = true;
      try {
        const out = await api({ action: 'contact', phone: g('phone'), address: g('address') });
        const bits = contactBits(out.phone || '', out.address || '');
        const ph = pane.querySelector('[data-contact-phone]');
        if (ph) ph.outerHTML = bits.phone;
        const ad = pane.querySelector('[data-contact-address]');
        if (ad) ad.outerHTML = bits.address;
        if (said) said.textContent = 'Saved. It is on the card now.';
      } catch (err) {
        if (said) said.textContent = err.message || 'Could not save.';
      }
      save.disabled = false;
    });
  }

  pane.innerHTML = `
    ${infoBar(c, mtFmt, start, due)}
    ${c.fullAccess ? '<div data-authority-status></div>' : ''}
    ${waiting.trim() ? `<p class="eyebrow mgmt-when hot">Waiting on you</p>${waiting}` : ''}

    <!-- OUTSIDE the panel below on purpose: the panel is gone the moment the
         tier is on, which is exactly when this line has something to say. -->
    ${saidHtml('openfull')}
    <p class="eyebrow mgmt-when">Before the call</p>
    ${c.fullAccess ? '' : `
    <!-- OPENING THE TIER BY HAND. Until now the only thing that could set
         fullAccess was a Stripe webhook, so a client who agreed on a call and
         paid another way could not be given what he had bought: the
         work log, the scope-note checklist and the check-in booking are all
         gated on that flag. Eric, 2026-08-26: "where to start the
         clock and send forms as if he paid for the enhancement through the
         app." -->
    <details class="mgmt" data-k="openfull">
      <summary>🤝 Open Full-Service by hand</summary>
      <div class="mgmt-body">
        <p class="dim small" style="margin:0 0 .6rem;">For a client who agreed
          it on a call. This opens exactly the case a payment opens: their work
          log, their checklist, the check-in booking and the email. They cannot
          tell which way the money reached you. It sends no forms and asks
          them to sign nothing: every form goes out by your hand, and you tick
          Forms submitted on the tier card when the signed copies are back.</p>
        <p class="small" style="margin:0 0 .5rem;">This case shows
          <strong>${paidCents(c) === null ? 'no payment recorded' : '$' + dollars(paidCents(c))}</strong>
          paid so far.</p>
        <label class="small" style="display:block; margin-bottom:.3rem;">
          Paid you for Full-Service, outside the app
          <span class="sched-amt">
            <span aria-hidden="true">$</span>
            <input type="text" inputmode="decimal" id="openfull-amt"
              placeholder="0" aria-label="Amount in dollars">
          </span>
        </label>
        <p class="dim small" style="margin:0 0 .5rem;">Leave it at zero if you
          already took the money through the charge panel. It is on the case
          once already, and entering it twice inflates your hourly.</p>
        <!-- ONE NUMBER, NOT TWO. This box ADDS to the case fee already on the
             record; the box in Settings SETS the whole figure outright. So
             3400 typed here and 3400 typed there mean two different totals for
             one real event, and the Settings figure is the one every screen
             reads. Saying that here costs a sentence and saves him finding out
             from a total he does not recognise. -->
        <p class="dim small" style="margin:0 0 .5rem;">This adds to the case
          fee already on the record. If the total it lands on is not what they
          really paid, set the whole figure in Settings instead: that is the
          number every other screen reads.</p>
        <p class="small" id="openfull-total" style="margin:0 0 .7rem;"></p>
        <label class="small" style="display:block; margin-bottom:.3rem;">
          Their month starts
          <input type="date" id="openfull-start" style="margin-left:.35rem;">
        </label>
        <p class="dim small" id="openfull-when" style="margin:0 0 .5rem;"></p>
        <p class="error" id="openfull-err" hidden></p>
        <!-- "and send the forms" came off this button (Eric, 2026-08-29:
             "Remove those. I have those sent manually."). It never sent any:
             the handler posts open-full and nothing else, so the label was
             promising an action that did not exist. -->
        <div class="actions"><button class="btn secondary" id="openfull-go">Open Full-Service</button></div>
      </div>
    </details>`}

    <!-- TICK THEM AND SEND THEM. Eric, 2026-08-27, on a live case he had
         already been paid for outside the app: "I need to be able to select
         forms and send them, regardless of if they've already been sent or
         not. This way this client can have the signed forms in the uploaded
         documents. This is another example of what the advisor could do:
         'send the full-service forms to the client'."
         FORMS, PLURAL, IN ONE ACTION. Printing each one and uploading it by
         hand was three trips through the share sheet per form on a phone, and
         the pair of them go out together every single time.
         THE COPY THIS PANEL USED TO CARRY SAID signing in the app opened when
         they upgraded. It does not: the client-side offer is parked
         (OFFER_AUTHORITY_SIGNING in public/js/case.js), so every form on
         every case is signed by hand now, and the sentence was telling him
         something untrue about his own tool. -->
    <details class="mgmt" data-k="auth">
      <summary>📄 Send a form to sign</summary>
      <div class="mgmt-body">
        <p class="dim small" style="margin:0 0 .6rem;">A blank copy with
          ${esc(c.clientName || 'the client')}'s name already on it and ruled lines
          to sign by hand. Tick what you need and send it straight to their
          documents, or print one to hand over on paper. Signing is by hand on
          every case: they sign it, send it back to you, and you file the signed
          copy as a filled form. Records requests take weeks, so the form going
          out early is the whole game.</p>
        <!-- flex-wrap:nowrap and min-width:0 on the label, both deliberate.
             .row wraps by default, and at 320px that dropped every Print
             button onto a line of its own underneath its form, which reads as
             a button belonging to nothing. The label wrapping to two lines
             with the button held on the right keeps the pair together at every
             width. The button is OUTSIDE the label, or tapping Print would
             also tick the box. -->
        ${SENDABLE_FORMS.map((f) => `
        <div class="row" style="gap:.5rem; align-items:center; flex-wrap:nowrap; margin:0 0 .4rem;">
          <label class="small" style="flex:1 1 auto; min-width:0; margin:0;">
            <input type="checkbox" data-form-pick="${f.id}" style="margin-right:.35rem;">${esc(f.label)}</label>
          <button type="button" class="btn quiet tiny" data-blank="${f.id}">Print</button>
        </div>`).join('')}
        <p class="error" id="forms-err" hidden></p>
        <div class="actions"><button class="btn secondary" id="forms-send">Send the ticked forms</button></div>
        ${saidHtml('auth')}
      </div>
    </details>

    <details class="mgmt" data-k="sched">
      <summary>📅 Schedule a session</summary>
      <div class="mgmt-body">
        <p class="dim small">Book this client at any time at all, or nudge the
          appointment they already have. Lead time, booking horizon and
          business hours do not apply to you.</p>
        ${c.appointment?.start ? `
        <!-- MOVE IT, do not re-book it (Eric, 2026-08-26: "let me reschedule
             sessions without the scheduling blocks stopping me... reschedule
             for an hour later on the same day"). The common reschedule is a
             nudge from where it already is, and doing that through the slot
             list was impossible: the cron deletes every open slot inside 72
             hours, so the dropdown had nothing sooner than three days out and
             the only way through was knowing the custom field existed and
             typing a date. These do the arithmetic off the CURRENT
             appointment, so one tap is the whole job. -->
        <div class="sched-nudge" data-nudge-row>
          <span class="dim small">Move it</span>
          ${[['+1 hour', 60], ['+2 hours', 120], ['+1 day', 1440], ['+1 week', 10080]]
            .map(([label, mins]) =>
              `<button type="button" class="btn quiet tiny" data-nudge="${mins}">${label}</button>`).join('')}
        </div>
        ${saidHtml('sched')}` : ''}
        <select id="sched-slot"><option value="">Loading open slots…</option></select>
        <div id="sched-custom" style="margin-top:.5rem;" hidden>
          <!-- TODAY, in one tap. The picker below reaches any time at all, but
               the case this panel keeps failing is "we agreed on 2pm, today",
               and that should not cost four wheel spins. Built at render from
               the hours left in the MST day. -->
          <div class="sched-today" data-today-row></div>
          <input type="datetime-local" id="sched-when">
          <select id="sched-dur" style="margin-top:.35rem;">
            ${[30, 45, 60, 90, 120].map((m) =>
              `<option value="${m}" ${m === 60 ? 'selected' : ''}>${m} minutes</option>`).join('')}
          </select>
          <p class="dim small" style="margin:.3rem 0 0;">Times are MST. Evenings, weekends and tomorrow are all fair game — the slot is created for this client only and never shows up on the public picker.</p>
        </div>
        <div id="sched-modes" style="margin-top:.6rem;">
          <label class="small" style="display:block;"><input type="radio" name="sched-mode" value="reschedule" checked>
            Reschedule the main appointment <span class="dim">(no charge)</span></label>
          <label class="small" style="display:block;"><input type="radio" name="sched-mode" value="followup" ${followUpAvailable(c) ? '' : 'disabled'}>
            Book their paid follow-up ${followUpAvailable(c) ? '' : `<span class="dim">(${followUpUnavailableReason(c)})</span>`}</label>
          ${c.fullAccess ? `<label class="small" style="display:block;"><input type="radio" name="sched-mode" value="checkin" ${c.status === 'closed' ? 'disabled' : ''}>
            Book a check-in <span class="dim">(included in Full Access, no charge)</span></label>` : ''}
          <label class="small" style="display:block;"><input type="radio" name="sched-mode" value="charge">
            Charge for a session:</label>
          <div id="sched-charge" style="margin:.35rem 0 0 1.4rem;" hidden>
            <!-- AN AMOUNT HE TYPES BEATS A PERCENTAGE. The percentages stop at
                 150%, which against a $1,200 case is $1,800, and a figure
                 agreed on a call is not a share of a list price. It goes FIRST
                 because when he is reaching for this panel at all it is usually
                 because the dropdown could not say what he needs. -->
            <label class="small" style="display:block; margin-bottom:.3rem;">
              An amount you agreed
              <span class="sched-amt">
                <span aria-hidden="true">$</span>
                <input type="text" inputmode="decimal" id="sched-amt"
                  placeholder="3400" aria-label="Amount in dollars">
              </span>
            </label>
            <p class="dim small" style="margin:0 0 .45rem;">Leave it empty to use a share of their case fee instead.</p>
            <select id="sched-pct">
              ${[0, 25, 50, 75, 100, 125, 150].map((p) =>
                `<option value="${p}" ${p === 50 ? 'selected' : ''}>${p}%: ${p === 0 ? 'no charge' : '$' + dollars((p * caseRate(c)) / 100)}</option>`).join('')}
            </select>
            <input type="text" id="sched-tag" maxlength="120" placeholder="Invoice line (optional), e.g. Records deep-dive session" style="margin-top:.35rem;">
            <p class="dim small" style="margin:.3rem 0 0;">A share of <strong>$${dollars(caseRate(c))}</strong>, the rate this client booked at. They pay through Stripe to confirm; the slot holds for 24 hours. Your tagline is the line item on their receipt.</p>
          </div>
        </div>
        <p class="error" id="sched-err" hidden></p>
        <div id="sched-result" class="dim small" style="margin-top:.4rem;"></div>
        <div class="actions"><button class="btn secondary" id="sched-go">Schedule</button></div>
        ${saidHtml('sched')}
      </div>
    </details>

    <details class="mgmt" data-k="link">
      <summary>🔗 ${c.appointment?.method === 'phone' ? 'Phone note' : 'Meeting link'}</summary>
      <div class="mgmt-body">
        <p class="dim small">${c.appointment?.method === 'phone'
          ? `Client expects a call at <strong>${esc(c.appointment.phone || '?')}</strong>. Post the number you'll call from:`
          : 'Paste the video-call link the client should join:'}</p>
        <input type="url" id="joinlink" placeholder="${c.appointment?.method === 'phone' ? 'Calling from +1 …' : 'https://…'}"
          value="${esc(c.appointment?.joinLink || '')}">
        <div class="actions"><button class="btn secondary" id="save-link">Save</button></div>
        ${saidHtml('link')}
      </div>
    </details>

    <p class="eyebrow mgmt-when">After the call</p>

    <details class="mgmt" data-k="miles">
      <summary>✓ Call done, report sent</summary>
      <div class="mgmt-body">
        <div class="actions" style="margin-top:.3rem;">
          <button class="btn secondary" data-action="recording-uploaded">Call done: start the 7-day report clock</button>
          <button class="btn secondary" data-action="report-uploaded">Report delivered</button>
          ${c.status === 'closed' ? '<span class="dim small">Case closed.</span>' : ''}
        </div>
        ${saidHtml('miles')}
        <p class="dim small" style="margin-top:.6rem;">Uploading a recording or report triggers its milestone automatically; the buttons cover manual corrections.</p>
      </div>
    </details>

    <details class="mgmt" data-k="review">
      <summary>⭐ Their review</summary>
      <div class="mgmt-body" data-case-review>
        <p class="dim small">Loading…</p>
      </div>
    </details>

    <p class="eyebrow mgmt-when">Ending it</p>

    <details class="mgmt mgmt-grave" data-k="hold">
      <summary>${c.hold?.pausedAt ? '⏸ Paused' : '⏸ Pause or close'}</summary>
      <div class="mgmt-body">
        ${c.hold?.pausedAt ? `
          <p class="dim small" style="margin:.2rem 0 .6rem;">Paused since
            <strong>${esc(new Intl.DateTimeFormat('en-US', { timeZone: MOUNTAIN_TZ, month: 'short', day: 'numeric' }).format(toDate(c.hold.pausedAt)))}</strong>. Every deadline on
            this case is stopped. Their page says so and says their dates moved
            with it.</p>
          <div class="actions"><button class="btn glow" data-hold-off>Resume the case</button></div>`
        : `
          <p class="dim small" style="margin:.2rem 0 .6rem;">Stops every clock
            on this case: the report deadline, the follow-up month, the
            coordination window. Resuming puts the time back on all of them.
            An insurance appeal deadline is NOT paused, because that clock
            belongs to the plan, not to you.</p>
          <label class="dim small" style="display:block; margin-bottom:.4rem;">Back around (optional)
            <input type="date" data-hold-back style="margin-left:.4rem;"></label>
          <label class="dim small" style="display:block; margin-bottom:.6rem;">Why, for your record only
            <input type="text" data-hold-why maxlength="300" placeholder="never shown to them"
              style="width:100%; margin-top:.2rem;"></label>
          <div class="actions"><button class="btn secondary" data-hold-on>Pause this case</button></div>`}
        <hr style="margin:.9rem 0; border:0; border-top:1px solid var(--line);">
        ${c.status === 'closed'
          ? '<p class="dim small" style="margin:0;">Case closed. They can still leave a review.</p>'
          : `
          <p class="dim small" style="margin:.2rem 0 .6rem;">Closing ends the
            case at your discretion, for any reason. They keep everything in
            it, and they can still leave a review.</p>
          <label class="dim small" style="display:block; margin-bottom:.6rem;">Why — <strong style="color:var(--orange)">the client reads this, word for word</strong>
            <input type="text" data-close-reason maxlength="500" placeholder="required — shown on their case page"
              style="width:100%; margin-top:.2rem;"></label>
          <div class="actions"><button class="btn quiet" data-close-case>Close this case</button></div>`}
        <p class="error" data-hold-error hidden style="margin:.5rem 0 0;"></p>
        ${saidHtml('hold')}
      </div>
    </details>
`;

  paintCaseReview(pane);
  pane.querySelector('#save-link').addEventListener('click', saveLink);
  wireScheduler(pane);
  wireOpenFull(pane, c);
  pane.querySelectorAll('[data-action]').forEach((b) =>
    b.addEventListener('click', () => milestone(b.dataset.action, b)));
  // Blank forms print straight from the pure functions — nothing is written
  // down, because nothing has been signed. Deliberately not a [data-action]:
  // those all post a milestone to the server, and this one is just paper.
  pane.querySelectorAll('[data-blank]').forEach((b) =>
    b.addEventListener('click', () => printAuthorityDoc({ kind: b.dataset.blank, blank: true })));
  // SENDING them is a different thing from printing them, and it reads the
  // ticks rather than the button it was hung on, so one tap sends the pair.
  //
  // The catch is not swallowing anything: sendBlankForms has already put the
  // failure where Eric will read it, and it throws on top of that so a caller
  // that is not a person can tell a send from a failure. A tap must not also
  // raise an unhandled rejection into the console.
  pane.querySelector('#forms-send')?.addEventListener('click', (e) =>
    sendBlankForms([...pane.querySelectorAll('[data-form-pick]:checked')]
      .map((x) => x.dataset.formPick), e.currentTarget)
      .catch(() => { /* already said, on the panel */ }));
  pane.querySelectorAll('[data-telehealth]').forEach((b) =>
    b.addEventListener('click', async () => {
      const action = b.dataset.telehealth;
      if (action === 'deny' && !confirm('Decline this appointment? They are told, and if they paid you are pinged to refund it in full.')) return;
      b.disabled = true;
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/admin/telehealth', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ caseId, action }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
        load();
      } catch (err) { alert(err.message); b.disabled = false; }
    }));
  // The live count deliberately does NOT come from /api/rates: that route
  // publishes fullOpen as a bare boolean precisely because the counts are not
  // a client's business, and this page shares it. The real numbers arrive in
  // the 409 below, from the only route that can create one of these.
  pane.querySelectorAll('[data-full-request]').forEach((b) =>
    b.addEventListener('click', async () => {
      const decision = b.dataset.fullRequest;
      const errEl = pane.querySelector('[data-full-request-error]');
      let reason = '';
      if (decision === 'decline') {
        // His words, verbatim, the same as a case closure: the client reads
        // this and nothing was charged, so it had better say something.
        reason = (prompt('Why can\'t you take this one? They read this word for word.') || '').trim();
        if (!reason) return;
      } else if (!confirm('Approve this? They get a link to start month one at the rate they were quoted.')) {
        return;
      }
      b.disabled = true;
      if (errEl) errEl.hidden = true;
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/admin/full-request', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ caseId, decision, reason }),
        });
        const out = await res.json().catch(() => ({}));
        if (res.status === 409 && out.error === 'full-booked') {
          // The cap is real now - this route is the ONLY way a tier case can
          // be created - so it can refuse him, and he can override knowingly.
          // "3 of undefined" was one setting away, once the cap could be
          // turned off. It cannot fire with no cap set, and a prompt about his
          // load is not the place to rely on that.
          const carrying = out.max
            ? `${out.open} of ${out.max}` : `${out.open}, with no limit set`;
          if (!confirm(`You already carry ${carrying}. Take this one anyway?`)) {
            b.disabled = false;
            return;
          }
          const again = await fetch('/api/admin/full-request', {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
            body: JSON.stringify({ caseId, decision, reason, overrideCap: true }),
          });
          const out2 = await again.json().catch(() => ({}));
          if (!again.ok) throw new Error(out2.error || `Failed (${again.status})`);
          load();
          return;
        }
        if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
        load();
      } catch (err) {
        if (errEl) { errEl.textContent = err.message; errEl.hidden = false; }
        b.disabled = false;
      }
    }));
  wireHoldAndClose(pane);
}

/**
 * Pausing a case, resuming it, and ending it at his discretion.
 *
 * Both routes are admin-gated and both 404 to anyone else. The PAUSE reason
 * is his record alone - the client is told the case is paused and roughly
 * when he expects to be back, never why. The CLOSING reason is the opposite
 * on purpose (Eric, 2026-08-25): it is documented in the case for both
 * parties, rendered on the client's page word for word, and the form says so
 * before he types a letter.
 */
function wireHoldAndClose(pane) {
  const errEl = pane.querySelector('[data-hold-error]');
  // Renamed from `say` when the module gained a say() of its own for the
  // confirmations. This one is only ever the red line; the module's say() is
  // the one that survives a repaint.
  const fail = (msg) => { if (errEl) { errEl.textContent = msg; errEl.hidden = !msg; } };
  // `note` is what the CLIENT will see once this lands, which is the only
  // thing he actually wants to know after pressing one of these. `landed`
  // reads the freshly loaded case and answers "did it": same rule as the
  // meeting link, a 200 is not the same claim as a case that changed.
  const post = async (path, payload, btn, note, landed) => {
    btn.disabled = true;
    fail('');
    try {
      const token = await user.getIdToken();
      const res = await fetch(path, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ caseId, ...payload }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
      await load();
      if (note) {
        say('hold', landed && !landed(data)
          ? 'That went through, but the case has not moved. Try once more.'
          : note, { tone: landed && !landed(data) ? 'warn' : 'ok' });
        refreshOverview();
      }
    } catch (err) {
      fail(err.message);
      btn.disabled = false;
    }
  };

  pane.querySelector('[data-hold-on]')?.addEventListener('click', (e) => {
    const back = pane.querySelector('[data-hold-back]')?.value || '';
    post('/api/admin/hold', {
      on: true,
      reason: pane.querySelector('[data-hold-why]')?.value || '',
      // A bare date means the whole MST day, the same rule the rest of the
      // app uses; without the offset it would mean UTC midnight and land a
      // day early on his own screen.
      backBy: back ? `${back}T12:00:00-07:00` : null,
    }, e.currentTarget,
    'Paused. Their page now says the case is on hold and that their dates moved with it.',
    (c2) => !!c2?.hold?.pausedAt);
  });

  pane.querySelector('[data-hold-off]')?.addEventListener('click', (e) =>
    post('/api/admin/hold', { on: false }, e.currentTarget,
      'Resumed. Their page is back to normal and every clock has the paused time back on it.',
      (c2) => !c2?.hold?.pausedAt));

  pane.querySelector('[data-close-case]')?.addEventListener('click', (e) => {
    const reason = (pane.querySelector('[data-close-reason]')?.value || '').trim();
    if (!reason) { fail('Write the reason first. The client reads it word for word.'); return; }
    if (!confirm(`Close this case? They will read, word for word:\n\n"${reason}"\n\nThey keep every file and can still leave a review. This is not reversible from here.`)) return;
    post('/api/admin/close-case', { reason }, e.currentTarget,
      'Closed. Their page now shows your reason word for word, and they can still leave a review.',
      (c2) => c2?.status === 'closed');
  });
}

/** Repaint Overview in place, keeping whichever rows Eric had open. */
function refreshOverview() {
  const pane = folder?.el('overview');
  if (!pane) return;
  const open = new Set(
    [...pane.querySelectorAll('details[data-k][open]')].map((d) => d.dataset.k));
  // A panel holding a fresh confirmation is opened whether or not it was open
  // before. Without this, a save made from a panel could be answered inside a
  // panel that the repaint had shut, which is the silence all over again.
  for (const k of said.keys()) open.add(k);
  paintOverview(pane);
  // paintOverview rewrites the pane, so the authority card has to be re-served
  // after it, not before.
  paintAuthorityStatus(pane);
  open.forEach((k) => {
    const d = pane.querySelector(`details[data-k="${k}"]`);
    if (d) d.open = true;
  });
}

/** The Uploads page shell. Painted once; refreshFiles fills the list. */
/**
 * EVERY FILE ON THE CASE, AS ONE DOCUMENT (Eric, 2026-08-26: "there should be
 * a place where all the uploads can get compiled into one PDF, by type first
 * and then date second").
 *
 * By type first, then date within type, using the SAME fileGroup() and the
 * same date ordering as the Uploads page, so the compiled document and the
 * screen he compiled it from can never disagree about what goes where.
 *
 * WHAT IT CAN AND CANNOT CONTAIN, said plainly here and on the cover page,
 * because a compilation that quietly drops half a case file is worse than no
 * compilation at all.
 *
 * There is no PDF library in this app and no build step to add one, so this
 * goes through the same print path everything else does: build a document,
 * let the browser render it to PDF. That means IMAGES ARE EMBEDDED and print
 * in full, and a PDF, a recording or a Word file cannot be: a browser will
 * not inline one document inside another it is printing. Those are listed in
 * place, in their right group and date order, with their name, size and a
 * link, so the compiled file is a complete index of the case and a complete
 * rendering of everything that can be rendered.
 *
 * Merging real PDFs would have to happen server side, and the Worker's CPU
 * ceiling is the same one that already killed the call document once.
 */
async function compileCaseFile() {
  const said = (m, bad) => { say('compile', m, { tone: bad ? 'warn' : 'ok' }); refreshOverview(); };
  said('Gathering every file on the case…');
  let rows;
  try {
    rows = await listCaseFiles();
  } catch (err) {
    said(`Could not read the files: ${err.message}`, true);
    return;
  }
  if (!rows.length) { said('There are no files on this case yet.', true); return; }

  // Type first, date second. ORDER IS THE FEATURE, so it is explicit rather
  // than left to whatever listCaseFiles happened to return.
  const ORDER = ['Reports', 'Documents', 'Images', 'Recordings', 'Other'];
  const byGroup = new Map();
  for (const r of rows) {
    const g = fileGroup(r);
    if (!byGroup.has(g)) byGroup.set(g, []);
    byGroup.get(g).push(r);
  }
  for (const list of byGroup.values()) list.sort((a, b) => a.ts - b.ts);
  const groups = ORDER.filter((g) => byGroup.has(g)).map((g) => [g, byGroup.get(g)]);

  const isImg = (r) => {
    const ct = (r.contentType || '').toLowerCase();
    // HEIC is an image that browsers will not render, so it is listed rather
    // than embedded as a broken box.
    return ct.startsWith('image/') && !/heic|heif/.test(ct);
  };
  const size = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB`
    : n > 1024 ? `${Math.round(n / 1024)} KB` : `${n || 0} B`);
  const when = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, year: 'numeric', month: 'long', day: 'numeric',
  });

  const embedded = rows.filter(isImg).length;
  const listed = rows.length - embedded;
  const win = window.open('', '_blank');
  if (!win) { said('Your browser blocked the print window. Allow pop-ups and try again.', true); return; }

  const body = groups.map(([g, list]) => `
    <section class="grp">
      <h2>${esc(g)}<span class="n">${list.length} file${list.length === 1 ? '' : 's'}</span></h2>
      ${list.map((r) => `
        <article class="item">
          <p class="meta"><strong>${esc(readName(r))}</strong><br>
            ${esc(when.format(r.ts))} · ${esc(size(r.size))} · ${esc(r.kindLabel || r.kind || '')}</p>
          ${isImg(r)
            ? `<img src="${esc(r.url)}" alt="${esc(readName(r))}">`
            : `<p class="not-shown">Not rendered here: a ${esc((r.contentType || 'file').split('/').pop())}
                 cannot be printed inside another document.
                 <a href="${esc(r.url)}">Open the original</a></p>`}
        </article>`).join('')}
    </section>`).join('');

  win.document.write(`<!doctype html><html><head><meta charset="utf-8">
    <title>${esc(data?.clientName || 'Case')} case file</title>
    <style>
      @page { margin: 14mm; }
      body { font: 12px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; color: #111; }
      h1 { font-size: 20px; margin: 0 0 2mm; }
      .cover { border-bottom: 2px solid #111; padding-bottom: 4mm; margin-bottom: 6mm; }
      .cover p { margin: 1mm 0; color: #444; }
      .grp { page-break-before: always; }
      .grp:first-of-type { page-break-before: avoid; }
      h2 { font-size: 15px; border-bottom: 1px solid #bbb; padding-bottom: 1.5mm; margin: 0 0 4mm; }
      h2 .n { float: right; font-weight: 400; color: #666; font-size: 12px; }
      .item { page-break-inside: avoid; margin: 0 0 7mm; }
      .meta { margin: 0 0 2mm; }
      .meta strong { font-size: 13px; }
      img { max-width: 100%; max-height: 210mm; display: block; border: 1px solid #ddd; }
      .not-shown { margin: 0; padding: 3mm; background: #f4f4f4; border-left: 3px solid #999; color: #444; }
      a { color: #14508c; }
    </style></head><body>
    <div class="cover">
      <h1>${esc(data?.clientName || 'Case')} &mdash; complete case file</h1>
      <p>Compiled ${esc(when.format(new Date()))} &middot; ${rows.length} file${rows.length === 1 ? '' : 's'}, by type then by date.</p>
      <p>${embedded} image${embedded === 1 ? '' : 's'} printed in full.
         ${listed} other file${listed === 1 ? '' : 's'} listed with a link: a PDF, a recording or a
         Word file cannot be printed inside another document.</p>
    </div>
    ${body}</body></html>`);
  win.document.close();
  // Images have to finish loading or the print runs on empty boxes. Waiting on
  // the window's own load event rather than a fixed delay, which is the
  // difference between a compiled case file and a stack of grey rectangles.
  const go = () => setTimeout(() => win.print(), 400);
  if (win.document.readyState === 'complete') go();
  else win.addEventListener('load', go, { once: true });
  said(`Compiled ${rows.length} file${rows.length === 1 ? '' : 's'}. Choose Save to Files in the share sheet to keep the PDF.`);
}

function paintFiles(pane) {
  pane.innerHTML = `
    <div class="panel">
      <h3>📎 Uploads</h3>
      <!-- This line used to end "then Analyze in the advisor". There is no
           Analyze button on the advisor and has not been one for a while; the
           button is Update. An instruction naming a control that does not
           exist is worse than no instruction. -->
      <p class="dim small">Everything shared on this case, newest day first. Tap 👨‍⚕️ on a file to hand it to the advisor, then press Update on the Read page.</p>
      <label class="small" style="margin-top:.7rem;">Upload the recording
        <input type="file" id="up-recording" accept="video/*,audio/*,.mp4,.m4a,.mp3,.mkv,.webm">
      </label>
      <!-- ONE PICKER, TWO DECISIONS, IN THE ORDER HE MAKES THEM. He knows what
           the document IS before he goes looking for it, so the category is
           above the file field rather than beside it, and the sentence under
           it changes to say what this particular choice does. A call summary
           must NOT advance the case: report-uploaded marks the report
           delivered, which ends the case chat 48 hours later. -->
      <label class="small" style="margin-top:.7rem; display:block;">What are you uploading?
        <select id="up-cat" style="margin-left:.35rem;">
          ${UPLOAD_CATEGORIES.map((x) => `<option value="${x.id}">${esc(x.label)}</option>`).join('')}
        </select>
      </label>
      <p class="dim small" id="up-cat-note" style="margin:.3rem 0 .1rem;"></p>
      <label class="small" style="margin-top:.2rem;">Choose the file
        <input type="file" id="up-report" accept=".pdf,.html,.md,.doc,.docx,.jpg,.jpeg,.png,.heic">
      </label>
      <progress id="bar" max="100" value="0" hidden></progress>
      <p class="error" id="err" hidden></p>
      <p class="saved-note ok" id="up-said" role="status" hidden></p>
      <hr class="divide">
      <label class="small" style="display:block; margin:0 0 .5rem;">Find an upload
        <input type="search" id="up-search" placeholder="Search by name or label"
          autocomplete="off" style="width:100%; margin-top:.25rem;"></label>
      <div class="uploads" id="files"><p class="dim small">Loading…</p></div>
    </div>`;
  pane.querySelector('#up-recording').addEventListener('change', (e) =>
    upload(e.target.files[0], 'recording', 'recording-uploaded'));
  // The search box lives OUTSIDE #files so repaints never eat a keystroke.
  // A fresh pane always starts unfiltered.
  fileQuery = '';
  const searchEl = pane.querySelector('#up-search');
  let searchTick = 0;
  searchEl?.addEventListener('input', () => {
    const tick = ++searchTick;
    setTimeout(() => {
      if (tick !== searchTick) return;
      fileQuery = searchEl.value || '';
      refreshFiles({ fromCache: true });
    }, 160);
  });
  // The category picker drives the sentence AND the route the upload finishes
  // with, so the two can never say different things.
  const cat = pane.querySelector('#up-cat');
  const note = pane.querySelector('#up-cat-note');
  const sayWhat = () => {
    const c = categoryOf(cat.value) || UPLOAD_CATEGORIES[0];
    note.textContent = c.action === 'report-uploaded'
      ? 'Marks the case delivered and starts their 48 hours to ask about it.'
      : `Files it on their case as a ${c.label.toLowerCase()} and tells them by name. Nothing about the case moves.`;
  };
  cat.addEventListener('change', sayWhat);
  sayWhat();
  pane.querySelector('#up-report').addEventListener('change', (e) => {
    const c = categoryOf(cat.value) || UPLOAD_CATEGORIES[0];
    upload(e.target.files[0], 'report', c.action, c.id);
  });
}

async function api(body) {
  const idToken = await user.getIdToken();
  const res = await fetch('/api/admin/case-update', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ caseId, ...body }),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
  return out;
}

/**
 * Eric, 2026-08-26: "I put meeting link in but it didn't visually confirm
 * that it saved. So idk if my client is seeing it."
 *
 * The answer he needs is not "saved", it is what is on their screen now. For
 * a video call that is a Join button; clearing the field puts their page back
 * to the sentence that says the link is coming. For a PHONE case it is
 * neither: case.js renders `I call you at <their number>` and never renders
 * this field at all, so what he types here is a note to himself. Telling him
 * "your client can see it" on a phone case would be a lie about the exact
 * thing he asked about, so it says the true thing instead.
 */
async function saveLink() {
  const btn = document.getElementById('save-link');
  const value = document.getElementById('joinlink').value.trim();
  const phone = data?.appointment?.method === 'phone';
  if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
  try {
    await api({ action: 'join-link', joinLink: value });
    // RE-READ THE CASE BEFORE CLAIMING ANYTHING. A 200 means the request was
    // accepted, and what he asked for is whether his client can SEE it, which
    // is a question about the stored document and not about the response
    // code. So load() first, then check the case actually holds what he
    // typed, and only then say it is live. A route that quietly accepts and
    // does not write now shows up here instead of shipping a confident lie.
    await load();
    const stored = data?.appointment?.joinLink || '';
    if (stored !== value) {
      say('link', 'That went through, but the case still does not show it. '
        + 'Do not rely on your client seeing it yet: try once more.', { tone: 'warn' });
    } else {
      say('link', phone
        ? (value
          ? 'Saved on the case. Their page shows the number I call YOU at, not this one, so this is a note to yourself.'
          : 'Cleared. Their page was never showing this, so nothing changed for them.')
        : (value
          ? 'Saved. Your client now sees a "Join the video call" button on their case page.'
          : 'Cleared. Their page is back to saying the join link appears there before the call.'));
    }
    refreshOverview();
  } catch (err) {
    // Onto the panel, not into an alert: an alert is dismissed and gone, and
    // this is the one place where he needs the words still there when he
    // looks back at the field.
    say('link', `Not saved: ${err.message}`, { tone: 'warn' });
    refreshOverview();
  }
}

async function milestone(action, btn) {
  if (action === 'close' && !confirm('Close this case? The client keeps the file forever; chat ends (Phase 3).')) return;
  btn.disabled = true;
  try {
    await api({ action });
    // Same rule as the meeting link: re-read, then name what moved on THEIR
    // page, and only if it actually moved.
    await load();
    const landed = action === 'recording-uploaded' ? !!data?.reportDueAt
      : action === 'report-uploaded' ? (data?.status === 'delivered' || data?.status === 'closed')
        : true;
    if (!landed) {
      say('miles', 'That went through, but the case has not moved. Try once more.', { tone: 'warn' });
    } else {
      say('miles', action === 'recording-uploaded'
        ? 'Marked. Their page now shows the report as due, and the seven days are running.'
        : action === 'report-uploaded'
          ? 'Marked. Their page now says the report is delivered.'
          : 'Done.');
    }
    refreshOverview();
  } catch (err) {
    btn.disabled = false;
    say('miles', `Not saved: ${err.message}`, { tone: 'warn' });
    refreshOverview();
  }
}

async function upload(file, kind, milestoneAction, category = '') {
  if (!file) return;
  const bar = document.getElementById('bar');
  const err = document.getElementById('err');
  const done = document.getElementById('up-said');
  err.hidden = true;
  if (done) done.hidden = true;
  bar.hidden = false;
  const safe = file.name.replace(/[^\w.\- ]+/g, '_');
  // ${Date.now()}- IN FRONT, which every other upload path in this app already
  // does and this one alone did not. Storage overwrites on a repeated path
  // without a word, so two files called "Summary.pdf" were one file, and the
  // first one was gone. He is about to upload many documents with names like
  // that. Both listings strip the prefix for display (`^\d{10,}-`), so a file
  // uploaded before today still reads correctly.
  const path = `cases/${caseId}/${kind}/${Date.now()}-${safe}`;
  const task = uploadBytesResumable(ref(storage, path), file,
    // THE CATEGORY IS A LABEL, NOT A FOLDER. storage.rules names exactly four
    // client-readable folders and prep-shelf.mjs pins that list by string
    // equality, because a recursive wildcard once put anything dropped under a
    // case straight onto a client's screen. So a call summary is a report-
    // folder file wearing a different word. getMetadata() is already called on
    // every file in both listings, so this costs no extra request.
    category ? { customMetadata: { paCategory: category } } : undefined);
  try {
    await new Promise((resolve, reject) => {
      task.on('state_changed',
        (snap) => { bar.value = (snap.bytesTransferred / snap.totalBytes) * 100; },
        reject, resolve);
    });
    // The name goes with it. The client's notification says WHAT landed, and
    // the Worker cannot see Storage, so the only place that name can come from
    // is here.
    await api({ action: milestoneAction, category, fileName: file.name });
    // The bar hides and the list repaints, which up to now was the whole of
    // the feedback: he could not tell an upload that landed from one that
    // silently did not. The Uploads page is not repainted wholesale by load(),
    // so this line can simply stay put.
    if (done) {
      const cat = UPLOAD_CATEGORIES.find((x) => x.id === category);
      done.textContent = milestoneAction === 'report-uploaded'
        ? `“${file.name}” is up. Your client can open it on their case page now, and their page says the report is delivered.`
        : cat
          ? `“${file.name}” is up, filed as a ${cat.label.toLowerCase()}. Your client can open it now and has been notified by name.`
          : `“${file.name}” is up. Your client can open it on their case page now.`;
      done.hidden = false;
    }
    load();
  } catch (e) {
    err.textContent = `Upload failed: ${e.message}`;
    err.hidden = false;
  }
  bar.hidden = true;
}

/**
 * WHAT A DOCUMENT HE UPLOADS IS. Eric, 2026-08-27: "All SOAP notes and visit
 * f/u summaries are done through uploads. I simply need an upload type to
 * separate the category. So they're labeled. 'Call Summaries,' for example.
 * They get notified that I uploaded [file name]."
 *
 * He writes the document. Nothing here generates, summarises or reads
 * anything; this is a word attached to a file he already has.
 *
 * A LABEL, NEVER A FOLDER. storage.rules grants a client read on exactly four
 * named folders and prep-shelf.mjs pins that list by string equality, because
 * a recursive wildcard once made anything dropped under a case instantly
 * client-readable. So every one of these lands in report/ and carries its
 * category in Storage customMetadata, which both listings already fetch.
 *
 * `action` is the Worker route the upload finishes with, and it is the reason
 * the list is shaped this way rather than being a bare array of words: only
 * the report advances the case to delivered. A call summary that marked the
 * report delivered would end the case chat 48 hours later.
 *
 * ADDING ONE IS SIX ONE-LINE EDITS, and every one of them is load-bearing:
 * here; FILE_GROUPS below, or the file renders under a heading the page never
 * prints and disappears; the client's CATS map in case.js, pinned equal to
 * this list by tools/suites/uploads.mjs; SUMMARY_KINDS in the Worker, which is
 * the only thing that decides the words in a push and is keyed by id so a
 * caller can never name its own; the .kind-pill rule in site.css, joining an
 * existing token rather than inventing a hue; and the demo's own copy of the
 * kinds map, because Eric drives the demo.
 *
 * Eric, 2026-08-27: "Doctor appointment summaries should also be a tag
 * because I will upload one after an attendance at a doctor's visit." And,
 * the same day: "A 'form sent to client' should be included as a category.
 * Then once it's filled out and sent back to me I'll delete the one I sent
 * him and reupload that and categorize it as 'filled forms'."
 *
 * The two form rows are ONE document at two points in its life, not two
 * kinds of thing, which is why they sit next to each other and why the
 * blank one is deleted rather than left beside the filled one.
 *
 * Every one of these carries action 'summary-uploaded' like the documents he
 * writes; ONLY the report may carry 'report-uploaded', which advances the
 * case to delivered, starts the client's 48 hours and closes the chat.
 */
const UPLOAD_CATEGORIES = [
  { id: 'report', label: 'Report', pill: 'REPORT', group: 'Reports', action: 'report-uploaded' },
  { id: 'callsummary', label: 'Call summary', pill: 'CALL SUMMARY', group: 'Call summaries', action: 'summary-uploaded' },
  { id: 'visitfollowup', label: 'Visit follow-up', pill: 'VISIT FOLLOW-UP', group: 'Visit follow-ups', action: 'summary-uploaded' },
  { id: 'apptsummary', label: 'Appointment summary', pill: 'APPOINTMENT', group: 'Appointment summaries', action: 'summary-uploaded' },
  { id: 'formsent', label: 'Form sent to client', pill: 'FORM SENT', group: 'Forms sent', action: 'summary-uploaded' },
  { id: 'formfilled', label: 'Filled form', pill: 'FILLED FORM', group: 'Filled forms', action: 'summary-uploaded' },
];
const categoryOf = (id) => UPLOAD_CATEGORIES.find((x) => x.id === id) || null;

/**
 * A CATEGORY IS A LABEL ON A FILE, AND A FILE CAN BE FILED AFTER IT LANDS.
 *
 * Every reader of `cat` used to gate on `kind === 'report'`, and that was
 * right while the label could only be stamped on at upload time: report/ was
 * the only folder a labelled file could come from. Eric can now long-press a
 * chat upload and file it (POST /api/file/meta), so the label has to be read
 * wherever he is allowed to write one, which is the same four case folders
 * that route accepts.
 *
 * The client's own profile shelf is deliberately absent from that set, here
 * and on the route: it follows the person rather than the case, and it is
 * theirs to keep rather than his to file.
 */
const FILEABLE_KINDS = new Set(['report', 'upload', 'chat', 'recording']);
const filedCat = (r) => (FILEABLE_KINDS.has(r.kind) && categoryOf(r.cat) ? r.cat : '');

/**
 * The name a person reads on a file row.
 *
 * A Storage object's name IS its identity and cannot be changed - see
 * patchObjectMeta in worker/storage.js for what a real rename would cost. So
 * a file Eric has renamed carries the name he typed beside its bytes, and it
 * is preferred here over the object name with its upload timestamp stripped.
 * A file nobody has renamed has none, and reads exactly as it always did.
 */
const readName = (r) => r.display || String(r.name || '').replace(/^\d{10,}-/, '');

// Uploads are grouped by day and then by what kind of thing they are. The
// order inside a day is deliberate: the report is the deliverable, documents
// are what the advisor reads, images are usually screenshots of documents, and
// a recording is an hour of video nobody scrubs through on a phone. The two
// document types he writes himself sit directly under the report, because they
// are the same kind of thing: something he produced for this client.
const FILE_GROUPS = ['Reports', 'Call summaries', 'Visit follow-ups',
  'Appointment summaries', 'Forms sent', 'Filled forms',
  'Documents', 'Images', 'Recordings', 'Other'];

function fileGroup(r) {
  // The category first: a call summary IS a report-folder file, so a check on
  // the folder alone would file every one of them under Reports. And a chat
  // upload he has filed as a filled form belongs under Filled forms rather
  // than under whatever its file extension suggests.
  const filed = filedCat(r);
  if (filed) return categoryOf(filed).group;
  if (r.kind === 'report') return 'Reports';
  if (r.kind === 'recording') return 'Recordings';
  const ct = (r.contentType || '').toLowerCase();
  const name = (r.name || '').toLowerCase();
  if (ct.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif)$/.test(name)) return 'Images';
  if (ct.startsWith('video/') || ct.startsWith('audio/')) return 'Recordings';
  if (ct === 'application/pdf' || /\.(pdf|docx?|txt|md|rtf|csv|xlsx?)$/.test(name)) return 'Documents';
  return 'Other';
}

/** "Today", "Yesterday", then the date itself. Grouping needs a stable key. */
function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayLabel(d) {
  const today = new Date();
  const y = new Date(today.getTime() - 86_400_000);
  if (dayKey(d) === dayKey(today)) return 'Today';
  if (dayKey(d) === dayKey(y)) return 'Yesterday';
  return d.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
    year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

/**
 * Every file on this case, from Storage.
 *
 * Pulled out of refreshFiles so the call document's picker can offer the same
 * list. Two readers, one listing: a second copy of these five paths is how the
 * two pages start disagreeing about what exists on a case.
 *
 * THIS USED TO LOOK HUNG, and on a real case it nearly was. Eric, 2026-08-26,
 * with a screenshot: "Looking for files on this case…" sitting there while the
 * file he had just uploaded was on the screen above it. It was not hung, it
 * was serial. Five folders, one after another with `await listAll`, and then
 * inside each folder's loop another awaited round trip PER FILE for the url
 * and the metadata. On a case with a dozen files that is seventeen round trips
 * end to end, on a phone, before a single row can be drawn.
 *
 * Everything that does not depend on anything else now runs at once: the five
 * folders together, and within each folder every file's url and metadata
 * together. The wall time becomes the slowest single round trip plus change,
 * instead of the sum of all of them.
 *
 * `onProgress` is the other half of the fix and it is not decoration. Even a
 * fast listing is a moment of nothing, and a screen that says nothing while it
 * waits is the same screen as a screen that has died. The caller gets a count
 * as folders land and a `failed` count if any of them did not, so it can say
 * which of those two things is happening rather than leaving one sentence up
 * forever and letting him guess.
 */
/**
 * Every file on the case, from Storage.
 *
 * WHY THIS IS PARALLEL, AND WHY IT REPORTS PROGRESS (Eric, 2026-08-26). He
 * photographed the call document panel sitting on "Looking for files on this
 * case..." while his own uploaded document waited above it. It was not hung.
 * It was SERIAL: five folders listed one after another with `await` in a for
 * loop, and then, for every single file found, another awaited round trip for
 * its URL and its metadata, one file at a time. On a real case that is dozens
 * of sequential requests over a phone connection, which is indistinguishable
 * from broken.
 *
 * Now the five folders list at once, every file's url and metadata are fetched
 * together, and `onProgress` lets the caller say what it has found so far. The
 * wall clock becomes the slowest single request instead of the sum of all of
 * them, and while it runs the panel counts up instead of sitting on one
 * sentence.
 *
 * What is deliberately NOT changed: which folders are read. The private `prep`
 * shelf is still absent, and the comment above listPrep explains why that is a
 * client-visibility rule and not a style preference. Adding it here is the day
 * his working notes appear on a page a client can open.
 */
async function listCaseFiles({ onProgress } = {}) {
  const places = [
    ['report', `cases/${caseId}/report`],
    ['recording', `cases/${caseId}/recording`],
    ['upload', `cases/${caseId}/uploads`],
    // Files shared in the chat, which until now appeared nowhere in this list
    // at all - the second half of the same blind spot that lost Eric's
    // documents. They live under the case, so they belong on the case's page.
    ['chat', `cases/${caseId}/chat-files`],
    ['saved', `profiles/${data.clientUid}/saved`],
  ];
  let done = 0;
  let files = 0;
  let failed = 0;
  const tick = () => {
    try { onProgress?.({ done, total: places.length, files, failed }); }
    catch { /* a progress line must never be able to fail a listing */ }
  };
  tick();

  const perPlace = await Promise.all(places.map(async ([kind, path]) => {
    try {
      const res = await listAll(ref(storage, path));
      return await Promise.all(res.items.map(async (item) => {
        try {
          const [url, meta] = await Promise.all([getDownloadURL(item), getMetadata(item)]);
          files += 1;
          tick();
          return {
            kind, name: item.name, url, ts: new Date(meta.timeCreated),
            size: meta.size, contentType: meta.contentType || '', path: item.fullPath,
            // Arrives with the metadata this line already fetched, so the
            // category costs nothing. A file uploaded before the control
            // existed has none and reads as a plain report, which is what it
            // is.
            cat: meta.customMetadata?.paCategory || '',
            starred: !!meta.customMetadata?.paStarred,
            starAt: Number(meta.customMetadata?.paStarred) || 0,
            // And the name he gave it AFTER it landed, if he gave it one. It
            // rides on the same metadata this line already fetched, so a
            // rename costs no extra request in either listing.
            display: meta.customMetadata?.paName || '',
          };
        } catch {
          // One unreadable object must not lose the other nineteen, which is
          // what a single rejection inside a Promise.all would do.
          return null;
        }
      }));
    } catch {
      // One unreadable folder is not an empty case. It is counted so the
      // caller can say so instead of quietly showing a short list.
      failed += 1;
      return [];
    } finally {
      done += 1;
      tick();
    }
  }));
  // Flattened in the order of `places`, so the same case always lists the same
  // way however the five requests happen to finish.
  return perPlace.flat().filter(Boolean);
}

/**
 * The files the advisor can actually read. Images and PDFs go straight to it
 * for a real read; HEIC it refuses outright, and "saved" copies are the
 * client's own profile shelf, outside the advisor's fence.
 */
function advisorReadable(r) {
  const ct = (r.contentType || '').toLowerCase();
  return r.kind !== 'saved' && !/heic|heif/.test(ct)
    && (ct.startsWith('image/') || ct === 'application/pdf' || /\.pdf$/i.test(r.name));
}

/**
 * Eric's private shelf, listed straight from Storage.
 *
 * Deliberately NOT folded into listCaseFiles: that function feeds the client-
 * visible Uploads page, and the day someone adds `prep` to its folder list is
 * the day his working notes appear on a page a client can read. Two readers,
 * two lists, and the private one is the one nothing else calls.
 */
async function listPrep() {
  try {
    const res = await listAll(ref(storage, `cases/${caseId}/${PREP_DIR}`));
    const rows = await Promise.all(res.items.map(async (item) => {
      const [url, meta] = await Promise.all([getDownloadURL(item), getMetadata(item)]);
      return {
        name: String(item.name).replace(/^\d{10,}-/, ''),
        path: item.fullPath,
        url,
        contentType: meta.contentType || '',
        size: meta.size || 0,
        ts: new Date(meta.timeCreated),
      };
    }));
    prepFiles = rows.sort((a, b) => b.ts - a.ts);
  } catch {
    prepFiles = [];
  }
  return prepFiles;
}

/**
 * How far along a listing is, in a sentence. Shared by the Uploads page and
 * the call document's picker so the two cannot describe the same wait
 * differently. A count that moves is the difference between waiting and
 * wondering whether it has died.
 */
function listingLine({ done, total, files, failed }) {
  if (done < total) {
    return `Looking for files on this case… ${done} of ${total} places`
      + (files ? `, ${files} file${files === 1 ? '' : 's'} so far` : '');
  }
  if (failed) {
    return `Couldn't read ${failed} of ${total} places on this case`
      + (files ? `, so this list may be short. ${files} file${files === 1 ? '' : 's'} found.` : '.');
  }
  return '';
}

let filesGen = 0;
// The last full listing and the live search term (Eric, 2026-08-30: "There's
// a search bar to search for key terms that pull up uploads"). Typing filters
// the cached listing; it never re-lists Storage per keystroke.
let filesRows = null;
let fileQuery = '';
async function refreshFiles({ fromCache = false } = {}) {
  const listEl = document.getElementById('files');
  if (!listEl) return;
  // Two refreshes can be in flight at once (a second star tapped while the
  // first repaint is still listing), and the real listing is slow enough for
  // the OLDER pass to finish last and paint stale metadata over the newer
  // truth: that is how a second pin looked refused (Eric, 2026-08-30).
  // Newest pass wins; every older one drops its paint.
  const gen = ++filesGen;
  let last = null;
  let rows;
  if (fromCache && filesRows) {
    rows = filesRows;
  } else {
    rows = await listCaseFiles({
      onProgress: (p) => {
        last = p;
        // Only while it is still working. Once it is done the list itself is
        // the answer, and a progress line under a list of files is noise.
        if (p.done < p.total && gen === filesGen && document.getElementById('files') === listEl) {
          listEl.innerHTML = `<p class="dim small">${esc(listingLine(p))}</p>`;
        }
      },
    });
    filesRows = rows;
  }
  const short = last && last.failed
    ? `<p class="saved-note warn" role="status"><span>${esc(listingLine(last))}
         Try opening this page again.</span></p>`
    : '';
  if (gen !== filesGen) return;
  if (!rows.length) {
    listEl.innerHTML = short || '<p class="dim small">No files yet.</p>';
    return;
  }
  const reviewable = advisorReadable;
  // Image rows get a real thumbnail; tapping it opens the same lightbox the
  // chat uses. HEIC won't render in an <img>, so it stays a plain link.
  const thumbable = (r) => {
    const ct = (r.contentType || '').toLowerCase();
    return ct.startsWith('image/') && !/heic|heif/.test(ct);
  };
  const label = (r) => (filedCat(r) && categoryOf(filedCat(r)).pill)
    || (r.kind === 'saved' ? 'SAVED' : r.kind === 'chat' ? 'CHAT' : r.kind.toUpperCase());
  const pillClass = (r) => filedCat(r) || r.kind;

  // Newest day first; inside a day, newest file first within its group.
  rows.sort((a, b) => b.ts - a.ts);
  const days = new Map();
  for (const r of rows) {
    const k = dayKey(r.ts);
    if (!days.has(k)) days.set(k, { label: dayLabel(r.ts), groups: new Map() });
    const g = fileGroup(r);
    const groups = days.get(k).groups;
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(r);
  }

  const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' });
  // Three columns rather than one wrapping line: the thumbnail, then the name
  // and its meta, then the badge. On a phone a single flex row pushed the file
  // name down to "sl..." and then spread an image row over three lines.
  const row = (r) => {
    const i = rows.indexOf(r);
    return `
    <li data-frow="${i}">
      ${thumbable(r) ? `<img class="thumb" src="${r.url}" alt="" loading="lazy" data-thumb="${i}">` : ''}
      <span class="up-text">
        <span class="fname"><span class="kind-pill ${pillClass(r)}">${label(r)}</span><a href="${r.url}" target="_blank" rel="noopener">${esc(readName(r))}</a></span>
        <span class="fmeta">${time.format(r.ts)} · ${prettySize(r.size)}</span>
      </span>
      ${r.kind === 'saved' ? '' : `<button class="star-tap" data-star="${i}"
        style="background:none; border:0; padding:.3rem .35rem; font-size:1.25rem; line-height:1; cursor:pointer;${r.starred ? '' : ' opacity:.35; filter:grayscale(1);'}"
        aria-label="${r.starred ? `Unstar ${esc(readName(r))}` : `Star ${esc(readName(r))}: pin to the top`}"
        title="${r.starred ? 'Unstar: back into its day' : 'Star: pin to the top'}">⭐</button>`}
      ${reviewable(r)
        ? `<button class="btn quiet file-review" data-review="${i}"
             aria-label="Hand ${esc(readName(r))} to the advisor to read"
             title="Hand this to the advisor to read, then press Update on the Read page">👨‍⚕️</button>`
        : ''}
    </li>`;
  };

  // THE PINNED BLOCK (Eric, 2026-08-30): starred files ride above the day
  // pager, always visible whatever day the pager shows. They keep their spot
  // inside their day too; the pin is a pointer, not a move.
  const starred = rows.filter((r) => r.starred)
    .sort((x, y) => (x.starAt || 0) - (y.starAt || 0));
  const pinnedHtml = starred.length ? `
    <section class="up-pinned">
      <h4 class="up-date">⭐ Priority</h4>
      <ul class="filelist">${starred.map(row).join('')}</ul>
    </section>` : '';
  // THE SEARCH (Eric, 2026-08-30): a term replaces the day pages with one
  // flat list of everything it pulls up, across every day at once; the
  // pinned block above rides through untouched. Clearing the box brings the
  // days back exactly where they were.
  const q = fileQuery.trim().toLowerCase();
  const hits = q ? rows.filter((r) => `${readName(r)} ${label(r)}`.toLowerCase().includes(q)) : [];
  const daysHtml = q ? `
    <section class="up-day">
      <h4 class="up-date">🔎 ${hits.length ? `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}` : 'No matches'} for “${esc(fileQuery.trim())}”</h4>
      <ul class="filelist">${hits.map(row).join('')}</ul>
    </section>` : [...days.values()].map((day) => `
    <section class="up-day">
      <h4 class="up-date">${esc(day.label)}</h4>
      ${FILE_GROUPS.filter((g) => day.groups.has(g)).map((g) => `
        <h5 class="up-kind">${esc(g)}<span class="up-n">${day.groups.get(g).length}</span></h5>
        <ul class="filelist">${day.groups.get(g).map(row).join('')}</ul>`).join('')}
    </section>`).join('');
  listEl.innerHTML = short + pinnedHtml + daysHtml;
  // One day per page (Eric, 2026-08-30), same pager as the work log. A
  // search shows its one flat section and needs no pager at all.
  if (!q) pageByDay('files', [...listEl.querySelectorAll('.up-day')],
    [...days.values()].map((d) => d.label), { olderStep: 1 });
  listEl.querySelectorAll('[data-thumb]').forEach((img) => {
    const r = rows[Number(img.dataset.thumb)];
    img.addEventListener('click', () => openLightbox({ name: readName(r), url: r.url }));
  });
  // Long-press (or right-click) any row for that file's own menu: Rename,
  // File as..., Delete. Full authority on this side (Eric, 2026-08-22: "I get
  // authority on both").
  listEl.querySelectorAll('[data-frow]').forEach((li) => {
    const r = rows[Number(li.dataset.frow)];
    if (!r?.path) return;
    wireHeldPress(li, () => { openFileMenu(r); });
  });

  // The star, A TAP AND NEVER A LONG PRESS (Eric, 2026-08-30: "It's not a
  // long press, that causes issues"): the outline fills and the file pins,
  // in the order he starred them. Every copy of a row wears one, the pinned
  // copy included, so an unstar is one tap wherever he sees the file.
  listEl.querySelectorAll('[data-star]').forEach((b) => {
    const r = rows[Number(b.dataset.star)];
    b.addEventListener('click', () => {
      b.disabled = true;
      // Instant truth on the glyph he tapped; the repaint that follows the
      // save re-renders the whole list with the stored state.
      b.style.opacity = r.starred ? '.35' : '1';
      b.style.filter = r.starred ? 'grayscale(1)' : 'none';
      starCaseFile(r);
    });
  });

  // Toggle to stage the file for the advisor's next analysis; highlighted
  // while staged. The advisor panel owns the selection and the Analyze run.
  listEl.querySelectorAll('[data-review]').forEach((b) => {
    const r = rows[Number(b.dataset.review)];
    b.dataset.url = r.url;
    if (window.__paMediaSel?.has(r.url)) b.classList.add('on');
    b.addEventListener('click', () => {
      b.classList.toggle('on');
      document.dispatchEvent(new CustomEvent('pa-panel-toggle', {
        detail: { attachment: { name: r.name, url: r.url, contentType: r.contentType, size: r.size || 0 } },
      }));
    });
  });
}

/**
 * A HELD PRESS, the way every other held press in this app works.
 *
 * Pointer events with a movement tolerance, the same 550ms and the same 12px
 * as wireFolderLongPress in drawer.js. What this replaces listened for
 * `touchstart` alone with no tolerance at all, and both halves of that were
 * wrong in a way you only find by using it: a held MOUSE press did nothing,
 * so on the machine he does his long sessions on the feature simply was not
 * there, and a finger dragged down a long list fired the menu on the way past
 * because nothing was watching for movement.
 */
const HELD_PRESS_MS = 550;
const HELD_PRESS_MOVE = 12;

function wireHeldPress(el, fire) {
  let timer = null;
  let from = null;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } from = null; };
  // The controls that already answer a tap keep it. A press that lingered on
  // the advisor button or a thumbnail would pop a menu offering something else
  // entirely, on top of the thing he was actually reaching for.
  const onOwnControl = (e) => !!e.target.closest?.('button, .thumb');
  const fired = () => {
    // The click that TRAILS a held press must not also follow the file link,
    // which would open the file in a new tab behind the sheet. Eaten once, and
    // then disarmed: a press fired from a right-click has no trailing click,
    // and a listener left armed would spend itself on his next ordinary tap
    // instead. That is the stale-mark bug drawer.js documents, in a new shape.
    const eat = (e) => { e.preventDefault(); e.stopPropagation(); };
    el.addEventListener('click', eat, { capture: true, once: true });
    setTimeout(() => el.removeEventListener('click', eat, { capture: true }), 400);
    fire();
  };
  el.addEventListener('pointerdown', (e) => {
    if (onOwnControl(e)) return;
    from = { x: e.clientX, y: e.clientY };
    timer = setTimeout(() => { timer = null; fired(); }, HELD_PRESS_MS);
  });
  el.addEventListener('pointermove', (e) => {
    if (!timer || !from) return;
    if (Math.hypot(e.clientX - from.x, e.clientY - from.y) > HELD_PRESS_MOVE) cancel();
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) {
    el.addEventListener(ev, cancel);
  }
  el.addEventListener('contextmenu', (e) => {
    if (onOwnControl(e)) return;
    e.preventDefault();
    cancel();
    fired();
  });
}

/** The Uploads page's own status line, reused by the file menu. */
function saidFiles(msg, bad) {
  const el = document.getElementById('up-said');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('warn', !!bad);
  el.classList.toggle('ok', !bad);
  el.hidden = false;
}

/**
 * THE FILE MENU. Eric, 2026-08-27: "the advisor/app should take anything
 * uploaded in the chat and add it to forms. I can long press and rename them."
 *
 * Asked whether every chat upload should file itself as a form, he chose:
 * "Filable, I choose." So nothing files itself, ever. A file a client shares
 * keeps saying FROM CHAT until he presses it and says what it is, which is why
 * this menu is the entire feature and there is no automatic path beside it.
 *
 * The client's own saved shelf gets Delete and nothing else. That shelf
 * follows the person rather than the case; the filing route refuses to write
 * metadata into it at all, and offering him two rows that would come back
 * "Bad path" is worse than not offering them.
 */
async function openFileMenu(r) {
  const name = readName(r);
  const mine = FILEABLE_KINDS.has(r.kind);
  const pick = await openMessageMenu({
    heading: name,
    label: 'File actions',
    extraRows: [
      // The star moved OUT of this menu the same day it arrived (Eric,
      // 2026-08-30: "It's not a long press, that causes issues"): it is the
      // visible ☆ button on every row now. This menu keeps the actions that
      // genuinely need a menu.
      ...(mine ? [
        { act: 'rename', emoji: '✏️', label: 'Rename' },
        { act: 'file', emoji: '🗂', label: 'File as...' },
      ] : []),
      { act: 'delete', emoji: '🗑', label: 'Delete' },
    ],
  });
  if (!pick) return;
  if (pick.action === 'rename') await renameCaseFile(r);
  else if (pick.action === 'file') await fileCaseFileAs(r);
  else if (pick.action === 'delete') await deleteCaseFile(r);
}

/**
 * Write a new name or a new category onto a file that already exists.
 *
 * THROUGH THE WORKER, never from here. Firebase's updateMetadata would need
 * storage.rules widened to let a browser write metadata, and storage.rules is
 * the one file that decides what a client can reach: a client who could write
 * metadata could rename the report or file their own chat upload as a filled
 * form. The route is behind requireAdmin and answers 404 to everyone else, so
 * it is not merely refused to a client, it is not there.
 */
async function saveFileMeta(r, patch) {
  const token = await user.getIdToken();
  const res = await fetch('/api/file/meta', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'case', id: caseId, path: r.path, ...patch }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
  return out;
}

async function starCaseFile(r) {
  try {
    const out = await saveFileMeta(r, { starred: !r.starred });
    saidFiles(out.starred
      ? `Starred. "${readName(r)}" is pinned at the top of the list here and on your client's page.`
      : 'Star removed. It sits back in its day.');
    refreshFiles();
  } catch (err) {
    saidFiles(`Not changed: ${err.message}`, true);
  }
}

async function renameCaseFile(r) {
  const typed = await openRenameSheet(readName(r));
  if (typed === undefined) return;
  try {
    const out = await saveFileMeta(r, { name: typed });
    saidFiles(out.name
      ? `Renamed. It reads as "${out.name}" here and on your client's page.`
      : 'Back to the name it was uploaded with.');
    refreshFiles();
  } catch (err) {
    saidFiles(`Not renamed: ${err.message}`, true);
  }
}

async function fileCaseFileAs(r) {
  const name = readName(r);
  // HIS OWN UPLOAD LIST, the same words in the same order. A document he
  // sends and a document he files are the same six kinds of thing, and a
  // second vocabulary here is how the two lists start disagreeing.
  const rows = UPLOAD_CATEGORIES.map((c) => ({
    act: `cat:${c.id}`,
    emoji: c.id === r.cat ? '✅' : '📄',
    label: c.label,
  }));
  if (r.cat) rows.push({ act: 'cat:', emoji: '✕', label: 'Take the label off' });
  const pick = await openMessageMenu({
    heading: `File "${name}" as`,
    label: 'File this as',
    extraRows: rows,
  });
  if (!pick || !String(pick.action).startsWith('cat:')) return;
  const id = String(pick.action).slice(4);
  if (id === (r.cat || '')) return;
  try {
    const out = await saveFileMeta(r, { category: id });
    const c = categoryOf(out.category);
    saidFiles(c
      ? `Filed as a ${c.label.toLowerCase()}. It sits under ${c.group} here, and your client's list says ${c.pill}.`
      : 'Label removed. It reads as an ordinary file again on both lists.');
    refreshFiles();
  } catch (err) {
    saidFiles(`Not filed: ${err.message}`, true);
  }
}

async function deleteCaseFile(r) {
  if (!confirm(`Delete "${readName(r)}"? This removes it for the client too.`)) return;
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/file/delete', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'case', id: caseId, path: r.path }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
    refreshFiles();
  } catch (err) { alert(`Couldn't delete: ${err.message}`); }
}

/**
 * "What should this be called?" Resolves to the new name, to '' for "put the
 * uploaded name back", or to undefined if he backs out.
 *
 * The current name goes in through .value, never through markup, which is the
 * same rule the client's own upload sheet follows: a file name is somebody
 * else's words and this dialog is the one place they come back out of storage
 * and onto a screen.
 */
function openRenameSheet(current) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay';
    overlay.innerHTML = `
      <div class="settings-card rename-card" role="dialog" aria-modal="true" aria-label="Rename this file">
        <div class="row"><h3 style="margin:0;">Rename this file</h3>
          <button class="btn quiet" data-cancel>Cancel</button></div>
        <p class="dim small" style="margin:.5rem 0 .7rem;">What it is called here and
          on your client's page. The file itself does not move, so every link to
          it keeps working.</p>
        <input type="text" data-name maxlength="80" autocomplete="off"
          autocapitalize="sentences" placeholder="Signed records release"
          style="width:100%;">
        <div class="actions" style="margin-top:.8rem; display:flex; gap:.5rem; flex-wrap:wrap;">
          <button class="btn glow" data-save>Use this name</button>
          <button class="btn quiet" data-orig>Put the uploaded name back</button>
        </div>
      </div>`;
    const input = overlay.querySelector('[data-name]');
    // Through .value, never through the template above: whatever it is called
    // now came off a file somebody else named.
    input.value = current || '';

    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    const save = () => {
      const typed = input.value.trim().replace(/\s+/g, ' ').slice(0, 80);
      done(typed);
    };
    function onKey(e) {
      if (e.key === 'Escape') { done(undefined); return; }
      if (e.key === 'Enter' && document.activeElement === input) { e.preventDefault(); save(); }
    }
    overlay.querySelector('[data-save]').addEventListener('click', save);
    overlay.querySelector('[data-orig]').addEventListener('click', () => done(''));
    overlay.querySelector('[data-cancel]').addEventListener('click', () => done(undefined));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(undefined); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    // Same rule as the client's naming sheet: do not raise the keyboard on a
    // short screen, where it covers the two buttons and iOS gives the overlay
    // nothing to scroll.
    if (window.innerHeight >= 700) setTimeout(() => input.focus(), 30);
  });
}

// A FILE SHARED IN THE CHAT BELONGS ON THIS PAGE THE MOMENT IT LANDS.
//
// The client's own Documents page has listened for this since chat files
// started appearing in it; this side never did, so a file either of us had
// just attached was on his Uploads page only after a reload - and the long
// press that files it is on that page. Same event, same reason. The listener
// is permanent and the page repaint is cheap enough to run unconditionally:
// refreshFiles returns early when the list is not mounted.
document.addEventListener('pa-saved-file', () => { refreshFiles(); });

// Repaint the file badges when the advisor panel consumes the selection.
document.addEventListener('pa-panel-select', () => {
  document.querySelectorAll('#files [data-review]').forEach((b) =>
    b.classList.toggle('on', !!window.__paMediaSel?.has(b.dataset.url)));
});

// ---- follow-up status + the scheduling panel ----

const FOLLOWUP_EXPIRY_MS = 30 * 86_400_000;

function followUpDaysLeft(c) {
  // The SAME base the Worker enforces (followUpBase): the purchase date when
  // there is one, the call otherwise. A follow-up is ALWAYS bought after the
  // call, so counting from the appointment expired it early on every case.
  const bought = c.addOnFollowUpAt ? toDate(c.addOnFollowUpAt).getTime() : null;
  const base = bought || (c.appointment?.start ? toDate(c.appointment.start).getTime() : null);
  if (!base) return null;
  return Math.ceil((base + FOLLOWUP_EXPIRY_MS - Date.now()) / 86_400_000);
}
function followUpAvailable(c) {
  if (!c.addOnFollowUp || c.followUp) return false;
  const days = followUpDaysLeft(c);
  return days === null || days > 0;
}
function followUpUnavailableReason(c) {
  if (!c.addOnFollowUp) return 'not purchased';
  if (c.followUp) return 'already scheduled';
  return 'expired — use Charge at 0% to honor it';
}

/**
 * THE CLIENT'S PHONE AND HOME ADDRESS (Eric, 2026-09-03: "patient's home
 * address and telephone number should be visible on this screen by the rest
 * of his info"). Two fragments from one function, because the overview
 * paints them at render and again in place after an edit, and two copies of
 * the markup would drift. Tap the number to call it from the phone this page
 * is read on; tap the address to open it in Maps. A missing value says so
 * rather than leaving a blank, so the gap is visible and the Edit beside it
 * is the obvious next tap.
 */
function contactBits(phone, address) {
  const tel = String(phone || '').replace(/[^\d+]/g, '');
  return {
    phone: phone
      ? `<a href="tel:${esc(tel)}" data-contact-phone>📞 ${esc(phone)}</a>`
      : '<span class="dim" data-contact-phone>📞 no number on file</span>',
    address: address
      ? `<a href="https://maps.apple.com/?q=${esc(encodeURIComponent(address))}" target="_blank" rel="noopener" data-contact-address>📍 ${esc(address)}</a>`
      : '<span class="dim" data-contact-address>📍 no address on file</span>',
  };
}

/**
 * Everything that matters, one section: appointment, session type, money,
 * the report clock (strict 7 calendar days, loud as it tightens), follow-up
 * state, and any payment the client still owes.
 */
function infoBar(c, mtFmt, start, due) {
  // Compact date form so values sit on one line even at phone width.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  const rows = [];
  // The label was set at .62rem, which is two steps under the smallest size in
  // the type scale and the smallest text anywhere in the app. It is the column
  // he reads down to find the one row he wants, so it goes back onto the
  // scale, in a class rather than an inline font shorthand.
  const row = (label, value, color) => rows.push(`
    <span class="fact-k">${label}</span>
    <span class="fact-v" style="color:${color || 'var(--ink)'};">${value}</span>`);

  if (c.clientName || c.clientDob) {
    const age = c.clientDob ? Math.floor((Date.now() - new Date(c.clientDob + 'T00:00:00').getTime()) / 31_557_600_000) : null;
    row('CLIENT', `${esc(c.clientName || '?')}${c.clientDob ? ` <span class="dim">· DOB ${esc(c.clientDob)}${age !== null ? ` (${age})` : ''}</span>` : ''}${c.clientEmail ? ` <span class="dim">· ${esc(c.clientEmail)}</span>` : ''}`);
  }
  // THE CLIENT'S PHONE AND HOME ADDRESS (Eric, 2026-09-03: "patient's home
  // address and telephone number should be visible on this screen by the rest
  // of his info"). The links come from contactBits so an edit can repaint
  // them in place; the Edit unfolds two inputs under the row and saves
  // through case-update. The phone falls back to the number a phone-call
  // booking left on the appointment.
  const contactPhone = c.clientPhone || c.appointment?.phone || '';
  const contactAddress = c.clientAddress || '';
  const bits = contactBits(contactPhone, contactAddress);
  row('CONTACT', `${bits.phone} <span class="dim">·</span> ${bits.address}
    <button class="btn ghost tiny" type="button" data-contact-edit aria-label="Edit phone and address">✏️ Edit</button>
    <span class="contact-form" data-contact-form hidden>
      <label class="dim small">Phone
        <input type="tel" data-contact-in="phone" value="${esc(contactPhone)}" placeholder="+1 555 555 5555"></label>
      <label class="dim small">Home address
        <input type="text" data-contact-in="address" value="${esc(contactAddress)}" maxlength="300" placeholder="Street, city, state, ZIP"></label>
      <span class="row" style="gap:.4rem; align-items:center; margin-top:.3rem;">
        <button class="btn tiny" type="button" data-contact-save>Save</button>
        <span class="dim small" data-contact-said></span>
      </span>
    </span>`);
  row('CALL', start
    ? `${fmt.format(start)} MST · ${esc(c.appointment.method)}${c.publicElection?.choice === 'public' ? ' · <span style="color:var(--magenta)">PUBLIC</span>' : ''}`
    : 'no appointment', start ? null : 'var(--danger)');

  // WHAT THEY PAID FOR THE CASE ITSELF, his correction first. This row read
  // `stripe.amountTotal` alone, so a case where he had recorded $3,400 against
  // a $175 Stripe booking still said PAID $175 on the page he opens first.
  // paidOverrideCents had exactly one reader in the whole app, and it was not
  // this one.
  //
  // The recorded figure REPLACES the Stripe line rather than adding to it: it
  // is the whole of what they paid for the case, which is what the box in
  // Settings asks for and says on its face. Sessions and follow-ups stay on
  // their own line, the way they always were.
  const extraCents = Array.isArray(c.extraPayments)
    ? c.extraPayments.reduce((x, p) => x + (p.amountCents || 0), 0) : 0;
  const recordedCents = Number(c.paidOverrideCents) > 0 ? Number(c.paidOverrideCents) : 0;
  const caseCents = recordedCents || (c.stripe?.amountTotal || 0);
  const totalCents = caseCents + extraCents;
  if (totalCents)
    row('PAID', `$${(totalCents / 100).toLocaleString()}${extraCents ? ` <span class="dim">(case $${(caseCents / 100).toLocaleString()} + sessions $${(extraCents / 100).toLocaleString()})</span>` : ''}${recordedCents ? ' <span class="dim">· recorded by you</span>' : ''}`, 'var(--cyan)');

  // The report clock — strict 7 calendar days on this side of the counter.
  if (c.status === 'delivered' || c.status === 'closed')
    row('REPORT', c.status === 'closed' ? 'delivered · case closed' : 'DELIVERED', 'var(--cyan)');
  else if (due !== null)
    row('REPORT', due >= 0 ? `due in ${due} day${due === 1 ? '' : 's'}` : `OVERDUE ${-due}d`,
      due < 0 ? 'var(--danger)' : due <= 3 ? 'var(--magenta)' : 'var(--cyan)');
  else row('REPORT', '<span class="dim">clock starts at "Call done"</span>');

  if (c.followUp)
    row(c.followUp.kind === 'followup' ? 'FOLLOW-UP' : 'SESSION',
      `${fmt.format(toDate(c.followUp.start))} MST${c.followUp.amountCents ? ` · $${(c.followUp.amountCents / 100).toLocaleString()} paid` : ''}`,
      'var(--cyan)');
  else if (c.addOnFollowUp) {
    const days = followUpDaysLeft(c);
    if (days !== null && days <= 0) row('FOLLOW-UP', 'EXPIRED', 'var(--danger)');
    else row('FOLLOW-UP', days === null
      ? 'paid · unscheduled'
      : `paid · <strong>${days}d left</strong> to use${c.followUpExpiryWarned ? ' <span class="dim">· client warned</span>' : ''}`, 'var(--magenta)');
  }

  if (c.pendingExtra)
    row('UNPAID', `${esc(c.pendingExtra.label)} · $${(c.pendingExtra.amountCents / 100).toLocaleString()} · ${fmt.format(toDate(c.pendingExtra.start))} MST`,
      'var(--magenta)');
  {
    const ci = checkInState(c);
    if (ci?.next) row('CHECK-IN', `${fmt.format(ci.next)} MST`, 'var(--cyan)');
    else if (ci?.due) row('CHECK-IN', `<strong>DUE — ${ci.days}d since the last call</strong>`, 'var(--orange)');
  }
  if (c.pendingTelehealth?.state === 'requested')
    row('TELEHEALTH', `<strong>AWAITING YOUR CONFIRM</strong> · ${fmt.format(toDate(c.pendingTelehealth.when))} MST · ${esc(c.pendingTelehealth.clinicName || '')}`,
      'var(--orange)');
  if (c.needsReschedule) row('ALERT', 'NEEDS RESCHEDULE', 'var(--danger)');

  return `<div class="panel facts">${rows.join('')}</div>`;
}

/**
 * Opening Full-Service Case Management by hand.
 *
 * Eric, 2026-08-26: "I need to charge a client 3400 (verbally agreed to on
 * call)... where to start the clock and send forms as if he paid for the
 * enhancement through the app."
 *
 * The money is the easy half and the charge panel already does it. The hard
 * half was that the tier flag had exactly one writer in the whole system, a
 * Stripe webhook, so a client who paid any other way could not be given the
 * forms he had bought.
 *
 * Two rules, both learned the expensive way:
 *
 *   THE TOTAL IS SHOWN BEFORE HE COMMITS, worked out by the same paidCents()
 *   the rate pill uses, so the number he is about to create is the number he
 *   reads. Guessing at this is how a case that had paid $175 came to claim
 *   $76.12/hr.
 *
 *   THE CASE IS RE-READ AFTERWARDS and only then does the panel say what
 *   happened. Same rule as the meeting link and the reschedule.
 */
function wireOpenFull(el, c) {
  const box = el.querySelector('#openfull-amt');
  if (!box) return;                       // already on the tier: no panel
  const totalEl = el.querySelector('#openfull-total');
  const errEl = el.querySelector('#openfull-err');
  const go = el.querySelector('#openfull-go');

  // The same arithmetic the Worker does, so the preview cannot promise a
  // figure the server would not write: the case fee this client actually
  // paid, plus what they paid for the tier.
  const paidForCase = Number(c.caseRateCents) > 0
    ? Number(c.caseRateCents) : (Number(c.stripe?.amountTotal) || 0);
  const typedCents = () => {
    const raw = (box.value || '').trim();
    if (!raw) return 0;
    const n = Number(raw.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
  };
  const preview = () => {
    const cents = typedCents();
    if (cents === null || cents > 100_000_00) {
      totalEl.textContent = '';
      return;
    }
    const after = paidCents({ ...c, fullAccess: true, fullAccessRateCents: paidForCase + cents });
    totalEl.innerHTML = after === null
      ? 'This case will still show no payment recorded.'
      : `This case will show <strong>$${dollars(after)}</strong> paid.`;
  };
  box.addEventListener('input', preview);
  preview();

  // WHEN THE MONTH STARTS. Eric, 2026-08-26: "I want to be prompted to set the
  // clock or when the start time is. This one is going to be delayed
  // slightly." A tier agreed in August for a September start was, until now,
  // forced to begin the moment he pressed the button, which quietly took the
  // difference out of the month he had sold.
  //
  // A DATE, not a datetime: a month that begins at 2:15pm is noise, and it is
  // one fewer wheel to spin on a phone. Noon Mountain on the chosen day, so
  // no timezone rounding can shunt it to the day before or after.
  const startEl = el.querySelector('#openfull-start');
  const whenEl = el.querySelector('#openfull-when');
  const todayMT = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: MOUNTAIN_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const startInstant = () => {
    const day = (startEl?.value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    // Noon Mountain. -07:00 is the offset every formatter in the Worker uses
    // and it does not shift under daylight saving, so the day he picked is
    // the day that gets stored.
    const t = new Date(`${day}T12:00:00-07:00`);
    return Number.isNaN(t.getTime()) ? null : t;
  };
  if (startEl && !startEl.value) startEl.value = todayMT();
  const dayFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, month: 'long', day: 'numeric',
  });
  const previewWhen = () => {
    const t = startInstant();
    if (!whenEl) return;
    if (!t) { whenEl.textContent = 'Pick the day their month begins.'; return; }
    const end = new Date(t.getTime() + 30 * 86_400_000);
    whenEl.textContent = t.getTime() > Date.now()
      ? `Their month runs ${dayFmt.format(t)} to ${dayFmt.format(end)}. The clock runs from the day it starts, signed forms or not.`
      : `Their month runs ${dayFmt.format(t)} to ${dayFmt.format(end)}.`;
  };
  startEl?.addEventListener('change', previewWhen);
  startEl?.addEventListener('input', previewWhen);
  previewWhen();

  go.addEventListener('click', async () => {
    const cents = typedCents();
    errEl.hidden = true;
    if (cents === null || cents > 100_000_00) {
      errEl.textContent = 'Give an amount between $0 and $100,000, or leave it empty.';
      errEl.hidden = false;
      return;
    }
    const startAt = startInstant();
    if (!startAt) {
      errEl.textContent = 'Pick the day their month begins.';
      errEl.hidden = false;
      return;
    }
    const YEAR = 365 * 86_400_000;
    if (Math.abs(startAt.getTime() - Date.now()) > YEAR) {
      errEl.textContent = 'Pick a start date within a year either side of today.';
      errEl.hidden = false;
      return;
    }
    const after = paidCents({ ...c, fullAccess: true, fullAccessRateCents: paidForCase + cents });
    // The figure is named out loud. An upgrade that emails the client and
    // unlocks the signing surfaces is not a thing to do on a mis-tap.
    if (!confirm(`Open Full-Service Case Management on ${c.clientName || 'this case'}?\n\n`
      + `${cents > 0 ? `Recording $${dollars(cents)} paid outside the app.` : 'No new payment recorded.'}\n`
      + `${after === null ? 'The case will show no payment recorded.' : `The case will show $${dollars(after)} paid.`}\n`
      + `Their month starts ${dayFmt.format(startAt)}.\n\n`
      + 'They get one email. No forms are sent, and nothing on their page asks them to sign.')) return;
    go.disabled = true;
    try {
      await api({ action: 'open-full', tierCents: cents, startAt: startAt.toISOString() });
      // Re-read before claiming, same rule as the meeting link: a 200 says
      // the request was accepted, and what he needs to know is whether the
      // case is actually on the tier now.
      await load();
      // The date comes back off the RE-READ case, not off the variable that
      // was sent. If the server stored a different day, this says the day the
      // server stored.
      const stored = data?.fullAccessAt ? toDate(data.fullAccessAt) : null;
      // Same predicate the client's page and the Worker use, so his
      // confirmation cannot say "starts" about a month their email treated as
      // already running.
      const later = handsOffStartsLater(data);
      say('openfull', data?.fullAccess
        ? `Open. Their work log and the check-in booking are live on their case page and the email has gone. Send every form yourself, and tick Forms submitted on the tier card when the signed copies are back in your hands.${stored ? ` Their month ${later ? 'starts' : 'started'} ${dayFmt.format(stored)}.` : ''}`
        : 'That went through, but the case still does not show Full-Service. Do not send them to sign yet: try once more.',
      { tone: data?.fullAccess ? 'ok' : 'warn' });
      refreshOverview();
    } catch (err) {
      say('openfull', `Not opened: ${err.message}`, { tone: 'warn' });
      go.disabled = false;
      refreshOverview();
    }
  });
}

async function wireScheduler(el) {
  const slotSel = el.querySelector('#sched-slot');
  const chargeBox = el.querySelector('#sched-charge');
  el.querySelectorAll('input[name=sched-mode]').forEach((r) =>
    r.addEventListener('change', () => { chargeBox.hidden = r.value !== 'charge' || !r.checked; }));

  const mtFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  try {
    const snapshot = await getDocs(query(collection(db, 'availability'), where('state', '==', 'open')));
    const slots = [];
    snapshot.forEach((d) => {
      const s = d.data();
      const start = toDate(s.start);
      if (start.getTime() > Date.now()) slots.push({ id: d.id, start });
    });
    slots.sort((a, b) => a.start - b.start);
    // Custom time goes last when there's real inventory (an open slot is the
    // common case) and first when there isn't — with no slots open, typing a
    // time is the only thing left to do.
    // TYPING A TIME COMES FIRST, ALWAYS (Eric, 2026-08-26: "I still can't
    // reschedule the time today to what I want. We're meeting 2pm MST").
    //
    // It used to go last whenever there was open inventory, on the reasoning
    // that picking an existing slot is the common path. But open slots are
    // never sooner than the 72h lead window, so the list he actually sees is
    // next week, and the one option that can reach TODAY was under all of it
    // behind a scroll. Rescheduling to this afternoon is the single most
    // urgent thing this panel does and it was the hardest thing to find in it.
    slotSel.innerHTML = CUSTOM_OPTION
      + slots.map((s) => `<option value="${s.id}">${mtFmt.format(s.start)} MST</option>`).join('');
    slotSel.value = CUSTOM;
  } catch (err) {
    slotSel.innerHTML = CUSTOM_OPTION;
    console.warn("couldn't load open slots:", err.message);
  }

  // The nudge buttons. Each one moves the CURRENT appointment by its own
  // number of minutes and books it, in one tap, with no date typing and no
  // dependence on there being an open slot. The Worker's admin schedule route
  // already accepts any wall-clock time and creates the slot on demand, so
  // this is the arithmetic and the confirmation, nothing more.
  for (const b of el.querySelectorAll('[data-nudge]')) {
    b.addEventListener('click', async () => {
      const from = data?.appointment?.start ? toDate(data.appointment.start) : null;
      // THE MODULE-LEVEL say(), not a line written into this panel. A local
      // element is destroyed by the load() below, which is exactly how this
      // panel used to confirm a save and then delete its own confirmation.
      // say() stores the sentence and every repaint renders it back.
      const tell = (msg, bad) => {
        say('sched', msg, { tone: bad ? 'warn' : 'ok' });
        refreshOverview();
      };
      if (!from) { tell('There is no appointment to move yet.', true); return; }
      const mins = Number(b.dataset.nudge);
      // MEASURE FROM NOW WHEN THE OLD TIME HAS ALREADY GONE. A call that did
      // not happen is the single most likely thing he is rescheduling, and
      // adding an hour to last Tuesday lands in the past and refuses. Off a
      // future appointment "+1 hour" means an hour later than planned; off a
      // missed one it means an hour from now, which is the same sentence a
      // person would say out loud in both cases.
      const past = from.getTime() < Date.now();
      const base = past ? new Date() : from;
      const to = new Date(base.getTime() + mins * 60000);
      const row = el.querySelector('[data-nudge-row]');
      row?.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      const was = b.textContent;
      b.textContent = 'Moving…';
      try {
        const idToken = await user.getIdToken();
        const res = await fetch('/api/admin/schedule', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
          body: JSON.stringify({
            caseId, mode: 'reschedule',
            customStart: to.toISOString(),
            customDurationMin: Number(data?.appointment?.durationMin) || 60,
          }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
        // RE-READ BEFORE CLAIMING IT MOVED. Same rule as the meeting link: a
        // 200 says the request was accepted, and what he needs to know is
        // where his client's page now says the call is.
        await load();
        const now = data?.appointment?.start ? toDate(data.appointment.start) : null;
        if (!now || Math.abs(now.getTime() - to.getTime()) > 60000) {
          tell('That went through, but the case still shows the old time. Check before you tell them.', true);
        } else {
          tell(`Moved to ${mtFmt.format(now)} MST${past ? ', measured from now because the old time had already gone' : ''}. Their case page shows the new time.`);
        }
      } catch (err) {
        tell(`Not moved: ${err.message}`, true);
      } finally {
        b.textContent = was;
        row?.querySelectorAll('button').forEach((x) => { x.disabled = false; });
      }
    });
  }

  const customBox = el.querySelector('#sched-custom');
  const whenInput = el.querySelector('#sched-when');
  const syncCustom = () => { customBox.hidden = slotSel.value !== CUSTOM; };
  slotSel.addEventListener('change', syncCustom);
  // Prefilled to the next round hour TODAY, in MST wall clock, which is what
  // the submit below parses. An empty picker on a phone means spinning four
  // wheels from whatever the OS defaults to; prefilled, "2pm today" is one
  // spin. Never prefills a time that has already gone.
  if (whenInput && !whenInput.value) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: MOUNTAIN_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date()).reduce((o, x) => { o[x.type] = x.value; return o; }, {});
    let h = Number(parts.hour) + 1;
    let day = `${parts.year}-${parts.month}-${parts.day}`;
    if (h > 23) {
      // Past 11pm the next round hour is tomorrow. Roll the MST date properly
      // rather than doing string arithmetic on the day.
      h = 8;
      const t = new Date(`${day}T12:00:00Z`);
      t.setUTCDate(t.getUTCDate() + 1);
      day = t.toISOString().slice(0, 10);
    }
    whenInput.value = `${day}T${String(h).padStart(2, '0')}:00`;
  }
  // The remaining hours of today, as chips. Rendered here rather than in the
  // template because "today" is only known at paint time and a stale chip is
  // worse than no chip.
  {
    const row = el.querySelector('[data-today-row]');
    if (row) {
      const p = new Intl.DateTimeFormat('en-CA', {
        timeZone: MOUNTAIN_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', hour12: false,
      }).formatToParts(new Date()).reduce((o, x) => { o[x.type] = x.value; return o; }, {});
      const day = `${p.year}-${p.month}-${p.day}`;
      const from = Number(p.hour) + 1;
      const hours = [];
      for (let h = Math.max(from, 7); h <= 21; h++) hours.push(h);
      const label = (h) => {
        const ampm = h >= 12 ? 'pm' : 'am';
        const twelve = h % 12 === 0 ? 12 : h % 12;
        return `${twelve}${ampm}`;
      };
      row.innerHTML = hours.length
        ? `<span class="dim small">Today</span>`
          + hours.map((h) => `<button type="button" class="btn quiet tiny" data-today="${day}T${String(h).padStart(2, '0')}:00">${label(h)}</button>`).join('')
        : '<span class="dim small">Nothing left today. Pick a time below.</span>';
      for (const btn of row.querySelectorAll('[data-today]')) {
        btn.addEventListener('click', () => {
          slotSel.value = CUSTOM;
          syncCustom();
          whenInput.value = btn.dataset.today;
          for (const other of row.querySelectorAll('[data-today]')) other.classList.remove('on');
          btn.classList.add('on');
        });
      }
    }
  }
  syncCustom();

  el.querySelector('#sched-go').addEventListener('click', async () => {
    const btn = el.querySelector('#sched-go');
    const errEl = el.querySelector('#sched-err');
    const resultEl = el.querySelector('#sched-result');
    const slotId = slotSel.value;
    const mode = el.querySelector('input[name=sched-mode]:checked').value;
    errEl.hidden = true;

    // A custom time is typed as MST wall-clock; MST is a fixed -07:00, so
    // stamping the offset on turns it into the exact instant regardless of
    // which timezone this browser thinks it's in.
    let customStart;
    if (slotId === CUSTOM) {
      if (!whenInput.value) { errEl.textContent = 'Pick a date and time.'; errEl.hidden = false; return; }
      const at = new Date(`${whenInput.value}:00-07:00`);
      if (Number.isNaN(at.getTime())) { errEl.textContent = "That date and time didn't parse."; errEl.hidden = false; return; }
      if (at.getTime() < Date.now() &&
          !confirm(`${mtFmt.format(at)} MST is in the past. Book it anyway?`)) return;
      customStart = at.toISOString();
    } else if (!slotId) {
      errEl.textContent = 'Pick a slot.';
      errEl.hidden = false;
      return;
    }

    // The typed amount, read and checked before anything is sent. A charge is
    // the one thing on this panel that moves somebody's money, so a fat finger
    // has to be caught here rather than explained afterwards.
    let amountCents;
    if (mode === 'charge') {
      const raw = (el.querySelector('#sched-amt')?.value || '').trim();
      if (raw) {
        const n = Number(raw.replace(/[$,\s]/g, ''));
        if (!Number.isFinite(n) || n < 1 || n > 100000) {
          errEl.textContent = 'Give an amount between $1 and $100,000, or leave it empty to use a percentage.';
          errEl.hidden = false;
          return;
        }
        amountCents = Math.round(n * 100);
        if (!confirm(`Charge ${data?.clientName || 'this client'} $${(amountCents / 100).toLocaleString(undefined, { minimumFractionDigits: amountCents % 100 ? 2 : 0 })}?`)) return;
      }
    }

    btn.disabled = true;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          caseId, mode,
          slotId: customStart ? undefined : slotId,
          customStart,
          customDurationMin: customStart ? Number(el.querySelector('#sched-dur').value) : undefined,
          pct: mode === 'charge' ? Number(el.querySelector('#sched-pct').value) : undefined,
          // Sent only when he actually typed something, so an empty box leaves
          // the percentage in charge rather than sending a zero.
          amountCents: mode === 'charge' ? amountCents : undefined,
          tagline: mode === 'charge' ? el.querySelector('#sched-tag').value : undefined,
        }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
      // THIS PANEL DID CONFIRM, AND THEN DELETED ITS OWN CONFIRMATION. It
      // wrote the result into #sched-result and then called load() 1.2s later,
      // which repaints Overview and takes that element with it. The words were
      // on screen for about a second. So the result goes through say(), which
      // survives the repaint, and #sched-result keeps only the copyable link.
      if (out.checkoutUrl) {
        resultEl.textContent = '';
        // The link rides INSIDE the confirmation rather than beside it, so the
        // repaint below cannot separate the two. Built and escaped here.
        say('sched', `Scheduled, pending payment of $${(out.amountCents / 100).toLocaleString()}. `
          + 'Your client has an email and a pay button on their case page, and the slot holds for 24 hours. '
          + 'Or send them this link in chat:', {
          html: `<input type="text" readonly value="${esc(out.checkoutUrl)}" onclick="this.select()" style="margin-top:.35rem;">`,
        });
        refreshOverview();
      } else {
        resultEl.textContent = '';
        say('sched', `Booked: ${out.scheduled}. Your client has been emailed, and the time is on their case page now.`);
        setTimeout(load, 1200);
      }
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
    btn.disabled = false;
  });
}

function toDate(v) { return v?.toDate ? v.toDate() : new Date(v || 0); }
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
 * Whether he is actually allowed to act yet, on the page where he decides what
 * to do next. Read-only: he can see and print what was signed, and he can
 * never sign it himself.
 *
 * IT NO LONGER SAYS "the client's own page is where signing happens", which
 * was true when it was written and stopped being true the day the client-side
 * offer was parked (OFFER_AUTHORITY_SIGNING in public/js/case.js). Signing is
 * by hand now: the forms panel on Overview sends or prints a blank, they sign
 * it and send it back, and the signed copy is filed as a filled form. What
 * this card lists is what was signed BEFORE that, plus anything signed if the
 * offer is ever turned back on.
 *
 * Served through the Worker like everything else under the case's private
 * subtree, which the browser cannot read directly by rule.
 */
async function paintAuthorityStatus(pane) {
  const host = pane?.querySelector('[data-authority-status]');
  if (!host) return;
  let items = [];
  try {
    const token = await user.getIdToken();
    const res = await fetch(`/api/authority?caseId=${encodeURIComponent(caseId)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.ok) items = (await res.json()).items || [];
  } catch { /* the card still says what it does not know */ }

  const live = items.filter((i) => !i.revokedAt);
  const recs = live.filter((i) => i.kind === 'records');
  const rep = live.find((i) => i.kind === 'representative');
  // The agreement is not a permission. It says the engagement is agreed; it
  // authorises no phone call, so it is kept out of every permission count
  // below and shown on its own line (Eric, 2026-08-29: "All I need is scope
  // of work agreement").
  const scope = live.find((i) => i.kind === 'scope');
  const perms = live.filter((i) => i.kind !== 'scope');
  const revoked = items.filter((i) => i.revokedAt && i.kind !== 'scope');
  const days = fullAccessDaysLeft(data);
  // Extensions and holds both stretch the window, so "75 days left in the 60
  // day window" was a sentence this card could print. Name the extra instead.
  const extra = Number(data.fullAccessExtraDays) || 0;
  const paused = !!data.hold?.pausedAt;
  // The same derived checklist the client sees, from the same helper - the
  // two views cannot drift.
  //
  // WHAT THIS CARD STOPPED CLAIMING (2026-08-27). Its headline was "Ready:
  // authority to act", and two of the checklist's three rows came from the
  // signed authority documents. Signing them on the case page was parked on
  // Eric's word, so those rows could never be ticked again and this card would
  // have read "Not ready yet" on every case he ever opened. The checklist is
  // one row now, and it says only what it still knows: whether they have read
  // and acknowledged the scope note.
  //
  // SINCE 2026-08-29 THE ROW IS HIS OWN TICK. Every form travels by hand
  // (Eric: "Do NOT send him any forms whatsoever... Just create a 'forms
  // submitted' tick box for me to tick off once I've received them. Keep
  // that my side, not his."), so the record that matters is whether the
  // signed copies are back in his hands, and only he can say so. The tick
  // stamps formsOnFileAt on the case; handsOffReadiness reads exactly that,
  // both sides of the glass.
  //
  // THE WARNING DID NOT GO ANYWHERE. "May I pick up the phone" was the real
  // question, and the honest answer is written permission in hand: an in-app
  // permission on file, or the tick saying the paper ones are back. Orange
  // until one of those is true.
  const ready = handsOffReadiness(data);
  const formsBack = data.formsOnFileAt ? toDate(data.formsOnFileAt) : null;
  const noPermission = perms.length === 0 && !formsBack;
  const alarm = !ready.ready || noPermission;

  host.innerHTML = `
    <div class="panel" style="${alarm ? 'border-color:var(--orange); box-shadow:var(--glow-o);' : ''}">
      <h3 style="margin:0 0 .35rem;${alarm ? ' color:var(--orange);' : ''}">
        ${noPermission ? 'No permission on file' : ready.ready ? 'Forms on file' : 'Waiting on the signed forms'}</h3>
      <p class="dim small" style="margin:0 0 .4rem;">
        ${ready.rows.map((r) => `${r.done ? '✓' : '○'} ${esc(r.label)}`).join('<br>')}</p>
      ${noPermission ? `<p class="dim small" style="margin:0 0 .5rem; color:var(--orange);">
        Nothing here authorises you to speak for them. Do not phone a clinic or
        their plan on their behalf until you have it in writing. The clock runs
        from purchase either way.</p>` : ''}
      <label class="agreement-check" style="align-items:flex-start; margin:.2rem 0 .4rem;">
        <input type="checkbox" data-forms-back${formsBack ? ' checked' : ''}>
        <span><strong>Forms submitted</strong><br><span class="dim small">
          ${formsBack
    ? `Received ${esc(formsBack.toLocaleDateString())}. Untick if that was a mistake.`
    : 'Tick once the signed forms are back in your hands. It clears the warning and ticks their checklist row.'}</span></span>
      </label>
      <p class="error" data-forms-back-err hidden></p>
      ${items.length ? `
      <p class="dim small" style="margin:.1rem 0;">
        Agreement: ${scope
    ? `signed ${esc(new Date(scope.signedAt).toLocaleDateString())}`
    : data.forms?.fullAccess ? 'acknowledged at purchase' : 'not signed in the app'}</p>
      <p class="dim small" style="margin:.1rem 0;">
        Records: ${recs.length
    ? recs.map((r) => esc(r.clinicName || 'clinic')).join(', ') : 'none signed in the app'}</p>
      <p class="dim small" style="margin:.1rem 0;">
        Insurer: ${rep
    ? `${esc(rep.planName || 'plan')}${rep.memberId ? ` · ${esc(rep.memberId)}` : ''}`
    : 'not signed in the app'}</p>` : ''}
      ${days !== null ? `<p class="dim small" style="margin:.35rem 0 0;">
        ${days} day${days === 1 ? '' : 's'} left in the window${extra ? ` (${FULL_WINDOW_DAYS} + ${extra} bought)` : ''}${paused ? ', paused' : ''}.</p>` : ''}
      ${revoked.length ? `<p class="dim small" style="margin:.35rem 0 0; color:var(--orange);">
        ${revoked.length} withdrawn. Do not act on ${revoked.length === 1 ? 'it' : 'them'}.</p>` : ''}
      ${live.length ? `<p class="row" style="gap:.4rem; flex-wrap:wrap; margin:.5rem 0 0;">
        ${live.map((i) => `<button class="btn ghost tiny" data-auth-print="${esc(i.id)}">
          ${i.kind === 'records' ? esc(i.clinicName || 'Records')
    : i.kind === 'scope' ? 'Scope of work' : 'Insurer form'}</button>`).join('')}
      </p>` : ''}
    </div>`;

  // THE TICK, DEEP-READ STYLE: the control reflects the case, the write goes
  // through the Worker, and a failed write puts the box back the way it was
  // rather than lying about what is stored.
  const tick = host.querySelector('[data-forms-back]');
  tick?.addEventListener('change', async () => {
    const errEl = host.querySelector('[data-forms-back-err]');
    if (errEl) errEl.hidden = true;
    const want = tick.checked;
    tick.disabled = true;
    try {
      await api({ action: 'forms-on-file', on: want });
      await load();
      paintAuthorityStatus(pane);
    } catch (err) {
      tick.checked = !want;
      tick.disabled = false;
      if (errEl) { errEl.textContent = `Not saved: ${err.message}`; errEl.hidden = false; }
    }
  });

  for (const b of host.querySelectorAll('[data-auth-print]')) {
    b.addEventListener('click', async () => {
      let item = items.find((i) => i.id === b.dataset.authPrint);
      if (!item) return;
      // The list GET omits the signature blobs - this card paints on every
      // overview repaint and would otherwise re-download all of them. Ask
      // for this one document's ink now that it is actually being printed.
      if (item.hasSignature && !item.signatureImage) {
        try {
          const idToken = await user.getIdToken();
          const res = await fetch(
            // `caseId`, the binding this module actually has (:145). It said
            // `id`, which is declared nowhere, so this threw a ReferenceError
            // BEFORE the fetch was made, every single time. The catch below
            // swallowed it under a comment about printing without the mark,
            // so every signed authority form printed with a blank signature
            // and nothing anywhere said so. The sibling call at :3287 had it
            // right the whole time.
            `/api/authority?caseId=${encodeURIComponent(caseId)}&id=${encodeURIComponent(item.id)}`,
            { headers: { authorization: `Bearer ${idToken}` } },
          );
          if (res.ok) {
            const found = ((await res.json()).items || []).find((i) => i.id === item.id);
            if (found?.signatureImage) item = found;
          }
        } catch {
          // It still prints, because a form without the mark beats no form at
          // all when he is stood at a clinic desk. But it SAYS so now: a
          // silent fallback is exactly how the ReferenceError above survived.
          //
          // An alert rather than a panel line, deliberately. This one is
          // act-now and he is about to be looking at a print dialog, not at
          // this card, so it has to interrupt or it is not read at all.
          alert('Printing without the signature: it could not be fetched just now.\n\n'
            + 'The signature is still on file. Try again in a moment if the clinic needs it on the page.');
        }
      }
      printAuthorityDoc(item);
    });
  }
}

/**
 * The coordination window, by the Worker's own rule (fullAccessWindowEnd):
 * sixty days from the PURCHASE (Eric, 2026-08-25: "the clock starts upon
 * booking"), plus any extension bought, plus every stretch the case has
 * spent on hold. First-call fallback for legacy cases with no purchase
 * stamp, matching the Worker exactly — two copies, kept in step.
 */
// The Worker's numbers, copied rather than guessed. worker/index.js is the
// authority; tools/suites/pricing.mjs pins all three copies against it.
const FULL_WINDOW_DAYS = 30;
const FULL_LEGACY_WINDOW_DAYS = 60;
const FULL_MONTHLY_FROM_AT = Date.parse('2026-08-26T00:00:00Z');
const FULL_WINDOW_FROM_PURCHASE_AT = Date.parse('2026-08-25T00:00:00Z');
function fullAccessDaysLeft(c) {
  // Mirrors worker/index.js fullAccessWindowEnd line for line. It did not:
  // it measured from fullAccessAt whenever that was set, and it applied the
  // thirty-day month to EVERY case. A case sold before the monthly reshape
  // bought sixty days from the first call, so this card was quietly telling
  // him a legacy client had a month less than they had actually paid for,
  // while the client's own page said sixty. Three implementations of one
  // window, three different answers.
  const bought = c?.fullAccessAt ? toDate(c.fullAccessAt).getTime() : 0;
  const firstCall = c?.appointment?.start ? toDate(c.appointment.start).getTime() : 0;
  const boughtUnderNewRule = bought && bought >= FULL_WINDOW_FROM_PURCHASE_AT;
  const start = boughtUnderNewRule ? bought : (firstCall || bought);
  if (!start) return null;
  // Same as heldMs(): what is banked, plus the stretch still running if the
  // case is paused right now. While paused these two grow together, so the
  // number on the card holds still, which is the point of a pause.
  const held = Math.max(0, Number(c?.hold?.totalMs) || 0)
    + (c?.hold?.pausedAt ? Math.max(0, Date.now() - toDate(c.hold.pausedAt).getTime()) : 0);
  const base = bought && bought >= FULL_MONTHLY_FROM_AT
    ? FULL_WINDOW_DAYS : FULL_LEGACY_WINDOW_DAYS;
  const end = start + (base + (Number(c.fullAccessExtraDays) || 0)) * 86_400_000 + held;
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
}

/**
 * The tier's cadence, as a state the shelf and the chart can both say:
 * the next booked check-in if there is one, or how long the case has gone
 * without one. "Due" means 14+ days since the last call of any kind with
 * nothing on the books - the promise is a check-in every two weeks, and
 * this flag is the enforcement Eric chose: a quiet marker, not automation.
 */
const CHECKIN_DAYS = 14;
function checkInState(c) {
  if (!c?.fullAccess || c.status === 'closed') return null;
  const now = Date.now();
  const all = Array.isArray(c.checkIns) ? c.checkIns : [];
  const future = all.map((x) => toDate(x.start).getTime()).filter((t) => t > now).sort((a, b) => a - b);
  if (future.length) return { next: new Date(future[0]), due: false };
  const past = all.map((x) => toDate(x.start).getTime()).filter((t) => t <= now);
  // THE MONTH IS THE FLOOR, the same as checkInDue on the shelf. A cadence the
  // tier promises cannot be overdue before the tier has begun, and the anchor
  // below is the advocacy call, which on a hand-opened case is usually weeks
  // old. Kept in step with public/js/admin.js:392 on purpose: two copies of
  // one rule, and tools/suites/checkins.mjs runs both against the same cases.
  const started = c.fullAccessAt ? toDate(c.fullAccessAt).getTime() : 0;
  if (started > now) return { next: null, due: false, days: 0 };
  const first = c.appointment?.start ? toDate(c.appointment.start).getTime() : 0;
  const last = Math.max(first, started, ...past, 0);
  if (!last || last > now) return { next: null, due: false };
  const days = Math.floor((now - last) / 86_400_000);
  return { next: null, due: days >= CHECKIN_DAYS && !c.hold?.pausedAt, days };
}

/** A paper copy for the clinic or the plan. Same print path as the prep sheet. */
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
  if (!src || !/^data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=]+$/.test(src)) return '';
  return `<figure class="sig-ink"><img src="${esc(src)}" alt="Signature">
    <figcaption>Signature of the person named above.</figcaption></figure>`;
}

/**
 * The document itself, as one self-contained page.
 *
 * ONE BUILDER, TWO DESTINATIONS. This is what goes into the print window, and
 * it is byte for byte what is stored on the case when he sends a form. Two
 * builders would drift, and the morning they drifted he would be talking a
 * client through a document that is not the one on their screen.
 *
 * Self-contained is the requirement, not a nicety: the sent copy is opened
 * from Storage on the client's phone, where nothing of this app is loaded, so
 * every style it needs is inside it and it fetches nothing.
 */
function authorityDocTitle(kind) {
  return kind === 'records' ? 'Records authorisation'
    : kind === 'scope' ? 'Scope of work agreement' : 'Insurance representative';
}
function authorityDocHtml(item) {
  const o = {
    ...item,
    clientName: data.clientName, clientDob: data.clientDob, advocateName: 'Eric Bleach',
  };
  const text = item.kind === 'records' ? recordsAuthorisation(o)
    : item.kind === 'scope' ? scopeOfWork(o) : representativeDesignation(o);
  return `<!doctype html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${authorityDocTitle(item.kind)}</title>
    <style>@page { margin: 16mm; }
      body { font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; color:#000; background:#fff; margin: 16px; }
      pre { white-space: pre-wrap; word-wrap: break-word; margin: 0; }
      .sig-ink { margin: 6mm 0 0; page-break-inside: avoid; }
      .sig-ink img { max-width: 78mm; max-height: 26mm; display: block; }
      .sig-ink figcaption { font-size: 10px; color: #444; margin-top: 1mm; }
      </style>
    </head><body><pre>${text.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))}</pre>${signatureInk(item)}</body></html>`;
}

function printAuthorityDoc(item) {
  const win = window.open('', '_blank');
  if (!win) { alert('Allow pop-ups to print this.'); return; }
  win.document.write(authorityDocHtml(item));
  win.document.close();
  setTimeout(() => win.print(), 350);
}

/**
 * The Mountain day, as a date a person reads on a file name: 2026-08-27.
 *
 * Etc/GMT+7 like every other date on this page. Built from the parts rather
 * than from a locale string, because the file name is a stored artefact and
 * "27/08/2026" or "8/27/2026" depending on where the browser thinks it is
 * would put three shapes of the same day into one client's document list.
 */
function mountainDay(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * A storage stamp that never repeats, in the shape both file listings already
 * strip (`^\d{10,}-`).
 *
 * Date.now() alone is what every other upload path uses, and it is enough
 * there because he is picking files by hand. Here the file NAME is generated,
 * so a resend produces a byte-identical name every time, and Storage
 * overwrites a repeated path without a word. Two sends of one form inside the
 * same millisecond would therefore be one document, which is precisely the
 * thing he asked for and precisely the thing that would silently not happen.
 */
let lastStamp = 0;
function uploadStamp() {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

/**
 * SEND THE TICKED FORMS TO THE CLIENT.
 *
 * Eric, 2026-08-27, on a client who paid him outside the app: "I need to be
 * able to select forms and send them, regardless of if they've already been
 * sent or not. This way this client can have the signed forms in the uploaded
 * documents. This is another example of what the advisor could do: 'send the
 * full-service forms to the client'."
 *
 * THERE IS NO ONCE-ONLY GUARD HERE, AND NONE MAY BE ADDED. Not a disabled
 * button, not an "already sent" refusal, not a quiet skip of a form that is
 * already on the case. His words are "regardless of if they've already been
 * sent or not", and every reason to resend is a real one: the client deleted
 * it, the clinic wants a copy dated today, the first one went out before he
 * had their date of birth on the case. Send it three times and three
 * documents land. tools/suites/uploads.mjs U24 sends the same form twice and
 * fails if fewer than two documents exist afterwards, so a guard added here
 * turns that check red rather than quietly costing him a send.
 *
 * WHERE IT LANDS AND WHY. Straight into `cases/{id}/report/` wearing
 * `paCategory: 'formsent'`, which is exactly the path and exactly the label a
 * hand upload of the same document would produce. The category is metadata,
 * never a folder: storage.rules names four client-readable folders and
 * prep-shelf.mjs pins that list by string equality. So the client's documents
 * list shows it under Forms sent with a FORM SENT pill, and the moment they
 * send the signed copy back he files that as a filled form beside it.
 *
 * THE NOTIFICATION IS NOT THE SEND. The document is on their page the instant
 * Storage has the bytes. Telling them is a second, weaker thing that runs
 * after, and a failure there must never lose him the send or make him think
 * he has to do it again; it says so on the panel instead.
 */
async function sendBlankForms(kinds, btn) {
  const sent = [];
  const quiet = [];
  // REPORTED ON THE PANEL AND THROWN, both.
  //
  // The panel line is for Eric, who is looking at this screen. The throw is
  // for a caller that is not a person: the advisor branch proposes "send the
  // full-service forms to the client" as a card he taps, and its card renders
  // "Not done: {message}" and stays on screen when a carry-out fails. A
  // function that reports only into the DOM tells such a caller nothing, and
  // a caller that cannot tell a send from a failure reports success for both.
  // So this returns { sent, quiet } when it worked and throws an Error
  // carrying the same two lists when it did not.
  const problem = (msg, { onPanel = true } = {}) => {
    // onPanel is false once load() has been called: the repaint would wipe
    // anything written straight onto the panel, and the said line below
    // carries the same news in a form that survives it.
    if (onPanel) {
      const el = document.getElementById('forms-err');
      if (el) { el.textContent = msg; el.hidden = false; } else alert(msg);
    }
    const e = new Error(msg);
    e.sent = sent.slice();
    e.quiet = quiet.slice();
    return e;
  };
  const errEl = document.getElementById('forms-err');
  if (errEl) errEl.hidden = true;
  const picked = SENDABLE_FORMS.filter((f) => kinds.includes(f.id));
  // Nothing ticked is a refusal, not a failure of the send, and it happens
  // before anything is repainted, so the error line survives where it is.
  if (!picked.length) throw problem('Tick at least one form first.');
  const label = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  let broke = '';
  try {
    for (const form of picked) {
      const name = `${form.label} ${mountainDay()}.html`;
      // The same sanitiser the hand-upload path uses, so one rule governs
      // every name that reaches a Storage path on this page.
      const safe = name.replace(/[^\w.\- ]+/g, '_');
      const path = `cases/${caseId}/report/${uploadStamp()}-${safe}`;
      // NOT `doc`: that name is the Firestore import at the top of this file,
      // and shadowing it inside a function that also touches Storage is how a
      // later edit here reaches for the wrong one.
      const page = authorityDocHtml({ kind: form.id, blank: true });
      // A File, not a bare Blob: the demo store and every listing read
      // `file.name`, and the content type is what decides whether this opens
      // as a readable form on their phone or arrives as bytes they cannot use.
      const body = new File([page], name, { type: 'text/html' });
      const task = uploadBytesResumable(ref(storage, path), body, {
        contentType: 'text/html',
        // Storage would otherwise be free to hand it over as a download. He
        // is sending a form to be read and printed, on a phone.
        contentDisposition: 'inline',
        customMetadata: { paCategory: 'formsent' },
      });
      // ONE AT A TIME, not Promise.all. Nothing in this repo lints, so this
      // is not a lint appeasement: sequential is what lets the line below say
      // how many of the ticked forms actually got through before it stopped,
      // and it keeps the stamps in the order he ticked them.
      await new Promise((resolve, reject) => {
        // Four arguments, every one a function, matching the shape the hand
        // upload path uses. There is no progress bar on this panel: a form is
        // a few kilobytes and the whole send is over before a bar could paint.
        task.on('state_changed', () => {}, reject, resolve);
      });
      sent.push(name);
      await api({ action: 'summary-uploaded', category: 'formsent', fileName: name })
        .catch(() => { quiet.push(name); });
    }
  } catch (e) {
    broke = e.message;
  }
  if (btn) { btn.disabled = false; btn.textContent = label; }
  const names = sent.join(' and ');
  const is = sent.length === 1 ? 'is' : 'are';
  // THROUGH THE SAID MAP, NOT INTO THE DOM. load() below repaints the whole
  // Overview, which would destroy a line written straight onto the panel: the
  // repaint that proves it worked would erase the sentence saying so.
  if (sent.length) {
    say('auth', broke
      ? `${names} ${is} on their documents now, under Forms sent. The rest stopped: ${broke}`
      : quiet.length
        ? `${names} ${is} on their documents now, under Forms sent. I could not confirm they were told, so mention it in chat.`
        : `Sent. ${names} ${is} on their documents now, under Forms sent, and they have been notified by name.`,
    { tone: broke || quiet.length ? 'warn' : 'ok' });
    // Untick, so a second tap is a decision rather than an accident. NOT a
    // guard: tick it again and it goes again, which is the whole point.
    document.querySelectorAll('[data-form-pick]:checked').forEach((x) => { x.checked = false; });
    load();
  }
  if (broke) {
    throw problem(`${sent.length ? `${sent.length} sent, then it stopped: ` : 'Not sent: '}${broke}`,
      { onPanel: !sent.length });
  }
  return { sent, quiet };
}

/**
 * THE SEAM FOR "send the full-service forms to the client".
 *
 * Eric named it himself as an example of what he wants to be able to say out
 * loud rather than tap out. The advisor branch turns a spoken instruction into
 * a confirm card he taps; the card lives in advisor.js, which cannot import
 * from this file, so the two talk through a DOM event exactly as
 * `pa-panel-review` and `pa-mark-done` already do between chat.js and
 * advisor.js.
 *
 * THE ADVISOR DISPATCHES THIS, since 2026-08-28. advisor.js fires the event
 * named by the act and reads `detail.result` straight back off the detail.
 * This listener was written before that half existed and sat inert until the
 * two landed in one tree; it is here rather than there because the sender
 * lives here. Do not read it as dead code and do not build a second one.
 *
 * THE PROMISE GOES BACK ON THE DETAIL, SYNCHRONOUSLY, and that is the whole
 * design. A fire-and-forget event cannot tell "the send failed" apart from
 * "admin-case.js is not on this page", and those need different words in front
 * of a client. The dispatcher reads `detail.result` the instant
 * dispatchEvent() returns: null means no sender is here, a rejected promise
 * means it was tried and failed. So there must never be an `await` before the
 * assignment below, or a send that is genuinely running reads as a page that
 * cannot send.
 *
 * Registered at module scope, so it is registered exactly once however many
 * times the page repaints.
 */
document.addEventListener('pa-send-forms', (e) => {
  if (!e.detail) return;
  e.detail.result = sendBlankForms(e.detail.kinds || []);
});

/**
 * The appeals workbench. One letter in flight at a time per case, which is
 * how appeals actually run: you file one, you wait for the plan's answer, and
 * what you file next depends on that answer.
 *
 * The letter is never sent from here. Eric files it through the insurer's own
 * portal, fax or certified mail, which is what keeps proof of timely filing
 * in his hands rather than in a mail server's logs. Approving is a state
 * write; the sending is his.
 */
let appealKey = null;
function paintAppeals(pane) {
  const load = () => {
    const st = panelState || {};
    const meta = st.appealMeta || {};
    const running = st.appealStatus === 'running';
    const ready = st.appealStatus === 'ready' && st.appeal;
    const key = JSON.stringify([st.appealStatus, st.appealAt, meta, (st.appeal || '').length]);
    // A poll that changed nothing must not steal a tap, or rebuild a form
    // mid-typing.
    if (key === appealKey && pane.querySelector('[data-appeal-root]')) return;
    appealKey = key;

    // Same rule as the Worker: a bare date means the whole MST day, not UTC
    // midnight, which rendered a day early on the card.
    const due = meta.dueAt
      ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(meta.dueAt))
        ? Date.parse(`${meta.dueAt}T23:59:59-07:00`)
        : meta.dueAt)
      : null;
    const daysLeft = due ? Math.ceil((due.getTime() - Date.now()) / 86_400_000) : null;
    const urgency = daysLeft === null ? '' : daysLeft <= 3 ? 'over' : daysLeft <= 14 ? 'soon' : '';

    pane.innerHTML = `
      <div class="panel" data-appeal-root>
        <h3 style="margin:0 0 .3rem;">⚖️ Appeal</h3>
        ${meta.filedAt ? `
          <p class="dim small" style="margin:0 0 .6rem;">Filed ${new Date(meta.filedAt).toLocaleDateString()}.
            ${meta.planName ? esc(meta.planName) : 'The plan'} owes an answer; commercial plans
            generally have 30 days before service and 60 after.</p>`
          : due ? `
          <p class="appeal-due ${urgency}" style="margin:0 0 .6rem;">
            Due ${due.toLocaleDateString()}${daysLeft !== null
              ? ` · ${daysLeft <= 0 ? 'past due' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}` : ''}
            ${meta.trackLabel ? `<br><span class="dim small">${esc(meta.trackLabel)}</span>` : ''}</p>`
          : '<p class="dim small" style="margin:0 0 .6rem;">Fill in the denial and I will work out the filing deadline.</p>'}

        <details class="faq" data-k="appeal-facts"${ready ? '' : ' open'}>
          <summary>The claim and the denial</summary>
          <div class="faq-a">
            <div class="row" style="gap:.5rem; flex-wrap:wrap;">
              <label class="dim small" style="flex:1 1 8rem;">Member ID
                <input type="text" data-a="memberId" value="${esc(meta.memberId || '')}"></label>
              <label class="dim small" style="flex:1 1 8rem;">Plan
                <input type="text" data-a="planName" value="${esc(meta.planName || '')}"></label>
            </div>
            <div class="row" style="gap:.5rem; flex-wrap:wrap;">
              <label class="dim small" style="flex:1 1 8rem;">Claim number
                <input type="text" data-a="claimNumber" value="${esc(meta.claimNumber || '')}"></label>
              <label class="dim small" style="flex:1 1 8rem;">Dates of service
                <input type="text" data-a="serviceDates" placeholder="e.g. 12 Jun 2026"></label>
            </div>
            <div class="row" style="gap:.5rem; flex-wrap:wrap;">
              <label class="dim small" style="flex:1 1 8rem;">Provider
                <input type="text" data-a="provider"></label>
              <label class="dim small" style="flex:1 1 8rem;">Denied on
                <input type="date" data-a="deniedAt" value="${esc(meta.deniedAt || '')}"></label>
            </div>
            <label class="dim small">Which appeal is this
              <select data-a="trackId">
                <option value="">Choose…</option>
                ${APPEAL_DEADLINES.map((t) => `<option value="${t.id}"${meta.trackId === t.id ? ' selected' : ''}>${esc(t.label)} (${t.days} days)</option>`).join('')}
              </select></label>
            <p class="dim small" style="margin:.3rem 0 .6rem;">Those are the legal
              floors. Check the denial letter: a plan may allow longer and none may
              allow less.</p>
            <label class="dim small">What the plan said, in its words
              <textarea data-a="denialReason" rows="3" placeholder="The denial reason and its code, copied from the letter."></textarea></label>
            <label class="dim small">Their policy or criteria, if you have it
              <textarea data-a="policyText" rows="3" placeholder="Paste the plan's medical policy language. This is what the letter argues against."></textarea></label>
            <label class="dim small">Clinical facts worth leading with
              <textarea data-a="clinicalFacts" rows="3" placeholder="Results with dates, who ordered what, what the treating clinician said."></textarea></label>
          </div>
        </details>

        <p class="row" style="gap:.5rem; flex-wrap:wrap; margin:.7rem 0 0;">
          <button class="btn${ready ? ' quiet' : ' glow'}" data-appeal-write ${running ? 'disabled' : ''}>
            ${running ? '⚖️ Writing…' : ready ? 'Rewrite from these facts' : 'Write the appeal'}</button>
          ${ready ? '<button class="btn quiet" data-appeal-revise>🔁 Revise…</button>' : ''}
          ${ready ? '<button class="btn quiet" data-appeal-print>🖨 Print or save</button>' : ''}
          ${ready && !meta.filedAt ? '<button class="btn" data-appeal-filed>Mark it filed</button>' : ''}
          ${ready ? '<button class="btn quiet" data-appeal-clear>Discard</button>' : ''}
        </p>
        ${st.appealError ? `<p class="error" style="margin:.5rem 0 0;">${esc(st.appealError)}</p>` : ''}
        <p class="error" data-appeal-err hidden style="margin:.5rem 0 0;"></p>
        ${ready ? `
          <textarea class="draft-box" data-appeal-text rows="18" style="margin-top:.7rem;">${esc(st.appeal)}</textarea>
          <p class="dim small" style="margin:.3rem 0 0;">Anything in square brackets
            marked NEEDS is a gap it would not invent. Fill those in before you file.</p>` : ''}
      </div>`;

    const facts = () => {
      const g = (n) => pane.querySelector(`[data-a="${n}"]`)?.value.trim() || '';
      const trackId = g('trackId');
      const track = APPEAL_DEADLINES.find((t) => t.id === trackId);
      const deniedAt = g('deniedAt');
      const dueAt = appealDueAt(deniedAt, trackId);
      return {
        memberId: g('memberId'), planName: g('planName'), claimNumber: g('claimNumber'),
        serviceDates: g('serviceDates'), provider: g('provider'), deniedAt,
        trackId, trackLabel: track?.label || '',
        dueAt: dueAt ? dueAt.toISOString().slice(0, 10) : '',
        denialReason: g('denialReason'), policyText: g('policyText'),
        clinicalFacts: g('clinicalFacts'),
      };
    };

    const post = async (payload, btn) => {
      const err = pane.querySelector('[data-appeal-err]');
      if (btn) btn.disabled = true;
      err.hidden = true;
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/advisor', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'case', id: caseId, ...payload }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok || out.ok === false) throw new Error(out.error || `Failed (${res.status})`);
        appealKey = null; // let the next poll rebuild from truth
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
        if (btn) btn.disabled = false;
      }
    };

    pane.querySelector('[data-appeal-write]')?.addEventListener('click', (e) =>
      post({ action: 'appeal-draft', appeal: facts() }, e.currentTarget));
    pane.querySelector('[data-appeal-revise]')?.addEventListener('click', (e) => {
      const what = prompt('What should change about the letter?');
      if (what === null) return;
      post({
        action: 'appeal-draft', revise: true,
        base: pane.querySelector('[data-appeal-text]')?.value || '',
        appeal: { ...facts(), instruction: what.slice(0, 1000) },
      }, e.currentTarget);
    });
    pane.querySelector('[data-appeal-clear]')?.addEventListener('click', (e) => {
      if (confirm('Discard this letter?')) post({ action: 'clear-appeal' }, e.currentTarget);
    });
    pane.querySelector('[data-appeal-filed]')?.addEventListener('click', (e) => {
      if (confirm('Mark this appeal as filed? The deadline warnings stop.')) post({ action: 'appeal-filed' }, e.currentTarget);
    });
    pane.querySelector('[data-appeal-print]')?.addEventListener('click', () => {
      const text = pane.querySelector('[data-appeal-text]')?.value || '';
      const win = window.open('', '_blank');
      if (!win) { alert('Allow pop-ups to print this.'); return; }
      win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Appeal</title>
        <style>@page { margin: 20mm; }
          body { font: 12.5px/1.6 Georgia, "Times New Roman", serif; color:#000; }
          pre { white-space: pre-wrap; word-wrap: break-word; margin:0; font: inherit; }</style>
        </head><body><pre>${text.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))}</pre></body></html>`);
      win.document.close();
      setTimeout(() => win.print(), 350);
    });
  };
  pane._reload = load;
  load();
}

/**
 * Notes for the next call, on the My doc page. Same bones as the appeals
 * workbench: paint from the advisor's state broadcast, a key guard so a poll
 * that changed nothing cannot steal a tap or wipe a hand edit, and revisions
 * that carry the box's CURRENT text so they build on manual edits.
 *
 * The sheet is for Eric's eyes on a call: resources nearby, the action plan
 * with the top priority first, then the pitch written so he can read it out
 * as is. A line that is nothing but [square brackets] is a visual - the PDF
 * renders it as a framed placeholder with the caption, per his rule that
 * anything in brackets is a chart or graphic.
 */
let callNotesKey = null;
function paintCallNotes(host) {
  if (!host) return;
  const load = () => {
    const st = panelState || {};
    // A run is only "running" while its heartbeat is fresh. The worker beats
    // callNotesProgressAt as tokens stream; a run that died between writes
    // would otherwise hold this button disabled until a reload, since the
    // queue rescue takes minutes to notice. Five minutes of silence hands
    // the button back (the rescue still cleans up the record behind it).
    const beat = Math.max(
      st.callNotesStartedAt ? new Date(st.callNotesStartedAt).getTime() : 0,
      st.callNotesProgressAt ? new Date(st.callNotesProgressAt).getTime() : 0,
    );
    const stalled = st.callNotesStatus === 'running' && beat
      && Date.now() - beat > 5 * 60_000;
    const running = st.callNotesStatus === 'running' && !stalled;
    const ready = st.callNotesStatus === 'ready' && st.callNotes;
    const key = JSON.stringify([st.callNotesStatus, st.callNotesAt, !!stalled,
      (st.callNotes || '').length, st.callNotesError || '']);
    if (key === callNotesKey && host.querySelector('[data-cn-root]')) return;
    callNotesKey = key;

    host.innerHTML = `
      <div class="panel" data-cn-root>
        <h3 style="margin:0 0 .3rem;">📞 Notes for the call</h3>
        <p class="dim small" style="margin:0 0 .6rem;">A sheet to have open while
          you talk: nearby resources worth naming, the action plan with the top
          priority first, then the pitch written out so you can read it as is.
          Your in-app personal notes are read before it drafts.</p>
        <p class="row" style="gap:.5rem; flex-wrap:wrap; margin:0;">
          <!-- Plain, not glow. This panel moved onto My doc, where the call
               document already owns the one lit action. Three lit buttons on
               one page is three things shouting and none of them heard. -->
          <button class="btn${ready ? ' quiet' : ''}" data-cn-write ${running ? 'disabled' : ''}>
            ${running ? '📞 Drafting…' : ready ? 'Redraft from scratch' : 'Draft notes for call'}</button>
          ${ready ? '<button class="btn quiet" data-cn-revise>🔁 Revise…</button>' : ''}
          ${ready ? '<button class="btn quiet" data-cn-print>🖨 Send to PDF</button>' : ''}
          ${ready ? '<button class="btn quiet" data-cn-discard>Discard</button>' : ''}
        </p>
        ${st.callNotesError ? `<p class="error" style="margin:.5rem 0 0;">${esc(st.callNotesError)}</p>` : ''}
        ${stalled ? '<p class="error" style="margin:.5rem 0 0;">The last run went quiet. Tap the draft button to try again.</p>' : ''}
        <p class="error" data-cn-err hidden style="margin:.5rem 0 0;"></p>
        ${ready ? `
          <textarea class="draft-box" data-cn-text rows="18" style="margin-top:.7rem;">${esc(st.callNotes)}</textarea>
          <p class="dim small" style="margin:.3rem 0 0;">Edit anything by hand before
            printing. A line that is only [square brackets] prints as a framed
            visual with that caption. "(verify)" marks a fact to confirm before
            you say it out loud.</p>` : ''}
      </div>`;

    const post = async (payload, btn) => {
      if (btn) btn.disabled = true;
      const err0 = host.querySelector('[data-cn-err]');
      if (err0) err0.hidden = true;
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/advisor', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'case', id: caseId, ...payload }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok || out.ok === false) throw new Error(out.error || `Failed (${res.status})`);
        callNotesKey = null; // let the next poll rebuild from truth
      } catch (e) {
        // Rebuild from the current truth FIRST: the tap flipped a label to
        // "Drafting…" that no run backs, and with the state unchanged the
        // key guard would otherwise hold that lie until a reload. Then say
        // what failed on the FRESH node - the pre-repaint one is detached.
        callNotesKey = null;
        load();
        const err = host.querySelector('[data-cn-err]');
        if (err) { err.textContent = e.message; err.hidden = false; }
      }
    };

    host.querySelector('[data-cn-write]')?.addEventListener('click', (e) => {
      // Say so at once: the state poll that repaints this panel runs on its
      // own clock, and a button that just sits there reads as a broken tap.
      e.currentTarget.textContent = '📞 Drafting…';
      post({ action: 'call-notes' }, e.currentTarget);
    });
    // The overlay, never prompt(): window.prompt() silently does nothing in
    // iOS Home-Screen apps, and this page lives on Eric's home screen.
    host.querySelector('[data-cn-revise]')?.addEventListener('click', () => {
      if (document.getElementById('pa-cn-revise')) return;
      const overlay = document.createElement('div');
      overlay.id = 'pa-cn-revise';
      overlay.className = 'settings-overlay';
      overlay.innerHTML = `
        <div class="settings-card" role="dialog" aria-modal="true" aria-label="Revise the call notes">
          <div class="row"><h3 style="margin:0;">🔁 Revise the notes</h3>
            <button class="btn quiet" data-x>Cancel</button></div>
          <p class="dim small" style="margin:.2rem 0 .5rem;">What should change?
            Add a resource, cut a step, sharpen the pitch — say it plainly.</p>
          <textarea class="edit-box" data-inst rows="3" maxlength="1000" style="min-height:4rem;"></textarea>
          <div class="actions" style="margin-top:.7rem;"><button class="btn" data-go>Revise it</button></div>
        </div>`;
      const closeOv = () => overlay.remove();
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOv(); });
      overlay.querySelector('[data-x]').addEventListener('click', closeOv);
      overlay.querySelector('[data-go]').addEventListener('click', () => {
        const instruction = overlay.querySelector('[data-inst]').value.trim();
        if (!instruction) return;
        closeOv();
        const wb = host.querySelector('[data-cn-write]');
        if (wb) wb.textContent = '📞 Drafting…';
        // wb rides along so a FAILED revise re-enables it - without that,
        // one offline moment wedged the button until a full reload.
        post({
          action: 'call-notes', instruction, revise: true,
          base: host.querySelector('[data-cn-text]')?.value || '',
        }, wb);
      });
      document.body.appendChild(overlay);
      overlay.querySelector('[data-inst]').focus();
    });
    host.querySelector('[data-cn-discard]')?.addEventListener('click', (e) => {
      if (confirm('Discard these notes?')) post({ action: 'clear-call-notes' }, e.currentTarget);
    });
    host.querySelector('[data-cn-print]')?.addEventListener('click', () => {
      printCallNotes(host.querySelector('[data-cn-text]')?.value || '');
    });
  };
  host._reload = load;
  load();
}

/**
 * The paper copy. Same print path as everything else here - a window, a
 * write, print after a beat - but the body is built line by line so a
 * bracket-only line becomes a framed visual placeholder instead of text.
 * An inline bracket mid-sentence stays text; only a line that IS the
 * bracket is a visual, which matches how the drafts come out.
 */
/**
 * Print a call sheet.
 *
 * `title` names the window, and iOS names the SAVED FILE from the window
 * title. Both the call notes and the call document came through here with
 * "Call notes" hardcoded, so his call document landed in Files as
 * "Call notes.pdf", colliding with the other feature one tab over.
 */
function printCallNotes(text, title = 'Call notes') {
  const escP = (s) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  const blocks = [];
  let run = [];
  const flush = () => {
    const body = run.join('\n').replace(/^\n+|\n+$/g, '');
    // Text, not array length: a stretch of blank lines between two visuals
    // is nothing, not an empty box with a margin.
    if (body.trim()) blocks.push(`<pre>${escP(body)}</pre>`);
    run = [];
  };
  for (const line of String(text).split('\n')) {
    // A [NEEDS: …] marker is a gap to fill, not a visual - it stays text so
    // it cannot hide inside a decorative frame if appeal prose is ever
    // pasted into this box.
    const m = line.match(/^\s*\[([^\][]{2,200})\]\s*$/);
    if (m && !/^NEEDS\b/i.test(m[1])) {
      flush();
      blocks.push(`<figure class="viz"><div class="frame">▦</div><figcaption>${escP(m[1])}</figcaption></figure>`);
    } else run.push(line);
  }
  flush();
  const win = window.open('', '_blank');
  if (!win) { alert('Allow pop-ups to print this.'); return; }
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escP(title)}</title>
    <style>@page { margin: 18mm; }
      body { font: 12.5px/1.6 Georgia, "Times New Roman", serif; color:#000; }
      pre { white-space: pre-wrap; word-wrap: break-word; margin:0 0 .6em; font: inherit; }
      .viz { margin: .8em 0; page-break-inside: avoid; }
      .viz .frame { border: 1.5px dashed #888; border-radius: 6px; min-height: 110px;
        display: flex; align-items: center; justify-content: center;
        font-size: 26px; color: #aaa; }
      .viz figcaption { text-align: center; font-style: italic; color: #444;
        font-size: 11px; margin-top: .35em; }
      /* AN EXIT. Eric, 2026-08-26: "when I open the prep document there's no
         way to exit out." On the Home Screen app this window carries no
         browser chrome at all: no address bar, no back arrow. Once the print
         sheet is dismissed the document owns the screen and the only way out
         was force-quitting. The bar is sticky so it is still under his thumb
         at the moment he is stuck, and it never prints. */
      #pa-exit { position: sticky; top: 0; z-index: 9; background: #fff;
        border-bottom: 1px solid #ddd; padding: 6px 0 8px; margin: 0 0 .9em; }
      #pa-exit button { min-height: 44px; min-width: 44px; padding: 0 20px;
        font: 600 16px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
        color: #111; background: #f1f1f1; border: 1px solid #b5b5b5;
        border-radius: 8px; cursor: pointer; -webkit-appearance: none; }
      #pa-done { font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
        color: #333; margin: 2.5em 0; }
      @media print { #pa-exit, #pa-done { display: none !important; } }</style>
    </head><body><div id="pa-exit"><button type="button" data-pa-close
      aria-label="Close this document">&#10005; Close</button></div>${blocks.join('')}
    <script>(function () {
      try {
        var bar = document.getElementById('pa-exit');
        var btn = bar && bar.querySelector('[data-pa-close]');
        if (!btn) return;
        // Last resort, and it keeps the button: window.close() failing once
        // will fail again, so leaving him a live control plus a plain page is
        // better than a blank screen he still cannot read his way out of.
        var plain = function () {
          try {
            var kids = [].slice.call(document.body.childNodes);
            for (var i = 0; i < kids.length; i++) {
              if (kids[i] !== bar) document.body.removeChild(kids[i]);
            }
            var p = document.createElement('p');
            p.id = 'pa-done';
            p.textContent = 'Done. You can close this tab.';
            document.body.appendChild(p);
          } catch (e) { /* nothing further this page can do */ }
        };
        var exit = function () {
          try { window.close(); } catch (e) { /* the checks below still run */ }
          setTimeout(function () {
            if (window.closed) return;
            try { if (history.length > 1) { history.back(); } } catch (e) { /* no history here */ }
            setTimeout(function () { if (!window.closed) plain(); }, 400);
          }, 300);
        };
        btn.addEventListener('click', exit);
        // The moment he is stuck is the moment the print sheet closes, so put
        // the exit back at the top of the screen right then.
        window.addEventListener('afterprint', function () {
          try { window.scrollTo(0, 0); btn.focus(); } catch (e) { /* a nicety */ }
        });
      } catch (e) { /* the document still reads without the control */ }
    })();<\/script></body></html>`);
  win.document.close();
  setTimeout(() => win.print(), 350);
}

/**
 * THE WORK LOG. What he has been doing on this case, by date.
 *
 * Eric, 2026-08-27: "I also do unlimited calls etc so that section should
 * just be a log of what I've been doing by date, so they can see what I've
 * been up to. Calls with notes for reason, appeals, investigations, attended
 * appointments."
 *
 * THE SAME RECORD the clinic calls always used, grown two fields, because a
 * second record would mean logging one call twice. It is still their own
 * private record and not a value on the appointment: `appointment.method` is
 * a two-value enum that gates checkout, and everything on `appointment` is
 * client-readable, so a clinic's direct line would be on the client's own
 * case doc. The number, who was on the line and his notes stay here; the one
 * line he writes for the client goes out through /api/case-log.
 *
 * NOTHING AUTO-POPULATES (Eric, asked directly, 2026-08-27: "only what I log
 * by hand"). No past check-in, attended appointment or upload writes a row
 * here. Every line on this page is one he typed.
 *
 * NO COUNTER. This panel used to say "Three are included" and "N of 3 used",
 * which contradicted his own agreement ("as many calls as the case needs. I
 * do not count them and you will never be told you have used them up") and
 * the About sheet's "Unlimited calls... never counted or metered". Nobody but
 * him ever read it, and it was still wrong.
 *
 * No audio recording. The recording consent covers Eric's calls with his
 * client, not a third party, and two-party-consent states make recording a
 * clinic without asking a legal trap. The artifact is the written note.
 */
const LOG_KINDS = [
  { id: 'call', label: 'Call', pill: 'CALL' },
  { id: 'appeal', label: 'Appeal', pill: 'APPEAL' },
  { id: 'investigation', label: 'Investigation', pill: 'INVESTIGATION' },
  { id: 'appointment', label: 'Attended appointment', pill: 'APPOINTMENT' },
];
// KEEP IN STEP with LOG_PILLS in case.js and with LOG_KINDS in the Worker.
// Three copies because one file is served to clients, one is not, and the
// Worker cannot import either; tools/suites/worklog.mjs pins all three equal.
const logKind = (id) => LOG_KINDS.find((k) => k.id === id) || LOG_KINDS[0];

// HIS OWN ACTIVITY TYPES (Eric, 2026-08-29: "I want to add 'email' for
// example but don't want to come here every time to add something new. I can
// select the highlight color."). The colour ids resolve here against scheme
// tokens; KEEP IN STEP with LOG_COLORS in case.js and LOG_COLOR_IDS in the
// Worker (worklog.mjs pins the three equal). The labels are what the picker
// shows him.
const LOG_COLORS = {
  blue: '--cyan', deep: '--magenta', green: '--green',
  gold: '--gold', orange: '--orange', red: '--danger',
};
// The slider stores a bare hue, h0-h359 (Eric, 2026-08-29: "Would like a
// color wheel/slider"); the scheme supplies saturation and lightness through
// site.css --pill-s/--pill-l. KEEP IN STEP with pillColor in case.js and
// validPillColor in the Worker.
function pillColor(c) {
  if (LOG_COLORS[c]) return `var(${LOG_COLORS[c]})`;
  const m = /^h(\d{1,3})$/.exec(String(c || ''));
  if (m && Number(m[1]) <= 359) return `hsl(${Number(m[1])} var(--pill-s, 62%) var(--pill-l, 36%))`;
  return 'var(--cyan)';
}

/** The value an <input type="datetime-local"> wants, in local time. */
function localInputValue(v) {
  const d = v ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * THE CSV (Eric, 2026-08-29: "it can be exported as a CSV so at the end of
 * a case I can export total hours worked with the things that I logged in
 * totality"). Pure and module-level so the suite lifts and RUNS it against
 * entries carrying commas, quotes and newlines rather than trusting a
 * regex. Excel-safe: every cell quoted, quotes doubled, CRLF rows; the
 * click handler prepends a BOM so Excel reads it as UTF-8. The hours ride
 * at the top in both shapes anybody wants them in: "22h 0m" for a person,
 * a decimal for a spreadsheet formula.
 */
function workLogCsv(items, totals, meta) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const row = (r) => r.map(cell).join(',');
  const hm = (s) => `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  const dec = (s) => (s / 3600).toFixed(2);
  const head = [
    ['Client', meta.client || ''],
    ['Case', meta.caseId || ''],
    ['Exported', meta.exportedAt || new Date().toISOString()],
    ['Case review hours', hm(totals.reviewSeconds), dec(totals.reviewSeconds)],
    ['Full-Service hours', hm(totals.tierSeconds), dec(totals.tierSeconds)],
    ['Total hours worked', hm(totals.totalSeconds), dec(totals.totalSeconds)],
    [],
    ['Date', 'Type', 'With', 'Client line', 'Private notes', 'Phone', 'Who was on it'],
  ];
  const body = (items || []).map((i) => [
    i.at || i.createdAt ? new Date(i.at || i.createdAt).toLocaleString('en-US') : '',
    (typeof i.kindLabel === 'string' && i.kindLabel.trim()) || logKind(i.kind).label,
    i.clinic || '', i.summary || '', i.notes || '', i.phone || '', i.parties || '',
  ]);
  return [...head, ...body].map(row).join('\r\n');
}

let callsKey = null;
// The kind the select should land on after the next repaint: set when he
// creates a type, so the thing he just made is the thing selected.
let pickKindAfterLoad = '';
// ---- one day per page -----------------------------------------------------
//
// Eric, 2026-08-30: "I want the log of tasks done (like calls) separated by
// days; each one a page. Also, the uploads as well." Every day still renders
// (the CSV export and every handler keep working against the whole list);
// this shows one day at a time and remembers which day he was on across the
// constant repaints both panes do. Newest day is the landing page: the day
// he is working is the day he came to see.
const dayPageMemo = {};
function pageByDay(key, sections, labels, { olderStep }) {
  if (sections.length <= 1) return;
  const newest = olderStep > 0 ? 0 : sections.length - 1;
  let idx = labels.indexOf(dayPageMemo[key]);
  if (idx < 0) idx = newest;
  const bar = document.createElement('p');
  bar.className = 'row day-pager';
  bar.style.cssText = 'gap:.5rem; align-items:center; justify-content:space-between; margin:.2rem 0 .6rem;';
  const paint = () => {
    dayPageMemo[key] = labels[idx];
    sections.forEach((sec, i) => { sec.hidden = i !== idx; });
    const back = olderStep > 0 ? idx : sections.length - 1 - idx;
    const olderOk = idx + olderStep >= 0 && idx + olderStep < sections.length;
    const newerOk = idx - olderStep >= 0 && idx - olderStep < sections.length;
    bar.innerHTML = `
      <button type="button" class="btn quiet tiny" data-pg-old ${olderOk ? '' : 'disabled'}>◀ Older</button>
      <span class="dim small" style="text-align:center; flex:1;">${esc(labels[idx])}<span style="display:block;">${back ? `${back} day${back === 1 ? '' : 's'} back` : 'most recent day'}</span></span>
      <button type="button" class="btn quiet tiny" data-pg-new ${newerOk ? '' : 'disabled'}>Newer ▶</button>`;
  };
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    idx += b.hasAttribute('data-pg-old') ? olderStep : -olderStep;
    idx = Math.max(0, Math.min(sections.length - 1, idx));
    paint();
  });
  sections[0].parentNode.insertBefore(bar, sections[0]);
  paint();
}

/**
 * MILESTONES (Eric, 2026-08-30: "similar to how activities are logged and I
 * can create new categories, only they're not separated by days, simply time
 * stamped, to mark achievements in progress like an appointment scheduled, a
 * referral out, an insurance authorization"). One feed, newest first, never
 * split into days. His own types ride the same colour slider the log uses,
 * and a row marked by mistake comes off with one tap. The two-week report
 * reads this feed as its progress spine when that ships.
 */
const MILESTONE_BASE = [
  { id: 'appointment', label: 'Appointment scheduled' },
  { id: 'referral', label: 'Referral out' },
  { id: 'authorization', label: 'Insurance authorization' },
];
let mileKey = null;
let pickMileKindAfterLoad = '';
function paintMilestones(pane) {
  const load = async () => {
    let items = [];
    let customs = [];
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/milestones?caseId=${encodeURIComponent(caseId)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const out = await res.json();
        items = out.items || [];
        customs = (out.kinds || []).filter((k) => k && k.id && k.label
          && (LOG_COLORS[k.color] || /^h\d{1,3}$/.test(String(k.color))));
      }
    } catch { /* an unreachable list still offers the form */ }
    const key = JSON.stringify([items, customs]);
    if (key === mileKey && pane.querySelector('[data-mile-root]')) return;
    mileKey = key;

    const stamp = new Intl.DateTimeFormat('en-US',
      { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const rowHtml = (i) => {
      const hue = pillColor(i.kindColor || 'blue');
      const at = new Date(i.at || i.createdAt || 0);
      return `
        <li class="mile-row" style="display:flex; gap:.5rem; align-items:flex-start; padding:.45rem 0; border-bottom:1px solid var(--line);">
          <span style="flex:1 1 12rem;">
            <span class="kind-pill" style="border-color:${hue}; color:${hue}">${esc(String(i.kindLabel || i.kind || '').toUpperCase())}</span>
            ${esc(String(i.what || ''))}
            <span class="dim small" style="display:block;">${Number.isFinite(at.getTime()) && at.getTime() ? esc(stamp.format(at)) : ''}</span>
          </span>
          <button class="btn ghost tiny" data-mile-remove="${esc(String(i.id))}"
            aria-label="Remove this milestone">✕</button>
        </li>`;
    };

    pane.innerHTML = `
      <div class="panel" data-mile-root>
        <h3 style="margin:0 0 .3rem;">🏁 Milestones</h3>
        <p class="dim small" style="margin:0 0 .6rem;">What has actually been
          achieved on this case, newest first: an appointment on the books, a
          referral out the door, an authorization approved. One time-stamped
          feed, the spine of the two-week progress report, and <strong>your
          client sees every entry</strong> on their case page.</p>
        <details class="faq" data-k="mile-new">
          <summary>Mark a milestone</summary>
          <div class="faq-a">
            <label class="dim small">What kind
              <select data-m="kind">
                ${MILESTONE_BASE.map((k) => `<option value="${esc(k.id)}">${esc(k.label)}</option>`).join('')}
                ${customs.map((k) => `<option value="${esc(k.id)}">${esc(k.label)}</option>`).join('')}
                <option value="__new">+ New milestone type</option>
              </select></label>
            <div data-newmile hidden style="margin:.4rem 0 .6rem; padding:.6rem; border:1px solid var(--line); border-radius:10px;">
              <label class="dim small">Call it
                <input type="text" data-mk-label maxlength="24" placeholder="e.g. Records received"></label>
              <p class="dim small" style="margin:.5rem 0 .2rem;">Highlight colour.
                Slide to any colour; the app keeps it readable in every look,
                day and night.</p>
              <input type="range" class="nk-hue" data-mk-hue min="0" max="359" value="140"
                aria-label="Highlight colour hue">
              <p style="margin:.45rem 0 0;">
                <span class="kind-pill" data-mk-preview>LIKE THIS</span></p>
              <p style="margin:.6rem 0 0;"><button class="btn quiet tiny" data-mk-add>Add the type</button></p>
              ${customs.length ? `
              <p class="dim small" style="margin:.7rem 0 .2rem;">Your types. Removing one never touches anything already marked.</p>
              ${customs.map((k) => `
              <p class="row" style="gap:.4rem; align-items:center; margin:.15rem 0;">
                <span class="kind-pill" style="border-color:${pillColor(k.color)}; color:${pillColor(k.color)}">${esc(k.label.toUpperCase())}</span>
                <button class="btn ghost tiny" data-mk-remove="${esc(k.id)}" aria-label="Remove ${esc(k.label)}">Remove</button>
              </p>`).join('')}` : ''}
            </div>
            <label class="dim small">What happened
              <input type="text" data-m="what" maxlength="300"
                placeholder="e.g. Neurology appointment set at USF for Oct 3"></label>
            <label class="dim small">When. Leave it and the mark is now.
              <input type="datetime-local" data-m="at"></label>
            <p><button class="btn" data-mile-add>Mark it</button></p>
          </div>
        </details>
        <p class="error" data-mile-err hidden></p>
        ${items.length
          ? `<ul class="filelist" style="list-style:none; padding:0; margin:.6rem 0 0;">${items.map(rowHtml).join('')}</ul>`
          : '<p class="dim small" style="margin:.6rem 0 0;">Nothing marked yet. The first appointment on the books goes here.</p>'}
      </div>`;

    const post = async (payload, btn) => {
      const err = pane.querySelector('[data-mile-err]');
      if (btn) btn.disabled = true;
      err.hidden = true;
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/milestones', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ caseId, ...payload }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
        mileKey = null;
        load();
        return out;
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
        if (btn) btn.disabled = false;
        return null;
      }
    };

    const kindSel = pane.querySelector('[data-m="kind"]');
    const newBox = pane.querySelector('[data-newmile]');
    if (kindSel && pickMileKindAfterLoad
      && [...kindSel.options].some((o) => o.value === pickMileKindAfterLoad)) {
      kindSel.value = pickMileKindAfterLoad;
      pickMileKindAfterLoad = '';
    }
    const syncNewBox = () => { if (newBox) newBox.hidden = kindSel?.value !== '__new'; };
    kindSel?.addEventListener('change', syncNewBox);
    syncNewBox();
    const hueEl = pane.querySelector('[data-mk-hue]');
    const labelEl = pane.querySelector('[data-mk-label]');
    const previewEl = pane.querySelector('[data-mk-preview]');
    const paintPreview = () => {
      if (!previewEl) return;
      const c = pillColor(`h${Number(hueEl?.value) || 0}`);
      previewEl.style.borderColor = c;
      previewEl.style.color = c;
      previewEl.textContent = (labelEl?.value.trim() || 'Like this').toUpperCase();
    };
    hueEl?.addEventListener('input', paintPreview);
    labelEl?.addEventListener('input', paintPreview);
    paintPreview();
    pane.querySelector('[data-mk-add]')?.addEventListener('click', async (e) => {
      const label = labelEl?.value.trim() || '';
      if (!label) { alert('Call it something first.'); return; }
      const color = `h${Number(hueEl?.value) || 0}`;
      const out = await post({ action: 'kind-add', label, color }, e.currentTarget);
      if (out?.id) pickMileKindAfterLoad = out.id;
    });
    for (const b of pane.querySelectorAll('[data-mk-remove]')) {
      b.addEventListener('click', () => {
        pickMileKindAfterLoad = '__new';
        post({ action: 'kind-remove', id: b.dataset.mkRemove }, b);
      });
    }
    pane.querySelector('[data-mile-add]')?.addEventListener('click', (e) => {
      const g = (n) => pane.querySelector(`[data-m="${n}"]`)?.value.trim() || '';
      if (g('kind') === '__new') { alert('Finish the new type first, or pick one from the list.'); return; }
      if (!g('what')) { alert('Say what was achieved first.'); return; }
      post({
        action: 'add', kind: g('kind'), what: g('what'),
        // Same rule as the log: the device resolves its own wall clock into
        // a real instant before the string leaves the phone.
        at: g('at') ? new Date(g('at')).toISOString() : '',
      }, e.currentTarget);
    });
    for (const b of pane.querySelectorAll('[data-mile-remove]')) {
      b.addEventListener('click', () => {
        if (confirm('Take this milestone off the feed?')) post({ action: 'remove', id: b.dataset.mileRemove }, b);
      });
    }
  };
  pane._reload = load;
  load();
}

function paintWorkLog(pane) {
  const load = async () => {
    let items = [];
    let customs = [];
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/clinic-calls?caseId=${encodeURIComponent(caseId)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const out = await res.json();
        items = out.items || [];
        customs = (out.kinds || []).filter((k) => k && k.id && k.label
          && (LOG_COLORS[k.color] || /^h\d{1,3}$/.test(String(k.color))));
      }
    } catch { /* an unreachable list still offers the form */ }
    const key = JSON.stringify([items, customs]);
    if (key === callsKey && pane.querySelector('[data-calls-root]')) return;
    callsKey = key;

    const shown = items.filter((i) => String(i.summary || '').trim()).length;
    // DAY BY DAY (Eric, 2026-08-29: "separate logged things by day so it's
    // not just one long string of logged activities"). His list keeps its
    // reading order, oldest first, so the case still reads down the page as
    // a story; a heading lands wherever the date changes.
    const dayLabel = (i) => {
      const d = new Date(i.at || i.createdAt || 0);
      return Number.isFinite(d.getTime()) && d.getTime()
        ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
        : 'No date';
    };
    const dayGroups = [];
    for (const i of items) {
      const label = dayLabel(i);
      const last = dayGroups[dayGroups.length - 1];
      if (last && last.label === label) last.rows.push(i);
      else dayGroups.push({ label, rows: [i] });
    }
    pane.innerHTML = `
      <div class="panel" data-calls-root>
        <h3 style="margin:0 0 .3rem;">🗒 Work log</h3>
        <p class="dim small" style="margin:0 0 .6rem;">Everything you do on this
          case, by date, and nothing lands here on its own. Calls, appeals,
          investigations, appointments you attended. Never counted, never
          metered.</p>
        <p class="dim small" style="margin:0 0 .6rem;"><strong>Your client sees
          an entry only if you write the client line on it.</strong> Leave that
          box empty and the entry is yours alone.
          ${items.length
            ? `${shown} of ${items.length} ${items.length === 1 ? 'entry is' : 'entries are'} on their page.`
            : ''}</p>
        ${items.length ? `<p style="margin:0 0 .6rem;"><button class="btn quiet tiny" data-log-csv>⬇ Export the log as CSV, with the hours</button></p>` : ''}
        ${dayGroups.map((g) => `
        <section class="log-day-pg">
        <p class="log-day">${esc(g.label)}</p>` + g.rows.map((i) => {
    const seen = !!String(i.summary || '').trim();
    const k = logKind(i.kind);
    // A custom entry wears the label and colour stamped on it at write
    // time, so a type he later removes never blanks an old row.
    const custom = !LOG_KINDS.some((b) => b.id === i.kind)
      && typeof i.kindLabel === 'string' && i.kindLabel.trim();
    const chue = pillColor(i.kindColor);
    const pillHtml = custom
      ? `<span class="kind-pill" style="border-color:${chue}; color:${chue}">${esc(i.kindLabel.trim().toUpperCase())}</span>`
      : `<span class="kind-pill ${esc(k.id)}">${esc(k.pill)}</span>`;
    return `
          <details class="faq" data-k="call-${esc(i.id)}">
            <summary>
              <!-- ONE WRAPPER, and it is not decoration. The summary rule in
                   site.css is display:flex with space-between, so a bare span
                   in here is a FLEX ITEM: setting it to display block changes
                   nothing, and the badge was pushed off the right edge at
                   320px, where it read "Pr". Half a word is worse than no
                   badge, because this is how he tells at a glance what his
                   client is reading. So the row is its own wrapping flex box
                   and the badge takes a whole basis, which puts it on the next
                   line at every width. Found in a 320px screenshot, twice.
                   NOTE: no back quotes in this comment. It sits inside a
                   template literal, and the first draft of it ended the
                   literal three words in. -->
              <span class="log-row">
                ${pillHtml}
                <span class="log-row-t">${esc(i.clinic || 'Someone')}${i.at ? ` · ${new Date(i.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}</span>
                <!-- THE PENCIL, top right (Eric, 2026-09-03: "Edit pencil top
                     right of each log. I misspelled his name, for example").
                     It sits inside the summary, so its handler stops the tap
                     from folding the entry. -->
                <button class="btn ghost tiny log-edit" type="button" data-call-edit="${esc(i.id)}" aria-label="Edit this entry">✏️</button>
                <span class="log-seen${seen ? ' is-on' : ''}">${seen ? '👁 Shown to your client' : '🔒 Private, not shown'}</span>
              </span></summary>
            <div class="faq-a">
              <div class="log-edit-form" data-call-edit-form="${esc(i.id)}" hidden>
                <label class="dim small">What was it
                  <select data-e="kind">
                    ${LOG_KINDS.map((k) => `<option value="${esc(k.id)}"${k.id === i.kind ? ' selected' : ''}>${esc(k.label)}</option>`).join('')}
                    ${customs.map((k) => `<option value="${esc(k.id)}"${k.id === i.kind ? ' selected' : ''}>${esc(k.label)}</option>`).join('')}
                  </select></label>
                <label class="dim small">Who it was with
                  <input type="text" data-e="clinic" maxlength="200" value="${esc(i.clinic || '')}"></label>
                <label class="dim small">When
                  <input type="datetime-local" data-e="at" value="${i.at ? esc(localInputValue(new Date(i.at).getTime())) : ''}"></label>
                <div class="row" style="gap:.5rem; flex-wrap:wrap;">
                  <label class="dim small" style="flex:1 1 8rem;">Their number, private
                    <input type="tel" data-e="phone" maxlength="40" value="${esc(i.phone || '')}"></label>
                  <label class="dim small" style="flex:1 1 8rem;">Who was on it, private
                    <input type="text" data-e="parties" maxlength="200" value="${esc(i.parties || '')}"></label>
                </div>
                <p><button class="btn tiny" type="button" data-call-edit-save="${esc(i.id)}">Save the correction</button></p>
              </div>
              ${i.phone ? `<p class="dim small">${esc(i.phone)}</p>` : ''}
              ${i.parties ? `<p class="dim small">On it: ${esc(i.parties)}</p>` : ''}
              <label class="dim small">What your client sees, in one line. Leave
                it empty and they see nothing.
                <textarea data-call-summary="${esc(i.id)}" rows="2" maxlength="400"
                  placeholder="e.g. Called the records office and chased the neurology notes.">${esc(i.summary || '')}</textarea></label>
              <label class="dim small">Your own notes. These never leave this page.
                <textarea class="notes-root" data-call-notes="${esc(i.id)}" rows="6"
                  placeholder="What was said, what was agreed, who owes what by when.">${esc(i.notes || '')}</textarea></label>
              <p><button class="btn quiet tiny" data-call-save="${esc(i.id)}">Save</button></p>
            </div>
          </details>`;
  }).join('') + '</section>').join('')}
        <details class="faq" data-k="call-new">
          <summary>Log something</summary>
          <div class="faq-a">
            <label class="dim small">What was it
              <select data-c="kind">
                ${LOG_KINDS.map((k) => `<option value="${esc(k.id)}">${esc(k.label)}</option>`).join('')}
                ${customs.map((k) => `<option value="${esc(k.id)}">${esc(k.label)}</option>`).join('')}
                <option value="__new">+ New activity type</option>
              </select></label>
            <!-- HIS OWN TYPES, MADE HERE (Eric, 2026-08-29: "I want to add
                 'email' for example but don't want to come here every time
                 to add something new. I can select the highlight color.").
                 Shown only while the dropdown sits on + New activity type. -->
            <div data-newkind hidden style="margin:.4rem 0 .6rem; padding:.6rem; border:1px solid var(--line); border-radius:10px;">
              <label class="dim small">Call it
                <input type="text" data-nk-label maxlength="24" placeholder="e.g. Email"></label>
              <p class="dim small" style="margin:.5rem 0 .2rem;">Highlight colour.
                Slide to any colour; the app keeps it readable in every look,
                day and night.</p>
              <input type="range" class="nk-hue" data-nk-hue min="0" max="359" value="210"
                aria-label="Highlight colour hue">
              <p style="margin:.45rem 0 0;">
                <span class="kind-pill" data-nk-preview>LIKE THIS</span></p>
              <p style="margin:.6rem 0 0;"><button class="btn quiet tiny" data-nk-add>Add the type</button></p>
              ${customs.length ? `
              <p class="dim small" style="margin:.7rem 0 .2rem;">Your types. Removing one never touches anything already logged.</p>
              ${customs.map((k) => `
              <p class="row" style="gap:.4rem; align-items:center; margin:.15rem 0;">
                <span class="kind-pill" style="border-color:${pillColor(k.color)}; color:${pillColor(k.color)}">${esc(k.label.toUpperCase())}</span>
                <button class="btn ghost tiny" data-nk-remove="${esc(k.id)}" aria-label="Remove ${esc(k.label)}">Remove</button>
              </p>`).join('')}` : ''}
            </div>
            <label class="dim small">Who it was with
              <input type="text" data-c="clinic" placeholder="e.g. Valley Neurology, or their insurer"></label>
            <label class="dim small">When
              <input type="datetime-local" data-c="at" value="${esc(localInputValue(Date.now()))}"></label>
            <label class="dim small">What your client sees, in one line. Leave it
              empty and they see nothing.
              <textarea data-c="summary" rows="2" maxlength="400"
                placeholder="e.g. Filed your first-level appeal."></textarea></label>
            <div class="row" style="gap:.5rem; flex-wrap:wrap;">
              <label class="dim small" style="flex:1 1 8rem;">Their number, private
                <input type="tel" data-c="phone"></label>
              <label class="dim small" style="flex:1 1 8rem;">Who was on it, private
                <input type="text" data-c="parties" placeholder="e.g. me, the client, records clerk"></label>
            </div>
            <p><button class="btn" data-call-add>Add it</button></p>
          </div>
        </details>
        <p class="error" data-calls-err hidden></p>
      </div>`;

    // The whole record leaves as one file: every entry plus the clock's
    // three figures, named for the client and the day.
    pane.querySelector('[data-log-csv]')?.addEventListener('click', () => {
      const total = liveTotalSeconds();
      const review = Math.min(clock.mark || 0, total);
      const csv = workLogCsv(items, {
        reviewSeconds: review,
        tierSeconds: Math.max(0, total - review),
        totalSeconds: total,
      }, {
        client: (data || {}).clientName || (data || {}).clientEmail || caseId,
        caseId,
        exportedAt: new Date().toISOString(),
      });
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const who = String((data || {}).clientName || 'case').trim().replace(/[^\w-]+/g, '-').toLowerCase() || 'case';
      a.download = `work-log-${who}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    });

    const post = async (payload, btn) => {
      const err = pane.querySelector('[data-calls-err]');
      if (btn) btn.disabled = true;
      err.hidden = true;
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/clinic-calls', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ caseId, ...payload }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
        callsKey = null;
        load();
        return out;
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
        if (btn) btn.disabled = false;
        return null;
      }
    };

    // The new-type mini form, revealed only while the dropdown sits on
    // + New activity type; anything he made lands back in the dropdown
    // selected, so the next tap logs under it.
    const kindSel = pane.querySelector('[data-c="kind"]');
    const newBox = pane.querySelector('[data-newkind]');
    if (kindSel && pickKindAfterLoad
      && [...kindSel.options].some((o) => o.value === pickKindAfterLoad)) {
      kindSel.value = pickKindAfterLoad;
      pickKindAfterLoad = '';
    }
    const syncNewBox = () => { if (newBox) newBox.hidden = kindSel?.value !== '__new'; };
    kindSel?.addEventListener('change', syncNewBox);
    syncNewBox();
    // The live preview: the pill shows the name he is typing in the hue he
    // is sliding through, before anything is saved.
    const hueEl = pane.querySelector('[data-nk-hue]');
    const labelEl = pane.querySelector('[data-nk-label]');
    const previewEl = pane.querySelector('[data-nk-preview]');
    const paintPreview = () => {
      if (!previewEl) return;
      const c = pillColor(`h${Number(hueEl?.value) || 0}`);
      previewEl.style.borderColor = c;
      previewEl.style.color = c;
      previewEl.textContent = (labelEl?.value.trim() || 'Like this').toUpperCase();
    };
    hueEl?.addEventListener('input', paintPreview);
    labelEl?.addEventListener('input', paintPreview);
    paintPreview();
    pane.querySelector('[data-nk-add]')?.addEventListener('click', async (e) => {
      const label = labelEl?.value.trim() || '';
      if (!label) { alert('Call it something first.'); return; }
      const color = `h${Number(hueEl?.value) || 0}`;
      const out = await post({ action: 'kind-add', label, color }, e.currentTarget);
      if (out?.id) pickKindAfterLoad = out.id;
    });
    for (const b of pane.querySelectorAll('[data-nk-remove]')) {
      b.addEventListener('click', () => {
        pickKindAfterLoad = '__new'; // stay on the manager so he sees it gone
        post({ action: 'kind-remove', id: b.dataset.nkRemove }, b);
      });
    }

    pane.querySelector('[data-call-add]')?.addEventListener('click', (e) => {
      const g = (n) => pane.querySelector(`[data-c="${n}"]`)?.value.trim() || '';
      if (g('kind') === '__new') { alert('Finish the new type first, or pick one from the list.'); return; }
      if (!g('clinic')) { alert('Say who it was with first.'); return; }
      post({
        action: 'add', kind: g('kind'), clinic: g('clinic'), summary: g('summary'),
        // A real instant, not the picker's bare wall-clock string: the
        // Worker's clock is UTC, and it read "1:31 PM" as 1:31 UTC, which
        // painted back as 7:31 AM (Eric, 2026-08-29). The device knows what
        // its own wall clock means; let it say so before the string leaves.
        phone: g('phone'), at: g('at') ? new Date(g('at')).toISOString() : '', parties: g('parties'),
      }, e.currentTarget);
    });
    for (const b of pane.querySelectorAll('[data-call-save]')) {
      b.addEventListener('click', (e) => post({
        action: 'notes', id: b.dataset.callSave,
        notes: pane.querySelector(`[data-call-notes="${b.dataset.callSave}"]`)?.value || '',
        summary: pane.querySelector(`[data-call-summary="${b.dataset.callSave}"]`)?.value || '',
      }, e.currentTarget));
    }
    // The pencil and its Save (2026-09-03). The pencil lives inside the
    // <summary>, so its tap is stopped from folding the entry; it opens the
    // entry and unfolds the form instead.
    for (const b of pane.querySelectorAll('[data-call-edit]')) {
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const d = b.closest('details');
        if (d) d.open = true;
        const f = pane.querySelector(`[data-call-edit-form="${b.dataset.callEdit}"]`);
        if (f) f.hidden = !f.hidden;
      });
    }
    for (const b of pane.querySelectorAll('[data-call-edit-save]')) {
      b.addEventListener('click', (e) => {
        const f = pane.querySelector(`[data-call-edit-form="${b.dataset.callEditSave}"]`);
        const g = (n) => f?.querySelector(`[data-e="${n}"]`)?.value.trim() || '';
        if (!g('clinic')) { alert('Say who it was with first.'); return; }
        post({
          action: 'edit', id: b.dataset.callEditSave, kind: g('kind'), clinic: g('clinic'),
          at: g('at') ? new Date(g('at')).toISOString() : '', phone: g('phone'), parties: g('parties'),
        }, e.currentTarget);
      });
    }
    pageByDay('log', [...pane.querySelectorAll('.log-day-pg')],
      dayGroups.map((g) => g.label), { olderStep: -1 });
  };
  pane._reload = load;
  load();
}

// ---- the call document ----------------------------------------------------
//
// Eric, 2026-08-26: "a tab/section where I can upload a document and the
// advisor can format it, add in other useful information regarding his
// uploaded charts and labs, list questions that need to be asked that were
// missed, and highlight anything and note with a * if there is anything that
// I need to review that may be incorrect."
//
// Different from the call NOTES panel above, which generates a short sheet
// from the case. This one starts from a document he wrote, keeps his
// structure, and enriches it. Admin only, like everything on this page.
//
// The files ride inline as base64 rather than through Storage: this is a
// document he has on the device in his hand, often one he has not and will
// not put on the case, and making him upload it to the client's file shelf
// first would be a worse product and a privacy question he never asked for.

/**
 * A run THIS PAGE just started that the state poll has not reported yet.
 *
 * The poll owns the truth, but it can be a whole interval behind: he taps
 * build, the Worker accepts it, and until the next tick the panel still
 * believes nothing is running. That gap is exactly where the document he is
 * reading would stay editable through a rebuild and the button would look
 * tappable a second time. The panel knows it started a run, so this is it
 * saying so until the poll agrees. `at` is here so a run that never reports
 * back cannot leave the button disabled forever.
 */
let callDocPending = null;

/**
 * The case's own files, listed once and offered beside the device upload.
 *
 * WHY THIS EXISTS. The call document's fourth section is "FROM THE CASE, NOT
 * IN YOUR DOCUMENT", and it is the one the prompt calls the section that
 * earns its keep: a trend across results, a contradiction between two
 * documents, a date that does not line up. All of that needs two documents in
 * the room. Until now there was one - his - because the picker was a bare
 * device <input type="file"> and runCallDoc read nothing else. So the section
 * had only the assessment to work from, and restated the assessment he had
 * already read that morning. A max-effort turn spent on a summary.
 *
 * These go as URLs, which is the cheap path: Storage to the model, the bytes
 * never passing through the Worker, and a far larger size ceiling than an
 * inline upload gets.
 */
let callDocCaseFiles = null;      // null = not listed yet
let callDocCasePicked = new Set(); // storage paths he ticked
// How the listing is going, so the panel can say so. `null` until one starts.
// Eric watched "Looking for files on this case…" sit unchanged with his own
// upload on the screen above it; one sentence that never moves is
// indistinguishable from a dead page.
let callDocListProgress = null;
let callDocListing = false;

/**
 * ERIC'S OWN SHELF. cases/{id}/prep/ — his pre-call documents, working notes,
 * anything he wants the advisor to have and the client never to see.
 *
 * Eric, 2026-08-26: "I can't just upload my precall document for him to see.
 * There needs to be an uploads section under Mine that only me and the
 * advisor see, and he pairs it with the rest of the context of the case,
 * invisible to the client."
 *
 * NO STORAGE RULE CHANGE WAS NEEDED, and that is worth knowing rather than
 * assuming. storage.rules already allows a client to read only four named
 * folders under a case - report, recording, uploads, chat-files - and grants
 * everything else under cases/{id}/ to the admin alone. Its own comment says
 * why the rule was written that way: "one manual upload of working notes or a
 * prep sheet into that prefix and it would be on their screen." So `prep/` is
 * client-denied by a rule that already exists and is already deployed, not by
 * one shipped tonight and hoped about.
 *
 * It lives on the Call doc page rather than as a sixth tab because a group
 * holds four tabs before the strip wraps, and Mine is full. Beside the thing
 * that consumes it is also simply where it belongs.
 */
const PREP_DIR = 'prep';
let prepFiles = null;              // null = not listed yet
const prepPicked = new Set();      // storage paths he ticked
let prepBusy = '';                 // a filename mid-upload, for the progress line

/** Inline cap. The Worker refuses larger, and saying so here saves the trip. */
const CALLDOC_MAX_BYTES = 8 * 1024 * 1024;
/** Mirrors MAX_IMAGE_BYTES in worker/advisor.js. A photo over this is refused
 *  by the advisor, so refusing it here saves an upload and a wait. */
const CALLDOC_MAX_IMAGE_BYTES = 4.5 * 1024 * 1024;
const CALLDOC_MAX_FILES = 12;
/** Chosen but not yet sent. Cleared once a build starts. */
let callDocPicked = [];
let callDocKey = null;

/**
 * LOOK THINGS UP ON THE INTERNET, per build, and OFF unless he ticks it.
 *
 * Eric, 2026-08-26: "any internet searches for providers mentioned or other
 * providers/paths of action that may be useful."
 *
 * Off by default, because every lookup is billed on top of the most expensive
 * run in the app and most rebuilds are a reformat of material already in the
 * room. A default of ON would charge him on every revise for a section he did
 * not ask for. So it is a deliberate tick, and the tick rides with that one
 * request rather than being remembered as a setting.
 */
let callDocSearch = false;

const readAsBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onerror = () => reject(new Error(`Could not read ${file.name}`));
  r.onload = () => {
    const s = String(r.result || '');
    const comma = s.indexOf(',');
    resolve(comma < 0 ? '' : s.slice(comma + 1));
  };
  r.readAsDataURL(file);
});

function paintCallDoc(host) {
  if (!host) return;
  const load = () => {
    const st = panelState || {};
    // Same heartbeat rule as the call notes: a run whose beat has gone quiet
    // for five minutes hands the button back, so a dead turn cannot hold the
    // panel hostage until a reload.
    const beat = Math.max(
      st.callDocStartedAt ? new Date(st.callDocStartedAt).getTime() : 0,
      st.callDocProgressAt ? new Date(st.callDocProgressAt).getTime() : 0,
    );
    // The poll has caught up (it reports running, or the document changed, or
    // it failed) - or the optimistic flag has simply been up too long to be
    // believed any more.
    if (callDocPending && (st.callDocStatus === 'running'
      || st.callDocStatus === 'error'
      || String(st.callDocAt || '') !== callDocPending.wasAt
      || Date.now() - callDocPending.at > 30_000)) callDocPending = null;

    const stalled = st.callDocStatus === 'running' && beat && Date.now() - beat > 5 * 60_000;
    const running = (st.callDocStatus === 'running' || !!callDocPending) && !stalled;
    // A DOCUMENT HE ALREADY HAS MUST NEVER VANISH. `ready` used to gate both
    // the controls AND the document text, so the moment he tapped "Build a
    // new one" or "Revise", the sheet he was about to read on the call was
    // removed from the page for the whole multi-minute run - and if that run
    // errored, status stayed 'error' and the good document, still intact on
    // the server, was never rendered again. Not on reload either. A dropped
    // connection destroyed his access to a working document with no way back
    // but a successful rebuild.
    //
    // So: hasDoc decides what he can READ, and ready decides what he can DO.
    const hasDoc = !!st.callDoc;
    const ready = st.callDocStatus === 'ready' && hasDoc;
    // `running` rather than st.callDocStatus, so the optimistic flag is part
    // of what decides a repaint. Keying off the server status alone meant a
    // just-started run rendered nothing until the poll caught up, which is
    // the whole gap the flag exists to close.
    const key = JSON.stringify([st.callDocStatus, running, st.callDocAt, !!stalled,
      (st.callDoc || '').length, st.callDocError || '', callDocPicked.map((f) => f.name),
      callDocSearch]);
    if (key === callDocKey && host.querySelector('[data-cd-root]')) return;
    callDocKey = key;

    // How many things there are to check. Counted from the numbered list in
    // REVIEW BEFORE YOU CALL, which the prompt guarantees holds every flag
    // exactly once.
    //
    // It used to count every LINE containing a *, and every flag appears
    // twice by design - gathered at the top and marked in place - so the
    // number came out roughly double. On the shipped demo fixture it said
    // "5 lines flagged" for 3 real concerns, and the better the document
    // obeyed its own instructions the more wrong the number got. He would
    // read 5, find the 3 in the list, then hunt a 30-line sheet for two
    // flags that do not exist, with the phone ringing.
    const stars = (() => {
      if (!hasDoc) return 0;
      const sec = String(st.callDoc).split(/^REVIEW BEFORE YOU CALL\s*$/m)[1];
      if (sec === undefined) {
        // No section: fall back to distinct starred lines rather than a lie.
        return new Set((String(st.callDoc).match(/^[^\n]*\*[^\n]*$/gm) || [])
          .map((s) => s.trim())).size;
      }
      const body = sec.split(/\n(?=[A-Z][A-Z ,'-]{6,}$)/m)[0] || '';
      if (/nothing flagged/i.test(body)) return 0;
      return (body.match(/^\s*\d+[.)]\s+\S/gm) || []).length;
    })();

    host.innerHTML = `
      <div class="panel" data-cd-root>
        <!-- The tab says "My doc", so the heading under it says the same
             thing. A page whose tab and heading use different words for it is
             a page you can look straight at and still not be sure you found. -->
        <h3 style="margin:0 0 .3rem;">📄 My call document</h3>
        <p class="dim small" style="margin:0 0 .6rem;">Upload what you have written
          for this call. It comes back reformatted so you can read it down the
          page while you talk, with what the case adds, the questions your
          document does not ask, and a <strong style="color:var(--gold)">*</strong>
          on anything worth checking before you say it. Your document stays the
          spine: your order, your priorities, your words.</p>

        ${running ? '' : `
          <p class="eyebrow cd-step">1 · Your document</p>
          <label class="small" style="display:block; margin:0 0 .5rem;">Your document, plus any charts or labs
            <input type="file" data-cd-files multiple
              accept=".pdf,.jpg,.jpeg,.png">
          </label>
          ${callDocPicked.length ? `<p class="dim small" style="margin:0 0 .5rem;">
            ${callDocPicked.map((f, i) => `<span class="chip-label">${i === 0 ? '📄 ' : '📎 '}${esc(f.name)}</span>`).join(' ')}
            <button class="btn quiet" data-cd-clearfiles style="font-size:.7rem; padding:.2rem .5rem;">clear</button></p>` : ''}
          ${hasDoc ? `<p class="dim small" style="margin:-.25rem 0 .5rem;">📄 is the one treated as
            <strong style="color:var(--ink)">your</strong> document, 📎 are charts and labs. Pick again to
            build a new one; your current document stays until the new one lands.</p>` : ''}
          <div class="cd-case" data-cd-prep>
            <p class="dim small" style="margin:.2rem 0 .3rem;">
              <strong style="color:var(--ink)">🔒 Your shelf.</strong> Documents you put here stay
              between you and the advisor. The client cannot see them, cannot list them, and they
              never appear on their Files page. Put your pre-call sheet here once and it is on
              every device you sign in on.</p>
            <label class="small" style="display:block; margin:0 0 .4rem;">Add to your shelf
              <input type="file" data-prep-add multiple accept=".pdf,.jpg,.jpeg,.png">
            </label>
            ${prepBusy ? `<p class="dim small" style="margin:0 0 .4rem; color:var(--cyan);">Uploading ${esc(prepBusy)}…</p>` : ''}
            ${prepFiles === null
              ? '<p class="dim small" style="margin:0 0 .5rem;">Opening your shelf…</p>'
              : prepFiles.length
                ? prepFiles.map((f) => `
                    <label class="cd-case-row">
                      <input type="checkbox" data-prep-file value="${esc(f.path)}"
                        ${prepPicked.has(f.path) ? 'checked' : ''}>
                      <span>🔒 ${esc(f.name)}</span>
                      <button class="btn quiet" data-prep-del="${esc(f.path)}"
                        style="font-size:.68rem; padding:.15rem .45rem;">remove</button>
                    </label>`).join('')
                : '<p class="dim small" style="margin:0 0 .5rem;">Nothing on your shelf yet.</p>'}
          </div>
          <p class="eyebrow cd-step">2 · Add from this case</p>
          <div class="cd-case" data-cd-case>
            ${callDocCaseFiles === null
              // A COUNT THAT MOVES, not one sentence that sits there. And a
              // way out: if it did not work he can press again rather than
              // stare at a line that is never going to change on its own.
              ? `<p class="dim small" data-cd-listing style="margin:0 0 .5rem;">${
                esc(listingLine(callDocListProgress || { done: 0, total: 5, files: 0, failed: 0 }))
                || 'Looking for files on this case…'}</p>
                 <button class="btn quiet tiny" data-cd-relist>Try again</button>`
              : callDocCaseFiles.length
                ? `${callDocListProgress?.failed
                    ? `<p class="saved-note warn" role="status"><span>${esc(listingLine(callDocListProgress))}</span></p>` : ''}
                   <p class="dim small" style="margin:0 0 .3rem;">And from this case, so it can read across
                     them rather than only summarising what you already have:</p>
                   ${callDocCaseFiles.map((f) => `
                     <label class="cd-case-row">
                       <input type="checkbox" data-cd-case-file value="${esc(f.path)}"
                         ${callDocCasePicked.has(f.path) ? 'checked' : ''}>
                       <span>${esc(String(f.name).replace(/^\d{10,}-/, ''))}</span>
                       <span class="dim">${esc(f.kindLabel)}</span>
                     </label>`).join('')}`
                : `${callDocListProgress?.failed
                    ? `<p class="saved-note warn" role="status"><span>${esc(listingLine(callDocListProgress))}</span></p>
                       <button class="btn quiet tiny" data-cd-relist>Try again</button>`
                    : '<p class="dim small" style="margin:0 0 .5rem;">Nothing on this case it can read yet.</p>'}`}
          </div>
          <label class="cd-case-row" style="margin:.4rem 0 .1rem;">
            <input type="checkbox" data-cd-search ${callDocSearch ? 'checked' : ''}>
            <span>🌐 Look things up on the internet for this one</span>
          </label>
          <p class="dim small" style="margin:0 0 .6rem;">Off unless you tick it, because each build
            that does it costs more. When it is on, providers, programmes and insurers named in the
            record get looked up, along with other paths worth knowing about. Anything found lands in
            its own section at the end, <strong style="color:var(--gold)">marked as not from the case
            file and not verified</strong>, with the link beside every line. Never treat that section
            as part of the record.</p>`}

        ${running ? '' : '<p class="eyebrow cd-step">3 · Build it</p>'}
        <p class="row" style="gap:.5rem; flex-wrap:wrap; margin:0;">
          <button class="btn${hasDoc ? ' quiet' : ' glow'}" data-cd-build ${running ? 'disabled' : ''}>
            ${running ? '📄 Building…' : hasDoc ? 'Build a new one' : 'Build the call document'}</button>
          ${hasDoc && !running ? '<button class="btn quiet" data-cd-revise>🔁 Revise…</button>' : ''}
          ${hasDoc ? '<button class="btn quiet" data-cd-print>🖨 Send to PDF</button>' : ''}
          ${hasDoc && !running ? '<button class="btn quiet" data-cd-discard>Discard</button>' : ''}
          ${running ? '<button class="btn quiet" data-cd-stop>✕ Stop waiting</button>' : ''}
        </p>

        ${running ? '<p class="dim small" style="margin:.5rem 0 0;">This one thinks hard and takes a few minutes. You can leave the page; it keeps going.</p>' : ''}
        ${st.callDocError ? `<p class="error" style="margin:.5rem 0 0;">${esc(st.callDocError)}</p>` : ''}
        ${stalled ? '<p class="error" style="margin:.5rem 0 0;">The last run went quiet. Tap build to try again.</p>' : ''}
        <p class="error" data-cd-err hidden style="margin:.5rem 0 0;"></p>
        ${(st.callDocSkipped || []).length ? `<p class="dim small" style="margin:.5rem 0 0; color:var(--gold);">
          Could not read: ${(st.callDocSkipped || []).map(esc).join('; ')}</p>` : ''}

        ${hasDoc ? `
          ${running ? '<p class="dim small" style="margin:.6rem 0 .2rem; color:var(--gold);">This is your current document. It stays exactly as it is until the new one lands.</p>' : ''}
          <p class="dim small" style="margin:.6rem 0 .2rem;">
            ${stars ? `<strong style="color:var(--gold)">${stars} thing${stars === 1 ? '' : 's'} to check</strong> before you rely on them.` : 'Nothing flagged.'}
            ${(st.callDocSources || []).length ? ` Built from: ${(st.callDocSources || []).map(esc).join(', ')}.` : ''}</p>
          ${st.callDocSearchNote ? `<p class="dim small" style="margin:-.1rem 0 .2rem; color:var(--gold);">
            🌐 ${esc(st.callDocSearchNote)}</p>` : ''}
          <textarea class="draft-box" data-cd-text rows="24" ${running ? 'readonly' : ''}>${esc(st.callDoc)}</textarea>
          <p class="dim small" style="margin:.3rem 0 0;">Edit anything by hand before
            printing. A line that is only [square brackets] prints as a framed
            visual with that caption.</p>` : ''}
      </div>`;

    const post = async (payload, btn) => {
      if (btn) btn.disabled = true;
      const err0 = host.querySelector('[data-cd-err]');
      if (err0) err0.hidden = true;
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/advisor', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ kind: 'case', id: caseId, ...payload }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok || out.ok === false) throw new Error(out.error || `Failed (${res.status})`);
        callDocKey = null;
      } catch (e) {
        // Repaint from truth first, then say what failed on the FRESH node:
        // the tap flipped a label to "Building…" that no run backs, and the
        // pre-repaint error node is detached.
        callDocKey = null;
        load();
        const err = host.querySelector('[data-cd-err]');
        if (err) { err.textContent = e.message; err.hidden = false; }
      }
    };

    host.querySelector('[data-cd-files]')?.addEventListener('change', async (e) => {
      const chosen = [...(e.target.files || [])].slice(0, CALLDOC_MAX_FILES);
      // The cap that actually applies. An image is refused by the advisor
      // over 4.5 MB while everything else has 8 MB, and the panel used to
      // wave through anything under 8 - so a 6 MB photo was accepted, base64'd,
      // uploaded, and dropped server-side minutes later with "too large to
      // read". Refusing it here is instant and costs him nothing.
      const capFor = (f) => (/^image\//.test(f.type || '') ? CALLDOC_MAX_IMAGE_BYTES : CALLDOC_MAX_BYTES);
      const tooBig = chosen.filter((f) => f.size > capFor(f));
      const msg = tooBig.length
        ? `${tooBig.map((f) => f.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} too big`
          + ` (${tooBig.some((f) => /^image\//.test(f.type || '')) ? 'photos up to 4.5 MB, other files' : 'up to'} 8 MB).`
          + ' Send one page, or a smaller photo.'
        : '';
      callDocPicked = chosen.filter((f) => f.size <= capFor(f))
        .map((f, i) => ({ file: f, name: f.name, contentType: f.type, size: f.size, mine: i === 0 }));
      callDocKey = null;
      // Repaint FIRST, then write the message onto the fresh node. Writing it
      // before load() put it on a node that load() then destroyed, so an
      // oversize pick was dropped in complete silence: he saw one chip where
      // he chose two, no error, and a document built without his labs.
      load();
      if (msg) {
        const fresh = host.querySelector('[data-cd-err]');
        if (fresh) { fresh.textContent = msg; fresh.hidden = false; }
      }
    });

    // ---- the private shelf ----
    host.querySelector('[data-prep-add]')?.addEventListener('change', async (ev) => {
      const chosen = [...(ev.target.files || [])];
      if (!chosen.length) return;
      for (const file of chosen) {
        // The same two caps the advisor applies, refused here so he learns in
        // a second rather than after a build.
        const cap = /^image\//.test(file.type || '') ? CALLDOC_MAX_IMAGE_BYTES : CALLDOC_MAX_BYTES;
        if (file.size > cap) {
          prepBusy = '';
          callDocKey = null;
          load();
          const e2 = host.querySelector('[data-cd-err]');
          if (e2) {
            e2.textContent = `${file.name} is too big (photos up to 4.5 MB, other files 8 MB).`;
            e2.hidden = false;
          }
          continue;
        }
        prepBusy = file.name;
        callDocKey = null;
        load();
        try {
          const safe = file.name.replace(/[^\w.\- ]+/g, '_');
          const task = uploadBytesResumable(
            ref(storage, `cases/${caseId}/${PREP_DIR}/${Date.now()}-${safe}`), file);
          await new Promise((res, rej) => task.on('state_changed', null, rej, res));
        } catch (e3) {
          prepBusy = '';
          callDocKey = null;
          load();
          const e4 = host.querySelector('[data-cd-err]');
          if (e4) { e4.textContent = `Could not add ${file.name}: ${e3.message}`; e4.hidden = false; }
          continue;
        }
      }
      prepBusy = '';
      prepFiles = null;
      callDocKey = null;
      load();
      listPrep().then(() => { callDocKey = null; load(); });
    });

    for (const cb of host.querySelectorAll('[data-prep-file]')) {
      cb.addEventListener('change', (ev) => {
        const v = ev.currentTarget.value;
        if (ev.currentTarget.checked) prepPicked.add(v); else prepPicked.delete(v);
      });
    }

    for (const btn of host.querySelectorAll('[data-prep-del]')) {
      btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        const path = ev.currentTarget.getAttribute('data-prep-del');
        const nice = String(path).split('/').pop().replace(/^\d{10,}-/, '');
        if (!confirm(`Remove ${nice} from your shelf? This deletes the file.`)) return;
        try {
          await deleteObject(ref(storage, path));
        } catch (e5) {
          const e6 = host.querySelector('[data-cd-err]');
          if (e6) { e6.textContent = `Could not remove it: ${e5.message}`; e6.hidden = false; }
          return;
        }
        prepPicked.delete(path);
        prepFiles = null;
        callDocKey = null;
        load();
        listPrep().then(() => { callDocKey = null; load(); });
      });
    }

    for (const cb of host.querySelectorAll('[data-cd-case-file]')) {
      cb.addEventListener('change', (ev) => {
        const v = ev.currentTarget.value;
        if (ev.currentTarget.checked) callDocCasePicked.add(v);
        else callDocCasePicked.delete(v);
        // No repaint: rebuilding innerHTML here would drop the checkbox he is
        // still tapping down the list, and the ticks are already on screen.
      });
    }

    // No repaint on tick. Rebuilding innerHTML here would take the checkbox
    // out from under his finger, and the tick is already drawn on screen; the
    // flag is in the repaint key so any LATER repaint renders it correctly.
    host.querySelector('[data-cd-search]')?.addEventListener('change', (ev) => {
      callDocSearch = ev.currentTarget.checked === true;
    });

    host.querySelector('[data-cd-clearfiles]')?.addEventListener('click', () => {
      callDocPicked = [];
      callDocKey = null;
      load();
    });

    host.querySelector('[data-cd-build]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const err = host.querySelector('[data-cd-err]');
      // A BUILD ALWAYS NEEDS A DOCUMENT. This used to pass whenever a call
      // document already existed - and in that state the file picker was not
      // even on the page - so "Build a new one" posted sources: [] and spent
      // a max-effort turn against a prompt whose first instruction is "He has
      // uploaded a document he prepared himself. THAT DOCUMENT IS THE SPINE."
      // What came back looked exactly like a real one and silently replaced
      // his. The picker is always shown now, and this is the matching guard.
      if (!callDocPicked.length && !prepPicked.size) {
        if (err) {
          err.textContent = (panelState || {}).callDoc
            ? 'Tick the document to build from, on your shelf or from this device. To change the one you have, use Revise.'
            : 'Choose your document first, from your shelf or from this device.';
          err.hidden = false;
        }
        return;
      }
      btn.textContent = '📄 Reading your document…';
      btn.disabled = true;
      // HIS SHELF MUST BE LISTED BEFORE WE READ IT (Eric, 2026-08-26: "Prep
      // file did not populate after I attached my own document and selected
      // uploaded file").
      //
      // `prepFiles` is null until listPrep() has run, and the assembly below
      // reads `(prepFiles || [])`. So "not listed yet" silently became "you
      // have no files", his ticked document vanished from the sources, and the
      // guard above still let the build through because `prepPicked` was not
      // empty. He got a document built from nothing he chose, which is the
      // exact failure he photographed. Uploading sets prepFiles back to null,
      // so the window between his upload and the relist is precisely when he
      // is most likely to tick something and press build.
      if (prepPicked.size && prepFiles === null) await listPrep();
      let sources;
      try {
        const mine = await Promise.all(callDocPicked.map(async (p) => ({
          name: p.name, contentType: p.contentType, size: p.size, mine: p.mine,
          data: await readAsBase64(p.file),
        })));
        // The case's files ride as URLs: Storage straight to the model, no
        // bytes through the Worker, and a much larger ceiling than an inline
        // upload gets. None of them is ever marked `mine` - his own document
        // is the thing he just picked off this device, and mistaking a lab
        // report for the spine makes the model faithfully preserve the wrong
        // document's structure.
        // His shelf. These ARE his documents, so the first one is the spine
        // when he has not also picked something off the device this minute.
        // They ride as URLs like the case files: Storage to the model, no
        // bytes through the Worker. The URL is fenced to this case on the
        // Worker side, and the object itself is admin-only in storage.rules.
        const fromShelf = (prepFiles || [])
          .filter((f) => prepPicked.has(f.path))
          .map((f, i) => ({
            name: f.name, contentType: f.contentType, size: f.size,
            url: f.url, mine: !mine.length && i === 0,
            // Carried only so the guard below can name what went missing. The
            // Worker ignores it.
            path: f.path,
          }));
        const fromCase = (callDocCaseFiles || [])
          .filter((f) => callDocCasePicked.has(f.path))
          .map((f) => ({
            name: f.name, contentType: f.contentType, size: f.size,
            url: f.url, mine: false,
          }));
        // NEVER BUILD WITH FEWER OF HIS FILES THAN HE TICKED. Above is one way
        // a tick can evaporate; a file renamed or removed between the tick and
        // the tap is another, and listPrep() answers [] on any Storage error
        // at all, so a permission blip empties the shelf while the ticks stay
        // on screen. Every one of those used to end the same way: a confident
        // document built without the thing he chose. If anything he asked for
        // is not in hand, stop and name it.
        if (fromShelf.length < prepPicked.size) {
          const got = new Set(fromShelf.map((f) => f.path));
          const lost = [...prepPicked]
            .filter((x) => !got.has(x))
            .map((x) => String(x).split('/').pop().replace(/^\d{10,}-/, ''));
          throw new Error(
            `Could not read ${lost.join(', ')} from your shelf, so nothing was built. `
            + 'Your document is still there. Try again in a moment.');
        }
        sources = [...mine, ...fromShelf, ...fromCase].slice(0, CALLDOC_MAX_FILES);
      } catch (e2) {
        callDocKey = null;
        load();
        const err2 = host.querySelector('[data-cd-err]');
        if (err2) { err2.textContent = e2.message; err2.hidden = false; }
        return;
      }
      btn.textContent = '📄 Building…';
      callDocPicked = [];
      // Remember what the state looked like BEFORE the run, so load() can
      // tell "the poll has not caught up yet" from "the new document landed".
      callDocPending = { at: Date.now(), wasAt: String((panelState || {}).callDocAt || '') };
      // Repaint NOW, on this page's own knowledge. post() only clears the key
      // and waits for the poll, which can be a whole interval away - and the
      // running state is what makes his current document read-only and takes
      // the picker off the screen. `btn` is detached by this repaint; post()
      // only ever sets .disabled on it, which is harmless on a dead node.
      callDocKey = null;
      load();
      // The tick as it stands at the moment he taps build, sent with this one
      // request. The Worker defaults it off, so an old page that does not send
      // the field builds without searching rather than spending on a surprise.
      await post({ action: 'call-doc', sources, search: callDocSearch }, btn);
    });

    // The overlay, never prompt(): window.prompt() does nothing at all inside
    // an iOS Home-Screen app, and this page lives on Eric's home screen.
    host.querySelector('[data-cd-revise]')?.addEventListener('click', () => {
      if (document.getElementById('pa-cd-revise')) return;
      const overlay = document.createElement('div');
      overlay.id = 'pa-cd-revise';
      overlay.className = 'settings-overlay';
      overlay.innerHTML = `
        <div class="settings-card" role="dialog" aria-modal="true" aria-label="Revise the call document">
          <div class="row"><h3 style="margin:0;">🔁 Revise the document</h3>
            <button class="btn quiet" data-x style="margin-left:auto;">Cancel</button></div>
          <p class="dim small" style="margin:.2rem 0 .5rem;">What should change? Cut a
            section, add a question, put the insurance part first. Everything you do
            not mention stays as it is.</p>
          <textarea class="edit-box" data-inst rows="3" maxlength="2000" style="min-height:4rem;"></textarea>
          <div class="actions" style="margin-top:.7rem;"><button class="btn" data-go>Revise it</button></div>
        </div>`;
      const closeOv = () => overlay.remove();
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOv(); });
      overlay.querySelector('[data-x]').addEventListener('click', closeOv);
      overlay.querySelector('[data-go]').addEventListener('click', () => {
        const instruction = overlay.querySelector('[data-inst]').value.trim();
        if (!instruction) return;
        closeOv();
        // The edited text, not the stored one: if he has changed it by hand,
        // that is the document he means.
        const base = host.querySelector('[data-cd-text]')?.value || '';
        callDocPending = { at: Date.now(), wasAt: String((panelState || {}).callDocAt || '') };
        callDocKey = null;
        load();
        post({ action: 'call-doc', revise: true, instruction, base, search: callDocSearch });
      });
      document.body.appendChild(overlay);
      overlay.querySelector('[data-inst]').focus();
    });

    host.querySelector('[data-cd-discard]')?.addEventListener('click', () => {
      if (!confirm('Discard this call document?')) return;
      post({ action: 'clear-call-doc' });
    });

    // AN EXIT. Eric, 2026-08-26: "There's nowhere to exit draft for video prep
    // sheet." He was right, and the read-only-while-building fix made it
    // worse: during a run every control was gone, so a run that was going to
    // take ten minutes owned the page until it finished or the stall rule
    // fired at five. This hands the panel back immediately.
    //
    // It stops WAITING, not the run. The turn keeps going on the Worker and
    // the document still lands, which is the honest thing to say on the
    // button: there is no cancel to send, and pretending otherwise would have
    // him tap it and believe nothing was still running.
    host.querySelector('[data-cd-stop]')?.addEventListener('click', () => {
      callDocPending = null;
      // Discard the local optimism only. The server's own 'running' is left
      // alone; if it is still going, the next poll puts the panel back into
      // the running state, which is correct, and the stall rule still covers
      // a run that has actually died.
      callDocKey = null;
      load();
      const e7 = host.querySelector('[data-cd-err]');
      if (e7) {
        e7.textContent = 'Stopped waiting. The document is still being built and will appear here when it lands.';
        e7.hidden = false;
      }
    });

    host.querySelector('[data-cd-print]')?.addEventListener('click', () => {
      const text = host.querySelector('[data-cd-text]')?.value || '';
      if (text) printCallNotes(text, 'Call document');
    });
  };
  load();
  callDocRepaint = load;

  // List the case's files ONCE per mount, then repaint so they appear. Doing
  // it inside load() would re-list on every poll tick, which is five Storage
  // calls a time for a list that barely changes.
  if (prepFiles === null) {
    listPrep().finally(() => { callDocKey = null; load(); });
  }
  // `callDocListing` stops a second run piling on top of a first. paintCallDoc
  // runs on every onShow, so flipping to this page twice while a slow listing
  // was in flight used to start it again from scratch.
  const listCaseFilesIntoPicker = () => {
    if (callDocListing) return;
    callDocListing = true;
    callDocListProgress = { done: 0, total: 5, files: 0, failed: 0 };
    listCaseFiles({
      onProgress: (p) => {
        callDocListProgress = p;
        // Write straight onto the line rather than repainting the whole
        // panel: a repaint mid-listing would drop whatever he has already
        // ticked and re-run the file input's markup underneath his finger.
        const line = host.querySelector('[data-cd-listing]');
        if (line && p.done < p.total) line.textContent = listingLine(p);
      },
    })
      .then((rows) => {
        callDocCaseFiles = rows
          .filter(advisorReadable)
          .sort((a, b) => b.ts - a.ts)
          .map((r) => ({
            // What he calls it, so a file he renamed is not offered here
            // under the name he renamed it away from.
            name: readName(r),
            path: r.path,
            url: r.url,
            contentType: r.contentType,
            size: r.size,
            kindLabel: r.kind === 'chat' ? 'shared in chat'
              : r.kind === 'report' ? 'your report'
                : r.kind === 'recording' ? 'recording' : 'uploaded',
          }));
      })
      // A listing that throws outright still has to END. Leaving
      // callDocCaseFiles at null was the state that put one unchanging
      // sentence on the screen with nothing after it.
      .catch(() => {
        callDocCaseFiles = [];
        callDocListProgress = { done: 5, total: 5, files: 0, failed: 5 };
      })
      .finally(() => { callDocListing = false; callDocKey = null; load(); });
  };

  // Delegated onto the host, which load() never replaces, and bound ONCE:
  // paintCallDoc runs on every onShow, and a listener added per visit would
  // fire the retry once per time he had opened the page.
  if (!host.dataset.relistBound) {
    host.dataset.relistBound = '1';
    host.addEventListener('click', (e) => {
      if (!e.target.closest('[data-cd-relist]')) return;
      callDocCaseFiles = null;
      callDocListProgress = null;
      callDocKey = null;
      load();
      listCaseFilesIntoPicker();
    });
  }

  if (callDocCaseFiles === null) listCaseFilesIntoPicker();
}
