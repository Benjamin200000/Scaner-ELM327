/**
 * Fórmulas de los bloques de medición de VAG (KW1281 y KWP2000 por K-Line).
 *
 * En estos protocolos, cada valor de un grupo de medición llega como un
 * triplete: un código de fórmula y dos bytes (A y B). El código dice cómo
 * convertir A y B en una magnitud física con su unidad. La misma tabla de
 * fórmulas vale para KW1281 y para los "measuring blocks" de KWP2000.
 *
 * La tabla está portada de gmenounos/kw1281test (SensorValue.cs), que es la
 * implementación abierta de referencia y la mantiene la comunidad contra
 * autos reales. Es la parte que da sentido a los datos crudos; sin ella, un
 * grupo de medición son solo números sin unidad.
 */

export interface Medicion {
  /** Valor numérico, o null para las fórmulas de texto/estado. */
  value: number | null;
  unit: string;
  /** Representación lista para mostrar, con su unidad. */
  text: string;
  /** Código de fórmula y bytes crudos, para el modo técnico. */
  code: number;
  a: number;
  b: number;
}

const bin8 = (n: number): string => n.toString(2).padStart(8, '0');
const car = (n: number): string => (n >= 0x20 && n <= 0x7e ? String.fromCharCode(n) : '.');

/**
 * Decodifica un triplete (código, A, B) en una medición.
 *
 * Un código desconocido NO se inventa: se muestra crudo como "(code A B)",
 * igual que hace la referencia, para no presentar un número sin sentido como
 * si fuera una lectura real.
 */
export function decodificarMedicion(code: number, a: number, b: number): Medicion {
  const num = (value: number, unit: string, dec = 1): Medicion =>
    ({ value, unit, text: `${value.toFixed(dec)} ${unit}`.trim(), code, a, b });
  const txt = (text: string, unit = ''): Medicion =>
    ({ value: null, unit, text, code, a, b });

  switch (code) {
    case 0: return txt('—');
    case 1: return num(0.2 * a * b, 'rpm', 0);
    case 2: return num(a * 0.002 * b, '%');
    case 3: return num(0.002 * a * b, '°');
    case 4: return txt(`${(Math.abs(b - 127) * 0.01 * a).toFixed(1)} °${b > 127 ? 'ATDC' : 'BTDC'}`);
    case 5: return num(a * (b - 100) * 0.1, '°C');
    case 6: return num(0.001 * a * b, 'V', 2);
    case 7: return num(0.01 * a * b, 'km/h', 0);
    case 8: return num(0.1 * a * b, '');
    case 9: return num((b - 127) * 0.02 * a, '°');
    case 10: return txt(b === 0 ? 'Frío' : 'Caliente');
    case 11: return num(0.0001 * a * (b - 128) + 1, '');
    case 12: return num(0.001 * a * b, 'Ω');
    case 13: return num((b - 127) * 0.001 * a, 'mm');
    case 14: return num(0.005 * a * b, 'bar', 2);
    case 15: return num(0.01 * a * b, 'ms');
    case 16: return txt(`${bin8(a)} ${bin8(b)}`);
    case 17: return txt(`"${car(a)}${car(b)}"`);
    case 18: return num(0.04 * a * b, 'mbar', 0);
    case 19: return num(a * b * 0.01, 'l');
    case 20: return num((a * (b - 128)) / 128, '%');
    case 21: return num(0.001 * a * b, 'V', 2);
    case 22: return num(0.001 * a * b, 'ms', 2);
    case 23: return num((b / 256) * a, '%');
    case 24: return num(0.001 * a * b, 'A', 2);
    case 25: return num(b * 1.421 + a / 182, 'g/s', 2);
    case 26: return num(b - a, '°C', 0);
    case 27: return txt(`${(Math.abs(b - 128) * 0.01 * a).toFixed(1)} °${b < 128 ? 'ATDC' : 'BTDC'}`);
    case 28: return num(b - a, '', 0);
    case 29: return txt(b < a ? 'Mapa 1' : 'Mapa 2');
    case 30: return num((b / 12) * a, '° k/w');
    case 31: return num((b / 2560) * a, '');
    case 32: return num(b > 128 ? b - 256 : b, '', 0);
    case 33: return num(a === 0 ? 100 * b : (100 * b) / a, '%');
    case 34: return num((b - 128) * 0.01 * a, 'kW', 2);
    case 35: return num(0.01 * a * b, 'l/h', 2);
    case 36: return num(a * 2560 + b * 10, 'km', 0);
    case 38: return num((b - 128) * 0.001 * a, '° k/w');
    case 39: return num((b / 256) * a, 'mg/h', 0);
    case 40: return num(b * 0.1 + 25.5 * a - 400, 'A');
    case 41: return num(b + a * 255, 'Ah', 0);
    case 42: return num(b * 0.1 + 25.5 * a - 400, 'kW');
    case 43: return num(b * 0.1 + 25.5 * a, 'V');
    case 44: return txt(`${String(a).padStart(2, '0')}:${String(b).padStart(2, '0')}`);
    case 45: return num((0.1 * a * b) / 100, '');
    case 46: return num((a * b - 3200) * 0.0027, '° k/w');
    case 47: return num((b - 128) * a, 'ms', 0);
    case 48: return num(b + a * 255, '', 0);
    case 49: return num((b / 4) * a * 0.1, 'mg/h');
    case 50: return num(a === 0 ? (b - 128) / 0.01 : (b - 128) / (0.01 * a), 'mbar', 0);
    case 51: return num(((b - 128) / 255) * a, 'mg/h');
    case 52: return num(b * 0.02 * a - a, 'Nm');
    case 53: return num((b - 128) * 1.4222 + 0.006 * a, 'g/s', 2);
    case 54: return num(a * 256 + b, '', 0);
    case 55: return num((a * b) / 200, 's', 2);
    case 56: return num(a * 256 + b, 'WSC', 0);
    case 57: return num(a * 256 + b + 65536, 'WSC', 0);
    case 58: return num(b > 128 ? 1.0225 * (256 - b) : 1.0225 * b, '/s');
    case 59: return num((a * 256 + b) / 32768, '');
    case 60: return num((a * 256 + b) * 0.01, 's', 2);
    case 61: return num(a === 0 ? b - 128 : (b - 128) / a, '');
    case 62: return num(0.256 * a * b, 'S', 0);
    case 63: return txt(`"${car(a)}${car(b)}"?`);
    case 64: return num(a + b, 'Ω', 0);
    case 65: return num(0.01 * a * (b - 127), 'mm');
    case 66: return num((a * b) / 511.12, 'V', 2);
    case 67: return num(640 * a + b * 2.5, '°');
    case 68: return num((256 * a + b) / 7.365, '°/s');
    case 69: return num((256 * a + b) * 0.3254, 'bar', 2);
    case 70: return num((256 * a + b) * 0.192, 'm/s²');
    default: return txt(`(${code} ${a} ${b})`);
  }
}
