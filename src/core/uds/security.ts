/**
 * Algoritmos de acceso de seguridad (UDS servicio 0x27).
 *
 * El handshake es estándar: se pide una semilla, se calcula una llave a
 * partir de ella y se envía. Lo que NO es estándar es la función que
 * convierte semilla en llave: es propia de cada familia de ECU, y es
 * exactamente lo que PCMFlash vende como "módulo".
 *
 * Esta app NO trae algoritmos de ECU reales. Fabricar uno no serviría —una
 * llave incorrecta la rechaza la ECU, y de paso gasta intentos hasta que se
 * bloquea por un rato—. Lo que trae es:
 *
 *   - 'ninguno': para las ECU que permiten leer sin acceso de seguridad
 *     (varias ME7.5 de VAG, según la comunidad de NefMoto).
 *   - 'sim-prueba': el algoritmo del simulador, solo para verificar que el
 *     flujo completo funciona de punta a punta.
 *   - 'personalizado': una ranura donde se conecta el algoritmo real de tu
 *     ECU, obtenido de la comunidad o de su documentación.
 *
 * Un algoritmo recibe la semilla (los bytes que devolvió la ECU) y devuelve
 * la llave (los bytes a enviar). Nada más.
 */

export type AlgoritmoLlave = (semilla: number[]) => number[];

/** Interpreta una lista de bytes como entero de 32 bits sin signo. */
const aU32 = (b: number[]): number =>
  ((b[0] ?? 0) << 24 | (b[1] ?? 0) << 16 | (b[2] ?? 0) << 8 | (b[3] ?? 0)) >>> 0;

/** Vuelve un entero de 32 bits a cuatro bytes. */
const deU32 = (n: number): number[] =>
  [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

/**
 * Algoritmo de prueba del simulador.
 *
 * Es deliberadamente simple y público: no protege nada, solo sirve para
 * ejercitar el intercambio semilla/llave en los tests. Una ECU real usa algo
 * que hay que conocer de antemano.
 */
export const algoritmoPrueba: AlgoritmoLlave = (semilla) => {
  const s = aU32(semilla);
  const llave = (((s ^ 0x1234_5678) >>> 0) + 0x9abc_def0) >>> 0;
  return deU32(llave);
};

export interface AlgoritmoDef {
  id: string;
  label: string;
  descripcion: string;
  fn: AlgoritmoLlave | null;
}

export const ALGORITMOS: AlgoritmoDef[] = [
  {
    id: 'ninguno',
    label: 'Sin acceso de seguridad',
    descripcion:
      'Para ECU que permiten leer memoria sin desbloqueo. Si la ECU lo exige, ' +
      'la lectura fallará con "acceso denegado" y habrá que elegir un algoritmo.',
    fn: null,
  },
  {
    id: 'sim-prueba',
    label: 'Simulador (solo prueba)',
    descripcion:
      'El algoritmo del vehículo simulado. No sirve para ningún auto real: ' +
      'está para comprobar que el flujo de lectura funciona.',
    fn: algoritmoPrueba,
  },
  {
    id: 'personalizado',
    label: 'Algoritmo personalizado',
    descripcion:
      'Ranura para el algoritmo de llave de tu ECU. Se conecta desde el ' +
      'código con registrarAlgoritmo(); la app no incluye ninguno real.',
    fn: null,
  },
];

/** Algoritmos que el usuario o un módulo conectan en tiempo de ejecución. */
const registrados = new Map<string, AlgoritmoLlave>();

export function registrarAlgoritmo(id: string, fn: AlgoritmoLlave): void {
  registrados.set(id, fn);
}

export function obtenerAlgoritmo(id: string): AlgoritmoLlave | null {
  if (registrados.has(id)) return registrados.get(id)!;
  return ALGORITMOS.find((a) => a.id === id)?.fn ?? null;
}
