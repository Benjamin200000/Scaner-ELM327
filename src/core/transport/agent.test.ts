import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess, execFileSync } from 'node:child_process';
import { AgentTransport } from './agent';
import { Elm327Driver } from '@/core/elm327/driver';
import { Obd2Service } from '@/core/obd2/service';
import { TransportError } from './types';

/**
 * Test de integración contra el agente REAL.
 *
 * Levanta el proceso del agente y habla con él por WebSocket usando el mismo
 * transporte que usa el navegador. Es la única forma de que el protocolo no
 * se desincronice: el agente es JavaScript plano sin build, la app es
 * TypeScript, y nada los ata en tiempo de compilación. Esto los ata en
 * tiempo de ejecución.
 */

const PUERTO = 8911;
const URL = `ws://127.0.0.1:${PUERTO}`;
let agente: ChildProcess;
let token: string;

beforeAll(async () => {
  token = execFileSync('node', ['agent/scaner-agent.mjs', '--token'], {
    encoding: 'utf8',
  }).trim();

  agente = spawn('node', [
    'agent/scaner-agent.mjs', '--simular', '--puerto', String(PUERTO),
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('El agente no arrancó a tiempo')), 10000);
    agente.stdout?.on('data', (b: Buffer) => {
      if (b.toString().includes('Escuchando en')) {
        clearTimeout(t);
        resolve();
      }
    });
    agente.on('error', reject);
  });
}, 20000);

afterAll(() => {
  agente?.kill('SIGTERM');
});

