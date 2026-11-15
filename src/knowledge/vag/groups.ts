/**
 * Definición de los grupos de medición de ME7.5 (VAG, KW1281 / KWP2000).
 *
 * El protocolo entrega hasta cuatro campos por grupo con su valor y unidad,
 * pero NO dice qué representa cada campo. Esta tabla nombra los campos de los
 * grupos más usados en motores ME7.5.
 *
 * Orientada a ME7.5 y PARCIAL: el contenido exacto de cada grupo varía según
 * la versión de software de la ECU, así que un grupo o campo que no esté acá
 * se muestra como "Campo N". Sigue la nomenclatura de las etiquetas de la
 * comunidad (Ross-Tech), no verificada campo por campo contra una ECU.
 */

export interface GrupoDef {
  grupo: number;
  titulo: string;
  campos: string[];
}

const G: GrupoDef[] = [
  { grupo: 1, titulo: 'Básico', campos: ['Régimen del motor', 'Temperatura refrigerante', 'Sonda lambda', 'Estado del sistema'] },
  { grupo: 2, titulo: 'Carga y ralentí', campos: ['Régimen del motor', 'Carga', 'Tiempo de inyección', 'Posición mariposa'] },
  { grupo: 3, titulo: 'Admisión', campos: ['Régimen del motor', 'Presión del colector', 'Caudal de aire', 'Ángulo de encendido'] },
  { grupo: 4, titulo: 'Avance de encendido', campos: ['Régimen del motor', 'Carga', 'Ángulo de encendido', 'Temperatura refrigerante'] },
  { grupo: 20, titulo: 'Detonación', campos: ['Régimen del motor', 'Carga', 'Retardo cil. 1-2', 'Retardo cil. 3-4'] },
  { grupo: 31, titulo: 'Regulación lambda', campos: ['Sonda delante', 'Corrección', 'Sonda detrás', 'Estado'] },
  { grupo: 115, titulo: 'Sobrealimentación', campos: ['Régimen del motor', 'Presión solicitada', 'Presión real', 'Ciclo de la electroválvula'] },
  { grupo: 118, titulo: 'EGR', campos: ['Régimen del motor', 'EGR solicitada', 'EGR real', 'Estado'] },
];

const INDICE = new Map<number, GrupoDef>(G.map((g) => [g.grupo, g]));

export const buscarGrupoVag = (grupo: number): GrupoDef | null => INDICE.get(grupo) ?? null;

/** Nombre del campo i (0-based) de un grupo, o un rótulo genérico. */
export function nombreCampo(grupo: number, i: number): string {
  return buscarGrupoVag(grupo)?.campos[i] ?? `Campo ${i + 1}`;
}
