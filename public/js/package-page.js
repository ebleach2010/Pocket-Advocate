// ONE PACKAGE, ONE PAGE (Eric, 2026-10-15: "it should go to a page dedicated
// to what the chat is. Same with the other two options. They should never
// commingle information.")
//
// Each package page names its package on <body data-package>. This paints
// that package's approved About copy (service-about.js, the same words its
// sheet carried) and its door: the way in while it is offered, "Not
// currently offering" and the waitlist while it is not. Nothing here reads
// any other package's copy.
import { SERVICE_ABOUT } from './service-about.js';
import { packageOpen } from './sales.js';

/** The About entry each page shows. Full service's copy is filed as handsOff. */
export const PAGE_COPY = { chat: 'chat', case: 'case', full: 'handsOff' };

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** The way in, or the honest word that there is none right now. */
export function statusHtml(pkg, open) {
  if (!open) {
    return `<span class="opt-badge">Not currently offering</span>
      <a class="btn glow cta pkg-go" href="/?wl=${esc(pkg)}#waitlist">Join the waitlist</a>`;
  }
  if (pkg === 'chat') return '<a class="btn glow cta pkg-go" href="/subscribe.html">Start chatting</a>';
  // Full service is asked for from inside an open case, so its way in is a case.
  if (pkg === 'full') return '<a class="btn glow cta pkg-go" href="/book.html">Book a case first</a>';
  return '<a class="btn glow cta pkg-go" href="/book.html">Book a case</a>';
}

/** The package's own copy: the TL;DR, the whole picture, point by point. */
export function bodyHtml(a) {
  return `
    <section class="pkg-sec pkg-tldr">
      <h2>TL;DR</h2>
      <p>${esc(a.tldr)}</p>
    </section>
    <section class="pkg-sec">
      <h2>What it is</h2>
      ${a.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}
    </section>
    <section class="pkg-sec">
      <h2>Point by point</h2>
      <ul class="pkg-points">${a.bullets.map((b) => `<li>${esc(b)}</li>`).join('')}</ul>
    </section>`;
}

function paint() {
  const pkg = document.body.dataset.package;
  const a = SERVICE_ABOUT[PAGE_COPY[pkg]];
  if (!a) return;
  const status = document.querySelector('[data-pkg-status]');
  if (status) status.innerHTML = statusHtml(pkg, packageOpen(pkg));
  const body = document.querySelector('[data-pkg-body]');
  if (body) body.innerHTML = bodyHtml(a);
}

if (typeof document !== 'undefined') paint();
