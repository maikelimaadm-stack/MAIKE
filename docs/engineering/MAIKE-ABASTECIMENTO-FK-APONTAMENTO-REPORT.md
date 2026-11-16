# MAIKE — Reforço no banco: o apontamento do abastecimento é da atividade dele (relatório, D-PROD-214)

> **fatia:** reforço D-PROD-214 · **branch:** `feat/abastecimento-fk-apontamento-atividade` · **PR:** a abrir
> Decisão **D-PROD-214** (continua a D-PROD-211, item 8, "reforço futuro") · pedido do proprietário: "pode fazer o
> reforço no banco" · runbook [`MAIKE-ABASTECIMENTO-FK-APONTAMENTO-RUNBOOK-RELEASE.md`](./MAIKE-ABASTECIMENTO-FK-APONTAMENTO-RUNBOOK-RELEASE.md)

## 1. O problema

Desde a D-PROD-211, `AbastecimentoBem` tem duas FKs independentes, uma para a atividade e outra para o lançamento
(apontamento), mais o CHECK "apontamento ⇒ atividade". Nada no banco impedia uma linha com o apontamento de **outra**
atividade: só o servidor garantia (ele deriva a atividade do apontamento). O ensaio local reproduz a brecha: na partida
(62 migrations, o estado de produção), um `UPDATE` ou `INSERT` à mão com a atividade A e o apontamento da atividade B
entra sem erro.

## 2. O que entra

| Área | Entrega |
|---|---|
| Banco | Migration CONTRACT `20261116400000_abastecimento_fk_apontamento_atividade` (SHA-256 `1ee8d5a3c3dd64e59d27459bd51224795b69f691c7358088fd5bbec375561c0e`): UNIQUE `AtividadeApontamento_empresa_atividade_id_key` (`cliente_id`, `empresa_id`, `atividade_id`, `id`) e a FK `AbastecimentoBem_apontamento_fkey` recriada, com o mesmo nome, com 4 colunas (`cliente_id`, `empresa_id`, `atividade_id`, `apontamento_id`), RESTRICT / CASCADE. Guarda pinada (`8982f86d…`): formato anterior, travas (`AtividadeApontamento` e depois `AbastecimentoBem` em `ACCESS EXCLUSIVE`, sem subir de trava no `DROP CONSTRAINT`) e nenhum abastecimento ligado a apontamento de outra atividade. Produção 62 → 63, 94 tabelas |
| Schema | `schema.prisma`: a relação `apontamento` de `AbastecimentoBem` com 4 campos; `@@unique` novo em `AtividadeApontamento` (editado à mão, sem `prisma format`) |
| Portão | `MIGRATIONS_APROVADAS` (pino) e a décima segunda entrada fechada de `MIGRATIONS_CONTRACT_APROVADAS` (`decisao: 'D-PROD-214'`, 3 instruções pinadas, sem resto) |
| Servidor e tela | Nenhuma mudança (o servidor já grava sempre o par certo) |

Efeito: o banco recusa (`23503`, `AbastecimentoBem_apontamento_fkey`) o apontamento de outra atividade, por `UPDATE` ou
`INSERT`, `ESTOQUE` ou `EXTERNO`, e também a troca só da atividade; aceita o par certo, a troca do par inteiro e os
abastecimentos sem vínculo. Mudar a atividade de um apontamento leva junto a do abastecimento (CASCADE).

## 3. Testes

| Arquivo | O que prova |
|---|---|
| `backend/tests/abastecimentoFkApontamentoMigration.test.mjs` (novo) | o runbook de ponta a ponta (preflight, envelope do caminho B, postcheck) na partida de 62; a brecha antes; a guarda recusa sem mudar nada (apontamento de outra atividade, UNIQUE já presente, FK já com 4 colunas, CHECK ausente, reaplicação); concorrência: a transação do app que lê o apontamento e depois grava o abastecimento só faz a migration esperar, sem deadlock (com `SHARE ROW EXCLUSIVE` na guarda, o teste falha); o runner sem a decisão exata recusa antes do DDL; GREEN 63/0 com só a FK e o UNIQUE mudando; 23503 nas formas erradas e as certas aceitas; envelope recusa com SID de produção, histórico fora de 62/0, a D-PROD-211 com outro checksum ou o UNIQUE já presente |
| `backend/tests/atividadeAbastecimento.test.mjs` | um caso novo: com o servidor real, um `UPDATE`/`INSERT` à mão com o apontamento de outra atividade é recusado pelo banco; o par certo entra |
| `backend/tests/abastecimentoAtividadeMigration.test.mjs` | a D-PROD-211 passa a rodar no dia dela (espelho do runner até ela) e prova a ordem de produção 211 → 214 (AA-08) |
| os outros testes de migration (D-PROD-162 … D-PROD-209) | 63ª pasta: listas de posteriores e de CONTRACT pendentes, contagens, a D-PROD-211 pelo espelho até ela e a D-PROD-214 pelo runner do repositório; o UNIQUE novo fora das contas "o resto intacto" |
| `scripts/tests/deploy/premerge-migrate.test.mjs` | B31a–B31m (classificação, pino, variações recusadas, guarda, nome, release isolada, ambiente do runner, pendências, runner real, ordem de produção 62 → 63) |
| `scripts/tests/deploy/migrations.test.mjs` | B24 (a barreira do runner exige a D-PROD-214 exata e nunca junto de outra CONTRACT) |

## 4. Validação local

| Verificação | Resultado |
|---|---|
| `prisma migrate deploy` das 63 / `migrate diff --exit-code` | 63, sem drift |
| `abastecimentoFkApontamentoMigration` | 14/14 |
| `atividadeAbastecimento` | 16/16 |
| `abastecimentoAtividadeMigration` | 14/14 |
| testes de migration das CONTRACT anteriores (63ª pasta) | `funcionarioTipoTerceirizado` 13/13 · `atividadeMaoObraParceiro` 14/14 · `atividadeMaoObra` 12/12 · `atividadeLinhas` 11/11 · `atividadeCabecalho` 28/28 · `tipoAtividadeDefaults` 25/25 · `cadCategoriaCurvaGanho` 10/10 · `cadCurvaGanhoMensal` 10/10 · `categoriaManejoCadcategoria` 20/20 · `patrimonioSimplifica` 14/14 · `tipoTarefaDropColunas` 15/15 · `estoqueP1M7Transacao` 8/8 · `alvoMigrationDuplaConexao` 4/4 |
| `patrimonioP1Abastecimentos` · `atividadeLinhaMaoObra` · `atividadeLinhaProduto` | 15/15 · 23/23 · 20/20 |
| `sqlEditorBootstrap` · `sqlEditorPreservaMaike` · `patrimonioP1AbastecimentosSeguranca` · `patrimonioP1Seguranca` | 14/14 · 7/7 · 8/8 · 12/12 |
| `scripts/tests/deploy` premerge-migrate / migrations / alvo-banco | 173/173 · 83/83 · 6/6 |
| `verify-all --pular=test:backend` | todas as etapas passaram (gates, tipos, lint, smoke, builds) |

## 5. Release

Só com o GO escrito do proprietário para esta migration, pelo
[runbook](./MAIKE-ABASTECIMENTO-FK-APONTAMENTO-RUNBOOK-RELEASE.md) (`--contract D-PROD-214` no caminho A, o envelope no
caminho B). Produção hoje: 62/0, 94 tabelas, 1 abastecimento sem vínculo (a guarda passa). `SCHEMA_APPLIED_PROD: NÃO`.
