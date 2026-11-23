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
| 4 | Exclusão com recálculo — saídas (manual, cocho, atividade, abastecimento, venda) | feita (branch `claude/estoque-exclusao-saidas`) |
| 5 | Exclusão com recálculo — entradas, compra, transferência, ajuste (a edição D-PROD-271 continua recusando, ver abaixo) | feita (branch `claude/estoque-exclusao-entradas`) |
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

## Fatia 4 — exclusão com recálculo das SAÍDAS

**Origens:** saída manual (`saidaEstoqueService.excluir`), cocho (cancelamento do lançamento), linha de produto da
atividade (cancelar a linha, e as cascatas de cancelar o apontamento/atividade; **não** a edição da linha),
abastecimento (cancelar, direto e em cascata) e venda do financeiro (`operacaoFinanceira` **cancelar**, só
`RECEBER`). Entradas, compra, transferência, ajuste, edição D-PROD-271, `excluirConfirmado` e a retificação do
financeiro continuam com a regra de antes (fatia 5).

**Desenho.** Módulo novo `backend/src/modules/estoqueRecalculo/estoqueExclusaoRecalculo.js`, chamado pelo serviço de
cada origem, sob as travas na ordem de sempre (cocho e áreas antes da trava do produto):

1. `planejarExclusaoComRecalculo` — ANTES do estorno. Por produto, a mesma consulta de hoje
   (`buscarMovimentoPosterior`; no cocho descontando os pares neutros; na saída manual ignorando os estornos
   substituídos da D-PROD-271; os pares já excluídos com recálculo nunca contam como "depois"). Nada depois →
   plano vazio e o **estorno exato de sempre, sem mudança**. Algo depois → lê o histórico (tetos 20.000 / 5.000 →
   422), exige replay sem exclusão = gravado (senão 409 `ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL`), simula a sequência
   sem o movimento (saldo < 0 → 409 `ESTOQUE_EXCLUSAO_SALDO_NEGATIVO`; numa saída não acontece) e só então segue.
2. O estorno exato de hoje (o par original/estorno some das telas — fatia 2).
3. `aplicarExclusaoComRecalculo` — marca o par em `movimentacao_grupo_id = 'exclusao_recalculo:<id do original>'`
   (coluna existente e sem uso; **sem migration**), relê o histórico e refaz a sequência com o par fora dela. Grava
   só o que mudou, com CAS sobre o lido: valores, saldos, médios (só onde o motor os grava) e `lotes_consumidos` dos
   posteriores, em todos os depósitos (cascata pela transferência); o bloco `[RATEIO_FIFO]` das observações
   (cocho e transferência) quando as fatias mudam; as camadas (disponível, custo, situação, entrada). Dependentes:
   `SaidaEstoqueItem` (custo e valor), `AtividadeApontamentoProduto` e `AbastecimentoBem` (custo unitário e total) e as
   fatias `*ConsumoLote` deles, `OperacaoFinanceiraConsumoLote` (o preço de venda não muda) e o custo do fechamento do
   cocho em `SuplementacaoEvento.dados`. Trilha: um `AuditLog` `estoque.recalculo` por registro reescrito (antes →
   depois, autor do `auth_context`, motivo, `movimentos_excluidos`, `origem`) e um resumo por produto. No fim relê
   tudo e exige replay = gravado; qualquer diferença desfaz a transação inteira (409 `recalculo_nao_confere`).

**Replay (fatia 3, ajustado).** O par marcado fica fora da sequência (marca incoerente = não reproduzível). Na
transferência cujas fatias mudam: a camada de destino gravada na mesma posição é reaproveitada se a camada de origem
é a mesma (a quantidade de entrada pode mudar); senão nasce uma nova (id no formato do cuid, para o desempate FIFO por
id seguir a ordem de criação), e a gravada que sobrou fica `Estornado` com disponível 0 — **nenhuma camada é apagada**.
As fatias `*ConsumoLote` seguem as fatias novas: a linha da mesma camada é atualizada, a que falta é criada e a de
camada que deixou de ser consumida é removida (a camada fica; o antes completo vai para a trilha).

**Cocho (`SuplementacaoEvento.dados`).** O cálculo do custo do fechamento era só da tela; foi portado para o servidor
(`backend/src/modules/suplementacaoEventos/fechamentoCustoCocho.js`, mesma aritmética em Number e mesmos
arredondamentos de `calcularFechamentoConsumo`; o smoke `estoqueExclusaoRecalculoCocho` compara os dois nos cinco
caminhos: camadas herdadas, custo do anterior, aproximado, sem sobra, legado). Para cada cocho tocado, a cadeia de
lançamentos ativos é percorrida em ordem: o custo/kg da saída muda e, se o período está fechado, o fechamento é
**primeiro refeito com os dados de antes e tem de bater com o gravado** (senão 409 `cocho_fechamento_nao_reproduzivel`)
e só então refeito com o custo novo; o lançamento seguinte herda as camadas novas da sobra. Os cochos de outros
pontos são travados sem esperar (`pg_try_advisory_xact_lock`; ocupado → 409 `CONCURRENCY_CONFLICT`), porque a trava do
cocho vem antes da do produto e quem já segura o produto não pode esperar por ela.

**Kardex e histórico do depósito.** O par recalculado some como qualquer par excluído, mas **não desconta** o saldo
(os saldos de quem veio depois já foram regravados sem ele): servidor (`estoqueConsultaService`) e tela
(`src/lib/estoqueSaldoSemExcluidos.js`).

**Frontend.** Componente `src/components/estoque/PreviaRecalculoExclusao.jsx` (chama a prévia que já existe) nas
janelas de exclusão: saída manual (`JanelaSaidaEstoque`), cocho (`CancelarLancamentoCocho`, que também lista o
`efeitos.recalculo` do ensaio do servidor), linha de produto (`DialogoCancelarLinha`), abastecimento
(`DialogoCancelarAbastecimento`) e venda (`LancamentosFinanceirosTela`, diálogo Cancelar). Mostra "Nada foi lançado
depois: o estorno devolve o valor exato" ou "X movimentos posteriores terão o custo recalculado" com até 5 linhas
"Nº · tipo · antes → depois" (no celular as linhas quebram, sem rolagem lateral). Recusas do recálculo com frase
clara em todas as origens (`mensagemRecalculoDaExclusao` em `gestaoErros`, usada pela saída, abastecimento,
atividade, financeiro e cocho). Os textos que diziam "só se nada mexeu depois" foram trocados.

### Decisões de implementação (dentro da D-PROD-273) — para o dono conferir

1. **Marca do par em `movimentacao_grupo_id`** (coluna legada sem uso em todo o código), para não precisar de
   migration. Sem a marca, o replay não saberia que os posteriores foram regravados sem o par.
2. **Recálculo inviável** (histórico que não reproduz o gravado, volume, cocho, camada…): saída manual e cocho
   **recusam** (409/422, antes também recusavam por "movimento posterior"); abastecimento, atividade e venda — que até
   aqui estornavam pelo valor exato mesmo com movimento depois — **continuam com o estorno exato, sem recalcular**
   (`estornoExatoSeInviavel`, ampliado na revisão: ver abaixo), com o motivo na trilha. Saldo negativo é sempre
   recusa. Se o dono preferir a recusa também nesses, é tirar a opção.
