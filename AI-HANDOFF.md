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

### 2026-09-24 14:10 EDT — Claude
Status: EM ANDAMENTO (implementado e testado, falta revisão da Maia)
Arquivos/tabelas: Supabase RLS (quotes, quote_items, invoices, api_secrets); funções fn_auto_approve_quote_on_invoice_paid, fn_auto_create_followup_task_on_project_completed, fn_auto_create_project_on_invoice_paid (revoke), get_invoice_for_print (nova); invoice-print.html
Resumo: FT-004 (1ª parte). `quotes`/`quote_items`: policy aberta a anon+authenticated (sem checar aprovado) trocada por acesso só de equipe aprovada — não existe página pública de orçamento. `invoices`: mesmo problema (mais grave, dado financeiro) — mas `invoice-print.html` É um link público legítimo real (confirmei no código, sem sessão, lê por `?id=`). Preservei o link: criei `get_invoice_for_print(uuid)` (SECURITY DEFINER, retorna só a invoice pedida com cliente/orçamento/itens) e atualizei a página pra chamar essa função em vez da tabela direto — mesmo link, sem listagem possível via API. `api_secrets`: nenhum código cliente usa (busquei no repo todo) — travado 100% pro cliente, só service_role. As 3 funções privilegiadas da auditoria: `EXECUTE` revogado de anon/authenticated/PUBLIC; confirmei com teste (rollback) que o trigger de invoice paga continua funcionando normalmente.
Testes (tudo com BEGIN/ROLLBACK, usuários reais existentes, nada inventado, nada real alterado): anônimo e pendente = 0 linhas e 0 escrita nas 4 tabelas; aprovado e admin = acesso total a quotes/quote_items/invoices, 0 em api_secrets pra todo mundo (nenhum cargo novo inventado, só travado igual pra todos via API). `get_invoice_for_print` testado com invoice real (retornou dados completos corretos) e com id falso (retornou nulo, sem erro, sem vazar nada). Validado AO VIVO no navegador (sessão isolada, sem login) que o link do invoice continua funcionando normal. Advisor de segurança rodado no final: nenhum achado novo além dos avisos esperados/intencionais (as próprias `get_invoice_for_print`/`is_approved_admin`/`is_approved_user` aparecerem como "chamável por authenticated" é necessário pro RLS funcionar, não é falha).
Não alterei nenhum dado financeiro, pagamento ou invoice antiga — só políticas de acesso.
Observação (não corrigida, fora de escopo): a página `invoice-print.html` mostra botões "Edit"/"Delete" pra qualquer visitante (não checa sessão pra exibir a UI) — mas cliques nesses botões já são bloqueados de verdade pelo RLS agora (testado, 0 linhas afetadas), então não é um risco real, só um detalhe de UI que pode ser limpo depois se quiserem.
Ficou de fora desta rodada (pré-existente, não pedido, não é dependência indispensável): `campaign_performance` (view SECURITY DEFINER), `fn_auto_approve_quote_on_invoice_paid`/`fn_auto_create_followup_task_on_project_completed` sem `search_path` fixo, proteção de senha vazada desativada no Auth.
Falta: Maia revisar antes de marcar FT-004 como CONCLUIDO.

### 2026-09-24 13:05 EDT — ChatGPT (Maia) + Claude
Status: CONCLUIDO (FT-003) / EM ANDAMENTO (FT-004 aberta)
Arquivos/tabelas: user_profiles, auth.users (limpeza); AI-TASKS.md (FT-003 fechada, FT-004 criada)
Resumo: Maia revisou a FT-003 direto no banco e aprovou: RLS ativo, propostas só pra aprovados, perfis editáveis só por admin aprovado, cadastro continua pending/pending, RPC de compras sem execute pra anon/authenticated. Registro a aprovação aqui e fecho a FT-003 como CONCLUIDO (ver entrada completa abaixo com evidências).
Limpeza solicitada por Fabinho (via Maia): conta de teste `test-invite-check@mailinator.com` removida de `auth.users` e `user_profiles`. Verifiquei diretamente no banco (não repeti a exclusão, já estava feita): zero linhas com esse email em `auth.users`, zero em `user_profiles`, total de usuários caiu de 3 pra 2. Confirmado.
Próxima tarefa aberta como **FT-004** (ver AI-TASKS.md): revisar/corrigir leitura anônima irrestrita de `quotes`/`quote_items`/`invoices`, acesso de usuário não aprovado a módulos internos, `api_secrets`, e as funções privilegiadas já identificadas no advisor (`fn_auto_approve_quote_on_invoice_paid`, `fn_auto_create_followup_task_on_project_completed`, `fn_auto_create_project_on_invoice_paid`). Escopo explícito antes de alterar: preservar link legítimo de cliente/site com acesso limitado por documento (não listagem) e o acesso normal da equipe aprovada; não inventar nova matriz de cargos; não alterar dados financeiros/pagamentos/notas antigas; migrations reversíveis; testes sem dados permanentes nem mensagens externas.

