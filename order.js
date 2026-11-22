/* Utilidades públicas para armar el pedido por WhatsApp y el comprobante.
   No envía nada automáticamente: solo construye textos e identificadores. */
(function (global) {
  "use strict";

  function money(value) {
    const n = Number.isFinite(Number(value)) ? Number(value) : 0;
    return "$ " + n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function pad(n) { return String(n).padStart(2, "0"); }

  function createOrderId(value) {
    const d = value ? new Date(value) : new Date();
    const valid = d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
    const stamp = valid.getFullYear() + pad(valid.getMonth() + 1) + pad(valid.getDate()) + "-" +
      pad(valid.getHours()) + pad(valid.getMinutes());
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    return "RM-" + stamp + "-" + suffix;
  }

  function formatDate(value) {
    const d = value ? new Date(value) : new Date();
    const valid = d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date();
    return valid.toLocaleString("es-AR", {
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit"
    });
  }

  function buildOrderText(detail, id) {
    const d = detail || {};
    const items = d.items || [];
    const orderId = id || d.id || createOrderId(d.validatedAt);
    const lines = items.map(function (item, i) {
      const qty = Number(item.qty) || 1;
      const price = Number(item.price) || 0;
      const text = (i + 1) + ") " + qty + " × " + String(item.name || "Producto") +
        " — " + money(price) + " c/u = " + money(Number(item.subtotal != null ? item.subtotal : price * qty));
      return item.note ? text + "\n    Obs: " + String(item.note) : text;
    });

    return [
      "Hola Reymero3d! Quiero confirmar este pedido:",
      "",
      "Pedido: " + orderId,
      "Fecha: " + formatDate(d.validatedAt),
      "",
      ...lines,
      "",
      "Observaciones generales: " + (d.notes ? String(d.notes) : "-"),
      "Total: " + money(d.subtotal),
      "",
      "Precios y stock verificados al generar el pedido."
    ].join("\n");
  }

  global.ReymeroOrder = Object.freeze({
    money: money,
    createOrderId: createOrderId,
    formatDate: formatDate,
    buildOrderText: buildOrderText
  });
})(window);
