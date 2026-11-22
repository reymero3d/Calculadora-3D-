/* Comprobante visual y PDF del pedido validado (Etapas 3 y 4).
   Genera el PDF localmente con jsPDF vendorizado. No envía nada automáticamente. */
(function () {
  "use strict";

  const STYLE_ID = "rmReceiptStyles";
  const MODAL_ID = "rmReceiptModal";
  const BACKDROP_ID = "rmReceiptBackdrop";

  let modal = null;
  let backdrop = null;
  let closeBtn = null;
  let bodyEl = null;
  let lastFocus = null;
  let previousOverflow = "";
  let current = null;

  const CSS = `
    .rm-receipt-backdrop { position:fixed; inset:0; z-index:80; background:rgba(28,25,23,.6); opacity:0; pointer-events:none; transition:opacity .2s; }
    .rm-receipt-backdrop.open { opacity:1; pointer-events:auto; }
    .rm-receipt { position:fixed; z-index:81; left:50%; top:50%; transform:translate(-50%,-48%) scale(.98); width:min(620px,calc(100% - 2rem)); max-height:92vh; display:flex; flex-direction:column; background:var(--surface); color:var(--text); border:1px solid var(--border); border-radius:14px; box-shadow:var(--shadow-lg); opacity:0; pointer-events:none; transition:opacity .2s,transform .2s; }
    .rm-receipt.open { opacity:1; pointer-events:auto; transform:translate(-50%,-50%) scale(1); }
    .rm-receipt-head { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:1.1rem 1.25rem; border-bottom:1px solid var(--border); }
    .rm-receipt-head h2 { margin:0; font-family:"Fraunces","Segoe UI",serif; font-size:1.3rem; }
    .rm-receipt-close { width:2rem; height:2rem; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--text); cursor:pointer; font-size:1.1rem; line-height:1; }
    .rm-receipt-body { overflow:auto; padding:1.25rem; }
    .rm-receipt-brand { font-family:"JetBrains Mono",monospace; font-size:.7rem; text-transform:uppercase; letter-spacing:.14em; color:var(--accent); font-weight:800; }
    .rm-receipt-title { margin:.25rem 0 1rem; font-family:"Fraunces","Segoe UI",serif; font-size:1.5rem; }
    .rm-receipt-meta { display:grid; grid-template-columns:1fr 1fr; gap:.5rem 1rem; padding:.85rem; margin-bottom:1rem; background:var(--surface-2); border-radius:8px; font-family:"JetBrains Mono",monospace; font-size:.75rem; }
    .rm-receipt-meta span { color:var(--muted); }
    .rm-receipt-meta b { display:block; margin-top:.15rem; color:var(--text); }
    .rm-receipt-line { display:flex; justify-content:space-between; gap:1rem; padding:.75rem 0; border-bottom:1px solid var(--border); }
    .rm-receipt-line-name { font-weight:700; font-size:.9rem; line-height:1.35; }
    .rm-receipt-line-meta { margin-top:.2rem; font-size:.72rem; color:var(--muted); font-family:"JetBrains Mono",monospace; }
    .rm-receipt-line-note { margin-top:.25rem; font-size:.75rem; color:var(--muted); font-style:italic; }
    .rm-receipt-line-sub { font-weight:800; color:var(--accent); white-space:nowrap; }
    .rm-receipt-notes { margin-top:1rem; padding:.85rem; border:1px dashed var(--border); border-radius:8px; }
    .rm-receipt-notes b { display:block; font-size:.72rem; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin-bottom:.3rem; }
    .rm-receipt-notes p { margin:0; font-size:.85rem; line-height:1.5; white-space:pre-wrap; }
    .rm-receipt-total { display:flex; justify-content:space-between; align-items:baseline; gap:1rem; margin-top:1.25rem; padding-top:1rem; border-top:2px solid var(--border); font-family:"JetBrains Mono",monospace; }
    .rm-receipt-total b { font-size:1.5rem; color:var(--accent); }
    .rm-receipt-disclaimer { margin:.9rem 0 0; font-size:.72rem; color:var(--muted); line-height:1.5; }
    .rm-receipt-foot { border-top:1px solid var(--border); padding:1rem 1.25rem 1.15rem; display:grid; gap:.5rem; }
    .rm-receipt-row { display:grid; grid-template-columns:1fr 1fr; gap:.5rem; }
    .rm-receipt-btn { padding:.75rem .6rem; border:1px solid var(--border); border-radius:7px; background:var(--surface); color:var(--text); font-family:inherit; font-size:.78rem; font-weight:700; cursor:pointer; }
    .rm-receipt-btn:hover { border-color:var(--accent); color:var(--accent); }
    .rm-receipt-btn.primary { border-color:var(--accent); background:var(--accent); color:#fff; font-family:"JetBrains Mono",monospace; font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; }
    .rm-receipt-btn.primary:hover { background:var(--accent-dark); }
    .rm-receipt-close:focus-visible, .rm-receipt-btn:focus-visible { outline:3px solid rgba(185,28,28,.35); outline-offset:2px; }
    @media (max-width:640px) {
      .rm-receipt { width:calc(100% - 1.5rem); }
      .rm-receipt-meta { grid-template-columns:1fr; }
      .rm-receipt-row { grid-template-columns:1fr; }
    }
    @media (prefers-reduced-motion:reduce) { .rm-receipt,.rm-receipt-backdrop { transition:none; } }
  `;

  function money(value) { return window.ReymeroOrder.money(value); }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function orderText() {
    return window.ReymeroOrder.buildOrderText(current && current.detail, current && current.id);
  }

  function pdfFilename() {
    return "pedido-" + (current ? current.id : "reymero3d") + ".pdf";
  }

  function makePdf() {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("jsPDF no disponible");
    const d = current.detail;
    const customer = d.customer || {};
    const shipping = d.shipping || {};
    const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
    const left = 50;
    const right = 545;
    let y = 56;

    function ensure(h) { if (y + (h || 20) > 760) { doc.addPage(); y = 56; } }
    function line(text, opts) {
      opts = opts || {};
      doc.setFont("helvetica", opts.bold ? "bold" : "normal");
      doc.setFontSize(opts.size || 10);
      const lines = doc.splitTextToSize(String(text || ""), opts.width || 495);
      ensure(lines.length * (opts.lh || 13) + 2);
      doc.text(lines, left, y);
      y += lines.length * (opts.lh || 13);
    }

    doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text("Reymero3d", left, y); y += 20;
    doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.text("Comprobante de pedido", left, y); y += 20;
    line("Pedido: " + current.id);
    line("Fecha: " + window.ReymeroOrder.formatDate(d.createdAt || d.validatedAt));
    line("Estado: " + (d.statusLabel || "Pendiente de confirmación"));
    line("Pago: No pagado");
    y += 4; doc.setDrawColor(200); doc.line(left, y, right, y); y += 16;

    line("Cliente", { bold: true, size: 11, lh: 14 });
    line("Nombre: " + (customer.fullName || "-"));
    line("Teléfono: " + (customer.phone || "-"));
    if (customer.email) line("Email: " + customer.email);
    y += 6;
    line("Entrega", { bold: true, size: 11, lh: 14 });
    line("Método: " + (d.deliveryMethod === "pickup_agreed" ? "Retiro acordado" : "Envío"));
    if (d.deliveryMethod === "shipping") {
      const addr = [shipping.address, shipping.city, shipping.province, shipping.postalCode].filter(Boolean).join(", ");
      if (addr) line("Dirección: " + addr);
      if (shipping.references) line("Referencias: " + shipping.references);
    }
    y += 6; doc.setDrawColor(200); doc.line(left, y, right, y); y += 16;
    line("Productos", { bold: true, size: 11, lh: 14 });

    (d.items || []).forEach(function (item, i) {
      const qty = Number(item.qty) || 1;
      const price = Number(item.price) || 0;
      const sub = Number(item.subtotal != null ? item.subtotal : price * qty);
      ensure(40);
      doc.setFont("helvetica", "bold"); doc.setFontSize(10);
      const nameLines = doc.splitTextToSize((i + 1) + ") " + String(item.name || "Producto"), 360);
      doc.text(nameLines, left, y); y += nameLines.length * 13;
      doc.setFont("helvetica", "normal");
      doc.text(qty + " x " + money(price) + " c/u", left + 12, y);
      doc.text(money(sub), right, y, { align: "right" }); y += 14;
      if (item.note) { line("Obs: " + String(item.note), { size: 9, lh: 11, width: 470 }); }
      y += 4;
    });

    if (d.notes) {
      y += 4; line("Observaciones generales", { bold: true, size: 11, lh: 14 });
      line(String(d.notes), { width: 495 });
    }

    ensure(60);
    doc.setDrawColor(200); doc.line(left, y, right, y); y += 22;
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.text("Total estimado", left, y);
    doc.setFontSize(16); doc.text(money(d.total != null ? d.total : d.subtotal), right, y, { align: "right" }); y += 24;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    const disclaimer = "Pedido registrado como pendiente. No pagado. La apertura de WhatsApp no confirma la aceptación final del pedido. Precios y stock verificados al generar el pedido.";
    const dLines = doc.splitTextToSize(disclaimer, 495);
    doc.text(dLines, left, y);
    return doc;
  }

  function render() {
    if (!bodyEl) return;
    const d = current.detail;
    const customer = d.customer || {};
    const shipping = d.shipping || {};
    bodyEl.textContent = "";

    bodyEl.appendChild(el("div", "rm-receipt-brand", "Reymero3d · Impresión 3D"));
    bodyEl.appendChild(el("h3", "rm-receipt-title", "Comprobante de pedido"));

    const meta = el("div", "rm-receipt-meta");
    [
      ["Número de pedido", current.id],
      ["Fecha", window.ReymeroOrder.formatDate(d.createdAt || d.validatedAt)],
      ["Estado", d.statusLabel || "Pendiente de confirmación"],
      ["Pago", "No pagado"]
    ].forEach(function (pair) {
      const box = el("div");
      box.appendChild(el("span", null, pair[0]));
      box.appendChild(el("b", null, pair[1]));
      meta.appendChild(box);
    });
    bodyEl.appendChild(meta);

    const infoBlock = el("div", "rm-receipt-notes");
    infoBlock.appendChild(el("b", null, "Datos del cliente / entrega"));
    const info = [];
    info.push("Cliente: " + (customer.fullName || "-"));
    info.push("Teléfono: " + (customer.phone || "-"));
    if (customer.email) info.push("Email: " + customer.email);
    info.push("Entrega: " + (d.deliveryMethod === "pickup_agreed" ? "Retiro acordado" : "Envío"));
    if (d.deliveryMethod === "shipping") {
      const addr = [shipping.address, shipping.city, shipping.province, shipping.postalCode].filter(Boolean).join(", ");
      if (addr) info.push("Dirección: " + addr);
      if (shipping.references) info.push("Referencias: " + shipping.references);
    }
    infoBlock.appendChild(el("p", null, info.join("\n")));
    bodyEl.appendChild(infoBlock);

    (d.items || []).forEach(function (item, i) {
      const qty = Number(item.qty) || 1;
      const price = Number(item.price) || 0;
      const sub = Number(item.subtotal != null ? item.subtotal : price * qty);
      const row = el("div", "rm-receipt-line");
      const leftInfo = el("div");
      leftInfo.appendChild(el("div", "rm-receipt-line-name", (i + 1) + ") " + String(item.name || "Producto")));
      leftInfo.appendChild(el("div", "rm-receipt-line-meta", qty + " × " + money(price) + " c/u"));
      if (item.note) leftInfo.appendChild(el("div", "rm-receipt-line-note", "Obs: " + String(item.note)));
      row.appendChild(leftInfo);
      row.appendChild(el("div", "rm-receipt-line-sub", money(sub)));
      bodyEl.appendChild(row);
    });

    if (d.notes) {
      const notes = el("div", "rm-receipt-notes");
      notes.appendChild(el("b", null, "Observaciones generales"));
      notes.appendChild(el("p", null, d.notes));
      bodyEl.appendChild(notes);
    }

    const total = el("div", "rm-receipt-total");
    total.appendChild(el("span", null, "Total estimado"));
    total.appendChild(el("b", null, money(d.total != null ? d.total : d.subtotal)));
    bodyEl.appendChild(total);
    bodyEl.appendChild(el("p", "rm-receipt-disclaimer",
      "Pedido registrado como pendiente. No pagado. La apertura de WhatsApp no confirma la aceptación final del pedido. Precios y stock verificados al generar el pedido."));
  }

  function open() {
    if (!current || (modal && modal.classList.contains("open"))) return;
    if (window.ReymeroCheckout && window.ReymeroCheckout.getState().open) {
      window.ReymeroCheckout.close();
    }
    lastFocus = document.activeElement;
    previousOverflow = document.body.style.overflow;
    render();
    document.body.style.overflow = "hidden";
    const app = document.querySelector(".app");
    if (app && "inert" in app) app.inert = true;
    backdrop.classList.add("open");
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    if ("inert" in modal) modal.inert = false;
    try { closeBtn.focus(); } catch (e) {}
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
    const visible = lastFocus && lastFocus.isConnected && lastFocus.getClientRects().length &&
      !(lastFocus.closest && lastFocus.closest("[inert]"));
    const target = visible ? lastFocus : document.getElementById("rmCartFab");
    if (target && typeof target.focus === "function") {
      try { target.focus(); } catch (e) {}
    }
  }

  function onValidated(e) {
    const detail = e && e.detail;
    if (!detail || !(detail.items || []).length) return;
    const displayId = detail.orderNumber ? ("RM-" + String(detail.orderNumber).padStart(6, "0")) : (detail.id || window.ReymeroOrder.createOrderId(detail.validatedAt));
    current = {
      detail: detail,
      id: displayId,
      orderId: detail.orderId || detail.id || null
    };
    open();
  }

  function build() {
    if (!window.ReymeroOrder || document.getElementById(MODAL_ID)) return;

    if (!document.getElementById(STYLE_ID)) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      document.head.appendChild(style);
    }

    backdrop = el("div", "rm-receipt-backdrop");
    backdrop.id = BACKDROP_ID;
    backdrop.setAttribute("aria-hidden", "true");

    modal = el("section", "rm-receipt");
    modal.id = MODAL_ID;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-label", "Comprobante del pedido");
    modal.setAttribute("aria-hidden", "true");
    if ("inert" in modal) modal.inert = true;

    const head = el("div", "rm-receipt-head");
    head.appendChild(el("h2", null, "Pedido listo"));
    closeBtn = el("button", "rm-receipt-close", "×");
    closeBtn.id = "rmReceiptClose";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Cerrar comprobante");
    head.appendChild(closeBtn);
    modal.appendChild(head);

    bodyEl = el("div", "rm-receipt-body");
    bodyEl.id = "rmReceiptBody";
    modal.appendChild(bodyEl);

    const foot = el("div", "rm-receipt-foot");
    const row1 = el("div", "rm-receipt-row");
    const whatsapp = el("button", "rm-receipt-btn primary", "Enviar por WhatsApp");
    whatsapp.id = "rmReceiptWhatsapp";
    whatsapp.type = "button";
    const copy = el("button", "rm-receipt-btn", "Copiar texto");
    copy.id = "rmReceiptCopy";
    copy.type = "button";
    row1.appendChild(whatsapp);
    row1.appendChild(copy);
    foot.appendChild(row1);

    const row2 = el("div", "rm-receipt-row");
    const pdf = el("button", "rm-receipt-btn", "Descargar PDF");
    pdf.id = "rmReceiptPdf";
    pdf.type = "button";
    const share = el("button", "rm-receipt-btn", "Compartir comprobante");
    share.id = "rmReceiptShare";
    share.type = "button";
    row2.appendChild(pdf);
    row2.appendChild(share);
    foot.appendChild(row2);
    modal.appendChild(foot);

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);

    closeBtn.addEventListener("click", close);
    backdrop.addEventListener("click", close);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("open")) close();
    });
    window.addEventListener("reymero:checkout-validated", onValidated);

    whatsapp.addEventListener("click", function () {
      const cfg = window.ReymeroConfig || {};
      const url = "https://wa.me/" + encodeURIComponent(cfg.WHATSAPP || "") +
        "?text=" + encodeURIComponent(orderText());
      const target = window.ReymeroShare.isNative() ? "_system" : "_blank";
      window.open(url, target, "noopener");
    });

    copy.addEventListener("click", async function () {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(orderText());
          if (typeof window.toast === "function") window.toast("Texto del pedido copiado");
        } else {
          await window.ReymeroShare.shareText(orderText(), "Pedido Reymero3d");
        }
      } catch (e) {
        if (typeof window.toast === "function") window.toast("No se pudo copiar el texto");
      }
    });

    pdf.addEventListener("click", function () {
      try {
        const doc = makePdf();
        doc.save(pdfFilename());
      } catch (e) {
        if (typeof window.toast === "function") window.toast("No se pudo generar el PDF");
      }
    });

    share.addEventListener("click", async function () {
      try {
        const doc = makePdf();
        const blob = doc.output("blob");
        await window.ReymeroShare.sharePdf(blob, pdfFilename(), orderText(), "Comprobante Reymero3d");
      } catch (e) {
        if (typeof window.toast === "function") window.toast("No se pudo compartir el comprobante");
      }
    });

    window.ReymeroReceipt = Object.freeze({
      open: open,
      close: close,
      makePdf: makePdf,
      orderText: orderText,
      getOrder: function () { return current; }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", build);
  } else {
    build();
  }
})();
