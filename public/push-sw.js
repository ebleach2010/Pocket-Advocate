// Native Web Push service worker — no Firebase. Receives encrypted pushes from
// our Worker and shows the notification; a tap opens the linked page.
/* global self, clients */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* keep defaults */ }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Pocket Advocate', {
      body: data.body || 'You have a new message.',
      icon: '/icon-180.png',
      badge: '/icon-180.png',
      data: { link: data.link || '/' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification.data && event.notification.data.link ? event.notification.data.link : '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const path = new URL(link, self.location.origin).pathname;
      for (const w of wins) {
        if (w.url.includes(path) && 'focus' in w) return w.focus();
      }
      return clients.openWindow(link);
    })
  );
});
