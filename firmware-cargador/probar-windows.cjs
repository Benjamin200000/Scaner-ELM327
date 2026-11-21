// Simula una placa ESP32 en Windows: abrir el puerto o mover DTR/RTS la reinicia,
// y solo entra en modo carga si BOOT está apretado en ese instante.
const { chromium } = require('playwright');
const ARCHIVO = require('path').resolve(process.argv[2] || __dirname + '/Cargar-GolfDashboard-ESP32.html');

const instalar = (op) => {
  const inicio = Date.now();
  const bootApretado = () => op.boot && Date.now() - inicio >= (op.bootDesdeMs || 0);
  navigator.serial.requestPort = async () => {
    let ctl, buf = [], dentro = false, esc = false, descarga = op.yaEnDescarga || false;
    const reiniciar = () => { descarga = bootApretado(); };
    const enviar = (o, val) => {
      const p = [1, o, 4, 0, val & 255, (val >> 8) & 255, (val >> 16) & 255, (val >>> 24) & 255, 0, 0, 0, 0];
      ctl.enqueue(new Uint8Array([0xc0, ...p.flatMap((b) => (b === 0xc0 ? [0xdb, 0xdc] : b === 0xdb ? [0xdb, 0xdd] : [b])), 0xc0]));
    };
    const atender = (p) => {
      if (!descarga) return;
      if (p[1] === 0x08) { for (let i = 0; i < 8; i++) enviar(8, 0x20120707); return; }
      if (p[1] === 0x0a) { const a = (p[8] | (p[9] << 8) | (p[10] << 16) | (p[11] << 24)) >>> 0; enviar(0x0a, a === 0x40001000 ? 0x00f01d83 : 0); return; }
      enviar(p[1], 0);
    };
    return {
      getInfo: () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 }),
      open: async () => { reiniciar(); }, close: async () => {},
      setSignals: async () => { reiniciar(); },
      readable: new ReadableStream({ start(c) { ctl = c; } }),
      writable: new WritableStream({ write(chunk) {
        for (const b of chunk) {
          if (b === 0xc0) { if (dentro && buf.length) { atender(buf); buf = []; dentro = false; } else { dentro = true; buf = []; } continue; }
          if (!dentro) continue;
          if (esc) { buf.push(b === 0xdc ? 0xc0 : 0xdb); esc = false; } else if (b === 0xdb) esc = true; else buf.push(b);
        }
      } }),
    };
  };
};

(async () => {
  const b = await chromium.launch();
  const caso = async (nombre, op, manual) => {
    const p = await b.newPage();
    await p.goto('file://' + ARCHIVO);
    await p.waitForFunction(() => !document.getElementById('cargar').disabled, null, { timeout: 20000 });
    await p.evaluate(instalar, op);
    if (manual) await p.check('#manual');
    const t = Date.now();
    await p.click('#cargar');
    await p.waitForFunction(() => /Detecting chip type\.\.\. ESP32/.test(document.getElementById('log').textContent)
      || document.getElementById('estado').dataset.tipo === 'error', null, { timeout: 120000 });
    const log = await p.textContent('#log');
    const ok = /Detecting chip type\.\.\. ESP32/.test(log);
    console.log(`${ok ? 'CONECTA ' : 'NO CONECTA'} (${((Date.now() - t) / 1000).toFixed(0)} s) · ${nombre}`);
    if (!ok) console.log('           →', await p.textContent('#estado'));
    await p.close();
  };
  await caso('versión anterior del manual: modo carga antes, BOOT suelto al abrir', { yaEnDescarga: true, boot: false }, true);
  await caso('manual nuevo: BOOT apretado desde antes de pulsar Cargar', { boot: true }, true);
  await caso('manual nuevo: BOOT apretado recién a los 12 s', { boot: true, bootDesdeMs: 12000 }, true);
  await caso('automático con reinicio por DTR/RTS (placa normal)', { boot: true }, false);
  await b.close();
})();
