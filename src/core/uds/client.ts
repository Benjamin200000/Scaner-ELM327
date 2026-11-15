import type { Elm327Driver } from '@/core/elm327/driver';
import { ElmError } from '@/core/elm327/errors';
import { describeNrc } from '@/core/kwp2000/sid';
import { familyOf, parseEcuMessages } from '@/core/elm327/frames';
import type { AlgoritmoLlave } from './security';

/**
 * Cliente UDS (ISO 14229) para una ECU, sobre el driver del ELM327.
 *
 * Sirve para lo que el OBD-II genérico no alcanza: abrir una sesión
 * extendida, desbloquear la ECU y leer su memoria. Todo esto es solo
 * lectura; esta clase no escribe flash a propósito (ver memory.ts).
 *
 * Direcciona a una ECU por su par de direcciones físicas (p. ej. se le habla
 * por 7E0 y contesta por 7E8). Fija la cabecera con ATSH y filtra la
 * respuesta por la dirección que contesta, así el tráfico de otras unidades
 * no se cuela.
 */

export type ServicioUds = number;

export class UdsError extends Error {
  constructor(
    readonly servicio: number,
    readonly nrc: number,
    readonly contexto: string,
  ) {
    super(`${contexto}: ${describeNrc(nrc)} (0x${nrc.toString(16)})`);
    this.name = 'UdsError';
  }
}

const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, '0');
const hexN = (n: number, bytes: number): string =>
  n.toString(16).toUpperCase().padStart(bytes * 2, '0');

export interface UdsOpciones {
  /** Dirección a la que se le habla. */
  reqAddr: string;
  /** Dirección por la que contesta. */
  resAddr: string;
}

const RESPUESTA_PENDIENTE = 0x78;

export class UdsClient {
  constructor(
    private readonly driver: Elm327Driver,
    private readonly opc: UdsOpciones,
  ) {}

  /** Prepara el enlace: fija la cabecera y, en CAN, filtra por la respuesta. */
  async preparar(): Promise<void> {
    await this.driver.send(`ATSH${this.opc.reqAddr}`);
    if (familyOf(this.driver.protocol).startsWith('can')) {
      // Filtrar por la ECU que contesta evita el ruido de otras unidades y
      // acelera las lecturas largas.
      await this.driver.send(`ATCRA${this.opc.resAddr}`).catch(() => {});
      // Permitir mensajes largos y control de flujo automático.
      await this.driver.send('ATAL').catch(() => {});
    }
  }

  /** Devuelve la cabecera al direccionamiento funcional. */
  async liberar(): Promise<void> {
    await this.driver.send('ATCRA').catch(() => {});
    await this.driver.send('ATSH7DF').catch(() => {});
  }

  /**
   * Envía un servicio y devuelve la respuesta positiva, ya sin el byte de
   * servicio. Lanza UdsError ante una respuesta negativa.
   *
   * Maneja el NRC 0x78 ("respuesta pendiente"): la ECU avisa que necesita más
   * tiempo, y en una lectura de memoria eso es normal. Tratarlo como error
   * rompería la operación justo donde más importa.
   */
  async enviar(
    servicio: number,
    datos: string,
    contexto: string,
    timeoutMs = 2000,
  ): Promise<number[]> {
    const comando = hex2(servicio) + datos;
    for (let intento = 0; intento < 8; intento++) {
      let lineas: string[];
      try {
        const res = await this.driver.send(comando, { timeoutMs });
        lineas = res.lines;
      } catch (err) {
        if (err instanceof ElmError && err.code === 'no-data') {
          throw new UdsError(servicio, 0x10, contexto);
        }
        throw err;
      }

      const mensajes = parseEcuMessages(lineas, familyOf(this.driver.protocol));
      const propio = mensajes.find((m) =>
        m.ecu === this.opc.resAddr || m.ecu.endsWith(this.opc.resAddr) || m.ecu === '?');
      const bytes = propio?.data ?? [];

      // Respuesta negativa: 7F <servicio> <nrc>.
      if (bytes[0] === 0x7f && bytes[1] === servicio) {
        const nrc = bytes[2] ?? 0x10;
        if (nrc === RESPUESTA_PENDIENTE) {
          await new Promise((r) => setTimeout(r, 100));
          continue;
        }
        throw new UdsError(servicio, nrc, contexto);
      }
      if (bytes[0] === servicio + 0x40) return bytes.slice(1);
      throw new UdsError(servicio, 0x10, contexto);
    }
    throw new UdsError(servicio, RESPUESTA_PENDIENTE, contexto);
  }

