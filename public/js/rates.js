// What a case, a follow-up, and the chat subscription cost right now. The
// Worker owns the figures; this fetches them and corrects whatever the page
// shipped with.

const money = (cents) => (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100));

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
 *   <span data-rate="case">$265</span>
 *   <span data-rate="addon">$75</span>
 *   <span data-rate="sub">$50</span>
 *
 * `data-rate-fmt="bare"` drops the dollar sign, for a spot that supplies its own.
 */
export async function paintRates(root = document) {
  const spots = root.querySelectorAll('[data-rate]');
  if (!spots.length) return;
  const r = await rates();
  if (!r) return;
  for (const el of spots) {
    const cents = { addon: r.addonCents, sub: r.subCents }[el.dataset.rate] ?? r.caseCents;
    if (!(Number(cents) > 0)) continue;
    const text = el.dataset.rateFmt === 'bare' ? money(cents) : `$${money(cents)}`;
    if (el.textContent !== text) el.textContent = text;
  }
}

// Any page that has price spots gets them painted; a page with none pays
// nothing for importing this.
paintRates().catch(() => {});
