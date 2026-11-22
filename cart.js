/* Carrito local de Reymero 3D.
   Guarda solo id, cantidad, nombre y precio. Las fotos se resuelven desde el catálogo/IndexedDB.
   Expone window.ReymeroCart y emite "reymero:cart-change". */
(function (global) {
  "use strict";

  const CFG = global.ReymeroConfig || {};
  const KEY = CFG.CART_KEY || "reymero-cart-v1";
  const EVENT = "reymero:cart-change";
  const MAX_QTY = 999;
  const listeners = [];

  function clampQty(value) {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n)) return 1;
    return Math.min(MAX_QTY, Math.max(1, n));
  }

  function normalize(raw) {
    if (!raw || typeof raw !== "object") return null;
    const id = String(raw.id == null ? "" : raw.id).trim();
    if (!id) return null;
    const price = Number(raw.price);
    return {
      id: id,
      qty: clampQty(raw.qty),
      name: String(raw.name == null ? "Producto" : raw.name).slice(0, 300),
      price: Number.isFinite(price) && price >= 0 ? price : 0,
      note: String(raw.note == null ? "" : raw.note).slice(0, 1000)
    };
  }

  function load() {
    try {
      const raw = global.localStorage.getItem(KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const seen = Object.create(null);
      const out = [];
      for (const entry of parsed) {
        const item = normalize(entry);
        if (!item || seen[item.id]) continue;
        seen[item.id] = true;
        out.push(item);
      }
      return out;
    } catch (e) {
      return [];
    }
  }

  let items = load();

  function snapshot() {
    return items.map(function (i) {
      return { id: i.id, qty: i.qty, name: i.name, price: i.price, note: i.note };
    });
  }

  function emit() {
    const detail = { items: snapshot(), count: count(), subtotal: subtotal() };
    const event = new CustomEvent(EVENT, { detail: detail });
    global.document.dispatchEvent(event);
    for (const fn of listeners.slice()) {
      try { fn(detail); } catch (e) { console.warn("Cart listener error", e); }
    }
  }

  function persist() {
    try { global.localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) {}
    emit();
  }

  function find(id) {
    const key = String(id == null ? "" : id);
    return items.find(function (i) { return i.id === key; }) || null;
  }

  function count() {
    return items.reduce(function (sum, i) { return sum + i.qty; }, 0);
  }

  function subtotal() {
    return items.reduce(function (sum, i) { return sum + (i.price * i.qty); }, 0);
  }

  function add(product, qty) {
    if (!product) return false;
    const id = String(product.id == null ? "" : product.id).trim();
    if (!id || product.in_stock === false) return false;
    const amount = clampQty(qty == null ? 1 : qty);
    const price = Number(product.price);
    const existing = find(id);
    if (existing) {
      existing.qty = Math.min(MAX_QTY, existing.qty + amount);
      existing.name = String(product.name == null ? existing.name : product.name).slice(0, 300);
      if (Number.isFinite(price) && price >= 0) existing.price = price;
    } else {
      items.push({
        id: id,
        qty: amount,
        name: String(product.name == null ? "Producto" : product.name).slice(0, 300),
        price: Number.isFinite(price) && price >= 0 ? price : 0,
        note: ""
      });
    }
    persist();
    return true;
  }

  function setQty(id, qty) {
    const item = find(id);
    if (!item) return false;
    const next = clampQty(qty);
    if (next === item.qty) return true;
    item.qty = next;
    persist();
    return true;
  }

  function remove(id) {
    const next = items.filter(function (i) { return i.id !== String(id); });
    if (next.length === items.length) return false;
    items = next;
    persist();
    return true;
  }

  /* Actualiza nombre y precio desde datos ya verificados de Supabase.
     No cambia cantidades ni agrega productos nuevos. */
  function sync(products) {
    let changed = false;
    (products || []).forEach(function (p) {
      if (!p) return;
      const item = find(p.id);
      if (!item) return;
      const nextName = String(p.name == null ? item.name : p.name).slice(0, 300);
      const nextPrice = Number(p.price);
      if (item.name !== nextName) { item.name = nextName; changed = true; }
      if (Number.isFinite(nextPrice) && nextPrice >= 0 && item.price !== nextPrice) {
        item.price = nextPrice;
        changed = true;
      }
    });
    if (changed) persist();
    return changed;
  }

  function setNote(id, note) {
    const item = find(id);
    if (!item) return false;
    const next = String(note == null ? "" : note).slice(0, 1000);
    if (item.note === next) return true;
    item.note = next;
    persist();
    return true;
  }

  function clear() {
    if (!items.length) return false;
    items = [];
    persist();
    return true;
  }

  function subscribe(fn) {
    if (typeof fn !== "function") return function () {};
    listeners.push(fn);
    return function () {
      const idx = listeners.indexOf(fn);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }

  global.ReymeroCart = Object.freeze({
    items: snapshot,
    add: add,
    setQty: setQty,
    setNote: setNote,
    sync: sync,
    remove: remove,
    clear: clear,
    count: count,
    subtotal: subtotal,
    has: function (id) { return !!find(id); },
    subscribe: subscribe,
    EVENT: EVENT
  });
})(window);