describe('agente local', () => {
  it('autentica y enumera las interfaces disponibles', async () => {
    const t = new AgentTransport({ url: URL, token });
    const { interfaces, features } = await t.connect();
    expect(features.simulador).toBe(true);
    expect(interfaces.some((i) => i.id === 'sim:elm327')).toBe(true);
    await t.close();
  });

  it('rechaza un token incorrecto y lo dice con claridad', async () => {
    const t = new AgentTransport({ url: URL, token: 'token-que-no-es' });
    await expect(t.connect()).rejects.toSatisfy(
      (e: unknown) => e instanceof TransportError && /token/i.test(e.message),
    );
  });

  it('enumera los puertos serie reales de la máquina', async () => {
    const t = new AgentTransport({ url: URL, token });
    const { interfaces } = await t.connect();
    // En este contenedor puede no haber ninguno; lo que importa es que la
    // enumeración no explote y devuelva entradas bien formadas.
    for (const i of interfaces) {
      expect(typeof i.id).toBe('string');
      expect(typeof i.label).toBe('string');
      expect(i.id.includes(':')).toBe(true);
    }
    await t.close();
  });

  it('abre el simulador y entrega su información', async () => {
    const t = new AgentTransport({ url: URL, token, interfaceId: 'sim:elm327' });
    await t.open();
    expect(t.state).toBe('open');
    expect(t.info?.name).toMatch(/simulado/i);
    expect(t.info?.link).toMatch(/agente/);
    await t.close();
    expect(t.state).toBe('closed');
  });

  it('rechaza abrir una interfaz que no existe', async () => {
    const t = new AgentTransport({ url: URL, token, interfaceId: 'serial:/dev/no-existe' });
    await expect(t.open()).rejects.toThrow();
  });

  it('el driver del ELM327 funciona igual a través del agente', async () => {
    const t = new AgentTransport({ url: URL, token, interfaceId: 'sim:elm327' });
    await t.open();
    const driver = new Elm327Driver(t, { timeoutMs: 4000, initTimeoutMs: 8000 });
    driver.attach();

    const protocolo = await driver.initialize();
    expect(protocolo?.id).toBe('6');
    expect(driver.identity?.version).toBe('ELM327 v1.5');

    const v = await driver.readVoltage();
    expect(v).toBeCloseTo(12.4, 1);

    driver.detach();
    await t.close();
  }, 25000);

  it('la cadena completa funciona: descubrimiento y lectura de PID', async () => {
    const t = new AgentTransport({ url: URL, token, interfaceId: 'sim:elm327' });
    await t.open();
    const driver = new Elm327Driver(t, { timeoutMs: 4000, initTimeoutMs: 8000 });
    driver.attach();
    await driver.initialize();
    const obd = new Obd2Service(driver);

    const soportados = await obd.discoverSupportedPids();
    expect(soportados.has(0x0c)).toBe(true);
    expect(soportados.has(0x05)).toBe(true);

    const rpm = await obd.readPid(0x0c);
    expect(rpm?.values.get('rpm')).toBeGreaterThan(700);
    expect(rpm?.values.get('rpm')).toBeLessThan(900);

    const temp = await obd.readPid(0x05);
    expect(temp?.values.get('coolant')).toBe(88);

    driver.detach();
    await t.close();
  }, 30000);

  it('los bytes sobreviven la ida y vuelta por base64', async () => {
    const t = new AgentTransport({ url: URL, token, interfaceId: 'sim:elm327' });
    await t.open();
    const recibido: number[] = [];
    t.onData((c) => recibido.push(...c));
    await t.write(new TextEncoder().encode('ATI\r'));
    await new Promise((r) => setTimeout(r, 400));
    const texto = new TextDecoder().decode(new Uint8Array(recibido));
    expect(texto).toContain('ELM327 v1.5');
    expect(texto).toContain('>');
    await t.close();
  });

  it('no deja abrir dos interfaces a la vez en la misma sesión', async () => {
    const t = new AgentTransport({ url: URL, token, interfaceId: 'sim:elm327' });
    await t.open();
    await expect(t.open()).rejects.toSatisfy(
      (e: unknown) => e instanceof TransportError && e.code === 'already-open',
    );
    await t.close();
  });

  it('escribir sin interfaz abierta falla en vez de quedarse colgado', async () => {
    const t = new AgentTransport({ url: URL, token });
    await t.connect();
    await expect(t.write(new TextEncoder().encode('ATI\r'))).rejects.toSatisfy(
      (e: unknown) => e instanceof TransportError && e.code === 'not-open',
    );
    await t.close();
  });

  it('avisa cuando no hay ningún agente en esa dirección', async () => {
    const t = new AgentTransport({
      url: 'ws://127.0.0.1:8912', token, handshakeMs: 1500,
    });
    await expect(t.connect()).rejects.toSatisfy(
      (e: unknown) => e instanceof TransportError && /agente/i.test(e.message),
    );
  }, 10000);

  it('una interfaz queda liberada al cerrar la sesión, no tomada', async () => {
    const a = new AgentTransport({ url: URL, token, interfaceId: 'sim:elm327' });
    await a.open();
    await a.close();
    // Si el agente no liberase al desconectar, esto fallaría con 'ya abierta'.
    const b = new AgentTransport({ url: URL, token, interfaceId: 'sim:elm327' });
    await b.open();
    expect(b.state).toBe('open');
    await b.close();
  });
});

describe('enlace automático con el agente local', () => {
  it('toma dirección y token del fragmento', async () => {
    const { enlaceDesdeUrl } = await import('@/state/store');
    expect(enlaceDesdeUrl('http://127.0.0.1:8777/#agente=abcdefghijklmnopqrstuvwxyz012345'))
      .toEqual({ url: 'ws://127.0.0.1:8777', token: 'abcdefghijklmnopqrstuvwxyz012345' });
    expect(enlaceDesdeUrl('http://192.168.1.20:9000/#agente=AAAAaaaa_-BBBBbbbb')?.url)
      .toBe('ws://192.168.1.20:9000');
  });
  it('ignora fragmentos ajenos o mal formados', async () => {
    const { enlaceDesdeUrl } = await import('@/state/store');
    expect(enlaceDesdeUrl('http://127.0.0.1:8777/')).toBeNull();
    expect(enlaceDesdeUrl('http://127.0.0.1:8777/#agente=corto')).toBeNull();
    expect(enlaceDesdeUrl('http://127.0.0.1:8777/#agente=con espacios y <script>')).toBeNull();
    expect(enlaceDesdeUrl('file:///C:/x/index.html#agente=abcdefghijklmnopqrstuvwxyz')).toBeNull();
  });
});
