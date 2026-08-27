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
import { STATUS_REACTIONS } from './msg-actions.js';
import { mountAdvisor, sendToClient } from './advisor.js';
import { mountNotes } from './notes.js';
import { mountSaved } from './saved.js';
import { markSeen, isUnseen, PAGE_BADGES } from './seen.js';
import { openDutyDraft } from './duty.js';
import { openPrepSheet } from './prep.js';
import { mountFolder } from './folder.js';
import {
  recordsAuthorisationModel, representativeDesignationModel, APPEAL_DEADLINES, appealDueAt,
  authorityHtml, authorityModelFor, authorityExpired, authorityEndsAt, AUTHORITY_KINDS,
} from './authority.js';
import { handsOffReadiness, handsOffStartsLater } from './readiness.js';
import { openAuthorityDocument } from './authority-doc-window.js';
import {
  providerPacketModel, effectiveStatus,
  PROVIDER_STATUSES, PROVIDER_REQUESTS,
} from './admin-provider-packet.js';

/**
 * His own contact block, for the cover sheet and the patient designation.
 * Loaded with the provider list and cached here so the packet does not have to
 * fetch it at print time, when a failed fetch would mean a cover sheet with no
 * way to reply on it. Empty until it loads, and every field renders as a ruled
 * line rather than a placeholder when it is not set.
 */
