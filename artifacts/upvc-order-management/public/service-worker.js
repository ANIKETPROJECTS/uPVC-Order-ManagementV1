self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { title: 'Framewise update', message: event.data?.text() || '' }; }
  const title = payload.title || 'Framewise update';
  const options = {
    body: payload.message || payload.body || 'There is an update in your workspace.',
    data: { url: payload.url || '/quotation-builder', quotationId: payload.quotationId || null },
    icon: '/favicon.svg',
    badge: '/favicon.svg',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const target = data.quotationId
    ? (data.url && data.url.includes('approv')
        ? `/quotation-approvals?quote=${encodeURIComponent(data.quotationId)}`
        : `/quotation-builder?quote=${encodeURIComponent(data.quotationId)}&section=drafts`)
    : (data.url || '/quotation-builder');
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => 'focus' in client);
    if (existing) {
      existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  }));
});