#!/usr/bin/env node
import { WebSocketServer } from 'ws';
import { networkInterfaces } from 'node:os';
import { analizar, CODIGOS } from './lib/protocol.mjs';
import { obtenerToken, rutaToken, tokenValido } from './lib/auth.mjs';
import { abrir, enumerar } from './lib/interfaces.mjs';

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
  --token        Mostrar el token y salir.
  --ayuda        Esta ayuda.
`);
  process.exit(0);
}

const TOKEN = obtenerToken();

if (flag('--token')) {
  console.log(TOKEN);
  process.exit(0);
}

const PUERTO = Number(valor('--puerto', '8777'));
const LAN = flag('--lan');
const SIMULAR = flag('--simular');
const HOST = LAN ? '0.0.0.0' : '127.0.0.1';

const wss = new WebSocketServer({ host: HOST, port: PUERTO, maxPayload: 64 * 1024 });

wss.on('listening', () => {
  console.log(`\nAgente del escáner ELM327  v${VERSION}`);
  console.log(`Escuchando en  ws://${LAN ? direccionLan() : '127.0.0.1'}:${PUERTO}`);
  console.log(`Token          ${TOKEN}`);
  console.log(`               (guardado en ${rutaToken})`);
  if (SIMULAR) console.log('Simulador      activo');
  if (LAN) {
    console.log(
      '\nAVISO: con --lan el agente acepta conexiones de toda la red local.\n' +
      '       El token es lo único que lo protege. No lo compartas.',
    );
  }
  console.log('\nPegá la dirección y el token en la pantalla de Conexión de la app.\n');
});

wss.on('error', (err) => {
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
        features: { simulador: SIMULAR, j2534: false },
      });
    }

    if (!autenticado) return error(CODIGOS.noAutenticado, 'Hay que autenticar primero');

    switch (msg.t) {
      case 'ping':
        return enviar({ t: 'pong' });

      case 'list':
        return enviar({ t: 'interfaces', items: await enumerar({ simular: SIMULAR }) });

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

  ws.on('close', async () => {
    console.log(`[${quien}] desconectado`);
    // Si el navegador se va, el puerto tiene que quedar libre: si no, el
    // próximo intento falla con "ocupado" y nadie entiende por qué.
    if (interfaz !== null) {
      const i = interfaz;
      interfaz = null;
      await i.close().catch(() => {});
    }
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
  wss.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
};
process.on('SIGINT', cerrar);
process.on('SIGTERM', cerrar);
