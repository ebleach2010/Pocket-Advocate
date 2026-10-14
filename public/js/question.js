// THE QUESTION BOX (Eric, 2026-10-14: "Have a chat box icon at the bottom
// right of the screen and it opens up a window that says 'questions? Type
// them down below and I'll get back to you within two days.' They put their
// name and email and question and press send to have it sent to my inbox.
// Once sent, remind them to check their spam box in case my reply gets sent
// there.")
//
// No Firebase and no sign-in, like the waitlist: a native <dialog>, posted to
// /api/question, which emails him with the reply going straight to them.
// The checks here are the Worker's, in the same words.

/** On a demo host the shim answers the route, so wait for it to mount. */
async function demoReady() {
  try {
    if (/(^|\.)thepocketadvocates\.com$/i.test(location.hostname)) return;
    const q = new URLSearchParams(location.search).get('demo');
    if ((q && q !== '0') || sessionStorage.getItem('pa-demo')) await import('./firebase.js');
  } catch { /* not the demo, or storage blocked: ask the real route */ }
}

export const QUESTION_MAX = 2000;

/** The first problem with the form, in the Worker's words, or ''. */
export function questionProblem(v) {
  if (!v.name) return 'Your name, please.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) return 'A working email address, please. My answer goes there.';
  if (v.question.length < 2) return 'Type your question, please.';
  if (v.question.length > QUESTION_MAX) return `Keep it under ${QUESTION_MAX} characters, please.`;
  return '';
}

function wire() {
  const dlg = document.getElementById('ask');
  if (!dlg) return;
  const form = dlg.querySelector('.wl-form');
  const err = dlg.querySelector('.wl-err');
  const done = dlg.querySelector('.wl-done');
  const go = dlg.querySelector('.wl-go');
  const say = (msg) => { err.textContent = msg; err.hidden = !msg; };

  // A sent question leaves the thank-you up until the box is closed; the next
  // open starts a fresh question.
  const reset = () => {
    if (done.hidden) return;
    form.reset();
    form.hidden = false;
    done.hidden = true;
  };
  for (const b of document.querySelectorAll('[data-ask-open]')) {
    b.addEventListener('click', () => {
      reset();
      dlg.showModal();
      form.elements.name.focus();
    });
  }
  for (const b of dlg.querySelectorAll('[data-ask-close]')) b.addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  form.addEventListener('input', () => say(''));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const el = form.elements;
    const v = {
      name: el.name.value.trim(),
      email: el.email.value.trim(),
      question: el.question.value.trim(),
      website: el.website.value,
    };
    const problem = questionProblem(v);
    if (problem) { say(problem); return; }
    say('');
    go.disabled = true;
    go.textContent = 'Sending...';
    try {
      await demoReady();
      const res = await fetch('/api/question', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(v),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { say(out.error || 'That did not go through. Try again in a moment.'); return; }
      dlg.querySelector('[data-ask-first]').textContent = v.name.split(/\s+/)[0];
      form.hidden = true;
      done.hidden = false;
      done.querySelector('button').focus();
    } catch {
      say('That did not go through. Check your connection and try again.');
    } finally {
      go.disabled = false;
      go.textContent = 'Send';
    }
  });
}

wire();
