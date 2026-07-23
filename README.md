# Pocket-Advocate

**Pocket Advocate** — a paid patient-advocacy service (US & Canada), headed for **thepocketadvocates.com**. Clients book a live discussion of their symptoms, labs, and medical journey, get a private case file with chat, and receive a comprehensive written report within a week. A $20/mo subscription tier offers ongoing chat access.

This is advocacy, not medicine: no diagnosis, no treatment, no prescriptions, and not a substitute for a doctor.

## Documents

- **[SPEC.md](SPEC.md)** — the full product spec (v1). Single source of truth for builders.
- **[FLOW.html](FLOW.html)** — the phone-readable blueprint of the same spec, for Eric's review.

## Stack

Static web app on Cloudflare (one Worker as the only server-side code) + Firebase (Auth / Firestore / Storage / RTDB) + Stripe Checkout.

## Status

**Phases 1–3 built.** Phase 1 (skeleton + money): landing, magic-link auth, waiver flow, public/private election, schedule-and-pay through the Worker + Stripe webhook, case created end-to-end. Phase 2 (the case file): uploads to Storage, the client case dashboard (timeline, appointment card + calendar file, files, make-private), the admin side (case list with report-due counters, case detail with milestones, availability editor). Phase 3 (chat + subscription): live case chat and subscriber chat with Eric's presence, the $20/mo Pocket Advocate subscription through Stripe with lifecycle webhooks, closed-case chat behavior, and Resend email notifications with a chat-nudge cron. Neon UI throughout. Next: Phase 4 (hardening). See §G of the spec and [docs/SETUP.md](docs/SETUP.md) to wire up Firebase/Stripe/Cloudflare.

## Layout

```
public/          static app — client: landing, about, sign-in, booking wizard,
                 case dashboard · admin: case list/detail, availability editor
worker/          the one Cloudflare Worker (checkout, Stripe webhook, admin API,
                 trust boundary)
firestore.rules  clients read own data; cases/availability are Worker-writable only
storage.rules    per-case file access; client uploads only while the case is open
scripts/         set the admin account (slot seeding now lives in the admin UI)
docs/SETUP.md    one-time Firebase / Stripe / Cloudflare wiring
PROTOTYPE.html   self-contained click-through of the client flow (no backend needed)
```
