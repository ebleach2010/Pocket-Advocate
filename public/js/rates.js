// What a case and a follow-up cost right now.
//
// The rate is not a constant any more. Every completed booking lifts the case
// and the follow-up by $10, so a number typed into a page is wrong the moment
// somebody else books. The Worker owns the real figure; this fetches it and
// corrects whatever the page shipped with.
//
// The chat subscription is not in here. It does not move.
//
// Nothing about this is announced. A page that quietly says a different number
// than it did last week is the whole design: no banner, no "prices are rising",
// no urgency. Someone who booked keeps the rate they were quoted, which the
// case records at the moment it is created.

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
 *
 * `data-rate-fmt="bare"` drops the dollar sign, for a spot that supplies its own.
 */
export async function paintRates(root = document) {
  const spots = root.querySelectorAll('[data-rate]');
  if (!spots.length) return;
  const r = await rates();
  if (!r) return;
  for (const el of spots) {
    const cents = el.dataset.rate === 'addon' ? r.addonCents : r.caseCents;
    if (!(Number(cents) > 0)) continue;
    const text = el.dataset.rateFmt === 'bare' ? money(cents) : `$${money(cents)}`;
    if (el.textContent !== text) el.textContent = text;
  }
}

// Any page that has price spots gets them painted; a page with none pays
// nothing for importing this.
paintRates().catch(() => {});
