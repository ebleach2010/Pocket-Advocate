// The "?" beside the case title. Two questions every new client asks in the
// first week — what actually lives in this file, and how do I get back to it
// without hunting for a browser tab — answered in one closable panel.

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
const installed = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

/** Markup for the trigger. Rendered inline next to the case heading. */
export const HELP_BUTTON =
  '<button class="help-dot" data-case-help aria-label="What is stored here, and how to install the app" title="What is stored here?">?</button>';

/** Wire every [data-case-help] inside `root` to open the panel. */
export function wireCaseHelp(root) {
  root.querySelectorAll('[data-case-help]').forEach((b) =>
    b.addEventListener('click', openCaseHelp));
}

export function openCaseHelp() {
  if (document.getElementById('pa-help')) return;

  const overlay = document.createElement('div');
  overlay.id = 'pa-help';
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-card help-card" role="dialog" aria-modal="true" aria-labelledby="pa-help-title">
      <div class="row">
        <h3 id="pa-help-title" style="margin:0;">Your case file</h3>
        <button class="btn quiet" data-close aria-label="Close">Close</button>
      </div>

      <p>Everything about your case lives here, in one place, for as long as you want it. Nothing in it is shared with anyone — not your hospital, not your insurer, not anybody — unless you send it to them yourself.</p>

      <h4>What's stored here</h4>
      <ul class="help-list">
        <li><strong>Progress</strong> — where your case stands, your appointment time, and how to join the call.</li>
        <li><strong>Chat</strong> — every message between you and me, kept permanently. Photos and files sent in chat can be saved straight into your documents.</li>
        <li><strong>Documents</strong> — labs, imaging, records and letters. Upload from either end, any time before or after the call. PDFs, photos, HEIC, DICOM and ZIPs up to 25&nbsp;MB each.</li>
        <li><strong>The recording</strong> of our discussion, once it lands in your file.</li>
        <li><strong>Your written report</strong>, within 7 days of the call.</li>
      </ul>
      <p class="dim small">When a case closes, none of it goes away — the file stays yours. This is an advocacy record, not a medical record: nothing in it is a diagnosis, treatment, or medical advice.</p>

      <h4>Keep it one tap away</h4>
      ${installed()
        ? `<p>You've already added Pocket Advocate to your Home Screen. ✓ Open it from that icon and you'll stay signed in.</p>`
        : `<p>Add Pocket Advocate to your Home Screen and it opens like an app, keeps you signed in, and can notify you when I reply or your report lands. It takes under a minute.</p>
      <p class="help-os"><strong>iPhone &amp; iPad</strong></p>
      <ol class="help-list">
        <li>Open this site in <strong>Safari</strong> (it has to be Safari, not Chrome).</li>
        <li>Tap <strong>Share</strong> — the square with an arrow pointing up.</li>
        <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
        <li>Tap <strong>Add</strong>, then open Pocket Advocate from the new icon.</li>
      </ol>
      <p class="help-os"><strong>Android</strong></p>
      <ol class="help-list">
        <li>Open this site in <strong>Chrome</strong>.</li>
        <li>Tap the <strong>⋮</strong> menu at the top right.</li>
        <li>Tap <strong>Add to Home screen</strong>, then <strong>Add</strong>.</li>
      </ol>
      <p class="dim small">${isIOS()
        ? 'On iPhone, notifications only work once the app is on your Home Screen — that\'s an Apple rule, not mine.'
        : 'Stuck? Send me a message in chat and I\'ll walk you through it.'}</p>`}
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
