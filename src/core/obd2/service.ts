import type { Elm327Driver } from '@/core/elm327/driver';
import { ElmError } from '@/core/elm327/errors';
import { extractPayload, joinObdBytes } from '@/core/elm327/parse';
import { type Dtc, type DtcKind, parseDtcPayload } from './dtc';
import { PID_DEFS, type PidDef, pidByNumber } from './pids';

/**
 * Servicios OBD-II genéricos sobre el driver del ELM327.
 *
 * Esta capa no sabe nada de UI y nada de fabricantes: solo modos estándar.
 * El diagnóstico específico de marca vive en su propia capa (kwp2000/), y la
 * app los presenta separados a propósito.
 */

export interface PidReading {
  pid: number;
  /** Valores decodificados por id de parámetro. null = campo no presente. */
  values: Map<string, number | null>;
  /** Bytes crudos del payload, para el modo técnico. */
  raw: number[];
  at: number;
}

export interface VehicleIdentity {
  vin: string | null;
  calibrationId: string | null;
  ecuName: string | null;
}

const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');

export class Obd2Service {
  constructor(private readonly driver: Elm327Driver) {}

  /**
   * Descubre qué PID del modo 01 soporta la ECU.
   *
   * Recorre los bloques 00, 20, 40... y para cuando un bloque no declara
   * continuidad. Devuelve el conjunto real, no una suposición.
   */
  async discoverSupportedPids(): Promise<Set<number>> {
    const supported = new Set<number>();
    for (let base = 0x00; base <= 0xc0; base += 0x20) {
      let payload: number[] | null;
      try {
        payload = await this.rawPid(0x01, base);
      } catch (err) {
        if (err instanceof ElmError && err.isExpected) break;
        throw err;
      }
      if (payload === null || payload.length < 4) break;

      for (let i = 0; i < 32; i++) {
        const byte = payload[i >> 3];
        if (byte === undefined) continue;
        if ((byte & (0x80 >> (i & 7))) !== 0) {
          supported.add(base + i + 1);
        }
      }
      // El último bit del bloque indica si hay que seguir preguntando.
      const last = payload[3];
      const hasNext = last !== undefined && (last & 0x01) !== 0;
      if (!hasNext) break;
    }
    // Los PID de bloque no son parámetros: no deben aparecer como datos.
    for (let base = 0x00; base <= 0xc0; base += 0x20) supported.delete(base);
    return supported;
  }

  /** PID del modo 01 que la app sabe decodificar y la ECU soporta. */
  readablePids(supported: Set<number>): PidDef[] {
    return PID_DEFS.filter((d) => supported.has(d.pid));
  }

  async readPid(pid: number): Promise<PidReading | null> {
    const def = pidByNumber(pid);
    const payload = await this.rawPid(0x01, pid);
    if (payload === null) return null;
    const values = new Map<string, number | null>();
    if (def) {
      for (const param of def.params) {
        values.set(param.id, param.decode(payload));
      }
    }
    return { pid, values, raw: payload, at: Date.now() };
  }

  private async rawPid(mode: number, pid: number): Promise<number[] | null> {
    const res = await this.driver.send(`${hex2(mode)}${hex2(pid)}`);
    const bytes = joinObdBytes(res.lines);
    if (bytes === null) return null;
    return extractPayload(bytes, mode, pid);
  }

  async readDtcs(kind: DtcKind): Promise<Dtc[]> {
    const mode = kind === 'stored' ? 0x03 : kind === 'pending' ? 0x07 : 0x0a;
    let res;
    try {
      res = await this.driver.send(hex2(mode), { timeoutMs: 4000 });
    } catch (err) {
      // Sin códigos, KWP devuelve NO DATA en lugar de una lista vacía.
      if (err instanceof ElmError && err.isExpected) return [];
      throw err;
    }
    const bytes = joinObdBytes(res.lines);
    if (bytes === null) return [];
    const payload = extractPayload(bytes, mode);
    if (payload === null) return [];
    // Solo CAN/ISO-TP intercala el byte de cantidad entre el modo y los
    // códigos. Confundirse acá significa inventar o perder un código.
    const hasCountByte = this.driver.protocol?.family === 'can';
    return parseDtcPayload(payload, kind, hasCountByte);
  }

  /**
   * Borra códigos y datos congelados (modo 04).
   *
   * Es una ESCRITURA: apaga el testigo, borra los freeze frames y resetea
   * los monitores de a bordo. La confirmación corresponde a la UI, no acá.
   */
  async clearDtcs(): Promise<void> {
    await this.driver.send('04', { timeoutMs: 5000 });
  }

  /** Identificación por modo 09. Lo que no esté, queda en null. */
  async readIdentity(): Promise<VehicleIdentity> {
    return {
      vin: await this.readMode09Text(0x02),
      calibrationId: await this.readMode09Text(0x04),
      ecuName: await this.readMode09Text(0x0a),
    };
  }

  private async readMode09Text(pid: number): Promise<string | null> {
    try {
      const res = await this.driver.send(`09${hex2(pid)}`, { timeoutMs: 4000 });
      const bytes = joinObdBytes(res.lines);
      if (bytes === null) return null;
      const payload = extractPayload(bytes, 0x09, pid);
      if (payload === null || payload.length === 0) return null;
      // El primer byte es la cantidad de mensajes de datos, no texto.
      const chars = payload.slice(1).filter((c) => c >= 0x20 && c <= 0x7e);
      const text = String.fromCharCode(...chars).trim();
      return text.length > 0 ? text : null;
    } catch (err) {
      if (err instanceof ElmError && err.isExpected) return null;
      throw err;
    }
  }
}
