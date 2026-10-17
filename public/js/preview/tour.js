// The preview's guided tour (Eric, 2026-10-15): "Have it go step by step
// through what each tab means by starting with a short welcome to the
// preview and what they'll find in there / what they'll be able to do in real
// life and what they can test in the suite. Highlighting each section one at
// a time with a small window explaining what it is. Then hit next for the
// next section of the tutorial/overview until they can browse the suite."
//
// A welcome card, then one section of Joe's case at a time: everything else
// dims, the section is ringed, and a small card at the foot of the screen
// says what it is. Next and Back move through; Skip ends it. It runs once
// per visit: the flag lives in the preview's own store, which Exit wipes, so
// the next visitor gets the tour again.

const STEPS = [
  {
    title: 'Welcome to the preview',
    body: 'This is Joe, an invented client about three weeks into his case. A real client sees exactly this: their case, their chat with Eric, their documents and their progress, all in one place. Here you can try all of it. Send a message, upload a file, sign a form. Nothing leaves this browser, and it all disappears when you tap Exit.',
    next: 'Show me around',
  },
  { at: '.case-folder .folder-tabs', title: 'Five tabs', body: 'Progress, Chat, Docs, Enhance and Saved. Tap a tab to switch, or swipe left and right. Next, a quick look at each.' },
  { tab: 'progress', at: '[data-appt]', title: 'Progress, at a glance', body: 'The call, what was paid and what comes next. This is the first thing a client sees.' },
  { tab: 'progress', at: '[data-cheer]', title: 'Every step, celebrated 🎉', body: 'As the case moves forward, this fills up. Joe\'s report is ready, so he is six steps in.' },
  { tab: 'progress', at: '[data-hours-card]', title: 'Hours, out in the open', body: 'On Full-Service you see every hour Eric works on the case, and what he is doing right now.' },
  { tab: 'progress', at: '[data-worklog]', title: 'The work log', body: 'Every call, fax and appeal made for the case, with the date and who it was with.' },
  { tab: 'chat', at: '[data-chat-who]', title: 'Eric, in office', body: 'The green pill means Eric is in. Tap the ? any time to see when he answers.' },
  // Its card sits at the top (2026-10-17): at the foot it covered the message box it points to.
  { tab: 'chat', at: '[data-chat]', top: true, title: 'Chat', body: 'Records, scheduling, anything new or urgent with your health. Try it: type a message and tap Send, and see how a reply feels.' },
  { tab: 'chat', at: '[data-nextcall]', title: 'For the next call', body: 'Questions for the call go on this list, and you go through them together on the call.' },
  { tab: 'docs', at: '[data-drop]', title: 'Docs: add anything', body: 'Labs, imaging, letters. Tap here to add a file. Try one: in the preview it stays in this browser.' },
  { tab: 'docs', at: '[data-files]', title: 'Every file in one place', body: 'Uploads, files from the chat, the call recording and Eric\'s report. Joe adds a couple most days.' },
  { tab: 'addons', at: '.fpage[data-page="addons"] .case-sec-h', title: 'Enhance', body: 'Extras for the case when you need them, like a telehealth visit with Eric beside you, or a follow-up call. In the preview nothing can be bought.' },
  { tab: 'saved', at: '.ftab[data-page="saved"]', title: 'Saved', body: 'Hold any chat message and save it, and it waits here for later.' },
  { at: '.pv-exit', title: 'Exit any time', body: 'Tap Exit to leave the preview. Everything you did here is erased.' },
  { title: 'Your turn', body: 'That is the tour. Look around: open every tab, send a message, upload something.', next: 'Start exploring' },
];

