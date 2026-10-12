// THE WAITLIST BUBBLE (Eric, 2026-10-12: "a small 'join the waitlist' that's
// in a shining text bubble at the top right of the screen. Have them fill out
// their first and last name, email, and phone number and desired package in a
// dropdown. Once submitted, a short message that I'll get back to them soon.")
//
// No Firebase and no sign-in: the sheet is a native <dialog>, the form posts
// to /api/waitlist, and the Worker keeps the row where no page can read it.
// The checks here are the Worker's, in the same words, so a person hears
// about a missing field before anything is sent.

/** On a demo host the shim answers the route, so wait for it to mount. */
async function demoReady() {
  try {
    if (/(^|\.)thepocketadvocates\.com$/i.test(location.hostname)) return;
    const q = new URLSearchParams(location.search).get('demo');
    if ((q && q !== '0') || sessionStorage.getItem('pa-demo')) await import('./firebase.js');
  } catch { /* not the demo, or storage blocked: ask the real route */ }
}

/** The first problem with the form, in the Worker's words, or ''. */
export function waitlistProblem(v) {
  if (!v.first) return 'Your first name, please.';
  if (!v.last) return 'Your last name, please.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) return 'A working email address, please.';
  if (!/^\+?[\d\s().-]{7,20}$/.test(v.phone)) return 'A valid phone number, please.';
  if (!['chat', 'case', 'full'].includes(v.package)) return 'Pick the package you want.';
  return '';
}

function wire() {
  const dlg = document.getElementById('waitlist');
  if (!dlg) return;
  const form = dlg.querySelector('.wl-form');
  const err = dlg.querySelector('.wl-err');
  const done = dlg.querySelector('.wl-done');
  const go = dlg.querySelector('.wl-go');
  const say = (msg) => { err.textContent = msg; err.hidden = !msg; };

  for (const b of document.querySelectorAll('[data-waitlist-open]')) {
    b.addEventListener('click', () => {
      dlg.showModal();
      if (!done.hidden) return;
      form.elements.first.focus();
    });
  }
  for (const b of dlg.querySelectorAll('[data-waitlist-close]')) b.addEventListener('click', () => dlg.close());
  // A tap on the dimmed page around the sheet closes it, like Escape does.
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

  // The old complaint goes the moment they start fixing it.
  form.addEventListener('input', () => say(''));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const el = form.elements;
    const v = {
      first: el.first.value.trim(),
      last: el.last.value.trim(),
      email: el.email.value.trim(),
      phone: el.phone.value.trim(),
      package: el.package.value,
      website: el.website.value,
    };
    const problem = waitlistProblem(v);
    if (problem) { say(problem); return; }
    say('');
    go.disabled = true;
    go.textContent = 'Sending...';
    try {
      await demoReady();
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(v),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { say(out.error || 'That did not go through. Try again in a moment.'); return; }
      dlg.querySelector('[data-wl-first]').textContent = v.first;
      form.hidden = true;
      done.hidden = false;
      done.querySelector('button').focus();
    } catch {
      say('That did not go through. Check your connection and try again.');
    } finally {
      go.disabled = false;
      go.textContent = 'Join the waitlist';
    }
  });
}

wire();
