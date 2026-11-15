import { Elm327Driver, type AdapterIdentity, type TraceEntry } from '@/core/elm327/driver';
import { ElmError } from '@/core/elm327/errors';
import type { ElmProtocol } from '@/core/elm327/protocols';
import { Obd2Service, type EcuIdentity, type VehicleIdentity } from '@/core/obd2/service';
import { decodificarVin, type VinInfo } from '@/knowledge/vin';
import type { Dtc } from '@/core/obd2/dtc';
import { PID_DEFS } from '@/core/obd2/pids';
import { availableParams } from '@/core/engine/systems';
import type { Readiness } from '@/core/obd2/readiness';
import {
  type CapabilityVerdict,
  evaluateCapabilities,
} from '@/core/capabilities';
import type { Transport } from '@/core/transport/types';

/**
 * Orquesta una sesión de diagnóstico: conectar, identificar, sondear.
 *
 * Mantiene deliberadamente fuera a React. Toda la lógica de comunicación vive
 * acá para que la interfaz pueda cambiar por completo sin tocarla, y para que
 * se pueda probar sin montar un DOM.
 */

export interface SessionInfo {
  protocol: ElmProtocol | null;
  adapter: AdapterIdentity | null;
  voltage: number | null;
  identity: VehicleIdentity;
  supportedPids: Set<number>;
  availableParams: Set<string>;
  capabilities: CapabilityVerdict[];
  /** Combustible según el PID 0x51, si la ECU lo expone. */
  fuel: 'gasolina' | 'diesel' | null;
  /** La ECU acepta pedir varios PID en una sola solicitud. */
  agrupacion: boolean;
  /** Estado de los monitores de emisiones al conectar. */
  readiness: Readiness | null;
  /** Unidades que contestan en el bus, con su identificación. */
  ecus: EcuIdentity[];
  /** Fabricante, país y año modelo deducidos del VIN. */
  vinInfo: VinInfo | null;
}

export interface PollResult {
  values: Map<string, number | null>;
  /** PID que fallaron en esta vuelta, con su motivo. */
  failures: Map<number, string>;
  at: number;
}

export type SessionPhase =
  | 'desconectado'
  | 'abriendo-enlace'
  | 'inicializando'
  | 'identificando'
  | 'listo'
  | 'error';

export interface SessionProgress {
  phase: SessionPhase;
  /** Texto para la pantalla de conexión. */
  detail: string;
}

export class DiagnosticSession {
  readonly driver: Elm327Driver;
  readonly obd: Obd2Service;

  private _info: SessionInfo | null = null;
  private pollOrder: number[] = [];
  private pollCursor = 0;
  /** PID que fallaron repetidamente: se dejan de pedir para no frenar el ciclo. */
  private deadPids = new Map<number, number>();

  constructor(
    readonly transport: Transport,
    private readonly onProgress: (p: SessionProgress) => void = () => {},
  ) {
    this.driver = new Elm327Driver(transport);
    this.obd = new Obd2Service(this.driver);
  }

  get info(): SessionInfo | null {
    return this._info;
  }

