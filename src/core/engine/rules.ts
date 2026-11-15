import type { ParamSnapshot } from './evaluate';
import type { Dtc } from '@/core/obd2/dtc';
import { paramById } from '@/core/obd2/pids';

/**
 * Motor de reglas de diagnóstico.
 *
 * La regla de oro del proyecto: un parámetro fuera de rango es un DATO
 * ANORMAL, no un diagnóstico. El tipo `Finding` lo impone con `level`, que
 * no tiene ningún valor equivalente a "confirmado":
 *
 *   observacion         un valor está fuera de lo esperado, nada más
 *   indicio             dos o más valores apuntan en la misma dirección
 *   patron-compatible   el conjunto es característico de una falla conocida
 *
 * Y con `wording`: ninguna regla puede decir "la pieza X está defectuosa".
 * Lo más fuerte que la app afirma es "compatible con", y siempre junto a
 * qué habría que medir para avanzar.
 *
 * Una regla a la que le falta un parámetro NO se evalúa a medias: se informa
 * como no evaluable, con qué dato falta.
 */

export type FindingLevel = 'observacion' | 'indicio' | 'patron-compatible';

export const LEVEL_LABEL: Record<FindingLevel, string> = {
  observacion: 'OBSERVACIÓN',
  indicio: 'INDICIO',
  'patron-compatible': 'PATRÓN COMPATIBLE',
};

export interface Finding {
  ruleId: string;
  level: FindingLevel;
  /** Encabezado corto, en el lenguaje del taller. */
  title: string;
  /** Qué se observó, con los números concretos. */
  observed: string;
  /** Hipótesis a verificar. Nunca conclusiones. */
  causes: string[];
  /** Qué revisar o medir para avanzar. */
  check: string[];
  /** Parámetros involucrados, para poder graficarlos juntos. */
  params: string[];
}

/** Una regla que no se pudo evaluar, y por qué. Se informa, no se oculta. */
export interface SkippedRule {
  ruleId: string;
  title: string;
  missing: string[];
  reason: string;
}

export interface RuleContext {
  snapshot: ParamSnapshot;
  dtcs: Dtc[];
  /** Cilindrada en litros. Hace falta para estimar el caudal de aire teórico. */
  displacementL?: number;
  fuel?: 'gasolina' | 'diesel';
}

export interface Rule {
  id: string;
  title: string;
  /** Sin estos parámetros la regla no corre. */
  requires: string[];
  /** Solo corre para este combustible, si se declara. */
  fuel?: 'gasolina' | 'diesel';
  evaluate(ctx: RuleContext): Finding | null;
}

const val = (ctx: RuleContext, id: string): number | null => {
  const v = ctx.snapshot.get(id);
  return v === null || v === undefined || !Number.isFinite(v) ? null : v;
};

const fmt = (id: string, v: number): string => {
  const def = paramById(id);
  const n = v.toFixed(def?.decimals ?? 1);
  return def?.unit ? `${n} ${def.unit}` : n;
};

// ─────────────────────────────────────────────────────────────────────────
// Reglas
// ─────────────────────────────────────────────────────────────────────────

/**
 * Corrección larga sostenidamente positiva: entra aire que no se mide, o
 * falta combustible. Es el ejemplo de la especificación.
 */
const mezclaPobre: Rule = {
  id: 'mezcla-pobre-adaptativa',
  title: 'Corrección de combustible en el límite positivo',
  requires: ['ltft1'],
  fuel: 'gasolina',
  evaluate(ctx) {
    const ltft = val(ctx, 'ltft1');
    if (ltft === null || ltft < 12) return null;
    const stft = val(ctx, 'stft1');
    const level: FindingLevel = ltft >= 20 ? 'patron-compatible' : 'indicio';
    const observed =
      `Corrección larga en ${fmt('ltft1', ltft)}` +
      (stft !== null ? `, corta en ${fmt('stft1', stft)}` : '') +
      '. La ECU está agregando combustible de forma sostenida.';
    return {
      ruleId: this.id,
      level,
      title: 'Compatible con exceso de aire no medido o falta de combustible',
      observed,
      causes: [
        'Entrada de aire falsa después del medidor de caudal',
        'MAF que subestima el caudal real',
        'Presión de combustible baja',
        'Inyectores con caudal reducido',
        'Fuga de escape antes de la sonda lambda',
      ],
      check: [
        'Observar si la corrección baja al subir el régimen: una fuga fija ' +
          'pierde peso relativo al aumentar el caudal',
        'Prueba de humo en la admisión',
        'Medir presión de combustible en carga',
        'Comparar MAF contra el caudal teórico del motor',
      ],
      params: ['ltft1', 'stft1', 'maf', 'rpm', 'load'],
    };
  },
};

