// The page half of the sales switch (sales.js). A courtesy, not the gate: the
// Worker refuses every purchase route while SALES_OPEN is false. On a page
// whose <main> carries data-sales="buy" (book, subscribe) the buying flow is
// hidden behind the notice; anywhere else (services) the notice leads the
// page and the rest reads as before. Skipped in the demo, which drives the
// buying flows end to end.
import { SALES_OPEN } from './sales.js';

function inDemo() {
  try {
    const q = new URLSearchParams(location.search).get('demo');
    return q !== '0' && !!(q || sessionStorage.getItem('pa-demo'));
  } catch { return false; }
}

export function closeSales() {
  if (SALES_OPEN || inDemo()) return;
  const main = document.querySelector('main');
  if (!main || main.querySelector('.pa-closed')) return;
  const style = document.createElement('style');
  style.textContent = `
    .pa-closed {
      display: grid; gap: .6rem; margin: 0 0 1.5rem; padding: 1.1rem 1.15rem;
      border: 1px solid var(--edge-lit, rgba(255, 255, 255, .18)); border-left-width: 4px;
      border-radius: 14px; background: var(--sur-base, #131317); color: var(--ink, #F5F5F7);
    }
    .pa-closed h2 { margin: 0; font-size: 1.25rem; }
    .pa-closed p { margin: 0; color: var(--soft, #D2D2D9); line-height: 1.5; }
    .pa-closed .btn { justify-self: start; }
    main[data-sales="buy"].pa-closed-on > :not(.pa-closed):not(.footer-disclaimer) { display: none !important; }`;
  document.head.appendChild(style);
  main.insertAdjacentHTML('afterbegin', `
    <section class="pa-closed" role="note">
      <h2>Not currently offering</h2>
      <p>I'm not taking on new work right now. Join the waitlist and I'll get back to you soon.</p>
      <a class="btn glow" href="/#waitlist">Join the waitlist</a>
    </section>`);
  main.classList.add('pa-closed-on');
}

closeSales();
