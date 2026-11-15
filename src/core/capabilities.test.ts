import { describe, expect, it } from 'vitest';
import { actionableFeatures, capabilityOf, evaluateCapabilities, isVag } from './capabilities';
import { protocolById } from './elm327/protocols';

const can = protocolById('6');
const kwpFast = protocolById('5');
const iso9141 = protocolById('3');

describe('modelo de capacidades', () => {
  it('sin protocolo, todo queda en desconocido', () => {
    const v = evaluateCapabilities({ protocol: null, adapter: null });
    expect(v.every((x) => x.support === 'desconocido')).toBe(true);
  });

  it('OBD-II genérico es compatible en cualquier protocolo', () => {
    for (const p of [can, kwpFast, iso9141]) {
      const v = evaluateCapabilities({ protocol: p, adapter: null });
      expect(capabilityOf(v, 'obd2.dtc.read')?.support).toBe('compatible');
      expect(capabilityOf(v, 'obd2.livedata')?.support).toBe('compatible');
    }
  });

  it('ISO 9141 descarta el diagnóstico de fabricante, no lo deja en duda', () => {
    const v = evaluateCapabilities({ protocol: iso9141, adapter: null });
    expect(capabilityOf(v, 'mfr.measuring.blocks')?.support).toBe('no-compatible');
    expect(capabilityOf(v, 'mfr.adaptation')?.support).toBe('no-compatible');
  });

  it('nunca declara compatible una función de fabricante sin haberla probado', () => {
    const v = evaluateCapabilities({ protocol: can, adapter: null, make: 'Volkswagen' });
    const mfr = v.filter((x) => x.feature.scope === 'fabricante');
    expect(mfr.length).toBeGreaterThan(0);
    expect(mfr.every((x) => x.support !== 'compatible')).toBe(true);
  });

  it('advierte sobre KW1281 en VAG con K-Line', () => {
    const v = evaluateCapabilities({ protocol: kwpFast, adapter: null, make: 'Audi' });
    expect(capabilityOf(v, 'mfr.measuring.blocks')?.reason).toMatch(/KW1281/);
  });

  it('advierte cuando el adaptador se identifica como clon', () => {
    const v = evaluateCapabilities({
      protocol: can,
      adapter: { version: 'ELM327 v2.1', likelyClone: true },
    });
    expect(capabilityOf(v, 'mfr.actuator.test')?.reason).toMatch(/clon/i);
  });

  it('solo expone como accionable lo que está implementado y es compatible', () => {
    const v = evaluateCapabilities({ protocol: can, adapter: null });
    const ids = actionableFeatures(v).map((x) => x.feature.id);
    expect(ids).toContain('obd2.dtc.read');
    expect(ids).toContain('obd2.livedata');
    // Los datos congelados están declarados pero no implementados.
    expect(ids).not.toContain('obd2.freezeframe');
    expect(ids.every((id) => id.startsWith('obd2.'))).toBe(true);
  });

  it('toda función de escritura queda marcada como tal', () => {
    const v = evaluateCapabilities({ protocol: can, adapter: null });
    expect(capabilityOf(v, 'obd2.dtc.clear')?.feature.writes).toBe(true);
    expect(capabilityOf(v, 'mfr.actuator.test')?.feature.risk).toBe('fisico');
    expect(capabilityOf(v, 'obd2.livedata')?.feature.writes).toBe(false);
  });

  it('reconoce las marcas del grupo VAG', () => {
    expect(isVag('Volkswagen')).toBe(true);
    expect(isVag('SEAT')).toBe(true);
    expect(isVag('Škoda')).toBe(true);
    expect(isVag('Toyota')).toBe(false);
    expect(isVag(undefined)).toBe(false);
  });
});
