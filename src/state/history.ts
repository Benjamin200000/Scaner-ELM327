/**
 * Historial de sesiones en IndexedDB.
 *
 * Local al dispositivo a propósito: la app funciona sin backend y sin
 * conexión, que es lo que hace falta en un taller con mala señal. Si más
 * adelante se quiere sincronizar entre equipos, este módulo es el único
 * punto que habría que cambiar.
 */

export interface HistoryEntry {
  id?: number;
  at: number;
  vehicle: {
    make: string | null;
    model: string | null;
    year: number | null;
    vin: string | null;
    odometerKm: number | null;
  };
  ecu: {
    name: string | null;
    calibrationId: string | null;
    protocol: string | null;
  };
  dtcs: { code: string; kind: string }[];
  /** Instantánea de los parámetros al cerrar la sesión. */
  values: Record<string, number | null>;
}

const DB_NAME = 'scaner-elm327';
const DB_VERSION = 1;
const STORE = 'sessions';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no está disponible en este navegador'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('at', 'at');
        store.createIndex('vin', 'vehicle.vin');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('No se pudo abrir la base local'));
  });
}

const tx = async <T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> => {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const req = fn(transaction.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Fallo en la base local'));
    transaction.oncomplete = () => db.close();
  });
};

export const History = {
  save: (entry: HistoryEntry): Promise<IDBValidKey> =>
    tx('readwrite', (s) => s.add(entry)),

  /** Más recientes primero. */
  async list(limit = 50): Promise<HistoryEntry[]> {
    const all = await tx<HistoryEntry[]>('readonly', (s) => s.getAll());
    return all.sort((a, b) => b.at - a.at).slice(0, limit);
  },

  get: (id: number): Promise<HistoryEntry | undefined> =>
    tx('readonly', (s) => s.get(id)),

  remove: (id: number): Promise<undefined> =>
    tx('readwrite', (s) => s.delete(id)),
};
