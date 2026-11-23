// Service worker: stranica radi i bez veze. Objavljuje ga src/pages/sw.js.ts, koji upisuje verziju.
// Stranice i podaci: prvo mreža (vozni red mora biti svjež), a bez veze ili uz sporu vezu spremljena kopija.
// /_astro/*: ime sadrži sažetak sadržaja, pa se kopija nikad ne provjerava.
const VERSION = '__VERSION__';
const PAGES = `stranice-${VERSION}`;
const ASSETS = 'dijelovi';
const PRECACHE = ['/offline', '/', '/linije', '/stanice', '/put'];
const DATA = ['/data/index.json', '/data/planer.json', '/manifest.webmanifest', '/icon.svg'];
const SLOW = 4000;
const MAX_PAGES = 250;
const MAX_ASSETS = 150;
/** Karta je velika i bez veze ionako nema podlogu. */
const SKIP = /maplibre/;

const key = (url) => new URL(url, self.location.origin).origin + new URL(url, self.location.origin).pathname.replace(/(.)\/$/, '$1');

async function trim(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(k);
}

/** Skripte, stilovi i fontovi stranice, uključujući uvoze iz skripti. */
async function saveAssets(text, base, seen) {
  const found = new Set();
  for (const m of text.matchAll(/\/_astro\/[\w.@-]+\.(?:js|mjs|css|woff2)/g)) found.add(m[0]);
  for (const m of text.matchAll(/["'`(](\.{1,2}\/[\w.@-]+\.(?:js|mjs|css|woff2))["'`)]/g)) found.add(new URL(m[1], base).pathname);
  const cache = await caches.open(ASSETS);
  await Promise.all([...found].filter((p) => !seen.has(p) && !SKIP.test(p) && !/cyrillic-ext|vietnamese|italic/.test(p)).map(async (path) => {
    seen.add(path);
    const url = self.location.origin + path;
    let res = await cache.match(url);
    if (!res) {
      res = await fetch(url);
      if (!res.ok) return;
      await cache.put(url, res.clone());
    }
    if (/\.(js|mjs|css)$/.test(path)) await saveAssets(await res.text(), url, seen);
  }));
}

async function save(path, seen = new Set()) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) return;
  const cache = await caches.open(PAGES);
  // Preusmjeren odgovor preglednik ne prihvaća kao stranicu, pa se sprema kao običan.
  await cache.put(key(path), res.redirected ? new Response(await res.clone().blob(), { headers: res.headers }) : res.clone());
  if ((res.headers.get('content-type') ?? '').includes('html')) await saveAssets(await res.text(), self.location.origin + path, seen);
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const seen = new Set();
    await save('/offline', seen); // bez nje nema smisla
    await Promise.allSettled([...PRECACHE.slice(1), ...DATA].map((p) => save(p, seen)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const name of await caches.keys()) if (name.startsWith('stranice-') && name !== PAGES) await caches.delete(name);
    await trim(ASSETS, MAX_ASSETS);
    await self.clients.claim();
  })());
});

/** Stranica šalje spremljene stanice i linije, da rade i bez veze. */
self.addEventListener('message', (e) => {
  const paths = Array.isArray(e.data?.save) ? e.data.save.filter((p) => typeof p === 'string' && /^\/(stanica|linija|data)\//.test(p)).slice(0, 40) : [];
  e.waitUntil((async () => {
    const cache = await caches.open(PAGES);
    const seen = new Set();
    await Promise.allSettled(paths.map(async (p) => { if (!(await cache.match(key(p)))) await save(p, seen); }));
    await trim(PAGES, MAX_PAGES);
  })());
});

/** Odgovor i posao koji se nastavlja nakon njega (spremanje svježe kopije). */
function fromNetwork(request) {
  const k = key(request.url);
  const opened = caches.open(PAGES);
  let store = Promise.resolve();
  const network = fetch(request).then((res) => {
    if (res.ok && res.type === 'basic' && !res.redirected) {
      const copy = res.clone();
      store = opened.then((cache) => cache.put(k, copy));
    }
    return res;
  });
  const response = (async () => {
    const saved = await (await opened).match(k);
    if (!saved) return network;
    const slow = new Promise((done) => { setTimeout(() => done(saved), SLOW); });
    return Promise.race([network.catch(() => saved), slow]);
  })();
  return { response, work: network.then(() => store, () => {}) };
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('range')) return;
  if (url.pathname.startsWith('/_astro/')) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSETS);
      const saved = await cache.match(url.origin + url.pathname);
      if (saved) return saved;
      const res = await fetch(request);
      if (res.ok && !SKIP.test(url.pathname)) await cache.put(url.origin + url.pathname, res.clone());
      return res;
    })());
  } else if (request.mode === 'navigate') {
    const { response, work } = fromNetwork(request);
    event.respondWith(response.catch(async () => (await (await caches.open(PAGES)).match(key('/offline'))) ?? Response.error()));
    event.waitUntil(work);
  } else if (url.pathname.startsWith('/data/') || url.pathname === '/icon.svg' || url.pathname === '/manifest.webmanifest') {
    const { response, work } = fromNetwork(request);
    event.respondWith(response);
    event.waitUntil(work);
  }
});
