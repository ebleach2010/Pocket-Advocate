// First-run setup guide for clients. The two things that make Pocket Advocate
// work like a real app — installing to the Home Screen and turning on
// notifications — are shown as a clear, in-app step-by-step, adapting to where
// the person actually is. Once both are done it disappears for good.
import { initPushPrompt } from './push.js';

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function notificationsOn() {
  return 'Notification' in window && Notification.permission === 'granted';
}

/** Render the setup guide into `mount` (top of the page). No-ops when done. */
export function initSetupGuide(user, mount) {
  if (!mount || !user) return;

  // Fully set up (installed + notifications on): nothing to show.
  if (isStandalone() && notificationsOn()) return;

  // Installed already → the only step left is notifications; use the prompt.
  if (isStandalone()) {
    initPushPrompt(user, mount).catch(() => {});
    return;
  }

  // Still in the browser → guide them to install first (that unlocks
  // notifications, offline access, and a one-tap icon).
  const steps = isIOS()
    ? `<li>Tap the <strong>Share</strong> button <span style="font-size:1.1em;">⬆️</span> at the bottom of Safari</li>
       <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
       <li>Tap <strong>Add</strong>, then open Pocket Advocate from the new icon</li>`
    : `<li>Tap the <strong>⋮</strong> menu at the top right of Chrome</li>
       <li>Tap <strong>Add to Home screen</strong> (or <strong>Install app</strong>)</li>
       <li>Confirm, then open Pocket Advocate from the new icon</li>`;

  const card = document.createElement('div');
  card.className = 'panel setup-guide';
  card.innerHTML = `
    <h3 style="margin:0 0 .3rem;">Set up Pocket Advocate</h3>
    <p class="dim small" style="margin:0 0 .6rem;">Two quick steps so you never miss a message, document, or update — this is how you get notifications on your phone.</p>
    <p style="margin:0 0 .2rem;"><strong>Step 1 — Add it to your Home Screen</strong></p>
    <ol style="margin:.2rem 0 .6rem 1.1rem; padding:0; line-height:1.5;">${steps}</ol>
    <p class="dim small" style="margin:0;"><strong>Step 2 —</strong> Open it from that icon and tap <strong>Turn on notifications</strong>. That's it.</p>`;
  mount.prepend(card);
}
