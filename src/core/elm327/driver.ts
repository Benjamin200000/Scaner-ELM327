import { ASCII, type Transport, TransportError } from '@/core/transport/types';
import { ElmError } from './errors';
import { parseResponse, type ParsedResponse } from './parse';
import {
  type ElmProtocol,
  parseProtocolNumber,
  protocolById,
} from './protocols';

/**
 * Driver del ELM327.
 *
 * Un ELM327 atiende un comando a la vez: si se le escribe mientras está
 * respondiendo, se pierden datos. Por eso todo pasa por una cola serializada,
 * y el framing es por prompt ('>'), no por tiempo.
 */

export interface DriverOptions {
  /** Plazo por defecto para un comando, en ms. */
  timeoutMs?: number;
  /** Plazo para comandos que inicializan el bus (ATSP, primer 0100). */
  initTimeoutMs?: number;
}

export interface CommandOptions {
  timeoutMs?: number;
  /** Si true, 'NO DATA' se devuelve como respuesta en lugar de lanzar. */
  tolerateNoData?: boolean;
}

export interface TraceEntry {
  at: number;
  direction: 'tx' | 'rx' | 'error';
  text: string;
  /** ms transcurridos entre el envío y la respuesta. */
  elapsedMs?: number;
}

export interface AdapterIdentity {
  /** Lo que devuelve ATI, p. ej. 'ELM327 v1.5'. */
  version: string;
  /** Muchos clones mienten; se marca cuando la versión es sospechosa. */
  likelyClone: boolean;
}

interface QueueItem {
  command: string;
  options: CommandOptions;
  resolve: (r: ParsedResponse) => void;
  reject: (e: unknown) => void;
}

const PROMPT = '>';

export class Elm327Driver {
  private readonly timeoutMs: number;
  private readonly initTimeoutMs: number;
  private buffer = '';
  private queue: QueueItem[] = [];
  private active: QueueItem | null = null;
  private activeTimer: ReturnType<typeof setTimeout> | null = null;
  private activeStartedAt = 0;
  private unsubData: (() => void) | null = null;
  private unsubClose: (() => void) | null = null;
  private trace: TraceEntry[] = [];
  private traceLimit = 500;
  private traceListeners = new Set<(e: TraceEntry) => void>();
  private _protocol: ElmProtocol | null = null;
  private _identity: AdapterIdentity | null = null;

  constructor(
    private readonly transport: Transport,
    opts: DriverOptions = {},
  ) {
    this.timeoutMs = opts.timeoutMs ?? 2000;
    this.initTimeoutMs = opts.initTimeoutMs ?? 12000;
  }

  get protocol(): ElmProtocol | null {
    return this._protocol;
  }

  get identity(): AdapterIdentity | null {
    return this._identity;
  }

  attach(): void {
    this.unsubData = this.transport.onData((chunk) => this.ingest(chunk));
    this.unsubClose = this.transport.onClose((err) => this.abortAll(err));
  }

  detach(): void {
    this.unsubData?.();
    this.unsubClose?.();
    this.unsubData = null;
    this.unsubClose = null;
    this.abortAll(null);
  }

  /** Secuencia de inicialización. Devuelve el protocolo que quedó activo. */
  async initialize(forcedProtocol?: string): Promise<ElmProtocol | null> {
    await this.send('ATZ', { timeoutMs: 5000 });
    // ATZ reinicia los flags; hay que volver a dejar el chip como queremos.
    await this.send('ATE0');  // sin eco
    await this.send('ATL0');  // sin linefeed
    await this.send('ATS0');  // sin espacios: menos bytes por el enlace
    await this.send('ATH1');  // con headers: hacen falta para saber qué ECU contestó
    await this.send('ATAT1'); // timing adaptativo
    await this.send('ATST64'); // ~400 ms de tope por solicitud

    const ati = await this.send('ATI', { timeoutMs: 3000 });
    const version = ati.lines[0] ?? 'desconocido';
    this._identity = { version, likelyClone: isLikelyClone(version) };

    await this.send(`ATSP${forcedProtocol ?? '0'}`);

    // El protocolo recién queda fijo cuando una solicitud real recorre el bus.
    try {
      await this.send('0100', { timeoutMs: this.initTimeoutMs });
    } catch (err) {
      if (err instanceof ElmError && err.code === 'no-data') {
        // El bus respondió pero la ECU no soporta el modo 01. Raro pero posible.
      } else {
        throw err;
      }
    }

    const dpn = await this.send('ATDPN', { timeoutMs: 3000 });
    const { protocol } = parseProtocolNumber(dpn.lines[0] ?? '');
    this._protocol = protocol ?? (forcedProtocol ? protocolById(forcedProtocol) : null);
    return this._protocol;
  }

