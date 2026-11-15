import { compilarFormula } from './math';
import { type Definicion, type EjeDef, type TablaCompilada, type TablaDef, compilarTabla } from './def';

/**
 * Aplica una definición a un volcado de memoria: ubica cada tabla y la
 * convierte en una grilla de valores físicos con sus ejes.
 *
 * Es solo lectura. No modifica el volcado ni escribe nada: es lo que un
 * afinador usa para ENTENDER un mapa (de inyección, de turbo, de encendido)
 * antes de tocar nada, y para ver qué cambió un remap respecto del original.
 */

export interface TablaLeida {
  def: TablaDef;
  /** Etiquetas del eje X (columnas). */
  x: number[];
  /** Etiquetas del eje Y (filas). */
  y: number[];
  /** Valores físicos [fila][columna]. */
  valores: number[][];
  /** Valores crudos, para el modo técnico y la comparación exacta. */
  crudos: number[][];
  min: number;
  max: number;
  /** Advertencia si la tabla cae fuera del volcado. */
  problema?: string;
}

const leerEntero = (
  dump: Uint8Array, offset: number, bits: number, signed: boolean, bigEndian: boolean,
): number | null => {
  const nBytes = bits / 8;
  if (offset < 0 || offset + nBytes > dump.length) return null;
  let v = 0;
  for (let i = 0; i < nBytes; i++) {
    const b = dump[offset + (bigEndian ? i : nBytes - 1 - i)]!;
    v = v * 256 + b;
  }
  if (signed) {
    const techo = 2 ** bits;
    if (v >= techo / 2) v -= techo;
  }
  return v;
};

function leerEje(dump: Uint8Array, eje: EjeDef | undefined, cantidad: number): number[] {
  if (!eje) return Array.from({ length: cantidad }, (_, i) => i);
  if (eje.etiquetas && eje.etiquetas.length > 0) return eje.etiquetas.slice(0, cantidad);
  if (eje.direccion === undefined) return Array.from({ length: cantidad }, (_, i) => i);
  const conv = compilarFormula(eje.conversion ?? 'X');
  const bits = eje.bits ?? 16;
  const out: number[] = [];
  for (let i = 0; i < cantidad; i++) {
    const crudo = leerEntero(dump, eje.direccion + i * (bits / 8), bits, eje.signed ?? false, eje.bigEndian ?? true);
    out.push(crudo === null ? i : conv(crudo));
  }
  return out;
}

export function leerTabla(dump: Uint8Array, tabla: TablaCompilada): TablaLeida {
  const { def, convZ } = tabla;
  const nBytes = def.bits / 8;
  const valores: number[][] = [];
  const crudos: number[][] = [];
  let min = Infinity;
  let max = -Infinity;
  let problema: string | undefined;

  for (let f = 0; f < def.filas; f++) {
    const filaV: number[] = [];
    const filaC: number[] = [];
    for (let c = 0; c < def.columnas; c++) {
      const offset = def.direccion + (f * def.columnas + c) * nBytes;
      const crudo = leerEntero(dump, offset, def.bits, def.signed, def.bigEndian);
      if (crudo === null) {
        problema = 'La tabla cae fuera del volcado: ¿definición equivocada o volcado incompleto?';
        filaV.push(0); filaC.push(0);
        continue;
      }
      const v = convZ(crudo);
      filaV.push(v); filaC.push(crudo);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    valores.push(filaV);
    crudos.push(filaC);
  }
  if (!Number.isFinite(min)) { min = 0; max = 0; }

  return {
    def,
    x: leerEje(dump, def.ejeX, def.columnas),
    y: leerEje(dump, def.ejeY, def.filas),
    valores,
    crudos,
    min,
    max,
    ...(problema !== undefined ? { problema } : {}),
  };
}

export function leerDefinicion(dump: Uint8Array, def: Definicion): TablaLeida[] {
  return def.tablas.map((t) => leerTabla(dump, compilarTabla(t)));
}

export interface CeldaCambiada {
  fila: number;
  columna: number;
  antes: number;
  despues: number;
}

export interface DiffTabla {
  def: TablaDef;
  /** Celdas cuyo valor crudo cambió. */
  cambios: CeldaCambiada[];
  /** Cantidad total de celdas. */
  celdas: number;
}

/**
 * Compara una misma tabla entre dos volcados (p. ej. original y remap).
 *
 * Trabaja sobre los valores CRUDOS: un cambio es un cambio real en el byte,
 * sin ruido de redondeo de la conversión. Es la base de "¿qué tocó este
 * remap?".
 */
export function compararTabla(
  original: Uint8Array,
  modificado: Uint8Array,
  tabla: TablaCompilada,
): DiffTabla {
  const a = leerTabla(original, tabla);
  const b = leerTabla(modificado, tabla);
  const cambios: CeldaCambiada[] = [];
  for (let f = 0; f < tabla.def.filas; f++) {
    for (let c = 0; c < tabla.def.columnas; c++) {
      if (a.crudos[f]![c] !== b.crudos[f]![c]) {
        cambios.push({ fila: f, columna: c, antes: a.valores[f]![c]!, despues: b.valores[f]![c]! });
      }
    }
  }
  return { def: tabla.def, cambios, celdas: tabla.def.filas * tabla.def.columnas };
}