### 2026-09-24 12:15 EDT — Claude
Status: EM ANDAMENTO
Arquivos/tabelas: Supabase RLS — tabelas `proposals` e `user_profiles`; funções novas `is_approved_user()`, `is_approved_admin()`; grants de `create_purchase_with_items` (correção incidental crítica, ver abaixo)

**Transferência explícita de responsabilidade (registrada antes de iniciar qualquer mudança, por pedido direto do Fabinho)**: a entrada de 2026-09-21 abaixo ("Log RLS audit review — ChatGPT owns the fix") atribuía a correção de RLS de `proposals`, `user_profiles`, `invoices`, `quotes`, `quote_items`, `api_secrets` à Maia/ChatGPT, e eu registrei explicitamente que não mexeria nessas tabelas até ela concluir. Fabinho agora autorizou e pediu que EU execute, **especificamente e apenas** `proposals` e `user_profiles` — as demais tabelas (`invoices`, `quotes`, `quote_items`, `api_secrets`, pagamentos) continuam fora do meu escopo e não foram tocadas nesta tarefa; a atribuição delas a quem for corrigi-las permanece como estava. Maia coordena/revisa este trabalho, não duplica a implementação.

**Estado real confirmado antes de mudar** (não presumi nada da auditoria antiga): reconfirmei via `pg_policies` que ambas as tabelas tinham uma única policy `all_access`, role `public`, `USING (true) WITH CHECK (true)` — leitura E escrita totalmente livres pra qualquer um com a chave anon pública, exatamente como a auditoria original apontou.

**Fluxos dependentes mapeados antes de mudar** (pra não quebrar nada):
- Cadastro: a linha em `user_profiles` é criada por um trigger `on_auth_user_created` → função `handle_new_user()`, que é `SECURITY DEFINER` — roda com privilégio do dono, não passa por RLS. Confirmado que não quebra com a correção.
- Convite (`api/invite-user.js`) e o gate administrativo do bot do Telegram (`api/telegram.js`) usam a `SUPABASE_SERVICE_ROLE_KEY` — bypassam RLS, não afetados.
- Todo "estou logado e aprovado?" (login.html, dashboard.html, users.html, proposals.html, quotes.html, etc. — mapeado ~17 arquivos) faz `select('status,role,...').eq('id', session.user.id)` — precisa continuar podendo ler a PRÓPRIA linha.
- Aprovar/rejeitar/revogar em `users.html` faz `UPDATE user_profiles SET status,role,... .eq('id', outroUsuario)` — só chamado por quem já é admin (checagem hoje só no cliente; agora also reforçada no banco).
- **Propostas para clientes**: procurei ativamente por uma página pública de visualização/aceite de proposta por link (era a premissa do pedido) e **não existe nenhuma** — `proposals.html` e `proposal-bundles.html` exigem sessão autenticada 100% do tempo; o que é enviado ao cliente é um PDF exportado (botão "Salvar PDF" / `window.print()`), não um link vivo no app. Ou seja, não havia nenhum "link já enviado" a preservar tecnicamente — reporto isso explicitamente pra Maia/Fabinho confirmarem que não existe outro mecanismo que eu não tenha encontrado.

