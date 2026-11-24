/* Interfaz del carrito compartida por tienda.html y producto.html.
   Inyecta un botón flotante y un panel deslizable. No reemplaza ninguna UI existente. */
(function () {
  "use strict";

  const STYLE_ID = "rmCartStyles";
  const FAB_ID = "rmCartFab";
  const PANEL_ID = "rmCartPanel";
  const BACKDROP_ID = "rmCartBackdrop";

  function money(value) {
    const n = Number.isFinite(Number(value)) ? Number(value) : 0;
    return "$ " + n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  const CSS = `
    .rm-cart-fab { position:fixed; left:calc(1.25rem + env(safe-area-inset-left,0px)); bottom:calc(1.25rem + env(safe-area-inset-bottom,0px)); z-index:60; display:inline-flex; align-items:center; gap:.55rem; min-height:44px; padding:.7rem 1rem; border:1.5px solid var(--accent); border-radius:99px; background:var(--accent); color:#fff; font-family:"JetBrains Mono",monospace; font-size:.75rem; font-weight:700; letter-spacing:.04em; cursor:pointer; box-shadow:var(--shadow-lg); }
    .rm-cart-fab:hover { background:var(--accent-dark); border-color:var(--accent-dark); }
    .rm-cart-fab:focus-visible { outline:3px solid rgba(185,28,28,.35); outline-offset:3px; }
    .rm-cart-badge { display:inline-flex; align-items:center; justify-content:center; min-width:1.4rem; height:1.4rem; padding:0 .35rem; border-radius:99px; background:#fff; color:var(--accent); font-size:.7rem; }
    body.dark .rm-cart-badge { background:#1c1917; color:#fca5a5; }
    .rm-cart-backdrop { position:fixed; inset:0; z-index:61; background:rgba(28,25,23,.45); opacity:0; pointer-events:none; transition:opacity .2s; }
    .rm-cart-backdrop.open { opacity:1; pointer-events:auto; }
    .rm-cart-panel { position:fixed; top:0; left:0; bottom:0; height:100dvh; z-index:62; width:min(380px,100%); background:var(--surface); color:var(--text); border-right:1px solid var(--border); box-shadow:var(--shadow-lg); display:flex; flex-direction:column; transform:translateX(-105%); transition:transform .25s ease; }
    .rm-cart-panel.open { transform:translateX(0); }
    .rm-cart-head { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:calc(1.1rem + env(safe-area-inset-top,0px)) 1.15rem 1.1rem; border-bottom:1px solid var(--border); }
    .rm-cart-head h2 { margin:0; font-family:"Fraunces","Segoe UI",serif; font-size:1.25rem; }
    .rm-cart-close { width:2.75rem; height:2.75rem; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--text); cursor:pointer; font-size:1.25rem; line-height:1; }
    .rm-cart-close:focus-visible, .rm-cart-stepper button:focus-visible, .rm-cart-remove:focus-visible, .rm-cart-primary:focus-visible, .rm-cart-secondary:focus-visible { outline:3px solid rgba(185,28,28,.35); outline-offset:2px; }
    .rm-cart-list { flex:1; overflow:auto; padding:.85rem 1.15rem; overscroll-behavior:contain; }
    .rm-cart-empty { text-align:center; color:var(--muted); font-size:.9rem; padding:3rem 1rem; line-height:1.6; }
    .rm-cart-item { display:grid; grid-template-columns:1fr auto; gap:.35rem .75rem; padding:.9rem 0; border-bottom:1px solid var(--border); }
    .rm-cart-item-name { font-weight:700; font-size:.9rem; line-height:1.35; }
    .rm-cart-item-meta { font-size:.72rem; color:var(--muted); font-family:"JetBrains Mono",monospace; }
    .rm-cart-item-sub { font-weight:800; color:var(--accent); font-size:.9rem; text-align:right; }
    .rm-cart-controls { display:flex; align-items:center; gap:.5rem; grid-column:1 / -1; }
    .rm-cart-stepper { display:inline-flex; align-items:center; border:1px solid var(--border); border-radius:6px; overflow:hidden; }
    .rm-cart-stepper button { width:2.75rem; height:2.75rem; border:0; background:var(--surface-2); color:var(--text); cursor:pointer; font-size:1.1rem; }
    .rm-cart-stepper span { min-width:2.2rem; text-align:center; font-family:"JetBrains Mono",monospace; font-size:.85rem; font-weight:700; }
    .rm-cart-remove { margin-left:auto; background:none; border:0; color:var(--muted); font-size:.78rem; text-decoration:underline; cursor:pointer; font-family:inherit; min-height:44px; padding:.25rem .4rem; }
    .rm-cart-foot { border-top:1px solid var(--border); padding:1rem 1.15rem calc(1.2rem + env(safe-area-inset-bottom,0px)); display:grid; gap:.75rem; background:var(--surface); }
    .rm-cart-totals { display:flex; justify-content:space-between; gap:1rem; font-size:.78rem; color:var(--muted); }
    .rm-cart-totals strong { color:var(--text); font-family:"JetBrains Mono",monospace; }
    .rm-cart-total { display:flex; justify-content:space-between; align-items:baseline; gap:1rem; font-family:"JetBrains Mono",monospace; font-size:.8rem; color:var(--muted); }
    .rm-cart-total b { font-size:1.35rem; color:var(--accent); }
    .rm-cart-actions { display:grid; gap:.5rem; }
    .rm-cart-primary { width:100%; min-height:44px; padding:.8rem; border:1.5px solid var(--accent); border-radius:7px; background:var(--accent); color:#fff; font-family:"JetBrains Mono",monospace; font-size:.72rem; font-weight:700; text-transform:uppercase; letter-spacing:.05em; cursor:pointer; }
    .rm-cart-primary:hover { background:var(--accent-dark); border-color:var(--accent-dark); }
    .rm-cart-secondary { width:100%; min-height:44px; padding:.65rem; border:1px solid var(--border); border-radius:7px; background:transparent; color:var(--muted); font-family:inherit; font-size:.85rem; cursor:pointer; }
    @media (prefers-reduced-motion:reduce) { .rm-cart-panel,.rm-cart-backdrop { transition:none; } }
  `;

  let fab = null;
  let panel = null;
  let backdrop = null;
  let listEl = null;
  let unitsEl = null;
  let subtotalEl = null;
  let closeBtn = null;
  let lastFocus = null;
  let previousOverflow = "";

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function build() {
    if (!window.ReymeroCart || document.getElementById(FAB_ID)) return;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    fab = el("button", "rm-cart-fab");
    fab.id = FAB_ID;
    fab.type = "button";
    fab.setAttribute("aria-label", "Abrir carrito");
    fab.appendChild(el("span", null, "▤ Carrito"));
    fab.appendChild(el("span", "rm-cart-badge", "0"));

    backdrop = el("div", "rm-cart-backdrop");
    backdrop.id = BACKDROP_ID;
    backdrop.setAttribute("aria-hidden", "true");

    panel = el("aside", "rm-cart-panel");
    panel.id = PANEL_ID;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Carrito de compras");
    panel.setAttribute("aria-hidden", "true");
    if ("inert" in panel) panel.inert = true;

    const head = el("div", "rm-cart-head");
    head.appendChild(el("h2", null, "Tu carrito"));
    closeBtn = el("button", "rm-cart-close", "×");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Cerrar carrito");
    head.appendChild(closeBtn);
    panel.appendChild(head);

    listEl = el("div", "rm-cart-list");
    panel.appendChild(listEl);

    const foot = el("div", "rm-cart-foot");
    const totals = el("div", "rm-cart-totals");
    unitsEl = el("strong", null, "0 unidades");
    const totalsLabel = el("span", null, "Cantidad total");
    totals.appendChild(totalsLabel);
    totals.appendChild(unitsEl);
    foot.appendChild(totals);

    const totalRow = el("div", "rm-cart-total");
    totalRow.appendChild(el("span", null, "Subtotal estimado"));
    subtotalEl = el("b", null, money(0));
    totalRow.appendChild(subtotalEl);
    foot.appendChild(totalRow);

    const actions = el("div", "rm-cart-actions");
    const checkout = el("button", "rm-cart-primary", "Revisar pedido");
    checkout.type = "button";
    checkout.addEventListener("click", function () {
      if (window.ReymeroCartUI) window.ReymeroCartUI.close();
      window.dispatchEvent(new CustomEvent("reymero:checkout-request"));
    });
    const keepShopping = el("button", "rm-cart-secondary", "Seguir comprando");
    keepShopping.type = "button";
    keepShopping.addEventListener("click", close);
    actions.appendChild(checkout);
    actions.appendChild(keepShopping);
    foot.appendChild(actions);
    panel.appendChild(foot);

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    document.body.appendChild(fab);

    fab.addEventListener("click", open);
    backdrop.addEventListener("click", close);
    closeBtn.addEventListener("click", close);
    document.addEventListener("keydown", function (e) {
      if (!panel.classList.contains("open")) return;
      if (e.key === "Escape") { close(); return; }
      if (e.key === "Tab") {
        const focusables = panel.querySelectorAll('button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!focusables.length) { e.preventDefault(); return; }
        const first = focusables[0], last = focusables[focusables.length - 1];
        if (e.shiftKey) { if (document.activeElement === first || document.activeElement === panel) { e.preventDefault(); last.focus(); } }
        else { if (document.activeElement === last) { e.preventDefault(); first.focus(); } }
      }
    });

    listEl.addEventListener("click", function (e) {
      const step = e.target.closest("[data-cart-step]");
      if (step) {
        const item = window.ReymeroCart.items().find(function (i) { return i.id === step.dataset.id; });
        if (!item) return;
        const delta = step.dataset.cartStep === "inc" ? 1 : -1;
        window.ReymeroCart.setQty(item.id, item.qty + delta);
        return;
      }
      const remove = e.target.closest("[data-cart-remove]");
      if (remove) window.ReymeroCart.remove(remove.dataset.cartRemove);
    });

    window.ReymeroCart.subscribe(function () {
      updateFab();
      if (panel.classList.contains("open")) render();
    });

    updateFab();
    render();

    function open() {
      if (panel.classList.contains("open")) return;
      render();
      lastFocus = document.activeElement;
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      const app = document.querySelector(".app");
      if (app && "inert" in app) app.inert = true;
      backdrop.classList.add("open");
      panel.classList.add("open");
      panel.setAttribute("aria-hidden", "false");
      if ("inert" in panel) panel.inert = false;
      try { closeBtn.focus(); } catch (err) {}
    }

    function close() {
      backdrop.classList.remove("open");
      panel.classList.remove("open");
      panel.setAttribute("aria-hidden", "true");
      if ("inert" in panel) panel.inert = true;
      document.body.style.overflow = previousOverflow;
      const app = document.querySelector(".app");
      if (app && "inert" in app) app.inert = false;
      if (lastFocus && typeof lastFocus.focus === "function") {
        try { lastFocus.focus(); } catch (err) {}
      }
    }

    window.ReymeroCartUI = Object.freeze({ open: open, close: close });
  }

  function updateFab() {
    if (!fab) return;
    const n = window.ReymeroCart.count();
    const badge = fab.querySelector(".rm-cart-badge");
    if (badge) badge.textContent = String(n);
    fab.setAttribute("aria-label", "Abrir carrito, " + n + (n === 1 ? " producto" : " productos"));
  }

  function render() {
    if (!listEl) return;
    const items = window.ReymeroCart.items();
    listEl.textContent = "";

    if (!items.length) {
      const empty = el("div", "rm-cart-empty", "Tu carrito está vacío. Agregá productos desde el catálogo o desde su detalle.");
      listEl.appendChild(empty);
    } else {
      items.forEach(function (item) {
        const row = el("div", "rm-cart-item");
        row.appendChild(el("div", "rm-cart-item-name", item.name));
        row.appendChild(el("div", "rm-cart-item-sub", money(item.price * item.qty)));
        row.appendChild(el("div", "rm-cart-item-meta", money(item.price) + " c/u"));

        const controls = el("div", "rm-cart-controls");
        const stepper = el("div", "rm-cart-stepper");
        stepper.setAttribute("role", "group");
        stepper.setAttribute("aria-label", "Cantidad de " + item.name);
        const minus = el("button", null, "−");
        minus.type = "button";
        minus.dataset.cartStep = "dec";
        minus.dataset.id = item.id;
        minus.setAttribute("aria-label", "Disminuir cantidad de " + item.name);
        const value = el("span", null, String(item.qty));
        const plus = el("button", null, "+");
        plus.type = "button";
        plus.dataset.cartStep = "inc";
        plus.dataset.id = item.id;
        plus.setAttribute("aria-label", "Aumentar cantidad de " + item.name);
        stepper.appendChild(minus);
        stepper.appendChild(value);
        stepper.appendChild(plus);
        controls.appendChild(stepper);

        const remove = el("button", "rm-cart-remove", "Eliminar");
        remove.type = "button";
        remove.dataset.cartRemove = item.id;
        remove.setAttribute("aria-label", "Eliminar " + item.name + " del carrito");
        controls.appendChild(remove);
        row.appendChild(controls);
        listEl.appendChild(row);
      });
    }

    const units = window.ReymeroCart.count();
    if (unitsEl) unitsEl.textContent = units + (units === 1 ? " unidad" : " unidades");
    if (subtotalEl) subtotalEl.textContent = money(window.ReymeroCart.subtotal());
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
