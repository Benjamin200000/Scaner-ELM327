import {
  ASCII,
  type Transport,
  type TransportInfo,
  type TransportState,
  TransportError,
} from './types';
import { Elm327Simulator, type SimOptions } from '@/sim/ecu';

/**
 * Transporte que habla con el simulador en lugar de con hardware.
 *
 * No es solo para tests: es el único modo de trabajar en la app sin un auto
 * conectado, y permite reproducir escenarios (DPF saturado, overboost, ECU
 * muda) que serían difíciles de provocar a propósito en un vehículo real.
 */
export class MockTransport implements Transport {
  readonly kind = 'mock' as const;

  readonly simulator: Elm327Simulator;
  private _state: TransportState = 'closed';
  private dataListeners = new Set<(chunk: Uint8Array) => void>();
  private closeListeners = new Set<(err: TransportError | null) => void>();
  private buffer = '';
  private clock: ReturnType<typeof setInterval> | null = null;
  private pending = new Set<ReturnType<typeof setTimeout>>();

  constructor(opts: SimOptions = {}) {
    this.simulator = new Elm327Simulator(opts);
  }

  get state(): TransportState {
    return this._state;
  }

  get info(): TransportInfo | null {
    if (this._state !== 'open') return null;
    return {
      kind: this.kind,
      name: 'Simulador ELM327',
      link: this.simulator.activeProfile.label,
    };
  }

  async open(): Promise<void> {
    if (this._state === 'open') {
      throw new TransportError('already-open', 'El simulador ya está abierto');
    }
    this._state = 'open';
    this.buffer = '';
    // 10 Hz: suficiente para que los valores evolucionen de forma visible.
    this.clock = setInterval(() => this.simulator.advance(0.1), 100);
  }

  async close(): Promise<void> {
    this._state = 'closing';
    if (this.clock !== null) clearInterval(this.clock);
    this.clock = null;
    for (const t of this.pending) clearTimeout(t);
    this.pending.clear();
    this._state = 'closed';
  }

  async write(data: Uint8Array): Promise<void> {
    if (this._state !== 'open') {
      throw new TransportError('not-open', 'El simulador no está abierto');
    }
    this.buffer += ASCII.decode(data);
    // El ELM327 procesa al recibir CR.
    for (;;) {
      const idx = this.buffer.indexOf('\r');
      if (idx === -1) break;
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      this.dispatch(line);
    }
  }

  private dispatch(line: string): void {
    const reply = this.simulator.handle(line);
    const latency = this.simulator.latency;
    const timer = setTimeout(() => {
      this.pending.delete(timer);
      if (this._state !== 'open') return;
      // Entrega partida en dos, como un enlace real: el driver no debe
      // asumir que una respuesta llega en un solo chunk.
      const bytes = ASCII.encode(reply);
      const cut = Math.max(1, Math.floor(bytes.byteLength / 2));
      this.emit(bytes.slice(0, cut));
      const second = setTimeout(() => {
        this.pending.delete(second);
        if (this._state === 'open') this.emit(bytes.slice(cut));
      }, 2);
      this.pending.add(second);
    }, latency);
    this.pending.add(timer);
  }

  private emit(chunk: Uint8Array): void {
    for (const fn of this.dataListeners) fn(chunk);
  }

  /** Corta el enlace como si se desenchufara el adaptador. */
  simulateDisconnect(): void {
    if (this._state !== 'open') return;
    this._state = 'error';
    void this.close();
    for (const fn of this.closeListeners) {
      fn(new TransportError('disconnected', 'El simulador cortó el enlace'));
    }
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
