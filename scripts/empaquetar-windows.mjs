#!/usr/bin/env node
/**
 * Arma el paquete portable para Windows: release/ScanerELM327-windows.zip
 *
 *   ScanerELM327.exe           Node 64 bits con el arranque embebido (SEA)
 *   ScanerELM327-32bits.exe    ídem en 32 bits, para DLL J2534 de 32 bits
 *   app/                       agente + app web compilada + node_modules
 *   LEEME.txt, *.cmd
 *
 * Se puede correr en Linux, macOS o Windows: los binarios de Windows no se
 * compilan acá, se toman ya hechos (node.exe del paquete npm oficial
 * node-win-*, y los prebuilds que traen serialport y koffi).
 *
 * Uso:  node scripts/empaquetar-windows.mjs [--sin-build] [--sin-zip]
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Misma versión para generar el blob y para el .exe: así no hay dudas de
// compatibilidad del formato SEA.
const NODE = '22.23.5';
const ARQUITECTURAS = [
  { npm: 'node-win-x64', exe: 'ScanerELM327.exe' },
  { npm: 'node-win-x86', exe: 'ScanerELM327-32bits.exe' },
];
const FUSIBLE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'release');
const PAQUETE = join(SALIDA, 'ScanerELM327');
const TRABAJO = join(SALIDA, '.trabajo');
const args = process.argv.slice(2);
const esWindows = process.platform === 'win32';
const npm = esWindows ? 'npm.cmd' : 'npm';

const correr = (cmd, argumentos, opciones = {}) =>
  execFileSync(cmd, argumentos, { stdio: 'inherit', shell: esWindows, ...opciones });
const paso = (texto) => console.log(`\n== ${texto}`);

rmSync(PAQUETE, { recursive: true, force: true });
rmSync(TRABAJO, { recursive: true, force: true });
mkdirSync(join(PAQUETE, 'app'), { recursive: true });
mkdirSync(TRABAJO, { recursive: true });

// 1. App web
if (!args.includes('--sin-build')) {
  paso('Compilando la app web');
  correr(npm, ['run', 'build'], { cwd: RAIZ });
}
if (!existsSync(join(RAIZ, 'dist', 'index.html'))) {
  throw new Error('No existe dist/index.html: corré "npm run build" primero.');
}
cpSync(join(RAIZ, 'dist'), join(PAQUETE, 'app', 'web'), { recursive: true });

// 2. Agente y dependencias de producción
paso('Copiando el agente');
const AGENTE = join(RAIZ, 'agent');
for (const f of ['scaner-agent.mjs', 'lib', 'package.json', 'package-lock.json']) {
  cpSync(join(AGENTE, f), join(PAQUETE, 'app', f), { recursive: true });
}
cpSync(join(RAIZ, 'windows', 'cargar.cjs'), join(PAQUETE, 'app', 'cargar.cjs'));
// --ignore-scripts: los binarios vienen prearmados dentro de los paquetes;
// no hay que compilar nada (y desde Linux no se podría compilar para Windows).
correr(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
  { cwd: join(PAQUETE, 'app') });

paso('Quitando binarios que no son de Windows');
const nm = join(PAQUETE, 'app', 'node_modules');
const dejarSolo = (dir, sirve) => {
  if (!existsSync(dir)) throw new Error(`Falta ${dir}`);
  for (const n of readdirSync(dir)) if (!sirve(n)) rmSync(join(dir, n), { recursive: true });
  const quedan = readdirSync(dir);
  if (quedan.length === 0) throw new Error(`No quedaron binarios de Windows en ${dir}`);
  console.log(`   ${dir.slice(nm.length + 1)}: ${quedan.join(', ')}`);
};
dejarSolo(join(nm, 'koffi', 'build', 'koffi'), (n) => /^win32_(x64|ia32|i386)$/.test(n));
dejarSolo(join(nm, '@serialport', 'bindings-cpp', 'prebuilds'), (n) => /^win32-(x64|ia32)$/.test(n));
// koffi 2.9.0 publica el binario de 32 bits en "win32_i386" pero al cargar lo
// busca en "win32_ia32". Sin esta copia, el .exe de 32 bits no puede usar J2534.
{
  const base = join(nm, 'koffi', 'build', 'koffi');
  if (!existsSync(join(base, 'win32_ia32'))) {
    cpSync(join(base, 'win32_i386'), join(base, 'win32_ia32'), { recursive: true });
    rmSync(join(base, 'win32_i386'), { recursive: true });
  }
}
for (const n of ['win32_x64', 'win32_ia32']) {
  if (!existsSync(join(nm, 'koffi', 'build', 'koffi', n, 'koffi.node'))) {
    throw new Error(`Falta el binario de koffi para ${n}`);
  }
}
for (const sobra of [
  ['koffi', 'src'], ['koffi', 'vendor'], ['koffi', 'doc'],
  ['@serialport', 'bindings-cpp', 'src'], ['@serialport', 'bindings-cpp', 'build'],
  ['@serialport', 'bindings-cpp', 'binding.gyp'],
  ['node-addon-api'],
]) rmSync(join(nm, ...sobra), { recursive: true, force: true });

// 3. Ejecutables: node.exe oficial + arranque embebido (single executable)
paso(`Preparando Node ${NODE} y el arranque embebido`);
const herramientas = join(TRABAJO, 'herramientas');
mkdirSync(herramientas, { recursive: true });
writeFileSync(join(herramientas, 'package.json'), '{"private":true}');
// Paquetes "de otra plataforma": --force evita el chequeo de os/cpu.
const paqueteNodoLocal = `node-${esWindows ? 'win' : process.platform}-${process.arch}`;
correr(npm, [
  'install', '--force', '--no-audit', '--no-fund', '--ignore-scripts', '--loglevel=error',
  'postject@1.0.0-alpha.6',
  `${paqueteNodoLocal}@${NODE}`,
  ...ARQUITECTURAS.map((a) => `${a.npm}@${NODE}`),
], { cwd: herramientas });

const hnm = join(herramientas, 'node_modules');
const nodoLocal = join(hnm, paqueteNodoLocal, 'bin', esWindows ? 'node.exe' : 'node');
if (!esWindows) chmodSync(nodoLocal, 0o755);

const blob = join(TRABAJO, 'arranque.blob');
writeFileSync(join(TRABAJO, 'sea.json'), JSON.stringify({
  main: join(RAIZ, 'windows', 'sea-main.cjs'),
  output: blob,
  disableExperimentalSEAWarning: true,
  // Sin snapshot ni code cache el blob sirve para cualquier plataforma.
  useSnapshot: false,
  useCodeCache: false,
}));
execFileSync(nodoLocal, ['--experimental-sea-config', join(TRABAJO, 'sea.json')], { stdio: 'inherit' });

const { inject } = await import(join(hnm, 'postject', 'dist', 'api.js')).then((m) => m.default ?? m);
for (const a of ARQUITECTURAS) {
  const destino = join(PAQUETE, a.exe);
  cpSync(join(hnm, a.npm, 'bin', 'node.exe'), destino);
  await inject(destino, 'NODE_SEA_BLOB', readFileSync(blob), { sentinelFuse: FUSIBLE });
  console.log(`   ${a.exe} listo`);
}

// 4. Accesos y documentación
paso('Accesos directos y LEEME');
const cmd = (lineas) => lineas.join('\r\n') + '\r\n';
writeFileSync(join(PAQUETE, 'Modo simulador.cmd'), cmd([
  '@echo off', 'cd /d "%~dp0"', 'ScanerELM327.exe --abrir --simular',
]));
writeFileSync(join(PAQUETE, 'Usar desde tablet.cmd'), cmd([
  '@echo off', 'cd /d "%~dp0"',
  'echo Abri en la tablet la direccion "Desde la red" que aparece abajo.',
  'echo Windows puede pedir permiso de Firewall: permitilo en redes privadas.',
  'ScanerELM327.exe --abrir --lan',
]));
writeFileSync(join(PAQUETE, 'Diagnostico.cmd'), cmd([
  '@echo off', 'cd /d "%~dp0"', 'set SCANER_SIN_PAUSA=1',
  'echo ===== 64 bits =====', 'ScanerELM327.exe --diagnostico',
  'echo ===== 32 bits =====', 'ScanerELM327-32bits.exe --diagnostico',
  'pause',
]));
writeFileSync(join(PAQUETE, 'LEEME.txt'),
  readFileSync(join(RAIZ, 'windows', 'LEEME.txt'), 'utf8').replace(/\r?\n/g, '\r\n'));

rmSync(TRABAJO, { recursive: true, force: true });

// 5. Zip
if (!args.includes('--sin-zip')) {
  paso('Comprimiendo');
  const zip = join(SALIDA, 'ScanerELM327-windows.zip');
  rmSync(zip, { force: true });
  if (esWindows) {
    correr('powershell', ['-NoProfile', '-Command',
      `Compress-Archive -Path '${PAQUETE}' -DestinationPath '${zip}'`], { shell: false });
  } else {
    correr('zip', ['-qr9', zip, 'ScanerELM327'], { cwd: SALIDA });
  }
  console.log(`\nListo: ${zip}`);
} else {
  console.log(`\nListo: ${PAQUETE}`);
}