3. Fatia de dependente (`*ConsumoLote`) de camada que deixou de ser consumida é **removida** (a camada nunca);
   o CHECK `quantidade > 0` não deixa zerar. O antes completo fica na trilha.
4. Camada esgotada sem reavaliação guarda o custo dela (é a regra do motor: a reavaliação só toca o disponível).
5. Saída legada FIFO em depósito afetado passa a médio no valor, mas `modo_saida_fifo` não muda (mudar mexeria no
   corte da era FIFO das outras).
6. O resultado da exclusão traz `recalculo: { produtos, movimentos, camadas, dependentes }` (saída manual, cocho e o
   ensaio de elegibilidade do cocho; financeiro na auditoria).

### Achados da revisão independente e correções

A revisão confirmou por teste os três primeiros achados; cada cenário dela virou teste PG permanente em
`estoqueExclusaoRecalculoSaidas.test.mjs` (7 testes, todos vermelhos antes da correção, verdes depois) e no smoke.

| # | Achado | Correção |
|---|---|---|
| 1 (bloqueante) | O estorno marcado ainda contava como "movimento posterior" fora do planejamento: depois de excluir o cocho 1, cancelar o cocho 2 (agora o último) dava 409 `movimento_posterior_no_deposito`; o mesmo no cancelamento da transferência e na edição D-PROD-271 da saída | A regra mora num ponto só: `buscarMovimentoPosterior` (`movimentoPosterior.js`, de onde vêm também `buscarMovimentoPosteriorA` e todos os chamadores) ignora `movimentacao_grupo_id` com a marca `exclusao_recalculo:` (constante `MARCA_EXCLUSAO_RECALCULO` ali; o replay e a prova da venda do financeiro usam a mesma). No cancelamento da transferência, a linhagem ignora a camada de destino que o recálculo deixou `Estornado` com disponível 0. Testes: cancelar C2 depois de C1 (estorno exato 80 × 5,8 = 464), cancelar a transferência recalculada (A volta a 200 kg) e editar a S2 para 70 kg (70 × 5,8 = 406); replay = gravado |
| 2 | O custo do fechamento reescrito impedia cancelar o lançamento seguinte do cocho (`periodo_anterior_alterado`) | Escolhida a mais segura: `planejarReabertura` considera as trilhas `estoque.recalculo` do evento posteriores ao fechamento, aplicadas em ordem sobre o `dados_novos` do fechamento, cada uma conferida contra o estado anterior a ela (cadeia quebrada = alterado). Não se grava registro "de fechamento" falso no AuditLog (ele entraria nas provas de quem fechou o período). Ao reabrir, o custo/kg da saída fica o vigente (recalculado). Teste: o caso do dono, cancelar C1 e depois C4 → C3 reabre com sobra 10 e custo/kg 5,8 |
| 3 | O fallback de abastecimento, atividade e venda só cobria duas razões e só no planejamento | Toda recusa contornável (inviável por qualquer razão, volume 422, `cocho_ocupado`) cai no estorno exato, com a trilha `estoque.recalculo` do produto (`recalculo_dispensado`, `recusa`). Depois de escrever, o recálculo roda num `SAVEPOINT`: recusa contornável (inclusive `recalculo_nao_confere`) faz `ROLLBACK TO SAVEPOINT` e segue com o estorno exato já gravado. Saldo negativo é sempre recusa. Cancelar abastecimento e linha de atividade passou a `TRANSACAO_LONGA` (30 s, a da exclusão da saída manual). Teste: venda com cocho posterior cujo fechamento não reproduz → estorno exato, cocho intocado, motivo `cocho_fechamento_nao_reproduzivel` na trilha |
| 4 | A prévia mostrava recusa quando a exclusão ia passar | A prévia devolve `modo`: `estorno_exato` (nada depois — sem ler o histórico, mesmo irreproduzível), `recalculo`, ou `estorno_exato_sem_recalculo` com `aviso` (abastecimento, atividade e venda com recálculo inviável; a tela diz que devolve o valor exato sem recalcular, sem alerta vermelho). Na venda e na saída manual, simula juntas as saídas do mesmo produto do documento. Teste: venda de 20 + 30 kg simulada junto → a saída posterior a 464, o mesmo do cancelamento de verdade |
| 5 | Custo herdado podia ficar velho quando o anterior fechado não gravou `custo_unitario_kg` | `herdaMudou` considera também `custoAntes ≠ custoDepois` do anterior. Teste no smoke: o seguinte passa de 150 a 148 (10 kg herdados a 5,8 + 15 a 6); vermelho antes |
| 6 | Movimento legado com `movimentacao_grupo_id` preenchido caía em `CONCURRENCY_CONFLICT` | Recusa clara antes de qualquer escrita: `ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL` `grupo_legado_preenchido` (também se a marca passar de 64 caracteres); nas três origens do item 3, estorno exato com o motivo na trilha |

Mudou também a expectativa do teste de recusas da prévia da fatia 3: com nada depois, a prévia é `estorno_exato`; o
cenário ganhou uma saída depois para continuar exercitando tetos e a recusa por divergência.

Não feito (relatado): as cascatas de cancelar o apontamento ou a atividade continuam na transação curta; a leitura do
histórico continua em três passos (prova, recálculo, prova final) — reaproveitar exigiria reler as camadas depois do
estorno de qualquer jeito.

### Validação (PG 17, banco `maike_rx4`)

| Verificação | Resultado |
|---|---|
| PG `estoqueExclusaoRecalculoSaidas` (novo: manual, cocho, atividade, abastecimento, venda, cascata, concorrência, fail-closed e os 7 da revisão) | 16/16 |
| Testes da revisão (`rev4`: `cocho` e `seguintes`) | 13/13 (antes: 9/13) |
| PG regressão: `estoqueRecalculo*`, `estoqueConsulta*`, `estoqueSaidas*`, `estoqueEntradas*`, `estoqueCustoMedio`, `estoqueP0*`, `estoqueP1M2MotorParametros` (P7), `motorEstornoCochoTransferencia`, `suplementacao*`, `leituraCocho*`, `atividade*`, `abastecimento*`, `patrimonioP1Abastec*`, `patrimonioSimplificaAbast*`, `gestaoP3*`, `depositoCancelar*`, `foundation` + o novo | 988/988 (63 arquivos) |
| Smoke inteiro (inclui o novo `estoqueExclusaoRecalculoCocho`: porte do custo do cocho = tela, herança pelo custo do movimento, resumo da prévia, par recalculado no histórico) | 318 arquivos, 3986 testes |
| Gate tests | 1055/1055 |
| gates `tenancy`, `indices`, `governance-paths`, `no-secrets`, `product-scope`, `import-integrity`, `base44`, `native-api` | ok |
| eslint nos tocados, `typecheck:backend` | ok (0) |
| `typecheck` | 374 (igual à base) |

