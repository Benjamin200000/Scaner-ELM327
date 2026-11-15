import type { Elm327Driver } from '@/core/elm327/driver';
import { ElmError } from '@/core/elm327/errors';
import { extractPayload, joinObdBytes } from '@/core/elm327/parse';
import { type Dtc, type DtcKind, parseDtcPayload } from './dtc';
import { PID_DEFS, type PidDef, pidByNumber } from './pids';
import { decodificarReadiness, type Readiness } from './readiness';

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
  /**
   * Estado de los monitores de emisiones (PID 01 del modo 01).
   *
   * Se lee aparte de los demás parámetros porque no es una medición: es el
   * estado de los autodiagnósticos, y decide si un vehículo pasa una
   * revisión técnica.
   */
  async readReadiness(): Promise<Readiness | null> {
    const payload = await this.rawPid(0x01, 0x01);
    if (payload === null) return null;
    return decodificarReadiness(payload);
  }

  /**
   * Datos congelados: la foto de los sensores en el momento en que la ECU
   * guardó un código (modo 02).
   *
   * Vale mucho para diagnosticar una falla intermitente, porque dice en qué
   * condiciones ocurrió: a qué régimen, con qué carga, a qué temperatura.
   *
   * El modo 02 reutiliza los PID del modo 01 y agrega un número de trama.
   * No todas las ECU lo implementan, y las que lo hacen suelen guardar una
   * sola trama.
   */
  async readFreezeFrame(pids: number[], frame = 0): Promise<Map<number, PidReading>> {
    const salida = new Map<number, PidReading>();
    for (const pid of pids) {
      try {
        const datos = await this.rawFreezeFrame(pid, frame);
        if (datos === null) continue;
        const def = pidByNumber(pid);
        const values = new Map<string, number | null>();
        if (def) {
          for (const param of def.params) values.set(param.id, param.decode(datos));
        }
        salida.set(pid, { pid, values, raw: datos, at: Date.now() });
      } catch (err) {
        // Una ECU sin modo 02 rechaza cada PID: no es motivo para abortar.
        if (!(err instanceof ElmError)) throw err;
      }
    }
    return salida;
  }

  /**
   * ¿Qué código provocó los datos congelados? Es el PID 02 dentro del modo 02.
   * Devuelve null cuando la ECU no tiene ninguna trama guardada.
   */
  async readFreezeFrameDtc(frame = 0): Promise<string | null> {
    try {
      // El código ocupa dos bytes; el 0x02 no está en el catálogo de PID.
      const datos = await this.rawFreezeFrame(0x02, frame, 2);
      if (datos === null || datos.length < 2) return null;
      const [a, b] = datos;
      if (a === undefined || b === undefined) return null;
      const { decodeDtc } = await import('./dtc');
      return decodeDtc(a, b);
    } catch (err) {
      if (err instanceof ElmError) return null;
      throw err;
    }
  }

  /**
   * @param esperados Bytes de datos esperados. Hace falta para los PID que
   * no están en el catálogo, como el 0x02 que trae el código disparador:
   * sin saber el largo no se puede distinguir el número de trama de un
   * byte de datos, y saltear de más corre todo el contenido.
   */
  private async rawFreezeFrame(
    pid: number,
    frame: number,
    esperados?: number,
  ): Promise<number[] | null> {
    const res = await this.driver.send(`02${hex2(pid)}${hex2(frame)}`, { timeoutMs: 3000 });
    const bytes = joinObdBytes(res.lines);
    if (bytes === null) return null;
    const payload = extractPayload(bytes, 0x02, pid);
    if (payload === null) return null;

    // La respuesta repite el número de trama después del PID. Algunas
    // implementaciones no lo hacen, así que se decide por el largo esperado
    // en lugar de asumir: saltear un byte de más corre todos los datos.
    const largo = esperados ?? pidByNumber(pid)?.bytes;
    if (largo === undefined) return payload;
    if (payload.length === largo) return payload;
    if (payload.length >= largo + 1 && payload[0] === frame) {
      return payload.slice(1, 1 + largo);
    }
    return payload.slice(0, largo);
  }

  /**
   * Lee varios PID en una sola solicitud.
   *
   * SAE J1979 permite pedir hasta seis PID del modo 01 en un mismo mensaje
   * y la ECU contesta todos juntos. Solo funciona sobre CAN: los protocolos
   * más viejos no tienen tramas lo bastante largas.
   *
   * Importa mucho en la práctica. Un ELM327 hace entre 8 y 12 solicitudes
   * por segundo; pidiendo de a uno, catorce parámetros tardan más de un
   * segundo en refrescarse. Agrupados de a seis bajan a tres solicitudes.
   * Es la diferencia entre ver una aceleración y ver una sucesión de saltos.
   */
  async readPidBatch(pids: number[]): Promise<BatchReading> {
    const pedidos = pids.slice(0, MAX_PIDS_POR_SOLICITUD);
    const readings = new Map<number, PidReading>();
    if (pedidos.length === 0) return { readings, missing: [] };

    const res = await this.driver.send(`01${pedidos.map(hex2).join('')}`, {
      timeoutMs: 3000,
    });
    const bytes = joinObdBytes(res.lines);
    if (bytes === null) return { readings, missing: pedidos };

    const payload = extractPayload(bytes, 0x01);
    if (payload === null) return { readings, missing: pedidos };

    const at = Date.now();
    for (const [pid, datos] of recorrerAgrupado(payload)) {
      const def = pidByNumber(pid);
      const values = new Map<string, number | null>();
      if (def) {
        for (const param of def.params) values.set(param.id, param.decode(datos));
      }
      readings.set(pid, { pid, values, raw: datos, at });
    }
    return { readings, missing: pedidos.filter((p) => !readings.has(p)) };
  }

  /**
   * Comprueba si esta ECU acepta solicitudes agrupadas.
   *
   * No alcanza con que el protocolo sea CAN: hay ECU que ignoran el pedido
   * múltiple o contestan solo el primer PID. Se exige que vuelvan TODOS los
   * pedidos, porque conformarse con una respuesta parcial perdería
   * parámetros en silencio, que es peor que ir de a uno.
   */
  async probarAgrupacion(candidatos: number[]): Promise<boolean> {
    if (this.driver.protocol?.family !== 'can') return false;
    const prueba = candidatos.slice(0, 3);
    if (prueba.length < 2) return false;
    try {
      const r = await this.readPidBatch(prueba);
      return r.missing.length === 0;
    } catch {
      return false;
    }
  }
}

export const MAX_PIDS_POR_SOLICITUD = 6;

export interface BatchReading {
  /** Lecturas por PID. Los que la ECU no devolvió no aparecen. */
  readings: Map<number, PidReading>;
  /** PID que se pidieron y no volvieron. */
  missing: number[];
}

/**
 * Recorre la respuesta agrupada: <pid> <datos...> <pid> <datos...>
 *
 * El largo de cada bloque lo da el catálogo, porque la respuesta no lo
 * incluye. Un PID desconocido corta el recorrido: sin saber cuántos bytes
 * ocupa no se puede ubicar el siguiente, y seguir adivinando produciría
 * valores inventados a partir de bytes corridos.
 */
export function recorrerAgrupado(payload: number[]): Map<number, number[]> {
  const salida = new Map<number, number[]>();
  let i = 0;
  while (i < payload.length) {
    const pid = payload[i];
    if (pid === undefined) break;
    const def = pidByNumber(pid);
    if (!def) break;
    const datos = payload.slice(i + 1, i + 1 + def.bytes);
    if (datos.length < def.bytes) break;
    salida.set(pid, datos);
    i += 1 + def.bytes;
  }
  return salida;
}
