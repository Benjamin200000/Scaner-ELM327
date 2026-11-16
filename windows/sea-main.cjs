// Punto de entrada embebido en ScanerELM327.exe (Node "single executable").
// El .exe es Node con este archivo adentro; todo lo demás vive en la carpeta
// "app" junto al .exe, para que los módulos nativos (puerto serie, J2534) se
// carguen desde disco como en una instalación normal.
const { createRequire } = require('node:module');
const path = require('node:path');

const app = path.join(path.dirname(process.execPath), 'app');
// Doble clic sin argumentos: abrir el programa en el navegador.
if (process.argv.length <= 2) process.argv.push('--abrir');
try {
  createRequire(path.join(app, 'cargar.cjs'))('./cargar.cjs');
} catch (err) {
  console.error('\nNo se pudo iniciar el programa.');
  console.error('Falta la carpeta "app" junto al .exe, o está incompleta.');
  console.error('Descomprimí el .zip completo en una carpeta y abrí el .exe desde ahí.\n');
  console.error(String(err && err.message ? err.message : err));
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15000);
  process.exit(1);
}
