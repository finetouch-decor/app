-- FT-013: tabelas do sync Google no ERP (Supabase projeto finetouch-app)
-- ADITIVO: nenhuma tabela existente e alterada.
-- Leitura: somente equipe aprovada (public.is_approved_user()).
-- Escrita: somente service_role (servidor/cron). anon sem acesso.
-- STATUS: APLICADO em 2026-11-09 no Supabase finetouch-app (migration ft013_google_sync_tables). RLS verificada: 8 tabelas, 1 policy de SELECT cada.

create table if not exists public.google_sync_runs (
  id bigint generated always as identity primary key,
  source text not null,                 -- 'ads' | 'ga4' | 'gsc' | 'gbp' | 'token'
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  rows_written integer not null default 0,
  error_code text,                      -- ex.: invalid_grant, invalid_client, permission_denied
  error_message text                    -- mensagem REAL devolvida pelo Google (sem segredos)
);
create index if not exists google_sync_runs_source_started_idx
  on public.google_sync_runs (source, started_at desc);

create table if not exists public.google_ads_accounts (
  customer_id text primary key,         -- sem hifens
  descriptive_name text,
  is_manager boolean not null default false,
  manager_customer_id text,
  currency_code text,
  time_zone text,
  status text,
  last_seen_at timestamptz not null default now()
);

create table if not exists public.google_ads_campaign_daily (
  customer_id text not null,
  campaign_id text not null,
  date date not null,
  campaign_name text,
  campaign_status text,
  channel_type text,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  cost_micros bigint not null default 0,   -- custo em micros da moeda da conta
  conversions numeric not null default 0,
  conversions_value numeric not null default 0,
  currency_code text,
  synced_at timestamptz not null default now(),
  primary key (customer_id, campaign_id, date)
);
create index if not exists google_ads_campaign_daily_date_idx
  on public.google_ads_campaign_daily (date desc);

create table if not exists public.ga4_daily (
  property_id text not null,
  date date not null,
  source text not null default '(direct)',
  medium text not null default '(none)',
  campaign text not null default '(not set)',
  sessions bigint not null default 0,
  total_users bigint not null default 0,
  new_users bigint not null default 0,
  engaged_sessions bigint not null default 0,
  key_events numeric not null default 0,
  synced_at timestamptz not null default now(),
  primary key (property_id, date, source, medium, campaign)
);
create index if not exists ga4_daily_date_idx on public.ga4_daily (date desc);

create table if not exists public.gsc_query_daily (
  site_url text not null,
  date date not null,
  query text not null,
  page text not null,
  clicks integer not null default 0,
  impressions integer not null default 0,
  ctr numeric,
  position numeric,
  synced_at timestamptz not null default now(),
  primary key (site_url, date, query, page)
);
create index if not exists gsc_query_daily_date_idx on public.gsc_query_daily (date desc);

create table if not exists public.gbp_reviews (
  review_id text primary key,
  location_id text,
  reviewer_name text,
  rating smallint,
  comment text,
  created_at_google timestamptz,
  updated_at_google timestamptz,
  reply_comment text,
  reply_updated_at timestamptz,
  synced_at timestamptz not null default now()
);

create table if not exists public.gbp_metrics_daily (
  location_id text not null,
  date date not null,
  metric text not null,                 -- ex.: CALL_CLICKS, WEBSITE_CLICKS, BUSINESS_DIRECTION_REQUESTS
  value bigint not null default 0,
  synced_at timestamptz not null default now(),
  primary key (location_id, date, metric)
);

create table if not exists public.lead_attribution (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  gclid text,
  gbraid text,
  wbraid text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  landing_page text,
  referrer text,
  google_ads_campaign_id text,
  captured_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array[
    'google_sync_runs','google_ads_accounts','google_ads_campaign_daily','ga4_daily',
    'gsc_query_daily','gbp_reviews','gbp_metrics_daily','lead_attribution'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_approved', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_approved_user())',
      t || '_select_approved', t
    );
  end loop;
end $$;
