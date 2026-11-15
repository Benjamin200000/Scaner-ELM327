import { describe, expect, it } from 'vitest';
import { MockTransport } from '@/core/transport/mock';
import { Elm327Driver } from './driver';
import { ElmError } from './errors';
import { golf20_8v, tdi20_dpf } from '@/sim/profiles';
import type { SimOptions } from '@/sim/ecu';

async function connected(opts: SimOptions = {}) {
  const transport = new MockTransport({ latencyMs: 1, ...opts });
  await transport.open();
  const driver = new Elm327Driver(transport, { timeoutMs: 500, initTimeoutMs: 1000 });
  driver.attach();
  return { transport, driver };
}

describe('Elm327Driver', () => {
  it('inicializa y resuelve el protocolo del perfil KWP', async () => {
    const { driver } = await connected({ profile: golf20_8v });
    const protocol = await driver.initialize();
    expect(protocol?.id).toBe('5');
    expect(protocol?.family).toBe('kwp');
    expect(driver.identity?.version).toBe('ELM327 v1.5');
    expect(driver.identity?.likelyClone).toBe(false);
  });

  it('resuelve CAN en el perfil diésel', async () => {
    const { driver } = await connected({ profile: tdi20_dpf });
    const protocol = await driver.initialize();
    expect(protocol?.id).toBe('6');
    expect(protocol?.isoTp).toBe(true);
  });

  it('marca como clon una versión que nunca existió', async () => {
    const { driver } = await connected({ version: 'ELM327 v2.1' });
    await driver.initialize();
    expect(driver.identity?.likelyClone).toBe(true);
  });

  it('lee la tensión de batería con contacto y con motor en marcha', async () => {
    const { transport, driver } = await connected();
    await driver.initialize();

    // Contacto dado, motor apagado: tensión de batería en reposo.
    const keyOn = await driver.readVoltage();
    expect(keyOn).toBeGreaterThan(12);
    expect(keyOn).toBeLessThan(13);

    // Con el motor girando el alternador carga, y eso se tiene que ver.
    transport.simulator.advance(2);
    const running = await driver.readVoltage();
    expect(running).toBeGreaterThan(13.5);
    expect(running).toBeLessThan(15);
  });

  it('serializa los comandos: nada se entrelaza', async () => {
    const { driver } = await connected();
    await driver.initialize();
    const results = await Promise.all([
      driver.send('010C'),
      driver.send('0105'),
      driver.send('010D'),
    ]);
    // Cada respuesta tiene que corresponder a su propio PID.
    expect(results[0].lines.join('')).toContain('410C');
    expect(results[1].lines.join('')).toContain('4105');
    expect(results[2].lines.join('')).toContain('410D');
  });

  it('convierte NO DATA en un ElmError esperado', async () => {
    const { driver } = await connected({ profile: golf20_8v });
    await driver.initialize();
    // El perfil gasolina no soporta el PID 7A (presión DPF).
    await expect(driver.send('017A')).rejects.toSatisfy(
      (e: unknown) => e instanceof ElmError && e.code === 'no-data' && e.isExpected,
    );
  });

  it('con tolerateNoData devuelve la respuesta en lugar de lanzar', async () => {
    const { driver } = await connected({ profile: golf20_8v });
    await driver.initialize();
    const res = await driver.send('017A', { tolerateNoData: true });
    expect(res.lines.join(' ')).toMatch(/NO DATA/i);
  });

  it('distingue "el chip no contestó" de "contestó tarde"', async () => {
    const transport = new MockTransport({ latencyMs: 5000 });
    await transport.open();
    const driver = new Elm327Driver(transport, { timeoutMs: 50 });
    driver.attach();
    await expect(driver.send('ATI')).rejects.toSatisfy(
      (e: unknown) => e instanceof ElmError && e.code === 'no-adapter-response',
    );
  });

  it('rechaza los comandos pendientes cuando se corta el enlace', async () => {
    const { transport, driver } = await connected();
    await driver.initialize();
    const inflight = driver.send('010C', { timeoutMs: 5000 });
    transport.simulateDisconnect();
    await expect(inflight).rejects.toThrow(/enlace/i);
  });

  it('registra TX y RX con el tiempo de ida y vuelta', async () => {
    const { driver } = await connected();
    await driver.initialize();
    driver.clearTrace();
    await driver.send('010C');
    const trace = driver.getTrace();
    expect(trace[0]).toMatchObject({ direction: 'tx', text: '010C' });
    expect(trace[1]?.direction).toBe('rx');
    expect(trace[1]?.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('responde ? a un comando AT que el chip no conoce', async () => {
    const { driver } = await connected();
    await driver.initialize();
    await expect(driver.send('ATQQ')).rejects.toSatisfy(
      (e: unknown) => e instanceof ElmError && e.code === 'adapter-rejected',
    );
  });

  it('reporta NO DATA en todo si la ECU está muda', async () => {
    const { transport, driver } = await connected();
    await driver.initialize();
    transport.simulator.setEcuSilent(true);
    await expect(driver.send('010C')).rejects.toSatisfy(
      (e: unknown) => e instanceof ElmError && e.code === 'no-data',
    );
  });
});
