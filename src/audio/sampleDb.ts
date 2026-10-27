// IndexedDB storage for audio files the user imports.
const DB_NAME = 'drumduino';
const STORE = 'samples';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      })
  );
}

export function putSample(id: string, data: ArrayBuffer): Promise<unknown> {
  return tx('readwrite', (s) => s.put({ id, data }));
}

export async function getSample(id: string): Promise<ArrayBuffer | null> {
  const row = await tx<{ id: string; data: ArrayBuffer } | undefined>('readonly', (s) => s.get(id));
  return row ? row.data : null;
}

export function deleteSample(id: string): Promise<unknown> {
  return tx('readwrite', (s) => s.delete(id));
}
