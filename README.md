# Pocket-Advocate

**Pocket Advocate** — a paid patient-advocacy service (US only). Clients book a live discussion of their symptoms, labs, and medical journey, get a private case file with chat, and receive a comprehensive written report within a week. A $20/mo subscription tier offers ongoing chat access.

This is advocacy, not medicine: no diagnosis, no treatment, no prescriptions, and not a substitute for a doctor.

## Documents

- **[SPEC.md](SPEC.md)** — the full product spec (v1). Single source of truth for builders.
- **[FLOW.html](FLOW.html)** — the phone-readable blueprint of the same spec, for Eric's review.

## Stack

Static web app on Cloudflare (one Worker as the only server-side code) + Firebase (Auth / Firestore / Storage / RTDB) + Stripe Checkout.

## Status

**Phase 1 (skeleton + money) built:** landing, magic-link auth, waiver flow, public/private election, schedule-and-pay through the Worker + Stripe webhook, case created end-to-end. See §G of the spec for the phase plan and [docs/SETUP.md](docs/SETUP.md) to wire up Firebase/Stripe/Cloudflare.

## Layout

```
public/          static app (landing, sign-in, booking wizard, case view)
worker/          the one Cloudflare Worker (checkout, Stripe webhook, trust boundary)
firestore.rules  day-one security rules (clients read own data; Worker writes)
storage.rules    per-case file access (uploads land in Phase 2)
scripts/         seed availability slots, set the admin account
docs/SETUP.md    one-time Firebase / Stripe / Cloudflare wiring
```
