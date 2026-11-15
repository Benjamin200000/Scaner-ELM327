/**
 * Errores del adaptador y del enlace con la ECU.
 *
 * El requisito es no mostrar nunca "error desconocido": cada caso tiene un
 * código estable, un texto para el mecánico y, cuando aplica, qué hacer.
 */

export type ElmErrorCode =
  | 'no-adapter-response'    // el chip no contestó: cable, baud rate, alimentación
  | 'adapter-rejected'       // el chip respondió '?': comando mal formado
  | 'unable-to-connect'      // el chip no encontró el bus
  | 'bus-init-failed'        // falló la inicialización del protocolo
  | 'no-data'                // el chip habló con el bus pero la ECU no contestó
  | 'bus-error'              // CAN ERROR / DATA ERROR / <DATA ERROR
  | 'buffer-full'            // respuesta más larga de lo que el chip maneja
  | 'stopped'                // operación interrumpida
  | 'searching-timeout'      // quedó en SEARCHING... sin resolver
  | 'timeout'                // no llegó el prompt en el plazo
  | 'bad-response'           // respuesta que no se puede interpretar
  | 'busy';                  // ya hay un comando en curso

export interface ElmErrorInfo {
  title: string;
  advice?: string;
}

const CATALOG: Record<ElmErrorCode, ElmErrorInfo> = {
  'no-adapter-response': {
    title: 'El ELM327 no responde',
    advice:
      'Verificar que el adaptador esté bien enchufado al conector OBD y que el ' +
      'baud rate coincida. Los clones vienen a 38400, 9600 o 115200.',
  },
  'adapter-rejected': {
    title: 'El adaptador rechazó el comando',
    advice: 'El comando no es válido para este chip o su versión de firmware.',
  },
  'unable-to-connect': {
    title: 'No se pudo establecer comunicación con la ECU',
    advice:
      'Dar contacto sin arrancar, confirmar que el vehículo use el protocolo ' +
      'seleccionado y revisar los pines del conector OBD.',
  },
  'bus-init-failed': {
    title: 'Falló la inicialización del bus',
    advice:
      'Típico al forzar un protocolo incorrecto. Probar detección automática ' +
      'o el protocolo específico del vehículo.',
  },
  'no-data': {
    title: 'La ECU no respondió a la solicitud',
    advice:
      'Normal cuando la ECU no soporta ese parámetro o servicio. No indica una falla del vehículo.',
  },
  'bus-error': {
    title: 'Error en el bus de datos',
    advice: 'Interferencia, cableado o un módulo que responde mal. Reintentar y revisar el conector.',
  },
  'buffer-full': {
    title: 'La respuesta excedió el buffer del adaptador',
    advice: 'Pedir menos datos por solicitud o usar un adaptador con firmware más nuevo.',
  },
  stopped: { title: 'Operación interrumpida' },
  'searching-timeout': {
    title: 'El adaptador no terminó de detectar el protocolo',
    advice: 'Seleccionar el protocolo a mano en lugar de usar la detección automática.',
  },
  timeout: {
    title: 'El adaptador no contestó en el plazo esperado',
    advice: 'Enlace lento o inestable. Por Bluetooth, acercar el dispositivo al adaptador.',
  },
  'bad-response': {
    title: 'Respuesta ilegible del adaptador',
    advice: 'Puede ser ruido en el enlace o un baud rate incorrecto.',
  },
  busy: { title: 'Ya hay un comando en curso' },
};

export class ElmError extends Error {
  readonly code: ElmErrorCode;
  /** Comando que la provocó. */
  readonly command?: string;
  /** Texto crudo que devolvió el chip, para el modo debug. */
  readonly raw?: string;

  constructor(code: ElmErrorCode, command?: string, raw?: string) {
    super(CATALOG[code].title);
    this.name = 'ElmError';
    this.code = code;
    if (command !== undefined) this.command = command;
    if (raw !== undefined) this.raw = raw;
  }

  get advice(): string | undefined {
    return CATALOG[this.code].advice;
  }

  /** `no-data` es una respuesta legítima, no un fallo del enlace. */
  get isExpected(): boolean {
    return this.code === 'no-data';
  }
}

export const describeElmError = (code: ElmErrorCode): ElmErrorInfo => CATALOG[code];
