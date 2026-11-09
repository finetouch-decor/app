-- FT-013 Fase 4: ponte site -> ERP.
-- STATUS: APLICADO em 2026-11-09 no Supabase finetouch-app (migration ft013_submit_site_lead).
-- Testado como papel anon dentro de transacao desfeita: lead com gclid -> source google_ads; reenvio com o
-- mesmo request_id -> duplicate=true (sem novo lead); referrer google.* sem gclid -> organic; acesso direto -> website;
-- cliente existente (mesmo e-mail/telefone) reaproveitado; dados invalidos recusados (invalid_lead).
-- O site chama public.submit_site_lead(p jsonb) via rpc com a chave publishable (nenhum segredo).
alter table public.lead_attribution add column if not exists request_id text;
create unique index if not exists lead_attribution_request_id_key on public.lead_attribution (request_id) where request_id is not null;

create or replace function public.submit_site_lead(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text := left(btrim(coalesce(p->>'name','')), 100);
  v_email text := lower(left(btrim(coalesce(p->>'email','')), 255));
  v_phone text := left(btrim(coalesce(p->>'phone','')), 30);
  v_service text := nullif(left(btrim(coalesce(p->>'service','')), 100), '');
  v_message text := left(btrim(coalesce(p->>'message','')), 1000);
  v_req text := nullif(left(btrim(coalesce(p->>'request_id','')), 64), '');
  v_gclid text := nullif(left(btrim(coalesce(p->>'gclid','')), 200), '');
  v_gbraid text := nullif(left(btrim(coalesce(p->>'gbraid','')), 200), '');
  v_wbraid text := nullif(left(btrim(coalesce(p->>'wbraid','')), 200), '');
  v_us text := nullif(left(btrim(coalesce(p->>'utm_source','')), 200), '');
  v_um text := nullif(left(btrim(coalesce(p->>'utm_medium','')), 200), '');
  v_uc text := nullif(left(btrim(coalesce(p->>'utm_campaign','')), 200), '');
  v_ut text := nullif(left(btrim(coalesce(p->>'utm_term','')), 200), '');
  v_ucont text := nullif(left(btrim(coalesce(p->>'utm_content','')), 200), '');
  v_landing text := nullif(left(btrim(coalesce(p->>'landing_page','')), 300), '');
  v_ref text := nullif(left(btrim(coalesce(p->>'referrer','')), 300), '');
  v_client uuid;
  v_lead uuid;
  v_existing uuid;
  v_src text;
begin
  if length(v_name) < 2 or length(v_phone) < 7 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid_lead' using errcode = '22023';
  end if;

  if v_req is not null then
    select lead_id into v_existing from public.lead_attribution where request_id = v_req;
    if found then
      return jsonb_build_object('ok', true, 'lead_id', v_existing, 'duplicate', true);
    end if;
  end if;

  -- anti-abuso: no maximo 40 leads vindos do site em 10 minutos
  if (select count(*) from public.lead_attribution where captured_at > now() - interval '10 minutes') > 40 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  if v_gclid is not null or v_gbraid is not null or v_wbraid is not null
     or (lower(coalesce(v_us,'')) = 'google' and lower(coalesce(v_um,'')) in ('cpc','ppc','paid','paidsearch','paid_search')) then
    v_src := 'google_ads';
  elsif coalesce(v_ref,'') ~* '^https?://([a-z0-9-]+\.)*google\.' then
    v_src := 'organic';
  else
    v_src := 'website';
  end if;

  select id into v_client from public.clients
   where lower(coalesce(email,'')) = v_email
      or regexp_replace(coalesce(phone,''), '\D', '', 'g') = regexp_replace(v_phone, '\D', '', 'g')
   order by created_at limit 1;
  if v_client is null then
    insert into public.clients (name, email, phone, source) values (v_name, v_email, v_phone, 'website') returning id into v_client;
  end if;

  insert into public.leads (client_id, status, project_type, source, campaign_name, notes, first_contact_date)
  values (v_client, 'lead', v_service, v_src, v_uc, left('Pedido de orcamento pelo site: ' || v_message, 1500), current_date)
  returning id into v_lead;

  insert into public.lead_attribution (lead_id, gclid, gbraid, wbraid, utm_source, utm_medium, utm_campaign, utm_term, utm_content, landing_page, referrer, request_id)
  values (v_lead, v_gclid, v_gbraid, v_wbraid, v_us, v_um, v_uc, v_ut, v_ucont, v_landing, v_ref, v_req);

  return jsonb_build_object('ok', true, 'lead_id', v_lead, 'source', v_src, 'duplicate', false);
end;
$$;

revoke all on function public.submit_site_lead(jsonb) from public;
grant execute on function public.submit_site_lead(jsonb) to anon, authenticated;
