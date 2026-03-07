const DB_NAME = 'arcvision-cache';
const DB_VERSION = 2; // Bumped: V1→V2 data format change (Number fields instead of BigInt)
const STORE_NAME = 'market-logs';

let dbInstance = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (dbInstance) {
      resolve(dbInstance);
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      dbInstance = request.result;
      resolve(dbInstance);
    };
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      // Delete old store if it exists — data format is incompatible
      if (db.objectStoreNames.contains(STORE_NAME)) {
        db.deleteObjectStore(STORE_NAME);
      }
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'marketId' });
      store.createIndex('lastBlock', 'lastBlock', { unique: false });
    };
  });
}

/**
 * Get cached logs and lastBlock for a market.
 * Returns { marketId, logs, lastBlock, timestamp } or null.
 * No TTL — incremental fetching handles freshness.
 */
export async function getCachedLogs(marketId) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(String(marketId));
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error reading from IndexedDB:', error);
    return null;
  }
}

export async function saveLogs(marketId, logs, lastBlock) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const data = {
        marketId: String(marketId),
        logs: logs || [],
        lastBlock: lastBlock || 0,
        timestamp: Date.now()
      };
      const request = store.put(data);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error saving to IndexedDB:', error);
    return false;
  }
}

export async function clearCache(marketId) {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(String(marketId));
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error('Error clearing cache:', error);
    return false;
  }
}
