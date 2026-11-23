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

**Decisão para o dono conferir: a contagem não é refeita.** O recálculo é de custo. A diferença do ajuste (a
quantidade do movimento), o saldo anterior e o contado ficam como foram lançados. Os saldos antes e depois do
movimento são recalculados. Se S1 nunca aconteceu fisicamente, a contagem real teria dado outra diferença. Manter a
diferença lançada conta S1 duas vezes (no exemplo abaixo: 160 kg em vez de 110). Refazer a contagem mudaria
quantidades, e até o tipo da linha (sobra ↔ falta). Isso fica fora desta fatia. Se o dono preferir, a alternativa
segura é recusar a exclusão quando houver um ajuste depois no mesmo depósito.

**Números à mão** (`backend/tests/estoqueRecalculoAjuste.test.mjs`). E1 100 kg a R$ 2; S1 tira 50; E2 50 kg a R$ 5
→ 100 kg, R$ 350, médio 3,50. Sem S1: 150 kg, R$ 450, médio 3,00.

| Cenário | Antes de excluir S1 | Depois de excluir S1 |
|---|---|---|
| (e1) sobra de 10 (contou 110) | sobra 10 × 3,50 = 35 (saldo 100→110); S2 20 × 3,50 = 70; poço 90 kg, R$ 315 | sobra 10 × 3,00 = **30** (150→160), camada a 3,00; S2 20 × 3,00 = **60** (160→140); poço 140 kg, R$ 420; linha do ajuste 3,50/35 → 3,00/30 (trilha) |
| (e2) falta de 10 (contou 90) | falta 10 × 3,50 = 35; S2 70; poço 70 kg, R$ 245 | falta 10 × 3,00 = **30** (150→140, fatia L1 10 a 3,00); S2 **60** (140→120); poço 120 kg, R$ 360; linha 3,50/35 → 3,00/30 |
| (e3) S1 zera o depósito; sobra 10 com custo informado R$ 7 | S2 5 × 7 = 35 | a sobra continua 7/70 (100→110); S2 5 × 2,4545 = **12,2725** (110 kg, R$ 270); linha intacta |
| (a) 30 a 1 + 40 a 2, contou 80 | sobra 10 × 1,5714 = 15,714; saída 25 × 1,5714 = 39,285 | — |
| (b) 50 a 2 + 50 a 4, contou 90 | falta 10 × 3 = 30; saída 20 × 3 = 60 | — |
| (c) sobra de 20 (ureia) e falta de 25 (sal, 60 a 5 + 40 a 10), ajuste excluído | estornos 3/60 e 7/175; poços 100 kg/R$ 300 e 100 kg/R$ 700 | — |
| (d) sobra no Barracão sem saldo, R$ 7 informado | 15 × 7 = 105; saída 5 × 7 = 35 | — |

Em todos: `auditarReplayDoProduto` sem divergência (antes e depois da exclusão). No replay puro
(`estoqueRecalculoReplayPuro`): sobra gravada a 9 sem custo informado diverge (calculado 3); com custo informado,
reproduz; sem a linha do ajuste, ou num poço vazio na simulação, o replay para. Excluída a E2, a camada da sobra vai
de 3 para 2.

**Validação (PG 17, banco novo `maike_rx4aj`, `prisma migrate deploy`):**

| Verificação | Resultado |
|---|---|
| `estoqueAjustes`, `estoqueRecalculo*` (inclui o novo `estoqueRecalculoAjuste` e o puro), `estoqueExclusaoRecalculoSaidas`, `estoqueConsulta*`, `estoqueSaidas*`, `estoqueEntradas*`, `estoqueP1M2MotorParametros`, `motorEstornoCochoTransferencia` | 188/188 (14 arquivos) |
| Vermelho antes da correção | PG: (e1) e (e2) falhavam, (a) a (d) e (e3) passavam; puro: os 3 novos falhavam |
| Gate tests (`scripts/tests/run-gate-tests.mjs`) | 1058/1058 |
| eslint nos tocados, `typecheck:backend` | ok (0) |

### Riscos e próximos passos

- Transação: o abastecimento e a linha da atividade usam a transação curta (9 s); um produto com milhares de
  movimentos depois pode estourar o tempo (a transação volta inteira; nada fica pela metade). Os tetos (5.000
  posteriores) valem; medir em produção.
- O custo do fechamento do cocho só é refeito quando reproduz o gravado; eventos antigos com fechamento feito à mão
  ou fora da conta da tela recusam a exclusão (409 com o `evento_id`).
- Fatia 5: entradas, compra, transferência e edição D-PROD-271 com a mesma maquinaria (prova de saldo ≥ 0 e
  reatribuição de camadas nos estornos de entrada).
