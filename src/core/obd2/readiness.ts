/**
 * Monitores de preparación (PID 01 del modo 01).
 *
 * La ECU corre autodiagnósticos de sus sistemas de emisiones y marca cada
 * uno como completado o pendiente. Al borrar códigos, o al desconectar la
 * batería, todos vuelven a pendiente y hace falta conducir un rato para que
 * se completen.
 *
 * Por qué importa en serio: en una revisión técnica, un vehículo con
 * monitores pendientes **se rechaza aunque no tenga ninguna falla**. Saberlo
 * antes de ir ahorra el viaje, y evita el error clásico de borrar los
 * códigos justo antes de la revisión.
 *
 * ─────────────────────────────────────────────────────────────────────
 * ESTADO DE VERIFICACIÓN
 *
 * El esquema de bits está en SAE J1979 / ISO 15031-5. No pude leer la
 * norma ni una fuente primaria desde este entorno, así que esta
 * implementación sigue el esquema ampliamente documentado pero NO está
 * verificada contra el documento ni contra un vehículo real.
 *
 * La polaridad es lo delicado: un bit de soporte en 1 significa soportado,
 * y un bit de completitud en 0 significa completado. Invertir el segundo
 * haría que la app diga "listo para revisión" cuando no lo está.
 *
 * Por eso la interfaz muestra los cuatro bytes crudos junto al resultado:
 * se verifica en dos minutos comparando contra un vehículo recién borrado
 * (todo pendiente) y uno con varios días de uso (casi todo completo).
 * ─────────────────────────────────────────────────────────────────────
 */

export type EstadoMonitor = 'completo' | 'pendiente' | 'no-soportado';

export interface Monitor {
  id: string;
  label: string;
  estado: EstadoMonitor;
}

export type TipoEncendido = 'chispa' | 'compresion';

export interface Readiness {
  /** Testigo de avería encendido. */
  mil: boolean;
  /** Códigos confirmados que informa la ECU. */
  dtcCount: number;
  tipoEncendido: TipoEncendido;
  monitores: Monitor[];
  /** Los cuatro bytes tal como llegaron, para poder verificar a mano. */
  raw: number[];
}

/** Monitores continuos: los tres primeros, iguales en todos los motores. */
const CONTINUOS: { bit: number; id: string; label: string }[] = [
  { bit: 0, id: 'misfire', label: 'Fallo de combustión' },
  { bit: 1, id: 'fuel', label: 'Sistema de combustible' },
  { bit: 2, id: 'components', label: 'Componentes integrales' },
];

/** Monitores no continuos, motores de encendido por chispa (gasolina). */
const CHISPA: { bit: number; id: string; label: string }[] = [
  { bit: 0, id: 'catalyst', label: 'Catalizador' },
  { bit: 1, id: 'heated_catalyst', label: 'Catalizador calefaccionado' },
  { bit: 2, id: 'evap', label: 'Sistema evaporativo' },
  { bit: 3, id: 'secondary_air', label: 'Aire secundario' },
  { bit: 4, id: 'ac_refrigerant', label: 'Refrigerante de aire acondicionado' },
  { bit: 5, id: 'o2_sensor', label: 'Sonda lambda' },
  { bit: 6, id: 'o2_heater', label: 'Calefactor de sonda lambda' },
  { bit: 7, id: 'egr', label: 'Sistema EGR' },
];

/** Monitores no continuos, motores de encendido por compresión (diésel). */
const COMPRESION: { bit: number; id: string; label: string }[] = [
  { bit: 0, id: 'nmhc_catalyst', label: 'Catalizador NMHC' },
  { bit: 1, id: 'nox_scr', label: 'Postratamiento NOx / SCR' },
  { bit: 3, id: 'boost', label: 'Presión de sobrealimentación' },
  { bit: 5, id: 'exhaust_sensor', label: 'Sensor de gases de escape' },
  { bit: 6, id: 'pm_filter', label: 'Filtro de partículas' },
  { bit: 7, id: 'egr_vvt', label: 'EGR / distribución variable' },
];

/**
 * Decodifica los cuatro bytes del PID 01.
 *
 * Devuelve null si no llegaron los cuatro bytes: con menos no se puede
 * decidir nada, y rellenar con ceros diría "todo completo", que es
 * exactamente el error peligroso.
 */
