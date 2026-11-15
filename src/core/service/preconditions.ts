import type { Precondition, RoutineContext } from './types';

/**
 * Precondiciones reutilizables.
 *
 * Cada una se evalúa contra datos medidos. Cuando el dato no está, el
 * resultado es 'indeterminada' y no 'cumplida': una condición que no se pudo
 * verificar nunca se da por buena.
 */

const num = (ctx: RoutineContext, id: string): number | null => {
  const v = ctx.values.get(id);
  return v === null || v === undefined || !Number.isFinite(v) ? null : v;
};

export const motorDetenido: Precondition = {
  id: 'motor-detenido',
  label: 'Motor detenido',
  rationale:
    'Varias ECU rechazan escrituras con el motor girando, y una rutina que ' +
    'acciona componentes con el motor en marcha es peligrosa.',
  check(ctx) {
    const rpm = num(ctx, 'rpm');
    if (rpm === null) {
      return { state: 'indeterminada', observed: 'Régimen no disponible' };
    }
    return {
      state: rpm < 50 ? 'cumplida' : 'no-cumplida',
      observed: `${Math.round(rpm)} rpm`,
    };
  },
};

export const motorEnMarcha: Precondition = {
  id: 'motor-en-marcha',
  label: 'Motor en marcha',
  rationale: 'La rutina necesita que el motor esté funcionando para completarse.',
  check(ctx) {
    const rpm = num(ctx, 'rpm');
    if (rpm === null) {
      return { state: 'indeterminada', observed: 'Régimen no disponible' };
    }
    return {
      state: rpm > 400 ? 'cumplida' : 'no-cumplida',
      observed: `${Math.round(rpm)} rpm`,
    };
  },
};

export const vehiculoDetenido: Precondition = {
  id: 'vehiculo-detenido',
  label: 'Vehículo detenido',
  rationale: 'Ninguna función de servicio debe ejecutarse con el vehículo en movimiento.',
  check(ctx) {
    const v = num(ctx, 'speed');
    if (v === null) {
      return { state: 'indeterminada', observed: 'Velocidad no disponible' };
    }
    return { state: v === 0 ? 'cumplida' : 'no-cumplida', observed: `${Math.round(v)} km/h` };
  },
};

/**
 * Tensión suficiente y estable.
 *
 * Es la precondición que más vehículos salva. Una escritura interrumpida por
 * caída de tensión puede dejar la ECU en un estado del que no se vuelve sin
 * equipo de programación.
 */
export const tensionSuficiente: Precondition = {
  id: 'tension-suficiente',
  label: 'Tensión de alimentación suficiente',
  rationale:
    'Una escritura que se corta por caída de tensión puede dejar la ECU en ' +
    'un estado irrecuperable sin equipo de programación. Por debajo de ' +
    '12.0 V conviene conectar un cargador de mantenimiento.',
  check(ctx) {
    const v = ctx.voltage ?? num(ctx, 'module_voltage');
    if (v === null) {
      return { state: 'indeterminada', observed: 'Tensión no disponible' };
    }
    return {
      state: v >= 12.0 ? 'cumplida' : 'no-cumplida',
      observed: `${v.toFixed(1)} V`,
    };
  },
};

export const motorATemperatura: Precondition = {
  id: 'motor-a-temperatura',
  label: 'Motor a temperatura de régimen',
  rationale: 'Por debajo de 70 °C la ECU suele rechazar la operación.',
  check(ctx) {
    const t = num(ctx, 'coolant');
    if (t === null) {
      return { state: 'indeterminada', observed: 'Temperatura no disponible' };
    }
    return {
      state: t >= 70 ? 'cumplida' : 'no-cumplida',
      observed: `${Math.round(t)} °C`,
    };
  },
};

export const combustibleSuficiente: Precondition = {
  id: 'combustible-suficiente',
  label: 'Combustible suficiente',
  rationale:
    'Una regeneración consume combustible y puede durar más de veinte ' +
    'minutos. Quedarse sin nafta a mitad del ciclo lo deja incompleto.',
  check(ctx) {
    const l = num(ctx, 'fuel_level');
    if (l === null) {
      return { state: 'indeterminada', observed: 'Nivel no disponible' };
    }
    return {
      state: l >= 25 ? 'cumplida' : 'no-cumplida',
      observed: `${Math.round(l)} %`,
    };
  },
};

export const sinFallasCriticas: Precondition = {
  id: 'sin-fallas-criticas',
  label: 'Sin fallas que impidan la operación',
  rationale:
    'Una falla activa en inyección, admisión o sensores puede hacer que la ' +
    'ECU aborte la rutina a mitad de camino, o que la complete con datos malos.',
  check(ctx) {
    const stored = ctx.dtcs.filter((d) => d.kind === 'stored');
    return {
      state: stored.length === 0 ? 'cumplida' : 'no-cumplida',
      observed: stored.length === 0
        ? 'Sin códigos confirmados'
        : `${stored.length} confirmados: ${stored.map((d) => d.code).join(', ')}`,
    };
  },
};

/**
 * Evalúa todas las precondiciones de una rutina.
 *
 * La regla de corte depende del riesgo: en una rutina que acciona
 * componentes, una condición indeterminada bloquea igual que una no
 * cumplida. En una de solo lectura, no.
 */
export function evaluatePreconditions(
  preconditions: Precondition[],
  ctx: RoutineContext,
): { precondition: Precondition; result: ReturnType<Precondition['check']> }[] {
  return preconditions.map((p) => ({ precondition: p, result: p.check(ctx) }));
}
