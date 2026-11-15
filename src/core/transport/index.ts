import type { TransportAvailability } from './types';
import { WebSerialTransport } from './webserial';
import { WebBluetoothTransport } from './webbluetooth';

export * from './types';
export { WebSerialTransport } from './webserial';
export { WebBluetoothTransport } from './webbluetooth';
export { MockTransport } from './mock';

/**
 * Qué transportes puede usar realmente este dispositivo.
 *
 * Se consulta antes de ofrecer un botón de conexión: es mejor explicar por
 * qué una opción no está disponible que dejar que falle al apretarla.
 */
export function detectTransports(): TransportAvailability[] {
  const secure = typeof window !== 'undefined' ? window.isSecureContext : true;

  const serialPresent = WebSerialTransport.serial !== null;
  const blePresent = WebBluetoothTransport.bluetooth !== null;

  return [
    {
      kind: 'webserial',
      label: 'ELM327 USB',
      ...verdict(serialPresent, secure,
        'Requiere Chrome o Edge de escritorio. No existe en Safari, Firefox, Android ni iOS.'),
    },
    {
      kind: 'webbluetooth',
      label: 'ELM327 Bluetooth LE',
      ...verdict(blePresent, secure,
        'Requiere Chrome o Edge en escritorio o Android. No existe en iOS ni en Safari. ' +
        'Solo adaptadores BLE: los ELM327 Bluetooth Classic (SPP) no son accesibles desde el navegador.'),
    },
    {
      kind: 'mock',
      label: 'Simulador',
      available: true,
      detail: 'Vehículo simulado. Sin hardware, para desarrollo y pruebas.',
    },
  ];
}

function verdict(present: boolean, secure: boolean, detail: string): {
  available: boolean;
  reason?: TransportAvailability['reason'] | undefined;
  detail?: string | undefined;
} {
  if (!present) return { available: false, reason: 'unsupported-browser', detail };
  if (!secure) {
    return {
      available: false,
      reason: 'insecure-context',
      detail: 'El navegador exige HTTPS o localhost para acceder al hardware.',
    };
  }
  return { available: true, detail };
}
