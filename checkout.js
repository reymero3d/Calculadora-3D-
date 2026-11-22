/* Resumen del pedido de Reymero 3D (Etapa 2).
   Verifica precio, published e in_stock contra Supabase antes de habilitar el resumen.
   No envía nada por WhatsApp: solo emite "reymero:checkout-validated" para la próxima etapa. */
(function () {
  "use strict";

  const STYLE_ID = "rmCheckoutStyles";
  const MODAL_ID = "rmCheckoutModal";
  const BACKDROP_ID = "rmCheckoutBackdrop";
  const NOTE_KEY = "reymero-checkout-note-v1";

  let modal = null;
  let backdrop = null;
  let statusEl = null;
  let linesEl = null;
  let noteEl = null;
  let unitsEl = null;
  let totalEl = null;
  let confirmBtn = null;
  let backBtn = null;
  let closeBtn = null;
  let lastFocus = null;
  let previousOverflow = "";
  let sbClient = null;
  let fetcher = fetchRows;

  const state = { result: null, error: "", validating: false, generalNote: "" };

  const CSS = `
    .rm-checkout-backdrop { position:fixed; inset:0; z-index:70; background:rgba(28,25,23,.55); opacity:0; pointer-events:none; transition:opacity .2s; }
    .rm-checkout-backdrop.open { opacity:1; pointer-events:auto; }
    .rm-checkout { position:fixed; z-index:71; left:50%; top:50%; transform:translate(-50%,-48%) scale(.98); width:min(560px,calc(100% - 2rem)); max-height:min(88vh,820px); display:flex; flex-direction:column; background:var(--surface); color:var(--text); border:1px solid var(--border); border-radius:14px; box-shadow:var(--shadow-lg); opacity:0; pointer-events:none; transition:opacity .2s,transform .2s; }
    .rm-checkout.open { opacity:1; pointer-events:auto; transform:translate(-50%,-50%) scale(1); }
    .rm-checkout-head { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:1.1rem 1.25rem; border-bottom:1px solid var(--border); }
    .rm-checkout-head h2 { margin:0; font-family:"Fraunces","Segoe UI",serif; font-size:1.25rem; }
    .rm-checkout-close { width:2rem; height:2rem; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--text); cursor:pointer; font-size:1.1rem; line-height:1; }
    .rm-checkout-body { overflow:auto; padding:1rem 1.25rem; }
    .rm-checkout-status { margin:0 0 .9rem; padding:.7rem .85rem; border-radius:7px; font-size:.78rem; line-height:1.45; font-family:"JetBrains Mono",monospace; background:var(--surface-2); color:var(--muted); }
    .rm-checkout-status.ok { color:var(--green); background:var(--accent-soft); }
    .rm-checkout-status.pending { color:var(--muted); }
    .rm-checkout-status.error { color:var(--accent); background:var(--accent-soft); }
    .rm-checkout-line { padding:.85rem 0; border-bottom:1px solid var(--border); }
    .rm-checkout-line.invalid { padding-left:.75rem; border-left:3px solid var(--accent); }
    .rm-checkout-line-top { display:flex; justify-content:space-between; align-items:baseline; gap:.75rem; }
    .rm-checkout-line-name { font-weight:700; font-size:.9rem; line-height:1.35; }
    .rm-checkout-line-sub { font-weight:800; color:var(--accent); font-size:.9rem; white-space:nowrap; }
    .rm-checkout-line-meta { margin-top:.2rem; font-size:.72rem; color:var(--muted); font-family:"JetBrains Mono",monospace; }
    .rm-checkout-line-notice { margin-top:.35rem; font-size:.72rem; color:var(--green); }
    .rm-checkout-line-error { margin-top:.35rem; font-size:.72rem; color:var(--accent); font-weight:700; }
    .rm-checkout-remove { margin-top:.45rem; background:none; border:0; padding:0; color:var(--accent); font-size:.72rem; text-decoration:underline; cursor:pointer; font-family:inherit; }
    .rm-checkout-note { width:100%; margin-top:.55rem; padding:.55rem .7rem; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--text); font-family:inherit; font-size:.8rem; }
    .rm-checkout-note:focus, .rm-checkout-general:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 3px rgba(185,28,28,.12); }
    .rm-checkout-general-label { display:block; margin-top:1.1rem; font-size:.72rem; font-weight:800; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
    .rm-checkout-general { width:100%; min-height:78px; margin-top:.45rem; padding:.7rem; resize:vertical; border:1px solid var(--border); border-radius:7px; background:var(--surface); color:var(--text); font-family:inherit; font-size:.85rem; line-height:1.5; }
    .rm-checkout-foot { border-top:1px solid var(--border); padding:1rem 1.25rem 1.15rem; display:grid; gap:.8rem; }
    .rm-checkout-totals { display:flex; justify-content:space-between; gap:1rem; font-size:.78rem; color:var(--muted); }
    .rm-checkout-totals strong { color:var(--text); font-family:"JetBrains Mono",monospace; }
    .rm-checkout-total { display:flex; justify-content:space-between; align-items:baseline; gap:1rem; font-family:"JetBrains Mono",monospace; font-size:.8rem; color:var(--muted); }
    .rm-checkout-total b { font-size:1.35rem; color:var(--accent); }
    .rm-checkout-actions { display:grid; grid-template-columns:1fr 1fr; gap:.6rem; }
    .rm-checkout-primary { padding:.8rem; border:1.5px solid var(--accent); border-radius:7px; background:var(--accent); color:#fff; font-family:"JetBrains Mono",monospace; font-size:.72rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em; cursor:pointer; }
    .rm-checkout-primary:hover:not(:disabled) { background:var(--accent-dark); border-color:var(--accent-dark); }
    .rm-checkout-primary:disabled { opacity:.5; cursor:default; }
    .rm-checkout-secondary { padding:.8rem; border:1px solid var(--border); border-radius:7px; background:transparent; color:var(--muted); font-family:inherit; font-size:.8rem; cursor:pointer; }
    .rm-checkout-close:focus-visible, .rm-checkout-primary:focus-visible, .rm-checkout-secondary:focus-visible, .rm-checkout-remove:focus-visible { outline:3px solid rgba(185,28,28,.35); outline-offset:2px; }
    @media (max-width:640px) {
      .rm-checkout { width:calc(100% - 1.5rem); max-height:92vh; }
      .rm-checkout-actions { grid-template-columns:1fr; }
    }
    @media (prefers-reduced-motion:reduce) { .rm-checkout,.rm-checkout-backdrop { transition:none; } }
  `;

  function money(value) {
    const n = Number.isFinite(Number(value)) ? Number(value) : 0;
    return "$ " + n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function getClient() {
    if (sbClient) return sbClient;
    const cfg = window.ReymeroConfig || {};
    if (!window.supabase || !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
      throw new Error("Supabase no disponible");
    }
    sbClient = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    return sbClient;
  }

  /* Solo columnas públicas. Nunca se consultan costos ni datos internos. */
  function fetchRows(ids) {
    const unique = [...new Set((ids || []).map(String))].filter(Boolean);
    if (!unique.length) return Promise.resolve([]);
    return getClient().from("products")
      .select("id,name,price,published,in_stock")
      .in("id", unique)
      .then(function (res) {
        if (res.error) throw res.error;
        return res.data || [];
      });
  }

  /* Función pura: clasifica cada línea del carrito con datos frescos del catálogo. */
  function validateRows(items, rows) {
    const byId = Object.create(null);
    (rows || []).forEach(function (r) {
      if (r && r.id != null) byId[String(r.id)] = r;
    });

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

      return {
        id: String(item.id),
        qty: Number(item.qty) || 1,
        note: String(item.note || ""),
        name: name,
        oldPrice: oldPrice,
        price: finalPrice,
        subtotal: finalPrice * (Number(item.qty) || 1),
        available: available,
        reason: reason,
        priceChanged: available && oldPrice !== finalPrice,
        nameChanged: available && name !== String(item.name)
      };
    });

    const valid = lines.filter(function (l) { return l.available; });
    return {
      lines: lines,
      valid: valid,
      invalid: lines.filter(function (l) { return !l.available; }),
      count: valid.reduce(function (s, l) { return s + l.qty; }, 0),
      subtotal: valid.reduce(function (s, l) { return s + l.subtotal; }, 0)
    };
  }

  async function validate() {
    const items = window.ReymeroCart.items();
    if (!items.length) {
      state.result = validateRows([], []);
      state.error = "";
      state.validating = false;
      render();
      return state.result;
    }

    state.validating = true;
    state.error = "";
    render();

    try {
      const rows = await fetcher(items.map(function (i) { return i.id; }));
      const result = validateRows(items, rows);
      if (result.valid.length) {
        window.ReymeroCart.sync(result.valid.map(function (l) {
          return { id: l.id, name: l.name, price: l.price };
        }));
      }
      state.result = result;
    } catch (e) {
      state.result = null;
      state.error = "No se pudo verificar precios y stock con Supabase. Revisá tu conexión e intentá de nuevo.";
      if (window.console) console.warn("No se pudo validar el pedido", e);
    } finally {
      state.validating = false;
      render();
    }
    return state.result;
  }

  function lineNode(line) {
    const row = el("div", "rm-checkout-line" + (line.available ? "" : " invalid"));
    const top = el("div", "rm-checkout-line-top");
    top.appendChild(el("div", "rm-checkout-line-name", line.name));
    top.appendChild(el("div", "rm-checkout-line-sub", money(line.subtotal)));
    row.appendChild(top);
    row.appendChild(el("div", "rm-checkout-line-meta", line.qty + " × " + money(line.price) + " c/u"));

    if (line.available && (line.priceChanged || line.nameChanged)) {
      const notices = [];
      if (line.priceChanged) notices.push("Precio actualizado (antes " + money(line.oldPrice) + ")");
      if (line.nameChanged) notices.push("Nombre actualizado");
      row.appendChild(el("div", "rm-checkout-line-notice", notices.join(" · ")));
    }
    if (!line.available) {
      row.appendChild(el("div", "rm-checkout-line-error", line.reason));
      const remove = el("button", "rm-checkout-remove", "Quitar del pedido");
      remove.type = "button";
      remove.dataset.checkoutRemove = line.id;
      row.appendChild(remove);
    }

    const note = el("input", "rm-checkout-note");
    note.type = "text";
    note.maxLength = 1000;
    note.placeholder = "Observación (opcional)";
    note.value = line.note;
    note.dataset.checkoutNote = line.id;
    note.setAttribute("aria-label", "Observación para " + line.name);
    row.appendChild(note);
    return row;
  }

  function render() {
    if (!statusEl || !linesEl) return;

    statusEl.textContent = "";
    let statusClass = "rm-checkout-status";
    if (state.validating) {
      statusEl.textContent = "Verificando precios, publicación y stock…";
      statusClass += " pending";
    } else if (state.error) {
      statusEl.textContent = state.error;
      statusClass += " error";
    } else if (state.result && state.result.lines.length) {
      statusEl.textContent = "Verificado con datos actuales del catálogo." +
        (state.result.invalid.length ? " Quitá los productos no disponibles para continuar." : "");
      statusClass += " ok";
    } else {
      statusEl.textContent = "Tu carrito está vacío. Agregá productos desde el catálogo.";
    }
    statusEl.className = statusClass;

    linesEl.textContent = "";
    if (state.result && state.result.lines.length) {
      state.result.lines.forEach(function (line) { linesEl.appendChild(lineNode(line)); });
    }

    const count = state.result ? state.result.count : window.ReymeroCart.count();
    const subtotal = state.result ? state.result.subtotal : window.ReymeroCart.subtotal();
    if (unitsEl) unitsEl.textContent = count + (count === 1 ? " unidad" : " unidades");
    if (totalEl) totalEl.textContent = money(subtotal);
    if (confirmBtn) {
      confirmBtn.disabled = state.validating || !!state.error || !state.result ||
        !state.result.valid.length || state.result.invalid.length > 0;
    }
  }

  function open() {
    if (modal && modal.classList.contains("open")) return;
    if (window.ReymeroCartUI) window.ReymeroCartUI.close();
    lastFocus = document.activeElement;
    previousOverflow = document.body.style.overflow;

    try { state.generalNote = window.localStorage.getItem(NOTE_KEY) || ""; }
    catch (e) { state.generalNote = ""; }
    if (noteEl) noteEl.value = state.generalNote;

    document.body.style.overflow = "hidden";
    const app = document.querySelector(".app");
    if (app && "inert" in app) app.inert = true;
    backdrop.classList.add("open");
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    if ("inert" in modal) modal.inert = false;
    try { closeBtn.focus(); } catch (e) {}

    validate();
  }

  function close() {
    if (!modal || !modal.classList.contains("open")) return;
    backdrop.classList.remove("open");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    if ("inert" in modal) modal.inert = true;
    document.body.style.overflow = previousOverflow;
    const app = document.querySelector(".app");
    if (app && "inert" in app) app.inert = false;
    if (lastFocus && typeof lastFocus.focus === "function") {
      try { lastFocus.focus(); } catch (e) {}
    }
  }

  function build() {
    if (!window.ReymeroCart || document.getElementById(MODAL_ID)) return;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    backdrop = el("div", "rm-checkout-backdrop");
    backdrop.id = BACKDROP_ID;
    backdrop.setAttribute("aria-hidden", "true");

    modal = el("section", "rm-checkout");
    modal.id = MODAL_ID;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Resumen del pedido");
    modal.setAttribute("aria-hidden", "true");
    if ("inert" in modal) modal.inert = true;

    const head = el("div", "rm-checkout-head");
    head.appendChild(el("h2", null, "Resumen del pedido"));
    closeBtn = el("button", "rm-checkout-close", "×");
    closeBtn.id = "rmCheckoutClose";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Cerrar resumen del pedido");
    head.appendChild(closeBtn);
    modal.appendChild(head);

    const body = el("div", "rm-checkout-body");
    statusEl = el("p", "rm-checkout-status", "Verificando precios, publicación y stock…");
    statusEl.id = "rmCheckoutStatus";
    body.appendChild(statusEl);
    linesEl = el("div", "rm-checkout-lines");
    linesEl.id = "rmCheckoutLines";
    body.appendChild(linesEl);

    const noteLabel = el("label", "rm-checkout-general-label", "Observaciones generales");
    noteEl = el("textarea", "rm-checkout-general");
    noteEl.id = "rmCheckoutGeneralNote";
    noteEl.maxLength = 2000;
    noteEl.placeholder = "Ej.: entregar por la tarde, avisar antes de enviar…";
    noteEl.setAttribute("aria-label", "Observaciones generales del pedido");
    noteLabel.appendChild(noteEl);
    body.appendChild(noteLabel);
    modal.appendChild(body);

    const foot = el("div", "rm-checkout-foot");
    const totals = el("div", "rm-checkout-totals");
    totals.appendChild(el("span", null, "Cantidad total"));
    unitsEl = el("strong", null, "0 unidades");
    totals.appendChild(unitsEl);
    foot.appendChild(totals);

    const totalRow = el("div", "rm-checkout-total");
    totalRow.appendChild(el("span", null, "Subtotal"));
    totalEl = el("b", null, money(0));
    totalEl.id = "rmCheckoutTotal";
    totalRow.appendChild(totalEl);
    foot.appendChild(totalRow);

    const actions = el("div", "rm-checkout-actions");
    backBtn = el("button", "rm-checkout-secondary", "Volver al carrito");
    backBtn.type = "button";
    confirmBtn = el("button", "rm-checkout-primary", "Confirmar resumen");
    confirmBtn.id = "rmCheckoutConfirm";
    confirmBtn.type = "button";
    confirmBtn.disabled = true;
    actions.appendChild(backBtn);
    actions.appendChild(confirmBtn);
    foot.appendChild(actions);
    modal.appendChild(foot);

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);

    closeBtn.addEventListener("click", close);
    backdrop.addEventListener("click", close);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("open")) close();
    });
    window.addEventListener("reymero:checkout-request", open);

    backBtn.addEventListener("click", function () {
      close();
      if (window.ReymeroCartUI) window.ReymeroCartUI.open();
    });

    linesEl.addEventListener("input", function (e) {
      const input = e.target.closest("[data-checkout-note]");
      if (!input) return;
      window.ReymeroCart.setNote(input.dataset.checkoutNote, input.value);
      if (state.result) {
        const line = state.result.lines.find(function (l) { return l.id === input.dataset.checkoutNote; });
        if (line) line.note = input.value;
      }
    });

    linesEl.addEventListener("click", function (e) {
      const remove = e.target.closest("[data-checkout-remove]");
      if (!remove) return;
      window.ReymeroCart.remove(remove.dataset.checkoutRemove);
      validate();
    });

    noteEl.addEventListener("input", function () {
      state.generalNote = noteEl.value;
      try { window.localStorage.setItem(NOTE_KEY, state.generalNote); } catch (e) {}
    });

    confirmBtn.addEventListener("click", async function () {
      if (state.validating) return;
      const res = await validate();
      if (!res || res.invalid.length || !res.valid.length) return;
      const detail = {
        items: res.valid.map(function (l) {
          return { id: l.id, name: l.name, qty: l.qty, price: l.price, note: l.note, subtotal: l.subtotal };
        }),
        notes: state.generalNote,
        count: res.count,
        subtotal: res.subtotal,
        validatedAt: new Date().toISOString()
      };
      window.dispatchEvent(new CustomEvent("reymero:checkout-validated", { detail: detail }));
      if (typeof window.toast === "function") {
        window.toast("Resumen listo. El envío por WhatsApp se habilita en la próxima etapa.");
      }
    });

    window.ReymeroCheckout = Object.freeze({
      open: open,
      close: close,
      validate: validate,
      validateRows: validateRows,
      setFetcher: function (fn) { fetcher = typeof fn === "function" ? fn : fetchRows; },
      getState: function () {
        return {
          result: state.result,
          error: state.error,
          validating: state.validating,
          open: modal.classList.contains("open")
        };
      }
    });

    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
