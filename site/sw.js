/* App shell is stamped so a deploy swaps in a new cache. Projection files stay
   network-first in their own cache, so an update does not discard the last good
   data.json, market.json, or news.json when the network is down. */
const VER = 'dcbe605776';
const SHELL_CACHE = 'ml-shell-' + VER;
const DATA_CACHE = 'ml-data';
const VERSIONED = ['styles.css', 'themes.css', 'app.js', 'model.js', 'lineup.js', 'team.js', 'glossary.js', 'trade.js', 'chants.js', 'chart.umd.min.js'];
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
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL);
    // The first visit has no active worker, so it takes control immediately.
    // A later version stays waiting until the refresh button posts SKIP_WAITING,
    // which keeps an open tab from reloading on its own.
    if (!self.registration.active) self.skipWaiting();
  })());
});

self.addEventListener('message', event => {
  const data = event.data;
  const type = data && typeof data === 'object' ? data.type : data;
  if (type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('ml-shell-') && key !== SHELL_CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

function isProjectionData(url) {
  return /\/(?:data|market|news)\.json$/.test(url.pathname);
}

function wantsFresh(request) {
  return new URL(request.url).searchParams.has('fresh');
}

async function networkFirstData(request) {
  const cache = await caches.open(DATA_CACHE);
  const url = new URL(request.url);
  const stable = new Request(url.origin + url.pathname);
  const fresh = wantsFresh(request);
  // A refresh must not be answered by the HTTP cache or by ml-data. cache:'reload'
  // skips the HTTP cache; the fresh flag skips the data cache below.
  try {
    // Fresh requests use cache:'reload' so the HTTP cache cannot answer them.
    const res = fresh
      ? await fetch(new Request(request.url, { cache: 'reload', mode: 'cors', credentials: 'omit', redirect: 'follow' }))
      : await fetch(request);
    if (res && res.ok) {
      await cache.put(stable, res.clone());
      return res;
    }
    // A manual refresh must fail visibly so the page can keep the data on screen.
    if (fresh) return res;
    const cached = await cache.match(stable);
    return cached || res;
  } catch (err) {
    if (fresh) throw err;
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
