/*
 * Synapse service worker.
 *
 * Goals, in order: open instantly, keep working on a bad connection, never
 * serve another account's data. Strategy per request type:
 *
 *   /_next/static, icons, fonts  → cache first (content-hashed, immutable)
 *   page navigations             → network first, cached shell when offline
 *   read-only API GETs           → network first, last good copy when offline
 *   everything else              → straight to the network
 *
 * Signing out wipes the data cache.
 */
const VERSION = 'v1';
const STATIC = `synapse-static-${VERSION}`;
const PAGES = `synapse-pages-${VERSION}`;
const DATA = `synapse-data-${VERSION}`;

const CACHEABLE_API = [
  /^\/api\/graph$/,
  /^\/api\/notes$/,
  /^\/api\/spaces$/,
  /^\/api\/clusters$/,
  /^\/api\/me$/,
  /^\/api\/highlights$/,
  /^\/api\/training\/run$/,
  /^\/api\/training\/week\/(\d+|current)$/,
];

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Synapse — offline</title>
<style>html,body{height:100%;margin:0;background:#0b0d12;color:#e9ecf3;font:15px/1.5 system-ui,sans-serif}
main{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center}
small{color:#9aa2b8}button{margin-top:8px;background:#7c8cff;color:#0b0d12;border:0;border-radius:10px;padding:10px 18px;font-weight:600}</style>
</head><body><main><strong>You're offline</strong><small>Synapse will pick up where you left off once you're back online.</small>
<button onclick="location.reload()">Try again</button></main></body></html>`;

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC, PAGES, DATA]);
      for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method === 'POST' && url.origin === self.location.origin && url.pathname === '/auth/signout') {
    event.waitUntil(Promise.all([caches.delete(DATA), caches.delete(PAGES)]));
    return;
  }
  if (req.method !== 'GET') return;

  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';

  if (isFont || (sameOrigin && (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/pwa-icon/')))) {
    event.respondWith(cacheFirst(req, STATIC));
    return;
  }
  if (!sameOrigin) return;

  if (req.mode === 'navigate') {
    // Never cache the auth flow itself.
    if (url.pathname.startsWith('/auth') || url.pathname.startsWith('/login')) return;
    event.respondWith(networkFirst(req, PAGES, () => new Response(OFFLINE_HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })));
    return;
  }

  if (CACHEABLE_API.some((re) => re.test(url.pathname))) {
    event.respondWith(networkFirst(req, DATA, () => new Response(
      JSON.stringify({ error: 'Offline — showing nothing new until you reconnect', offline: true }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )));
  }
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req, cacheName, fallback) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    // Only keep successful, non-redirected responses: a redirect to /login
    // must never be replayed as if it were the app.
    if (res.ok && !res.redirected) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req)) ?? fallback();
  }
}
