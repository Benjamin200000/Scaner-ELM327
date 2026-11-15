import { CODIGOS } from './protocol.mjs';
import { ElmStub } from './elm-stub.mjs';

/**
 * Enumeración y apertura de interfaces de diagnóstico.
 *
 * Hoy cubre puertos serie, que en Windows incluye tres casos en uno:
 *   - ELM327 USB (puente CH340, FTDI, CP2102, PL2303)
 *   - ELM327 Bluetooth Classic emparejado, que Windows expone como COM
 *   - Cable K-Line / KKL 409.1, que es un FTDI o CH340
 *
 * Ese segundo caso es el que importa: los adaptadores Bluetooth Classic son
 * los que el navegador NO puede alcanzar, y acá se abren como un puerto más
 * sin escribir una línea de código de Bluetooth.
 *
 * J2534 va a ser otro tipo de interfaz en este mismo módulo: carga la DLL
 * del fabricante y la expone con la misma forma. Por eso la enumeración
 * devuelve `kind` y no asume que todo es serie.
 */

const PUENTES_USB = {
  '1a86:7523': 'CH340', '1a86:5523': 'CH341',
  '0403:6001': 'FTDI FT232R', '0403:6015': 'FTDI FT231X',
  '10c4:ea60': 'Silicon Labs CP2102', '067b:2303': 'Prolific PL2303',
};

export async function enumerar({ simular }) {
  const items = [];

  if (simular) {
    items.push({
      id: 'sim:elm327',
      kind: 'simulador',
      label: 'ELM327 simulado (dentro del agente)',
      detail: 'Para verificar el enlace entre el agente y la app, sin hardware.',
    });
  }

  try {
    const { SerialPort } = await import('serialport');
    const puertos = await SerialPort.list();
    for (const p of puertos) {
      const vid = (p.vendorId ?? '').toLowerCase();
      const pid = (p.productId ?? '').toLowerCase();
      const puente = PUENTES_USB[`${vid}:${pid}`];
      const esBluetooth = /bluetooth/i.test(
        `${p.friendlyName ?? ''} ${p.manufacturer ?? ''} ${p.pnpId ?? ''}`,
      );
      items.push({
        id: `serial:${p.path}`,
        kind: esBluetooth ? 'bluetooth-spp' : 'serial',
        label: p.friendlyName ?? p.path,
        detail: [
          p.path,
          puente,
          esBluetooth ? 'Bluetooth Classic emparejado, expuesto como puerto serie' : null,
          p.manufacturer,
        ].filter(Boolean).join(' · '),
      });
    }
  } catch (err) {
    // Sin serialport el agente igual sirve para --simular, así que no se cae.
    items.push({
      id: 'serial:no-disponible',
      kind: 'error',
      label: 'No se pudieron enumerar los puertos serie',
      detail: String(err?.message ?? err),
    });
  }

  return items;
}

/**
 * Abre una interfaz. Devuelve un objeto con la misma forma siempre:
 * `{ info, write(bytes), close(), onData(cb), onClose(cb) }`.
 */
export async function abrir(id, options, { simular }) {
  if (id.startsWith('sim:')) {
    if (!simular) {
      throw fallo(CODIGOS.interfazDesconocida,
        'El simulador solo está disponible si el agente arrancó con --simular');
    }
    const stub = new ElmStub();
    return {
      info: { kind: 'simulador', name: 'ELM327 simulado', link: 'dentro del agente' },
      write: (bytes) => stub.write(bytes),
      close: () => stub.close(),
      onData: (cb) => stub.on('data', cb),
      onClose: () => { /* el stub no se cae solo */ },
    };
  }

  if (!id.startsWith('serial:')) {
    throw fallo(CODIGOS.interfazDesconocida, `Interfaz desconocida: ${id}`);
  }

  const ruta = id.slice('serial:'.length);
  const { SerialPort } = await import('serialport');

  const puerto = await new Promise((resolve, reject) => {
    const p = new SerialPort(
      { path: ruta, baudRate: options.baudRate, autoOpen: false },
      (err) => { if (err) reject(err); },
    );
    p.open((err) => (err ? reject(err) : resolve(p)));
  }).catch((err) => {
    throw fallo(CODIGOS.falloAlAbrir, describirAperturaFallida(ruta, err), String(err?.message ?? err));
  });

  return {
    info: {
      kind: 'serial',
      name: ruta,
      link: `${options.baudRate} baud`,
    },
    write: (bytes) => new Promise((resolve, reject) => {
      puerto.write(bytes, (err) => (err ? reject(
        fallo(CODIGOS.falloAlEscribir, 'No se pudo escribir en el puerto', String(err.message)),
      ) : resolve()));
    }),
    close: () => new Promise((resolve) => puerto.close(() => resolve())),
    onData: (cb) => puerto.on('data', cb),
    onClose: (cb) => {
      puerto.on('close', () => cb(null));
      puerto.on('error', (err) => cb(String(err?.message ?? err)));
    },
  };
}

/** Los errores de apertura más comunes, dichos de forma accionable. */
function describirAperturaFallida(ruta, err) {
  const m = String(err?.message ?? '').toLowerCase();
  if (m.includes('access denied') || m.includes('eacces') || m.includes('permission')) {
    return `No hay permiso para abrir ${ruta}. En Windows suele estar tomado por ` +
      'otro programa; en Linux hace falta pertenecer al grupo dialout.';
  }
  if (m.includes('busy') || m.includes('resource busy')) {
    return `${ruta} está ocupado por otro programa.`;
  }
  if (m.includes('no such file') || m.includes('cannot open') || m.includes('enoent')) {
    return `${ruta} ya no existe. Si es Bluetooth, puede haberse desemparejado.`;
  }
  return `No se pudo abrir ${ruta}.`;
}

function fallo(code, message, detail) {
  const e = new Error(message);
  e.code = code;
  if (detail) e.detail = detail;
  return e;
}
