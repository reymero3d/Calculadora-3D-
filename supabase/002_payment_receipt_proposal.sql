-- PROPUESTA ETAPA 2b — Comprobante de pago / datos de transferencia
-- Estado: BORRADOR PARA REVISIÓN. NO ejecutar sin aprobación.
-- No modifica tablas existentes de productos; extiende orders y agrega Storage/RLS/RPC.
--
-- Objetivo
-- 1) Tras crear pedido, mostrar datos de transferencia bancaria.
-- 2) Permitir subir comprobante (imagen/PDF) al pedido.
-- 3) NO vaciar carrito hasta que el comprobante se suba correctamente.
-- 4) El comprobante NO marca el pedido como pagado; solo como "recibido / pendiente de verificación".
--
-- Decisiones de diseño
-- - orders recibe campos de comprobante y receipt_token (capability token para upload guest).
-- - payment_status separado de status del pedido:
--     pending_payment      = pedido creado, esperando comprobante
--     receipt_uploaded     = comprobante cargado, pendiente verificación admin
--     verified             = admin verificó pago (futuro)
--     waived/not_required  = reservado (no usado por ahora)
--   El status operativo del pedido (pending/confirmed/...) se mantiene como está.
-- - Bucket Storage privado `order-receipts`.
-- - Ruta de archivo: <order_id>/<receipt_token>/<timestamp>-<safe_filename>
--   El receipt_token en la ruta funciona como capability para invitados (UUID impredecible).
-- - Admin puede ver/descargar comprobantes. Cliente autenticado puede ver los suyos.
-- - Anon NO puede listar/leer; solo puede insertar por RPC helper/policy controlada.
--
-- RIESGOS / PENDIENTES A CONFIRMAR ANTES DE EJECUTAR
-- 1) Storage RLS en storage.objects: verificar que las políticas con función SECURITY DEFINER
--    funcionen en el proyecto Supabase actual. Probar con upload anon y autenticado.
-- 2) Tamaño máximo: proponer 10MB por archivo. Confirmar límite del bucket/proyecto.
-- 3) MIME permitidos: image/jpeg, image/png, image/webp, application/pdf.
-- 4) Pedidos viejos: quedan con payment_status NULL/'not_required' según migración; definir default.
-- 5) Un pedido puede tener 1 comprobante activo por ahora (reemplazo opcional: decidir).
-- 6) Abuso: rate limiting/WAF externo sigue pendiente para RPCs anon.

begin;

-- ---------------------------------------------------------------------------
-- 1) Campos de pago/comprobante en orders
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists payment_status text not null default 'pending_payment'
    check (payment_status in ('pending_payment','receipt_uploaded','verified','not_required')),
  add column if not exists receipt_token uuid not null default gen_random_uuid(),
  add column if not exists payment_receipt_path text null check (payment_receipt_path is null or char_length(payment_receipt_path) <= 500),
  add column if not exists payment_receipt_name text null check (payment_receipt_name is null or char_length(payment_receipt_name) <= 255),
  add column if not exists payment_receipt_mime text null check (payment_receipt_mime is null or char_length(payment_receipt_mime) <= 100),
  add column if not exists payment_receipt_size integer null check (payment_receipt_size is null or (payment_receipt_size > 0 and payment_receipt_size <= 10485760)),
  add column if not exists payment_receipt_uploaded_at timestamptz null,
  add column if not exists payment_verified_at timestamptz null,
  add column if not exists payment_verified_by uuid null references auth.users(id) on delete set null;

create index if not exists orders_payment_status_idx on public.orders(payment_status, created_at desc);
create index if not exists orders_receipt_token_idx on public.orders(receipt_token);

-- Pedidos ya existentes antes de esta migración: no exigir comprobante retroactivo.
-- IMPORTANTE: revisar esta ventana antes de ejecutar. El objetivo es no marcar como
-- not_required pedidos nuevos creados durante el deploy.
-- update public.orders
-- set payment_status = 'not_required'
-- where payment_status = 'pending_payment'
--   and created_at < now() - interval '1 hour';