Testes existentes que mudaram de expectativa (só onde provavam a recusa "movimento posterior" nestas origens):
`estoqueSaidas` (excluir com movimento depois → passa e recalcula), `estoqueSaidasEdicao` (a edição continua recusando;
a exclusão no mesmo cenário passa), `suplementacaoCancelamentoCocho` (compra/outro cocho depois e a corrida "saída
primeiro" → o cancelamento passa e recalcula), `estoqueRecalculoReplay` (a prova do estorno em lote do financeiro
passa a usar a primitiva do motor, a regra dos pares antigos), e dois textos do smoke (abastecimento e linha de
produto, que diziam "volta exatamente").

### Testes PG novos (`backend/tests/estoqueExclusaoRecalculoSaidas.test.mjs`, números à mão)

Base: A recebe 100 kg a R$ 4 (L1) e 100 kg a R$ 6 (L2); S1 tira 50 a R$ 5; entram 50 a R$ 9; S2 tira 80 a R$ 6 =
R$ 480 (L1 50 + L2 30). Excluir S1: 250 kg a R$ 5,8; S2 = 80 × 5,8 = **R$ 464** (só L1 80), saldo 200→250 / 120→170.

| Cenário | Resultado |
|---|---|
| Saída manual | S2 464, fatias L1 80, entrada do meio 150→200, camadas L1 20 / L2 100 / L3 50 a 5,8; `SaidaEstoqueItem` 480→464; trilha; kardex sem desconto duplo; excluir depois a S2 (agora a última) = estorno exato, sem recálculo |
| Cocho (o caso do dono) | excluir o cocho 1 (50 kg): cocho 2 480→464, cocho 3 120→116, cocho 4 60→58; fechamento do cocho 2 R$ 420→406 (8,4→8,12 cab/dia, sobra 10 kg a 5,8), do cocho 3 (herdou a sobra) R$ 150→145 (3→2,9), lançamento aberto 6→5,8; ensaio de elegibilidade já mostra o recálculo sem gravar |
| Linha de atividade | linha posterior 480→464, fatias (L1 50 + L2 30) → (L1 80): a fatia da L2 sai, a da L1 é atualizada (mesmo id) |
| Abastecimento (diesel, L) | `AbastecimentoBem` 480→464, fatias → L1 80; a camada L2 continua |
| Venda | fatias do item 6→5,8 (L1 80); preço de venda igual (12 × 80 = 960) |
| Cascata | A: 50 a 2 (L1), 100 a 5 (L2); S1 50; entram 50 a 10; T 80 A→B a 6 = 480 (L2); venda 30 no B a 6. Excluir S1: T 440 (L1 50 + L2 30, médio 5,5), duas camadas novas no B, a antiga `Estornado`, venda 165 na camada nova |
| Concorrência | trava do produto segura de fora, duas exclusões na fila: as duas passam em sequência; S3 = 80 × 5,8 = 464; dois pares marcados |

Em todos: `auditarReplayDoProduto` sem divergência antes e depois.

### Ajuste de inventário no replay (D-PROD-272 × D-PROD-273)

O ajuste entrou na `main` depois do replay. A origem `ajuste_estoque` já estava em `ORIGENS_PROTOCOLO`, mas
ninguém tinha provado que o replay reproduz o que o motor grava. Se não reproduzisse, a exclusão com recálculo de uma
saída seria recusada para o produto inteiro depois de qualquer ajuste. Seria seguro, mas seria uma regressão.

**O que o motor grava** (`estoqueFisicoMotor.js`, invólucros do ajuste):

| Ponta | Primitiva | O que fica gravado |
|---|---|---|
| SOBRA `ajuste_sobra` | `aplicarEntradaEstoque` | Entrada com camada nova. O custo é o médio do depósito naquele momento (`pocoDoDeposito`: valor ÷ saldo, 4 casas). Sem saldo, vale o custo informado na linha (`custo_informado = true`). Valor = diferença × custo. O poço **não** é reavaliado. |
| FALTA `ajuste_falta` | `aplicarSaida` | Saída a custo médio, com as fatias em `lotes_consumidos`; o restante do poço é reavaliado. |
| estorno da sobra `estorno_ajuste_sobra` | `estornarEmLote`, efeito ENTRADA | A camada fica `Estornado`, sem reavaliar. O valor é copiado do original. |
| estorno da falta `estorno_ajuste_falta` | `estornarSaida` | Devolve as fatias e o valor exato; o poço é reavaliado. |

`AjusteEstoqueItem.custo_unitario` e `valor_total` copiam o valor unitário e o valor total do movimento.

**O replay já reproduzia?** Sim, em todos os casos **sem exclusão**: sobra (com médio arredondado), falta,
ajuste excluído e sobra com custo informado. Os testes (a) a (d) passaram de primeira. O replay tratava a sobra como
uma entrada comum e criava a camada com o custo gravado. A falta e os dois estornos já seguiam as regras de sempre.

**O que estava errado na exclusão com recálculo** (o caso do dono: entradas → S1 → ajuste → S2, excluir S1):

- **Sobra:** a camada herdou o médio de antes de S1 e ficava com ele. Pela D-PROD-272, a sobra entra "ao custo
  médio do depósito", um custo derivado do estoque. A emenda da D-PROD-273 manda recalcular o custo derivado e não
  mexer no valor de compra. Por isso a sobra segue o médio recalculado, exceto quando o custo foi informado (depósito
  sem saldo): esse custo vale como valor de compra e não muda.
- **Linha do ajuste:** `AjusteEstoqueItem.custo_unitario` e `valor_total` não eram reescritos, nem na sobra nem na
  falta. Na falta, o movimento já era recalculado como saída a médio.

**O que mudou (testes vermelhos antes da correção):**

1. O leitor (`lerHistoricoDoProduto`) lê as linhas do ajuste do produto (`custo_informado`).
2. No replay (`estoqueReplay.js`), a sobra nasce ao médio do depósito naquele ponto da sequência, com a mesma conta
   do motor. Com custo informado, vale o gravado. Assim o replay sem exclusão também **prova** o custo da sobra,
   em vez de só copiá-lo. O replay para em dois casos, sem adivinhar: sobra sem a linha do ajuste
   (`sobra_de_ajuste_sem_linha`) e sobra sem custo informado num poço vazio (`sobra_de_ajuste_sem_custo_medio`;
   o motor teria exigido o custo).
3. No recálculo (`estoqueExclusaoRecalculo.js`), `AjusteEstoqueItem.custo_unitario` e `valor_total` passam a ser
   dependentes. A escrita usa CAS sobre o valor lido e registra a trilha `estoque.recalculo` com antes e depois. A
   prévia (`lerDependentes`) lista a linha com `documento_id` = o ajuste.
4. O motor só passou a exportar o rótulo `TIPO_SOBRA_AJUSTE`. Nenhuma regra dele mudou.

**Escolha do proprietário (2026-11-23): com ajuste de inventário depois, a exclusão é recusada.** Este relatório
apontou que o recálculo é só de custo. A diferença lançada no ajuste ficaria como estava, e a exclusão de S1 contaria
S1 duas vezes: 160 kg no sistema onde a contagem física deu 110. O dono decidiu que o estoque nunca pode ficar
diferente do que foi contado. A decisão está registrada no fim da D-PROD-273.

