import type { Elm327Driver } from '@/core/elm327/driver';
import { ElmError } from '@/core/elm327/errors';
import { direccionSolicitud, familyOf, parseEcuMessages } from '@/core/elm327/frames';

/**
 * Identificación profunda de una ECU por UDS (ISO 14229, servicio 0x22).
 *
 * El modo 09 de OBD-II da VIN y calibración. Las ECU modernas guardan mucho
 * más: número de repuesto, versión de software, número de hardware, número
 * de serie, proveedor. Son identificadores estándar de ISO 14229-1 (rango
 * F180-F19F) y leerlos no modifica nada: es la misma consulta que hace
 * cualquier equipo de taller al entrar a un módulo.
 *
 * Solo CAN de 11 bits, que es donde la dirección física de cada ECU se
 * deduce de su respuesta (7E8 contesta, 7E0 pregunta). Que una ECU conteste
 * cada identificador depende del fabricante: lo que no contesta se omite.
 */

export interface DidDef {
  did: number;
  label: string;
}

/** Identificadores de ISO 14229-1 que valen la pena para saber qué ECU es. */
export const DIDS_IDENTIFICACION: DidDef[] = [
  { did: 0xf190, label: 'VIN grabado en la unidad' },
  { did: 0xf187, label: 'Número de repuesto' },
  { did: 0xf189, label: 'Versión de software' },
  { did: 0xf188, label: 'Número de software' },
  { did: 0xf191, label: 'Número de hardware' },
  { did: 0xf193, label: 'Versión de hardware del proveedor' },
  { did: 0xf197, label: 'Sistema o tipo de motor' },
  { did: 0xf18a, label: 'Proveedor del sistema' },
  { did: 0xf18c, label: 'Número de serie de la ECU' },
  { did: 0xf18b, label: 'Fecha de fabricación de la ECU' },
  { did: 0xf195, label: 'Versión de software del proveedor' },
  { did: 0xf199, label: 'Fecha de programación' },
];

export interface DidValue {
  did: number;
  label: string;
  /** Texto si los bytes son imprimibles; si no, hexadecimal. */
  text: string;
  raw: number[];
}

const hex = (n: number, w: number): string => n.toString(16).toUpperCase().padStart(w, '0');

function presentar(raw: number[]): string {
  const utiles = raw.filter((b) => b !== 0x00 && b !== 0xff);
  const imprimible = utiles.length > 0 && utiles.every((b) => b >= 0x20 && b <= 0x7e);
  if (imprimible) return String.fromCharCode(...utiles).trim();
  return raw.map((b) => hex(b, 2)).join(' ');
}

/**
 * Lee los identificadores de una ECU.
 *
 * Fija la cabecera a la dirección física de esa unidad y la devuelve al
 * direccionamiento funcional al terminar, también si algo falla: dejar la
 * cabecera cambiada haría que el resto de la app le hable a una sola ECU
 * sin saberlo.
 */
export async function leerIdentificacionUds(
  driver: Elm327Driver,
  ecu: string,
): Promise<DidValue[]> {
  if (familyOf(driver.protocol) !== 'can11') return [];
  const solicitud = direccionSolicitud(ecu);
  if (solicitud === null) return [];

  const out: DidValue[] = [];
  await driver.send(`ATSH${solicitud}`);
  try {
    for (const def of DIDS_IDENTIFICACION) {
      try {
        const res = await driver.send(`22${hex(def.did, 4)}`, { timeoutMs: 2500 });
        const propio = parseEcuMessages(res.lines, 'can11').find((m) =>
          m.ecu === ecu && m.data[0] === 0x62
          && m.data[1] === (def.did >> 8) && m.data[2] === (def.did & 0xff));
        if (!propio) continue;
        const raw = propio.data.slice(3);
        if (raw.length === 0) continue;
        out.push({ did: def.did, label: def.label, text: presentar(raw), raw });
      } catch (err) {
        // NO DATA o respuesta negativa: esa ECU no expone ese identificador.
        if (!(err instanceof ElmError)) throw err;
      }
    }
  } finally {
    await driver.send('ATSH7DF').catch(() => {});
  }
  return out;
}
