const CACHE_NAME = "lexo-catalog-v20260723-price-approval-estia-14537";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=20260723-price-approval",
  "./app.js?v=20260723-price-approval",
  "./admin.js?v=20260723-price-approval",
  "./catalog-store.js?v=20260714-no-related-skus",
  "./supabase-client.js?v=20260723-price-approval",
  "./data/catalog-data.js?v=20260723-estia-14537",
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(APP_SHELL.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && (response.ok || response.type === "opaque")) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") return caches.match("./index.html");
        throw new Error("Offline and no cached response");
      }),
  );
});
