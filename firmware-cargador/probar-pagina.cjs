const { chromium } = require('playwright');
const ARCHIVO = require('path').resolve(process.argv[2] || __dirname + '/Cargar-GolfDashboard-ESP32.html');
const pagina = 'file://' + ARCHIVO;
(async () => {
  const b = await chromium.launch();
  // 1. Carga normal
  let p = await b.newPage(); const errs = []; p.on('pageerror', e => errs.push(String(e)));
  await p.goto(pagina);
  await p.waitForFunction(() => !document.getElementById('cargar').disabled || document.getElementById('estado').dataset.tipo === 'error', null, { timeout: 20000 });
  console.log('contexto seguro:', await p.evaluate(() => isSecureContext), '| serial:', await p.evaluate(() => 'serial' in navigator));
  console.log('estado:', await p.textContent('#estado'));
  await p.screenshot({ path: __dirname + '/captura.png' });

  // 2. Usuario cancela la elección de puerto
  await p.evaluate(() => { navigator.serial.requestPort = () => Promise.reject(new DOMException('No port selected by the user.', 'NotFoundError')); });
  await p.click('#cargar'); await p.waitForTimeout(500);
  console.log('cancelado →', await p.textContent('#estado'), '| botón habilitado:', !(await p.isDisabled('#cargar')));

  // 3. Placa que no responde (puerto que abre pero nunca contesta)
  await p.evaluate(() => {
    navigator.serial.requestPort = async () => ({
      open: async () => {}, close: async () => {}, getInfo: () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 }),
      setSignals: async () => {},
      readable: new ReadableStream({ pull() { return new Promise(() => {}); } }),
      writable: new WritableStream({ write() {} }),
    });
  });
  const t = Date.now(); await p.click('#cargar');
  await p.waitForFunction(() => document.getElementById('estado').dataset.tipo === 'error', null, { timeout: 180000 });
  console.log(`sin respuesta (${((Date.now() - t) / 1000).toFixed(0)} s) →`, await p.textContent('#estado'));
  console.log('log:', (await p.textContent('#log')).trim().split('\n').slice(-3).join(' | '));

  // La imagen alterada se prueba en probar-danado.cjs.
  console.log('errores JS:', errs);
  await b.close();
})();
