/**
 * Tipos de la base de conocimiento.
 *
 * El requisito central del proyecto es no inventar información. Eso no se
 * logra con buenas intenciones al escribir texto: se logra haciendo que el
 * tipo de dato OBLIGUE a declarar de dónde sale cada afirmación y a admitir
 * cuando no se sabe.
 *
 * De ahí dos decisiones:
 *
 * 1. Toda búsqueda devuelve `T | null`. No hay valores por defecto ni textos
 *    de relleno. Si no hay entrada, la UI dice "no disponible".
 *
 * 2. Todo dato de referencia lleva `source` y `appliesTo`. Un rango de
 *    presión diferencial de DPF sacado de un manual genérico no vale lo
 *    mismo que uno medido en esa ECU, y la UI lo tiene que poder mostrar
 *    distinto.
 */

/** De dónde viene la afirmación. Determina cuánto se puede confiar. */
export type Source =
  /** Norma pública: SAE J1979, ISO 15031, ISO 14229. */
  | 'norma'
  /** Documentación técnica del fabricante. */
  | 'fabricante'
  /** Práctica de taller ampliamente aceptada, sin fuente única. */
  | 'practica-taller'
  /** Medido en este vehículo y guardado por el usuario. */
  | 'medido'
  /** Sin verificar. Se muestra marcado o no se muestra. */
  | 'sin-verificar';

export interface Provenance {
  source: Source;
  /** Referencia concreta cuando existe: norma, manual, ECU. */
  reference?: string;
}

/** A qué vehículos aplica una entrada. Vacío = genérico. */
export interface AppliesTo {
  make?: string;
  model?: string;
  engine?: string;
  ecu?: string;
  yearFrom?: number;
  yearTo?: number;
  fuel?: 'gasolina' | 'diesel';
}

export type DtcPriority = 'alta' | 'media' | 'baja';

/**
 * Interpretación de un código de falla.
 *
 * Nada acá afirma que una pieza esté defectuosa. `causes` son hipótesis a
 * verificar y `checkParams` dice con qué parámetros verificarlas. Esa
 * distinción entre dato anormal y diagnóstico confirmado es deliberada.
 */
export interface DtcKnowledge {
  code: string;
  /** Descripción normalizada del código. */
  description: string;
  system: string;
  priority: DtcPriority;
  /** Qué detectó la ECU, en lenguaje claro. */
  meaning: string;
  /** Hipótesis ordenadas de más a menos frecuente. Nunca conclusiones. */
  causes: string[];
  /** Ids de parámetros a observar para avanzar en el diagnóstico. */
  checkParams: string[];
  /** Pruebas concretas a realizar. */
  tests: string[];
  /** Qué lectura apoyaría la hipótesis y qué la descartaría. */
  confirmsIf?: string[];
  rulesOutIf?: string[];
  provenance: Provenance;
  appliesTo?: AppliesTo;
}

/**
 * Rango de referencia de un parámetro.
 *
 * `conditions` existe porque un rango sin condiciones suele ser inútil o
 * engañoso: la presión diferencial de un DPF depende del régimen y del
 * caudal, y dar un número fijo haría que la app marque fallas inexistentes.
 */
export interface ReferenceRange {
  paramId: string;
  min?: number;
  max?: number;
  /** Rango dentro del cual hay que prestar atención sin que sea falla. */
  warnBelow?: number;
  warnAbove?: number;
  unit: string;
  /** Condiciones bajo las que el rango es válido. */
  conditions: string;
  /** Precondiciones verificables sobre otros parámetros. */
  requires?: RangeCondition[];
  provenance: Provenance;
  appliesTo?: AppliesTo;
}

/** Precondición sobre otro parámetro para que el rango aplique. */
export interface RangeCondition {
  paramId: string;
  min?: number;
  max?: number;
}

export const SOURCE_LABEL: Record<Source, string> = {
  norma: 'Norma',
  fabricante: 'Fabricante',
  'practica-taller': 'Práctica de taller',
  medido: 'Medido en este vehículo',
  'sin-verificar': 'Sin verificar',
};

/** Cuánto peso dar a cada origen al elegir entre entradas que compiten. */
export const SOURCE_WEIGHT: Record<Source, number> = {
  medido: 5,
  fabricante: 4,
  norma: 3,
  'practica-taller': 2,
  'sin-verificar': 0,
};
