import type { ElmProtocol } from '@/core/elm327/protocols';
import type { Dtc } from '@/core/obd2/dtc';
import type { KwpResponse } from '@/core/kwp2000/service';

/**
 * Funciones de servicio: rutinas que ESCRIBEN en la ECU.
 *
 * Todo el diseño de este módulo parte de una asimetría: una lectura
 * equivocada muestra un número mal, una escritura equivocada puede dejar el
 * vehículo peor que antes. Por eso acá hay cosas que no existen en el resto
 * del sistema:
 *
 *  - Precondiciones evaluadas contra datos reales, no una lista para tildar
 *    a mano. Si una no se cumple, la rutina no arranca.
 *  - Un estado 'indeterminada' para la precondición que no se puede
 *    verificar. En una rutina de riesgo físico, no poder verificar bloquea
 *    igual que no cumplir: no saber si el motor está detenido no es lo mismo
 *    que saber que lo está.
 *  - Modo simulación, que arma la secuencia completa y muestra byte por byte
 *    lo que se enviaría SIN enviar nada. Es el modo por defecto para toda
 *    rutina cuya secuencia no esté verificada contra una ECU real.
 *  - Cada rutina declara si su secuencia fue verificada y de dónde sale.
 */

export type RoutineRisk = 'lectura' | 'escritura' | 'fisico';

export const RISK_LABEL: Record<RoutineRisk, string> = {
  lectura: 'Solo lectura',
  escritura: 'Escribe en la ECU',
  fisico: 'Acciona componentes',
};

export type PreconditionState = 'cumplida' | 'no-cumplida' | 'indeterminada';

export interface RoutineContext {
  protocol: ElmProtocol | null;
  /** Valores actuales de los parámetros. */
  values: ReadonlyMap<string, number | null>;
  /** Parámetros que la ECU expone. */
  available: ReadonlySet<string>;
  dtcs: Dtc[];
  /** Tensión medida por el adaptador en el pin 16. */
  voltage: number | null;
  make?: string | undefined;
}

export interface PreconditionResult {
  state: PreconditionState;
  /** Qué se midió, para mostrarlo al lado de la condición. */
  observed: string;
}

export interface Precondition {
  id: string;
  label: string;
  /** Por qué importa. Se muestra: una condición sin motivo se saltea sola. */
  rationale: string;
  check(ctx: RoutineContext): PreconditionResult;
}

export interface RoutineStep {
  label: string;
  /** Qué hace este paso, en castellano. Se muestra en modo simulación. */
  explain: string;
  writes: boolean;
  /** Header de direccionamiento (ATSH) si difiere del de la rutina. */
  header?: string;
  sid: number;
  payload: number[];
  /** Milisegundos de espera antes del paso siguiente. */
  settleMs?: number;
  /** Interpreta la respuesta positiva. Devuelve texto para el informe. */
  interpret?(res: KwpResponse): string;
}

export interface ServiceRoutine {
  id: string;
  label: string;
  description: string;
  risk: RoutineRisk;
  scope: 'obd2' | 'fabricante';
  /** Familias de protocolo que pueden transportarla. */
  families: ElmProtocol['family'][];
  /** Marcas a las que aplica. Vacío = cualquiera. */
  makes?: string[];
  /** Header de direccionamiento por defecto. */
  header?: string;
  /**
   * ¿La secuencia fue verificada contra una ECU real?
   *
   * Si es false, la UI solo habilita el modo simulación. No es una
   * formalidad: una secuencia de escritura sacada de documentación sin
   * confirmar es exactamente la clase de cosa que rompe un vehículo.
   */
  verified: boolean;
  /** De dónde sale la secuencia. Se muestra siempre. */
  sourceNote: string;
  preconditions: Precondition[];
  steps: RoutineStep[];
  /** Qué pasa después de ejecutarla, para que el usuario sepa qué esperar. */
  afterNote?: string;
}

export type StepStatus =
  | 'pendiente'
  | 'enviando'
  | 'ok'
  | 'rechazado'
  | 'error'
  | 'omitido';

export interface StepOutcome {
  index: number;
  step: RoutineStep;
  status: StepStatus;
  /** Hexadecimal exacto que se enviaría o se envió. */
  request: string;
  response?: string;
  detail?: string;
  elapsedMs?: number;
}

export type RunMode = 'simulacion' | 'real';

export interface RunResult {
  mode: RunMode;
  routine: ServiceRoutine;
  outcomes: StepOutcome[];
  completed: boolean;
  /** Motivo del corte, si no se completó. */
  abortedBecause?: string;
  startedAt: number;
  finishedAt: number;
}
