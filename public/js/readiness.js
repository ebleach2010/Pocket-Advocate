// The Hands-Off readiness checklist (Eric, 2026-08-25: "There needs to be a
// checklist on their end that populates in order for me to begin... but the
// clock starts upon booking").
//
// DERIVED, never stored. Every row is backed by a record that already
// exists - the scope-note acknowledgment on the case, the signed authority
// documents behind /api/authority - so the checklist can never disagree
// with the documents themselves, needs no route of its own, and holds
// nothing a client could tick past. Both sides render from this one
// function, so the two views cannot drift.

export function handsOffReadiness(c, authorityItems = []) {
  const live = (authorityItems || []).filter((i) => !i.revokedAt);
  const rows = [
    {
      id: 'scope',
      label: 'The scope note, read and acknowledged',
      done: !!(c?.forms?.fullAccess),
    },
    {
      id: 'records',
      label: 'A records authorisation signed for at least one clinic',
      done: live.some((i) => i.kind === 'records'),
    },
    {
      id: 'representative',
      label: 'The insurance representative designation signed',
      done: live.some((i) => i.kind === 'representative'),
    },
  ];
  return { rows, ready: rows.every((r) => r.done) };
}
