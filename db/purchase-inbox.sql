-- Receipt intake remains separate from financial totals until explicitly approved.
create table if not exists public.purchase_inbox (
 id uuid primary key default gen_random_uuid(),
 source_key text not null unique,
 message_id text not null,
 source_mailbox text not null,
 source_subject text,
 supplier_name text,
 receipt_number text,
 purchase_date date,
 currency text not null default 'USD',
 subtotal numeric(12,2), tax numeric(12,2), total numeric(12,2),
 items jsonb not null default '[]',
 review_notes text,
 status text not null default 'pending' check(status in ('pending','review','assigned','ignored')),
 purchase_ids uuid[] not null default '{}',
 created_at timestamptz not null default now(),
 unique(source_mailbox,message_id,source_key)
);
alter table public.purchase_inbox enable row level security;
revoke all on public.purchase_inbox from anon, authenticated;
grant select,insert,update on public.purchase_inbox to authenticated;
grant all on public.purchase_inbox to service_role;
create policy approved_receipt_intake on public.purchase_inbox for all to authenticated
 using (exists(select 1 from public.user_profiles where id=auth.uid() and (status='approved' or role='admin')))
 with check (exists(select 1 from public.user_profiles where id=auth.uid() and (status='approved' or role='admin')));
create or replace function public.assign_purchase_inbox(entry_id uuid, allocations jsonb)
returns uuid[] language plpgsql security invoker set search_path=public as $$
declare r purchase_inbox%rowtype; a jsonb; p uuid; ids uuid[]='{}'; sum_total numeric=0; n int=0; amount numeric; tax_amount numeric; assigned_tax numeric=0; dst uuid;
begin
 if not exists(select 1 from user_profiles where id=auth.uid() and (status='approved' or role='admin')) then raise exception 'Acesso negado'; end if;
 select * into r from purchase_inbox where id=entry_id for update;
 if not found then raise exception 'Nota nao encontrada'; end if;
 if r.status='assigned' then return r.purchase_ids; end if;
 if r.status='ignored' then raise exception 'Nota descartada'; end if;
 if r.total is null or r.total<=0 or r.tax is null or r.tax<0 or r.subtotal is null or round(r.subtotal+r.tax,2)<>r.total or r.currency<>'USD' then raise exception 'Confira subtotal, imposto, total e moeda antes de destinar'; end if;
 if jsonb_typeof(allocations)<>'array' or jsonb_array_length(allocations)=0 then raise exception 'Escolha um destino'; end if;
 for a in select * from jsonb_array_elements(allocations) loop
  amount=(a->>'amount')::numeric;
  if amount is null or amount<=0 or round(amount,2)<>amount then raise exception 'Valor invalido'; end if;
  sum_total=sum_total+amount;
 end loop;
 if sum_total<>r.total then raise exception 'A soma dos destinos deve ser igual ao total'; end if;
 -- Prevent a second cost when the receipt was already entered manually or by camera.
 if exists(select 1 from purchases where lower(trim(supplier_name))=lower(trim(r.supplier_name)) and order_date=r.purchase_date and total=r.total and status<>'cancelled') then raise exception 'Possivel compra duplicada. Confira Compras antes de continuar'; end if;
 for a in select * from jsonb_array_elements(allocations) loop
  n=n+1; amount=(a->>'amount')::numeric; dst=nullif(a->>'project_id','')::uuid;
  if dst is null and coalesce(a->>'company','false')<>'true' then raise exception 'Escolha obra ou uso da empresa'; end if;
  if dst is not null and not exists(select 1 from projects where id=dst) then raise exception 'Obra invalida'; end if;
  tax_amount=case when n=jsonb_array_length(allocations) then r.tax-assigned_tax else round(r.tax*amount/r.total,2) end;
  assigned_tax=assigned_tax+tax_amount;
  insert into purchases(purchase_number,project_id,supplier_name,status,order_date,subtotal,tax,total,notes)
  values('EMAIL-'||r.id::text||'-'||n,dst,r.supplier_name,'pending',r.purchase_date,amount-tax_amount,tax_amount,amount,
  'Nota importada do email. Referencia: '||coalesce(r.receipt_number,'')||'. Origem Gmail: '||r.message_id||'. '||case when dst is null then 'Uso da empresa. ' else '' end||coalesce(a->>'notes','')) returning id into p;
  insert into purchase_items(purchase_id,description,quantity,unit,unit_price,total)
  values(p,'Materiais conforme comprovante e itens da fila de compras',1,'lote',amount-tax_amount,amount-tax_amount);
  ids=array_append(ids,p);
 end loop;
 update purchase_inbox set status='assigned',purchase_ids=ids where id=entry_id;
 return ids;
end $$;
revoke all on function public.assign_purchase_inbox(uuid,jsonb) from public, anon;
grant execute on function public.assign_purchase_inbox(uuid,jsonb) to authenticated;