-- ---------------------------------------------------------------------------
-- 2) Helper: validar posibilidad de subir comprobante
--    Acepta text para uso seguro desde policies de storage.objects (evita cast inválido).
-- ---------------------------------------------------------------------------
create or replace function public.can_upload_order_receipt(p_order_id_text text, p_receipt_token_text text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_token uuid;
begin
  v_order_id := p_order_id_text::uuid;
  v_token := p_receipt_token_text::uuid;
  return exists (
    select 1
    from public.orders o
    where o.id = v_order_id
      and o.receipt_token = v_token
      and o.payment_status in ('pending_payment', 'receipt_uploaded') -- permite reemplazo mientras no verificado
      and o.status not in ('cancelled')
  );
exception when others then
  return false;
end;
$$;

revoke all on function public.can_upload_order_receipt(text, text) from public;
grant execute on function public.can_upload_order_receipt(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) RPC: registrar comprobante subido (llamar DESPUÉS de upload exitoso a Storage)
-- ---------------------------------------------------------------------------
create or replace function public.register_order_receipt(
  p_order_id uuid,
  p_receipt_token uuid,
  p_path text,
  p_file_name text,
  p_mime text,
  p_size integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_path text := btrim(coalesce(p_path, ''));
  v_name text := left(btrim(coalesce(p_file_name, 'comprobante')), 255);
  v_mime text := lower(btrim(coalesce(p_mime, '')));
  v_size integer := coalesce(p_size, 0);
  v_expected_prefix text;
begin
  if p_order_id is null or p_receipt_token is null then
    raise exception 'Datos de comprobante inválidos';
  end if;
  if v_path = '' or char_length(v_path) > 500 then
    raise exception 'Ruta de comprobante inválida';
  end if;
  if v_mime not in ('image/jpeg','image/png','image/webp','application/pdf') then
    raise exception 'Formato de comprobante no permitido';
  end if;
  if v_size <= 0 or v_size > 10485760 then
    raise exception 'Tamaño de comprobante inválido';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Pedido no encontrado';
  end if;
  if v_order.receipt_token <> p_receipt_token then
    raise exception 'Token de comprobante inválido';
  end if;
  if v_order.status = 'cancelled' then
    raise exception 'El pedido está cancelado';
  end if;
  if v_order.payment_status = 'verified' then
    raise exception 'El pago ya fue verificado; no se puede reemplazar el comprobante';
  end if;

  -- La ruta debe pertenecer al pedido y token. Evita registrar paths ajenos.
  v_expected_prefix := v_order.id::text || '/' || v_order.receipt_token::text || '/';
  if position(v_expected_prefix in v_path) <> 1 then
    raise exception 'La ruta del comprobante no corresponde al pedido';
  end if;

  update public.orders
  set payment_status = 'receipt_uploaded',
      payment_receipt_path = v_path,
      payment_receipt_name = v_name,
      payment_receipt_mime = v_mime,
      payment_receipt_size = v_size,
      payment_receipt_uploaded_at = now()
  where id = v_order.id
  returning * into v_order;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (v_order.id, v_order.status, v_order.status, auth.uid(), 'Comprobante recibido (pendiente de verificación)');

  return jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'payment_status', v_order.payment_status,
    'payment_receipt_uploaded_at', v_order.payment_receipt_uploaded_at,
    'ok', true
  );
end;
$$;

revoke all on function public.register_order_receipt(uuid, uuid, text, text, text, integer) from public;
grant execute on function public.register_order_receipt(uuid, uuid, text, text, text, integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) RPC: obtener estado de pago/comprobante por order_id + receipt_token
--    Útil para reanudar flujo si el usuario cerró la página.
-- ---------------------------------------------------------------------------
create or replace function public.get_order_payment_status(p_order_id uuid, p_receipt_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found or v_order.receipt_token <> p_receipt_token then
    raise exception 'Pedido no encontrado';
  end if;
  return jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'payment_receipt_uploaded_at', v_order.payment_receipt_uploaded_at,
    'total', v_order.total,
    'currency', v_order.currency,
    'created_at', v_order.created_at
  );
end;
$$;

revoke all on function public.get_order_payment_status(uuid, uuid) from public;
grant execute on function public.get_order_payment_status(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) Ajuste create_shop_order: devolver receipt_token y payment_status
--    NOTA: reemplaza la función existente. Revisar diff antes de ejecutar.
--    Cambios vs 001: incluye receipt_token y payment_status en retorno (nuevo y duplicado).
-- ---------------------------------------------------------------------------
create or replace function public.create_shop_order(
  p_payload jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_existing public.orders%rowtype;
  v_order public.orders%rowtype;
  v_item jsonb;
  v_items jsonb := coalesce(p_payload -> 'items', '[]'::jsonb);
  v_product record;
  v_qty int;
  v_unit numeric(12,2);
  v_line numeric(12,2);
  v_subtotal numeric(12,2) := 0;
  v_delivery text := btrim(coalesce(p_payload ->> 'delivery_method', ''));
  v_customer_type text := case when v_uid is null then 'guest' else 'registered' end;
  v_source text := case when lower(btrim(coalesce(p_payload ->> 'source', 'web'))) = 'apk' then 'apk' else 'web' end;
  v_name text := btrim(coalesce(p_payload ->> 'customer_full_name', ''));
  v_phone text := btrim(coalesce(p_payload ->> 'customer_phone', ''));
  v_email text := nullif(btrim(coalesce(p_payload ->> 'customer_email', '')), '');
  v_notes text := nullif(btrim(coalesce(p_payload ->> 'general_notes', '')), '');
  v_billing_requested boolean := coalesce((p_payload ->> 'billing_requested')::boolean, false);
  v_shipping_province text := nullif(btrim(coalesce(p_payload ->> 'shipping_province', '')), '');
  v_shipping_city text := nullif(btrim(coalesce(p_payload ->> 'shipping_city', '')), '');
  v_shipping_address text := nullif(btrim(coalesce(p_payload ->> 'shipping_address', '')), '');
  v_shipping_postal_code text := nullif(btrim(coalesce(p_payload ->> 'shipping_postal_code', '')), '');
  v_shipping_references text := nullif(btrim(coalesce(p_payload ->> 'shipping_references', '')), '');
  v_billing_full_name text := nullif(btrim(coalesce(p_payload ->> 'billing_full_name', '')), '');
  v_billing_tax_id text := nullif(btrim(coalesce(p_payload ->> 'billing_tax_id', '')), '');
  v_billing_address text := nullif(btrim(coalesce(p_payload ->> 'billing_address', '')), '');
  v_result jsonb;
begin
  if v_key = '' or char_length(v_key) < 8 then
    raise exception 'idempotency_key inválida';
  end if;

  select * into v_existing from public.orders where idempotency_key = v_key;
  if found then
    select jsonb_build_object(
      'id', o.id,
      'order_number', o.order_number,
      'status', o.status,
      'created_at', o.created_at,
      'total', o.total,
      'currency', o.currency,
      'duplicate', true,
      'receipt_token', o.receipt_token,
      'payment_status', o.payment_status
    ) into v_result
    from public.orders o where o.id = v_existing.id;
    return v_result;
  end if;

  if char_length(v_name) < 2 or char_length(v_phone) < 6 then
    raise exception 'Datos de contacto incompletos';
  end if;
  if v_delivery not in ('shipping', 'pickup_agreed') then
    raise exception 'Método de entrega inválido';
  end if;
  if v_delivery = 'shipping' then
    if v_shipping_province is null or v_shipping_city is null or v_shipping_address is null or v_shipping_postal_code is null then
      raise exception 'Datos de envío incompletos';
    end if;
  else
    v_shipping_province := null; v_shipping_city := null; v_shipping_address := null; v_shipping_postal_code := null;
  end if;
  if not v_billing_requested then
    v_billing_full_name := null; v_billing_tax_id := null; v_billing_address := null;
  end if;

  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'El pedido no tiene productos';
  end if;
  if jsonb_array_length(v_items) > 50 then
    raise exception 'Demasiados productos en el pedido';
  end if;

  insert into public.orders (
    user_id, customer_type, status, delivery_method,
    customer_full_name, customer_phone, customer_email,
    shipping_province, shipping_city, shipping_address, shipping_postal_code, shipping_references,
    billing_requested, billing_full_name, billing_tax_id, billing_address,
    general_notes, subtotal, total, currency, idempotency_key, source,
    payment_status
  ) values (
    v_uid, v_customer_type, 'pending', v_delivery,
    v_name, v_phone, v_email,
    v_shipping_province, v_shipping_city, v_shipping_address, v_shipping_postal_code, v_shipping_references,
    v_billing_requested, v_billing_full_name, v_billing_tax_id, v_billing_address,
    v_notes, 0, 0, 'ARS', v_key, v_source,
    'pending_payment'
  ) returning * into v_order;

  for v_item in select * from jsonb_array_elements(v_items)
  loop
    v_qty := coalesce((v_item ->> 'qty')::int, 0);
    if v_qty <= 0 or v_qty > 999 then
      raise exception 'Cantidad inválida';
    end if;

    select p.id, p.name, p.price, p.published, p.in_stock
      into v_product
      from public.products p
      where p.id = (v_item ->> 'id')::uuid
      for share;

    if not found then
      raise exception 'Producto no encontrado: %', coalesce(v_item ->> 'id', '');
    end if;
    if coalesce(v_product.published, false) is not true or coalesce(v_product.in_stock, false) is not true then
      raise exception 'Producto no disponible: %', v_product.name;
    end if;

    v_unit := round(coalesce(v_product.price, 0)::numeric, 2);
    if v_unit < 0 then
      raise exception 'Precio inválido para %', v_product.name;
    end if;
    v_line := round(v_unit * v_qty, 2);
    v_subtotal := v_subtotal + v_line;

    insert into public.order_items (
      order_id, product_id, product_name_snapshot, unit_price, quantity, line_total, item_note
    ) values (
      v_order.id,
      v_product.id,
      left(btrim(coalesce(v_product.name, 'Producto')), 300),
      v_unit,
      v_qty,
      v_line,
      nullif(left(btrim(coalesce(v_item ->> 'note', '')), 1000), '')
    );
  end loop;

  update public.orders
  set subtotal = round(v_subtotal, 2), total = round(v_subtotal, 2)
  where id = v_order.id
  returning * into v_order;

  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (v_order.id, null, 'pending', v_uid, 'Pedido creado - pendiente de comprobante');

  return jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'created_at', v_order.created_at,
    'total', v_order.total,
    'currency', v_order.currency,
    'duplicate', false,
    'customer_full_name', v_order.customer_full_name,
    'delivery_method', v_order.delivery_method,
    'receipt_token', v_order.receipt_token,
    'payment_status', v_order.payment_status
  );
end;
$$;

revoke all on function public.create_shop_order(jsonb, text) from public;
grant execute on function public.create_shop_order(jsonb, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) Storage bucket + policies (EJECUTAR EN SQL EDITOR / revisar en Dashboard)
-- ---------------------------------------------------------------------------
-- Crear bucket privado. Si ya existe, ignorar.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'order-receipts',
  'order-receipts',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp','application/pdf']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS en storage.objects ya está habilitado en Supabase normalmente. No forzar si no hace falta.

-- Limpieza de policies propuestas con nombre estable
drop policy if exists "order_receipts_insert_with_token" on storage.objects;
drop policy if exists "order_receipts_select_admin" on storage.objects;
drop policy if exists "order_receipts_select_owner" on storage.objects;
drop policy if exists "order_receipts_update_none" on storage.objects;

-- INSERT: anon/authenticated pueden subir solo si path corresponde a pedido+token válido.
-- Path esperado: <order_id>/<receipt_token>/<filename>
create policy "order_receipts_insert_with_token"
on storage.objects
for insert
to anon, authenticated
with check (
  bucket_id = 'order-receipts'
  and array_length(storage.foldername(name), 1) >= 2
  and public.can_upload_order_receipt(
    (storage.foldername(name))[1],
    (storage.foldername(name))[2]
  )
);

-- SELECT: admin puede leer cualquier comprobante.
create policy "order_receipts_select_admin"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'order-receipts'
  and public.is_admin()
);

