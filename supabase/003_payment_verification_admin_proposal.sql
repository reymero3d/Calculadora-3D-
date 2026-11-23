-- PROPUESTA ETAPA 3 — Verificación admin de pagos / estados de pago separados
-- Estado: BORRADOR PARA REVISIÓN. NO ejecutar sin aprobación.
-- Requiere haber aplicado 001 y 002 (o esquema equivalente).
--
-- Objetivos
-- 1) Separar estado comercial del pedido del estado de pago.
-- 2) Permitir verificación/rechazo manual de comprobantes solo por admin autorizado.
-- 3) Registrar auditoría de acciones de pago.
-- 4) Mantener compatibilidad con pedidos existentes.
--
-- IMPORTANTE: revisar nombres de constraints/índices reales antes de ejecutar.
-- Ajustar si el esquema productivo difiere de 001/002.

begin;

-- ---------------------------------------------------------------------------
-- 1) Normalizar estados de pago (compatibilidad hacia atrás)
--    Estado actual 002: pending_payment, receipt_uploaded, verified, not_required
--    Estado solicitado: unpaid, proof_submitted, verified, rejected, refunded
-- ---------------------------------------------------------------------------
alter table public.orders drop constraint if exists orders_payment_status_check;
alter table public.orders drop constraint if exists orders_payment_status_check1;

update public.orders set payment_status = 'unpaid' where payment_status = 'pending_payment';
update public.orders set payment_status = 'proof_submitted' where payment_status = 'receipt_uploaded';
update public.orders set payment_status = 'unpaid' where payment_status = 'not_required';

alter table public.orders
  alter column payment_status set default 'unpaid';

alter table public.orders
  add constraint orders_payment_status_check
  check (payment_status in ('unpaid','proof_submitted','verified','rejected','refunded'));

-- Campos de auditoría de pago
alter table public.orders
  add column if not exists payment_reviewed_at timestamptz null,
  add column if not exists payment_reviewed_by uuid null references auth.users(id) on delete set null,
  add column if not exists payment_rejection_reason text null check (payment_rejection_reason is null or char_length(payment_rejection_reason) <= 500);

-- ---------------------------------------------------------------------------
-- 2) Historial de pago (auditoría)
-- ---------------------------------------------------------------------------
create table if not exists public.order_payment_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_payment_status text null,
  to_payment_status text not null check (to_payment_status in ('unpaid','proof_submitted','verified','rejected','refunded')),
  changed_by uuid null references auth.users(id) on delete set null,
  note text null check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists order_payment_history_order_id_idx
  on public.order_payment_history(order_id, created_at desc);

alter table public.order_payment_history enable row level security;

drop policy if exists order_payment_history_select_admin on public.order_payment_history;
create policy order_payment_history_select_admin on public.order_payment_history
for select to authenticated
using (public.is_admin());

grant select on public.order_payment_history to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Actualizar helper de upload para permitir reemplazo cuando rechazado
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
      and o.payment_status in ('unpaid', 'proof_submitted', 'rejected')
      and o.status not in ('cancelled')
  );
exception when others then
  return false;
end;
$$;

