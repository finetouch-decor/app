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
Responsável: Maia (ChatGPT)
Solicitado por: Fabinho
Criado em: 2026-09-21
Arquivos/sistemas: api/telegram.js, Vercel, Telegram, Supabase purchases e purchase_items
Objetivo: Depois da troca do token, religar o webhook do bot e confirmar o fluxo completo: foto da nota, leitura dos itens, lista de obras ativas, separação dos valores, escolha da obra e gravação no ERP.
Resultado: Aguardando publicação e teste completo.

## Tarefas concluídas

Nenhuma ainda.
