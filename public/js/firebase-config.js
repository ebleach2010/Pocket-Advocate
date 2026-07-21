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

// Web-push (FCM) public VAPID key. From Firebase console → Project settings →
// Cloud Messaging → Web Push certificates (public half — safe in the browser).
export const VAPID_PUBLIC_KEY =
  'BN2uifVCbTj93B3t4-XGl60SMhyocCdhSae-cvlZJ34usNVAbtfc1L8hljWDETMySGinwG9Z5hUsHXT8C1rn-R0';
