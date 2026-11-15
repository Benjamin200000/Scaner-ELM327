import koffi from 'koffi';
import { execFileSync } from 'node:child_process';

/**
 * Enlace con una biblioteca J2534 (PassThru 04.04).
 *
 * J2534 no es un puerto serie: es una API de mensajes. Se abre el
 * dispositivo, se conecta un canal con un protocolo y un baud rate, se
 * instalan filtros y se leen y escriben mensajes con cabecera. Esta capa
 * expone exactamente eso; la traducción a algo que el driver del ELM327
 * entienda vive en j2534-elm.mjs, separada a propósito.
 *
 * VERIFICACIÓN: el marshalling de estructuras, el paso de punteros y la
 * traducción de errores están probados contra una biblioteca falsa compilada
 * para los tests (agent/test/fake-j2534.c), que implementa la misma API. Lo
 * que NO está probado es contra un equipo real: eso requiere el hardware.
 */

export const PROTOCOLO = {
  J1850VPW: 1, J1850PWM: 2, ISO9141: 3, ISO14230: 4, CAN: 5, ISO15765: 6,
};

/** Códigos de retorno de la norma. */
export const ERRORES = {
  0x00: 'Sin error',
  0x01: 'La función no está soportada por esta biblioteca',
  0x02: 'Identificador de canal inválido',
  0x03: 'Protocolo no soportado por el equipo',
  0x04: 'Parámetro nulo',
  0x05: 'Valor de ioctl inválido',
  0x06: 'Flags inválidos',
  0x07: 'La operación falló',
  0x08: 'El equipo no está conectado',
  0x09: 'Se agotó el tiempo de espera',
  0x0a: 'Mensaje inválido',
  0x0b: 'Intervalo de tiempo inválido',
  0x0c: 'Se excedió un límite del equipo',
  0x0d: 'Identificador de mensaje inválido',
  0x0e: 'El equipo está en uso por otro programa',
  0x0f: 'Identificador de ioctl inválido',
  0x10: 'No hay mensajes para leer',
  0x11: 'Buffer lleno',
  0x12: 'Desborde de buffer',
  0x13: 'Pin inválido',
  0x14: 'El canal ya está en uso',
  0x15: 'El protocolo del mensaje no coincide con el del canal',
  0x16: 'Identificador de filtro inválido',
  0x17: 'Falta el mensaje de control de flujo',
  0x18: 'El filtro no es único',
  0x19: 'Baud rate inválido',
  0x1a: 'Identificador de dispositivo inválido',
};

export const SIN_ERROR = 0x00;
export const BUFFER_VACIO = 0x10;

/** Tamaño del campo de datos que fija la norma. */
const DATA_MAX = 4128;

/**
 * Estructura de mensaje de la norma, registrada una sola vez por proceso.
 *
 * koffi rechaza redefinir un tipo con el mismo nombre, así que esto NO puede
 * vivir dentro de cargar(): abrir un segundo equipo fallaría.
 *
 * Los campos son uint32 explícitos. En Windows `unsigned long` son 4 bytes
 * tanto en 32 como en 64 bits, y la norma define la estructura con campos de
 * 32 bits; en Linux `unsigned long` son 8, así que dejarlo librado al tipo
 * nativo daría un layout distinto según el sistema.
 */
const PASSTHRU_MSG = koffi.struct('PASSTHRU_MSG', {
  ProtocolID: 'uint32',
  RxStatus: 'uint32',
  TxFlags: 'uint32',
  Timestamp: 'uint32',
  DataSize: 'uint32',
  ExtraDataIndex: 'uint32',
  Data: koffi.array('uint8', DATA_MAX),
});

const IOCTL = {
  READ_VBATT: 0x03,
  CLEAR_TX_BUFFER: 0x07,
  CLEAR_RX_BUFFER: 0x08,
};

const FILTRO_FLOW_CONTROL = 3;

export class J2534Error extends Error {
  constructor(codigo, operacion, detalle) {
    const texto = ERRORES[codigo] ?? `Código desconocido 0x${codigo.toString(16)}`;
    super(`${operacion}: ${texto}`);
    this.name = 'J2534Error';
    this.codigo = codigo;
    this.operacion = operacion;
    if (detalle) this.detalle = detalle;
  }
}

