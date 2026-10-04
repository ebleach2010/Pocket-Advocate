// The landing's support block (Eric, 2026-10-04).
//
// "Make sure it's explicit that the fundraiser will go from the moment it's
// live to November 2." And: "Secondarily, they can purchase items from my
// zazzle store ... but zazzle takes a cut, so the direct GoFundMe is
// recommended." The words are in index.html, so they read the same with or
// without this module; this only does the two things that need a clock or a
// link: it shows the GoFundMe button once there is a link to show (Eric:
// hide it until he sends one), and once November 2 is over it puts one line
// where the ways to give were. Applying for verification stays open either
// way.

// Empty until Eric sends the link. While it is empty, no button is drawn.
export const GOFUNDME_URL = '';
export const ZAZZLE_URL = 'https://www.zazzle.com/store/rooftop_and_reed';
// Through the end of November 2 in Mountain time: midnight going into
// November 3 is 07:00 UTC, the clocks having gone back on November 1.
export const FUNDRAISER_ENDS_AT = Date.UTC(2026, 10, 3, 7, 0, 0);
export const ENDED_LINE = 'This fundraiser ended November 2.';

export const fundraiserOpen = (now = Date.now()) => now < FUNDRAISER_ENDS_AT;

/** Paints the support block for the moment `now`. */
export function paintSupport(root, now = Date.now()) {
  const box = root.querySelector('[data-support]');
  if (!box) return 'missing';
  if (!fundraiserOpen(now)) {
    box.innerHTML = `<h2>Support the fund</h2><p>${ENDED_LINE}</p>`;
    return 'ended';
  }
  if (GOFUNDME_URL) {
    const slot = box.querySelector('[data-gofundme]');
    if (slot) {
      slot.innerHTML = `<a class="fund-btn fl-give" href="${GOFUNDME_URL}" target="_blank" rel="noopener">Give on GoFundMe</a><span class="fl-rec">Recommended</span>`;
      slot.hidden = false;
    }
    return 'open';
  }
  return 'open-no-link';
}

if (typeof document !== 'undefined') paintSupport(document);
