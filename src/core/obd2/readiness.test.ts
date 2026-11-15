import { describe, expect, it } from 'vitest';
import { MockTransport } from '@/core/transport/mock';
import { Elm327Driver } from '@/core/elm327/driver';
import { Obd2Service } from './service';
import { decodificarReadiness, evaluarRevision } from './readiness';
import { golf20_8v, tdi20_dpf } from '@/sim/profiles';
import type { SimProfile } from '@/sim/profiles';

async function sesion(profile: SimProfile) {
  const transport = new MockTransport({ latencyMs: 1, profile });
  await transport.open();
  const driver = new Elm327Driver(transport, { timeoutMs: 1500, initTimeoutMs: 2500 });
  driver.attach();
  await driver.initialize();
  return { transport, obd: new Obd2Service(driver) };
}

describe('decodificación de monitores', () => {
  it('lee el testigo y la cuenta de códigos del byte A', () => {
    const conFalla = decodificarReadiness([0x83, 0x07, 0xe5, 0x00]);
    expect(conFalla?.mil).toBe(true);
    expect(conFalla?.dtcCount).toBe(3);

    const sinFalla = decodificarReadiness([0x00, 0x07, 0xe5, 0x00]);
    expect(sinFalla?.mil).toBe(false);
    expect(sinFalla?.dtcCount).toBe(0);
  });

  it('distingue encendido por chispa de compresión por el bit 3 de B', () => {
    expect(decodificarReadiness([0x00, 0x07, 0x00, 0x00])?.tipoEncendido).toBe('chispa');
    expect(decodificarReadiness([0x00, 0x0f, 0x00, 0x00])?.tipoEncendido).toBe('compresion');
  });

  it('un bit de soporte en 0 da NO SOPORTADO, no COMPLETO', () => {
    // B = 0x00: ningún monitor continuo soportado.
    const r = decodificarReadiness([0x00, 0x00, 0x00, 0x00]);
    const misfire = r?.monitores.find((m) => m.id === 'misfire');
    expect(misfire?.estado).toBe('no-soportado');
  });

  it('la polaridad de completitud es inversa: 1 significa pendiente', () => {
    // B = 0x17 -> soportados 0,1,2 (0x07) y bit 4 en 1 = fallo de
    // combustión pendiente.
    const r = decodificarReadiness([0x00, 0x17, 0x00, 0x00]);
    const monitores = new Map(r!.monitores.map((m) => [m.id, m.estado]));
    expect(monitores.get('misfire')).toBe('pendiente');
    expect(monitores.get('fuel')).toBe('completo');
    expect(monitores.get('components')).toBe('completo');
  });

  it('usa la tabla de gasolina para encendido por chispa', () => {
    const r = decodificarReadiness([0x00, 0x07, 0xff, 0x00]);
    const ids = r!.monitores.map((m) => m.id);
    expect(ids).toContain('catalyst');
    expect(ids).toContain('evap');
    expect(ids).toContain('o2_sensor');
    expect(ids).not.toContain('pm_filter');
  });

  it('usa la tabla de diésel para encendido por compresión', () => {
    const r = decodificarReadiness([0x00, 0x0f, 0xff, 0x00]);
    const ids = r!.monitores.map((m) => m.id);
    expect(ids).toContain('pm_filter');
    expect(ids).toContain('nox_scr');
    expect(ids).toContain('nmhc_catalyst');
    expect(ids).not.toContain('evap');
  });

  it('conserva los bytes crudos para poder verificar a mano', () => {
    const r = decodificarReadiness([0x81, 0x07, 0xe5, 0x20]);
    expect(r?.raw).toEqual([0x81, 0x07, 0xe5, 0x20]);
  });

  it('con menos de cuatro bytes devuelve null, no "todo completo"', () => {
    expect(decodificarReadiness([0x00, 0x07])).toBeNull();
    expect(decodificarReadiness([])).toBeNull();
  });
});

