// Service worker: versioned cache for the app shell, network-first for index.html,
// cache-first for pinned CDN libraries and map tiles, and NEVER caches Supabase or the map
// search/data services (Nominatim, Overpass): those requests pass straight through.
// Bump VERSION on every release so users see "New version, reload".
const VERSION = 'vg-v1.2.0';
const SHELL = [
  './', './index.html', './config.js', './manifest.webmanifest', './css/style.css',
  './js/app.js', './js/state.js', './js/shared.js', './js/i18n.js', './js/ui.js', './js/map.js', './js/scene3d.js', './js/osm.js', './js/models3d.js',
  './js/data.js', './js/data-demo.js', './js/data-supabase.js',
  './js/views-auth.js', './js/views-home.js', './js/views-map.js', './js/views-requests.js', './js/views-business.js',
  './js/views-admin.js', './js/views-owner.js', './js/views-settings.js', './js/views-setup.js',
  './data/demo-village.json', './data/maps/index.json', './data/maps/al-safa.json',
  './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png',
];
const CDN = ['https://unpkg.com/leaflet@1.9.4/', 'https://cdn.jsdelivr.net/npm/three@0.170.0/', 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@'];
const TILES = 'https://tile.openstreetmap.org/';
const TILE_CACHE = 'vg-tiles';
const MAX_TILES = 600;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== TILE_CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')) return; // never cache the backend

  // index.html / navigations: network first, fall back to cache when offline
  if (req.mode === 'navigate' || (url.origin === location.origin && url.pathname.endsWith('/index.html'))) {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone(); caches.open(VERSION).then(c => c.put('./index.html', copy));
      return res;
    }).catch(() => caches.match('./index.html')));
    return;
  }
  // map tiles: cache first, keep the cache small
  if (req.url.startsWith(TILES)) {
    e.respondWith(caches.open(TILE_CACHE).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      const res = await fetch(req);
      if (res.ok || res.type === 'opaque') {
        c.put(req, res.clone());
        c.keys().then(k => { if (k.length > MAX_TILES) k.slice(0, k.length - MAX_TILES).forEach(r => c.delete(r)); });
      }
      return res;
    }).catch(() => caches.match(req)));
    return;
  }
  // pinned CDN libraries + our own files: cache first, then network (and store)
  if (url.origin === location.origin || CDN.some(p => req.url.startsWith(p))) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    })));
  }
});