  /**
   * Abre el enlace y deja la sesión lista.
   *
   * El orden importa: sin protocolo resuelto no tiene sentido descubrir PID,
   * y sin PID descubiertos la interfaz no sabe qué secciones mostrar.
   */
  async connect(forcedProtocol?: string, declaredMake?: string): Promise<SessionInfo> {
    this.report('abriendo-enlace', 'Abriendo el enlace con el adaptador');
    await this.transport.open();
    this.driver.attach();

    this.report('inicializando', 'Reiniciando el adaptador y detectando el protocolo del vehículo');
    const protocol = await this.driver.initialize(forcedProtocol);
    this.report('inicializando',
      `Adaptador ${this.driver.identity?.version ?? 'sin identificar'} · ` +
      `protocolo ${protocol?.name ?? 'sin resolver'}`);

    this.report('identificando', 'Midiendo la tensión de batería');
    const voltage = await this.driver.readVoltage();

    this.report('identificando', 'Preguntando qué parámetros soporta la ECU');
    const supportedPids = await this.obd.discoverSupportedPids();
    this.report('identificando',
      `${supportedPids.size} parámetros soportados · ` +
      `${this.obd.ecusVistas.size} ${this.obd.ecusVistas.size === 1 ? 'unidad contesta' : 'unidades contestan'}`);

    this.report('identificando', 'Leyendo el VIN');
    const vin = await this.obd.readVin().catch(() => null);
    this.report('identificando', 'Leyendo calibración y nombre de cada unidad');
    const ecus: EcuIdentity[] = await this.obd.readEcuIdentities().catch(() => []);
    // Una unidad puede contestar datos sin exponer identificación: figura igual.
    for (const ecu of this.obd.ecusVistas) {
      if (ecu !== '?' && !ecus.some((e) => e.ecu === ecu)) {
        ecus.push({ ecu, calIds: [], cvns: [], name: null });
      }
    }
    ecus.sort((a, b) => parseInt(a.ecu, 16) - parseInt(b.ecu, 16));
    const identity = {
      vin,
      calibrationId: ecus[0]?.calIds[0] ?? null,
      ecuName: ecus[0]?.name ?? null,
    };

    this.report('identificando', 'Leyendo el estado de los monitores de emisiones');
    const readiness = await this.obd.readReadiness().catch(() => null);
    // Si la ECU no declara el combustible, el tipo de encendido que informan
    // los monitores lo resuelve: compresión es diésel.
    const fuel = await this.readFuelType(supportedPids)
      ?? (readiness?.tipoEncendido === 'compresion' ? 'diesel' as const : null);

    // Se prueba una sola vez, al conectar: si la ECU acepta solicitudes
    // agrupadas, el ciclo de datos en vivo se vuelve varias veces más
    // rápido. Si no, se sigue de a uno sin que nada más cambie.
    this.report('identificando', 'Probando si la ECU acepta lecturas agrupadas');
    const candidatos = [0x0c, 0x0d, 0x04].filter((p) => supportedPids.has(p));
    const agrupacion = await this.obd.probarAgrupacion(candidatos).catch(() => false);

    const info: SessionInfo = {
      protocol,
      adapter: this.driver.identity,
      voltage,
      identity,
      supportedPids,
      availableParams: availableParams(supportedPids),
      capabilities: evaluateCapabilities({
        protocol,
        adapter: this.driver.identity,
        ...(declaredMake !== undefined ? { make: declaredMake } : {}),
      }),
      fuel,
      agrupacion,
      readiness,
      ecus,
      vinInfo: vin !== null ? decodificarVin(vin) : null,
    };
    this._info = info;
    this.planPolling(supportedPids);
    this.report('listo', agrupacion
      ? 'Comunicación activa, con lecturas agrupadas'
      : 'Comunicación activa');
    return info;
  }

  private async readFuelType(supported: Set<number>): Promise<'gasolina' | 'diesel' | null> {
    if (!supported.has(0x51)) return null;
    try {
      const reading = await this.obd.readPid(0x51);
      const code = reading?.values.get('fuel_type');
      if (code === null || code === undefined) return null;
      // 4 = diésel, 19 = híbrido diésel. El resto se trata como gasolina.
      if (code === 4 || code === 19) return 'diesel';
      if (code === 0) return null;
      return 'gasolina';
    } catch {
      return null;
    }
  }

  /**
   * Arma el orden de sondeo.
   *
   * Un ELM327 sobre K-Line hace unas 8-12 solicitudes por segundo, así que no
   * se puede pedir todo en cada vuelta. Los parámetros que cambian rápido se
   * piden en cada ciclo; los lentos, de a uno por vuelta.
   */
  private planPolling(supported: Set<number>): void {
    const FAST = [0x0c, 0x0d, 0x04, 0x0b, 0x10, 0x11, 0x06];
    const fast = FAST.filter((p) => supported.has(p));
    const slow = PID_DEFS.map((d) => d.pid)
      .filter((p) => supported.has(p) && !fast.includes(p));
    this.pollOrder = [...fast, ...slow];
    this.pollCursor = 0;
    this.deadPids.clear();
  }

