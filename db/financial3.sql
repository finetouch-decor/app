-- Financeiro 3 — somente estruturas NOVAS (colunas aditivas, tabela de metas, funcoes e views).
-- Nenhum registro historico e alterado. As views respeitam o RLS das tabelas de origem
-- (security_invoker) -- so usuarios aprovados enxergam.

create or replace function public.fin3_today() returns date language sql stable
as $$ select (now() at time zone 'America/New_York')::date $$;

-- 1) Data de aprovacao de propostas (nao existia). Registros antigos ficam NULL: o painel
--    mostra a data como ESTIMADA ate o Fabinho confirmar. Novas aprovacoes gravam sozinhas.
alter table public.proposals add column if not exists accepted_at timestamptz;
alter table public.proposals add column if not exists accepted_source text
  check (accepted_source in ('system','manual'));

create or replace function public.proposals_set_accepted_at() returns trigger language plpgsql as $$
begin
  if new.status = 'accepted' then
    if tg_op = 'INSERT' then
      if new.accepted_at is null then
        new.accepted_at := now(); new.accepted_source := 'system';
      end if;
    elsif old.status is distinct from 'accepted' and new.accepted_at is not distinct from old.accepted_at then
      new.accepted_at := now(); new.accepted_source := 'system';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_proposals_accepted_at on public.proposals;
create trigger trg_proposals_accepted_at before insert or update of status on public.proposals
  for each row execute function public.proposals_set_accepted_at();

-- 2) Meta mensal. Uma linha por mes em que a meta foi definida; meses sem linha herdam a
--    ultima meta anterior. Meses passados sao imutaveis e nao ha DELETE, entao alterar a
--    meta nunca muda o historico.
create table if not exists public.financial_goals (
  month date primary key check (month = date_trunc('month', month)::date),
  target numeric(12,2) not null check (target >= 0),
  set_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.financial_goals enable row level security;
revoke all on public.financial_goals from anon, authenticated;
grant select, insert, update on public.financial_goals to authenticated;
grant all on public.financial_goals to service_role;
drop policy if exists approved_goals on public.financial_goals;
create policy approved_goals on public.financial_goals for all to authenticated
  using (public.is_approved_user()) with check (public.is_approved_user());

create or replace function public.financial_goals_guard() returns trigger language plpgsql as $$
begin
  if new.month < date_trunc('month', public.fin3_today())::date
     or (tg_op = 'UPDATE' and old.month < date_trunc('month', public.fin3_today())::date) then
    raise exception 'Metas de meses anteriores nao podem ser alteradas';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_financial_goals_guard on public.financial_goals;
create trigger trg_financial_goals_guard before insert or update on public.financial_goals
  for each row execute function public.financial_goals_guard();

create or replace function public.fin3_goal(m date) returns numeric language sql stable
set search_path = public as $$
  select target from public.financial_goals where month <= date_trunc('month', m)::date order by month desc limit 1
$$;
grant execute on function public.fin3_goal(date) to authenticated;
grant execute on function public.fin3_today() to authenticated;

-- 3) Unidade de venda = combo aprovado OU proposta aprovada fora de combo aprovado.
--    (propostas dentro de combo aprovado nao entram: o combo ja traz o valor total)
create or replace view public.fin3_sale_units with (security_invoker = true) as
with base as (
  select 'bundle'::text as unit_type, b.id as unit_id, b.client_name, b.title,
         round(b.total::numeric, 2) as amount, b.accepted_at as confirmed_at,
         b.created_at::date as proposal_date
  from public.proposal_bundles b where b.status = 'accepted'
  union all
  select 'proposal', p.id, p.client_name, coalesce(p.project_name, p.title),
         round(p.total_cost::numeric, 2), p.accepted_at, p.date
  from public.proposals p
  left join public.proposal_bundles pb on pb.id = p.bundle_id
  where p.status = 'accepted' and (p.bundle_id is null or pb.status is distinct from 'accepted')
), inv as (
  select coalesce(i.proposal_bundle_id, i.proposal_id) as unit_id,
         count(*) filter (where i.status not in ('cancelled','void','draft')) as n_invoices,
         coalesce(sum(i.total) filter (where i.status not in ('cancelled','void','draft')), 0) as invoiced_total,
         coalesce(sum(i.total) filter (where i.status = 'paid'), 0) as paid_total,
         min(i.issue_date) filter (where i.status not in ('cancelled','void','draft')) as first_invoice_date,
         array_agg(distinct i.project_id) filter (where i.project_id is not null) as project_ids
  from public.invoices i
  where coalesce(i.proposal_bundle_id, i.proposal_id) is not null
  group by 1
), u as (
  select b.*, coalesce(inv.n_invoices, 0) as n_invoices, coalesce(inv.invoiced_total, 0) as invoiced_total,
         coalesce(inv.paid_total, 0) as paid_total, inv.first_invoice_date,
         coalesce(array_length(inv.project_ids, 1), 0) as n_projects,
         case when array_length(inv.project_ids, 1) = 1 then inv.project_ids[1] end as project_id
  from base b left join inv on inv.unit_id = b.unit_id
)
select u.unit_type, u.unit_id, u.client_name, u.title, u.amount, u.proposal_date,
       case when u.confirmed_at is not null then (u.confirmed_at at time zone 'America/New_York')::date
            when u.first_invoice_date is not null then u.first_invoice_date
            else u.proposal_date end as approval_date,
       case when u.confirmed_at is not null then 'confirmada'
            when u.first_invoice_date is not null then 'estimada_primeira_invoice'
            else 'estimada_data_proposta' end as approval_basis,
       (u.confirmed_at is not null) as approval_confirmed,
       u.n_invoices, u.invoiced_total, u.paid_total, u.first_invoice_date, u.project_id, u.n_projects,
       round(greatest(u.invoiced_total - u.paid_total, 0)
             + case when u.amount - u.invoiced_total < 0.05 then 0 else u.amount - u.invoiced_total end, 2) as open_balance,
       case when u.amount - u.invoiced_total < 0.05 then 0 else round(u.amount - u.invoiced_total, 2) end as uninvoiced_amount,
       case when u.unit_type = 'proposal' and u.n_invoices = 0 and exists (
              select 1 from u o where o.unit_id <> u.unit_id and o.unit_type = 'proposal' and o.n_invoices > 0
                and o.amount = u.amount and lower(trim(o.client_name)) = lower(trim(u.client_name))
                and lower(trim(coalesce(o.title,''))) = lower(trim(coalesce(u.title,''))))
            then 'possivel_duplicada' end as review_flag
