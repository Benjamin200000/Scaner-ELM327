import { describe, expect, it } from 'vitest';
import { MockTransport } from '@/core/transport/mock';
import { Elm327Driver } from '@/core/elm327/driver';
import { DiagnosticSession } from '@/core/session';
import { Kwp2000Service, KwpError } from '@/core/kwp2000/service';
import { gate, ServiceRunner } from './runner';
import {
  borrarCodigos,
  leerIntervaloServicio,
  regeneracionDpf,
  resetIntervaloServicio,
  ROUTINES,
} from './routines';
import type { RoutineContext } from './types';
import { golf20_8v, tdi20_dpf } from '@/sim/profiles';
import type { SimProfile } from '@/sim/profiles';
import { protocolById } from '@/core/elm327/protocols';

async function rig(profile: SimProfile = golf20_8v) {
  const transport = new MockTransport({ latencyMs: 1, profile });
  await transport.open();
  const driver = new Elm327Driver(transport, { timeoutMs: 1500, initTimeoutMs: 2000 });
  driver.attach();
  await driver.initialize();
  return { transport, driver, kwp: new Kwp2000Service(driver) };
}

const ctx = (over: Partial<RoutineContext> = {}): RoutineContext => ({
  protocol: protocolById('5'),
  values: new Map<string, number | null>([
    ['rpm', 0], ['speed', 0], ['coolant', 88], ['fuel_level', 60],
  ]),
  available: new Set(['rpm', 'speed', 'coolant', 'fuel_level']),
  dtcs: [],
  voltage: 12.6,
  make: 'Volkswagen',
  ...over,
});

describe('capa KWP2000', () => {
  it('abre y cierra una sesión de diagnóstico', async () => {
    const { transport, kwp } = await rig();
    await kwp.setAddress('8110F1');
    const res = await kwp.startSession(0x85);
    expect(res.positive).toBe(true);
    expect(transport.simulator.kwpSession).toBe(0x85);
    await kwp.stopSession();
    expect(transport.simulator.kwpSession).toBe(0x81);
  });

  it('traduce la respuesta negativa a texto entendible', async () => {
    const { kwp } = await rig();
    await kwp.setAddress('8110F1');
    // La sesión de programación está deliberadamente deshabilitada.
    const res = await kwp.request(0x10, [0x86]);
    expect(res.positive).toBe(false);
    expect(res.nrc).toBe(0x33);
    expect(res.nrcText).toMatch(/autenticación de seguridad/i);
  });

  it('requestOrThrow lanza un KwpError con el motivo', async () => {
    const { kwp } = await rig();
    await kwp.setAddress('8110F1');
    await expect(kwp.requestOrThrow(0x10, [0x86])).rejects.toSatisfy(
      (e: unknown) => e instanceof KwpError && e.nrc === 0x33,
    );
  });

  it('una escritura sin sesión extendida se rechaza, y con ella funciona', async () => {
    const { kwp } = await rig();
    await kwp.setAddress('8110F1');

    const sinSesion = await kwp.request(0x3b, [0x30, 0x00, 0x00]);
    expect(sinSesion.positive).toBe(false);
    expect(sinSesion.nrcText).toMatch(/sesión activa/i);

    await kwp.startSession(0x85);
    const conSesion = await kwp.request(0x3b, [0x30, 0x00, 0x00]);
    expect(conSesion.positive).toBe(true);
  });

  it('lee la identificación de ECU', async () => {
    const { kwp } = await rig();
    await kwp.setAddress('8110F1');
    expect(await kwp.readEcuIdentification(0x9b)).toBe(golf20_8v.ecuName);
    expect(await kwp.readEcuIdentification(0x94)).toBe(golf20_8v.calId);
  });

  it('devuelve null en vez de lanzar cuando el bloque no existe', async () => {
    const { kwp } = await rig();
    await kwp.setAddress('8110F1');
    expect(await kwp.readDataByLocalId(0x99)).toBeNull();
  });
});

