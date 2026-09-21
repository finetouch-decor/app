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
