import type { Definicion } from './def';

/**
 * Definiciones nativas incluidas.
 *
 * La del simulador apunta a la región de calibración que devuelve la lectura
 * de memoria del vehículo simulado, para mostrar el visor de mapas funcionando
 * de punta a punta sin un XDF ni un auto. Sus tablas son de demostración: el
 * contenido del simulador es un relleno determinista, no mapas reales.
 *
 * Para un auto de verdad se importa un XDF de la comunidad (ver pantalla).
 */
export const defSimulador: Definicion = {
  nombre: 'Simulador (demostración)',
  tamanoBin: 0x200,
  tablas: [
    {
      id: 'sim-iny',
      titulo: 'Tabla de ejemplo A',
      descripcion: 'Región de calibración del simulador, 8×8',
      categoria: 'Demostración',
      direccion: 0x00,
      bits: 16,
      signed: false,
      bigEndian: true,
      filas: 8,
      columnas: 8,
      conversion: '0.01 * X',
      unidad: 'ms',
      decimales: 2,
      ejeX: { etiquetas: [700, 1000, 1500, 2000, 3000, 4000, 5000, 6000], unidad: 'rpm' },
      ejeY: { etiquetas: [10, 20, 30, 40, 50, 60, 70, 80], unidad: '%' },
    },
    {
      id: 'sim-turbo',
      titulo: 'Tabla de ejemplo B',
      descripcion: 'Otra zona de la región, 6×8',
      categoria: 'Demostración',
      direccion: 0x80,
      bits: 16,
      signed: false,
      bigEndian: true,
      filas: 6,
      columnas: 8,
      conversion: '0.001 * X',
      unidad: 'bar',
      decimales: 2,
      ejeX: { etiquetas: [700, 1000, 1500, 2000, 3000, 4000, 5000, 6000], unidad: 'rpm' },
      ejeY: { etiquetas: [20, 40, 60, 80, 100, 120], unidad: '%' },
    },
  ],
};
