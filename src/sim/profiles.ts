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

/** Un resultado de prueba del modo 06: valor medido contra sus límites. */
export interface SimTest {
  mid: number;
  tid: number;
  uas: number;
  value: number;
  min: number;
  max: number;
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
  /** Número de verificación de calibración (modo 09 PID 06), 4 bytes. */
  cvn?: [number, number, number, number];
  /** Identificadores UDS (servicio 0x22) que la ECU contesta: DID -> texto. */
  uds?: Record<string, string>;
  /** Resultados de autodiagnóstico del modo 06. */
  mode06?: SimTest[];
  /** La lectura de memoria exige acceso de seguridad previo. */
  lecturaRequiereSeguridad?: boolean;
  /** Segunda unidad que también contesta en el bus (transmisión). */
  segunda?: {
    ecuName: string;
    calId: string;
    dtcs: SimDtc[];
    supportedPids: string[];
    uds?: Record<string, string>;
  };
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
  calId: '06A906032HK 0005',
  dtcs: [{ code: 'P0171', kind: 'stored' }],
  supportedPids: [
    '01', '03', '04', '05', '06', '07', '0B', '0C', '0D', '0E',
    '0F', '10', '11', '13', '1C', '1F', '21', '2F', '31', '33',
    '42', '46', '4D', '51',
  ],
  // Encendido por chispa (bit 3 de B en 0), continuos soportados y
  // completos, y los no continuos del lado gasolina todos completos.
  readiness: [0x07, 0xe5, 0x00],
  cvn: [0x5e, 0x10, 0x7b, 0x92],
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
  calId: '03L906018NQ 9977',
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
  cvn: [0x8a, 0x3f, 0x21, 0xc4],
  uds: {
    F190: 'WVWZZZ1KZAW654321',
    F187: '03L906018NQ',
    F189: '9977',
    F191: '03L907309AE',
    F197: 'R4 2.0l TDI',
    F18C: '0281017946',
  },
  lecturaRequiereSeguridad: true,
  mode06: [
    // Filtro de partículas: valor por encima del máximo, prueba fallida.
    { mid: 0xb2, tid: 0x8a, uas: 0x17, value: 0x0e10, min: 0x0000, max: 0x0bb8 },
    // Sensor de gases de escape: dentro de límites.
    { mid: 0x01, tid: 0x81, uas: 0x0a, value: 0x0456, min: 0x0200, max: 0x0800 },
    // Presión de sobrealimentación: cerca del límite superior.
    { mid: 0x85, tid: 0x90, uas: 0x17, value: 0x0780, min: 0x0100, max: 0x0800 },
    // EGR: dentro de límites.
    { mid: 0x31, tid: 0x84, uas: 0x01, value: 0x0064, min: 0x0020, max: 0x00c8 },
  ],
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

/**
 * El mismo diésel con caja automática: dos unidades contestan en el bus.
 * Sirve para ejercitar la separación por ECU, que es donde un parser
 * ingenuo mezcla respuestas y fabrica datos.
 */
export const tdi20_dsg: SimProfile = {
  ...tdi20_dpf,
  id: 'tdi-2.0-dsg',
  label: 'VW 2.0 TDI con caja DSG · dos ECU en el bus',
  segunda: {
    ecuName: 'TCM-DSG 02E',
    calId: '02E300058P 1305',
    dtcs: [{ code: 'P0715', kind: 'stored' }],
    supportedPids: ['0C', '0D'],
    uds: { F187: '02E927770AL', F189: '1305', F197: 'GSG DSG AG6' },
  },
};

export const PROFILES: SimProfile[] = [golf20_8v, tdi20_dpf, tdi20_dsg];

export const profileById = (id: string): SimProfile =>
  PROFILES.find((p) => p.id === id) ?? golf20_8v;
