import { SID, VAG_SESSION } from '@/core/kwp2000/sid';
import type { ServiceRoutine } from './types';
import {
  combustibleSuficiente,
  motorATemperatura,
  motorDetenido,
  motorEnMarcha,
  sinFallasCriticas,
  tensionSuficiente,
  vehiculoDetenido,
} from './preconditions';

/**
 * Catálogo de rutinas de servicio.
 *
 * Cada rutina declara si su secuencia está VERIFICADA contra una ECU real.
 * Las que no lo están solo se pueden correr en modo simulación, y eso lo
 * impone el ejecutor, no la buena voluntad de la interfaz.
 *
 * El criterio para marcar `verified: true` es estricto: o la secuencia está
 * en una norma pública que pude contrastar, o alguien la ejecutó contra un
 * vehículo real y el resultado se confirmó. Documentación de terceros,
 * foros y deducción por analogía NO alcanzan para una escritura.
 */

/**
 * Borrado de códigos de falla. Modo 04 de OBD-II.
 *
 * Es la única rutina de escritura verificada acá, porque es la única cuya
 * secuencia está definida en norma pública y es idéntica en todos los
 * vehículos con OBD-II.
 */
export const borrarCodigos: ServiceRoutine = {
  id: 'obd2.clear-dtc',
  label: 'Borrar códigos de falla',
  description:
    'Borra los códigos almacenados, los datos congelados y reinicia los ' +
    'monitores de a bordo. No repara nada: si la condición persiste, el ' +
    'código vuelve.',
  risk: 'escritura',
  scope: 'obd2',
  families: ['iso9141', 'kwp', 'can', 'pwm', 'vpw'],
  verified: true,
  sourceNote: 'Servicio 04 de SAE J1979 / ISO 15031-5. Idéntico en todo vehículo OBD-II.',
  preconditions: [vehiculoDetenido, tensionSuficiente],
  steps: [
    {
      label: 'Borrar información de diagnóstico',
      explain:
        'Envía el servicio 04. La ECU borra códigos confirmados y pendientes, ' +
        'los datos congelados asociados, la distancia y el tiempo con el ' +
        'testigo encendido, y pone los monitores de a bordo en "no listo".',
      writes: true,
      sid: 0x04,
      payload: [],
      settleMs: 500,
    },
  ],
  afterNote:
    'Los monitores de a bordo quedan en "no listo" y hacen falta varios ' +
    'ciclos de conducción para que vuelvan a completarse. Si el vehículo ' +
    'tiene que pasar una verificación técnica, conviene no borrar justo antes.',
};

/**
 * Lectura del intervalo de servicio en VAG sobre KWP2000.
 *
 * Es solo lectura, así que el riesgo de ejecutarla es nulo. Igual queda
 * marcada como no verificada porque el identificador local del bloque varía
 * entre familias de ECU: en una que no lo tenga, la respuesta va a ser un
 * rechazo, no un dato equivocado.
 */
export const leerIntervaloServicio: ServiceRoutine = {
  id: 'vag.read-service-interval',
  label: 'Leer intervalo de servicio',
  description:
    'Consulta cuántos kilómetros y días faltan para el próximo servicio, ' +
    'según lo que tiene almacenado la ECU.',
  risk: 'lectura',
  scope: 'fabricante',
  families: ['kwp'],
  makes: ['volkswagen', 'vw', 'audi', 'seat', 'skoda', 'škoda'],
  header: '8110F1',
  verified: false,
  sourceNote:
    'Servicio 0x21 (readDataByLocalIdentifier) de ISO 14230-3, con el ' +
    'identificador de bloque 0x30. El servicio es norma; el identificador ' +
    'del bloque es específico de la familia de ECU y está sin verificar.',
  preconditions: [vehiculoDetenido],
  steps: [
    {
      label: 'Abrir sesión de diagnóstico',
      explain:
        'Solicita la sesión 0x89. Es la sesión de lectura: no habilita ' +
        'escrituras, así que este paso por sí solo no puede modificar nada.',
      writes: false,
      sid: SID.startDiagnosticSession,
      payload: [VAG_SESSION.default],
      settleMs: 150,
    },
    {
      label: 'Leer bloque de intervalo de servicio',
      explain:
        'Pide el bloque 0x30. Se esperan tres bytes: dos con la distancia ' +
        'restante en centenas de kilómetros y uno con los días restantes.',
      writes: false,
      sid: SID.readDataByLocalIdentifier,
      payload: [0x30],
      interpret(res) {
        const [, kmHi, kmLo, days] = res.data;
        if (kmHi === undefined || kmLo === undefined || days === undefined) {
          return 'Respuesta más corta de lo esperado: el bloque no tiene este formato en esta ECU';
        }
        const km = ((kmHi << 8) | kmLo) * 100;
        return `Faltan ${km.toLocaleString('es')} km o ${days} días`;
      },
    },
  ],
};

/**
 * Reinicio del intervalo de servicio en VAG sobre KWP2000.
 *
 * ESCRITURA SIN VERIFICAR. La secuencia es plausible y sigue la norma, pero
 * el identificador del bloque y el formato del valor a escribir son
 * específicos de la familia de ECU. Hasta confirmarla contra un vehículo
 * real, el ejecutor solo la deja correr en modo simulación.
 */
