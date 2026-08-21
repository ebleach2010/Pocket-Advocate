// What changed, and who is told about it.
//
// Every merge to main is a version. The client sees a card on next open, App
// Store style: the version, then a short bullet list of what actually changed
// for them. Eric sees the same card with the admin work included.
//
// Two rules that keep this honest rather than noisy:
//
//   Only client-visible changes appear in the client's list. Work that never
//   reaches their screen is not news to them; what they need is that their
//   documents now show as thumbnails, and where those thumbnails are.
//
//   Every entry says what changed AND where to find it if the UI moved. "The
//   chat and your files are easier to move between" is half a sentence; "tap
//   the tabs at the top of your case" is the other half, and it is the half
//   that stops a change from feeling like something went missing.

export const VERSION = '2.2';

/**
 * Newest first, and CLIENT NOTES ONLY.
 *
 * This file is loaded by every page, so anything in it is readable by anyone
 * who opens devtools. Eric's half of the release notes is not, and must not
 * be: it is served by an admin-gated Worker route and never exists in a static
 * file.
 *
 * A version with an empty list never shows a card at all, which is the right
 * outcome for a release that only moved things on the advocate's side.
 */
export const CHANGELOG = [
  {
    version: '2.2',
    // A guided tour rather than a list. Each card is one page of their case,
    // in the order the tabs are in, and says what the page is for and how to
    // get around it. `where` is the tab it is talking about, so the card and
    // the thing it describes are never out of step.
    tour: [
      {
        where: 'Your case',
        icon: '📁',
        body: 'Your case is a folder with tabs across the top. Tap a tab to open '
          + 'that page, or swipe left and right to move between them. Nothing '
          + 'is buried: every page is one tap away.',
      },
      {
        where: 'Progress',
        icon: '📍',
        body: 'Where your case is up to, and when we are speaking. The time is '
          + 'shown in your own timezone as well as mine, and there is a "+ '
          + 'calendar" link that adds it to your phone. Session details are '
          + 'folded up underneath; tap to open them.',
      },
      {
        where: 'Chat',
        icon: '💬',
        body: 'Messages between us. The ⤢ button next to the box makes it full '
          + 'screen, which is easier to read on a phone, and the same button '
          + 'brings it back. Press and hold any message to react to it, copy it, '
          + 'or save it. You can edit your own message for three minutes after '
          + 'sending it.',
      },
      {
        where: 'Docs',
        icon: '📄',
        body: 'Everything on your case: your report, the recording, and anything '
          + 'either of us has uploaded. Tap the box at the top to add labs, '
          + 'imaging or records. Files shared in chat land here too, so there is '
          + 'one place to look.',
      },
      {
        where: 'Saved',
        icon: '🔖',
        body: 'Messages you have bookmarked, each with room for a note of your '
          + 'own. Press and hold a message in Chat and choose "Save this '
          + 'message". This page is yours: I am not told what you save.',
      },
      {
        where: 'If a question is too much',
        icon: '⚐',
        body: 'Press and hold any question I asked and tap the flag to pass on '
          + 'it. It is marked and we move on. No questions asked, no judgement, '
          + 'and you never owe an explanation.',
      },
      {
        where: 'How it looks',
        icon: '⚙',
        body: 'Four looks, including a light one and a high-contrast one. Tap '
          + 'the ⚙ in the top bar. If reading is hard today, the high-contrast '
          + 'one is worth trying.',
      },
    ],
    client: [
      'Your case is now a folder with tabs instead of one long scroll. Tap a tab, or swipe left and right to move between pages.',
      'A new Saved tab: press and hold any message to bookmark it with a note of your own.',
      'Files shared in chat now show up in your Documents, where they always should have.',
      'Long file names are readable again instead of being cut off mid-word.',
      'When your report is delivered it is marked with a ✅, and a short feedback card opens under it.',
      'You can export your case as a PDF and pick which sections to include. It is in the feedback card, under Docs.',
      'Four looks to choose from, including a light one and a high-contrast one. Tap the ⚙ in the top bar.',
    ],
  },
  {
    version: '2.1',
    client: [
      'Press and hold a message to react to it, or to edit your own within three minutes.',
      'Press and hold a file shared in chat to save it to your Documents.',
    ],
  },
];

