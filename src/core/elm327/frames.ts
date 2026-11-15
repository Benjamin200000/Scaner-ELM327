import type { ElmProtocol } from './protocols';

/**
 * Interpretación de las respuestas del ELM327 con headers activos (ATH1),
 * separadas por ECU.
 *
 * Con headers, cada línea es una trama cruda del bus y trae quién la envió.
 * Eso importa por dos motivos:
 *
 *  1. Varias ECU pueden contestar la misma pregunta (motor y transmisión
 *     responden las dos a 0100 o a 03). Mezclar sus bytes fabrica datos: en
 *     K-Line, la cabecera de la segunda ECU se decodificaba como un código de
 *     falla que no existe.
 *
 *  2. El formato depende del protocolo. En CAN el primer byte es el PCI de
 *     ISO-TP (trama única, primera o consecutiva). En los protocolos
 *     anteriores hay tres bytes de cabecera y un checksum al final, y las
 *     respuestas largas llevan un byte de orden.
 *
 * Las reglas de armado siguen las de python-OBD (protocol_can.py y
 * protocol_legacy.py), que es la implementación abierta de referencia y
 * lleva años contra hardware real.
 */

export interface EcuMessage {
  /** Identificador de la ECU: '7E8' en CAN, '10' en K-Line. */
  ecu: string;
  /** Mensaje armado: empieza en el byte de modo de respuesta (0x41, 0x43…). */
  data: number[];
}

export type FrameFamily = 'can11' | 'can29' | 'legacy' | 'unknown';

export function familyOf(protocol: ElmProtocol | null): FrameFamily {
  if (!protocol) return 'unknown';
  if (protocol.family === 'can') {
    return protocol.id === '6' || protocol.id === '8' ? 'can11' : 'can29';
  }
  if (protocol.family === 'auto') return 'unknown';
  return 'legacy';
}

const hexOf = (line: string): string => line.replace(/[^0-9A-Fa-f]/g, '');

const bytesOf = (hex: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
};

interface CanFrame {
  ecu: string;
  type: 'sf' | 'ff' | 'cf';
  len: number;
  seq: number;
  data: number[];
}

/**
 * Arma los mensajes de cada ECU.
 *
 * Devuelve una lista vacía cuando las líneas no tienen forma de trama con
 * cabecera; quien llama decide entonces el camino sin cabeceras.
 */
export function parseEcuMessages(lines: string[], family: FrameFamily): EcuMessage[] {
  if (family === 'can11' || family === 'can29') return parseCan(lines, family);
  if (family === 'legacy') return parseLegacy(lines);
  // Protocolo todavía sin resolver: se prueba CAN de 11 bits, que es lo que
  // delata una línea de largo impar, y si no, el formato anterior.
  const can = parseCan(lines, 'can11');
  return can.length > 0 ? can : parseLegacy(lines);
}

function parseCan(lines: string[], family: 'can11' | 'can29'): EcuMessage[] {
  const idChars = family === 'can11' ? 3 : 8;
  const porEcu = new Map<string, CanFrame[]>();

  for (const line of lines) {
    const hex = hexOf(line);
    // Con cabecera de 11 bits la línea queda de largo impar; con 29, par.
    if (family === 'can11' ? hex.length % 2 !== 1 : hex.length % 2 !== 0) continue;
    if (hex.length < idChars + 4) continue;
    const ecu = hex.slice(0, idChars).toUpperCase();
    const bytes = bytesOf(hex.slice(idChars));
    const pci = bytes[0];
    if (pci === undefined) continue;

    let frame: CanFrame | null = null;
    switch (pci & 0xf0) {
      case 0x00: {
        const len = pci & 0x0f;
        if (len > 0) frame = { ecu, type: 'sf', len, seq: 0, data: bytes.slice(1, 1 + len) };
        break;
      }
      case 0x10: {
        const len = ((pci & 0x0f) << 8) | (bytes[1] ?? 0);
        if (len > 0) frame = { ecu, type: 'ff', len, seq: 0, data: bytes.slice(2) };
        break;
      }
      case 0x20:
        frame = { ecu, type: 'cf', len: 0, seq: pci & 0x0f, data: bytes.slice(1) };
        break;
    }
    if (frame === null) continue;
    porEcu.set(ecu, [...(porEcu.get(ecu) ?? []), frame]);
  }

  const out: EcuMessage[] = [];
  for (const [ecu, frames] of porEcu) {
    const primeras = frames.filter((f) => f.type === 'ff');
    const consecutivas = frames.filter((f) => f.type === 'cf');

    // Tramas únicas: cada una es un mensaje completo.
    for (const f of frames) {
      if (f.type === 'sf') out.push({ ecu, data: f.data });
    }

    const primera = primeras[0];
    if (primera === undefined || primeras.length > 1 || consecutivas.length === 0) continue;

    // El número de secuencia solo trae cuatro bits y da la vuelta en 0xF:
    // se reconstruye el índice completo a partir del anterior.
    let previo = 0;
    const ordenadas = consecutivas.map((f) => {
      let seq = (previo & ~0x0f) + f.seq;
      if (seq < previo - 7) seq += 0x10;
      previo = seq;
      return { seq, data: f.data };
    }).sort((a, b) => a.seq - b.seq);

    // Si falta una trama del medio, el mensaje no se entrega: un VIN con un
    // hueco es peor que no tener VIN.
    const contiguas = ordenadas.every((f, i) => f.seq === i + 1);
    if (!contiguas) continue;

    const data = [...primera.data];
    for (const f of ordenadas) data.push(...f.data);
    out.push({ ecu, data: data.slice(0, primera.len) });
  }
  return out;
}

