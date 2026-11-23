MAIKE-TIPO-IMPLEMENTO-PRODUTO (D-PROD-279) · `claude/tipo-tarefa-drop-colunas-1aznvv` · PR (a abrir)

# Relatório — o tipo de implemento diz se usa produto, como conta e a capacidade

**Data:** 2026-11-23 · **Decisão:** [D-PROD-279](./DECISIONS.md) · **Runbook:** [`MAIKE-TIPO-IMPLEMENTO-PRODUTO-RUNBOOK-RELEASE.md`](./MAIKE-TIPO-IMPLEMENTO-PRODUTO-RUNBOOK-RELEASE.md) · **Base:** `main` `d62a4ef8`

## Pedido

"A máquina sozinha não leva produto; quem leva é o implemento." O tipo de implemento ganha "Usa produto?", "Como
conta" e "Capacidade". O uso nas telas de atividade ("Jatos de hoje") fica para depois.

## O que mudou

| Camada | Mudança |
|---|---|
| Migration | `20261124100000_tipo_implemento_produto` (EXPAND): `TipoPatrimonial.usa_produto` BOOLEAN, `forma_produto` VARCHAR(16), `capacidade` DECIMAL(14,4), `capacidade_unidade` VARCHAR(8); anuláveis, sem DEFAULT, sem CHECK. sha256 `a18362400ec4345487bca6bb4b6c94c62991cb120bb36786448a46c39a64ae45`. 76 migrations, 111 tabelas |
| Pinos | `MIGRATIONS_APROVADAS` (`premergeMigrateLib.mjs`), `COLUNAS_EXIGIDAS` (`preflightSchemaLib.mjs`, as 4), B43a/B43b/B43k e as contagens 75 → 76 em `premerge-migrate.test.mjs` (posições do manifesto deslocadas em B31a…B42a, B42k recortado no dia da reforma), `preflight-schema.test.mjs`, `diaDaD223.mjs` (`schemaSemProdutoDoImplemento`), `estoqueEntradasMotivosMigration`, `categoriaManejoCadcategoriaMigration`, `patrimonioSimplificaMigration` e os dois `scripts/dev/ensaio-*.mjs` |
| API | `tipoPatrimonialService.js` (`produtoDoCorpo`) e `patrimonioCatalogoRoutes.js` (schema e o `preValidation`: capacidade só texto, `usa_produto` só booleano) |
| Tela | `FormularioTipo.jsx` (bloco só para Implemento), `GerenciarTiposDialog.jsx` (`resumoProduto` na linha), `patrimonioCatalogoService.js` (campos na criação) |

## Regras da API

- Só natureza **IMPLEMENTO**; em outra, qualquer um dos 4 campos presente (mesmo `null`) → 400 `REQUEST_VALIDATION_FAILED` `so_implemento`.
- `usa_produto` `false`/`null`: forma, capacidade e unidade nulas; mandá-las preenchidas → 400 `sem_produto`; as gravadas são limpas.
- `usa_produto` `true`: `forma_produto` obrigatória e `JATO`; `capacidade` obrigatória, texto decimal com até 4 casas, > 0 e ≤ 100000 (gravada com 4 casas); `capacidade_unidade` obrigatória, `L` ou `KG`. No PATCH, o estado final é conferido (o que não vem é o gravado).
- PATCH com o CAS por `versao`; auditoria `update` com os campos em `campos_alterados`. A leitura (lista, detalhe) devolve os 4; nulos fora do implemento.

## Tela

No "+ Novo tipo" do "⋯ › Gerenciar tipos", com Tipo de bem **Implemento**: "Usa produto?" Sim/Não (padrão Não); com
Sim, "Como conta" (Por jato (tanque)), "Capacidade do jato" (número local) e "Unidade" (L/kg); dica "Ex.: pulverizador
2.000 L. A grade não usa produto.". Capacidade vazia, zero, acima de 100.000 ou mal formada não envia. Outro Tipo de bem
não mostra nem manda os campos. A linha da lista mostra, discreto, "usa produto · jato 2.000 L".

## Testes

- `backend/tests/tipoImplementoProduto.test.mjs` (Postgres real): T1 aceita/lê/audita; T2 MAQUINA e as outras naturezas → 400; T3 cada regra; T4 limpeza, PATCH parcial e CAS — 4/4.
- Testes de migration e contagem (`backend/tests/*Migration*.test.mjs`, `sqlEditorBootstrap.test.mjs`): 249/249 (o `patrimonioSimplificaMigration` passou a contar 12 + 4 colunas em `TipoPatrimonial`); testes do Patrimônio (`backend/tests/patrimonio*.test.mjs`, `gestaoP3PatrimonioCombinado`): 149/149 (a forma pública do tipo em `patrimonioP1Catalogos` e `patrimonioSimplifica02` ganhou os 4 campos).
- `node --test scripts/tests/deploy/*.test.mjs`: 339/339.
- `tests/smoke/tipoImplementoProduto.test.jsx` 4/4; `bensGerenciarTipos` e `bensTipoRapido` seguem verdes.
- `node scripts/gates/verify-all.mjs --pular=test:backend`.

## Ensaio do caminho B

Banco local novo com as 75 da `main`: envelope com o identificador de produção recusou (`alvo divergente`); com o
local aplicou (76/0, checksum `a1836240…ae45`, 1 passo, 111 tabelas, 4 colunas); 2ª execução recusou (`migration já
registrada`); `prisma migrate diff` sem diferença. Banco apagado. Detalhes no runbook §3.

## Pontos em aberto

- "Jatos de hoje" nas telas de atividade (fora desta missão).
- Editar o produto de um tipo já criado pela tela (a API aceita no PATCH; a linha do "Gerenciar tipos" continua só com nome e teto de salto).
- Migration não aplicada em produção: aplicar com o GO do proprietário, depois o merge.
