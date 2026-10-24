// 이 브라우저 안(IndexedDB)에만 둔다: 넣은 CSV(files), 설정·즐겨찾기·별칭·저장한 보기(kv). 어디로도 보내지 않는다
const DB = "journal-metrics";

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("files");
      req.result.createObjectStore("kv");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = null;
const db = () => (dbPromise ??= open());

function run(store, mode, fn) {
  return db().then((d) => new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const result = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(result && "result" in result ? result.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

/// 넣은 CSV 전부: Map(이름 → 글)
export async function readFiles() {
  const d = await db();
  return new Promise((resolve, reject) => {
    const out = new Map();
    const req = d.transaction("files").objectStore("files").openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(out);
      out.set(c.key, c.value);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export const putFile = (path, text) => run("files", "readwrite", (s) => s.put(text, path));
export const clearFiles = () => run("files", "readwrite", (s) => s.clear());
export const getValue = (key) => run("kv", "readonly", (s) => s.get(key));
export const setValue = (key, value) => run("kv", "readwrite", (s) => s.put(value, key));
export const clearValues = () => run("kv", "readwrite", (s) => s.clear());
