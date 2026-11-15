import { describe, expect, it } from 'vitest';
import { evaluateParam, formatRange } from './evaluate';
import { availableParams, relevantSystems, summarizeSystem, SYSTEMS } from './systems';
import { runRules } from './rules';
import { findDtcFor, findDtcKnowledge } from '@/knowledge';
import { golf20_8v, tdi20_dpf } from '@/sim/profiles';

const snap = (o: Record<string, number | null>) => new Map(Object.entries(o));
const pidSet = (hex: string[]) => new Set(hex.map((h) => parseInt(h, 16)));

describe('evaluación de parámetros', () => {
  // El rango de refrigerante solo aplica con el motor ya caliente.
  const caliente = (coolant: number) => snap({ coolant, run_time: 900 });

  it('marca normal dentro del rango', () => {
    const ev = evaluateParam('coolant', caliente(89), true);
    expect(ev.status).toBe('normal');
    expect(formatRange(ev.range)).toBe('80–105 °C');
  });

  it('marca atención al salirse del rango sin llegar al umbral de falla', () => {
    const ev = evaluateParam('coolant', caliente(107), true);
    expect(ev.status).toBe('atencion');
  });

  it('marca falla al pasar el umbral explícito', () => {
    const ev = evaluateParam('coolant', caliente(118), true);
    expect(ev.status).toBe('falla');
  });

  it('un motor que todavía no calentó NO se marca como anomalía', () => {
    // Arranque en frío: 30 °C a los 40 segundos de marcha es lo esperable.
    const ev = evaluateParam('coolant', snap({ coolant: 30, run_time: 40 }), true);
    expect(ev.status).toBe('fuera-de-condicion');
    expect(ev.status).not.toBe('atencion');
  });

  it('pero la sobretemperatura se detecta desde el primer segundo', () => {
    // La regla no depende del rango, justamente para que el calentamiento
    // no sirva de excusa para ocultar un motor hirviendo.
    const { findings } = runRules(
      { snapshot: snap({ coolant: 117, run_time: 40 }), dtcs: [] },
      new Set(['coolant', 'run_time']),
    );
    expect(findings.find((f) => f.ruleId === 'refrigerante-alto')?.level)
      .toBe('patron-compatible');
  });

  it('el testigo de avería encendido es una falla, no un dato sin interpretar', () => {
    expect(evaluateParam('mil', snap({ mil: 1 }), true).status).toBe('falla');
    expect(evaluateParam('mil', snap({ mil: 0 }), true).status).toBe('normal');
  });

  it('cualquier código confirmado deja el contador en falla', () => {
    expect(evaluateParam('dtc_count', snap({ dtc_count: 2 }), true).status).toBe('falla');
    expect(evaluateParam('dtc_count', snap({ dtc_count: 0 }), true).status).toBe('normal');
  });

  it('el IAT pegado a -40 delata un sensor en circuito abierto', () => {
    expect(evaluateParam('iat', snap({ iat: -40 }), true).status).toBe('falla');
    expect(evaluateParam('iat', snap({ iat: 34 }), true).status).toBe('normal');
  });

  it('NO muestra cero cuando la ECU no soporta el parámetro', () => {
    const ev = evaluateParam('dpf_delta', snap({}), false);
    expect(ev.status).toBe('no-compatible');
    expect(ev.value).toBeNull();
  });

  it('distingue no soportado de soportado sin dato', () => {
    const ev = evaluateParam('dpf_delta', snap({ dpf_delta: null }), true);
    expect(ev.status).toBe('no-disponible');
  });

  it('con valor pero sin rango fiable no juzga', () => {
    // La presión del riel no tiene rango genérico a propósito.
    const ev = evaluateParam('rail_pressure', snap({ rail_pressure: 27200 }), true);
    expect(ev.status).toBe('sin-referencia');
    expect(ev.value).toBe(27200);
    expect(ev.note).toMatch(/no disponible/i);
  });

  it('no evalúa el ralentí con el motor frío: el rango no aplica', () => {
    const frio = evaluateParam('rpm', snap({ rpm: 1150, coolant: 30, speed: 0 }), true);
    expect(frio.status).toBe('fuera-de-condicion');
    expect(frio.note).toMatch(/refrigerante/i);

    const caliente = evaluateParam('rpm', snap({ rpm: 1150, coolant: 88, speed: 0 }), true);
    expect(caliente.status).toBe('falla');
  });

  it('no evalúa el ralentí si el vehículo está en movimiento', () => {
    const ev = evaluateParam('rpm', snap({ rpm: 2400, coolant: 88, speed: 80 }), true);
    expect(ev.status).toBe('fuera-de-condicion');
  });

  it('detecta la corrección larga alta del escenario P0171', () => {
    const ev = evaluateParam('ltft1', snap({ ltft1: 19.5, coolant: 89 }), true);
    expect(ev.status).toBe('falla');
  });
});

