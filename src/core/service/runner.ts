import type { Elm327Driver } from '@/core/elm327/driver';
import { ElmError } from '@/core/elm327/errors';
import { Kwp2000Service, KwpError } from '@/core/kwp2000/service';
import { evaluatePreconditions } from './preconditions';
import type {
  Precondition,
  PreconditionResult,
  RoutineContext,
  RunMode,
  RunResult,
  ServiceRoutine,
  StepOutcome,
} from './types';

/**
 * Ejecutor de rutinas de servicio.
 *
 * Las reglas que impone, y que la interfaz no puede saltear porque están
 * acá y no en un componente:
 *
 *  1. Una rutina sin pasos no se ejecuta nunca, ni en simulación.
 *  2. Una rutina no verificada solo corre en modo simulación.
 *  3. Las precondiciones se evalúan SIEMPRE, también en simulación, para
 *     que el usuario vea qué le faltaría antes de armarla de verdad.
 *  4. En modo real, si una precondición bloquea, no se envía ni un byte.
 *  5. Si un paso falla a mitad de camino, se corta. No se sigue "a ver si
 *     anda": una secuencia a medias es peor que una no empezada.
 */

export interface GateResult {
  allowed: boolean;
  /** Por qué no se puede, en texto para mostrar. */
  reasons: string[];
  preconditions: { precondition: Precondition; result: PreconditionResult }[];
}

/**
 * Decide si una rutina puede correr en el modo pedido.
 *
 * Separado de la ejecución a propósito: la interfaz necesita mostrar el
 * veredicto antes de que el usuario toque nada.
 */
export function gate(
  routine: ServiceRoutine,
  ctx: RoutineContext,
  mode: RunMode,
): GateResult {
  const reasons: string[] = [];
  const preconditions = evaluatePreconditions(routine.preconditions, ctx);

  if (routine.steps.length === 0) {
    reasons.push('Esta rutina no tiene una secuencia implementada todavía');
  }

  if (mode === 'real' && !routine.verified) {
    reasons.push(
      'La secuencia no está verificada contra una ECU real. Solo se puede ' +
      'correr en modo simulación hasta confirmarla',
    );
  }

  const family = ctx.protocol?.family;
  if (family === undefined) {
    reasons.push('No hay un protocolo activo');
  } else if (!routine.families.includes(family)) {
    reasons.push(
      `${ctx.protocol?.name ?? 'El protocolo activo'} no puede transportar esta rutina`,
    );
  }

  if (routine.makes !== undefined && routine.makes.length > 0) {
    const make = ctx.make?.toLowerCase();
    if (make === undefined) {
      reasons.push('Hace falta indicar la marca del vehículo: esta rutina es específica');
    } else if (!routine.makes.includes(make)) {
      reasons.push(`Esta rutina es específica de ${routine.makes[0]} y derivadas`);
    }
  }

  // En modo real, las precondiciones mandan.
  if (mode === 'real') {
    for (const { precondition, result } of preconditions) {
      if (result.state === 'no-cumplida') {
        reasons.push(`${precondition.label}: ${result.observed}`);
      }
      // En una rutina de riesgo físico, no poder verificar una condición
      // pesa igual que saber que no se cumple.
      if (result.state === 'indeterminada' && routine.risk === 'fisico') {
        reasons.push(
          `${precondition.label}: no se pudo verificar (${result.observed})`,
        );
      }
    }
  }

  return { allowed: reasons.length === 0, reasons, preconditions };
}

export interface RunOptions {
  mode: RunMode;
  /** Se llama con cada cambio de estado, para que la UI siga el avance. */
  onProgress?: (outcomes: StepOutcome[]) => void;
  /** Permite abortar desde la interfaz entre pasos. */
  shouldAbort?: () => boolean;
}

export class ServiceRunner {
  private readonly kwp: Kwp2000Service;

  constructor(private readonly driver: Elm327Driver) {
    this.kwp = new Kwp2000Service(driver);
  }

