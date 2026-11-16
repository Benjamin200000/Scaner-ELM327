#!/usr/bin/env node
/**
 * Arma la aplicación de escritorio para Windows (ventana propia, sin navegador).
 *
 *   release/ScanerELM327-win-x64.zip     64 bits: ELM327 y cable KKL
 *   release/ScanerELM327-win-ia32.zip    32 bits: para DLL J2534 de 32 bits
 *
 * Cada una trae ScanerELM327.exe (Electron), el agente, la app compilada y
 * los módulos nativos de puerto serie y J2534. Corre en Linux, macOS o
 * Windows: nada se compila, los binarios de Windows se toman ya hechos.
 *
 * Uso:  node scripts/empaquetar-windows.mjs [--sin-build] [--sin-zip] [--arq x64|ia32]
 */
import { execFileSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ELECTRON = '43.8.10';
const PACKAGER = '20.3.0';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = join(RAIZ, 'release');
const TRABAJO = join(SALIDA, '.trabajo');
const FUENTE = join(TRABAJO, 'app');
const args = process.argv.slice(2);
const soloArq = args.includes('--arq') ? args[args.indexOf('--arq') + 1] : null;
const ARQS = (soloArq ? [soloArq] : ['x64', 'ia32']);
const esWindows = process.platform === 'win32';
const npm = esWindows ? 'npm.cmd' : 'npm';
const version = JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).version;

const correr = (cmd, argumentos, opciones = {}) =>
  execFileSync(cmd, argumentos, { stdio: 'inherit', shell: esWindows, ...opciones });
const paso = (texto) => console.log(`\n== ${texto}`);

rmSync(TRABAJO, { recursive: true, force: true });
mkdirSync(FUENTE, { recursive: true });

// 1. App web
if (!args.includes('--sin-build')) {
  paso('Compilando la app web');
  correr(npm, ['run', 'build'], { cwd: RAIZ });
}
if (!existsSync(join(RAIZ, 'dist', 'index.html'))) {
  throw new Error('No existe dist/index.html: corré "npm run build" primero.');
}
cpSync(join(RAIZ, 'dist'), join(FUENTE, 'web'), { recursive: true });

// 2. Proceso principal, agente y dependencias de producción
paso('Copiando el agente');
cpSync(join(RAIZ, 'desktop', 'main.mjs'), join(FUENTE, 'main.mjs'));
cpSync(join(RAIZ, 'desktop', 'icono.png'), join(FUENTE, 'icono.png'));
writeFileSync(join(FUENTE, 'package.json'), JSON.stringify({
  name: 'scaner-elm327', productName: 'ScanerELM327', version,
  description: 'Diagnóstico automotriz: ELM327, K-Line VAG y J2534',
  main: 'main.mjs', type: 'module', private: true,
}, null, 2));
const AGENTE = join(RAIZ, 'agent');
mkdirSync(join(FUENTE, 'agent'));
for (const f of ['scaner-agent.mjs', 'lib', 'package.json', 'package-lock.json']) {
  cpSync(join(AGENTE, f), join(FUENTE, 'agent', f), { recursive: true });
}
// --ignore-scripts: los binarios vienen prearmados dentro de los paquetes;
// no hay que compilar nada (y desde Linux no se podría compilar para Windows).
correr(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'],
  { cwd: join(FUENTE, 'agent') });

paso('Dejando solo los binarios de Windows');
const nm = join(FUENTE, 'agent', 'node_modules');
const koffiBin = join(nm, 'koffi', 'build', 'koffi');
// koffi 2.9.0 publica el binario de 32 bits en "win32_i386" pero al cargar lo
// busca en "win32_ia32". Sin este cambio, la versión de 32 bits no puede usar J2534.
if (!existsSync(join(koffiBin, 'win32_ia32'))) {
  renameSync(join(koffiBin, 'win32_i386'), join(koffiBin, 'win32_ia32'));
}
const dejarSolo = (dir, sirve) => {
  for (const n of readdirSync(dir)) if (!sirve(n)) rmSync(join(dir, n), { recursive: true });
  const quedan = readdirSync(dir);
  if (quedan.length !== 2) throw new Error(`Se esperaban 2 binarios de Windows en ${dir}: ${quedan}`);
  console.log(`   ${dir.slice(nm.length + 1)}: ${quedan.join(', ')}`);
};
dejarSolo(koffiBin, (n) => /^win32_(x64|ia32)$/.test(n));
dejarSolo(join(nm, '@serialport', 'bindings-cpp', 'prebuilds'), (n) => /^win32-(x64|ia32)$/.test(n));
for (const sobra of [
  ['koffi', 'src'], ['koffi', 'vendor'], ['koffi', 'doc'],
  ['@serialport', 'bindings-cpp', 'src'], ['@serialport', 'bindings-cpp', 'build'],
  ['@serialport', 'bindings-cpp', 'binding.gyp'],
  ['node-addon-api'],
]) rmSync(join(nm, ...sobra), { recursive: true, force: true });