/** Lo simétrico: corrección negativa sostenida. */
const mezclaRica: Rule = {
  id: 'mezcla-rica-adaptativa',
  title: 'Corrección de combustible en el límite negativo',
  requires: ['ltft1'],
  fuel: 'gasolina',
  evaluate(ctx) {
    const ltft = val(ctx, 'ltft1');
    if (ltft === null || ltft > -12) return null;
    const level: FindingLevel = ltft <= -20 ? 'patron-compatible' : 'indicio';
    return {
      ruleId: this.id,
      level,
      title: 'Compatible con exceso de combustible o aire sobreestimado',
      observed:
        `Corrección larga en ${fmt('ltft1', ltft)}. La ECU está quitando ` +
        'combustible de forma sostenida.',
      causes: [
        'Presión de combustible alta: regulador o retorno',
        'Inyector con fuga',
        'MAF que sobreestima el caudal',
        'Filtro de aire obstruido',
        'Sensor de temperatura de refrigerante que informa un motor más frío',
      ],
      check: [
        'Medir presión de combustible y su caída tras el corte',
        'Comparar la temperatura de refrigerante con la real',
        'Revisar el filtro de aire',
      ],
      params: ['ltft1', 'stft1', 'maf', 'coolant'],
    };
  },
};

/**
 * Caudal de aire medido contra el teórico del motor.
 *
 * Esta regla NECESITA la cilindrada. Sin ella no corre: estimar un caudal
 * esperado sin saber el tamaño del motor daría un número inventado, que es
 * exactamente lo que la app no debe hacer.
 */
const mafImplausible: Rule = {
  id: 'maf-vs-teorico',
  title: 'Caudal de aire medido contra el teórico',
  requires: ['maf', 'rpm', 'load'],
  evaluate(ctx) {
    const maf = val(ctx, 'maf');
    const rpm = val(ctx, 'rpm');
    const load = val(ctx, 'load');
    const disp = ctx.displacementL;
    if (maf === null || rpm === null || load === null || disp === undefined) return null;
    if (rpm < 500 || load < 40) return null; // solo tiene sentido con carga

    // Caudal teórico a 100 % de llenado, aire a ~1.18 g/L:
    //   g/s = (rpm / 2 / 60) ciclos * cilindrada * densidad
    const theoretical = (rpm / 120) * disp * 1.18;
    const expected = theoretical * (load / 100);
    if (expected <= 0) return null;
    const ratio = maf / expected;
    if (ratio > 0.75) return null;

    return {
      ruleId: this.id,
      level: 'indicio',
      title: 'Compatible con problema de medición de aire',
      observed:
        `MAF en ${fmt('maf', maf)} con carga de ${fmt('load', load)} a ` +
        `${fmt('rpm', rpm)}. El caudal teórico estimado para ${disp} L es ` +
        `${expected.toFixed(1)} g/s: el medido es un ${Math.round(ratio * 100)} % de eso.`,
      causes: [
        'MAF sucio o fuera de calibración',
        'Fuga de admisión entre el MAF y la mariposa',
        'Filtro de aire obstruido',
        'EGR que recircula más de lo solicitado',
        'Cableado del MAF con mala continuidad',
      ],
      check: [
        'Comparar el MAF en ralentí y en carga',
        'Inspeccionar el filtro y los conductos de admisión',
        'Verificar la posición real de la EGR',
        'Medir alimentación y masa del sensor',
      ],
      params: ['maf', 'rpm', 'load', 'map'],
    };
  },
};

