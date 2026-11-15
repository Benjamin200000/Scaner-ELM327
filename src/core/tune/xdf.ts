import type { Definicion, EjeDef, TablaDef } from './def';

/**
 * Importador de definiciones TunerPro XDF (subconjunto).
 *
 * XDF es el formato más difundido de la comunidad para describir los mapas de
 * una ECU: dirección, tamaño, dimensiones y fórmula de conversión de cada
 * tabla. Esta función lee lo esencial —título, eje Z (datos) y ejes X/Y— para
 * poder abrir definiciones reales sin depender de un parser de XML completo.
 *
 * Es un subconjunto: ignora lo que no hace falta para ver una tabla
 * (banderas, constantes, funciones). Una tabla que use algo no soportado se
 * lee igual con la conversión por defecto, nunca con datos inventados.
 *
 * Referencia de formato: archivos XDF de la comunidad (TunerPro RT).
 */

const attr = (tag: string, nombre: string): string | null => {
  const m = new RegExp(`${nombre}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  return m ? m[1]! : null;
};

const num = (s: string | null): number | null => {
  if (s === null) return null;
  const v = s.trim().toLowerCase().startsWith('0x') ? parseInt(s, 16) : Number(s);
  return Number.isFinite(v) ? v : null;
};

const texto = (bloque: string, tag: string): string | null => {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(bloque);
  return m ? m[1]!.trim() : null;
};

/** Extrae un eje (x/y/z) de un bloque XDFTABLE. */
function parseEje(bloqueTabla: string, id: string): {
  embedded: string | null;
  equation: string;
  unidad: string;
  decimales: number | null;
  etiquetas: number[];
} | null {
  const re = new RegExp(`<XDFAXIS\\s+id="${id}"[\\s\\S]*?</XDFAXIS>`, 'i');
  const m = re.exec(bloqueTabla);
  if (!m) return null;
  const eje = m[0];
  const emb = /<EMBEDDEDDATA[^>]*\/?>/i.exec(eje)?.[0] ?? null;
  const eq = attr(/<MATH[^>]*>/i.exec(eje)?.[0] ?? '', 'equation') ?? 'X';
  const etiquetas: number[] = [];
  for (const lm of eje.matchAll(/<LABEL[^>]*value="([^"]*)"[^>]*\/?>/gi)) {
    const v = Number(lm[1]);
    if (Number.isFinite(v)) etiquetas.push(v);
  }
  return {
    embedded: emb,
    equation: eq,
    unidad: texto(eje, 'units') ?? '',
    decimales: num(texto(eje, 'decimalpl')),
    etiquetas,
  };
}

function ejeDef(eje: ReturnType<typeof parseEje>): EjeDef | undefined {
  if (!eje) return undefined;
  if (eje.etiquetas.length > 0) {
    return { etiquetas: eje.etiquetas, conversion: eje.equation, unidad: eje.unidad };
  }
  const dir = eje.embedded ? num(attr(eje.embedded, 'mmedaddress')) : null;
  if (dir === null) return undefined;
  const bits = (num(attr(eje.embedded!, 'mmedelementsizebits')) ?? 16) as 8 | 16 | 32;
  const flags = num(attr(eje.embedded!, 'mmedtypeflags')) ?? 0;
  return { direccion: dir, bits, signed: (flags & 0x01) !== 0, bigEndian: true, conversion: eje.equation, unidad: eje.unidad };
}

export function importarXdf(xml: string, nombre = 'XDF importado'): Definicion {
  const tablas: TablaDef[] = [];
  const baseOffset = num(texto(xml, 'baseoffset')) ?? 0;

  let i = 0;
  for (const tm of xml.matchAll(/<XDFTABLE[\s\S]*?<\/XDFTABLE>/gi)) {
    const bloque = tm[0];
    const titulo = texto(bloque, 'title') ?? `Tabla ${i + 1}`;
    const z = parseEje(bloque, 'z');
    if (!z || !z.embedded) { i++; continue; } // sin datos ubicables: se omite

    const dir = num(attr(z.embedded, 'mmedaddress'));
    if (dir === null) { i++; continue; }
    const bits = (num(attr(z.embedded, 'mmedelementsizebits')) ?? 16) as 8 | 16 | 32;
    const flags = num(attr(z.embedded, 'mmedtypeflags')) ?? 0;
    const filas = num(attr(z.embedded, 'mmedrowcount')) ?? 1;
    const columnas = num(attr(z.embedded, 'mmedcolcount')) ?? 1;

    const ex = ejeDef(parseEje(bloque, 'x'));
    const ey = ejeDef(parseEje(bloque, 'y'));

    tablas.push({
      id: `xdf-${i}`,
      titulo,
      ...(texto(bloque, 'description') ? { descripcion: texto(bloque, 'description')! } : {}),
      direccion: dir + baseOffset,
      bits,
      signed: (flags & 0x01) !== 0,
      bigEndian: true,
      filas: Math.max(1, filas),
      columnas: Math.max(1, columnas),
      conversion: z.equation,
      unidad: z.unidad,
      decimales: z.decimales ?? 2,
      ...(ex ? { ejeX: ex } : {}),
      ...(ey ? { ejeY: ey } : {}),
    });
    i++;
  }

  return { nombre, tablas };
}
