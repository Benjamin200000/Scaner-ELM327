import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { carpetaWebValida, crearManejadorWeb, resolverArchivo } from '../lib/web.mjs';
import { arquitecturaDll, avisoArquitectura } from '../lib/j2534.mjs';

const base = mkdtempSync(join(tmpdir(), 'scaner-web-'));
const raiz = join(base, 'web');
mkdirSync(join(raiz, 'assets'), { recursive: true });
writeFileSync(join(raiz, 'index.html'), '<!doctype html><title>x</title>');
writeFileSync(join(raiz, 'assets', 'a.js'), 'console.log(1)');
writeFileSync(join(base, 'secreto.txt'), 'no debe servirse');
test.after(() => rmSync(base, { recursive: true, force: true }));

test('reconoce una carpeta con la app compilada', () => {
  assert.equal(carpetaWebValida(raiz), raiz);
  assert.equal(carpetaWebValida(base), null);
  assert.equal(carpetaWebValida(null), null);
});

test('resuelve archivos y el índice', () => {
  assert.equal(resolverArchivo(raiz, '/'), join(raiz, 'index.html'));
  assert.equal(resolverArchivo(raiz, '/assets/a.js?v=1'), join(raiz, 'assets', 'a.js'));
  assert.equal(resolverArchivo(raiz, '/no-existe.js'), null);
});

test('nunca sale de la carpeta', () => {
  for (const ruta of [
    '/../secreto.txt', '/%2e%2e/secreto.txt', '/assets/../../secreto.txt',
    '/..%2fsecreto.txt', '/%00', '/%E0%A4%A',
  ]) {
    assert.equal(resolverArchivo(raiz, ruta), null, ruta);
  }
});

test('sirve por HTTP con tipo correcto y rechaza escrituras', async () => {
  const srv = createServer(crearManejadorWeb(raiz));
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  try {
    const idx = await fetch(url + '/');
    assert.equal(idx.status, 200);
    assert.match(idx.headers.get('content-type'), /text\/html/);
    assert.equal(idx.headers.get('cache-control'), 'no-cache');
    const js = await fetch(url + '/assets/a.js');
    assert.match(js.headers.get('content-type'), /javascript/);
    assert.equal(await js.text(), 'console.log(1)');
    assert.equal((await fetch(url + '/', { method: 'POST' })).status, 405);
    assert.equal((await fetch(url + '/nada')).status, 404);
  } finally {
    srv.close();
  }
});

/** Un encabezado PE mínimo: alcanza para lo que mira arquitecturaDll. */
function dllFalsa(nombre, maquina) {
  const b = Buffer.alloc(0x100);
  b.writeUInt16LE(0x5a4d, 0);
  b.writeUInt32LE(0x80, 0x3c);
  b.writeUInt32LE(0x00004550, 0x80);
  b.writeUInt16LE(maquina, 0x84);
  const ruta = join(base, nombre);
  writeFileSync(ruta, b);
  return ruta;
}

test('detecta la arquitectura de una DLL', () => {
  assert.equal(arquitecturaDll(dllFalsa('a32.dll', 0x014c)), 'ia32');
  assert.equal(arquitecturaDll(dllFalsa('a64.dll', 0x8664)), 'x64');
  assert.equal(arquitecturaDll(join(base, 'secreto.txt')), null);
  assert.equal(arquitecturaDll(join(base, 'no-existe.dll')), null);
});

test('avisa qué .exe abrir cuando la DLL es de otra arquitectura', () => {
  const d32 = dllFalsa('b32.dll', 0x014c);
  const d64 = dllFalsa('b64.dll', 0x8664);
  assert.equal(avisoArquitectura(d32, 'ia32'), null);
  assert.equal(avisoArquitectura(d64, 'x64'), null);
  assert.match(avisoArquitectura(d32, 'x64'), /ScanerELM327-32bits\.exe/);
  assert.match(avisoArquitectura(d64, 'ia32'), /ScanerELM327\.exe/);
  // Si no se puede saber, no se bloquea: que decida la carga real.
  assert.equal(avisoArquitectura(join(base, 'no-existe.dll'), 'x64'), null);
});