describe('veredicto de revisión técnica', () => {
  it('aprueba con testigo apagado, sin códigos y todo completo', () => {
    const v = evaluarRevision(decodificarReadiness([0x00, 0x07, 0xe5, 0x00]));
    expect(v.aprobaria).toBe(true);
    expect(v.pendientes).toEqual([]);
  });

  it('rechaza con el testigo encendido, sin mirar nada más', () => {
    const v = evaluarRevision(decodificarReadiness([0x80, 0x07, 0xe5, 0x00]));
    expect(v.aprobaria).toBe(false);
    expect(v.motivo).toMatch(/testigo de avería/i);
  });

  it('rechaza si hay códigos confirmados aunque el testigo esté apagado', () => {
    const v = evaluarRevision(decodificarReadiness([0x02, 0x07, 0xe5, 0x00]));
    expect(v.aprobaria).toBe(false);
    expect(v.motivo).toMatch(/2 códigos confirmados/);
  });

  it('tolera un monitor pendiente y rechaza con dos', () => {
    // D = 0x01 -> catalizador pendiente.
    const uno = evaluarRevision(decodificarReadiness([0x00, 0x07, 0xe5, 0x01]));
    expect(uno.aprobaria).toBe(true);
    expect(uno.pendientes).toHaveLength(1);

    // D = 0x05 -> catalizador y evaporativo pendientes.
    const dos = evaluarRevision(decodificarReadiness([0x00, 0x07, 0xe5, 0x05]));
    expect(dos.aprobaria).toBe(false);
    expect(dos.pendientes).toHaveLength(2);
    expect(dos.motivo).toMatch(/borrar códigos los vuelve a poner en cero/i);
  });

  it('el umbral es configurable, porque la normativa cambia', () => {
    const bytes = decodificarReadiness([0x00, 0x07, 0xe5, 0x05]);
    expect(evaluarRevision(bytes, 1).aprobaria).toBe(false);
    expect(evaluarRevision(bytes, 2).aprobaria).toBe(true);
  });

  it('no inventa un veredicto cuando no hay datos', () => {
    const v = evaluarRevision(null);
    expect(v.aprobaria).toBeNull();
    expect(v.motivo).toMatch(/no entregó/i);
  });

  it('los monitores no soportados no cuentan como pendientes', () => {
    // C = 0x01: solo el catalizador soportado. D = 0xFF: todos los bits de
    // pendiente en 1, pero solo importa el del monitor soportado.
    const v = evaluarRevision(decodificarReadiness([0x00, 0x07, 0x01, 0xff]));
    expect(v.soportados).toBe(4); // 3 continuos + catalizador
    expect(v.pendientes).toHaveLength(1);
  });
});

describe('lectura contra la ECU', () => {
  it('el perfil gasolina informa encendido por chispa y todo completo', async () => {
    const { obd } = await sesion(golf20_8v);
    const r = await obd.readReadiness();
    expect(r?.tipoEncendido).toBe('chispa');
    expect(r?.monitores.filter((m) => m.estado === 'pendiente')).toEqual([]);
    // El perfil tiene P0171 almacenado, así que el testigo está encendido.
    expect(r?.mil).toBe(true);
    expect(evaluarRevision(r).aprobaria).toBe(false);
  });

  it('el perfil diésel informa compresión y el filtro de partículas pendiente', async () => {
    const { obd } = await sesion(tdi20_dpf);
    const r = await obd.readReadiness();
    expect(r?.tipoEncendido).toBe('compresion');
    const pendientes = r!.monitores.filter((m) => m.estado === 'pendiente');
    expect(pendientes.map((m) => m.id)).toEqual(['pm_filter']);
  });

  it('tras borrar códigos el testigo se apaga', async () => {
    const { obd } = await sesion(golf20_8v);
    expect((await obd.readReadiness())?.mil).toBe(true);
    await obd.clearDtcs();
    const r = await obd.readReadiness();
    expect(r?.mil).toBe(false);
    expect(r?.dtcCount).toBe(0);
  });
});

describe('datos congelados', () => {
  it('devuelve el código que disparó la foto', async () => {
    const { obd } = await sesion(golf20_8v);
    expect(await obd.readFreezeFrameDtc()).toBe('P0171');
  });

  it('las condiciones guardadas son las del momento de la falla, no las actuales', async () => {
    const { obd } = await sesion(golf20_8v);
    const foto = await obd.readFreezeFrame([0x0c, 0x05, 0x0d, 0x04]);

    // La foto se tomó conduciendo: 2000 rpm y 60 km/h, no el ralentí actual.
    expect(foto.get(0x0c)?.values.get('rpm')).toBe(2000);
    expect(foto.get(0x0d)?.values.get('speed')).toBe(60);
    expect(foto.get(0x05)?.values.get('coolant')).toBe(63);

    const ahora = await obd.readPid(0x0c);
    expect(ahora?.values.get('rpm')).toBeLessThan(1000);
  });

  it('sin códigos almacenados no hay foto', async () => {
    const { obd } = await sesion(golf20_8v);
    await obd.clearDtcs();
    expect(await obd.readFreezeFrameDtc()).toBeNull();
    expect((await obd.readFreezeFrame([0x0c])).size).toBe(0);
  });

  it('un PID sin foto no rompe la lectura de los demás', async () => {
    const { obd } = await sesion(golf20_8v);
    const foto = await obd.readFreezeFrame([0x0c, 0x7a, 0x05]);
    expect(foto.has(0x0c)).toBe(true);
    expect(foto.has(0x05)).toBe(true);
    expect(foto.has(0x7a)).toBe(false);
  });
});
