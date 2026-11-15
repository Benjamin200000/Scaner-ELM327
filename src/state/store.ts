import { create } from 'zustand';
import { DiagnosticSession, type SessionInfo, type SessionProgress } from '@/core/session';
import { MockTransport } from '@/core/transport/mock';
import { WebSerialTransport } from '@/core/transport/webserial';
import { WebBluetoothTransport } from '@/core/transport/webbluetooth';
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
import { History } from './history';

/**
 * Estado de la aplicación.
 *
 * Es una capa delgada sobre DiagnosticSession a propósito: el store maneja
 * lo que React necesita (valores actuales, series para graficar, errores a
 * mostrar) y delega todo lo que sea protocolo.
 */

export type Screen = 'conexion' | 'resumen' | 'codigos' | 'datos' | 'funciones' | 'terminal' | 'historial';

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

  setScreen(s: Screen): void;
  setMode(m: DetailMode): void;
  setManual(m: Partial<VehicleManual>): void;
  setSimProfile(id: string): void;
  setForcedProtocol(p: string): void;
  setDebug(on: boolean): void;
  setPaused(on: boolean): void;

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

function makeTransport(kind: TransportKind, simProfileId: string): Transport {
  switch (kind) {
    case 'webserial':
      return new WebSerialTransport({ baudRate: 38400 });
    case 'webbluetooth':
      return new WebBluetoothTransport();
    case 'mock':
      return new MockTransport({ profile: profileById(simProfileId) });
    default:
      throw new TransportError('not-supported', `Transporte no implementado: ${kind}`);
  }
}

let pollTimer: ReturnType<typeof setTimeout> | null = null;

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

  setScreen: (screen) => set({ screen }),
  setMode: (mode) => set({ mode }),
  setManual: (m) => set((s) => ({ manual: { ...s.manual, ...m } })),
  setSimProfile: (simProfileId) => set({ simProfileId }),
  setForcedProtocol: (forcedProtocol) => set({ forcedProtocol }),
  setDebug: (debug) => set({ debug }),
  setPaused: (paused) => set({ paused }),
  clearFault: () => set({ fault: null }),

  async connect(kind) {
    const { simProfileId, forcedProtocol, manual } = get();
    set({ fault: null, values: new Map(), series: new Map(), dtcs: [], trace: [] });

    const transport = makeTransport(kind, simProfileId);
    const session = new DiagnosticSession(transport, (progress) => set({ progress }));
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
      await History.save({
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
      }).catch(() => { /* el historial no debe bloquear la desconexión */ });
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
        const result = await session.poll();
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
