/* Service worker pro Tlumočník — stará se JEN o to, aby šla appka nainstalovat
   na plochu a otevřít i bez signálu. Do vlastního tlumočení nijak nezasahuje:
   - požadavky na googleapis.com (Gemini) nechává úplně na pokoji,
   - WebSocket ani mikrofon service workerem vůbec neprochází,
   - cokoli jiného než GET se nikdy neukládá do cache. */
"use strict";

const CACHE = "tlumocnik-shell-v1";

/* "App shell" = jen soubory samotné aplikace. Nic víc se necachuje. */
const SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png"
];

/* Absolutní adresy shellu, ať je porovnání spolehlivé i v podadresáři /tlumocnik/ */
const SHELL_URLS = new Set(SHELL.map(p => new URL(p, self.registration.scope).href));

/* ---------- instalace: stáhneme shell dopředu ---------- */
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    /* allSettled = když se jeden soubor nepovede, instalace kvůli tomu nespadne */
    await Promise.allSettled(SHELL.map(p => cache.add(new Request(p, { cache: "reload" }))));
    await self.skipWaiting();
  })());
});

/* ---------- aktivace: úklid starých verzí cache ---------- */
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.map(n => (n === CACHE ? null : caches.delete(n))));
    await self.clients.claim();
  })());
});

/* ---------- rozhodnutí, čeho se vůbec smíme dotknout ---------- */
function isShellRequest(request) {
  if (request.method !== "GET") return false;              // POST apod. nikdy

  let url;
  try { url = new URL(request.url); } catch (e) { return false; }

  if (url.protocol !== "http:" && url.protocol !== "https:") return false; // blob:, data: …
  if (url.origin !== self.location.origin) return false;   // cizí server = ruce pryč
  if (/googleapis\.com$/i.test(url.hostname)) return false; // pojistka: Gemini nikdy

  /* Navigace (otevření appky) obsloužíme vždy, jinak jen soubory ze seznamu */
  if (request.mode === "navigate") return true;
  return SHELL_URLS.has(url.origin + url.pathname);
}

/* ---------- network-first: nejdřív internet, cache je jen záchranná síť ---------- */
self.addEventListener("fetch", event => {
  /* Když to není náš shell, NEVOLÁME respondWith — prohlížeč si to vyřídí sám,
     přesně jako by žádný service worker neexistoval. */
  if (!isShellRequest(event.request)) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(event.request);
      /* Uložíme jen povedené odpovědi z vlastního serveru */
      if (fresh && fresh.ok && fresh.type === "basic") {
        const cache = await caches.open(CACHE);
        cache.put(event.request, fresh.clone());
      }
      return fresh;
    } catch (e) {
      /* Offline → zkusíme, co máme uložené */
      const hit = await caches.match(event.request, { ignoreSearch: true });
      if (hit) return hit;
      if (event.request.mode === "navigate") {
        const index = await caches.match(new URL("./index.html", self.registration.scope).href);
        if (index) return index;
      }
      throw e;
    }
  })());
});
