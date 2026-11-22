self.addEventListener('push', event => {
  let orderId;
  try { orderId = event.data?.json()?.orderId; } catch { return; }
  if (!Number.isSafeInteger(orderId) || orderId < 1) return;
  event.waitUntil(self.registration.showNotification('Новый заказ №' + orderId, {
    body: 'Открыть заказы в GAS SHOP',
    icon: '/admin-icon-192.png',
    tag: 'order-' + orderId,
    data: orderId
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const orderId = event.notification.data;
  const target = new URL('/#orders', self.location.origin);
  if (Number.isSafeInteger(orderId)) target.searchParams.set('order-notification', orderId);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      const url = new URL(client.url);
      if (url.origin !== target.origin || url.pathname !== '/') continue;
      const page = await client.navigate(target.href);
      if (page) return page.focus();
    }
    return self.clients.openWindow(target.href);
  })());
});
