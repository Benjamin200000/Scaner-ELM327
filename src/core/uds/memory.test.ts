import { describe, expect, it } from 'vitest';
import { MockTransport } from '@/core/transport/mock';
import { Elm327Driver } from '@/core/elm327/driver';
import { UdsClient, UdsError } from './client';
import { leerRegion, volcadoHex } from './memory';
import { moduloSimulador } from './modules';
import { algoritmoPrueba, obtenerAlgoritmo } from './security';
import { tdi20_dpf } from '@/sim/profiles';

async function conectar() {
  const transport = new MockTransport({ latencyMs: 1, profile: tdi20_dpf });
  await transport.open();
  const driver = new Elm327Driver(transport, { timeoutMs: 2000, initTimeoutMs: 3000 });
  driver.attach();
  await driver.initialize();
  return { transport, driver };
}

const uds = (driver: Elm327Driver) =>
  new UdsClient(driver, { reqAddr: '7E0', resAddr: '7E8' });

describe('acceso de seguridad', () => {
  it('desbloquea la ECU con la llave correcta', async () => {
    const { driver } = await conectar();
    const c = uds(driver);
    await c.preparar();
    await c.sesion(0x03);
    await expect(c.accesoSeguridad(0x01, algoritmoPrueba)).resolves.toBeUndefined();
  });

  it('rechaza una llave incorrecta con el código de la norma', async () => {
    const { driver } = await conectar();
    const c = uds(driver);
    await c.preparar();
    await c.sesion(0x03);
    const malAlgoritmo = (semilla: number[]) => semilla.map((b) => b ^ 0xff);
    await expect(c.accesoSeguridad(0x01, malAlgoritmo)).rejects.toSatisfy(
      (e: unknown) => e instanceof UdsError && e.nrc === 0x35,
    );
  });

  it('el algoritmo de prueba coincide entre la app y el simulador', () => {
    // Si no coincidieran, el desbloqueo de arriba fallaría; esto lo fija.
    expect(algoritmoPrueba([0x11, 0x22, 0x33, 0x44]))
      .toEqual(obtenerAlgoritmo('sim-prueba')!([0x11, 0x22, 0x33, 0x44]));
  });
});

describe('lectura por subida (0x35/0x36/0x37)', () => {
  it('lee la región de calibración completa y en orden', async () => {
    const { driver } = await conectar();
    const r = await leerRegion(driver, moduloSimulador, moduloSimulador.regiones[1]!);
    expect(r.completa).toBe(true);
    expect(r.datos).toHaveLength(0x200);
    // Byte en 0x10100 de la flash: (0x10100*7 + 0x3b) & 0xff. La región
    // empieza en 0x80010000 → offset 0x10000 de la flash.
    const esperado = (off: number) => (((0x10000 + off) * 7 + 0x3b) & 0xff);
    expect(r.datos[0]).toBe(esperado(0));
    expect(r.datos[0x50]).toBe(esperado(0x50));
    expect(r.datos[0x1ff]).toBe(esperado(0x1ff));
  });

  it('informa el avance por bloques', async () => {
    const { driver } = await conectar();
    const avances: number[] = [];
    await leerRegion(driver, moduloSimulador, moduloSimulador.regiones[1]!, {
      onAvance: (a) => avances.push(a.leido),
    });
    // 0x200 bytes en bloques de 0x40 → avances crecientes hasta el total.
    expect(avances.at(-1)).toBe(0x200);
    expect(avances.length).toBeGreaterThan(1);
    expect([...avances].sort((a, b) => a - b)).toEqual(avances);
  });

  it('lee el encabezado de identificación como texto', async () => {
    const { driver } = await conectar();
    const r = await leerRegion(driver, moduloSimulador, moduloSimulador.regiones[0]!);
    const texto = new TextDecoder().decode(r.datos.slice(0, 18));
    expect(texto).toBe('EDC17-SIM CAL v1.0');
  });

  it('se puede cancelar a mitad de la lectura', async () => {
    const { driver } = await conectar();
    let bloques = 0;
    const r = await leerRegion(driver, moduloSimulador, moduloSimulador.regiones[1]!, {
      onAvance: () => { bloques++; },
      cancelar: () => bloques >= 2,
    });
    expect(r.completa).toBe(false);
    expect(r.motivo).toBe('Cancelado');
    expect(r.datos.length).toBeLessThan(0x200);
  });

  it('sin desbloqueo, una ECU que lo exige rechaza la subida', async () => {
    const { driver } = await conectar();
    const sinSeguridad = {
      ...moduloSimulador,
      seguridad: { nivel: 0, algoritmo: 'ninguno' },
    };
    const r = await leerRegion(driver, sinSeguridad, sinSeguridad.regiones[1]!);
    expect(r.completa).toBe(false);
  });

  it('avisa cuando falta el algoritmo en vez de intentar a ciegas', async () => {
    const { driver } = await conectar();
    const conAlgoDesconocido = {
      ...moduloSimulador,
      seguridad: { nivel: 0x01, algoritmo: 'no-existe' },
    };
    const r = await leerRegion(driver, conAlgoDesconocido, conAlgoDesconocido.regiones[0]!);
    expect(r.completa).toBe(false);
    expect(r.motivo).toMatch(/algoritmo de llave/i);
  });
});

describe('lectura por dirección (0x23)', () => {
  it('lee una región con el método memoria-por-dirección', async () => {
    const { driver } = await conectar();
    // Desbloquear primero, porque este perfil lo exige para 0x35 pero 0x23
    // solo pide sesión extendida.
    const modulo = {
      ...moduloSimulador,
      metodo: 'memoria-por-direccion' as const,
      seguridad: { nivel: 0, algoritmo: 'ninguno' },
      sizeBytes: 1,
      regiones: [{ id: 'x', label: 'Prueba', direccion: 0x8001_0000, tamano: 0x80 }],
    };
    const r = await leerRegion(driver, modulo, modulo.regiones[0]!);
    expect(r.completa).toBe(true);
    expect(r.datos).toHaveLength(0x80);
    expect(r.datos[0]).toBe(((0x10000) * 7 + 0x3b) & 0xff);
  });
});

describe('deja el adaptador limpio', () => {
  it('devuelve la cabecera al modo funcional después de leer', async () => {
    const { driver } = await conectar();
    const obd = new (await import('@/core/obd2/service')).Obd2Service(driver);
    await leerRegion(driver, moduloSimulador, moduloSimulador.regiones[0]!);
    // Si la cabecera quedara apuntando a 7E0, la lectura de códigos
    // funcional seguiría sirviendo porque la ECU de motor contesta igual,
    // pero el VIN por 7DF debe volver a funcionar.
    expect(await obd.readVin()).toBe(tdi20_dpf.vin);
  });
});

describe('volcado hexadecimal', () => {
  it('formatea en líneas de 16 bytes con dirección y ascii', () => {
    const datos = new Uint8Array([0x45, 0x44, 0x43, 0x31, 0x37, 0x00, 0xff]);
    const l = volcadoHex(datos, 0x8000_0000);
    expect(l[0]).toMatch(/^80000000  45 44 43 31 37 00 ff/);
    expect(l[0]).toMatch(/EDC17\.\.$/);
  });
});
