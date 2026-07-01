// handlers de push cargados dentro del service worker generado por workbox
// (via workbox.importScripts en vite.config.ts). NO es el sw completo: solo
// añade el manejo de notificaciones push sin tocar el precache de workbox.

// muestra la notificación al recibir un push. el payload es el PushPayload
// serializado por el server: { title, body, data: { type, route, ... } }.
self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    // fallback: texto plano como cuerpo
    payload = { title: 'SIS', body: event.data.text(), data: {} };
  }
  const { title, body, data } = payload;
  event.waitUntil(
    self.registration.showNotification(title || 'SIS', {
      body: body || '',
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      data: data || {},
    }),
  );
});

// al pulsar la notificación: enfoca una pestaña abierta de la app y navega a la
// ruta indicada (data.route), o abre una nueva ventana si no hay ninguna.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = (event.notification.data && event.notification.data.route) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(route).catch(() => {});
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(route);
    }),
  );
});