const KEY = 'pa-seen-version';

/** Sortable so 2.10 lands after 2.9 rather than before it. */
function rank(v) {
  return String(v).split('.').map((n) => String(Number(n) || 0).padStart(4, '0')).join('.');
}

export function seenVersion() {
  try { return localStorage.getItem(KEY) || ''; } catch { return ''; }
}

export function markVersionSeen(v = VERSION) {
  try { localStorage.setItem(KEY, v); } catch { /* storage blocked */ }
}

/**
 * Everything they have not been told about yet, newest first. A first-ever
 * visit gets nothing: somebody who has never used the app does not need a
 * changelog, they need the app.
 */
export function unseenVersions(extra = {}) {
  const seen = seenVersion();
  if (!seen) return [];
  return CHANGELOG
    .filter((v) => rank(v.version) > rank(seen))
    .map((v) => ({
      version: v.version,
      // `extra` is Eric's half, fetched from the admin route. A client never
      // has one, and never has a way to ask for one.
      notes: [...v.client, ...(extra[v.version] || [])],
      tour: v.tour || [],
    }))
    .filter((v) => v.notes.length);
}

/**
 * The card. Dismissible, and it never comes back: the moment it is built the
 * version is marked seen, so a reload does not bring it round again even if
 * they never tapped anything.
 */
export async function showVersionCard(isAdmin = false, user = null) {
  // Eric's half comes from a route that checks his role server-side. A client
  // calling it gets a 403 and an empty object, which is also what a network
  // failure gives, so the card degrades to the client notes either way.
  let extra = {};
  if (isAdmin && user) {
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/changelog', { headers: { authorization: `Bearer ${token}` } });
      if (res.ok) extra = (await res.json()).admin || {};
    } catch { /* the client half still shows */ }
  }
  const versions = unseenVersions(extra);
  markVersionSeen();
  if (!versions.length) return false;

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  // The tour, if this release has one. One card per page, in tab order, paged
  // through with Next: a person who is unwell should never have to scroll a
  // wall of text to find out how to stop scrolling.
  const tour = versions.flatMap((v) => v.tour || []);
  let step = 0;

  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-card whats-new" role="dialog" aria-modal="true" aria-label="What's new">
      <div data-body></div>
      <div class="actions" data-acts></div>
    </div>`;
  const bodyEl = overlay.querySelector('[data-body]');
  const actsEl = overlay.querySelector('[data-acts]');

  function draw() {
    if (tour.length && step < tour.length) {
      const t = tour[step];
      bodyEl.innerHTML = `
        <p class="wn-step">${step + 1} of ${tour.length}</p>
        <h3>${esc(t.icon || '')} ${esc(t.where)}</h3>
        <p class="wn-body">${esc(t.body)}</p>
        <div class="wn-dots" aria-hidden="true">${tour.map((_, i) =>
          `<span class="${i === step ? 'on' : ''}"></span>`).join('')}</div>`;
      actsEl.innerHTML = `
        ${step > 0 ? '<button class="btn quiet" data-back>Back</button>' : ''}
        <button class="btn glow" data-next>${step === tour.length - 1 ? 'See what changed' : 'Next'}</button>
        <button class="btn ghost" data-close>Skip</button>`;
      actsEl.querySelector('[data-back]')?.addEventListener('click', () => { step--; draw(); });
      actsEl.querySelector('[data-next]').addEventListener('click', () => { step++; draw(); });
    } else {
      bodyEl.innerHTML = versions.map((v) => `
        <h3>Pocket Advocate ${esc(v.version)}</h3>
        <ul class="whats-new-list">${v.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`).join('');
      actsEl.innerHTML = '<button class="btn glow" data-close>Got it</button>';
    }
    actsEl.querySelector('[data-close]').addEventListener('click', close);
  }

  function close() { overlay.remove(); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  draw();
  document.body.appendChild(overlay);
  return true;
}
