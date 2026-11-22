/* Checkout de Reymero 3D (Etapa 2).
   Revalida carrito contra Supabase, recoge datos de entrega/facturación,
   crea el pedido por RPC server-side y emite reymero:checkout-validated con datos persistidos. */
(function () {
  "use strict";

  const STYLE_ID = "rmCheckoutStyles";
  const MODAL_ID = "rmCheckoutModal";
  const BACKDROP_ID = "rmCheckoutBackdrop";
  const NOTE_KEY = "reymero-checkout-note-v1";
  const DRAFT_KEY = "reymero-checkout-draft-v1";
  const IDEM_KEY = "reymero-checkout-idem-v1";
  const PENDING_KEY = "reymero-pending-payment-v1";

  let modal = null, backdrop = null, statusEl = null, linesEl = null, noteEl = null;
  let unitsEl = null, totalEl = null, confirmBtn = null, backBtn = null, closeBtn = null;
  let formEl = null, lastFocus = null, previousOverflow = "";
  let sbClient = null, fetcher = fetchRows;
  let syncingCart = false;

  const state = { result: null, error: "", validating: false, submitting: false, generalNote: "" };

  const CSS = `
    .rm-checkout-backdrop { position:fixed; inset:0; z-index:70; background:rgba(28,25,23,.55); opacity:0; pointer-events:none; transition:opacity .2s; }
    .rm-checkout-backdrop.open { opacity:1; pointer-events:auto; }
    .rm-checkout { position:fixed; z-index:71; left:50%; top:50%; transform:translate(-50%,-48%) scale(.98); width:min(720px,calc(100% - 1.5rem)); max-height:min(92vh,900px); display:flex; flex-direction:column; background:var(--surface); color:var(--text); border:1px solid var(--border); border-radius:14px; box-shadow:var(--shadow-lg); opacity:0; pointer-events:none; transition:opacity .2s,transform .2s; }
    .rm-checkout.open { opacity:1; pointer-events:auto; transform:translate(-50%,-50%) scale(1); }
    .rm-checkout-head { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:1rem 1.25rem; border-bottom:1px solid var(--border); }
    .rm-checkout-head h2 { margin:0; font-family:"Fraunces","Segoe UI",serif; font-size:1.25rem; }
    .rm-checkout-close { width:2rem; height:2rem; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--text); cursor:pointer; font-size:1.1rem; line-height:1; }
    .rm-checkout-body { overflow:auto; padding:1rem 1.25rem; }
    .rm-checkout-status { margin:0 0 .9rem; padding:.7rem .85rem; border-radius:7px; font-size:.78rem; line-height:1.45; font-family:"JetBrains Mono",monospace; background:var(--surface-2); color:var(--muted); }
    .rm-checkout-status.ok { color:var(--green); background:var(--accent-soft); }
    .rm-checkout-status.pending { color:var(--muted); }
    .rm-checkout-status.error { color:var(--accent); background:var(--accent-soft); }
    .rm-checkout-line { padding:.75rem 0; border-bottom:1px solid var(--border); }
    .rm-checkout-line.invalid { padding-left:.75rem; border-left:3px solid var(--accent); }
    .rm-checkout-line-top { display:flex; justify-content:space-between; gap:.75rem; }
    .rm-checkout-line-name { font-weight:700; font-size:.88rem; line-height:1.35; }
    .rm-checkout-line-sub { font-weight:800; color:var(--accent); font-size:.88rem; white-space:nowrap; }
    .rm-checkout-line-meta { margin-top:.2rem; font-size:.72rem; color:var(--muted); font-family:"JetBrains Mono",monospace; }
    .rm-checkout-line-notice { margin-top:.35rem; font-size:.72rem; color:var(--green); }
    .rm-checkout-line-error { margin-top:.35rem; font-size:.72rem; color:var(--accent); font-weight:700; }
    .rm-checkout-remove { margin-top:.45rem; background:none; border:0; padding:0; color:var(--accent); font-size:.72rem; text-decoration:underline; cursor:pointer; font-family:inherit; }
    .rm-checkout-note, .rm-ck-input, .rm-ck-select, .rm-ck-textarea { width:100%; padding:.6rem .7rem; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--text); font-family:inherit; font-size:.85rem; }
    .rm-checkout-note { margin-top:.45rem; font-size:.8rem; }
    .rm-ck-textarea { min-height:72px; resize:vertical; line-height:1.45; }
    .rm-checkout-note:focus, .rm-ck-input:focus, .rm-ck-select:focus, .rm-ck-textarea:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px rgba(185,28,28,.12); }
    .rm-ck-section { margin-top:1rem; padding-top:1rem; border-top:1px solid var(--border); }
    .rm-ck-title { margin:0 0 .75rem; font-size:.72rem; font-weight:800; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
    .rm-ck-grid { display:grid; grid-template-columns:1fr 1fr; gap:.75rem; }
    .rm-ck-field { display:flex; flex-direction:column; gap:.3rem; }
    .rm-ck-field.full { grid-column:1/-1; }
    .rm-ck-label { font-size:.72rem; font-weight:700; color:var(--muted); }
    .rm-ck-label .req { color:var(--accent); }
    .rm-ck-radio-row { display:flex; gap:1rem; flex-wrap:wrap; }
    .rm-ck-radio { display:flex; gap:.45rem; align-items:center; font-size:.85rem; }
    .rm-ck-check { display:flex; gap:.5rem; align-items:flex-start; font-size:.82rem; color:var(--text); }
    .rm-ck-check input { margin-top:.15rem; }
    .rm-ck-hint { font-size:.72rem; color:var(--muted); line-height:1.4; }
    .rm-ck-billing { margin-top:.75rem; padding:.85rem; background:var(--surface-2); border-radius:8px; display:none; }
    .rm-ck-billing.open { display:block; }
    .rm-checkout-foot { border-top:1px solid var(--border); padding:1rem 1.25rem 1.1rem; display:grid; gap:.7rem; }
    .rm-checkout-totals { display:flex; justify-content:space-between; gap:1rem; font-size:.78rem; color:var(--muted); }
    .rm-checkout-totals strong { color:var(--text); font-family:"JetBrains Mono",monospace; }
    .rm-checkout-total { display:flex; justify-content:space-between; align-items:baseline; gap:1rem; font-family:"JetBrains Mono",monospace; font-size:.8rem; color:var(--muted); }
    .rm-checkout-total b { font-size:1.3rem; color:var(--accent); }
    .rm-checkout-actions { display:grid; grid-template-columns:1fr 1fr; gap:.6rem; }
    .rm-checkout-primary { padding:.8rem; border:1.5px solid var(--accent); border-radius:7px; background:var(--accent); color:#fff; font-family:"JetBrains Mono",monospace; font-size:.72rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em; cursor:pointer; }
    .rm-checkout-primary:hover:not(:disabled) { background:var(--accent-dark); border-color:var(--accent-dark); }
    .rm-checkout-primary:disabled { opacity:.5; cursor:default; }
    .rm-checkout-secondary { padding:.8rem; border:1px solid var(--border); border-radius:7px; background:transparent; color:var(--muted); font-family:inherit; font-size:.8rem; cursor:pointer; }
    .rm-checkout-close:focus-visible, .rm-checkout-primary:focus-visible, .rm-checkout-secondary:focus-visible, .rm-checkout-remove:focus-visible, .rm-ck-input:focus-visible, .rm-ck-select:focus-visible, .rm-ck-textarea:focus-visible { outline:3px solid rgba(185,28,28,.35); outline-offset:2px; }
    @media (max-width:640px) { .rm-checkout { width:calc(100% - 1rem); max-height:94vh; } .rm-ck-grid, .rm-checkout-actions { grid-template-columns:1fr; } }
    @media (prefers-reduced-motion:reduce) { .rm-checkout,.rm-checkout-backdrop { transition:none; } }
  `;

  function money(v) { const n = Number(v); return "$ " + (Number.isFinite(n) ? n : 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = String(text); return n; }
  function uid() { return (globalThis.crypto && crypto.randomUUID) ? crypto.randomUUID() : ("ck-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10)); }

  function getClient() {
    if (sbClient) return sbClient;
    const cfg = window.ReymeroConfig || {};
    if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) throw new Error("Supabase no disponible");
    sbClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    return sbClient;
  }

  function fetchRows(ids) {
    const unique = [...new Set((ids || []).map(String))].filter(Boolean);
    if (!unique.length) return Promise.resolve([]);
    return getClient().from("products").select("id,name,price,published,in_stock").in("id", unique).then(function (res) {
      if (res.error) throw res.error;
      return res.data || [];
    });
  }

  function validateRows(items, rows) {
    const byId = Object.create(null);
    (rows || []).forEach(function (r) { if (r && r.id != null) byId[String(r.id)] = r; });
    const lines = (items || []).map(function (item) {
      const row = byId[String(item.id)];
      const price = row == null ? NaN : Number(row.price);
      let reason = "";
      if (!row) reason = "Producto no encontrado en el catálogo actual";
      else if (row.published === false) reason = "Producto no publicado";
      else if (row.in_stock === false) reason = "Sin stock";
      else if (!Number.isFinite(price) || price < 0) reason = "Precio no disponible";
      const available = !reason;
      const oldPrice = Number(item.price) || 0;
      const name = row && row.name ? String(row.name) : String(item.name);
      const finalPrice = available ? price : oldPrice;
      return { id: String(item.id), qty: Number(item.qty) || 1, note: String(item.note || ""), name: name, oldPrice: oldPrice, price: finalPrice, subtotal: finalPrice * (Number(item.qty) || 1), available: available, reason: reason, priceChanged: available && oldPrice !== finalPrice, nameChanged: available && name !== String(item.name) };
    });
    const valid = lines.filter(function (l) { return l.available; });
    return { lines: lines, valid: valid, invalid: lines.filter(function (l) { return !l.available; }), count: valid.reduce(function (s, l) { return s + l.qty; }, 0), subtotal: valid.reduce(function (s, l) { return s + l.subtotal; }, 0) };
  }

  async function validate() {
    const items = window.ReymeroCart.items();
    if (!items.length) { state.result = validateRows([], []); state.error = ""; state.validating = false; render(); return state.result; }
    state.validating = true; state.error = ""; render();
    try {
      const rows = await fetcher(items.map(function (i) { return i.id; }));
      const result = validateRows(items, rows);
      if (result.valid.length) {
        syncingCart = true;
        try { window.ReymeroCart.sync(result.valid.map(function (l) { return { id: l.id, name: l.name, price: l.price }; })); }
        finally { syncingCart = false; }
      }
      state.result = result;
    } catch (e) {
      state.result = null;
      state.error = "No se pudo verificar precios y stock con Supabase. Revisá tu conexión e intentá de nuevo.";
      if (window.console) console.warn("No se pudo validar el pedido", e);
    } finally { state.validating = false; render(); }
    return state.result;
  }

  function field(id, label, opts) {
    opts = opts || {};
    const wrap = el("div", "rm-ck-field" + (opts.full ? " full" : ""));
    const lab = el("label", "rm-ck-label");
    lab.setAttribute("for", id);
    lab.appendChild(document.createTextNode(label));
    if (opts.required) { const req = el("span", "req", " *"); lab.appendChild(req); }
    wrap.appendChild(lab);
    let input;
    if (opts.type === "textarea") { input = el("textarea", "rm-ck-textarea"); }
    else if (opts.type === "select") { input = el("select", "rm-ck-select"); (opts.options || []).forEach(function (o) { const op = document.createElement("option"); op.value = o.value; op.textContent = o.label; input.appendChild(op); }); }
    else { input = el("input", "rm-ck-input"); input.type = opts.type || "text"; }
    input.id = id; input.name = id;
    if (opts.maxLength) input.maxLength = opts.maxLength;
    if (opts.autocomplete) input.autocomplete = opts.autocomplete;
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.required) input.required = true;
    wrap.appendChild(input);
    if (opts.hint) wrap.appendChild(el("div", "rm-ck-hint", opts.hint));
    return { wrap: wrap, input: input };
  }

  function getDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function saveDraft(d) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d || {})); } catch (e) {} }
  function getIdem() { try { return sessionStorage.getItem(IDEM_KEY) || ""; } catch (e) { return ""; } }
  function setIdem(v) { try { if (v) sessionStorage.setItem(IDEM_KEY, v); else sessionStorage.removeItem(IDEM_KEY); } catch (e) {} }
  function getPending() { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || "null"); } catch (e) { return null; } }
  function setPending(v) { try { if (v) localStorage.setItem(PENDING_KEY, JSON.stringify(v)); else localStorage.removeItem(PENDING_KEY); } catch (e) {} }
  function clearPending() { setPending(null); setIdem(""); }

  function collectForm() {
    const g = function (id) { const n = document.getElementById(id); return n ? n.value.trim() : ""; };
    const delivery = (document.querySelector('input[name="rmDelivery"]:checked') || {}).value || "shipping";
    const billingRequested = !!(document.getElementById("rmBillingRequested") && document.getElementById("rmBillingRequested").checked);
    return {
      customer_full_name: g("rmName"), customer_phone: g("rmPhone"), customer_email: g("rmEmail"),
      delivery_method: delivery,
      shipping_province: g("rmProvince"), shipping_city: g("rmCity"), shipping_address: g("rmAddress"),
      shipping_postal_code: g("rmPostal"), shipping_references: g("rmRefs"),
      billing_requested: billingRequested,
      billing_full_name: billingRequested ? g("rmBillName") : "",
      billing_tax_id: billingRequested ? g("rmBillTax") : "",
      billing_address: billingRequested ? g("rmBillAddr") : "",
      general_notes: g("rmCheckoutGeneralNote")
    };
  }

  function validateForm(f) {
    if (f.customer_full_name.length < 2) return "Ingresá tu nombre y apellido.";
    if (f.customer_phone.length < 6) return "Ingresá un teléfono de contacto válido.";
    if (f.customer_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.customer_email)) return "El correo electrónico no es válido.";
    if (!["shipping", "pickup_agreed"].includes(f.delivery_method)) return "Seleccioná un método de entrega.";
    if (f.delivery_method === "shipping") {
      if (!f.shipping_province) return "Ingresá la provincia.";
      if (!f.shipping_city) return "Ingresá la localidad.";
      if (!f.shipping_address) return "Ingresá la dirección.";
      if (!f.shipping_postal_code) return "Ingresá el código postal.";
    }
    if (f.billing_requested && !f.billing_full_name) return "Ingresá el nombre para facturación o desmarcá la opción.";
    return "";
  }

  function lineNode(line) {
    const row = el("div", "rm-checkout-line" + (line.available ? "" : " invalid"));
    const top = el("div", "rm-checkout-line-top");
    top.appendChild(el("div", "rm-checkout-line-name", line.name));
    top.appendChild(el("div", "rm-checkout-line-sub", money(line.subtotal)));
    row.appendChild(top);
    row.appendChild(el("div", "rm-checkout-line-meta", line.qty + " × " + money(line.price) + " c/u"));
    if (line.available && (line.priceChanged || line.nameChanged)) {
      const notices = []; if (line.priceChanged) notices.push("Precio actualizado (antes " + money(line.oldPrice) + ")"); if (line.nameChanged) notices.push("Nombre actualizado");
      row.appendChild(el("div", "rm-checkout-line-notice", notices.join(" · ")));
    }
    if (!line.available) {
      row.appendChild(el("div", "rm-checkout-line-error", line.reason));
      const remove = el("button", "rm-checkout-remove", "Quitar del pedido"); remove.type = "button"; remove.dataset.checkoutRemove = line.id; row.appendChild(remove);
    }
    const note = el("input", "rm-checkout-note"); note.type = "text"; note.maxLength = 1000; note.placeholder = "Observación del producto (opcional)"; note.value = line.note; note.dataset.checkoutNote = line.id; note.setAttribute("aria-label", "Observación para " + line.name);
    row.appendChild(note);
    return row;
  }

  function render() {
    if (!statusEl || !linesEl) return;
    let statusClass = "rm-checkout-status";
    if (state.submitting) { statusEl.textContent = "Registrando pedido..."; statusClass += " pending"; }
    else if (state.validating) { statusEl.textContent = "Verificando precios, publicación y stock…"; statusClass += " pending"; }
    else if (state.error) { statusEl.textContent = state.error; statusClass += " error"; }
    else if (state.result && state.result.lines.length) { statusEl.textContent = "Verificado con datos actuales del catálogo." + (state.result.invalid.length ? " Quitá los productos no disponibles para continuar." : ""); statusClass += " ok"; }
    else { statusEl.textContent = "Tu carrito está vacío. Agregá productos desde el catálogo."; }
    statusEl.className = statusClass;
    linesEl.textContent = "";
    if (state.result && state.result.lines.length) state.result.lines.forEach(function (l) { linesEl.appendChild(lineNode(l)); });
    const count = state.result ? state.result.count : window.ReymeroCart.count();
    const subtotal = state.result ? state.result.subtotal : window.ReymeroCart.subtotal();
    if (unitsEl) unitsEl.textContent = count + (count === 1 ? " unidad" : " unidades");
    if (totalEl) totalEl.textContent = money(subtotal);
    if (confirmBtn) {
      confirmBtn.disabled = state.validating || state.submitting || !!state.error || !state.result || !state.result.valid.length || state.result.invalid.length > 0;
      confirmBtn.textContent = state.submitting ? "Registrando..." : (state.validating ? "Verificando..." : "Confirmar pedido");
    }
  }

  function syncDeliveryUI() {
    const delivery = (document.querySelector('input[name="rmDelivery"]:checked') || {}).value || "shipping";
    const shipping = document.getElementById("rmShippingFields");
    if (shipping) shipping.style.display = delivery === "shipping" ? "grid" : "none";
    ["rmProvince", "rmCity", "rmAddress", "rmPostal"].forEach(function (id) {
      const n = document.getElementById(id); if (n) n.required = delivery === "shipping";
    });
  }
  function syncBillingUI() {
    const checked = !!(document.getElementById("rmBillingRequested") && document.getElementById("rmBillingRequested").checked);
    const box = document.getElementById("rmBillingBox");
    if (box) box.classList.toggle("open", checked);
  }

  function fillForm(d) {
    const set = function (id, v) { const n = document.getElementById(id); if (n && v != null) n.value = v; };
    set("rmName", d.customer_full_name || ""); set("rmPhone", d.customer_phone || ""); set("rmEmail", d.customer_email || "");
    const del = d.delivery_method === "pickup_agreed" ? "pickup_agreed" : "shipping";
    const radio = document.querySelector('input[name="rmDelivery"][value="' + del + '"]'); if (radio) radio.checked = true;
    set("rmProvince", d.shipping_province || ""); set("rmCity", d.shipping_city || ""); set("rmAddress", d.shipping_address || "");
    set("rmPostal", d.shipping_postal_code || ""); set("rmRefs", d.shipping_references || "");
    const bill = document.getElementById("rmBillingRequested"); if (bill) bill.checked = !!d.billing_requested;
    set("rmBillName", d.billing_full_name || ""); set("rmBillTax", d.billing_tax_id || ""); set("rmBillAddr", d.billing_address || "");
    if (d.general_notes != null) set("rmCheckoutGeneralNote", d.general_notes);
    syncDeliveryUI(); syncBillingUI();
  }

  async function getResumablePending() {
    const pending = getPending();
    if (!pending || !pending.orderId || !pending.receiptToken) return null;
    try {
      const { data, error } = await getClient().rpc("get_order_payment_status", {
        p_order_id: pending.orderId,
        p_receipt_token: pending.receiptToken
      });
      if (error) throw error;
      if (data && (data.payment_status === "pending_payment" || data.payment_status === "receipt_uploaded")) {
        pending.paymentStatus = data.payment_status;
        pending.status = data.status || pending.status;
        pending.paymentReceiptUploadedAt = data.payment_receipt_uploaded_at || pending.paymentReceiptUploadedAt || null;
        setPending(pending);
        return pending;
      }
      // verified/not_required/cancelled/no longer payable: liberar flujo
      clearPending();
      return null;
    } catch (e) {
      // Si no se puede verificar, reanudar con datos locales para no bloquear el pago
      if (pending.paymentStatus === "pending_payment" || pending.paymentStatus === "receipt_uploaded") return pending;
      return null;
    }
  }

  async function open() {
    if (modal && modal.classList.contains("open")) return;
    if (window.ReymeroCartUI) window.ReymeroCartUI.close();
    lastFocus = document.activeElement; previousOverflow = document.body.style.overflow;

    // Si hay un pedido pendiente de comprobante, reanudar pantalla de pago.
    const pending = await getResumablePending();
    if (pending) {
      window.dispatchEvent(new CustomEvent("reymero:checkout-validated", { detail: pending }));
      return;
    }

    const draft = getDraft();
    // Prefill desde perfil de cuenta cliente si hay sesión y el borrador está vacío
    const cust = window.ReymeroCustomer;
    const prof = cust && cust.getProfile ? cust.getProfile() : null;
    const user = cust && cust.getUser ? cust.getUser() : null;
    if (prof || user) {
      const p = prof || {};
      if (!draft.customer_full_name && p.full_name) draft.customer_full_name = p.full_name;
      if (!draft.customer_phone && p.phone) draft.customer_phone = p.phone;
      if (!draft.customer_email && (p.email || (user && user.email))) draft.customer_email = p.email || user.email;
      if (!draft.shipping_province && p.province) draft.shipping_province = p.province;
      if (!draft.shipping_city && p.city) draft.shipping_city = p.city;
      if (!draft.shipping_address && p.address) draft.shipping_address = p.address;
      if (!draft.shipping_postal_code && p.postal_code) draft.shipping_postal_code = p.postal_code;
      if (!draft.shipping_references && p.extra_references) draft.shipping_references = p.extra_references;
    }
    try { state.generalNote = (draft.general_notes != null ? String(draft.general_notes) : (localStorage.getItem(NOTE_KEY) || "")); } catch (e) { state.generalNote = String(draft.general_notes || ""); }
    if (noteEl) noteEl.value = state.generalNote;
    fillForm(draft);
    document.body.style.overflow = "hidden";
    const app = document.querySelector(".app"); if (app && "inert" in app) app.inert = true;
    backdrop.classList.add("open"); modal.classList.add("open"); modal.setAttribute("aria-hidden", "false");
    if ("inert" in modal) modal.inert = false;
    try { closeBtn.focus(); } catch (e) {}
    validate();
  }

  function close() {
    if (!modal || !modal.classList.contains("open")) return;
    backdrop.classList.remove("open"); modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true");
    if ("inert" in modal) modal.inert = true;
    document.body.style.overflow = previousOverflow;
    const app = document.querySelector(".app"); if (app && "inert" in app) app.inert = false;
    if (lastFocus && typeof lastFocus.focus === "function") { try { lastFocus.focus(); } catch (e) {} }
  }

  async function submitOrder() {
    if (state.validating || state.submitting) return;
    state.error = ""; render();
    const form = collectForm();
    const err = validateForm(form);
    if (err) { state.error = err; render(); return; }
    saveDraft(form);
    const res = await validate();
    if (!res || res.invalid.length || !res.valid.length) return;
    if (!res.valid.length) { state.error = "No hay productos válidos para pedir."; render(); return; }

    let idem = getIdem();
    if (!idem) { idem = uid(); setIdem(idem); }
    state.submitting = true; render();
    try {
      const payload = Object.assign({}, form, {
        source: (window.ReymeroShare && window.ReymeroShare.isNative && window.ReymeroShare.isNative()) ? "apk" : "web",
        items: res.valid.map(function (l) { return { id: l.id, qty: l.qty, note: l.note || "" }; })
      });
      const { data, error } = await getClient().rpc("create_shop_order", { p_payload: payload, p_idempotency_key: idem });
      if (error) throw error;
      if (!data || !data.id) throw new Error("Respuesta inválida del servidor");

      // Guardar perfil básico si el cliente inició sesión (best-effort, sin bloquear UX)
      if (window.ReymeroCustomer && window.ReymeroCustomer.getUser && window.ReymeroCustomer.getUser()) {
        window.ReymeroCustomer.saveProfile({
          full_name: form.customer_full_name, phone: form.customer_phone, email: form.customer_email,
          province: form.shipping_province, city: form.shipping_city, address: form.shipping_address,
          postal_code: form.shipping_postal_code, extra_references: form.shipping_references
        }).catch(() => {});
      }

      const detail = {
        orderId: data.id,
        orderNumber: data.order_number,
        status: data.status || "pending",
        statusLabel: "Pendiente de confirmación",
        createdAt: data.created_at || new Date().toISOString(),
        total: Number(data.total != null ? data.total : res.subtotal),
        currency: data.currency || "ARS",
        duplicate: !!data.duplicate,
        receiptToken: data.receipt_token || "",
        paymentStatus: data.payment_status || "pending_payment",
        customer: { fullName: form.customer_full_name, phone: form.customer_phone, email: form.customer_email },
        deliveryMethod: form.delivery_method,
        shipping: { province: form.shipping_province, city: form.shipping_city, address: form.shipping_address, postalCode: form.shipping_postal_code, references: form.shipping_references },
        billing: form.billing_requested ? { fullName: form.billing_full_name, taxId: form.billing_tax_id, address: form.billing_address } : null,
        notes: form.general_notes,
        items: res.valid.map(function (l) { return { id: l.id, name: l.name, qty: l.qty, price: l.price, note: l.note, subtotal: l.subtotal }; }),
        count: res.count,
        subtotal: res.subtotal,
        validatedAt: new Date().toISOString()
      };
      // No vaciar carrito hasta que el comprobante se suba correctamente.
      setPending(detail);
      close();
      window.dispatchEvent(new CustomEvent("reymero:checkout-validated", { detail: detail }));
    } catch (e) {
      state.error = "No se pudo registrar el pedido. Revisá tu conexión e intentá de nuevo. " + (e && e.message ? "(" + e.message + ")" : "");
      if (window.console) console.warn("Error creando pedido", e);
    } finally { state.submitting = false; render(); }
  }

  function build() {
    if (!window.ReymeroCart || document.getElementById(MODAL_ID)) return;
    if (!document.getElementById(STYLE_ID)) { const style = document.createElement("style"); style.id = STYLE_ID; style.textContent = CSS; document.head.appendChild(style); }

    backdrop = el("div", "rm-checkout-backdrop"); backdrop.id = BACKDROP_ID; backdrop.setAttribute("aria-hidden", "true");
    modal = el("section", "rm-checkout"); modal.id = MODAL_ID; modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true"); modal.setAttribute("aria-label", "Finalizar pedido"); modal.setAttribute("aria-hidden", "true");
    if ("inert" in modal) modal.inert = true;

    const head = el("div", "rm-checkout-head"); head.appendChild(el("h2", null, "Finalizar pedido"));
    closeBtn = el("button", "rm-checkout-close", "×"); closeBtn.id = "rmCheckoutClose"; closeBtn.type = "button"; closeBtn.setAttribute("aria-label", "Cerrar checkout"); head.appendChild(closeBtn); modal.appendChild(head);

    const body = el("div", "rm-checkout-body");
    statusEl = el("p", "rm-checkout-status", "Verificando precios, publicación y stock…"); statusEl.id = "rmCheckoutStatus"; body.appendChild(statusEl);
    linesEl = el("div", "rm-checkout-lines"); linesEl.id = "rmCheckoutLines"; body.appendChild(linesEl);

    formEl = document.createElement("form"); formEl.id = "rmCheckoutForm"; formEl.noValidate = true;
    // Contacto
    const sec1 = el("div", "rm-ck-section"); sec1.appendChild(el("h3", "rm-ck-title", "Datos de contacto"));
    const g1 = el("div", "rm-ck-grid");
    const fName = field("rmName", "Nombre y apellido", { required: true, autocomplete: "name", maxLength: 120 }); g1.appendChild(fName.wrap);
    const fPhone = field("rmPhone", "Teléfono de contacto", { required: true, autocomplete: "tel", maxLength: 30, placeholder: "Ej.: 11 1234 5678" }); g1.appendChild(fPhone.wrap);
    const fEmail = field("rmEmail", "Correo electrónico (opcional)", { type: "email", autocomplete: "email", maxLength: 254 }); fEmail.wrap.classList.add("full"); g1.appendChild(fEmail.wrap);
    sec1.appendChild(g1); formEl.appendChild(sec1);

    // Entrega
    const sec2 = el("div", "rm-ck-section"); sec2.appendChild(el("h3", "rm-ck-title", "Entrega"));
    const radioRow = el("div", "rm-ck-radio-row");
    [["shipping", "Envío a domicilio"], ["pickup_agreed", "Retiro acordado"]].forEach(function (opt, idx) {
      const lab = el("label", "rm-ck-radio"); const r = document.createElement("input"); r.type = "radio"; r.name = "rmDelivery"; r.value = opt[0]; if (idx === 0) r.checked = true; lab.appendChild(r); lab.appendChild(document.createTextNode(" " + opt[1])); radioRow.appendChild(lab);
    });
    sec2.appendChild(radioRow);
    const g2 = el("div", "rm-ck-grid"); g2.id = "rmShippingFields"; g2.style.marginTop = ".75rem";
    g2.appendChild(field("rmProvince", "Provincia", { required: true, maxLength: 80 }).wrap);
    g2.appendChild(field("rmCity", "Localidad", { required: true, maxLength: 120 }).wrap);
    g2.appendChild(field("rmAddress", "Dirección", { required: true, maxLength: 200, full: true }).wrap);
    g2.appendChild(field("rmPostal", "Código postal", { required: true, maxLength: 20 }).wrap);
    g2.appendChild(field("rmRefs", "Referencias adicionales (opcional)", { maxLength: 500, full: true, placeholder: "Ej.: timbre, horario, punto de referencia" }).wrap);
    sec2.appendChild(g2); formEl.appendChild(sec2);

    // Facturación opcional
    const sec3 = el("div", "rm-ck-section"); sec3.appendChild(el("h3", "rm-ck-title", "Facturación (opcional)"));
    const billCheck = el("label", "rm-ck-check"); const billCb = document.createElement("input"); billCb.type = "checkbox"; billCb.id = "rmBillingRequested"; billCheck.appendChild(billCb); billCheck.appendChild(document.createTextNode(" Necesito datos de facturación en el pedido")); sec3.appendChild(billCheck);
    const billBox = el("div", "rm-ck-billing"); billBox.id = "rmBillingBox";
    const g3 = el("div", "rm-ck-grid");
    g3.appendChild(field("rmBillName", "Nombre / Razón social", { maxLength: 120, full: true }).wrap);
    g3.appendChild(field("rmBillTax", "CUIT / DNI (opcional)", { maxLength: 32 }).wrap);
    g3.appendChild(field("rmBillAddr", "Domicilio fiscal (opcional)", { maxLength: 200 }).wrap);
    billBox.appendChild(g3); sec3.appendChild(billBox); formEl.appendChild(sec3);

    // Observaciones
    const sec4 = el("div", "rm-ck-section"); sec4.appendChild(el("h3", "rm-ck-title", "Observaciones"));
    const noteLabel = el("label", "rm-ck-label", "Observaciones generales (opcional)"); noteLabel.setAttribute("for", "rmCheckoutGeneralNote"); noteLabel.style.display = "block"; noteLabel.style.marginBottom = ".3rem"; sec4.appendChild(noteLabel);
    noteEl = el("textarea", "rm-ck-textarea"); noteEl.id = "rmCheckoutGeneralNote"; noteEl.maxLength = 2000; noteEl.placeholder = "Ej.: entregar por la tarde, avisar antes de enviar…"; sec4.appendChild(noteEl);
    sec4.appendChild(el("p", "rm-ck-hint", "Al confirmar, el pedido se registra como pendiente y no pagado. La confirmación final se coordina por WhatsApp."));
    formEl.appendChild(sec4);

    body.appendChild(formEl); modal.appendChild(body);

    const foot = el("div", "rm-checkout-foot");
    const totals = el("div", "rm-checkout-totals"); totals.appendChild(el("span", null, "Cantidad total")); unitsEl = el("strong", null, "0 unidades"); totals.appendChild(unitsEl); foot.appendChild(totals);
    const totalRow = el("div", "rm-checkout-total"); totalRow.appendChild(el("span", null, "Total estimado")); totalEl = el("b", null, money(0)); totalEl.id = "rmCheckoutTotal"; totalRow.appendChild(totalEl); foot.appendChild(totalRow);
    const actions = el("div", "rm-checkout-actions");
    backBtn = el("button", "rm-checkout-secondary", "Volver al carrito"); backBtn.type = "button";
    confirmBtn = el("button", "rm-checkout-primary", "Confirmar pedido"); confirmBtn.id = "rmCheckoutConfirm"; confirmBtn.type = "button"; confirmBtn.disabled = true;
    actions.appendChild(backBtn); actions.appendChild(confirmBtn); foot.appendChild(actions); modal.appendChild(foot);

    document.body.appendChild(backdrop); document.body.appendChild(modal);

    closeBtn.addEventListener("click", close); backdrop.addEventListener("click", close);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && modal.classList.contains("open")) close(); });
    window.addEventListener("reymero:checkout-request", open);
    backBtn.addEventListener("click", function () { close(); if (window.ReymeroCartUI) window.ReymeroCartUI.open(); });

    function clearError() { if (state.error) { state.error = ""; render(); } }
    formEl.addEventListener("change", function (e) {
      if (e.target && e.target.name === "rmDelivery") syncDeliveryUI();
      if (e.target && e.target.id === "rmBillingRequested") syncBillingUI();
      saveDraft(collectForm());
      clearError();
    });
    formEl.addEventListener("input", function (e) {
      if (e.target && e.target.id === "rmCheckoutGeneralNote") { state.generalNote = e.target.value; try { localStorage.setItem(NOTE_KEY, state.generalNote); } catch (_) {} }
      saveDraft(collectForm());
      clearError();
    });

    linesEl.addEventListener("input", function (e) {
      const input = e.target.closest("[data-checkout-note]"); if (!input) return;
      window.ReymeroCart.setNote(input.dataset.checkoutNote, input.value);
      if (state.result) { const line = state.result.lines.find(function (l) { return l.id === input.dataset.checkoutNote; }); if (line) line.note = input.value; }
    });
    linesEl.addEventListener("click", function (e) {
      const remove = e.target.closest("[data-checkout-remove]"); if (!remove) return;
      window.ReymeroCart.remove(remove.dataset.checkoutRemove); validate();
    });

    confirmBtn.addEventListener("click", submitOrder);

    window.ReymeroCheckout = Object.freeze({
      open: open, close: close, validate: validate, validateRows: validateRows,
      setFetcher: function (fn) { fetcher = typeof fn === "function" ? fn : fetchRows; },
      getState: function () { return { result: state.result, error: state.error, validating: state.validating, submitting: state.submitting, open: modal.classList.contains("open") }; },
      getPending: getPending,
      clearPending: clearPending,
      setPending: setPending
    });
    window.ReymeroCart.subscribe(function () { if (!syncingCart && !getPending()) setIdem(""); });
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
})();