**Migration aplicada** (reversível — SQL de rollback completo no comentário da própria migration, nenhuma linha de dado apagada):
- `user_profiles`: removida `all_access`; criadas `self_select` (autenticado lê só a própria linha), `admin_select_all` e `admin_update_any` (só admin aprovado lê/atualiza qualquer linha — via função `is_approved_admin()`). Nenhuma policy de UPDATE existe pra usuário comum — ele não tem NENHUM caminho de escrita liberado pra `role`/`status`, então autoaprovação/autopromoção fica impossível, não só bloqueada por regra de negócio.
- `proposals`: removida `all_access`; criada `team_full_access` (qualquer membro da equipe aprovado, via `is_approved_user()`, mantém acesso total — não restringi a admin porque o app atual não restringe proposals a admin especificamente).
- Precisei mover a checagem "sou admin/aprovado?" pra funções `SECURITY DEFINER` (`is_approved_admin`, `is_approved_user`) porque uma policy que consulta a própria tabela via subquery direta causa recursão infinita no Postgres (testado, decisão baseada em erro real, não suposição).

**Achado crítico incidental (fora do escopo desta tarefa, corrigido na hora por ser risco financeiro ativo)**: rodando o advisor de segurança do Supabase depois da migration, descobri que a função `create_purchase_with_items` (criada por mim mesmo na FT-001, usada pelo bot do Telegram) estava com `EXECUTE` concedido a `anon` e `authenticated` — ou seja, **qualquer pessoa com a chave pública anon podia chamar `/rest/v1/rpc/create_purchase_with_items` direto e criar compras/despesas falsas no banco real**, sem passar pelo bot nem por nenhuma autorização. Causa: `REVOKE ALL ... FROM PUBLIC` não remove grants que o Supabase concede DIRETO às roles `anon`/`authenticated` (fora de `PUBLIC`) em funções novas por padrão — eu não sabia disso na hora de implementar a FT-001. Corrigido imediatamente: `REVOKE EXECUTE ... FROM anon, authenticated`, deixando só `postgres`/`service_role`. Confirmado no advisor que o achado sumiu da lista. Também revoguei `anon` (mantendo `authenticated`, necessário pras policies novas) de `is_approved_admin`/`is_approved_user` por precaução, embora o risco ali fosse baixo (a função só responde true/false sobre o próprio `auth.uid()`, que é nulo pra anon).

**Testes controlados** (todos dentro de `BEGIN...ROLLBACK`, simulando `auth.uid()` de usuários REAIS já existentes — não inventei usuário nenhum, não mandei mensagem/convite a ninguém, nenhum dado real foi alterado):
- ✅ Visitante anônimo: 0 linhas visíveis em `user_profiles` e `proposals`; tentativa de INSERT em `proposals` rejeitada (erro de RLS); tentativa de UPDATE em `user_profiles` afeta 0 linhas.
- ✅ Usuário pendente (Test User): vê só a própria linha em `user_profiles` (1, não as 3), 0 propostas; tentativa de se auto-aprovar/virar admin afeta 0 linhas.
- ✅ Usuário aprovado comum (Tiele): vê só a própria linha em `user_profiles` (não a lista toda), vê as 83 propostas (acesso de equipe preservado); tentativa de se auto-promover a admin afeta 0 linhas.
- ✅ Admin (Fabinho): vê as 3 linhas de `user_profiles`, aprova/rejeita outro usuário com sucesso (1 linha afetada), lê e insere em `proposals` normalmente.
- ✅ `create_purchase_with_items`: confirmado nos grants reais que `anon`/`authenticated` não conseguem mais chamar (só `service_role`).
- Não testei o gate administrativo do bot do Telegram nem os links de cliente porque ambos usam a service role key (bypassam RLS) e/ou não existem (proposta = PDF, não link) — nada a testar nesses dois pontos especificamente para RLS.

Não marco como CONCLUIDO até a Maia revisar. Nenhuma tabela além de `proposals`/`user_profiles` foi alterada (as pré-existentes `fn_auto_approve_quote_on_invoice_paid`, `fn_auto_create_followup_task_on_project_completed`, `fn_auto_create_project_on_invoice_paid` também aparecem no advisor como `SECURITY DEFINER` chamáveis por anon/authenticated — são anteriores a hoje, tocam invoices/quotes, e ficam de fora por decisão explícita de escopo desta tarefa; reporto pra registro, não corrigi).

### 2026-09-24 11:41 EDT — Claude
Status: EM ANDAMENTO
Arquivos/tabelas: api/telegram.js; users.html (novo botão "Reconectar Telegram" + status); Vercel (env var nova TELEGRAM_OPS_SECRET; TELEGRAM_AUTHORIZED_CHAT_IDS corrigida)
Resumo: Segunda rodada, respondendo à revisão da Maia sobre a entrada anterior (abaixo). Commit 6655703 deployado (dpl_EqHVXELZJV8XSReZaQJdptiYWLKb).

