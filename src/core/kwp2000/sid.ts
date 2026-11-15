/**
 * Identificadores de servicio de KWP2000 (ISO 14230-3) y sus códigos de
 * respuesta negativa.
 *
 * Esta tabla es norma pública y es la base del diagnóstico específico de
 * fabricante en VAG con ECU de K-Line (ME7, EDC15 y similares).
 */

export const SID = {
  startDiagnosticSession: 0x10,
  ecuReset: 0x11,
  clearDiagnosticInformation: 0x14,
  readDtcByStatus: 0x18,
  readEcuIdentification: 0x1a,
  stopDiagnosticSession: 0x20,
  readDataByLocalIdentifier: 0x21,
  readMemoryByAddress: 0x23,
  securityAccess: 0x27,
  writeDataByLocalIdentifier: 0x3b,
  inputOutputControlByLocalIdentifier: 0x30,
  startRoutineByLocalIdentifier: 0x31,
  stopRoutineByLocalIdentifier: 0x32,
  requestRoutineResultsByLocalIdentifier: 0x33,
  testerPresent: 0x3e,
  negativeResponse: 0x7f,
} as const;

/** Códigos de respuesta negativa. El texto explica qué significa de verdad. */
export const NRC: Record<number, string> = {
  0x10: 'Rechazo general',
  0x11: 'Servicio no soportado por esta ECU',
  0x12: 'Subfunción no soportada',
  0x21: 'ECU ocupada, reintentar',
  0x22: 'Condiciones no cumplidas o secuencia incorrecta',
  0x23: 'Enrutamiento incorrecto',
  0x31: 'Identificador fuera de rango',
  0x33: 'Acceso denegado: requiere autenticación de seguridad',
  0x35: 'Clave inválida',
  0x36: 'Se superó la cantidad de intentos',
  0x37: 'Hay que esperar antes de reintentar',
  0x40: 'Descarga no aceptada',
  0x50: 'Carga no aceptada',
  0x71: 'Transferencia de datos suspendida',
  0x78: 'Respuesta pendiente: la ECU necesita más tiempo',
  0x80: 'El servicio no está permitido en la sesión activa',
  0x9a: 'Datos no disponibles',
  0x9b: 'Datos no disponibles por estado del sistema',
};

export const describeNrc = (code: number): string =>
  NRC[code] ?? `Respuesta negativa desconocida (0x${code.toString(16).toUpperCase()})`;

/** Sesiones de diagnóstico de VAG sobre KWP2000. */
export const VAG_SESSION = {
  /** Modo de lectura. Es el único que esta app usa por ahora. */
  default: 0x89,
  /** Sesión ampliada. Habilita adaptaciones y pruebas de actuador. */
  extended: 0x85,
  /** Programación. NO se usa: puede dejar la ECU inutilizable. */
  programming: 0x86,
} as const;
