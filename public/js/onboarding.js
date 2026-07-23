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
      body: `<p>You're in. This is your private space — your case, your documents, and a direct line to Eric. Just a couple of quick things to set up first.</p>`,
      cta: 'Get started',
    },
    {
      title: 'Pick your look',
      body: `<p>Choose a color scheme — you can change it any time from the ⚙ settings.</p>
        <div class="seg" data-theme-seg>${THEMES.map((t) =>
          `<button data-theme-pick="${t.id}" class="${t.id === currentTheme() ? 'on' : ''}">${t.label}</button>`).join('')}</div>`,
      cta: 'Next',
      onPaint: (root) => {
        root.querySelectorAll('[data-theme-pick]').forEach((b) =>
          b.addEventListener('click', () => {
            setTheme(b.dataset.themePick);
            root.querySelectorAll('[data-theme-pick]').forEach((x) => x.classList.toggle('on', x === b));
          }));
      },
    },
  ];

  if (!pushInstalled()) {
    steps.push({
      title: 'Keep it one tap away',
      body: isIOS()
        ? `<p>Add Pocket Advocate to your Home Screen so it opens like an app and you stay signed in:</p>
           <ol class="intro-steps"><li>Tap the <strong>Share</strong> button ⬆️ at the bottom of Safari</li>
           <li>Scroll down, tap <strong>Add to Home Screen</strong></li>
           <li>Tap <strong>Add</strong> — then open Pocket Advocate from the new icon</li></ol>
           <p class="dim small">This is also how notifications work on iPhone.</p>`
        : `<p>Add Pocket Advocate to your Home Screen so it opens like an app:</p>
           <ol class="intro-steps"><li>Tap the <strong>⋮</strong> menu in Chrome</li>
           <li>Tap <strong>Add to Home screen</strong></li>
           <li>Confirm — then open it from the new icon</li></ol>`,
      cta: 'Done — take me in',
    });
  } else if (!notifOn()) {
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
          ${last ? '' : '<button class="btn quiet" data-skip>Skip</button>'}
          <button class="btn" data-next>${last ? 'Enter my dashboard →' : s.cta || 'Next'}</button>
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
