# AI Task Queue — Fine Touch ERP

Fila compartilhada de trabalho entre Fabinho, Maia (ChatGPT) e Claude.

## Como funciona

1. Fabinho pode passar pedidos por voz para a Maia.
2. Maia organiza cada pedido nesta fila e define quem executa.
3. Antes de iniciar, Maia e Claude conferem esta fila e o `AI-HANDOFF.md`.
4. Mudanças no ERP continuam sendo registradas no `AI-HANDOFF.md` ao terminar.
5. O executor atualiza o status e escreve um resultado curto.
6. Tarefas concluídas permanecem no arquivo como histórico.

## Status

- `PENDENTE`: aguardando início.
- `EM ANDAMENTO`: alguém está executando.
- `AGUARDANDO FABINHO`: precisa de decisão ou informação.
- `CONCLUIDO`: resultado verificado.
- `BLOQUEADO`: impedimento externo descrito no resultado.

## Prioridades

- `CRITICA`: segurança, indisponibilidade ou risco de perda.
- `ALTA`: afeta operação diária ou clientes.
- `MEDIA`: melhoria importante.
- `BAIXA`: conveniência ou ideia futura.

## Tarefas ativas

### FT-010 — PWA no iPhone + tela Fotografar Nota
Status: CONCLUIDO
Prioridade: MEDIA
Responsável: Claude
Solicitado por: Fabinho (via Maia)
Criado em: 2026-10-01
Arquivos/sistemas: todas as páginas internas do ERP (tags de PWA + manifest), sw.js (novo), capture.html (novo), api/telegram.js (dois endpoints novos reaproveitando a OCR e a gravação já existentes do bot)
Objetivo: Deixar o ERP instalável na tela inicial do iPhone e criar uma forma de lançar custo de obra fotografando a nota direto do celular, sem precisar do Telegram.
Resultado: Implementado, testado e publicado. PWA com tags em todas as páginas internas e um service worker que só cacheia asset estático (nunca dado de negócio). Tela /capture reaproveita a mesma OCR e a mesma gravação do bot — nenhum serviço novo contratado — com deduplicação por hash do arquivo original (bloqueio real, não só aviso). Dois bugs encontrados e corrigidos durante o teste real (hash calculado no momento errado; lista de obras ficando vazia quando a OCR falhava). Testado de ponta a ponta com a sessão já autenticada do Fabinho, incluindo um teste de duplicidade com dado fictício criado e removido na hora (sem deixar rastro). Detalhes completos no cartão privado FT-010.

### FT-008 — Financeiro 2: fechamento de obras, entradas do mês e margem por modelo de execução
Status: EM ANDAMENTO (implementado, deployado e validado via banco/dados reais; falta conferência visual do Fabinho na interface, que não tenho login pra fazer)
Prioridade: MEDIA
Responsável: Claude
Solicitado por: Fabinho (via Maia)
Criado em: 2026-09-29
Arquivos/sistemas: financial2.html (único arquivo alterado) — sem alterar nenhum lançamento, cliente ou pagamento
Objetivo: Separar "venda" (valor contratado, atribuído ao mês de fechamento/aceite real da obra) de "caixa" (dinheiro recebido, pela data real de pagamento de cada parcela), evitando que uma obra parcelada apareça duplicada ou espalhada em vários meses. Mostrar, por mês: obras fechadas (contratado/recebido/saldo), entradas de caixa separadas (incluindo parcelas de obras fechadas em meses anteriores), margem por modelo de execução (interno/subcontratado/misto) e um gráfico de vendas x recebimentos dos últimos 12 meses.
Resultado: Implementado e publicado (commit 14b2555). Validado com consultas diretas ao banco e replicação das mesmas fórmulas de cálculo contra dados reais (incluindo um caso real de parcela cruzando dois meses), confirmando que a venda não é duplicada por parcela. Detalhes completos, números e evidências ficam só no cartão privado FT-008 (dados financeiros específicos não vão neste repositório público). Falta: Fabinho conferir visualmente na interface (não tenho como logar no ERP pra fazer esse último passo).

