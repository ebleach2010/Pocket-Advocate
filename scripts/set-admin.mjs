// Marks one account as the admin (Eric): sets users/{uid}.role = 'admin' in
// Firestore and the `admin` custom claim used by the RTDB presence rules.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=service-account.json \
//   node scripts/set-admin.mjs eric@example.com

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const email = process.argv[2];
if (!email) {
  console.error('usage: node scripts/set-admin.mjs <email>');
  process.exit(1);
}

initializeApp({ credential: applicationDefault() });
const user = await getAuth().getUserByEmail(email);
await getAuth().setCustomUserClaims(user.uid, { admin: true });
await getFirestore().doc(`users/${user.uid}`).set(
  { email, role: 'admin' },
  { merge: true }
);
console.log(`${email} (${user.uid}) is now the admin. They must sign out/in for the claim to apply.`);
