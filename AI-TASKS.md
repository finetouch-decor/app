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

### FT-004 — RLS de quotes/quote_items/invoices, api_secrets e funções privilegiadas
Status: EM ANDAMENTO
Prioridade: CRITICA
Responsável: Claude
Solicitado por: Fabinho (via Maia)
Criado em: 2026-09-24
Arquivos/sistemas: Supabase RLS (quotes, quote_items, invoices, api_secrets) e as funções SECURITY DEFINER privilegiadas já identificadas na auditoria (fn_auto_approve_quote_on_invoice_paid, fn_auto_create_followup_task_on_project_completed, fn_auto_create_project_on_invoice_paid) — sem alterar dados financeiros/pagamentos/notas antigas
Objetivo: Bloquear leitura anônima irrestrita de quotes/quote_items/invoices, impedir que usuário não aprovado acesse módulos internos, corrigir api_secrets e as funções privilegiadas expostas a anon/authenticated sem necessidade. Preservar link legítimo de cliente/site com acesso limitado por documento (não listagem) e o acesso normal da equipe aprovada. Não inventar nova matriz de cargos.
Resultado: Completa em 2 rodadas (Maia revisou e aprovou a 1ª antes da 2ª). 1ª: quotes/quote_items/invoices/api_secrets + 3 funções privilegiadas (commit 8d6d911). 2ª: clients/projects/purchases/transactions restritos a equipe aprovada (fechando o acesso de usuário pendente a módulos internos, mantendo site_insert_clients intacto pro lead do site) + get_invoice_for_print reescrita pra devolver só os campos que a página de impressão usa (antes expunha a linha inteira da invoice). Testes visitante/pendente/aprovado/admin ok em todas as tabelas, validado ao vivo no navegador (sessão real e sem sessão). Nenhum dado financeiro alterado. Ver evidências completas em AI-HANDOFF.md. Falta: revisão final da Maia.

### FT-001 — Restaurar leitura de notas fiscais pelo bot do Telegram
Status: EM ANDAMENTO
Prioridade: CRITICA
Responsável: Claude
Solicitado por: Fabinho
Criado em: 2026-09-21
Arquivos/sistemas: api/telegram.js, users.html, Vercel, Telegram, Supabase purchases e purchase_items
Objetivo: Implementar os ajustes revisados por Maia em 2026-09-24 (commit 166fc1e, ver AI-HANDOFF.md), incluindo a segunda rodada de correções pedida por ela (segredo operacional server-side em vez de sessão do navegador, botão de reconexão no ERP, lista de remetentes restrita a valor comprovado, checagem de from.id, e correção da janela de perda de update em falha real).
Resultado: Implementado, deployado (commit 6655703) e testado tecnicamente em produção sem criar despesa real (ver evidências completas em AI-HANDOFF.md): webhook reconectado via segredo operacional do servidor, secret_token confirmado, remetente autorizado restrito ao chat_id comprovado (7758479066 removido por falta de comprovação), checagem de from.id além de chat.id, deduplicação por update_id, liberação de reserva + retry em falha real (testado forçando um erro controlado — devolveu 500 e liberou a reserva), botão "Reconectar Telegram" + status ao vivo dentro do ERP (sem função serverless nova). As 2 notas antigas (CMP-69907, CMP-81778) ficam fora do escopo por decisão explícita do Fabinho — já registradas, preservadas, não reprocessadas. Falta apenas a validação com uso real (não simulável sem criar despesa real): nota única, duas seguidas, resposta por áudio/texto e conferência de compra+itens no ERP. Só fecho como CONCLUIDO depois disso.

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
