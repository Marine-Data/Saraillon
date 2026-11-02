// Service worker Planya : permet d'installer l'appli et d'ouvrir l'écran même hors ligne.
// Seuls les fichiers de l'appli sont mis en cache ; les données (Supabase) ne le sont jamais.
const CACHE = 'planya-v15';
const FICHIERS = ['./', './index.html', './css/app.css', './js/app.js', './js/config.js', './js/supabase.js', './js/vendor/supabase-js-2.45.0.min.js', './manifest.webmanifest', './icon-192.png'];

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FICHIERS)).catch(() => {}));
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // données et services externes : réseau direct
  e.respondWith(
    fetch(e.request).then(r => { const copie = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copie)); return r; })
      .catch(() => caches.match(e.request).then(r => r || caches.match('./index.html')))
  );
});

// Notifications (Web Push) : affichage, puis ouverture de l'écran concerné au toucher.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Planya', {
    body: d.body || '', icon: 'icon-192.png', badge: 'icon-192.png', data: { url: d.url || './' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const cible = new URL(e.notification.data?.url || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(fenetres => {
    const ouverte = fenetres.find(f => f.url.startsWith(self.registration.scope));
    if (ouverte) { ouverte.navigate(cible).catch(() => {}); return ouverte.focus(); }
    return self.clients.openWindow(cible);
  }));
});
