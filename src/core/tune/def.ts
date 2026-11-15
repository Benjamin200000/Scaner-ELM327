import { compilarFormula, type Conversion } from './math';

/**
 * Modelo normalizado de una tabla (mapa) de una ECU.
 *
 * Es la forma común a la que se traducen tanto un XDF de TunerPro como una
 * definición nativa. Describe DÓNDE está la tabla en la memoria y CÓMO
 * convertir sus bytes en valores físicos, sin depender del formato de origen.
 *
 * Los motores Bosch ME7 son big-endian (C16x), así que ese es el valor por
 * defecto; una definición puede indicar lo contrario.
 */

export interface EjeDef {
  /** Etiquetas fijas (si el eje no se lee de la memoria). */
  etiquetas?: number[];
  /** O una dirección de memoria de donde leer el eje. */
  direccion?: number;
  bits?: 8 | 16 | 32;
  signed?: boolean;
  bigEndian?: boolean;
  conversion?: string;
  unidad?: string;
}

export interface TablaDef {
  id: string;
  titulo: string;
  descripcion?: string;
  categoria?: string;
  /** Datos (eje Z). */
  direccion: number;
  bits: 8 | 16 | 32;
  signed: boolean;
  bigEndian: boolean;
  filas: number;
  columnas: number;
  conversion: string;
  unidad: string;
  decimales: number;
  min?: number;
  max?: number;
  ejeX?: EjeDef;
  ejeY?: EjeDef;
}

export interface Definicion {
  nombre: string;
  /** Tamaño esperado del .bin, para avisar si no coincide. */
  tamanoBin?: number;
  tablas: TablaDef[];
}

/** Compila las conversiones de una tabla una sola vez. */
export interface TablaCompilada {
  def: TablaDef;
  convZ: Conversion;
  convX: Conversion;
  convY: Conversion;
}

export function compilarTabla(def: TablaDef): TablaCompilada {
  return {
    def,
    convZ: compilarFormula(def.conversion),
    convX: compilarFormula(def.ejeX?.conversion ?? 'X'),
    convY: compilarFormula(def.ejeY?.conversion ?? 'X'),
  };
}
