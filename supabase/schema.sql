-- ═══════════════════════════════════════════════════════════════
--  AuraUp In-Store — database schema
--  Run this once in Supabase: SQL Editor > New query > paste > Run
-- ═══════════════════════════════════════════════════════════════

-- ── STAFF ──────────────────────────────────────────────────────
-- pin_hash is an HMAC of the 4-digit PIN using STAFF_PIN_SECRET.
-- Deterministic, so we can look a staff member up directly, and
-- unique, so two people can never share a PIN.

create table if not exists public.staff (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  pin_hash    text        not null unique,
  is_active   boolean     not null default true,
  created_at  timestamptz not null default now()
);

-- ── CLIENTS ────────────────────────────────────────────────────
-- Phone is the natural key. Name can change, phone identifies.

create table if not exists public.clients (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  phone       text        not null unique,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists clients_phone_idx on public.clients (phone);

-- ── SALES ──────────────────────────────────────────────────────
-- sale_number gives staff a human ticket number (#0001, #0002...).
-- inventory_synced tracks whether the Shopify stock push succeeded,
-- so a network blip never silently loses a sale.

create sequence if not exists public.sale_number_seq start 1;

create table if not exists public.sales (
  id                uuid primary key default gen_random_uuid(),
  sale_number       integer     not null unique default nextval('public.sale_number_seq'),
  client_id         uuid        references public.clients(id) on delete set null,
  staff_id          uuid        not null references public.staff(id),
  subtotal          numeric(12,2) not null check (subtotal >= 0),
  discount          numeric(12,2) not null default 0 check (discount >= 0),
  total             numeric(12,2) not null check (total >= 0),
  payment_method    text        not null check (payment_method in ('cash','transfer','card')),
  note              text,
  inventory_synced  boolean     not null default false,
  inventory_error   text,
  created_at        timestamptz not null default now()
);

create index if not exists sales_created_at_idx on public.sales (created_at desc);
create index if not exists sales_client_idx     on public.sales (client_id);
create index if not exists sales_staff_idx      on public.sales (staff_id);

-- ── SALE ITEMS ─────────────────────────────────────────────────
-- We copy title/colour/size/price at time of sale rather than only
-- storing a variant id. If Ebuka renames a product or changes a
-- price next month, old receipts still read correctly.

create table if not exists public.sale_items (
  id                  uuid primary key default gen_random_uuid(),
  sale_id             uuid          not null references public.sales(id) on delete cascade,
  shopify_product_id  text          not null,
  shopify_variant_id  text          not null,
  inventory_item_id   text,
  title               text          not null,
  color               text,
  size                text,
  unit_price          numeric(12,2) not null check (unit_price >= 0),
  quantity            integer       not null check (quantity > 0),
  line_total          numeric(12,2) not null check (line_total >= 0),
  is_preorder         boolean       not null default false,
  created_at          timestamptz   not null default now()
);

create index if not exists sale_items_sale_idx    on public.sale_items (sale_id);
create index if not exists sale_items_variant_idx on public.sale_items (shopify_variant_id);

-- ── updated_at trigger for clients ─────────────────────────────

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists clients_touch_updated_at on public.clients;
create trigger clients_touch_updated_at
  before update on public.clients
  for each row execute function public.touch_updated_at();

-- ── VIEWS: powering the returning-client feature ───────────────

-- Visits and lifetime value per client.
create or replace view public.client_stats as
select
  c.id                              as client_id,
  c.name,
  c.phone,
  count(s.id)                       as visit_count,
  coalesce(sum(s.total), 0)         as lifetime_value,
  max(s.created_at)                 as last_visit
from public.clients c
left join public.sales s on s.client_id = c.id
group by c.id, c.name, c.phone;

-- The single product each client buys most. Used for
-- "usually buys Monogram Hoodie" on the sale ticket.
create or replace view public.client_favourites as
select distinct on (s.client_id)
  s.client_id,
  si.title       as favourite_product,
  sum(si.quantity) as units
from public.sales s
join public.sale_items si on si.sale_id = s.id
where s.client_id is not null
group by s.client_id, si.title
order by s.client_id, units desc;

-- ── ROW LEVEL SECURITY ─────────────────────────────────────────
-- Enabled with no policies, which denies everything to the anon
-- and authenticated roles. Our server routes use the service role
-- key, which bypasses RLS. Net effect: the database is unreachable
-- from a browser, only our own API routes can touch it.

alter table public.staff      enable row level security;
alter table public.clients    enable row level security;
alter table public.sales      enable row level security;
alter table public.sale_items enable row level security;

-- Views do NOT inherit RLS from their tables. Without this, anyone holding
-- the public anon key could read client_stats and pull customer names and
-- phone numbers straight out. security_invoker makes each view run with the
-- permissions of whoever queries it, so RLS applies and the views become
-- unreachable from a browser too.

alter view public.client_stats      set (security_invoker = on);
alter view public.client_favourites set (security_invoker = on);