  /** Servicio 0x10: cambia de sesión de diagnóstico. */
  async sesion(tipo: number): Promise<void> {
    await this.enviar(0x10, hex2(tipo), 'Abrir sesión de diagnóstico', 4000);
  }

  /** Mantiene viva la sesión (0x3E con "no respondas"). */
  async testerPresent(): Promise<void> {
    await this.driver.send('3E80').catch(() => {});
  }

  /**
   * Servicio 0x27: acceso de seguridad.
   *
   * Pide la semilla con el nivel impar, calcula la llave con el algoritmo
   * provisto y la manda con el nivel par. Una semilla de solo ceros significa
   * que la ECU ya está desbloqueada.
   */
  async accesoSeguridad(nivel: number, algoritmo: AlgoritmoLlave): Promise<void> {
    const semilla = await this.enviar(0x27, hex2(nivel), 'Pedir semilla', 3000);
    // La ECU puede devolver el nivel al principio; se descarta si está.
    const bytesSemilla = semilla[0] === nivel ? semilla.slice(1) : semilla;
    if (bytesSemilla.every((b) => b === 0)) return; // ya desbloqueada

    const llave = algoritmo(bytesSemilla);
    const datos = hex2(nivel + 1) + llave.map(hex2).join('');
    await this.enviar(0x27, datos, 'Enviar llave', 3000);
  }

  /**
   * Servicio 0x23: leer memoria por dirección, en una sola solicitud.
   *
   * El byte de formato indica cuántos bytes ocupan la dirección y el tamaño.
   * Es el camino más simple; no todas las ECU lo exponen.
   */
  async leerMemoriaPorDireccion(
    direccion: number,
    tamano: number,
    addrBytes: number,
    sizeBytes: number,
  ): Promise<number[]> {
    const alfi = (sizeBytes << 4) | addrBytes;
    const datos = hex2(alfi) + hexN(direccion, addrBytes) + hexN(tamano, sizeBytes);
    return this.enviar(0x23, datos, 'Leer memoria por dirección', 4000);
  }

  /**
   * Servicio 0x35: solicitar subida (lectura por bloques).
   *
   * Devuelve el tamaño máximo de bloque que la ECU entrega por cada
   * TransferData. Para memorias grandes es el camino que usan las
   * herramientas, porque evita pedir todo de una.
   */
  async solicitarSubida(
    direccion: number,
    tamano: number,
    addrBytes: number,
    sizeBytes: number,
  ): Promise<number> {
    const alfi = (sizeBytes << 4) | addrBytes;
    // Formato de datos 0x00 = sin compresión ni cifrado.
    const datos = '00' + hex2(alfi) + hexN(direccion, addrBytes) + hexN(tamano, sizeBytes);
    const res = await this.enviar(0x35, datos, 'Solicitar subida', 4000);
    // Respuesta: <longitudDeFormato> <maxNumberOfBlockLength...>.
    const nBytes = (res[0] ?? 0) >> 4;
    let max = 0;
    for (let i = 1; i <= nBytes && i < res.length; i++) max = (max << 8) | (res[i] ?? 0);
    return max > 0 ? max : 0xff;
  }

  /** Servicio 0x36: pedir el siguiente bloque. */
  async transferir(contador: number): Promise<number[]> {
    const res = await this.enviar(0x36, hex2(contador & 0xff), `Transferir bloque ${contador}`, 4000);
    // La respuesta repite el contador y luego trae los datos.
    return res[0] === (contador & 0xff) ? res.slice(1) : res;
  }

  /** Servicio 0x37: terminar la transferencia. */
  async terminarTransferencia(): Promise<void> {
    await this.enviar(0x37, '', 'Terminar transferencia', 3000);
  }
}
