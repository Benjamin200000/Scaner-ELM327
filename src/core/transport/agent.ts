import {
  type Transport,
  type TransportInfo,
  type TransportState,
  TransportError,
} from './types';

/**
 * Transporte contra el agente local.
 *
 * El agente corre en la notebook y expone por WebSocket lo que el navegador
 * no puede tocar: ELM327 Bluetooth Classic, cable K-Line y
 * J2534. Desde acá arriba es un transporte como cualquier otro, así que el
 * driver del ELM327 y todo lo que está encima no cambian en nada.
 *
 * Efecto secundario que vale la pena: como el enlace es de red, la app puede
 * correr en una tablet y usar el adaptador enchufado a la notebook.
 */

export interface AgentInterface {
  id: string;
  kind: string;
  label: string;
  detail: string;
}

export interface AgentOptions {
  /** ws://127.0.0.1:8777 o la IP de la notebook en la red del taller. */
  url: string;
  token: string;
  /** Interfaz a abrir. Si falta, open() falla pidiendo que se elija una. */
  interfaceId?: string;
  baudRate?: number;
  /** Plazo para que el agente conteste el saludo. */
  handshakeMs?: number;
}

type Incoming =
  | { t: 'hello-ok'; agent: { version: string; platform: string }; features: Record<string, boolean> }
  | { t: 'interfaces'; items: AgentInterface[] }
  | { t: 'opened'; info: { kind: string; name: string; link: string } }
  | { t: 'data'; data: string }
  | { t: 'closed'; reason?: string }
  | { t: 'error'; code: string; message: string; detail?: string }
  | { t: 'pong' };

export class AgentTransport implements Transport {
  readonly kind = 'websocket' as const;

