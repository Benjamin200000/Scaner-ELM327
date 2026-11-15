import { describe, expect, it } from 'vitest';
import { MockTransport } from '@/core/transport/mock';
import { Elm327Driver } from '@/core/elm327/driver';
import { Obd2Service } from '@/core/obd2/service';
import { leerModo06, nombreMonitor, parsearRegistros } from '@/core/obd2/mode06';
import { leerIdentificacionUds } from '@/core/uds/ident';
import { probarAdaptador } from '@/core/elm327/adapterTest';
import { decodificarVin } from '@/knowledge/vin';
import { golf20_8v, tdi20_dpf, tdi20_dsg } from '@/sim/profiles';
import type { SimOptions } from '@/sim/ecu';

async function sesion(opts: SimOptions) {
  const transport = new MockTransport({ latencyMs: 1, ...opts });
  await transport.open();
  const driver = new Elm327Driver(transport, { timeoutMs: 1500, initTimeoutMs: 2500 });
  driver.attach();
  await driver.initialize();
  return { transport, driver, obd: new Obd2Service(driver) };
}

describe('varias ECU en el bus', () => {
  it('atribuye cada código a la unidad que lo informó', async () => {
    const { obd } = await sesion({ profile: tdi20_dsg });
    const dtcs = await obd.readDtcs('stored');
    expect(dtcs.map((d) => `${d.ecu}:${d.code}`)).toEqual(['7E8:P2002', '7E9:P0715']);
  });

  it('registra qué unidades contestaron', async () => {
    const { obd } = await sesion({ profile: tdi20_dsg });
    await obd.discoverSupportedPids();
    expect([...obd.ecusVistas].sort()).toEqual(['7E8', '7E9']);
  });

  it('identifica cada unidad por separado', async () => {
    const { obd } = await sesion({ profile: tdi20_dsg });
    const ecus = await obd.readEcuIdentities();
    expect(ecus.map((e) => e.ecu)).toEqual(['7E8', '7E9']);
    expect(ecus[0]?.name).toBe('EDC17CP14');
    expect(ecus[0]?.calIds).toEqual(['03L906018NQ 9977']);
    expect(ecus[0]?.cvns).toEqual(['8A3F21C4']);
    expect(ecus[1]?.name).toBe('TCM-DSG 02E');
    expect(ecus[1]?.calIds).toEqual(['02E300058P 1305']);
  });

  it('la lectura de parámetros no se contamina con la segunda unidad', async () => {
    const { transport, obd } = await sesion({ profile: tdi20_dsg });
    transport.simulator.advance(5);
    const rpm = await obd.readPid(0x0c);
    expect(rpm?.values.get('rpm')).toBeGreaterThan(700);
  });
});

describe('identificación en K-Line', () => {
  it('lee el VIN, que llega en cinco líneas con checksum', async () => {
    const { obd } = await sesion({ profile: golf20_8v });
    expect(await obd.readVin()).toBe(golf20_8v.vin);
  });

  it('lee calibración, CVN y nombre de la ECU', async () => {
    const { obd } = await sesion({ profile: golf20_8v });
    const [motor] = await obd.readEcuIdentities();
    expect(motor?.ecu).toBe('10');
    expect(motor?.name).toBe('ECM-EngineControl');
    expect(motor?.calIds).toEqual(['06A906032HK 0005']);
    expect(motor?.cvns).toEqual(['5E107B92']);
  });
});

describe('identificación UDS', () => {
  it('lee número de repuesto, software y hardware de la ECU de motor', async () => {
    const { driver } = await sesion({ profile: tdi20_dpf });
    const ids = await leerIdentificacionUds(driver, '7E8');
    const por = new Map(ids.map((d) => [d.did, d.text]));
    expect(por.get(0xf187)).toBe('03L906018NQ');
    expect(por.get(0xf189)).toBe('9977');
    expect(por.get(0xf191)).toBe('03L907309AE');
    expect(por.get(0xf190)).toBe('WVWZZZ1KZAW654321');
  });

  it('omite los identificadores que la ECU no expone, sin inventarlos', async () => {
    const { driver } = await sesion({ profile: tdi20_dpf });
    const ids = await leerIdentificacionUds(driver, '7E8');
    expect(ids.find((d) => d.did === 0xf199)).toBeUndefined();
  });

  it('le habla a la transmisión por su propia dirección', async () => {
    const { driver } = await sesion({ profile: tdi20_dsg });
    const ids = await leerIdentificacionUds(driver, '7E9');
    expect(ids.find((d) => d.did === 0xf187)?.text).toBe('02E927770AL');
  });

  it('devuelve la cabecera al modo funcional al terminar', async () => {
    const { driver, obd } = await sesion({ profile: tdi20_dsg });
    await leerIdentificacionUds(driver, '7E9');
    // Si la cabecera quedara en 7E1, la ECU de motor ya no contestaría.
    const dtcs = await obd.readDtcs('stored');
    expect(dtcs.some((d) => d.ecu === '7E8')).toBe(true);
  });

  it('no se intenta en K-Line', async () => {
    const { driver } = await sesion({ profile: golf20_8v });
    expect(await leerIdentificacionUds(driver, '10')).toEqual([]);
  });
});

