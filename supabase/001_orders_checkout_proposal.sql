-- PROPUESTA ETAPA 1 — Reymero 3D checkout/pedidos
-- Estado: BORRADOR PARA REVISIÓN. NO ejecutar sin revisar contra el esquema real.
-- No modifica tablas existentes (products, product_costs, etc.). Solo crea objetos nuevos.
--
-- Supuestos a confirmar antes de ejecutar:
-- 1) products.id es UUID. Si es TEXT/BIGINT, cambiar order_items.product_id y el cast en create_shop_order.
-- 2) Existe Supabase Auth para admins; se formaliza autorización con public.admin_users.
-- 3) Los pedidos se crean solo vía RPC create_shop_order (no INSERT directo desde cliente).
-- 4) Facturación opcional: campos genéricos (nombre, documento/CUIT, domicilio fiscal). Ajustar si se requieren campos AFIP específicos.
-- 5) "Retiro acordado" no exige dirección de envío; "shipping" sí la exige.

begin;

-- Extensiones útiles (gen_random_uuid suele existir en Supabase; pgcrypto por compatibilidad).
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Utilidad: updated_at
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Perfiles de cliente (opcional, solo usuario autenticado)
-- ---------------------------------------------------------------------------
create table if not exists public.customer_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(btrim(full_name)) between 2 and 120),
  phone text not null check (char_length(btrim(phone)) between 6 and 30),
  email text null check (email is null or char_length(email) <= 254),
  province text null check (province is null or char_length(province) <= 80),
  city text null check (city is null or char_length(city) <= 120),
  address text null check (address is null or char_length(address) <= 200),
  postal_code text null check (postal_code is null or char_length(postal_code) <= 20),
  extra_references text null check (extra_references is null or char_length(extra_references) <= 500),
  billing_requested boolean not null default false,
  billing_full_name text null check (billing_full_name is null or char_length(billing_full_name) <= 120),
  billing_tax_id text null check (billing_tax_id is null or char_length(billing_tax_id) <= 32),
  billing_address text null check (billing_address is null or char_length(billing_address) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_customer_profiles_updated_at on public.customer_profiles;
create trigger trg_customer_profiles_updated_at
before update on public.customer_profiles
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Admins autorizados para gestionar pedidos/catalogo admin
-- ---------------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  note text null,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users a
    where a.user_id = auth.uid()
      and a.active = true
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  user_id uuid null references auth.users(id) on delete set null,
  customer_type text not null check (customer_type in ('guest', 'registered')),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled')),
  delivery_method text not null check (delivery_method in ('shipping', 'pickup_agreed')),

  customer_full_name text not null check (char_length(btrim(customer_full_name)) between 2 and 120),
  customer_phone text not null check (char_length(btrim(customer_phone)) between 6 and 30),
  customer_email text null check (customer_email is null or char_length(customer_email) <= 254),

  shipping_province text null check (shipping_province is null or char_length(shipping_province) <= 80),
  shipping_city text null check (shipping_city is null or char_length(shipping_city) <= 120),
  shipping_address text null check (shipping_address is null or char_length(shipping_address) <= 200),
  shipping_postal_code text null check (shipping_postal_code is null or char_length(shipping_postal_code) <= 20),
  shipping_references text null check (shipping_references is null or char_length(shipping_references) <= 500),

  billing_requested boolean not null default false,
  billing_full_name text null check (billing_full_name is null or char_length(billing_full_name) <= 120),
  billing_tax_id text null check (billing_tax_id is null or char_length(billing_tax_id) <= 32),
  billing_address text null check (billing_address is null or char_length(billing_address) <= 200),

  general_notes text null check (general_notes is null or char_length(general_notes) <= 2000),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  total numeric(12,2) not null check (total >= 0),
  currency text not null default 'ARS' check (currency = 'ARS'),

  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  source text not null default 'web' check (source in ('web', 'apk', 'admin')),
  whatsapp_reported_at timestamptz null, -- marca opcional informativa; NO implica confirmación
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint orders_shipping_required check (
    delivery_method = 'pickup_agreed'
    or (
      char_length(btrim(coalesce(shipping_province, ''))) > 0 and
      char_length(btrim(coalesce(shipping_city, ''))) > 0 and
      char_length(btrim(coalesce(shipping_address, ''))) > 0 and
      char_length(btrim(coalesce(shipping_postal_code, ''))) > 0
    )
  ),
  constraint orders_billing_required check (
    billing_requested = false
    or char_length(btrim(coalesce(billing_full_name, ''))) > 0
  ),
  constraint orders_customer_type_user check (
    (customer_type = 'guest' and user_id is null)
    or (customer_type = 'registered' and user_id is not null)
  )
);

