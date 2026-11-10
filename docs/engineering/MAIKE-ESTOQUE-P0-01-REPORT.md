# MAIKE-ESTOQUE-P0-01 — Motor físico único; ENTRADA ≠ MOVIMENTAÇÃO

Decisão: **D-PROD-161** ([`DECISIONS.md`](./DECISIONS.md)). Base: `origin/main` `e3ea4c39` (PRs #232, #234 e #235 mergeadas), com a `main` integrada por merge conservador ao longo da missão.
Branch: `claude/maike-estoque-p0-motor-unico-01` · PR [#238](https://github.com/maikelimaadm-stack/MAIKE/pull/238) (**DRAFT**).

> **Zero DDL.** Nenhuma migration nova: `git diff origin/main -- backend/prisma` é vazio. `SCHEMA_APPLIED_PROD = N/A`. Nenhum UPDATE, DDL, seed ou "ajuste para conciliar" foi feito em banco remoto. O único acesso a produção foi um preflight **somente leitura** com números agregados (§10). Todos os testes rodaram em PostgreSQL 17 **local** e descartável.

## 1. O que entra e o que fica fora

**Entra:**
- um **único motor físico** (`backend/src/modules/estoqueFisico/estoqueFisicoMotor.js`) para toda escrita de estoque: compra (entrada), venda, abastecimento, suplementação e transferência entre locais;
- **ENTRADA ≠ MOVIMENTAÇÃO**: só a ENTRADA cria quantidade nova (hoje, a compra confirmada da Central de Lançamentos). A MOVIMENTAÇÃO só baixa ou muda de lugar o que entrou;
- **Produto = cadastro**: `estoque_atual` é cache derivado e somente leitura;
- **escritas genéricas fechadas** (`POST /movimentacoes-estoque`, `POST/PATCH/DELETE /estoque-lotes-nota`), com a renomeação benigna do local, os GETs e os comandos específicos preservados;
- **reconciliação somente leitura** (`GET /estoque-fisico/reconciliacao`).

**Fica fora** (proibido pela missão nesta fase): telas de entrada manual, lotes comerciais, painel de movimentações, inventário físico, relatórios ou históricos novos; mudança no domínio pecuário `Lote`; DDL; seed de produção; correção de dados. A P1 está só desenhada (§13).

## 2. Inventário de escritores — ANTES → DEPOIS

Legenda: **MANTIDO** = sem mudança de comportamento; **MIGRADO→X** = passa pela primitiva X do motor; **BLOQUEADO(C)** = a rota continua registrada e responde C; **RESTRITO** = só sobra a renomeação benigna; **REMOVIDO** = o código saiu.

| # | Escritor | Rota / origem | ANTES | DEPOIS |
|---|---|---|---|---|
| W1 | `aplicarEntradaEstoque` (motor) | Financeiro: confirmar e retificar | ENTRADA: movimento + lote + `{increment}`; não conferia a empresa do produto | **MANTIDO** + guarda fail-closed `produto.empresa_id === empresaId`; criação do lote extraída para `criarCamadaEntrada` (sem mudar comportamento) |
| W2 | `aplicarSaidaFifo` (motor) | Venda; abastecimento | SAÍDA FIFO com CAS, `lotes_consumidos`, `{decrement}` | **MANTIDO** (mesma assinatura) + opcionais `instante`, `complemento` (allowlist), `procedencia`; laço CAS extraído para `consumirCamadas`; guarda de empresa |
| W3 | `estornarSaida` | Cancelamento do abastecimento | Estorno exato por fatia FK | **MANTIDO** |
| W4 | `estornarEntrada` | (oráculo de teste) | — | **MANTIDO** (base do estorno de transferência na P1) |
| W5 | `estornarEmLote` | Financeiro: cancelar, excluir, retificar | — | **MANTIDO** |
| W6 | `numerarMovimentos` / `numeroMovimentoProvisorio` | Abastecimento | Numera no fim | **MANTIDO**; passa a servir também a suplementação e a transferência |
| W7 | `atualizarProcedencia` | Retificar NO_LUGAR | Metadado | **MANTIDO** |
| W8 | Financeiro confirmar/cancelar/retificar/excluir | `/operacoes-financeiras/*` | Só chama o motor | **MANTIDO** — zero linhas em `operacaoFinanceiraService.js`/`operacaoFinanceiraPlano.js` |
| W9 | Abastecimento confirmar/cancelar | `/abastecimentos/*` | Só chama o motor | **MANTIDO** — zero linhas em `abastecimentoService.js`/`abastecimentoPlano.js` |
| W10 | `comandoSaidaSuplementacao` | `POST /movimentacoes-estoque/comandos/saida-suplementacao` | FIFO próprio em `Number`; lote gravado com valor **absoluto sem CAS**; sem limite; local não validado; número reservado no meio; `estoque_atual` conferido depois de gravar; sem `lotes_consumidos` | **MIGRADO→`aplicarSaidaFifo`** (origem `suplementacao`), numeração no fim, releitura; contrato externo preservado (§5) |
| W11 | `comandoTransferenciaEntreLocais` | `POST /movimentacoes-estoque/comandos/transferencia-locais` | Igual à W10 + lote de destino com **ano 2001**, destino sem validação, nomes do corpo, `movimento_filho_id` null | **MIGRADO→`aplicarTransferenciaEstoque`** (nova) + `numerarMovimentos([saída, entrada])` |
| W12 | `fifoEstoque.js` | Só o comando importava | Segundo FIFO, em `Number` | **REMOVIDO** (arquivo apagado) |
| W13 | `movimentacaoEstoqueService.criar` | `POST /movimentacoes-estoque` (SO_ADMIN) | Inseria fato sem saldo, forjava `origem_sistema`/`lotes_consumidos`, ocupava a sequência | **BLOQUEADO(409 `ESTOQUE_ESCRITA_DIRETA_RECUSADA`)** depois do schema (400) e da allowlist de colunas (400); sem transação, número ou auditoria |
| W14 | `movimentacaoEstoqueService.atualizar` | `PATCH /movimentacoes-estoque/:id` | Só renomeia o local, conferindo com `LocalEstoque` | **MANTIDO** (usado pelo Mapa ao salvar depósito) |
| W15 | `movimentacaoEstoqueService.excluir` | `DELETE /movimentacoes-estoque/:id` | Sempre 409 `MOVIMENTO_CANCELAMENTO_OBRIGATORIO` | **MANTIDO** |
| W16 | `estoqueLoteNotaService.criar` | `POST /estoque-lotes-nota` (SO_ADMIN) | Criava saldo sem fato, sem trava, sem validação | **BLOQUEADO(409 `ESTOQUE_ESCRITA_DIRETA_RECUSADA`)** depois da allowlist de colunas (400) |
| W17 | `estoqueLoteNotaService.atualizar` | `PATCH /estoque-lotes-nota/:id` | Qualquer conta renomeava; o admin real alterava saldo, custo, situação, produto e empresa de lote livre | **RESTRITO**: `local_estoque_nome` (e `empresa_id` igual) como antes; outra coluna → 403 se não for admin real → trava → 409 `REGISTRO_OPERACIONAL_IMUTAVEL` se vinculado → 409 `ESTOQUE_ESCRITA_DIRETA_RECUSADA` se livre |
| W18 | `estoqueLoteNotaService.excluir` | `DELETE /estoque-lotes-nota/:id` | Apagava lote livre com saldo | **BLOQUEADO**: trava → vínculo (409 `REGISTRO_OPERACIONAL_IMUTAVEL`) → 409 `ESTOQUE_ESCRITA_DIRETA_RECUSADA`; nunca apaga |
| W19 | `produtoService.criar` | `POST /produtos`; CSV; porta nativa | Criava saldo sem fato | Grava **sempre 0**; ausente ou 0 aceito; outro valor → 422 `PRODUTO_ESTOQUE_ATUAL_NAO_EDITAVEL` |
| W20 | `produtoService.atualizar` | `PATCH /produtos/:id` | `estoque_atual` **absoluto** (lost update contra o motor); troca de empresa com estoque permitida | `estoque_atual` **nunca é escrito** (igual ao atual a 4 casas = sem efeito; diferente = 422, sob `FOR NO KEY UPDATE`); troca de empresa com lote/movimento/cache ≠ 0 → 409 `PRODUTO_COM_ESTOQUE_NAO_MUDA_EMPRESA` |
| W21 | `produtoService.excluir` | `DELETE /produtos/:id` | Contava movimentos, não lotes (lote órfão) | Conta lotes também → 409 `PRODUTO_DELETE_BLOCKED` (`vinculo: 'lotes de estoque'`) |
| W22 | `syncEntityReferencesService` | `POST /referencias/sincronizar` | Metadado do produto no movimento | **MANTIDO** (benigno) |
| W23 | `executarComIdempotencia` | Todos os comandos | Na suplementação/transferência, o recibo era a única prova do consumo | **MANTIDO**; nas operações novas a prova é `lotes_consumidos` do movimento (o recibo continua lido para o legado) |
| W24 | `reservarNumero(s)` | Suplementação/transferência no meio da transação; POST genérico | Prendia a sequência do tenant durante os efeitos | Suplementação/transferência reservam **no fim**; o POST genérico não reserva mais |
| W25 | `scripts/ops/seed-demo-tenant.mjs` | `npm run ops:seed-demo-tenant` | `estoque_atual: 100` sem lote | `estoque_atual: 0` (**não** rodar em produção) |
| W26 | `scripts/dev/e2e-*-seed.mjs` | Scripts de dev | Coerentes, fora do motor | **MANTIDO** (dev) |
| W27 | Reversão pelo navegador (`src/services/suplementacaoHistoricoService.js`) | Atrás de `CANCELAMENTO_*_HABILITADO=false` | PATCH/POST/DELETE de lote, PATCH de `estoque_atual`, DELETE de movimento, não atômico | **Fail-closed sem I/O** (mesmas assinaturas; rejeita sem chamar API) |
| W28 | Portas e wrappers do front (`movimentacaoEstoqueNativePort`, `estoqueLoteNotaNativePort`, `*Api.js`, `suplementacaoApi.js`) | Sem chamador ativo | `create`/`delete` expostos, inclusive à fila offline | `create`/`delete` **saem** das portas e wrappers; `list`/`filter`/`update` ficam (a renomeação usa `update`); os arquivos de porta continuam |
| W29 | `src/services/produtoService.js`, porta de produto, `csvProduto.js` | Cadastro e CSV | Mandavam `estoque_atual` | O payload nunca leva `estoque_atual`; CSV com Estoque ≠ 0/vazio é erro de linha |
| W30 | `scripts/scaffold/p54-*.mjs` | Geradores (fora do `verify:all`) | Regeneram CRUD genérico | Não editados (resíduo registrado) |
| W31 | **Novo** `reconciliarEstoque` | `GET /estoque-fisico/reconciliacao` (SO_ADMIN) | — | Somente leitura (§9) |

## 3. Arquivos

**Backend:**
- `backend/src/modules/estoqueFisico/estoqueFisicoMotor.js` — origens novas, `kgDeEntrada`, `exigirLocaisEstoque`, `consumirCamadas`, `criarCamadaEntrada` (privado), `lotesFifo` com procedência, opcionais de `aplicarSaidaFifo`, **nova** `aplicarTransferenciaEstoque`, guarda de empresa, cabeçalho com a ordem canônica de travas.
- `backend/src/modules/movimentacoesEstoque/movimentacaoEstoqueComandoService.js` — suplementação e transferência pelo motor (§5).
- `backend/src/modules/movimentacoesEstoque/fifoEstoque.js` — **apagado**.
- `backend/src/modules/movimentacoesEstoque/movimentacaoEstoqueService.js` — `criar` recusa (W13).
- `backend/src/modules/estoqueLotesNota/estoqueLoteNotaService.js` — POST/PATCH/DELETE (W16–W18).
- `backend/src/modules/produtos/{produtoService,produtoRepository,produtoRoutes}.js` — W19–W21.
- `backend/src/modules/estoqueFisico/{reconciliacaoEstoque,estoqueFisicoRoutes}.js` (novos), `backend/src/app.js`, `backend/src/shared/auth/guardasRotas.js` (`estoqueFisico.reconciliar = SO_ADMIN`).
- `backend/src/shared/errors/errorCodes.js` — 4 códigos (§8).
- `scripts/ops/seed-demo-tenant.mjs` — W25.

**Frontend:** `src/services/produtoService.js`, `src/apis/produtos/produtoNativePort.js`, `src/domain/produtos/csvProduto.js`, `src/components/produtos/FormularioProduto.jsx`, `src/components/suplementacao/estoqueSuplementacaoUtils.jsx`, `src/apis/movimentacoes-estoque/*`, `src/apis/estoque-lotes-nota/*`, `src/apis/suplementacao/*`, `src/services/suplementacaoHistoricoService.js`.

**Testes novos:** `backend/tests/estoqueP0MotorUnico.test.mjs`, `estoqueP0MotorConcorrencia.test.mjs`, `estoqueP0Cadastro.test.mjs`, `estoqueP0EscritaDireta.test.mjs`, `estoqueP0Reconciliacao.test.mjs`; `tests/smoke/estoqueP0CadastroProduto.test.jsx`, `tests/smoke/estoqueP0Portas.test.js`.

**Não tocados (prova por `git diff`):** `backend/prisma/**`, `config/**`, `package.json`, `scripts/gates/**`, `operacaoFinanceiraService.js`, `operacaoFinanceiraPlano.js`, `abastecimentoService.js`, `abastecimentoPlano.js`, `decimalFinanceiro.js`.

## 4. Motor único

- Toda primitiva recebe `tx` e nunca abre transação; trabalha em `Decimal` (precisão 50, `ROUND_HALF_UP`) e grava com 4 casas; valida **tudo antes** da primeira escrita; lote só por CAS (`updateMany` com o saldo anterior); cache só por `{increment}`/`{decrement}` conferido.
- **Ordem canônica de travas** (documentada no cabeçalho): recibo → documento → advisory de escopo → `LocalEstoque` `FOR KEY SHARE` em ordem de id → produtos (advisory + `FOR UPDATE` crescente) → títulos/perfil/Empresa → lotes (CAS) → INSERTs → Produto ± → **sequência no fim** → AuditLog → recibo committed.
- **FIFO sem mudança de regra:** `COALESCE(data_documento, createdAt)` crescente, desempate por id (para cuid, `localeCompare` = ordem de bytes), numa única função (`ordenarFifo`) e numa única seleção (`lotesFifo`). FEFO não entra.
- **Decimal na fronteira:** o kg do corpo JSON vira Decimal uma única vez (`kgDeEntrada`, `new Dec(String(n))`, 4 casas HALF_UP). O fingerprint de idempotência continua com o Number cru.
- **Transferência** (`aplicarTransferenciaEstoque`): consome FIFO na origem por CAS e cria, para cada fatia, uma camada no destino com o **mesmo custo**, a **mesma `data_documento`** (ou o dia UTC da movimentação, se a origem não tiver data) e a **mesma procedência** (null continua null). Grava Saída `transferencia_enviada` e Entrada `transferencia_recebida` (pai/filho), `lote_destino_id` em `lotes_consumidos` (JSON, sem FK) e **não** altera `estoque_atual` nem o total da empresa.

## 5. Suplementação e transferência migradas

- Sequência: empresa → data → kg → local (`FOR KEY SHARE`) → produto (trava) → motor → `numerarMovimentos` no fim → **releitura** do movimento → auditoria → recibo.
- **Congelado:** rotas, schemas (`additionalProperties: false`), guardas, status 201/200, chaves da resposta e o **fingerprint** (mesmas chaves, mesma ordem, quantidade em Number). Um recibo antigo continua dando replay, mesmo com dado que hoje seria recusado.
- **Mudanças observáveis** (todas declaradas):
  - `unidade_medida = 'KG'` (antes vinha do produto, rótulo errado para quantidade em kg);
  - `lotes_consumidos` preenchido e `modo_saida_fifo = 'FIFO'`;
  - `valor_total`, `valor_unitario` e `custo_medio_depois` pela regra Decimal do motor;
  - nome do local vindo do banco (o do corpo é ignorado);
  - `movimentacao_saida.movimento_filho_id` preenchido;
  - recusas `saldo_lote_insuficiente` / `estoque_atual_insuficiente` no lugar de `insufficient` (nenhum uso em `src/`);
  - 422 `OPERACAO_VALORES_INVALIDOS` (`quantidade_estoque_zero`, `valor_excede_limite_estoque`) e 422 `ESTOQUE_LOCAL_INVALIDO` no lugar de 201 com 0.0000 ou 500;
  - 400 `REQUEST_VALIDATION_FAILED` para `data_movimentacao` com formato inválido ou dia inexistente;
  - `[RATEIO_FIFO]` montado em Decimal; se passar de 2000 caracteres, corta só o bloco gerado (antes dava 500).

## 6. Cadastro de Produtos

- `POST /produtos`: grava sempre `estoque_atual = 0`; ausente ou 0 aceito; outro valor (100, −5, 0,00001, 1e-9) → 422 `PRODUTO_ESTOQUE_ATUAL_NAO_EDITAVEL` antes de reservar número ou auditar.
- `PATCH /produtos/:id`: `estoque_atual` saiu dos campos editáveis; se vier no corpo, a linha é travada (`FOR NO KEY UPDATE`, que espera o `FOR UPDATE` do motor) e relida: igual a 4 casas é aceito sem efeito (os outros campos seguem), diferente → 422. Não há *lost update*.
- Troca de `empresa_id` com lote (qualquer situação), movimento ou cache ≠ 0 → 409 `PRODUTO_COM_ESTOQUE_NAO_MUDA_EMPRESA` (depois da checagem de vínculo a combustível, que fica igual).
- `DELETE` com lote → 409 `PRODUTO_DELETE_BLOCKED` (`vinculo: 'lotes de estoque'`).
- `preco_custo`, peso por saco e unidade continuam editáveis e **não** mexem em lote, item (`fator_kg` gravado) nem movimento.
- Front: `normalizarProduto` e a porta nativa (allowlist) nunca enviam `estoque_atual`; CSV sem estoque (template com `0`; ≠ 0/vazio vira erro de linha); `FormularioProduto` mostra "Estoque é alterado em Entradas/Movimentações, não no Cadastro de Produtos" (`role="note"`); o saldo transferível do Mapa vem só dos lotes do local (saiu o fallback para `estoque_atual`).

## 7. Escritas genéricas fechadas

Ver W13–W18 e W27–W28. A ordem das recusas preserva os testes de concorrência existentes: a trava do lote continua **antes** da recusa, então o PATCH/DELETE de lote continua esperando a venda em andamento e vendo o vínculo. A renomeação do local (`PATCH` de lote só com `local_estoque_nome` e `PATCH` de movimento) segue igual, porque o Mapa a usa em todo salvamento de depósito.

## 8. Erros novos (bloco D-PROD-161 de `errorCodes.js`)

| Código | HTTP | Quando |
|---|---|---|
| `ESTOQUE_ESCRITA_DIRETA_RECUSADA` | 409 | POST genérico de movimento ou lote; PATCH de coluna operacional ou DELETE de lote livre (`details.entidade`, `operacao`, `campos`) |
| `PRODUTO_ESTOQUE_ATUAL_NAO_EDITAVEL` | 422 | `estoque_atual` ≠ 0 no POST ou diferente do atual no PATCH (`field: estoque_atual`, `reason: somente_leitura`) |
| `PRODUTO_COM_ESTOQUE_NAO_MUDA_EMPRESA` | 409 | troca de empresa de produto com lote, movimento ou cache ≠ 0 |
| `ESTOQUE_LOCAL_INVALIDO` | 422 | local do comando inexistente neste tenant (`local_inexistente`, sem oráculo para outro tenant) ou destino inativo (`local_inativo`) |

## 9. Reconciliação somente leitura

- `GET /estoque-fisico/reconciliacao?empresa_id&produto_id&local_estoque_id&limite` — `onRequest: autenticar`, `preHandler: SO_ADMIN`, querystring `additionalProperties: false`, tenant só do `auth_context`.
- Transação `RepeatableRead` + `SET TRANSACTION READ ONLY`, sem `FOR UPDATE`/`FOR SHARE`/advisory; número fixo de consultas, sem N+1; quantidades em `numeric`/Decimal e saída em texto com 4 casas.
- Classes (a primeira regra que casar vale; o nível lote não é mascarado pelo nível produto): `DADOS_INSUFICIENTES` (órfão, local inexistente, status/tipo desconhecido, cache ≠ 0 sem lote e sem evidência), `LIMITACAO_LEGADA` (evidência de escritor fora do protocolo, lote sem movimento de entrada, lote de transferência com ano 2001, resíduo de Number), `DIVERGENCIA_REAL` (invariante quebrado com proveniência do protocolo), `OK`.
- **Nunca corrige**: não há chamada de escrita no módulo; os testes conferem que a foto do banco e a contagem de AuditLog ficam iguais.

## 10. Preflight de produção (somente leitura)

2026-11-10 15:50:16 UTC, Supabase `uuemcasqcdjucflulkne`, uma consulta `SET TRANSACTION READ ONLY` com agregados (SPEC §5.4):

| Verificação | Resultado |
|---|---|
| `_prisma_migrations` | 39/39 concluídas; última `20261110200000_patrimonio_p1_02_abastecimentos` |
| P1 cache × Σ lotes `Disponivel` | **0** produtos divergentes |
| P2 lote fora de I3 (situação inválida / fora de faixa / `Disponivel` zerado / saldo em situação ≠ Disponivel) | 0 / 0 / 0 / 0 |
| P3 lote de transferência com ano < 2002 | 0 |
| P4 saldo sem fato (lote com saldo sem movimento de entrada) | 0 |
| P5 número provisório `p-` commitado | 0 |
| P6 movimento fora do protocolo | 0 |
| Contagens | 2 produtos, 2 lotes, 3 movimentos (todos `operacao_financeira`), 1 local |

Nada foi corrigido, recalculado ou escrito.

## 11. Testes

_(preenchido ao fim da integração e da revisão)_

## 12. Riscos e limitações

- **R1 fingerprint** congelado em Number; mudança futura faria replay antigo virar 409 `IDEMPOTENCY_CONFLICT` (coberto por teste de replay de recibo antigo).
- **R2 recibos antigos**: o replay devolve o corpo antigo (floats, `movimento_filho_id` null); `provaDaCompra` continua lendo os recibos legados.
- **R4 lotes de 2001 já gravados** em outros ambientes: o código novo não os corrige; o reconciliador os classifica como `LIMITACAO_LEGADA`. Em produção, hoje, são 0.
- **R5 linhagem** em JSON (`lote_destino_id`), sem FK; transferências antigas não têm linhagem; nunca se forja ancestral.
- **R7** a P0 não recalcula o cache; divergências legadas ficam só reportadas.
- **R8** estorno de suplementação e de transferência continua indisponível (a UI já estava suspensa); vem na P1, no motor.
- **R12** `data_movimentacao` ausente continua sendo o instante atual (validar "hoje da fazenda" exige fuso em toda empresa).
- **R13** fila offline legada: escritas antigas no IndexedDB seriam recusadas pelo backend se o replay fosse religado (hoje não está); uma criação de produto antiga com `estoque_atual` ≠ 0 seria reenviada sem o campo.
- **R16** o front ainda manda o próprio bloco `[RATEIO_FIFO]`; o servidor acrescenta o dele.
- **R18** a baixa de suplementação e o evento de suplementação continuam em duas transações (comando único fica para a P1).
- **Pré-existente:** `PATCH /produtos` sem `empresa_id` e sem `estoque_atual` lê o estado anterior sem trava; o AuditLog pode registrar `dados_anteriores.estoque_atual` defasado em relação ao motor (o formulário real sempre reenvia `empresa_id`, então trava).
- **Colisão de numeração:** a PR #237 (DRAFT) anuncia a D-PROD-160 e mexe nos mesmos documentos; o merge posterior resolve só texto.

## 13. Proposta P1 (somente design; nada implementado)

1. **Documento de Entrada de Estoque (recebimento manual):** `EntradaEstoque` (empresa, número, RASCUNHO/CONFIRMADA/CANCELADA, motivo fechado `SALDO_IMPLANTACAO | AJUSTE_INVENTARIO_POSITIVO | DOACAO | DEVOLUCAO_QUALIFICADA | OUTRA` com texto, data operacional ≤ hoje da fazenda, `operation_id` único, `versao`) e `EntradaEstoqueItem` (produto, local, quantidade + unidade, `fator_kg` snapshot, custo líquido por kg, FK única para movimento e lote). Confirmar chama `aplicarEntradaEstoque` com origem própria; cancelar chama `estornarEntrada` (lote intocado). Tela e permissão próprias, nunca no Cadastro de Produtos.
2. **Lote de fabricante e validade:** colunas anuláveis em `EstoqueLoteNota` (`lote_fabricante`, `data_fabricacao`, `data_validade`), copiadas pela transferência; prontas para FEFO opcional.
3. **Linhagem estruturada:** `lote_origem_id`/`lote_raiz_id` com FK composta e tabela `EstoqueMovimentoConsumoLote` (padrão `AbastecimentoBemConsumoLote`); backfill só das transferências P0+ a partir de `lotes_consumidos.lote_destino_id`.
4. **Estornos de suplementação e transferência no motor** (`estornarSaida`; `estornarTransferencia` = CAS na camada de destino intocada + devolução à origem); religar a UI suspensa.
5. **Integridade (expand-only, depois do saneamento):** CHECKs de situação e faixa, `estoque_atual ≥ 0`, FKs de lote → Produto/LocalEstoque/movimento de entrada, índice `(cliente_id, movimentacao_entrada_id)`.
6. **Saneamento auditado com GO:** datas de 2001, `Disponivel` com 0, recálculo de cache por comando com relatório antes/depois. Nunca automático.
7. **Consulta/histórico por lote** com contrato próprio (os nomes de página `MovimentacoesEstoque`, `LancamentoProdutosEstoque` e `RelatoriosEstoque` são proibidos no escopo; usar outro nome ou decidir antes).

Cada item exige decisão própria e, havendo DDL, migration expand-only, runbook e GO do proprietário.

## 14. Situação

_(preenchido no fechamento)_
