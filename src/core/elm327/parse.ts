import { type ElmErrorCode } from './errors';

/** Mensajes de error que el chip devuelve como texto en lugar de datos. */
const ERROR_PATTERNS: ReadonlyArray<[RegExp, ElmErrorCode]> = [
  [/^\?$/, 'adapter-rejected'],
  [/UNABLE\s*TO\s*CONNECT/i, 'unable-to-connect'],
  [/BUS\s*INIT.*(ERROR|FAIL)/i, 'bus-init-failed'],
  [/BUS\s*ERROR/i, 'bus-error'],
  [/CAN\s*ERROR/i, 'bus-error'],
  [/<?DATA\s*ERROR/i, 'bus-error'],
  [/FB\s*ERROR/i, 'bus-error'],
  [/BUFFER\s*FULL/i, 'buffer-full'],
  [/STOPPED/i, 'stopped'],
  [/NO\s*DATA/i, 'no-data'],
  // 'ERROR' a secas va último: varias respuestas lo contienen como sufijo.
  [/^ERROR$/i, 'bus-error'],
];

export interface ParsedResponse {
  /** Líneas útiles, sin eco, sin prompt, sin 'SEARCHING...'. */
  lines: string[];
  /** Primer error detectado, si lo hubo. */
  error?: ElmErrorCode;
  /** Texto crudo tal como llegó, para el terminal de debug. */
  raw: string;
}

/**
 * Convierte el bloque crudo que termina en '>' en líneas aprovechables.
 *
 * Quita el eco del comando (los clones no siempre respetan ATE0), descarta
 * 'SEARCHING...' y normaliza el espaciado para que el resto del sistema no
 * tenga que saber si ATS0 estaba activo.
 */
export function parseResponse(raw: string, command?: string): ParsedResponse {
  const cleaned = raw.replace(/\0/g, '');
  const normalizedCmd = command?.replace(/\s+/g, '').toUpperCase();

  const lines = cleaned
    .split(/[\r\n]+/)
    .map((l) => l.replace(/>/g, '').trim())
    .filter((l) => l.length > 0)
    .filter((l) => !/^SEARCHING/i.test(l))
    .filter((l) => {
      if (!normalizedCmd) return true;
      return l.replace(/\s+/g, '').toUpperCase() !== normalizedCmd;
    });

  for (const line of lines) {
    for (const [pattern, code] of ERROR_PATTERNS) {
      if (pattern.test(line)) {
        return { lines, error: code, raw: cleaned };
      }
    }
  }
  if (/SEARCHING/i.test(cleaned) && lines.length === 0) {
    return { lines, error: 'searching-timeout', raw: cleaned };
  }
  return { lines, raw: cleaned };
}

/**
 * Une una respuesta OBD en una secuencia de bytes.
 *
 * Maneja los tres formatos que entrega un ELM327:
 *   - una línea:            `41 0C 1A F8`
 *   - multilínea numerada:  `014` / `0: 49 02 01 57` / `1: 5A 5A ...`
 *   - con headers (ATH1):   `7E8 06 41 0C 1A F8 00`
 *
 * Devuelve null si no hay nada interpretable.
 */
export function joinObdBytes(lines: string[]): number[] | null {
  if (lines.length === 0) return null;

  const numbered = lines.filter((l) => /^[0-9A-F]\s*:/i.test(l));
  if (numbered.length > 0) {
    const ordered = numbered
      .map((l) => {
        const m = /^([0-9A-F])\s*:\s*(.*)$/i.exec(l);
        return { idx: parseInt(m?.[1] ?? '0', 16), body: m?.[2] ?? '' };
      })
      .sort((a, b) => a.idx - b.idx);
    const bytes = ordered.flatMap((o) => hexBytes(o.body));
    // La primera línea suele ser el largo total declarado por el chip.
    const declared = declaredLength(lines);
    return declared !== null ? bytes.slice(0, declared) : bytes;
  }

  const bytes = lines.flatMap(hexBytes);
  return bytes.length > 0 ? bytes : null;
}

/** La línea de largo es un hex de 2-3 dígitos sin separadores, sola. */
function declaredLength(lines: string[]): number | null {
  const first = lines[0];
  if (first === undefined) return null;
  const compact = first.replace(/\s+/g, '');
  if (!/^[0-9A-F]{2,3}$/i.test(compact)) return null;
  return parseInt(compact, 16);
}

export function hexBytes(text: string): number[] {
  let compact = text.replace(/[^0-9A-Fa-f]/g, '');
  // Con ATH1 sobre CAN de 11 bits el chip emite un header de TRES dígitos
  // hex ('7E8'), que deja la línea con largo impar. Los bytes de datos
  // siempre vienen de a pares, así que un largo impar solo puede explicarse
  // por ese header. Si no se descarta, todo el flujo queda corrido medio
  // byte y ninguna respuesta CAN se decodifica.
  if (compact.length % 2 === 1 && compact.length >= 3) {
    compact = compact.slice(3);
  }
  const out: number[] = [];
  for (let i = 0; i + 1 < compact.length; i += 2) {
    out.push(parseInt(compact.slice(i, i + 2), 16));
  }
  return out;
}

/**
 * Localiza el payload de una respuesta OBD y descarta header y eco de PID.
 *
 * Para una solicitud `01 0C`, la respuesta positiva empieza en `41 0C`.
 * Devuelve los bytes que vienen después, que son los datos del PID.
 */
export function extractPayload(
  bytes: number[],
  mode: number,
  pid?: number,
): number[] | null {
  const positive = mode + 0x40;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== positive) continue;
    if (pid === undefined) return bytes.slice(i + 1);
    if (bytes[i + 1] === pid) return bytes.slice(i + 2);
  }
  return null;
}

/** Respuesta negativa ISO 14229/14230: 7F <sid> <nrc>. */
export function negativeResponseCode(bytes: number[]): number | null {
  const i = bytes.indexOf(0x7f);
  if (i === -1) return null;
  const nrc = bytes[i + 2];
  return nrc === undefined ? null : nrc;
}
