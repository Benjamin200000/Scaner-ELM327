import type { SystemId } from '@/core/obd2/pids';
import { PID_DEFS } from '@/core/obd2/pids';
import {
  type EvaluatedParam,
  type ParamStatus,
  STATUS_SEVERITY,
} from './evaluate';

/**
 * Agrupación de parámetros en sistemas, y decisión de qué sistemas mostrar.
 *
 * El requisito es que la app no muestre una sección de DPF en un gasolina ni
 * una pantalla con cuarenta parámetros. La regla acá es simple y verificable:
 * un sistema se muestra si la ECU soporta al menos un parámetro suyo. No se
 * infiere del año ni del modelo, que es información que puede faltar o ser
 * incorrecta: se infiere de lo que la ECU realmente contestó.
 */

export interface SystemDef {
  id: SystemId;
  label: string;
  /** Orden en que aparecen en la interfaz. */
  order: number;
  /** Parámetros que se destacan en el resumen del sistema. */
  highlight: string[];
}

export const SYSTEMS: SystemDef[] = [
  { id: 'motor', label: 'Motor', order: 1, highlight: ['rpm', 'coolant', 'load'] },
  { id: 'combustible', label: 'Combustible', order: 2, highlight: ['ltft1', 'stft1', 'rail_pressure'] },
  { id: 'admision', label: 'Admisión', order: 3, highlight: ['maf', 'map', 'iat'] },
  { id: 'turbo', label: 'Turbo', order: 4, highlight: ['boost_cmd', 'boost_actual'] },
  { id: 'egr', label: 'EGR', order: 5, highlight: ['egr_cmd', 'egr_error'] },
  { id: 'dpf', label: 'DPF', order: 6, highlight: ['dpf_delta', 'dpf_inlet_temp'] },
  { id: 'encendido', label: 'Encendido', order: 7, highlight: ['timing'] },
  { id: 'emisiones', label: 'Emisiones', order: 8, highlight: ['mil', 'dtc_count'] },
  { id: 'sensores', label: 'Sensores', order: 9, highlight: ['ambient'] },
  { id: 'vehiculo', label: 'Vehículo', order: 10, highlight: ['speed', 'fuel_level'] },
];

export const systemById = (id: SystemId): SystemDef | null =>
  SYSTEMS.find((s) => s.id === id) ?? null;

/** Parámetros de un sistema, según el catálogo de PID. */
export function paramsOfSystem(system: SystemId): string[] {
  return PID_DEFS.flatMap((pid) =>
    pid.params.filter((p) => p.system === system).map((p) => p.id),
  );
}

/** Ids de parámetros que la ECU soporta, derivados de los PID soportados. */
export function availableParams(supportedPids: Set<number>): Set<string> {
  const out = new Set<string>();
  for (const pid of PID_DEFS) {
    if (!supportedPids.has(pid.pid)) continue;
    for (const param of pid.params) out.add(param.id);
  }
  return out;
}

/**
 * Sistemas a mostrar para esta ECU, en orden.
 *
 * Un sistema sin ningún parámetro soportado no aparece: es la diferencia
 * entre una app que se adapta al vehículo y una que muestra secciones vacías.
 */
export function relevantSystems(available: Set<string>): SystemDef[] {
  return SYSTEMS.filter((sys) =>
    paramsOfSystem(sys.id).some((p) => available.has(p)),
  ).sort((a, b) => a.order - b.order);
}

export interface SystemSummary {
  system: SystemDef;
  status: ParamStatus;
  /** Parámetros que empujaron el estado hacia arriba. */
  drivers: EvaluatedParam[];
  /** Cuántos parámetros del sistema se pudieron evaluar. */
  evaluated: number;
}

/**
 * Resume un sistema por su peor parámetro.
 *
 * Si ninguno se pudo evaluar contra una referencia, el sistema queda en
 * `sin-referencia` en lugar de `normal`: decir "normal" sin haber comparado
 * nada sería afirmar algo que no se verificó.
 */
export function summarizeSystem(
  system: SystemDef,
  evaluated: EvaluatedParam[],
): SystemSummary {
  const mine = evaluated.filter((e) => e.def.system === system.id);
  const judged = mine.filter(
    (e) => e.status === 'normal' || e.status === 'atencion' || e.status === 'falla',
  );

  if (judged.length === 0) {
    const anyValue = mine.some((e) => e.value !== null);
    return {
      system,
      status: anyValue ? 'sin-referencia' : 'no-compatible',
      drivers: [],
      evaluated: 0,
    };
  }

  const worst = judged.reduce((a, b) =>
    STATUS_SEVERITY[b.status] > STATUS_SEVERITY[a.status] ? b : a,
  );
  return {
    system,
    status: worst.status,
    drivers: judged.filter((e) => e.status === worst.status && e.status !== 'normal'),
    evaluated: judged.length,
  };
}