export function decodificarReadiness(payload: number[]): Readiness | null {
  const [a, b, c, d] = payload;
  if (a === undefined || b === undefined || c === undefined || d === undefined) {
    return null;
  }

  const tipoEncendido: TipoEncendido = (b & 0x08) !== 0 ? 'compresion' : 'chispa';
  const monitores: Monitor[] = [];

  // Continuos: soporte en los bits 0-2 de B, completitud en los 4-6.
  for (const m of CONTINUOS) {
    const soportado = (b & (1 << m.bit)) !== 0;
    const incompleto = (b & (1 << (m.bit + 4))) !== 0;
    monitores.push({
      id: m.id,
      label: m.label,
      estado: !soportado ? 'no-soportado' : incompleto ? 'pendiente' : 'completo',
    });
  }

  // No continuos: soporte en C, completitud en D, mismo número de bit.
  const tabla = tipoEncendido === 'compresion' ? COMPRESION : CHISPA;
  for (const m of tabla) {
    const soportado = (c & (1 << m.bit)) !== 0;
    const incompleto = (d & (1 << m.bit)) !== 0;
    monitores.push({
      id: m.id,
      label: m.label,
      estado: !soportado ? 'no-soportado' : incompleto ? 'pendiente' : 'completo',
    });
  }

  return {
    mil: (a & 0x80) !== 0,
    dtcCount: a & 0x7f,
    tipoEncendido,
    monitores,
    raw: [a, b, c, d],
  };
}

export interface VeredictoRevision {
  /** null = no se puede decidir con los datos disponibles. */
  aprobaria: boolean | null;
  pendientes: Monitor[];
  soportados: number;
  completos: number;
  motivo: string;
}

/**
 * ¿Pasaría una revisión técnica por el lado de la electrónica?
 *
 * El criterio habitual: el testigo apagado, sin códigos confirmados, y a lo
 * sumo un monitor pendiente (dos en vehículos más viejos). El umbral varía
 * según la normativa local, así que acá se informa el conteo y el criterio
 * usado en lugar de dar un veredicto a secas.
 *
 * Esto NO reemplaza a la revisión: es una señal para no hacer el viaje al
 * pedo.
 */
export function evaluarRevision(
  r: Readiness | null,
  maxPendientes = 1,
): VeredictoRevision {
  if (r === null) {
    return {
      aprobaria: null,
      pendientes: [],
      soportados: 0,
      completos: 0,
      motivo: 'La ECU no entregó el estado de los monitores',
    };
  }

  const soportados = r.monitores.filter((m) => m.estado !== 'no-soportado');
  const pendientes = soportados.filter((m) => m.estado === 'pendiente');
  const completos = soportados.length - pendientes.length;

  if (r.mil) {
    return {
      aprobaria: false,
      pendientes,
      soportados: soportados.length,
      completos,
      motivo: 'El testigo de avería está encendido: es rechazo directo',
    };
  }
  if (r.dtcCount > 0) {
    return {
      aprobaria: false,
      pendientes,
      soportados: soportados.length,
      completos,
      motivo: `La ECU informa ${r.dtcCount} código${r.dtcCount === 1 ? '' : 's'} confirmado${r.dtcCount === 1 ? '' : 's'}`,
    };
  }
  if (pendientes.length > maxPendientes) {
    return {
      aprobaria: false,
      pendientes,
      soportados: soportados.length,
      completos,
      motivo:
        `Hay ${pendientes.length} monitores pendientes y el criterio admite ` +
        `${maxPendientes}. Conducir unos días en ciclos variados suele ` +
        'completarlos; borrar códigos los vuelve a poner en cero.',
    };
  }
  return {
    aprobaria: true,
    pendientes,
    soportados: soportados.length,
    completos,
    motivo: pendientes.length === 0
      ? 'Testigo apagado, sin códigos y todos los monitores completos'
      : `Testigo apagado, sin códigos y ${pendientes.length} monitor pendiente, dentro del criterio`,
  };
}

export const ESTADO_LABEL: Record<EstadoMonitor, string> = {
  completo: 'COMPLETO',
  pendiente: 'PENDIENTE',
  'no-soportado': 'NO SOPORTADO',
};
