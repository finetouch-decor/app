-- Importacao automatica de notas de compra do Gmail (contact@) para purchase_inbox.
-- Nada aqui cria custo: a fila so vira custo quando o usuario confirma em
-- /purchase-inbox (RPC assign_purchase_inbox). Tabelas de controle sao privadas
-- (RLS ligado, sem policy: so service_role le/escreve).

-- Log por mensagem: idempotencia, fila duravel de processamento e retries.
create table if not exists public.gmail_intake_log (
  message_id text primary key,
  mailbox text not null,
  thread_id text,
  internal_date timestamptz,
  from_addr text,
  subject text,
  classification text,
  decision text not null default 'queued'
    check (decision in ('queued','inserted','skipped','duplicate','failed','pending_ai','abandoned')),
  reason text,
  source_key text,
  inbox_id uuid,
  duplicate_of text,
  attempts int not null default 0,
  ai_used boolean not null default false,
  last_error text,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gmail_intake_log_work_idx on public.gmail_intake_log (decision, next_retry_at);
create index if not exists gmail_intake_log_ai_idx on public.gmail_intake_log (ai_used, updated_at);

-- Estado da rotina: cursor (historyId), trava de execucao, ultimo resultado, saude do OAuth.
create table if not exists public.gmail_intake_state (
  key text primary key,
  value jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.gmail_intake_log enable row level security;
alter table public.gmail_intake_state enable row level security;
revoke all on public.gmail_intake_log from anon, authenticated;
revoke all on public.gmail_intake_state from anon, authenticated;
grant all on public.gmail_intake_log to service_role;
grant all on public.gmail_intake_state to service_role;

-- Colunas aditivas na fila existente (a tela e a RPC da Maia nao dependem delas).
alter table public.purchase_inbox add column if not exists source_sender text;
alter table public.purchase_inbox add column if not exists intake_meta jsonb not null default '{}';
