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

export const VERSION = '2.36';

/**
 * Newest first.
 *
 * This file is loaded by every page, so anything written here is readable by
 * anyone who opens devtools. Nothing goes in it that is not meant for the
 * person reading it.
 *
 * A version with an empty list never shows a card at all.
 *
 * ERIC'S VERSIONING RULE (2026-08-21, his words condensed): every push to
 * main is a version, even when it is not loudly announced. Each push bumps
 * VERSION here (and the worker's copy for /api/version), and the NEWEST
 * entry's `client` list is REPLACED with that push's changes - what was
 * added CLIENT SIDE ONLY, plus bug fixes. Never anything from his side.
 * `quiet: true` means footer-only: the version and its notes show behind
 * the small "Version notes" button at the bottom of the page (client and
 * admin alike), but no update card and no tour ever open for it. A loud
 * release omits `quiet` and may carry a `tour`; only Eric calls for one of
 * those.
 *
 * His two commands (verbatim, 2026-08-21): "push as full update" = a loud
 * entry, existing clients get the update card with bullet points. "push as
 * silent update" = a quiet entry, footer only, and anything NEW clients
 * need to know goes into the onboarding tutorial instead, replacing old
 * copy there if necessary. An unspecified push is silent.
 *
 * ERIC'S SCOPE RULE (2026-08-23, from a screenshot of the notes window):
 * client-readable notes never describe admin-side machinery, however it is
 * worded. A push whose changes are admin-only keeps an EMPTY client list,
 * and the footer (version-note.js) keeps showing the newest version that
 * actually changed something for clients, so the number and the notes a
 * client sees only move when their app does.
 */