from u;

-- 4) Recebimentos confirmados = invoices marcadas como pagas (data real = paid_date),
--    conciliadas com o lancamento de entrada em transactions (a ligacao existe so no texto
--    "Recebimento invoice INV-xxxx-n", nunca em invoice_id).
create or replace view public.fin3_payments with (security_invoker = true) as
select i.id as invoice_id, i.invoice_number, i.paid_date, i.total as amount,
       coalesce(c.name, i.project_name) as client_name, i.project_id,
       t.id as txn_id, t.amount as txn_amount, t.date as txn_date,
       coalesce(t.n, 0) as n_txn,
       case when t.id is null then 'sem_lancamento'
            when t.n > 1 then 'lancamento_duplicado'
            when t.amount <> i.total then 'valor_diferente'
            when t.date is distinct from i.paid_date then 'data_diferente'
            else 'conciliado' end as reconciliation
from public.invoices i
left join public.clients c on c.id = i.client_id
left join lateral (
  select t1.id, t1.amount, t1.date, count(*) over () as n
  from public.transactions t1
  where t1.type = 'income' and (t1.invoice_id = i.id or t1.description ~ (i.invoice_number || '($|[^0-9])'))
  order by (t1.invoice_id = i.id) desc, t1.date limit 1
) t on true
where i.status = 'paid';

create or replace view public.fin3_orphan_income with (security_invoker = true) as
select t.id as txn_id, t.date, t.amount, t.description
from public.transactions t
where t.type = 'income' and not exists (
  select 1 from public.invoices i
  where i.id = t.invoice_id or t.description ~ (i.invoice_number || '($|[^0-9])'));

-- 5) Contas a receber, linha a linha (nada de data inventada).
create or replace view public.fin3_receivable_lines with (security_invoker = true) as
select 'invoice'::text as line_type, i.id::text as line_id, i.invoice_number as ref,
       coalesce(c.name, i.project_name) as client_name, i.project_id, i.due_date, i.total as amount,
       case when i.due_date is null then 'sem_data'
            when i.due_date < public.fin3_today() then 'vencido'
            else 'a_vencer' end as bucket
from public.invoices i left join public.clients c on c.id = i.client_id
where i.status not in ('paid','cancelled','void','draft')
  and coalesce(
        (select su.review_flag is null from public.fin3_sale_units su
          where su.unit_id = coalesce(i.proposal_bundle_id, i.proposal_id)), true)
