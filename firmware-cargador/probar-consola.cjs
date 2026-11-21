// Prueba el botón "Ver mensajes de la placa" con un puerto simulado que
// escribe un arranque como el del firmware.
const { chromium } = require('playwright');
const ARCHIVO = require('path').resolve(process.argv[2] || __dirname + '/Cargar-GolfDashboard-ESP32.html');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage(); const errores = []; p.on('pageerror', (e) => errores.push(String(e)));
  await p.goto('file://' + ARCHIVO);
  await p.waitForFunction(() => !document.getElementById('consola').disabled, null, { timeout: 20000 });
  await p.evaluate(() => {
    window.__senales = []; window.__abierto = null; window.__cerrado = false;
    navigator.serial.requestPort = async () => {
      let ctl;
      const lineas = ['ets Jun  8 2016 00:22:57\r\n', 'rst:0x1 (POWERON_RESET),boot:0x13 (SPI_FAST_FLASH_BOOT)\r\n',
        'Wi-Fi GolfDashboard, abrir http://192.168.4.1/\r\n', 'Conectando a ELM 327; contacto del Golf encendido.\r\n',
        'ELM no encontrado; nueva busqueda en 3 s.\r\n'];
      return {
        getInfo: () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 }),
        open: async (o) => { window.__abierto = o; },
        close: async () => { window.__cerrado = true; },
        setSignals: async (s) => { window.__senales.push(s); },
        readable: new ReadableStream({
          start(c) { ctl = c; },
          async pull(c) { const l = lineas.shift(); if (!l) return new Promise(() => {}); await new Promise((r) => setTimeout(r, 50)); c.enqueue(new TextEncoder().encode(l)); },
        }),
      };
    };
  });
  await p.click('#consola');
  await p.waitForFunction(() => /nueva busqueda/.test(document.getElementById('log').textContent), null, { timeout: 10000 });
  const r = await p.evaluate(() => ({ log: document.getElementById('log').textContent, abierto: window.__abierto, senales: window.__senales,
    cargarBloqueado: document.getElementById('cargar').disabled, textoBoton: document.getElementById('consola').textContent }));
  console.log('abre a', r.abierto.baudRate, 'baudios | reinicio:', JSON.stringify(r.senales));
  console.log('muestra el arranque:', /Wi-Fi GolfDashboard/.test(r.log) && /ELM no encontrado/.test(r.log));
  console.log('Cargar bloqueado mientras mira:', r.cargarBloqueado, '| botón dice:', r.textoBoton);
  await p.click('#consola');
  await p.waitForFunction(() => document.getElementById('consola').textContent === 'Ver mensajes de la placa', null, { timeout: 5000 });
  console.log('al detener: puerto cerrado', await p.evaluate(() => window.__cerrado), '| Cargar habilitado', !(await p.isDisabled('#cargar')));
  await p.click('#copiar'); await p.waitForTimeout(200);
  console.log('copiar →', await p.textContent('#estado'));
  console.log('errores JS:', errores);
  await b.close();
})();
