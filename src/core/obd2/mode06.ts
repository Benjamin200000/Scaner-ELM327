import type { Obd2Service } from './service';
import { ElmError } from '@/core/elm327/errors';

/**
 * Modo 06: resultados de los autodiagnósticos de la ECU.
 *
 * Los monitores de emisiones no son solo "completo / pendiente": cada uno
 * guarda el valor que midió y los límites contra los que lo comparó. Eso
 * permite ver una falla ANTES de que haya código: un catalizador o un filtro
 * de partículas que pasa la prueba raspando el límite todavía no enciende el
 * testigo, pero ya avisa.
 *
 * Solo CAN. En los protocolos anteriores el modo 06 tiene otro formato,
 * propio de cada fabricante, y no se intenta.
 *
 * Lo que es firme y lo que no:
 *  - El formato del registro (MID, TID, escala, valor, mínimo, máximo) y la
 *    comparación contra límites son de la norma y no dependen de unidades.
 *  - Los NOMBRES de los monitores salen de la tabla de ISO 15031-5. Los de
 *    sondas lambda (01-10) los contrasté; el resto no pude contrastarlos y
 *    van marcados. Un MID sin nombre se muestra por su número.
 *  - Los valores se muestran en unidades internas: la tabla de escalas de
 *    la norma no está cargada, y convertir con una escala supuesta sería
 *    inventar. El margen porcentual sí es exacto.
 */

export interface TestResult {
  ecu: string;
  mid: number;
  tid: number;
  /** Identificador de unidad y escala de la norma. */
  uas: number;
  value: number;
  min: number;
  max: number;
  passed: boolean;
  /**
   * Posición del valor dentro de la ventana permitida, 0 a 100.
   * Cerca de 0 o de 100 significa que aprobó, pero cerca del límite.
   */
  position: number | null;
}

export interface MonitorName {
  label: string;
  /** false = nombre no contrastado contra una fuente primaria. */
  verified: boolean;
}

const banco = (base: number, mid: number, texto: string): string =>
  `${texto}, banco ${mid - base + 1}`;

/** Nombre del monitor según su MID. null si no se conoce. */
export function nombreMonitor(mid: number): MonitorName | null {
  if (mid >= 0x01 && mid <= 0x10) {
    const b = Math.floor((mid - 1) / 4) + 1;
    const sn = ((mid - 1) % 4) + 1;
    return { label: `Sonda lambda, banco ${b} sensor ${sn}`, verified: true };
  }
  const nv = (label: string): MonitorName => ({ label, verified: false });
  if (mid >= 0x21 && mid <= 0x24) return nv(banco(0x21, mid, 'Catalizador'));
  if (mid >= 0x31 && mid <= 0x34) return nv(banco(0x31, mid, 'EGR'));
  if (mid >= 0x35 && mid <= 0x38) return nv(banco(0x35, mid, 'Distribución variable'));
  if (mid >= 0x39 && mid <= 0x3d) return nv('Sistema evaporativo');
  if (mid >= 0x41 && mid <= 0x50) {
    const b = Math.floor((mid - 0x41) / 4) + 1;
    const sn = ((mid - 0x41) % 4) + 1;
    return nv(`Calefactor de sonda lambda, banco ${b} sensor ${sn}`);
  }
  if (mid >= 0x61 && mid <= 0x64) return nv(banco(0x61, mid, 'Catalizador calefaccionado'));
  if (mid >= 0x71 && mid <= 0x74) return nv('Aire secundario');
  if (mid >= 0x81 && mid <= 0x84) return nv(banco(0x81, mid, 'Sistema de combustible'));
  if (mid >= 0x85 && mid <= 0x86) return nv(banco(0x85, mid, 'Control de presión de turbo'));
  if (mid >= 0x90 && mid <= 0x91) return nv(banco(0x90, mid, 'Adsorbedor de NOx'));
  if (mid >= 0x98 && mid <= 0x99) return nv(banco(0x98, mid, 'Catalizador de NOx'));
  if (mid === 0xa1) return nv('Fallo de combustión, datos generales');
  if (mid >= 0xa2 && mid <= 0xad) return nv(`Fallo de combustión, cilindro ${mid - 0xa1}`);
  if (mid >= 0xb2 && mid <= 0xb3) return nv(banco(0xb2, mid, 'Filtro de partículas'));
  return null;
}

/** Arma los registros de 9 bytes de un mensaje del modo 06. */
export function parsearRegistros(ecu: string, datos: number[]): TestResult[] {
  const out: TestResult[] = [];
  for (let i = 0; i + 8 < datos.length; i += 9) {
    const r = datos.slice(i, i + 9);
    const [mid, tid, uas] = r;
    if (mid === undefined || tid === undefined || uas === undefined) break;
    // Las escalas 0x80 en adelante son con signo.
    const u16 = (hi: number, lo: number): number => {
      const v = (hi << 8) | lo;
      return uas >= 0x80 && v >= 0x8000 ? v - 0x10000 : v;
    };
    const value = u16(r[3] ?? 0, r[4] ?? 0);
    const min = u16(r[5] ?? 0, r[6] ?? 0);
    const max = u16(r[7] ?? 0, r[8] ?? 0);
    const passed = value >= min && value <= max;
    const position = max > min
      ? Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
      : null;
    out.push({ ecu, mid, tid, uas, value, min, max, passed, position });
  }
  return out;
}

const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');

/** Descubre los monitores disponibles y lee todos sus resultados. */
export async function leerModo06(obd: Obd2Service): Promise<TestResult[]> {
  const mids = new Set<number>();
  for (let base = 0x00; base <= 0xe0; base += 0x20) {
    let mensajes;
    try {
      mensajes = await obd.consultar(`06${hex2(base)}`, 0x06, 3000);
    } catch (err) {
      if (err instanceof ElmError && err.isExpected) break;
      throw err;
    }
    let sigue = false;
    let alguno = false;
    for (const m of mensajes) {
      if (m.data[1] !== base) continue;
      const bits = m.data.slice(2, 6);
      if (bits.length < 4) continue;
      alguno = true;
      for (let i = 0; i < 31; i++) {
        if (((bits[i >> 3] ?? 0) & (0x80 >> (i & 7))) !== 0) mids.add(base + i + 1);
      }
      if (((bits[3] ?? 0) & 0x01) !== 0) sigue = true;
    }
    if (!alguno || !sigue) break;
  }

  const out: TestResult[] = [];
  for (const mid of [...mids].sort((a, b) => a - b)) {
    try {
      for (const m of await obd.consultar(`06${hex2(mid)}`, 0x06, 3000)) {
        out.push(...parsearRegistros(m.ecu, m.data.slice(1)));
      }
    } catch (err) {
      if (!(err instanceof ElmError)) throw err;
    }
  }
  return out;
}
