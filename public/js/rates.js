// What a case, a follow-up, and the chat subscription cost right now. The
// Worker owns the figures; this fetches them and corrects whatever the page
// shipped with.

// Thousands separated. The case and tier prices crossed $1,000 in the
// 2026-08-26 recalibration, and this helper repaints every price span on the
// site - so without it the landing page rendered "$1200" and "$3400" the
// moment the live rate landed, overwriting correctly formatted markup.
const money = (cents) => (cents / 100).toLocaleString('en-US',
  cents % 100 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {});

let inflight = null;

/** { caseCents, addonCents } from the Worker, or null if it cannot be reached. */
export function rates() {
  if (!inflight) {
    inflight = fetch('/api/rates')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d && Number(d.caseCents) > 0 ? d : null))
      .catch(() => null);
  }
  return inflight;
}

/**
 * Fill every `[data-rate]` on the page. The element's shipped text is the
 * fallback and is already correct at deploy time, so a failed fetch or a slow
 * one shows a real price rather than a blank or a spinner.
 *
 *   <span data-rate="case">$650</span>
 *   <span data-rate="addon">$175</span>
 *   <span data-rate="sub">$95</span>
 *   <span data-rate="full">$1500</span>
 *   <span data-rate="tele">$450</span>
 *
 * `data-rate-fmt="bare"` drops the dollar sign, for a spot that supplies its own.
 *
 * Every key a page can use has to appear in the map below. The case price is
 * the `??` fallback, so an unlisted key does not fail loudly: it quietly
 * paints the wrong number, which is the worse kind of wrong.
 */
export async function paintRates(root = document) {
  const spots = root.querySelectorAll('[data-rate]');
  if (!spots.length) return;
  const r = await rates();
  if (!r) return;
  for (const el of spots) {
    const cents = { addon: r.addonCents, sub: r.subCents, full: r.fullCents, tele: r.teleCents }[el.dataset.rate] ?? r.caseCents;
    if (!(Number(cents) > 0)) continue;
    const text = el.dataset.rateFmt === 'bare' ? money(cents) : `$${money(cents)}`;
    if (el.textContent !== text) el.textContent = text;
  }
}

// Any page that has price spots gets them painted; a page with none pays
// nothing for importing this.
paintRates().catch(() => {});
