/** Códigos de falla: decodificación y clasificación. */

export type DtcKind = 'stored' | 'pending' | 'permanent';

export type DtcGroup = 'P' | 'C' | 'B' | 'U';

export interface Dtc {
  /** 'P0171'. */
  code: string;
  group: DtcGroup;
  kind: DtcKind;
  /** ECU que lo informó, cuando la respuesta trae cabecera. */
  ecu?: string;
}

const GROUPS: DtcGroup[] = ['P', 'C', 'B', 'U'];

/**
 * Decodifica un par de bytes en un código.
 *
 * Dos bits de grupo, dos del primer dígito, y los tres nibbles restantes
 * en hexadecimal. `0000` significa "sin código" y se descarta.
 */
export function decodeDtc(a: number, b: number): string | null {
  if (a === 0 && b === 0) return null;
  const group = GROUPS[(a >> 6) & 0x3] ?? 'P';
  const d1 = (a >> 4) & 0x3;
  const d2 = a & 0xf;
  const rest = b.toString(16).toUpperCase().padStart(2, '0');
  return `${group}${d1}${d2.toString(16).toUpperCase()}${rest}`;
}

/**
 * Extrae los códigos de una respuesta a los modos 03, 07 o 0A.
 *
 * Los dos formatos reales son:
 *   - CAN:  43 <cantidad> <dtc...>
 *   - KWP:  43 <dtc1> <dtc2> <dtc3>, rellenando con 0000
 *
 * La diferencia NO se puede deducir del payload. El byte [01 02 03 00] se
 * lee como 'P0203' si el 01 es un contador, o como 'P0102' y 'P0300' si no
 * lo es, y las dos lecturas son internamente consistentes: un primer código
 * como P0102 tiene byte alto 0x01, idéntico a un contador de "un código".
 *
 * Adivinar acá significa inventar o perder códigos de falla. El dato que
 * desambigua es el protocolo, que el driver ya conoce, así que se exige
 * explícito.
 */
export function parseDtcPayload(
  bytes: number[],
  kind: DtcKind,
  hasCountByte: boolean,
): Dtc[] {
  const body = hasCountByte ? bytes.slice(1) : bytes;
  const declared = hasCountByte ? bytes[0] : undefined;

  let codes = tryDecode(body) ?? [];
  // Con contador, recortar al total declarado: algunas ECU rellenan la
  // trama con bytes que no son códigos.
  if (declared !== undefined && declared < codes.length) {
    codes = codes.slice(0, declared);
  }
  return codes.map((code) => ({
    code,
    group: (code[0] as DtcGroup) ?? 'P',
    kind,
  }));
}

function tryDecode(bytes: number[]): string[] | null {
  if (bytes.length === 0) return [];
  const out: string[] = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) {
    const a = bytes[i];
    const b = bytes[i + 1];
    if (a === undefined || b === undefined) break;
    const code = decodeDtc(a, b);
    if (code !== null) out.push(code);
  }
  return out;
}

/** Sistema al que apunta el código, por su rango. Es orientativo. */
export function dtcArea(code: string): string {
  const group = code[0];
  if (group === 'P') {
    const n = parseInt(code.slice(1), 16);
    if (n >= 0x0100 && n <= 0x0199) return 'Medición de aire y combustible';
    if (n >= 0x0200 && n <= 0x0299) return 'Circuito de inyectores';
    if (n >= 0x0300 && n <= 0x0399) return 'Encendido y detección de fallos';
    if (n >= 0x0400 && n <= 0x0499) return 'Control de emisiones';
    if (n >= 0x0500 && n <= 0x0599) return 'Velocidad, ralentí y entradas auxiliares';
    if (n >= 0x0600 && n <= 0x0699) return 'Unidad de control y salidas';
    if (n >= 0x0700 && n <= 0x0899) return 'Transmisión';
    if (n >= 0x2000 && n <= 0x2099) return 'Postratamiento de gases';
    return 'Grupo motopropulsor';
  }
  if (group === 'C') return 'Chasis';
  if (group === 'B') return 'Carrocería';
  if (group === 'U') return 'Red de comunicación';
  return 'Desconocido';
}

export const dtcKindLabel: Record<DtcKind, string> = {
  stored: 'Confirmado',
  pending: 'Pendiente',
  permanent: 'Permanente',
};
