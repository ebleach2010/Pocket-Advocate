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
  return { uid: user.localId, email: user.email || null };
}
