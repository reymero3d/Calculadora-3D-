/* Comprobante visual, datos de transferencia y subida de comprobante (Etapas 3-4 + pago).
   No marca el pedido como pagado: solo registra comprobante recibido / pendiente de verificación. */
(function () {
  "use strict";

  const STYLE_ID = "rmReceiptStyles";
  const MODAL_ID = "rmReceiptModal";
  const BACKDROP_ID = "rmReceiptBackdrop";

  let modal = null, backdrop = null, closeBtn = null, bodyEl = null;
  let lastFocus = null, previousOverflow = "";
  let current = null; // { detail, id, orderId }
  let uploading = false;

  const CSS = `
    .rm-receipt-backdrop { position:fixed; inset:0; z-index:80; background:rgba(28,25,23,.6); opacity:0; pointer-events:none; transition:opacity .2s; }
    .rm-receipt-backdrop.open { opacity:1; pointer-events:auto; }
    .rm-receipt { position:fixed; z-index:81; left:50%; top:50%; transform:translate(-50%,-48%) scale(.98); width:min(680px,calc(100% - 2rem)); max-height:92vh; display:flex; flex-direction:column; background:var(--surface); color:var(--text); border:1px solid var(--border); border-radius:14px; box-shadow:var(--shadow-lg); opacity:0; pointer-events:none; transition:opacity .2s,transform .2s; }
    .rm-receipt.open { opacity:1; pointer-events:auto; transform:translate(-50%,-50%) scale(1); }
    .rm-receipt-head { display:flex; align-items:center; justify-content:space-between; gap:1rem; padding:1.1rem 1.25rem; border-bottom:1px solid var(--border); }
    .rm-receipt-head h2 { margin:0; font-family:"Fraunces","Segoe UI",serif; font-size:1.3rem; }
    .rm-receipt-close { width:2rem; height:2rem; border:1px solid var(--border); border-radius:6px; background:var(--surface); color:var(--text); cursor:pointer; font-size:1.1rem; line-height:1; }
    .rm-receipt-body { overflow:auto; padding:1.25rem; }
    .rm-receipt-brand { font-family:"JetBrains Mono",monospace; font-size:.7rem; text-transform:uppercase; letter-spacing:.14em; color:var(--accent); font-weight:800; }
    .rm-receipt-title { margin:.25rem 0 1rem; font-family:"Fraunces","Segoe UI",serif; font-size:1.5rem; }
    .rm-receipt-meta { display:grid; grid-template-columns:1fr 1fr; gap:.5rem 1rem; padding:.85rem; margin-bottom:1rem; background:var(--surface-2); border-radius:8px; font-family:"JetBrains Mono",monospace; font-size:.75rem; }
    .rm-receipt-meta span { color:var(--muted); }
    .rm-receipt-meta b { display:block; margin-top:.15rem; color:var(--text); word-break:break-word; }
    .rm-pay { margin:0 0 1rem; padding:1rem; border:1.5px solid var(--border); border-radius:10px; background:linear-gradient(180deg, var(--surface-2), var(--surface)); }
    .rm-pay h4 { margin:0 0 .6rem; font-size:.78rem; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
    .rm-pay-grid { display:grid; grid-template-columns:1fr 1fr; gap:.5rem .75rem; font-size:.84rem; }
    .rm-pay-grid span { color:var(--muted); font-size:.72rem; display:block; }
    .rm-pay-grid b { color:var(--text); word-break:break-word; }
    .rm-pay-actions { display:flex; gap:.5rem; flex-wrap:wrap; margin-top:.85rem; }
    .rm-pay-note { margin:.7rem 0 0; font-size:.72rem; color:var(--muted); line-height:1.45; }
    .rm-upload { margin:0 0 1rem; padding:1rem; border:1px dashed var(--border); border-radius:10px; background:var(--surface); }
    .rm-upload h4 { margin:0 0 .5rem; font-size:.78rem; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
    .rm-upload input[type=file] { width:100%; font-size:.8rem; color:var(--text); }
    .rm-upload-status { margin-top:.6rem; font-size:.75rem; color:var(--muted); line-height:1.4; min-height:1.2em; }
    .rm-upload-status.ok { color:var(--green); font-weight:600; }
    .rm-upload-status.err { color:var(--accent); font-weight:600; }
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
    .rm-receipt-btn:hover:not(:disabled) { border-color:var(--accent); color:var(--accent); }
    .rm-receipt-btn:disabled { opacity:.55; cursor:default; }
    .rm-receipt-btn.primary { border-color:var(--accent); background:var(--accent); color:#fff; font-family:"JetBrains Mono",monospace; font-size:.72rem; text-transform:uppercase; letter-spacing:.04em; }
    .rm-receipt-btn.primary:hover:not(:disabled) { background:var(--accent-dark); }
    .rm-receipt-close:focus-visible, .rm-receipt-btn:focus-visible { outline:3px solid rgba(185,28,28,.35); outline-offset:2px; }
    @media (max-width:640px) { .rm-receipt { width:calc(100% - 1.5rem); } .rm-receipt-meta,.rm-pay-grid,.rm-receipt-row { grid-template-columns:1fr; } }
    @media (prefers-reduced-motion:reduce) { .rm-receipt,.rm-receipt-backdrop { transition:none; } }
  `;

  function money(value) { return window.ReymeroOrder.money(value); }
  function el(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text != null) n.textContent = String(text); return n; }
  function orderText() { return window.ReymeroOrder.buildOrderText(current && current.detail, current && current.id); }
  function pdfFilename() { return "pedido-" + (current ? current.id : "reymero3d") + ".pdf"; }
  function getSb() { const cfg = window.ReymeroConfig || {}; return window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY); }
  function safeName(name) { return String(name || "comprobante").replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").slice(0, 120) || "comprobante"; }

  function makePdf() {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("jsPDF no disponible");
    const d = current.detail;
    const customer = d.customer || {};
    const shipping = d.shipping || {};
    const doc = new window.jspdf.jsPDF({ unit: "pt", format: "a4" });
    const left = 50, right = 545; let y = 56;
    function ensure(h) { if (y + (h || 20) > 760) { doc.addPage(); y = 56; } }
    function line(text, opts) {
      opts = opts || {}; doc.setFont("helvetica", opts.bold ? "bold" : "normal"); doc.setFontSize(opts.size || 10);
      const lines = doc.splitTextToSize(String(text || ""), opts.width || 495);
      ensure(lines.length * (opts.lh || 13) + 2); doc.text(lines, left, y); y += lines.length * (opts.lh || 13);
    }
    doc.setFont("helvetica", "bold"); doc.setFontSize(20); doc.text("Reymero3d", left, y); y += 20;
    doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.text("Comprobante de pedido", left, y); y += 20;
    line("Pedido: " + current.id);
    line("Fecha: " + window.ReymeroOrder.formatDate(d.createdAt || d.validatedAt));
    line("Estado: " + (d.statusLabel || "Pendiente de confirmación"));
    line("Pago: " + (d.paymentStatus === "receipt_uploaded" ? "Comprobante recibido (pendiente de verificación)" : "No pagado / pendiente de comprobante"));
    y += 4; doc.setDrawColor(200); doc.line(left, y, right, y); y += 16;
    line("Cliente", { bold: true, size: 11, lh: 14 });
    line("Nombre: " + (customer.fullName || "-"));
    line("Teléfono: " + (customer.phone || "-"));
    if (customer.email) line("Email: " + customer.email);
    y += 6; line("Entrega", { bold: true, size: 11, lh: 14 });
    line("Método: " + (d.deliveryMethod === "pickup_agreed" ? "Retiro acordado" : "Envío"));
    if (d.deliveryMethod === "shipping") {
      const addr = [shipping.address, shipping.city, shipping.province, shipping.postalCode].filter(Boolean).join(", ");
      if (addr) line("Dirección: " + addr);
      if (shipping.references) line("Referencias: " + shipping.references);
    }
    y += 6; doc.setDrawColor(200); doc.line(left, y, right, y); y += 16;
    line("Productos", { bold: true, size: 11, lh: 14 });
    (d.items || []).forEach(function (item, i) {
      const qty = Number(item.qty) || 1, price = Number(item.price) || 0, sub = Number(item.subtotal != null ? item.subtotal : price * qty);
      ensure(40); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
      const nameLines = doc.splitTextToSize((i + 1) + ") " + String(item.name || "Producto"), 360);
      doc.text(nameLines, left, y); y += nameLines.length * 13;
      doc.setFont("helvetica", "normal"); doc.text(qty + " x " + money(price) + " c/u", left + 12, y);
      doc.text(money(sub), right, y, { align: "right" }); y += 14;
      y += 4;
    });
    ensure(60); doc.setDrawColor(200); doc.line(left, y, right, y); y += 22;
    doc.setFont("helvetica", "bold"); doc.setFontSize(14); doc.text("Total estimado", left, y);
    doc.setFontSize(16); doc.text(money(d.total != null ? d.total : d.subtotal), right, y, { align: "right" }); y += 24;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    const disclaimer = d.paymentStatus === "receipt_uploaded"
      ? "Comprobante recibido. Pago pendiente de verificación. La apertura de WhatsApp no confirma la aceptación final del pedido."
      : "Pedido registrado como pendiente. No pagado. La apertura de WhatsApp no confirma la aceptación final del pedido. Precios y stock verificados al generar el pedido.";
    doc.text(doc.splitTextToSize(disclaimer, 495), left, y);
    return doc;
  }

  function render() {
    if (!bodyEl || !current) return;
    const d = current.detail;
    const customer = d.customer || {};
    const shipping = d.shipping || {};
    const t = (window.ReymeroConfig && window.ReymeroConfig.TRANSFER) || {};
    const uploaded = d.paymentStatus === "receipt_uploaded" || d.paymentStatus === "verified";
    bodyEl.textContent = "";

    bodyEl.appendChild(el("div", "rm-receipt-brand", "Reymero3d · Impresión 3D"));
    bodyEl.appendChild(el("h3", "rm-receipt-title", uploaded ? "Comprobante recibido" : "Datos para el pago"));

    const meta = el("div", "rm-receipt-meta");
    [["Número de pedido", current.id],
     ["Fecha", window.ReymeroOrder.formatDate(d.createdAt || d.validatedAt)],
     ["Estado pedido", d.statusLabel || "Pendiente de confirmación"],
     ["Pago", uploaded ? "Comprobante recibido / pendiente de verificación" : "Pendiente de comprobante"]].forEach(function (pair) {
      const box = el("div"); box.appendChild(el("span", null, pair[0])); box.appendChild(el("b", null, pair[1])); meta.appendChild(box);
    });
    bodyEl.appendChild(meta);

    // Transferencia
    const pay = el("div", "rm-pay");
    pay.appendChild(el("h4", null, "Datos de transferencia"));
    const grid = el("div", "rm-pay-grid");
    [["Alias", t.alias || "-"], ["Titular", t.holder || "-"], ["DNI", t.dni || "-"], ["Banco / Entidad", t.bank || "-"]].forEach(function (p) {
      const cell = el("div"); cell.appendChild(el("span", null, p[0])); cell.appendChild(el("b", null, p[1])); grid.appendChild(cell);
    });
    pay.appendChild(grid);
    const payActions = el("div", "rm-pay-actions");
    const copyAlias = el("button", "rm-receipt-btn", "Copiar alias"); copyAlias.type = "button"; copyAlias.id = "rmPayCopyAlias";
    payActions.appendChild(copyAlias); pay.appendChild(payActions);
    pay.appendChild(el("p", "rm-pay-note", "Transferí el total estimado e subí el comprobante. El pedido queda pendiente hasta que verifiquemos el pago. No se marca como pagado automáticamente."));
    bodyEl.appendChild(pay);

    // Upload
    const up = el("div", "rm-upload");
    up.appendChild(el("h4", null, "Comprobante de pago"));
    if (uploaded) {
      up.appendChild(el("p", "rm-upload-status ok", "Comprobante recibido. Pendiente de verificación por Reymero3d."));
    } else {
      const input = document.createElement("input"); input.type = "file"; input.id = "rmReceiptFile"; input.accept = "image/jpeg,image/png,image/webp,application/pdf";
      up.appendChild(input);
      const upActions = el("div", "rm-pay-actions"); upActions.style.marginTop = ".75rem";
      const upBtn = el("button", "rm-receipt-btn primary", "Subir comprobante"); upBtn.type = "button"; upBtn.id = "rmReceiptUploadBtn";
      upActions.appendChild(upBtn); up.appendChild(upActions);
      up.appendChild(el("p", "rm-upload-status", "Formatos: JPG, PNG, WebP o PDF. Máximo 10 MB. El carrito se vacía recién después de subirlo correctamente. No modifiques el carrito hasta subir el comprobante: el pedido ya fue registrado con estos productos."));
      const st = el("div", "rm-upload-status"); st.id = "rmReceiptUploadStatus"; up.appendChild(st);
    }
    bodyEl.appendChild(up);

    // Cliente / entrega
    const infoBlock = el("div", "rm-receipt-notes");
    infoBlock.appendChild(el("b", null, "Datos del cliente / entrega"));
    const info = ["Cliente: " + (customer.fullName || "-"), "Teléfono: " + (customer.phone || "-")];
    if (customer.email) info.push("Email: " + customer.email);
    info.push("Entrega: " + (d.deliveryMethod === "pickup_agreed" ? "Retiro acordado" : "Envío"));
    if (d.deliveryMethod === "shipping") {
      const addr = [shipping.address, shipping.city, shipping.province, shipping.postalCode].filter(Boolean).join(", ");
      if (addr) info.push("Dirección: " + addr);
      if (shipping.references) info.push("Referencias: " + shipping.references);
    }
    infoBlock.appendChild(el("p", null, info.join("\n"))); bodyEl.appendChild(infoBlock);

    (d.items || []).forEach(function (item, i) {
      const qty = Number(item.qty) || 1, price = Number(item.price) || 0, sub = Number(item.subtotal != null ? item.subtotal : price * qty);
      const row = el("div", "rm-receipt-line"); const leftInfo = el("div");
      leftInfo.appendChild(el("div", "rm-receipt-line-name", (i + 1) + ") " + String(item.name || "Producto")));
      leftInfo.appendChild(el("div", "rm-receipt-line-meta", qty + " × " + money(price) + " c/u"));
      row.appendChild(leftInfo); row.appendChild(el("div", "rm-receipt-line-sub", money(sub))); bodyEl.appendChild(row);
    });

    const total = el("div", "rm-receipt-total"); total.appendChild(el("span", null, "Total estimado"));
    total.appendChild(el("b", null, money(d.total != null ? d.total : d.subtotal))); bodyEl.appendChild(total);
    bodyEl.appendChild(el("p", "rm-receipt-disclaimer", uploaded
      ? "Comprobante recibido. Pago pendiente de verificación. La apertura de WhatsApp no confirma la aceptación final del pedido."
      : "Pedido registrado como pendiente. No pagado. Subí el comprobante para que podamos verificar tu pago. La apertura de WhatsApp no confirma la aceptación final del pedido."));
  }

  function open() {
    if (!current || (modal && modal.classList.contains("open"))) return;
    if (window.ReymeroCheckout && window.ReymeroCheckout.getState().open) window.ReymeroCheckout.close();
    lastFocus = document.activeElement; previousOverflow = document.body.style.overflow;
    render();
    document.body.style.overflow = "hidden";
    const app = document.querySelector(".app"); if (app && "inert" in app) app.inert = true;
    backdrop.classList.add("open"); modal.classList.add("open"); modal.setAttribute("aria-hidden", "false");
    if ("inert" in modal) modal.inert = false;
    try { closeBtn.focus(); } catch (e) {}
  }

  function close() {
    if (!modal || !modal.classList.contains("open")) return;
    backdrop.classList.remove("open"); modal.classList.remove("open"); modal.setAttribute("aria-hidden", "true");
    if ("inert" in modal) modal.inert = true;
    document.body.style.overflow = previousOverflow;
    const app = document.querySelector(".app"); if (app && "inert" in app) app.inert = false;
    const visible = lastFocus && lastFocus.isConnected && lastFocus.getClientRects().length && !(lastFocus.closest && lastFocus.closest("[inert]"));
    const target = visible ? lastFocus : document.getElementById("rmCartFab");
    if (target && typeof target.focus === "function") { try { target.focus(); } catch (e) {} }
  }

  function onValidated(e) {
    const detail = e && e.detail;
    if (!detail || !(detail.items || []).length) return;
    const displayId = detail.orderNumber ? ("RM-" + String(detail.orderNumber).padStart(6, "0")) : (detail.id || window.ReymeroOrder.createOrderId(detail.validatedAt));
    current = { detail: detail, id: displayId, orderId: detail.orderId || detail.id || null };
    open();
  }

  async function uploadReceipt() {
    if (uploading || !current || !current.detail) return;
    const d = current.detail;
    if (!d.orderId || !d.receiptToken) { setUploadStatus("Falta información del pedido para subir el comprobante.", true); return; }
    const input = document.getElementById("rmReceiptFile");
    const file = input && input.files && input.files[0];
    if (!file) { setUploadStatus("Seleccioná un archivo JPG, PNG, WebP o PDF.", true); return; }
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (allowed.indexOf(file.type) < 0) { setUploadStatus("Formato no permitido. Usá JPG, PNG, WebP o PDF.", true); return; }
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) { setUploadStatus("El archivo debe pesar hasta 10 MB.", true); return; }

    uploading = true;
    const btn = document.getElementById("rmReceiptUploadBtn"); if (btn) { btn.disabled = true; btn.textContent = "Subiendo..."; }
    setUploadStatus("Subiendo comprobante...", false);
    try {
      const path = d.orderId + "/" + d.receiptToken + "/" + Date.now() + "-" + safeName(file.name);
      const sb = getSb();
      const up = await sb.storage.from("order-receipts").upload(path, file, { contentType: file.type, upsert: false });
      if (up.error) throw up.error;
      const reg = await sb.rpc("register_order_receipt", {
        p_order_id: d.orderId,
        p_receipt_token: d.receiptToken,
        p_path: path,
        p_file_name: file.name,
        p_mime: file.type,
        p_size: file.size
      });
      if (reg.error) throw reg.error;

      d.paymentStatus = "receipt_uploaded";
      d.paymentReceiptUploadedAt = (reg.data && reg.data.payment_receipt_uploaded_at) || new Date().toISOString();
      if (window.ReymeroCheckout && window.ReymeroCheckout.setPending) window.ReymeroCheckout.setPending(d);
      if (window.ReymeroCart) window.ReymeroCart.clear();
      if (window.ReymeroCheckout && window.ReymeroCheckout.clearPending) window.ReymeroCheckout.clearPending();
      // mantener d en memoria pero pending ya limpiado; el modal muestra estado recibido
      setUploadStatus("Comprobante recibido. Pendiente de verificación.", false);
      render();
      if (typeof window.toast === "function") window.toast("Comprobante recibido");
    } catch (err) {
      console.warn("Error subiendo comprobante", err);
      setUploadStatus("No se pudo subir el comprobante. " + (err && err.message ? err.message : "Intentá de nuevo."), true);
    } finally {
      uploading = false;
      const b = document.getElementById("rmReceiptUploadBtn"); if (b) { b.disabled = false; b.textContent = "Subir comprobante"; }
    }
  }

  function setUploadStatus(msg, isErr) {
    const st = document.getElementById("rmReceiptUploadStatus");
    if (st) { st.textContent = msg || ""; st.className = "rm-upload-status" + (msg ? (isErr ? " err" : " ok") : ""); }
  }

  function build() {
    if (!window.ReymeroOrder || document.getElementById(MODAL_ID)) return;
    if (!document.getElementById(STYLE_ID)) { const style = document.createElement("style"); style.id = STYLE_ID; style.textContent = CSS; document.head.appendChild(style); }

    backdrop = el("div", "rm-receipt-backdrop"); backdrop.id = BACKDROP_ID; backdrop.setAttribute("aria-hidden", "true");
    modal = el("section", "rm-receipt"); modal.id = MODAL_ID; modal.setAttribute("role", "dialog"); modal.setAttribute("aria-modal", "true"); modal.setAttribute("aria-label", "Pago y comprobante del pedido"); modal.setAttribute("aria-hidden", "true");
    if ("inert" in modal) modal.inert = true;

    const head = el("div", "rm-receipt-head"); head.appendChild(el("h2", null, "Pedido registrado"));
    closeBtn = el("button", "rm-receipt-close", "×"); closeBtn.id = "rmReceiptClose"; closeBtn.type = "button"; closeBtn.setAttribute("aria-label", "Cerrar"); head.appendChild(closeBtn); modal.appendChild(head);

    bodyEl = el("div", "rm-receipt-body"); bodyEl.id = "rmReceiptBody"; modal.appendChild(bodyEl);

    // Acciones de compartir/descargar removidas por solicitud; el cierre queda en la cabecera.

    document.body.appendChild(backdrop); document.body.appendChild(modal);

    closeBtn.addEventListener("click", close);
    backdrop.addEventListener("click", close);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && modal.classList.contains("open")) close(); });
    window.addEventListener("reymero:checkout-validated", onValidated);

    bodyEl.addEventListener("click", function (e) {
      if (e.target && e.target.id === "rmPayCopyAlias") {
        const alias = (window.ReymeroConfig && window.ReymeroConfig.TRANSFER && window.ReymeroConfig.TRANSFER.alias) || "";
        const p = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(alias) : Promise.reject();
        p.then(() => { if (typeof window.toast === "function") window.toast("Alias copiado"); }).catch(() => {});
      }
      if (e.target && e.target.id === "rmReceiptUploadBtn") uploadReceipt();
    });

    // Botones WhatsApp/copiar/PDF/compartir removidos por solicitud.

    window.ReymeroReceipt = Object.freeze({
      open: open, close: close, makePdf: makePdf, orderText: orderText,
      getOrder: function () { return current; }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build); else build();
})();