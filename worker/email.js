// Email via Resend. Gracefully no-ops until RESEND_API_KEY / EMAIL_FROM are
// configured, so the app runs fine before the SETUP.md checklist is done.
// Bodies stay deliberately content-free about health specifics — an email
// says "something happened, open the app," never what was discussed.

// His business line. (Eric, 2026-08-21: "My phone number is (208)670-8608 so
// integrate that. It's my business number.") The web pages read the same
// number from public/js/reviews-config.js; a Worker cannot import a browser
// module, so it is written once here and the two are changed together.
export const BUSINESS_PHONE = '+12086708608';
export const BUSINESS_PHONE_TEXT = '(208) 670-8608';

const FOOTER = `
  <p style="color:#888; font-size:12px; border-top:1px solid #ddd; padding-top:12px; margin-top:24px;">
    Reach me on <a href="tel:${BUSINESS_PHONE}" style="color:#888;">${BUSINESS_PHONE_TEXT}</a>,
    or just reply to this email.<br><br>
    Pocket Advocate is a patient-advocacy service, offered to residents of the United States and Canada.
    It does not provide diagnosis, treatment, prescriptions, or medical advice,
    and does not create a doctor-patient relationship. If this is an emergency, call 911.
  </p>`;

/** The sign-in code email — the first thing a new client ever receives. */
export function signinCodeEmail(code, baseUrl) {
  return `
  <div style="font-family: -apple-system, Segoe UI, sans-serif; max-width:480px; margin:0 auto;">
    <h2 style="margin:0 0 6px;">Your sign-in code</h2>
    <p style="margin:0 0 14px; color:#444;">Enter this code in the Pocket Advocate app to sign in. It expires in 10 minutes.</p>
    <p style="font-size:34px; font-weight:800; letter-spacing:8px; text-align:center;
       background:#f5f7fa; border-radius:10px; padding:16px 0; margin:0 0 6px;">${code}</p>
    <p style="margin:0 0 4px; color:#888; font-size:13px;">Didn't request this? You can ignore this email.</p>
    <div style="background:#f5f7fa; border-radius:10px; padding:14px 16px; margin-top:18px; font-size:16px; line-height:1.6;">
      <p style="margin:0 0 8px;"><strong>First time here?</strong> Add Pocket Advocate to your Home Screen first, then type the code above into it. It takes about a minute.</p>
      <p style="margin:0 0 6px;"><strong>On iPhone or iPad:</strong></p>
      <ol style="margin:0 0 10px; padding-left:22px;">
        <li>Open this site in <strong>Safari</strong></li>
        <li>Tap the <strong>Share</strong> button — the square with an arrow pointing up</li>
        <li>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong></li>
      </ol>
      <p style="margin:0 0 6px;"><strong>On Android:</strong></p>
      <ol style="margin:0 0 10px; padding-left:22px;">
        <li>Open this site in <strong>Chrome</strong></li>
        <li>Tap the <strong>⋮</strong> menu at the top right</li>
        <li>Tap <strong>Add to Home screen</strong>, then <strong>Add</strong></li>
      </ol>
      <p style="margin:0; color:#555;">You can skip this and sign in right here instead — it will still work.</p>
    </div>
  </div>`;
}

/**
 * Step-by-step "keep this on your phone" instructions, appended to the two
 * welcome emails (case opened, subscription started) — Eric's request:
 * clients should never have to hunt for the portal again.
 */
export function homeScreenTips(baseUrl) {
  const host = baseUrl.replace(/^https?:\/\//, '');
  return `
  <div style="background:#f5f7fa; border-radius:10px; padding:16px 18px; margin-top:20px; font-size:16px; line-height:1.6;">
    <p style="margin:0 0 10px; font-size:17px;"><strong>Please add Pocket Advocate to your Home Screen.</strong></p>
    <p style="margin:0 0 12px;">This is the only way your phone can notify you about replies, documents, appointment reminders, and your report. Without it you'd have to keep checking back yourself. It takes under a minute, and afterwards the site opens like an app and keeps you signed in.</p>
    <p style="margin:0 0 6px;"><strong>On iPhone or iPad:</strong></p>
    <ol style="margin:0 0 12px; padding-left:22px;">
      <li>Open <a href="${baseUrl}">${host}</a> in <strong>Safari</strong></li>
      <li>Tap the <strong>Share</strong> button — the square with an arrow pointing up</li>
      <li>Scroll down and tap <strong>Add to Home Screen</strong></li>
      <li>Tap <strong>Add</strong>, then open Pocket Advocate from the new icon</li>
    </ol>
    <p style="margin:0 0 6px;"><strong>On Android:</strong></p>
    <ol style="margin:0 0 12px; padding-left:22px;">
      <li>Open <a href="${baseUrl}">${host}</a> in <strong>Chrome</strong></li>
      <li>Tap the <strong>⋮</strong> menu at the top right</li>
      <li>Tap <strong>Add to Home screen</strong>, then <strong>Add</strong></li>
    </ol>
    <p style="margin:0; color:#555;">If you get stuck, just reply to this email and I'll walk you through it.</p>
  </div>`;
}

export async function sendEmail(env, { to, subject, html }) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM || !to) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [to],
        subject,
        html: `<div style="font-family:-apple-system,Segoe UI,sans-serif; max-width:540px; margin:0 auto; line-height:1.6; color:#222;">${html}${FOOTER}</div>`,
      }),
    });
    if (!res.ok) console.error('resend failed:', res.status, await res.text());
    return res.ok;
  } catch (err) {
    console.error('resend error:', err);
    return false;
  }
}
