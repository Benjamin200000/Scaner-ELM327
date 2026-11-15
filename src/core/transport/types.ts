/**
 * Capa de transporte: mueve bytes hacia y desde la interfaz de diagnóstico.
 * No sabe nada de ELM327, OBD-II ni KWP2000. Esa separación es la que permite
 * agregar J2534, WebUSB o un agente local sin tocar nada por encima.
 */

export type TransportKind = 'webserial' | 'webbluetooth' | 'mock' | 'websocket';

export type TransportState = 'closed' | 'opening' | 'open' | 'closing' | 'error';

/** Motivo por el que un transporte no está disponible en este dispositivo. */
export type UnavailableReason =
  | 'unsupported-browser'
  | 'insecure-context'
  | 'no-permission'
  | 'not-implemented';

export interface TransportAvailability {
  kind: TransportKind;
  label: string;
  available: boolean;
  reason?: UnavailableReason | undefined;
  /** Texto para el usuario. Nunca "error desconocido". */
  detail?: string | undefined;
}

export interface TransportInfo {
  kind: TransportKind;
  /** Nombre que expone el dispositivo, si lo hay. */
  name?: string;
  /** Detalle del enlace: baud rate, UUID de servicio GATT, etc. */
  link?: string;
}

/**
 * Un transporte orientado a bytes. El ELM327 habla ASCII terminado en '>',
 * pero el transporte no lo interpreta: entrega los chunks tal como llegan.
 */
export interface Transport {
  readonly kind: TransportKind;
  readonly state: TransportState;
  readonly info: TransportInfo | null;

  /** Abre el enlace. Puede disparar un selector de dispositivo del navegador. */
  open(): Promise<void>;
  close(): Promise<void>;
  write(data: Uint8Array): Promise<void>;

  /** Se llama con cada chunk recibido. Devuelve una función para desuscribirse. */
  onData(listener: (chunk: Uint8Array) => void): () => void;
  /** Pérdida de enlace no solicitada (adaptador desenchufado, BT fuera de rango). */
  onClose(listener: (err: TransportError | null) => void): () => void;
}

export type TransportErrorCode =
  | 'not-supported'
  | 'cancelled-by-user'
  | 'open-failed'
  | 'write-failed'
  | 'read-failed'
  | 'disconnected'
  | 'already-open'
  | 'not-open';

/**
 * Error de transporte con código estable. La UI traduce el código a texto;
 * el `detail` lleva lo que dijo el navegador, para el modo debug.
 */
export class TransportError extends Error {
  readonly code: TransportErrorCode;
  readonly detail?: string;

  constructor(code: TransportErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

export const ASCII = {
  encode: (s: string): Uint8Array => new TextEncoder().encode(s),
  decode: (b: Uint8Array): string => new TextDecoder().decode(b),
};
