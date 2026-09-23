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
Status: AGUARDANDO FABINHO
Prioridade: CRITICA
Responsável: Claude
Solicitado por: Fabinho
Criado em: 2026-09-21
Arquivos/sistemas: api/telegram.js, login.html, Vercel, Telegram, Supabase purchases e purchase_items
Objetivo: Depois da troca do token, religar o webhook do bot e confirmar o fluxo completo: foto da nota, leitura dos itens, lista de obras ativas, separação dos valores, escolha da obra e gravação no ERP.
Resultado: Assumi a tarefa (estava com a Maia). Consolidei api/notify-telegram.js dentro de api/telegram.js (rota ?notify=1), removi o arquivo antigo e reduzi as funções serverless de 13 para 12 — descobri que esse era o motivo real dos 2 últimos deploys terem falhado silenciosamente ("exceeded_serverless_functions_per_deployment", limite do plano Hobby da Vercel), deixando a produção presa numa versão antiga. Deploy do commit 15cd143 confirmado no ar (app-one-amber-58.vercel.app); rotas ?notify=1 e ?setup=1 testadas e corretas. Falta: Fabinho rodar a reconexão do webhook (POST /api/telegram?setup=1 — precisa de sessão de admin logado, não posso autenticar como ele) e confirmar que as 2 notas fiscais que ficaram pendentes no bot passam por OCR → escolha de obra → gravação em purchases/purchase_items sem duplicar. Passo a passo enviado ao Fabinho no chat.

## Tarefas concluídas

### FT-002 — Obra não criada automaticamente ao pagar invoice de cliente recorrente
Concluída em: 2026-09-22
Responsável: Claude
Solicitado por: Fabinho
Resultado: Causa raiz encontrada e corrigida — invoices geradas pela aba Propostas nunca têm quote_id (proposals não tem FK pra quotes), então o trigger fn_auto_create_project_on_invoice_paid só criava obra automática se o cliente não tivesse nenhuma obra ainda. Cliente recorrente com proposta nova ficava sempre bloqueado. Corrigido o trigger pra usar também proposal_id como sinal válido, e corrigida a propagação de obra em invoices.html pra não misturar propostas diferentes do mesmo cliente. Caso da cliente Kerry reprocessado manualmente (obra "Paint Loft + Stairs" criada e vinculada nas 2 parcelas). Ver detalhes em AI-HANDOFF.md.
