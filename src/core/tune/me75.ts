import type { Definicion } from './def';

/**
 * Definición nativa de referencia para Bosch ME7.5 (1.8T).
 *
 * Son los mapas canónicos de afinación de ME7, con sus dimensiones, escalas y
 * unidades REALES, tomados de una definición XDF de la comunidad (NefMoto)
 * para la ECU 8E0909518AK (Audi A4 B6 1.8T).
 *
 * ADVERTENCIA IMPORTANTE SOBRE LAS DIRECCIONES:
 * Las direcciones son propias de ESA versión de software. En otra ECU —otra
 * marca, otro motor, otra calibración— los mismos mapas están en OTRAS
 * direcciones. El Golf 2.0 8V del usuario es un motor atmosférico distinto:
 * no tiene los mapas de turbo (LDRXN) y sus direcciones no coinciden.
 *
 * Por eso esta definición sirve para dos cosas honestas:
 *   1. Como ejemplo con las escalas y dimensiones correctas de cada mapa.
 *   2. Como punto de partida: en la pantalla se puede EDITAR la dirección de
 *      cada tabla hasta que, sobre tu propio volcado, el mapa tenga sentido
 *      (ejes crecientes, valores plausibles). Así se adapta a tu ROM.
 *
 * Lo que es durable acá son las escalas y las dimensiones; las direcciones son
 * un punto de arranque a verificar, no un dato cerrado. Requiere un volcado
 * del ROM completo, no de una región suelta.
 *
 * ME7 es little-endian (núcleo C167): por eso bigEndian es false en todas.
 */
export const defMe75Referencia: Definicion = {
  nombre: 'ME7.5 1.8T (referencia · verificar direcciones)',
  tablas: [
    {
      id: 'kfmirl',
      titulo: 'KFMIRL · Par/carga solicitada',
      descripcion: 'Cuánta carga pide el pedal. El mapa central de la respuesta del motor.',
      categoria: 'Par',
      direccion: 0x1efbe, bits: 16, signed: false, bigEndian: false,
      filas: 16, columnas: 16, conversion: '0.023438 * X', unidad: '%', decimales: 1,
      ejeX: { direccion: 0x1ef7e, bits: 16, bigEndian: false, conversion: 'X/4', unidad: 'rpm' },
      ejeY: { direccion: 0x1ef9e, bits: 16, bigEndian: false, conversion: '0.001526 * X', unidad: '' },
    },
    {
      id: 'ldrxn',
      titulo: 'LDRXN · Límite de sobrealimentación',
      descripcion: 'Carga máxima permitida (límite de presión de turbo). No existe en motores atmosféricos.',
      categoria: 'Turbo',
      direccion: 0x29734, bits: 16, signed: false, bigEndian: false,
      filas: 1, columnas: 16, conversion: '0.023438 * X', unidad: '%', decimales: 1,
      ejeX: { direccion: 0x1ef7e, bits: 16, bigEndian: false, conversion: 'X/4', unidad: 'rpm' },
    },
    {
      id: 'ldrxnzk',
      titulo: 'LDRXNZK · Límite de turbo con detonación',
      descripcion: 'Límite de carga reducido cuando hay detonación.',
      categoria: 'Turbo',
      direccion: 0x29776, bits: 16, signed: false, bigEndian: false,
      filas: 1, columnas: 16, conversion: '0.023438 * X', unidad: '%', decimales: 1,
      ejeX: { direccion: 0x1ef7e, bits: 16, bigEndian: false, conversion: 'X/4', unidad: 'rpm' },
    },
    {
      id: 'kfzw',
      titulo: 'KFZW · Avance de encendido',
      descripcion: 'Ángulo de encendido por régimen y carga.',
      categoria: 'Encendido',
      direccion: 0x12856, bits: 8, signed: true, bigEndian: false,
      filas: 16, columnas: 12, conversion: '0.75 * X', unidad: '° KW', decimales: 2,
    },
    {
      id: 'kfzw2',
      titulo: 'KFZW2 · Avance de encendido 2',
      descripcion: 'Segundo mapa de encendido (según temperatura/mapa activo).',
      categoria: 'Encendido',
      direccion: 0x12916, bits: 8, signed: true, bigEndian: false,
      filas: 16, columnas: 12, conversion: '0.75 * X', unidad: '° KW', decimales: 2,
    },
    {
      id: 'mlhfm',
      titulo: 'MLHFM · Linealización del caudalímetro',
      descripcion: 'Tabla que convierte la tensión del MAF en caudal de aire. La toca un remap de MAF.',
      categoria: 'Admisión',
      direccion: 0x143da, bits: 16, signed: false, bigEndian: false,
      filas: 512, columnas: 1, conversion: '0.1 * X', unidad: 'kg/h', decimales: 1,
    },
    {
      id: 'krkte',
      titulo: 'KRKTE · Constante de inyección',
      descripcion: 'Relaciona el tiempo de inyección con la masa de combustible.',
      categoria: 'Combustible',
      direccion: 0x1f82a, bits: 16, signed: false, bigEndian: false,
      filas: 1, columnas: 1, conversion: '0.000167 * X', unidad: 'ms', decimales: 4,
    },
    {
      id: 'lamfa',
      titulo: 'LAMFA · Enriquecimiento a plena carga',
      descripcion: 'Lambda objetivo a carga alta (cuánto enriquece para proteger).',
      categoria: 'Combustible',
      direccion: 0x26be2, bits: 8, signed: false, bigEndian: false,
      filas: 15, columnas: 6, conversion: '0.007813 * X', unidad: 'λ', decimales: 3,
    },
  ],
};
