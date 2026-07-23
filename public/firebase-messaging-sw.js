// Firebase Cloud Messaging service worker — receives web pushes while the
// app is closed. Must live at the site root. Uses the compat builds because
// service workers can't load ES modules from the gstatic CDN reliably.
/* global importScripts, firebase, self, clients */
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging-compat.js');

// Keep in sync with /js/firebase-config.js (service workers can't import it).
firebase.initializeApp({
  apiKey: 'AIzaSyBDH8QZxGYBWytbxx7aNM0uyUIOqRj-7T8',
  authDomain: 'pocket-advocate-f3148.firebaseapp.com',
  projectId: 'pocket-advocate-f3148',
  storageBucket: 'pocket-advocate-f3148.firebasestorage.app',
  messagingSenderId: '629123378205',
  appId: '1:629123378205:web:03fc0b564c5d240cd32af4',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const n = payload.notification || {};
  self.registration.showNotification(n.title || 'Pocket Advocate', {
    body: n.body || 'You have a new message.',
    icon: '/icon-180.png',
    badge: '/icon-180.png',
    data: { link: payload.fcmOptions?.link || payload.data?.link || '/' },
  });
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data?.link || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes(new URL(link, self.location.origin).pathname) && 'focus' in w)
          return w.focus();
      }
      return clients.openWindow(link);
    })
  );
});
