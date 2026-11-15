import type { ElmProtocol } from '@/core/elm327/protocols';
import type { AdapterIdentity } from '@/core/elm327/driver';

/**
 * Qué funciones son realmente posibles con el hardware y el protocolo que hay
 * conectado ahora.
 *
 * Existe por un requisito explícito del proyecto: verificar que una función
 * sea técnicamente posible ANTES de ofrecerla. La alternativa habitual —
 * mostrar todos los botones y dejar que fallen — convierte la herramienta en
 * algo en lo que no se puede confiar.
 *
 * Los tres estados son los que pidió la especificación, y el tercero no es un
 * relleno: hay muchísimos casos donde la única respuesta honesta es que no se
 * sabe hasta probarlo en ese vehículo.
 */
export type Support = 'compatible' | 'no-compatible' | 'desconocido';

export const SUPPORT_LABEL: Record<Support, string> = {
  compatible: 'Compatible',
  'no-compatible': 'No compatible',
  desconocido: 'Compatibilidad desconocida',
};

export type FeatureId =
  | 'obd2.dtc.read'
  | 'obd2.dtc.clear'
  | 'obd2.livedata'
  | 'obd2.identity'
  | 'obd2.freezeframe'
  | 'mfr.ecu.identify'
  | 'mfr.dtc.read'
  | 'mfr.measuring.blocks'
  | 'mfr.actuator.test'
  | 'mfr.adaptation'
  | 'mfr.basic.settings'
  | 'mfr.dpf.regen'
  | 'mfr.service.reset';

export interface Feature {
  id: FeatureId;
  label: string;
  /** Genérico OBD-II o específico de fabricante. La app los separa. */
  scope: 'obd2' | 'fabricante';
  /** Modifica el estado de la ECU: exige confirmación. */
  writes: boolean;
  /** Riesgo de dañar algo o mover un componente físicamente. */
  risk: 'ninguno' | 'fisico' | 'ecu';
}

export const FEATURES: Feature[] = [
  { id: 'obd2.dtc.read', label: 'Leer códigos de falla', scope: 'obd2', writes: false, risk: 'ninguno' },
  { id: 'obd2.dtc.clear', label: 'Borrar códigos de falla', scope: 'obd2', writes: true, risk: 'ecu' },
  { id: 'obd2.livedata', label: 'Datos en vivo', scope: 'obd2', writes: false, risk: 'ninguno' },
  { id: 'obd2.identity', label: 'Identificación del vehículo', scope: 'obd2', writes: false, risk: 'ninguno' },
  { id: 'obd2.freezeframe', label: 'Datos congelados', scope: 'obd2', writes: false, risk: 'ninguno' },
  { id: 'mfr.ecu.identify', label: 'Identificación de ECU', scope: 'fabricante', writes: false, risk: 'ninguno' },
  { id: 'mfr.dtc.read', label: 'Códigos específicos de fabricante', scope: 'fabricante', writes: false, risk: 'ninguno' },
  { id: 'mfr.measuring.blocks', label: 'Bloques de medición', scope: 'fabricante', writes: false, risk: 'ninguno' },
  { id: 'mfr.actuator.test', label: 'Pruebas de actuadores', scope: 'fabricante', writes: true, risk: 'fisico' },
  { id: 'mfr.adaptation', label: 'Adaptaciones', scope: 'fabricante', writes: true, risk: 'ecu' },
  { id: 'mfr.basic.settings', label: 'Ajustes básicos', scope: 'fabricante', writes: true, risk: 'fisico' },
  { id: 'mfr.dpf.regen', label: 'Regeneración de DPF', scope: 'fabricante', writes: true, risk: 'fisico' },
  { id: 'mfr.service.reset', label: 'Resets de servicio', scope: 'fabricante', writes: true, risk: 'ecu' },
];

export interface CapabilityVerdict {
  feature: Feature;
  support: Support;
  /** Por qué. Se muestra tal cual al usuario. */
  reason: string;
  /** true cuando la app todavía no implementa la función, aunque sea posible. */
  notImplemented?: boolean;
}

export interface CapabilityInput {
  protocol: ElmProtocol | null;
  adapter: AdapterIdentity | null;
  /** Marca detectada o cargada a mano. */
  make?: string;
}

