/**
 * Perfiles de vehículo para el simulador.
 *
 * Esto NO es una base de datos de referencia: son escenarios de prueba.
 * Los valores buscan ser plausibles para ejercitar la UI y el motor de
 * reglas, no describir un vehículo real con precisión.
 */

export interface SimEngineState {
  /** Segundos desde el arranque del simulador. */
  t: number;
  rpm: number;
  speedKmh: number;
  coolantC: number;
  iatC: number;
  loadPct: number;
  throttlePct: number;
  mapKpa: number;
  mafGs: number;
  baroKpa: number;
  timingAdvance: number;
  stftPct: number;
  ltftPct: number;
  voltage: number;
  /** Solo diésel. */
  sootPct: number;
  dpfDiffMbar: number;
  dpfInletC: number;
  dpfOutletC: number;
  regenActive: boolean;
  kmSinceRegen: number;
  railBarActual: number;
  railBarTarget: number;
  boostMbarActual: number;
  boostMbarTarget: number;
}

export type SimFuel = 'gasolina' | 'diesel';

export interface SimDtc {
  code: string;
  kind: 'stored' | 'pending' | 'permanent';
}

export interface SimProfile {
  id: string;
  label: string;
  fuel: SimFuel;
  /** Número de protocolo del ELM327 que reporta ATDPN. */
  protocolNumber: string;
  protocolName: string;
  vin: string | null;
  ecuName: string | null;
  calId: string | null;
  dtcs: SimDtc[];
  /** PIDs del modo 01 que la ECU declara soportar. */
  supportedPids: string[];
  /**
   * Bytes B, C y D del PID 01: estado de los monitores de emisiones.
   * El byte A lo arma el simulador según los códigos almacenados.
   */
  readiness: [number, number, number];
  /** Evoluciona el estado del motor un paso de `dt` segundos. */
  step(state: SimEngineState, dt: number): void;
  initial(): SimEngineState;
}

const baseState = (over: Partial<SimEngineState>): SimEngineState => ({
  t: 0,
  rpm: 0,
  speedKmh: 0,
  coolantC: 18,
  iatC: 18,
  loadPct: 0,
  throttlePct: 0,
  mapKpa: 100,
  mafGs: 0,
  baroKpa: 100,
  timingAdvance: 0,
  stftPct: 0,
  ltftPct: 0,
  voltage: 12.5,
  sootPct: 0,
  dpfDiffMbar: 0,
  dpfInletC: 18,
  dpfOutletC: 18,
  regenActive: false,
  kmSinceRegen: 0,
  railBarActual: 0,
  railBarTarget: 0,
  boostMbarActual: 1000,
  boostMbarTarget: 1000,
  ...over,
});

/** Ralentí con una leve oscilación, como un motor real. */
const idleWobble = (t: number, center: number, amp: number): number =>
  center + Math.sin(t * 2.3) * amp + Math.sin(t * 7.1) * amp * 0.3;

const approach = (current: number, target: number, rate: number, dt: number): number => {
  const delta = target - current;
  const step = Math.sign(delta) * Math.min(Math.abs(delta), rate * dt);
  return current + step;
};

/**
 * VW Golf Mk4 2.0 8V (AZJ/APK), Bosch ME7.5, K-Line KWP2000.
 * Un gasolina sano, para verificar que el sistema NO inventa secciones
 * diésel ni parámetros de DPF donde no corresponden.
 */
