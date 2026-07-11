// Email via Resend. Gracefully no-ops until RESEND_API_KEY / EMAIL_FROM are
// configured, so the app runs fine before the SETUP.md checklist is done.
// Bodies stay deliberately content-free about health specifics — an email
// says "something happened, open the app," never what was discussed.

const FOOTER = `
  <p style="color:#888; font-size:12px; border-top:1px solid #ddd; padding-top:12px; margin-top:24px;">
    Pocket Advocate is a patient-advocacy service, offered to US residents only.
    It does not provide diagnosis, treatment, prescriptions, or medical advice,
    and does not create a doctor-patient relationship. If this is an emergency, call 911.
  </p>`;

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
