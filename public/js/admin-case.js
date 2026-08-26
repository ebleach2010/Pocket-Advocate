// Admin case workspace: the case folder. Everything the client sees, plus the
// levers, rehoused into flip pages: Overview, Chat, Advisor, Differential,
// Files, Notes, Drafts. Chat and advisor mount ONCE per case; refresh paths
// only repaint the Overview and Files contents in place, so the chat's live
// onSnapshot and the advisor's poll survive every action on this page.

import './admin-ledger.js';
import {
  db, storage, doc, getDoc, collection, getDocs, query, where,
  ref, uploadBytesResumable, listAll, getDownloadURL, getMetadata,
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

const MOUNTAIN_TZ = 'Etc/GMT+7';
// Keep in sync with CASE_PRICE_CENTS in worker/index.js — the custom-rate
// percentages below are a share of the standard Advocacy Case fee.
const CASE_PRICE_CENTS = 26500;

/**
 * The rate a given client booked at. Recorded on the case at checkout, so a
 * percentage charge later is a share of what they actually paid rather than of
 * whatever the rate has moved to since (Eric: "current client gets
 * grandfathered in", 2026-08-20). Cases from before the field existed fall back
 * to today's rate, which since rates have only come down errs in their favour.
 */
const caseRate = (c) => (c && c.caseRateCents) || CASE_PRICE_CENTS;
const dollars = (cents) => (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100));
const caseId = new URLSearchParams(location.search).get('id');
// Sentinel value for "a time that isn't on the calendar" in the slot dropdown.
const CUSTOM = '__custom__';
const CUSTOM_OPTION = `<option value="${CUSTOM}">A time not on the calendar…</option>`;

hydrateNav();
const user = await requireAdmin();
if (user && caseId) load();

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
}

