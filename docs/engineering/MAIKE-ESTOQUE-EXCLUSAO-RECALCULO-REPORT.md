# MAIKE — Exclusão com recálculo do estoque · relatório

**Decisão:** [D-PROD-273](./DECISIONS.md) · **SPEC:** [MAIKE-ESTOQUE-EXCLUSAO-RECALCULO-SPEC.md](./MAIKE-ESTOQUE-EXCLUSAO-RECALCULO-SPEC.md) · **Migration:** nenhuma

## Problema relatado

Ao excluir um movimento de estoque (ex.: a saída para suplementação), o sistema
grava um estorno que continua aparecendo nas telas, e depois disso nada anterior
pode mais ser excluído ("movimento posterior"). O dono decidiu: o excluído
**some da tela**, a exclusão **recalcula** o custo médio de tudo que veio depois,
na **ordem em que foi lançado** (número do movimento). Emenda aprovada.

## Fatias

| Fatia | Conteúdo | Estado |
|---|---|---|
| 1 | Decisão D-PROD-273, emenda constitucional (00 e 07), SPEC | feita |
| 2 | "Some da tela": `incluir_excluidos` na consulta, filtro **Mostrar excluídos** no Kardex, saldo exibido sem os excluídos | feita |
| 3 | Replay puro + prévia + prova replay = gravado (sem escrita) | feita (branch `claude/estoque-recalculo-replay`) |
| 4 | Exclusão com recálculo — saídas | pendente |
| 5 | Exclusão com recálculo — entradas, compra, transferência, edição | pendente |
| 6 | Reconciliação de valor + gate | pendente |

## Fatia 2 — o que mudou

- **Par excluído** = movimento `Estornada` + o estorno dele (`tipo_detalhado`
  `estorno_*`, `movimento_pai_id` = original), mesmo tenant/empresa/produto. Só o
  par completo some; estornada sem estorno, estorno órfão e movimento ativo
  aparecem como antes.
- **`GET /estoque/movimentos`**: `incluir_excluidos` (padrão `false`, inválido →
  400). Mesmos filtros, busca e keyset `(data DESC, id DESC)`; pares calculados uma
  vez por consulta (`NOT IN`), então total, paginação e cursor continuam corretos.
  O cursor fica amarrado ao modo (usar no outro modo → 400). Base sintética de 66 mil
  movimentos / 6 mil pares: contagem ~36 ms, página ~25 ms.
- **Campo `excluido`** na lista e no detalhe.
- **Saldo exibido**: saldo gravado menos o efeito dos excluídos do mesmo produto e
  depósito lançados antes (ordem da SPEC §1.3). Igual com o filtro ligado ou
  desligado e no detalhe. Só leitura; nada é regravado.
- **Kardex**: pílula **Mostrar excluídos** (Não/Sim; no celular, na folha Filtros);
  com "Sim", etiquetas **Excluído** e **Estorno da exclusão**.
- **Histórico do depósito (mapa)**: a regra de esconder continua a da D-PROD-268; o
  saldo antes/depois dos cartões passa a usar a mesma regra do servidor
  (`src/lib/estoqueSaldoSemExcluidos.js`, inteiro com 4 casas).
- Motor, camadas e regras de exclusão **não mudaram** nesta fatia.

## Validação

| Verificação | Resultado |
|---|---|
| PG `estoqueConsulta` / `estoqueConsultaExcluidos` (novo) | 23/23 · 7/7 |
| PG `estoqueEntradas` / `estoqueSaidas` / `motorEstornoCochoTransferencia` | 47/47 · 15/15 · 13/13 |
| PG `estoqueSaidasEdicao` + `estoqueEntradasEdicao` | verdes |
| Smoke inteiro | 317 arquivos, 3977 testes |
| Gate tests | 1055/1055 |
| eslint, `typecheck:backend`, `typecheck` (374, igual à base) | ok |

## Decisões de implementação (dentro da D-PROD-273)

1. O saldo de um movimento ativo é o mesmo com o filtro ligado ou desligado
   (o número não "pula" ao ligar o filtro; lista e detalhe batem).
2. O histórico do depósito no mapa continua escondendo qualquer `Estornada` /
   `estorno_*`, como na D-PROD-268 (no mapa só existe exclusão).

## Riscos e próximos passos

- A ordem canônica supõe que o número do movimento segue a ordem real de
  processamento (atribuído sob a trava do produto — verdadeiro para todo escritor
  atual).
