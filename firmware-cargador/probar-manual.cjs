const { chromium } = require('playwright');
const ARCHIVO = require('path').resolve(process.argv[2] || __dirname + '/Cargar-GolfDashboard-ESP32.html');

// ESP32 simulado: responde SYNC y READ_REG como la ROM, solo si está en modo descarga.
const instalar = (opciones) => {
  window.__registro = { pedidoPuerto: null, ops: [], senalesAntesDeSync: 0, senales: 0 };
  navigator.serial.requestPort = async (arg) => {
    window.__registro.pedidoPuerto = arg;
    if (opciones.bluetooth) return { getInfo: () => ({}), open: async () => {}, close: async () => {} };
    let ctl, buf = [], dentro = false, esc = false, descarga = opciones.descarga;
    const enviar = (op, val, data = [0, 0, 0, 0]) => {
      const p = [1, op, data.length & 255, data.length >> 8, val & 255, (val >> 8) & 255, (val >> 16) & 255, (val >>> 24) & 255, ...data];
      const out = [0xc0];
      for (const b of p) { if (b === 0xc0) out.push(0xdb, 0xdc); else if (b === 0xdb) out.push(0xdb, 0xdd); else out.push(b); }
      out.push(0xc0); ctl.enqueue(new Uint8Array(out));
    };
    const atender = (p) => {
      const op = p[1]; window.__registro.ops.push(op);
      if (op === 0x08 && window.__registro.ops.filter((o) => o === 8).length === 1) window.__registro.senalesAntesDeSync = window.__registro.senales;
      if (!descarga) return;
      if (op === 0x08) { for (let i = 0; i < 8; i++) enviar(8, 0x20120707); return; }
      if (op === 0x0a) { const a = (p[8] | (p[9] << 8) | (p[10] << 16) | (p[11] << 24)) >>> 0; enviar(0x0a, a === 0x40001000 ? 0x00f01d83 : 0); return; }
      enviar(op, 0);
    };
    return {
      getInfo: () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 }),
      open: async () => {}, close: async () => {},
      setSignals: async () => { window.__registro.senales++; },
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
  const errores = [];
  const caso = async (nombre, opciones, preparar) => {
    const p = await b.newPage(); p.on('pageerror', (e) => errores.push(String(e)));
    await p.goto('file://' + ARCHIVO);
    await p.waitForFunction(() => !document.getElementById('cargar').disabled, null, { timeout: 20000 });
    await p.evaluate(instalar, opciones);
    if (preparar) await preparar(p);
    await p.click('#cargar');
    await p.waitForFunction(() => document.getElementById('estado').dataset.tipo !== 'info', null, { timeout: 120000 });
    const r = await p.evaluate(() => ({
      estado: document.getElementById('estado').textContent,
      manual: document.getElementById('manual').checked,
      pasosVisibles: !document.getElementById('pasos-manual').hidden,
      log: document.getElementById('log').textContent,
      reg: window.__registro,
    }));
    console.log(`\n## ${nombre}\n  estado: ${r.estado}`);
    return { p, r };
  };

  let { r } = await caso('Puerto Bluetooth elegido', { bluetooth: true });
  console.log('  filtro de puertos USB pedido al navegador:', JSON.stringify(r.reg.pedidoPuerto).slice(0, 80) + '…');

  ({ r } = await caso('"Mostrar todos los puertos" marcado', { bluetooth: true }, (p) => p.check('#todos')));
  console.log('  pedido sin filtro:', JSON.stringify(r.reg.pedidoPuerto));

  ({ r } = await caso('Placa que no entra sola en modo carga', { descarga: false }));
  console.log(`  modo manual activado: ${r.manual} | pasos visibles: ${r.pasosVisibles} | SYNC enviados: ${r.reg.ops.filter((o) => o === 8).length}`);

  let x = await caso('Modo manual, placa en modo carga', { descarga: true }, (p) => p.check('#manual'));
  console.log(`  chip detectado: ${/Detecting chip type\.\.\. ESP32/.test(x.r.log)} | reinicios por señales antes del primer SYNC: ${x.r.reg.senalesAntesDeSync}`);
  console.log('  (después falla al cargar el programa auxiliar: el simulador no lo implementa, es esperado)');

  x = await caso('Modo automático, placa responde', { descarga: true });
  console.log(`  chip detectado: ${/Detecting chip type\.\.\. ESP32/.test(x.r.log)} | señales de reinicio usadas: ${x.r.reg.senalesAntesDeSync > 0}`);

  console.log('\nerrores JS:', errores);
  await b.close();
})();
