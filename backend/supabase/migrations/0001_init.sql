-- Project Wall — core schema
-- Anonymous sessions, an event-sourced spray ledger, server-authoritative
-- project state, and Lemon Squeezy subscriptions.

create extension if not exists "pgcrypto";

-- One row per anonymous visitor. The opaque token lives in the browser's
-- localStorage; this table just gives it a stable server-side identity.
create table sessions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

-- Server-authoritative project state. Glue decays and grows here, not in
-- client JS, so every viewer sees the same wall.
create table projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color_hex text not null,
  text_hex text not null,
  glue numeric not null default 0 check (glue >= 0 and glue <= 100),
  y_pos numeric not null default 20 check (y_pos >= 0 and y_pos <= 100),
  updated_at timestamptz not null default now()
);

-- Event-sourced spray balance. Never update a counter in place — always
-- append a grant or a spend. Balance = sum(grant) - sum(spend).
create table ledger (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  kind text not null check (kind in ('grant', 'spend')),
  amount int not null check (amount > 0),
  source text not null,              -- 'ls_order' | 'ls_subscription' | 'spray' | ...
  external_id text,                  -- Lemon Squeezy order/invoice id — unique
                                      -- per grant, gives webhook idempotency
  project_id uuid references projects(id),  -- set for spends
  created_at timestamptz not null default now()
);

-- One grant per external payment event, ever.
create unique index ledger_external_id_uq
  on ledger (external_id) where external_id is not null;

create index ledger_session_idx on ledger (session_id);

-- One row per active Lemon Squeezy subscription.
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  ls_subscription_id text not null unique,
  variant_id text not null,
  status text not null default 'active', -- active | cancelled | expired | past_due
  pinned_project_id uuid references projects(id),
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index subscriptions_session_idx on subscriptions (session_id);

-- Convenience view: current spray balance per session.
create view session_balances as
select
  session_id,
  coalesce(sum(amount) filter (where kind = 'grant'), 0)
    - coalesce(sum(amount) filter (where kind = 'spend'), 0) as balance
from ledger
group by session_id;

-- Atomic spend: check balance and apply the spray in one transaction, so
-- two rapid clicks can't both succeed against the same last spray.
create or replace function spend_spray(p_session_id uuid, p_project_id uuid, p_amount int default 1)
returns table (ok boolean, new_balance bigint, new_glue numeric)
language plpgsql
security definer
as $$
declare
  v_balance bigint;
  v_glue numeric;
begin
  select coalesce(sum(amount) filter (where kind = 'grant'), 0)
       - coalesce(sum(amount) filter (where kind = 'spend'), 0)
    into v_balance
  from ledger
  where session_id = p_session_id
  for update;  -- serializes concurrent spends for this session

  if v_balance < p_amount then
    return query select false, v_balance, null::numeric;
    return;
  end if;

  insert into ledger (session_id, kind, amount, source, project_id)
  values (p_session_id, 'spend', p_amount, 'spray', p_project_id);

  update projects
    set glue = least(100, glue + 10 * p_amount),
        y_pos = greatest(6, y_pos - 9 * p_amount),
        updated_at = now()
  where id = p_project_id
  returning glue into v_glue;

  return query select true, v_balance - p_amount, v_glue;
end;
$$;

-- Row Level Security: sessions/ledger/subscriptions are only ever touched
-- through Edge Functions using the service role, never directly from the
-- anonymous browser client — so RLS defaults to fully closed.
alter table sessions enable row level security;
alter table ledger enable row level security;
alter table subscriptions enable row level security;

-- Projects are public read-only from the browser (everyone sees the wall);
-- writes only happen via spend_spray() (security definer) or the webhook.
alter table projects enable row level security;
create policy projects_public_read on projects for select using (true);