  private ws: WebSocket | null = null;
  private _state: TransportState = 'closed';
  private _info: TransportInfo | null = null;
  private dataListeners = new Set<(chunk: Uint8Array) => void>();
  private closeListeners = new Set<(err: TransportError | null) => void>();
  private pending = new Map<string, { resolve: (v: Incoming) => void; reject: (e: unknown) => void }>();
  private intentionalClose = false;
  private keepAlive: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly options: AgentOptions) {}

  get state(): TransportState {
    return this._state;
  }

  get info(): TransportInfo | null {
    return this._info;
  }

  /**
   * Conecta y autentica sin abrir ninguna interfaz todavía.
   *
   * Separado de open() porque hay que enumerar antes de poder elegir: el
   * usuario no sabe de antemano en qué COM quedó su adaptador Bluetooth.
   */
  async connect(): Promise<{ interfaces: AgentInterface[]; features: Record<string, boolean> }> {
    const ws = await this.dial();
    this.ws = ws;

    const hello = await this.exchange(
      { t: 'hello', token: this.options.token, client: 'scaner-elm327-web' },
      'hello-ok',
      this.options.handshakeMs ?? 5000,
    );
    const features = hello.t === 'hello-ok' ? hello.features : {};

    const list = await this.exchange({ t: 'list' }, 'interfaces', 5000);
    const interfaces = list.t === 'interfaces' ? list.items : [];

    // El agente cierra la conexión si queda ociosa detrás de un router.
    this.keepAlive = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: 'ping' }));
    }, 20000);

    return { interfaces, features };
  }

  async open(): Promise<void> {
    if (this._state === 'open') {
      throw new TransportError('already-open', 'El enlace con el agente ya está abierto');
    }
    this._state = 'opening';
    this.intentionalClose = false;

    try {
      if (this.ws === null || this.ws.readyState !== this.ws.OPEN) {
        await this.connect();
      }
      const id = this.options.interfaceId;
      if (id === undefined) {
        throw new TransportError('open-failed', 'Hay que elegir una interfaz del agente');
      }
      const opened = await this.exchange(
        { t: 'open', id, options: { baudRate: this.options.baudRate ?? 38400 } },
        'opened',
        15000,
      );
      if (opened.t !== 'opened') throw new TransportError('open-failed', 'Respuesta inesperada del agente');
      this._info = {
        kind: this.kind,
        name: opened.info.name,
        link: `agente · ${opened.info.link}`,
      };
      this._state = 'open';
    } catch (err) {
      this._state = 'error';
      await this.teardown();
      throw err instanceof TransportError ? err : wrap(err);
    }
  }

  private dial(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.options.url);
      } catch (err) {
        reject(new TransportError('open-failed',
          'La dirección del agente no es válida', messageOf(err)));
        return;
      }
      ws.binaryType = 'arraybuffer';

      const timer = setTimeout(() => {
        ws.close();
        reject(new TransportError('open-failed',
          'El agente no respondió',
          `No se pudo conectar a ${this.options.url}. Verificá que esté corriendo ` +
          'y que el puerto coincida. Desde otro equipo, el agente tiene que haber ' +
          'arrancado con --lan.'));
      }, this.options.handshakeMs ?? 5000);

      ws.onopen = () => {
        clearTimeout(timer);
        resolve(ws);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new TransportError('open-failed',
          'No se pudo conectar con el agente',
          `Falló la conexión a ${this.options.url}.`));
      };
      ws.onclose = (ev) => {
        clearTimeout(timer);
        this.handleSocketClose(ev.code, ev.reason);
      };
      ws.onmessage = (ev) => this.handleMessage(ev);
    });
  }

  private handleMessage(ev: MessageEvent): void {
    let msg: Incoming;
    try {
      msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '') as Incoming;
    } catch {
      return; // un frame ilegible no debe tumbar la sesión
    }

    if (msg.t === 'data') {
      const bytes = base64ToBytes(msg.data);
      for (const fn of this.dataListeners) fn(bytes);
      return;
    }
    if (msg.t === 'closed') {
      if (this._state === 'open' && !this.intentionalClose) {
        this._state = 'error';
        const reason = msg.reason ?? 'El agente cerró la interfaz';
        for (const fn of this.closeListeners) {
          fn(new TransportError('disconnected', reason));
        }
      }
      this.settle('closed', msg);
      return;
    }
    if (msg.t === 'error') {
      this.rejectAll(new TransportError(
        msg.code === 'token-invalido' ? 'not-supported' : 'open-failed',
        msg.message,
        msg.detail,
      ));
      return;
    }
    this.settle(msg.t, msg);
  }

  private settle(type: string, msg: Incoming): void {
    const waiter = this.pending.get(type);
    if (waiter) {
      this.pending.delete(type);
      waiter.resolve(msg);
    }
  }

  private rejectAll(err: unknown): void {
    for (const [, w] of this.pending) w.reject(err);
    this.pending.clear();
  }

  private exchange(send: object, expect: string, timeoutMs: number): Promise<Incoming> {
    const ws = this.ws;
    if (ws === null) {
      return Promise.reject(new TransportError('not-open', 'No hay conexión con el agente'));
    }
    return new Promise<Incoming>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(expect);
        reject(new TransportError('open-failed',
          `El agente no respondió a ${(send as { t: string }).t}`));
      }, timeoutMs);
      this.pending.set(expect, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      ws.send(JSON.stringify(send));
    });
  }

  async write(data: Uint8Array): Promise<void> {
    const ws = this.ws;
    if (this._state !== 'open' || ws === null || ws.readyState !== ws.OPEN) {
      throw new TransportError('not-open', 'El enlace con el agente no está abierto');
    }
    try {
      ws.send(JSON.stringify({ t: 'write', data: bytesToBase64(data) }));
    } catch (err) {
      throw new TransportError('write-failed',
        'No se pudo enviar el comando al agente', messageOf(err));
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
    if (this.keepAlive !== null) clearInterval(this.keepAlive);
    this.keepAlive = null;
    const ws = this.ws;
    this.ws = null;
    this.rejectAll(new TransportError('disconnected', 'Se cerró el enlace con el agente'));
    if (ws !== null && ws.readyState === ws.OPEN) {
      try {
        ws.send(JSON.stringify({ t: 'close' }));
      } catch { /* el socket ya pudo caerse */ }
      ws.close();
    }
  }

  private handleSocketClose(code: number, reason: string): void {
    if (this.intentionalClose || this._state === 'closed') return;
    this._state = 'error';
    const err = new TransportError(
      code === 4001 ? 'not-supported' : 'disconnected',
      code === 4001
        ? 'El agente rechazó el token'
        : 'Se perdió la conexión con el agente',
      reason || undefined,
    );
    this.rejectAll(err);
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

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

const wrap = (err: unknown): TransportError =>
  new TransportError('open-failed', 'Falló el enlace con el agente', messageOf(err));
