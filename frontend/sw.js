/* ChatWave service worker: always tries the network first, so new deployments show up
   straight away, and falls back to the saved copy when there is no connection.
   It never touches the API, WebSocket or other websites. */
const CACHE = 'chatwave-v1';
const SHELL = ['./index.html', './chat.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.addAll(SHELL).catch(() => {}))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;
    if (new URL(req.url).origin !== self.location.origin) return;

    event.respondWith(
        fetch(req)
            .then((res) => {
                if (res.ok) {
                    const copy = res.clone();
                    caches.open(CACHE).then((cache) => cache.put(req, copy));
                }
                return res;
            })
            .catch(() =>
                caches.match(req).then((hit) =>
                    hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())
                )
            )
    );
});
