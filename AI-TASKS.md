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

### FT-003 — Corrigir permissões de acesso (RLS) — proposals e user_profiles
Status: EM ANDAMENTO
Prioridade: CRITICA
Responsável: Claude (transferido de Maia/ChatGPT nesta tarefa — ver transferência explícita e escopo em AI-HANDOFF.md)
Solicitado por: Fabinho
Criado em: 2026-09-24
Arquivos/sistemas: Supabase RLS (tabelas proposals, user_profiles; funções is_approved_user, is_approved_admin) — sem tocar invoices/quotes/quote_items/pagamentos
Objetivo: Bloquear leitura/escrita anônima irrestrita em proposals e user_profiles, impedir autoaprovação/elevação de role por usuário comum, manter cadastro pendente + aprovação administrativa + acesso legítimo da equipe funcionando, sem quebrar nenhum fluxo dependente nem apagar dados.
Resultado: Implementado, testado (visitante/pendente/comum/admin, todos com rollback, sem criar dados reais) e deployado via migration no Supabase. Ver evidências completas, achado crítico incidental (RPC create_purchase_with_items exposta a anon) e detalhes em AI-HANDOFF.md. Falta: Maia revisar o resultado antes de fechar como CONCLUIDO.

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

### FT-002 — Obra não criada automaticamente ao pagar invoice de cliente recorrente
Concluída em: 2026-09-22
Responsável: Claude
Solicitado por: Fabinho
Resultado: Causa raiz encontrada e corrigida — invoices geradas pela aba Propostas nunca têm quote_id (proposals não tem FK pra quotes), então o trigger fn_auto_create_project_on_invoice_paid só criava obra automática se o cliente não tivesse nenhuma obra ainda. Cliente recorrente com proposta nova ficava sempre bloqueado. Corrigido o trigger pra usar também proposal_id como sinal válido, e corrigida a propagação de obra em invoices.html pra não misturar propostas diferentes do mesmo cliente. Caso da cliente Kerry reprocessado manualmente (obra "Paint Loft + Stairs" criada e vinculada nas 2 parcelas). Ver detalhes em AI-HANDOFF.md.