- **Quando recusa.** Uma sobra ou falta de ajuste foi lançada depois do excluído, na ordem canônica. O ajuste ainda
  está valendo (`Ativa`, sem estorno, fora de par marcado). Ele está num depósito que a exclusão alcança.
- **Como recusa.** 409 `ESTOQUE_EXCLUSAO_RECALCULO_INVIAVEL`, `reason: 'ajuste_de_inventario_posterior'`, com
  `local_estoque_id`, `movimento_id`/`movimento_numero` do ajuste e `ajuste_id`/`ajuste_numero`. Nada é gravado.
- **Onde se acha o ajuste:**
  1. **No depósito do movimento**, por consulta direta, antes de ler o histórico: `buscarAjustePosterior` no leitor,
     com o mesmo critério fail-closed de "depois" de `buscarMovimentoPosterior`. Ela roda em
     `planejarExclusaoComRecalculo`, antes de qualquer escrita e antes do teste "nada depois". Assim, o ajuste
     sozinho também recusa: o ajuste é "algo depois".
  2. **No destino da cascata**, pelo replay. Na simulação (`opcoes.excluir`), um ajuste vigente num depósito já
     alcançado pela exclusão para a simulação com a mesma razão. "Alcançado" quer dizer o depósito do excluído ou o
     destino de uma transferência processada depois dele. Os pares já marcados (exclusões com recálculo gravadas)
     não contam como alcance. Senão, um ajuste depois de qualquer exclusão antiga travaria o produto. Ajuste no
     destino **antes** de a transferência chegar não recusa: nem o saldo nem o custo dele mudam.
- **Sem estorno exato.** A recusa não é contornável (`ehRecusaContornavel` devolve falso para essa razão).
  Abastecimento, atividade e venda **não** caem no estorno exato, que também deixaria o saldo fora do contado. O
  estorno exato de hoje dessas três origens só roda sem plano quando não há nada depois. Com um ajuste depois, a
  consulta direta já recusa, então ele não passa.
- **Prévia.** Devolve `permitido: false`, `modo: null`, a `recusa` com o número do ajuste e nenhum `aviso`. A
  recusa vem antes do teste de estorno exato e nunca vira `estorno_exato_sem_recalculo`.
- **Tela.** `mensagemRecalculoDaExclusao` (`src/lib/gestaoErros.js`) mostra: "Há uma contagem de inventário (ajuste
  nº X) depois deste movimento no depósito; exclua a contagem primeiro ou faça uma nova contagem. Nada foi alterado."

**A escrita em `AjusteEstoqueItem` continua (ainda alcançável).** O ajuste **já excluído** depois do excluído não
recusa, porque a contagem não vale mais. A sobra dele e o estorno `estorno_ajuste_sobra` seguem o médio recalculado,
e a linha do ajuste (status `EXCLUIDA`) copia o custo e o valor do movimento. Sem essa escrita, ela ficaria diferente
do movimento. Ajuste anterior ao excluído e ajuste no destino antes da cascata não mudam de valor. A correção do
replay da sobra (custo ao médio) também continua valendo: no replay sem exclusão ela prova o custo gravado.

**Números à mão** (`backend/tests/estoqueRecalculoAjuste.test.mjs`). Caso do dono: E1 100 kg a R$ 2; S1 tira 50;
E2 50 kg a R$ 5 → 100 kg, R$ 350, médio 3,50. Sem S1 seriam 150 kg, R$ 450, médio 3,00.

| Cenário | Resultado |
|---|---|
| (e1) sobra de 10 no meio (10 × 3,50 = 35), S2 20 × 3,50 = 70 | excluir S1 → **409**, ajuste nº 1, depósito Galpão; nada gravado (foto igual: movimentos, camadas, linhas, saídas, cache, trilha); prévia recusa |
| (e2) falta de 10 no meio (35), S2 70 | **409**; S2 continua 70 |
| (e3) S1 zera o depósito; sobra 10 com custo informado R$ 7; S2 5 × 7 = 35 | **409** |
| (e4) entrada → S1 → ajuste (falta 5), nada mais | **409**: o ajuste sozinho é "algo depois" |
| (e5) S1 em A; A 100 kg a 3,50 → transferência 40 A→B; sobra 5 em B | **409** com o depósito **B** (achado pelo replay) |
| (e6) ajuste **anterior**: 150 kg a 3 → sobra 10 × 3 = 30; S1 40 × 3; entra 40 a 7 (160 kg, médio 4); S2 20 × 4 = 80 | excluir S1 passa: S2 **76** (200 kg, R$ 760, médio 3,8; saldo 200→180); estoque 180 kg, R$ 684; sobra e linha do ajuste intactas (3/30) |
| (e7) ajuste **já excluído** depois de S1: sobra 10 × 3,50 = 35, estornada; S2 20 × 3,50 = 70 | excluir S1 passa: sobra e estorno **3,00/30**, camada estornada a 3,00; S2 **60** (150→130); estoque 130 kg, R$ 390; linha do ajuste excluído 3,50/35 → 3,00/30 (trilha) |
| (e8) sobra 2 × 4 em B **antes** da transferência; T 40 × 3,50 = 140 | excluir S1 passa: T 40 × 3 = **120**; B 52 kg, R$ 168 (médio 3,2308; camadas somam 168,0016); ajuste intacto (4/8) |
| (a) 30 a 1 + 40 a 2, contou 80 | sobra 10 × 1,5714 = 15,714; saída 25 × 1,5714 = 39,285 |
| (b) 50 a 2 + 50 a 4, contou 90 | falta 10 × 3 = 30; saída 20 × 3 = 60 |
| (c) sobra de 20 (ureia) e falta de 25 (sal, 60 a 5 + 40 a 10), ajuste excluído | estornos 3/60 e 7/175; estoques 100 kg/R$ 300 e 100 kg/R$ 700 |
| (d) sobra no Barracão sem saldo, R$ 7 informado | 15 × 7 = 105; saída 5 × 7 = 35 |

Origens com estorno exato (`estoqueExclusaoRecalculoSaidas.test.mjs`), todas com 100 kg a R$ 4:

- **Atividade:** linha de 50 e falta de 10 depois. Cancelar a linha → **409**; prévia `permitido: false` sem aviso.
- **Abastecimento:** diesel 50 L e sobra de 10 L depois. Cancelar → **409**.
- **Venda:** 50 kg e falta de 5 depois. Cancelar → **409**; a venda continua confirmada.

Em todas, nada é gravado.

Em todos os cenários, `auditarReplayDoProduto` dá zero divergência (antes e depois da exclusão ou da recusa).

**Replay puro** (`estoqueRecalculoReplayPuro`):
- Sobra gravada a 9 sem custo informado diverge (o replay calcula 3).
- Com custo informado, e com ajuste excluído, o replay reproduz o gravado.
- Sem a linha do ajuste, o replay para.
- Excluída a E2, a contagem vigente depois recusa a simulação, com depósito, movimento e `ajuste_id`.
- Com o ajuste já excluído, a sobra e o estorno dela vão de 3 para 2.
- Sobra não informada num depósito vazio para a simulação.

