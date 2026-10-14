// Offline support. Own files: network first, so new posts show up when online.
// CDN script + Medium cover images: cache first. Model files are cached by Transformers.js itself.
const CACHE = 'blog-search-v2';
const SHELL = ['./', 'index.html', 'app.js', 'search.js', 'posts.json', 'chunks.json', 'vectors.bin'];
const CACHE_FIRST = ['cdn.jsdelivr.net', 'cdn-images-1.medium.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('blog-search-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === location.origin) e.respondWith(networkFirst(e.request));
  else if (CACHE_FIRST.includes(url.hostname)) e.respondWith(cacheFirst(e.request));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: true })) ?? Response.error();
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}
