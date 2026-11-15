import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Token de acceso del agente.
 *
 * Se genera una vez y se guarda en el home del usuario. Con --lan el agente
 * queda alcanzable desde la red local: ahí el token es lo único que separa
 * "mi tablet" de "cualquier equipo del taller".
 */

const DIR = join(homedir(), '.scaner-elm327');
const ARCHIVO = join(DIR, 'token');

export function obtenerToken() {
  try {
    const guardado = readFileSync(ARCHIVO, 'utf8').trim();
    if (guardado.length >= 32) return guardado;
  } catch {
    // Todavía no existe: se crea abajo.
  }
  const token = randomBytes(24).toString('base64url');
  mkdirSync(DIR, { recursive: true });
  writeFileSync(ARCHIVO, token + '\n', { mode: 0o600 });
  try {
    chmodSync(ARCHIVO, 0o600);
  } catch {
    // En Windows los permisos POSIX no aplican.
  }
  return token;
}

/** Comparación en tiempo constante, para no filtrar el token por timing. */
export function tokenValido(esperado, recibido) {
  const a = Buffer.from(esperado, 'utf8');
  const b = Buffer.from(String(recibido ?? ''), 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const rutaToken = ARCHIVO;
