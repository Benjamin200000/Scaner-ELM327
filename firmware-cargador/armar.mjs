import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

// Uso: node armar.mjs <imagen.bin> <salida.html> [archivo-SHA256.txt]
// Si se da el archivo SHA256, la imagen tiene que coincidir con él.
const [, , binPath, salida, shaPath] = process.argv;
const bin = readFileSync(binPath);
const sha = createHash('sha256').update(bin).digest('hex');
if (shaPath) {
  const esperado = readFileSync(shaPath, 'utf8').trim().split(/\s+/)[0];
  if (sha !== esperado) throw new Error(`Imagen distinta a la publicada: ${sha} != ${esperado}`);
}
if (bin.length !== 4 * 1024 * 1024) throw new Error(`La imagen debe medir 4 MiB y mide ${bin.length}`);
let fin = bin.length;
while (fin > 0 && bin[fin - 1] === 0xff) fin--;
fin = Math.ceil(fin / 4) * 4;
const recorte = bin.subarray(0, fin);
console.log(`imagen ${bin.length} bytes, se escriben ${fin} (el resto es relleno 0xFF)`);

const r = await build({
  entryPoints: ['src/main.ts'], bundle: true, format: 'iife', minify: true, write: false,
  target: 'chrome100', legalComments: 'inline',
  define: {
    FIRMWARE_B64: JSON.stringify(recorte.toString('base64')),
    FIRMWARE_SHA256: JSON.stringify(sha),
    FIRMWARE_TOTAL: String(bin.length),
  },
});
const codigo = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('plantilla.html', 'utf8').replace('__SHA__', sha).replace('__CODE__', () => codigo);
writeFileSync(salida, html);
console.log(`${salida}: ${(html.length / 1024 / 1024).toFixed(2)} MB`);