function render(el) {
  const c = data;

  el.innerHTML = `
    <div class="case-head">
      <div class="row">
        <h1 style="margin:0;" data-client>${esc(c.clientName || c.clientEmail || c.clientUid)}</h1>
        <span class="status-pill" data-status>${(c.status || '?').replace('_', ' ').toUpperCase()}</span>
      </div>
      <p class="dim small working-line" data-working hidden style="margin:.2rem 0 0;"></p>
    </div>
    <div data-folder></div>`;

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
    groups: [
      { id: 'case', label: 'Case', icon: '📁', pages: ['overview', 'chat', 'files'] },
      { id: 'read', label: 'Advisor', icon: '👨‍⚕️', pages: ['advisor', 'dx', 'advisor-chat', 'education'] },
      { id: 'track', label: 'Track', icon: '🗒', pages: ['summary', 'unanswered', 'agenda', 'about'] },
      { id: 'mine', label: 'Mine', icon: '🔒', pages: ['notes', 'drafts', 'saved'] },
    ],
    // Landing on a page IS having seen it. The badge clears here rather than
    // on some later save, so it never outlives the thing it was pointing at.
    onShow: (id) => { markSeen(caseId, id); folder?.mark(id, false); },
    pages: [
      {
        id: 'overview', title: 'Overview', icon: '⚡',
        render: (pane) => paintOverview(pane),
      },
      {
        id: 'chat', title: 'Chat', icon: '💬', fade: true,
        render: (pane) => {
          pane.innerHTML = `
            <div class="panel">
              <!-- Eric, 2026-08-25: the statuses "should sit to the right of
                   'chat with client' as a dropdown so I can have it be the
                   status of what I'm working on." Before this they were
                   reachable only by long-pressing an individual message,
                   which frames a standing state as a reply to one message. -->
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
                <button class="btn quiet work-total-btn" data-work-total
                  style="flex:none;" title="Tap to add or subtract time"></button>
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
        id: 'advisor-chat', title: 'Chat', icon: '💬',
        render: (pane) => { pane.innerHTML = '<div id="advisor-chat"></div>'; },
      },
      {
        // The page id stays 'files' so a remembered tab still resolves; the
        // page itself is now everything shared on the case, from either side.
        id: 'files', title: 'Uploads', icon: '📎',
        render: (pane) => paintFiles(pane),
      },
      {
        id: 'education', title: 'Education', icon: '📚',
        // Painted from the advisor's state poll, same as the differential.
        render: (pane) => { pane.innerHTML = '<p class="dim">Loading…</p>'; },
      },
      {
        id: 'about', title: 'About you', icon: '🪞',
        render: (pane) => { pane.innerHTML = '<p class="dim">Loading…</p>'; },
      },
      {
        // fade, and so opted out of tap-to-flip: on the notes sheet a tap has
        // to place the cursor, never turn the page.
        id: 'notes', title: 'Notes', icon: '📝', fade: true,
        render: (pane) => {
          // Private to Eric: stored under `private/`, which is browser-denied
          // in both directions, so it only ever moves through the admin-gated
          // Worker route. The saved html arrives with the advisor state poll
          // and lands via setHtml, which refuses to clobber live typing.
          notes = mountNotes({
            container: pane,
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
        // One day of the thread, read back to him. His side only: he took this
        // off the client's side deliberately.
        id: 'summary', title: 'Summary', icon: '🗒',
        render: (pane) => paintSummary(pane),
      },
      {
        // What he asked the client for and never got. Painted from the poll.
        id: 'unanswered', title: 'Unanswered', icon: '⚠️',
        render: (pane) => { pane.innerHTML = '<p class="dim">Loading…</p>'; },
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
        // His bookmarks on this thread, each with a note. Private by path: a
        // client cannot read them, and nothing is written back to the message,
        // so saving one tells them nothing.
        id: 'saved', title: 'Saved', icon: '🔖',
        render: (pane) => {
          mountSaved({ container: pane, kind: 'case', id: caseId, user, myRole: 'admin' });
        },
      },
      {
        id: 'drafts', title: 'Drafts', icon: '✍️',
        // Today's draft panel, relocated. The advisor renders into it and
        // owns its heading and its hidden state.
        render: (pane) => {
          pane.innerHTML = [
            '<div class="panel draft-panel advisor-draft" id="draft-panel" hidden></div>',
            '<div class="panel">',
            '  <h3>Before a call</h3>',
            '  <p class="dim small">Nothing here decides anything for you.</p>',
            '  <button class="btn" data-prep-sheet>🎬 Video prep sheet</button>',
            '</div>',
            '<div class="panel">',
            '  <h3>Duty of care</h3>',
            '  <p class="dim small">A draft you can edit before it goes anywhere. Also on the',
            '    composer in Chat, so it is one tap away when you want it.</p>',
            '  <button class="btn" data-duty>⚕️ Draft it</button>',
            '</div>',
          ].join('');
          // Always present, never suggested. It says nothing about this client
          // and looks identical on every case; Eric decides when he is
          // obligated, and this only saves him writing the same thing under
          // pressure at the moment he is least able to.
          // Built from the advisor's own sections rather than a fresh model
          // call: that read already exists and is already the one he trusts,
          // and asking twice would produce a second version to reconcile.
          pane.querySelector('[data-prep-sheet]').addEventListener('click', () => {
            const c = data;
            const start = c.appointment?.start ? toDate(c.appointment.start) : null;
            openPrepSheet({
              name: c.clientName || c.clientEmail || 'Call prep',
              when: start
                ? new Intl.DateTimeFormat('en-US', {
                  timeZone: MOUNTAIN_TZ, weekday: 'long', month: 'long', day: 'numeric',
                  hour: 'numeric', minute: '2-digit',
                }).format(start) + ' MST'
                : '',
              analysis: lastAnalysis,
              differential: lastDifferential,
            });
          });
          pane.querySelector('[data-duty]').addEventListener('click', () => openDutyDraft({
            tz: data.clientTz || '',
            onSend: (text) => chatSend?.(text),
          }));
        },
      },
    ],
  });

  // Built from STATUS_REACTIONS so the dropdown cannot drift from the
  // long-press menu or from the Worker's wording.
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
  // The key alone is not enough: paintOverview rebuilds this pane's innerHTML
  // first, so the host comes back empty while the key still matches and the
  // early return left "Loading..." on screen permanently. paintAppeals and
  // paintClinicCalls already check the host survived; this one did not.
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
 * The work clock. He toggles it on when he starts on a case and off when he
 * stops, and the client sees the total on their own page (Eric, 2026-08-22:
 * "the cost is a toggle per client... They can see this"). Manual on
 * purpose: the automatic meter it replaces only ever saw minutes the chat
 * page was open, which is the smallest part of the work.
 */
let workTick = null;
function startWorkClock(c) {
  const row = document.querySelector('[data-workclock]');
  if (!row) return;
  const btn = row.querySelector('[data-work-toggle]');
  const totalEl = row.querySelector('[data-work-total]');
  const w = c?.work || {};
  let seconds = Math.max(0, Number(w.seconds) || 0);
  let startedAt = w.startedAt ? toDate(w.startedAt).getTime() : 0;

  // Clamped the way the Worker banks it: a stretch forgotten over a weekend
  // banks at most twelve hours, so the page and the bank agree on one number.
  const live = () => Math.max(0, seconds
    + (startedAt ? Math.min(Math.floor((Date.now() - startedAt) / 1000), 12 * 3600) : 0));
  const paint = () => {
    const t = live();
    totalEl.textContent = `${fmtHm(t)} on this case${startedAt ? ' · running' : ''}`;
    totalEl.classList.toggle('on', !!startedAt);
    btn.textContent = startedAt ? '⏸ Stop working' : '▶ Start working';
    btn.classList.toggle('glow', !!startedAt);
  };
  paint();
  clearInterval(workTick);
  // A minute is plenty: this is hours, not a stopwatch.
  workTick = setInterval(() => { if (startedAt) paint(); }, 30_000);

  btn.addEventListener('click', async () => {
    const want = !startedAt;
    btn.disabled = true;
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/work', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ caseId, on: want }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
      seconds = Number(out.seconds) || 0;
      startedAt = out.running ? Date.now() : 0;
      paint();
    } catch (err) {
      alert(`Couldn't change the clock: ${err.message}`);
    }
    btn.disabled = false;
  });

  // ---- correcting the total ----
  //
  // Eric, 2026-08-25: "I should be able to tap on the time and subtract time
  // or add time (hours + minutes with the iOS scroll wheel widget)."
  //
  // So the TIME ITSELF is the control, and the amount is picked rather than
  // typed. Two <select>s, because on iOS that is precisely the native wheel
  // he means: a text box asking for "10h 0m" is the wrong shape on a phone
  // and makes him do arithmetic while annoyed.
  //
  // He picks an AMOUNT and a direction, which is how the mistake actually
  // presents ("that ran about ten hours too long"). The page does the
  // arithmetic and sends the finished total, so the Worker takes one absolute
  // number and a retry on a flaky connection cannot subtract it twice.
  totalEl.addEventListener('click', () => {
    if (document.getElementById('pa-clock-fix')) return;
    const now = live();
    const opts = (n) => Array.from({ length: n }, (_, i) =>
      `<option value="${i}"${i === 0 ? ' selected' : ''}>${i}</option>`).join('');

    const overlay = document.createElement('div');
    overlay.id = 'pa-clock-fix';
    overlay.className = 'settings-overlay';
    overlay.innerHTML = `
      <div class="settings-card" role="dialog" aria-modal="true" aria-label="Fix the clock">
        <div class="row"><h3 style="margin:0;">⏱ Fix the clock</h3>
          <button class="btn quiet" data-x style="margin-left:auto;">Cancel</button></div>
        <p class="dim small" style="margin:.2rem 0 .8rem;">This case reads
          <strong style="color:var(--ink)">${fmtHm(now)}</strong>.
          Your client can see this number, so the change is written onto the case.</p>
        <div class="row" style="gap:.5rem; align-items:flex-end;">
          <label class="dim small" style="flex:1;">Hours
            <select data-h style="width:100%;">${opts(25)}</select></label>
          <label class="dim small" style="flex:1;">Minutes
            <select data-m style="width:100%;">${opts(60)}</select></label>
        </div>
        <p class="dim small" style="margin:.7rem 0 .2rem;">New total:
          <strong style="color:var(--ink)" data-preview>${fmtHm(now)}</strong></p>
        <p class="error small" data-err style="margin:.4rem 0 0;" hidden></p>
        <div class="row" style="gap:.5rem; margin-top:.6rem;">
          <button class="btn" data-sub style="flex:1;">− Subtract</button>
          <button class="btn" data-add style="flex:1;">+ Add</button>
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
    // focusing one shows what it would do before he commits to it.
    let sign = -1;
    const repaint = () => {
      preview.textContent = fmtHm(Math.max(0, live() + (sign * picked())));
      err.hidden = true;
    };
    for (const el of overlay.querySelectorAll('select')) el.addEventListener('change', repaint);
    for (const [sel, s] of [['[data-sub]', -1], ['[data-add]', 1]]) {
      const b = overlay.querySelector(sel);
      b.addEventListener('pointerenter', () => { sign = s; repaint(); });
      b.addEventListener('focus', () => { sign = s; repaint(); });
    }

    const apply = async (direction, button) => {
      const amount = picked();
      if (!amount) {
        err.textContent = 'Pick an amount first.';
        err.hidden = false;
        return;
      }
      const from = live();
      const next = from + (direction * amount);
      if (next < 0) {
        err.textContent = `That is more than the ${fmtHm(from)} on the clock. `
          + 'Subtract that much or less, or take it to zero.';
        err.hidden = false;
        return;
      }
      button.disabled = true;
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/work', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ caseId, setSeconds: next }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
        seconds = Number(out.seconds) || 0;
        // The Worker re-anchors a running clock to the moment of the
        // correction, so the stretch already inside the number he sent is not
        // counted a second time. Match that here or the next repaint adds it
        // straight back.
        startedAt = out.running ? Date.now() : 0;
        paint();
        close();
      } catch (e2) {
        err.textContent = e2.message || 'That did not save. Try again.';
        err.hidden = false;
        button.disabled = false;
      }
    };
    overlay.querySelector('[data-sub]').addEventListener('click', (e) => apply(-1, e.currentTarget));
    overlay.querySelector('[data-add]').addEventListener('click', (e) => apply(1, e.currentTarget));

    document.body.appendChild(overlay);
    overlay.querySelector('[data-h]').focus();
  });
}

/** Seconds as "10h 40m", the one shape the clock is written in. */
function fmtHm(sec) {
  const t = Math.max(0, Math.floor(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${h ? `${h}h ` : ''}${m}m`;
}

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
             This list is rebuilt each time the advisor reads the thread; if you have asked for things since, run an Update on the Advisor tab and check back.</p>`
          : `<p class="dim small">No completed read yet, so there is nothing to show. Run an Update on the Advisor tab; this list is built from it.</p>`}
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
      <h3>📚 Education</h3>
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
document.addEventListener('pa-panel-state', (e) => {
  const d = e.detail || {};
  if (d.id && d.id !== caseId) return;

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
 * The Overview page: the info bar, the booking-request panel when one is
 * waiting, then the management levers folded into tight rows.
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

  pane.innerHTML = `
    ${infoBar(c, mtFmt, start, due)}
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

    <details class="mgmt" data-k="sched">
      <summary>📅 Schedule a session</summary>
      <div class="mgmt-body">
        <p class="dim small">Book this client at any time at all — pick an open slot, or type a time that isn't on the calendar. Lead time, booking horizon and business hours don't apply to you.</p>
        <select id="sched-slot"><option value="">Loading open slots…</option></select>
        <div id="sched-custom" style="margin-top:.5rem;" hidden>
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
          <label class="small" style="display:block;"><input type="radio" name="sched-mode" value="charge">
            Charge for a session:</label>
          <div id="sched-charge" style="margin:.35rem 0 0 1.4rem;" hidden>
            <select id="sched-pct">
              ${[0, 25, 50, 75, 100, 125, 150].map((p) =>
                `<option value="${p}" ${p === 50 ? 'selected' : ''}>${p}% — ${p === 0 ? 'no charge' : '$' + dollars((p * caseRate(c)) / 100)}</option>`).join('')}
            </select>
            <input type="text" id="sched-tag" maxlength="120" placeholder="Invoice line (optional) — e.g. Records deep-dive session" style="margin-top:.35rem;">
            <p class="dim small" style="margin:.3rem 0 0;">A share of <strong>$${dollars(caseRate(c))}</strong>, the rate this client booked at. They pay through Stripe to confirm; the slot holds for 24 hours. Your tagline is the line item on their receipt.</p>
          </div>
        </div>
        <p class="error" id="sched-err" hidden></p>
        <div id="sched-result" class="dim small" style="margin-top:.4rem;"></div>
        <div class="actions"><button class="btn secondary" id="sched-go">Schedule</button></div>
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
      </div>
    </details>

    <details class="mgmt" data-k="miles">
      <summary>✓ Milestones</summary>
      <div class="mgmt-body">
        <div class="actions" style="margin-top:.3rem;">
          <button class="btn secondary" data-action="recording-uploaded">Call done — start 7-day report clock</button>
          <button class="btn secondary" data-action="report-uploaded">Report delivered</button>
          ${c.status === 'closed' ? '<span class="dim small">Case closed.</span>' : ''}
        </div>
        <p class="dim small" style="margin-top:.6rem;">Uploading a recording or report triggers its milestone automatically; the buttons cover manual corrections.</p>
      </div>
    </details>

    <details class="mgmt" data-k="review">
      <summary>⭐ Their review</summary>
      <div class="mgmt-body" data-case-review>
        <p class="dim small">Loading…</p>
      </div>
    </details>

    ${c.status !== 'closed' ? `
    <details class="mgmt" data-k="close">
      <summary>⛔ Close case</summary>
      <div class="mgmt-body">
        <button class="btn danger" data-action="close">Close case</button>
      </div>
    </details>` : ''}`;

  paintCaseReview(pane);
  pane.querySelector('#save-link').addEventListener('click', saveLink);
  wireScheduler(pane);
  pane.querySelectorAll('[data-action]').forEach((b) =>
    b.addEventListener('click', () => milestone(b.dataset.action, b)));
}

/** Repaint Overview in place, keeping whichever rows Eric had open. */
function refreshOverview() {
  const pane = folder?.el('overview');
  if (!pane) return;
  const open = new Set(
    [...pane.querySelectorAll('details[data-k][open]')].map((d) => d.dataset.k));
  paintOverview(pane);
  open.forEach((k) => {
    const d = pane.querySelector(`details[data-k="${k}"]`);
    if (d) d.open = true;
  });
}

/** The Uploads page shell. Painted once; refreshFiles fills the list. */
function paintFiles(pane) {
  pane.innerHTML = `
    <div class="panel">
      <h3>📎 Uploads</h3>
      <p class="dim small">Everything shared on this case, newest day first. Tap 👨‍⚕️ on a file to stage it, then Analyze in the advisor.</p>
      <div class="uploads" id="files"><p class="dim small">Loading…</p></div>
      <label class="small" style="margin-top:.7rem;">Upload the recording
        <input type="file" id="up-recording" accept="video/*,audio/*,.mp4,.m4a,.mp3,.mkv,.webm">
      </label>
      <label class="small" style="margin-top:.5rem;">Upload the report <span class="dim">(advances the case + pings the client)</span>
        <input type="file" id="up-report" accept=".pdf,.html,.md,.doc,.docx,.jpg,.jpeg,.png,.heic">
      </label>
      <progress id="bar" max="100" value="0" hidden></progress>
      <p class="error" id="err" hidden></p>
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

async function saveLink() {
  const value = document.getElementById('joinlink').value.trim();
  try {
    await api({ action: 'join-link', joinLink: value });
    load();
  } catch (err) { alert(err.message); }
}

async function milestone(action, btn) {
  if (action === 'close' && !confirm('Close this case? The client keeps the file forever; chat ends (Phase 3).')) return;
  btn.disabled = true;
  try {
    await api({ action });
    load();
  } catch (err) {
    btn.disabled = false;
    alert(err.message);
  }
}

async function upload(file, kind, milestoneAction) {
  if (!file) return;
  const bar = document.getElementById('bar');
  const err = document.getElementById('err');
  err.hidden = true;
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

async function refreshFiles() {
  const listEl = document.getElementById('files');
  if (!listEl) return;
  const rows = [];
  for (const [kind, path] of [
    ['report', `cases/${caseId}/report`],
    ['recording', `cases/${caseId}/recording`],
    ['upload', `cases/${caseId}/uploads`],
    // Files shared in the chat, which until now appeared nowhere in this list
    // at all - the second half of the same blind spot that lost Eric's
    // documents. They live under the case, so they belong on the case's page.
    ['chat', `cases/${caseId}/chat-files`],
    ['saved', `profiles/${data.clientUid}/saved`],
  ]) {
    try {
      const res = await listAll(ref(storage, path));
      for (const item of res.items) {
        const [url, meta] = await Promise.all([getDownloadURL(item), getMetadata(item)]);
        rows.push({
          kind, name: item.name, url, ts: new Date(meta.timeCreated),
          size: meta.size, contentType: meta.contentType || '', path: item.fullPath,
        });
      }
    } catch { /* empty */ }
  }
  if (!rows.length) {
    listEl.innerHTML = '<p class="dim small">No files yet.</p>';
    return;
  }
  // Images and PDFs can go straight to the advisor for a real read. "Saved"
  // copies are the client's own profile shelf, outside the advisor's fence.
  const reviewable = (r) => {
    const ct = (r.contentType || '').toLowerCase();
    return r.kind !== 'saved' && !/heic|heif/.test(ct) &&
      (ct.startsWith('image/') || ct === 'application/pdf' || /\.pdf$/i.test(r.name));
  };
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
        ? `<button class="btn quiet file-review" data-review="${i}" title="Select for the advisor to read, then press Analyze in the advisor panel">👨‍⚕️</button>`
        : ''}
    </li>`;
  };

  listEl.innerHTML = [...days.values()].map((day) => `
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
  // The SAME base the Worker enforces (followUpBase in worker/index.js): the
  // purchase date when there is one, the call otherwise. This screen counted
  // from the appointment alone, and a follow-up is ALWAYS bought after the
  // call - so it expired early on every case, disabling the booking radio and
  // telling Eric to honour it by hand, while the client's own page correctly
  // said the session was live. The Worker fixed this in the 2026-08-21 audit;
  // this copy was missed.
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
  const row = (label, value, color) => rows.push(`
    <span style="font:600 .62rem/1.7 ui-monospace,monospace; letter-spacing:.13em; color:var(--dim); white-space:nowrap;">${label}</span>
    <span class="small" style="color:${color || 'var(--ink)'}; font-weight:600; min-width:0; overflow-wrap:anywhere;">${value}</span>`);

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
  if (c.needsReschedule) row('ALERT', 'NEEDS RESCHEDULE', 'var(--danger)');

  return `<div class="panel" style="display:grid; grid-template-columns:max-content 1fr;
    column-gap:1.1rem; row-gap:.5rem; align-items:baseline;
    margin:.7rem 0 1rem; padding:.85rem 1rem;">${rows.join('')}</div>`;
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
    slotSel.innerHTML = slots.length
      ? slots.map((s) => `<option value="${s.id}">${mtFmt.format(s.start)} MST</option>`).join('') + CUSTOM_OPTION
      : CUSTOM_OPTION;
  } catch (err) {
    slotSel.innerHTML = CUSTOM_OPTION;
    console.warn("couldn't load open slots:", err.message);
  }

  const customBox = el.querySelector('#sched-custom');
  const whenInput = el.querySelector('#sched-when');
  const syncCustom = () => { customBox.hidden = slotSel.value !== CUSTOM; };
  slotSel.addEventListener('change', syncCustom);
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
          tagline: mode === 'charge' ? el.querySelector('#sched-tag').value : undefined,
        }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
      if (out.checkoutUrl) {
        resultEl.innerHTML = `Scheduled pending payment ($${(out.amountCents / 100).toLocaleString()}).
          The client got an email and a pay button on their case page — or send this link in chat:
          <input type="text" readonly value="${esc(out.checkoutUrl)}" onclick="this.select()" style="margin-top:.3rem;">`;
      } else {
        resultEl.textContent = `Booked: ${out.scheduled}. The client has been emailed.`;
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
