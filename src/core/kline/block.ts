/**
 * Bloques del protocolo KW1281.
 *
 * Un bloque es [longitud][contador][título][datos...][0x03]. La longitud
 * cuenta todo lo que sigue al byte de longitud (contador, título, datos y el
 * byte de fin). Cada byte, salvo el 0x03 final, se confirma con su
 * complemento durante el envío; esa parte vive en la capa de enlace, no acá.
 *
 * Esta capa es pura: arma y lee bloques como listas de bytes. La referencia
 * es gmenounos/kw1281test (KW1281Dialog.cs).
 */

/** Títulos de bloque de KW1281 que esta app usa. */
export const Titulo = {
  ack: 0x09,
  fin: 0x06,
  leerIdent: 0x00,
  leerGrupo: 0x29,
  respuestaGrupo: 0xe7,
  leerFallas: 0x07,
  respuestaFallas: 0xfc,
  borrarFallas: 0x05,
  ascii: 0xf6,
  /** Respuesta "sin datos" / grupo no disponible. */
  sinDatos: 0x0a,
} as const;

export interface Bloque {
  contador: number;
  titulo: number;
  datos: number[];
}

/**
 * Arma un bloque en bytes, listos para que la capa de enlace los envíe con
 * el handshake. No incluye el 0x03 final (lo agrega el enlace, porque no se
 * confirma).
 */
export function armarBloque(contador: number, titulo: number, datos: number[] = []): number[] {
  // longitud = contador + título + datos + fin.
  const longitud = datos.length + 3;
  return [longitud, contador, titulo, ...datos];
}

/**
 * Lee un bloque de los bytes recibidos (sin el 0x03 final, que el enlace ya
 * consumió). Devuelve null si la longitud no cuadra con el contenido.
 */
export function leerBloque(bytes: number[]): Bloque | null {
  const longitud = bytes[0];
  const contador = bytes[1];
  const titulo = bytes[2];
  if (longitud === undefined || contador === undefined || titulo === undefined) return null;
  // Los datos son longitud - 3 bytes (contador, título, fin).
  const nDatos = longitud - 3;
  if (nDatos < 0) return null;
  const datos = bytes.slice(3, 3 + nDatos);
  if (datos.length !== nDatos) return null;
  return { contador, titulo, datos };
}

export const esAck = (b: Bloque): boolean => b.titulo === Titulo.ack;
