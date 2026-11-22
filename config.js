/* Configuración pública compartida por la tienda y el detalle de producto.
   Solo datos públicos: nunca service_role, tokens admin ni costos internos. */
(function (global) {
  "use strict";
  global.ReymeroConfig = Object.freeze({
    SUPABASE_URL: "https://ylpgluuwxegcmubgqvls.supabase.co",
    SUPABASE_ANON_KEY: "sb_publishable_kJJSRv8NgGjA3AHNHFEtSg_tpCb39bo",
    WHATSAPP: "5491167994767",
    CART_KEY: "reymero-cart-v1",
    TRANSFER: Object.freeze({
      alias: "Reymero3d",
      holder: "Esteban Rodrigo Reynoso",
      dni: "43507449",
      bank: "Conexion De Altura SA"
    })
  });
})(window);
