// Identity gate (Eric, 2026-07-14): before booking or subscribing, every
// client must give first name, last name, and date of birth — Eric needs to
// know who he's talking to, and he doesn't aid minors without guardian
// consent. The Worker re-checks age at checkout; this UI is not trusted.

import { db, doc, getDoc, setDoc } from './firebase.js';

export const MIN_AGE = 18;

export function ageFromDob(dob) {
  const d = new Date(dob + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

/**
 * Resolves with the completed profile, rendering a form into `container`
 * first if anything is missing. Never resolves for under-18s — they get the
 * guardian-consent stop instead.
 */
export async function ensureFullProfile(user, container) {
  const refDoc = doc(db, 'users', user.uid);
  let existing = {};
  try {
    const snapshot = await getDoc(refDoc);
    if (snapshot.exists()) existing = snapshot.data();
  } catch { /* treated as incomplete */ }
  if (existing.firstName && existing.lastName && existing.dob) return existing;

  return new Promise((resolve) => {
    const today = new Date().toISOString().slice(0, 10);
    container.innerHTML = `
      <h2>First — who are we talking with?</h2>
      <p class="muted small">Eric works with real people, by name. This stays between you and him, like everything else here.</p>
      <div class="card">
        <label for="pf-first">First name</label>
        <input type="text" id="pf-first" autocomplete="given-name" value="${esc(existing.firstName || '')}">
        <label for="pf-last" style="margin-top:.6rem;">Last name</label>
        <input type="text" id="pf-last" autocomplete="family-name" value="${esc(existing.lastName || '')}">
        <label for="pf-dob" style="margin-top:.6rem;">Date of birth</label>
        <input type="date" id="pf-dob" max="${today}" value="${esc(existing.dob || '')}">
        <p class="muted small" style="margin-top:.6rem;">Pocket Advocate serves adults. Under 18? A parent or guardian
          needs to reach out first — message through the site or the About page's call button.</p>
        <p class="error" id="pf-err" hidden></p>
        <p style="margin-top:.8rem;"><button class="btn" id="pf-save">Continue</button></p>
      </div>`;

    container.querySelector('#pf-save').addEventListener('click', async () => {
      const err = container.querySelector('#pf-err');
      const firstName = container.querySelector('#pf-first').value.trim();
      const lastName = container.querySelector('#pf-last').value.trim();
      const dob = container.querySelector('#pf-dob').value;
      err.hidden = true;
      if (!firstName || !lastName) {
        err.textContent = 'First and last name, please — Eric needs to know who he\'s working with.';
        err.hidden = false;
        return;
      }
      const age = ageFromDob(dob);
      if (age === null) {
        err.textContent = 'Enter your date of birth.';
        err.hidden = false;
        return;
      }
      if (age < MIN_AGE) {
        container.innerHTML = `
          <h2>We need a guardian for this one</h2>
          <p class="muted">Pocket Advocate doesn't open cases for anyone under 18 without a parent or guardian's
          consent — that's a hard rule, for your protection. Have your parent or guardian get in touch
          (the call button on the <a href="/about.html">About page</a> works), and Eric will take it from there.</p>`;
        return;
      }
      try {
        await setDoc(refDoc, {
          firstName, lastName, dob,
          name: `${firstName} ${lastName}`,
          email: user.email || existing.email || null,
          role: existing.role || 'client',
        }, { merge: true });
        resolve({ ...existing, firstName, lastName, dob });
      } catch (e) {
        err.textContent = `Couldn't save: ${e.message}`;
        err.hidden = false;
      }
    });
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
