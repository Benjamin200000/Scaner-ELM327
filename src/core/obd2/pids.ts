/**
 * Catálogo de PID del modo 01 y los parámetros que cada uno entrega.
 *
 * Dos decisiones de diseño:
 *
 * 1. Un PID puede dar VARIOS parámetros. Los PID diésel ampliados (0x70,
 *    0x7A, 0x7C) traen un byte de máscara y después varios campos. Modelarlos
 *    como "un PID = un valor" obliga a parchear la UI después.
 *
 * 2. Cada parámetro declara `verified`. Las fórmulas del bloque clásico
 *    (0x01-0x5E) son estables y están en SAE J1979. Las de los PID ampliados
 *    varían entre fabricantes y NO las pude verificar contra una ECU real ni
 *    contra la norma: van marcadas como no verificadas, y la UI las muestra
 *    como tales en modo técnico en lugar de presentarlas como dato firme.
 */

export type SystemId =
  | 'motor'
  | 'combustible'
  | 'admision'
  | 'turbo'
  | 'egr'
  | 'dpf'
  | 'emisiones'
  | 'encendido'
  | 'sensores'
  | 'vehiculo';

export interface ParamDef {
  id: string;
  label: string;
  unit: string;
  system: SystemId;
  decimals: number;
  /** false = layout/escala sin verificar contra norma o vehículo real. */
  verified: boolean;
  /** Devuelve null cuando el campo no está presente según la máscara. */
  decode(payload: number[]): number | null;
}

export interface PidDef {
  /** Número de PID dentro del modo 01. */
  pid: number;
  /** Bytes de datos esperados, sin contar el eco de modo y PID. */
  bytes: number;
  params: ParamDef[];
}

const b = (payload: number[], i: number): number | null => payload[i] ?? null;

const u16at = (payload: number[], i: number): number | null => {
  const hi = payload[i];
  const lo = payload[i + 1];
  if (hi === undefined || lo === undefined) return null;
  return (hi << 8) | lo;
};

/** Los PID ampliados traen un bit por campo en el primer byte. */
const maskBit = (payload: number[], bit: number): boolean => {
  const mask = payload[0];
  if (mask === undefined) return false;
  return (mask & (1 << bit)) !== 0;
};

const p = (
  id: string,
  label: string,
  unit: string,
  system: SystemId,
  decimals: number,
  decode: (payload: number[]) => number | null,
  verified = true,
): ParamDef => ({ id, label, unit, system, decimals, verified, decode });

