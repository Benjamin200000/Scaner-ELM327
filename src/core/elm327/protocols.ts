/** Protocolos que el ELM327 puede seleccionar con ATSP. */
export interface ElmProtocol {
  /** Dígito que usa ATSP / reporta ATDPN. */
  id: string;
  name: string;
  family: 'auto' | 'pwm' | 'vpw' | 'iso9141' | 'kwp' | 'can';
  /** Si soporta diagnóstico extendido tipo UDS sobre ISO-TP. */
  isoTp: boolean;
  note?: string;
}

export const PROTOCOLS: ElmProtocol[] = [
  { id: '0', name: 'Detección automática', family: 'auto', isoTp: false },
  { id: '1', name: 'SAE J1850 PWM (41.6 kbaud)', family: 'pwm', isoTp: false,
    note: 'Ford hasta ~2003.' },
  { id: '2', name: 'SAE J1850 VPW (10.4 kbaud)', family: 'vpw', isoTp: false,
    note: 'GM hasta ~2005.' },
  { id: '3', name: 'ISO 9141-2 (5 baud init, 10.4 kbaud)', family: 'iso9141', isoTp: false,
    note: 'K-Line. Asiáticos y europeos antiguos.' },
  { id: '4', name: 'ISO 14230-4 KWP (5 baud init, 10.4 kbaud)', family: 'kwp', isoTp: false,
    note: 'K-Line KWP2000 con inicialización lenta.' },
  { id: '5', name: 'ISO 14230-4 KWP (fast init, 10.4 kbaud)', family: 'kwp', isoTp: false,
    note: 'K-Line KWP2000. Habitual en VAG con ME7/EDC15.' },
  { id: '6', name: 'ISO 15765-4 CAN (11 bit, 500 kbaud)', family: 'can', isoTp: true,
    note: 'Estándar en la mayoría de vehículos desde ~2008.' },
  { id: '7', name: 'ISO 15765-4 CAN (29 bit, 500 kbaud)', family: 'can', isoTp: true },
  { id: '8', name: 'ISO 15765-4 CAN (11 bit, 250 kbaud)', family: 'can', isoTp: true },
  { id: '9', name: 'ISO 15765-4 CAN (29 bit, 250 kbaud)', family: 'can', isoTp: true },
  { id: 'A', name: 'SAE J1939 CAN (29 bit, 250 kbaud)', family: 'can', isoTp: true,
    note: 'Vehículos pesados.' },
];

export const protocolById = (id: string): ElmProtocol | null =>
  PROTOCOLS.find((p) => p.id === id.toUpperCase()) ?? null;

/**
 * ATDPN puede devolver 'A5' (automático, resolvió al 5) o '5'.
 * Devuelve el protocolo real y si se llegó por detección automática.
 */
export function parseProtocolNumber(text: string): {
  protocol: ElmProtocol | null;
  auto: boolean;
} {
  const t = text.trim().toUpperCase();
  const auto = t.startsWith('A');
  const id = auto ? t.slice(1) : t;
  return { protocol: protocolById(id), auto };
}

/**
 * Familias en las que el diagnóstico específico de fabricante es alcanzable
 * con un ELM327. Fuera de estas, la app debe decir que no es posible en vez
 * de ofrecer funciones que van a fallar.
 */
export const supportsManufacturerDiagnostics = (p: ElmProtocol): boolean =>
  p.family === 'kwp' || p.family === 'can';
