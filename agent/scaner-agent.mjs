#!/usr/bin/env node
import { WebSocketServer } from 'ws';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { carpetaWebValida, crearManejadorWeb } from './lib/web.mjs';
import { analizar, CODIGOS } from './lib/protocol.mjs';
import { obtenerToken, rutaToken, tokenValido } from './lib/auth.mjs';
import { abrir, enumerar } from './lib/interfaces.mjs';
import { EnlaceKLine } from './lib/kline.mjs';

/**
 * Agente local del escáner.
 *
 * Existe porque hay tres interfaces que un navegador no puede tocar:
 *   - ELM327 Bluetooth Classic (SPP): Web Bluetooth solo habla BLE
 *   - Cable K-Line / KKL: es un puerto serie, y en móviles no hay Web Serial
 *   - J2534: es una DLL de Windows, no una API web
 *
 * El agente las expone por WebSocket con la misma forma, y la app las usa
 * como un transporte más. Efecto secundario útil: con --lan, una tablet o un
 * teléfono pueden usar el adaptador que está enchufado a la notebook.
 */

const VERSION = '0.1.0';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const valor = (n, def) => {
  const i = args.indexOf(n);
  return i !== -1 && args[i + 1] !== undefined ? args[i + 1] : def;
};

if (flag('--ayuda') || flag('-h')) {
  console.log(`
Agente del escáner ELM327  v${VERSION}

  node scaner-agent.mjs [opciones]

  --puerto <n>   Puerto de escucha (por defecto 8777)
  --lan          Escuchar en toda la red local, no solo en esta máquina.
                 Hace falta para usar la app desde una tablet o un teléfono.
  --simular      Ofrecer un ELM327 simulado, para verificar el enlace sin
                 hardware antes de pelearse con el adaptador.
  --j2534 <ruta> Usar esta biblioteca J2534. En Windows las instaladas se
                 descubren solas desde el registro.
  --web <ruta>   Carpeta con la app web compilada, para servirla desde el
                 mismo puerto. Si hay una carpeta "web" junto al agente (o
                 "dist" en el repositorio) se usa sola.
  --abrir        Abrir la app en el navegador al iniciar, ya enlazada.
  --diagnostico  Comprobar que los módulos de puerto serie y J2534 cargan en
                 este equipo, listar lo que se encuentra, y salir.
  --token        Mostrar el token y salir.
  --ayuda        Esta ayuda.
`);
  process.exit(0);
}

function carpetaWeb() {
  const aqui = dirname(fileURLToPath(import.meta.url));
  return carpetaWebValida(valor('--web', null)) ??
    carpetaWebValida(join(aqui, 'web')) ??
    carpetaWebValida(join(aqui, '..', 'web')) ??
    carpetaWebValida(join(aqui, '..', 'dist'));
}

const TOKEN = obtenerToken();

if (flag('--token')) {
  console.log(TOKEN);
  process.exit(0);
}

if (flag('--diagnostico')) {
  const { diagnostico } = await import('./lib/diagnostico.mjs');
  const r = await diagnostico({ version: VERSION, web: carpetaWeb() !== null });
  console.log('\n' + r.lineas.join('\n') + '\n');
  process.exit(r.fallas === 0 ? 0 : 1);
}

const PUERTO = Number(valor('--puerto', '8777'));
const LAN = flag('--lan');
const SIMULAR = flag('--simular');
const J2534 = valor('--j2534', null);
const HOST = LAN ? '0.0.0.0' : '127.0.0.1';

const ABRIR = flag('--abrir');

const WEB = carpetaWeb();

// Un solo puerto para todo: HTTP sirve la app y el mismo servidor acepta el
// WebSocket del agente. Así el programa completo es un proceso y una URL.
const http = createServer(crearManejadorWeb(WEB));
const wss = new WebSocketServer({ server: http, maxPayload: 64 * 1024 });
http.listen(PUERTO, HOST);

