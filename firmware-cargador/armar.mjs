import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';

const [, , binPath, salida] = process.argv;
const bin = readFileSync(binPath);
const sha = createHash('sha256').update(bin).digest('hex');
if (sha !== '4388ee8ee732e3af786e6d8aa21ef8117911f94ec8a74c7eb48c69488b1509b6') throw new Error('Imagen distinta a la publicada');
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
