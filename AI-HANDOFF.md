# AI Handoff Log — Fine Touch ERP

Este arquivo existe porque o Fabinho usa mais de um assistente de IA (Claude e ChatGPT) com acesso de escrita ao mesmo GitHub, Supabase, Vercel e Lovable deste projeto. Nao ha comunicacao direta entre os assistentes — este arquivo e o unico ponto de encontro entre eles.

## Regras basicas

1. **Antes de comecar qualquer tarefa**, leia as ultimas entradas abaixo (as mais recentes ficam no topo) pra saber se o outro assistente esta com algo "EM ANDAMENTO" que possa colidir com o que voce vai fazer (mesmo arquivo .html, mesma tabela do Supabase, mesma migration).
2. **Se algo estiver marcado EM ANDAMENTO** por outro assistente num arquivo/tabela que voce precisa mexer, avise o Fabinho antes de prosseguir em vez de editar por cima.
3. **Ao terminar uma tarefa**, adicione uma entrada nova no topo da lista com: data/hora, assistente, o que foi feito, quais arquivos/tabelas foram tocados, e status final.
4. Commits no GitHub e mudancas no Supabase ja ficam no historico de cada ferramenta — este log e um resumo em linguagem simples pro outro assistente (e pro Fabinho) entender rapido o que mudou e por que, sem precisar reconstruir o raciocinio a partir do diff bruto.

## Formato de cada entrada

```
### YYYY-MM-DD HH:MM (fuso do commit) — [Claude|ChatGPT]
Status: CONCLUIDO | EM ANDAMENTO
Arquivos/tabelas: lista separada por virgula
Resumo: 1-3 frases do que foi feito e por que
```

---

### 2026-09-22 21:12 EDT — Claude
Status: CONCLUIDO
Arquivos/tabelas: invoices.html, funcao SQL fn_auto_create_project_on_invoice_paid (Supabase), projects/invoices (dados da cliente Kerry)
Resumo: Fabinho marcou o 1o invoice de uma proposta nova da cliente Kerry como pago e a obra nao foi criada automaticamente. Causa raiz: invoices geradas pela aba Propostas nunca tem quote_id (a tabela proposals nao tem FK pra quotes), entao o trigger so criava obra automatica se o cliente nao tivesse NENHUMA obra ainda — cliente recorrente com obra anterior ficava sempre bloqueado, so com aviso pra vincular manualmente. Corrigido o trigger pra tambem confiar no proposal_id (parcelas da mesma proposta) como sinal valido de escopo novo, igual ja fazia com quote_id. Tambem corrigida a propagacao de obra em invoices.html (markPaid) que usava so client_id — agora usa proposal_id/quote_id primeiro, pra nao misturar duas propostas em aberto do mesmo cliente. Reprocessado manualmente o caso da Kerry: obra "Paint Loft + Stairs" criada e vinculada nas 2 parcelas (INV-6416-1 e INV-6416-2). Deploy em producao confirmado (commit 923f963).

### 2026-09-22 (sessao anterior, mesmo dia) — Claude
Status: CONCLUIDO
Arquivos/tabelas: api/telegram.js, login.html, api/notify-telegram.js (removido)
Resumo: Assumi a FT-001 (estava com a Maia/ChatGPT). Consolidei o endpoint de aviso de novo cadastro (antigo api/notify-telegram.js) dentro de api/telegram.js como rota POST autenticada ?notify=1, reaproveitando a mesma validacao de sessao Supabase e janela de 10 min. login.html atualizado pra chamar /api/telegram?notify=1. Isso reduziu as funcoes serverless de 13 pra 12 — e essa era a causa real de os ultimos 2 deploys (antes deste) terem falhado silenciosamente com "exceeded_serverless_functions_per_deployment" (limite do plano Hobby da Vercel): o site ficou rodando uma versao antiga em producao sem ninguem perceber, inclusive o fix anterior do token do Telegram nunca tinha ido ao ar. Commit 15cd143 deployado e confirmado em producao (app-one-amber-58.vercel.app), rotas notify=1 e setup=1 testadas (401 sem auth, como esperado) e /api/notify-telegram confirmado 404. Falta: religar o webhook do Telegram via POST /api/telegram?setup=1 (exige sessao de admin logado — pedi pro Fabinho rodar esse passo, nao consigo autenticar como ele) e validar o fluxo completo de foto de nota fiscal -> OCR -> escolha de obra -> gravacao em purchases/purchase_items com as 2 notas que ficaram pendentes no bot. Ver AI-TASKS.md FT-001.

