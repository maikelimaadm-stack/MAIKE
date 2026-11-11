# MAIKE-ESTOQUE-P0-01 — Motor físico único; ENTRADA ≠ MOVIMENTAÇÃO

Decisão: **D-PROD-161** ([`DECISIONS.md`](./DECISIONS.md)). Base: `origin/main` `e3ea4c39` (PRs #232, #234 e #235 mergeadas), com a `main` integrada por merge conservador ao longo da missão. A última integração foi a `main` `e39d318b`, que trouxe a PR #237 (D-PROD-160), no merge `6da66a55`.
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
| W7 | `atualizarProcedencia` | Retificar NO_LUGAR | Metadado só no lote da compra | **MANTIDO** na regra. A partir da R2 (A-03), leva fornecedor e nº do documento também às camadas derivadas por transferência, com linhagem JSON validada e auditoria `ACAO_PROCEDENCIA_LOTE`. Quantidade, custo, situação e datas ficam intactos |
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
| W30 | `scripts/scaffold/p54-*.mjs` | Geradores (fora do `verify:all`; nenhum script/CI os chama) | Uma execução normal sobrescrevia 22 arquivos e recriava POST/DELETE genéricos de lote e movimento, portas com `create`/`delete` e PATCH livre (e, com `Produto` na lista, `estoque_atual` gravável) | **BLINDADO**: guarda `p54-guarda-estoque.mjs` em duas camadas (entradas e conteúdo gerado) recusa a execução inteira com exit 2 e `[SCAFFOLD_ESTOQUE_RECUSADO]` (D-PROD-161), sem gravar nada; saída das demais entidades idêntica byte a byte; teste `scripts/tests/gates/scaffold-p54-estoque.test.mjs` (18 casos) no `test:gates` |
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
  - **Data da camada de destino (R2, A-02):**
    - recebe a `data_documento` da camada de origem;
    - se a origem é legada e não tem data, recebe o dia UTC do `createdAt` dela, que é exatamente a chave FIFO `COALESCE(data_documento, createdAt)` que a origem tinha;
    - a `data_movimentacao` do comando é só o metadado do fato e nunca muda a idade FIFO;
    - antes da R2, o destino de uma origem sem data recebia o dia da movimentação, até 0001-01-01.

### 5.1 Celular: folha "Local de Destino" atrás do diálogo (R2, pré-existente)

- **Causa, medida no Chromium a 390 px:**
  - o "Depósito de Suplementação" é um `LancLoteDialogo` e passa aos filhos o lugar das folhas do celular (`MobileSheetPortalCtx`);
  - o diálogo "Saída do Depósito", aberto por cima, herdava esse lugar;
  - a folha nascia dentro do diálogo de baixo (`.mk-ll-dlg__folhas`), que o de cima deixa `aria-hidden`, sem toque e fora do foco;
  - o z-index 90 dela ficava preso na camada z-50 do diálogo de baixo.
- **Correção mínima**, só em `DetalhesDepositoSuplementacao.jsx`:
  - o diálogo da transferência dá às folhas o próprio lugar;
  - no celular ele centraliza sem `transform` (classes `max-sm:`);
  - Escape com a folha aberta fecha só a folha, pela guarda no `onOpenChange` da Root tipada.
- **Foco, em `AutocompleteGenerico.jsx`** (só no celular): ao abrir, entra na opção marcada ou na primeira; ao fechar, volta ao campo.
- Ficaram sem mudança: Mapa, `FormularioTransferenciaDeposito`, `MobileSheet` e `ui/dialog`.
- **RED → GREEN:**
  - E2E antigo a 390 px: exit 1 com `ariaHidden: true, coberta: true`;
  - RTL `estoqueP0FolhaTransferenciaMobile` (FT1–FT5): 5 de 5 falham antes e 5 de 5 passam depois.

## 6. Cadastro de Produtos

- `POST /produtos`: grava sempre `estoque_atual = 0`; ausente ou 0 aceito; outro valor (100, −5, 0,00001, 1e-9) → 422 `PRODUTO_ESTOQUE_ATUAL_NAO_EDITAVEL` antes de reservar número ou auditar.
- `PATCH /produtos/:id`: `estoque_atual` saiu dos campos editáveis; se vier no corpo, a linha é travada (`FOR NO KEY UPDATE`, que espera o `FOR UPDATE` do motor) e relida: igual a 4 casas é aceito sem efeito (os outros campos seguem), diferente → 422. Não há *lost update*.
- Troca de `empresa_id` com lote (qualquer situação), movimento ou cache ≠ 0 → 409 `PRODUTO_COM_ESTOQUE_NAO_MUDA_EMPRESA` (depois da checagem de vínculo a combustível, que fica igual).
- `DELETE` com lote → 409 `PRODUTO_DELETE_BLOCKED` (`vinculo: 'lotes de estoque'`).
- `preco_custo`, peso por saco e unidade continuam editáveis e **não** mexem em lote, item (`fator_kg` gravado) nem movimento.
- Front: `normalizarProduto` e a porta nativa (allowlist) nunca enviam `estoque_atual`; CSV sem estoque (template com `0`; ≠ 0/vazio vira erro de linha); `FormularioProduto` mostra "Estoque é alterado em Entradas/Movimentações, não no Cadastro de Produtos" (`role="note"`); o saldo transferível do Mapa vem só dos lotes do local (saiu o fallback para `estoque_atual`).

### 6.1 Máscaras: o valor exibido não era o gravado (R2, bloqueador de integridade corrigido)

- **Reproduzido no Chromium com banco real**, a 1280 e 390 px:
  - peso por saco digitado tecla a tecla mostrava "25,00" e gravava `2.5000`;
  - preço colado com Ctrl+V mostrava "12,34" e gravava `0.0012`;
  - uma compra planejada de 4 SACO saía com `fator_kg` 2.5000 e 10 kg, quando deveria ser 25.0000 e 100 kg.
- **Por que é bloqueador:** o lote de estoque nasceria com a quantidade errada.
- **Correção mínima, em `FormularioProduto.jsx`:** uma única leitura do campo serve à tela e ao envio. O texto decimal vindo do servidor (`"30.0000"`) é lido uma vez, na abertura; antes aparecia "3.000,00".
- Não mudaram: a máscara, o `normalizarProduto` e o `produtoService`.
- **RED → GREEN:**
  - probe Playwright + banco: 8 divergências antes, 0 depois;
  - RTL `estoqueP0MascarasProduto`: MP1–MP4 falham antes, MP5 é o controle; 5 de 5 passam depois;
  - o passo 7 do E2E confere que o banco tem 25.0000 e 12.3400 e que a compra usa `fator_kg` 25.0000 (100 kg).

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

### 9.1 Rota e isolamento

- `GET /estoque-fisico/reconciliacao?empresa_id&produto_id&local_estoque_id&limite&cursor`:
  - `onRequest: autenticar` e `preHandler: GUARDAS.estoqueFisico.reconciliar` (só o administrador real do tenant);
  - querystring `additionalProperties: false`, `limite` de 1 a `LIMITE_MAXIMO`, `cursor` ≤ 1024 caracteres no padrão `^[A-Za-z0-9_-]+$`;
  - tenant só do `auth_context`.
- A transação é `RepeatableRead` com `SET TRANSACTION READ ONLY`. Não usa `FOR UPDATE`, `FOR SHARE` nem advisory lock.
- Tudo é ajustado só nesta transação: `plan_cache_mode=force_custom_plan`, `jit=off` e `statement_timeout=15000ms`. O cancelamento 57014 vira 409 `CONCURRENCY_CONFLICT`: fail-closed, nada declarado OK.
- Toda consulta começa por `cliente_id`. O teste RI2 confere isso por tabela, em cada consulta, e também zero `n_tup_ins/upd/del`.
- Quantidades em `numeric`/Decimal e saída em texto com 4 casas.

### 9.2 Classes e regras

- Classes, pela ordem: `DADOS_INSUFICIENTES` → `LIMITACAO_LEGADA` → `DIVERGENCIA_REAL` → `OK`. Vale a primeira que casar, e o nível lote não é mascarado pelo nível produto.
- `DADOS_INSUFICIENTES`:
  - órfão (chave de produto sem Produto);
  - local inexistente;
  - status ou tipo desconhecido;
  - cache ≠ 0 sem lote e sem evidência;
  - lote excluído cujo produto não existe (`lote_excluido_produto_inexistente`).
- `LIMITACAO_LEGADA`:
  - evidência relevante de escritor fora do protocolo;
  - lote sem movimento de entrada;
  - lote de transferência **legado** com ano 2001. A camada com linhagem do motor (a saída-pai cita a camada em `lote_destino_id`) não entra nessa regra; se for adulterada, cai em `DIVERGENCIA_REAL` (R2, A-01);
  - resíduo de Number;
  - lote excluído fora do motor (`lote_excluido_fora_do_motor`).
- `DIVERGENCIA_REAL`: invariante quebrado com proveniência do protocolo, inclusive `linhagem_transferencia_diverge` (R2). Na transferência do motor, `lote_destino_id` tem de apontar para a camada do filho, no local de destino, com a mesma quantidade e o mesmo custo.
- **AuditLog relevante (R1).** Só rebaixa para `LIMITACAO_LEGADA` a escrita **provada** de:
  - `estoque_atual`: os dois lados com o campo e valores diferentes; na criação, ≠ 0;
  - quantidade, situação ou vínculo do lote.

  Nunca rebaixam `DIVERGENCIA_REAL`: renomeação, procedência, custo, fornecedor ou documento do lote, nome ou preço do produto, quantidade igual em outro formato.
- **Recibo legado** (suplementação sem `lotes_consumidos`): usado só quando o movimento não tem `lotes_consumidos`, então nunca conta duas vezes. A janela é de ±10 min.
  - No R1, o recibo era ligado ao movimento por um `LATERAL` por saída, com custo O(saídas × recibos).
  - Desde a R2 (LC-2), as janelas das saídas legadas da página são fundidas em intervalos, cada intervalo é lido uma vez pelo índice `(cliente_id, createdAt)` e o recibo é casado por hash.
  - A pré-contagem da chave passou a `1 + lotes + movimentos + 2 × recibos`, então o recibo entra no orçamento.
  - Medido com uma rajada de 20.000 recibos: o produto foi de 26 s com 409 para 346 ms COMPROVADA, e a chamada 3 do tenant A de 26,3 s com 409 para 1,6 s.
  - Com isso, as divergências achadas na varredura do tenant A subiram de 5/9 para 9/9.
- **Filtro de local:** não mascara a inconsistência do cache, que é global. `cobertura.nivel_produto = 'todos_os_locais'` e I1 continua conferido em todos os locais.
- **Nunca corrige**: não há chamada de escrita no módulo.
  - A única cadeia `.update(` é a do HMAC do cursor, e o teste R9 exige exatamente uma.
  - Os testes conferem que a foto do banco e a contagem de AuditLog ficam iguais.
  - Na carga, 14 chamadas deixaram iguais o hash de todas as linhas de 9 tabelas e os contadores do PostgreSQL.

### 9.3 Volume limitado (R1 + R2)

- **ANTES do R1:** o `limite` não limitava nada; o módulo agregava o tenant inteiro e cortava a lista no fim.
  - A (5.000 produtos, 60 mil lotes, 210 mil movimentos): 8,0–8,2 s, 90 mil linhas, 53,6 MB e heap 132 MB.
  - Com 3× A, a transação estourava, e uma consulta em plano genérico ficou 8 min 50 s.
  - JIT ligado (~1,5 s por consulta) e plano genérico na 6ª execução da conexão (7× mais lento).
- **R1:** páginas por produto em keyset e orçamento por chamada. O padrão é `ORCAMENTO_PADRAO`:
  - `produtosPorPagina` 200, `linhasPorPagina` 20.000 e `linhasPorChamada` 250.000;
  - `tempoMs` 8.000 e `instrucaoMs` 15.000;
  - R2 acrescenta `anomaliasPorConsulta` 20.000 e `auditoriaPorChamada` 250.000.

  A resposta passou a ter `cobertura`, com `OK = null` quando a cobertura é parcial, e um cursor amarrado ao escopo.
- **R2:** o fechamento rigoroso tem sete partes.
  1. **Chaves em vez de produtos.** A página anda pelos ids de Produto **mais** os `produto_id` distintos de lote e de movimento.
     - Órfãos antes do primeiro id, entre dois ids e depois do último, e o tenant sem produto, entram na pré-contagem e no orçamento.
     - Não sobra faixa aberta sem conta.
  2. **Agregado no SQL.** Q3 (lotes) e Q4 (movimentos) devolvem só as linhas suspeitas, com teto `anomaliasPorConsulta`. Acima do teto, a página fica **truncada** e é declarada.
     - Órfãos são contados no SQL e só uma amostra volta.
     - A chave pesada que não cabe no que sobra do orçamento abre sozinha a chamada seguinte. Ela nunca é pulada.
  3. **Exclusões legadas** são uma fase própria, `exclusoes` e depois `exclusoes_sem_id`, com cursor próprio.
     - O histórico de AuditLog de lote é lido em blocos de no máximo `linhasPorPagina` linhas lidas; o LIMIT vem antes do filtro.
     - Cada exclusão vira achado; nenhuma é omitida, nem a de produto inexistente.
     - A evidência por página é uma sonda de índice por produto ou lote.
     - A busca de evidência tem teto `auditoriaPorChamada`. Acima dele, `evidencia_exclusoes = 'parcial'` e nada é rebaixado.
  4. **Contrato da cobertura.**
     - Campos novos: `fim_do_escopo`, `snapshot_unico`, `fase` (`chaves | exclusoes | exclusoes_sem_id | fim`), `cumulativa` (assinada no cursor), `conclusao_global` (`COMPROVADA | INCONCLUSIVA`), `conclusao_global_comprovada` e `motivos_inconclusiva` (`continua_no_cursor`, `varios_snapshots`, `paginas_truncadas`, `evidencia_de_exclusao_parcial`).
     - **COMPROVADA só existe quando o escopo inteiro é lido num único snapshot, sem lacuna.**
     - Uma varredura em várias chamadas termina em `resumo.situacao = 'INCONCLUSIVO'`, com `OK = null`. Nunca é um OK falso.
     - `CONSISTENTE`, `COM_ACHADOS` e o `OK` numérico só aparecem com a conclusão global comprovada.
  5. **Cursor v2 autêntico.**
     - Formato: `base64url(JSON(estado) ‖ HMAC-SHA256)`.
     - Chave derivada por HKDF-SHA256 do `AUTH_SECRET`, com sal e rótulo próprios (`maike-estoque-reconciliacao-cursor:v2`).
     - A assinatura cobre versão, tenant do `auth_context`, empresa, produto, local e limite. Validade de 24 h, com folga de 5 min no relógio.
     - Comparação em tempo constante.
     - **Qualquer** desvio dá o mesmo 400 `REQUEST_VALIDATION_FAILED` (`field: 'cursor'`, `reason: 'cursor_invalido'`) antes de qualquer ida ao banco, sem oráculo de existência.
       - Os desvios cobertos são: adulterado, de outro tenant, de outro escopo, de outra versão ou de outro limite, sem assinatura, vencido ou do futuro.
       - Sai o `cursor_de_outro_escopo` do R1, e o cursor R1 deixa de valer.
     - **RED que motivou o cursor v2:** no R1, o cursor do tenant B era aceito pelo tenant A com 200 e pulava a verificação do tenant inteiro (RK1).
  6. **Idas ao banco:** 3 fixas (+1 com empresa), mais 5 por página, mais 1 por bloco de exclusões, mais 1 da busca de evidência quando necessária. Substitui o "4 fixas + 5 por página" do R1; não há N+1.
  7. **Remedição** em PG17 local, só aqui, sem produção (`r2-carga/medicao.md` no scratchpad da missão).
     - **Fixture:** A com 5.001 produtos, 130.331 lotes, 430.300 movimentos, 145.000 recibos e 62.031 AuditLog. Inclui:
       - um produto patológico com 50.000 lotes e 200.000 movimentos;
       - 300 órfãos antes, entre e depois dos produtos, e uma chave órfã pesada (20.000 + 20.000);
       - 2.000 exclusões antigas, 500 delas de produto inexistente.

       O tenant Z não tem produto e tem 45.000 lotes e 45.000 movimentos órfãos.

| Métrica por chamada | ANTES (R1 `850c5aa2`) | DEPOIS (R2) |
|---|---|---|
| Linhas pré-contadas (orçamento 250.000) | até 387.532 (empresa E1); Z: 90.000 lidas com `linhas_previstas = 0` | ≤ 250.000, salvo a página de uma chave só (`PPESADO`, 250.001) |
| Linhas banco → Node | até 137.245 | até 27.245 |
| MB banco → Node | até 90,6 | até 11,3 |
| Heap pico | até 142 MB | ≤ 33,5 MB |
| Tempo | até 6,5 s | ≤ 4,0 s |
| Produto patológico | 50.008 linhas, 35,4 MB, heap 102 MB | **14 linhas**, heap 11,8 MB, 2,3–2,8 s |
| JIT | desligado desde o R1 | 0 JIT em todos os planos (EXPLAIN ANALYZE BUFFERS) |

- **Varredura inteira:** A leva 8,4–8,6 s em 4 chamadas, contra 8,3 s em 2 chamadas antes.
- **Equivalência nos 6 cenários:** os totais são iguais e o conjunto de `DIVERGENCIA_REAL` é **idêntico** (147/147/7/1/46/0). O único acréscimo é o achado de cada exclusão legada (2.000/1.250/0/0/800/1.000).
- Classes sem cobertura exaustiva viraram BLOCKER nomeado (§12): R2-1, R2-2 e R2-3.

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

Todos em PostgreSQL 17 **local e descartável**, na porta 5433, com um banco novo por suíte e por roteiro. Nada rodou em produção nem na Preview.

### 11.1 RED → GREEN por frente

| Frente | RED (código anterior) | GREEN |
|---|---|---|
| F1 motor único (`estoqueP0MotorUnico`, `estoqueP0MotorConcorrencia`) | 18/23 e 3/4 falham. Motivos: data 2001, Number em vez de Decimal, 500 por estouro, nome do local vindo do corpo, CAS ausente, sequência reservada no meio da transação | 27/27 |
| F2 Cadastro de Produtos (`estoqueP0Cadastro`) | 7/10 falham. Motivos: 201 com `estoque_atual` 100 e −5, PATCH absoluto com *lost update*, troca de empresa e DELETE com lote | 10/10, mais 76/76 nos testes de tela |
| F3 escritas genéricas (`estoqueP0EscritaDireta`) | 6/11 falham. POST de movimento e de lote dão 201 e reservam número; PATCH e DELETE de lote livre gravam | 92/92 nos afetados, mais 113/113 nos testes de tela |
| F4 reconciliação (`estoqueP0Reconciliacao`) | 17/17 falham: a rota não existia e o seed trazia saldo sem fato | 18/18 |
| R1 cobertura (`estoqueP0ReconciliacaoCobertura`) | 9/9 falham: sem cobertura nem cursor, plano genérico, AuditLog benigno rebaixando | 74/74 nos afetados |
| R1 blindagem p54 (`scaffold-p54-estoque`) | 15/18 falham: o gerador produzia escrita de estoque com exit 0 | 18/18. As três mutações da guarda são detectadas |
| R2 reconciliação (`estoqueP0ReconciliacaoR2`) | 12/16 falham contra `850c5aa2`. Inclui o **cursor do tenant B aceito pelo tenant A** (RK1) | 44/44 nos três arquivos da reconciliação |
| R2 folha do celular (`estoqueP0FolhaTransferenciaMobile`) | 5/5 falham; no E2E antigo a 390 px, `ariaHidden: true` | 5/5 |
| R2 máscaras (`estoqueP0MascarasProduto`) | 4/5 falham (o MP5 é o controle). No probe com banco, 8 divergências entre o exibido e o gravado | 5/5, e o banco grava 25.0000 e 12.3400 |
| R2 lentes (`estoqueP0CorrecoesR2`, `estoqueP0FilaOfflineLegada`) | 6/6 e 1/2 falham (A-01, A-02, A-03, B-01, B-02, LC-2, LC-3) | 6/6 e 2/2 |
| Contrato legado (AB11 e TA-05b) | 409 ≠ 200: mudança deliberada da D-PROD-161 | 17/17 nos dois arquivos, com o legado emulado no banco |

### 11.2 Lentes adversariais (R2)

| Id | Lente | Severidade | Defeito | Resultado |
|---|---|---|---|---|
| A-01 | A integridade/FIFO | MÉDIO | `data_transferencia_2001` mascarava a divergência de uma camada do motor | Corrigido (RED→GREEN) |
| A-02 | A | BAIXO | Destino de origem sem data herdava o dia da movimentação, até 0001 | Corrigido |
| A-03 | A | BAIXO | Retificação NO_LUGAR não chegava às camadas transferidas | Corrigido |
| B-01 | B concorrência | MÉDIO | Renomeação de lote sem trava gerava AuditLog falso de quantidade | Corrigido |
| B-02 | B | BAIXO | `PATCH /produtos` sem `empresa_id` gerava AuditLog falso de cache | Corrigido |
| B-03 | B | BAIXO, pré-existente | Replay devolve número onde o 201 devolve string | Não corrigido: contrato, registrado para a P1 |
| LC-1 | C segurança/compat./crescimento | MÉDIO | Mesmo defeito de B-01 e B-02, visto pela reconciliação | Corrigido (B-01/B-02) |
| LC-2 | C | MÉDIO | Recibo legado O(N×M) fora do orçamento: 409 eterno numa rajada | Corrigido para O(N+M) e contado; resíduo físico vai para a P1 (índice, DDL) |
| LC-3 | C | BAIXO | Item legado de estoque travava a fila offline inteira | Corrigido: quarentena no cliente |

As lentes também confirmaram o que segue correto (`verificado_ok`):
- Lente A: cadeia financeira completa, frações e duas camadas, custo líquido, conservação na transferência, limites `Decimal(14,4)`, empresa e tenant; 157/157 nas suítes da lente.
- Lente B: concorrência e idempotência nos pools padrão, 3 e 5.
  - LB1: 6 rodadas, até 10 pedidos simultâneos no mesmo produto.
  - LB2: duas transferências com saldo para uma só.
  - LB3: `lock_timeout` de 8 s.
  - LB4: CAS.
  - LB5: três pedidos com a mesma chave.
  - LB6: recibos legados com float.
  - LB7: rollback em 4 pontos.
  - LB11: 5 rodadas de cancelar contra transferir, com um único vencedor.
  - Nenhum número `p-` commitado. O único deadlock observado é o forçado pelo próprio teste C de mapeamento 40P01.
- Lente C: 401/403 da reconciliação, cursor sem oráculo entre tenants, `cliente_id` nunca vem do corpo (9 escritas → 400), fila offline legada por HTTP → 409/422, scaffolds recusados, diff zero no Financeiro e no Patrimônio, 205/205 nos testes de tela do mobile.

### 11.3 Suítes e gates

| Verificação | HEAD `63070351` (antes do merge da `main`) | HEAD ``6da66a55`` (depois do merge da `main`) |
|---|---|---|
| `prisma migrate diff`, migrations → schema e banco → schema | No difference detected (exit 0) | No difference detected (exit 0) |
| Migrations: repositório × banco local × produção (SELECT) | 39 × 39 × 39 | 39 × 39 × 39 |
| `git diff origin/main -- backend/prisma` | vazio | vazio |
| `verify:all` integral, banco novo | 39 etapas PASS, exit 0, 1319 s | 39 etapas PASS, exit 0, 1312 s |
| gates (`test:gates`) | 716/716 | 716/716 |
| backend (`test:backend`) | 1567 testes: 1562 pass, 0 fail, 5 todo | 1598 testes: 1593 pass, 0 fail, 5 todo |
| testes de tela (`test:smoke`) | 183 arquivos, 2270/2270 | 186 arquivos, 2353/2353 |
| lint / gate:types / typecheck / build | 0 erros / 808 (teto 1746) / ok / ok | 0 erros / 808 (teto 1746) / ok / ok |

### 11.4 E2E com navegador real (Playwright/Chromium, backend e Vite locais)

Um auditor somente leitura confere o banco antes e depois de cada roteiro: cache igual à soma dos lotes, lote dentro da faixa, nenhum `p-` gravado, nenhum ano 2001, e a reconciliação oficial de cada tenant.

| Roteiro | Larguras | Pool 5 | Pool 3 | 5xx | Banco depois |
|---|---|---|---|---|---|
| `e2e-estoque-p0.mjs` (8 passos: compra → suplementação no Mapa → transferência pelo depósito → venda FIFO → cancelar consumido → escritas diretas → Produto/máscaras → reconciliação) | 1280, 390, 412 | 24/24 | 24/24 | 0 | 0 violações; CONSISTENTE/COMPROVADA, 0 achados |
| `e2e-lancamentos-real.mjs` (Central Financeira: confirmar, cancelar, retificar no lugar/substituição, excluir) | 1280, 390 | 68/68 | 68/68 | 0 | 0 violações; só LIMITACAO_LEGADA da semente |
| `e2e-abastecimentos-real.mjs` (Patrimônio: confirmar, cancelar, replay, 403) | 1280, 820, 390 | 27/27 | 27/27 | 0 | 0 violações; só LIMITACAO_LEGADA da semente |
| `e2e-abastecimentos-ux02-real.mjs` (UX-02 vinda da `main`: Produto do bem, troca de associação) | 1280, 820, 390 | 25/25 | 25/25 | 0 | 0 violações; só LIMITACAO_LEGADA da semente |

Os números acima são do HEAD `6da66a55`, depois do merge. Antes do merge, no HEAD `63070351`, os mesmos roteiros tinham dado estoque 24/24, Financeiro 68/68 e Patrimônio 18/18 (em 1280 e 390 px), nos dois pools e sem 5xx.

Nos roteiros Financeiro e Patrimônio, a reconciliação dá `COM_ACHADOS/COMPROVADA`, só com `LIMITACAO_LEGADA` (`entrada_fora_do_protocolo`). A causa é o estoque inicial que as sementes antigas desses roteiros gravam direto no banco com origem `manual`. O resultado está correto: 0 `DIVERGENCIA_REAL`, 0 `DADOS_INSUFICIENTES` e 0 violações físicas.

### 11.5 Volume

Ver §9.3 (R2) e o LC-2 (§9.2): fixture de 5.001 produtos, 130.331 lotes, 430.300 movimentos, 145.000 recibos e 62.031 AuditLog, mais um produto patológico, órfãos e exclusões antigas. Por chamada: ≤ 4,0 s e heap ≤ 33,5 MB. Equivalência exata do conjunto de `DIVERGENCIA_REAL`.

### 11.6 CI

`quality` / `verify:all` no SHA exato do HEAD final: [run 42917240485](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/42917240485) no `6da66a55`, **success** (job `verify:all`, 20 min). O commit seguinte só altera `docs/`; o run do SHA final está no corpo da PR.

Ambiente local: Node 22.22 e PostgreSQL 17.11. A CI usa Node 20.19 e PostgreSQL 16.13, e é ela que vale para o SHA final.

## 12. Riscos e limitações

- **R1 fingerprint** congelado em Number; mudança futura faria replay antigo virar 409 `IDEMPOTENCY_CONFLICT` (coberto por teste de replay de recibo antigo).
- **R2 recibos antigos**: o replay devolve o corpo antigo (floats, `movimento_filho_id` null); `provaDaCompra` continua lendo os recibos legados.
- **R4 lotes de 2001 já gravados** em outros ambientes: o código novo não os corrige; o reconciliador os classifica como `LIMITACAO_LEGADA`. Em produção, hoje, são 0.
- **R5 linhagem** em JSON (`lote_destino_id`), sem FK; transferências antigas não têm linhagem; nunca se forja ancestral.
- **R7** a P0 não recalcula o cache; divergências legadas ficam só reportadas.
- **R8** estorno de suplementação e de transferência continua indisponível (a UI já estava suspensa); vem na P1, no motor.
- **R12** `data_movimentacao` ausente continua sendo o instante atual (validar "hoje da fazenda" exige fuso em toda empresa).
- **R13 fila offline legada.**
  - Hoje o replay não tem chamador.
  - Desde a R2 (LC-3), um `create` ou `delete` antigo de movimento ou lote no IndexedDB fica **retido no cliente**, em quarentena `OFFLINE_ENTITY_UNSUPPORTED`. Ele não é enviado nem apagado, e o resto da fila segue.
  - Ele não chega ao backend. Se chegasse, seria 409.
  - Uma criação de produto antiga com `estoque_atual` ≠ 0 seria reenviada sem o campo.
  - Liberar ou descartar o item retido pela UI fica para a P1.
- **R16** o front ainda manda o próprio bloco `[RATEIO_FIFO]`; o servidor acrescenta o dele.
- **R18** a baixa de suplementação e o evento de suplementação continuam em duas transações (comando único fica para a P1).
- **Corrigido na R2 (B-01, B-02, LC-1):** a leitura sem trava gerava evidência falsa no AuditLog.
  - Afetava o `PATCH /produtos` sem `empresa_id` e sem `estoque_atual`, e a renomeação benigna do lote.
  - Numa corrida com uma baixa, o AuditLog registrava 100→90 de `estoque_atual` ou de `quantidade_disponivel`, que o PATCH não escreveu.
  - A reconciliação tomava isso como escrita fora do motor e rebaixava uma divergência real para `LIMITACAO_LEGADA`.
  - Agora as duas rotas leem a linha sob `FOR NO KEY UPDATE`. Uma corrida natural de 150 rodadas deu 0 divergência.
  - AuditLogs gravados antes desta correção continuam indistinguíveis do legado.
- **B-03, pré-existente na `main`:** o replay idempotente devolve como **número** os Decimal que o 201 devolve como **string**. Ids, números de movimento e rateio são iguais.
  - Mudar isso altera o formato do recibo gravado e o contrato do replay; fica para a P1.
  - Nenhum consumidor em `src/` depende do tipo, e o fingerprint não muda.
- **`data_movimentacao` sem faixa plausível:** desde a R2 (A-02) ela é só metadado do fato. Não define a data nem a idade FIFO de nenhuma camada. Validar a faixa fica com o R12, na P1.
- **LC-2, resíduo:** o recibo legado já é lido de forma linear e entra no orçamento.
  - Continua um limite físico: um produto com milhões de recibos na janela é lido de uma vez, e o resultado é 409 fail-closed.
  - A saída é o índice `OperacaoIdempotente(cliente_id, tipo_operacao, createdAt)`, que é DDL e fica para a P1. É o mesmo tipo de bloqueio que o R2-1.
- **Numeração resolvida:** a PR #237 foi mergeada na `main` com a D-PROD-160 (`e39d318b`) e integrada nesta branch por merge conservador.
  - Os conflitos eram só de texto, em DECISIONS, CURRENT-STATE e ROADMAP; as duas decisões, as duas missões e os dois tracks foram mantidos.
  - O código mergeou sem conflito, e a reverificação foi feita depois do merge (§11).
- **BLOCKER-R2-1: produto gigantesco numa chave.** Arquitetural, não explorável; vai para a P1.
  - Uma chave nunca é partida, porque I1 e I2 precisam do produto inteiro.
  - Medido: 250.001 linhas levam 2,3–2,8 s. Extrapolando, a partir de ~1,5–2 milhões de linhas num só produto, o `statement_timeout` de 15 s corta a leitura.
  - Efeito: 409 fail-closed, nada gravado e nenhum OK, mas esse produto nunca fecha.
  - Saída na P1: partição por local dentro da chave (sem DDL) ou linhagem estruturada (DDL).
  - Em produção hoje são 2 produtos e 2 lotes.
- **BLOCKER-R2-2: AuditLog de lote sem índice útil.** Arquitetural, pede DDL e não é executado nesta PR.
  - O produto de um lote apagado só existe no JSON. Por isso a fase de exclusões lê todo o histórico de AuditLog de lote do tenant, também com filtro de produto.
  - Essa leitura é paginada e cada linha é lida uma vez por varredura. Medido: +75 ms com 32 mil linhas.
  - Acima de `auditoriaPorChamada`, a evidência é PARCIAL e é declarada.
  - Saída na P1 (DDL): índice parcial ou de expressão em `(cliente_id, (dados_anteriores->>'produto_id')) WHERE entidade='EstoqueLoteNota' AND acao='delete'`.
- **BLOCKER-R2-3: sem snapshot global entre requisições.**
  - A conclusão global só existe na chamada única. Uma varredura em várias chamadas é sempre INCONCLUSIVA, por contrato; o tenant de carga A fecha em 4 chamadas.
  - Saída na P1: job assíncrono com `pg_export_snapshot` ou transação dedicada, fora do HTTP.
- **Estatística velha:** logo depois de uma carga em lote e antes do autovacuum, o planejador pode subestimar o tenant e ler o histórico pelo índice errado. Só o orçamento de tempo e o `statement_timeout` limitam isso, e o resultado é fail-closed.
- **Âncora do cursor apagada entre chamadas:** não dá 400. O keyset `id > âncora` continua sem pular nada e sem oráculo (teste RK2). Mudar isso seria decisão de contrato.
- **Medição só local:** 4 vCPU, sem latência de rede. Uma chamada cheia faz cerca de 115 idas ao banco.

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

| Status | Valor | Justificativa |
|---|---|---|
| `CODE_READY` | **SIM** | Toda a missão (F1–F4, R1 e R2) está implementada, e cada achado corrigido tem teste RED→GREEN. Os resultados pós-merge da `main` estão em §11:<br>• `verify:all` integral passou num banco novo;<br>• os E2E reais passaram nos pools 3 e 5, sem 5xx;<br>• o E2E de estoque deu 8/8 em 1280, 390 e 412 px. |
| `SCHEMA_APPLIED_PROD` | **N/A** | Zero DDL: `prisma migrate diff` não acusa diferença nas duas direções, e `git diff origin/main -- backend/prisma` está vazio. Há 39 migrations no repositório, no banco local e em produção (SELECT de 2026-11-10 19:18 UTC). |
| `MERGE_READY` | **SIM (técnico)**. O CI `quality`/`verify:all` está verde no SHA exato do HEAD final, a PR está mergeável sem conflito com a `main` `e39d318b`, e não há risco crítico explorável | Os três BLOCKERs (R2-1, R2-2 e R2-3) são limites arquiteturais fail-closed e não são exploráveis: o máximo que fazem é dar `INCONCLUSIVO` ou um 409, nunca um OK falso. O merge é manual, do proprietário, depois da auditoria do arquiteto. A PR continua em DRAFT. |
| `RELEASE_BLOCKED` | **SIM, até o merge manual** | Não há passo de banco nem migration: o merge publica o código. A liberação depende só da auditoria do arquiteto e do merge manual do proprietário. Pelo preflight só de leitura, a produção tem 0 divergência entre cache e lotes. |

**O que fica para a P1** (nada disso está implementado; cada item precisa de decisão própria):
- os bloqueios R2-1, R2-2 e R2-3, mais o índice de recibos do LC-2 (§12);
- B-03, a forma do replay;
- a faixa de `data_movimentacao` (R12);
- liberar ou descartar item retido na fila offline;
- os itens 1 a 7 do §13.
