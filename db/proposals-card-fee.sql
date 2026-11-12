-- Taxa de cartao como acrescimo opcional (+3%) na proposta. ADITIVO. Aplicado em 2026-11-11.
alter table public.proposals add column if not exists card_fee_enabled boolean not null default false;
alter table public.proposals add column if not exists base_cost numeric;