export const PID_DEFS: PidDef[] = [
  {
    pid: 0x01,
    bytes: 4,
    params: [
      p('mil', 'Testigo de avería', '', 'emisiones', 0, (d) => {
        const a = b(d, 0);
        return a === null ? null : (a & 0x80) !== 0 ? 1 : 0;
      }),
      p('dtc_count', 'Códigos confirmados', '', 'emisiones', 0, (d) => {
        const a = b(d, 0);
        return a === null ? null : a & 0x7f;
      }),
    ],
  },
  {
    pid: 0x04,
    bytes: 1,
    params: [
      p('load', 'Carga calculada', '%', 'motor', 1, (d) => {
        const a = b(d, 0);
        return a === null ? null : (a * 100) / 255;
      }),
    ],
  },
  {
    pid: 0x05,
    bytes: 1,
    params: [
      p('coolant', 'Temperatura refrigerante', '°C', 'motor', 0, (d) => {
        const a = b(d, 0);
        return a === null ? null : a - 40;
      }),
    ],
  },
  {
    pid: 0x06,
    bytes: 1,
    params: [
      p('stft1', 'Corrección corta banco 1', '%', 'combustible', 1, (d) => {
        const a = b(d, 0);
        return a === null ? null : (a - 128) / 1.28;
      }),
    ],
  },
  {
    pid: 0x07,
    bytes: 1,
    params: [
      p('ltft1', 'Corrección larga banco 1', '%', 'combustible', 1, (d) => {
        const a = b(d, 0);
        return a === null ? null : (a - 128) / 1.28;
      }),
    ],
  },
  {
    pid: 0x0a,
    bytes: 1,
    params: [
      p('fuel_pressure', 'Presión de combustible', 'kPa', 'combustible', 0, (d) => {
        const a = b(d, 0);
        return a === null ? null : a * 3;
      }),
    ],
  },
  {
    pid: 0x0b,
    bytes: 1,
    params: [
      p('map', 'Presión colector (MAP)', 'kPa', 'admision', 0, (d) => b(d, 0)),
    ],
  },
  {
    pid: 0x0c,
    bytes: 2,
    params: [
      p('rpm', 'Régimen del motor', 'rpm', 'motor', 0, (d) => {
        const v = u16at(d, 0);
        return v === null ? null : v / 4;
      }),
    ],
  },
  {
    pid: 0x0d,
    bytes: 1,
    params: [
      p('speed', 'Velocidad del vehículo', 'km/h', 'vehiculo', 0, (d) => b(d, 0)),
    ],
  },
  {
    pid: 0x0e,
    bytes: 1,
    params: [
      p('timing', 'Avance de encendido', '°', 'encendido', 1, (d) => {
        const a = b(d, 0);
        return a === null ? null : a / 2 - 64;
      }),
    ],
  },
  {
    pid: 0x0f,
    bytes: 1,
    params: [
      p('iat', 'Temperatura aire admisión', '°C', 'admision', 0, (d) => {
        const a = b(d, 0);
        return a === null ? null : a - 40;
      }),
    ],
  },
  {
    pid: 0x10,
    bytes: 2,
    params: [
      p('maf', 'Caudal de aire (MAF)', 'g/s', 'admision', 2, (d) => {
        const v = u16at(d, 0);
        return v === null ? null : v / 100;
      }),
    ],
  },
  {
    pid: 0x11,
    bytes: 1,
    params: [
      p('throttle', 'Posición mariposa', '%', 'admision', 1, (d) => {
        const a = b(d, 0);
        return a === null ? null : (a * 100) / 255;
      }),
    ],
  },
  {
    pid: 0x1f,
    bytes: 2,
    params: [
      p('run_time', 'Tiempo desde arranque', 's', 'motor', 0, (d) => u16at(d, 0)),
    ],
  },
  {
    pid: 0x21,
    bytes: 2,
    params: [
      p('dist_mil', 'Distancia con testigo encendido', 'km', 'emisiones', 0,
        (d) => u16at(d, 0)),
    ],
  },
  {
    pid: 0x23,
    bytes: 2,
    params: [
      p('rail_pressure', 'Presión del riel', 'kPa', 'combustible', 0, (d) => {
        const v = u16at(d, 0);
        return v === null ? null : v * 10;
      }),
    ],
  },
  {
    pid: 0x2c,
    bytes: 1,
    params: [
      p('egr_cmd', 'EGR solicitada', '%', 'egr', 1, (d) => {
        const a = b(d, 0);
        return a === null ? null : (a * 100) / 255;
      }),
    ],
  },
  {
    pid: 0x2d,
    bytes: 1,
    params: [
      p('egr_error', 'Error de EGR', '%', 'egr', 1, (d) => {
        const a = b(d, 0);
        return a === null ? null : (a - 128) * 100 / 128;
      }),
    ],
  },
  {
    pid: 0x2f,
    bytes: 1,
    params: [
      p('fuel_level', 'Nivel de combustible', '%', 'vehiculo', 1, (d) => {
        const a = b(d, 0);
        return a === null ? null : (a * 100) / 255;
      }),
    ],
  },
  {
    pid: 0x31,
    bytes: 2,
    params: [
      p('dist_cleared', 'Distancia desde borrado', 'km', 'emisiones', 0,
        (d) => u16at(d, 0)),
    ],
  },
  {
    pid: 0x33,
    bytes: 1,
    params: [
      p('baro', 'Presión atmosférica', 'kPa', 'admision', 0, (d) => b(d, 0)),
    ],
  },
  {
    pid: 0x42,
    bytes: 2,
    params: [
      p('module_voltage', 'Tensión de la ECU', 'V', 'motor', 2, (d) => {
        const v = u16at(d, 0);
        return v === null ? null : v / 1000;
      }),
    ],
  },
  {
    pid: 0x43,
    bytes: 2,
    params: [
      p('abs_load', 'Carga absoluta', '%', 'motor', 1, (d) => {
        const v = u16at(d, 0);
        return v === null ? null : (v * 100) / 255;
      }),
    ],
  },
  {
    pid: 0x44,
    bytes: 2,
    params: [
      p('lambda_cmd', 'Lambda solicitada', 'λ', 'combustible', 3, (d) => {
        const v = u16at(d, 0);
        return v === null ? null : (v * 2) / 65536;
      }),
    ],
  },
  {
    pid: 0x46,
    bytes: 1,
    params: [
      p('ambient', 'Temperatura ambiente', '°C', 'sensores', 0, (d) => {
        const a = b(d, 0);
        return a === null ? null : a - 40;
      }),
    ],
  },
  {
    pid: 0x4d,
    bytes: 2,
    params: [
      p('time_mil', 'Tiempo con testigo encendido', 'min', 'emisiones', 0,
        (d) => u16at(d, 0)),
    ],
  },
  {
    pid: 0x51,
    bytes: 1,
    params: [
      p('fuel_type', 'Tipo de combustible', '', 'vehiculo', 0, (d) => b(d, 0)),
    ],
  },
  {
    pid: 0x5c,
    bytes: 1,
    params: [
      p('oil_temp', 'Temperatura de aceite', '°C', 'motor', 0, (d) => {
        const a = b(d, 0);
        return a === null ? null : a - 40;
      }),
    ],
  },
  {
    pid: 0x5e,
    bytes: 2,
    params: [
      p('fuel_rate', 'Consumo instantáneo', 'L/h', 'combustible', 2, (d) => {
        const v = u16at(d, 0);
        return v === null ? null : v / 20;
      }),
    ],
  },
  {
    pid: 0x62,
    bytes: 1,
    params: [
      p('torque_actual', 'Par real del motor', '%', 'motor', 0, (d) => {
        const a = b(d, 0);
        return a === null ? null : a - 125;
      }),
    ],
  },
  // ---------------------------------------------------------------------
  // PID ampliados, principalmente diésel. Layout NO verificado: ver nota
  // al inicio del archivo. Se exponen marcados, no como dato firme.
  // ---------------------------------------------------------------------
  {
    pid: 0x70,
    bytes: 7,
    params: [
      p('boost_cmd', 'Boost solicitado', 'kPa', 'turbo', 1, (d) =>
        maskBit(d, 0) ? scale(u16at(d, 1), 0.03125) : null, false),
      p('boost_actual', 'Boost real', 'kPa', 'turbo', 1, (d) =>
        maskBit(d, 1) ? scale(u16at(d, 3), 0.03125) : null, false),
    ],
  },
  {
    pid: 0x78,
    bytes: 9,
    params: [
      p('egt1', 'Temperatura de escape', '°C', 'dpf', 0, (d) =>
        maskBit(d, 0) ? offsetScale(u16at(d, 1), 0.1, -40) : null, false),
    ],
  },
  {
    pid: 0x7a,
    bytes: 9,
    params: [
      p('dpf_delta', 'Presión diferencial DPF', 'kPa', 'dpf', 2, (d) =>
        maskBit(d, 3) ? offsetScale(u16at(d, 3), 0.01, -327.68) : null, false),
    ],
  },
  {
    pid: 0x7c,
    bytes: 9,
    params: [
      p('dpf_inlet_temp', 'Temperatura entrada DPF', '°C', 'dpf', 0, (d) =>
        maskBit(d, 0) ? offsetScale(u16at(d, 1), 0.1, -40) : null, false),
      p('dpf_outlet_temp', 'Temperatura salida DPF', '°C', 'dpf', 0, (d) =>
        maskBit(d, 3) ? offsetScale(u16at(d, 3), 0.1, -40) : null, false),
    ],
  },
];