/**
 * Carga la biblioteca y liga las funciones.
 *
 * El error que más desconcierta en la práctica es el de arquitectura: muchas
 * DLL J2534 son de 32 bits y un Node de 64 no las puede cargar. Se detecta y
 * se dice con todas las letras, porque el mensaje del sistema no ayuda.
 */
export function cargar(ruta) {
  let lib;
  try {
    lib = koffi.load(ruta);
  } catch (err) {
    const m = String(err?.message ?? err);
    if (/is not a valid win32|%1 is not|wrong architecture|invalid ELF|bad ELF/i.test(m)) {
      throw new Error(
        `No se pudo cargar ${ruta}: la biblioteca es de otra arquitectura que este Node. ` +
        `Node corre en ${process.arch}. Si la DLL del fabricante es de 32 bits, hace falta ` +
        'un Node de 32 bits, o la variante de 64 bits de esa DLL si el fabricante la provee.',
      );
    }
    throw new Error(`No se pudo cargar ${ruta}: ${m}`);
  }

  const f = (sig) => lib.func(sig);

  return {
    PASSTHRU_MSG,
    PassThruOpen: f('int32 PassThruOpen(void *pName, _Out_ uint32 *pDeviceID)'),
    PassThruClose: f('int32 PassThruClose(uint32 DeviceID)'),
    PassThruConnect: f(
      'int32 PassThruConnect(uint32 DeviceID, uint32 ProtocolID, uint32 Flags, uint32 BaudRate, _Out_ uint32 *pChannelID)',
    ),
    PassThruDisconnect: f('int32 PassThruDisconnect(uint32 ChannelID)'),
    PassThruReadMsgs: f(
      'int32 PassThruReadMsgs(uint32 ChannelID, _Inout_ PASSTHRU_MSG *pMsg, _Inout_ uint32 *pNumMsgs, uint32 Timeout)',
    ),
    PassThruWriteMsgs: f(
      'int32 PassThruWriteMsgs(uint32 ChannelID, _Inout_ PASSTHRU_MSG *pMsg, _Inout_ uint32 *pNumMsgs, uint32 Timeout)',
    ),
    PassThruStartMsgFilter: f(
      'int32 PassThruStartMsgFilter(uint32 ChannelID, uint32 FilterType, PASSTHRU_MSG *pMaskMsg, PASSTHRU_MSG *pPatternMsg, PASSTHRU_MSG *pFlowControlMsg, _Out_ uint32 *pFilterID)',
    ),
    PassThruStopMsgFilter: f('int32 PassThruStopMsgFilter(uint32 ChannelID, uint32 FilterID)'),
    PassThruReadVersion: f(
      'int32 PassThruReadVersion(uint32 DeviceID, _Out_ char *pFirmwareVersion, _Out_ char *pDllVersion, _Out_ char *pApiVersion)',
    ),
    PassThruGetLastError: f('int32 PassThruGetLastError(_Out_ char *pErrorDescription)'),
    PassThruIoctl: f('int32 PassThruIoctl(uint32 ChannelID, uint32 IoctlID, void *pInput, _Out_ uint32 *pOutput)'),
  };
}

/** Un mensaje vacío con la forma que espera la norma. */
const mensajeVacio = (protocolo) => ({
  ProtocolID: protocolo,
  RxStatus: 0,
  TxFlags: 0,
  Timestamp: 0,
  DataSize: 0,
  ExtraDataIndex: 0,
  Data: new Uint8Array(DATA_MAX),
});

const conDatos = (protocolo, bytes, txFlags = 0) => {
  const data = new Uint8Array(DATA_MAX);
  data.set(bytes.subarray(0, DATA_MAX));
  return {
    ProtocolID: protocolo,
    RxStatus: 0,
    TxFlags: txFlags,
    Timestamp: 0,
    DataSize: Math.min(bytes.length, DATA_MAX),
    ExtraDataIndex: 0,
    Data: data,
  };
};

/**
 * Un dispositivo J2534 abierto, con un canal conectado.
 *
 * Trabaja con mensajes, no con bytes: `escribir` toma el payload sin la
 * cabecera CAN y la agrega, `leer` devuelve el payload ya sin ella.
 */