union all
select 'contracted_not_invoiced', su.unit_id::text, su.title, su.client_name, su.project_id, null::date,
       su.uninvoiced_amount, 'sem_invoice'
from public.fin3_sale_units su
where su.review_flag is null and su.uninvoiced_amount > 0;

-- 6) Custos registrados (data efetiva = order_date; valor COM imposto). Despesas avulsas em
--    transactions entram apenas se nao estiverem ligadas a uma compra (evita dupla contagem).
create or replace view public.fin3_costs with (security_invoker = true) as
select 'purchase'::text as source, p.id::text as cost_id, p.purchase_number as ref, p.supplier_name,
       p.project_id, p.order_date as cost_date,
       coalesce(p.total, (select sum(x.total) from public.purchase_items x where x.purchase_id = p.id), 0) as amount,
       p.status, (p.receipt_url is not null) as has_receipt
from public.purchases p where p.status <> 'cancelled'
union all
select 'transaction', t.id::text, t.reference, t.description, t.project_id, t.date, t.amount, null, false
from public.transactions t where t.type <> 'income' and t.purchase_id is null;

-- 7) Lucratividade por obra: contratado - custos registrados. Obra concluida = final;
--    demais = parcial/provisorio.
create or replace view public.fin3_project_profit with (security_invoker = true) as
with sales as (
  select project_id, sum(amount) as contracted, sum(paid_total) as received
  from public.fin3_sale_units where review_flag is null and project_id is not null group by project_id
), costs as (
  select project_id, sum(amount) as costs, count(*) as n_costs
  from public.fin3_costs where project_id is not null group by project_id
)
select pr.id as project_id, pr.name, pr.status, pr.closed_at, c.name as client_name,
       coalesce(s.contracted, 0) as contracted, coalesce(s.received, 0) as received,
       coalesce(k.costs, 0) as costs, coalesce(k.n_costs, 0) as n_costs,
       coalesce(s.contracted, 0) - coalesce(k.costs, 0) as profit,
       case when coalesce(s.contracted, 0) > 0
            then round((coalesce(s.contracted, 0) - coalesce(k.costs, 0)) / s.contracted * 100, 1) end as margin_pct,
       case when pr.status = 'completed' then 'final' else 'provisorio' end as profit_kind,
       (s.project_id is null) as no_contract
from public.projects pr
left join public.clients c on c.id = pr.client_id
left join sales s on s.project_id = pr.id
left join costs k on k.project_id = pr.id;

-- 8) Comparativo mensal.
create or replace view public.fin3_monthly with (security_invoker = true) as
with bounds as (
  select date_trunc('month', least(
           (select min(approval_date) from public.fin3_sale_units),
           (select min(paid_date) from public.fin3_payments),
           (select min(cost_date) from public.fin3_costs),
           public.fin3_today()))::date as first_month
), months as (
  select generate_series(b.first_month, date_trunc('month', public.fin3_today())::date, interval '1 month')::date as month
  from bounds b
)
select m.month,
  (select coalesce(sum(amount), 0) from public.fin3_sale_units where review_flag is null and date_trunc('month', approval_date) = m.month) as sales,
  (select count(*) from public.fin3_sale_units where review_flag is null and date_trunc('month', approval_date) = m.month) as sales_count,
  (select coalesce(sum(amount), 0) from public.fin3_sale_units where review_flag is null and approval_confirmed and date_trunc('month', approval_date) = m.month) as sales_confirmed,
  public.fin3_goal(m.month) as goal,
  (select coalesce(sum(amount), 0) from public.fin3_payments where date_trunc('month', paid_date) = m.month) as received,
  (select coalesce(sum(amount), 0) from public.fin3_costs where project_id is not null and date_trunc('month', cost_date) = m.month) as costs_obras,
  (select coalesce(sum(amount), 0) from public.fin3_costs where project_id is null and date_trunc('month', cost_date) = m.month) as costs_sem_obra
from months m;

revoke all on public.fin3_sale_units, public.fin3_payments, public.fin3_orphan_income, public.fin3_receivable_lines,
  public.fin3_costs, public.fin3_project_profit, public.fin3_monthly from public, anon;
grant select on public.fin3_sale_units, public.fin3_payments, public.fin3_orphan_income, public.fin3_receivable_lines,
  public.fin3_costs, public.fin3_project_profit, public.fin3_monthly to authenticated;