/** El token va en el fragmento: el navegador no lo manda al servidor ni queda en logs. */
const urlApp = (host) => `http://${host}:${PUERTO}/#agente=${TOKEN}`;

http.on('listening', () => {
  console.log(`\nAgente del escáner ELM327  v${VERSION}`);
  console.log(`Escuchando en  ws://${LAN ? direccionLan() : '127.0.0.1'}:${PUERTO}`);
  if (WEB) {
    console.log(`Programa       http://127.0.0.1:${PUERTO}`);
    if (LAN) console.log(`Desde la red   ${urlApp(direccionLan())}`);
  }
  console.log(`Token          ${TOKEN}`);
  console.log(`               (guardado en ${rutaToken})`);
  if (SIMULAR) console.log('Simulador      activo');
  if (J2534) console.log(`J2534          ${J2534}`);
  if (LAN) {
    console.log(
      '\nAVISO: con --lan el agente acepta conexiones de toda la red local.\n' +
      '       El token es lo único que lo protege. No lo compartas.',
    );
  }
  if (WEB) {
    console.log('\nDejá esta ventana abierta mientras uses el programa. Para salir, cerrala.\n');
  } else {
    console.log('\nPegá la dirección y el token en la pantalla de Conexión de la app.\n');
  }
  if (ABRIR && WEB) abrirNavegador(urlApp('127.0.0.1'));
});

function abrirNavegador(url) {
  try {
    const [cmd, argumentos] =
      process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
        : process.platform === 'darwin' ? ['open', [url]]
          : ['xdg-open', [url]];
    spawn(cmd, argumentos, { stdio: 'ignore', detached: true, windowsHide: true })
      .on('error', () => console.log(`Abrí a mano: ${url}`))
      .unref();
  } catch {
    console.log(`Abrí a mano: ${url}`);
  }
}

http.on('error', (err) => {
  if (err?.code === 'EADDRINUSE' && ABRIR && WEB) {
    // Doble clic con el programa ya abierto: se reutiliza el que está corriendo.
    console.log(`\nEl programa ya está abierto en el puerto ${PUERTO}. Abriendo el navegador.\n`);
    abrirNavegador(urlApp('127.0.0.1'));
    setTimeout(() => process.exit(0), 1500);
    return;
  }
  if (err?.code === 'EADDRINUSE') {
    console.error(`\nEl puerto ${PUERTO} ya está en uso. Probá con --puerto <otro>.\n`);
  } else {
    console.error('\nNo se pudo iniciar el agente:', err?.message ?? err, '\n');
  }
  process.exit(1);
});

