import { EventEmitter } from 'node:events';
import { DispositivoJ2534, J2534Error, PROTOCOLO } from './j2534.mjs';

/**
 * Presenta un canal J2534 como si fuera un ELM327.
 *
 * Por qué esta capa existe: J2534 es una API de mensajes con cabecera, y el
 * ELM327 es un flujo de bytes de texto. Son modelos distintos. Traducir acá
 * significa que el driver del ELM327, la capa OBD-II, el motor de reglas y
 * toda la interfaz funcionan igual sobre un equipo profesional sin cambiar
 * una línea.
 *
 * La alternativa era una segunda ruta de mensajes en la app, con su propio
 * código de protocolo. Esto es bastante menos código y, sobre todo, no
 * duplica la lógica que ya está probada.
 *
 * Se traducen los comandos que la app realmente usa. Un comando AT que no
 * esté acá devuelve '?', igual que un ELM327 que no lo reconoce.
 */

const PROMPT = '>';

/** Protocolos del ELM327 que esta capa sabe mapear a J2534. */
const MAPA_PROTOCOLO = {
  '6': { j2534: PROTOCOLO.ISO15765, baud: 500000, nombre: 'ISO 15765-4 CAN (11 bit, 500 kbaud)', num: '6' },
  '8': { j2534: PROTOCOLO.ISO15765, baud: 250000, nombre: 'ISO 15765-4 CAN (11 bit, 250 kbaud)', num: '8' },
  '5': { j2534: PROTOCOLO.ISO14230, baud: 10400, nombre: 'ISO 14230-4 KWP (fast init, 10.4 kbaud)', num: '5' },
  '3': { j2534: PROTOCOLO.ISO9141, baud: 10400, nombre: 'ISO 9141-2 (5 baud init, 10.4 kbaud)', num: '3' },
};

export class J2534ComoElm extends EventEmitter {
  #dispositivo;
  #buffer = '';
  #eco = true;
  #espacios = true;
  #headers = false;
  #protocolo = null;
  #conectado = false;
  #cola = Promise.resolve();
  #version = { firmware: '', dll: '', api: '' };

  constructor(rutaBiblioteca) {
    super();
    this.#dispositivo = new DispositivoJ2534(rutaBiblioteca);
    this.#dispositivo.abrir();
    this.#version = this.#dispositivo.version();
  }

  get info() {
    return {
      kind: 'j2534',
      name: `J2534 ${this.#version.dll || 'equipo'}`,
      link: `API ${this.#version.api} · firmware ${this.#version.firmware}`,
    };
  }

  write(bytes) {
    this.#buffer += Buffer.from(bytes).toString('ascii');
    for (;;) {
      const i = this.#buffer.indexOf('\r');
      if (i === -1) break;
      const linea = this.#buffer.slice(0, i);
      this.#buffer = this.#buffer.slice(i + 1);
      // Los comandos se encolan: J2534 no es reentrante y el ELM327
      // tampoco atiende dos cosas a la vez.
      this.#cola = this.#cola.then(() => this.#atender(linea)).catch(() => {});
    }
  }