Correções desta rodada:
- **Reconexão sem sessão do navegador**: `?setup=1`/`?status=1` agora também aceitam um segredo operacional (`TELEGRAM_OPS_SECRET`, header `X-Ops-Secret`) só conhecido pelo ambiente do servidor — usei esse caminho pra terminar de registrar o `secret_token` no Telegram sem extrair nem depender da sessão do Fabinho. Nunca enfraqueceu a proteção existente (sessão de admin continua funcionando igual).
- **Botão "Reconectar Telegram" + status real, dentro do ERP**: adicionado em `/users` (página já admin-only), com status ao vivo (`getWebhookInfo`) e botão de reconexão — usa a própria sessão do navegador já logado (mesmo padrão que `notifyTelegram()` em login.html), nunca extraída por mim. Não precisa mais de console/código manual daqui pra frente. Não criou função serverless nova (reaproveita api/telegram.js) — continua em 12 funções.
- **Removido o 7758479066 da lista autorizada**: a Maia estava certa — eu tinha incluído "por segurança" um valor que eu mesmo já tinha dito não ter comprovação de ser do Fabinho pra fins de RECEBER comandos (é só o destino de envio do alerta de cadastro, papel diferente). `TELEGRAM_AUTHORIZED_CHAT_IDS` agora tem só o `5483720444`, o único confirmado em `marketing_data.owner_telegram_chat_id` a partir de mensagens reais já recebidas.
- **Checagem de remetente, não só de chat**: agora valida `message.from.id` além de `chat.id`. Hoje é redundante (chat privado = mesma pessoa), mas evita que, se o bot um dia entrar num grupo, o chat_id do grupo sozinho autorize qualquer membro dele.
- **Corrigida janela real de perda de update numa falha**: eu reservava o `update_id` (marcando como processado) ANTES de processar, mas sempre devolvia 200 mesmo numa falha genuína — resultado: se o processamento quebrasse de verdade no meio (bug, banco fora do ar), a atualização ficava marcada "processada" pra sempre e o Telegram nunca reentregava (200 = entregue), perdendo a nota. Agora uma falha real (não os erros esperados de input, que os handlers já tratam e devolvem 200 normalmente) libera a reserva do update_id e devolve status não-200, deixando o retry nativo do Telegram reprocessar de verdade.

Testes controlados (sem criar despesa real, todos limpos depois):
- ✅ Webhook reconectado via segredo operacional do servidor — confirmado `getWebhookInfo` sem backlog (`pending_update_count:0`) antes e depois.
- ✅ Remetente com chat autorizado mas `from.id` diferente → bloqueado e logado ("remetente nao autorizado... from: 111111111").
- ✅ Remetente com chat E from.id autorizados → processado normalmente (comando `ajuda`, sem gravação financeira).
- ✅ POST sem secret_token, mesmo remetente autorizado → 401 (proteção de origem independente da autorização de remetente).
- ✅ Falha real forçada de propósito (payload sem `chat`, erro não tratado) → devolveu 500 (não 200) e a reserva do update_id foi liberada (conferido no banco: linha não ficou presa) — exatamente o comportamento que evita perder a atualização.
- Todos os `update_id` sintéticos usados nos testes foram apagados da tabela `telegram_processed_updates` depois (não são dados reais, só marcadores de deduplicação).

**Atualização explícita do Fabinho**: as 2 notas antigas (CMP-69907, CMP-81778) ficam fora do escopo de lançamento/reprocessamento — já registradas, preservadas sem alteração, não usadas pra validar esta implementação. A validação funcional completa do fluxo (foto → OCR → escolha de obra → gravação) com uma nota real fica para quando o Fabinho usar o bot normalmente; vou acompanhar quando isso acontecer.

Diferenciando o que está CONCLUÍDO tecnicamente do que falta validar com uso real:
- ✅ Concluído e testado: origem do webhook (secret_token), remetente autorizado (chat+from, lista restrita a valor comprovado), deduplicação por update_id, liberação de reserva + retry em falha real, botão de reconexão no ERP, função atômica de gravação (testada isolada no banco com rollback).
- ⏳ Falta validar com uso real do Fabinho (não simulável sem criar despesa real): nota única com itens/totais corretos, duas notas consecutivas sem sobrescrita, resposta por áudio/texto, conferência de compra+itens gravados no ERP.
Não marco FT-001 como CONCLUÍDO até esses itens serem validados com uso real.

