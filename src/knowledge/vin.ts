/**
 * Decodificación del VIN (ISO 3779 / ISO 3780).
 *
 * Del VIN salen tres cosas sin consultar nada: quién fabricó el vehículo y
 * dónde (los tres primeros caracteres, WMI), el año modelo (posición 10) y
 * el número de serie.
 *
 * Límites, dichos de frente:
 *  - La tabla de fabricantes es parcial: están los que más circulan en
 *    Chile. Un WMI que no figura se informa como no identificado; no se
 *    adivina por parecido.
 *  - La posición 10 como año modelo es obligatoria en Norteamérica y de uso
 *    muy extendido, pero no universal. Se informa como "según posición 10".
 *  - El código de año se repite cada 30 años. Se elige el más reciente que
 *    no quede en el futuro.
 */

export interface VinInfo {
  vin: string;
  valid: boolean;
  /** Por qué no es válido, si no lo es. */
  problem?: string;
  wmi: string;
  manufacturer: string | null;
  country: string | null;
  modelYear: number | null;
  serial: string;
}

/** WMI -> [fabricante, país de fabricación]. */
const WMI: Record<string, [string, string]> = {
  // Volkswagen y grupo
  WVW: ['Volkswagen', 'Alemania'], WV1: ['Volkswagen Comerciales', 'Alemania'],
  WV2: ['Volkswagen Comerciales', 'Alemania'], '3VW': ['Volkswagen', 'México'],
  '9BW': ['Volkswagen', 'Brasil'], '8AW': ['Volkswagen', 'Argentina'],
  WAU: ['Audi', 'Alemania'], TRU: ['Audi', 'Hungría'],
  VSS: ['SEAT', 'España'], TMB: ['Škoda', 'República Checa'],
  // Toyota
  JTD: ['Toyota', 'Japón'], JTE: ['Toyota', 'Japón'], JTM: ['Toyota', 'Japón'],
  JTN: ['Toyota', 'Japón'], MR0: ['Toyota', 'Tailandia'], '8AJ': ['Toyota', 'Argentina'],
  '9BR': ['Toyota', 'Brasil'],
  // Mitsubishi, Nissan, Isuzu, Mazda
  MMB: ['Mitsubishi', 'Tailandia'], JMB: ['Mitsubishi', 'Japón'],
  JN1: ['Nissan', 'Japón'], '3N1': ['Nissan', 'México'], '3N6': ['Nissan', 'México'],
  MNT: ['Nissan', 'Tailandia'], MPA: ['Isuzu', 'Tailandia'],
  JM1: ['Mazda', 'Japón'], JMZ: ['Mazda', 'Japón'], MM7: ['Mazda', 'Tailandia'],
  // Ford
  WF0: ['Ford', 'Alemania'], '8AF': ['Ford', 'Argentina'], MNB: ['Ford', 'Tailandia'],
  '9BF': ['Ford', 'Brasil'], '1FT': ['Ford', 'Estados Unidos'],
  // GM
  '9BG': ['Chevrolet', 'Brasil'], '8AG': ['Chevrolet', 'Argentina'],
  LSG: ['Chevrolet (SAIC-GM)', 'China'], KL1: ['Chevrolet (GM Korea)', 'Corea del Sur'],
  '3G1': ['Chevrolet', 'México'], '1G1': ['Chevrolet', 'Estados Unidos'],
  // Hyundai y Kia
  KMH: ['Hyundai', 'Corea del Sur'], MAL: ['Hyundai', 'India'],
  KNA: ['Kia', 'Corea del Sur'], KND: ['Kia', 'Corea del Sur'],
  // Suzuki
  JS2: ['Suzuki', 'Japón'], JSA: ['Suzuki', 'Japón'], MA3: ['Suzuki (Maruti)', 'India'],
  // Europeos
  VF1: ['Renault', 'Francia'], '93Y': ['Renault', 'Brasil'],
  VF3: ['Peugeot', 'Francia'], VF7: ['Citroën', 'Francia'],
  ZFA: ['Fiat', 'Italia'], '9BD': ['Fiat', 'Brasil'],
  WBA: ['BMW', 'Alemania'], WDB: ['Mercedes-Benz', 'Alemania'], WDD: ['Mercedes-Benz', 'Alemania'],
  // Honda y Subaru
  JHM: ['Honda', 'Japón'], '93H': ['Honda', 'Brasil'], JF1: ['Subaru', 'Japón'],
  // Chinos
  LGW: ['Great Wall', 'China'], LVV: ['Chery', 'China'], LS5: ['Changan', 'China'],
  LJ1: ['JAC', 'China'], LSJ: ['MG (SAIC)', 'China'],
};

/** Región según el primer carácter, cuando el WMI exacto no está en la tabla. */
function region(c: string): string | null {
  if ('ABCDEFGH'.includes(c)) return 'África';
  if ('JKLMNPR'.includes(c)) return 'Asia';
  if ('STUVWXYZ'.includes(c)) return 'Europa';
  if ('12345'.includes(c)) return 'Norteamérica';
  if ('67'.includes(c)) return 'Oceanía';
  if ('89'.includes(c)) return 'Sudamérica';
  return null;
}

const CODIGOS_ANIO = 'ABCDEFGHJKLMNPRSTVWXY123456789';

function anioModelo(c: string, hoy: number): number | null {
  const i = CODIGOS_ANIO.indexOf(c);
  if (i === -1) return null;
  // 'A' es 1980 y también 2010: el ciclo es de 30 años.
  let anio = 1980 + i;
  while (anio + 30 <= hoy + 1) anio += 30;
  return anio;
}

export function decodificarVin(crudo: string, hoy = new Date().getFullYear()): VinInfo {
  const vin = crudo.trim().toUpperCase();
  const base = {
    vin, wmi: vin.slice(0, 3), manufacturer: null, country: null,
    modelYear: null, serial: vin.slice(11),
  };
  if (vin.length !== 17) {
    return { ...base, valid: false, problem: `Tiene ${vin.length} caracteres y deben ser 17` };
  }
  if (/[IOQ]/.test(vin)) {
    return { ...base, valid: false, problem: 'Contiene I, O o Q, que un VIN no usa' };
  }
  if (!/^[A-Z0-9]{17}$/.test(vin)) {
    return { ...base, valid: false, problem: 'Contiene caracteres que no son letras ni números' };
  }
  const entrada = WMI[vin.slice(0, 3)];
  return {
    ...base,
    valid: true,
    manufacturer: entrada?.[0] ?? null,
    country: entrada?.[1] ?? region(vin[0] ?? ''),
    modelYear: anioModelo(vin[9] ?? '', hoy),
  };
}
