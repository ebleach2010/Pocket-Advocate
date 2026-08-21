// A gentle first-run intro. New clients tap through a couple of soft welcome
// cards — set up the app, turn on notifications — and land on their dashboard.
// Shows once per device; after that, a small reminder appears only if setup
// isn't finished yet.
import { enablePush, pushInstalled, pushSupported } from './push.js';

const DONE_KEY = 'pa-intro-done';
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
  let known = false;
  try { known = !!localStorage.getItem('pa-seen-version'); } catch { /* blocked */ }

  if (known || localStorage.getItem(DONE_KEY)) {
    if (!fullySet) reminder(user, mount);
    return;
  }
  runIntro(user, mount, fullySet, welcome);
}

function finish() {
  localStorage.setItem(DONE_KEY, '1');
  document.getElementById('pa-intro')?.remove();
}

function runIntro(user, mount, fullySet, welcome = true) {
  const steps = [
    ...(welcome ? [{
      title: 'Welcome to Pocket Advocate 👋',
      body: `<p>You're in. This is your private space: your case, your documents, and a direct line to me. Just a couple of quick things to set up first.</p>`,
      cta: 'Get started',
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
