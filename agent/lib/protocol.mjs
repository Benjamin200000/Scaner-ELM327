/**
 * Validación de los mensajes del protocolo.
 *
 * El agente queda escuchando en un socket, y con --lan queda accesible desde
 * la red local. Así que todo lo que entra se valida antes de tocarlo: nada
 * de confiar en la forma del JSON porque "lo manda nuestra app".
 */

export const CODIGOS = {
  noAutenticado: 'no-autenticado',
  tokenInvalido: 'token-invalido',
  mensajeInvalido: 'mensaje-invalido',
  interfazDesconocida: 'interfaz-desconocida',
  yaAbierta: 'ya-abierta',
  noAbierta: 'no-abierta',
  falloAlAbrir: 'fallo-al-abrir',
  falloAlEscribir: 'fallo-al-escribir',
  enlaceCaido: 'enlace-caido',
  ocupado: 'ocupado',
};

/** Tope de un frame. Un comando de ELM327 son decenas de bytes, no megas. */
export const MAX_FRAME = 64 * 1024;

const esTexto = (v, max = 200) =>
  typeof v === 'string' && v.length > 0 && v.length <= max;

/**
 * Analiza un frame entrante.
 *
 * Devuelve `{ ok: true, msg }` o `{ ok: false, code, message }`. Nunca lanza:
 * un cliente mal escrito, o malicioso, no debe poder tirar el agente.
 */
export function analizar(raw) {
  if (raw.length > MAX_FRAME) {
    return malo('El mensaje excede el tamaño máximo');
  }
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return malo('El mensaje no es JSON válido');
  }
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) {
    return malo('El mensaje debe ser un objeto');
  }
  if (!esTexto(msg.t, 32)) return malo('Falta el tipo de mensaje');

  switch (msg.t) {
    case 'hello':
      if (!esTexto(msg.token, 128)) return malo('Falta el token');
      return { ok: true, msg: { t: 'hello', token: msg.token, client: String(msg.client ?? 'desconocido').slice(0, 64) } };
    case 'list':
    case 'close':
    case 'ping':
      return { ok: true, msg: { t: msg.t } };
    case 'kline': {
      const op = msg.op;
      if (!esTexto(op, 16)) return malo('Falta la operación de K-Line');
      const out = { t: 'kline', op };
      if (op === 'open') {
        if (!esTexto(msg.id, 256)) return malo('Falta la interfaz');
        out.id = msg.id;
        out.baud = Number(msg.baud) || 10400;
      } else if (op === 'init') {
        const dir = Number(msg.address);
        if (!Number.isInteger(dir) || dir < 0 || dir > 0xff) return malo('Dirección inválida');
        out.address = dir;
      } else if (op === 'send') {
        if (!Array.isArray(msg.bytes) || msg.bytes.length > 300) return malo('Bytes inválidos');
        out.bytes = msg.bytes.map((b) => b & 0xff);
      } else if (op === 'recv') {
        out.timeout = Math.min(Number(msg.timeout) || 2000, 10000);
      }
      return { ok: true, msg: out };
    }
    case 'open': {
      if (!esTexto(msg.id, 256)) return malo('Falta el identificador de la interfaz');
      const baudRate = Number(msg.options?.baudRate ?? 38400);
      if (!Number.isInteger(baudRate) || baudRate < 300 || baudRate > 1000000) {
        return malo('baudRate fuera de rango');
      }
      return { ok: true, msg: { t: 'open', id: msg.id, options: { baudRate } } };
    }
    case 'write': {
      if (typeof msg.data !== 'string' || msg.data.length > MAX_FRAME) {
        return malo('Datos inválidos');
      }
      let bytes;
      try {
        bytes = Buffer.from(msg.data, 'base64');
      } catch {
        return malo('Los datos no son base64 válido');
      }
      if (bytes.length === 0) return malo('Escritura vacía');
      return { ok: true, msg: { t: 'write', bytes } };
    }
    default:
      return malo(`Tipo de mensaje desconocido: ${msg.t}`);
  }
}

const malo = (message) => ({ ok: false, code: CODIGOS.mensajeInvalido, message });