const CSS = `
  .pv-tour { position: fixed; inset: 0; z-index: 70; }
  .pv-tour-shade { position: absolute; inset: 0; background: rgba(14, 8, 11, .72); }
  .pv-tour.lit .pv-tour-shade { background: transparent; }
  .pv-tour-spot {
    position: fixed; display: none; border-radius: 18px; pointer-events: none;
    box-shadow: 0 0 0 9999px rgba(14, 8, 11, .72), 0 0 0 2px #FFB27A, 0 0 24px 4px rgba(255, 150, 105, .45);
  }
  .pv-tour.lit .pv-tour-spot { display: block; }
  .pv-tour-card {
    position: fixed; left: 16px; right: 16px; bottom: max(16px, env(safe-area-inset-bottom, 0px));
    max-width: 26rem; margin: 0 auto; padding: 1.05rem 1.1rem 1rem;
    border: 1.5px solid transparent; border-radius: 20px;
    background: linear-gradient(#30232A, #30232A) padding-box, linear-gradient(110deg, #FFC48A 0%, #FF9E7D 50%, #F59BBF 100%) border-box;
    color: #FFF5EE; box-shadow: 0 24px 70px rgba(10, 4, 6, .6);
    font: 500 .95rem/1.5 'Manrope', -apple-system, 'Segoe UI', system-ui, sans-serif;
  }
  .pv-tour.center .pv-tour-card { top: 50%; bottom: auto; transform: translateY(-50%); }
  .pv-tour.top .pv-tour-card { top: calc(var(--pv-hb, 64px) + 8px); bottom: auto; }
  .pv-tour-n { margin: 0 0 .2rem; color: #FFC48A; font-size: .74rem; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; }
  .pv-tour-card h2 { margin: 0 0 .35rem; font: 600 1.15rem/1.3 'Sora', 'Manrope', system-ui, sans-serif; letter-spacing: -.01em; color: #FFF5EE; }
  .pv-tour-card p.pv-tour-b { margin: 0 0 .9rem; color: #F2E1D6; }
  .pv-tour-acts { display: flex; align-items: center; gap: .5rem; }
  .pv-tour-acts button {
    min-height: 44px; padding: .5rem 1.1rem; border-radius: 999px; cursor: pointer;
    font: 700 .9rem/1 'Manrope', -apple-system, 'Segoe UI', system-ui, sans-serif;
  }
  .pv-tour-next { margin-left: auto; border: 0; background: linear-gradient(110deg, #FFC48A 0%, #FF9E7D 50%, #F59BBF 100%); color: #2B1207; }
  .pv-tour-back, .pv-tour-skip { border: 1px solid rgba(255, 214, 190, .25); background: transparent; color: #F2E1D6; }
  .pv-tour-acts button:focus-visible { outline: 2px solid #FFF5EE; outline-offset: 2px; }
  .pv-tour-dots { display: flex; gap: 5px; margin: 0 0 .7rem; }
  .pv-tour-dots i { width: 6px; height: 6px; border-radius: 50%; background: rgba(255, 214, 190, .25); }
  .pv-tour-dots i.on { width: 16px; border-radius: 999px; background: #FFB27A; }
  @media (prefers-reduced-motion: no-preference) {
    .pv-tour-spot { transition: top .25s ease, left .25s ease, width .25s ease, height .25s ease; }
    .pv-tour-card { animation: pv-tour-in .25s ease-out; }
  }
  @keyframes pv-tour-in { from { opacity: 0; transform: translateY(8px); } }
  .pv-tour.center .pv-tour-card { animation: none; }
  /* Blue and green (2026-10-17: the look past the home): the same card in the cyan to violet. */
  :root[data-look="cool"]:not([data-scheme="contrast"]) .pv-tour-shade { background: rgba(4, 6, 10, .74); }
  :root[data-look="cool"]:not([data-scheme="contrast"]) .pv-tour.lit .pv-tour-shade { background: transparent; }
  :root[data-look="cool"]:not([data-scheme="contrast"]) .pv-tour-spot { box-shadow: 0 0 0 9999px rgba(4, 6, 10, .74), 0 0 0 2px #3DDCF5, 0 0 24px 4px rgba(61, 220, 245, .45); }
  :root[data-look="cool"]:not([data-scheme="contrast"]) .pv-tour-card {
    background: linear-gradient(#14161C, #14161C) padding-box, linear-gradient(110deg, #3DDCF5 0%, #9BEBFA 48%, #B9A6FF 100%) border-box;
    color: #F2F5FA; box-shadow: 0 24px 70px rgba(0, 0, 0, .6);
  }
  :root[data-look="cool"]:not([data-scheme="contrast"]) .pv-tour-n { color: #3DDCF5; }
  :root[data-look="cool"]:not([data-scheme="contrast"]) .pv-tour-card h2 { color: #F2F5FA; }
  :root[data-look="cool"]:not([data-scheme="contrast"]) .pv-tour-card p.pv-tour-b { color: #CDD3DE; }
  :root[data-look="cool"]:not([data-scheme="contrast"]) .pv-tour-next { background: linear-gradient(110deg, #3DDCF5 0%, #9BEBFA 48%, #B9A6FF 100%); color: #04161C; }
  :root[data-look="cool"]:not([data-scheme="contrast"]) :is(.pv-tour-back, .pv-tour-skip) { border-color: rgba(200, 225, 255, .25); color: #CDD3DE; }
  :root[data-look="cool"]:not([data-scheme="contrast"]) .pv-tour-dots i { background: rgba(200, 225, 255, .25); }
  :root[data-look="cool"]:not([data-scheme="contrast"]) .pv-tour-dots i.on { background: #3DDCF5; }`;

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const visible = (el) => !!el && el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

