/**
 * Enlace K-Line (KW1281 y KWP2000) sobre un puerto serie, para cables KKL.
 *
 * Un cable KKL es un conversor USB↔K-Line "tonto": no tiene intérprete como
 * el ELM327, así que TODO el protocolo lo hace el host. Esta capa implementa
 * lo sensible al tiempo:
 *
 *   - Inicialización a 5 baudios: se despierta a la ECU enviando su dirección
 *     bit a bit, conmutando la condición de "break" del puerto (200 ms por
 *     bit). Es lo que el ELM327 no puede hacer y por lo que KW1281 solo
 *     funciona con un cable como este.
 *   - Handshake byte a byte: cada byte se confirma con su complemento antes
 *     del siguiente. Esta ida y vuelta tiene que ocurrir en milisegundos, por
 *     eso vive en el agente y no cruza la red.
 *
 * ADVERTENCIA: la temporización está portada de la implementación de
 * referencia (gmenounos/kw1281test) pero NO está verificada contra un cable y
 * un auto reales desde este entorno. Node y los drivers FTDI/CH340 agregan
 * latencia; puede necesitar ajuste. La lógica del protocolo por encima (en la
 * app) sí está probada contra un ECU simulado.
 */

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera activa para la temporización fina del init de 5 baudios. */
function esperaActiva(ms) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { /* ocupar el hilo: 200 ms por bit */ }
}

/** Paridad impar sobre un byte, como pide el init de 5 baudios. */
function paridadImpar(b) {
  let unos = 0;
  for (let i = 0; i < 7; i++) if ((b >> i) & 1) unos++;
  return (unos % 2 === 0) ? (b | 0x80) : (b & 0x7f);
}

export class EnlaceKLine {
  #puerto = null;
  #buffer = [];
  #resolverLectura = null;

  constructor(SerialPort) {
    this.SerialPort = SerialPort;
  }

  async abrir(ruta, baud = 10400) {
    this.#puerto = await new Promise((resolve, reject) => {
      const p = new this.SerialPort({ path: ruta, baudRate: baud, autoOpen: false });
      p.open((err) => (err ? reject(err) : resolve(p)));
    });
    this.#puerto.on('data', (chunk) => {
      for (const b of chunk) this.#buffer.push(b);
      if (this.#resolverLectura) this.#resolverLectura();
    });
  }

  /**
   * Init de 5 baudios: envía la dirección de la unidad bit a bit conmutando
   * el break, lee la sincronización (0x55) y las dos palabras clave, y manda
   * el complemento de la segunda. Devuelve la versión de protocolo.
   */
  async init(direccion) {
    this.#buffer = [];
    const b = paridadImpar(direccion);
    const msBit = 200;
    // Bit de arranque (break activo), 8 bits de datos LSB primero, bit de parada.
    await this.#break(true); esperaActiva(msBit);
    for (let i = 0; i < 8; i++) {
      await this.#break(((b >> i) & 1) === 0); // bit 1 → línea alta → break off
      esperaActiva(msBit);
    }
    await this.#break(false); // bit de parada
    esperaActiva(msBit);

    const sync = await this.#leerByte(1500);
    if (sync !== 0x55) throw new Error(`Sincronización inesperada: 0x${sync.toString(16)}`);
    const kwLsb = await this.#leerByte(500);
    const kwMsb = await this.#leerByte(500);
    const version = ((kwMsb & 0x7f) << 7) + (kwLsb & 0x7f);
    await espera(25);
    await this.#escribirByte((~kwMsb) & 0xff); // complemento de la 2.ª palabra
    return { version, keywords: [kwLsb, kwMsb] };
  }

  /** Envía un bloque KW1281 (sin el 0x03) con handshake por byte, y el fin. */
  async enviarBloque(bytes) {
    await espera(25);
    for (const b of bytes) {
      await this.#escribirByte(b);
      const comp = await this.#leerByte(500);
      if (comp !== ((~b) & 0xff)) {
        throw new Error(`Complemento incorrecto al enviar 0x${b.toString(16)}`);
      }
      await espera(1);
    }
    await this.#escribirByte(0x03); // fin de bloque: no se confirma
  }

  /** Recibe un bloque KW1281 completo, confirmando cada byte con su complemento. */
  async recibirBloque(timeoutMs) {
    const leerAck = async () => {
      const b = await this.#leerByte(timeoutMs);
      await this.#escribirByte((~b) & 0xff);
      return b;
    };
    const longitud = await leerAck();
    const contador = await leerAck();
    const titulo = await leerAck();
    const datos = [];
    for (let i = 0; i < longitud - 3; i++) datos.push(await leerAck());
    const fin = await this.#leerByte(timeoutMs); // el 0x03 no se confirma
    if (fin !== 0x03) throw new Error(`Fin de bloque inesperado: 0x${fin.toString(16)}`);
    return [longitud, contador, titulo, ...datos];
  }

  async cerrar() {
    if (this.#puerto) await new Promise((r) => this.#puerto.close(() => r()));
    this.#puerto = null;
  }

  // ── Interno ──────────────────────────────────────────────────────────
  #break(activo) {
    return new Promise((resolve) => this.#puerto.set({ brk: activo }, () => resolve()));
  }
  #escribirByte(b) {
    return new Promise((resolve, reject) =>
      this.#puerto.write(Buffer.from([b]), (err) => (err ? reject(err) : resolve())));
  }
  async #leerByte(timeoutMs) {
    const fin = Date.now() + timeoutMs;
    while (this.#buffer.length === 0) {
      if (Date.now() >= fin) throw new Error('Tiempo agotado leyendo del cable K-Line');
      await new Promise((resolve) => {
        this.#resolverLectura = resolve;
        setTimeout(resolve, 20);
      });
      this.#resolverLectura = null;
    }
    return this.#buffer.shift();
  }
}
