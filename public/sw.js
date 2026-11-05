// Riceve le notifiche delle richieste di intervento anche a gestionale chiuso
// e, toccandole, apre la richiesta.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch { m = { testo: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(m.titolo || "Gestionale", {
    body: m.testo || "",
    icon: "icona-192.png",
    badge: "icona-notifica.png",
    tag: m.tag,
    renotify: !!m.tag,
    requireInteraction: true,
    vibrate: [200, 100, 200],
    data: { url: m.url || self.registration.scope },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || self.registration.scope;
  e.waitUntil((async () => {
    const finestre = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const f of finestre) {
      if (f.url.startsWith(self.registration.scope)) {
        await f.focus();
        f.postMessage({ tipo: "apri", url });
        return;
      }
    }
    await self.clients.openWindow(url);
  })());
});