create unique index if not exists orders_idempotency_key_uidx on public.orders(idempotency_key);
create index if not exists orders_created_at_idx on public.orders(created_at desc);
create index if not exists orders_status_created_at_idx on public.orders(status, created_at desc);
create index if not exists orders_user_created_at_idx on public.orders(user_id, created_at desc);

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
before update on public.orders
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Items del pedido (snapshot de precio/nombre al momento de compra)
-- ---------------------------------------------------------------------------
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_id uuid not null, -- CONFIRMAR tipo contra products.id
  product_name_snapshot text not null check (char_length(btrim(product_name_snapshot)) between 1 and 300),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0 and quantity <= 999),
  line_total numeric(12,2) not null check (line_total = round(unit_price * quantity, 2)),
  item_note text null check (item_note is null or char_length(item_note) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists order_items_order_id_idx on public.order_items(order_id);
create index if not exists order_items_product_id_idx on public.order_items(product_id);

-- ---------------------------------------------------------------------------
-- Historial de estados
-- ---------------------------------------------------------------------------
create table if not exists public.order_status_history (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text null,
  to_status text not null check (to_status in ('pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled')),
  changed_by uuid null references auth.users(id) on delete set null,
  note text null check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists order_status_history_order_id_idx on public.order_status_history(order_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.customer_profiles enable row level security;
alter table public.admin_users enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_status_history enable row level security;

-- customer_profiles: dueño solo ve/edita lo suyo
drop policy if exists customer_profiles_select_own on public.customer_profiles;
create policy customer_profiles_select_own on public.customer_profiles
for select to authenticated
using (auth.uid() = user_id or public.is_admin());

drop policy if exists customer_profiles_insert_own on public.customer_profiles;
create policy customer_profiles_insert_own on public.customer_profiles
for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists customer_profiles_update_own on public.customer_profiles;
create policy customer_profiles_update_own on public.customer_profiles
for update to authenticated
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

-- admin_users: solo admin puede leer; gestión idealmente por SQL Editor/service role
drop policy if exists admin_users_select_admin on public.admin_users;
create policy admin_users_select_admin on public.admin_users
for select to authenticated
using (public.is_admin());

-- orders: lectura propia o admin. Sin insert/update/delete directo para clientes/anon.
drop policy if exists orders_select_own_or_admin on public.orders;
create policy orders_select_own_or_admin on public.orders
for select to authenticated
using (user_id = auth.uid() or public.is_admin());

drop policy if exists orders_admin_update on public.orders;
create policy orders_admin_update on public.orders
for update to authenticated
using (public.is_admin())
with check (public.is_admin());

-- order_items: lectura a través del pedido propio o admin.
drop policy if exists order_items_select_own_or_admin on public.order_items;
create policy order_items_select_own_or_admin on public.order_items
for select to authenticated
using (
  public.is_admin() or exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and o.user_id = auth.uid()
  )
);

-- history: lectura admin; inserts por RPC admin/trigger.
drop policy if exists order_status_history_select_admin on public.order_status_history;
create policy order_status_history_select_admin on public.order_status_history
for select to authenticated
using (public.is_admin());

-- IMPORTANTE: no hay políticas INSERT para orders/order_items/order_status_history para anon/authenticated.
-- La creación se hace vía RPC SECURITY DEFINER.

-- ---------------------------------------------------------------------------
-- RPC: crear pedido (invitado o autenticado)
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
      'duplicate', true
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
    general_notes, subtotal, total, currency, idempotency_key, source
  ) values (
    v_uid, v_customer_type, 'pending', v_delivery,
    v_name, v_phone, v_email,
    v_shipping_province, v_shipping_city, v_shipping_address, v_shipping_postal_code, v_shipping_references,
    v_billing_requested, v_billing_full_name, v_billing_tax_id, v_billing_address,
    v_notes, 0, 0, 'ARS', v_key, v_source
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
  values (v_order.id, null, 'pending', v_uid, 'Pedido creado');

  return jsonb_build_object(
    'id', v_order.id,
    'order_number', v_order.order_number,
    'status', v_order.status,
    'created_at', v_order.created_at,
    'total', v_order.total,
    'currency', v_order.currency,
    'duplicate', false,
    'customer_full_name', v_order.customer_full_name,
    'delivery_method', v_order.delivery_method
  );
end;
$$;

revoke all on function public.create_shop_order(jsonb, text) from public;
grant execute on function public.create_shop_order(jsonb, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: actualizar estado (solo admin)
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_order_status(
  p_order_id uuid,
  p_new_status text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_status text := btrim(coalesce(p_new_status, ''));
begin
  if not public.is_admin() then
    raise exception 'No autorizado';
  end if;
  if v_status not in ('pending','confirmed','preparing','ready','delivered','cancelled') then
    raise exception 'Estado inválido';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'Pedido no encontrado';
  end if;

  if v_order.status = v_status then
    return jsonb_build_object('id', v_order.id, 'status', v_order.status, 'changed', false);
  end if;

  update public.orders set status = v_status where id = p_order_id;
  insert into public.order_status_history (order_id, from_status, to_status, changed_by, note)
  values (p_order_id, v_order.status, v_status, auth.uid(), nullif(left(btrim(coalesce(p_note,'')),500), ''));

  return jsonb_build_object('id', p_order_id, 'from_status', v_order.status, 'status', v_status, 'changed', true);
end;
$$;

revoke all on function public.admin_update_order_status(uuid, text, text) from public;
grant execute on function public.admin_update_order_status(uuid, text, text) to authenticated;

commit;

-- ---------------------------------------------------------------------------
-- NOTAS POSTERIORES (ejecutar manualmente, con cuidado)
-- ---------------------------------------------------------------------------
-- 1) Agregar admins:
--    insert into public.admin_users (user_id, note)
--    select id, 'admin inicial' from auth.users where email = 'TU_ADMIN@EMAIL';
-- 2) Verificar tipo de products.id. Si no es uuid, ajustar order_items.product_id y cast en RPC.
-- 3) Revisar políticas RLS existentes de products/product_costs: no se modifican aquí.
-- 4) Considerar rate limiting externo/WAF para create_shop_order (anon). Idempotency key mitiga duplicados, no abuso.
-- 5) Si querés que clientes vean historial completo por cuenta, agregar UI "Mis pedidos" leyendo orders con RLS propia.
-- 6) Probar con: anon insert directo (debe fallar), anon RPC válido (debe crear), user A leyendo pedido de user B (debe fallar), admin update status (ok).