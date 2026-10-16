// Verifies a Firebase Auth ID token from the browser by asking Identity
// Toolkit directly (accounts:lookup validates signature, expiry, audience).
// Avoids hand-rolled JWT verification in the Worker.

export async function requireUser(request, env) {
  const auth = request.headers.get('authorization') || '';
  const m = auth.match(/^Bearer (.+)$/);
  if (!m) return null;
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idToken: m[1] }),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  const user = data.users && data.users[0];
  if (!user || user.disabled) return null;
  return { uid: user.localId, email: user.email || null, authTime: authTimeOf(m[1]) };
}

/**
 * When this session began, in seconds (2026-10-16). The token was just
 * validated above, so its payload is only read here, not trusted on its own:
 * auth_time survives every refresh, which is what lets a password reset or a
 * turn-off end the sessions that began before it (staff.js sessionStale).
 */
export function authTimeOf(idToken) {
  try {
    const part = String(idToken).split('.')[1] || '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((part.length + 3) % 4);
    return Number(JSON.parse(atob(b64)).auth_time) || 0;
  } catch {
    return 0;
  }
}
