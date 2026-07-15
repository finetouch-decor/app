# Fine Touch Decor & Design — Infraestrutura Técnica

> Documento de referência único. Leia isto ANTES de procurar qualquer coisa do zero em outra sessão.
> Última atualização: 2026-07-15.

> **REGRA PERMANENTE (não é opcional):** este arquivo é a fonte de verdade sobre tudo que existe nesse sistema — não uma conversa de chat, que se perde entre sessões. Toda vez que algo novo for criado, configurado, mudado ou abandonado (tabela, bucket, bot, integração, token, pasta, scheduled task, decisão importante), atualize este arquivo NO MESMO commit/entrega, antes de considerar a tarefa concluída. Se uma sessão futura (de qualquer chat) precisar entender o sistema, o primeiro passo é clonar `finetouch-decor/app` e ler este arquivo — nunca vasculhar tudo de novo do zero.

## Visão geral

FT (Fine Touch Decor & Design) — empresa de wall paneling/accent walls em Orlando, FL. Site: ftdecordesign.com. Instagram: @ftdecordesign. Facebook: Fine Touch Decor & Design.

O sistema tem 3 pernas principais:
1. **ERP** — app estático (GitHub `finetouch-decor/app`, deploy no Vercel projeto `app`, domínio `app-one-amber-58.vercel.app`).
2. **Banco de dados** — Supabase, projeto `jpbpzlpvhdwgbmljqfyd` (org `finetouch-decor's Org`).
3. **Bot do Telegram** (`@finetoucherp_bot`) — roda como serverless function DENTRO do mesmo repo/projeto Vercel do ERP (`api/telegram.js`), não é um serviço separado.

## Repositórios e deploys

- **GitHub**: `https://github.com/finetouch-decor/app.git` — único repo, contém TODO o ERP (páginas HTML/JS em multi-page, sem build step) E as serverless functions em `/api/*.js`.
- **Vercel**: time `finetouch` (`team_JvquXNUc6vGGUruLBJXnZtzF`), projeto `app` (id `prj_YEb27h1ukfV8Gya0ufublpmgd1dP`) — é o deploy desse mesmo repo. Outros projetos Vercel do time: `paige-winterpark` (site de cliente específico), `finetouch-catalog` (catálogo público).
- **Rotas do ERP** (ver `vercel.json`): `/dashboard`, `/app` (CRM/Leads), `/quotes` (Orçamentos), `/proposals` (Propostas), `/invoices`, `/projects` (Obras), `/purchases` (Compras), `/financial`, `/reports`, `/marketing`, `/services`, `/tasks`, `/users`.
- **Push no GitHub**: preciso de um Personal Access Token do usuário a cada sessão (não persiste) — peço um "fine-grained token" com "Contents: Read and write" no repo `finetouch-decor/app`, uso uma vez no `git push` embutido na URL, nunca salvo.
- **⚠️ Clonagem**: o sandbox de bash (`mcp__workspace__bash`) É PERSISTENTE dentro da mesma sessão, mas reseta entre sessões novas ou após compactação de contexto — sempre reclone antes de assumir que `/tmp/ft-repos/app` existe.

## Banco de dados (Supabase `jpbpzlpvhdwgbmljqfyd`)

Tabelas principais: `proposals` (+ `images` jsonb — galeria de imagens na proposta, `scope_items` jsonb array de strings), `quotes` + `quote_items`, `invoices`, `projects` (obras) + `project_stages`, `purchases`, `suppliers`, `catalog_portfolio` (portfólio — `image_urls` array, `ig_caption`, `blog_body`, `gmb_post_text`, ligado a `projects` via `project_id`), `catalog_services`, `content_queue` (fila de aprovação blog/instagram/facebook/gmb), `marketing_data` (tabela chave-valor genérica — usada como KV store por várias automações, incluindo sessões temporárias do bot do Telegram: chave `tg_session_{chatId}`), `api_secrets` (tabela ISOLADA e seguro para tokens sensíveis, não confundir com `marketing_data`).

