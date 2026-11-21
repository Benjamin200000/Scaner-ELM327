// ESP32 simulado con el protocolo completo de carga (ROM + programa auxiliar):
// conexión, identificación, programa auxiliar, cambio de velocidad, tamaño de
// flash, borrado, escritura comprimida, fin y verificación MD5.
// Caso 1: escritura normal. Caso 2: a más de 115200 responde "status 201,0" en
// un bloque (lo que vio el usuario) y el cargador debe repetir todo a 115200.
const { chromium } = require('playwright');
const { build } = require('esbuild');
const path = require('path');
const ARCHIVO = path.resolve(process.argv[2] || __dirname + '/Cargar-GolfDashboard-ESP32.html');

function emulador(op) {
  // Se ejecuta dentro de la página.
  const md5Hex = window.MD5.md5Hex;
  window.__emu = { sesiones: [], escrito: null };
  navigator.serial.requestPort = async () => {
    let ctl = null, baud = 115200, stub = false, buf = [], dentro = false, esc = false;
    let comprimido = [], tamano = 0, fallado = false;
    const sesion = { baudios: [], ops: [] }; window.__emu.sesiones.push(sesion);
    const enviarCrudo = (bytes) => ctl && ctl.enqueue(new Uint8Array([0xc0, ...bytes.flatMap((b) => (b === 0xc0 ? [0xdb, 0xdc] : b === 0xdb ? [0xdb, 0xdd] : [b])), 0xc0]));
    const responder = (o, val = 0, datos = [], estado = [0, 0]) => {
      const cuerpo = [...datos, ...(stub ? estado : [...estado, 0, 0])];
      enviarCrudo([1, o, cuerpo.length & 255, cuerpo.length >> 8, val & 255, (val >> 8) & 255, (val >> 16) & 255, (val >>> 24) & 255, ...cuerpo]);
    };
    const u32 = (p, i) => (p[i] | (p[i + 1] << 8) | (p[i + 2] << 16) | (p[i + 3] << 24)) >>> 0;
    const atender = async (p) => {
      const o = p[1], d = p.slice(8); sesion.ops.push(o);
      switch (o) {
        case 0x08: for (let i = 0; i < 8; i++) responder(8, 0x20120707); return;
        case 0x0a: {
          const a = u32(d, 0);
          const v = a === 0x40001000 ? 0x00f01d83 : a === 0x3ff42080 ? 0x001640ef : 0;
          return responder(0x0a, v);
        }
        case 0x06: responder(6); stub = true; enviarCrudo([0x4f, 0x48, 0x41, 0x49]); return; // MEM_END + "OHAI"
        case 0x0f: responder(0x0f); return; // cambio de velocidad
        case 0x10: tamano = u32(d, 0); comprimido = []; return responder(0x10);
        case 0x11: {
          const seq = u32(d, 4), largo = u32(d, 0);
          if (op.fallarSiBaudMayorA && baud > op.fallarSiBaudMayorA && seq === 3 && !fallado) {
            fallado = true; return responder(0x11, 0, [], [0xc9, 0x00]); // status 201,0
          }
          comprimido.push(...d.slice(16, 16 + largo)); return responder(0x11);
        }
        case 0x13: {
          const ds = new Blob([new Uint8Array(comprimido)]).stream().pipeThrough(new DecompressionStream('deflate'));
          const plano = new Uint8Array(await new Response(ds).arrayBuffer()).slice(0, tamano);
          window.__emu.escrito = plano.length;
          const h = md5Hex(plano); const bytes = []; for (let i = 0; i < 32; i += 2) bytes.push(parseInt(h.slice(i, i + 2), 16));
          return responder(0x13, 0, bytes);
        }
        default: return responder(o);
      }
    };
    return {
      getInfo: () => ({ usbVendorId: 0x1a86, usbProductId: 0x7523 }),
      open: async (o) => { baud = o.baudRate; sesion.baudios.push(baud); },
      close: async () => { try { ctl && ctl.close(); } catch {} ctl = null; },
      setSignals: async () => {},
      get readable() { return this._r && !this._cerrado ? this._r : (this._r = new ReadableStream({ start(c) { ctl = c; } }), this._r); },
      writable: new WritableStream({ write(chunk) {
        for (const b of chunk) {
          if (b === 0xc0) { if (dentro && buf.length) { atender(buf); buf = []; dentro = false; } else { dentro = true; buf = []; } continue; }
          if (!dentro) continue;
          if (esc) { buf.push(b === 0xdc ? 0xc0 : 0xdb); esc = false; } else if (b === 0xdb) esc = true; else buf.push(b);
        }
      } }),
    };
  };
}

(async () => {
  const md5 = (await build({ entryPoints: [path.join(__dirname, 'src/md5.ts')], bundle: true, format: 'iife', globalName: 'MD5', write: false })).outputFiles[0].text;
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined });
  const caso = async (nombre, op) => {
    const p = await b.newPage(); const errores = []; p.on('pageerror', (e) => errores.push(String(e)));
    await p.addInitScript(md5 + ';window.MD5 = MD5;');
    await p.goto('file://' + ARCHIVO);
    await p.waitForFunction(() => !document.getElementById('cargar').disabled, null, { timeout: 20000 });
    // Un puerto nuevo cada vez que se abre: la lectura anterior queda cerrada.
    await p.evaluate(emulador, op);
    await p.evaluate(() => {
      const orig = navigator.serial.requestPort;
      navigator.serial.requestPort = async (...a) => {
        const port = await orig(...a);
        const abrir = port.open.bind(port), cerrar = port.close.bind(port);
        port.open = async (o) => { port._r = null; port._cerrado = false; return abrir(o); };
        port.close = async () => { port._cerrado = true; return cerrar(); };
        return port;
      };
    });
    const t = Date.now();
    await p.click('#cargar');
    await p.waitForFunction(() => document.getElementById('estado').dataset.tipo !== 'info', null, { timeout: 240000 });
    const r = await p.evaluate(() => ({ estado: document.getElementById('estado').textContent, log: document.getElementById('log').textContent, emu: window.__emu }));
    console.log(`\n## ${nombre} (${((Date.now() - t) / 1000).toFixed(0)} s)\n  estado: ${r.estado}`);
    console.log(`  sesiones: ${r.emu.sesiones.length} · velocidades abiertas: ${r.emu.sesiones.map((s) => s.baudios.join('→')).join(' | ')}`);
    console.log(`  borrados completos: ${r.emu.sesiones.map((s) => s.ops.filter((o) => o === 0xd0).length).join(', ')} · bytes escritos y verificados: ${r.emu.escrito}`);
    console.log('  registro: ' + r.log.split('\n').filter((l) => /Falló|Reintent|201|velocidad|verificad/i.test(l)).join(' / '));
    console.log(`  MD5 verificado: ${/Hash of data verified/.test(r.log)} · errores JS: ${errores.length}`);
    await p.close();
    return r;
  };
  const a = await caso('Escritura normal a 460800', {});
  const c = await caso('Error 201 a alta velocidad → reintento a 115200', { fallarSiBaudMayorA: 115200 });
  await b.close();
  const ok = a.estado.startsWith('Listo') && c.estado.startsWith('Listo') && /status 201,0/.test(c.log) && /Reintentando la escritura completa a 115200/.test(c.log);
  console.log(ok ? '\nCorrecto: escribe y verifica, y ante el error 201 repite todo a 115200 y termina bien.' : '\nFALLÓ');
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
