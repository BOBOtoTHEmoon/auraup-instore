-- ═══════════════════════════════════════════════════════════════
--  AuraUP Affiliates: database schema
--  Same Supabase project as AuraUp In-Store. Every table is aff_*
--  so nothing touches the POS tables.
--  Run this once in Supabase: SQL Editor > New query > paste > Run
-- ═══════════════════════════════════════════════════════════════

create extension if not exists pg_cron;

-- ── SETTINGS (single row) ──────────────────────────────────────
create table if not exists public.aff_settings (
  id int primary key default 1 check (id = 1),
  commission_rate numeric(5,2) not null default 10,
  customer_discount numeric(5,2) not null default 10,
  hold_days int not null default 14,
  min_payout numeric(12,2) not null default 10000,
  allow_self_referral boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.aff_settings (id) values (1) on conflict do nothing;

-- ── AFFILIATES ─────────────────────────────────────────────────
-- One per Shopify customer account. code is their discount code
-- (TOLU10), slug is their share link (/apps/affiliates/r/tolu).
create table if not exists public.aff_affiliates (
  id uuid primary key default gen_random_uuid(),
  shopify_customer_id bigint unique not null,
  full_name text not null,
  email text not null,
  phone text,
  instagram text,
  tiktok text,
  audience text,
  why text,
  status text not null default 'pending'
    check (status in ('pending','approved','declined','suspended')),
  code text unique,
  slug text unique,
  commission_rate numeric(5,2),          -- null means use aff_settings
  shopify_discount_id text,
  bank_code text,
  bank_name text,
  account_number text,
  account_name text,
  bank_verified_at timestamptz,
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- ── CLICKS ─────────────────────────────────────────────────────
create table if not exists public.aff_clicks (
  id bigserial primary key,
  affiliate_id uuid not null references public.aff_affiliates(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists aff_clicks_aff_time on public.aff_clicks (affiliate_id, created_at);

-- ── PAYOUTS ────────────────────────────────────────────────────
create table if not exists public.aff_payouts (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'draft'
    check (status in ('draft','approved','processing','completed','failed')),
  total numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  approved_at timestamptz
);

-- ── COMMISSIONS ────────────────────────────────────────────────
-- One per order. order_ref is the Shopify order id (online) or the
-- POS sale id (instore). Pending until the hold period passes, so a
-- returned order never gets paid out.
create table if not exists public.aff_commissions (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.aff_affiliates(id),
  source text not null check (source in ('online','instore')),
  order_ref text not null,
  order_name text,
  order_value numeric(12,2) not null,
  rate numeric(5,2) not null,
  amount numeric(12,2) not null,
  reversed_amount numeric(12,2) not null default 0,
  status text not null default 'pending'
    check (status in ('pending','approved','reversed','paid')),
  placed_at timestamptz not null,
  approves_at timestamptz not null,
  payout_id uuid references public.aff_payouts(id),
  created_at timestamptz not null default now(),
  unique (source, order_ref)
);
create index if not exists aff_comm_aff_time on public.aff_commissions (affiliate_id, placed_at desc);

create table if not exists public.aff_payout_items (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references public.aff_payouts(id) on delete cascade,
  affiliate_id uuid not null references public.aff_affiliates(id),
  amount numeric(12,2) not null,
  reference text unique,
  status text not null default 'queued'
    check (status in ('queued','sent','successful','failed')),
  error text,
  created_at timestamptz not null default now()
);

-- ── PLUMBING ───────────────────────────────────────────────────
create table if not exists public.aff_webhook_events (
  id text primary key,
  topic text,
  received_at timestamptz not null default now()
);

create table if not exists public.aff_kv (
  key text primary key,
  value text not null,
  expires_at timestamptz
);

-- ── ROW LEVEL SECURITY ─────────────────────────────────────────
-- Same rule as the POS: enabled with no policies, so only the Edge
-- Functions (service role) can reach these tables.
alter table public.aff_settings enable row level security;
alter table public.aff_affiliates enable row level security;
alter table public.aff_clicks enable row level security;
alter table public.aff_payouts enable row level security;
alter table public.aff_commissions enable row level security;
alter table public.aff_payout_items enable row level security;
alter table public.aff_webhook_events enable row level security;
alter table public.aff_kv enable row level security;

-- ── HOLD PERIOD: pending to approved, daily ────────────────────
create or replace function public.aff_approve_due() returns int
language sql as $$
  with u as (
    update public.aff_commissions set status = 'approved'
    where status = 'pending' and approves_at <= now()
    returning 1
  ) select count(*)::int from u;
$$;

select cron.schedule('aff-approve-due', '15 0 * * *', $$select public.aff_approve_due()$$);

-- ── AFFILIATE DASHBOARD ────────────────────────────────────────
create or replace function public.aff_dashboard(p_aff uuid) returns jsonb
language sql stable as $$
select jsonb_build_object(
  'clicks_month', (select count(*) from public.aff_clicks
                   where affiliate_id = p_aff and created_at >= date_trunc('month', now())),
  'orders_month', (select count(*) from public.aff_commissions
                   where affiliate_id = p_aff and status <> 'reversed'
                   and placed_at >= date_trunc('month', now())),
  'pending',  coalesce((select sum(amount - reversed_amount) from public.aff_commissions
                        where affiliate_id = p_aff and status = 'pending'), 0),
  'approved', coalesce((select sum(amount - reversed_amount) from public.aff_commissions
                        where affiliate_id = p_aff and status = 'approved'), 0),
  'paid',     coalesce((select sum(amount - reversed_amount) from public.aff_commissions
                        where affiliate_id = p_aff and status = 'paid'), 0),
  'months', (
    select jsonb_agg(jsonb_build_object('month', to_char(m, 'Mon'), 'amount', coalesce(s.total, 0)) order by m)
    from generate_series(date_trunc('month', now()) - interval '5 months',
                         date_trunc('month', now()), interval '1 month') as m
    left join lateral (
      select sum(amount - reversed_amount) as total from public.aff_commissions
      where affiliate_id = p_aff and status <> 'reversed'
        and placed_at >= m and placed_at < m + interval '1 month'
    ) s on true
  ),
  'recent', coalesce((
    select jsonb_agg(r order by r.placed_at desc) from (
      select order_name, source, order_value,
             amount - reversed_amount as commission, status, placed_at
      from public.aff_commissions where affiliate_id = p_aff
      order by placed_at desc limit 10
    ) r
  ), '[]'::jsonb)
);
$$;

-- ── ADMIN OVERVIEW ─────────────────────────────────────────────
create or replace function public.aff_admin_overview() returns jsonb
language sql stable as $$
select jsonb_build_object(
  'active', (select count(*) from public.aff_affiliates where status = 'approved'),
  'sales_month', coalesce((select sum(order_value) from public.aff_commissions
                           where status <> 'reversed' and placed_at >= date_trunc('month', now())), 0),
  'owed', coalesce((select sum(amount - reversed_amount) from public.aff_commissions
                    where status in ('pending','approved')), 0),
  'applications', coalesce((
    select jsonb_agg(a order by a.created_at) from (
      select id, full_name, email, phone, instagram, tiktok, audience, why, created_at
      from public.aff_affiliates where status = 'pending'
    ) a), '[]'::jsonb),
  'top', coalesce((
    select jsonb_agg(t order by t.sales desc) from (
      select f.full_name, f.code, count(*) as orders, sum(c.order_value) as sales
      from public.aff_commissions c join public.aff_affiliates f on f.id = c.affiliate_id
      where c.status <> 'reversed' and c.placed_at >= date_trunc('month', now())
      group by f.id, f.full_name, f.code
      order by sales desc limit 5
    ) t), '[]'::jsonb)
);
$$;

-- ── IN-STORE: called by the POS server routes ──────────────────
-- Staff enter an affiliate code on a sale; the POS calls this after
-- the sale is saved. aff_void_instore runs when a sale is voided.
create or replace function public.aff_record_instore(
  p_code text, p_sale_id text, p_value numeric,
  p_sale_name text default null, p_placed_at timestamptz default now()
) returns jsonb language plpgsql as $$
declare a public.aff_affiliates; s public.aff_settings; r numeric;
begin
  select * into a from public.aff_affiliates where code = upper(trim(p_code)) and status = 'approved';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_code');
  end if;
  select * into s from public.aff_settings where id = 1;
  r := coalesce(a.commission_rate, s.commission_rate);
  insert into public.aff_commissions (affiliate_id, source, order_ref, order_name, order_value,
                                      rate, amount, placed_at, approves_at)
  values (a.id, 'instore', p_sale_id, p_sale_name, p_value, r, round(p_value * r / 100, 2),
          p_placed_at, p_placed_at + make_interval(days => s.hold_days))
  on conflict (source, order_ref) do nothing;
  return jsonb_build_object('ok', true, 'affiliate', a.full_name, 'discount', s.customer_discount);
end $$;

create or replace function public.aff_void_instore(p_sale_id text) returns void
language sql as $$
  update public.aff_commissions set status = 'reversed', reversed_amount = amount
  where source = 'instore' and order_ref = p_sale_id and status in ('pending','approved');
$$;

-- Only server code holding the service role key may call these
revoke execute on function public.aff_approve_due() from public, anon, authenticated;
revoke execute on function public.aff_dashboard(uuid) from public, anon, authenticated;
revoke execute on function public.aff_admin_overview() from public, anon, authenticated;
revoke execute on function public.aff_record_instore(text, text, numeric, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.aff_void_instore(text) from public, anon, authenticated;
