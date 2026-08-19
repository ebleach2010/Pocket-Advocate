// A gentle first-run intro. New clients tap through a couple of soft welcome
// cards — set up the app, turn on notifications — and land on their dashboard.
// Shows once per device; after that, a small reminder appears only if setup
// isn't finished yet.
import { enablePush, pushInstalled, pushSupported } from './push.js';
import { setTheme, currentTheme, THEMES } from './theme.js';

const DONE_KEY = 'pa-intro-done';
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const notifOn = () => 'Notification' in window && Notification.permission === 'granted';

export function initSetupGuide(user, mount) {
  if (!mount || !user) return;
  const fullySet = pushInstalled() && notifOn();

  if (localStorage.getItem(DONE_KEY)) {
    if (!fullySet) reminder(user, mount);
    return;
  }
  runIntro(user, mount, fullySet);
}

function finish() {
  localStorage.setItem(DONE_KEY, '1');
  document.getElementById('pa-intro')?.remove();
}

function runIntro(user, mount, fullySet) {
  const steps = [
    {
      title: 'Welcome to Pocket Advocate 👋',
      body: `<p>You're in. This is your private space — your case, your documents, and a direct line to me. Just a couple of quick things to set up first.</p>`,
      cta: 'Get started',
    },
    {
      // Home Screen instructions and the colour picker share one card: two
      // small optional choices on one screen beats two screens to get through.
      title: pushInstalled() ? 'Make it yours' : 'Keep it one tap away',
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
        <p style="margin-top:1rem;">Pick a colour scheme — change it any time from the ⚙ settings.</p>
        <div class="seg" data-theme-seg>${THEMES.map((t) =>
          `<button data-theme-pick="${t.id}" class="${t.id === currentTheme() ? 'on' : ''}">${t.label}</button>`).join('')}</div>
        <p class="dim small" style="margin-top:.9rem;">Nothing here is required — you can skip it and carry on.</p>`,
      cta: pushInstalled() ? 'Next' : 'Done — take me in',
      onPaint: (root) => {
        root.querySelectorAll('[data-theme-pick]').forEach((b) =>
          b.addEventListener('click', () => {
            setTheme(b.dataset.themePick);
            root.querySelectorAll('[data-theme-pick]').forEach((x) => x.classList.toggle('on', x === b));
          }));
      },
    },
  ];

  if (pushInstalled() && !notifOn()) {
    steps.push({
      title: 'Turn on notifications',
      body: `<p>Get a gentle alert when there's a new message, document, or update — so you never have to keep checking back. No message content is ever shown.</p>`,
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
  document.body.appendChild(overlay);

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
    overlay.querySelector('[data-skip]')?.addEventListener('click', finish);
    if (s.onPaint) s.onPaint(overlay);
    overlay.querySelector('[data-next]').addEventListener('click', async (e) => {
      if (s.action) await s.action(e.target);
      if (i < steps.length - 1) { i += 1; paint(); } else finish();
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