const scale = (v: number | null, k: number): number | null => (v === null ? null : v * k);

const offsetScale = (v: number | null, k: number, off: number): number | null =>
  v === null ? null : v * k + off;

export const pidByNumber = (pid: number): PidDef | null =>
  PID_DEFS.find((d) => d.pid === pid) ?? null;

/** Índice parámetro -> PID que lo provee. */
export const PARAM_INDEX: Map<string, { pid: PidDef; param: ParamDef }> = new Map(
  PID_DEFS.flatMap((pid) => pid.params.map((param) => [param.id, { pid, param }] as const)),
);

export const paramById = (id: string): ParamDef | null =>
  PARAM_INDEX.get(id)?.param ?? null;

/** Nombre legible del tipo de combustible del PID 0x51. */
export const FUEL_TYPES: Record<number, string> = {
  0: 'No disponible',
  1: 'Gasolina',
  2: 'Metanol',
  3: 'Etanol',
  4: 'Diésel',
  5: 'GLP',
  6: 'GNC',
  7: 'Propano',
  8: 'Eléctrico',
  9: 'Bifuel gasolina',
  10: 'Bifuel metanol',
  11: 'Bifuel etanol',
  12: 'Bifuel GLP',
  13: 'Bifuel GNC',
  14: 'Bifuel propano',
  15: 'Bifuel eléctrico',
  17: 'Híbrido gasolina',
  18: 'Híbrido etanol',
  19: 'Híbrido diésel',
  20: 'Híbrido eléctrico',
  23: 'Híbrido recargable',
};