  /**
   * Una vuelta de sondeo.
   *
   * Devuelve los PID rápidos siempre, más una porción de los lentos. Los que
   * fallan tres veces se descartan: insistir sobre un PID que la ECU no
   * contesta arruina la frecuencia de refresco de todo lo demás.
   */
  async poll(slowPerCycle = 3): Promise<PollResult> {
    const info = this._info;
    if (!info) throw new Error('La sesión no está conectada');

    const values = new Map<string, number | null>();
    const failures = new Map<number, string>();

    const FAST_COUNT = 7;
    const fast = this.pollOrder.slice(0, FAST_COUNT);
    const slowAll = this.pollOrder.slice(FAST_COUNT);

    const slice: number[] = [];
    for (let i = 0; i < Math.min(slowPerCycle, slowAll.length); i++) {
      const pid = slowAll[(this.pollCursor + i) % slowAll.length];
      if (pid !== undefined) slice.push(pid);
    }
    if (slowAll.length > 0) {
      this.pollCursor = (this.pollCursor + slowPerCycle) % slowAll.length;
    }

    const pedidos = [...fast, ...slice].filter(
      (pid) => (this.deadPids.get(pid) ?? 0) < 3,
    );

    if (info.agrupacion) {
      // De a seis, que es el tope de la norma. Catorce parámetros pasan de
      // catorce idas y vueltas a tres.
      for (let i = 0; i < pedidos.length; i += 6) {
        const grupo = pedidos.slice(i, i + 6);
        try {
          const r = await this.obd.readPidBatch(grupo);
          for (const [pid, lectura] of r.readings) {
            for (const [k, v] of lectura.values) values.set(k, v);
            this.deadPids.delete(pid);
          }
          for (const pid of r.missing) {
            this.deadPids.set(pid, (this.deadPids.get(pid) ?? 0) + 1);
          }
        } catch (err) {
          // Un grupo que falla entero puede ser un problema de enlace, no
          // de los PID: se cuenta a cada uno, y si insisten se descartan.
          const msg = err instanceof ElmError ? err.message : String(err);
          for (const pid of grupo) {
            failures.set(pid, msg);
            this.deadPids.set(pid, (this.deadPids.get(pid) ?? 0) + 1);
          }
        }
      }
      return { values, failures, at: Date.now() };
    }

    for (const pid of pedidos) {
      try {
        const reading = await this.obd.readPid(pid);
        if (reading) {
          for (const [k, v] of reading.values) values.set(k, v);
          this.deadPids.delete(pid);
        }
      } catch (err) {
        const msg = err instanceof ElmError ? err.message : String(err);
        failures.set(pid, msg);
        this.deadPids.set(pid, (this.deadPids.get(pid) ?? 0) + 1);
      }
    }

    return { values, failures, at: Date.now() };
  }

  async readAllDtcs(): Promise<Dtc[]> {
    const out: Dtc[] = [];
    for (const kind of ['stored', 'pending', 'permanent'] as const) {
      try {
        out.push(...(await this.obd.readDtcs(kind)));
      } catch (err) {
        // Un tipo que la ECU no soporta no invalida los demás.
        if (!(err instanceof ElmError)) throw err;
      }
    }
    return out;
  }

  /** PID que la ECU soporta pero esta app todavía no sabe decodificar. */
  undecodedPids(): number[] {
    const known = new Set(PID_DEFS.map((d) => d.pid));
    return [...(this._info?.supportedPids ?? [])].filter((p) => !known.has(p)).sort();
  }

  onTrace(fn: (e: TraceEntry) => void): () => void {
    return this.driver.onTrace(fn);
  }

  getTrace(): readonly TraceEntry[] {
    return this.driver.getTrace();
  }

  async disconnect(): Promise<void> {
    this.driver.detach();
    await this.transport.close();
    this._info = null;
    this.report('desconectado', 'Enlace cerrado');
  }

  private report(phase: SessionPhase, detail: string): void {
    this.onProgress({ phase, detail });
  }
}
