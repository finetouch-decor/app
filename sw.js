// Service worker do PWA do ERP Fine Touch.
//
// So cacheia assets estaticos PUROS (logo, icones, manifest) -- nunca HTML, nunca JS de
// pagina, nunca nada de /api/ ou de outro dominio (Supabase incluido). Paginas de ERP
// mostram dado financeiro/cliente; servir uma versao antiga offline por engano e pior
// do que nao ter PWA nenhum. O beneficio aqui e so instalabilidade (Android/Chrome exige
// um service worker pra oferecer "Adicionar a tela inicial") + o icone funcionar mesmo
// sem rede por um instante.
const CACHE_NAME = 'ft-erp-shell-v1';
const CACHEABLE = /\.(png|jpg|jpeg|svg|ico|webp)$/i;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // nunca Supabase/terceiros
  if (url.pathname.startsWith('/api/')) return;      // nunca rotas de API

  if (url.pathname === '/manifest.json' || CACHEABLE.test(url.pathname)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          });
        })
      )
    );
  }
  // HTML, JS de pagina e qualquer outra coisa: sempre direto na rede, nunca cacheado.
});
