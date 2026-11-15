import { create } from 'zustand';
import { DiagnosticSession, type SessionInfo, type SessionProgress } from '@/core/session';
import { MockTransport } from '@/core/transport/mock';
import { WebSerialTransport } from '@/core/transport/webserial';
import { WebBluetoothTransport } from '@/core/transport/webbluetooth';
import { AgentTransport, type AgentInterface } from '@/core/transport/agent';
import type { Transport, TransportKind } from '@/core/transport/types';
import { TransportError } from '@/core/transport/types';
import { ElmError } from '@/core/elm327/errors';
import type { TraceEntry } from '@/core/elm327/driver';
import type { Dtc } from '@/core/obd2/dtc';
import { profileById } from '@/sim/profiles';
import { type Finding, runRules, type SkippedRule } from '@/core/engine/rules';
import { type EvaluatedParam, evaluateParam } from '@/core/engine/evaluate';
import { relevantSystems, type SystemDef } from '@/core/engine/systems';
import type { VehicleContext } from '@/knowledge';
import { History, type HistoryEntry } from './history';
import { leerModo06, type TestResult } from '@/core/obd2/mode06';
import { leerIdentificacionUds, type DidValue } from '@/core/uds/ident';
import { probarAdaptador, type InformeAdaptador } from '@/core/elm327/adapterTest';
import { ServiceRunner, gate, type GateResult } from '@/core/service/runner';
import { routineById } from '@/core/service/routines';
import type { RoutineContext, RunMode, RunResult, StepOutcome } from '@/core/service/types';

/**
 * Estado de la aplicación.
 *
 * Es una capa delgada sobre DiagnosticSession a propósito: el store maneja
 * lo que React necesita (valores actuales, series para graficar, errores a
 * mostrar) y delega todo lo que sea protocolo.
 */

export type Screen =
  | 'conexion' | 'resumen' | 'computadora' | 'codigos' | 'datos' | 'emisiones'
  | 'funciones' | 'informe' | 'historial' | 'terminal';

/** Un paso de la conexión, para mostrar qué está haciendo la app. */
export interface PasoBitacora {
  at: number;
  fase: SessionProgress['phase'];
  texto: string;
}

export type DetailMode = 'simple' | 'tecnico';

/** Serie temporal acotada, para los gráficos en vivo. */
export interface Series {
  t: number[];
  v: (number | null)[];
}

const SERIES_LIMIT = 900; // ~3 min a 5 Hz

export interface VehicleManual {
  make?: string | undefined;
  model?: string | undefined;
  engine?: string | undefined;
  year?: number | undefined;
  displacementL?: number | undefined;
  odometerKm?: number | undefined;
}

interface AppState {
  screen: Screen;
  mode: DetailMode;
  progress: SessionProgress;
  session: DiagnosticSession | null;
  info: SessionInfo | null;
  /** Error de conexión o de enlace, listo para mostrar. */
  fault: { title: string; advice?: string; detail?: string } | null;

  values: Map<string, number | null>;
  series: Map<string, Series>;
  dtcs: Dtc[];
  trace: TraceEntry[];
  debug: boolean;
  polling: boolean;
  paused: boolean;

  manual: VehicleManual;
  simProfileId: string;
  forcedProtocol: string;

  /** Agente local: dirección, token e interfaces que ofrece. */
  agentUrl: string;
  agentToken: string;
  agentInterfaces: AgentInterface[];
  agentInterfaceId: string;
  agentBusy: boolean;
  agentVersion: string | null;

  taller: { nombre: string; tecnico: string; orden: string; contacto: string };
  /** Qué fue haciendo la app al conectar, paso por paso. */
  bitacora: PasoBitacora[];
  /** Resultados del modo 06; null = todavía no se leyeron. */
  mode06: TestResult[] | null;
  /** Identificación UDS por ECU. */
  uds: Record<string, DidValue[]>;
  adaptador: InformeAdaptador | null;
  /** Operación larga en curso: 'modo06', 'uds:7E8', 'adaptador'. */
  ocupado: string | null;
  /** Datos congelados: la foto de los sensores al guardarse el código. */
  freeze: { dtc: string | null; values: Map<number, number | null> } | null;
  freezeCargando: boolean;
  historial: HistoryEntry[];
  historialCargando: boolean;
  /** Sesión del historial que se está mirando, o null para la actual. */
  historialAbierto: HistoryEntry | null;

