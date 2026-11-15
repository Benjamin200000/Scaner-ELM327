import {
  type Transport,
  type TransportInfo,
  type TransportState,
  TransportError,
} from './types';

/**
 * ELM327 por Bluetooth Low Energy.
 *
 * LIMITACIÓN DE PLATAFORMA, no del código:
 * Los ELM327 Bluetooth baratos y más comunes son Bluetooth Classic y hablan
 * SPP (Serial Port Profile). Web Bluetooth NO soporta Bluetooth Classic ni
 * SPP: solo BLE/GATT. Por lo tanto un adaptador SPP jamás aparecerá en el
 * selector del navegador, por mucho que esté emparejado con el sistema.
 *
 * Desde el navegador funcionan únicamente los adaptadores BLE, por ejemplo
 * Vgate iCar Pro BLE, Veepeak OBDCheck BLE, OBDLink CX y clones BLE.
 * Esos exponen un servicio GATT con una característica de escritura y otra
 * de notificación, y es sobre eso que trabaja esta clase.
 *
 * Web Bluetooth tampoco existe en iOS/iPadOS (ningún navegador) ni en
 * Firefox ni en Safari de escritorio.
 */

/** Perfiles GATT conocidos de adaptadores ELM327 BLE. */
interface GattProfile {
  name: string;
  service: string;
  /** Si write y notify coinciden, la característica es bidireccional. */
  write: string;
  notify: string;
}

const KNOWN_PROFILES: GattProfile[] = [
  {
    name: 'FFF0 (Vgate iCar Pro, Veepeak BLE y clones)',
    service: '0000fff0-0000-1000-8000-00805f9b34fb',
    write: '0000fff2-0000-1000-8000-00805f9b34fb',
    notify: '0000fff1-0000-1000-8000-00805f9b34fb',
  },
  {
    name: 'FFE0 (clones BLE con característica única)',
    service: '0000ffe0-0000-1000-8000-00805f9b34fb',
    write: '0000ffe1-0000-1000-8000-00805f9b34fb',
    notify: '0000ffe1-0000-1000-8000-00805f9b34fb',
  },
  {
    name: 'E7810A71 (LELink y derivados)',
    service: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    write: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
    notify: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f',
  },
  {
    name: 'Nordic UART (algunos adaptadores DIY)',
    service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    write: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
    notify: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
  },
];

/** BLE limita cada escritura al MTU negociado; 20 bytes es el mínimo seguro. */
const BLE_CHUNK = 20;

type BluetoothLike = {
  requestDevice(options: unknown): Promise<BluetoothDeviceLike>;
  getAvailability?(): Promise<boolean>;
};

type BluetoothDeviceLike = {
  id: string;
  name?: string;
  gatt?: {
    connected: boolean;
    connect(): Promise<GattServerLike>;
    disconnect(): void;
  };
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
};

type GattServerLike = {
  getPrimaryService(uuid: string): Promise<GattServiceLike>;
};

type GattServiceLike = {
  getCharacteristic(uuid: string): Promise<GattCharacteristicLike>;
};

type GattCharacteristicLike = {
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
  writeValue(value: BufferSource): Promise<void>;
  startNotifications(): Promise<GattCharacteristicLike>;
  stopNotifications(): Promise<GattCharacteristicLike>;
  addEventListener(type: string, fn: (ev: Event) => void): void;
  removeEventListener(type: string, fn: (ev: Event) => void): void;
};

export class WebBluetoothTransport implements Transport {
  readonly kind = 'webbluetooth' as const;

  private _state: TransportState = 'closed';
  private _info: TransportInfo | null = null;
  private device: BluetoothDeviceLike | null = null;
  private writeChar: GattCharacteristicLike | null = null;
  private notifyChar: GattCharacteristicLike | null = null;
  private dataListeners = new Set<(chunk: Uint8Array) => void>();
  private closeListeners = new Set<(err: TransportError | null) => void>();
  private intentionalClose = false;
  private onGattDisconnect = (): void => {
    if (this.intentionalClose) return;
    this._state = 'error';
    for (const fn of this.closeListeners) {
      fn(new TransportError('disconnected', 'Se perdió el enlace Bluetooth con el adaptador'));
    }
  };
  private onCharValue = (ev: Event): void => {
    const target = ev.target as { value?: DataView } | null;
    const view = target?.value;
    if (!view) return;
    const chunk = new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
    if (chunk.byteLength > 0) {
      for (const fn of this.dataListeners) fn(chunk);
    }
  };

  get state(): TransportState {
    return this._state;
  }

  get info(): TransportInfo | null {
    return this._info;
  }

  static get bluetooth(): BluetoothLike | null {
    const nav = navigator as unknown as { bluetooth?: BluetoothLike };
    return nav.bluetooth ?? null;
  }

