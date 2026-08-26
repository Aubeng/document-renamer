// Offline app shell. Bump CACHE when any listed file changes, otherwise the
// installed app keeps serving the old copy.
const CACHE = 'document-renamer-v3';

const SHELL = [
  '.',
  'index.html',
  'app.js',
  'manifest.webmanifest',
  'lib/classifier.js',
  'lib/formatter.js',
  'lib/docdate.js',
  'lib/engine.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache-first: this app has no server data to be stale about.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((hit) => hit || fetch(event.request)),
  );
});