**Validação (PG 17, banco novo `maike_rx4aj`, recriado e `prisma migrate deploy`):**

| Verificação | Resultado |
|---|---|
| `estoqueAjustes`, `estoqueRecalculo*` (com `estoqueRecalculoAjuste` e o puro), `estoqueExclusaoRecalculoSaidas`, `estoqueConsulta*`, `estoqueSaidas*`, `estoqueEntradas*`, `estoqueP1M2MotorParametros`, `motorEstornoCochoTransferencia` | 197/197 (14 arquivos) |
| Vermelho antes da correção | 1ª rodada (custo da sobra): PG (e1) e (e2) antigos e os 3 puros. 2ª rodada (recusa): PG (e1)–(e5), as 3 origens com estorno exato e a frase do smoke |
| Gate tests (`scripts/tests/run-gate-tests.mjs`) | 1058/1058 |
| Smoke `tests/smoke/estoque*` | 9 arquivos, 110 testes |
| Smoke inteiro (`npm run -s test:smoke`, por causa do `gestaoErros`) | 318 arquivos, 3999 testes |
| eslint nos tocados, `typecheck:backend` | ok (0) |

**Fora daqui (como antes):** a edição da linha de atividade (D-PROD-271) e a retificação do financeiro estornam e
relançam pelo caminho de sempre, sem passar por esta recusa. A exclusão do próprio ajuste continua exigindo nada
depois (D-PROD-272).

### Riscos e próximos passos

- Transação: o abastecimento e a linha da atividade usam a transação curta (9 s); um produto com milhares de
  movimentos depois pode estourar o tempo (a transação volta inteira; nada fica pela metade). Os tetos (5.000
  posteriores) valem; medir em produção.
- O custo do fechamento do cocho só é refeito quando reproduz o gravado; eventos antigos com fechamento feito à mão
  ou fora da conta da tela recusam a exclusão (409 com o `evento_id`).
- Fatia 5: entradas, compra, transferência e edição D-PROD-271 com a mesma maquinaria (prova de saldo ≥ 0 e
  reatribuição de camadas nos estornos de entrada).

## Fatia 5 — exclusão com recálculo das ENTRADAS

**Origens:** entrada documentada (`entradaEstoqueService.excluir`), compra do financeiro (`operacaoFinanceira`
**cancelar**, `PAGAR`), cancelamento da transferência entre depósitos (`transferenciaEstornoService`, POST e o ensaio da
elegibilidade) e exclusão do ajuste de inventário (`ajusteEstoqueService.excluir`: a sobra é entrada, a falta é saída).
Até aqui todas recusavam quando havia movimento posterior no mesmo produto e depósito (`camada_consumida`,
`lote_consumido`, `movimento_posterior`, `AJUSTE_ESTOQUE_MOVIMENTO_POSTERIOR`).

**Desenho.** A mesma maquinaria da fatia 4 (`planejarExclusaoComRecalculo` → estorno → `aplicarExclusaoComRecalculo`),
com uma diferença: o estorno exato de uma entrada exige a camada intocada, o que é justamente o que não vale quando
alguém consumiu dela depois. Por isso o estorno da origem é gravado **sem tocar na camada** e o recálculo, logo depois,
na mesma transação, deixa a camada como ela tem de ficar:

1. **Planejar** (antes de qualquer escrita, sob a trava do produto): a mesma consulta "algo depois"
   (`buscarMovimentoPosterior`; na transferência, nos dois depósitos). Nada depois → o caminho de sempre, sem mudança
   (na entrada documentada continua valendo a prova da camada intocada). **Algo depois, mas sem saída válida depois**
   (`entradaIntocada`, corrigida na revisão: a camada inteira — uma, 'Disponivel', disponível = entrada, custo = o do
   movimento — **e** nenhuma saída válida depois no poço da entrada; saídas de pares já excluídos não contam): nenhum
   médio que valorizou alguma coisa incluiu a entrada, então o estorno exato está certo. O plano sai com
   `camadaIntocada`: a camada sai inteira pelo motor, o recálculo é tentado (num SAVEPOINT) para o par sair da
   sequência e, se ele recusar (recusa contornável, ou saldo negativo num ponto intermediário — que aqui só pode vir de
   saídas de pares já excluídos, ex.: compra com um abastecimento já cancelado no meio), fica o estorno exato de antes,
   com o motivo na trilha. A camada no custo original **não** basta: toda saída reavalia as camadas ao médio e o custo
   pode voltar ao original depois de saídas que usaram um médio que incluía a entrada (achado 2 da revisão). Com saída
   válida depois, recusa do recálculo é recusa. A prévia usa a mesma função. Senão → contagem de inventário vigente
   depois → 409 `ajuste_de_inventario_posterior`; tetos 422; replay sem exclusão = gravado (senão 409); simulação sem o
   movimento: saldo < 0 em qualquer ponto, de qualquer depósito (inclusive o destino de transferências em cascata) →
   **409 `ESTOQUE_EXCLUSAO_SALDO_NEGATIVO`** com `local_estoque_id`, `movimento_id`, `movimento_numero` e `saldo`; nada
   gravado. **Sem estorno exato como saída** (`estornoExatoSeInviavel` falso): recusa é recusa.
2. **Estorno da origem sem baixa de camada** (motor):
   - `estornarEmLote` ganhou `camadaPeloRecalculo` (ids dos originais, só efeito ENTRADA): o lote precisa existir, ser
     da empresa/produto/local e ter a entrada = kg do item, mas não precisa estar intocado e **não é escrito**. O resto
     é o de sempre (original 'Ativa', movimento de estorno com o valor do original, `estoque_atual −= kg`, CAS). Usado
     por `estornarEntradaDocumentada`, `estornarSobraDeAjuste` e o cancelamento da compra.
   - `estornarTransferenciaEstoque` ganhou `recalculo: true`: valem a descoberta, as travas, o par coerente e ativo, as
     fatias com linhagem, a origem ativa e o limite; não valem a regra do último, as camadas do destino intocadas, a
     devolução nas camadas da origem e a prova de saldo; nenhuma camada é escrita. E_d e E_o nascem como sempre
     (saldos = os de agora ∓ kg, que é o saldo de cada depósito sem a transferência).
