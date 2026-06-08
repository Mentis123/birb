// Birb Mobile service worker — small offline cache so the game is playable
// after the first online visit. Bump CACHE_VERSION whenever you ship a
// release; the new SW will precache fresh shell assets and evict the old
// caches on activate.

const CACHE_VERSION = 'v6-2026-06-08';
const CORE_CACHE = `birb-core-${CACHE_VERSION}`;
const RUNTIME_CACHE = `birb-runtime-${CACHE_VERSION}`;

// Same-origin assets the game needs to boot offline. CDN modules
// (three, nipplejs from esm.sh) are populated into RUNTIME_CACHE on
// first fetch instead — they pull in transitive deps we can't predict.
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './splash.jpg',
  './info.jpg',
  './birb.glb',
  './sound/ambient-forest.mp3',
  './sound/rocket-fire.mp3',
  './sound/explosion.mp3',
  './src/flight/bird-flight.js',
  './src/flight/bird-camera.js',
  './src/flight/bird-visual.js',
  './src/flight/touch-input.js',
  './src/camera/camera-state.js',
  './src/camera/follow-camera.js',
  './src/camera/fpv-camera.js',
  './src/camera/sequence-camera.js',
  './src/controls/flight-controls.js',
  './src/controls/thumbstick.js',
  './src/controls/virtual-thumbstick.js',
  './src/environment/world-shell.js',
  './src/environment/spherical-world.js',
  './src/environment/landmark-valley.js',
  './src/environment/slalom-run.js',
  './src/environment/sky-dome.js',
  './src/environment/collectibles.js',
  './src/nesting/nest-points.js',
  './src/nesting/nesting-system.js',
  './src/nesting/aim-rig.js',
  './src/nesting/rocket.js',
  './src/nesting/drone-system.js',
  './src/effects/particles.js',
  './src/effects/screen-shake.js',
];

const RUNTIME_CACHEABLE_HOSTS = new Set([
  'esm.sh',
  'cdn.esm.sh',
]);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE);
    // addAll is all-or-nothing; do them individually so one missing file
    // doesn't sink the whole install.
    await Promise.all(CORE_ASSETS.map(async (url) => {
      try {
        const response = await fetch(url, { cache: 'reload' });
        if (response.ok || response.type === 'opaque') {
          await cache.put(url, response);
        }
      } catch (err) {
        // Network failed for one asset — skip it; runtime fetch will retry.
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((k) => k !== CORE_CACHE && k !== RUNTIME_CACHE)
        .map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Only handle http(s); ignore chrome-extension://, etc.
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return;

  const sameOrigin = url.origin === self.location.origin;
  const cdnCacheable = RUNTIME_CACHEABLE_HOSTS.has(url.host);
  if (!sameOrigin && !cdnCacheable) return;

  // Navigation requests: network-first so updates roll out without
  // forcing a SW version bump, fall back to cached shell offline.
  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Same-origin JS modules: stale-while-revalidate. Serve the cached copy
  // instantly (fast, offline-safe) but always re-fetch in the background so
  // the NEXT load runs the freshest code even without a version bump. This is
  // the self-healing layer that stops iOS pinning old module code.
  if (sameOrigin && url.pathname.endsWith('.js')) {
    event.respondWith(staleWhileRevalidate(event));
    return;
  }

  event.respondWith(cacheFirst(request));
});

// Serve from cache immediately, refresh the cache in the background. Heavy
// media stays on cacheFirst — only code goes through here, so the extra
// background fetches are small.
async function staleWhileRevalidate(event) {
  const { request } = event;
  const cache = await caches.open(CORE_CACHE);
  const cached = await cache.match(request, { ignoreSearch: false });
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    // Keep the worker alive long enough to finish the background refresh.
    event.waitUntil(network);
    return cached;
  }
  const fresh = await network;
  return fresh || new Response('', { status: 504, statusText: 'Offline' });
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CORE_CACHE);
      cache.put('./index.html', response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    const cached = await caches.match('./index.html', { ignoreSearch: true });
    if (cached) return cached;
    return caches.match('./');
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: false });
  if (cached) return rangeRespond(request, cached);

  try {
    const response = await fetch(request);
    if (response && (response.ok || response.type === 'opaque')) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(request, response.clone()).catch(() => {});
    }
    return response;
  } catch (err) {
    // Last-ditch: if the request had a Range header it won't match the
    // cached full-body entry by default, so try without the Range.
    const fallback = await caches.match(new Request(request.url));
    if (fallback) return rangeRespond(request, fallback);
    return new Response('', { status: 504, statusText: 'Offline' });
  }
}

// iOS Safari issues HTTP Range requests for <audio> playback. A naïve
// 200 OK response confuses some media engines, so when the request asked
// for a byte range and we have the full body cached, slice it into a
// proper 206 Partial Content response.
async function rangeRespond(request, response) {
  const range = request.headers.get('range');
  if (!range) return response;
  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!match) return response;

  const buffer = await response.clone().arrayBuffer();
  const total = buffer.byteLength;
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : total - 1;
  if (Number.isNaN(start) || Number.isNaN(end) || start >= total) return response;

  const slice = buffer.slice(start, end + 1);
  return new Response(slice, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Length': String(slice.byteLength),
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': response.headers.get('Cache-Control') || 'no-cache',
    },
  });
}
