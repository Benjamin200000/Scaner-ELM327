import { findRange, type ReferenceRange, type VehicleContext } from '@/knowledge';
import { paramById, type ParamDef } from '@/core/obd2/pids';

/**
 * Estados de un parámetro.
 *
 * Los tres primeros son los que pidió la especificación. Los otros tres
 * existen porque callarlos obliga a mentir:
 *
 * - `no-disponible`: la ECU soporta el PID pero devolvió un campo vacío.
 * - `no-compatible`: la ECU no soporta el PID. Nunca se muestra como 0.
 * - `sin-referencia`: hay valor pero no hay rango fiable. Se muestra el
 *   número sin juzgarlo.
 * - `fuera-de-condicion`: hay valor y hay rango, pero el rango no aplica en
 *   este momento (motor frío, vehículo en movimiento). Evaluarlo igual
 *   marcaría fallas inexistentes.
 */
export type ParamStatus =
  | 'normal'
  | 'atencion'
  | 'falla'
  | 'no-disponible'
  | 'no-compatible'
  | 'sin-referencia'
  | 'fuera-de-condicion';

export const STATUS_LABEL: Record<ParamStatus, string> = {
  normal: 'NORMAL',
  atencion: 'ATENCIÓN',
  falla: 'FALLA',
  'no-disponible': 'NO DISPONIBLE',
  'no-compatible': 'NO COMPATIBLE',
  'sin-referencia': 'SIN REFERENCIA',
  'fuera-de-condicion': 'FUERA DE CONDICIÓN',
};

/** Orden de gravedad, para resumir un sistema por su peor parámetro. */
export const STATUS_SEVERITY: Record<ParamStatus, number> = {
  falla: 4,
  atencion: 3,
  normal: 1,
  'sin-referencia': 0,
  'fuera-de-condicion': 0,
  'no-disponible': 0,
  'no-compatible': 0,
};

export interface EvaluatedParam {
  id: string;
  def: ParamDef;
  value: number | null;
  status: ParamStatus;
  range: ReferenceRange | null;
  /** Por qué el rango no se aplicó, cuando corresponde. */
  note?: string;
}

/** Valores actuales por id de parámetro. */
export type ParamSnapshot = ReadonlyMap<string, number | null>;

/**
 * Evalúa un parámetro contra su rango de referencia.
 *
 * Nunca convierte la ausencia de dato en un cero, y nunca juzga un valor sin
 * un rango cuyas condiciones se cumplan.
 */
export function evaluateParam(
  paramId: string,
  snapshot: ParamSnapshot,
  supported: boolean,
  ctx: VehicleContext = {},
): EvaluatedParam {
  const def = paramById(paramId);
  if (!def) {
    throw new Error(`Parámetro desconocido: ${paramId}`);
  }

  if (!supported) {
    return { id: paramId, def, value: null, status: 'no-compatible', range: null };
  }

  const value = snapshot.get(paramId) ?? null;
  if (value === null || !Number.isFinite(value)) {
    return { id: paramId, def, value: null, status: 'no-disponible', range: null };
  }

  const range = findRange(paramId, ctx);
  if (!range) {
    return {
      id: paramId,
      def,
      value,
      status: 'sin-referencia',
      range: null,
      note: 'Rango de referencia no disponible para este vehículo',
    };
  }

  const unmet = unmetConditions(range, snapshot);
  if (unmet !== null) {
    return {
      id: paramId,
      def,
      value,
      status: 'fuera-de-condicion',
      range,
      note: unmet,
    };
  }

  return { id: paramId, def, value, status: classify(value, range), range };
}

/** Devuelve el texto de la primera condición que no se cumple, o null. */
function unmetConditions(
  range: ReferenceRange,
  snapshot: ParamSnapshot,
): string | null {
  for (const cond of range.requires ?? []) {
    const v = snapshot.get(cond.paramId);
    if (v === null || v === undefined) {
      const dep = paramById(cond.paramId);
      return `Requiere ${dep?.label ?? cond.paramId}, que no está disponible`;
    }
    if (cond.min !== undefined && v < cond.min) {
      const dep = paramById(cond.paramId);
      return `${dep?.label ?? cond.paramId} por debajo de ${cond.min} ${dep?.unit ?? ''}`.trim();
    }
    if (cond.max !== undefined && v > cond.max) {
      const dep = paramById(cond.paramId);
      return `${dep?.label ?? cond.paramId} por encima de ${cond.max} ${dep?.unit ?? ''}`.trim();
    }
  }
  return null;
}

/**
 * Clasifica un valor dentro de un rango.
 *
 * `warnBelow` / `warnAbove` marcan el umbral de FALLA; entre el rango normal
 * y ese umbral el estado es ATENCIÓN. Si no hay umbral de falla definido,
 * salirse del rango normal solo llega a ATENCIÓN: declarar FALLA sin un
 * límite explícito sería afirmar más de lo que el dato respalda.
 */
function classify(value: number, range: ReferenceRange): ParamStatus {
  const { min, max, warnBelow, warnAbove } = range;

  if (warnBelow !== undefined && value < warnBelow) return 'falla';
  if (warnAbove !== undefined && value > warnAbove) return 'falla';
  if (min !== undefined && value < min) return 'atencion';
  if (max !== undefined && value > max) return 'atencion';
  return 'normal';
}

/** Texto del rango para mostrar. Null si no hay nada que mostrar. */
export function formatRange(range: ReferenceRange | null): string | null {
  if (!range) return null;
  const { min, max, unit } = range;
  if (min !== undefined && max !== undefined) return `${min}–${max} ${unit}`;
  if (min !== undefined) return `≥ ${min} ${unit}`;
  if (max !== undefined) return `≤ ${max} ${unit}`;
  return null;
}

/** Formatea un valor respetando los decimales del parámetro. */
export function formatValue(ev: EvaluatedParam): string {
  if (ev.value === null) return '—';
  return ev.value.toFixed(ev.def.decimals);
}