3. **Recálculo** (`aplicarExclusaoComRecalculo`): marca o par em `movimentacao_grupo_id` e refaz a sequência sem ele.
   - Entrada: original 'Estornada' + estorno (filho), marca do original.
   - Transferência: **dois pares**, cada um com a marca do seu original: S + E_o (`estorno_transferencia_enviada`, pai =
     S; a S continua com o filho R) e R + E_d. Assim o kardex e o histórico do mapa (que já tratavam o par pela marca do
     original) escondem os dois sem descontar saldo, sem mudar código de leitura.
   - Replay (`estoqueReplay.js`): `paresMarcados` aceita os pares de entrada e os dois pares da transferência (os dois
     têm de estar marcados; qualquer outro desenho → `marca_de_recalculo_incoerente`, fail-closed). A camada da entrada
     excluída (e as recebidas na transferência excluída) nasce no ponto dela **já 'Estornado', disponível 0, no custo e
     na entrada gravados**: nunca entra no poço. Quem consumia dela volta a consumir das outras camadas pela regra do
     motor (FIFO para a fatia, médio do poço sem ela para o valor) — é a reatribuição.
   - A escrita é a da fatia 4: valores, saldos, médios e fatias dos posteriores (todos os depósitos), a camada excluída
     → 'Estornado'/0 (CAS), as outras camadas, camadas novas no destino de transferências em cascata (a antiga fica
     'Estornado'), o rateio `[RATEIO_FIFO]`, os dependentes (`SaidaEstoqueItem`, linha da atividade e fatias,
     abastecimento e fatias, venda e fatias, linha do ajuste já excluído, custo do cocho) — a fatia `*ConsumoLote` da
     mesma camada é atualizada, a que falta é criada, a da camada que deixou de ser consumida é removida; **nenhuma
     camada é apagada** —, a trilha `estoque.recalculo` e a prova final replay = gravado (senão tudo volta, 409).
4. **Prévia** (`GET /estoque/movimentos/:id/exclusao/previa`): guarda nova para a sobra/falta do ajuste
   (`estoque.ajuste`); documento inteiro também na entrada documentada, na compra e no ajuste (todas as linhas do mesmo
   produto do documento são simuladas juntas). A camada da entrada aparece na lista de camadas indo a 'Estornado'.
5. **Tela.** `PreviaRecalculoExclusao` nas janelas de exclusão da entrada (`JanelaEntradaEstoque`), do ajuste
   (`JanelaAjusteEstoque`), no cancelamento do lançamento financeiro também na compra (`LancamentosFinanceirosTela`) e
   na exclusão da transferência pelo mapa (`CancelarTransferenciaDeposito`, quando o ensaio diz que haverá recálculo).
   Frases das recusas do recálculo em `mensagemErroEntrada`, `mensagemErroAjuste` e `mensagemDaRecusaTransferencia`.
   Os textos "só é possível se ... não foi usado / nenhum movimento depois" foram trocados.

**Escolha do dono (2026-11-23) mantida.** Com OUTRO ajuste vigente depois, no depósito que a exclusão muda, a exclusão
(da entrada, da compra, da transferência ou do próprio ajuste) é recusada com `ajuste_de_inventario_posterior` e o
número do ajuste. Excluir primeiro o ajuste mais novo (que é o último: estorno exato) destrava o anterior.

### O que continua recusando, e por quê

| Caso | Recusa | Por quê |
|---|---|---|
| Edição completa D-PROD-271 da entrada e da saída com algo depois | a de antes (`ENTRADA_ESTOQUE_DEPENDENCIAS_FISICAS` / `SAIDA_ESTOQUE_MOVIMENTO_POSTERIOR`) | A edição estorna e **relança no fim da sequência** (número novo). Com movimentos depois, o "recálculo" seria o da exclusão: quem veio depois passaria a ser valorizado **sem** a entrada, não com a versão corrigida (ex.: a entrada nº 31 de 3.600 kg a R$ 0: corrigir o custo não corrigiria as transferências seguintes, e tirar a quantidade deixaria saldo negativo). Fazer certo exige substituir o movimento **no lugar** dele na ordem de lançamento — chave de ordem nova no replay e no kardex. Não cabe no mesmo motor sem mexer na ordem canônica (SPEC §1.3). O caminho hoje: excluir (com recálculo) e lançar de novo. |
| `excluirConfirmado` e retificação do financeiro (compra) | a de antes (elegibilidade com `lote_consumido`) | Como na venda (fatia 4): a elegibilidade é a fonte única da tela do financeiro; o cancelamento cobre a necessidade. |
| Estorno antigo de entrada cuja camada a simulação consome (`reatribuido`) | 409 `reatribuicao_de_camada` | Só aparece com um estorno exato antigo depois do excluído; o valor gravado do estorno antigo deixaria de ser o valor que sai do poço. Raro (o estorno exato antigo exigia a camada intocada). |
| Saldo negativo em qualquer ponto | 409 `ESTOQUE_EXCLUSAO_SALDO_NEGATIVO` | Regra da emenda. |

### Testes PG novos (`backend/tests/estoqueExclusaoRecalculoEntradas.test.mjs`, números à mão)

Base: A recebe E1 100 kg a R$ 4 (L1) e E2 100 a R$ 6 (L2) → 200 kg, médio 5; S1 tira 50 a 5 = 250 (L1); entra E3 50 a 9
(L3) → 200 kg, médio 6; S2 tira 80 a 6 = 480 (L1 50 + L2 30).

| Cenário | Resultado |
|---|---|
| Excluir E1 (consumida por S1 e S2) | S1 250 → **300** (50 × 6, fatia L1 → L2); E3 vê 50 → 100 kg; S2 480 → **600** (80 × 7,5; L2 50 + L3 30); L1 Esgotado → **Estornado**/0 no custo 5; L3 20 a 7,5; estoque 120 → 20 kg; itens das saídas 300/600; estorno `estorno_entrada_exclusao` de R$ 400 (valor de compra); trilha; prévia igual sem gravar; kardex sem desconto duplo; depois disso excluir S2 (a última) = estorno exato |
| Saldo negativo | E1 100, E2 100, S 150, entra 200. Excluir E2 → **409** no movimento de S, saldo **−50**; nada gravado (foto do tenant igual); prévia diz o mesmo |
| Nada depois | estorno exato, sem marca, `recalculo: null` (sem regressão) |
| Compra cancelada com saída depois | compra 100 a 4 (LC), E2 100 a 6, S 50 a 5 = 250 (LC). Cancelar → S **300** (50 × 6, L2); LC Estornado; item da compra continua 4 / 400; estorno `estorno_compra` marcado; estoque 50 |
| Compra cujo estoque foi usado, sem outra entrada | **409** saldo **−30** no movimento da saída; lançamento continua CONFIRMADO |
| Transferência cancelada com consumo depois na origem e no destino | A: E1 100 a 4, E2 100 a 6; B: EB 40 a 8; T 80 A→B a 5 = 400; A recebe 40 a 20 (160 kg, médio 8,75); SA 60 = 525; SB 30 a 6 = 180 (DB1). Cancelar → SA **450** (60 × 7,5, L1), saldo 240 → 180; SB **240** (30 × 8, DB1), saldo 40 → 10; D1 Estornado; camadas de A a 7,5; total da empresa igual; os dois pares marcados (S mantém o filho R); elegibilidade ensaia (`efeitos.recalculo`) sem gravar |
| Transferência deixando o destino negativo | A 100; T 50 A→B; SB 20. Cancelar → **409** no depósito **B**, movimento de SB, saldo **−20**; elegibilidade `elegivel: false` com o mesmo código |
| Ajuste — sobra | E1 100 a 4; sobra 20 a 4; E2 60 a 10 (180 kg, médio 6); S 90 × 6 = 540. Excluir → S **562,5** (90 × 6,25; 160 → 70 kg); camada da sobra Estornado; linha do ajuste guarda 4 / 80 |
| Ajuste — falta | E1 100 a 4, E2 100 a 6; falta 50 a 5; E3 50 a 9; S 80 × 6 = 480. Excluir → S **464** (80 × 5,8, L1 80) |
| Outro ajuste depois | ajuste nº 1 (falta 10), saída 20, ajuste nº 2 (sobra 5). Excluir o nº 1 → **409** `ajuste_de_inventario_posterior`, ajuste nº 2; nada gravado; excluir o nº 2 = estorno exato |
| Cascata por transferência | A: E1 50 a 2, E2 100 a 5 (médio 4); T 80 A→B = 320 (L1 50 + L2 30); SB 30 = 120. Excluir E1 → T **400** (80 × 5, L2); camada nova no B (as duas antigas Estornado); SB **150** na camada nova; L1 Estornado; L2 20 a 5 |
| Cocho e atividade dependentes | E1 50 a 2, E2 150 a 6 (médio 5); cocho 30 = 150 (L1 30); linha da atividade 60 = 300 (L1 20 + L2 40). Excluir E1 → cocho **180** (30 × 6, L2; rateio e custo/kg do lançamento 5 → 6); linha **360** (L2 60): a fatia da L1 sai, a da L2 é atualizada (mesmo id, ordem 2 → 1); L1 fica (FK Restrict) |
| Concorrência | E1 100 a 4, E2 100 a 6, E3 100 a 8; S 50 × 6 = 300. Trava do produto segura de fora, exclusões de E1 e E2 na fila → as duas passam; S **400** (50 × 8, L3); quatro movimentos marcados |