  async open(): Promise<void> {
    if (this._state === 'open' || this._state === 'opening') {
      throw new TransportError('already-open', 'El enlace Bluetooth ya está abierto');
    }
    const bluetooth = WebBluetoothTransport.bluetooth;
    if (!bluetooth) {
      throw new TransportError(
        'not-supported',
        'Este navegador no expone Web Bluetooth',
        'navigator.bluetooth no existe. No está disponible en iOS, Safari ni Firefox.',
      );
    }

    this._state = 'opening';
    this.intentionalClose = false;
    try {
      const device = await bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: KNOWN_PROFILES.map((p) => p.service),
      });
      this.device = device;

      if (!device.gatt) {
        throw new TransportError(
          'open-failed',
          'El dispositivo elegido no expone GATT',
          'Probablemente sea un adaptador Bluetooth Classic (SPP), inalcanzable desde el navegador.',
        );
      }
      device.addEventListener('gattserverdisconnected', this.onGattDisconnect);
      const server = await device.gatt.connect();

      const resolved = await this.resolveProfile(server);
      this.writeChar = resolved.write;
      this.notifyChar = resolved.notify;

      await this.notifyChar.startNotifications();
      this.notifyChar.addEventListener('characteristicvaluechanged', this.onCharValue);

      this._info = {
        kind: this.kind,
        name: device.name ?? 'Adaptador BLE',
        link: resolved.profile.name,
      };
      this._state = 'open';
    } catch (err) {
      this._state = 'error';
      await this.teardown();
      throw wrapOpenError(err);
    }
  }

  /** Prueba los perfiles conocidos en orden y usa el primero que exista. */
  private async resolveProfile(server: GattServerLike): Promise<{
    profile: GattProfile;
    write: GattCharacteristicLike;
    notify: GattCharacteristicLike;
  }> {
    const tried: string[] = [];
    for (const profile of KNOWN_PROFILES) {
      try {
        const service = await server.getPrimaryService(profile.service);
        const write = await service.getCharacteristic(profile.write);
        const notify =
          profile.notify === profile.write
            ? write
            : await service.getCharacteristic(profile.notify);
        return { profile, write, notify };
      } catch {
        tried.push(profile.service.slice(4, 8).toUpperCase());
      }
    }
    throw new TransportError(
      'open-failed',
      'El adaptador no expone un perfil ELM327 BLE reconocido',
      `Servicios GATT probados sin éxito: ${tried.join(', ')}. ` +
        'Si el adaptador es Bluetooth Classic (SPP) no puede usarse desde el navegador.',
    );
  }

  async write(data: Uint8Array): Promise<void> {
    const char = this.writeChar;
    if (this._state !== 'open' || !char) {
      throw new TransportError('not-open', 'El enlace Bluetooth no está abierto');
    }
    try {
      for (let i = 0; i < data.byteLength; i += BLE_CHUNK) {
        const slice = data.slice(i, i + BLE_CHUNK);
        if (char.writeValueWithoutResponse) {
          await char.writeValueWithoutResponse(slice);
        } else {
          await char.writeValue(slice);
        }
      }
    } catch (err) {
      throw new TransportError(
        'write-failed',
        'No se pudo enviar el comando por Bluetooth',
        messageOf(err),
      );
    }
  }

  async close(): Promise<void> {
    this.intentionalClose = true;
    this._state = 'closing';
    await this.teardown();
    this._state = 'closed';
    this._info = null;
  }

  private async teardown(): Promise<void> {
    if (this.notifyChar) {
      this.notifyChar.removeEventListener('characteristicvaluechanged', this.onCharValue);
      try {
        await this.notifyChar.stopNotifications();
      } catch { /* el dispositivo ya pudo desconectarse */ }
    }
    if (this.device) {
      this.device.removeEventListener('gattserverdisconnected', this.onGattDisconnect);
      try {
        if (this.device.gatt?.connected) this.device.gatt.disconnect();
      } catch { /* ya desconectado */ }
    }
    this.notifyChar = null;
    this.writeChar = null;
    this.device = null;
  }

  onData(listener: (chunk: Uint8Array) => void): () => void {
    this.dataListeners.add(listener);
    return () => this.dataListeners.delete(listener);
  }

  onClose(listener: (err: TransportError | null) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }
}

function wrapOpenError(err: unknown): TransportError {
  if (err instanceof TransportError) return err;
  const msg = messageOf(err);
  const name = (err as { name?: string } | null)?.name;
  if (name === 'NotFoundError') {
    return new TransportError(
      'cancelled-by-user',
      'No se seleccionó ningún adaptador',
      msg,
    );
  }
  if (name === 'SecurityError') {
    return new TransportError(
      'not-supported',
      'El navegador bloqueó el acceso a Bluetooth',
      'Web Bluetooth exige HTTPS o localhost y un gesto del usuario.',
    );
  }
  if (name === 'NetworkError') {
    return new TransportError(
      'open-failed',
      'El adaptador rechazó la conexión',
      'Suele pasar si el adaptador sigue conectado a otra aplicación o al sistema.',
    );
  }
  return new TransportError('open-failed', 'No se pudo conectar el adaptador BLE', msg);
}

const messageOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);