- Fatia 3: feita (abaixo). Falta rodar o script de replay sobre os dados reais de produção (leitura).

## Fatia 3 — replay puro, prévia e prova (sem nenhuma escrita)

**Módulo** `backend/src/modules/estoqueRecalculo/`:

| Arquivo | Papel |
|---|---|
| `estoqueReplay.js` | replay PURO (sem banco) por produto × depósito, ordem canônica da fatia 2; `reproduzir`, `compararComGravado`, `simularExclusao` |
| `estoqueRecalculoLeitor.js` | leitor transacional (REPEATABLE READ + `SET TRANSACTION READ ONLY`), tetos, dependentes (§3) |
| `estoqueRecalculoService.js` | `previaExclusao` e `auditarReplayDoProduto` |
| `estoqueRecalculoRoutes.js` | `GET /estoque/movimentos/:id/exclusao/previa?empresa_id=` |

**Desenho.** O replay não tem cálculo de custo próprio: a saída usa `consumirCustoMedio` do motor e as
reavaliações seguem `reavaliarCamadas`/`reavaliarPoco`. Reproduz: entrada (camada com o custo do movimento);
saída a médio; transferência (S e R juntos: origem a médio, camadas do destino com o custo da fatia, destino
reavaliado — cascata); estorno de saída item a item (valor exato do original, poço reavaliado) e **em lote**
(financeiro e atividade: uma reavaliação por poço no fim do lote, agrupando estornos consecutivos com a mesma
origem, documento, rótulo e `createdAt`); estorno de entrada (camada sai pelo custo vigente, sem reavaliar);
estorno de transferência (E_d/E_o). **Legado** (antes da D-PROD-256): saída com `modo_saida_fifo` ≠
`CUSTO_MEDIO` aplica as fatias e o valor FIFO gravados, sem reavaliar; estorno anterior ao corte devolve sem
reavaliar. Corte = 1º movimento `CUSTO_MEDIO` do tenant (o script aceita `--cutover`).

**Simulação.** O mesmo replay com o movimento (e o par, na transferência) fora da sequência. O depósito do
excluído fica "afetado" a partir dele; transferência de depósito afetado afeta o destino. Movimento em depósito
afetado é refeito pela regra atual (a saída FIFO legada passa a médio e a prévia mostra `regra: legado → atual`).
Saldo < 0 em qualquer ponto → `permitido: false`, `recusa: { code: 'ESTOQUE_EXCLUSAO_SALDO_NEGATIVO',
local_estoque_id, movimento_id, movimento_numero, saldo }`. Se a simulação deixou consumida a camada que um
estorno de entrada/transferência retira, o que falta sai das outras camadas em FIFO, pelo custo delas
(`reatribuido: true`) — proposta para a fatia 5.

**Prévia** (200, `gravado: false`): `movimento`, `excluidos`, `permitido`, `recusa`, `movimentos` (antes → depois de
valor unitário/total, saldos e médios, `fatias_mudaram`), `depositos` (saldo, valor e médio no fim),
`camadas` que mudam, `dependentes` (só identificados: `SaidaEstoqueItem`, `AtividadeApontamentoProduto` e
fatias, `AbastecimentoBem` e fatias, `OperacaoFinanceiraItem` e fatias, `SuplementacaoEvento` por
`dados.movimentacao_estoque_id`). Fail-closed: **antes de simular, o replay sem exclusão tem de reproduzir
exatamente o gravado**; senão 409 `ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL` (`replay_diverge_do_gravado` /
`historico_nao_reproduzivel`). Outras recusas 409: `movimento_ja_excluido`, `movimento_e_estorno`,
`origem_nao_suportada`, `par_de_transferencia_incoerente`. Tetos: 20.000 movimentos lidos por produto e 5.000
posteriores ao excluído → 422 `ESTOQUE_RECALCULO_VOLUME_EXCEDIDO` (conta antes de ler/processar).
Tenant só do `auth_context`; querystring fechada. Guarda = a da exclusão da origem do movimento
(`estoque.saida`, `estoque.entrada`, `movimentacaoEstoque.cancelarTransferencia`,
`suplementacaoEvento.cancelar`, `atividadeApontamentos.cancelar`, `patrimonioAbastecimentos.cancelar`,
`operacaoFinanceira.cancelar`).

