// YKS Macera Defteri — servis çalışanı: çevrimdışı kabuk + bildirimler
const CACHE = "yks-macera-v25";
const SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./config.js", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Kendi dosyalarımız: önce ağ, olmazsa önbellek. Supabase ve CDN istekleri dokunulmadan geçer.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: "no-cache" }).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("./index.html")))
  );
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "YKS Macera Defteri", {
    body: d.body || "Yeni bir gelişme var!",
    icon: "icons/icon-192.png",
    badge: "icons/icon-192.png",
    tag: d.tag,
    renotify: !!d.tag,
    data: { url: d.url || "./" },
    vibrate: [80, 40, 80],
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.startsWith(self.registration.scope)) { c.focus(); return; } }
    return self.clients.openWindow(target);
  }));
});
