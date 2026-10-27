const CACHE_NAME = "lexo-catalog-v20261027-admin-dashboard";
const PAGE_CACHE_NAME = "lexo-catalog-pages-v20261021-page-performance";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css?v=20261015-delivery-hours",
  "./dialog-compat.js?v=20260819-ipad-dialogs",
  "./app.js?v=20261027-preview-r4",
  "./data/product-browse-data.js?v=20261005-oxo-r1",
  "./sales-dashboard-access.js?v=20261027-admin-r9",
  "./sales-dashboard-model.js?v=20261009-sales-analysis-r1",
  "./sales-dashboard.js?v=20261027-admin-r9",
  "./sales-bi.css?v=20261027-admin-r9",
  "./sales-product-brands.js?v=20261019-brand-review-r1",
  "./sales-bi-model.js?v=20261027-admin-r9",
  "./sales-bi.js?v=20261027-admin-r9",
  "./admin.js?v=20261006-ean-r1",
  "./catalog-store.js?v=20261005-oxo-r1",
  "./supabase-client.js?v=20261027-admin-r9",
  "./data/catalog-data.js?v=20261005-oxo-r1",
  "./assets/lexo-favicon.png?v=20260728-r2",
  "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
  "./assets/vendor/supabase-2.118.0.min.js",
  "./assets/vendor/jspdf.umd.min.js?v=2.5.2",
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
      .then((keys) => Promise.all(keys.filter((key) => ![CACHE_NAME, PAGE_CACHE_NAME].includes(key)).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if(request.headers?.has?.('authorization') || url.pathname.startsWith('/__')) return;
  // Authenticated database responses must never enter the shared offline cache.
  if (url.origin !== self.location.origin && !APP_SHELL.includes(url.href)) return;
  const isCatalogPage = url.origin === self.location.origin && url.pathname.includes("/assets/pages/");

  // Page URLs are versioned. A saved page must not wait for another network trip.
  if (isCatalogPage) {
    event.respondWith((async () => {
      let cache;
      try {
        cache = await caches.open(PAGE_CACHE_NAME);
        const cached = await cache.match(request);
        if (cached) return cached;
      } catch { /* Storage restrictions must not block an online page. */ }
      const response = await fetch(request);
      if (response?.ok && cache) event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
      return response;
    })());
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && (response.ok || response.type === "opaque")) {
          const copy = response.clone();
          caches.open(isCatalogPage ? PAGE_CACHE_NAME : CACHE_NAME).then((cache) => cache.put(request, copy));
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
