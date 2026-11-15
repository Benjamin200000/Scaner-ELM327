import {
  type Transport,
  type TransportInfo,
  type TransportState,
  TransportError,
} from './types';

export interface WebSerialOptions {
  /** 38400 es el default de fábrica del ELM327; muchos clones vienen a 9600 o 115200. */
  baudRate: number;
}

type SerialLike = {
  requestPort(options?: { filters?: unknown[] }): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
};

type SerialPortLike = {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo?(): { usbVendorId?: number; usbProductId?: number };
};

/** Nombres conocidos de los puentes USB-serie que traen los ELM327 USB. */
const USB_BRIDGES: Record<string, string> = {
  '1a86:7523': 'CH340',
  '1a86:5523': 'CH341',
  '0403:6001': 'FTDI FT232R',
  '10c4:ea60': 'Silicon Labs CP2102',
  '067b:2303': 'Prolific PL2303',
};

/**
 * ELM327 por USB (o cualquier puerto serie) vía Web Serial.
 *
 * Disponible en Chrome/Edge de escritorio. NO existe en Safari, Firefox,
 * ni en Chrome para Android o iOS: ahí este transporte se reporta como
 * no disponible en lugar de fallar al abrir.
 */
export class WebSerialTransport implements Transport {
  readonly kind = 'webserial' as const;

  private _state: TransportState = 'closed';
  private _info: TransportInfo | null = null;
  private port: SerialPortLike | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private dataListeners = new Set<(chunk: Uint8Array) => void>();
  private closeListeners = new Set<(err: TransportError | null) => void>();
  private intentionalClose = false;

  constructor(private readonly options: WebSerialOptions = { baudRate: 38400 }) {}

  get state(): TransportState {
    return this._state;
  }

  get info(): TransportInfo | null {
    return this._info;
  }

  static get serial(): SerialLike | null {
    const nav = navigator as unknown as { serial?: SerialLike };
    return nav.serial ?? null;
  }

  async open(): Promise<void> {
    if (this._state === 'open' || this._state === 'opening') {
      throw new TransportError('already-open', 'El puerto serie ya está abierto');
    }
    const serial = WebSerialTransport.serial;
    if (!serial) {
      throw new TransportError(
        'not-supported',
        'Este navegador no expone Web Serial',
        'navigator.serial no existe. Requiere Chrome o Edge de escritorio.',
      );
    }

    this._state = 'opening';
    this.intentionalClose = false;
    try {
      const port = await serial.requestPort({});
      await port.open({ baudRate: this.options.baudRate });
      this.port = port;

      if (!port.writable || !port.readable) {
        throw new TransportError('open-failed', 'El puerto se abrió sin flujos de datos');
      }
      this.writer = port.writable.getWriter();
      this.reader = port.readable.getReader();

      this._info = {
        kind: this.kind,
        name: describePort(port),
        link: `${this.options.baudRate} baud`,
      };
      this._state = 'open';
      void this.readLoop();
    } catch (err) {
      this._state = 'error';
      await this.teardown();
      throw wrapOpenError(err);
    }
  }

  private async readLoop(): Promise<void> {
    const reader = this.reader;
    if (!reader) return;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value && value.byteLength > 0) this.emitData(value);
      }
      this.handleUnexpectedClose(null);
    } catch (err) {
      if (this.intentionalClose) return;
      this.handleUnexpectedClose(
        new TransportError(
          'read-failed',
          'Se interrumpió la lectura del puerto serie',
          messageOf(err),
        ),
      );
    }
  }

  async write(data: Uint8Array): Promise<void> {
    if (this._state !== 'open' || !this.writer) {
      throw new TransportError('not-open', 'El puerto serie no está abierto');
    }
    try {
      await this.writer.write(data);
    } catch (err) {
      throw new TransportError(
        'write-failed',
        'No se pudo escribir en el puerto serie',
        messageOf(err),
      );
    }
  }

  async close(): Promise<void> {
    this.intentionalClose = true;
    this._state = 'closing';
    await this.teardown();
    this._state = 'closed';
    this._info = null;
  }

  private async teardown(): Promise<void> {
    try {
      await this.reader?.cancel();
    } catch { /* el puerto ya pudo desaparecer */ }
    try {
      this.reader?.releaseLock();
    } catch { /* ya liberado */ }
    try {
      this.writer?.releaseLock();
    } catch { /* ya liberado */ }
    try {
      await this.port?.close();
    } catch { /* ya cerrado */ }
    this.reader = null;
    this.writer = null;
    this.port = null;
  }

  private emitData(chunk: Uint8Array): void {
    for (const fn of this.dataListeners) fn(chunk);
  }

  private handleUnexpectedClose(err: TransportError | null): void {
    if (this._state === 'closed' || this._state === 'closing') return;
    this._state = err ? 'error' : 'closed';
    void this.teardown();
    for (const fn of this.closeListeners) fn(err);
  }

  onData(listener: (chunk: Uint8Array) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onClose(listener: (err: TransportError | null) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }
}

function describePort(port: SerialPortLike): string {
  const info = port.getInfo?.();
  if (!info?.usbVendorId || !info.usbProductId) return 'Puerto serie';
  const id = `${hex4(info.usbVendorId)}:${hex4(info.usbProductId)}`;
  const bridge = USB_BRIDGES[id];
  return bridge ? `ELM327 USB (${bridge})` : `Puerto serie ${id}`;
}

const hex4 = (n: number): string => n.toString(16).padStart(4, '0');

function wrapOpenError(err: unknown): TransportError {
  if (err instanceof TransportError) return err;
  const msg = messageOf(err);
  const name = (err as { name?: string } | null)?.name;
  if (name === 'NotFoundError') {
    return new TransportError(
      'cancelled-by-user',
      'No se seleccionó ningún puerto',
      msg,
    );
  }
  if (name === 'SecurityError') {
    return new TransportError(
      'not-supported',
      'El navegador bloqueó el acceso al puerto serie',
      'Web Serial exige HTTPS o localhost y un gesto del usuario.',
    );
  }
  if (name === 'InvalidStateError' || name === 'NetworkError') {
    return new TransportError(
      'open-failed',
      'El puerto está ocupado por otro programa',
      msg,
    );
  }
  return new TransportError('open-failed', 'No se pudo abrir el puerto serie', msg);
}

const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
