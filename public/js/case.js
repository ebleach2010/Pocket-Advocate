// The client case dashboard (Phases 2-3): after booking, the case lives on
// one scrolling page in three stacked sections - Progress (timeline +
// appointment), Chat (live, with file sharing), and Documents (uploads from
// both ends + files saved from chat) - with a sticky jump-chip nav that
// scrolls to each section and highlights the one in view.

import {
  db, storage, collection, getDocs, query, where,
  ref, uploadBytesResumable, listAll, getDownloadURL, getMetadata,
} from './firebase.js';
import { requireUser, hydrateNav } from './auth.js';
import { mountChat, watchPresence } from './chat.js';
import { mountSaved } from './saved.js';
import { initSetupGuide } from './onboarding.js';
import { askName, safeName } from './rename.js';
import { HELP_BUTTON, wireHelp, openCaseHelp } from './help.js';
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
  if (progress) renderProgress(progress, c);
  if (docs) renderDocs(docs, c);
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
      <ul class="timeline">
        ${STEPS.map(([, label], i) => `
          <li class="${i + 1 < rank ? 'done' : i + 1 === rank ? (closed ? 'done' : 'now') : ''}">
            <span class="t-dot"></span>${label}</li>`).join('')}
      </ul>
    </div>
    <details class="faq" data-more>
      <summary>Session details</summary>
      <div class="faq-a">
        <p class="dim small">Session: <strong style="color:${election.choice === 'public' ? 'var(--magenta)' : 'var(--cyan)'};">
          ${election.choice === 'public' ? 'PUBLIC, streams live on YouTube' : 'PRIVATE'}</strong></p>
        ${revocable ? `<p><button class="btn ghost" data-private>Make it private</button></p>` : ''}
        ${followUpSection(c)}
      </div>
    </details>`;

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
  el.innerHTML = `
    <h2 class="case-sec-h">Chat</h2>
    <p class="dim small" style="margin:.1rem 0 .3rem;">Chat keeps your case moving between calls: records, scheduling, and anything new or urgent with your health. The analysis itself happens on our calls, and everything else goes on the list for the next one.</p>
    <p style="margin:.2rem 0 .3rem;"><span class="p-dot"></span><span class="p-label">Checking…</span></p>
    <div class="panel" data-chat></div>
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
    disabled: closed,
    notice: 'This chat ended when the case closed. Your documents remain yours forever.',
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
    <div data-review hidden></div>
    <div data-followup></div>`;
  const input = el.querySelector('[data-file-input]');
  input?.addEventListener('change', () => uploadFiles(c, el, [...input.files]));
  refreshFiles(c, el);
  renderReview(el, c);
  const offer = el.querySelector('[data-followup]');
  if (offer) {
    offer.innerHTML = followUpOffer(c);
    wireFollowUpOffer(offer, c);
  }
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
        rows.push({ kind, name: item.name, url, ts: new Date(meta.timeCreated), size: meta.size });
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
  listEl.innerHTML = rows.map((r) => `
    <li>
      <span class="fname"><span class="kind-pill ${r.kind}">${r.kind === 'saved' || r.kind === 'chat' ? 'FROM CHAT' : r.kind.toUpperCase()}</span>
        ${r.kind === 'report' && delivered ? '<span class="delivered-tick" title="Delivered" role="img" aria-label="Delivered">✅</span>' : ''}
        <a href="${r.url}" target="_blank" rel="noopener">${esc(shownName(r.name))}</a></span>
      <span class="fmeta">${fmt.format(r.ts)} · ${prettySize(r.size)}</span>
    </li>`).join('');
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
  'The chat closes 48hrs after you receive your advocacy case review.',
  'Thank You!',
];

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
    mine: m.classList.contains('mine'),
    text: (m.querySelector('.msg-text')?.textContent || m.textContent || '').trim(),
    when: m.querySelector('time')?.textContent?.trim() || '',
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
const FOLLOWUP_PRICE_CENTS = 7500;
const followUpPrice = (c) =>
  (Number(c?.addonRateCents) > 0 ? Number(c.addonRateCents) : FOLLOWUP_PRICE_CENTS) / 100;

/**
 * True on the one page load that comes straight back from Stripe. The offer
 * card is already saying the follow-up is reserved; the review card below it
 * saying the same thing in different words reads as a glitch.
 */
/**
 * The bottom of the case page: the tip jar. Always there, never hidden, and
 * never in the way. The words are Eric's, verbatim. If the v2.2 update card
 * has not been seen yet, changelog.js folds a copy of this into the end of
 * that flow (it looks for [data-tip-jar]).
 */
const TIP_QUOTE = [
  'Professional patient advocacy at this level typically runs $150\u2013$275/hour. Between direct client time, research, and case preparation, my current pricing works out to roughly $6/hour.',
  'Anything contributed here goes directly back into improving The Pocket Advocate, its tools, experience, and outcomes.',
  'This is exactly what it sounds like: a tip jar. If you\u2019ve found the service valuable and want to contribute, you can. If not, nothing about the care or effort you receive changes.',
  'Completely optional. Always appreciated.',
];

/** Everything they have paid on this case, in cents. */
function totalPaidCents(c) {
  const base = c.payment?.amountTotal || c.caseRateCents || 26500;
  const extras = (Array.isArray(c.extraPayments) ? c.extraPayments : [])
    .filter((x) => x.kind !== 'tip')
    .reduce((sum, x) => sum + (Number(x.amountCents) || 0), 0);
  return base + extras;
}

function tipJarHtml(c) {
  const paid = totalPaidCents(c);
  const pct = (n) => Math.round((paid * n) / 100);
  const money = (cents) => `$${(cents / 100).toFixed(2)}`;
  return `
    <div class="panel" data-tip-jar style="margin-top:1.2rem; text-align:center;">
      <p style="font-size:2.6rem; margin:.2rem 0 .6rem;" aria-hidden="true">\u{1FAD9}</p>
      ${TIP_QUOTE.map((t) => `<p class="dim" style="text-align:left;">${esc(t)}</p>`).join('')}
      <div style="display:flex; flex-direction:column; gap:.5rem; max-width:22rem; margin:1rem auto 0;">
        <button type="button" class="btn ghost" data-tip-custom>Custom amount</button>
        <div data-tip-box hidden style="gap:.5rem;">
          <input type="number" min="1" max="5000" step="1" inputmode="decimal" placeholder="$"
            data-tip-amount style="flex:1; min-width:0; text-align:center;">
          <button type="button" class="btn glow" data-tip-send>Add</button>
        </div>
        <div style="display:flex; gap:.5rem;">
          <button type="button" class="btn ghost" style="flex:1; min-width:0; padding-left:.2rem; padding-right:.2rem;" data-tip-pct="15">15%<br><span class="dim small">${money(pct(15))}</span></button>
          <button type="button" class="btn ghost" style="flex:1; min-width:0; padding-left:.2rem; padding-right:.2rem;" data-tip-pct="20">20%<br><span class="dim small">${money(pct(20))}</span></button>
          <button type="button" class="btn ghost" style="flex:1; min-width:0; padding-left:.2rem; padding-right:.2rem;" data-tip-pct="25">25%<br><span class="dim small">${money(pct(25))}</span></button>
        </div>
        <p class="error" data-tip-error hidden style="margin:0;"></p>
        <p class="dim small" data-tip-thanks hidden style="margin:0;">Received. Thank you.</p>
      </div>
    </div>`;
}

function renderPageFooter(host, c) {
  if (!host) return;
  const delivered = c.status === 'delivered' || c.status === 'closed';
  host.innerHTML = tipJarHtml(c) + (delivered ? '' : '<div data-review hidden></div>');
  // The version line rides just above the jar (Eric, 2026-08-21). It mounts
  // itself at the end of main before this footer exists; before() MOVES the
  // node, click wiring intact. Idempotent across repaints.
  const verline = document.getElementById('pa-verline');
  if (verline) host.before(verline);
  if (!delivered) renderReview(host, c);
  if (new URLSearchParams(location.search).get('tipped') === '1') {
    host.querySelector('[data-tip-thanks]').hidden = false;
    history.replaceState(null, '', `/case.html?id=${c.id}`);
  }
}

// One set of handlers at the document, so the copy changelog.js folds into
// the update card works exactly like the one at the bottom of the page.
async function sendTip(jar, amountCents) {
  const err = jar.querySelector('[data-tip-error]');
  if (err) err.hidden = true;
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/tip', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ caseId: currentId, amountCents }),
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
    location.href = out.url;
  } catch (e) {
    if (err) { err.textContent = e.message; err.hidden = false; }
  }
}
document.addEventListener('click', (e) => {
  const jar = e.target.closest?.('[data-tip-jar]');
  if (!jar) return;
  const pctBtn = e.target.closest('[data-tip-pct]');
  if (pctBtn) {
    const c = cases.find((x) => x.id === currentId);
    if (c) sendTip(jar, Math.round((totalPaidCents(c) * Number(pctBtn.dataset.tipPct)) / 100));
    return;
  }
  if (e.target.closest('[data-tip-custom]')) {
    const box = jar.querySelector('[data-tip-box]');
    box.hidden = false;
    box.style.display = 'flex';
    box.querySelector('[data-tip-amount]')?.focus();
    return;
  }
  if (e.target.closest('[data-tip-send]')) {
    const dollars = Number(jar.querySelector('[data-tip-amount]')?.value);
    if (!(dollars >= 1)) return;
    sendTip(jar, Math.round(dollars * 100));
  }
});

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
