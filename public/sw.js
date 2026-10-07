// Mimir's service worker. One job: when the network is gone, show the offline page instead of the browser's error
// (inside the Android app that is the difference between an app and a broken web view). It caches nothing else, so
// a site deploy is live in the app on the next load.
const OFFLINE = '/offline.html'
const CACHE = 'mimir-offline-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, '/app/icon-192.png'])).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(fetch(event.request).catch(() => caches.match(OFFLINE)))
})