/** Opens the tour once the case has painted, unless this visit has had it. */
export async function startTour({ seen, markSeen }) {
  if (seen() || !/^\/case(\.html)?$/.test(location.pathname)) return;
  // The case paints after the store answers; give it a few seconds.
  for (let i = 0; i < 40 && !document.querySelector('.case-folder .folder-tabs'); i++) await wait(150);
  if (!document.querySelector('.case-folder .folder-tabs') || document.querySelector('.pv-tour')) return;
  runTour(markSeen);
}

function runTour(markSeen) {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.className = 'pv-tour';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'pv-tour-t');
  root.innerHTML = `
    <div class="pv-tour-shade"></div>
    <div class="pv-tour-spot"></div>
    <div class="pv-tour-card" aria-live="polite">
      <p class="pv-tour-n" data-tour-n></p>
      <div class="pv-tour-dots" aria-hidden="true">${STEPS.map(() => '<i></i>').join('')}</div>
      <h2 id="pv-tour-t" data-tour-t></h2>
      <p class="pv-tour-b" data-tour-b></p>
      <div class="pv-tour-acts">
        <button type="button" class="pv-tour-skip" data-tour-skip>Skip</button>
        <button type="button" class="pv-tour-back" data-tour-back>Back</button>
        <button type="button" class="pv-tour-next" data-tour-next>Next</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  const spot = root.querySelector('.pv-tour-spot');
  const card = root.querySelector('.pv-tour-card');
  let i = 0;
  let target = null;
  let raf = 0;
  let alive = true;

  const headerBottom = () => {
    const bar = document.querySelector('header.bar');
    return bar ? Math.max(0, bar.getBoundingClientRect().bottom) : 0;
  };
  // The ring follows its section every frame: the page repaints underneath
  // (the hours card ticks), and a phone scrolls under a finger.
  const place = () => {
    if (!alive) return;
    if (target && !target.isConnected) target = document.querySelector(STEPS[i].at);
    if (target && visible(target)) {
      const r = target.getBoundingClientRect();
      const up = root.classList.contains('top');
      const top = Math.max(r.top - 8, up ? card.getBoundingClientRect().bottom + 10 : 4);
      const bottom = Math.min(r.bottom + 8, up ? window.innerHeight - 4 : card.getBoundingClientRect().top - 10);
      const pad = 8;
      spot.style.left = `${Math.max(4, r.left - pad)}px`;
      spot.style.width = `${Math.min(window.innerWidth - 8, r.width + pad * 2)}px`;
      spot.style.top = `${top}px`;
      spot.style.height = `${Math.max(24, bottom - top)}px`;
    }
    raf = requestAnimationFrame(place);
  };

  const show = async (n, dir = 1) => {
    i = Math.max(0, Math.min(STEPS.length - 1, n));
    const step = STEPS[i];
    if (step.tab) {
      const tab = document.querySelector(`.ftab[data-page="${step.tab}"]`);
      if (tab && !tab.classList.contains('on')) { tab.click(); await wait(450); }
    }
    target = step.at ? document.querySelector(step.at) : null;
    // A section that is not on this case (or not loaded yet) is skipped over,
    // in whichever direction the tour is going.
    if (step.at && !visible(target)) {
      for (let k = 0; k < 8 && !visible(target); k++) { await wait(150); target = document.querySelector(step.at); }
      if (!visible(target)) {
        const m = i + dir;
        if (m >= 0 && m < STEPS.length) return show(m, dir);
        target = null;
      }
    }
    // A tab off the end of the rail is brought into view sideways first.
    if (target?.closest('.folder-tabs')) target.scrollIntoView({ block: 'nearest', inline: 'center' });
    root.classList.toggle('center', !target);
    root.classList.toggle('lit', !!target);
    root.classList.toggle('top', !!(target && step.top));
    root.style.setProperty('--pv-hb', `${headerBottom()}px`);
    if (target && step.top) {
      // The foot of the section on screen: for Chat, the box to type in.
      const r = target.getBoundingClientRect();
      if (r.bottom > window.innerHeight - 14) window.scrollTo({ top: Math.max(0, window.scrollY + r.bottom - window.innerHeight + 14), behavior: 'auto' });
    } else if (target) {
      const r = target.getBoundingClientRect();
      const room = window.innerHeight - headerBottom() - card.offsetHeight - 40;
      const fixedTarget = getComputedStyle(target.closest('.pv-strip') || target).position === 'sticky';
      if (!fixedTarget && (r.top < headerBottom() + 8 || r.top > headerBottom() + Math.max(40, room - r.height))) {
        window.scrollTo({ top: Math.max(0, window.scrollY + r.top - headerBottom() - 14), behavior: 'auto' });
      }
    }
    root.querySelector('[data-tour-n]').textContent = i === 0 ? 'Preview' : `${i} of ${STEPS.length - 1}`;
    root.querySelector('[data-tour-t]').textContent = step.title;
    root.querySelector('[data-tour-b]').textContent = step.body;
    root.querySelectorAll('.pv-tour-dots i').forEach((d, k) => d.classList.toggle('on', k === i));
    root.querySelector('[data-tour-back]').hidden = i === 0;
    root.querySelector('[data-tour-skip]').hidden = i === STEPS.length - 1;
    const next = root.querySelector('[data-tour-next]');
    next.textContent = step.next || 'Next';
    next.focus({ preventScroll: true });
  };

  const end = () => {
    if (!alive) return;
    alive = false;
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey, true);
    root.remove();
    style.remove();
    markSeen();
    // Back to the start of the case, free to browse.
    document.querySelector('.ftab[data-page="progress"]')?.click();
    window.scrollTo({ top: 0, behavior: 'auto' });
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); end(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (i === STEPS.length - 1) end(); else show(i + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); show(i - 1, -1); }
  };
  root.querySelector('[data-tour-next]').addEventListener('click', () => (i === STEPS.length - 1 ? end() : show(i + 1)));
  root.querySelector('[data-tour-back]').addEventListener('click', () => show(i - 1, -1));
  root.querySelector('[data-tour-skip]').addEventListener('click', end);
  document.addEventListener('keydown', onKey, true);
  show(0);
  raf = requestAnimationFrame(place);
}
