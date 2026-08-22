// A gentle first-run intro. New clients tap through a couple of soft welcome
// cards — set up the app, turn on notifications — and land on their dashboard.
// Shows once per device; after that, a small reminder appears only if setup
// isn't finished yet.
import { enablePush, pushInstalled, pushSupported } from './push.js';

const DONE_KEY = 'pa-intro-done';

// Read at module load, BEFORE the changelog module can stamp the current
// version on this same page load. showVersionCard marks the version seen even
// on a first-ever visit (deliberately - it starts the update clock), and
// reading the marker later raced that stamp: a genuinely new client could be
// mistaken for a returning one and never welcomed at all.
// (Post-2.2 audit, 2026-08-21.)
const KNOWN_AT_LOAD = (() => {
  try { return !!localStorage.getItem('pa-seen-version'); } catch { return false; }
})();
// The marker alone is not enough: every page stamps it, so a brand-new person
// who looked at the booking page first arrives at their case already stamped.
// changelog.js flags the session in which the stamp was first created; while
// that flag is up, this browser is a first-ever visitor and the welcome runs.
const FRESH_SESSION = (() => {
  try { return sessionStorage.getItem('pa-fresh-visitor') === '1'; } catch { return false; }
})();
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const notifOn = () => 'Notification' in window && Notification.permission === 'granted';

/**
 * `welcome: false` drops the opening card.
 *
 * It says "You're in. This is your private space - your case, your documents"
 * which is true on the case page and false on the booking page, where the same
 * guide runs to offer the Home Screen install before anyone pays. A returning
 * client opening the pricing page on a new phone was told they had a case.
 */
export function initSetupGuide(user, mount, { welcome = true } = {}) {
  if (!mount || !user) return;
  const fullySet = pushInstalled() && notifOn();

  // Eric, 2026-08-21: "Be sure active clients don't get a 'Welcome to Pocket
  // Advocate' bullshit line. They should get update notes and then take the
  // tour."
  //
  // The first-run intro is keyed on a per-DEVICE flag, so a client who has
  // been with him for months got welcomed to the app as a newcomer the first
  // time they opened it on a new phone - and on the morning an update landed,
  // greeted before being told anything changed. A stored version marker means
  // this browser has already seen a release, which means they are not new.
  // The whole first-run intro is skipped for them, not just its opening card:
  // it is a modal, the update card is a modal, and two of those stacked on the
  // morning of a release is worse than either. The quiet reminder still runs if
  // notifications are not set up.
  let done = false;
  try { done = !!localStorage.getItem(DONE_KEY); } catch { /* blocked */ }

  if (done || (KNOWN_AT_LOAD && !FRESH_SESSION)) {
    if (!fullySet) reminder(user, mount);
    return;
  }
  runIntro(user, mount, fullySet, welcome);
}

function finish() {
  // The remove() must run even when storage is blocked or full: every dismiss
  // path routes through here, and a throw would leave the modal welded over
  // the page with no way past it.
  try { localStorage.setItem(DONE_KEY, '1'); } catch { /* blocked */ }
  document.getElementById('pa-intro')?.remove();
}

