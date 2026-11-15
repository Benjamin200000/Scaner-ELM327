import type { Elm327Driver } from '@/core/elm327/driver';
import { UdsClient, UdsError } from './client';
import { ElmError } from '@/core/elm327/errors';
import type { EcuModule, RegionMemoria } from './modules';
import { obtenerAlgoritmo } from './security';

/**
 * Motor de lectura de memoria de ECU por UDS.
 *
 * Orquesta el flujo completo y seguro-de-solo-lectura: abre la sesión,
 * desbloquea si hace falta, lee la región en trozos informando el avance, y
 * siempre deja la cabecera del adaptador como estaba.
 *
 * Nunca escribe. Lee en bloques acotados para no saturar el adaptador y para
 * poder mostrar progreso y permitir cancelar, que en una lectura larga
 * importa.
 */

export interface AvanceLectura {
  region: string;
  leido: number;
  total: number;
}

export interface ResultadoLectura {
  region: RegionMemoria;
  datos: Uint8Array;
  /** true si se leyó todo lo pedido. */
  completa: boolean;
  /** Motivo si quedó incompleta. */
  motivo?: string;
}

export interface OpcionesLectura {
  onAvance?: (a: AvanceLectura) => void;
  cancelar?: () => boolean;
}

export async function leerRegion(
  driver: Elm327Driver,
  modulo: EcuModule,
  region: RegionMemoria,
  opc: OpcionesLectura = {},
): Promise<ResultadoLectura> {
  const uds = new UdsClient(driver, { reqAddr: modulo.reqAddr, resAddr: modulo.resAddr });
  const datos = new Uint8Array(region.tamano);
  let leido = 0;

  const avisar = (): void => opc.onAvance?.({ region: region.id, leido, total: region.tamano });

  await uds.preparar();
  try {
    await uds.sesion(modulo.sesion);

    if (modulo.seguridad.nivel > 0) {
      const algoritmo = obtenerAlgoritmo(modulo.seguridad.algoritmo);
      if (algoritmo === null) {
        return incompleta(region, datos, leido,
          `No hay un algoritmo de llave para "${modulo.seguridad.algoritmo}". ` +
          'Sin él la ECU no se desbloquea.');
      }
      await uds.accesoSeguridad(modulo.seguridad.nivel, algoritmo);
    }

    if (modulo.metodo === 'subida') {
      await uds.solicitarSubida(
        region.direccion, region.tamano, modulo.addrBytes, modulo.sizeBytes);
      let contador = 1;
      while (leido < region.tamano) {
        if (opc.cancelar?.()) return incompleta(region, datos, leido, 'Cancelado');
        const bloque = await uds.transferir(contador);
        if (bloque.length === 0) break;
        const n = Math.min(bloque.length, region.tamano - leido);
        datos.set(bloque.slice(0, n), leido);
        leido += n;
        contador = (contador % 0xff) + 1;
        avisar();
      }
      await uds.terminarTransferencia().catch(() => {});
    } else {
      // Lectura por dirección: en trozos del tamaño que conviene por mensaje.
      const paso = 0x40;
      while (leido < region.tamano) {
        if (opc.cancelar?.()) return incompleta(region, datos, leido, 'Cancelado');
        const pedir = Math.min(paso, region.tamano - leido);
        const bloque = await uds.leerMemoriaPorDireccion(
          region.direccion + leido, pedir, modulo.addrBytes, modulo.sizeBytes);
        if (bloque.length === 0) break;
        const n = Math.min(bloque.length, region.tamano - leido);
        datos.set(bloque.slice(0, n), leido);
        leido += n;
        avisar();
      }
    }
  } catch (err) {
    // Una respuesta negativa (acceso denegado, servicio no soportado) o un
    // corte de enlace se informan como lectura incompleta con su motivo, no
    // como una excepción suelta que el usuario no sabe interpretar.
    if (err instanceof UdsError || err instanceof ElmError) {
      return incompleta(region, datos, leido, err.message);
    }
    throw err;
  } finally {
    await uds.liberar();
  }

  if (leido < region.tamano) {
    return incompleta(region, datos, leido, 'La ECU dejó de entregar datos');
  }
  return { region, datos, completa: true };
}

function incompleta(
  region: RegionMemoria,
  datos: Uint8Array,
  leido: number,
  motivo: string,
): ResultadoLectura {
  return { region, datos: datos.slice(0, leido), completa: false, motivo };
}

/** Vuelca los bytes en el formato clásico de un visor hexadecimal. */
export function volcadoHex(datos: Uint8Array, direccionBase = 0): string[] {
  const lineas: string[] = [];
  for (let i = 0; i < datos.length; i += 16) {
    const trozo = datos.slice(i, i + 16);
    const hex = Array.from(trozo, (b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(trozo, (b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.')).join('');
    const addr = (direccionBase + i).toString(16).toUpperCase().padStart(8, '0');
    lineas.push(`${addr}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return lineas;
}
