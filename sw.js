/* LeakLens service worker – makes the app installable and work offline.
   App files and the AI libraries/models are cached the first time they load.
   Photos are never sent anywhere. */
const CACHE = 'leaklens-v2';
const SHELL = [
  './', './index.html', './styles.css', './manifest.json', './icon.svg',
  './js/i18n.js', './js/exif.js', './js/pii.js', './js/score.js', './js/vision.js', './js/ocr.js', './js/blur.js', './js/sample.js', './js/app.js',
];

self.addEventListener('install', e => {
  // Cache each file on its own, so one missing file (e.g. sample.jpg) can't break installing.
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => console.warn('Not cached:', u)))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Cache-first for our own files and for the AI libraries on cdn.jsdelivr.net.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const ours = url.origin === location.origin;
  const cdn = url.hostname === 'cdn.jsdelivr.net';
  if (e.request.method !== 'GET' || !(ours || cdn)) return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: ours }).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }))
  );
});