export const golf20_8v: SimProfile = {
  id: 'golf-2.0-8v',
  label: 'VW Golf 2.0 8V · ME7.5 · gasolina',
  fuel: 'gasolina',
  protocolNumber: '5',
  protocolName: 'ISO 14230-4 KWP (fast init, 10.4 kbaud)',
  vin: 'WVWZZZ1JZ9W123456',
  ecuName: 'ECM-EngineControl',
  calId: '06A906032HK 2.0l R4/2V ME7.5',
  dtcs: [{ code: 'P0171', kind: 'stored' }],
  supportedPids: [
    '01', '03', '04', '05', '06', '07', '0B', '0C', '0D', '0E',
    '0F', '10', '11', '13', '1C', '1F', '21', '2F', '31', '33',
    '42', '46', '4D', '51',
  ],
  // Encendido por chispa (bit 3 de B en 0), continuos soportados y
  // completos, y los no continuos del lado gasolina todos completos.
  readiness: [0x07, 0xe5, 0x00],
  initial: () => baseState({ coolantC: 19, iatC: 19 }),
  step(s, dt) {
    s.t += dt;
    // Calentamiento hasta termostato.
    s.coolantC = approach(s.coolantC, 89, 0.55, dt);
    s.iatC = approach(s.iatC, 34, 0.25, dt);
    s.rpm = Math.round(idleWobble(s.t, 830, 28));
    s.throttlePct = 13.7;
    s.loadPct = 22 + Math.sin(s.t * 1.7) * 2.5;
    s.mapKpa = 34 + Math.sin(s.t * 2.1) * 1.4;
    s.mafGs = 3.1 + Math.sin(s.t * 1.9) * 0.25;
    s.timingAdvance = 11 + Math.sin(s.t * 1.3) * 2;
    // P0171 = mezcla pobre banco 1: la ECU compensa enriqueciendo.
    s.stftPct = 6.2 + Math.sin(s.t * 3.1) * 3.5;
    s.ltftPct = 19.5;
    s.voltage = 14.1 + Math.sin(s.t * 0.7) * 0.08;
    s.speedKmh = 0;
  },
};

/**
 * Diésel 2.0 TDI con DPF saturado y desviación de boost.
 * Escenario pensado para ejercitar la sección DPF y las reglas de aire.
 */
export const tdi20_dpf: SimProfile = {
  id: 'tdi-2.0-dpf',
  label: 'VW 2.0 TDI · EDC17 · diésel con DPF saturado',
  fuel: 'diesel',
  protocolNumber: '6',
  protocolName: 'ISO 15765-4 CAN (11 bit, 500 kbaud)',
  vin: 'WVWZZZ1KZAW654321',
  ecuName: 'EDC17CP14',
  calId: '03L906018NQ 2.0l TDI EDC17',
  dtcs: [
    { code: 'P2002', kind: 'stored' },
    { code: 'P0234', kind: 'pending' },
  ],
  supportedPids: [
    '01', '03', '04', '05', '06', '07', '0B', '0C', '0D', '0E',
    '0F', '10', '11', '1F', '21', '23', '2F', '31', '33', '42',
    '46', '5C', '62', '70', '78', '7A', '7C',
  ],
  // Encendido por compresión (bit 3 de B en 1). El monitor del filtro de
  // partículas queda pendiente, que es lo típico tras una regeneración
  // interrumpida o un borrado reciente.
  readiness: [0x0f, 0x6b, 0x40],
  initial: () => baseState({
    coolantC: 21,
    iatC: 21,
    sootPct: 72,
    dpfDiffMbar: 38,
    kmSinceRegen: 410,
    railBarActual: 0,
    boostMbarActual: 1000,
  }),
  step(s, dt) {
    s.t += dt;
    s.coolantC = approach(s.coolantC, 86, 0.5, dt);
    s.iatC = approach(s.iatC, 31, 0.2, dt);
    s.rpm = Math.round(idleWobble(s.t, 810, 22));
    s.throttlePct = 0;
    s.loadPct = 27 + Math.sin(s.t * 1.5) * 3;
    s.mapKpa = 101 + Math.sin(s.t * 1.8) * 1.2;
    s.mafGs = 11.4 + Math.sin(s.t * 1.6) * 0.6;
    s.timingAdvance = 0;
    s.stftPct = 0;
    s.ltftPct = 0;
    s.voltage = 14.0 + Math.sin(s.t * 0.6) * 0.07;
    s.speedKmh = 0;
    s.railBarTarget = 280;
    s.railBarActual = approach(s.railBarActual, 272, 60, dt);
    // Overboost leve y sostenido: alimenta la regla de control de presión.
    s.boostMbarTarget = 1010;
    s.boostMbarActual = approach(s.boostMbarActual, 1180, 90, dt);
    s.dpfInletC = approach(s.dpfInletC, 245, 1.6, dt);
    s.dpfOutletC = approach(s.dpfOutletC, 231, 1.5, dt);
    s.dpfDiffMbar = 36 + Math.sin(s.t * 1.1) * 2.5;
  },
};

export const PROFILES: SimProfile[] = [golf20_8v, tdi20_dpf];

export const profileById = (id: string): SimProfile =>
  PROFILES.find((p) => p.id === id) ?? golf20_8v;