export class DispositivoJ2534 {
  #api;
  #deviceId = null;
  #channelId = null;
  #protocolo = PROTOCOLO.ISO15765;
  #filtroId = null;
  /** Dirección de la herramienta y de la ECU, en CAN de 11 bits. */
  #idTx = 0x7e0;
  #idRx = 0x7e8;

  constructor(rutaBiblioteca) {
    this.#api = cargar(rutaBiblioteca);
  }

  #chequear(codigo, operacion) {
    if (codigo === SIN_ERROR) return;
    let detalle;
    try {
      const buf = Buffer.alloc(80);
      this.#api.PassThruGetLastError(buf);
      detalle = buf.toString('latin1').replace(/\0.*$/, '').trim() || undefined;
    } catch {
      // GetLastError es opcional en algunas bibliotecas.
    }
    throw new J2534Error(codigo, operacion, detalle);
  }

  abrir() {
    const out = [0];
    this.#chequear(this.#api.PassThruOpen(null, out), 'Abrir el equipo');
    this.#deviceId = out[0];
    return this.#deviceId;
  }

  version() {
    if (this.#deviceId === null) throw new Error('El equipo no está abierto');
    const fw = Buffer.alloc(80);
    const dll = Buffer.alloc(80);
    const api = Buffer.alloc(80);
    this.#chequear(
      this.#api.PassThruReadVersion(this.#deviceId, fw, dll, api),
      'Leer la versión',
    );
    const limpio = (b) => b.toString('latin1').replace(/\0.*$/, '').trim();
    return { firmware: limpio(fw), dll: limpio(dll), api: limpio(api) };
  }

  /** Tensión de batería en voltios, si el equipo la expone. */
  tension() {
    if (this.#deviceId === null) return null;
    try {
      const out = [0];
      const r = this.#api.PassThruIoctl(this.#deviceId, IOCTL.READ_VBATT, null, out);
      if (r !== SIN_ERROR) return null;
      return out[0] / 1000;
    } catch {
      return null;
    }
  }

  conectar({ protocolo = PROTOCOLO.ISO15765, baudRate = 500000, idTx, idRx } = {}) {
    if (this.#deviceId === null) throw new Error('El equipo no está abierto');
    if (idTx !== undefined) this.#idTx = idTx;
    if (idRx !== undefined) this.#idRx = idRx;
    this.#protocolo = protocolo;

    const out = [0];
    this.#chequear(
      this.#api.PassThruConnect(this.#deviceId, protocolo, 0, baudRate, out),
      'Conectar el canal',
    );
    this.#channelId = out[0];

    // Sobre ISO15765 hace falta un filtro de control de flujo o la ECU no
    // contesta nada. Es el paso que más se olvida y el síntoma es silencio
    // total, que se confunde con un problema de cableado.
    if (protocolo === PROTOCOLO.ISO15765) this.#instalarFiltro();
    return this.#channelId;
  }

  #instalarFiltro() {
    const idBytes = (id) => new Uint8Array([
      (id >> 24) & 0xff, (id >> 16) & 0xff, (id >> 8) & 0xff, id & 0xff,
    ]);
    const mask = conDatos(this.#protocolo, idBytes(0xffffffff));
    const pattern = conDatos(this.#protocolo, idBytes(this.#idRx));
    const flow = conDatos(this.#protocolo, idBytes(this.#idTx));
    const out = [0];
    this.#chequear(
      this.#api.PassThruStartMsgFilter(
        this.#channelId, FILTRO_FLOW_CONTROL, mask, pattern, flow, out,
      ),
      'Instalar el filtro de control de flujo',
    );
    this.#filtroId = out[0];
  }

  /** Escribe un payload de servicio, agregando la cabecera CAN. */
  escribir(payload, timeoutMs = 1000) {
    if (this.#channelId === null) throw new Error('No hay un canal conectado');
    const bytes = new Uint8Array(4 + payload.length);
    bytes[0] = (this.#idTx >> 24) & 0xff;
    bytes[1] = (this.#idTx >> 16) & 0xff;
    bytes[2] = (this.#idTx >> 8) & 0xff;
    bytes[3] = this.#idTx & 0xff;
    bytes.set(payload, 4);

    const msg = [conDatos(this.#protocolo, bytes)];
    const n = [1];
    this.#chequear(
      this.#api.PassThruWriteMsgs(this.#channelId, msg, n, timeoutMs),
      'Escribir al vehículo',
    );
  }

  /**
   * Lee un mensaje. Devuelve el payload sin cabecera, o null si no hay nada.
   *
   * BUFFER_VACIO no es un error: es la respuesta normal cuando todavía no
   * llegó nada. Tratarlo como fallo rompe cualquier lectura con espera.
   */
  leer(timeoutMs = 1000) {
    if (this.#channelId === null) throw new Error('No hay un canal conectado');
    const msg = [mensajeVacio(this.#protocolo)];
    const n = [1];
    const r = this.#api.PassThruReadMsgs(this.#channelId, msg, n, timeoutMs);
    if (r === BUFFER_VACIO || (r === SIN_ERROR && n[0] === 0)) return null;
    this.#chequear(r, 'Leer del vehículo');

    const m = msg[0];
    const total = Math.min(m.DataSize, DATA_MAX);
    // El índice de datos extra marca dónde termina la cabecera; cuando la
    // biblioteca no lo informa, la cabecera CAN son los primeros 4 bytes.
    const inicio = m.ExtraDataIndex > 0 && m.ExtraDataIndex < total ? m.ExtraDataIndex : 4;
    const datos = Uint8Array.from(m.Data.slice(inicio, total));
    return { payload: datos, rxStatus: m.RxStatus, timestamp: m.Timestamp };
  }

  limpiarBuffers() {
    if (this.#channelId === null) return;
    try {
      this.#api.PassThruIoctl(this.#channelId, IOCTL.CLEAR_RX_BUFFER, null, null);
      this.#api.PassThruIoctl(this.#channelId, IOCTL.CLEAR_TX_BUFFER, null, null);
    } catch {
      // Opcional: no todas las bibliotecas lo implementan.
    }
  }

  cerrar() {
    try {
      if (this.#filtroId !== null && this.#channelId !== null) {
        this.#api.PassThruStopMsgFilter(this.#channelId, this.#filtroId);
      }
    } catch { /* ya cerrado */ }
    try {
      if (this.#channelId !== null) this.#api.PassThruDisconnect(this.#channelId);
    } catch { /* ya desconectado */ }
    try {
      if (this.#deviceId !== null) this.#api.PassThruClose(this.#deviceId);
    } catch { /* ya cerrado */ }
    this.#filtroId = null;
    this.#channelId = null;
    this.#deviceId = null;
  }
}

/**
 * Busca las bibliotecas J2534 instaladas en Windows.
 *
 * El instalador de cada fabricante se registra bajo PassThruSupport.04.04.
 * Es la forma estándar de descubrirlas; no hay equivalente en Linux ni macOS.
 */
export function buscarInstaladas() {
  if (process.platform !== 'win32') return [];
  const raices = [
    'HKLM\\SOFTWARE\\WOW6432Node\\PassThruSupport.04.04',
    'HKLM\\SOFTWARE\\PassThruSupport.04.04',
  ];
  const encontradas = [];
  for (const raiz of raices) {
    let claves;
    try {
      claves = execFileSync('reg', ['query', raiz], { encoding: 'utf8', timeout: 5000 })
        .split(/\r?\n/).filter((l) => l.startsWith(raiz + '\\'));
    } catch {
      continue; // esa raíz no existe en este equipo
    }
    for (const clave of claves) {
      try {
        const salida = execFileSync('reg', ['query', clave.trim()], {
          encoding: 'utf8', timeout: 5000,
        });
        const nombre = /Name\s+REG_SZ\s+(.+)/i.exec(salida)?.[1]?.trim();
        const dll = /FunctionLibrary\s+REG_SZ\s+(.+)/i.exec(salida)?.[1]?.trim();
        const proveedor = /Vendor\s+REG_SZ\s+(.+)/i.exec(salida)?.[1]?.trim();
        if (dll) {
          encontradas.push({
            nombre: nombre ?? clave.split('\\').pop(),
            proveedor: proveedor ?? 'desconocido',
            dll,
            clave: clave.trim(),
          });
        }
      } catch {
        // Una clave ilegible no debe frenar el resto.
      }
    }
  }
  return encontradas;
}