### FT-004 — RLS de quotes/quote_items/invoices, api_secrets e funções privilegiadas
Status: EM ANDAMENTO
Prioridade: CRITICA
Responsável: Claude
Solicitado por: Fabinho (via Maia)
Criado em: 2026-09-24
Arquivos/sistemas: Supabase RLS (quotes, quote_items, invoices, api_secrets) e as funções SECURITY DEFINER privilegiadas já identificadas na auditoria (fn_auto_approve_quote_on_invoice_paid, fn_auto_create_followup_task_on_project_completed, fn_auto_create_project_on_invoice_paid) — sem alterar dados financeiros/pagamentos/notas antigas
Objetivo: Bloquear leitura anônima irrestrita de quotes/quote_items/invoices, impedir que usuário não aprovado acesse módulos internos, corrigir api_secrets e as funções privilegiadas expostas a anon/authenticated sem necessidade. Preservar link legítimo de cliente/site com acesso limitado por documento (não listagem) e o acesso normal da equipe aprovada. Não inventar nova matriz de cargos.
Resultado: 3 rodadas. 1ª: quotes/quote_items/invoices/api_secrets + 3 funções privilegiadas. 2ª: clients/projects/purchases/transactions + get_invoice_for_print restrita aos campos usados. 3ª (varredura completa do schema, não mais tabela por tabela): activity_log, catalog_portfolio, catalog_products, catalog_services, content_queue, contracts, fb_leads_processed, leads, marketing_campaigns, marketing_data, marketing_tasks, pendencias, project_stages, proposal_bundle_items, proposal_bundles, purchase_items, qr_scans, suppliers, tasks restritos a equipe aprovada; profiles/invoice_items travadas 100% (tabelas mortas, sem uso no código). Preservados intactos: site_insert_clients, site_insert_leads, qr_scans_insert_anon (público intencional). Sinalizado sem corrigir: competitors_public_read (categoria diferente — exposição anon, não pendente-via-authenticated). Pendência separada registrada (não corrigida): invoices.notes mistura texto de cliente com avisos internos do sistema. Testes visitante/pendente/aprovado/admin em todas as 21 tabelas desta rodada, validado ao vivo no navegador. Nenhum dado alterado. Ver lista completa e evidências em AI-HANDOFF.md. Falta: revisão final da Maia.

### FT-001 — Restaurar leitura de notas fiscais pelo bot do Telegram
Status: EM ANDAMENTO
Prioridade: CRITICA
Responsável: Claude
Solicitado por: Fabinho
Criado em: 2026-09-21
Arquivos/sistemas: api/telegram.js, users.html, Vercel, Telegram, Supabase purchases e purchase_items
Objetivo: Implementar os ajustes revisados por Maia em 2026-09-24 (commit 166fc1e, ver AI-HANDOFF.md), incluindo a segunda rodada de correções pedida por ela (segredo operacional server-side em vez de sessão do navegador, botão de reconexão no ERP, lista de remetentes restrita a valor comprovado, checagem de from.id, e correção da janela de perda de update em falha real).
Resultado: Implementado, deployado (commit 6655703) e testado tecnicamente em produção sem criar despesa real (ver evidências completas em AI-HANDOFF.md): webhook reconectado via segredo operacional do servidor, secret_token confirmado, remetente autorizado restrito ao chat_id comprovado (7758479066 removido por falta de comprovação), checagem de from.id além de chat.id, deduplicação por update_id, liberação de reserva + retry em falha real (testado forçando um erro controlado — devolveu 500 e liberou a reserva), botão "Reconectar Telegram" + status ao vivo dentro do ERP (sem função serverless nova). As 2 notas antigas (CMP-69907, CMP-81778) ficam fora do escopo por decisão explícita do Fabinho — já registradas, preservadas, não reprocessadas. Falta apenas a validação com uso real (não simulável sem criar despesa real): nota única, duas seguidas, resposta por áudio/texto e conferência de compra+itens no ERP. Só fecho como CONCLUIDO depois disso.
Revalidado em 30/09: uma foto de nota fiscal real chegou em 29/09 (2 updates confirmados em `telegram_processed_updates`), mas de um chat_id que **não** está autorizado a operar o bot — pelo desenho de segurança já implementado, foi descartada sem processar (sem resposta ao remetente, só log interno). Nenhuma nota duplicada, nenhum dado inventado. Adicionei uma ferramenta de identificação de chat_id (`?whois=`, endpoint admin-only + campo em /users) pra confirmar com certeza — via o próprio Telegram, não adivinhando — a quem esse chat pertence antes de qualquer decisão de autorizar (mudança de segurança, não decido sozinho). Commit 8608acc. Detalhes completos (qual obra, qual chat_id) só no cartão privado FT-009. Segue AGUARDANDO FABINHO confirmar a identidade do chat e reenviar a nota (pelo chat já autorizado ou, se confirmado, pelo novo).