  /** Rutina de servicio en curso o terminada. */
  routineRun: RunResult | null;
  routineOutcomes: StepOutcome[];
  routineBusy: boolean;
  /** Habilita las rutinas de escritura. Apagado por defecto a propósito. */
  advanced: boolean;

  setScreen(s: Screen): void;
  setMode(m: DetailMode): void;
  setManual(m: Partial<VehicleManual>): void;
  setSimProfile(id: string): void;
  setForcedProtocol(p: string): void;
  setDebug(on: boolean): void;
  setPaused(on: boolean): void;
  setAdvanced(on: boolean): void;
  setAgentUrl(url: string): void;
  setAgentToken(token: string): void;
  setAgentInterfaceId(id: string): void;
  probeAgent(): Promise<void>;
  setTaller(t: Partial<AppState['taller']>): void;
  cargarFreezeFrame(): Promise<void>;
  cargarModo06(): Promise<void>;
  cargarUds(ecu: string): Promise<void>;
  ejecutarPruebaAdaptador(): Promise<void>;
  cargarHistorial(): Promise<void>;
  abrirDelHistorial(entry: HistoryEntry | null): void;
  borrarDelHistorial(id: number): Promise<void>;
  guardarSesionActual(): Promise<void>;
  runRoutine(routineId: string, mode: RunMode): Promise<void>;
  cancelRoutine(): void;
  clearRoutineRun(): void;
  routineContext(): RoutineContext;
  gateRoutine(routineId: string, mode: RunMode): GateResult | null;
  exportTrace(): void;

  connect(kind: TransportKind): Promise<void>;
  disconnect(): Promise<void>;
  refreshDtcs(): Promise<void>;
  clearDtcs(): Promise<void>;
  clearFault(): void;

  // Derivados
  vehicleContext(): VehicleContext;
  evaluated(): EvaluatedParam[];
  systems(): SystemDef[];
  diagnosis(): { findings: Finding[]; skipped: SkippedRule[] };
}

const emptyProgress: SessionProgress = { phase: 'desconectado', detail: 'Sin conexión' };

interface AgentConfig {
  url: string;
  token: string;
  interfaceId: string;
}

function makeTransport(
  kind: TransportKind,
  simProfileId: string,
  agent: AgentConfig,
): Transport {
  switch (kind) {
    case 'webserial':
      return new WebSerialTransport({ baudRate: 38400 });
    case 'webbluetooth':
      return new WebBluetoothTransport();
    case 'mock':
      return new MockTransport({ profile: profileById(simProfileId) });
    case 'websocket':
      if (agent.interfaceId === '') {
        throw new TransportError('open-failed',
          'Hay que elegir una interfaz del agente antes de conectar');
      }
      return new AgentTransport({
        url: agent.url,
        token: agent.token,
        interfaceId: agent.interfaceId,
      });
    default:
      throw new TransportError('not-supported', `Transporte no implementado: ${kind}`);
  }
}

/** Arma la entrada de historial a partir del estado actual. */
function instantanea(
  info: SessionInfo,
  values: Map<string, number | null>,
  dtcs: Dtc[],
  manual: VehicleManual,
): HistoryEntry {
  return {
    at: Date.now(),
    vehicle: {
      make: manual.make ?? null,
      model: manual.model ?? null,
      year: manual.year ?? null,
      vin: info.identity.vin,
      odometerKm: manual.odometerKm ?? null,
    },
    ecu: {
      name: info.identity.ecuName,
      calibrationId: info.identity.calibrationId,
      protocol: info.protocol?.name ?? null,
    },
    dtcs: dtcs.map((d) => ({ code: d.code, kind: d.kind })),
    values: Object.fromEntries(values),
  };
}

/** localStorage puede fallar o venir vacío; nada de esto es crítico. */
function leer(clave: string): string | null {
  try {
    return localStorage.getItem(`scaner.${clave}`);
  } catch {
    return null;
  }
}

