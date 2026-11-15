import { describe, expect, it } from 'vitest';
import { MockTransport } from '@/core/transport/mock';
import { DiagnosticSession, type SessionProgress } from './session';
import { golf20_8v, tdi20_dpf } from '@/sim/profiles';
import { relevantSystems } from '@/core/engine/systems';
import { runRules } from '@/core/engine/rules';

async function open(profile = golf20_8v, warmSec = 200) {
  const transport = new MockTransport({ latencyMs: 1, profile });
  const progress: SessionProgress[] = [];
  const session = new DiagnosticSession(transport, (p) => progress.push(p));
  const info = await session.connect(undefined, 'Volkswagen');
  for (let i = 0; i < warmSec * 10; i++) transport.simulator.advance(0.1);
  return { transport, session, info, progress };
}

describe('sesión de diagnóstico', () => {
  it('informa cada fase del arranque', async () => {
    const { progress } = await open();
    expect(progress.map((p) => p.phase)).toEqual([
      'abriendo-enlace', 'inicializando', 'identificando', 'listo',
    ]);
  });

  it('deja la sesión con protocolo, identificación y PID descubiertos', async () => {
    const { info } = await open();
    expect(info.protocol?.id).toBe('5');
    expect(info.identity.vin).toBe(golf20_8v.vin);
    expect(info.supportedPids.size).toBeGreaterThan(15);
    expect(info.availableParams.has('rpm')).toBe(true);
  });

  it('detecta el combustible desde el PID 0x51', async () => {
    const gas = await open(golf20_8v);
    expect(gas.info.fuel).toBe('gasolina');
  });

  it('deja el combustible en null si la ECU no lo expone', async () => {
    // El perfil diésel no declara el PID 0x51.
    const dsl = await open(tdi20_dpf);
    expect(dsl.info.supportedPids.has(0x51)).toBe(false);
    expect(dsl.info.fuel).toBeNull();
  });

  it('el sondeo devuelve los parámetros rápidos en cada vuelta', async () => {
    const { session } = await open();
    const r1 = await session.poll();
    expect(r1.values.get('rpm')).toBeGreaterThan(700);
    expect(r1.values.get('load')).toBeGreaterThan(0);
    const r2 = await session.poll();
    expect(r2.values.get('rpm')).toBeGreaterThan(700);
  });

  it('rota los parámetros lentos entre vueltas', async () => {
    const { session } = await open();
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const r = await session.poll();
      for (const k of r.values.keys()) seen.add(k);
    }
    // Con la rotación se tienen que haber cubierto parámetros lentos.
    expect(seen.has('coolant')).toBe(true);
    expect(seen.has('module_voltage')).toBe(true);
  });

  it('deja de pedir un PID que falla de forma repetida', async () => {
    const { transport, session } = await open();
    transport.simulator.setEcuSilent(true);

    // Los rápidos se piden en todas las vueltas, así que juntan sus tres
    // fallos enseguida y dejan de intentarse.
    const first = await session.poll();
    expect(first.failures.size).toBeGreaterThan(0);
    for (let i = 0; i < 2; i++) await session.poll();
    const afterFast = await session.poll();
    expect(afterFast.failures.has(0x0c)).toBe(false);
    expect(afterFast.failures.has(0x0d)).toBe(false);

    // Los lentos rotan, así que cada uno acumula sus propios tres fallos.
    // Con suficientes vueltas el ciclo queda completamente en silencio.
    for (let i = 0; i < 60; i++) await session.poll();
    const quiet = await session.poll();
    expect(quiet.failures.size).toBe(0);
    expect(quiet.values.size).toBe(0);
  });

  it('un PID que vuelve a responder se reincorpora al ciclo', async () => {
    const { transport, session } = await open();
    transport.simulator.setEcuSilent(true);
    await session.poll();
    transport.simulator.setEcuSilent(false);
    const back = await session.poll();
    // Un solo fallo no descarta nada: el contador se reinicia al responder.
    expect(back.values.get('rpm')).toBeGreaterThan(700);
  });

  it('lee los tres tipos de código en una sola pasada', async () => {
    const { session } = await open(tdi20_dpf);
    const dtcs = await session.readAllDtcs();
    expect(dtcs.map((d) => `${d.code}:${d.kind}`)).toEqual([
      'P2002:stored', 'P0234:pending',
    ]);
  });

  it('expone los PID que la ECU soporta y la app aún no decodifica', async () => {
    const { session } = await open(golf20_8v);
    const undecoded = session.undecodedPids();
    // El perfil declara PID como 0x13 y 0x1C que el catálogo no cubre.
    expect(undecoded).toContain(0x13);
    expect(undecoded).toContain(0x1c);
  });

  it('un gasolina no habilita las secciones de turbo ni DPF', async () => {
    const { info } = await open(golf20_8v);
    const ids = relevantSystems(info.availableParams).map((s) => s.id);
    expect(ids).not.toContain('dpf');
    expect(ids).not.toContain('turbo');
  });

  it('cadena completa: sondeo, reglas y hallazgo del escenario diésel', async () => {
    const { session, info } = await open(tdi20_dpf);
    // Varias vueltas para que la rotación cubra los PID lentos del DPF.
    const values = new Map<string, number | null>();
    for (let i = 0; i < 10; i++) {
      const r = await session.poll();
      for (const [k, v] of r.values) values.set(k, v);
    }
    const { findings } = runRules(
      { snapshot: values, dtcs: await session.readAllDtcs(), fuel: 'diesel' },
      info.availableParams,
    );
    const boost = findings.find((f) => f.ruleId === 'boost-desviado');
    expect(boost?.title).toMatch(/overboost/i);
  });

  it('el cierre deja la sesión sin información y el transporte cerrado', async () => {
    const { transport, session } = await open();
    await session.disconnect();
    expect(session.info).toBeNull();
    expect(transport.state).toBe('closed');
  });
});
