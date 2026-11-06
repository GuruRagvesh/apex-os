self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = {}; }
  const title = payload.title || 'Apex OS';
  const tag = payload.tag || payload.notificationId || undefined;
  const options = {
    body: payload.body || 'You have a new notification.',
    data: { url: payload.url || '/dashboard', notificationId: payload.notificationId },
    tag,
    // renotify only takes effect with a tag: a repeated break alarm replaces the
    // previous one and rings and vibrates again.
    renotify: Boolean(tag) && (payload.alarm === true || payload.type === 'WARNING'),
    requireInteraction: payload.alarm === true || payload.type === 'WARNING',
    silent: false,
    // Phones vibrate for about seven seconds on a break alarm; Android uses it,
    // other platforms ignore it.
    ...(payload.alarm === true ? { vibrate: [900, 300, 900, 300, 900, 300, 900, 300, 900, 300, 900] } : {}),
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/dashboard', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    }),
  );
});
