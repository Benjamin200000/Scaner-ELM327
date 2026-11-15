import { GENERIC_DTCS, findDtcKnowledge, knownDtcCount } from './dtc/generic';
import { GENERIC_RANGES, VEHICLE_RANGES } from './ranges/generic';
import {
  type AppliesTo,
  type DtcKnowledge,
  type ReferenceRange,
  SOURCE_WEIGHT,
} from './types';

export * from './types';
export { findDtcKnowledge, knownDtcCount, GENERIC_DTCS };

/** Datos del vehículo con los que se resuelve qué entradas aplican. */
export interface VehicleContext {
  make?: string;
  model?: string;
  engine?: string;
  ecu?: string;
  year?: number;
  fuel?: 'gasolina' | 'diesel';
}

/** ¿Aplica esta entrada a este vehículo? Sin `appliesTo` es genérica. */
export function matches(applies: AppliesTo | undefined, ctx: VehicleContext): boolean {
  if (!applies) return true;
  const eq = (a?: string, b?: string): boolean =>
    a === undefined || (b !== undefined && a.toLowerCase() === b.toLowerCase());
  if (!eq(applies.make, ctx.make)) return false;
  if (!eq(applies.model, ctx.model)) return false;
  if (!eq(applies.engine, ctx.engine)) return false;
  if (!eq(applies.ecu, ctx.ecu)) return false;
  if (applies.fuel !== undefined && applies.fuel !== ctx.fuel) return false;
  if (applies.yearFrom !== undefined && (ctx.year ?? 0) < applies.yearFrom) return false;
  if (applies.yearTo !== undefined && (ctx.year ?? 9999) > applies.yearTo) return false;
  return true;
}

/** Cuán específica es una entrada. Más campos = gana sobre la genérica. */
const specificity = (applies: AppliesTo | undefined): number =>
  applies ? Object.values(applies).filter((v) => v !== undefined).length : 0;

/**
 * Elige el rango de referencia que mejor aplica a este vehículo.
 *
 * Prioriza, en orden: especificidad del `appliesTo` y después el peso del
 * origen. Un valor medido en ESTE vehículo le gana a uno de práctica de
 * taller. Devuelve null cuando no hay ninguno, y eso se muestra como
 * "rango de referencia no disponible".
 */
export function findRange(
  paramId: string,
  ctx: VehicleContext = {},
): ReferenceRange | null {
  const candidates = [...VEHICLE_RANGES, ...GENERIC_RANGES].filter(
    (r) => r.paramId === paramId && matches(r.appliesTo, ctx),
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, r) => {
    const bs = specificity(best.appliesTo) * 10 + SOURCE_WEIGHT[best.provenance.source];
    const rs = specificity(r.appliesTo) * 10 + SOURCE_WEIGHT[r.provenance.source];
    return rs > bs ? r : best;
  });
}

/** Igual que findRange pero para la interpretación de un código. */
export function findDtcFor(
  code: string,
  ctx: VehicleContext = {},
): DtcKnowledge | null {
  const generic = findDtcKnowledge(code);
  if (generic && !matches(generic.appliesTo, ctx)) return null;
  return generic;
}
