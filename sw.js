// Offline support: app shell is precached; the OCR engine is cached the first time it is used.
const VERSION = 'shoebox-v1.0.0';
const SHELL = [
  './', './index.html', './privacy.html', './manifest.webmanifest', './css/styles.css',
  './js/app.js', './js/config.js', './js/db.js', './js/dates.js', './js/parse.js', './js/ocr.js', './js/export.js', './js/pro.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './fonts/fraunces-latin-wght-normal.woff2',
];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== 'shoebox-share').map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function handleShare(request) {
  try {
    const form = await request.formData();
    const cache = await caches.open('shoebox-share');
    let i = 0;
    for (const f of form.getAll('receipts')) {
      if (f && f.type && f.type.startsWith('image/')) await cache.put(new Request(`./shared/${Date.now()}-${i++}-${encodeURIComponent(f.name || 'receipt')}`), new Response(f, { headers: { 'content-type': f.type } }));
    }
  } catch { /* fall through to the app */ }
  return Response.redirect('./?shared=1', 303);
}

self.addEventListener('fetch', (event) => {
  const req = event.request, url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) { event.respondWith(handleShare(req)); return; }
  if (req.method !== 'GET') return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
    const network = fetch(req).then((res) => { if (res && res.ok && res.type === 'basic' && res.status === 200) cache.put(req, res.clone()); return res; }).catch(() => null);
    if (cached) { event.waitUntil(network); return cached; }
    const res = await network;
    if (res) return res;
    if (req.mode === 'navigate') return (await cache.match('./index.html')) || Response.error();
    return Response.error();
  })());
});