  /** Tensión de batería medida por el adaptador en el pin 16. */
  async readVoltage(): Promise<number | null> {
    try {
      const res = await this.send('ATRV', { timeoutMs: 3000 });
      const m = /(\d+(?:\.\d+)?)\s*V?/i.exec(res.lines.join(' '));
      if (!m?.[1]) return null;
      const v = Number(m[1]);
      return Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  }

  send(command: string, options: CommandOptions = {}): Promise<ParsedResponse> {
    return new Promise<ParsedResponse>((resolve, reject) => {
      this.queue.push({ command, options, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    if (this.active !== null) return;
    const next = this.queue.shift();
    if (!next) return;
    this.active = next;
    this.buffer = '';
    this.activeStartedAt = Date.now();

    const timeout = next.options.timeoutMs ?? this.timeoutMs;
    this.activeTimer = setTimeout(() => {
      this.finishActive(
        new ElmError(
          this.buffer.length === 0 ? 'no-adapter-response' : 'timeout',
          next.command,
          this.buffer,
        ),
      );
    }, timeout);

    this.pushTrace({ at: this.activeStartedAt, direction: 'tx', text: next.command });

    this.transport
      .write(ASCII.encode(next.command + '\r'))
      .catch((err: unknown) => {
        const msg = err instanceof TransportError ? err.message : String(err);
        this.finishActive(new ElmError('no-adapter-response', next.command, msg));
      });
  }

  private ingest(chunk: Uint8Array): void {
    if (this.active === null) return; // datos no solicitados: se descartan
    this.buffer += ASCII.decode(chunk);
    if (!this.buffer.includes(PROMPT)) return;

    const raw = this.buffer;
    const parsed = parseResponse(raw, this.active.command);
    const elapsedMs = Date.now() - this.activeStartedAt;
    this.pushTrace({
      at: Date.now(),
      direction: parsed.error ? 'error' : 'rx',
      text: parsed.lines.join(' | ') || raw.trim(),
      elapsedMs,
    });

    if (parsed.error) {
      if (parsed.error === 'no-data' && this.active.options.tolerateNoData) {
        this.finishActive(null, parsed);
        return;
      }
      this.finishActive(new ElmError(parsed.error, this.active.command, raw));
      return;
    }
    this.finishActive(null, parsed);
  }

  private finishActive(error: unknown, value?: ParsedResponse): void {
    const item = this.active;
    if (!item) return;
    if (this.activeTimer !== null) clearTimeout(this.activeTimer);
    this.activeTimer = null;
    this.active = null;
    this.buffer = '';
    if (error) item.reject(error);
    else item.resolve(value ?? { lines: [], raw: '' });
    // Sin await: el siguiente comando arranca en el próximo tick.
    queueMicrotask(() => this.pump());
  }

  private abortAll(err: TransportError | null): void {
    const reason =
      err ?? new TransportError('disconnected', 'Se cerró el enlace con el adaptador');
    const pending = [...this.queue];
    this.queue = [];
    if (this.active) {
      if (this.activeTimer !== null) clearTimeout(this.activeTimer);
      this.activeTimer = null;
      this.active.reject(reason);
      this.active = null;
    }
    for (const item of pending) item.reject(reason);
  }

  private pushTrace(entry: TraceEntry): void {
    this.trace.push(entry);
    if (this.trace.length > this.traceLimit) {
      this.trace.splice(0, this.trace.length - this.traceLimit);
    }
    for (const fn of this.traceListeners) fn(entry);
  }

  getTrace(): readonly TraceEntry[] {
    return this.trace;
  }

  clearTrace(): void {
    this.trace = [];
  }

  onTrace(listener: (e: TraceEntry) => void): () => void {
    this.traceListeners.add(listener);
    return () => this.traceListeners.delete(listener);
  }
}

/**
 * Los clones basados en microcontroladores baratos reportan 'v2.1' o 'v2.2',
 * versiones que nunca existieron en el chip original de ELM Electronics.
 * Suelen no soportar comandos avanzados, así que conviene advertirlo.
 */
export function isLikelyClone(version: string): boolean {
  return /v2\.[12]/i.test(version);
}
