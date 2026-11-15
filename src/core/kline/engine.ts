import { armarBloque, type Bloque, esAck, leerBloque, Titulo } from './block';
import { decodificarMedicion, type Medicion } from './formulas';

/**
 * Motor de sesión KW1281.
 *
 * Maneja la lógica del protocolo por encima de la capa física: el contador
 * de bloques, el turno estricto (la ECU manda un bloque, el probador
 * contesta), la confirmación con bloques ACK y las operaciones de lectura.
 *
 * Toda la temporización crítica byte a byte queda en la capa de enlace
 * (`KLineLink`), que la implementa el agente sobre el puerto serie. Acá solo
 * viven las reglas del protocolo, que son las que se pueden probar sin
 * hardware contra un ECU simulado.
 */

/**
 * Capa física del enlace K-Line. La parte sensible al tiempo —init de 5
 * baudios y handshake byte a byte— la hace quien la implementa.
 */
export interface KLineLink {
  /**
   * Inicialización lenta: despierta a la ECU con su dirección a 5 baudios,
   * lee la sincronización y las palabras clave, y deja el bus listo.
   * Devuelve la versión de protocolo (p. ej. 1281) y las palabras clave.
   */
  conectar(direccion: number): Promise<{ version: number; keywords: number[] }>;
  /** Envía un bloque ya armado (sin el 0x03), con el handshake por byte. */
  enviarBloque(bytes: number[]): Promise<void>;
  /** Recibe un bloque completo (sin el 0x03), con el handshake por byte. */
  recibirBloque(timeoutMs: number): Promise<number[]>;
  cerrar(): Promise<void>;
}

/** Dirección de cada unidad VAG en el bus K-Line. */
export const DIRECCION = {
  motor: 0x01,
  cambio: 0x02,
  abs: 0x03,
  tablero: 0x17,
  airbag: 0x15,
  climatizador: 0x08,
  centralConfort: 0x46,
  direccionAsistida: 0x44,
} as const;

export interface Identificacion {
  /** Número de repuesto VAG (p. ej. 06A906032HK). */
  numeroRepuesto: string | null;
  /** Nombre del componente y versión. */
  componente: string | null;
  /** Código de codificación. */
  codificacion: number | null;
  /** Número del taller (WSC). */
  wsc: number | null;
  /** Texto adicional leído de los bloques ASCII. */
  extra: string[];
  version: number;
}

export interface GrupoMedicion {
  grupo: number;
  mediciones: Medicion[];
}

export interface FallaKline {
  /** Código VAG de 5 dígitos (p. ej. 00561). */
  codigo: string;
  /** Byte de elaboración/estado. */
  estado: number;
  /** true si está presente ahora; false si es esporádica. */
  presente: boolean;
}

const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');

export class Kw1281Engine {
  private contador = 0;
  private version = 0;

  constructor(private readonly link: KLineLink) {}

  /**
   * Conecta con una unidad y lee su identificación.
   *
   * Tras el init, la ECU manda sola una ráfaga de bloques (ASCII con el
   * número de repuesto y el componente, codificación, etc.) y cierra con un
   * ACK. El motor confirma cada bloque y arma la identificación.
   */
  async conectar(direccion: number): Promise<Identificacion> {
    const { version } = await this.link.conectar(direccion);
    this.version = version;
    this.contador = 0;
    const bloques = await this.recibirHastaAck(5000);
    return this.armarIdentificacion(bloques);
  }

  /**
   * Lee un grupo de medición (0x29). Devuelve hasta cuatro mediciones, cada
   * una decodificada con la tabla de fórmulas de VAG.
   */
  async leerGrupo(grupo: number): Promise<GrupoMedicion> {
    const bloques = await this.transaccion(Titulo.leerGrupo, [grupo], 3000);
    const resp = bloques.find((b) => b.titulo === Titulo.respuestaGrupo);
    if (!resp) {
      // Un grupo inexistente suele contestar "sin datos": no es un error.
      return { grupo, mediciones: [] };
    }
    const mediciones: Medicion[] = [];
    for (let i = 0; i + 2 < resp.datos.length; i += 3) {
      mediciones.push(decodificarMedicion(resp.datos[i]!, resp.datos[i + 1]!, resp.datos[i + 2]!));
    }
    return { grupo, mediciones };
  }

