# Etapa 1 — Propuesta de esquema/RLS/RPC (sin aplicar)

Archivos:
- `001_orders_checkout_proposal.sql`: borrador SQL para revisar/ejecutar manualmente en Supabase SQL Editor.

## Qué cubre
- `customer_profiles`: datos opcionales de cliente autenticado para autofill.
- `admin_users` + `is_admin()`: autorización admin formal en DB.
- `orders`: pedido con cliente, entrega, facturación opcional, totales calculados por servidor, estado, idempotency key.
- `order_items`: snapshot de producto/precio/cantidad al momento del pedido.
- `order_status_history`: auditoría de cambios de estado.
- RLS: dueño lee sus perfiles/pedidos; admin gestiona; anon/authenticated no insertan directo en tablas de pedidos.
- RPC `create_shop_order(payload, idempotency_key)`: valida, verifica productos publicados/en stock, recalcula precios/totales en servidor, crea pedido atómicamente, evita duplicados por idempotency.
- RPC `admin_update_order_status(...)`: solo admin.

## Supuestos / decisiones por defecto
- `products.id` es **UUID**. Confirmar antes de ejecutar; si no, ajustar `order_items.product_id` y casts.
- Pedido invitado: `user_id null`, `customer_type='guest'`. No hay lectura pública del pedido; el comprobante se entrega en la respuesta/UI.
- `delivery_method='shipping'` exige provincia/localidad/dirección/CP. `pickup_agreed` no los exige.
- Facturación opcional y separada: `billing_requested` + nombre/documento/domicilio fiscal. Ajustar campos si se necesita formato AFIP específico.
- Estados: `pending`, `confirmed`, `preparing`, `ready`, `delivered`, `cancelled`.
- Número visible: `order_number` identity (legible). Se puede formatear como `RM-000123` en UI.

## Checklist de revisión antes de ejecutar
1. Confirmar tipo real de `products.id` y compatibilidad con `order_items.product_id`.
2. Revisar políticas RLS existentes; este script no las modifica, pero agrega tablas nuevas.
3. Insertar al menos un admin en `admin_users` tras ejecutar.
4. Probar con SQL/Auth:
   - anon `insert into orders` directo: **debe fallar**.
   - anon RPC `create_shop_order` válido: **debe crear** pedido pendiente.
   - RPC con producto no publicado/sin stock/precio manipulado: **debe fallar** o usar precio DB.
   - mismo `idempotency_key`: **debe devolver duplicado**, no crear otro.
   - usuario A leyendo pedido de B: **debe fallar**.
   - admin `admin_update_order_status`: **debe funcionar** y registrar historial.
5. Definir protección anti-abuso para RPC anon (rate limit en edge/WAF/captcha/umbral), porque queda expuesta a anon/authenticated.

## Ajustes recomendados para Etapa 2 (frontend)
- El frontend debe generar `idempotency_key` por intento de checkout y reutilizarla en reintentos.
- El frontend no debe enviar totales confiables; el RPC los recalcula. El UI puede mostrar estimado, pero el comprobante final usa respuesta del servidor.
- Tras crear pedido OK: limpiar carrito, mostrar comprobante con estado `Pendiente` y texto “No pagado / pendiente de confirmación por el comercio”.
- Abrir WhatsApp no debe cambiar estado.

## No aplicado
No se ejecutó SQL en Supabase ni se modificó frontend. Este entregable es solo propuesta para revisión.