  async #atender(linea) {
    const crudo = linea.trim();
    const cmd = crudo.replace(/\s+/g, '').toUpperCase();
    const eco = this.#eco ? crudo + '\r' : '';
    let cuerpo;
    try {
      cuerpo = await this.#responder(cmd);
    } catch (err) {
      cuerpo = err instanceof J2534Error ? this.#traducirError(err) : 'ERROR';
    }
    const texto = cuerpo === '' ? '' : cuerpo + '\r';
    this.emit('data', Buffer.from(eco + texto + '\r' + PROMPT, 'ascii'));
  }

  /** Los errores de J2534 se expresan en el vocabulario del ELM327. */
  #traducirError(err) {
    switch (err.codigo) {
      case 0x09: return 'NO DATA';          // timeout
      case 0x10: return 'NO DATA';          // buffer vacío
      case 0x08: return 'UNABLE TO CONNECT';
      case 0x03: return 'UNABLE TO CONNECT';
      case 0x14: return 'BUS BUSY';
      case 0x17: return 'CAN ERROR';
      default: return 'ERROR';
    }
  }

  async #responder(cmd) {
    if (cmd === '') return '';
    if (cmd.startsWith('AT')) return this.#comandoAt(cmd.slice(2));
    if (!/^[0-9A-F]+$/.test(cmd)) return '?';
    return this.#comandoObd(cmd);
  }

  #comandoAt(arg) {
    switch (arg) {
      case 'Z':
        this.#eco = true; this.#espacios = true; this.#headers = false;
        return `ELM327 v1.5 (J2534 ${this.#version.dll})`;
      case 'I':
        return `ELM327 v1.5 (J2534 ${this.#version.dll})`;
      case 'E0': this.#eco = false; return 'OK';
      case 'E1': this.#eco = true; return 'OK';
      case 'S0': this.#espacios = false; return 'OK';
      case 'S1': this.#espacios = true; return 'OK';
      case 'H0': this.#headers = false; return 'OK';
      case 'H1': this.#headers = true; return 'OK';
      case 'L0': case 'L1': case 'AT0': case 'AT1': case 'AT2': case 'M0':
        return 'OK';
      case 'RV': {
        const v = this.#dispositivo.tension();
        return v === null ? '12.0V' : `${v.toFixed(1)}V`;
      }
      case 'DP':
        return this.#protocolo?.nombre ?? 'AUTO';
      case 'DPN':
        return this.#protocolo === null ? 'A0' : this.#protocolo.num;
      case 'D':
        return 'OK';
    }
    if (/^SP/.test(arg)) {
      const id = arg.replace(/^SPH?/, '');
      // ATSP0 es detección automática. Acá se prueba CAN 500k primero, que
      // es lo que usa la enorme mayoría de los vehículos desde ~2008.
      const elegido = id === '0' ? '6' : id;
      const mapa = MAPA_PROTOCOLO[elegido];
      if (!mapa) return '?';
      this.#protocolo = mapa;
      this.#conectado = false;
      return 'OK';
    }
    if (/^ST[0-9A-F]{1,2}$/.test(arg)) return 'OK';
    if (/^SH[0-9A-F]{3,8}$/.test(arg)) return 'OK';
    if (/^(WM|SW|IIA|SR|CRA|CF|CM)/.test(arg)) return 'OK';
    return '?';
  }

  #asegurarCanal() {
    if (this.#conectado) return;
    const mapa = this.#protocolo ?? MAPA_PROTOCOLO['6'];
    this.#protocolo = mapa;
    this.#dispositivo.conectar({ protocolo: mapa.j2534, baudRate: mapa.baud });
    this.#conectado = true;
  }

  async #comandoObd(hex) {
    this.#asegurarCanal();
    const payload = Uint8Array.from(
      hex.match(/.{1,2}/g).map((h) => parseInt(h.padEnd(2, '0'), 16)),
    );

    this.#dispositivo.limpiarBuffers();
    this.#dispositivo.escribir(payload, 1000);

    // Varias ECU contestan con más de una trama. Se junta lo que llegue
    // dentro de la ventana en lugar de quedarse con la primera.
    const lineas = [];
    const limite = Date.now() + 1200;
    for (;;) {
      const restante = limite - Date.now();
      if (restante <= 0) break;
      const r = this.#dispositivo.leer(Math.min(restante, 300));
      if (r === null) {
        if (lineas.length > 0) break; // ya llegó algo y se cortó
        continue;
      }
      lineas.push(this.#formatear(r.payload));
      if (lineas.length >= 8) break;
    }

    if (lineas.length === 0) return 'NO DATA';
    return lineas.join('\r');
  }

  /**
   * Arma las líneas como las emitiría un ELM327, respetando ATH y ATS.
   *
   * Con cabeceras, un mensaje de más de siete bytes sale partido en primera
   * trama y consecutivas con su PCI, igual que el chip real. Emitirlo en una
   * sola línea haría que el byte de largo se lea como un PCI inválido.
   */
  #formatear(payload) {
    const hex = (n) => n.toString(16).toUpperCase().padStart(2, '0');
    const bytes = Array.from(payload, hex);
    const unir = (p) => (this.#espacios ? p.join(' ') : p.join(''));
    if (!this.#headers) return unir(bytes);
    if (bytes.length <= 7) return unir(['7E8', hex(bytes.length), ...bytes]);
    const lineas = [unir([
      '7E8', hex(0x10 | (bytes.length >> 8)), hex(bytes.length & 0xff), ...bytes.slice(0, 6),
    ])];
    for (let i = 6, n = 1; i < bytes.length; i += 7, n++) {
      lineas.push(unir(['7E8', hex(0x20 | (n & 0x0f)), ...bytes.slice(i, i + 7)]));
    }
    return lineas.join('\r');
  }

  close() {
    this.#dispositivo.cerrar();
    this.#conectado = false;
  }
}
