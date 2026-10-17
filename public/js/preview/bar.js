// The preview's own strip (Eric, 2026-10-15): "When they're in the showcase
// suite, a button of the same design is in the top left (make sure it's not
// blocking any interactable UI elements) that say exit. Once they tap this it
// brings them back to the landing page."
//
// The strip takes its own row above the page header, the way the demo strip
// does, so the Exit bubble covers nothing: the header docks under it and the
// page starts below both.

const CSS = `
  .pv-strip {
    position: sticky; top: 0; z-index: 40;
    display: flex; align-items: center; gap: .7rem;
    padding: .5rem max(16px, env(safe-area-inset-right, 0px)) .5rem max(16px, env(safe-area-inset-left, 0px));
    padding-top: max(.5rem, env(safe-area-inset-top, 0px));
    background: #0A0A0C; border-bottom: 1px solid rgba(255, 255, 255, .12);
    color: #C9C9D2; font: 500 .8rem/1.35 'Manrope', -apple-system, 'Segoe UI', system-ui, sans-serif;
  }
  .pv-exit {
    position: relative; flex: none; margin-left: 7px;
    display: inline-flex; align-items: center; gap: .4rem;
    min-height: 44px; padding: .4rem 1rem;
    border: 0; border-radius: 20px 20px 20px 4px; cursor: pointer;
    background: linear-gradient(110deg, #3DDCF5 0%, #9BEBFA 48%, #B9A6FF 100%);
    color: #02161A; font: 700 .88rem/1 'Manrope', -apple-system, 'Segoe UI', system-ui, sans-serif;
    box-shadow: 0 0 0 1px rgba(61, 220, 245, .55), 0 8px 26px rgba(61, 220, 245, .32);
  }
  /* The home's Preview bubble, mirrored: its tail on the left, and its sheen. */
  .pv-exit::after {
    content: ""; position: absolute; left: -7px; bottom: 0; width: 12px; height: 12px;
    background: #3DDCF5; clip-path: polygon(100% 0, 0 100%, 100% 100%);
  }
  .pv-exit::before {
    content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
    background: linear-gradient(105deg, transparent 38%, rgba(255, 255, 255, .8) 50%, transparent 62%) no-repeat;
    background-size: 260% 100%; background-position: 130% 0;
  }
  .pv-exit:focus-visible { outline: 2px solid #F5F5F7; outline-offset: 3px; }
  .pv-what { min-width: 0; }
  .pv-what strong { color: #F5F5F7; }
  @media (prefers-reduced-motion: no-preference) {
    .pv-exit { animation: pv-glow 3.6s ease-in-out infinite; }
    .pv-exit::before { animation: pv-shine 3.6s ease-in-out infinite; }
  }
  @keyframes pv-shine {
    0%, 52% { background-position: 130% 0; }
    100% { background-position: -30% 0; }
  }
  @keyframes pv-glow {
    0%, 100% { box-shadow: 0 0 0 1px rgba(61, 220, 245, .55), 0 8px 26px rgba(61, 220, 245, .32); }
    50% { box-shadow: 0 0 0 1px rgba(61, 220, 245, .8), 0 8px 34px rgba(61, 220, 245, .55); }
  }
  /* In the warm look, warm (2026-10-17, the look audit: a cyan bubble on the
     plum page). Blue and purple and High contrast keep the cyan above. */
  :root:not([data-look="cool"]):not([data-scheme="contrast"]) .pv-exit {
    background: linear-gradient(110deg, #FFC48A 0%, #FF9E7D 50%, #F59BBF 100%); color: #2B1207;
    box-shadow: 0 0 0 1px rgba(255, 178, 122, .55), 0 8px 26px rgba(255, 140, 100, .3);
    animation-name: pv-glow-warm;
  }
  :root:not([data-look="cool"]):not([data-scheme="contrast"]) .pv-exit::after { background: #FFC48A; }
  @keyframes pv-glow-warm {
    0%, 100% { box-shadow: 0 0 0 1px rgba(255, 178, 122, .55), 0 8px 26px rgba(255, 140, 100, .3); }
    50% { box-shadow: 0 0 0 1px rgba(255, 178, 122, .8), 0 8px 34px rgba(255, 140, 100, .5); }
  }`;

export function mountBar(wipe) {
  if (document.querySelector('.pv-strip')) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const strip = document.createElement('div');
  strip.className = 'pv-strip';
  strip.setAttribute('role', 'region');
  strip.setAttribute('aria-label', 'Case preview');
  strip.innerHTML = `
    <button type="button" class="pv-exit" data-preview-exit>Exit</button>
    <span class="pv-what"><strong>Preview.</strong> An invented case. Chat, upload and sign anything; it all disappears when you exit.</span>`;
  document.body.prepend(strip);
  // The page header docks under the strip, at the strip's real height.
  document.body.classList.add('has-demo-bar');
  const publish = () => document.documentElement.style.setProperty(
    '--demo-bar-h', `${Math.round(strip.getBoundingClientRect().height)}px`);
  publish();
  if (window.ResizeObserver) new ResizeObserver(publish).observe(strip);
  else window.addEventListener('resize', publish);
  strip.querySelector('[data-preview-exit]').addEventListener('click', () => {
    wipe();
    location.assign('/');
  });
}