describe('puerta de entrada a las rutinas', () => {
  it('deja pasar el borrado de códigos, que está verificado', () => {
    expect(gate(borrarCodigos, ctx(), 'real').allowed).toBe(true);
  });

  it('BLOQUEA en modo real toda rutina sin verificar', () => {
    const v = gate(resetIntervaloServicio, ctx(), 'real');
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/no está verificada/i);
  });

  it('pero la deja correr en simulación', () => {
    expect(gate(resetIntervaloServicio, ctx(), 'simulacion').allowed).toBe(true);
  });

  it('una rutina sin pasos no corre ni siquiera en simulación', () => {
    const v = gate(regeneracionDpf, ctx(), 'simulacion');
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/no tiene una secuencia implementada/i);
  });

  it('bloquea cuando una precondición no se cumple', () => {
    const v = gate(borrarCodigos, ctx({
      values: new Map([['speed', 40], ['rpm', 2000]]),
    }), 'real');
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/Vehículo detenido: 40 km\/h/);
  });

  it('bloquea por tensión baja, que es lo que arruina una escritura', () => {
    const v = gate(borrarCodigos, ctx({ voltage: 11.2 }), 'real');
    expect(v.allowed).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/Tensión.*11\.2 V/);
  });

  it('en una rutina de riesgo físico, no poder verificar bloquea igual', () => {
    // Sin velocidad ni nivel de combustible disponibles.
    const v = gate(regeneracionDpf, ctx({
      values: new Map([['rpm', 800], ['coolant', 90]]),
      available: new Set(['rpm', 'coolant']),
    }), 'real');
    expect(v.reasons.join(' ')).toMatch(/no se pudo verificar/i);
  });

  it('en una de lectura, lo indeterminado no bloquea por sí solo', () => {
    const v = gate(leerIntervaloServicio, ctx({
      values: new Map([['speed', 0]]),
    }), 'simulacion');
    expect(v.allowed).toBe(true);
  });

  it('rechaza una rutina de fabricante sobre un protocolo que no la transporta', () => {
    const v = gate(resetIntervaloServicio, ctx({ protocol: protocolById('3') }), 'simulacion');
    expect(v.reasons.join(' ')).toMatch(/no puede transportar/i);
  });

  it('rechaza una rutina de VAG en un vehículo de otra marca', () => {
    const v = gate(resetIntervaloServicio, ctx({ make: 'Toyota' }), 'simulacion');
    expect(v.reasons.join(' ')).toMatch(/específica de/i);
  });

  it('pide la marca cuando no se cargó', () => {
    const v = gate(resetIntervaloServicio, ctx({ make: undefined }), 'simulacion');
    expect(v.reasons.join(' ')).toMatch(/indicar la marca/i);
  });
});

describe('modo simulación', () => {
  it('arma la secuencia completa sin enviar un solo byte', async () => {
    const { transport, driver } = await rig();
    const runner = new ServiceRunner(driver);
    driver.clearTrace();

    const result = await runner.run(resetIntervaloServicio, ctx(), { mode: 'simulacion' });

    expect(result.completed).toBe(true);
    expect(result.outcomes).toHaveLength(4);
    expect(result.outcomes.every((o) => o.status === 'ok')).toBe(true);
    // Nada salió al adaptador, y la ECU quedó intacta.
    expect(driver.getTrace()).toHaveLength(0);
    expect(transport.simulator.serviceResetCount).toBe(0);
  });

  it('muestra el hexadecimal exacto que se enviaría', async () => {
    const { driver } = await rig();
    const runner = new ServiceRunner(driver);
    const result = await runner.run(resetIntervaloServicio, ctx(), { mode: 'simulacion' });

    expect(result.outcomes[0]?.request).toBe('10 85');
    expect(result.outcomes[1]?.request).toBe('3B 30 00 00');
    expect(result.outcomes[3]?.request).toBe('20');
  });

  it('explica cada paso en castellano', async () => {
    const { driver } = await rig();
    const runner = new ServiceRunner(driver);
    const result = await runner.run(resetIntervaloServicio, ctx(), { mode: 'simulacion' });
    expect(result.outcomes[1]?.detail).toMatch(/modifica la ECU de forma permanente/i);
  });

  it('evalúa las precondiciones también en simulación', async () => {
    const v = gate(resetIntervaloServicio, ctx({ voltage: 11.0 }), 'simulacion');
    const tension = v.preconditions.find((p) => p.precondition.id === 'tension-suficiente');
    expect(tension?.result.state).toBe('no-cumplida');
    // Pero no bloquea: en simulación no se envía nada, así que sirve
    // justamente para ver qué faltaría.
    expect(v.allowed).toBe(true);
  });
});