Em todos: `auditarReplayDoProduto` sem divergência antes e depois. Replay puro (`estoqueRecalculoReplayPuro`): par de
entrada marcado reproduz; marca só no original → `problema`; simulação sem E1 (venda 15 → 20, L1 Estornado) e a recusa
com depósito, movimento e saldo (−5); transferência com os dois pares marcados reproduz; com um só → `problema`.

Vermelho antes do verde: replay puro 3/5 falham sem a mudança do replay; PG 0/13 sem a implementação; smoke 3/4 sem a
mudança da tela.

### Prova com dados reais (`maike_prova_prod`)

A cópia não tinha as tabelas do ajuste (D-PROD-272); a prova rodou num clone (`maike_prova_prod_rx5`, `CREATE DATABASE
… TEMPLATE` + `migrate deploy`, só EXPAND), sem tocar na cópia original. `scripts/ops/replay-estoque-custo-medio.mjs
--exigir-zero` **antes** (código da `main` `e05522af`) e **depois** (esta branch): 1 produto, 23 movimentos, 7 camadas,
**0 divergência** nos dois, 5 movimentos da era FIFO. Simulação só de leitura das exclusões das entradas e
transferências ativas desse produto:

| Movimento | Simulação |
|---|---|
| nº 22 compra 15.000 kg | recusa: saldo −450 no nº 23 |
| nº 23 transferência 450 kg | recusa: saldo −60 no nº 25 |
| **nº 31 entrada manual 3.600 kg a R$ 0** (o caso do dono) | **permitida**: 10 posteriores mudam; no depósito da entrada (o Barracão: 13.800 → 10.200 kg no fim) o médio volta de R$ 2,9833 a **R$ 3,96**, e no outro (810 kg) de R$ 3,00 a **R$ 3,96**; transferências nº 33/34 R$ 2.192,40 → 2.970,00, nº 35/36 2.430,00 → 3.207,60, linha da atividade nº 41 105,00 → 138,60 |
| nº 33 transferência 750 kg | recusa: saldo −750 no nº 35 |

### Testes existentes que mudaram de expectativa (só onde provavam a recusa por movimento posterior nessas origens)

| Teste | Antes | Agora |
|---|---|---|
| `estoqueAjustes` (outro movimento depois) | 409 `AJUSTE_ESTOQUE_MOVIMENTO_POSTERIOR` | 200, recalcula (falta 10 a 3; a saída de 1 kg continua 3, saldo 90→89 vira 100→99; estoque 99) |
| `estoqueSaidas` (saída consumiu a camada da entrada) | 409 `ENTRADA_ESTOQUE_DEPENDENCIAS_FISICAS` | 409 `ESTOQUE_EXCLUSAO_SALDO_NEGATIVO` (a entrada era o único estoque) |
| `estoqueEntradasEdicao` (a exclusão no mesmo cenário da edição recusada) | mesma recusa da edição | 409 saldo negativo −10 (a edição continua com a recusa de antes) |
| `depositoCancelarTransferencia` (regra do último) | 409 `movimento_posterior` | cocho no destino → 409 saldo negativo −5 no Barracão; entrada ou cocho na origem → 200 com recálculo; cadeia A→B→C → 409 saldo negativo |
| `estoqueP0MotorUnico`, `patrimonioP1Abastecimentos` (AB13) | 409 `lote_consumido` | 409 `replay_diverge_do_gravado` (cenários com lote legado criado direto no banco, que o replay não reproduz) ou saldo negativo |
| `gestaoP3Estoque`, `gestaoP3Lancamentos`, `patrimonioP1AbastecimentosConcorrencia` (compra consumida) | 409 `ESTOQUE_JA_CONSUMIDO` | 409 `ESTOQUE_EXCLUSAO_SALDO_NEGATIVO` (a compra era o único estoque) |
| `estoqueExclusaoRecalculoSaidas` (fail-closed) | entrada = `origem_nao_suportada` | a entrada passa a validação (para no teto); o estorno é que dá `origem_nao_suportada` |
| `estoqueConsultaExcluidos` (fatia 2, entrada entre o original e o estorno) | saldo de B gravado 100→150, descontado na leitura | B regravado 0→50 pelo recálculo (o par marcado não desconta); a tela mostra o mesmo 0→50 |

Sem regressão: a compra cujo abastecimento foi cancelado (AB11/AB13) e a entrada com outra entrada depois continuam
passando (o abastecimento cancelado é par excluído e não conta; camada inteira → estorno exato se o recálculo recusar).

### Validação (PG 17, banco novo `maike_rx5`, `prisma migrate deploy`)

| Verificação | Resultado |
|---|---|
| PG `estoqueExclusaoRecalculoEntradas` (novo) | 13/13 (vermelho antes: 0/13) |
| Replay puro `estoqueRecalculoReplayPuro` | 15/15 (3 novos vermelhos antes) |
| Regressão PG: `estoque*`, `motorEstornoCochoTransferencia`, `suplementacao*`, `atividade*`, `gestaoP3*`, `depositoCancelar*`, `patrimonioP1Abastec*`, `patrimonioSimplificaAbast*`, `leituraCocho*`, `abastecimento*`, `foundation` | **1210/1210 (78 arquivos)** |
| Smoke inteiro (`npm run -s test:smoke`) | 320 arquivos, 4031 testes: 4030 + 1 intermitente sem relação (`detalhesAreaHistorico`, animação de saída; 28/28 sozinho) |
| Smoke novo `estoqueExclusaoRecalculoEntradas` | 4/4 (vermelho antes: 3/4) |
| Gate tests (`scripts/tests/run-gate-tests.mjs`) | 1061/1061 |
| gates `tenancy`, `indices`, `governance-paths`, `no-secrets`, `product-scope`, `import-integrity`, `base44` | ok |
| eslint nos tocados, `typecheck:backend` | ok (0) |
| `typecheck` | 374 (igual à base) |
| Prova com dados reais (clone migrado de `maike_prova_prod`) | 0 divergência antes e depois |