/** Desviación entre boost solicitado y real. El otro ejemplo de la especificación. */
const boostDesviado: Rule = {
  id: 'boost-desviado',
  title: 'Desviación de presión de sobrealimentación',
  requires: ['boost_cmd', 'boost_actual'],
  evaluate(ctx) {
    const cmd = val(ctx, 'boost_cmd');
    const actual = val(ctx, 'boost_actual');
    if (cmd === null || actual === null || cmd <= 0) return null;

    const deltaPct = ((actual - cmd) / cmd) * 100;
    if (Math.abs(deltaPct) < 8) return null;

    const over = deltaPct > 0;
    const level: FindingLevel = Math.abs(deltaPct) >= 15 ? 'patron-compatible' : 'indicio';
    return {
      ruleId: this.id,
      level,
      title: over
        ? 'Compatible con sobrepresión de turbo (overboost)'
        : 'Compatible con falta de presión de turbo (underboost)',
      observed:
        `Boost solicitado ${fmt('boost_cmd', cmd)}, real ` +
        `${fmt('boost_actual', actual)}: una desviación de ` +
        `${deltaPct > 0 ? '+' : ''}${deltaPct.toFixed(1)} %.`,
      causes: over
        ? [
            'Geometría variable trabada por carbonilla',
            'Wastegate que no abre: varilla, cápsula o actuador',
            'Solenoide de control de presión defectuoso',
            'Circuito de vacío de control con fugas',
            'Sensor MAP que informa por debajo de la presión real',
          ]
        : [
            'Fuga en el circuito de aire presurizado o en el intercooler',
            'Geometría variable trabada en baja presión',
            'Contrapresión de escape por DPF saturado',
            'Admisión o filtro obstruidos',
            'Turbo desgastado',
          ],
      check: [
        'Seguir ambos valores en una aceleración completa, no solo en ralentí',
        'Verificar el recorrido del actuador',
        'Comprobar estanqueidad del circuito de control',
        over ? 'Contrastar el MAP con un manómetro externo' : 'Presurizar la admisión para buscar fugas',
      ],
      params: ['boost_cmd', 'boost_actual', 'map', 'rpm', 'load'],
    };
  },
};

/**
 * Presión diferencial de DPF elevada.
 *
 * No hay rango genérico fiable para este parámetro, así que la regla no
 * compara contra una tabla: compara contra sí misma a distintos regímenes,
 * que es lo que de verdad discrimina entre filtro saturado y sensor tapado.
 * En ralentí solo puede marcar una observación.
 */
const dpfSaturado: Rule = {
  id: 'dpf-presion-elevada',
  title: 'Presión diferencial de DPF elevada',
  requires: ['dpf_delta', 'rpm'],
  fuel: 'diesel',
  evaluate(ctx) {
    const delta = val(ctx, 'dpf_delta');
    const rpm = val(ctx, 'rpm');
    if (delta === null || rpm === null) return null;
    // En ralentí, más de ~2 kPa ya es llamativo en un DPF sano.
    if (rpm > 1200 || delta < 2) return null;

    return {
      ruleId: this.id,
      level: 'observacion',
      title: 'Presión diferencial alta para el régimen de ralentí',
      observed:
        `Presión diferencial de ${fmt('dpf_delta', delta)} a ${fmt('rpm', rpm)}. ` +
        'En ralentí el caudal de gases es bajo, así que una diferencia marcada ' +
        'llama la atención.',
      causes: [
        'DPF saturado de hollín',
        'Acumulación de ceniza por kilometraje',
        'Sensor de presión diferencial o sus mangueras obstruidos',
        'Sustrato del filtro dañado',
      ],
      check: [
        'Repetir la medición a 2500-3000 rpm: si la presión NO sube de forma ' +
          'marcada, el problema apunta al sensor o a sus mangueras, no al filtro',
        'Leer carga de hollín y de ceniza en la ECU: requiere diagnóstico de ' +
          'fabricante, no se obtiene por OBD-II genérico',
        'Revisar el historial de regeneraciones',
      ],
      params: ['dpf_delta', 'rpm', 'dpf_inlet_temp', 'dpf_outlet_temp'],
    };
  },
};