  /** Lee los códigos de falla almacenados (0x07). */
  async leerFallas(): Promise<FallaKline[]> {
    const bloques = await this.transaccion(Titulo.leerFallas, [], 4000);
    const fallas: FallaKline[] = [];
    for (const b of bloques) {
      if (b.titulo !== Titulo.respuestaFallas) continue;
      // Cada falla ocupa 3 bytes: código alto, código bajo y estado.
      for (let i = 0; i + 2 < b.datos.length; i += 3) {
        const alto = b.datos[i]!;
        const bajo = b.datos[i + 1]!;
        const estado = b.datos[i + 2]!;
        const num = alto * 256 + bajo;
        if (num === 0xffff || num === 0) continue; // relleno de fin de lista
        fallas.push({
          codigo: String(num).padStart(5, '0'),
          estado,
          // El bit 0x80 del estado marca las esporádicas (no presentes ahora).
          presente: (estado & 0x80) === 0,
        });
      }
    }
    return fallas;
  }

  /** Mantiene viva la sesión con un ACK. */
  async mantenerViva(): Promise<void> {
    await this.transaccion(Titulo.ack, [], 2000);
  }

  async desconectar(): Promise<void> {
    try {
      await this.enviar(Titulo.fin, []);
    } catch {
      // Si el enlace ya cayó, da igual.
    }
    await this.link.cerrar();
  }

  get protocolo(): number {
    return this.version;
  }

  // ── Interno ─────────────────────────────────────────────────────────

  /** Una transacción: enviar un bloque y recibir la respuesta hasta el ACK. */
  private async transaccion(titulo: number, datos: number[], timeoutMs: number): Promise<Bloque[]> {
    await this.enviar(titulo, datos);
    return this.recibirHastaAck(timeoutMs);
  }

  private async enviar(titulo: number, datos: number[]): Promise<void> {
    this.contador = (this.contador + 1) & 0xff;
    await this.link.enviarBloque(armarBloque(this.contador, titulo, datos));
  }

  /**
   * Recibe bloques, confirmando cada uno con un ACK, hasta que la ECU manda
   * su propio ACK (señal de que terminó y espera al probador).
   */
  private async recibirHastaAck(timeoutMs: number): Promise<Bloque[]> {
    const recibidos: Bloque[] = [];
    for (let i = 0; i < 64; i++) {
      const bytes = await this.link.recibirBloque(timeoutMs);
      const bloque = leerBloque(bytes);
      if (bloque === null) {
        throw new Error(`Bloque KW1281 ilegible: ${bytes.map(hex2).join(' ')}`);
      }
      // El contador de la ECU debe seguir la secuencia.
      this.contador = bloque.contador;
      recibidos.push(bloque);
      if (esAck(bloque)) break;
      // Confirmar y seguir escuchando.
      this.contador = (this.contador + 1) & 0xff;
      await this.link.enviarBloque(armarBloque(this.contador, Titulo.ack, []));
    }
    return recibidos;
  }

  private armarIdentificacion(bloques: Bloque[]): Identificacion {
    const ascii: string[] = [];
    let numeroRepuesto: string | null = null;
    let componente: string | null = null;
    let codificacion: number | null = null;
    let wsc: number | null = null;

    for (const b of bloques) {
      if (b.titulo === Titulo.ascii) {
        const texto = String.fromCharCode(...b.datos.filter((c) => c >= 0x20 && c <= 0x7e)).trim();
        if (texto.length > 0) ascii.push(texto);
      } else if (b.titulo === 0xf6 || b.titulo === 0x00) {
        // ya cubierto arriba
      }
    }

    // El primer bloque ASCII suele traer el número de repuesto al inicio.
    for (const t of ascii) {
      const m = /\b(\d[A-Z0-9]{2}\d{6}[A-Z]{0,2})\b/.exec(t);
      if (m && numeroRepuesto === null) numeroRepuesto = m[1]!;
    }
    if (numeroRepuesto === null && ascii[0]) numeroRepuesto = ascii[0];
    if (ascii.length > 1) componente = ascii.slice(1).join(' ');

    return {
      numeroRepuesto,
      componente,
      codificacion,
      wsc,
      extra: ascii,
      version: this.version,
    };
  }
}
