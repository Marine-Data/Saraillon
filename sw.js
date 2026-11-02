// Service worker Planya : permet d'installer l'appli et d'ouvrir l'écran même hors ligne.
// Seuls les fichiers de l'appli sont mis en cache ; les données (Supabase) ne le sont jamais.
const CACHE = 'planya-v5';
const FICHIERS = ['./', './index.html', './css/app.css', './js/app.js', './js/config.js', './manifest.webmanifest', './icon-192.png'];

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
