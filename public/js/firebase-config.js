// Public Firebase web config — safe to ship to the browser; security lives in
// the rules and the Worker. Fill in from Firebase console (docs/SETUP.md).
export const firebaseConfig = {
  apiKey: 'AIzaSyBDH8QZxGYBWytbxx7aNM0uyUIOqRj-7T8',
  authDomain: 'pocket-advocate-f3148.firebaseapp.com',
  projectId: 'pocket-advocate-f3148',
  storageBucket: 'pocket-advocate-f3148.firebasestorage.app',
  messagingSenderId: '629123378205',
  // Realtime Database (presence) — instance name confirmed from Eric's export.
  databaseURL: 'https://pocket-advocate-f3148-default-rtdb.firebaseio.com',
  appId: '1:629123378205:web:03fc0b564c5d240cd32af4',
};

// Native Web Push (RFC 8291) VAPID public key — the applicationServerKey the
// browser subscribes with. Public half only; the private half is a Worker
// secret. (We use native web push, not FCM, because FCM's token flow fails
// inside iOS Home-Screen apps.)
export const VAPID_PUBLIC_KEY =
  'BEYXJvRQkNcn01FzAP3_zx0suQlmh_rEjBxIYDtT2oCrtP2hunlAqV47PkjoCS1aiPb4lszik8df64o0HwFSNQ4';
