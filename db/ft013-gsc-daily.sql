-- FT-013: totais diarios do Search Console (sem dimensao query), pois o Google omite consultas anonimas
-- nos dados por consulta e os totais do painel as incluem. ADITIVO.
create table if not exists public.gsc_daily (
  site_url text not null,
  date date not null,
  clicks integer not null default 0,
  impressions integer not null default 0,
  ctr numeric,
  position numeric,
  synced_at timestamptz not null default now(),
  primary key (site_url, date)
);
create index if not exists gsc_daily_date_idx on public.gsc_daily (date desc);
alter table public.gsc_daily enable row level security;
revoke all on public.gsc_daily from anon;
drop policy if exists gsc_daily_select_approved on public.gsc_daily;
create policy gsc_daily_select_approved on public.gsc_daily for select to authenticated using (public.is_approved_user());

-- GA4 por canal e pagina de entrada (separa organico / blog / ads / direto / social)
create table if not exists public.ga4_landing_daily (
  property_id text not null,
  date date not null,
  channel_group text not null default 'Unassigned',
  source text not null default '(direct)',
  medium text not null default '(none)',
  landing_page text not null default '(not set)',
  sessions bigint not null default 0,
  total_users bigint not null default 0,
  engaged_sessions bigint not null default 0,
  key_events numeric not null default 0,
  synced_at timestamptz not null default now(),
  primary key (property_id, date, channel_group, source, medium, landing_page)
);
create index if not exists ga4_landing_daily_date_idx on public.ga4_landing_daily (date desc);
alter table public.ga4_landing_daily enable row level security;
revoke all on public.ga4_landing_daily from anon;
drop policy if exists ga4_landing_daily_select_approved on public.ga4_landing_daily;
create policy ga4_landing_daily_select_approved on public.ga4_landing_daily for select to authenticated using (public.is_approved_user());

-- GA4 eventos por nome e canal (ex.: cliques em telefone/WhatsApp, envio de formulario)
create table if not exists public.ga4_events_daily (
  property_id text not null,
  date date not null,
  channel_group text not null default 'Unassigned',
  event_name text not null,
  event_count bigint not null default 0,
  key_events numeric not null default 0,
  synced_at timestamptz not null default now(),
  primary key (property_id, date, channel_group, event_name)
);
create index if not exists ga4_events_daily_date_idx on public.ga4_events_daily (date desc);
alter table public.ga4_events_daily enable row level security;
revoke all on public.ga4_events_daily from anon;
drop policy if exists ga4_events_daily_select_approved on public.ga4_events_daily;
create policy ga4_events_daily_select_approved on public.ga4_events_daily for select to authenticated using (public.is_approved_user());
