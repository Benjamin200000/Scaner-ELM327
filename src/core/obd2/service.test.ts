import { describe, expect, it } from 'vitest';
import { MockTransport } from '@/core/transport/mock';
import { Elm327Driver } from '@/core/elm327/driver';
import { Obd2Service } from './service';
import { golf20_8v, tdi20_dpf } from '@/sim/profiles';
import type { SimProfile } from '@/sim/profiles';
import { decodeDtc, parseDtcPayload } from './dtc';

async function session(profile: SimProfile, advanceSec = 200) {
  const transport = new MockTransport({ latencyMs: 1, profile });
  await transport.open();
  const driver = new Elm327Driver(transport, { timeoutMs: 1000, initTimeoutMs: 2000 });
  driver.attach();
  await driver.initialize();
  // Llevar el motor a temperatura, para leer valores de régimen estable.
  for (let i = 0; i < advanceSec * 10; i++) transport.simulator.advance(0.1);
  return { transport, driver, obd: new Obd2Service(driver) };
}

describe('descubrimiento de PID', () => {
  it('encuentra exactamente los PID que declara el perfil gasolina', async () => {
    const { obd } = await session(golf20_8v);
    const supported = await obd.discoverSupportedPids();
    const expected = golf20_8v.supportedPids.map((h) => parseInt(h, 16)).sort();
    expect([...supported].sort()).toEqual(expected);
  });

  it('no incluye PID de bloque como si fueran parámetros', async () => {
    const { obd } = await session(tdi20_dpf);
    const supported = await obd.discoverSupportedPids();
    for (const base of [0x00, 0x20, 0x40, 0x60]) {
      expect(supported.has(base)).toBe(false);
    }
  });

  it('el perfil gasolina no ofrece PID de DPF y el diésel sí', async () => {
    const gas = await session(golf20_8v);
    const dsl = await session(tdi20_dpf);
    const gasPids = await gas.obd.discoverSupportedPids();
    const dslPids = await dsl.obd.discoverSupportedPids();
    expect(gasPids.has(0x7a)).toBe(false);
    expect(gasPids.has(0x7c)).toBe(false);
    expect(dslPids.has(0x7a)).toBe(true);
    expect(dslPids.has(0x7c)).toBe(true);
  });
});

describe('lectura de parámetros', () => {
  it('decodifica el bloque clásico con valores plausibles', async () => {
    const { obd } = await session(golf20_8v);

    const rpm = await obd.readPid(0x0c);
    expect(rpm?.values.get('rpm')).toBeGreaterThan(750);
    expect(rpm?.values.get('rpm')).toBeLessThan(900);

    const coolant = await obd.readPid(0x05);
    expect(coolant?.values.get('coolant')).toBeGreaterThan(85);
    expect(coolant?.values.get('coolant')).toBeLessThan(92);

    const maf = await obd.readPid(0x10);
    expect(maf?.values.get('maf')).toBeGreaterThan(2.5);
    expect(maf?.values.get('maf')).toBeLessThan(4);
  });

  it('recupera la corrección larga alta del escenario P0171', async () => {
    const { obd } = await session(golf20_8v);
    const ltft = await obd.readPid(0x07);
    // El perfil simula mezcla pobre compensada: ~19.5 %.
    expect(ltft?.values.get('ltft1')).toBeGreaterThan(17);
    expect(ltft?.values.get('ltft1')).toBeLessThan(22);
  });

  it('un PID entrega varios parámetros a la vez', async () => {
    const { obd } = await session(tdi20_dpf);
    const dpfTemp = await obd.readPid(0x7c);
    expect(dpfTemp?.values.get('dpf_inlet_temp')).toBeGreaterThan(200);
    expect(dpfTemp?.values.get('dpf_outlet_temp')).toBeGreaterThan(200);
    // La entrada está más caliente que la salida, como corresponde.
    const inlet = dpfTemp?.values.get('dpf_inlet_temp') ?? 0;
    const outlet = dpfTemp?.values.get('dpf_outlet_temp') ?? 0;
    expect(inlet).toBeGreaterThan(outlet);
  });

  it('sobrevive la ida y vuelta de la presión diferencial del DPF', async () => {
    const { transport, obd } = await session(tdi20_dpf);
    const expectedMbar = transport.simulator.snapshot().dpfDiffMbar;
    const reading = await obd.readPid(0x7a);
    const kpa = reading?.values.get('dpf_delta') ?? 0;
    // El simulador trabaja en mbar; el PID viaja en kPa.
    expect(kpa * 10).toBeCloseTo(expectedMbar, 0);
  });

  it('recupera el overboost del escenario diésel', async () => {
    const { obd } = await session(tdi20_dpf);
    const boost = await obd.readPid(0x70);
    const cmd = boost?.values.get('boost_cmd') ?? 0;
    const actual = boost?.values.get('boost_actual') ?? 0;
    expect(actual).toBeGreaterThan(cmd);
    // ~1180 mbar reales contra ~1010 solicitados, expresado en kPa.
    expect(actual - cmd).toBeGreaterThan(10);
  });

  it('devuelve null cuando la ECU no soporta el PID', async () => {
    const { obd } = await session(golf20_8v);
    await expect(obd.readPid(0x7a)).rejects.toThrow();
  });
});

