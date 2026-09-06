// Birb Mobile service worker — small offline cache so the game is playable
// after the first online visit. Bump CACHE_VERSION whenever you ship a
// release; the new SW will precache fresh shell assets and evict the old
// caches on activate.

// Bumped for the /grokrogue bypass below: the version change evicts CORE_CACHE
// on activate so the new sibling route cannot inherit stale shell handling.
const CACHE_VERSION = 'v24-2026-09-06-biome-landmarks';

/**
 * Paths owned by other Birb Labs artefacts. This worker must not touch them.
 * See the bypass in the fetch handler for why this is a correctness issue and
 * not housekeeping.
 */
const SIBLING_ARTEFACTS = ['/gauntlet', '/sculpture', '/grokrogue', '/AR', '/ar'];
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
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './splash.jpg',
  './info.jpg',
  // NOT precached (install-weight diet, ~7.3 MB saved):
  // - ./birb.glb (1.7 MB) — only loads behind the ?glb=1 A/B flag; the
  //   runtime cache picks it up on demand for whoever uses that flag.
  // - ./sound/ambient-mountain.mp3 (5.6 MB) — setAmbientMusic deliberately
  //   pins the forest track (users asked for the original back), so the
  //   mountain track is currently unplayed. Re-add here if track switching
  //   ever returns.
  './sound/ambient-forest.mp3',
  './sound/rocket-fire.mp3',
  './sound/explosion.mp3',
  './sound/ring-collect.wav',
  './src/flight/bird-flight.js',
  './src/flight/bird-camera.js',
  './src/flight/bird-visual.js',
  './src/flight/touch-input.js',
  './src/flight/flight-recovery.js',
  './src/flight/bird-pose.js',
  './src/game/game-modes.js',
  './src/game/frame-metrics.js',
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
  './src/environment/visual-style.js',
  './src/nesting/nest-placement.js',
  './src/nesting/nest-occlusion.js',
  './src/environment/collectibles.js',
  './src/environment/collider-grid.js',
  './src/ui/minimap.js',
  './src/nesting/nest-points.js',
  './src/nesting/nesting-system.js',
  './src/nesting/aim-rig.js',
  './src/nesting/rocket.js',
  './src/nesting/drone-system.js',
  './src/effects/contact-shadow.js',
  './src/effects/ribbon-trail.js',
  './src/effects/burst-signatures.js',
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

  // Sibling Birb Labs artefacts are separate, self-contained apps with their own
  // asset graphs. They are deliberately excluded from this service worker.
  //
  // This is not tidiness — it is a correctness fix. networkFirst() below writes
  // EVERY navigation response into the cache under the key './index.html', so
  // a single visit to /gauntlet would overwrite Birb Mobile's offline shell with
  // Birb Gauntlet's HTML, and the next offline launch of the main game would boot the
  // wrong game. Bypassing here keeps the artefacts fully independent.
  //
  // Add every new sibling to this list BEFORE it ships, not after someone
  // reports the main game booting the wrong thing.
  //
  // /AR (and the /ar redirect that feeds it) was the "after someone reports it"
  // case: the AR pages shipped inside this origin without a bypass, so every
  // visit to /AR/game.html wrote the shooter's HTML over './index.html' and the
  // next flaky-network launch of Birb Mobile served the wrong game — or served
  // Birb Mobile's shell AT the /AR/ URL, where its relative ./src/ imports all
  // 404 and the page renders blank. Both directions look like "it doesn't load".
  if (sameOrigin && SIBLING_ARTEFACTS.some((p) => url.pathname.startsWith(p))) return;

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