export const resetIntervaloServicio: ServiceRoutine = {
  id: 'vag.reset-service-interval',
  label: 'Reiniciar intervalo de servicio',
  description:
    'Pone a cero el contador de servicio: la distancia y los días hasta el ' +
    'próximo mantenimiento vuelven al valor de fábrica.',
  risk: 'escritura',
  scope: 'fabricante',
  families: ['kwp'],
  makes: ['volkswagen', 'vw', 'audi', 'seat', 'skoda', 'škoda'],
  header: '8110F1',
  verified: false,
  sourceNote:
    'Servicios 0x10 y 0x3B de ISO 14230-3. Los servicios son norma; el ' +
    'identificador de bloque 0x30 y el formato del valor son específicos de ' +
    'la familia de ECU y NO están verificados contra un vehículo real. ' +
    'Correr primero en modo simulación y contrastar la secuencia con la ' +
    'documentación del vehículo.',
  preconditions: [
    motorDetenido,
    vehiculoDetenido,
    tensionSuficiente,
  ],
  steps: [
    {
      label: 'Abrir sesión extendida',
      explain:
        'Solicita la sesión 0x85. Es la que habilita escrituras; sin ella ' +
        'la ECU rechaza el paso siguiente con "servicio no permitido en la ' +
        'sesión activa".',
      writes: false,
      sid: SID.startDiagnosticSession,
      payload: [VAG_SESSION.extended],
      settleMs: 200,
    },
    {
      label: 'Escribir el contador de servicio',
      explain:
        'Escribe el bloque 0x30 con el valor de reinicio. Este es el paso ' +
        'que modifica la ECU de forma permanente.',
      writes: true,
      sid: SID.writeDataByLocalIdentifier,
      payload: [0x30, 0x00, 0x00],
      settleMs: 400,
    },
    {
      label: 'Releer para confirmar',
      explain:
        'Vuelve a leer el bloque. Si la escritura funcionó, la distancia ' +
        'restante tiene que haber cambiado al valor de fábrica.',
      writes: false,
      sid: SID.readDataByLocalIdentifier,
      payload: [0x30],
      interpret(res) {
        const [, kmHi, kmLo, days] = res.data;
        if (kmHi === undefined || kmLo === undefined || days === undefined) {
          return 'No se pudo confirmar: la respuesta no tiene el formato esperado';
        }
        const km = ((kmHi << 8) | kmLo) * 100;
        return `Contador ahora en ${km.toLocaleString('es')} km / ${days} días`;
      },
    },
    {
      label: 'Cerrar sesión extendida',
      explain:
        'Vuelve a la sesión por defecto. Dejar una sesión extendida abierta ' +
        'y colgada es una forma fácil de que la próxima operación falle.',
      writes: false,
      sid: SID.stopDiagnosticSession,
      payload: [],
    },
  ],
  afterNote:
    'El tablero debería mostrar el intervalo nuevo al dar contacto otra vez. ' +
    'Si no cambió, la escritura no tomó: revisar la secuencia antes de repetirla.',
};

/**
 * Regeneración forzada de DPF.
 *
 * Declarada pero DELIBERADAMENTE sin pasos. Es la rutina de mayor riesgo
 * físico del catálogo: lleva el escape a más de 600 °C con el vehículo
 * detenido. Publicar una secuencia sin verificar para esto sería imprudente,
 * así que la entrada existe para que la UI muestre las condiciones y el
 * alcance, y el ejecutor la rechaza por no tener pasos.
 */
export const regeneracionDpf: ServiceRoutine = {
  id: 'vag.dpf-regen',
  label: 'Regeneración forzada de DPF',
  description:
    'Fuerza un ciclo de regeneración con el vehículo detenido. El escape ' +
    'supera los 600 °C y el ciclo puede durar más de veinte minutos.',
  risk: 'fisico',
  scope: 'fabricante',
  families: ['kwp', 'can'],
  makes: ['volkswagen', 'vw', 'audi', 'seat', 'skoda', 'škoda'],
  verified: false,
  sourceNote:
    'SIN IMPLEMENTAR. La secuencia varía entre familias de ECU y es la ' +
    'operación de mayor riesgo físico del catálogo. No se publica una ' +
    'secuencia sin verificar para algo que calienta el escape a más de ' +
    '600 °C con el vehículo parado.',
  preconditions: [
    motorEnMarcha,
    motorATemperatura,
    combustibleSuficiente,
    vehiculoDetenido,
    sinFallasCriticas,
    tensionSuficiente,
  ],
  steps: [],
  afterNote:
    'Durante la regeneración el vehículo no se puede apagar ni mover. ' +
    'Tiene que estar al aire libre, lejos de material inflamable, y nadie ' +
    'debe estar cerca de la salida de escape.',
};

export const ROUTINES: ServiceRoutine[] = [
  borrarCodigos,
  leerIntervaloServicio,
  resetIntervaloServicio,
  regeneracionDpf,
];

export const routineById = (id: string): ServiceRoutine | null =>
  ROUTINES.find((r) => r.id === id) ?? null;