let advocateContact = { business: '', phone: '', email: '', fax: '' };

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
  //    dropped the whole Hands-Off payment. A $1,200 booking that then paid
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
      { id: 'mine', label: 'Mine', icon: '🔒', pages: ['notes', 'calldoc', 'drafts', 'saved'] },
      // A FIFTH group rather than a fifth page in an existing one: four per
      // group is the width constraint, and 'read' and 'track' are both full.
      // Only rendered for a Full Access case; on a standard case these pages
      // would be furniture for work that was never bought.
      ...(data.fullAccess
        ? [{ id: 'act', label: 'Act', icon: '⚖️', pages: ['appeals', 'calls'] }] : []),
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
        {
          id: 'calls', title: 'Clinic calls', icon: '📞',
          render: (pane) => paintClinicCalls(pane),
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
  head.innerHTML = `
    <div class="case-who">
      <span class="case-name" data-client>${esc(c.clientName || c.clientEmail || c.clientUid)}</span>
      <span class="status-pill" data-status>${(c.status || '?').replace('_', ' ').toUpperCase()}</span>
    </div>
    ${c.status === 'closed' ? '' : `
    <button type="button" class="btn quiet work-head" data-work-head
      aria-label="Clock in or out of this case">⏱</button>`}
    <p class="dim small working-line" data-working hidden></p>`;
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
    composerButton: {
      icon: '⚕️',
      title: 'Duty of care draft',
      onClick: () => openDutyDraft({
        tz: data.clientTz || '',
        onSend: (text) => chatSend?.(text),
      }),
    },
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
const clock = { seconds: 0, startedAt: 0, loaded: false };
const clockPaints = new Set();
const paintClock = () => {
  for (const f of [...clockPaints]) {
    if (f.root && !f.root.isConnected) { clockPaints.delete(f); continue; }
    f();
  }
};
/** Banked plus the live stretch, clamped like every sibling renderer:
 *  clock.startedAt is the SERVER's clock (a phone seconds behind it rendered
 *  "-1h -1m · running"), and a stretch forgotten over a weekend banks at most
 *  twelve hours, so all three switches and the bank agree on one number. */
const liveClockSeconds = () => Math.max(0, clock.seconds
  + (clock.startedAt
    ? Math.min(Math.floor((Date.now() - clock.startedAt) / 1000), 12 * 3600)
    : 0));
/** One ticking repaint for however many switches exist. A minute is plenty. */
function armClockTick() {
  clearInterval(workTick);
  workTick = setInterval(() => { if (clock.startedAt) paintClock(); }, 30_000);
}

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
  clock.loaded = true;
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
    btn.textContent = on ? `● WORKING · ${total}` : `▶ Start · ${total}`;
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
    totalEl.innerHTML = `${esc(total)} on this case${clock.startedAt ? ' · running' : ''}<span class="fixit">✎ fix</span>`;
    totalEl.setAttribute('aria-label',
      `${total} banked on this case. Tap to add or subtract time.`);
    totalEl.classList.toggle('on', !!clock.startedAt);
    // The margin line, live beside the clock that produces it.
    if (rateEl) {
      const hourly = effectiveHourly(c, t);
      rateEl.hidden = hourly === null;
      if (hourly !== null) {
        rateEl.textContent = `$${dollars(hourly)}/hr`;
        rateEl.classList.toggle('under', hourly < floorCents);
        rateEl.title = hourly < floorCents
          ? `Below your $${dollars(floorCents)}/hr floor. $${dollars(paidCents(c))} paid so far.`
          : `$${dollars(paidCents(c))} paid so far.`;
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
  // And the rate pill records what they actually paid. Deliberately on the
  // pill: it is the thing showing the wrong answer, so it is the thing to
  // press. Writes paidOverrideCents, which paidCents() prefers over any
  // inference from today's price.
  rateEl?.addEventListener('click', async () => {
    const cur = Number(c.paidOverrideCents) > 0 ? (c.paidOverrideCents / 100).toFixed(2) : '';
    const typed = prompt(
      'What did this client actually pay for the case itself, in dollars?\n\n'
      + 'Add-ons and follow-ups are counted separately and do not go here.', cur);
    if (typed === null) return;
    const amount = Number(String(typed).replace(/[^0-9.]/g, ''));
    if (!(amount > 0)) {
      say('paid', 'That did not look like an amount. Nothing changed.', { tone: 'warn' });
      refreshOverview();
      return;
    }
    try {
      await api({ action: 'set-paid', paidCents: Math.round(amount * 100) });
      await load();
      say('paid', `Recorded. This case shows $${dollars(Math.round(amount * 100))} paid, and the hourly is worked out from that.`);
    } catch (err) {
      say('paid', `Not recorded: ${err.message}`, { tone: 'warn' });
    }
    refreshOverview();
  });
}

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
        await postWork({ setSeconds: next });
        close();
      } catch (e2) {
        if (err) { err.textContent = e2.message || 'That did not save. Try again.'; err.hidden = false; }
        button.disabled = false;
      }
    };
    overlay.querySelector('[data-sub]').addEventListener('click', (e) => apply(-1, e.currentTarget));
    overlay.querySelector('[data-add]').addEventListener('click', (e) => apply(1, e.currentTarget));

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
      <h3 style="margin:0 0 .3rem; color:var(--cyan);">Hands-Off request — your call</h3>
      <p class="small" style="margin:0 0 .2rem;">
        First month <strong>$${((Number(c.fullAccessRequest.firstMonthCents) || 0) / 100).toLocaleString()}</strong>
        (their case fee is already off it), then
        <strong>$${((Number(c.fullAccessRequest.monthCents) || 0) / 100).toLocaleString()}/mo</strong>.</p>
      <p class="dim small" style="margin:0 0 .7rem;">Nothing has been charged and no
        card was taken. Approving sends them a link to start month one at the rate
        quoted above — the one they were shown when they asked, not today's.
        You take at most two of these at once; if you are full, approving
        tells you so and asks before it goes ahead.</p>
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

  pane.innerHTML = `
    ${infoBar(c, mtFmt, start, due)}
    <!-- ON EVERY CASE, not only Hands-Off ones. The tier gate moved off the
         records release on 2026-08-26 (any case can sign one, because
         reviewing records IS the standard case) but this panel kept its own
         copy of the old rule. So on a standard case the client could sign the
         documents and Eric had nowhere to see them, print them, or build a
         packet from them. The readiness checklist inside it is still drawn
         only for a Hands-Off case, where it means something. -->
    <div data-authority-status></div>
    ${waiting.trim() ? `<p class="eyebrow mgmt-when hot">Waiting on you</p>${waiting}` : ''}

    <!-- OUTSIDE the panel below on purpose: the panel is gone the moment the
         tier is on, which is exactly when this line has something to say. -->
    ${saidHtml('openfull')}
    <p class="eyebrow mgmt-when">Before the call</p>
    ${!c.fullAccess ? '' : `
    <!-- CORRECTING AN AGREEMENT THAT IS ALREADY RUNNING. An agreement made on
         a call gets renegotiated on a later call, and the length and the start
         were set once and then frozen: a mistyped date, or a fortnight that
         became six weeks, left a case that could never say the truth again.
         Moves no money and sends no email; the amount is the rate pill's job. -->
    <details class="mgmt" data-k="agreement">
      <summary>🤝 Their agreement</summary>
      <div class="mgmt-body">
        <p class="dim small" style="margin:0 0 .6rem;">What you and this client
          agreed, and what the window runs on. Changing it moves no money and
          sends them nothing. To correct what they paid, tap the rate beside
          the work clock.</p>
        <label class="small" style="display:block; margin-bottom:.3rem;">
          Starts
          <input type="date" id="agree-start" style="margin-left:.35rem;">
        </label>
        <label class="small" style="display:block; margin-bottom:.3rem;">
          and runs for
          <input type="number" id="agree-days" min="1" max="365" step="1"
            style="width:5rem; margin:0 .35rem;">days
        </label>
        <p class="dim small" id="agree-when" style="margin:0 0 .5rem;"></p>
        <p class="error" id="agree-err" hidden></p>
        <div class="actions"><button class="btn secondary" id="agree-go">Save the agreement</button></div>
      </div>
    </details>`}
    ${saidHtml('agree')}

    ${c.fullAccess ? '' : `
    <!-- OPENING THE TIER BY HAND. Until now the only thing that could set
         fullAccess was a Stripe webhook, so a client who agreed on a call and
         paid another way could not be given what he had bought: the
         authorisation forms, the readiness checklist and the check-in booking
         are all gated on that flag. Eric, 2026-08-26: "where to start the
         clock and send forms as if he paid for the enhancement through the
         app." -->
    <details class="mgmt" data-k="openfull">
      <summary>🤝 Open Hands-Off by hand</summary>
      <div class="mgmt-body">
        <p class="dim small" style="margin:0 0 .6rem;">For a client who agreed
          it on a call. This opens exactly the case a payment opens: their
          authorisation forms, the readiness checklist, and the email telling
          them to sign. They cannot tell which way the money reached you.</p>
        <p class="small" style="margin:0 0 .5rem;">This case shows
          <strong>${paidCents(c) === null ? 'no payment recorded' : '$' + dollars(paidCents(c))}</strong>
          paid so far.</p>
        <label class="small" style="display:block; margin-bottom:.3rem;">
          Paid you for Hands-Off, outside the app
          <span class="sched-amt">
            <span aria-hidden="true">$</span>
            <input type="text" inputmode="decimal" id="openfull-amt"
              placeholder="0" aria-label="Amount in dollars">
          </span>
        </label>
        <p class="dim small" style="margin:0 0 .5rem;">Leave it at zero if you
          already took the money through the charge panel. It is on the case
          once already, and entering it twice inflates your hourly.</p>
        <p class="small" id="openfull-total" style="margin:0 0 .7rem;"></p>
        <label class="small" style="display:block; margin-bottom:.3rem;">
          Their month starts
          <input type="date" id="openfull-start" style="margin-left:.35rem;">
        </label>
        <label class="small" style="display:block; margin-bottom:.3rem;">
          and runs for
          <input type="number" id="openfull-days" min="1" max="365" step="1" value="30"
            style="width:5rem; margin:0 .35rem;">days
        </label>
        <p class="dim small" id="openfull-when" style="margin:0 0 .5rem;"></p>
        <p class="error" id="openfull-err" hidden></p>
        <div class="actions"><button class="btn secondary" id="openfull-go">Open Hands-Off and send the forms</button></div>
      </div>
    </details>`}

    <details class="mgmt" data-k="auth">
      <summary>📄 Print a form to sign</summary>
      <div class="mgmt-body">
        <p class="dim small" style="margin:0 0 .6rem;">A blank copy to print or
          send, with ${esc(c.clientName || 'the client')}'s name already on it and
          ruled lines to sign by hand. Use this to get a form into their hands
          before a case is running${c.fullAccess ? '' : ', and signing in the app opens when they upgrade'}.
          Records requests take weeks, so the form going out early is the whole game.</p>
        <!-- THE UNIVERSAL FORM AND THE PAGE THAT TRAVELS WITH IT COME FIRST,
             because they are what a new client signs. Both blanks were written
             and golden-tested this build and neither had a button, so the one
             document sign-once exists to produce could not be printed for a
             client at all, on the panel whose own copy says this is how a form
             reaches somebody before a case exists. -->
        <p class="row" style="gap:.4rem; flex-wrap:wrap; margin:0;">
          <button class="btn quiet tiny" data-blank="universal">Universal authorisation</button>
          <button class="btn quiet tiny" data-blank="designation">The one page for clinics</button>
          <button class="btn quiet tiny" data-blank="records">Records authorisation (one clinic)</button>
          <button class="btn quiet tiny" data-blank="representative">Insurance representative</button>
        </p>
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
  wireAgreement(pane, c);
  pane.querySelectorAll('[data-action]').forEach((b) =>
    b.addEventListener('click', () => milestone(b.dataset.action, b)));
  // Blank forms print straight from the pure functions — nothing is written
  // down, because nothing has been signed. Deliberately not a [data-action]:
  // those all post a milestone to the server, and this one is just paper.
  pane.querySelectorAll('[data-blank]').forEach((b) =>
    b.addEventListener('click', () => printAuthorityDoc({ kind: b.dataset.blank, blank: true })));
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
          if (!confirm(`You already carry ${out.open} of ${out.max}. Take this one anyway?`)) {
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
          <p class="meta"><strong>${esc(r.name)}</strong><br>
            ${esc(when.format(r.ts))} · ${esc(size(r.size))} · ${esc(r.kindLabel || r.kind || '')}</p>
          ${isImg(r)
            ? `<img src="${esc(r.url)}" alt="${esc(r.name)}">`
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
      <div class="uploads" id="files"><p class="dim small">Loading…</p></div>
      <label class="small" style="margin-top:.7rem;">Upload the recording
        <input type="file" id="up-recording" accept="video/*,audio/*,.mp4,.m4a,.mp3,.mkv,.webm">
      </label>
      <label class="small" style="margin-top:.5rem;">Upload the report <span class="dim">(advances the case + pings the client)</span>
        <input type="file" id="up-report" accept=".pdf,.html,.md,.doc,.docx,.jpg,.jpeg,.png,.heic">
      </label>
      <progress id="bar" max="100" value="0" hidden></progress>
      <p class="error" id="err" hidden></p>
      <p class="saved-note ok" id="up-said" role="status" hidden></p>
    </div>`;
  pane.querySelector('#up-recording').addEventListener('change', (e) =>
    upload(e.target.files[0], 'recording', 'recording-uploaded'));
  pane.querySelector('#up-report').addEventListener('change', (e) =>
    upload(e.target.files[0], 'report', 'report-uploaded'));
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