describe('relevancia de sistemas', () => {
  it('un gasolina no ofrece sección de DPF', () => {
    const available = availableParams(pidSet(golf20_8v.supportedPids));
    const systems = relevantSystems(available).map((s) => s.id);
    expect(systems).toContain('motor');
    expect(systems).toContain('combustible');
    expect(systems).toContain('admision');
    expect(systems).not.toContain('dpf');
    expect(systems).not.toContain('turbo');
  });

  it('un diésel con DPF sí la ofrece', () => {
    const available = availableParams(pidSet(tdi20_dpf.supportedPids));
    const systems = relevantSystems(available).map((s) => s.id);
    expect(systems).toContain('dpf');
    expect(systems).toContain('turbo');
  });

  it('los sistemas salen en orden estable', () => {
    const available = availableParams(pidSet(tdi20_dpf.supportedPids));
    const orders = relevantSystems(available).map((s) => s.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('un sistema sin nada evaluable no se reporta como normal', () => {
    const motor = SYSTEMS.find((s) => s.id === 'motor');
    const summary = summarizeSystem(motor!, []);
    expect(summary.status).not.toBe('normal');
    expect(summary.status).toBe('no-compatible');
  });

  it('el sistema toma el peor estado de sus parámetros', () => {
    const combustible = SYSTEMS.find((s) => s.id === 'combustible');
    const evaluated = [
      evaluateParam('stft1', snap({ stft1: 2, coolant: 89 }), true),
      evaluateParam('ltft1', snap({ ltft1: 19.5, coolant: 89 }), true),
    ];
    const summary = summarizeSystem(combustible!, evaluated);
    expect(summary.status).toBe('falla');
    expect(summary.drivers.map((d) => d.id)).toEqual(['ltft1']);
  });
});

describe('motor de reglas', () => {
  const gasAvailable = availableParams(pidSet(golf20_8v.supportedPids));
  const dslAvailable = availableParams(pidSet(tdi20_dpf.supportedPids));

  it('detecta el patrón de mezcla pobre y no afirma una pieza defectuosa', () => {
    const { findings } = runRules(
      { snapshot: snap({ ltft1: 19.5, stft1: 6, coolant: 89 }), dtcs: [], fuel: 'gasolina' },
      gasAvailable,
    );
    const hit = findings.find((f) => f.ruleId === 'mezcla-pobre-adaptativa');
    expect(hit).toBeDefined();
    expect(hit?.level).toBe('indicio');
    expect(hit?.title).toMatch(/compatible con/i);
    // Ninguna causa puede estar redactada como una conclusión.
    for (const f of findings) {
      expect(f.title).not.toMatch(/defectuos|averiad|hay que cambiar/i);
    }
  });

  it('escala a patrón compatible cuando la desviación es grande', () => {
    const { findings } = runRules(
      { snapshot: snap({ ltft1: 24, coolant: 89 }), dtcs: [], fuel: 'gasolina' },
      gasAvailable,
    );
    expect(findings[0]?.level).toBe('patron-compatible');
  });

  it('no dispara con correcciones normales', () => {
    const { findings } = runRules(
      { snapshot: snap({ ltft1: 3, stft1: -2, coolant: 89 }), dtcs: [], fuel: 'gasolina' },
      gasAvailable,
    );
    expect(findings.find((f) => f.ruleId.startsWith('mezcla'))).toBeUndefined();
  });

  it('detecta overboost con los valores del escenario diésel', () => {
    const { findings } = runRules(
      { snapshot: snap({ boost_cmd: 101, boost_actual: 118 }), dtcs: [], fuel: 'diesel' },
      dslAvailable,
    );
    const hit = findings.find((f) => f.ruleId === 'boost-desviado');
    expect(hit?.title).toMatch(/overboost/i);
    expect(hit?.level).toBe('patron-compatible');
    expect(hit?.observed).toMatch(/\+16\.8 %/);
  });

  it('distingue underboost de overboost', () => {
    const { findings } = runRules(
      { snapshot: snap({ boost_cmd: 180, boost_actual: 140 }), dtcs: [], fuel: 'diesel' },
      dslAvailable,
    );
    expect(findings.find((f) => f.ruleId === 'boost-desviado')?.title)
      .toMatch(/underboost/i);
  });

  it('NO evalúa el MAF teórico sin la cilindrada, y lo informa', () => {
    const { findings, skipped } = runRules(
      { snapshot: snap({ maf: 8, rpm: 3000, load: 80 }), dtcs: [] },
      gasAvailable,
    );
    expect(findings.find((f) => f.ruleId === 'maf-vs-teorico')).toBeUndefined();
    const skip = skipped.find((s) => s.ruleId === 'maf-vs-teorico');
    expect(skip?.missing).toContain('cilindrada');
    expect(skip?.reason).toMatch(/inventado/i);
  });

  it('con la cilindrada sí compara el MAF contra el teórico', () => {
    const { findings } = runRules(
      {
        snapshot: snap({ maf: 15, rpm: 3000, load: 80 }),
        dtcs: [],
        displacementL: 2.0,
      },
      gasAvailable,
    );
    const hit = findings.find((f) => f.ruleId === 'maf-vs-teorico');
    expect(hit).toBeDefined();
    expect(hit?.observed).toMatch(/caudal teórico/i);
  });

  it('informa las reglas que no pudo correr por falta de parámetros', () => {
    const { skipped } = runRules(
      { snapshot: snap({ coolant: 89 }), dtcs: [], fuel: 'diesel' },
      availableParams(pidSet(['05'])),
    );
    const dpf = skipped.find((s) => s.ruleId === 'dpf-presion-elevada');
    expect(dpf?.missing).toContain('dpf_delta');
  });

  it('la regla de DPF solo corre en diésel', () => {
    const { findings, skipped } = runRules(
      { snapshot: snap({ dpf_delta: 3.8, rpm: 810 }), dtcs: [], fuel: 'gasolina' },
      dslAvailable,
    );
    expect(findings.find((f) => f.ruleId === 'dpf-presion-elevada')).toBeUndefined();
    expect(skipped.find((s) => s.ruleId === 'dpf-presion-elevada')).toBeUndefined();
  });

  it('la observación de DPF propone cómo distinguir sensor de filtro', () => {
    const { findings } = runRules(
      { snapshot: snap({ dpf_delta: 3.8, rpm: 810 }), dtcs: [], fuel: 'diesel' },
      dslAvailable,
    );
    const hit = findings.find((f) => f.ruleId === 'dpf-presion-elevada');
    expect(hit?.level).toBe('observacion');
    expect(hit?.check.join(' ')).toMatch(/2500-3000 rpm/);
  });

  it('ordena los hallazgos de más a menos concluyente', () => {
    const { findings } = runRules(
      {
        snapshot: snap({
          ltft1: 24, coolant: 89,        // patrón compatible
          dpf_delta: 3.8, rpm: 810,      // observación
        }),
        dtcs: [],
        fuel: 'gasolina',
      },
      new Set(['ltft1', 'stft1', 'coolant', 'dpf_delta', 'rpm']),
    );
    expect(findings[0]?.level).toBe('patron-compatible');
  });
});

describe('base de conocimiento de códigos', () => {
  it('interpreta P2002 con causas y pruebas', () => {
    const k = findDtcKnowledge('P2002');
    expect(k?.system).toBe('DPF');
    expect(k?.priority).toBe('alta');
    expect(k?.causes.length).toBeGreaterThan(3);
    expect(k?.checkParams).toContain('dpf_delta');
  });

  it('devuelve null para un código que no está en la base', () => {
    expect(findDtcKnowledge('P1234')).toBeNull();
    expect(findDtcFor('P9999')).toBeNull();
  });

  it('es insensible a minúsculas', () => {
    expect(findDtcKnowledge('p0171')?.code).toBe('P0171');
  });

  it('cada entrada declara su origen', () => {
    const k = findDtcKnowledge('P0171');
    expect(k?.provenance.source).toBeDefined();
  });

  it('P2002 incluye qué descartaría la hipótesis, no solo qué la apoya', () => {
    const k = findDtcKnowledge('P2002');
    expect(k?.rulesOutIf?.join(' ')).toMatch(/sensor/i);
  });
});
