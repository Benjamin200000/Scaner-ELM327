import type { ReferenceRange } from '../types';

/**
 * Rangos de referencia genéricos.
 *
 * COBERTURA DELIBERADAMENTE CORTA. Un rango equivocado es peor que no tener
 * rango: hace que la app marque fallas inexistentes y que el mecánico
 * desconfíe de todo lo demás.
 *
 * Solo están acá los parámetros cuyo rango es razonablemente universal para
 * un motor a temperatura de régimen. Los que dependen del motor concreto
 * (presión de riel, boost, presión diferencial de DPF, caudal de MAF) NO
 * tienen rango genérico a propósito: la app los muestra con el valor y con
 * "rango de referencia no disponible" hasta que exista una entrada para ese
 * vehículo, o hasta que el usuario cargue una medición propia.
 */

const taller = { source: 'practica-taller' } as const;
const norma = { source: 'norma', reference: 'SAE J1979' } as const;

/** El motor tiene que estar caliente para que varios rangos tengan sentido. */
const MOTOR_CALIENTE = { paramId: 'coolant', min: 75 };

export const GENERIC_RANGES: ReferenceRange[] = [
  {
    paramId: 'coolant',
    min: 80,
    max: 105,
    warnAbove: 110,
    unit: '°C',
    conditions:
      'Motor a temperatura de régimen, con termostato cerrado. Antes de los ' +
      '7 minutos de marcha el rango no aplica: un motor que todavía no ' +
      'calentó no es una anomalía',
    // Sin esta condición, cada arranque en frío se marcaría como ATENCIÓN.
    // La sobretemperatura sigue cubierta por la regla 'refrigerante-alto',
    // que no depende de este rango y por lo tanto actúa desde el segundo
    // cero.
    requires: [{ paramId: 'run_time', min: 420 }],
    provenance: taller,
  },
  {
    // El testigo encendido no es un dato a interpretar: es una falla.
    paramId: 'mil',
    max: 0,
    warnAbove: 0,
    unit: '',
    conditions: 'Testigo de avería (MIL). 0 = apagado, 1 = encendido',
    provenance: norma,
  },
  {
    paramId: 'dtc_count',
    max: 0,
    warnAbove: 0,
    unit: '',
    conditions: 'Cantidad de códigos confirmados que informa la ECU',
    provenance: norma,
  },
  {
    // Control de plausibilidad, no de "normalidad": fuera de esta banda el
    // sensor está en circuito abierto o en cortocircuito, no hace ese frío.
    paramId: 'iat',
    min: -40,
    max: 80,
    warnBelow: -39,
    warnAbove: 120,
    unit: '°C',
    conditions:
      'Banda de plausibilidad del sensor, no de temperatura ambiente. Un ' +
      'valor pegado a -40 °C suele ser circuito abierto',
    provenance: taller,
  },
  {
    paramId: 'module_voltage',
    min: 13.2,
    max: 14.8,
    warnBelow: 12.8,
    warnAbove: 15.0,
    unit: 'V',
    conditions: 'Motor en marcha, con el alternador cargando',
    requires: [{ paramId: 'rpm', min: 400 }],
    provenance: taller,
  },
  {
    paramId: 'stft1',
    min: -10,
    max: 10,
    warnBelow: -15,
    warnAbove: 15,
    unit: '%',
    conditions: 'Motor caliente, en lazo cerrado y carga estable',
    requires: [MOTOR_CALIENTE],
    provenance: taller,
  },
  {
    paramId: 'ltft1',
    min: -10,
    max: 10,
    warnBelow: -15,
    warnAbove: 15,
    unit: '%',
    conditions: 'Motor caliente, en lazo cerrado. Más de ±25 % es el límite de adaptación',
    requires: [MOTOR_CALIENTE],
    provenance: taller,
  },
  {
    paramId: 'lambda_cmd',
    min: 0.97,
    max: 1.03,
    unit: 'λ',
    conditions: 'Lazo cerrado, carga parcial. En plena carga la ECU enriquece a propósito',
    requires: [MOTOR_CALIENTE, { paramId: 'load', max: 70 }],
    provenance: norma,
  },
  {
    paramId: 'baro',
    min: 80,
    max: 105,
    unit: 'kPa',
    conditions: 'Depende de la altitud: ~101 kPa a nivel del mar, ~85 kPa a 1500 m',
    provenance: norma,
  },
  {
    paramId: 'oil_temp',
    min: 80,
    max: 120,
    warnAbove: 130,
    unit: '°C',
    conditions: 'Motor a temperatura de régimen',
    requires: [MOTOR_CALIENTE],
    provenance: taller,
  },
  {
    paramId: 'egr_error',
    min: -10,
    max: 10,
    unit: '%',
    conditions: 'Diferencia entre EGR solicitada y real, en condición estable',
    provenance: taller,
  },
  // ── Rangos de ralentí: solo válidos con el vehículo detenido ──────────
  {
    paramId: 'rpm',
    min: 700,
    max: 950,
    warnBelow: 600,
    warnAbove: 1100,
    unit: 'rpm',
    conditions: 'Ralentí, motor caliente, sin consumidores eléctricos grandes',
    requires: [MOTOR_CALIENTE, { paramId: 'speed', max: 0 }],
    provenance: taller,
  },
];

/**
 * Entradas específicas por vehículo.
 *
 * Esta lista está vacía a propósito. Es el punto de crecimiento de la base:
 * cada rango que se agregue acá tiene que venir de documentación del
 * fabricante o de una medición real sobre ese motor, con su `provenance`
 * declarada. Agregar números plausibles pero no verificados rompería la
 * garantía central de la app.
 */
export const VEHICLE_RANGES: ReferenceRange[] = [];