describe('ejecución real', () => {
  it('borra los códigos de verdad', async () => {
    const transport = new MockTransport({ latencyMs: 1, profile: tdi20_dpf });
    const session = new DiagnosticSession(transport);
    await session.connect(undefined, 'Volkswagen');
    expect((await session.readAllDtcs()).length).toBeGreaterThan(0);

    const runner = new ServiceRunner(session.driver);
    const result = await runner.run(borrarCodigos, ctx({
      protocol: protocolById('6'),
    }), { mode: 'real' });

    expect(result.completed).toBe(true);
    expect(result.outcomes[0]?.status).toBe('ok');
    expect(await session.readAllDtcs()).toEqual([]);
  });

  it('no envía nada cuando una precondición bloquea', async () => {
    const { driver } = await rig();
    const runner = new ServiceRunner(driver);
    driver.clearTrace();

    const result = await runner.run(borrarCodigos, ctx({ voltage: 10.5 }), { mode: 'real' });

    expect(result.completed).toBe(false);
    expect(result.abortedBecause).toMatch(/Tensión/);
    expect(result.outcomes.every((o) => o.status === 'omitido')).toBe(true);
    expect(driver.getTrace()).toHaveLength(0);
  });

  it('corta en el primer rechazo y marca el resto como omitido', async () => {
    const { driver } = await rig();
    const runner = new ServiceRunner(driver);

    // Se fuerza una rutina sin verificar a modo real sorteando la puerta,
    // para probar el corte: se le quita el primer paso, el que abre sesión.
    const rota = {
      ...resetIntervaloServicio,
      verified: true,
      steps: resetIntervaloServicio.steps.slice(1),
    };
    const result = await runner.run(rota, ctx(), { mode: 'real' });

    expect(result.completed).toBe(false);
    // Sin sesión extendida la ECU rechaza la escritura.
    expect(result.outcomes[0]?.status).toBe('rechazado');
    expect(result.outcomes[0]?.detail).toMatch(/sesión activa/i);
    expect(result.outcomes[1]?.status).toBe('omitido');
  });

  it('la secuencia completa sí reinicia el contador en la ECU simulada', async () => {
    const { transport, driver } = await rig();
    const runner = new ServiceRunner(driver);
    const armada = { ...resetIntervaloServicio, verified: true };

    const result = await runner.run(armada, ctx(), { mode: 'real' });

    expect(result.completed).toBe(true);
    expect(transport.simulator.serviceResetCount).toBe(1);
    // El paso de relectura confirma el valor nuevo.
    expect(result.outcomes[2]?.detail).toMatch(/15\.000 km/);
  });

  it('informa el avance paso a paso', async () => {
    const { driver } = await rig();
    const runner = new ServiceRunner(driver);
    const seen: string[] = [];
    await runner.run({ ...resetIntervaloServicio, verified: true }, ctx(), {
      mode: 'real',
      onProgress: (o) => seen.push(o.map((x) => x.status).join(',')),
    });
    expect(seen.some((s) => s.includes('enviando'))).toBe(true);
    expect(seen.at(-1)).toMatch(/^ok,ok,ok,ok$/);
  });

  it('se puede cancelar entre pasos', async () => {
    const { transport, driver } = await rig();
    const runner = new ServiceRunner(driver);
    let calls = 0;
    const result = await runner.run({ ...resetIntervaloServicio, verified: true }, ctx(), {
      mode: 'real',
      shouldAbort: () => ++calls > 1, // cancelar antes del segundo paso
    });
    expect(result.completed).toBe(false);
    expect(result.abortedBecause).toMatch(/Cancelada/);
    // Se canceló antes de escribir: la ECU no se tocó.
    expect(transport.simulator.serviceResetCount).toBe(0);
  });

  it('lee el intervalo de servicio y lo interpreta', async () => {
    const { driver } = await rig();
    const runner = new ServiceRunner(driver);
    const result = await runner.run({ ...leerIntervaloServicio, verified: true }, ctx(), {
      mode: 'real',
    });
    expect(result.completed).toBe(true);
    // En español los números de cuatro cifras van sin separador (1500) y
    // desde cinco sí (15.000). Intl lo aplica bien; no hay que "arreglarlo".
    expect(result.outcomes[1]?.detail).toMatch(/Faltan 1500 km o 42 días/);
  });
});

describe('invariantes del catálogo', () => {
  it('toda rutina de escritura exige tensión suficiente', () => {
    for (const r of ROUTINES) {
      if (r.risk === 'lectura') continue;
      const ids = r.preconditions.map((p) => p.id);
      expect(ids, `${r.id} no verifica la tensión`).toContain('tension-suficiente');
    }
  });

  it('toda rutina declara de dónde sale su secuencia', () => {
    for (const r of ROUTINES) {
      expect(r.sourceNote.length, `${r.id} sin sourceNote`).toBeGreaterThan(30);
    }
  });

  it('solo está verificada la rutina cuya secuencia está en norma pública', () => {
    const verificadas = ROUTINES.filter((r) => r.verified).map((r) => r.id);
    expect(verificadas).toEqual(['obd2.clear-dtc']);
  });

  it('ninguna rutina de riesgo físico tiene pasos sin verificar', () => {
    for (const r of ROUTINES) {
      if (r.risk !== 'fisico') continue;
      if (!r.verified) {
        expect(r.steps, `${r.id} publica pasos sin verificar`).toHaveLength(0);
      }
    }
  });
});
