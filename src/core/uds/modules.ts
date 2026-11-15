import type { VehicleIdentity } from '@/core/obd2/service';

/**
 * Módulos de lectura de ECU.
 *
 * Un módulo describe CÓMO leer la memoria de una familia de ECU: qué sesión
 * abrir, si hace falta acceso de seguridad y con qué algoritmo, por qué
 * método leer, y qué regiones de memoria tienen sentido (la calibración, el
 * programa completo, etc.).
 *
 * Es la misma idea que los "módulos" de PCMFlash, con una diferencia honesta:
 * esta app trae solo el módulo del simulador y un módulo manual. Un módulo
 * para una ECU real necesita su algoritmo de llave y su mapa de direcciones,
 * que son propios de cada ECU y que la app no inventa. Se agregan conectando
 * el algoritmo (security.ts) y definiendo las regiones.
 *
 * NINGÚN módulo escribe. La escritura de flash es la única operación que deja
 * una ECU inservible si sale mal, y no se incluye.
 */

export type MetodoLectura = 'memoria-por-direccion' | 'subida';

export interface RegionMemoria {
  id: string;
  label: string;
  direccion: number;
  tamano: number;
  /** Qué es esto, en una línea. */
  nota?: string;
}

export interface EcuModule {
  id: string;
  label: string;
  /** Marcas y ECU a las que aplica, para orientar. */
  aplica: string;
  reqAddr: string;
  resAddr: string;
  /** Sesión a abrir antes de leer (0x03 extendida, 0x02 programación). */
  sesion: number;
  seguridad: {
    /** Nivel del servicio 0x27. 0 = no hace falta. */
    nivel: number;
    /** Id del algoritmo en el registro de security.ts. */
    algoritmo: string;
  };
  metodo: MetodoLectura;
  /** Bytes que ocupan la dirección y el tamaño en las solicitudes. */
  addrBytes: number;
  sizeBytes: number;
  regiones: RegionMemoria[];
  /** true = probado solo contra el simulador, nunca contra hardware. */
  soloSimulador: boolean;
}

/**
 * Módulo del vehículo simulado.
 *
 * Existe para verificar el flujo completo —sesión, desbloqueo, lectura por
 * bloques— sin hardware. Sus direcciones y su algoritmo son de juguete.
 */
export const moduloSimulador: EcuModule = {
  id: 'sim-edc17',
  label: 'Simulador EDC17 (prueba)',
  aplica: 'Solo el vehículo simulado de esta app',
  reqAddr: '7E0',
  resAddr: '7E8',
  sesion: 0x03,
  seguridad: { nivel: 0x01, algoritmo: 'sim-prueba' },
  metodo: 'subida',
  addrBytes: 4,
  sizeBytes: 4,
  regiones: [
    { id: 'id', label: 'Bloque de identificación', direccion: 0x8000_0000, tamano: 0x40,
      nota: 'Encabezado con nombre y versión' },
    { id: 'cal', label: 'Calibración', direccion: 0x8001_0000, tamano: 0x200,
      nota: 'La zona de mapas y parámetros' },
  ],
  soloSimulador: true,
};

/**
 * Módulo manual.
 *
 * Para cuando conocés la dirección y el tamaño de lo que querés leer de TU
 * ECU (de la documentación de la comunidad). La región se completa desde la
 * interfaz. El algoritmo de seguridad se elige aparte; si tu ECU lee sin
 * desbloqueo, se usa "ninguno".
 */
export const moduloManual: EcuModule = {
  id: 'manual',
  label: 'Manual (dirección y tamaño a mano)',
  aplica: 'Cualquier ECU CAN para la que conozcas la dirección a leer',
  reqAddr: '7E0',
  resAddr: '7E8',
  sesion: 0x03,
  seguridad: { nivel: 0x00, algoritmo: 'ninguno' },
  metodo: 'memoria-por-direccion',
  addrBytes: 4,
  sizeBytes: 2,
  regiones: [],
  soloSimulador: false,
};

export const MODULOS: EcuModule[] = [moduloSimulador, moduloManual];

export const moduloPorId = (id: string): EcuModule | null =>
  MODULOS.find((m) => m.id === id) ?? null;

/** Módulos cuyo direccionamiento coincide con lo identificado en el vehículo. */
export function modulosSugeridos(_identity: VehicleIdentity): EcuModule[] {
  // Sin una base de ECU reales, no hay match automático fiable. Se ofrecen
  // todos y el usuario elige; inventar una sugerencia sería peor.
  return MODULOS;
}
