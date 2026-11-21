/* Cache local de la tienda para funcionar sin internet.
   Guarda los productos (incluidas las fotos como Blob) en IndexedDB. */
(function (global) {
  "use strict";

  const DB_NAME = "reymero-store-offline";
  const DB_VERSION = 1;
  const STORE = "products";
  const LAST_SYNC_KEY = "reymero-last-sync";

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("No se pudo abrir la base offline"));
    });
  }

  function txDone(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("Error en la transacción offline"));
      tx.onabort = () => reject(tx.error || new Error("Transacción offline abortada"));
    });
  }

  async function readAll() {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } finally { db.close(); }
  }

  async function readOne(id) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } finally { db.close(); }
  }

  function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    return Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
          const i = next++;
          try { results[i] = await fn(items[i], i); }
          catch (e) { results[i] = items[i]; }
        }
      })
    ).then(() => results);
  }

  function hashUrl(url) {
    let h = 5381;
    const s = String(url || "");
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  }

  function mimeFromUrl(url) {
    const clean = String(url || "").split("?")[0].toLowerCase();
    if (clean.endsWith(".png")) return "image/png";
    if (clean.endsWith(".webp")) return "image/webp";
    if (clean.endsWith(".gif")) return "image/gif";
    return "image/jpeg";
  }

  function base64ToBlob(data, mime) {
    const bin = atob(data || "");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || "application/octet-stream" });
  }

  function nativeBlob(url) {
    const FS = global.Capacitor && global.Capacitor.Plugins && global.Capacitor.Plugins.Filesystem;
    if (!FS || !FS.downloadFile || !FS.readFile) return Promise.reject(new Error("Filesystem no disponible"));
    const path = "store-" + hashUrl(url) + ".img";
    const dir = "CACHE";
    return FS.downloadFile({ url, path, directory: dir })
      .then((res) => FS.readFile({ path: (res && res.path) || path, directory: dir, encoding: "base64" })
        .then((file) => {
          if (!file || !file.data) throw new Error("Archivo de imagen vacío");
          const blob = base64ToBlob(file.data, mimeFromUrl(url));
          try { FS.deleteFile({ path: (res && res.path) || path, directory: dir }).catch(() => {}); } catch (e) {}
          return blob;
        }));
  }

  async function blobFromUrl(url) {
    // En la APK usamos la descarga nativa: evita el CORS de MakerWorld.
    try { return await nativeBlob(url); }
    catch (e) { /* en la web caemos al fetch normal */ }

    // MakerWorld no envía headers CORS: en la web las fotos se muestran con <img>,
    // pero no se pueden guardar con fetch. Evitamos el error en consola.
    try {
      const u = new URL(url, location.href);
      if (!global.Capacitor && /makerworld\.bblmw\.com$/i.test(u.hostname)) return null;
    } catch (e) {}

    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) throw new Error("No se pudo descargar la imagen");
    return await res.blob();
  }

  /* Reutiliza el blob guardado si la foto no cambió. Si cambió o no hay cache,
     la descarga. image_cached_url indica qué URL corresponde al blob. */
  async function enrich(p, existing) {
    const copy = Object.assign({}, p);
    if (!p || !p.image_url) return copy;

    const samePhoto = existing && existing.image_blob &&
      ((existing.image_cached_url || existing.image_url) === p.image_url);
    if (samePhoto) {
      copy.image_blob = existing.image_blob;
      copy.image_cached_url = p.image_url;
      return copy;
    }

    try {
      const blob = await blobFromUrl(p.image_url);
      if (blob) {
        copy.image_blob = blob;
        copy.image_cached_url = p.image_url;
      }
    } catch (e) { /* sin foto offline, se usa la URL si hay internet */ }
    return copy;
  }

  async function writeAll(rows) {
    const list = Array.isArray(rows) ? rows : [];

    // Leemos lo ya guardado para no volver a bajar las fotos que no cambiaron.
    let previous = [];
    try { previous = await readAll(); } catch (e) {}
    const byId = Object.create(null);
    previous.forEach((p) => { if (p && p.id) byId[p.id] = p; });

    const enriched = await mapLimit(list, 8, (p) => enrich(p, p && byId[p.id]));

    const db = await open();
    try {
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      const keep = Object.create(null);
      enriched.forEach((p) => {
        if (!p || !p.id) return;
        keep[p.id] = true;
        st.put(p);
      });
      // Borramos solo los productos que ya no están publicados.
      previous.forEach((p) => { if (p && p.id && !keep[p.id]) st.delete(p.id); });
      await txDone(tx);
    } finally { db.close(); }
    return enriched;
  }

  async function upsert(row) {
    if (!row || !row.id) return row;
    let existing = null;
    try { existing = await readOne(row.id); } catch (e) {}
    const stored = await enrich(row, existing);
    const db = await open();
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(stored);
      await txDone(tx);
    } finally { db.close(); }
    return stored;
  }

  /* Devuelve copias listas para renderizar: crea object URLs para las fotos guardadas. */
  function withObjectUrls(rows) {
    return (rows || []).map((p) => {
      const copy = Object.assign({}, p);
      if (p && p.image_blob) {
        try { copy.local_image_url = URL.createObjectURL(p.image_blob); }
        catch (e) {}
        delete copy.image_blob;
      }
      return copy;
    });
  }

  function revokeObjectUrls(rows) {
    (rows || []).forEach((p) => {
      if (p && p.local_image_url) {
        try { URL.revokeObjectURL(p.local_image_url); } catch (e) {}
      }
    });
  }

  function imageOf(p) {
    return (p && (p.local_image_url || p.image_url)) || "";
  }

  function lastSync() {
    try { return Number(localStorage.getItem(LAST_SYNC_KEY)) || 0; }
    catch (e) { return 0; }
  }
  function setLastSync(ts) {
    try { localStorage.setItem(LAST_SYNC_KEY, String(ts || Date.now())); }
    catch (e) {}
  }
  function clearSync() {
    try { localStorage.removeItem(LAST_SYNC_KEY); } catch (e) {}
  }

  global.StoreOffline = {
    open, readAll, readOne, writeAll, upsert,
    withObjectUrls, revokeObjectUrls, imageOf,
    lastSync, setLastSync, clearSync
  };
})(window);