describe('modo 06', () => {
  it('lee los resultados y marca el que excede su límite', async () => {
    const { obd } = await sesion({ profile: tdi20_dpf });
    const tests = await leerModo06(obd);
    expect(tests).toHaveLength(4);
    const dpf = tests.find((t) => t.mid === 0xb2);
    expect(dpf?.passed).toBe(false);
    expect(dpf?.value).toBeGreaterThan(dpf!.max);
    expect(tests.filter((t) => t.passed)).toHaveLength(3);
  });

  it('informa qué tan cerca del límite quedó una prueba aprobada', async () => {
    const { obd } = await sesion({ profile: tdi20_dpf });
    const boost = (await leerModo06(obd)).find((t) => t.mid === 0x85);
    expect(boost?.passed).toBe(true);
    // Aprobó, pero en el 93 % de la ventana: está por fallar.
    expect(boost?.position).toBeGreaterThan(90);
  });

  it('no existe en K-Line y devuelve vacío en vez de fallar', async () => {
    const { obd } = await sesion({ profile: golf20_8v });
    expect(await leerModo06(obd)).toEqual([]);
  });

  it('interpreta con signo las escalas de 0x80 en adelante', () => {
    const [t] = parsearRegistros('7E8', [0x21, 0x80, 0x84, 0xff, 0xf6, 0xff, 0x9c, 0x00, 0x64]);
    expect(t?.value).toBe(-10);
    expect(t?.min).toBe(-100);
    expect(t?.passed).toBe(true);
  });

  it('nombra los monitores conocidos y deja null los que no', () => {
    expect(nombreMonitor(0x01)).toEqual({ label: 'Sonda lambda, banco 1 sensor 1', verified: true });
    expect(nombreMonitor(0x06)?.label).toBe('Sonda lambda, banco 2 sensor 2');
    expect(nombreMonitor(0x21)?.verified).toBe(false);
    expect(nombreMonitor(0xee)).toBeNull();
  });
});

describe('prueba del adaptador', () => {
  it('un adaptador completo pasa todo', async () => {
    const { driver } = await sesion({ profile: tdi20_dpf });
    const r = await probarAdaptador(driver);
    expect(r.basicoCompleto).toBe(true);
    expect(r.avanzadoCompleto).toBe(true);
    expect(r.esStn).toBe(false);
  });

  it('un clon queda marcado como apto solo para OBD-II genérico', async () => {
    const { driver } = await sesion({ profile: tdi20_dpf, clon: true });
    const r = await probarAdaptador(driver);
    expect(r.basicoCompleto).toBe(true);
    expect(r.avanzadoCompleto).toBe(false);
    expect(r.veredicto).toMatch(/OBD-II genérico/);
    expect(r.resultados.find((x) => x.comando === 'ATAL')?.respuesta).toBe('?');
  });

  it('deja el adaptador funcionando después de la prueba', async () => {
    const { driver, obd } = await sesion({ profile: tdi20_dsg });
    await probarAdaptador(driver);
    const dtcs = await obd.readDtcs('stored');
    expect(dtcs.map((d) => d.ecu)).toEqual(['7E8', '7E9']);
  });
});

describe('decodificación de VIN', () => {
  it('identifica fabricante, país y año modelo', () => {
    const v = decodificarVin('WVWZZZ1KZAW654321', 2026);
    expect(v.valid).toBe(true);
    expect(v.manufacturer).toBe('Volkswagen');
    expect(v.country).toBe('Alemania');
    expect(v.modelYear).toBe(2010);
    expect(v.serial).toBe('654321');
  });

  it('reconoce las camionetas que más circulan en Chile', () => {
    expect(decodificarVin('MR0FB8CD3H0123456').manufacturer).toBe('Toyota');
    expect(decodificarVin('MR0FB8CD3H0123456').country).toBe('Tailandia');
    expect(decodificarVin('MMBJNKL30KH012345').manufacturer).toBe('Mitsubishi');
    expect(decodificarVin('8AFAR23L5KJ123456').manufacturer).toBe('Ford');
  });

  it('resuelve el ciclo de 30 años hacia el año más reciente posible', () => {
    expect(decodificarVin('WVWZZZ1JZ9W123456', 2026).modelYear).toBe(2009);
    expect(decodificarVin('WVWZZZ1JZYW123456', 2026).modelYear).toBe(2000);
    expect(decodificarVin('WVWZZZ1JZSW123456', 2026).modelYear).toBe(2025);
    expect(decodificarVin('WVWZZZ1JZTW123456', 2026).modelYear).toBe(2026);
  });

  it('un fabricante que no está en la tabla queda sin identificar, con su región', () => {
    const v = decodificarVin('XYZAB12C3DE456789');
    expect(v.manufacturer).toBeNull();
    expect(v.country).toBe('Europa');
  });

  it('rechaza un VIN mal formado diciendo por qué', () => {
    expect(decodificarVin('WVW123').problem).toMatch(/17/);
    expect(decodificarVin('WVWZZZ1JZ9O123456').problem).toMatch(/I, O o Q/);
  });
});