function guardar(clave: string, valor: string): void {
  try {
    localStorage.setItem(`scaner.${clave}`, valor);
  } catch {
    // Ventana privada o almacenamiento bloqueado: se sigue igual.
  }
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let cancelRequested = false;
let vueltaEnCurso: Promise<void> | null = null;

export const useApp = create<AppState>((set, get) => ({
  screen: 'conexion',
  mode: 'tecnico',
  progress: emptyProgress,
  session: null,
  info: null,
  fault: null,

  values: new Map(),
  series: new Map(),
  dtcs: [],
  trace: [],
  debug: false,
  polling: false,
  paused: false,

  manual: {},
  simProfileId: 'tdi-2.0-dpf',
  forcedProtocol: '0',

  routineRun: null,
  routineOutcomes: [],
  routineBusy: false,
  advanced: false,

  agentUrl: leer('agentUrl') ?? 'ws://127.0.0.1:8777',
  agentToken: leer('agentToken') ?? '',
  agentInterfaces: [],
  agentInterfaceId: '',
  agentBusy: false,
  agentVersion: null,

  taller: {
    nombre: leer('tallerNombre') ?? '',
    tecnico: leer('tallerTecnico') ?? '',
    orden: '',
    contacto: leer('tallerContacto') ?? '',
  },
  bitacora: [],
  mode06: null,
  uds: {},
  adaptador: null,
  ocupado: null,
  freeze: null,
  freezeCargando: false,
  historial: [],
  historialCargando: false,
  historialAbierto: null,

  setScreen: (screen) => set({ screen }),
  setMode: (mode) => set({ mode }),
  setManual: (m) => set((s) => ({ manual: { ...s.manual, ...m } })),
  setSimProfile: (simProfileId) => set({ simProfileId }),
  setForcedProtocol: (forcedProtocol) => set({ forcedProtocol }),
  setDebug: (debug) => set({ debug }),
  setPaused: (paused) => set({ paused }),
  setAdvanced: (advanced) => set({ advanced }),
  setAgentUrl: (agentUrl) => { guardar('agentUrl', agentUrl); set({ agentUrl }); },
  setAgentToken: (agentToken) => { guardar('agentToken', agentToken); set({ agentToken }); },
  setAgentInterfaceId: (agentInterfaceId) => set({ agentInterfaceId }),
  abrirDelHistorial: (historialAbierto) => set({ historialAbierto }),
  setTaller: (t) => set((st) => {
    const taller = { ...st.taller, ...t };
    // El número de orden cambia en cada trabajo: no se persiste.
    guardar('tallerNombre', taller.nombre);
    guardar('tallerTecnico', taller.tecnico);
    guardar('tallerContacto', taller.contacto);
    return { taller };
  }),

  /** Resultados de los autodiagnósticos (modo 06). */
  async cargarModo06() {
    const { session } = get();
    if (!session) return;
    await exclusivo(set, get, 'modo06', async () => {
      set({ mode06: await leerModo06(session.obd) });
    });
  },

  /** Identificación profunda de una unidad por UDS. */
  async cargarUds(ecu) {
    const { session } = get();
    if (!session) return;
    await exclusivo(set, get, `uds:${ecu}`, async () => {
      const valores = await leerIdentificacionUds(session.driver, ecu);
      set((st) => ({ uds: { ...st.uds, [ecu]: valores } }));
    });
  },

  async ejecutarPruebaAdaptador() {
    const { session } = get();
    if (!session) return;
    await exclusivo(set, get, 'adaptador', async () => {
      set({ adaptador: await probarAdaptador(session.driver) });
    });
  },

  /**
   * Lee los datos congelados.
   *
   * Bajo demanda y no al conectar: son varias solicitudes y la mayoría de
   * las sesiones no los necesitan. Cuando hay una falla intermitente, en
   * cambio, son lo más valioso de toda la lectura.
   */
  async cargarFreezeFrame() {
    const { session, info } = get();
    if (!session || !info) return;
    set({ freezeCargando: true });
    try {
      const dtc = await session.obd.readFreezeFrameDtc();
      // Las condiciones que importan para situar una falla.
      const pids = [0x0c, 0x0d, 0x04, 0x05, 0x0b, 0x0f, 0x10, 0x11, 0x06, 0x07]
        .filter((p) => info.supportedPids.has(p));
      const foto = await session.obd.readFreezeFrame(pids);
      const values = new Map<number, number | null>();
      for (const [pid, lectura] of foto) {
        const primero = [...lectura.values.values()][0];
        values.set(pid, primero ?? null);
      }
      set({ freeze: { dtc, values } });
    } catch (err) {
      set({ fault: toFault(err) });
    } finally {
      set({ freezeCargando: false });
    }
  },

  async cargarHistorial() {
    set({ historialCargando: true });
    try {
      set({ historial: await History.list(100) });
    } catch (err) {
      set({ fault: toFault(err) });
    } finally {
      set({ historialCargando: false });
    }
  },

  async borrarDelHistorial(id) {
    try {
      await History.remove(id);
      await get().cargarHistorial();
      if (get().historialAbierto?.id === id) set({ historialAbierto: null });
    } catch (err) {
      set({ fault: toFault(err) });
    }
  },

  /**
   * Guarda la sesión actual sin desconectar.
   *
   * Hace falta porque el informe se genera durante el trabajo, no después:
   * el mecánico quiere el papel en la mano con el auto todavía conectado.
   */
  async guardarSesionActual() {
    const { info, values, dtcs, manual } = get();
    if (!info) return;
    try {
      await History.save(instantanea(info, values, dtcs, manual));
      await get().cargarHistorial();
    } catch (err) {
      set({ fault: toFault(err) });
    }
  },

  /**
   * Consulta al agente qué interfaces tiene, sin abrir ninguna.
   *
   * Es un paso aparte de conectar porque el usuario no sabe de antemano en
   * qué COM quedó su adaptador Bluetooth: primero hay que poder mirar.
   */
  async probeAgent() {
    const { agentUrl, agentToken } = get();
    set({ agentBusy: true, fault: null });
    const probe = new AgentTransport({ url: agentUrl, token: agentToken });
    try {
      const { interfaces, features } = await probe.connect();
      const usable = interfaces.filter((i) => i.kind !== 'error');
      set({
        agentInterfaces: interfaces,
        agentInterfaceId: get().agentInterfaceId !== ''
          && interfaces.some((i) => i.id === get().agentInterfaceId)
          ? get().agentInterfaceId
          : usable[0]?.id ?? '',
        agentVersion: features.simulador === true ? 'con simulador' : 'conectado',
      });
    } catch (err) {
      set({ fault: toFault(err), agentInterfaces: [], agentVersion: null });
    } finally {
      await probe.close().catch(() => {});
      set({ agentBusy: false });
    }
  },
  clearFault: () => set({ fault: null }),
  clearRoutineRun: () => set({ routineRun: null, routineOutcomes: [] }),
  cancelRoutine: () => { cancelRequested = true; },

  routineContext() {
    const { info, values, dtcs, manual } = get();
    return {
      protocol: info?.protocol ?? null,
      values,
      available: info?.availableParams ?? new Set<string>(),
      dtcs,
      voltage: info?.voltage ?? null,
      make: manual.make,
    };
  },

  gateRoutine(routineId, mode) {
    const routine = routineById(routineId);
    if (!routine) return null;
    return gate(routine, get().routineContext(), mode);
  },

  /**
   * Ejecuta una rutina de servicio.
   *
   * El sondeo se pausa durante la ejecución: un ELM327 atiende un comando
   * por vez, y dejar el ciclo de datos en vivo compitiendo con una
   * secuencia de escritura es una forma segura de que falle a la mitad.
   */
  async runRoutine(routineId, mode) {
    const { session } = get();
    const routine = routineById(routineId);
    if (!session || !routine) return;

    cancelRequested = false;
    const wasPaused = get().paused;
    set({ routineBusy: true, routineRun: null, routineOutcomes: [], paused: true });
    // Que termine la vuelta de sondeo en curso antes de tocar la ECU.
    if (vueltaEnCurso !== null) await vueltaEnCurso;

    try {
      const runner = new ServiceRunner(session.driver);
      const result = await runner.run(routine, get().routineContext(), {
        mode,
        onProgress: (outcomes) => set({ routineOutcomes: [...outcomes] }),
        shouldAbort: () => cancelRequested,
      });
      set({ routineRun: result, routineOutcomes: result.outcomes });

      // Tras un borrado la lista de códigos en pantalla quedó vieja.
      if (result.completed && mode === 'real' && routineId === 'obd2.clear-dtc') {
        await get().refreshDtcs();
      }
    } catch (err) {
      set({ fault: toFault(err) });
    } finally {
      set({ routineBusy: false, paused: wasPaused });
    }
  },

  /**
   * Descarga el registro completo de la sesión.
   *
   * Es la pieza que convierte un vehículo real en datos verificables: con
   * este archivo se puede contrastar la escala de un PID ampliado o la
   * respuesta de una ECU sin tener el auto delante.
   */
  exportTrace() {
    const { session, info, manual, trace, values, dtcs } = get();
    const payload = {
      exportadoEl: new Date().toISOString(),
      app: 'scaner-elm327',
      vehiculo: {
        ...manual,
        vin: info?.identity.vin ?? null,
        ecu: info?.identity.ecuName ?? null,
        calibracion: info?.identity.calibrationId ?? null,
      },
      adaptador: info?.adapter ?? null,
      protocolo: info?.protocol?.name ?? null,
      transporte: session?.transport.info ?? null,
      pidSoportados: [...(info?.supportedPids ?? [])]
        .map((p) => p.toString(16).toUpperCase().padStart(2, '0')),
      pidSinDecodificar: session?.undecodedPids().map(
        (p) => p.toString(16).toUpperCase().padStart(2, '0')) ?? [],
      codigos: dtcs,
      valores: Object.fromEntries(values),
      // El registro crudo es lo más valioso del archivo.
      traza: (trace.length > 0 ? trace : session?.getTrace() ?? []).map((t) => ({
        at: new Date(t.at).toISOString(),
        dir: t.direction,
        text: t.text,
        ms: t.elapsedMs ?? null,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.download = `sesion-${manual.make ?? 'vehiculo'}-${stamp}.json`.toLowerCase();
    a.click();
    URL.revokeObjectURL(url);
  },

  async connect(kind) {
    const { simProfileId, forcedProtocol, manual, agentUrl, agentToken, agentInterfaceId } = get();
    set({
      fault: null, values: new Map(), series: new Map(), dtcs: [], trace: [],
      bitacora: [], mode06: null, uds: {}, adaptador: null, freeze: null,
    });

    let transport: Transport;
    try {
      transport = makeTransport(kind, simProfileId, {
        url: agentUrl, token: agentToken, interfaceId: agentInterfaceId,
      });
    } catch (err) {
      set({ fault: toFault(err), progress: { phase: 'error', detail: 'No se pudo conectar' } });
      return;
    }
    const session = new DiagnosticSession(transport, (progress) => set((st) => ({
      progress,
      bitacora: [...st.bitacora, { at: Date.now(), fase: progress.phase, texto: progress.detail }],
    })));
    set({ session });

    const unsubTrace = session.onTrace((entry) => {
      if (!get().debug) return;
      set((s) => {
        const trace = [...s.trace, entry];
        return { trace: trace.length > 400 ? trace.slice(-400) : trace };
      });
    });

    try {
      const info = await session.connect(
        forcedProtocol === '0' ? undefined : forcedProtocol,
        manual.make,
      );
      set({ info, screen: 'resumen' });
      await get().refreshDtcs();
      startPolling(set, get);
    } catch (err) {
      unsubTrace();
      set({
        fault: toFault(err),
        progress: { phase: 'error', detail: 'La conexión falló' },
        session: null,
        info: null,
      });
      try {
        await transport.close();
      } catch { /* ya cerrado */ }
    }
  },

  async disconnect() {
    stopPolling();
    const { session, info, values, dtcs, manual } = get();
    if (session && info) {
      // Guardar la sesión antes de perderla.
      await History.save(instantanea(info, values, dtcs, manual))
        .catch(() => { /* el historial no debe bloquear la desconexión */ });
      await session.disconnect().catch(() => { /* el enlace ya pudo caer */ });
    }
    set({
      session: null, info: null, progress: emptyProgress,
      screen: 'conexion', polling: false, values: new Map(), series: new Map(),
    });
  },

  async refreshDtcs() {
    const { session } = get();
    if (!session) return;
    try {
      set({ dtcs: await session.readAllDtcs() });
    } catch (err) {
      set({ fault: toFault(err) });
    }
  },

  async clearDtcs() {
    const { session } = get();
    if (!session) return;
    try {
      await session.obd.clearDtcs();
      await get().refreshDtcs();
    } catch (err) {
      set({ fault: toFault(err) });
    }
  },

  vehicleContext() {
    const { manual, info } = get();
    const ctx: VehicleContext = {};
    if (manual.make !== undefined) ctx.make = manual.make;
    if (manual.model !== undefined) ctx.model = manual.model;
    if (manual.engine !== undefined) ctx.engine = manual.engine;
    if (manual.year !== undefined) ctx.year = manual.year;
    const ecu = info?.identity.ecuName;
    if (ecu !== null && ecu !== undefined) ctx.ecu = ecu;
    const fuel = info?.fuel;
    if (fuel !== null && fuel !== undefined) ctx.fuel = fuel;
    return ctx;
  },

  evaluated() {
    const { info, values } = get();
    if (!info) return [];
    const ctx = get().vehicleContext();
    return [...info.availableParams].map((id) =>
      evaluateParam(id, values, true, ctx),
    );
  },

  systems() {
    const { info } = get();
    return info ? relevantSystems(info.availableParams) : [];
  },

  diagnosis() {
    const { info, values, dtcs, manual } = get();
    if (!info) return { findings: [], skipped: [] };
    return runRules(
      {
        snapshot: values,
        dtcs,
        ...(manual.displacementL !== undefined
          ? { displacementL: manual.displacementL }
          : {}),
        ...(info.fuel !== null ? { fuel: info.fuel } : {}),
      },
      info.availableParams,
    );
  },
}));

/**
 * Ciclo de sondeo.
 *
 * Se reprograma con setTimeout en lugar de setInterval: si una vuelta tarda
 * más de lo previsto (habitual sobre K-Line), un intervalo fijo encolaría
 * solicitudes sobre un adaptador que ya está ocupado.
 */
function startPolling(
  set: (p: Partial<AppState>) => void,
  get: () => AppState,
): void {
  stopPolling();
  set({ polling: true });

  const tick = async (): Promise<void> => {
    const { session, paused } = get();
    if (!session) return;
    if (!paused) {
      try {
        const vuelta = session.poll();
        vueltaEnCurso = vuelta.then(() => {}, () => {});
        const result = await vuelta;
        set({
          values: mergeValues(get().values, result.values),
          series: appendSeries(get().series, result.values, result.at),
        });
      } catch (err) {
        // Un fallo de enlace corta el ciclo; uno puntual no.
        if (err instanceof TransportError) {
          stopPolling();
          set({ fault: toFault(err), polling: false });
          return;
        }
      }
    }
    pollTimer = setTimeout(() => void tick(), 150);
  };
  pollTimer = setTimeout(() => void tick(), 0);
}

function stopPolling(): void {
  if (pollTimer !== null) clearTimeout(pollTimer);
  pollTimer = null;
}

/**
 * Corre una operación con el sondeo detenido.
 *
 * Hace falta para todo lo que cambia la configuración del adaptador (la
 * identificación UDS fija la cabecera a una ECU): si el ciclo de datos en
 * vivo intercalara sus solicitudes, saldrían dirigidas a la unidad
 * equivocada. Se espera a que termine la vuelta en curso antes de empezar.
 */
async function exclusivo(
  set: (p: Partial<AppState>) => void,
  get: () => AppState,
  nombre: string,
  fn: () => Promise<void>,
): Promise<void> {
  if (get().ocupado !== null) return;
  const estabaPausado = get().paused;
  set({ ocupado: nombre, paused: true });
  try {
    if (vueltaEnCurso !== null) await vueltaEnCurso.catch(() => {});
    await fn();
  } catch (err) {
    set({ fault: toFault(err) });
  } finally {
    set({ ocupado: null, paused: estabaPausado });
  }
}

const mergeValues = (
  prev: Map<string, number | null>,
  next: Map<string, number | null>,
): Map<string, number | null> => {
  const out = new Map(prev);
  for (const [k, v] of next) out.set(k, v);
  return out;
};

function appendSeries(
  prev: Map<string, Series>,
  values: Map<string, number | null>,
  at: number,
): Map<string, Series> {
  const out = new Map(prev);
  const tSec = at / 1000;
  for (const [k, v] of values) {
    const existing = out.get(k) ?? { t: [], v: [] };
    const t = [...existing.t, tSec];
    const vv = [...existing.v, v];
    out.set(k, {
      t: t.length > SERIES_LIMIT ? t.slice(-SERIES_LIMIT) : t,
      v: vv.length > SERIES_LIMIT ? vv.slice(-SERIES_LIMIT) : vv,
    });
  }
  return out;
}

/** Traduce cualquier error a algo que se pueda mostrar sin "error desconocido". */
function toFault(err: unknown): { title: string; advice?: string; detail?: string } {
  if (err instanceof ElmError) {
    return {
      title: err.message,
      ...(err.advice !== undefined ? { advice: err.advice } : {}),
      ...(err.raw !== undefined ? { detail: `Respuesta del adaptador: ${err.raw.trim()}` } : {}),
    };
  }
  if (err instanceof TransportError) {
    return {
      title: err.message,
      ...(err.detail !== undefined ? { detail: err.detail } : {}),
    };
  }
  if (err instanceof Error) {
    return { title: 'Fallo inesperado', detail: err.message };
  }
  return { title: 'Fallo inesperado', detail: String(err) };
}