function parseLegacy(lines: string[]): EcuMessage[] {
  const porEcu = new Map<string, number[][]>();

  for (const line of lines) {
    const hex = hexOf(line);
    if (hex.length % 2 !== 0) continue;
    const bytes = bytesOf(hex);
    // Tres de cabecera, al menos un byte de datos y el checksum.
    if (bytes.length < 5 || bytes.length > 12) continue;
    const ecu = (bytes[2] ?? 0).toString(16).toUpperCase().padStart(2, '0');
    // Se descartan la cabecera y el checksum del final.
    const data = bytes.slice(3, -1);
    porEcu.set(ecu, [...(porEcu.get(ecu) ?? []), data]);
  }

  const out: EcuMessage[] = [];
  for (const [ecu, frames] of porEcu) {
    const primero = frames[0];
    if (primero === undefined) continue;
    const modo = primero[0];
    if (modo === undefined) continue;
    // Tramas de otro comando mezcladas: no se arma nada con eso.
    if (!frames.every((f) => f[0] === modo)) continue;

    if (modo === 0x43 || modo === 0x47 || modo === 0x4a) {
      // Los modos de DTC no llevan PID ni byte de orden: cada línea trae
      // hasta tres códigos y se concatenan.
      const data = [modo];
      for (const f of frames) data.push(...f.slice(1));
      out.push({ ecu, data });
      continue;
    }

    if (frames.length === 1) {
      // En el modo 09 hasta la respuesta de una sola línea trae el byte de
      // orden. Se quita siempre, para que el mensaje tenga la misma forma
      // venga en una línea o en cinco.
      out.push({
        ecu,
        data: modo === 0x49 ? [...primero.slice(0, 2), ...primero.slice(3)] : primero,
      });
      continue;
    }

    // Respuesta larga: <modo> <pid> <orden> <datos>. Se ordena por el byte
    // de orden y se exige que no falte ninguna.
    const ordenadas = [...frames].sort((a, b) => (a[2] ?? 0) - (b[2] ?? 0));
    const contiguas = ordenadas.every((f, i) => f[2] === i + 1);
    if (!contiguas) continue;
    const data = [...primero.slice(0, 2)];
    for (const f of ordenadas) data.push(...f.slice(3));
    out.push({ ecu, data });
  }
  return out;
}

/**
 * Nombre orientativo de una ECU según su dirección.
 *
 * Las direcciones 7E8 y 7E9 (y 10/18 en K-Line) son una convención muy
 * extendida, no una garantía: por eso el texto dice "habitualmente".
 */
export function describeEcu(ecu: string): string {
  const conocidas: Record<string, string> = {
    '7E8': 'Motor',
    '7E9': 'Transmisión',
    '7EA': 'Unidad adicional de emisiones',
    '7EB': 'Unidad adicional de emisiones',
    '10': 'Motor',
    '11': 'Motor',
    '18': 'Transmisión',
    '1A': 'Transmisión',
  };
  const corta = ecu.length === 8 ? ecu.slice(6) : ecu;
  const nombre = conocidas[ecu] ?? conocidas[corta];
  return nombre !== undefined ? `${nombre} (${ecu})` : `ECU ${ecu}`;
}

/** Ordena para que la ECU de motor quede primera. */
export const ordenarEcus = (a: string, b: string): number =>
  parseInt(a, 16) - parseInt(b, 16);

/** Dirección de solicitud física de una ECU CAN de 11 bits (7E8 -> 7E0). */
export function direccionSolicitud(ecu: string): string | null {
  if (ecu.length !== 3) return null;
  const id = parseInt(ecu, 16);
  if (id < 0x7e8 || id > 0x7ef) return null;
  return (id - 8).toString(16).toUpperCase();
}
