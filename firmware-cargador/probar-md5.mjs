import { build } from 'esbuild';
import { createHash, randomBytes } from 'node:crypto';
const r = await build({ entryPoints: ['src/md5.ts'], bundle: true, format: 'esm', write: false });
const { md5Hex } = await import('data:text/javascript,' + encodeURIComponent(r.outputFiles[0].text));
let n = 0;
for (const len of [0, 1, 55, 56, 63, 64, 65, 1000, 1762976]) {
  const d = randomBytes(len);
  const a = md5Hex(new Uint8Array(d)), b = createHash('md5').update(d).digest('hex');
  if (a !== b) throw new Error(`MD5 distinto en ${len}: ${a} ${b}`); n++;
}
console.log(`MD5: ${n} casos iguales a node:crypto`);
