// Email via Resend. Gracefully no-ops until RESEND_API_KEY / EMAIL_FROM are
// configured, so the app runs fine before the SETUP.md checklist is done.
// Bodies stay deliberately content-free about health specifics — an email
// says "something happened, open the app," never what was discussed.

const FOOTER = `
  <p style="color:#888; font-size:12px; border-top:1px solid #ddd; padding-top:12px; margin-top:24px;">
    Pocket Advocate is a patient-advocacy service, offered to residents of the United States and Canada.
    It does not provide diagnosis, treatment, prescriptions, or medical advice,
    and does not create a doctor-patient relationship. If this is an emergency, call 911.
  </p>`;

/**
 * Step-by-step "keep this on your phone" instructions, appended to the two
 * welcome emails (case opened, subscription started) — Eric's request:
 * clients should never have to hunt for the portal again.
 */
export function homeScreenTips(baseUrl) {
  const host = baseUrl.replace(/^https?:\/\//, '');
  return `
  <div style="background:#f5f7fa; border-radius:10px; padding:14px 16px; margin-top:20px;">
    <p style="margin:0 0 8px; font-size:15px;"><strong>⚠️ IMPORTANT: ADD POCKET ADVOCATE TO YOUR HOME SCREEN.</strong></p>
    <p style="margin:0 0 10px;">This is the <strong>only way you'll receive notifications</strong> for all reminders, links, information, uploaded documents, and chat messages. Without it, you'll have to manually check the app for new information. It takes under a minute — the site becomes an app icon and you stay signed in:</p>
    <p style="margin:0 0 4px;"><strong>iPhone / iPad:</strong></p>
    <ol style="margin:0 0 10px; padding-left:20px;">
      <li>Open <a href="${baseUrl}">${host}</a> in <strong>Safari</strong></li>
      <li>Tap the <strong>Share</strong> button (the square with the arrow)</li>
      <li>Scroll down, tap <strong>Add to Home Screen</strong>, then <strong>Add</strong></li>
    </ol>
    <p style="margin:0 0 4px;"><strong>Android:</strong></p>
    <ol style="margin:0; padding-left:20px;">
      <li>Open <a href="${baseUrl}">${host}</a> in <strong>Chrome</strong></li>
      <li>Tap the <strong>⋮</strong> menu (top right)</li>
      <li>Tap <strong>Add to Home screen</strong>, then <strong>Add</strong></li>
    </ol>
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
