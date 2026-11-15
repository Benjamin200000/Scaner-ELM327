import { armarBloque, leerBloque, Titulo } from './block';
import type { KLineLink } from './engine';

/**
 * ECU VAG simulada que habla KW1281, como enlace en memoria.
 *
 * Modela el intercambio real: turno estricto, bloques con contador, respuesta
 * a lectura de grupos y de fallas, y la ráfaga de identificación al conectar.
 * Sirve para probar el motor sin un cable ni un auto, que es la única forma
 * de verificar la lógica del protocolo acá.
 */

export interface PerfilKline {
  direccion: number;
  version: number;
  /** Bloques ASCII de identificación, en orden. */
  identificacion: string[];
  /** Grupos de medición: número de grupo -> tripletes [código, A, B]. */
  grupos: Record<number, number[]>;
  /** Fallas: cada una [códigoAlto, códigoBajo, estado]. */
  fallas: number[];
}

/** Golf 2.0 con ME7.5, el motor del usuario. */
export const perfilGolfMe7: PerfilKline = {
  direccion: 0x01,
  version: 1281,
  identificacion: ['06A906032HK ', '2.0l R4/2V ME7.5 ', 'G 0001'],
  grupos: {
    // Grupo 1: régimen, temperatura refrigerante, (dos campos más).
    1: [1, 10, 200, /*rpm*/ 5, 103, 110, /*°C*/ 3, 100, 90, 2, 90, 80],
    // Grupo 3: presión de colector y carga.
    3: [18, 90, 70, 2, 95, 100, 3, 80, 85, 8, 50, 40],
    // Grupo 31: lambda y correcciones.
    31: [20, 128, 150, 20, 128, 110, 1, 10, 180, 2, 90, 95],
  },
  // 00561 (mezcla, estática) y 00552 (MAF, esporádica, bit 0x80).
  fallas: [0x02, 0x31, 0x24, 0x02, 0x28, 0xa4],
};

export class EcuKlineSimulada implements KLineLink {
  private cola: number[][] = [];
  private contador = 0;
  private conectada = false;

  constructor(private readonly perfil: PerfilKline) {}

  async conectar(direccion: number): Promise<{ version: number; keywords: number[] }> {
    if (direccion !== this.perfil.direccion) {
      throw new Error(`La unidad ${direccion.toString(16)} no responde`);
    }
    this.conectada = true;
    this.contador = 1;
    // La ECU manda sola su identificación y cierra con un ACK.
    for (const linea of this.perfil.identificacion) {
      const datos = Array.from(linea, (c) => c.charCodeAt(0));
      this.encolar(Titulo.ascii, datos);
    }
    this.encolar(Titulo.ack, []);
    const v = this.perfil.version;
    return { version: v, keywords: [v & 0x7f, (v >> 7) & 0x7f] };
  }

  async enviarBloque(bytes: number[]): Promise<void> {
    if (!this.conectada) throw new Error('Enlace no conectado');
    const bloque = leerBloque(bytes);
    if (bloque === null) throw new Error('Bloque del probador ilegible');

    // Un ACK del probador cumple dos papeles: en medio de una ráfaga confirma
    // el bloque que la ECU acaba de mandar (y el siguiente ya está en cola),
    // y en el turno del probador es un "seguí viva". La ECU solo responde al
    // segundo, que se distingue porque no hay nada pendiente en la cola.
    if (bloque.titulo === Titulo.ack) {
      if (this.cola.length === 0) this.encolar(Titulo.ack, []);
      return;
    }

    switch (bloque.titulo) {
      case Titulo.leerGrupo: {
        const grupo = bloque.datos[0] ?? 0;
        const tripletes = this.perfil.grupos[grupo];
        if (tripletes && tripletes.length > 0) {
          this.encolar(Titulo.respuestaGrupo, tripletes);
        } else {
          this.encolar(Titulo.sinDatos, []);
        }
        this.encolar(Titulo.ack, []);
        break;
      }
      case Titulo.leerFallas:
        this.encolar(Titulo.respuestaFallas, this.perfil.fallas);
        this.encolar(Titulo.ack, []);
        break;
      case Titulo.leerIdent:
        for (const linea of this.perfil.identificacion) {
          this.encolar(Titulo.ascii, Array.from(linea, (c) => c.charCodeAt(0)));
        }
        this.encolar(Titulo.ack, []);
        break;
      case Titulo.fin:
        this.conectada = false;
        break;
      default:
        // Cualquier otra cosa: contestar ACK para no colgar el turno.
        this.encolar(Titulo.ack, []);
    }
  }

  async recibirBloque(_timeoutMs: number): Promise<number[]> {
    const bloque = this.cola.shift();
    if (bloque === undefined) {
      throw new Error('La ECU no tiene nada para enviar (turno del probador)');
    }
    return bloque;
  }

  async cerrar(): Promise<void> {
    this.conectada = false;
    this.cola = [];
  }

  private encolar(titulo: number, datos: number[]): void {
    this.contador = (this.contador + 1) & 0xff;
    this.cola.push(armarBloque(this.contador, titulo, datos));
  }
}
