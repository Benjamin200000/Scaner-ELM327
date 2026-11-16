import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

/**
 * Sirve la app web ya compilada desde el mismo puerto del agente.
 *
 * Con esto el programa entero es un solo proceso: se abre
 * http://127.0.0.1:<puerto> y no hace falta internet ni otro servidor.
 * Solo archivos estáticos, solo GET/HEAD, y nunca fuera de la carpeta.
 */

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/** Devuelve la carpeta si contiene una app compilada; si no, null. */
export function carpetaWebValida(dir) {
  if (!dir) return null;
  const abs = resolve(dir);
  return existsSync(join(abs, 'index.html')) ? abs : null;
}

/**
 * Resuelve una ruta de URL a un archivo dentro de `raiz`.
 * Devuelve null si la ruta intenta salir de la carpeta o no existe.
 */
export function resolverArchivo(raiz, rutaUrl) {
  let ruta;
  try {
    ruta = decodeURIComponent(rutaUrl.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (ruta.includes('\0')) return null;
  if (ruta.endsWith('/')) ruta += 'index.html';
  const destino = normalize(join(raiz, ruta));
  if (destino !== raiz && !destino.startsWith(raiz + sep)) return null;
  try {
    return statSync(destino).isFile() ? destino : null;
  } catch {
    return null;
  }
}

export function crearManejadorWeb(raiz) {
  return (req, res) => {
    const responder = (codigo, texto) => {
      res.writeHead(codigo, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(texto);
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return responder(405, 'Método no permitido');
    }
    if (raiz === null) {
      return responder(404,
        'Este agente no tiene la app web incluida. Usá --web <carpeta> o abrí la app aparte.');
    }
    const archivo = resolverArchivo(raiz, req.url ?? '/');
    if (archivo === null) return responder(404, 'No encontrado');
    const ext = extname(archivo).toLowerCase();
    res.writeHead(200, {
      'Content-Type': TIPOS[ext] ?? 'application/octet-stream',
      // El service worker y el index no se cachean: si se actualiza el
      // programa, tiene que verse la versión nueva al abrir.
      'Cache-Control': ext === '.html' || archivo.endsWith('sw.js')
        ? 'no-cache'
        : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(archivo).on('error', () => res.destroy()).pipe(res);
  };
}