  async run(
    routine: ServiceRoutine,
    ctx: RoutineContext,
    options: RunOptions,
  ): Promise<RunResult> {
    const startedAt = Date.now();
    const verdict = gate(routine, ctx, options.mode);

    const outcomes: StepOutcome[] = routine.steps.map((step, index) => ({
      index,
      step,
      status: 'pendiente',
      request: toHex(step.sid, step.payload),
    }));

    if (!verdict.allowed) {
      for (const o of outcomes) o.status = 'omitido';
      options.onProgress?.(outcomes);
      return {
        mode: options.mode,
        routine,
        outcomes,
        completed: false,
        abortedBecause: verdict.reasons.join('. '),
        startedAt,
        finishedAt: Date.now(),
      };
    }

    // En simulación no se abre el enlace ni se envía nada: se arma la
    // secuencia y se muestra. Es el modo pensado para contrastar los bytes
    // contra la documentación del vehículo antes de armarla de verdad.
    if (options.mode === 'simulacion') {
      for (const o of outcomes) {
        o.status = 'ok';
        o.detail = o.step.explain;
      }
      options.onProgress?.(outcomes);
      return {
        mode: 'simulacion',
        routine,
        outcomes,
        completed: true,
        startedAt,
        finishedAt: Date.now(),
      };
    }

    // ── Ejecución real ────────────────────────────────────────────────
    let aborted: string | undefined;
    const needsKeepAlive = routine.steps.some((s) => s.writes);

    try {
      if (routine.header !== undefined) {
        await this.kwp.setAddress(routine.header);
      }
      if (needsKeepAlive && routine.scope === 'fabricante') {
        this.kwp.startKeepAlive();
      }

      for (const outcome of outcomes) {
        if (options.shouldAbort?.() === true) {
          aborted = 'Cancelada por el usuario';
          break;
        }
        const { step } = outcome;
        outcome.status = 'enviando';
        options.onProgress?.([...outcomes]);

        const t0 = Date.now();
        try {
          if (step.header !== undefined) await this.kwp.setAddress(step.header);

          const res = routine.scope === 'obd2'
            ? await this.rawObd(step.sid, step.payload)
            : await this.kwp.request(step.sid, step.payload, 5000);

          outcome.elapsedMs = Date.now() - t0;
          outcome.response = res.bytes.map(hex2).join(' ');

          if (!res.positive) {
            outcome.status = 'rechazado';
            outcome.detail = res.nrcText ?? 'La ECU rechazó la solicitud';
            aborted = `${step.label}: ${outcome.detail}`;
            break;
          }

          outcome.status = 'ok';
          outcome.detail = step.interpret?.(res) ?? step.explain;
        } catch (err) {
          outcome.elapsedMs = Date.now() - t0;
          outcome.status = 'error';
          outcome.detail = describeError(err);
          aborted = `${step.label}: ${outcome.detail}`;
          break;
        }

        options.onProgress?.([...outcomes]);
        if (step.settleMs !== undefined) await delay(step.settleMs);
      }
    } finally {
      this.kwp.stopKeepAlive();
    }

    // Los pasos que quedaron sin correr se marcan omitidos, no pendientes:
    // pendiente sugiere que todavía van a pasar.
    for (const o of outcomes) {
      if (o.status === 'pendiente' || o.status === 'enviando') o.status = 'omitido';
    }
    options.onProgress?.([...outcomes]);

    return {
      mode: 'real',
      routine,
      outcomes,
      completed: aborted === undefined,
      ...(aborted !== undefined ? { abortedBecause: aborted } : {}),
      startedAt,
      finishedAt: Date.now(),
    };
  }

  /** Servicios OBD-II: no llevan la envoltura de KWP2000. */
  private async rawObd(sid: number, payload: number[]) {
    const res = await this.driver.send(toHex(sid, payload).replace(/\s/g, ''), {
      timeoutMs: 5000,
    });
    const bytes = res.lines
      .join('')
      .replace(/[^0-9A-Fa-f]/g, '')
      .match(/.{2}/g)
      ?.map((h) => parseInt(h, 16)) ?? [];
    const positive = bytes.includes(sid + 0x40);
    return { bytes, positive, data: bytes, ...(positive ? {} : {
      nrcText: 'La ECU no confirmó la operación',
    }) };
  }
}

const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');

const toHex = (sid: number, payload: number[]): string =>
  [sid, ...payload].map(hex2).join(' ');

function describeError(err: unknown): string {
  if (err instanceof KwpError) return err.nrcText;
  if (err instanceof ElmError) return err.advice !== undefined
    ? `${err.message}. ${err.advice}`
    : err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