export const CHANGELOG = [
  {
    // The reshaped tier (check-ins, $3,500), telehealth appointment
    // advocacy, the Add-ons tab, phone consent at booking, and closure
    // reasons shown to the client. None of it is live for clients until the
    // release that turns the tier on, so the notes wait with it.
    version: '2.36',
    quiet: true,
    client: [],
  },
  {
    // The tip jar's removal is client-visible and worth saying: something they
    // could see on their page every visit is simply gone, and silence about
    // that invites "did I break something". The rest of this push is the
    // agreement they tick at booking, which existing clients never see again,
    // and admin machinery.
    //
    // 2.35, not 2.34: while this branch sat unmerged, 2.33 shipped to main as
    // the maintenance window. Everything here moved up one rather than reuse
    // a number a client's app has already seen.
    version: '2.35',
    quiet: true,
    client: [
      'The tip jar is gone from the bottom of your case page. Nothing on this app asks you for money beyond what you booked.',
    ],
  },
  {
    // The tier is not live yet, so its client notes wait for the release that
    // turns it on. What IS listed is a fix a client can see on their own page
    // today.
    version: '2.34',
    quiet: true,
    client: [
      'Bug fix: the scope note and the buttons on your Docs page no longer reset while you are reading them. If you had a form snap shut on you mid-tap, that was this.',
    ],
  },
  {
    // Shipped to main on 2026-08-24 while this branch waited: the front-door
    // maintenance window. Empty client list because it changed nothing for
    // anyone who already had a case.
    version: '2.33',
    quiet: true,
    client: [],
  },
  {
    // The re-landing of the pulled-back update (2.26-2.30). Client notes for
    // the whole feature get written in one go on the release that turns the
    // new tier on; until then this stays quiet.
    version: '2.32',
    quiet: true,
    client: [],
  },
  {
    // The pullback itself: kept the booking closure and the settings split,
    // reverted the rest to be fixed and re-landed.
    version: '2.31',
    quiet: true,
    client: [],
  },
  {
    // Empty, and this one is worth saying why. The booking page changed for
    // anyone who visits it: the books are shut for two weeks. But this card
    // is shown to people who ALREADY have a case, and for them nothing
    // changed at all - the closure says so out loud on the page itself.
    // Telling an existing client "I have stopped taking clients" reads as bad
    // news about their case, and it is not news about their case.
    version: '2.30',
    quiet: true,
    client: [],
  },
  {
    // Empty on purpose, and not because nothing changed for clients: the
    // Full Access upgrade card gained the scope note it always promised. That
    // card is part of a tier that is not live yet, so announcing the note now
    // would describe a screen no client has. The whole tier's client notes get
    // written in one go on the release that turns it on.
    version: '2.29',
    quiet: true,
    client: [],
  },
  {
    version: '2.28',
    quiet: true,
    client: [],
  },
  {
    version: '2.27',
    quiet: true,
    client: [],
  },
  {
    version: '2.26',
    quiet: true,
    client: [],
  },
  {
    version: '2.25',
    quiet: true,
    client: [],
  },
  {
    version: '2.24',
    quiet: true,
    client: [],
  },
  {
    version: '2.23',
    quiet: true,
    client: [],
  },
  {
    version: '2.22',
    quiet: true,
    client: [],
  },
  {
    version: '2.21',
    quiet: true,
    client: [],
  },
  {
    version: '2.20',
    quiet: true,
    client: [],
  },
  {
    version: '2.19',
    quiet: true,
    client: [],
  },
  {
    version: '2.18',
    quiet: true,
    client: [],
  },
  {
    version: '2.17',
    quiet: true,
    client: [],
  },
  {
    version: '2.16',
    quiet: true,
    client: [],
  },
  {
    version: '2.15',
    quiet: true,
    client: [],
  },
  {
    version: '2.14',
    quiet: true,
    client: [],
  },
  {
    version: '2.13',
    quiet: true,
    client: [],
  },
  {
    version: '2.12',
    quiet: true,
    client: [],
  },
  {
    version: '2.11',
    quiet: true,
    client: [],
  },
  {
    version: '2.10',
    quiet: true,
    client: [
      'The time-worked line on your Progress page now updates live: the minutes climb while the page is open, and "working on it right now" appears and clears the moment the work starts or stops.',
    ],
  },
  {
    version: '2.9',
    quiet: true,
    client: [],
  },
  {
    version: '2.8',
    quiet: true,
    client: [],
  },
  {
    version: '2.7',
    quiet: true,
    client: [
      'Your case page now shows the time I have actually worked on your case, under Progress. I start and stop that clock myself, and it says when I am working on it right now.',
    ],
  },
  {
    version: '2.6',
    quiet: true,
    client: [
      'Links in chat are now tappable. Paste a study, an article, or a portal link and it opens straight from the message.',
      'Bug fix: on a long thread, the newest messages were being hidden. Chat now always shows where the conversation actually is.',
    ],
  },
  {
    version: '2.5',
    quiet: true,
    client: [
      'Chat now opens one week before your scheduled call. Until then, your "For our next call" list stays open, and I read it.',
      'Want a direct line sooner? You can open chat immediately for a one-time $50, right from your case page, and it stays open for the life of your case.',
      "You'll get a notification and an email the moment chat opens, so there's nothing to watch for.",
    ],
  },
  {
    version: '2.4',
    quiet: true,
    client: [
      'Press and hold a file you uploaded on the Docs page to delete it. Files I place there, like your report and the call recording, stay part of your case record.',
    ],
  },
  {
    version: '2.3',
    quiet: true,
    client: [
      'A "For our next call" list now lives right under the chat. Add anything to it, anytime. We go through the list together on the call, where it gets real attention instead of a rushed reply.',
      'Bug fix: chat opens at your newest message instead of somewhere in the middle of history.',
      'Bug fix: removing a reaction from a message works again.',
    ],
  },
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
        where: 'The tip jar',
        icon: '\u{1FAD9}',
        body: 'At the bottom of your case page. Completely optional, and '
          + 'nothing about your care changes either way. Right under it is '
          + 'the review card: you are welcome to leave one at any point, '
          + 'not just when your case wraps up.',
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
      'When you add a photo or a document, you can name it in your own words. IMG_4127 tells nobody anything; "rash on my left hand" tells us both.',
      'Long file names are readable again instead of being cut off mid-word.',
      'When your report is delivered it is marked with a ✅, and a short feedback card opens under it.',
      'You can export your case as a PDF and pick which sections to include. It is in the feedback card, under Docs.',
      'Four looks to choose from, including a light one and a high-contrast one. Tap the ⚙ in the top bar.',
      'A tip jar sits at the bottom of your case page. Completely optional, always appreciated, and nothing about your care changes either way.',
      'You can leave a review at any point along the way, not just at the end. The card is at the bottom of your case page.',
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
    // Quiet versions never open a card or a tour; their notes live behind the
    // "Version notes" button in the page footer instead (version-note.js).
    .filter((v) => !v.quiet && rank(v.version) > rank(seen))
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
  // Anything extra is fetched, and the fetch is allowed to fail: an empty
  // object is a perfectly good answer and the card is drawn from what is here.
  let extra = {};
  if (isAdmin && user) {
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/changelog', { headers: { authorization: `Bearer ${token}` } });
      if (res.ok) extra = (await res.json()).admin || {};
    } catch { /* the client half still shows */ }
  }
  const versions = unseenVersions(extra);
  // A marker created just now, from empty, means this person is NEW this
  // session - they browsed in, nothing more. The intro (onboarding.js) reads
  // this to tell a first-ever visitor from a returning client, because by the
  // time they reach their case page the marker exists either way.
  try {
    if (!seenVersion()) sessionStorage.setItem('pa-fresh-visitor', '1');
  } catch { /* storage blocked */ }
  markVersionSeen();
  if (!versions.length) return false;

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  // The tour, if this release has one. One card per page, in tab order, paged
  // through with Next: a person who is unwell should never have to scroll a
  // wall of text to find out how to stop scrolling.
  // Eric, 2026-08-21: "They should get update notes and then take the tour."
  // step -1 is the notes page. The tour follows it, not the other way round.
  const tour = versions.flatMap((v) => v.tour || []);
  // This flow used to end on a copy of the tip jar. The jar was retired on
  // 2026-08-24, so the notes end on the tour, or on themselves.
  let step = -1;

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
    if (step < 0) {
      // What changed, first. This is somebody who already uses the app.
      bodyEl.innerHTML = versions.map((v) => `
        <h3>Pocket Advocate ${esc(v.version)}</h3>
        <ul class="whats-new-list">${v.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`).join('');
      actsEl.innerHTML = tour.length
        ? `<button class="btn glow" data-next>Take the tour</button>
           <button class="btn ghost" data-close>Not now</button>`
        : '<button class="btn glow" data-close>Got it</button>';
      actsEl.querySelector('[data-next]')?.addEventListener('click', () => { step = 0; draw(); });
    } else if (step < tour.length) {
      const t = tour[step];
      bodyEl.innerHTML = `
        <p class="wn-step">${step + 1} of ${tour.length}</p>
        <h3>${esc(t.icon || '')} ${esc(t.where)}</h3>
        <p class="wn-body">${esc(t.body)}</p>
        <div class="wn-dots" aria-hidden="true">${tour.map((_, i) =>
          `<span class="${i === step ? 'on' : ''}"></span>`).join('')}</div>`;
      const lastTour = step === tour.length - 1;
      actsEl.innerHTML = `
        <button class="btn quiet" data-back>Back</button>
        ${lastTour
          ? '<button class="btn glow" data-close>Done</button>'
          : '<button class="btn glow" data-next>Next</button>'}
        ${lastTour ? '' : '<button class="btn ghost" data-close>Skip</button>'}`;
      actsEl.querySelector('[data-back]')?.addEventListener('click', () => { step--; draw(); });
      actsEl.querySelector('[data-next]')?.addEventListener('click', () => { step++; draw(); });
    }
    actsEl.querySelector('[data-close]')?.addEventListener('click', close);
  }

  function close() { overlay.remove(); }
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  draw();
  document.body.appendChild(overlay);
  return true;
}