### 2026-09-24 11:21 EDT — Claude
Status: EM ANDAMENTO (revisado — ver entrada acima; o item "botão administrativo" e a lista de chat_id autorizado desta entrada foram corrigidos na rodada seguinte)
Arquivos/tabelas: api/telegram.js; Supabase (migration telegram_dedup_and_atomic_purchase: tabela telegram_processed_updates, funcao create_purchase_with_items); Vercel (env vars novas TELEGRAM_WEBHOOK_SECRET e TELEGRAM_AUTHORIZED_CHAT_IDS)
Resumo: Implementados os pontos da revisao da Maia (entrada acima, commit 166fc1e). Commit ddeb0d0 deployado em producao (dpl_9P6XRtfBp94z3kALDdKkWrdLwozn, app-one-amber-58.vercel.app).

O que foi feito e ja validado:
- **Origem do webhook**: `?setup=1` agora registra um `secret_token` no Telegram; o handler principal rejeita (401) qualquer POST sem o header `X-Telegram-Bot-Api-Secret-Token` batendo. Testado: POST sem o header → 401 confirmado em producao.
- **Remetente autorizado**: novo env `TELEGRAM_AUTHORIZED_CHAT_IDS` (chat_id real do Fabinho, confirmado em `marketing_data.owner_telegram_chat_id` = 5483720444 — **atencao**: e diferente do 7758479066 usado como destino do alerta de cadastro; os dois foram incluidos na lista pra nao travar nada). Mensagem de chat nao autorizado e ignorada (200, sem gravar nada) e logada. Testado com chat_id falso em producao: bloqueado e logado nos runtime logs da Vercel ("Telegram: chat nao autorizado tentou usar o bot: 999999999").
- **Deduplicacao por update_id**: tabela nova `telegram_processed_updates` (PK update_id, RLS ligado sem policies — so service role acessa). Testado em producao: mandar o mesmo update_id duas vezes devolve `{"duplicate":true}` na segunda sem reprocessar.
- **Fila persistente por nota**: substitui a chave unica `tg_session_{chatId}` (que uma 2a foto sobrescrevia, e expirava sozinha em 10min) por um estado `{active, pending[]}`. Uma nota/foto que chega com outra conversa em andamento entra na fila e e apresentada depois, sem apagar a que estava ativa. Sem expiracao destrutiva.
- **Gravacao atomica + sem falso sucesso**: nova funcao Postgres `create_purchase_with_items` (SECURITY DEFINER, so `service_role` pode executar) grava purchase+purchase_items numa unica transacao. O bot so avisa "✅ lancado" depois de confirmar que a gravacao realmente aconteceu; se falhar, so os itens nao gravados ficam retidos pra retry (os que ja gravaram nunca sao regravados, entao retry nao duplica). Testado a funcao isoladamente no banco (dry-run com ROLLBACK) — grava purchase + item corretamente e reverte limpo.
- **OCR**: agora extrai qty/unit_price por linha (antes gravava sempre quantidade 1); parou de remover "duplicatas" por descricao+valor (podia apagar itens repetidos legitimos — agora a instrucao pro modelo e nao juntar linhas repetidas de verdade, so uma leitura duplicada por erro). Extrai tax/discount da nota e reconcilia contra o total, avisando quando nao bate; taxa/desconto sao rateados proporcionalmente entre as obras quando a nota e dividida.
- **`GET ?status=1`** (admin): consulta `getWebhookInfo` direto no Telegram sem alterar nada, pra verificar o estado real antes de presumir que falta reconectar.
- Nao mexi em: filtro de obras so "active" no picker (ja estava correto, preservado), nem em invoices/pagamentos.

