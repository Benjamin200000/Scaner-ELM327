import type { KLineLink } from './engine';

/**
 * Enlace K-Line que corre sobre el agente local.
 *
 * El agente hace la parte sensible al tiempo (init de 5 baudios y handshake
 * byte a byte, que no pueden cruzar la red). Esta clase manda las operaciones
 * de alto nivel —conectar, enviar bloque, recibir bloque— por WebSocket. El
 * motor KW1281 corre en la app, sobre esta capa.
 *
 * Abre su propia conexión al agente, separada del transporte ELM327, porque
 * KW1281 no es un flujo de bytes sino un intercambio de bloques.
 */
export interface AgentLinkOpciones {
  url: string;
  token: string;
  /** Interfaz serie del agente (el cable KKL), p. ej. 'serial:/dev/ttyUSB0'. */
  interfaceId: string;
  baud?: number;
}

type Entrante = { t: string; op?: string; [k: string]: unknown };

export class KLineLinkAgente implements KLineLink {
  private ws: WebSocket | null = null;
  private pendientes = new Map<string, { resolver: (m: Entrante) => void; rechazar: (e: unknown) => void }>();

  constructor(private readonly opc: AgentLinkOpciones) {}

  async conectar(direccion: number): Promise<{ version: number; keywords: number[] }> {
    await this.abrirSocket();
    await this.pedir('open', { op: 'open', id: this.opc.interfaceId, baud: this.opc.baud ?? 10400 });
    const r = await this.pedir('init', { op: 'init', address: direccion });
    return { version: Number(r.version), keywords: (r.keywords as number[]) ?? [] };
  }

  async enviarBloque(bytes: number[]): Promise<void> {
    await this.pedir('send', { op: 'send', bytes });
  }

  async recibirBloque(timeoutMs: number): Promise<number[]> {
    const r = await this.pedir('recv', { op: 'recv', timeout: timeoutMs });
    return (r.bytes as number[]) ?? [];
  }

  async cerrar(): Promise<void> {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) await this.pedir('close', { op: 'close' });
    } catch {
      // el enlace ya pudo caer
    }
    this.ws?.close();
    this.ws = null;
  }

  private abrirSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.opc.url);
      const timer = setTimeout(() => { ws.close(); reject(new Error('El agente no respondió')); }, 5000);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', token: this.opc.token, client: 'kline' }));
      ws.onmessage = (ev) => {
        let msg: Entrante;
        try { msg = JSON.parse(String(ev.data)) as Entrante; } catch { return; }
        if (msg.t === 'hello-ok') { clearTimeout(timer); this.ws = ws; resolve(); return; }
        if (msg.t === 'error') {
          const clave = this.claveAbierta();
          if (clave) this.pendientes.get(clave)?.rechazar(new Error(String(msg.message)));
          return;
        }
        if (msg.t === 'kline' && msg.op) {
          this.pendientes.get(`kline:${msg.op}`)?.resolver(msg);
        }
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error('No se pudo conectar con el agente')); };
      ws.onclose = () => { for (const p of this.pendientes.values()) p.rechazar(new Error('Enlace con el agente cerrado')); };
    });
  }

  private claveAbierta(): string | null {
    return [...this.pendientes.keys()][0] ?? null;
  }

  private pedir(op: string, cuerpo: object): Promise<Entrante> {
    const ws = this.ws;
    if (!ws) return Promise.reject(new Error('Enlace con el agente no abierto'));
    return new Promise((resolver, rechazar) => {
      const clave = `kline:${op}`;
      const timer = setTimeout(() => { this.pendientes.delete(clave); rechazar(new Error(`El agente no respondió a ${op}`)); }, 12000);
      this.pendientes.set(clave, {
        resolver: (m) => { clearTimeout(timer); this.pendientes.delete(clave); resolver(m); },
        rechazar: (e) => { clearTimeout(timer); this.pendientes.delete(clave); rechazar(e); },
      });
      ws.send(JSON.stringify({ t: 'kline', ...cuerpo }));
    });
  }
}