/** Sobretemperatura de refrigerante. Simple, pero es el que más importa. */
const sobretemperatura: Rule = {
  id: 'refrigerante-alto',
  title: 'Temperatura de refrigerante elevada',
  requires: ['coolant'],
  evaluate(ctx) {
    const t = val(ctx, 'coolant');
    if (t === null || t < 108) return null;
    return {
      ruleId: this.id,
      level: t >= 115 ? 'patron-compatible' : 'indicio',
      title: 'Temperatura por encima del rango de trabajo',
      observed: `Refrigerante en ${fmt('coolant', t)}.`,
      causes: [
        'Electroventilador que no activa',
        'Termostato trabado cerrado',
        'Nivel de refrigerante bajo o aire en el circuito',
        'Radiador obstruido',
        'Bomba de agua con bajo caudal',
      ],
      check: [
        'Verificar la activación del electroventilador',
        'Revisar nivel y estado del refrigerante',
        'Prueba de actuador sobre el ventilador',
      ],
      params: ['coolant', 'rpm', 'load', 'ambient'],
    };
  },
};

/** Tensión de la red de a bordo fuera de rango con el motor en marcha. */
const cargaElectrica: Rule = {
  id: 'tension-fuera-rango',
  title: 'Tensión de la red de a bordo',
  requires: ['module_voltage', 'rpm'],
  evaluate(ctx) {
    const v = val(ctx, 'module_voltage');
    const rpm = val(ctx, 'rpm');
    if (v === null || rpm === null || rpm < 500) return null;
    if (v >= 13.0 && v <= 15.0) return null;
    const low = v < 13.0;
    return {
      ruleId: this.id,
      level: 'indicio',
      title: low
        ? 'Compatible con falta de carga del alternador'
        : 'Compatible con sobretensión de carga',
      observed: `Tensión de ${fmt('module_voltage', v)} con el motor a ${fmt('rpm', rpm)}.`,
      causes: low
        ? ['Alternador o regulador defectuoso', 'Correa floja o patinando',
           'Masas o cables de carga con resistencia', 'Batería en mal estado']
        : ['Regulador de tensión defectuoso', 'Mala masa del regulador'],
      check: [
        'Medir tensión en bornes de batería con el motor a 2000 rpm',
        'Revisar tensión y estado de la correa',
        'Verificar caída en cables de carga y masas',
      ],
      params: ['module_voltage', 'rpm', 'load'],
    };
  },
};

export const RULES: Rule[] = [
  mezclaPobre,
  mezclaRica,
  mafImplausible,
  boostDesviado,
  dpfSaturado,
  sobretemperatura,
  cargaElectrica,
];

export interface RuleRunResult {
  findings: Finding[];
  skipped: SkippedRule[];
}

/**
 * Corre todas las reglas aplicables.
 *
 * Devuelve también las que no se pudieron evaluar. Eso no es ruido: que una
 * regla de DPF no haya corrido porque falta la presión diferencial es
 * información que el mecánico necesita para no concluir que el DPF está bien.
 */
export function runRules(ctx: RuleContext, available: Set<string>): RuleRunResult {
  const findings: Finding[] = [];
  const skipped: SkippedRule[] = [];

  for (const rule of RULES) {
    if (rule.fuel !== undefined && ctx.fuel !== undefined && rule.fuel !== ctx.fuel) {
      continue; // no aplica a este combustible: no es un salto a informar
    }
    const missing = rule.requires.filter((p) => !available.has(p));
    if (missing.length > 0) {
      skipped.push({
        ruleId: rule.id,
        title: rule.title,
        missing,
        reason: 'La ECU no expone los parámetros necesarios',
      });
      continue;
    }
    if (rule.id === 'maf-vs-teorico' && ctx.displacementL === undefined) {
      skipped.push({
        ruleId: rule.id,
        title: rule.title,
        missing: ['cilindrada'],
        reason:
          'Falta la cilindrada del motor. Sin ese dato no se puede estimar el ' +
          'caudal teórico, y no se evalúa en lugar de comparar contra un número inventado',
      });
      continue;
    }
    const hit = rule.evaluate(ctx);
    if (hit) findings.push(hit);
  }

  const order: Record<FindingLevel, number> = {
    'patron-compatible': 0, indicio: 1, observacion: 2,
  };
  findings.sort((a, b) => order[a.level] - order[b.level]);
  return { findings, skipped };
}
