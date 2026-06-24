/**
 * Offline-first data management with optimistic updates and sync queue.
 * Provides native mobile-like offline capabilities for the PWA.
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface OfflineState {
  isOnline: boolean;
  pendingOps: number;
  lastSyncAt: number | null;
  syncStatus: 'idle' | 'syncing' | 'error';
}

interface QueuedOperation {
  id: string;
  type: 'create' | 'update' | 'delete';
  endpoint: string;
  payload: unknown;
  timestamp: number;
  retries: number;
  maxRetries: number;
}

const DB_NAME = 'paymentswitch-offline';
const DB_VERSION = 2;
const STORE_NAME = 'operations';
const CACHE_STORE = 'api-cache';

export function useOfflineFirst() {
  const [state, setState] = useState<OfflineState>({
    isOnline: navigator.onLine,
    pendingOps: 0,
    lastSyncAt: null,
    syncStatus: 'idle',
  });
  const dbRef = useRef<IDBDatabase | null>(null);
  const syncingRef = useRef(false);

  useEffect(() => {
    const handleOnline = () => {
      setState(s => ({ ...s, isOnline: true }));
      syncPendingOperations();
    };
    const handleOffline = () => setState(s => ({ ...s, isOnline: false }));

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    openDB().then(db => {
      dbRef.current = db;
      countPending();
    });

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('timestamp', 'timestamp');
          store.createIndex('type', 'type');
        }
        if (!db.objectStoreNames.contains(CACHE_STORE)) {
          db.createObjectStore(CACHE_STORE, { keyPath: 'url' });
        }
      };
    });
  };

  const countPending = async () => {
    const db = dbRef.current;
    if (!db) return;
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const count = store.count();
    count.onsuccess = () => setState(s => ({ ...s, pendingOps: count.result }));
  };

  // Queue an operation for offline sync
  const queueOperation = useCallback(async (op: Omit<QueuedOperation, 'id' | 'timestamp' | 'retries' | 'maxRetries'>) => {
    const db = dbRef.current;
    if (!db) return;

    const operation: QueuedOperation = {
      ...op,
      id: `op-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      timestamp: Date.now(),
      retries: 0,
      maxRetries: 5,
    };

    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(operation);
    await new Promise<void>((resolve) => { tx.oncomplete = () => resolve(); });
    countPending();

    // If online, sync immediately
    if (navigator.onLine) {
      syncPendingOperations();
    }
  }, []);

  // Cache API response for offline access
  const cacheResponse = useCallback(async (url: string, data: unknown) => {
    const db = dbRef.current;
    if (!db) return;
    const tx = db.transaction(CACHE_STORE, 'readwrite');
    tx.objectStore(CACHE_STORE).put({ url, data, cachedAt: Date.now() });
  }, []);

  // Get cached response
  const getCached = useCallback(async (url: string): Promise<unknown | null> => {
    const db = dbRef.current;
    if (!db) return null;
    return new Promise((resolve) => {
      const tx = db.transaction(CACHE_STORE, 'readonly');
      const request = tx.objectStore(CACHE_STORE).get(url);
      request.onsuccess = () => resolve(request.result?.data ?? null);
      request.onerror = () => resolve(null);
    });
  }, []);

  // Sync all pending operations
  const syncPendingOperations = async () => {
    if (syncingRef.current || !navigator.onLine) return;
    syncingRef.current = true;
    setState(s => ({ ...s, syncStatus: 'syncing' }));

    const db = dbRef.current;
    if (!db) {
      syncingRef.current = false;
      return;
    }

    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('timestamp');
    const allOps: QueuedOperation[] = [];

    const cursor = index.openCursor();
    cursor.onsuccess = async (event) => {
      const c = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (c) {
        allOps.push(c.value);
        c.continue();
      } else {
        // Process all queued operations in order
        for (const op of allOps) {
          try {
            const response = await fetch(op.endpoint, {
              method: op.type === 'delete' ? 'DELETE' : op.type === 'update' ? 'PUT' : 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: op.payload ? JSON.stringify(op.payload) : undefined,
            });
            if (response.ok) {
              const delTx = db.transaction(STORE_NAME, 'readwrite');
              delTx.objectStore(STORE_NAME).delete(op.id);
            } else if (op.retries < op.maxRetries) {
              const retryTx = db.transaction(STORE_NAME, 'readwrite');
              retryTx.objectStore(STORE_NAME).put({ ...op, retries: op.retries + 1 });
            }
          } catch {
            // Network error — will retry next sync
          }
        }

        countPending();
        setState(s => ({
          ...s,
          syncStatus: 'idle',
          lastSyncAt: Date.now(),
        }));
        syncingRef.current = false;
      }
    };
  };

  return {
    ...state,
    queueOperation,
    cacheResponse,
    getCached,
    syncPendingOperations,
  };
}
