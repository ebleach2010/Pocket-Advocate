// Folded-in sign-in (PR 69): the email and 6-digit code happen inside the
// booking and subscribe pages instead of bouncing new visitors to a separate
// sign-in screen. Same Worker endpoints, same device-token trust, same
// residency attestation as signin.html — only the container changed.

import { auth, signInWithCustomToken } from './firebase.js';
import { recallEmail, rememberEmail } from './auth.js';

const DEVICE_KEY = 'pa-device-token';

/**
 * Renders the email → code card into `container` and resolves with the
 * signed-in Firebase user. Call only when there is no current user.
 * The admin's password path is rare and stays on /signin.html.
 */
export function ensureSignedIn(container, { returnTo = location.pathname } = {}) {
  return new Promise((resolve) => {
    let pendingEmail = '';

    container.innerHTML = `
      <div class="card auth-inline">
        <div id="ia-email-form">
          <h3>First, your email</h3>
          <p class="muted small">A 6 digit code signs you in. No password to remember, nothing to install.</p>
          <label for="ia-email">Email address</label>
          <input type="email" id="ia-email" autocomplete="email" placeholder="you@example.com">
          <label class="check-row" style="margin-top:.8rem;">
            <input type="checkbox" id="ia-attest"> I confirm I am a resident of the United States or Canada. This service is offered to US and Canadian residents only.
          </label>
          <p class="error" id="ia-error" hidden></p>
          <p style="margin-top:1rem;"><button class="btn glow" id="ia-send">Send my code</button></p>
        </div>
        <div id="ia-code-form" hidden>
          <h3>Enter your code</h3>
          <p class="muted small">We sent a 6 digit code to <strong id="ia-code-to"></strong>. It arrives in a few seconds and expires in 10 minutes.</p>
          <label for="ia-code">6 digit code</label>
          <input type="text" id="ia-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="123456" style="letter-spacing:6px; font-size:1.4rem; text-align:center;">
          <p class="error" id="ia-code-error" hidden></p>
          <p style="margin-top:1rem;">
            <button class="btn quiet" id="ia-back">← Back</button>
            <button class="btn glow" id="ia-verify">Sign in</button>
          </p>
          <p class="muted small" style="margin-top:.6rem;">Didn't get it? Check <strong>Spam</strong> or <strong>Promotions</strong>. <a href="#" id="ia-resend">Send a new code</a></p>
        </div>
      </div>`;

    const $ = (id) => container.querySelector('#' + id);
    const errEl = $('ia-error');
    const codeErr = $('ia-code-error');

    const known = recallEmail();
    if (known) $('ia-email').value = known;

    // A device that already proved a code once resumes on the email alone,
    // silently — the card only asks for a code when it has to.
    const deviceToken = localStorage.getItem(DEVICE_KEY) || '';
    if (known && deviceToken) {
      (async () => {
        try {
          const res = await fetch('/api/auth/device-signin', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: known, deviceToken }),
          });
          if (!res.ok) throw new Error('needs a code');
          const { token } = await res.json();
          const cred = await signInWithCustomToken(auth, token);
          finish(cred.user);
        } catch {
          localStorage.removeItem(DEVICE_KEY);
        }
      })();
    }

    function finish(user) {
      container.innerHTML = '';
      resolve(user);
    }

    async function requestCode(email) {
      try {
        const res = await fetch('/api/auth/request-code', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        const out = await res.json();
        if (!res.ok) throw new Error(out.error || 'Try again.');
        pendingEmail = email;
        rememberEmail(email);
        if (out.mode === 'password') {
          // Admin address — the password screen lives on the sign-in page.
          location.href = `/signin.html?to=${encodeURIComponent(returnTo)}`;
          return;
        }
        $('ia-email-form').hidden = true;
        $('ia-code-to').textContent = email;
        $('ia-code-form').hidden = false;
        $('ia-code').focus();
      } catch (err) {
        errEl.textContent = `Couldn't send the code: ${err.message}`;
        errEl.hidden = false;
      }
    }

    $('ia-send').addEventListener('click', async () => {
      const email = $('ia-email').value.trim();
      errEl.hidden = true;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        errEl.textContent = 'Enter a valid email address.';
        errEl.hidden = false;
        return;
      }
      // Same gate as signin.html: clients attest residency; a known admin
      // device skips it (the admin never books, but parity keeps this honest).
      if (!$('ia-attest').checked && localStorage.getItem('pa-admin-device') !== '1') {
        errEl.textContent = 'This service is available to US and Canadian residents only.';
        errEl.hidden = false;
        return;
      }
      await requestCode(email);
    });

    $('ia-verify').addEventListener('click', async () => {
      const code = $('ia-code').value.trim();
      codeErr.hidden = true;
      if (!/^\d{6}$/.test(code)) {
        codeErr.textContent = 'Enter the 6 digit code from your email.';
        codeErr.hidden = false;
        return;
      }
      try {
        const res = await fetch('/api/auth/verify-code', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email: pendingEmail, code }),
        });
        if (!res.ok) throw new Error((await res.json()).error || 'Invalid code.');
        const { token, deviceToken: issued } = await res.json();
        if (issued) localStorage.setItem(DEVICE_KEY, issued);
        const cred = await signInWithCustomToken(auth, token);
        finish(cred.user);
      } catch (err) {
        codeErr.textContent = err.message;
        codeErr.hidden = false;
      }
    });

    $('ia-code').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); $('ia-verify').click(); }
    });
    $('ia-back').addEventListener('click', () => {
      $('ia-code-form').hidden = true;
      $('ia-email-form').hidden = false;
    });
    $('ia-resend').addEventListener('click', (e) => {
      e.preventDefault();
      if (pendingEmail) requestCode(pendingEmail);
    });
  });
}
