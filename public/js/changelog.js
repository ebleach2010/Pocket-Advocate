// What changed, and who is told about it.
//
// Every merge to main is a version. The client sees a card on next open, App
// Store style: the version, then a short bullet list of what actually changed
// for them. Eric sees the same card with the admin work included.
//
// Two rules that keep this honest rather than noisy:
//
//   Only client-visible changes appear in the client's list. They do not need
//   to hear that the advisor gained a chart note; they need to hear that their
//   documents now show as thumbnails and where those thumbnails are.
//
//   Every entry says what changed AND where to find it if the UI moved. "The
//   chat and your files are easier to move between" is half a sentence; "tap
//   the tabs at the top of your case" is the other half, and it is the half
//   that stops a change from feeling like something went missing.

export const VERSION = '2.2';

/**
 * Newest first. `client` is what a patient reads; `admin` is what Eric reads on
 * top of it. A version with an empty `client` array never shows a card to a
 * client at all, which is the right outcome for a release that only moved
 * things on the advocate's side.
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
    admin: [
      'The dashboard is a shelf of case folders with the working diagnosis on the front. Press and hold that line to write your own over it.',
      'Folders carry an emoji for anything you have not looked at yet, and they stack: 💬👨‍🔬.',
      'The case opens as a folder. Tap the right half of a page to send it to the back of the pile, the left half to bring one forward. It loops.',
      'The advisor stops losing documents. Everything you hand it is read, queued for the next pass, or named with the reason it could not be read.',
      'It also picks up new files on its own, about five minutes after they land, and never re-reads one.',
      'Ten sections now, including plain English with colour-coded terms, a chart note, what is missing, and what is genuinely ruled out.',
      'Say "override" and the advisor stops arguing and files your position permanently.',
      'Education and About you are their own tabs.',
      'Reviews land in the case Overview for you to publish or keep private.',
      'A duty-of-care draft lives under Drafts, in your words, with live crisis numbers for the US and Canada.',
    ],
  },
  {
    version: '2.1',
    client: [
      'Press and hold a message to react to it, or to edit your own within three minutes.',
      'Press and hold a file shared in chat to save it to your Documents.',
    ],
    admin: [],
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
export function unseenVersions(isAdmin = false) {
  const seen = seenVersion();
  if (!seen) return [];
  return CHANGELOG
    .filter((v) => rank(v.version) > rank(seen))
    .map((v) => ({
      version: v.version,
      notes: isAdmin ? [...v.client, ...v.admin] : v.client,
    }))
    .filter((v) => v.notes.length);
}

/**
 * The card. Dismissible, and it never comes back: the moment it is built the
 * version is marked seen, so a reload does not bring it round again even if
 * they never tapped anything.
 */
export function showVersionCard(isAdmin = false) {
  const versions = unseenVersions(isAdmin);
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