Atualização 01/10 (correção de segurança): o comprovante anexado na entrada anterior tinha ficado publicamente acessível — usei por engano um bucket de storage que já era público por padrão. Corrigido: comprovantes agora vão pra um bucket privado novo, só acessível por usuário aprovado, com link temporário em vez de URL pública fixa. A foto foi reenviada e conferida íntegra no bucket novo antes de remover a cópia pública antiga. Acesso anônimo testado e negado; acesso autorizado testado e funcionando. Detalhes no cartão privado.

Atualização 01/10: o custo em questão já foi lançado — Fabinho anexou a foto e autorizou o lançamento manual direto em /purchases (sem depender do bot). Conferida ausência de duplicidade antes de gravar. Como a interface não tinha onde anexar comprovante nem informar imposto separado, adicionei os dois campos ao formulário existente (reaproveitando o mesmo bucket de fotos e o mesmo fluxo de salvar já usado pela página), com uma política de acesso nova restrita a usuário aprovado. Commit 86b5901. Isso resolve o lançamento em si, mas não a validação do fluxo do bot — a ambiguidade do chat_id de origem continua em aberto.

Revalidado em 29/09: reli Handoff/fila antes de mexer — os 3 itens pedidos nessa rodada (botão de reconexão, fila anti-sobrescrita, confirmação antes de gravar) já estavam implementados desde 24/09; não reescrevi nada. Confirmado ao vivo: webhook conectado, sem backlog, código da fila e do botão presentes no deploy atual (commit c7b63d8, mesmo HEAD de hoje). `telegram_processed_updates` com 0 linhas desde 24/09 = nenhuma mensagem real chegou ainda (não é falha). Segue AGUARDANDO FABINHO mandar uma nota real pro bot pra fechar a validação — não depende de código.

## Tarefas concluídas

### FT-003 — Corrigir permissões de acesso (RLS) — proposals e user_profiles
Concluída em: 2026-09-24
Responsável: Claude (transferido de Maia/ChatGPT nesta tarefa)
Solicitado por: Fabinho
Resultado: RLS corrigido em proposals e user_profiles (policy aberta removida, acesso restrito a equipe aprovada/admin, sem caminho de auto-aprovação). Achado crítico incidental corrigido: RPC create_purchase_with_items (FT-001) estava executável por anon/authenticated, agora restrita a service_role. Testado (visitante/pendente/comum/admin, tudo com rollback, sem dados reais criados) e validado ao vivo no navegador. Conta de teste test-invite-check@mailinator.com removida de auth.users e user_profiles (confirmado zero registros, não repetido). Revisado e aprovado pela Maia diretamente no banco. Ver detalhes completos em AI-HANDOFF.md.

### FT-002 — Obra não criada automaticamente ao pagar invoice de cliente recorrente
Concluída em: 2026-09-22
Responsável: Claude
Solicitado por: Fabinho
Resultado: Causa raiz encontrada e corrigida — invoices geradas pela aba Propostas nunca têm quote_id (proposals não tem FK pra quotes), então o trigger fn_auto_create_project_on_invoice_paid só criava obra automática se o cliente não tivesse nenhuma obra ainda. Cliente recorrente com proposta nova ficava sempre bloqueado. Corrigido o trigger pra usar também proposal_id como sinal válido, e corrigida a propagação de obra em invoices.html pra não misturar propostas diferentes do mesmo cliente. Caso da cliente Kerry reprocessado manualmente (obra "Paint Loft + Stairs" criada e vinculada nas 2 parcelas). Ver detalhes em AI-HANDOFF.md.