// 3. Electron
paso(`Empaquetando con Electron ${ELECTRON}`);
const herramientas = join(TRABAJO, 'herramientas');
mkdirSync(herramientas, { recursive: true });
writeFileSync(join(herramientas, 'package.json'), '{"private":true}');
correr(npm, ['install', '--no-audit', '--no-fund', '--loglevel=error', `@electron/packager@${PACKAGER}`],
  { cwd: herramientas });
const { packager } = await import(
  pathToFileURL(join(herramientas, 'node_modules', '@electron', 'packager', 'dist', 'index.js')).href
);
// Electron se baja con curl a una caché propia: es más robusto que el
// descargador del empaquetador detrás de un proxy, y no se repite cada vez.
const CACHE = join(SALIDA, '.cache');
mkdirSync(CACHE, { recursive: true });
for (const arq of ARQS) {
  const zip = `electron-v${ELECTRON}-win32-${arq}.zip`;
  if (existsSync(join(CACHE, zip))) continue;
  console.log(`   bajando ${zip}`);
  execFileSync('curl', ['-fsSL', '--retry', '4', '-o', join(CACHE, zip + '.parcial'),
    `https://github.com/electron/electron/releases/download/v${ELECTRON}/${zip}`], { stdio: 'inherit' });
  renameSync(join(CACHE, zip + '.parcial'), join(CACHE, zip));
}
const carpetas = await packager({
  electronZipDir: CACHE,
  dir: FUENTE,
  out: TRABAJO,
  name: 'ScanerELM327',
  platform: 'win32',
  arch: ARQS,
  electronVersion: ELECTRON,
  appVersion: version,
  icon: join(RAIZ, 'desktop', 'icono.ico'),
  // Sin asar: los módulos nativos se cargan desde disco, sin sorpresas.
  asar: false,
  prune: false,
  overwrite: true,
  quiet: true,
  win32metadata: { CompanyName: 'Scaner ELM327', FileDescription: 'Scaner ELM327', ProductName: 'Scaner ELM327' },
});

// 4. Accesos, LEEME y zip
const cmd = (lineas) => lineas.join('\r\n') + '\r\n';
const leeme = readFileSync(join(RAIZ, 'windows', 'LEEME.txt'), 'utf8').replace(/\r?\n/g, '\r\n');
for (const carpeta of carpetas) {
  const arq = /-(x64|ia32)$/.exec(carpeta)[1];
  const nombre = `ScanerELM327-${arq === 'x64' ? '64bits' : '32bits'}`;
  const destino = join(SALIDA, nombre);
  rmSync(destino, { recursive: true, force: true });
  renameSync(carpeta, destino);
  if (!existsSync(join(destino, 'ScanerELM327.exe'))) throw new Error(`Falta el .exe en ${destino}`);
  writeFileSync(join(destino, 'Modo simulador.cmd'), cmd([
    '@echo off', 'cd /d "%~dp0"', 'start "" ScanerELM327.exe --simular',
  ]));
  writeFileSync(join(destino, 'Usar desde tablet.cmd'), cmd([
    '@echo off', 'cd /d "%~dp0"', 'start "" ScanerELM327.exe --lan',
  ]));
  writeFileSync(join(destino, 'LEEME.txt'), leeme);
  if (!args.includes('--sin-zip')) {
    paso(`Comprimiendo ${nombre}`);
    const zip = join(SALIDA, `${nombre}.zip`);
    rmSync(zip, { force: true });
    if (esWindows) {
      correr('powershell', ['-NoProfile', '-Command',
        `Compress-Archive -Path '${destino}' -DestinationPath '${zip}'`], { shell: false });
    } else {
      correr('zip', ['-qr9', zip, nombre], { cwd: SALIDA });
    }
    console.log(`   ${zip}`);
  }
}
rmSync(TRABAJO, { recursive: true, force: true });
console.log('\nListo.');