### Riscos e próximos passos

- A transferência e as entradas usam a transação longa (30 s); o cancelamento da compra usa a do financeiro. Um produto
  com milhares de posteriores pode estourar o tempo (a transação volta inteira). Tetos de 20.000/5.000 valem.
- Exclusão de uma entrada cujo histórico tem lote legado sem movimento de entrada (saldo importado) recusa com
  `replay_diverge_do_gravado` sempre que houver algo depois que tocou a camada. Na cópia de produção isso não ocorre.
- `reatribuicao_de_camada` continua recusa (estorno antigo de entrada sem marca, consumido na simulação). Raro.
- A edição completa (D-PROD-271) com algo depois pede decisão do proprietário (corrigir no lugar = chave de ordem nova).
- O `excluirConfirmado` e a retificação da compra no financeiro seguem a elegibilidade antiga (como a venda na fatia 4).

### Achados da revisão independente e correções

A revisão confirmou três achados por teste (`rev5.test.mjs`). Cada cenário virou teste PG permanente em
`estoqueExclusaoRecalculoEntradas.test.mjs` (describe "achados da revisão"): 3 vermelhos antes da correção, verdes
depois; o 4º prova que a regra nova não regride.

| # | Achado | Correção |
|---|---|---|
| 1 (importante) | **Corrida no cancelamento da venda.** `cancelar` lia os itens e as fatias (`consumos`) antes da trava do produto; uma exclusão com recálculo na fila à frente reescrevia as fatias da venda, e o estorno devolvia às camadas velhas (L2 Disponivel 50 e L3 50 em vez de L2 0 e L3 100; replay divergente para sempre) | No financeiro (`cancelar`, `excluirConfirmado`, `retificar`) as mercadorias e as fatias são relidas **depois** da trava (`mercadoriasSobTrava`) e conferidas com o `lotes_consumidos` relido; divergência → 409 `CONCURRENCY_CONFLICT` `fatias_divergentes`. Os outros escritores conferidos: a linha de produto da atividade (cancelar a linha, o apontamento, a atividade e a edição passam por `estornarLinhasProduto`) lia as fatias de quem chamava, antes da trava — agora as relê sob a trava; abastecimento, saída manual, ajuste (falta) e cocho já liam depois da trava (o cocho e a transferência relêem no motor); a compra usa só o id da camada do item, que não muda. Teste: E1, E2, E3 a 4/6/8; saída de 100; venda de 50; exclusão da E1 e cancelamento da venda na fila → os dois 200, L2 0 (Esgotado), L3 100 a 7, replay = gravado |
| 2 (importante) | **O estorno exato da "camada intocada" gravava valores errados.** Custo atual = custo do movimento não prova que a entrada ficou fora do médio (o custo volta depois de reavaliações). Com o recálculo recusado, o estorno exato deixava S1 e S2 calculados com a entrada excluída | `entradaIntocada` exige também **nenhuma saída válida depois** no poço (saídas de pares já excluídos não contam: original 'Estornada' com estorno, com ou sem a marca). Com saída válida depois e recálculo recusado → a recusa do recálculo. A prévia usa a mesma regra; o estorno exato por camada intocada aparece como `estorno_exato_sem_recalculo` com `aviso`, e o `catch` da prévia só converte as recusas que o planejador contorna. Teste: L0 100 a 5, E 100 a 5, X 100 a 11 (médio 7), S1 50 = 350, Y 250 a 3 (médio 5), S2 10 = 50 (E volta a 5). Recálculo possível: S1 400, S2 48,75. Com grupo legado na entrada (recusa contornável) → prévia e exclusão **409 `grupo_legado_preenchido`**, nada gravado (antes: 200 e S1/S2 errados). Regressão citada (compra cujo abastecimento foi cancelado): continua 200 pelo estorno exato |
| 3 (menor) | A prévia usava só `entradaIntocada`; o serviço também a prova da entrada documentada — podiam discordar | Uma função só (`entradaIntocada`, com a condição nova) no planejador e na prévia; a prova de sempre da entrada documentada só onde nada veio depois. Teste: E 100 (único estoque), saída de 30 excluída → prévia `estorno_exato_sem_recalculo` (aviso saldo negativo) e exclusão 200 |
| 4 | Smoke `detalhesAreaHistorico` falhou uma vez | Smoke completo rodado duas vezes depois das correções: 320 arquivos, 4031/4031 nas duas; o teste passou também sozinho (28/28). Intermitente de tempo (animação de saída do diálogo do mapa), sem relação com a fatia: a fatia não toca nesse componente nem no que ele importa |

Teste existente que mudou de expectativa por causa do achado 2: `patrimonioP1Abastecimentos` AB11(b). A compra tinha o
lote "reposto por fora" com o abastecimento **ativo** depois (saída válida): antes passava pelo estorno exato; agora o
recálculo vê o histórico adulterado e recusa (409 `replay_diverge_do_gravado`, nada gravado). O estado "compra cancelada
com o lote Estornado" passou a ser emulado no banco para manter provada a defesa `lote_indisponivel_para_devolucao` do
cancelamento do abastecimento. O AB13 (compra cujo abastecimento foi **cancelado**) continua 200.

### Validação depois da revisão (PG 17, `maike_rx5`)

| Verificação | Resultado |
|---|---|
| PG `estoqueExclusaoRecalculoEntradas` (com os 4 da revisão) | 17/17 (os 3 da revisão vermelhos antes) |
| `rev5.test.mjs` da revisão | 3/3; H1: as duas operações 200, L2 0 Esgotado, L3 100 a 7, replay sem divergência; H2: prévia `estorno_exato_sem_recalculo` e exclusão 200; H3: prévia e exclusão 409 `grupo_legado_preenchido`, S1 350 e S2 50 intactos |
| Regressão PG (78 arquivos, mesma lista) | 1213/1214 na rodada; a falha era o AB11(b) acima, verde depois do ajuste (15/15) |
| Smoke completo, duas vezes | 4031/4031 e 4031/4031 |
| Gate tests | 1061/1061 |
| gates `tenancy`, `indices`, `governance-paths`, `no-secrets`, `product-scope`, `import-integrity`, `base44` | ok |
| eslint nos tocados, `typecheck:backend` | ok (0) |
| `typecheck` | 374 (igual à base) |
| Prova com dados reais (`maike_prova_prod_rx5`) | replay 0 divergência; a exclusão do nº 31 continua permitida (10 posteriores; médios de volta a R$ 3,96) — ela tem saídas válidas depois, então vai pelo recálculo, não pelo estorno exato |
