// The "?" panels. Four of them, one shell:
//   openAppHelp()        on the landing page, next to "This is a web app"
//   openCaseHelp()       beside the case title, for what is actually in the file
//   openTelehealthHelp() the ground rules for joining an appointment
//   openHoursHelp()      beside the chat: when will Eric respond
// They answer the questions clients ask in week one and nobody wants to email
// about: what is this thing, where does it live, and will it tell me anything.

// office.js has no imports of its own, so this costs the landing page a few
// hundred bytes and never drags the data layer onto it.
import {
  officeNow, readOffice, watchOffice, officeLabel, localHoursNote,
} from './office.js';

// His hours sentence, named once so it exists in exactly one place. The
// paragraph a client reads and the string the local-time line is computed from
// are THE SAME STRING, so "8:00 AM to 7:00 PM Mountain" and "X to Y your time"
// cannot come to state two different windows however either is edited.
const HOURS_LINE = 'Standard advocacy hours are Monday to Friday, 8:00 AM to 7:00 PM Mountain Time, unless my current status shows otherwise.';

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
          : b.dataset.help === 'hours' ? openHoursHelp()
            : openCaseHelp())));
}

/**
 * "When will Eric respond?" - the sheet behind the "?" beside the chat.
 *
 * THE COPY IS HIS, WORD FOR WORD (2026-08-27), with one class of change and
 * one only: the app forbids em and en dashes anywhere a person reads, and his
 * draft had three. "Monday-Friday" and "8:00 AM-7:00 PM" became "Monday to
 * Friday" and "8:00 AM to 7:00 PM"; the dash before "not simply the order"
 * became a comma. Nothing else in it may be edited, shortened or reworded.
 *
 * His current status sits at the top, above the copy, because the first line
 * of that copy defers to it ("unless my current status shows otherwise").
 *
 * The one sentence he asked to be emphasised gets its own block. It is still
 * the first sentence of its paragraph and the paragraph still reads in his
 * order; it is set apart rather than reordered.
 *
 * NO RESPONSE TIME IS PRINTED unless he has set one by hand. There is no
 * default, no "usually within", nothing computed from his hours.
 *
 * BOTH CLOCKS. Under his hours sentence sits the same window in the reader's
 * own timezone, worked out in their browser from that same sentence. Most
 * clients are not in Mountain time and "8:00 AM Mountain" is arithmetic they
 * should not have to do while they are ill. If the browser cannot say where it
 * is, the line is simply absent and the sheet reads exactly as it did before:
 * Mountain alone, never a guess and never a blank pair of brackets.
 */
export function openHoursHelp() {
  const s = officeNow();
  const rt = s?.responseTime;
  const local = localHoursNote(HOURS_LINE);
  const localLine = local ? `<p class="hours-local">That is ${esc(local)}.</p>` : '';
  openPanel('When will Eric respond?', `
    <p class="hours-now">
      <span class="office-cue${s ? '' : ' unknown'}" data-office role="status"
        ><span class="p-dot" aria-hidden="true"></span
        ><span class="p-label">${officeLabel(s)}</span></span>
    </p>
    ${rt ? `<p class="hours-set">${esc(rt)}</p>` : ''}

    <p>${HOURS_LINE}</p>${localLine}

    <p>I check messages throughout the day, but responses are triaged based on
      urgency, time sensitivity, and what each case needs, not simply the order
      messages arrive.</p>

    <p>A time-sensitive issue, such as an appointment happening soon, a problem
      accessing care, a deadline, or an important change in your situation, may
      be prioritized ahead of a routine question or update.</p>

    <p class="hours-key">If I haven't responded yet, that doesn't necessarily
      mean I'm not working on your case.</p>
    <p>A significant part of advocacy happens behind the scenes. I may be
      reviewing your records, researching your case, preparing for an
      appointment, working through next steps, contacting or preparing
      communication for your care team, or handling something that indirectly
      moves your case forward.</p>

    <p>Some messages also deserve more than a quick answer. If I need to review
      information or do additional work before giving you a useful response, I
      may intentionally wait to respond until I can give the question the
      attention it deserves.</p>

    <p>You're always welcome to send messages outside office hours. I'll see
      them when I'm back in office.</p>

    <p class="hours-safety">This chat is not an emergency or real-time medical
      service. If something requires immediate medical attention, use the
      appropriate emergency or medical resources available to you.</p>`,
  (overlay) => {
    // The pill inside the sheet is live like every other one, and the sheet
    // may well be the first thing on the page to ask. Without the re-read, a
    // client who opened the sheet before the first answer landed would sit
    // looking at "Checking" with no status at all.
    watchOffice(overlay);
    readOffice();
  });
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

/** Escapes text that came from a settings document rather than this file. */
function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// `after(overlay)` runs once the card is on the page, for a panel that has
// something live in it. Optional; the three older panels pass nothing.
function openPanel(title, bodyHtml, after = null) {
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
  try { after?.(overlay); } catch (err) { console.warn('help panel:', err); }
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
    <p>Everything about your case lives here, in one place, for as long as you want it. Nothing in it is shared with anyone: not your hospital, not your insurer, not anybody, unless you send it to them yourself.</p>

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
