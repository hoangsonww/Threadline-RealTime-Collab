// Installability only — deliberately no caching, no offline support. Threadline
// requires a live connection for every feature (session auth, live rooms, the
// durable record), so an offline-capable cache would only risk serving stale,
// broken UI. This exists solely so the browser has a registered service worker
// to satisfy "Add to Home Screen" / install-prompt criteria.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
