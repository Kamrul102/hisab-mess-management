const CACHE_NAME = "hisab-v4";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./app.js",
  "./lang.js",
  "./firebase-config.js",
  "./emailjs-config.js",
  "./manifest.json"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.map(function (key) {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", function (event) {
  // Only handle GET requests and skip Firebase/external APIs
  if (
    event.request.method !== "GET" ||
    event.request.url.includes("firestore.googleapis.com") ||
    event.request.url.includes("identitytoolkit.googleapis.com")
  ) {
    return;
  }

  // Network-First strategy: always fetch latest updates when online, fallback to cache offline
  event.respondWith(
    fetch(event.request)
      .then(function (networkResponse) {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(function () {
        return caches.match(event.request);
      })
  );
});
