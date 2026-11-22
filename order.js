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

  function deliveryLabel(method) {
    return method === "pickup_agreed" ? "Retiro acordado" : "Envío";
  }

  function formatOrderId(id, detail) {
    if (id && /^RM-/.test(String(id))) return String(id);
    const num = detail && detail.orderNumber != null ? detail.orderNumber : (/^\d+$/.test(String(id || "")) ? id : null);
    if (num != null && num !== "") return "RM-" + String(num).padStart(6, "0");
    return id ? String(id) : createOrderId((detail && (detail.createdAt || detail.validatedAt)) || undefined);
  }

  function buildOrderText(detail, id) {
    const d = detail || {};
    const items = d.items || [];
    const orderId = formatOrderId(id, d);
    const date = d.createdAt || d.validatedAt;
    const customer = d.customer || {};
    const shipping = d.shipping || {};
    const lines = items.map(function (item, i) {
      const qty = Number(item.qty) || 1;
      const price = Number(item.price) || 0;
      const text = (i + 1) + ") " + qty + " × " + String(item.name || "Producto") +
        " — " + money(price) + " c/u = " + money(Number(item.subtotal != null ? item.subtotal : price * qty));
      return item.note ? text + "\n    Obs: " + String(item.note) : text;
    });

    const delivery = [];
    delivery.push("Método: " + deliveryLabel(d.deliveryMethod));
    if (d.deliveryMethod === "shipping") {
      const addr = [shipping.address, shipping.city, shipping.province, shipping.postalCode].filter(Boolean).join(", ");
      if (addr) delivery.push("Dirección: " + addr);
      if (shipping.references) delivery.push("Referencias: " + shipping.references);
    }

    const out = [
      "Hola Reymero3d! Quiero confirmar este pedido:",
      "",
      "Pedido: " + orderId,
      "Fecha: " + formatDate(date),
      "Estado: Pendiente de confirmación",
      "Pago: No pagado",
      "",
      "Cliente: " + (customer.fullName || "-"),
      "Teléfono: " + (customer.phone || "-"),
    ];
    if (customer.email) out.push("Email: " + customer.email);
    out.push("");
    out.push("Entrega:");
    delivery.forEach(function (l) { out.push("- " + l); });
    out.push("");
    out.push("Productos:");
    out.push(...lines);
    out.push("");
    out.push("Observaciones generales: " + (d.notes ? String(d.notes) : "-"));
    out.push("Total estimado: " + money(d.total != null ? d.total : d.subtotal));
    out.push("");
    out.push("Precios y stock verificados al generar el pedido. Este mensaje no confirma el pago ni la aceptación final del pedido.");
    return out.join("\n");
  }

  global.ReymeroOrder = Object.freeze({
    money: money,
    createOrderId: createOrderId,
    formatDate: formatDate,
    buildOrderText: buildOrderText
  });
})(window);
