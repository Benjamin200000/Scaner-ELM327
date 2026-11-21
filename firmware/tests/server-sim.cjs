// Simulacion: por que el panel no cargaba en Safari/Chrome y por que el servidor
// asincrono lo resuelve. No ejecuta el firmware: modela en Node el comportamiento
// de cada servidor HTTP y sirve la pagina real (WebUi.h) a un navegador que emula
// un iPhone 15 Pro y abre conexiones por adelantado (preconexiones), como Safari.
//
//  - sincrono: como WebServer de arduino-esp32 3.3.4. Una conexion a la vez; si
//    una conexion no envia pedido, la espera hasta HTTP_MAX_DATA_WAIT (5000 ms).
//  - asincrono: como ESPAsyncWebServer. Cada conexion se atiende por separado.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const assert = require('node:assert/strict');
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const zlib = require('node:zlib');
// Igual que el firmware: la pagina va comprimida con gzip.
const html = zlib.gzipSync(fs.readFileSync(path.join(__dirname, '../web/panel.html')));
const live = JSON.stringify({
  state: 'OBD conectado', page: 0, mask: 0, rpmHz: 5, speedHz: 5, reference: 14.7, afr: null,
  fields: Array.from({ length: 11 }, () => ({ support: 1, value: 1, age: 100, stale: false, digits: 0 })),
});

function responder(pedido) {
  const ruta = pedido.split(' ')[1] || '/';
  if (ruta.startsWith('/api/live')) return ['200 OK', 'application/json', live];
  if (ruta.startsWith('/api/config')) return ['200 OK', 'application/json', '{"name":"ELM 327","mac":""}'];
  if (ruta.startsWith('/api/token')) return ['200 OK', 'text/plain', 'sim'];
  if (ruta === '/') return ['200 OK', 'text/html; charset=utf-8', html, 'Content-Encoding: gzip\r\n'];
  return ['404 Not Found', 'text/plain', 'no'];
}
function leerPedido(sock, esperaMs) {
  return new Promise((ok) => {
    let buf = '';
    const fin = (v) => { clearTimeout(t); sock.removeAllListeners('data'); ok(v); };
    const t = setTimeout(() => fin(null), esperaMs);
    sock.on('data', (d) => {
      buf += d.toString('latin1');
      const i = buf.indexOf('\r\n\r\n');
      if (i < 0) return;
      const largo = Number(/content-length:\s*(\d+)/i.exec(buf)?.[1] || 0);
      if (buf.length - i - 4 >= largo) fin(buf);
    });
    sock.on('error', () => fin(null));
    sock.on('close', () => fin(null));
  });
}
function enviar(sock, pedido) {
  const [estado, tipo, cuerpo, extra = ''] = responder(pedido);
  const b = Buffer.isBuffer(cuerpo) ? cuerpo : Buffer.from(cuerpo, 'utf8');
  sock.write(`HTTP/1.1 ${estado}\r\nContent-Type: ${tipo}\r\n${extra}Content-Length: ${b.length}\r\nConnection: close\r\n\r\n`);
  sock.end(b);
}
function servidor(modo) {
  const cola = []; let ocupado = false;
  const atender = async () => {
    if (ocupado) return;
    const sock = cola.shift(); if (!sock) return;
    ocupado = true;
    const pedido = await leerPedido(sock, 5000);
    if (pedido) enviar(sock, pedido); else sock.destroy();
    ocupado = false; setImmediate(atender);
  };
  const s = net.createServer((sock) => {
    sock.on('error', () => {});
    if (modo === 'asincrono') leerPedido(sock, 5000).then((p) => (p ? enviar(sock, p) : sock.destroy()));
    else { cola.push(sock); atender(); }
  });
  return new Promise((ok) => s.listen(0, '127.0.0.1', () => ok(s)));
}

async function escenario(browser, modo, preconexiones) {
  const srv = await servidor(modo);
  const port = srv.address().port;
  const ociosas = [];
  const abrirOciosa = () => { const c = net.connect(port, '127.0.0.1'); c.on('error', () => {}); ociosas.push(c); setTimeout(() => c.destroy(), 6000); };
  // Safari abre una conexion de reserva antes de pedir la pagina y despues mantiene otra.
  let reloj = null;
  if (preconexiones) { abrirOciosa(); reloj = setInterval(abrirOciosa, 1500); }
  const { defaultBrowserType, ...iphone } = devices['iPhone 15 Pro'];
  const ctx = await browser.newContext(iphone);
  const page = await ctx.newPage();
  const t0 = Date.now();
  let primera = null;
  try {
    await page.goto(`http://127.0.0.1:${port}/`, { timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('OBD conectado'), null, { timeout: 15000 });
    primera = Date.now() - t0;
  } catch { /* nunca llego a mostrar datos */ }
  let ok = 0, total = 0;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const st = await page.textContent('#status', { timeout: 1000 }).catch(() => '');
    total++; if (st.startsWith('OBD conectado')) ok++;
  }
  clearInterval(reloj); ociosas.forEach((c) => c.destroy());
  await ctx.close(); srv.close();
  const r = { modo, preconexiones, primeraCargaMs: primera, conDatos: Math.round((100 * ok) / total) };
  console.log(`${modo.padEnd(10)} ${preconexiones ? 'con preconexiones' : 'sin preconexiones'}: ` +
    `datos a los ${primera === null ? 'NUNCA (15 s)' : (primera / 1000).toFixed(1) + ' s'}, ` +
    `panel con datos el ${r.conDatos}% del tiempo en 10 s`);
  return r;
}

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const a = await escenario(browser, 'sincrono', false);
    const b = await escenario(browser, 'sincrono', true);
    const c = await escenario(browser, 'asincrono', true);
    assert(c.primeraCargaMs !== null && c.primeraCargaMs < 3000, 'asincrono debe cargar enseguida');
    assert(c.conDatos >= 90, 'asincrono debe mantener datos');
    assert(b.primeraCargaMs === null || b.conDatos < c.conDatos, 'el modelo sincrono deberia empeorar con preconexiones');
    console.log('Simulacion correcta: con preconexiones el servidor sincrono falla y el asincrono no.');
    void a;
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