async function upload(file, kind, milestoneAction) {
  if (!file) return;
  const bar = document.getElementById('bar');
  const err = document.getElementById('err');
  const done = document.getElementById('up-said');
  err.hidden = true;
  if (done) done.hidden = true;
  bar.hidden = false;
  const safe = file.name.replace(/[^\w.\- ]+/g, '_');
  const task = uploadBytesResumable(ref(storage, `cases/${caseId}/${kind}/${safe}`), file);
  try {
    await new Promise((resolve, reject) => {
      task.on('state_changed',
        (snap) => { bar.value = (snap.bytesTransferred / snap.totalBytes) * 100; },
        reject, resolve);
    });
    await api({ action: milestoneAction });
    // The bar hides and the list repaints, which up to now was the whole of
    // the feedback: he could not tell an upload that landed from one that
    // silently did not. The Uploads page is not repainted wholesale by load(),
    // so this line can simply stay put.
    if (done) {
      done.textContent = kind === 'report'
        ? `“${file.name}” is up. Your client can open it on their case page now, and their page says the report is delivered.`
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

// Uploads are grouped by day and then by what kind of thing they are. The
// order inside a day is deliberate: the report is the deliverable, documents
// are what the advisor reads, images are usually screenshots of documents, and
// a recording is an hour of video nobody scrubs through on a phone.
const FILE_GROUPS = ['Reports', 'Documents', 'Images', 'Recordings', 'Other'];

function fileGroup(r) {
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

async function refreshFiles() {
  const listEl = document.getElementById('files');
  if (!listEl) return;
  let last = null;
  const rows = await listCaseFiles({
    onProgress: (p) => {
      last = p;
      // Only while it is still working. Once it is done the list itself is
      // the answer, and a progress line under a list of files is noise.
      if (p.done < p.total && document.getElementById('files') === listEl) {
        listEl.innerHTML = `<p class="dim small">${esc(listingLine(p))}</p>`;
      }
    },
  });
  const short = last && last.failed
    ? `<p class="saved-note warn" role="status"><span>${esc(listingLine(last))}
         Try opening this page again.</span></p>`
    : '';
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
  const label = (kind) => (kind === 'saved' ? 'SAVED' : kind === 'chat' ? 'CHAT' : kind.toUpperCase());

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
        <span class="fname"><span class="kind-pill ${r.kind}">${label(r.kind)}</span><a href="${r.url}" target="_blank" rel="noopener">${esc(String(r.name).replace(/^\d{10,}-/, ''))}</a></span>
        <span class="fmeta">${time.format(r.ts)} · ${prettySize(r.size)}</span>
      </span>
      ${reviewable(r)
        ? `<button class="btn quiet file-review" data-review="${i}"
             aria-label="Hand ${esc(String(r.name).replace(/^\d{10,}-/, ''))} to the advisor to read"
             title="Hand this to the advisor to read, then press Update on the Read page">👨‍⚕️</button>`
        : ''}
    </li>`;
  };

  listEl.innerHTML = short + [...days.values()].map((day) => `
    <section class="up-day">
      <h4 class="up-date">${esc(day.label)}</h4>
      ${FILE_GROUPS.filter((g) => day.groups.has(g)).map((g) => `
        <h5 class="up-kind">${esc(g)}<span class="up-n">${day.groups.get(g).length}</span></h5>
        <ul class="filelist">${day.groups.get(g).map(row).join('')}</ul>`).join('')}
    </section>`).join('');
  listEl.querySelectorAll('[data-thumb]').forEach((img) => {
    const r = rows[Number(img.dataset.thumb)];
    img.addEventListener('click', () => openLightbox({ name: r.name, url: r.url }));
  });
  // Long-press (or right-click) any row to delete the file. Full authority
  // on this side (Eric, 2026-08-22: "I get authority on both"); the confirm
  // is the only brake.
  listEl.querySelectorAll('[data-frow]').forEach((li) => {
    const r = rows[Number(li.dataset.frow)];
    if (!r?.path) return;
    const name = String(r.name).replace(/^\d{10,}-/, '');
    const askThen = () => {
      if (!confirm(`Delete "${name}"? This removes it for the client too.`)) return;
      (async () => {
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
      })();
    };
    let timer = null;
    li.addEventListener('touchstart', () => { timer = setTimeout(askThen, 550); }, { passive: true });
    for (const ev of ['touchend', 'touchmove', 'touchcancel']) {
      li.addEventListener(ev, () => clearTimeout(timer), { passive: true });
    }
    li.addEventListener('contextmenu', (e) => { e.preventDefault(); askThen(); });
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
  row('CALL', start
    ? `${fmt.format(start)} MST · ${esc(c.appointment.method)}${c.publicElection?.choice === 'public' ? ' · <span style="color:var(--magenta)">PUBLIC</span>' : ''}`
    : 'no appointment', start ? null : 'var(--danger)');

  const extraCents = Array.isArray(c.extraPayments)
    ? c.extraPayments.reduce((x, p) => x + (p.amountCents || 0), 0) : 0;
  const totalCents = (c.stripe?.amountTotal || 0) + extraCents;
  if (totalCents)
    row('PAID', `$${(totalCents / 100).toLocaleString()}${extraCents ? ` <span class="dim">(case $${((c.stripe?.amountTotal || 0) / 100).toLocaleString()} + sessions $${(extraCents / 100).toLocaleString()})</span>` : ''}`, 'var(--cyan)');

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
 * Opening Hands-Off Case Management by hand.
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
/**
 * Correcting an agreement that is already running.
 *
 * Eric, 2026-08-26: "I should be able to override with custom
 * amounts/agreements me and the client make. Because that might vary per
 * client and length of time."
 *
 * Deliberately three separate controls rather than one big one, because they
 * are three different kinds of fact and two of them are dangerous:
 *
 *   what they PAID          the rate pill, beside the work clock
 *   when it starts and how long it runs   here
 *   whether they are on the tier at all   the opening panel, once
 *
 * This one moves no money and sends no email. It is a record of a deal.
 */
function wireAgreement(el, c) {
  const startEl = el.querySelector('#agree-start');
  if (!startEl) return;                   // not on the tier: no panel
  const daysEl = el.querySelector('#agree-days');
  const whenEl = el.querySelector('#agree-when');
  const errEl = el.querySelector('#agree-err');
  const go = el.querySelector('#agree-go');
  const dayFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, month: 'long', day: 'numeric',
  });
  // Prefilled from the case, so the fields say what is true before he touches
  // them. A blank form here would invite him to retype a date he had right.
  const at = c.fullAccessAt ? toDate(c.fullAccessAt) : null;
  if (at && !startEl.value) {
    startEl.value = new Intl.DateTimeFormat('en-CA', {
      timeZone: MOUNTAIN_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(at);
  }
  // The length actually in force: what he agreed, or the standard month.
  if (daysEl && !daysEl.value) daysEl.value = String(Number(c.fullAccessDays) || FULL_WINDOW_DAYS);
  const bought = Number(c.fullAccessExtraDays) || 0;

  const readDays = () => {
    const n = Math.round(Number((daysEl?.value || '').trim()));
    return Number.isFinite(n) && n >= 1 && n <= 365 ? n : null;
  };
  const readStart = () => {
    const day = (startEl.value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
    const t = new Date(`${day}T12:00:00-07:00`);
    return Number.isNaN(t.getTime()) ? null : t;
  };
  const preview = () => {
    const t = readStart();
    const n = readDays();
    if (!whenEl) return;
    if (!t || n === null) { whenEl.textContent = 'Give a date and a length between 1 and 365 days.'; return; }
    // Months they BOUGHT sit on top of what was agreed, and are named
    // separately so a purchase never reads as something he typed.
    const end = new Date(t.getTime() + (n + bought) * 86_400_000);
    whenEl.textContent = `Their window would run ${dayFmt.format(t)} to ${dayFmt.format(end)}`
      + `${bought ? `, including ${bought} days they bought` : ''}.`;
  };
  [startEl, daysEl].forEach((x) => {
    x?.addEventListener('input', preview);
    x?.addEventListener('change', preview);
  });
  preview();

  go.addEventListener('click', async () => {
    errEl.hidden = true;
    const t = readStart();
    const n = readDays();
    if (!t || n === null) {
      errEl.textContent = 'Give a date and a length between 1 and 365 days.';
      errEl.hidden = false;
      return;
    }
    const end = new Date(t.getTime() + (n + bought) * 86_400_000);
    // Named out loud. Moving a window changes the day their case closes and
    // the day their renewal notice goes out.
    if (!confirm(`Change ${c.clientName || 'this client'}'s agreement?\n\n`
      + `Their window runs ${dayFmt.format(t)} to ${dayFmt.format(end)}.\n\n`
      + 'Nothing is charged and they are not emailed.')) return;
    go.disabled = true;
    try {
      await api({ action: 'set-agreement', startAt: t.toISOString(), days: n });
      // Re-read before claiming, and say the date the CASE now holds rather
      // than the one that was typed.
      await load();
      const now = data?.fullAccessAt ? toDate(data.fullAccessAt) : null;
      const held = Number(data?.fullAccessDays) || FULL_WINDOW_DAYS;
      say('agree', now && held === n
        ? `Saved. Their window runs ${dayFmt.format(now)} to ${dayFmt.format(end)}.`
        : 'That went through, but the case does not show the change yet. Try once more.',
      { tone: now && held === n ? 'ok' : 'warn' });
      refreshOverview();
    } catch (err) {
      say('agree', `Not saved: ${err.message}`, { tone: 'warn' });
      go.disabled = false;
      refreshOverview();
    }
  });
}

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
  const daysEl = el.querySelector('#openfull-days');
  const whenEl = el.querySelector('#openfull-when');
  const agreedDays = () => {
    const n = Math.round(Number((daysEl?.value || '').trim()));
    return Number.isFinite(n) && n >= 1 && n <= 365 ? n : null;
  };
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
    const n = agreedDays();
    if (n === null) { whenEl.textContent = 'Give a length between 1 and 365 days.'; return; }
    const end = new Date(t.getTime() + n * 86_400_000);
    // The word "month" is dropped once it is not one. He can agree a
    // fortnight, and calling that a month on his own screen is how the wrong
    // date ends up in an email.
    const what = n === 30 ? 'month' : `${n} days`;
    whenEl.textContent = t.getTime() > Date.now()
      ? `Their ${what} runs ${dayFmt.format(t)} to ${dayFmt.format(end)}. Their forms go live today either way, so records requests can start moving now.`
      : `Their ${what} runs ${dayFmt.format(t)} to ${dayFmt.format(end)}.`;
  };
  startEl?.addEventListener('change', previewWhen);
  startEl?.addEventListener('input', previewWhen);
  daysEl?.addEventListener('input', previewWhen);
  daysEl?.addEventListener('change', previewWhen);
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
    const days = agreedDays();
    if (days === null) {
      errEl.textContent = 'Give a length between 1 and 365 days.';
      errEl.hidden = false;
      return;
    }
    const after = paidCents({ ...c, fullAccess: true, fullAccessRateCents: paidForCase + cents });
    // The figure is named out loud. An upgrade that emails the client and
    // unlocks the signing surfaces is not a thing to do on a mis-tap.
    if (!confirm(`Open Hands-Off Case Management on ${c.clientName || 'this case'}?\n\n`
      + `${cents > 0 ? `Recording $${dollars(cents)} paid outside the app.` : 'No new payment recorded.'}\n`
      + `${after === null ? 'The case will show no payment recorded.' : `The case will show $${dollars(after)} paid.`}\n`
      + `Their ${days === 30 ? 'month' : `${days} days`} starts ${dayFmt.format(startAt)} and ends ${dayFmt.format(new Date(startAt.getTime() + days * 86_400_000))}.\n\n`
      + 'They get an email asking them to sign their authorisation.')) return;
    go.disabled = true;
    try {
      await api({ action: 'open-full', tierCents: cents, startAt: startAt.toISOString(), days });
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
        ? `Open. Their authorisation forms are live on their case page and the email has gone.${stored ? ` Their month ${later ? 'starts' : 'started'} ${dayFmt.format(stored)}.` : ''}`
        : 'That went through, but the case still does not show Hands-Off. Do not send them to sign yet: try once more.',
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
 * never sign it himself. The client's own page is where signing happens.
 *
 * Served through the Worker like everything else under the case's private
 * subtree, which the browser cannot read directly by rule.
 */
async function paintAuthorityStatus(pane) {
  const host = pane?.querySelector('[data-authority-status]');
  if (!host) return;
  let items = [];
  let providers = [];
  try {
    const token = await user.getIdToken();
    const [res, pRes] = await Promise.all([
      fetch(`/api/authority?caseId=${encodeURIComponent(caseId)}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
      fetch(`/api/admin/providers?caseId=${encodeURIComponent(caseId)}`, {
        headers: { authorization: `Bearer ${token}` },
      }),
    ]);
    if (res.ok) items = (await res.json()).items || [];
    if (pRes.ok) {
      const out = await pRes.json();
      providers = out.items || [];
      advocateContact = { business: '', phone: '', email: '', fax: '', ...(out.contact || {}) };
    }
  } catch { /* the card still says what it does not know */ }

  // LIVE MEANS NOT WITHDRAWN AND NOT EXPIRED. It used to mean only "not
  // withdrawn", which was true when no document carried a real end date.
  // Now they do, and a card that lists an expired authorisation under
  // "Records:" without saying so is the card telling him he may ring a clinic
  // on a permission that ended.
  const live = items.filter((i) => !i.revokedAt && !authorityExpired(i));
  const expired = items.filter((i) => !i.revokedAt && authorityExpired(i));
  const master = live.find((i) => i.kind === 'universal');
  const desig = live.find((i) => i.kind === 'designation');
  const recs = live.filter((i) => i.kind === 'records');
  const rep = live.find((i) => i.kind === 'representative');
  // WHAT GOES IN A PACKET, AND THE RULE IS ABOUT THE AUTHORISATION, NOT ABOUT
  // THE LENGTH OF A LIST.
  //
  // The cover sheet says, in its own words, "within the limits of the
  // authorisation attached to this sheet", "Please send the records covered by
  // the attached authorisation", and "This authorisation is valid to ...".
  // Those sentences are true only when a live records authorisation really is
  // attached.
  //
  // This was `[master, desig].filter(Boolean)` guarded only by `length === 0`.
  // A client who signed both and then withdrew the AUTHORISATION alone left
  // designation live and master revoked: length 1, so the guard never fired,
  // Build packet stayed enabled, and a records request could go out under an
  // authorisation the patient had revoked. Expiry produces the same state
  // twelve months on with nobody doing anything at all.
  //
  // So the guard is the master itself. `live` already excludes withdrawn and
  // expired documents, so `!master` covers every way this fails: never signed,
  // withdrawn, run out.
  const packetDocs = master ? [master, desig].filter(Boolean) : [];
  // WHAT THE STATUS IS DERIVED FROM: the documents themselves, UNFILTERED.
  //
  // effectiveStatus exists to turn EXPIRED and REVOKED into facts about the
  // authorisation rather than opinions about the provider, and it was being
  // handed `live`, which has already removed every withdrawn and expired
  // document. So it could never see one, and its whole derivation was dead
  // from this call site while the suite's own direct calls to it passed.
  const statusDocs = items.filter((i) => i.kind === 'universal' || i.kind === 'designation');
  // WHY there is no packet, in his words, because "nothing is signed yet" was
  // false in two of the three cases and told him to ask for a signature he had
  // already been given.
  const noPacketBecause = master ? ''
    : items.some((i) => i.kind === 'universal' && i.revokedAt)
      ? 'The universal authorisation has been WITHDRAWN by the client, so there is nothing to attach and no packet to build. Do not act on it.'
      : expired.some((i) => i.kind === 'universal')
        ? 'The universal authorisation has EXPIRED, so there is nothing valid to attach. Ask for a fresh signature; the button on their case page now offers one.'
        : recs.length
          ? 'This client is on the old per-clinic authorisations. A packet quotes "the attached authorisation" to whichever office it goes to, so it needs the universal one. Ask them to sign it on their case page.'
          : 'Nothing is signed yet, so a packet would carry no authorisation. Ask for the signature first.';
  const revoked = items.filter((i) => i.revokedAt);
  const days = fullAccessDaysLeft(data);
  // Extensions and holds both stretch the window, so "75 days left in the 60
  // day window" was a sentence this card could print. Name the extra instead.
  const extra = Number(data.fullAccessExtraDays) || 0;
  const paused = !!data.hold?.pausedAt;
  // The same derived checklist the client sees, from the same helper - the
  // two views cannot drift, and this card is where Eric reads "may I begin".
  const ready = handsOffReadiness(data, items);

  host.innerHTML = `
    <div class="panel" style="${ready.ready ? '' : 'border-color:var(--orange); box-shadow:var(--glow-o);'}">
      <h3 style="margin:0 0 .35rem;${ready.ready ? '' : ' color:var(--orange);'}">
        ${ready.ready ? 'Ready: authority to act' : 'Not ready yet'}</h3>
      <p class="dim small" style="margin:0 0 .4rem;">
        ${ready.rows.map((r) => `${r.done ? '✓' : '○'} ${esc(r.label)}`).join('<br>')}</p>
      ${ready.ready ? '' : `<p class="dim small" style="margin:0 0 .5rem;">The
        clock runs from purchase either way. The forms are waiting on their case
        page; a nudge in chat is usually all it takes.</p>`}
      <p class="dim small" style="margin:.1rem 0;">
        Authorisation: ${master
          ? `universal, signed once${masterExpiryText(master)}`
          : recs.length
            ? `${esc(recs.map((r) => r.clinicName || 'clinic').join(', '))} (per clinic, old style)`
            : '<span style="color:var(--orange)">none signed</span>'}</p>
      <p class="dim small" style="margin:.1rem 0;">
        Their one page: ${desig
          ? 'signed'
          : '<span style="color:var(--orange)">not signed</span>'}</p>
      ${master && recs.length ? `<p class="dim small" style="margin:.1rem 0;">
        Narrowed copies: ${esc(recs.map((r) => r.clinicName || 'clinic').join(', '))}.
        The universal one is unaffected.</p>` : ''}
      <p class="dim small" style="margin:.1rem 0;">
        Insurer: ${rep
          ? `${esc(rep.planName || 'plan')}${rep.memberId ? ` · ${esc(rep.memberId)}` : ''}`
          : '<span style="color:var(--orange)">not signed</span>'}</p>
      ${days !== null ? `<p class="dim small" style="margin:.35rem 0 0;">
        ${days} day${days === 1 ? '' : 's'} left in the window${extra ? ` (${FULL_WINDOW_DAYS} + ${extra} bought)` : ''}${paused ? ', paused' : ''}.</p>` : ''}
      ${revoked.length ? `<p class="dim small" style="margin:.35rem 0 0; color:var(--orange);">
        ${revoked.length} withdrawn. Do not act on ${revoked.length === 1 ? 'it' : 'them'}.</p>` : ''}
      ${expired.length ? `<p class="dim small" style="margin:.35rem 0 0; color:var(--orange);">
        ${expired.length} expired. ${expired.length === 1 ? 'It has' : 'They have'} run out and
        ${expired.length === 1 ? 'is' : 'are'} no longer authority to act. Ask for a fresh signature.</p>` : ''}
      ${live.length ? `<p class="row" style="gap:.4rem; flex-wrap:wrap; margin:.5rem 0 0;">
        ${live.map((i) => `<button class="btn ghost tiny" data-auth-print="${esc(i.id)}">
          ${esc(AUTHORITY_KINDS[i.kind]?.title || 'Document')}${i.kind === 'records' && i.clinicName ? `: ${esc(i.clinicName)}` : ''}</button>`).join('')}
      </p>` : ''}
    </div>

    <!-- THE PROVIDER LIST AND WHERE EACH ONE GOT TO (Eric's spec 4).
         Advocate only, and it has to be: REJECTED PRIVACY REVIEW against a
         client's own oncologist is his working note on their care, not
         something they should read on their case page. This whole module is
         admin-*, so the asset gate 404s it to strangers. -->
    <div class="panel" data-providers>
      <h3 style="margin:0 0 .35rem;">Providers, and where each packet got to</h3>
      <p class="dim small" style="margin:0 0 .5rem;">You assemble the packet here
        and send it yourself. Nothing is transmitted from this page.</p>
      ${noPacketBecause ? `<p class="dim small" data-packet-blocked style="margin:0 0 .5rem; color:var(--orange);">
        ${esc(noPacketBecause)}</p>` : ''}
      ${!noPacketBecause && !data.clientDob ? `<p class="dim small" data-packet-nodob style="margin:0 0 .5rem; color:var(--orange);">
        No date of birth on this case. The cover sheet and both signed
        documents print a blank line where a records clerk matches the patient,
        and nothing ever asks the client for it. Get it before you send
        anything.</p>` : ''}
      ${providers.length ? providers.map((p) => {
    const st = effectiveStatus(p, statusDocs);
    return `
        <div class="auth-item" style="display:block; padding:.4rem 0; border-top:1px solid var(--line);">
          <strong>${esc(p.name)}</strong>
          <span class="dim small">${p.phone ? ` · ${esc(p.phone)}` : ''}${p.fax ? ` · fax ${esc(p.fax)}` : ''}</span><br>
          <label class="dim small" style="display:inline-block; margin:.25rem .5rem .25rem 0;">Status
            <select data-provider-status="${esc(p.id)}">
              ${PROVIDER_STATUSES.map((s) => `<option value="${esc(s.id)}"${s.id === st ? ' selected' : ''}>${esc(s.label)}</option>`).join('')}
            </select></label>
          <label class="dim small" style="display:inline-block; margin:.25rem .5rem .25rem 0;">Asking for
            <select data-provider-request="${esc(p.id)}">
              ${PROVIDER_REQUESTS.map((r) => `<option value="${esc(r.id)}"${r.id === (p.requestKind || 'records') ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}
            </select></label>
          <span class="auth-item-acts">
            <!-- REFUSED, not merely warned about. The orange line above was
                 the only thing standing between a revoked authorisation and a
                 cover sheet that says one is attached, and a line of text does
                 not stop a tap. -->
            <button type="button" class="btn ghost tiny" data-provider-packet="${esc(p.id)}"${
  packetDocs.length ? '' : ' disabled aria-disabled="true" title="No live authorisation to attach"'}>Build packet</button>
            <button type="button" class="btn ghost tiny" data-provider-remove="${esc(p.id)}">Remove</button>
          </span>
        </div>`;
  }).join('') : '<p class="dim small" style="margin:0 0 .5rem;">No providers on the list yet.</p>'}
      <p class="row" style="gap:.4rem; flex-wrap:wrap; margin:.6rem 0 0;">
        <input type="text" data-provider-name placeholder="Add a provider" maxlength="200" style="flex:1; min-width:11rem;">
        <button class="btn ghost tiny" data-provider-add>Add</button>
      </p>
      <details style="margin:.6rem 0 0;">
        <summary class="dim small">Your contact block, as it prints on the cover sheet</summary>
        <label class="dim small" style="display:block;">Business
          <input type="text" data-contact="business" maxlength="120" value="${esc(advocateContact.business || '')}" style="width:100%;"></label>
        <label class="dim small" style="display:block;">Phone
          <input type="tel" data-contact="phone" maxlength="40" value="${esc(advocateContact.phone || '')}" style="width:100%;"></label>
        <label class="dim small" style="display:block;">Secure email
          <input type="email" data-contact="email" maxlength="160" value="${esc(advocateContact.email || '')}" style="width:100%;"></label>
        <label class="dim small" style="display:block;">Fax
          <input type="tel" data-contact="fax" maxlength="40" value="${esc(advocateContact.fax || '')}" style="width:100%;"></label>
        <p class="dim small" style="margin:.3rem 0 0;">Anything left blank prints
          as a line to write on, never as a guess. A wrong fax number here sends
          a chart to a stranger.</p>
        <button class="btn ghost tiny" data-contact-save style="margin-top:.4rem;">Save</button>
      </details>
      <p class="error" data-provider-error hidden style="margin:.4rem 0 0;"></p>
    </div>`;

  wireProviders(host, pane, providers, packetDocs);

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
 * How long the master has left, on the card where he decides whether to ring
 * somebody. A date, not a tick: "signed" was true of an authorisation that
 * expired in March.
 */
function masterExpiryText(item) {
  // Through the shared helper, so a legacy document with no stored expiry
  // shows the date its own printed text has always implied rather than
  // showing nothing at all on the card where he decides whether to ring.
  const at = authorityEndsAt(item);
  if (!at) return '';
  return `, runs to ${at.toLocaleDateString()}`;
}

/**
 * The provider list's controls.
 *
 * OPTIMISTIC NOTHING. Every control posts and then repaints from the server,
 * rather than moving the row and posting behind it. A status that shows
 * ACCEPTED / ON CHART because the select moved, while the write failed, is
 * this panel lying to him about whether he may ring a clinic.
 */
function wireProviders(host, pane, providers, packetDocs) {
  const errEl = host.querySelector('[data-provider-error]');
  const say = (msg) => {
    if (!errEl) return;
    errEl.textContent = msg;
    errEl.hidden = !msg;
  };
  const post = async (body) => {
    const token = await user.getIdToken();
    const res = await fetch('/api/admin/providers', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ caseId, ...body }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Failed (${res.status})`);
    return res.json().catch(() => ({}));
  };
  const again = () => paintAuthorityStatus(pane);

  host.querySelector('[data-provider-add]')?.addEventListener('click', async () => {
    const input = host.querySelector('[data-provider-name]');
    const name = input?.value.trim();
    if (!name) { say('Name the provider first.'); return; }
    say('');
    try { await post({ action: 'add', name }); again(); } catch (e) { say(e.message); }
  });

  for (const sel of host.querySelectorAll('[data-provider-status]')) {
    sel.addEventListener('change', async () => {
      say('');
      try {
        await post({ action: 'update', id: sel.dataset.providerStatus, status: sel.value });
        again();
      } catch (e) { say(e.message); again(); }
    });
  }
  for (const sel of host.querySelectorAll('[data-provider-request]')) {
    sel.addEventListener('change', async () => {
      say('');
      try {
        await post({ action: 'update', id: sel.dataset.providerRequest, requestKind: sel.value });
        again();
      } catch (e) { say(e.message); again(); }
    });
  }
  for (const b of host.querySelectorAll('[data-provider-remove]')) {
    b.addEventListener('click', async () => {
      if (!confirm('Remove this provider from the list? The packet you already sent them is unaffected.')) return;
      say('');
      try { await post({ action: 'remove', id: b.dataset.providerRemove }); again(); } catch (e) { say(e.message); }
    });
  }

  host.querySelector('[data-contact-save]')?.addEventListener('click', async () => {
    say('');
    const v = (f) => host.querySelector(`[data-contact="${f}"]`)?.value.trim() || '';
    try {
      await post({
        action: 'contact', business: v('business'), phone: v('phone'),
        email: v('email'), fax: v('fax'),
      });
      again();
    } catch (e) { say(e.message); }
  });

  for (const b of host.querySelectorAll('[data-provider-packet]')) {
    b.addEventListener('click', async () => {
      const p = providers.find((x) => x.id === b.dataset.providerPacket);
      if (!p) return;
      // THE GUARD, not the styling. The button is disabled when there is no
      // live master, and this is the half that holds if it is ever re-enabled
      // by a repaint, a browser restoring a form, or devtools. Refusing to
      // build beats building a cover sheet whose own words claim an
      // authorisation that is not attached.
      if (!packetDocs.length) {
        say('No live authorisation to attach, so there is no packet to build. '
          + 'The cover sheet would say one is attached and none would be.');
        return;
      }
      say('');
      // THE INK, FETCHED BEFORE THE WINDOW OPENS. The list GET omits the
      // signature blobs, so a packet built straight from `packetDocs` would
      // print the authorisation with an empty signature block: the exact
      // defect the single-document path already had once, arriving again
      // through a new caller. Each document is asked for by id.
      let docs = packetDocs;
      try {
        const token = await user.getIdToken();
        docs = await Promise.all(packetDocs.map(async (d) => {
          if (!d.hasSignature || d.signatureImage) return d;
          const res = await fetch(
            `/api/authority?caseId=${encodeURIComponent(caseId)}&id=${encodeURIComponent(d.id)}`,
            { headers: { authorization: `Bearer ${token}` } },
          );
          if (!res.ok) return d;
          const found = ((await res.json()).items || []).find((i) => i.id === d.id);
          return found?.signatureImage ? found : d;
        }));
      } catch {
        // It still builds, because a packet without the mark beats no packet
        // when he is stood at a desk. It says so rather than failing quietly.
        alert('Building the packet without the signature: it could not be fetched just now.\n\n'
          + 'The signature is still on file. Try again in a moment if the clinic needs it on the page.');
      }
      printProviderPacket(p, docs);
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
  // The agreed length wins when there is one, exactly as in the Worker.
  const agreed = Number(c.fullAccessDays);
  const base = agreed > 0 ? agreed
    : (bought && bought >= FULL_MONTHLY_FROM_AT ? FULL_WINDOW_DAYS : FULL_LEGACY_WINDOW_DAYS);
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

function printAuthorityDoc(item) {
  const o = {
    ...item,
    clientName: data.clientName, clientDob: data.clientDob, advocateName: 'Eric Bleach',
    advocateBusiness: advocateContact.business, advocatePhone: advocateContact.phone,
    advocateEmail: advocateContact.email, advocateFax: advocateContact.fax,
  };
  // The STRUCTURE, not the finished text. The window renders it; this file never
  // touches the words, which is why the same document can be a printed page
  // here and a preview on the client's phone without two copies of the words.
  //
  // A LOOKUP, NOT A TERNARY. It was `kind === 'records' ? A : B`, which with
  // four kinds means every kind that is not `records` prints as the insurance
  // designation: a patient designation of advocate would have come out of the
  // printer as an appointment of authorised representative, with the
  // patient's real signature under it, at a clinic desk.
  openAuthorityDocument({
    model: authorityModelFor(item, o),
    title: AUTHORITY_KINDS[item.kind]?.title || 'Document',
    signatureHtml: signatureInk(item),
  });
}

/**
 * The provider packet, as paper.
 *
 * ASSEMBLED HERE, SENT BY HIM. This opens a window with a cover sheet and the
 * signed documents behind it, and stops. Nothing is transmitted: the app does
 * not email a client's health information to a clinic, which was settled and
 * is not a limitation to be worked around later.
 *
 * The signed documents are appended after the cover sheet in the same window,
 * so what comes out of the printer is the packet in the order a records clerk
 * reads it: cover sheet, then the authorisation it refers to, then the page
 * they are asked to put on the chart.
 */
function printProviderPacket(provider, docs) {
  const model = providerPacketModel({
    patient: { name: data.clientName, dob: data.clientDob },
    advocate: { name: 'Eric Bleach', ...advocateContact },
    provider,
    request: { kind: provider.requestKind, note: provider.requestNote },
    docs,
  });
  // Each document keeps its own ink. signatureInk re-checks the data URL
  // before it is written into a document, the same as the single-document
  // path, so a malformed blob never reaches the page.
  const tail = docs.map((d) => {
    const o = {
      ...d,
      clientName: data.clientName, clientDob: data.clientDob, advocateName: 'Eric Bleach',
      advocateBusiness: advocateContact.business, advocatePhone: advocateContact.phone,
      advocateEmail: advocateContact.email, advocateFax: advocateContact.fax,
    };
    return `<hr>${authorityHtml(authorityModelFor(d, o))}${signatureInk(d)}`;
  }).join('\n');
  openAuthorityDocument({
    model,
    title: `Packet for ${provider.name || 'provider'}`,
    signatureHtml: tail,
  });
}

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
 * Clinic calls. Their own private record rather than a value on the
 * appointment: `appointment.method` is a two-value enum that gates checkout,
 * and everything on `appointment` is client-readable, so a clinic's direct
 * line would be on the client's own case doc. What the client sees is a
 * summary line; the number stays here.
 *
 * No audio recording. The recording consent covers Eric's calls with his
 * client, not a third party, and two-party-consent states make recording a
 * clinic without asking a legal trap. The artifact is the written note.
 */
let callsKey = null;
function paintClinicCalls(pane) {
  const load = async () => {
    let items = [];
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/clinic-calls?caseId=${encodeURIComponent(caseId)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.ok) items = (await res.json()).items || [];
    } catch { /* an unreachable list still offers the form */ }
    const key = JSON.stringify(items);
    if (key === callsKey && pane.querySelector('[data-calls-root]')) return;
    callsKey = key;

    pane.innerHTML = `
      <div class="panel" data-calls-root>
        <h3 style="margin:0 0 .3rem;">📞 Clinic calls</h3>
        <p class="dim small" style="margin:0 0 .6rem;">Three are included. Notes
          only, never a recording: your recording consent covers your calls with
          your client, not a clinic on the other end of the line.</p>
        <p class="dim small" style="margin:0 0 .6rem;">${items.length} of 3 used.</p>
        ${items.map((i) => `
          <details class="faq" data-k="call-${esc(i.id)}">
            <summary>${esc(i.clinic || 'Clinic')} · ${i.at ? new Date(i.at).toLocaleDateString() : 'unscheduled'}</summary>
            <div class="faq-a">
              ${i.phone ? `<p class="dim small">${esc(i.phone)}</p>` : ''}
              <textarea class="notes-root" data-call-notes="${esc(i.id)}" rows="6"
                placeholder="What was said, what was agreed, who owes what by when.">${esc(i.notes || '')}</textarea>
              <p><button class="btn quiet tiny" data-call-save="${esc(i.id)}">Save notes</button></p>
            </div>
          </details>`).join('')}
        <details class="faq" data-k="call-new">
          <summary>Log another call</summary>
          <div class="faq-a">
            <label class="dim small">Clinic
              <input type="text" data-c="clinic"></label>
            <div class="row" style="gap:.5rem; flex-wrap:wrap;">
              <label class="dim small" style="flex:1 1 8rem;">Their number
                <input type="tel" data-c="phone"></label>
              <label class="dim small" style="flex:1 1 8rem;">When
                <input type="datetime-local" data-c="at"></label>
            </div>
            <label class="dim small">Who is on it
              <input type="text" data-c="parties" placeholder="e.g. me, the client, records clerk"></label>
            <p><button class="btn" data-call-add>Add it</button></p>
          </div>
        </details>
        <p class="error" data-calls-err hidden></p>
      </div>`;

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
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
        if (btn) btn.disabled = false;
      }
    };

    pane.querySelector('[data-call-add]')?.addEventListener('click', (e) => {
      const g = (n) => pane.querySelector(`[data-c="${n}"]`)?.value.trim() || '';
      if (!g('clinic')) { alert('Name the clinic first.'); return; }
      post({ action: 'add', clinic: g('clinic'), phone: g('phone'), at: g('at'), parties: g('parties') }, e.currentTarget);
    });
    for (const b of pane.querySelectorAll('[data-call-save]')) {
      b.addEventListener('click', (e) => post({
        action: 'notes', id: b.dataset.callSave,
        notes: pane.querySelector(`[data-call-notes="${b.dataset.callSave}"]`)?.value || '',
      }, e.currentTarget));
    }
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
            name: r.name,
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
