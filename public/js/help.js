// The "?" panels. Two of them, one shell:
//   openAppHelp()  — on the landing page, next to "This is a web app"
//   openCaseHelp() — beside the case title, for what's actually in the file
// Both answer the questions clients ask in week one and nobody wants to email
// about: what is this thing, where does it live, and will it tell me anything.

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const installed = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

/** Markup for a trigger. `kind` picks which panel it opens. */
export const helpButton = (kind = 'case', label = 'More information') =>
  `<button class="help-dot" data-help="${kind}" aria-label="${label}" title="${label}">?</button>`;

export const HELP_BUTTON = helpButton('case', 'What is stored here, and how to install the app');

/** Wire every [data-help] inside `root`. */
export function wireHelp(root) {
  root.querySelectorAll('[data-help]').forEach((b) =>
    b.addEventListener('click', () => (
      b.dataset.help === 'app' ? openAppHelp()
        : b.dataset.help === 'telehealth' ? openTelehealthHelp()
          : openCaseHelp())));
}

/**
 * The ground rules for appointment advocacy, stated before anyone pays:
 * who controls the visit, what happens if the answer is no, and the one
 * thing that never happens (recording). Plain enough to read in the
 * waiting room.
 */
export function openTelehealthHelp() {
  openPanel('Bringing me to your appointment', `
    <p><strong>What it is.</strong> You have a telehealth visit with one of
      your own providers; I join it by video as your patient advocate. I make
      sure your questions actually get asked, I take notes so nothing is lost,
      and afterwards the notes land in your case file.</p>
    <p><strong>It is your invitation.</strong> You have every right to have a
      support person in your own appointment. Tell the clinic's office your
      advocate is joining when you confirm the visit, and send me the visit
      link in chat once you have it.</p>
    <p><strong>Your provider runs the visit.</strong> They may ask who I am,
      and a clinic can decline a third person on the call. If that happens,
      or if I can't attend, anything you paid for that appointment comes back
      to you in full.</p>
    <p><strong>I never record it.</strong> Your provider's visit is theirs.
      My role on that screen is notes and advocacy only, and nothing about
      the visit is a diagnosis or medical advice from me.</p>`);
}

// ---- the shell ----

function openPanel(title, bodyHtml) {
  if (document.getElementById('pa-help')) return;

  const overlay = document.createElement('div');
  overlay.id = 'pa-help';
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-card help-card" role="dialog" aria-modal="true" aria-labelledby="pa-help-title">
      <div class="row">
        <h3 id="pa-help-title" style="margin:0;">${title}</h3>
        <button class="btn quiet" data-close aria-label="Close">Close</button>
      </div>
      ${bodyHtml}
    </div>`;

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  function onKey(e) { if (e.key === 'Escape') close(); }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-close]').addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  overlay.querySelector('[data-close]').focus();
}

// ---- shared blocks ----

/** Home Screen steps for both platforms, or a tick if it's already installed. */
function installBlock() {
  if (installed())
    return `<p>You've already added Pocket Advocate to your Home Screen. ✓ Open it from that icon and you'll stay signed in.</p>`;
  return `
    <p class="help-os"><strong>iPhone &amp; iPad</strong></p>
    <ol class="help-list">
      <li>Open this site in <strong>Safari</strong> (it has to be Safari, not Chrome).</li>
      <li>Tap <strong>Share</strong>, the square with an arrow pointing up.</li>
      <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
      <li>Tap <strong>Add</strong>, then open Pocket Advocate from the new icon.</li>
    </ol>
    <p class="help-os"><strong>Android</strong></p>
    <ol class="help-list">
      <li>Open this site in <strong>Chrome</strong>.</li>
      <li>Tap the <strong>⋮</strong> menu at the top right.</li>
      <li>Tap <strong>Add to Home screen</strong>, then <strong>Add</strong>.</li>
    </ol>`;
}

/** Who gets told what, split honestly by platform. */
function notificationsBlock() {
  return `
    <h4>Notifications</h4>
    <p>With the app on your Home Screen and notifications turned on, your phone tells you when <strong>I reply</strong>, when a <strong>document lands</strong> in your file, and when your <strong>report is ready</strong>. You don't have to keep checking back.</p>
    <p>It runs both ways. When you message me, <strong>my phone tells me</strong>. That's how you get an answer without sending a second email asking whether I saw the first one.</p>
    <p class="dim small">${isIOS()
      ? 'On iPhone, notifications only work once the app is on your Home Screen. That\'s Apple\'s rule, not mine, and a Safari tab can\'t receive them.'
      : 'On Android and desktop Chrome, notifications work in the browser too. On iPhone they need the Home Screen icon. Apple\'s rule, not mine.'}</p>`;
}

/** The one-more-code surprise, explained before it happens. */
function signInBlock() {
  return `
    <h4>Signing in</h4>
    <p>No password. You type your email, I send a 6-digit code, and that device stays signed in afterwards.</p>
    <p><strong>Adding the app to your Home Screen asks for one more code.</strong> That's expected, and it only happens once: your phone treats the installed app as a separate place from your browser, so it starts out signed out. After that one code, it stays signed in.</p>
    <p>You never have to install anything. Signing in through a normal browser works exactly the same and always will. The Home Screen icon just adds notifications and saves you hunting for the tab.</p>`;
}

// ---- the two panels ----

export function openAppHelp() {
  openPanel('This is a web app', `
    <p>There's nothing to download and no App Store. Pocket Advocate runs in your browser, and it can also sit on your Home Screen with its own icon and open like a normal app.</p>

    <h4>Putting it on your Home Screen</h4>
    <p>Worth doing whenever you like, before you book or after. It opens full-screen, keeps you signed in, and on an iPhone it's the only way the app can notify you.</p>
    ${installBlock()}

    ${notificationsBlock()}

    ${signInBlock()}`);
}

export function openCaseHelp() {
  openPanel('Your case file', `
    <p>Everything about your case lives here, in one place, for as long as you want it. Nothing in it is shared with anyone: not your hospital, not your insurer, not anybody — unless you send it to them yourself.</p>

    <h4>What's stored here</h4>
    <ul class="help-list">
      <li><strong>Progress</strong>: where your case stands, your appointment time, and how to join the call.</li>
      <li><strong>Chat</strong>: every message between you and me, kept permanently. Photos and files sent in chat can be saved straight into your documents.</li>
      <li><strong>Passing on a question</strong>: if I ask something you'd rather not answer, tap the little ⚐ flag under that question. It fills in red and marks it <strong>PASS</strong>: I won't ask again, I won't ask why, we just move on. You never owe me an explanation.</li>
      <li><strong>Documents</strong>: labs, imaging, records and letters. Upload from either end, any time before or after the call. PDFs, photos, HEIC, DICOM and ZIPs up to 25&nbsp;MB each.</li>
      <li><strong>The recording</strong> of our discussion, once it lands in your file.</li>
      <li><strong>Your written report</strong>, within 7 days of the call.</li>
    </ul>
    <p class="dim small">When a case closes, none of it goes away. The file stays yours. This is an advocacy record, not a medical record: nothing in it is a diagnosis, treatment, or medical advice.</p>

    <h4>Keep it one tap away</h4>
    <p>Add Pocket Advocate to your Home Screen and it opens like an app, keeps you signed in, and can notify you. It takes under a minute.</p>
    ${installBlock()}

    ${notificationsBlock()}

    ${signInBlock()}`);
}