Verificado ANTES de mexer: as 2 notas fiscais que ficavam pendentes ja tinham sido processadas hoje as 13:09 e 13:13 (antes desta correcao, pelo codigo antigo) — compras CMP-69907 (Sherwin Williams, $20, obra "Custom Door Frame Fabrication & Installation") e CMP-81778 (Lowe's, $220, mesma obra). Confirmado que nao havia sessao (`tg_session_*`/`tg_queue_*`) pendente no banco. Nao reprocessei essas duas.

**Bloqueio / proximo passo obrigatorio**: o webhook que ja estava registrado no Telegram foi configurado ANTES desta correcao, ou seja, SEM o `secret_token`. Com o secret_token agora sendo exigido, o Telegram vai continuar mandando as atualizacoes reais sem esse header ate o webhook ser re-registrado — ou seja, **o bot vai rejeitar (401) mensagens reais do Fabinho ate ele rodar o `?setup=1` mais uma vez** (dessa vez pra registrar o secret_token, nao repeticao do pedido anterior). Pedido a ele no chat.

Testes da lista da Maia — status:
- ✅ Remetente nao autorizado rejeitado (testado em producao, sintetico)
- ✅ Repeticao da mesma atualizacao nao duplica (testado em producao, sintetico)
- ✅ Falha de gravacao sem falso sucesso + retomada (revisado no codigo; RPC testada isoladamente no banco)
- ⏳ Nota unica com itens/totais corretos e escolha da obra — precisa de teste real (foto de nota) apos reconectar o webhook
- ⏳ Duas notas consecutivas sem sobrescrita — idem
- ⏳ Audio/texto pra escolha da obra — idem
- ⏳ Compras e itens conferidos no ERP apos teste real — idem
Nao marco FT-001 como CONCLUIDO ate esses ultimos 4 itens serem confirmados com uso real depois da reconexao do webhook. Botao administrativo de reconexao: nao implementado (webhook ja funcional via `?setup=1`, nao ha necessidade real identificada).

### 2026-09-24 — ChatGPT (Maia)
Status: CONCLUIDO
Arquivos/tabelas: AI-HANDOFF.md (registro); api/telegram.js e AI-TASKS.md revisados somente em leitura
Resumo: Revisao da FT-001 concluida, implementacao e validacao operacional ainda pendentes com Claude; Maia coordena e revisa, sem duplicar codigo. Handoff usado para customizacoes e coordenacao tecnica, nao para registrar pagamentos rotineiros. Evidencia na captura de Fabinho: ele informou ao Claude retorno "{ok: true, description: null}" do comando; portanto reconexao pode ja ter sido feita, verificar estado real antes de pedir repeticao. Sem acesso nesta revisao ao estado atual do webhook ou dados das compras.

Pendencias tecnicas verificadas no codigo atual:
- saveSession usa uma unica chave tg_session_CHAT e handlePhoto a substitui a cada nota; segunda nota/foto pode apagar a primeira pendente. getSession ignora sessoes apos 10 minutos. Implementar fila persistente por nota/mensagem e retomada.
- Handler nao verifica segredo de origem do webhook nem remetente/chat autorizado antes de operar com service role; inclusive sobrescreve owner_telegram_chat_id a partir de qualquer mensagem. Proteger origem e permissoes, sem confiar apenas no chat_id informado no corpo.
- Nao ha deduplicacao por update_id/message_id nem gravacao atomica de purchase + purchase_items. sbInsert nao verifica HTTP; handleSessionReply pode anunciar sucesso e apagar sessao mesmo com falha. Persistir estado, impedir repeticoes e so confirmar sucesso apos gravacao completa.
- OCR elimina linhas iguais por descricao/valor, podendo remover itens legitimos repetidos; grava quantidade 1 e total por linha, nao preserva quantidade/preco unitario real. Nao reconcilia soma de itens com total da nota/impostos/descontos. Corrigir antes de considerar valores validados.
- Obras oferecidas sao apenas active. Nao reabrir automaticamente obra encerrada para recuperar nota antiga. Conferir primeiro se notas antigas ja foram lancadas; caso necessario definir fluxo explicito para custo tardio sem mudar status da obra.
- Testes de aceite: nota unica com itens/totais corretos e escolha da obra; duas notas consecutivas sem sobrescrita; repeticao da mesma atualizacao sem duplicar; falha de OCR/banco sem falso sucesso e com retomada; remetente nao autorizado rejeitado; audio/texto para escolha; compras e itens conferidos no ERP.
- Botao administrativo de reconexao e melhoria de usabilidade, nao prova de funcionamento nem pre-requisito se webhook ja estiver ativo. Verificar conexao/configuracao e processamento real antes de implementar por suposicao.
Proximo passo: Claude corrigir os pontos acima e registrar evidencias de publicacao/testes; Maia revisar resultado. Esta entrada conclui somente a revisao, nao a FT-001.

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
