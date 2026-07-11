// Forms 1–3 (SPEC §B). DRAFT COPY — a real lawyer reviews every word here
// before the first paying client (Phase 4 gate). Advocacy framing only:
// never "diagnosis," "treatment plan," or "medical advice."

export const WAIVERS = [
  {
    id: 'disclaimer',
    title: 'Service disclaimer & waiver',
    body: `
<h3>What this service is</h3>
<p>Pocket Advocate is a <strong>patient-advocacy</strong> service offered to residents of the United States only. Your advocate helps you navigate your medical journey: organizing your story, helping you understand your labs and imaging in plain language, preparing questions to bring to your doctors, and identifying options to discuss with your care team.</p>
<h3>What this service is NOT</h3>
<p>This service is <strong>not medical care</strong>. Specifically, it is:</p>
<p>• <strong>Not diagnosis, not treatment, and not prescriptions.</strong> Nothing said in a discussion, written in chat, or included in a report is a diagnosis, a treatment plan, or medical advice.<br>
• <strong>Not a doctor-patient relationship</strong>, and not a substitute for one. Your advocate is not acting as your physician or clinician.<br>
• <strong>Not therapy and not emergency care.</strong> If this is an emergency, call 911.</p>
<h3>The advocacy relationship</h3>
<p>By purchasing an Advocacy Case you engage the advocate to review the materials you choose to share, discuss them with you, and prepare a written advocacy summary. You remain responsible for all decisions about your health, made together with your own licensed care team. You agree to share the advocacy summary with your care team before acting on anything in it.</p>
<h3>Assumption of responsibility & limitation of liability</h3>
<p>You acknowledge that the service provides information, organization, and preparation — not medical judgment. To the maximum extent permitted by law, the service's total liability for any claim arising out of an Advocacy Case is limited to the amount you paid for that case.</p>
<p><em>DRAFT — this document will be reviewed by an attorney before the service accepts its first paying client.</em></p>`,
  },
  {
    id: 'privacy',
    title: 'Privacy & data handling',
    body: `
<h3>What we store</h3>
<p>Your account email; the files you choose to upload (labs, imaging, records); the recording of your discussion; the written report; and your chat messages.</p>
<h3>Where it lives</h3>
<p>All data is stored in Google Firebase (United States region), encrypted in transit and at rest. Payments are processed by Stripe — your card details never touch this application.</p>
<h3>Who can see it</h3>
<p>Exactly two parties: <strong>you</strong> and <strong>your advocate (Eric)</strong>. Access is enforced by security rules on every document and file. If you elect a public session (a separate, explicit choice), the live discussion itself is broadcast — your uploaded files and case file are never public.</p>
<h3>Retention & deletion</h3>
<p>Your case file remains available to you indefinitely after your case closes, so you can download or print any document at any time. You may request deletion of your account and all associated data at any time, and it will be honored within 30 days.</p>
<h3>Breach notification</h3>
<p>This service is not a HIPAA covered entity, but it treats your health information as sensitive regardless. If a breach affecting your data occurs, you will be notified promptly and candidly, consistent with the FTC Health Breach Notification Rule and applicable state law.</p>
<p><em>DRAFT — this document will be reviewed by an attorney before the service accepts its first paying client.</em></p>`,
  },
  {
    id: 'recording',
    title: 'Recording consent',
    body: `
<h3>Your discussion is recorded</h3>
<p>Every Advocacy Case discussion is recorded so that the recording can be placed in your private case file for you to revisit, download, and keep.</p>
<h3>What you are consenting to</h3>
<p>By acknowledging this form you give written consent for your advocate to record the audio and video of your discussion, whether it takes place over Discord, Zoom, or phone. This written consent is collected from every participant before any recording begins, which satisfies the all-party consent laws of states such as California, Washington, and Florida.</p>
<h3>Where the recording goes</h3>
<p>Into your case file, visible only to you and your advocate — unless you separately and explicitly elect a public session on the next screen. You can revoke a public election any time before the broadcast starts.</p>
<p><em>DRAFT — this document will be reviewed by an attorney before the service accepts its first paying client.</em></p>`,
  },
];

export const ELECTION_QUOTE =
  'Other patients gain insight into their medical journey when live discussion of cases are presented. However, this is entirely optional depending on your privacy preferences.';

// Form 5 (SPEC §B) — subscribers only. Same DRAFT status as forms 1–3.
export const SUBSCRIPTION_TERMS = {
  id: 'subscriptionTerms',
  title: 'Pocket Advocate subscription terms',
  body: `
<h3>The honest deal, up front</h3>
<p><strong>Response timing is never guaranteed.</strong> Your subscription buys an always-open chat line to your advocate, with his live online status visible. He replies on his own time, when he is available. Sometimes that is minutes; sometimes it is days. That trade-off is the deal, stated plainly, and by subscribing you accept it.</p>
<h3>Still not medical advice</h3>
<p>Everything in the service disclaimer applies to chat: nothing your advocate writes is a diagnosis, a treatment plan, or medical advice. Chat is for understanding your situation and preparing for your care team — it is not a substitute for one, and it is not for emergencies. If this is an emergency, call 911.</p>
<h3>Billing & cancellation</h3>
<p>$20 per month through Stripe, renewed automatically. Cancel anytime from the Manage Subscription page — access runs to the end of the period you already paid for, and your message history stays visible to you. If a renewal payment fails, access likewise runs out at the end of the paid period.</p>
<h3>Separate from cases</h3>
<p>The subscription is independent of any Advocacy Case. Case chats live in their case file and close with the case; this chat lives with your subscription.</p>
<p><em>DRAFT — this document will be reviewed by an attorney before the service accepts its first paying client.</em></p>`,
};