/**
 * Evalúa todas las funciones contra la conexión actual.
 *
 * Nota importante, y es la razón de que este archivo exista: un ELM327 es un
 * conversor de protocolo, no un equipo de diagnóstico de fabricante. Puede
 * transportar solicitudes KWP2000 arbitrarias, así que las funciones
 * específicas de VAG son ALCANZABLES en principio. Pero cada una depende de
 * la ECU concreta y de su nivel de acceso, y ninguna se puede dar por
 * compatible sin haberla probado en ese vehículo. De ahí que casi todo el
 * bloque de fabricante quede en 'desconocido' y no en 'compatible'.
 */
export function evaluateCapabilities(input: CapabilityInput): CapabilityVerdict[] {
  const { protocol, adapter } = input;

  if (!protocol) {
    return FEATURES.map((feature) => ({
      feature,
      support: 'desconocido' as Support,
      reason: 'Todavía no se detectó el protocolo del vehículo',
    }));
  }

  const isCan = protocol.family === 'can';
  const isKwp = protocol.family === 'kwp';
  const isLegacy = protocol.family === 'iso9141' || protocol.family === 'pwm' ||
    protocol.family === 'vpw';
  const mfrReachable = isCan || isKwp;
  const clone = adapter?.likelyClone === true;

  return FEATURES.map((feature): CapabilityVerdict => {
    // ── OBD-II genérico: la norma lo garantiza en cualquier protocolo ──
    if (feature.scope === 'obd2') {
      if (feature.id === 'obd2.freezeframe') {
        return {
          feature,
          support: 'desconocido',
          reason: 'El modo 02 depende de que haya un código con datos congelados almacenado',
          notImplemented: true,
        };
      }
      return {
        feature,
        support: 'compatible',
        reason: `Servicio estándar OBD-II sobre ${protocol.name}`,
      };
    }

    // ── Específico de fabricante ───────────────────────────────────────
    if (isLegacy) {
      return {
        feature,
        support: 'no-compatible',
        reason:
          `${protocol.name} no transporta servicios de diagnóstico extendido. ` +
          'Con este protocolo solo hay OBD-II genérico.',
      };
    }

    if (!mfrReachable) {
      return {
        feature,
        support: 'desconocido',
        reason: 'No se pudo determinar si el protocolo admite diagnóstico extendido',
      };
    }

    // Caso particular y real: VAG anterior a ~2001 usa KW1281, un protocolo
    // por bloques con handshake byte a byte que el ELM327 NO puede hablar.
    const vag = isVag(input.make);
    if (vag && isKwp) {
      return {
        feature,
        support: 'desconocido',
        reason:
          'Alcanzable si la ECU usa KWP2000. Si usa el protocolo KW1281 por ' +
          'bloques (VAG anterior a ~2001), el ELM327 no puede hablarlo: hace ' +
          'falta una interfaz KKL o un equipo dedicado.',
        notImplemented: true,
      };
    }

    if (clone) {
      return {
        feature,
        support: 'desconocido',
        reason:
          `El adaptador se identifica como ${adapter?.version}, una versión que ` +
          'no existió en el chip original. Los clones suelen no soportar los ' +
          'comandos de header y temporización que estas funciones necesitan.',
        notImplemented: true,
      };
    }

    return {
      feature,
      support: 'desconocido',
      reason:
        `Alcanzable sobre ${protocol.name}, pero depende de la ECU concreta y ` +
        'de su nivel de acceso. No se declara compatible sin haberlo probado ' +
        'en este vehículo.',
      notImplemented: true,
    };
  });
}

const VAG_MAKES = ['volkswagen', 'vw', 'audi', 'seat', 'skoda', 'škoda'];

export const isVag = (make?: string): boolean =>
  make !== undefined && VAG_MAKES.includes(make.toLowerCase());

export const capabilityOf = (
  verdicts: CapabilityVerdict[],
  id: FeatureId,
): CapabilityVerdict | null => verdicts.find((v) => v.feature.id === id) ?? null;

/** Funciones que la app puede ofrecer ahora mismo como botón accionable. */
export const actionableFeatures = (verdicts: CapabilityVerdict[]): CapabilityVerdict[] =>
  verdicts.filter((v) => v.support === 'compatible' && v.notImplemented !== true);
