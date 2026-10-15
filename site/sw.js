/* App shell is stamped so a deploy swaps in a new cache. Projection files stay
   network-first in their own cache, so an update does not discard the last good
   data.json, market.json, or news.json when the network is down. */
const VER = '554c784b7a';
const SHELL_CACHE = 'ml-shell-' + VER;
const DATA_CACHE = 'ml-data';
const VERSIONED = ['styles.css', 'themes.css', 'app.js', 'model.js', 'lineup.js', 'team.js', 'glossary.js', 'trade.js', 'chart.umd.min.js'];
const SHELL = [
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
  './apple-touch-icon.png',
  './icon.svg',
  './favicon.ico',
].concat(VERSIONED.map(name => './' + name), VERSIONED.map(name => './' + name + '?v=' + VER));

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('ml-shell-') && key !== SHELL_CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

function isProjectionData(url) {
  return /\/(?:data|market|news)\.json$/.test(url.pathname);
}

async function networkFirstData(request) {
  const cache = await caches.open(DATA_CACHE);
  const url = new URL(request.url);
  const stable = new Request(url.origin + url.pathname);
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      await cache.put(stable, res.clone());
      return res;
    }
    const cached = await cache.match(stable);
    return cached || res;
  } catch (err) {
    const cached = await cache.match(stable);
    if (cached) return cached;
    throw err;
  }
}

async function fromShell(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const loose = await cache.match(request, { ignoreSearch: true });
    if (loose) return loose;
    throw err;
  }
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (isProjectionData(url)) {
    event.respondWith(networkFirstData(event.request));
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        const res = await fetch(event.request);
        if (res && res.ok) await cache.put('./index.html', res.clone());
        return res;
      } catch (err) {
        const page = await cache.match('./index.html');
        if (page) return page;
        throw err;
      }
    })());
    return;
  }
  event.respondWith(fromShell(event.request));
});
