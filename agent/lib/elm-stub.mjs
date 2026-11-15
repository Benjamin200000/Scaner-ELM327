import { EventEmitter } from 'node:events';

/**
 * Responde como un ELM327 mínimo, para la opción --simular del agente.
 *
 * NO es el simulador completo de la aplicación. Su único propósito es que se
 * pueda verificar que el enlace agente-navegador funciona ANTES de pelearse
 * con el adaptador, el baud rate y el conector del vehículo. Cuando algo no
 * anda, poder separar "el agente no conecta" de "el adaptador no contesta"
 * ahorra mucho tiempo.
 *
 * Contesta los comandos AT de inicialización y unos pocos PID, nada más.
 */
export class ElmStub extends EventEmitter {
  #buffer = '';
  #eco = true;
  #headers = false;
  #t0 = Date.now();

  write(bytes) {
    this.#buffer += bytes.toString('ascii');
    for (;;) {
      const i = this.#buffer.indexOf('\r');
      if (i === -1) break;
      const linea = this.#buffer.slice(0, i);
      this.#buffer = this.#buffer.slice(i + 1);
      this.#responder(linea);
    }
  }

  #responder(linea) {
    const cmd = linea.trim().replace(/\s+/g, '').toUpperCase();
    const eco = this.#eco ? linea.trim() + '\r' : '';
    const cuerpo = this.#cuerpo(cmd);
    const salida = eco + (cuerpo ? cuerpo + '\r' : '') + '\r>';
    // Con un retardo parecido al de un chip real, para que la app ejercite
    // sus timeouts en lugar de verlo todo instantáneo.
    setTimeout(() => this.emit('data', Buffer.from(salida, 'ascii')), 35);
  }

  #cuerpo(cmd) {
    if (cmd === '') return '';
    if (cmd === 'ATZ' || cmd === 'ATI') {
      this.#eco = true;
      return 'ELM327 v1.5';
    }
    if (cmd === 'ATE0') { this.#eco = false; return 'OK'; }
    if (cmd === 'ATE1') { this.#eco = true; return 'OK'; }
    if (cmd === 'ATH1') { this.#headers = true; return 'OK'; }
    if (cmd === 'ATH0') { this.#headers = false; return 'OK'; }
    if (cmd === 'ATRV') return '12.4V';
    if (cmd === 'ATDPN') return 'A6';
    if (cmd === 'ATDP') return 'AUTO, ISO 15765-4 (CAN 11/500)';
    if (/^AT/.test(cmd)) return 'OK';

    const datos = this.#obd(cmd);
    if (datos === 'NO DATA' || !this.#headers) return datos;
    // Con cabeceras: identificador CAN y byte de largo, como el chip real.
    const n = datos.split(' ').length;
    return `7E8 ${hex(n)} ${datos}`;
  }

  #obd(cmd) {
    const seg = (Date.now() - this.#t0) / 1000;
    switch (cmd) {
      case '0100': return '41 00 BE 3E B8 11';
      case '0120': return '41 20 80 00 00 01';
      case '0140': return '41 40 00 00 00 00';
      // Ralentí con una leve oscilación, para que el gráfico muestre algo.
      case '010C': {
        const rpm = Math.round((820 + Math.sin(seg * 2.1) * 25) * 4);
        return `41 0C ${hex(rpm >> 8)} ${hex(rpm & 0xff)}`;
      }
      case '0105': return `41 05 ${hex(Math.round(88 + 40))}`;
      case '010D': return '41 0D 00';
      case '0104': return `41 04 ${hex(Math.round(0.24 * 255))}`;
      case '010F': return `41 0F ${hex(Math.round(32 + 40))}`;
      case '0111': return `41 11 ${hex(Math.round(0.14 * 255))}`;
      case '0110': {
        const maf = Math.round((3.2 + Math.sin(seg * 1.7) * 0.3) * 100);
        return `41 10 ${hex(maf >> 8)} ${hex(maf & 0xff)}`;
      }
      case '03': return '43 00';
      case '0902': return 'NO DATA';
      default: return 'NO DATA';
    }
  }

  close() { /* nada que liberar */ }
}

const hex = (n) => Math.max(0, Math.min(255, n)).toString(16).toUpperCase().padStart(2, '0');
