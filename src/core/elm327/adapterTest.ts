import type { Elm327Driver } from './driver';
import { ElmError } from './errors';

/**
 * Prueba de capacidades del adaptador.
 *
 * "ELM327" no dice mucho: el chip original se dejó de fabricar y casi todo
 * lo que se vende son clones que implementan una parte del juego de
 * comandos, a veces mintiendo la versión. Lo básico (leer PID y códigos)
 * anda en casi todos. Lo avanzado (hablarle a una ECU concreta, mensajes
 * largos, filtros) es justo lo que los clones baratos omiten, y es lo que
 * necesitan la identificación UDS y las funciones de fabricante.
 *
 * Esta prueba manda cada comando y anota si el adaptador lo acepta. No
 * transmite nada al vehículo: son todos comandos de configuración del chip.
 */

export interface PruebaComando {
  comando: string;
  proposito: string;
  /** Qué deja de funcionar en la app si el adaptador no lo soporta. */
  sinEsto: string;
  nivel: 'basico' | 'avanzado';
}

export interface ResultadoComando extends PruebaComando {
  soportado: boolean;
  respuesta: string;
}

export interface InformeAdaptador {
  resultados: ResultadoComando[];
  descripcion: string | null;
  /** Chip STN (OBDLink y similares): más rápido y más completo que un ELM. */
  esStn: boolean;
  basicoCompleto: boolean;
  avanzadoCompleto: boolean;
  veredicto: string;
}

const PRUEBAS: PruebaComando[] = [
  { comando: 'ATRV', proposito: 'Leer tensión de batería', nivel: 'basico',
    sinEsto: 'No se muestra la tensión ni se verifica antes de una escritura' },
  { comando: 'ATDPN', proposito: 'Informar el protocolo activo', nivel: 'basico',
    sinEsto: 'La app no sabe con certeza qué protocolo quedó' },
  { comando: 'ATH1', proposito: 'Mostrar cabeceras', nivel: 'basico',
    sinEsto: 'No se distingue qué ECU contesta; se mezclan respuestas' },
  { comando: 'ATAT1', proposito: 'Temporización adaptativa', nivel: 'basico',
    sinEsto: 'Lecturas más lentas' },
  { comando: 'ATSH7E0', proposito: 'Dirigirse a una ECU concreta', nivel: 'avanzado',
    sinEsto: 'Sin identificación UDS ni funciones de fabricante' },
  { comando: 'ATCRA7E8', proposito: 'Filtrar respuestas por dirección', nivel: 'avanzado',
    sinEsto: 'Ruido de otras ECU en buses con mucho tráfico' },
  { comando: 'ATAL', proposito: 'Permitir mensajes largos', nivel: 'avanzado',
    sinEsto: 'Se cortan las solicitudes de más de siete bytes' },
  { comando: 'ATFCSH7E0', proposito: 'Control de flujo: dirección', nivel: 'avanzado',
    sinEsto: 'Fallan las respuestas largas de módulos no estándar' },
  { comando: 'ATFCSD300000', proposito: 'Control de flujo: datos', nivel: 'avanzado',
    sinEsto: 'Fallan las respuestas largas de módulos no estándar' },
  { comando: 'ATCAF1', proposito: 'Formateo automático CAN', nivel: 'avanzado',
    sinEsto: 'Habría que armar las tramas ISO-TP a mano' },
];

/** Deja el adaptador como estaba antes de la prueba. */
const RESTAURAR = ['ATAR', 'ATNL', 'ATCAF1', 'ATH1', 'ATAT1'];

export async function probarAdaptador(driver: Elm327Driver): Promise<InformeAdaptador> {
  const resultados: ResultadoComando[] = [];

  for (const prueba of PRUEBAS) {
    let soportado = false;
    let respuesta = '';
    try {
      const res = await driver.send(prueba.comando, { timeoutMs: 2000 });
      respuesta = res.lines.join(' ');
      soportado = true;
    } catch (err) {
      respuesta = err instanceof ElmError
        ? (err.code === 'adapter-rejected' ? '?' : err.message)
        : String(err);
    }
    resultados.push({ ...prueba, soportado, respuesta });
  }

  const texto = async (cmd: string): Promise<string | null> => {
    try {
      const res = await driver.send(cmd, { timeoutMs: 2000 });
      return res.lines.join(' ').trim() || null;
    } catch {
      return null;
    }
  };
  const descripcion = await texto('AT@1');
  // Los chips STN contestan STI; un ELM327 o un clon devuelven '?'.
  const sti = await texto('STI');
  const esStn = sti !== null && /STN/i.test(sti);

  // El orden importa: restaurar siempre, pase lo que pase arriba.
  const esCan = driver.protocol?.family === 'can';
  for (const cmd of [...RESTAURAR, ...(esCan ? ['ATSH7DF'] : [])]) {
    await driver.send(cmd, { timeoutMs: 2000 }).catch(() => {});
  }

  const ok = (nivel: 'basico' | 'avanzado'): boolean =>
    resultados.filter((r) => r.nivel === nivel).every((r) => r.soportado);
  const basicoCompleto = ok('basico');
  const avanzadoCompleto = ok('avanzado');

  const veredicto = esStn
    ? 'Chip STN: soporta todo lo que la app usa, y con mejor velocidad que un ELM327.'
    : basicoCompleto && avanzadoCompleto
    ? 'Juego de comandos completo. Sirve para todo lo que la app hace, incluida la identificación UDS.'
    : basicoCompleto
    ? 'Sirve para OBD-II genérico. Le faltan comandos avanzados, así que la ' +
      'identificación UDS y las funciones de fabricante pueden fallar con este adaptador.'
    : 'Le faltan comandos básicos. Es probable que haya lecturas erróneas o ' +
      'incompletas: conviene cambiar de adaptador.';

  return { resultados, descripcion, esStn, basicoCompleto, avanzadoCompleto, veredicto };
}
