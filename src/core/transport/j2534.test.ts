import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { AgentTransport } from './agent';
import { Elm327Driver } from '@/core/elm327/driver';
import { Obd2Service } from '@/core/obd2/service';
import { leerRegion } from '@/core/uds/memory';
import type { EcuModule } from '@/core/uds/modules';

/**
 * J2534 de punta a punta, sin hardware.
 *
 * La cadena completa que se ejercita acá es:
 *
 *   Obd2Service → Elm327Driver → AgentTransport → WebSocket
 *     → agente → puente J2534-como-ELM327 → FFI → biblioteca J2534
 *
 * La biblioteca es una falsa compilada para los tests, con una ECU mínima
 * detrás. Lo que esto demuestra es que la app funciona sobre un equipo
 * profesional SIN cambiar una línea por encima del transporte, y que la
 * traducción de mensajes a flujo de bytes es correcta.
 *
 * Lo que NO demuestra: que la DLL de un fabricante concreto se comporte
 * igual. Eso necesita el equipo.
 */

const PUERTO = 8913;
const URL = `ws://127.0.0.1:${PUERTO}`;
const FAKE = resolve('agent/test/libfakej2534.so');
let agente: ChildProcess;
let token: string;

beforeAll(async () => {
  token = execFileSync('node', ['agent/scaner-agent.mjs', '--token'], {
    encoding: 'utf8',
  }).trim();

  agente = spawn('node', [
    'agent/scaner-agent.mjs', '--puerto', String(PUERTO), '--j2534', FAKE,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  await new Promise<void>((res, rej) => {
    const t = setTimeout(() => rej(new Error('El agente no arrancó')), 10000);
    agente.stdout?.on('data', (b: Buffer) => {
      if (b.toString().includes('Escuchando en')) { clearTimeout(t); res(); }
    });
    agente.on('error', rej);
  });
}, 20000);

afterAll(() => { agente?.kill('SIGTERM'); });

const abrir = async () => {
  const t = new AgentTransport({ url: URL, token, interfaceId: `j2534:${FAKE}` });
  await t.open();
  return t;
};

describe('J2534 a través del agente', () => {
  it('el agente ofrece el equipo J2534 como interfaz', async () => {
    const t = new AgentTransport({ url: URL, token });
    const { interfaces, features } = await t.connect();
    expect(features.j2534).toBe(true);
    const eq = interfaces.find((i) => i.kind === 'j2534');
    expect(eq).toBeDefined();
    expect(eq?.detail).toContain('libfakej2534');
    await t.close();
  });

  it('abre el equipo y reporta sus versiones', async () => {
    const t = await abrir();
    expect(t.info?.name).toMatch(/J2534/);
    expect(t.info?.link).toMatch(/API 04\.04/);
    expect(t.info?.link).toMatch(/FAKE-FW/);
    await t.close();
  });

  it('el driver del ELM327 inicializa sobre J2534 sin saberlo', async () => {
    const t = await abrir();
    const driver = new Elm327Driver(t, { timeoutMs: 5000, initTimeoutMs: 9000 });
    driver.attach();

    const protocolo = await driver.initialize();
    expect(protocolo?.id).toBe('6');
    expect(protocolo?.family).toBe('can');
    expect(driver.identity?.version).toMatch(/ELM327/);

    driver.detach();
    await t.close();
  }, 30000);

  it('lee la tensión real del equipo, no una inventada', async () => {
    const t = await abrir();
    const driver = new Elm327Driver(t, { timeoutMs: 5000, initTimeoutMs: 9000 });
    driver.attach();
    await driver.initialize();
    // La biblioteca falsa informa 13950 mV por ioctl READ_VBATT.
    expect(await driver.readVoltage()).toBeCloseTo(13.95, 1);
    driver.detach();
    await t.close();
  }, 30000);

  it('descubre los PID soportados y los lee', async () => {
    const t = await abrir();
    const driver = new Elm327Driver(t, { timeoutMs: 5000, initTimeoutMs: 9000 });
    driver.attach();
    await driver.initialize();
    const obd = new Obd2Service(driver);

    const soportados = await obd.discoverSupportedPids();
    expect(soportados.has(0x0c)).toBe(true);
    expect(soportados.has(0x05)).toBe(true);

    const rpm = await obd.readPid(0x0c);
    expect(rpm?.values.get('rpm')).toBe(850);

    const temp = await obd.readPid(0x05);
    expect(temp?.values.get('coolant')).toBe(83);

    driver.detach();
    await t.close();
  }, 40000);

  it('lee códigos de falla por modo 03', async () => {
    const t = await abrir();
    const driver = new Elm327Driver(t, { timeoutMs: 5000, initTimeoutMs: 9000 });
    driver.attach();
    await driver.initialize();
    const obd = new Obd2Service(driver);
    const dtcs = await obd.readDtcs('stored');
    expect(dtcs.map((d) => d.code)).toEqual(['P0133']);
    driver.detach();
    await t.close();
  }, 30000);

  it('un PID que la ECU no contesta se traduce a NO DATA, no a un valor', async () => {
    const t = await abrir();
    const driver = new Elm327Driver(t, { timeoutMs: 5000, initTimeoutMs: 9000 });
    driver.attach();
    await driver.initialize();
    await expect(driver.send('017A')).rejects.toSatisfy(
      (e: unknown) => (e as { code?: string }).code === 'no-data',
    );
    driver.detach();
    await t.close();
  }, 30000);

  it('lee memoria de la ECU por UDS a través del J2534 real', async () => {
    // Este es el punto: lo que el ELM327 no puede, el J2534 sí. El motor de
    // lectura corre completo sobre el FFI y la DLL falsa, que modela sesión,
    // acceso de seguridad y subida por bloques.
    const t = await abrir();
    const driver = new Elm327Driver(t, { timeoutMs: 5000, initTimeoutMs: 9000 });
    driver.attach();
    await driver.initialize();

    const modulo: EcuModule = {
      id: 'fake', label: 'DLL de prueba', aplica: 'test',
      reqAddr: '7E0', resAddr: '7E8', sesion: 0x03,
      seguridad: { nivel: 0x01, algoritmo: 'sim-prueba' },
      metodo: 'subida', addrBytes: 4, sizeBytes: 4,
      regiones: [{ id: 'cal', label: 'Calibración', direccion: 0x80000800, tamano: 0x80 }],
      soloSimulador: true,
    };
    try {
      const r = await leerRegion(driver, modulo, modulo.regiones[0]!);
      expect(r.completa).toBe(true);
      expect(r.datos).toHaveLength(0x80);
      // Byte en offset 0x800 de la flash: (0x800*7 + 0x3b) & 0xff.
      expect(r.datos[0]).toBe((0x800 * 7 + 0x3b) & 0xff);
    } finally {
      driver.detach();
      await t.close();
    }
  }, 40000);

  it('la DLL rechaza la subida sin acceso de seguridad', async () => {
    const t = await abrir();
    const driver = new Elm327Driver(t, { timeoutMs: 5000, initTimeoutMs: 9000 });
    driver.attach();
    await driver.initialize();
    const modulo: EcuModule = {
      id: 'fake2', label: 'DLL sin llave', aplica: 'test',
      reqAddr: '7E0', resAddr: '7E8', sesion: 0x03,
      seguridad: { nivel: 0, algoritmo: 'ninguno' },
      metodo: 'subida', addrBytes: 4, sizeBytes: 4,
      regiones: [{ id: 'cal', label: 'Calibración', direccion: 0x80000800, tamano: 0x40 }],
      soloSimulador: true,
    };
    try {
      const r = await leerRegion(driver, modulo, modulo.regiones[0]!);
      expect(r.completa).toBe(false);
      expect(r.motivo).toMatch(/denegado|seguridad/i);
    } finally {
      driver.detach();
      await t.close();
    }
  }, 40000);

});