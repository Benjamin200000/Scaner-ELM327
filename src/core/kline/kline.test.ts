import { describe, expect, it } from 'vitest';
import { decodificarMedicion } from './formulas';
import { armarBloque, leerBloque, Titulo } from './block';
import { Kw1281Engine } from './engine';
import { EcuKlineSimulada, perfilGolfMe7 } from './sim';

describe('fórmulas de medición VAG', () => {
  it('régimen: 0.2 * A * B', () => {
    const m = decodificarMedicion(1, 10, 200);
    expect(m.value).toBe(400);
    expect(m.text).toBe('400 rpm');
  });
  it('temperatura: A * (B-100) * 0.1', () => {
    expect(decodificarMedicion(5, 103, 110).value).toBeCloseTo(103, 0);
    expect(decodificarMedicion(5, 103, 110).unit).toBe('°C');
  });
  it('tensión: 0.001 * A * B con dos decimales', () => {
    expect(decodificarMedicion(6, 100, 140).text).toBe('14.00 V');
  });
  it('caudal de aire: B*1.421 + A/182', () => {
    expect(decodificarMedicion(25, 182, 10).value).toBeCloseTo(15.21, 1);
  });
  it('las fórmulas de estado devuelven texto, no número', () => {
    expect(decodificarMedicion(10, 0, 0).value).toBeNull();
    expect(decodificarMedicion(10, 0, 0).text).toBe('Frío');
    expect(decodificarMedicion(10, 0, 1).text).toBe('Caliente');
    expect(decodificarMedicion(29, 100, 50).text).toBe('Mapa 1');
  });
  it('un código desconocido se muestra crudo, no inventado', () => {
    expect(decodificarMedicion(200, 5, 6).value).toBeNull();
    expect(decodificarMedicion(200, 5, 6).text).toBe('(200 5 6)');
  });
  it('código 0 es un campo vacío', () => {
    expect(decodificarMedicion(0, 0, 0).text).toBe('—');
  });
});

describe('códec de bloques', () => {
  it('arma y lee un bloque conservando contenido', () => {
    const bytes = armarBloque(5, Titulo.leerGrupo, [3]);
    // longitud = datos(1) + contador + título + fin = 4.
    expect(bytes).toEqual([4, 5, 0x29, 3]);
    const b = leerBloque(bytes);
    expect(b).toEqual({ contador: 5, titulo: 0x29, datos: [3] });
  });
  it('un bloque ACK no tiene datos', () => {
    const b = leerBloque(armarBloque(9, Titulo.ack, []));
    expect(b).toEqual({ contador: 9, titulo: 0x09, datos: [] });
  });
  it('rechaza un bloque cuya longitud no cuadra', () => {
    expect(leerBloque([9, 1, 0x29, 3])).toBeNull(); // dice 6 datos, hay 1
  });
});

describe('sesión KW1281 contra la ECU simulada', () => {
  const nuevo = () => new Kw1281Engine(new EcuKlineSimulada(perfilGolfMe7));

  it('conecta y lee la identificación', async () => {
    const e = nuevo();
    const id = await e.conectar(0x01);
    expect(e.protocolo).toBe(1281);
    expect(id.numeroRepuesto).toBe('06A906032HK');
    expect(id.extra).toContain('2.0l R4/2V ME7.5');
  });

  it('lee un grupo de medición y lo decodifica con las fórmulas', async () => {
    const e = nuevo();
    await e.conectar(0x01);
    const g = await e.leerGrupo(1);
    expect(g.mediciones).toHaveLength(4);
    // El primer triplete del grupo 1 es régimen: 0.2*10*200 = 400 rpm.
    expect(g.mediciones[0]!.text).toBe('400 rpm');
    expect(g.mediciones[1]!.unit).toBe('°C');
  });

  it('un grupo inexistente devuelve lista vacía, no un error', async () => {
    const e = nuevo();
    await e.conectar(0x01);
    const g = await e.leerGrupo(99);
    expect(g.mediciones).toEqual([]);
  });

  it('lee las fallas y separa presentes de esporádicas', async () => {
    const e = nuevo();
    await e.conectar(0x01);
    const fallas = await e.leerFallas();
    expect(fallas.map((f) => f.codigo)).toEqual(['00561', '00552']);
    expect(fallas[0]!.presente).toBe(true);   // estado 0x24, sin bit 0x80
    expect(fallas[1]!.presente).toBe(false);  // estado 0xA4, con bit 0x80
  });

  it('mantiene el turno estricto en lecturas sucesivas', async () => {
    const e = nuevo();
    await e.conectar(0x01);
    // Varias operaciones seguidas no deben descolocar el contador ni colgar.
    await e.leerGrupo(1);
    const g3 = await e.leerGrupo(3);
    await e.mantenerViva();
    const fallas = await e.leerFallas();
    expect(g3.mediciones.length).toBeGreaterThan(0);
    expect(fallas.length).toBe(2);
  });

  it('una unidad que no está en el bus no conecta', async () => {
    const e = new Kw1281Engine(new EcuKlineSimulada(perfilGolfMe7));
    await expect(e.conectar(0x17)).rejects.toThrow(/no responde/i);
  });

  it('desconecta sin romperse aunque el enlace ya esté cerrado', async () => {
    const e = nuevo();
    await e.conectar(0x01);
    await expect(e.desconectar()).resolves.toBeUndefined();
  });
});