revoke all on function public.can_upload_order_receipt(text, text) from public;
grant execute on function public.can_upload_order_receipt(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Registrar comprobante: setea proof_submitted, no verificado
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
  v_prev text;
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

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  if v_order.receipt_token <> p_receipt_token then raise exception 'Token de comprobante inválido'; end if;
  if v_order.status = 'cancelled' then raise exception 'El pedido está cancelado'; end if;
  if v_order.payment_status = 'verified' then raise exception 'El pago ya fue verificado; no se puede reemplazar el comprobante'; end if;
  if v_order.payment_status not in ('unpaid','proof_submitted','rejected') then
    raise exception 'El pedido no admite un nuevo comprobante en su estado actual';
  end if;

  v_expected_prefix := v_order.id::text || '/' || v_order.receipt_token::text || '/';
  if position(v_expected_prefix in v_path) <> 1 then
    raise exception 'La ruta del comprobante no corresponde al pedido';
  end if;

  v_prev := v_order.payment_status;
  update public.orders
  set payment_status = 'proof_submitted',
      payment_receipt_path = v_path,
      payment_receipt_name = v_name,
      payment_receipt_mime = v_mime,
      payment_receipt_size = v_size,
      payment_receipt_uploaded_at = now(),
      payment_reviewed_at = null,
      payment_reviewed_by = null,
      payment_rejection_reason = null
  where id = v_order.id
  returning * into v_order;

  insert into public.order_payment_history (order_id, from_payment_status, to_payment_status, changed_by, note)
  values (v_order.id, v_prev, 'proof_submitted', auth.uid(), 'Comprobante recibido (pendiente de verificación)');

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
-- 5) RPC admin: verificar pago
-- ---------------------------------------------------------------------------
create or replace function public.admin_verify_order_payment(
  p_order_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_prev text;
begin
  if not public.is_admin() then raise exception 'No autorizado'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  v_prev := v_order.payment_status;
  if v_prev = 'verified' then
    return jsonb_build_object('id', v_order.id, 'payment_status', v_prev, 'changed', false);
  end if;
  if v_prev <> 'proof_submitted' then
    raise exception 'Solo se puede verificar un pago con comprobante recibido';
  end if;

  update public.orders
  set payment_status = 'verified',
      payment_verified_at = now(),
      payment_verified_by = auth.uid(),
      payment_reviewed_at = now(),
      payment_reviewed_by = auth.uid(),
      payment_rejection_reason = null
  where id = p_order_id
  returning * into v_order;

  insert into public.order_payment_history (order_id, from_payment_status, to_payment_status, changed_by, note)
  values (p_order_id, v_prev, 'verified', auth.uid(), nullif(left(btrim(coalesce(p_note,'')),500), 'Pago verificado por admin'));

  return jsonb_build_object('id', p_order_id, 'from_payment_status', v_prev, 'payment_status', 'verified', 'changed', true);
end;
$$;

revoke all on function public.admin_verify_order_payment(uuid, text) from public;
grant execute on function public.admin_verify_order_payment(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6) RPC admin: rechazar comprobante
-- ---------------------------------------------------------------------------
create or replace function public.admin_reject_order_receipt(
  p_order_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_prev text;
  v_reason text := nullif(left(btrim(coalesce(p_reason,'')),500), '');
begin
  if not public.is_admin() then raise exception 'No autorizado'; end if;
  if v_reason is null then raise exception 'Indicá un motivo de rechazo'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'Pedido no encontrado'; end if;
  v_prev := v_order.payment_status;
  if v_prev not in ('proof_submitted','unpaid') then
    raise exception 'Solo se puede rechazar un comprobante pendiente o no pagado';
  end if;

  update public.orders
  set payment_status = 'rejected',
      payment_reviewed_at = now(),
      payment_reviewed_by = auth.uid(),
      payment_rejection_reason = v_reason
  where id = p_order_id
  returning * into v_order;

  insert into public.order_payment_history (order_id, from_payment_status, to_payment_status, changed_by, note)
  values (p_order_id, v_prev, 'rejected', auth.uid(), v_reason);

  return jsonb_build_object('id', p_order_id, 'from_payment_status', v_prev, 'payment_status', 'rejected', 'changed', true);
end;
$$;

revoke all on function public.admin_reject_order_receipt(uuid, text) from public;
grant execute on function public.admin_reject_order_receipt(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7) get_order_payment_status: devolver estados nuevos
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
    'payment_rejection_reason', v_order.payment_rejection_reason,
    'total', v_order.total,
    'currency', v_order.currency,
    'created_at', v_order.created_at
  );
end;
$$;

revoke all on function public.get_order_payment_status(uuid, uuid) from public;
grant execute on function public.get_order_payment_status(uuid, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8) create_shop_order: devolver unpaid (compatibilidad con frontend nuevo)
--    Basado en 002, con payment_status 'unpaid'.
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
    'unpaid'
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
  values (v_order.id, null, 'pending', v_uid, 'Pedido creado - pendiente de pago');

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
-- 9) Notas de despliegue
-- ---------------------------------------------------------------------------
-- - Actualizar frontend para aceptar ambos conjuntos de estados durante transición.
-- - Verificar policies de storage: can_upload_order_receipt ya permite 'rejected'.
-- - Confirmar que no existan otros constraints con nombres distintos.
-- - Probar: admin verifica proof_submitted ok; admin rechaza con motivo ok;
--   cliente sube nuevo comprobante tras rechazo ok; usuario no admin no puede verificar/rechazar.
-- - Considerar agregar refunded solo por admin RPC si se necesita.

commit;
