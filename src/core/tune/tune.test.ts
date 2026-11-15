import { describe, expect, it } from 'vitest';
import { compilarFormula } from './math';
import { compilarTabla, type TablaDef } from './def';
import { compararTabla, leerTabla } from './apply';
import { importarXdf } from './xdf';

describe('evaluador de fórmulas', () => {
  it('resuelve una conversión lineal', () => {
    expect(compilarFormula('0.125 * X')(800)).toBe(100);
  });
  it('resuelve una con offset y paréntesis', () => {
    expect(compilarFormula('(X-128)*0.75')(200)).toBeCloseTo(54, 5);
  });
  it('X sola es la identidad', () => {
    expect(compilarFormula('X')(42)).toBe(42);
  });
  it('rechaza una fórmula con caracteres no permitidos y no ejecuta nada', () => {
    // Intento de colar código: se ignora y se devuelve X tal cual.
    const malicioso = compilarFormula('globalThis.X=1; X');
    expect(malicioso(7)).toBe(7);
  });
});

const tablaBase: TablaDef = {
  id: 't', titulo: 'Prueba', direccion: 0x10, bits: 16, signed: false,
  bigEndian: true, filas: 2, columnas: 3, conversion: '0.1 * X', unidad: 'ms',
  decimales: 1,
};

/** Un volcado con una tabla 2x3 de valores conocidos en big-endian. */
function dumpConTabla(): Uint8Array {
  const d = new Uint8Array(0x40);
  const vals = [100, 200, 300, 400, 500, 600];
  vals.forEach((v, i) => { d[0x10 + i * 2] = (v >> 8) & 0xff; d[0x10 + i * 2 + 1] = v & 0xff; });
  return d;
}

describe('lectura de una tabla', () => {
  it('extrae la grilla con la conversión aplicada', () => {
    const t = leerTabla(dumpConTabla(), compilarTabla(tablaBase));
    expect(t.valores).toEqual([[10, 20, 30], [40, 50, 60]]);
    expect(t.crudos[0]).toEqual([100, 200, 300]);
    expect(t.min).toBe(10);
    expect(t.max).toBe(60);
  });

  it('interpreta big-endian y little-endian distinto', () => {
    const d = new Uint8Array(4);
    d[0] = 0x01; d[1] = 0x00; // BE = 256, LE = 1
    const be = leerTabla(d, compilarTabla({ ...tablaBase, direccion: 0, filas: 1, columnas: 1, conversion: 'X' }));
    const le = leerTabla(d, compilarTabla({ ...tablaBase, direccion: 0, filas: 1, columnas: 1, conversion: 'X', bigEndian: false }));
    expect(be.valores[0]![0]).toBe(256);
    expect(le.valores[0]![0]).toBe(1);
  });

  it('interpreta valores con signo', () => {
    const d = new Uint8Array([0xff, 0xfe]); // -2 con signo de 16 bits
    const con = leerTabla(d, compilarTabla({ ...tablaBase, direccion: 0, filas: 1, columnas: 1, conversion: 'X', signed: true }));
    expect(con.valores[0]![0]).toBe(-2);
  });

  it('avisa cuando la tabla cae fuera del volcado en vez de inventar', () => {
    const t = leerTabla(new Uint8Array(8), compilarTabla(tablaBase));
    expect(t.problema).toMatch(/fuera del volcado/i);
  });

  it('usa las etiquetas de eje fijas cuando las hay', () => {
    const t = leerTabla(dumpConTabla(), compilarTabla({
      ...tablaBase,
      ejeX: { etiquetas: [1000, 2000, 3000] },
      ejeY: { etiquetas: [0, 100] },
    }));
    expect(t.x).toEqual([1000, 2000, 3000]);
    expect(t.y).toEqual([0, 100]);
  });
});

describe('comparación entre volcados (remap vs original)', () => {
  it('encuentra las celdas que cambió un remap', () => {
    const orig = dumpConTabla();
    const mod = dumpConTabla();
    // Subir la celda [1][1] (índice 4) de 500 a 650.
    mod[0x10 + 4 * 2] = (650 >> 8) & 0xff; mod[0x10 + 4 * 2 + 1] = 650 & 0xff;
    const diff = compararTabla(orig, mod, compilarTabla(tablaBase));
    expect(diff.cambios).toHaveLength(1);
    expect(diff.cambios[0]).toMatchObject({ fila: 1, columna: 1, antes: 50, despues: 65 });
    expect(diff.celdas).toBe(6);
  });

  it('dos volcados idénticos no muestran cambios', () => {
    const diff = compararTabla(dumpConTabla(), dumpConTabla(), compilarTabla(tablaBase));
    expect(diff.cambios).toEqual([]);
  });
});

describe('importador XDF', () => {
  const xdf = `<XDFFORMAT><XDFHEADER><baseoffset>0</baseoffset></XDFHEADER>
    <XDFTABLE><title>Mapa de inyección</title><description>prueba</description>
      <XDFAXIS id="x">
        <EMBEDDEDDATA mmedelementsizebits="16"/>
        <LABEL index="0" value="1000"/><LABEL index="1" value="2000"/><LABEL index="2" value="3000"/>
      </XDFAXIS>
      <XDFAXIS id="y">
        <LABEL index="0" value="20"/><LABEL index="1" value="40"/>
      </XDFAXIS>
      <XDFAXIS id="z">
        <EMBEDDEDDATA mmedtypeflags="0x00" mmedaddress="0x10" mmedelementsizebits="16" mmedrowcount="2" mmedcolcount="3"/>
        <units>ms</units><decimalpl>1</decimalpl>
        <MATH equation="0.1 * X"><VAR id="X"/></MATH>
      </XDFAXIS>
    </XDFTABLE></XDFFORMAT>`;

  it('lee título, dirección, dimensiones y conversión de la tabla', () => {
    const def = importarXdf(xdf, 'mi xdf');
    expect(def.tablas).toHaveLength(1);
    const t = def.tablas[0]!;
    expect(t.titulo).toBe('Mapa de inyección');
    expect(t.direccion).toBe(0x10);
    expect(t.filas).toBe(2);
    expect(t.columnas).toBe(3);
    expect(t.unidad).toBe('ms');
    expect(t.ejeX?.etiquetas).toEqual([1000, 2000, 3000]);
  });

  it('la tabla importada se aplica a un volcado y da los valores reales', () => {
    const def = importarXdf(xdf);
    const leida = leerTabla(dumpConTabla(), compilarTabla(def.tablas[0]!));
    expect(leida.valores).toEqual([[10, 20, 30], [40, 50, 60]]);
    expect(leida.x).toEqual([1000, 2000, 3000]);
  });

  it('omite una tabla sin datos ubicables en vez de romperse', () => {
    const sinZ = '<XDFTABLE><title>vacía</title></XDFTABLE>';
    expect(importarXdf(sinZ).tablas).toEqual([]);
  });
});
