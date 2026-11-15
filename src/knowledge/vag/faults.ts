/**
 * Códigos de falla VAG de 5 dígitos (KW1281 / específicos de fabricante).
 *
 * No son los P-code genéricos de OBD-II: VAG usa su propia numeración de 5
 * dígitos decimales, que trae una ECU por K-Line. Esta tabla cubre los más
 * frecuentes en motores ME7.5 (el del Golf del usuario) y afines.
 *
 * COBERTURA PARCIAL y orientada a ME7. Un código que no esté acá se muestra
 * por su número; no se inventa una descripción. Las descripciones siguen la
 * nomenclatura de VAG difundida por la comunidad (Ross-Tech y afines).
 */

export interface FallaVag {
  codigo: string;
  descripcion: string;
  sistema: string;
}

const F: [string, string, string][] = [
  ['00261', 'Regulador de presión de combustible N276', 'Combustible'],
  ['00518', 'Sensor de posición de mariposa G69', 'Admisión'],
  ['00519', 'Sensor de presión del colector de admisión G71', 'Admisión'],
  ['00520', 'Medidor de masa de aire G70', 'Admisión'],
  ['00522', 'Sensor de temperatura del refrigerante G62', 'Motor'],
  ['00523', 'Sensor de temperatura del aire de admisión G42', 'Admisión'],
  ['00524', 'Sensor de detonación 1 G61', 'Encendido'],
  ['00525', 'Sonda lambda G39 (antes del catalizador)', 'Emisiones'],
  ['00528', 'Sensor de régimen del motor G28', 'Motor'],
  ['00530', 'Potenciómetro de mariposa G88', 'Admisión'],
  ['00532', 'Tensión de alimentación', 'Motor'],
  ['00533', 'Regulación de ralentí', 'Motor'],
  ['00537', 'Regulación lambda / sonda', 'Emisiones'],
  ['00540', 'Sensor de detonación 2 G66', 'Encendido'],
  ['00543', 'Régimen máximo superado (corte)', 'Motor'],
  ['00545', 'Comunicación caja/motor', 'Motor'],
  ['00552', 'Medidor de masa de aire G70: señal muy baja', 'Admisión'],
  ['00553', 'Medidor de masa de aire G70: señal muy alta', 'Admisión'],
  ['00555', 'Sonda lambda: envejecida / lenta', 'Emisiones'],
  ['00558', 'Inyector: resistencia fuera de rango', 'Combustible'],
  ['00560', 'Catalizador: eficiencia por debajo del umbral', 'Emisiones'],
  ['00561', 'Adaptación de mezcla (banco 1): límite alcanzado', 'Combustible'],
  ['00575', 'Presión del colector: regulación fuera de rango', 'Turbo'],
  ['00585', 'Recirculación de gases EGR N18', 'EGR'],
  ['00586', 'Válvula EGR: flujo insuficiente', 'EGR'],
  ['01247', 'Electroválvula de recirculación (turbo) N249', 'Turbo'],
  ['01249', 'Inyectores N30/N31/N32/N33', 'Combustible'],
  ['16486', 'G70 medidor de masa de aire: señal muy baja', 'Admisión'],
  ['16885', 'Flujo EGR insuficiente', 'EGR'],
  ['17536', 'Banco 1: mezcla demasiado pobre', 'Combustible'],
  ['17537', 'Banco 1: mezcla demasiado rica', 'Combustible'],
  ['17705', 'Control de presión de sobrealimentación: límite superado', 'Turbo'],
  ['17707', 'Presión de sobrealimentación: desviación negativa', 'Turbo'],
  ['17964', 'Presión de sobrealimentación: control por debajo del límite', 'Turbo'],
  ['17965', 'Presión de sobrealimentación: control por encima del límite', 'Turbo'],
  ['18010', 'Tensión de alimentación de bornes', 'Motor'],
];

const INDICE = new Map<string, FallaVag>(
  F.map(([codigo, descripcion, sistema]) => [codigo, { codigo, descripcion, sistema }]),
);

/** Devuelve la interpretación de un código VAG, o null si no está en la tabla. */
export const buscarFallaVag = (codigo: string): FallaVag | null =>
  INDICE.get(codigo) ?? null;

export const cantidadFallasVag = (): number => INDICE.size;