wss.on('connection', (ws, req) => {
  const quien = req.socket.remoteAddress ?? 'desconocido';
  /** @type {null | Awaited<ReturnType<typeof abrir>>} */
  let interfaz = null;
  let autenticado = false;
  let abriendo = false;
  let kline = null;

  const enviar = (obj) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };
  const error = (code, message, detail) =>
    enviar({ t: 'error', code, message, ...(detail ? { detail } : {}) });

  ws.on('message', async (raw) => {
    const r = analizar(raw.toString('utf8'));
    if (!r.ok) return error(r.code, r.message);
    const msg = r.msg;

    if (msg.t === 'hello') {
      if (!tokenValido(TOKEN, msg.token)) {
        // Sin pistas sobre en qué falló: no ayuda a quien esté probando.
        error(CODIGOS.tokenInvalido, 'Token inválido');
        console.log(`[${quien}] rechazado: token inválido`);
        return ws.close(4001, 'token invalido');
      }
      autenticado = true;
      console.log(`[${quien}] conectado: ${msg.client}`);
      return enviar({
        t: 'hello-ok',
        agent: { version: VERSION, platform: process.platform, node: process.versions.node },
        features: { simulador: SIMULAR, j2534: J2534 !== null || process.platform === 'win32' },
      });
    }

    if (!autenticado) return error(CODIGOS.noAutenticado, 'Hay que autenticar primero');

    switch (msg.t) {
      case 'ping':
        return enviar({ t: 'pong' });

      case 'list':
        return enviar({ t: 'interfaces', items: await enumerar({ simular: SIMULAR, j2534: J2534 }) });

      case 'open': {
        if (interfaz !== null) return error(CODIGOS.yaAbierta, 'Ya hay una interfaz abierta');
        // Sin esta guarda, dos 'open' seguidos dejan un puerto huérfano.
        if (abriendo) return error(CODIGOS.ocupado, 'Ya hay una apertura en curso');
        abriendo = true;
        try {
          const i = await abrir(msg.id, msg.options, { simular: SIMULAR });
          interfaz = i;
          i.onData((bytes) => enviar({ t: 'data', data: Buffer.from(bytes).toString('base64') }));
          i.onClose((motivo) => {
            if (interfaz !== i) return;
            interfaz = null;
            enviar({ t: 'closed', ...(motivo ? { reason: motivo } : {}) });
          });
          console.log(`[${quien}] abrió ${msg.id}`);
          return enviar({ t: 'opened', info: i.info });
        } catch (err) {
          return error(err?.code ?? CODIGOS.falloAlAbrir,
            err?.message ?? 'No se pudo abrir la interfaz', err?.detail);
        } finally {
          abriendo = false;
        }
      }

      case 'write': {
        if (interfaz === null) return error(CODIGOS.noAbierta, 'No hay una interfaz abierta');
        try {
          await interfaz.write(msg.bytes);
        } catch (err) {
          return error(err?.code ?? CODIGOS.falloAlEscribir,
            err?.message ?? 'No se pudo escribir', err?.detail);
        }
        return;
      }

      case 'kline':
        return manejarKline(msg);

      case 'close': {
        if (interfaz === null) return error(CODIGOS.noAbierta, 'No hay una interfaz abierta');
        const i = interfaz;
        interfaz = null;
        await i.close();
        console.log(`[${quien}] cerró la interfaz`);
        return enviar({ t: 'closed' });
      }
    }
  });

  async function manejarKline(msg) {
    try {
      if (msg.op === 'open') {
        if (!msg.id.startsWith('serial:')) {
          return error(CODIGOS.interfazDesconocida, 'K-Line necesita un puerto serie (cable KKL)');
        }
        const { SerialPort } = await import('serialport');
        kline = new EnlaceKLine(SerialPort);
        await kline.abrir(msg.id.slice('serial:'.length), msg.baud);
        return enviar({ t: 'kline', op: 'open', ok: true });
      }
      if (kline === null) return error(CODIGOS.noAbierta, 'El enlace K-Line no está abierto');
      if (msg.op === 'init') {
        const r = await kline.init(msg.address);
        return enviar({ t: 'kline', op: 'init', version: r.version, keywords: r.keywords });
      }
      if (msg.op === 'send') {
        await kline.enviarBloque(msg.bytes);
        return enviar({ t: 'kline', op: 'send', ok: true });
      }
      if (msg.op === 'recv') {
        const bytes = await kline.recibirBloque(msg.timeout);
        return enviar({ t: 'kline', op: 'recv', bytes });
      }
      if (msg.op === 'close') {
        await kline.cerrar();
        kline = null;
        return enviar({ t: 'kline', op: 'close', ok: true });
      }
    } catch (err) {
      return error(CODIGOS.enlaceCaido, `K-Line: ${err?.message ?? err}`);
    }
  }

  ws.on('close', async () => {
    console.log(`[${quien}] desconectado`);
    // Si el navegador se va, el puerto tiene que quedar libre: si no, el
    // próximo intento falla con "ocupado" y nadie entiende por qué.
    if (interfaz !== null) {
      const i = interfaz;
      interfaz = null;
      await i.close().catch(() => {});
    }
    if (kline !== null) { await kline.cerrar().catch(() => {}); kline = null; }
  });
});

function direccionLan() {
  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista ?? []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '0.0.0.0';
}

const cerrar = () => {
  console.log('\nCerrando el agente.');
  wss.close();
  http.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
};
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
