self.addEventListener('install', event => {
  event.waitUntil(
    caches.open('psyde-quest-v1').then(cache => {
      return cache.addAll([
        '/psyde-quest/',
        '/psyde-quest/index.html',
        '/psyde-quest/app.js',
        '/psyde-quest/manifest.json',
        'https://www.gstatic.com/firebasejs/9.6.0/firebase-app.js',
        'https://www.gstatic.com/firebasejs/9.6.0/firebase-firestore.js',
        'https://www.gstatic.com/firebasejs/9.6.0/firebase-database.js',
        'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js'
      ]);
    })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(response => {
      return response || fetch(event.request);
    })
  );
});
