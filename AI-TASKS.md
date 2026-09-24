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

### FT-001 — Restaurar leitura de notas fiscais pelo bot do Telegram
Status: EM ANDAMENTO
Prioridade: CRITICA
Responsável: Claude
Solicitado por: Fabinho
Criado em: 2026-09-21
Arquivos/sistemas: api/telegram.js, login.html, Vercel, Telegram, Supabase purchases e purchase_items
Objetivo: Implementar os ajustes revisados por Maia em 2026-09-24 (commit 166fc1e, ver AI-HANDOFF.md): estado real do webhook, origem/remetente autorizado, fila persistente sem sobrescrita, deduplicação por update/mensagem, gravação consistente (sem falso sucesso), correção de OCR (quantidade/itens repetidos/reconciliação de total), e não reabrir obras concluídas.
Resultado: Retomando agora — ver progresso detalhado no AI-HANDOFF.md conforme cada item é concluído e testado.

## Tarefas concluídas

### FT-002 — Obra não criada automaticamente ao pagar invoice de cliente recorrente
Concluída em: 2026-09-22
Responsável: Claude
Solicitado por: Fabinho
Resultado: Causa raiz encontrada e corrigida — invoices geradas pela aba Propostas nunca têm quote_id (proposals não tem FK pra quotes), então o trigger fn_auto_create_project_on_invoice_paid só criava obra automática se o cliente não tivesse nenhuma obra ainda. Cliente recorrente com proposta nova ficava sempre bloqueado. Corrigido o trigger pra usar também proposal_id como sinal válido, e corrigida a propagação de obra em invoices.html pra não misturar propostas diferentes do mesmo cliente. Caso da cliente Kerry reprocessado manualmente (obra "Paint Loft + Stairs" criada e vinculada nas 2 parcelas). Ver detalhes em AI-HANDOFF.md.
