// Úložiště v zařízení (IndexedDB).
// Obchody: songs (písně, klíč id), audio (zvukové soubory jako Blob, klíč = id zvuku), meta (nastavení aplikace),
// progress (pokrok učení, klíč „idPísně|klíčVerše“, viz learn.js).
const DB_NAME = 'alaw';
const DB_VERSION = 2;
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('audio')) db.createObjectStore('audio');
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('progress')) db.createObjectStore('progress', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// Nahrávky uložené v tomto běhu aplikace, ke kterým se ještě neuložila píseň (nahrávka se ukládá dřív než píseň).
// Synchronizace je nesmí smazat jako nepoužívané. store.saveSong je odsud odebere.
export const freshAudio = new Set();

export const db = {
  allSongs: () => tx('songs', 'readonly', s => s.getAll()).then(list => list || []),
  getSong: id => tx('songs', 'readonly', s => s.get(id)),
  putSong: song => tx('songs', 'readwrite', s => s.put(song)),
  deleteSong: id => tx('songs', 'readwrite', s => s.delete(id)),
  getAudio: key => tx('audio', 'readonly', s => s.get(key)),
  putAudio: (key, blob) => { freshAudio.add(key); return tx('audio', 'readwrite', s => s.put(blob, key)); },
  deleteAudio: key => tx('audio', 'readwrite', s => s.delete(key)),
  audioKeys: () => tx('audio', 'readonly', s => s.getAllKeys()).then(k => k || []),
  getMeta: key => tx('meta', 'readonly', s => s.get(key)),
  putMeta: (key, value) => tx('meta', 'readwrite', s => s.put(value, key)),
  allProgress: () => tx('progress', 'readonly', s => s.getAll()).then(list => list || []),
  putProgress: rec => tx('progress', 'readwrite', s => s.put(rec)),
  putProgressMany: recs => tx('progress', 'readwrite', s => { for (const r of recs) s.put(r); }),
  deleteProgress: ids => tx('progress', 'readwrite', s => { for (const id of ids) s.delete(id); }),
};

// Požádá prohlížeč, aby data nemazal při nedostatku místa (Android Chrome u nainstalované PWA obvykle vyhoví).
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch { /* nevadí */ }
}

export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
  } catch { /* nevadí */ }
  return null;
}