**Chaves importantes em `marketing_data`**: `gdrive_refresh_token` (autorizado desde 01/07/2026, usado pelo bot pra espelhar fotos de obra no Drive), `gmb_refresh_token`, `gmb_reviews_manual`, `blog`, `blog_drafts`, `schema_status`.

**`api_secrets`**: hoje só tem `meta_system_user_token` (token permanente do Meta/Instagram — ver seção Meta abaixo).

**Storage buckets**: `proposal-images` (público, imagens da galeria de propostas), `obra-photos` (usado pelo bot do Telegram pra fotos de obra, path `{chatId}/{timestamp}.jpg`).

**Edge Functions** (Supabase, deploy via MCP): `publish-social` — publica no Instagram/Facebook via API da Meta, chamado pela scheduled task diária.

## Bot do Telegram (`@finetoucherp_bot` → `api/telegram.js`)

Já implementado e funcionando (não precisa recriar):
- **Foto de nota fiscal/recibo**: OCR via OpenAI Vision, extrai itens, pergunta pra qual obra vai cada item, lança em `purchases`. Cadastra fornecedor novo automaticamente em `suppliers` se necessário.
- **Foto de obra**: `classifyPhoto()` detecta sozinho (OpenAI Vision) se é nota ou foto de ambiente/obra. Se for foto de obra: SÓ ARMAZENA (não tenta extrair item/valor) — sobe pro Storage (`obra-photos`), espelha automaticamente numa pasta do Google Drive ("Fotos de Obras — Fine Touch", cria sozinha na primeira vez), aceita várias fotos em sequência (usuário responde "pronto" quando terminar), pergunta de qual obra são, anexa em `catalog_portfolio.image_urls` daquela obra. Depois pede um áudio/texto contando sobre a obra (contexto pra gerar blog depois).
- **Q&A em linguagem natural**: perguntas tipo "quantas obras temos", "quanto tá em invoice aberto" via tool-use com Claude.
- **Custo rápido por texto**: `custo: obra, descrição, valor`.
- Sessão temporária guardada em `marketing_data` (chave `tg_session_{chatId}`), expira em 10 min.

## Meta / Instagram / Facebook

- Business Portfolio: "Nucleo ND" (`1013812852349765`), App: "FT Decor Automação" (`28354626797454111`), System User: "FTdecorapp" (`61591764008459`), Página FB: "Fine Touch Decor & Design" (`1484953725147177`), Instagram: `ftdecordesign` (`17841406583374792`).
- Token permanente (nunca expira) guardado em `api_secrets.meta_system_user_token`, 13 permissões incluindo `ads_management`/`ads_read` (pra quando formos fazer anúncios).
- Terceiro com acesso total ao Business Manager: **João Ricardo (Marchweb)** — deixado de propósito, dono pode remover depois se quiser.

## Google Drive / Dropbox (fotos de obra — tentativas de automação, julho/2026)

- Pasta `FT Obras 📸 - Fotos e Vídeos` e `FT Obras - INBOX (bruto, todas as fotos do dia)` criadas no Drive do usuário — **tentativa abandonada** de fazer upload automático via iOS Shortcuts (não funcionou bem) e Dropbox Camera Upload (bloqueado por restrição de rede do sandbox pra baixar conteúdo do Dropbox). **Solução real já em produção**: o bot do Telegram já resolve isso (ver seção acima) — é o caminho que o dono efetivamente usa.

## Scheduled tasks (Cowork, `/Users/fabinho/Claude/Scheduled/`)

- `ft-content-queue-daily` — publica blog/Instagram/Facebook aprovados e na data, revisa pedidos de ajuste.
- `ft-content-queue-topup` — mantém ~5 posts de blog e ~4 de Instagram/Facebook futuros na fila.
- `ft-gbp-api-recheck` — recheca em 13/08/2026 se os 60 dias de dono/gerente do GMB já passaram pra reenviar pedido de API.

## Pendências conhecidas

- API do Google Business Profile: rejeitada em 10/07 (regra dos 60 dias), recheck agendado.
- n8n self-hosted: nunca foi configurado — toda automação foi feita direto via Supabase Edge Functions + Cowork scheduled tasks + Vercel serverless functions.
- Facebook Ads / Google Ads: mencionados como objetivo futuro, não iniciado.
