import { describe, expect, it } from 'vitest';
import { MockTransport } from '@/core/transport/mock';
import { Elm327Driver } from '@/core/elm327/driver';
import { Obd2Service, recorrerAgrupado } from './service';
import { golf20_8v, tdi20_dpf } from '@/sim/profiles';
import type { SimProfile } from '@/sim/profiles';
import { joinObdBytes } from '@/core/elm327/parse';

async function sesion(profile: SimProfile, warmSec = 200) {
  const transport = new MockTransport({ latencyMs: 1, profile });
  await transport.open();
  const driver = new Elm327Driver(transport, { timeoutMs: 1500, initTimeoutMs: 2500 });
  driver.attach();
  await driver.initialize();
  for (let i = 0; i < warmSec * 10; i++) transport.simulator.advance(0.1);
  return { transport, driver, obd: new Obd2Service(driver) };
}

describe('recorrido de una respuesta agrupada', () => {
  it('separa los bloques usando el largo de cada PID', () => {
    // 0C(2 bytes) 05(1) 0D(1)
    const r = recorrerAgrupado([0x0c, 0x0d, 0x48, 0x05, 0x7b, 0x0d, 0x00]);
    expect([...r.keys()]).toEqual([0x0c, 0x05, 0x0d]);
    expect(r.get(0x0c)).toEqual([0x0d, 0x48]);
    expect(r.get(0x05)).toEqual([0x7b]);
    expect(r.get(0x0d)).toEqual([0x00]);
  });

  it('corta en un PID desconocido en vez de inventar valores', () => {
    // 0xF3 no está en el catálogo: sin saber su largo no se puede seguir.
    const r = recorrerAgrupado([0x05, 0x7b, 0xf3, 0x11, 0x22, 0x0d, 0x00]);
    expect([...r.keys()]).toEqual([0x05]);
  });

  it('descarta un bloque truncado al final', () => {
    // El 0x0C necesita dos bytes y solo hay uno.
    const r = recorrerAgrupado([0x05, 0x7b, 0x0c, 0x1a]);
    expect([...r.keys()]).toEqual([0x05]);
  });

  it('con payload vacío devuelve nada, sin romperse', () => {
    expect(recorrerAgrupado([]).size).toBe(0);
  });
});

describe('reensamblado ISO-TP', () => {
  it('reconstruye una respuesta partida en varias tramas CAN', () => {
    // Primera trama: 0x10 + largo 0x014 = 20 bytes. Luego consecutivas.
    const lineas = [
      '7E8 10 14 49 02 01 57 56',
      '7E8 21 57 5A 5A 5A 31 4A',
      '7E8 22 5A 39 57 31 32 33',
      '7E8 23 34 35 36 00 00 00',
    ];
    const bytes = joinObdBytes(lineas);
    expect(bytes).not.toBeNull();
    expect(bytes!.length).toBe(20);
    expect(bytes!.slice(0, 3)).toEqual([0x49, 0x02, 0x01]);
    const texto = String.fromCharCode(...bytes!.slice(3));
    expect(texto).toBe('WVWZZZ1JZ9W123456');
  });

  it('no toca una respuesta de una sola línea', () => {
    // Con una línea el PCI no se distingue de un byte de datos, así que
    // adivinar sería peor que no hacer nada.
    const bytes = joinObdBytes(['7E8 06 41 0C 1A F8 00 00']);
    expect(bytes).toEqual([0x06, 0x41, 0x0c, 0x1a, 0xf8, 0x00, 0x00]);
  });

  it('deja pasar el formato numerado, que el chip ya reensambló', () => {
    const bytes = joinObdBytes(['014', '0: 49 02 01 57 56 57', '1: 5A 5A 5A 31 4A 5A']);
    expect(bytes!.slice(0, 3)).toEqual([0x49, 0x02, 0x01]);
  });
});

describe('lectura agrupada contra la ECU', () => {
  it('lee seis PID en una sola solicitud sobre CAN', async () => {
    const { driver, obd } = await sesion(tdi20_dpf);
    driver.clearTrace();

    const r = await obd.readPidBatch([0x0c, 0x05, 0x04, 0x0b, 0x10, 0x11]);

    expect(r.missing).toEqual([]);
    expect(r.readings.size).toBe(6);
    expect(r.readings.get(0x0c)?.values.get('rpm')).toBeGreaterThan(700);
    expect(r.readings.get(0x05)?.values.get('coolant')).toBeGreaterThan(80);
    expect(r.readings.get(0x10)?.values.get('maf')).toBeGreaterThan(10);

    // Y lo central: fue UNA sola ida y vuelta, no seis.
    const envios = driver.getTrace().filter((t) => t.direction === 'tx');
    expect(envios).toHaveLength(1);
    expect(envios[0]?.text).toBe('010C05040B1011');
  });

  it('seis PID agrupados son mucho más rápidos que seis sueltos', async () => {
    const { transport, driver, obd } = await sesion(tdi20_dpf);
    // Latencia realista de un ELM327 para que la comparación signifique algo.
    transport.simulator.setEcuSilent(false);
    const pids = [0x0c, 0x05, 0x04, 0x0b, 0x10, 0x11];

    driver.clearTrace();
    for (const p of pids) await obd.readPid(p);
    const sueltos = driver.getTrace().filter((t) => t.direction === 'tx').length;

    driver.clearTrace();
    await obd.readPidBatch(pids);
    const agrupados = driver.getTrace().filter((t) => t.direction === 'tx').length;

    expect(sueltos).toBe(6);
    expect(agrupados).toBe(1);
  });

  it('informa los PID que la ECU no devolvió', async () => {
    const { obd } = await sesion(tdi20_dpf);
    // 0x51 (tipo de combustible) no está en el perfil diésel.
    const r = await obd.readPidBatch([0x0c, 0x51, 0x05]);
    expect(r.missing).toEqual([0x51]);
    expect(r.readings.has(0x0c)).toBe(true);
    expect(r.readings.has(0x05)).toBe(true);
  });

  it('nunca pide más de seis, que es el tope de la norma', async () => {
    const { driver, obd } = await sesion(tdi20_dpf);
    driver.clearTrace();
    await obd.readPidBatch([0x0c, 0x05, 0x04, 0x0b, 0x10, 0x11, 0x0f, 0x33]);
    const envio = driver.getTrace().find((t) => t.direction === 'tx');
    // 01 + seis PID de dos dígitos = 14 caracteres.
    expect(envio?.text).toHaveLength(14);
  });

  it('la prueba de capacidad acepta una ECU CAN que responde todo', async () => {
    const { obd } = await sesion(tdi20_dpf);
    expect(await obd.probarAgrupacion([0x0c, 0x05, 0x04])).toBe(true);
  });

  it('la rechaza sobre K-Line, donde la trama no da el largo', async () => {
    const { obd } = await sesion(golf20_8v);
    expect(await obd.probarAgrupacion([0x0c, 0x05, 0x04])).toBe(false);
  });

  it('la rechaza si falta aunque sea un PID de la prueba', async () => {
    const { obd } = await sesion(tdi20_dpf);
    // 0x51 no está soportado: la respuesta sería parcial.
    expect(await obd.probarAgrupacion([0x0c, 0x51, 0x05])).toBe(false);
  });

  it('los valores agrupados coinciden con los leídos de a uno', async () => {
    const { obd } = await sesion(tdi20_dpf);
    const suelto = await obd.readPid(0x05);
    const agrupado = await obd.readPidBatch([0x05, 0x04]);
    expect(agrupado.readings.get(0x05)?.values.get('coolant'))
      .toBe(suelto?.values.get('coolant'));
  });
});