function runIntro(user, mount, fullySet, welcome = true) {
  const steps = [
    ...(welcome ? [{
      title: 'Welcome to Pocket Advocate 👋',
      body: `<p>You're in. This is your private space: your case, your documents, and a direct line to me. Just a couple of quick things to set up first.</p>`,
      cta: 'Get started',
    }, {
      // Taught up front to new clients only; existing clients were
      // deliberately never sent a card about any of this. Gated on `welcome`
      // with the card above: both are case-page material, and this guide
      // also runs on the booking page, where there is no chat. The lane
      // chips this card once described are gone (Eric, 2026-08-22: "Have it
      // just be a chat"); the next-call list is what remains worth teaching.
      title: 'How chat works',
      body: `
        <p>Chat is a direct line to me: updates, questions, records, anything on your mind.</p>
        <p>For the bigger things, there is a <strong>For our next call</strong> list right under the chat. Add to it anytime; we go through the list together on the call, where it gets my full attention instead of a rushed reply.</p>`,
      cta: 'Next',
    }] : []),
    {
      title: 'Keep it one tap away',
      body: `
        ${pushInstalled()
          ? `<p>Pocket Advocate is on your Home Screen. ✓</p>`
          : isIOS()
            ? `<p>Add Pocket Advocate to your Home Screen so it opens like an app, keeps you signed in, and can send you notifications:</p>
               <ol class="intro-steps"><li>Tap the <strong>Share</strong> button ⬆️ at the bottom of Safari</li>
               <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
               <li>Tap <strong>Add</strong>, then open Pocket Advocate from the new icon</li></ol>`
            : `<p>Add Pocket Advocate to your Home Screen so it opens like an app and can send you notifications:</p>
               <ol class="intro-steps"><li>Tap the <strong>⋮</strong> menu in Chrome</li>
               <li>Tap <strong>Add to Home screen</strong></li>
               <li>Confirm, then open it from the new icon</li></ol>`}
        <p class="dim small" style="margin-top:.9rem;">Nothing here is required. You can skip it and carry on. The <strong>?</strong> beside your case title explains all of this again any time.</p>`,
      cta: pushInstalled() ? 'Next' : 'Done, take me in',
    },
  ];

  if (pushInstalled() && !notifOn()) {
    steps.push({
      title: 'Turn on notifications',
      body: `<p>Get a gentle alert when there's a new message, document, or update, so you never have to keep checking back. No message content is ever shown.</p>`,
      cta: 'Turn on notifications',
      action: async (btn) => {
        btn.disabled = true;
        const r = await enablePush(user);
        if (!r.ok && pushSupported()) alert(r.error);
        btn.disabled = false;
      },
    });
  }

  let i = 0;
  const overlay = document.createElement('div');
  overlay.id = 'pa-intro';
  overlay.className = 'intro-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  document.body.appendChild(overlay);
  // Focus goes in and stays in. It said aria-modal and then let Tab walk the
  // page behind it, which for anyone navigating by keyboard is worse than not
  // claiming to be modal at all.
  const returnTo = document.activeElement;
  const trap = (e) => {
    if (e.key === 'Escape') { finish(); return; }
    if (e.key !== 'Tab') return;
    const can = [...overlay.querySelectorAll('button, [href], input, select, textarea')]
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!can.length) return;
    const first = can[0];
    const last = can[can.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (!overlay.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  };
  document.addEventListener('keydown', trap);
  const releaseFocus = () => {
    document.removeEventListener('keydown', trap);
    if (returnTo && document.contains(returnTo)) returnTo.focus?.();
  };

  const paint = () => {
    const s = steps[i];
    const last = i === steps.length - 1;
    overlay.innerHTML = `
      <div class="intro-card">
        <div class="intro-dots">${steps.map((_, k) => `<span class="${k === i ? 'on' : ''}"></span>`).join('')}</div>
        <h2>${s.title}</h2>
        ${s.body}
        <div class="intro-actions">
          <button class="btn quiet" data-skip>${last ? 'Not now' : 'Skip'}</button>
          <button class="btn" data-next>${last ? 'Done' : s.cta || 'Next'}</button>
        </div>
      </div>`;
    overlay.querySelector('[data-skip]')?.addEventListener('click', () => { releaseFocus(); finish(); });
    overlay.querySelector('[data-next]')?.focus();
    if (s.onPaint) s.onPaint(overlay);
    overlay.querySelector('[data-next]').addEventListener('click', async (e) => {
      if (s.action) await s.action(e.target);
      if (i < steps.length - 1) { i += 1; paint(); } else { releaseFocus(); finish(); }
    });
  };
  paint();
}

// Small, non-blocking nudge shown after the intro if setup is still incomplete.
function reminder(user, mount) {
  const card = document.createElement('div');
  card.className = 'panel setup-guide';
  if (!pushInstalled()) {
    card.innerHTML = `<p style="margin:0;"><strong>Finish setup:</strong> add Pocket Advocate to your Home Screen
      ${isIOS() ? '(Share ⬆️ → Add to Home Screen)' : '(⋮ menu → Add to Home screen)'} to get notifications.</p>`;
  } else {
    card.innerHTML = `<p style="margin:0 0 .5rem;"><strong>Turn on notifications</strong> so you don't miss a reply.</p>
      <button class="btn" data-on>Turn on notifications</button>`;
    card.querySelector('[data-on]').addEventListener('click', async (e) => {
      e.target.disabled = true;
      const r = await enablePush(user);
      if (r.ok) card.innerHTML = '<p class="dim" style="margin:0;">Notifications are on. ✓</p>';
      else { e.target.disabled = false; alert(r.error); }
    });
  }
  mount.prepend(card);
}