### 2026-09-21 11:35 EDT — ChatGPT
Status: CONCLUIDO
Arquivos/tabelas: AI-TASKS.md
Resumo: Criada uma fila compartilhada para Fabinho, Maia (ChatGPT) e Claude coordenarem pedidos, responsaveis, prioridades e andamento. O AI-HANDOFF.md continua sendo o registro obrigatorio das mudancas tecnicas concluidas; o conserto do bot do Telegram foi cadastrado como FT-001 em andamento.

### 2026-09-21 11:25 EDT — ChatGPT
Status: CONCLUIDO
Arquivos/tabelas: login.html, api/notify-telegram.js, variavel TELEGRAM_BOT_TOKEN na Vercel
Resumo: Removidos o token e o chat ID do JavaScript publico do login. O aviso de novo usuario agora passa por uma funcao no servidor, usa o segredo da Vercel, valida a sessao do Supabase e aceita apenas contas criadas nos ultimos 10 minutos. A credencial antiga foi revogada no BotFather, a nova foi salva na Vercel e o projeto foi republicado.

### 2026-09-21 — Claude
Status: CONCLUIDO
Arquivos/tabelas: nenhum alterado (revisao apenas) — proposals, user_profiles, invoices, quotes, quote_items, api_secrets (Supabase, so leitura)
Resumo: Conferi direto no banco os achados da auditoria do ChatGPT — confirmados: proposals e user_profiles tem policy "all_access" pra role public (ALL, qual true, sem restricao); invoices/quotes/quote_items liberam SELECT pra anon; api_secrets exige authenticated (nao e anon, mas vale checar se signup publico esta aberto). Fabinho decidiu que o ChatGPT fica responsavel por aplicar as correcoes de RLS nessas tabelas. Eu NAO vou mexer em policies/RLS dessas tabelas ate o ChatGPT concluir e registrar aqui como CONCLUIDO.

### 2026-09-21 11:05 EDT — ChatGPT
Status: EM ANDAMENTO
Arquivos/tabelas: login.html, api/notify-telegram.js (planejado), variavel secreta Vercel (planejada)
Resumo: Correcao do token do Telegram exposto no login. O plano e remover o token e chat ID do navegador, mover o envio para uma funcao no servidor e usar segredo da Vercel; aguardando o Fabinho gerar a nova credencial do mesmo bot no BotFather.

### 2026-09-21 10:58 EDT — ChatGPT
Status: CONCLUIDO
Arquivos/tabelas: login.html, proposals, user_profiles, quotes, quote_items, invoices, api_secrets, campaign_performance, funcoes SQL publicas, storage obra-photos, storage proposal-images
Resumo: Auditoria somente leitura identificou riscos criticos: token do bot Telegram exposto no JavaScript publico; acesso anonimo total a proposals e user_profiles; leitura anonima de quotes, quote_items e invoices; e funcoes SECURITY DEFINER executaveis publicamente. Tambem foram encontrados acesso excessivo para usuarios autenticados, segredos acessiveis no schema publico, buckets de fotos publicos e protecao contra senhas vazadas desativada. Nenhuma configuracao ou dado do ERP foi alterado; correcoes aguardam aprovacao do Fabinho.

### 2026-09-21 — Claude
Status: CONCLUIDO
Arquivos/tabelas: manifest.json (novo), login.html, dashboard.html, pendencias (Supabase)
Resumo: Adicionado manifest PWA + meta tags apple-touch-icon pra permitir instalar o ERP como app no iPad/celular (fica em tela cheia, sem redesenho responsivo ainda). Tambem criada pendencia "Criar Google Local Services Ads para FT".

### 2026-09-19 — Claude
Status: CONCLUIDO
Arquivos/tabelas: invoices (Supabase)
Resumo: Mesclados os 2 invoices em aberto da cliente Maricela (INV-2607-2 e INV-2607-3) em um unico invoice de $5,968.83, pois ela ia quitar o saldo total de uma vez.

### 2026-09-18 — Claude
Status: CONCLUIDO
Arquivos/tabelas: quotes.html, proposals.html
Resumo: Adicionados botoes de ordenacao (cliente, data, titulo, projeto, maior/menor valor) nas abas de Orcamentos e Propostas.
