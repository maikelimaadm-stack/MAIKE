# MAIKE — Reforço no banco: o apontamento do abastecimento é da atividade dele (relatório, D-PROD-217)

> **fatia:** reforço D-PROD-217 · **branch:** `feat/abastecimento-fk-apontamento-atividade` · **PR:** #303
> Decisão **D-PROD-217** (continua a D-PROD-211, item 8, "reforço futuro") · pedido do proprietário: "pode fazer o
> reforço no banco" · runbook [`MAIKE-ABASTECIMENTO-FK-APONTAMENTO-RUNBOOK-RELEASE.md`](./MAIKE-ABASTECIMENTO-FK-APONTAMENTO-RUNBOOK-RELEASE.md)
>
> **Numeração e pasta:** nasceu D-PROD-213, depois D-PROD-214 e D-PROD-216 (213 → 214 → 216 → 217); a `main` deu a 213
> ao Resumo do Rebanho (#302), a 214 aos ajustes do mapa (#305/#306), a 215 ao Cadastro de Culturas (#304, EXPAND
> `20261116500000_cadculturas`) e a 216 à Área ligada à Cultura (#307, CONTRACT aditiva `20261117000000_area_cultura`),
> as duas aplicadas em produção antes desta. A pasta nasceu `20261116400000_…`, foi `20261116600000_…` e é
> `20261117100000_abastecimento_fk_apontamento_atividade`, o nome com que foi registrada em produção: a ordem do
> repositório é a de produção (211 → 215 → 216 → 217). O conteúdo e o checksum não mudaram.

## 1. O problema

Desde a D-PROD-211, `AbastecimentoBem` tem duas FKs independentes, uma para a atividade e outra para o lançamento
(apontamento), mais o CHECK "apontamento ⇒ atividade". Nada no banco impedia uma linha com o apontamento de **outra**
atividade: só o servidor garantia (ele deriva a atividade do apontamento). O ensaio local reproduz a brecha: na partida
(64 migrations, o estado de produção antes da aplicação), um `UPDATE` ou `INSERT` à mão com a atividade A e o apontamento da atividade B
entra sem erro.

## 2. O que entra

| Área | Entrega |
|---|---|
| Banco | Migration CONTRACT `20261117100000_abastecimento_fk_apontamento_atividade` (SHA-256 `1ee8d5a3c3dd64e59d27459bd51224795b69f691c7358088fd5bbec375561c0e`): UNIQUE `AtividadeApontamento_empresa_atividade_id_key` (`cliente_id`, `empresa_id`, `atividade_id`, `id`) e a FK `AbastecimentoBem_apontamento_fkey` recriada, com o mesmo nome, com 4 colunas (`cliente_id`, `empresa_id`, `atividade_id`, `apontamento_id`), RESTRICT / CASCADE. Guarda pinada (`8982f86d…`): formato anterior, travas (`AtividadeApontamento` e depois `AbastecimentoBem` em `ACCESS EXCLUSIVE`, sem subir de trava no `DROP CONSTRAINT`) e nenhum abastecimento ligado a apontamento de outra atividade. Produção 64 → 65 (a anterior é a `20261117000000_area_cultura`, D-PROD-216), 95 tabelas |
| Schema | `schema.prisma`: a relação `apontamento` de `AbastecimentoBem` com 4 campos; `@@unique` novo em `AtividadeApontamento` (editado à mão, sem `prisma format`) |
| Portão | `MIGRATIONS_APROVADAS` (pino) e a décima terceira entrada fechada de `MIGRATIONS_CONTRACT_APROVADAS` (`decisao: 'D-PROD-217'`, 3 instruções pinadas, sem resto), depois da D-PROD-216 |
| Servidor e tela | Nenhuma mudança (o servidor já grava sempre o par certo) |

Efeito: o banco recusa (`23503`, `AbastecimentoBem_apontamento_fkey`) o apontamento de outra atividade, por `UPDATE` ou
`INSERT`, `ESTOQUE` ou `EXTERNO`, e também a troca só da atividade; aceita o par certo, a troca do par inteiro e os
abastecimentos sem vínculo. Mudar a atividade de um apontamento leva junto a do abastecimento (CASCADE).

## 3. Testes

| Arquivo | O que prova |
|---|---|
| `backend/tests/abastecimentoFkApontamentoMigration.test.mjs` (novo) | o runbook de ponta a ponta (preflight, envelope do caminho B, postcheck) na partida de 64 (a D-PROD-211, a D-PROD-215 e por último a D-PROD-216, a ordem de produção); a brecha antes; a guarda recusa sem mudar nada (apontamento de outra atividade, UNIQUE já presente, FK já com 4 colunas, CHECK ausente, reaplicação); concorrência: a transação do app que lê o apontamento e depois grava o abastecimento só faz a migration esperar, sem deadlock (com `SHARE ROW EXCLUSIVE` na guarda, o teste falha); o runner sem a decisão exata recusa antes do DDL; GREEN 65/0 (95 tabelas) com só a FK e o UNIQUE mudando; 23503 nas formas erradas e as certas aceitas; envelope recusa com SID de produção, histórico fora de 64/0, a D-PROD-216 ou a D-PROD-211 com outro checksum ou o UNIQUE já presente |
| `backend/tests/atividadeAbastecimento.test.mjs` | um caso novo: com o servidor real, um `UPDATE`/`INSERT` à mão com o apontamento de outra atividade é recusado pelo banco; o par certo entra |
| `backend/tests/abastecimentoAtividadeMigration.test.mjs` | a D-PROD-211 passa a rodar no dia dela (espelho do runner até ela) e prova a ordem de produção 211 → 215 → 216 → 217 (AA-08: a CADCULTURAS pelo runner do dia dela, sem decisão; a Área ligada à Cultura pelo runner do dia dela, com a D-PROD-216; o reforço pelo runner do repositório, com a D-PROD-217) |
| os outros testes de migration (D-PROD-162 … D-PROD-209) | 65 pastas (com a CADCULTURAS e a Área ligada à Cultura da `main`): listas de posteriores e de CONTRACT pendentes, contagens (65/0, 95 tabelas), a D-PROD-211 pelo espelho até ela, a D-PROD-215 e a D-PROD-216 pelo espelho até a D-PROD-216 com a decisão dela e, por último, pelo runner do repositório com a decisão da D-PROD-217, o reforço; o UNIQUE novo e a coluna/FK/índice da Área fora das contas "o resto intacto" |
| `scripts/tests/deploy/premerge-migrate.test.mjs` | B33a–B33m (classificação, pino, variações recusadas, guarda, nome, release isolada, ambiente do runner, pendências, runner real e a ordem de produção: partida 64 com a D-PROD-216 por último → 65, o estado de hoje); a B31 é a da D-PROD-215 e a B32 a da D-PROD-216 (B31k e B32k no dia de cada uma) |
| `scripts/tests/deploy/migrations.test.mjs` | B25 (a barreira do runner exige a D-PROD-217 exata e nunca junto de outra CONTRACT, a D-PROD-216 inclusive); a B24 é a da D-PROD-216 |

## 4. Validação local

Depois do merge da `main` `effc50be` (PR #307, D-PROD-216), com a pasta no nome de produção e a decisão D-PROD-217,
em bancos novos (PostgreSQL 16 local), em 2026-11-17:

| Verificação | Resultado |
|---|---|
| `sha256sum` do `migration.sql` | `1ee8d5a3c3dd64e59d27459bd51224795b69f691c7358088fd5bbec375561c0e` (o mesmo desde a abertura; o aplicado em produção) |
| `prisma migrate deploy` das 65 / `migrate diff --from-migrations … --to-schema-datamodel … --exit-code` | 65 / 0, 95 tabelas, a ordem 211 → 215 → 216 → 217; sem drift (exit 0) |
| runbook como está, num banco na partida de produção (64 / 0, a Área ligada à Cultura por último; só o SID trocado) | preflight `PRONTO PARA APLICAR`; envelope com o SID de produção recusa (`alvo divergente`); com o local aplica; postcheck 65 / 0, 95 tabelas, `APLICADA E CONFERIDA`; repetir o envelope recusa (`migration já registrada`); o Prisma não vê pendência e o `migrate diff` fica vazio |
| `abastecimentoFkApontamentoMigration` (partida 64 → 65, com a concorrência) | 14/14 |
| `atividadeAbastecimento` · `abastecimentoAtividadeMigration` | 16/16 · 14/14 |
| testes de migration das CONTRACT anteriores (65 pastas) | `funcionarioTipoTerceirizado` + `cadCurvaGanhoMensal` 23/23 · `atividadeMaoObra` + `atividadeMaoObraParceiro` 26/26 · `atividadeLinhas` 11/11 · `atividadeCabecalho` 28/28 · `tipoAtividadeDefaults` + `patrimonioSimplifica` 39/39 · `cadCategoriaCurvaGanho` 10/10 · `categoriaManejoCadcategoria` 20/20 · `tipoTarefaDropColunas` 15/15 · `estoqueP1M7Transacao` 8/8 · `alvoMigrationDuplaConexao` 4/4 · `dProd122ReleaseFuso` 13/13 · `dProd122ReleaseFusoR4` 9/9 |
| da `main` (D-PROD-215 e D-PROD-216) e vizinhos | `areaCulturaNativa` 11/11 · `culturaNativo` 20/20 · `formulacaoNativo` 24/24 · `permissoesR2Rotas` 11/11 · `sqlEditorBootstrap` 15/15 · `sqlEditorPreservaMaike` 7/7 · `movimentacaoCancelamentoR2A` 9/9 · `inicializarTenantMaikeCli` 11/11 |
| `patrimonioP1Abastecimentos` · `patrimonioP1AbastecimentosSeguranca` · `patrimonioP1Seguranca` · `atividadeLinhaMaoObra` · `atividadeLinhaProduto` | 15/15 · 8/8 · 12/12 · 23/23 · 20/20 |
| `scripts/tests/deploy` (premerge-migrate / migrations / alvo-banco / todos) | 179/179 · 89/89 · 6/6 · 297/297 |
| `verify-all --pular=test:backend` | todas as etapas passaram (gates, tipos, lint, smoke, builds) |

## 5. Release

**Aplicada em produção** em **2026-11-17 00:43:48 UTC** pelo caminho B do
[runbook](./MAIKE-ABASTECIMENTO-FK-APONTAMENTO-RUNBOOK-RELEASE.md), com o GO do proprietário.
`SCHEMA_APPLIED_PROD: SIM (2026-11-17)`. Registro completo no §9 do runbook.

| Etapa | Valor |
|---|---|
| Preflight | `PRONTO PARA APLICAR`: 64 / 0; a anterior `20261117000000_area_cultura` (`e7fd7ee6…`); a D-PROD-211 (`6dfc825c…`); a FK de 3 colunas; o UNIQUE ausente; o CHECK da atividade presente; `1 / 0 / 0`; 95 tabelas; 0 travas; 0 transações longas |
| Envelope | guardas `n_ok <> 64`, a anterior = a D-PROD-216 (`e7fd7ee6…`), a D-PROD-211 (`6dfc825c…`), o UNIQUE ausente; `INSERT` como `20261117100000_abastecimento_fk_apontamento_atividade`, checksum `1ee8d5a3…` |
| Postcheck | `APLICADA E CONFERIDA`: 65 / 0, esta por último com o checksum `1ee8d5a3…`; FK `(cliente_id, empresa_id, atividade_id, apontamento_id) → "AtividadeApontamento"(cliente_id, empresa_id, atividade_id, id) ON UPDATE CASCADE ON DELETE RESTRICT`; UNIQUE `AtividadeApontamento_empresa_atividade_id_key`; `AbastecimentoBem_atividade_fkey` e `_atividade_check` presentes; 95 tabelas; dados intactos (`AbastecimentoBem` 1, `AtividadeApontamento` 4) |
| Antes | duas tentativas pararam no preflight (`PARAR`: 63 contra 62 e 64 contra 63), porque outra sessão aplicou antes a CADCULTURAS e a Área ligada à Cultura; nada foi aplicado nelas |

Ordem em produção: … `20261116300000` (D-PROD-211) → `20261116500000_cadculturas` (D-PROD-215) →
`20261117000000_area_cultura` (D-PROD-216) → `20261117100000_abastecimento_fk_apontamento_atividade` (D-PROD-217).
O código não muda nesta release; o merge da PR #303 só alinha o repositório ao banco.
