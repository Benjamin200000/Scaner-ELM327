import type { Elm327Driver } from '@/core/elm327/driver';
import { ElmError } from '@/core/elm327/errors';
import { hexBytes } from '@/core/elm327/parse';
import { describeNrc, SID } from './sid';

/**
 * Servicios KWP2000 (ISO 14230-3) sobre un ELM327.
 *
 * El ELM327 transporta solicitudes arbitrarias: se fija el header con ATSH y
 * se mandan los bytes del servicio en hexadecimal. Lo que el chip NO hace es
 * mantener la sesión viva por su cuenta en todos los casos, así que el
 * testerPresent periódico corre acá.
 *
 * Esta capa es genérica y está basada en norma. Las secuencias concretas de
 * cada fabricante viven en src/core/service/, separadas a propósito: una es
 * verificable contra el documento, las otras contra un vehículo.
 */

export interface KwpResponse {
  /** Bytes completos de la respuesta, sin header. */
  bytes: number[];
  /** true si fue respuesta positiva (SID + 0x40). */
  positive: boolean;
  /** Código de respuesta negativa, si la hubo. */
  nrc?: number;
  /** Texto del NRC, listo para mostrar. */
  nrcText?: string;
  /** Datos después del SID de respuesta. */
  data: number[];
}

export class KwpError extends Error {
  constructor(
    readonly sid: number,
    readonly nrc: number,
    readonly nrcText: string,
  ) {
    super(`KWP2000 rechazó el servicio 0x${hex(sid)}: ${nrcText}`);
    this.name = 'KwpError';
  }
}

/** Direcciones habituales de VAG sobre K-Line. */
export const VAG_ADDRESS = {
  /** Formato: 81 <destino> <origen>. F1 es la herramienta. */
  engine: '8110F1',
  abs: '8103F1',
  airbag: '8115F1',
  instruments: '8117F1',
} as const;

/** La ECU puede pedir más tiempo con NRC 0x78 antes de contestar de verdad. */
const RESPONSE_PENDING = 0x78;
const MAX_PENDING_RETRIES = 6;

export class Kwp2000Service {
  private keepAlive: ReturnType<typeof setInterval> | null = null;
  private currentHeader: string | null = null;

  constructor(private readonly driver: Elm327Driver) {}

  /** Fija el header de direccionamiento. Solo se reenvía si cambió. */
  async setAddress(header: string): Promise<void> {
    if (this.currentHeader === header) return;
    await this.driver.send(`ATSH${header}`);
    this.currentHeader = header;
  }

  /**
   * Envía una solicitud y devuelve la respuesta ya clasificada.
   *
   * Maneja el NRC 0x78 ("respuesta pendiente"), que no es un error: la ECU
   * avisa que necesita más tiempo. Tratarlo como fallo rompe justamente las
   * operaciones largas, que son las de servicio.
   */
  async request(sid: number, payload: number[] = [], timeoutMs = 3000): Promise<KwpResponse> {
    const hexReq = [sid, ...payload].map(hex).join('');

    for (let attempt = 0; attempt <= MAX_PENDING_RETRIES; attempt++) {
      const res = await this.driver.send(hexReq, { timeoutMs });
      const bytes = hexBytes(res.lines.join(''));
      const parsed = classify(sid, bytes);

      if (parsed.nrc === RESPONSE_PENDING) {
        // La ECU pidió tiempo. Se espera y se vuelve a leer.
        await delay(120);
        continue;
      }
      return parsed;
    }
    throw new ElmError('timeout', hexReq, 'La ECU siguió pidiendo tiempo sin contestar');
  }

  /** Igual que request() pero lanza si la respuesta fue negativa. */
  async requestOrThrow(sid: number, payload: number[] = [], timeoutMs = 3000): Promise<KwpResponse> {
    const res = await this.request(sid, payload, timeoutMs);
    if (!res.positive) {
      throw new KwpError(sid, res.nrc ?? 0, res.nrcText ?? 'sin detalle');
    }
    return res;
  }

  async startSession(sessionType: number): Promise<KwpResponse> {
    return this.requestOrThrow(SID.startDiagnosticSession, [sessionType], 5000);
  }

  async stopSession(): Promise<void> {
    this.stopKeepAlive();
    try {
      await this.request(SID.stopDiagnosticSession, [], 2000);
    } catch {
      // Cerrar la sesión es mejor esfuerzo: si el enlace ya cayó, da igual.
    }
  }

  /**
   * Mantiene viva la sesión extendida.
   *
   * Sin esto la ECU vuelve sola a la sesión por defecto a los pocos segundos
   * y la operación de servicio se cae a la mitad. El período tiene que ser
   * bastante menor que el timeout P3 de la ECU, típicamente 5 s.
   */
  startKeepAlive(periodMs = 1800): void {
    this.stopKeepAlive();
    this.keepAlive = setInterval(() => {
      // El subfunción 0x02 pide que la ECU no responda, para no ensuciar
      // el enlace con respuestas que a nadie le interesan.
      void this.request(SID.testerPresent, [0x02], 1500).catch(() => {
        // Un testerPresent perdido no justifica abortar: el siguiente
        // paso real de la rutina va a fallar con su propio error.
      });
    }, periodMs);
  }

  stopKeepAlive(): void {
    if (this.keepAlive !== null) clearInterval(this.keepAlive);
    this.keepAlive = null;
  }

  /** Identificación de ECU (servicio 0x1A). */
  async readEcuIdentification(identifier: number): Promise<string | null> {
    try {
      const res = await this.requestOrThrow(SID.readEcuIdentification, [identifier], 4000);
      const text = String.fromCharCode(
        ...res.data.slice(1).filter((c) => c >= 0x20 && c <= 0x7e),
      ).trim();
      return text.length > 0 ? text : null;
    } catch {
      return null;
    }
  }

  /** Lectura por identificador local (servicio 0x21). Base de los bloques VAG. */
  async readDataByLocalId(localId: number): Promise<number[] | null> {
    try {
      const res = await this.requestOrThrow(SID.readDataByLocalIdentifier, [localId], 3000);
      return res.data;
    } catch (err) {
      if (err instanceof KwpError) return null;
      throw err;
    }
  }
}

function classify(sid: number, bytes: number[]): KwpResponse {
  const neg = bytes.indexOf(SID.negativeResponse);
  if (neg !== -1 && bytes[neg + 1] === sid) {
    const nrc = bytes[neg + 2] ?? 0;
    return {
      bytes,
      positive: false,
      nrc,
      nrcText: describeNrc(nrc),
      data: [],
    };
  }
  const positiveSid = sid + 0x40;
  const at = bytes.indexOf(positiveSid);
  if (at === -1) {
    return { bytes, positive: false, nrcText: 'Respuesta sin relación con la solicitud', data: [] };
  }
  return { bytes, positive: true, data: bytes.slice(at + 1) };
}

const hex = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