describe('códigos de falla', () => {
  it('decodifica los cuatro grupos', () => {
    expect(decodeDtc(0x01, 0x71)).toBe('P0171');
    expect(decodeDtc(0x20, 0x02)).toBe('P2002');
    expect(decodeDtc(0x43, 0x21)).toBe('C0321');
    expect(decodeDtc(0x81, 0x05)).toBe('B0105');
    expect(decodeDtc(0xc1, 0x23)).toBe('U0123');
  });

  it('descarta los rellenos 0000', () => {
    expect(decodeDtc(0x00, 0x00)).toBeNull();
  });

  it('lee los confirmados en KWP, que rellena la trama', async () => {
    const { obd } = await session(golf20_8v);
    const dtcs = await obd.readDtcs('stored');
    expect(dtcs.map((d) => d.code)).toEqual(['P0171']);
  });

  it('lee los confirmados en CAN, que lleva byte de cantidad', async () => {
    const { obd } = await session(tdi20_dpf);
    const dtcs = await obd.readDtcs('stored');
    expect(dtcs.map((d) => d.code)).toEqual(['P2002']);
  });

  it('separa pendientes de confirmados', async () => {
    const { obd } = await session(tdi20_dpf);
    const pending = await obd.readDtcs('pending');
    expect(pending.map((d) => d.code)).toEqual(['P0234']);
    expect(pending[0]?.kind).toBe('pending');
  });

  it('devuelve lista vacía cuando no hay códigos de ese tipo', async () => {
    const { obd } = await session(golf20_8v);
    expect(await obd.readDtcs('permanent')).toEqual([]);
  });

  it('el borrado hace desaparecer los códigos', async () => {
    const { obd } = await session(tdi20_dpf);
    expect((await obd.readDtcs('stored')).length).toBe(1);
    await obd.clearDtcs();
    expect(await obd.readDtcs('stored')).toEqual([]);
  });

  it('no confunde un contador CAN con el byte alto de un DTC', () => {
    // P0102 empieza con 0x01, igual que un contador de "1 código".
    // Sin byte de cantidad, la lectura correcta son dos códigos.
    // El mismo payload, leído según el protocolo, da códigos distintos.
    // Por eso el parser exige saberlo en lugar de adivinar.
    const kwp = parseDtcPayload([0x01, 0x02, 0x03, 0x00], 'stored', false);
    expect(kwp.map((d) => d.code)).toEqual(['P0102', 'P0300']);

    const can = parseDtcPayload([0x01, 0x02, 0x03, 0x00], 'stored', true);
    expect(can.map((d) => d.code)).toEqual(['P0203']);
  });
});

describe('identificación por modo 09', () => {
  it('reconstruye el VIN de una respuesta multilínea', async () => {
    const { obd } = await session(tdi20_dpf);
    const id = await obd.readIdentity();
    expect(id.vin).toBe(tdi20_dpf.vin);
  });

  it('recupera el nombre de ECU y la calibración', async () => {
    const { obd } = await session(golf20_8v);
    const id = await obd.readIdentity();
    expect(id.ecuName).toBe(golf20_8v.ecuName);
    expect(id.calibrationId).toBe(golf20_8v.calId);
  });
});
