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
    client: [
      'Your case is now three pages instead of one long scroll. Tap Progress, Chat or Docs at the top, or swipe between them.',
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

  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-card whats-new" role="dialog" aria-modal="true" aria-label="What's new">
      ${versions.map((v) => `
        <h3>Pocket Advocate ${esc(v.version)}</h3>
        <ul class="whats-new-list">${v.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`).join('')}
      <div class="actions"><button class="btn glow" data-close>Got it</button></div>
    </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-close]').addEventListener('click', close);
  document.body.appendChild(overlay);
  return true;
}