-- SELECT: usuario autenticado dueño del pedido puede leer su comprobante.
create policy "order_receipts_select_owner"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'order-receipts'
  and exists (
    select 1
    from public.orders o
    where o.id::text = (storage.foldername(name))[1]
      and o.user_id = auth.uid()
  )
);

-- No permitir UPDATE/DELETE directo desde cliente. Admin puede gestionar desde Dashboard/service role si hace falta.

-- ---------------------------------------------------------------------------
-- 7) Grants mínimos
-- ---------------------------------------------------------------------------
grant select (payment_status, receipt_token, payment_receipt_path, payment_receipt_name, payment_receipt_mime, payment_receipt_size, payment_receipt_uploaded_at, payment_verified_at)
  on public.orders to authenticated; -- ya cubierto por grant select on table, pero explícito como documentación

-- ---------------------------------------------------------------------------
-- 8) Verificación manual post-ejecución (checklist)
-- ---------------------------------------------------------------------------
-- [ ] Anon puede llamar create_shop_order y recibe receipt_token + payment_status=pending_payment.
-- [ ] Anon puede subir archivo a order-receipts/<order_id>/<receipt_token>/file.jpg.
-- [ ] Anon NO puede subir a path con token incorrecto.
-- [ ] Anon NO puede listar/leer objetos del bucket.
-- [ ] Anon puede llamar register_order_receipt con token correcto y el pedido queda receipt_uploaded.
-- [ ] register_order_receipt rechaza path que no matchea order/token.
-- [ ] Usuario autenticado dueño puede leer su comprobante; otro usuario no.
-- [ ] Admin puede leer comprobantes y ver payment_status en pedidos.
-- [ ] Pedido cancelado/verificado rechaza upload/register según regla.
-- [ ] Reintento con misma idempotency key devuelve mismo pedido y receipt_token.

commit;
