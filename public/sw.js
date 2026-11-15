/*
 * Service worker: deja la app utilizable sin conexión.
 *
 * En un taller la señal es mala y la app no necesita internet para nada:
 * habla con el adaptador, no con un servidor. Se guarda lo que se va
 * pidiendo y se sirve de ahí cuando no hay red. Con red, se actualiza en
 * segundo plano para que la próxima apertura traiga la versión nueva.
 */
const CACHE = 'escaner-obd-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const nombre of await caches.keys()) {
      if (nombre !== CACHE) await caches.delete(nombre);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const guardado = await cache.match(request);
    const deRed = fetch(request).then((respuesta) => {
      if (respuesta.ok) cache.put(request, respuesta.clone());
      return respuesta;
    }).catch(() => null);
    return guardado ?? (await deRed) ?? new Response('Sin conexión', { status: 503 });
  })());
});
