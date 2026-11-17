# MAIKE — Reforço no banco: o apontamento do abastecimento é da atividade dele (relatório, D-PROD-216)

> **fatia:** reforço D-PROD-216 · **branch:** `feat/abastecimento-fk-apontamento-atividade` · **PR:** #303
> Decisão **D-PROD-216** (continua a D-PROD-211, item 8, "reforço futuro") · pedido do proprietário: "pode fazer o
> reforço no banco" · runbook [`MAIKE-ABASTECIMENTO-FK-APONTAMENTO-RUNBOOK-RELEASE.md`](./MAIKE-ABASTECIMENTO-FK-APONTAMENTO-RUNBOOK-RELEASE.md)
>
> **Numeração e pasta:** nasceu D-PROD-213, depois D-PROD-214; a `main` deu a 213 ao Resumo do Rebanho (#302), a 214
> aos ajustes do mapa (#305/#306) e a 215 ao Cadastro de Culturas (#304, EXPAND `20261116500000_cadculturas`, já
> aplicada em produção). A pasta passou de `20261116400000_…` para `20261116600000_abastecimento_fk_apontamento_atividade`,
> depois da CADCULTURAS: a ordem do repositório é a de produção (211 → 215 → 216). O conteúdo e o checksum não mudaram.

## 1. O problema

Desde a D-PROD-211, `AbastecimentoBem` tem duas FKs independentes, uma para a atividade e outra para o lançamento
(apontamento), mais o CHECK "apontamento ⇒ atividade". Nada no banco impedia uma linha com o apontamento de **outra**
atividade: só o servidor garantia (ele deriva a atividade do apontamento). O ensaio local reproduz a brecha: na partida
(63 migrations, o estado de produção), um `UPDATE` ou `INSERT` à mão com a atividade A e o apontamento da atividade B
entra sem erro.

## 2. O que entra

| Área | Entrega |
|---|---|
| Banco | Migration CONTRACT `20261116600000_abastecimento_fk_apontamento_atividade` (SHA-256 `1ee8d5a3c3dd64e59d27459bd51224795b69f691c7358088fd5bbec375561c0e`): UNIQUE `AtividadeApontamento_empresa_atividade_id_key` (`cliente_id`, `empresa_id`, `atividade_id`, `id`) e a FK `AbastecimentoBem_apontamento_fkey` recriada, com o mesmo nome, com 4 colunas (`cliente_id`, `empresa_id`, `atividade_id`, `apontamento_id`), RESTRICT / CASCADE. Guarda pinada (`8982f86d…`): formato anterior, travas (`AtividadeApontamento` e depois `AbastecimentoBem` em `ACCESS EXCLUSIVE`, sem subir de trava no `DROP CONSTRAINT`) e nenhum abastecimento ligado a apontamento de outra atividade. Produção 63 → 64 (a anterior é a `20261116500000_cadculturas`, D-PROD-215), 95 tabelas |
| Schema | `schema.prisma`: a relação `apontamento` de `AbastecimentoBem` com 4 campos; `@@unique` novo em `AtividadeApontamento` (editado à mão, sem `prisma format`) |
| Portão | `MIGRATIONS_APROVADAS` (pino) e a décima segunda entrada fechada de `MIGRATIONS_CONTRACT_APROVADAS` (`decisao: 'D-PROD-216'`, 3 instruções pinadas, sem resto) |
| Servidor e tela | Nenhuma mudança (o servidor já grava sempre o par certo) |

Efeito: o banco recusa (`23503`, `AbastecimentoBem_apontamento_fkey`) o apontamento de outra atividade, por `UPDATE` ou
`INSERT`, `ESTOQUE` ou `EXTERNO`, e também a troca só da atividade; aceita o par certo, a troca do par inteiro e os
abastecimentos sem vínculo. Mudar a atividade de um apontamento leva junto a do abastecimento (CASCADE).

## 3. Testes

| Arquivo | O que prova |
|---|---|
| `backend/tests/abastecimentoFkApontamentoMigration.test.mjs` (novo) | o runbook de ponta a ponta (preflight, envelope do caminho B, postcheck) na partida de 63 (a D-PROD-211 e por último a D-PROD-215, a ordem de produção); a brecha antes; a guarda recusa sem mudar nada (apontamento de outra atividade, UNIQUE já presente, FK já com 4 colunas, CHECK ausente, reaplicação); concorrência: a transação do app que lê o apontamento e depois grava o abastecimento só faz a migration esperar, sem deadlock (com `SHARE ROW EXCLUSIVE` na guarda, o teste falha); o runner sem a decisão exata recusa antes do DDL; GREEN 64/0 (95 tabelas) com só a FK e o UNIQUE mudando; 23503 nas formas erradas e as certas aceitas; envelope recusa com SID de produção, histórico fora de 63/0, a D-PROD-215 ou a D-PROD-211 com outro checksum ou o UNIQUE já presente |
| `backend/tests/atividadeAbastecimento.test.mjs` | um caso novo: com o servidor real, um `UPDATE`/`INSERT` à mão com o apontamento de outra atividade é recusado pelo banco; o par certo entra |
| `backend/tests/abastecimentoAtividadeMigration.test.mjs` | a D-PROD-211 passa a rodar no dia dela (espelho do runner até ela) e prova a ordem de produção 211 → 215 → 216 (AA-08: a CADCULTURAS pelo runner do dia dela, sem decisão; o reforço pelo runner do repositório, com a decisão) |
| os outros testes de migration (D-PROD-162 … D-PROD-209) | 64 pastas (com a CADCULTURAS da `main`): listas de posteriores e de CONTRACT pendentes, contagens (64/0, 95 tabelas), a D-PROD-211 pelo espelho até ela e, pelo runner do repositório com a decisão da D-PROD-216, a D-PROD-215 e depois a D-PROD-216; o UNIQUE novo fora das contas "o resto intacto" |
| `scripts/tests/deploy/premerge-migrate.test.mjs` | B32a–B32m (classificação, pino, variações recusadas, guarda, nome, release isolada, ambiente do runner, pendências, runner real, ordem de produção 63 → 64, com a CADCULTURAS concluída por último); a B31 é a da D-PROD-215 (B31k no dia dela) |
| `scripts/tests/deploy/migrations.test.mjs` | B24 (a barreira do runner exige a D-PROD-216 exata e nunca junto de outra CONTRACT) |

## 4. Validação local

Depois do merge da `main` `133c6ed4` (PRs #304, #305 e #306), com a pasta renomeada e a decisão D-PROD-216, em
bancos novos (PostgreSQL 16 local):

| Verificação | Resultado |
|---|---|
| `sha256sum` do `migration.sql` | `1ee8d5a3c3dd64e59d27459bd51224795b69f691c7358088fd5bbec375561c0e` (o mesmo de antes da renomeação) |
| `prisma migrate deploy` das 64 / `migrate diff --from-migrations … --exit-code` | 64 / 0, 95 tabelas, a ordem 211 → 215 → 216; sem drift (exit 0) |
| runbook à mão num banco na partida de produção (63 / 0, a CADCULTURAS por último) | preflight `PRONTO PARA APLICAR`; envelope com o SID de produção recusa (`alvo divergente`); com o local aplica; postcheck 64 / 0, 95 tabelas, `APLICADA E CONFERIDA`; repetir o envelope recusa; o Prisma não vê pendência e o `migrate diff` fica vazio |
| `abastecimentoFkApontamentoMigration` | 14/14 (com a concorrência, AF-RED-3) |
| `atividadeAbastecimento` · `abastecimentoAtividadeMigration` | 16/16 · 14/14 |
| testes de migration das CONTRACT anteriores (64 pastas) | `funcionarioTipoTerceirizado` 13/13 · `atividadeMaoObraParceiro` 14/14 · `atividadeMaoObra` 12/12 · `atividadeLinhas` 11/11 · `atividadeCabecalho` 28/28 · `tipoAtividadeDefaults` 25/25 · `cadCategoriaCurvaGanho` 10/10 · `cadCurvaGanhoMensal` 10/10 · `categoriaManejoCadcategoria` 20/20 · `patrimonioSimplifica` 14/14 · `tipoTarefaDropColunas` 15/15 |
| da `main` (D-PROD-215) e vizinhos | `culturaNativo` 20/20 · `formulacaoNativo` 24/24 · `permissoesR2Rotas` 11/11 · `sqlEditorBootstrap` 14/14 · `movimentacaoCancelamentoR2A` 9/9 |
| `patrimonioP1Abastecimentos` · `patrimonioP1AbastecimentosSeguranca` · `patrimonioP1Seguranca` · `atividadeLinhaMaoObra` · `atividadeLinhaProduto` | 15/15 · 8/8 · 12/12 · 23/23 · 20/20 |
| `scripts/tests/deploy` (premerge-migrate / migrations / alvo-banco / todos) | 176/176 · 83/83 · 6/6 · 288/288 |
| `verify-all --pular=test:backend` | todas as etapas passaram (gates, tipos, lint, smoke, builds) |

## 5. Release

Só com o GO escrito do proprietário para esta migration, pelo
[runbook](./MAIKE-ABASTECIMENTO-FK-APONTAMENTO-RUNBOOK-RELEASE.md) (`--contract D-PROD-216` no caminho A, o envelope no
caminho B). Produção hoje: 63/0 (a última, a `20261116500000_cadculturas`), 95 tabelas, 1 abastecimento sem vínculo
(a guarda passa). `SCHEMA_APPLIED_PROD: NÃO`.
