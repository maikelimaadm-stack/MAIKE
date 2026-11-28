# Relatório — Remoção das atividades para recomeçar do zero (D-PROD-383)

**Data:** 2026-11-28 · **Branch:** `claude/remover-atividades` · **PR:** rascunho, sem merge até o proprietário pedir

## Pedido

O proprietário: "vamos apagar tudo das atividades, vamos apagar tudo ok vamos iniciar uma nova, desde de cadastro etc".

Escolhas dele:
- apagar **código e dados** (migration que remove as tabelas);
- sai tudo: atividades e lançamentos, tipos de atividade, cadastro de Serviços, Diário e ações no mapa, e a reforma de pastagem (Planejamento);
- os **grupos de atividade ficam**, só para as tarefas;
- a estrutura nova ele explica depois, numa missão própria.

## O que saiu

### Servidor
- Módulos `atividades` (com o Planejamento), `tiposAtividade` e `servicos`, e as rotas `/atividades`, `/tipos-atividade`, `/servicos` e `/planejamentos`. Uma rota removida responde o 404 padrão do Fastify.
- Os erros de vínculo com atividade, serviço e tipo padrão.
- As ligações nos outros módulos:
  - **estoque:** consultas, recálculo, exclusão, entradas e lotes de nota;
  - **patrimônio:** o abastecimento não aceita mais atividade nem lançamento (`apontamento_id` diferente de `null` dá 400 `atividades_removidas`); a série do medidor lê só os abastecimentos;
  - **produtos, fornecedores, unidades, pontos de suplementação:** não contam mais o uso em atividades na exclusão;
  - **grupos de atividade:** contam e propagam só nos tipos de tarefa;
  - **permissões:** saem as telas e ações de Tipos de Atividade, Serviços e Lançamento de Atividades.
- O motor de estoque físico e a reconciliação já checavam com `to_regclass` se as tabelas existem; depois da migration esses ramos simplesmente não rodam. Não foram alterados.

### Banco: migration `20261128100000_remover_atividades` (CONTRACT)
- **Guarda** (bloco `DO`): timeouts, trava consultiva, as 17 tabelas existem e são do dono certo, nenhum abastecimento ligado a atividade ou lançamento, nenhuma FK de fora apontando para as tabelas (fora as 2 do `AbastecimentoBem`), nenhuma view, trigger ou publicação. Ela também confere a impressão do preflight (`maike.remover_atividades_impressao`).
- **AbastecimentoBem:** saem o CHECK, as 2 FKs, os 2 índices e as colunas `atividade_id` e `apontamento_id`.
- **16 tabelas removidas**, das filhas para as mães:
  - `AtividadePlantio`, `AtividadeApontamentoProdutoConsumoLote`, `AtividadeApontamentoMaquina`, `AtividadeApontamentoMaoObra`, `AtividadeApontamentoServico`;
  - `AtividadeMisturaItem`, `AtividadeMisturaMovimento`, `PlanejamentoArea`, `AtividadeApontamentoProduto`, `Servico`;
  - `AtividadeMistura`, `AtividadeApontamento`, `AtividadeArea`, `Atividade`, `TipoAtividade`, `Planejamento`.
- Registrada em `MIGRATIONS_APROVADAS` e em `MIGRATIONS_CONTRACT_APROVADAS` (`decisao: 'D-PROD-383'`, `drop_no_fim`, 7 `alter_antigas`).

### App e site
- Páginas Lançamento de Atividades, Tipos de Atividade e Serviços, com componentes, serviços, APIs, regras e hook.
- No mapa, os detalhes da área ficam com **Detalhes / Forragem / Abate**. Saem o Diário do pasto, a aba de registros e as ações da atividade.
- Abastecimento (Patrimônio): saem do formulário, da consulta e da tabela os campos de atividade e lançamento.
- Menu, permissões, `config/mapa-manejo-scope.json` (3 páginas a menos) e `vercel.json` (12 rotas a menos).
- Sem internet: o download completo deixa de pedir as rotas que não existem mais. O 404 de rota do Fastify também conta como "não existe mais".

### Testes, gates e scripts
- Saem os testes das telas e do servidor que só cobriam atividades. Os testes mistos (estoque, unidades, patrimônio, permissões, SQL Editor, migrations antigas) perdem só os casos de atividade.
- `gate:tarefa-cadastro-native`: deixa de exigir o Tipo de Atividade. Agora reprova se o model `TipoAtividade` voltar ao schema e continua proibindo as 11 flags no `TipoTarefa`.
- Novos testes D-PROD-383: escopo (as 3 páginas fora), rotas do Vercel, permissões antigas inertes e download sem internet (DB-01c).
- Scripts do SQL Editor (01–04): sem as 16 tabelas.

## Como aplicar em produção (só com autorização escrita do proprietário)

1. **Antes do merge**, porque a Vercel publica a `main` sozinha e o código novo não lê mais as colunas do abastecimento:
   - preflight somente leitura (impressão das tabelas, contagem de linhas, nenhum abastecimento ligado);
   - GO escrito do proprietário;
   - aplicar com `MIGRATION_CONTRACT_AUTORIZADO=D-PROD-383`, pelo `premerge-migrate`, ou pelo SQL do Supabase como na UE-1 (D-PROD-371).
2. Conferir: as 16 tabelas sumiram, `AbastecimentoBem` sem as 2 colunas, `_prisma_migrations` com a linha nova.
3. Só então fazer o merge.

**Os dados das atividades são apagados e não voltam.** Se o proprietário quiser guardar uma cópia, ela precisa ser exportada antes do passo 1.

## Próximo

O proprietário explica a estrutura nova das atividades (cadastro, lançamentos), que será uma missão própria, com decisão nova.
