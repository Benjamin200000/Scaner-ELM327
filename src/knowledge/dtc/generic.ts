import type { DtcKnowledge } from '../types';

/**
 * Códigos genéricos OBD-II (SAE J2012 / ISO 15031-6).
 *
 * COBERTURA: esto es un subconjunto curado, no un catálogo completo. Hay
 * miles de códigos genéricos y decenas de miles específicos de fabricante.
 * Las entradas acá son las que más aparecen en los sistemas que cubre la
 * app (mezcla, aire, turbo, EGR, DPF, catalizador).
 *
 * Un código ausente NO se rellena con un texto genérico: la búsqueda
 * devuelve null y la UI lo informa como descripción no disponible. Es
 * preferible a mostrarle al mecánico una descripción inventada.
 */

const norma = { source: 'norma', reference: 'SAE J2012 / ISO 15031-6' } as const;
const taller = { source: 'practica-taller' } as const;

export const GENERIC_DTCS: DtcKnowledge[] = [
  {
    code: 'P0171',
    description: 'Sistema de combustible demasiado pobre (banco 1)',
    system: 'Combustible',
    priority: 'media',
    meaning:
      'La ECU tuvo que agregar combustible de forma sostenida para mantener ' +
      'la mezcla en lambda 1. La corrección larga se fue al límite positivo, ' +
      'lo que indica que entra más aire del que la ECU mide, o menos ' +
      'combustible del que calcula.',
    causes: [
      'Entrada de aire falsa después del medidor de caudal (mangueras, juntas, retén)',
      'MAF sucio o fuera de calibración, que subestima el caudal real',
      'Presión de combustible baja: filtro, bomba o regulador',
      'Inyectores sucios u obstruidos',
      'Sonda lambda lenta o contaminada',
      'Fuga en el escape antes de la sonda, que mete aire al gas medido',
    ],
    checkParams: ['ltft1', 'stft1', 'maf', 'map', 'rpm', 'load', 'lambda_cmd'],
    tests: [
      'Comparar MAF medido contra el esperado para ese régimen y carga',
      'Observar si la corrección larga baja al elevar el régimen: una entrada ' +
        'de aire falsa pierde peso relativo al subir el caudal',
      'Prueba de humo en la admisión para localizar fugas',
      'Medir presión de combustible con el motor en carga',
    ],
    confirmsIf: [
      'La corrección larga mejora notablemente al aumentar el régimen: apunta ' +
        'a entrada de aire falsa en ralentí',
      'El MAF lee por debajo de lo esperado con carga alta: apunta al medidor',
    ],
    rulesOutIf: [
      'La corrección larga es igual de alta en todo el rango de régimen y carga: ' +
        'una entrada de aire falsa localizada se vuelve menos probable',
    ],
    provenance: norma,
  },
  {
    code: 'P0172',
    description: 'Sistema de combustible demasiado rico (banco 1)',
    system: 'Combustible',
    priority: 'media',
    meaning:
      'La ECU tuvo que quitar combustible de forma sostenida. La corrección ' +
      'larga se fue al límite negativo: llega más combustible del calculado ' +
      'o la ECU sobreestima el aire que entra.',
    causes: [
      'Presión de combustible alta: regulador o retorno obstruido',
      'Inyector con fuga o goteo',
      'MAF que sobreestima el caudal',
      'Filtro de aire obstruido',
      'Sonda lambda contaminada que informa pobre de forma falsa',
      'Sensor de temperatura de refrigerante que informa un motor más frío',
    ],
    checkParams: ['ltft1', 'stft1', 'maf', 'coolant', 'rpm', 'load'],
    tests: [
      'Medir presión de combustible y su caída al cortar el encendido',
      'Verificar la temperatura de refrigerante contra la real del motor',
      'Revisar el estado del filtro de aire',
    ],
    provenance: norma,
  },
  {
    code: 'P0300',
    description: 'Fallo de combustión detectado, cilindro aleatorio o múltiple',
    system: 'Encendido',
    priority: 'alta',
    meaning:
      'La ECU detectó irregularidades en el giro del cigüeñal compatibles con ' +
      'combustiones fallidas, sin poder atribuirlas a un cilindro único. Un ' +
      'fallo sostenido manda combustible sin quemar al catalizador y puede ' +
      'destruirlo.',
    causes: [
      'Bujías o cables en mal estado',
      'Bobina de encendido defectuosa',
      'Entrada de aire falsa importante',
      'Presión de combustible insuficiente',
      'Problema mecánico: compresión, distribución, válvulas',
      'EGR que recircula en exceso',
    ],
    checkParams: ['rpm', 'load', 'stft1', 'ltft1', 'maf', 'timing', 'coolant'],
    tests: [
      'Leer el contador de fallos por cilindro si la ECU lo expone',
      'Prueba de compresión',
      'Revisar bujías y bobinas',
      'Prueba de humo en la admisión',
    ],
    provenance: norma,
  },
  {
    code: 'P0401',
    description: 'Flujo de recirculación de gases de escape insuficiente',
    system: 'EGR',
    priority: 'media',
    meaning:
      'La ECU solicitó recirculación y no vio el efecto esperado. Suele ser ' +
      'obstrucción por carbonilla más que una falla eléctrica.',
    causes: [
      'Válvula EGR o conductos obstruidos por carbonilla',
      'Válvula EGR trabada',
      'Actuador o solenoide de control defectuoso',
      'Sensor de presión diferencial de EGR obstruido',
      'Enfriador de EGR tapado',
    ],
    checkParams: ['egr_cmd', 'egr_error', 'maf', 'map', 'rpm', 'load'],
    tests: [
      'Observar si el MAF cae al solicitar EGR: si no cambia, el flujo no ocurre',
      'Prueba de actuador sobre la válvula EGR, observando la respuesta',
      'Inspección física de la válvula y los conductos',
    ],
    provenance: norma,
  },
  {
    code: 'P0420',
    description: 'Eficiencia del catalizador por debajo del umbral (banco 1)',
    system: 'Emisiones',
    priority: 'media',
    meaning:
      'La sonda posterior sigue de cerca a la anterior, lo que indica que el ' +
      'catalizador no está almacenando oxígeno como debería. Puede ser el ' +
      'catalizador, pero también una sonda o una fuga de escape.',
    causes: [
      'Catalizador degradado o envenenado',
      'Sonda lambda posterior lenta o fuera de rango',
      'Fuga en el escape antes o entre sondas',
      'Fallo de combustión o mezcla rica sostenida que dañó el catalizador',
    ],
    checkParams: ['stft1', 'ltft1', 'coolant', 'load'],
    tests: [
      'Comparar la señal de la sonda anterior y la posterior en carga estable',
      'Verificar que no haya fallos de combustión activos',
      'Buscar fugas de escape antes del catalizador',
    ],
    rulesOutIf: [
      'Hay fallos de combustión o mezcla muy rica activos: corregir eso primero, ' +
        'porque puede ser la causa y no la consecuencia',
    ],
    provenance: norma,
  },
  {
    code: 'P0234',
    description: 'Condición de sobrepresión del turbocompresor',
    system: 'Turbo',
    priority: 'alta',
    meaning:
      'La presión de sobrealimentación superó el límite que admite la ECU. ' +
      'Sostenido, es un riesgo mecánico para el motor.',
    causes: [
      'Geometría variable trabada por carbonilla',
      'Wastegate que no abre: varilla, cápsula o actuador',
      'Solenoide de control de presión defectuoso',
      'Mangueras de control de vacío desconectadas o rotas',
      'Sensor MAP que informa por debajo de la presión real',
    ],
    checkParams: ['boost_cmd', 'boost_actual', 'map', 'baro', 'rpm', 'load'],
    tests: [
      'Comparar boost solicitado contra real a lo largo de una aceleración',
      'Verificar el recorrido del actuador de wastegate o de geometría variable',
      'Comprobar estanqueidad del circuito de vacío de control',
    ],
    confirmsIf: [
      'El boost real supera de forma sostenida el solicitado al acelerar',
    ],
    provenance: norma,
  },
  {
    code: 'P0299',
    description: 'Condición de subpresión del turbocompresor',
    system: 'Turbo',
    priority: 'media',
    meaning:
      'La presión de sobrealimentación quedó por debajo de la solicitada. ' +
      'Normalmente hay una fuga, una restricción o el turbo no responde.',
    causes: [
      'Fuga en el circuito de aire presurizado: mangueras, intercooler, abrazaderas',
      'Geometría variable trabada en posición de baja presión',
      'Filtro de aire o admisión obstruida',
      'DPF muy saturado, que genera contrapresión',
      'Turbo desgastado',
      'Sensor MAP fuera de calibración',
    ],
    checkParams: ['boost_cmd', 'boost_actual', 'map', 'maf', 'dpf_delta', 'rpm', 'load'],
    tests: [
      'Comparar boost solicitado contra real en aceleración plena',
      'Presurizar el circuito de admisión para buscar fugas',
      'Revisar la contrapresión de escape y el estado del DPF',
    ],
    provenance: norma,
  },
  {
    code: 'P2002',
    description: 'Eficiencia del filtro de partículas por debajo del umbral (banco 1)',
    system: 'DPF',
    priority: 'alta',
    meaning:
      'La ECU concluyó que el DPF no filtra como debería. Lo habitual es ' +
      'saturación por regeneraciones incompletas, pero también puede ser el ' +
      'sensor de presión diferencial o un filtro dañado.',
    causes: [
      'DPF saturado de hollín por ciclos de uso que no permiten regenerar',
      'Acumulación de ceniza por kilometraje: no se elimina regenerando',
      'Sensor o mangueras de presión diferencial obstruidos o mal conectados',
      'Regeneraciones interrumpidas de forma repetida',
      'Problema previo que ensucia en exceso: inyectores, EGR, turbo',
      'DPF fisurado o con el sustrato dañado',
    ],
    checkParams: [
      'dpf_delta', 'dpf_inlet_temp', 'dpf_outlet_temp', 'egt1',
      'rpm', 'load', 'maf', 'coolant',
    ],
    tests: [
      'Leer carga de hollín y de ceniza en la ECU si las expone (requiere ' +
        'diagnóstico de fabricante, no alcanza con OBD-II genérico)',
      'Observar la presión diferencial contra el régimen: tiene que crecer con el caudal',
      'Verificar que las mangueras del sensor diferencial no estén obstruidas',
      'Revisar el historial de regeneraciones y su distancia entre ciclos',
    ],
    confirmsIf: [
      'La presión diferencial es alta y crece de forma marcada con el régimen',
      'La carga de hollín informada está por encima del umbral de regeneración',
    ],
    rulesOutIf: [
      'La presión diferencial se mantiene casi fija al variar el régimen: apunta ' +
        'al sensor o a sus mangueras, no al filtro',
    ],
    provenance: norma,
  },
  {
    code: 'P2463',
    description: 'Filtro de partículas: acumulación excesiva de hollín',
    system: 'DPF',
    priority: 'alta',
    meaning:
      'La carga de hollín calculada superó el umbral admitido. Si se sigue ' +
      'usando el vehículo sin regenerar, la ECU puede limitar la potencia.',
    causes: [
      'Ciclos de uso cortos que nunca alcanzan temperatura de regeneración',
      'Regeneraciones iniciadas y cortadas por apagar el motor',
      'Falla previa que impide regenerar: EGR, inyección, temperatura',
    ],
    checkParams: ['dpf_delta', 'dpf_inlet_temp', 'egt1', 'coolant', 'rpm'],
    tests: [
      'Verificar si quedan regeneraciones habilitadas en la ECU',
      'Comprobar que se cumplan las condiciones de temperatura',
      'Revisar fallas activas que bloqueen la regeneración',
    ],
    provenance: norma,
  },
  {
    code: 'P0102',
    description: 'Señal baja del circuito del medidor de caudal de aire',
    system: 'Admisión',
    priority: 'media',
    meaning:
      'La señal del MAF quedó por debajo del rango plausible. Puede ser el ' +
      'sensor, su cableado o una restricción grande en la admisión.',
    causes: [
      'MAF sucio, dañado o fuera de calibración',
      'Cableado o conector del MAF con mala continuidad',
      'Admisión obstruida o filtro muy sucio',
      'Fuga grande entre el MAF y la mariposa',
    ],
    checkParams: ['maf', 'map', 'rpm', 'load', 'baro'],
    tests: [
      'Comparar el MAF con el valor esperado en ralentí y en carga',
      'Verificar alimentación y masa del sensor',
      'Inspeccionar el elemento del filtro de aire',
    ],
    provenance: norma,
  },
  {
    code: 'P0128',
    description: 'Temperatura de refrigerante por debajo de la de regulación del termostato',
    system: 'Motor',
    priority: 'baja',
    meaning:
      'El motor no alcanzó la temperatura esperada en el tiempo previsto. ' +
      'Normalmente es el termostato abierto, y afecta consumo y emisiones.',
    causes: [
      'Termostato trabado abierto',
      'Sensor de temperatura de refrigerante fuera de calibración',
      'Nivel de refrigerante bajo',
      'Electroventilador que funciona de forma permanente',
    ],
    checkParams: ['coolant', 'ambient', 'run_time', 'load'],
    tests: [
      'Seguir la curva de temperatura desde el arranque en frío',
      'Comparar la lectura del sensor con un termómetro externo',
    ],
    provenance: taller,
  },
];

/** Índice por código. Dos entradas con el mismo código: gana la primera. */
const INDEX = new Map<string, DtcKnowledge>();
for (const entry of GENERIC_DTCS) {
  if (!INDEX.has(entry.code)) INDEX.set(entry.code, entry);
}

/**
 * Busca la interpretación de un código.
 *
 * Devuelve null si no está en la base. Quien llama DEBE manejar ese caso
 * mostrando "descripción no disponible", nunca un texto armado al vuelo.
 */
export const findDtcKnowledge = (code: string): DtcKnowledge | null =>
  INDEX.get(code.toUpperCase()) ?? null;

export const knownDtcCount = (): number => INDEX.size;