**Script** `scripts/ops/replay-estoque-custo-medio.mjs`: lê só `DATABASE_URL` (nunca a imprime), uma transação
somente leitura por produto, só SELECT; relata por produto `reproduz` / `com_divergencia` / `nao_reproduzivel` /
`acima_do_teto`, com amostra das divergências (ids com hash, salvo `--mostrar-ids`); `--exigir-zero` sai 3.

### Validação (PG 17, banco `maike_rx3`)

| Verificação | Resultado |
|---|---|
| `estoqueRecalculoReplay` (novo, PG) | 6/6 |
| `estoqueRecalculoReplayPuro` (novo, sem banco) | 6/6 |
| Regressão: `estoqueConsulta*`, `estoqueCustoMedio`, `estoqueEntradas*`, `estoqueSaidas*`, `estoqueP0*`, `motorEstornoCochoTransferencia` + os novos | 259/259 (19 arquivos) |
| `foundation` (catálogo de erros) | 47/47 |
| Gate tests | 1055/1055 |
| gates `tenancy`, `indices`, `governance-paths`, `no-secrets`, `product-scope`, `import-integrity`, `base44`, `native-api` | ok |
| eslint nos tocados, `typecheck:backend` | ok (0) |
| script sobre o cenário grande | 2 produtos, 42 movimentos, 0 divergência; com 1 camada adulterada: 1 divergência, saída 3 |

**Prova replay = gravado.** Cenário pelos serviços reais (sal, 35 movimentos): entrada documentada, compra e
venda do financeiro, saída manual, transferências A↔B, cocho e o cancelamento dele, linha de produto da
atividade e o cancelamento, venda de duas linhas cancelada (lote), edição D-PROD-271 da saída e da entrada,
cancelamento de transferência, exclusão de saída e de entrada; diesel (7): compras, abastecimentos e o
cancelamento. Todos os valores gravados, saldos, médios, fatias e camadas finais reproduzidos, sem divergência.
O estorno em lote foi provado com números escolhidos para separar as duas regras (o motor gravou 5,3640; item a
item seria 5,3641) — com o agrupamento desligado o teste falha.

**Simulação (números à mão nos testes).** Excluir a saída antiga de 40: a saída seguinte de 30 vai de 4,3636
(130,9080) para 4,0000 (120,0000) e o saldo final de 80 para 120. Excluir a entrada de 50 com venda de 120 depois:
recusa no movimento da venda, saldo −20,0000. Cascata: sem a saída antiga na origem, a transferência vai de
200 para 160, o destino de 8,0000 para 7,6000 e a venda nele de 240 para 228. Excluir a própria transferência:
a venda no destino passa a 300 (60 a 10).

### Divergências do motor

Nenhuma nos cenários montados pelos serviços: o replay reproduziu todos os valores. Casos que o replay **não**
adivinha (recusa, nunca "ajusta"):

1. **Camada sem movimento de entrada** (saldo importado, lote criado direto no banco) e movimento de origem fora
   do protocolo: não há custo de origem confiável (o custo da camada é reavaliado). O produto fica não
   reproduzível e a prévia recusa. Proposta: tratá-los como saldo de abertura só com decisão do proprietário.
2. **Corte da era FIFO**: estorno lançado depois do deploy da D-PROD-256 mas antes da 1ª saída a médio do tenant
   seria tratado como legado. Se o script mostrar divergência aí, a regra proposta é fixar o corte na data do
   deploy (`--cutover`).
3. Saída legada sem `lotes_consumidos`: fatias refeitas em FIFO e marcadas `fatias_reconstruidas`;
   transferência legada sem fatias: o replay para (`transferencia_legada_sem_fatias`).

### Decisões de implementação (dentro da D-PROD-273)

1. A prévia lê o movimento antes da guarda (a guarda depende da origem): um id inexistente é 404 antes do 403.
2. A prévia mostra o médio do poço calculado mesmo nos movimentos que não o gravam (saída manual, venda).
3. A prévia não trava o produto (foto REPEATABLE READ); a escrita (fatias 4 e 5) refaz tudo sob a trava.
4. O texto de rateio em `observacoes` (cocho, transferência) não é comparado nem recalculado aqui (dependente).
5. Os pares já excluídos pela regra antiga continuam na sequência como foram gravados.

### Próximos passos

- Rodar `scripts/ops/replay-estoque-custo-medio.mjs` sobre os dados reais (leitura) e tratar cada
  `com_divergencia` / `nao_reproduzivel` antes da fatia 4.
- Fatia 4: exclusão das saídas usando esta simulação dentro da transação, sob a trava do produto.
