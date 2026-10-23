// Service worker : réseau d'abord, mais le cache prend le relais après NETWORK_TIMEOUT_MS.
//  - réseau absent  -> la copie du cache est servie tout de suite
//  - réseau mourant -> pas d'app figée pendant des dizaines de secondes
//  - réseau bon     -> l'utilisateur a toujours la dernière version, et le cache se met à jour
//
// Change CACHE (app-v2, app-v3…) quand tu ajoutes ou retires un fichier de ASSETS,
// pour que les anciens fichiers soient supprimés des appareils.
const CACHE = 'mon-app-v1';              // REMPLACER : un nom propre à l'app
const NETWORK_TIMEOUT_MS = 3000;

// ATTENTION : cache.addAll est tout ou rien. Un seul fichier introuvable ici et le service worker
// ne s'installe pas : plus de hors-ligne, sans aucun message. Liste uniquement des fichiers qui existent.
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(respond(request));
});

async function respond(request) {
  const cache = await caches.open(CACHE);

  const network = fetch(request).then((response) => {
    if (response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  });
  network.catch(() => {}); // évite une erreur « non gérée » si le cache a déjà répondu

  const timeout = new Promise((_, reject) => setTimeout(reject, NETWORK_TIMEOUT_MS));
  try {
    return await Promise.race([network, timeout]);
  } catch {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    // Page demandée hors ligne mais absente du cache : on sert la page d'accueil de l'app.
    if (request.mode === 'navigate') {
      const home = await cache.match('./');
      if (home) return home;
    }
    return network; // rien en cache : on attend le réseau jusqu'au bout
  }
}
