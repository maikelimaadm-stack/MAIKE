# MAIKE — Gestão P3-03: editar (retificar), excluir (lógico) e duplicar lançamentos (D-PROD-157)

| Campo | Valor |
|---|---|
| Missão | MAIKE-GESTAO-P3-03 (2026-11-09) |
| Decisão | [D-PROD-157](./DECISIONS.md) |
| PR | #234 (**draft**), branch `claude/maike-gestao-p3-03-editar-excluir-duplicar` |
| Base | `origin/main` `e4e907ea`, merge da PR #231 (P3-02, em produção, 36 migrations) |
| Runbook | [`MAIKE-GESTAO-P3-03-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-03-RUNBOOK-RELEASE.md), **não executado** |
| Colisão externa | A PR #232 (Patrimônio) anuncia a D-PROD-156, que na `main` é a P3-02. Reportada ao proprietário e não alterada. Esta PR usa a D-PROD-157 |

> **Provas:** saídas reais em PostgreSQL 17.11 local descartável, Playwright local e
> CI da PR. Nada foi gravado em Preview nem em produção.

## 1. Modelo técnico e justificativa

| Retificação | Quando | O que acontece |
|---|---|---|
| **NO_LUGAR** | a assinatura física de cada mercadoria não muda | mesmo registro e `versao+1`; as linhas de mercadoria ficam com os mesmos movimentos e lotes; itens de serviço, rateios e títulos (sem baixa) são recriados |
| **SUBSTITUIÇÃO** | a assinatura física muda | numa transação: o antigo é estornado pelo núcleo do cancelamento, recebe `retificado_em` e passa a se chamar `<n>/r<v>`; um documento novo, já confirmado pelo núcleo da confirmação, assume o mesmo número |

A **assinatura física** é: produto, local, unidade, kg, fator, ordem, data operacional, direção e, na compra, custo líquido.

Por que não versionar as linhas no mesmo documento:
- as uniques `(operacao_id, ordem)` dos itens e `(operacao_id, numero_parcela)` dos títulos impedem guardar as linhas antigas ao lado das novas;
- o classificador proíbe CHECK, UNIQUE e NOT NULL em tabela antiga.

Assim, a substituição reusa os dois caminhos já provados, e o histórico físico e financeiro fica íntegro e com FK: itens, fatias FIFO, movimentos, estornos e títulos cancelados.

Nos dois modos fica registrado:
- evento `OperacaoFinanceiraEvento` com motivo, autor, versões, número original e snapshot da versão anterior;
- AuditLog.

## 2. O que foi entregue

### Editar (retificar) um documento confirmado
- `GET /operacoes-financeiras/:id/elegibilidade` é a fonte única da regra. Ela é usada pela tela antes de abrir o formulário e pelos comandos depois das travas (cabeçalho → produtos → títulos).
- `POST /operacoes-financeiras/:id/retificar` exige motivo, `versao` (CAS) e `operation_id` (replay idempotente). O modo é escolhido pelo servidor:
  - **NO_LUGAR**: mesmo registro e `versao+1`. A procedência (parceiro, nº e emissão) chega ao movimento e ao lote originais, com os mesmos ids. Quantidade, custo, status e local do lote não mudam;
  - **SUBSTITUIÇÃO**: estorno pelo núcleo do cancelamento, o antigo vira `<n>/r<v>` com `retificado_em`, e o novo é confirmado pelo núcleo da confirmação com o mesmo número, na mesma transação.
- Na retificação, o peso por saco é o **gravado** no documento, não o do cadastro atual. Corrigir só dados financeiros nunca muda o estoque porque o cadastro mudou depois.
- **Bloqueios** (409 `OPERACAO_RETIFICACAO_BLOQUEADA`, com `details.motivos`):
  - qualquer liquidação, mesmo estornada;
  - lote da compra consumido (fatia FIFO, `lotes_consumidos`, suplementação, transferência ou alteração não auditada);
  - venda com movimento posterior no lote;
  - documento histórico;
  - falta de permissão.
  Se só a parte física for bloqueada, a correção apenas informativa continua permitida.
- Permissão: editar (ou salvar) **e** confirmar.

### Excluir um documento confirmado
- `POST /operacoes-financeiras/:id/excluir` é lógico: estorna como o cancelamento, grava `excluido_em` e o evento `EXCLUSAO` com motivo, e cancela os títulos.
- Os bloqueios são os mesmos (409 `OPERACAO_EXCLUSAO_BLOQUEADA`). O rascunho continua no `DELETE` de antes.
- Permissão: cancelar **e** excluir.
- Na tela, os efeitos aparecem antes; motivo e confirmação explícita são obrigatórios.

### Duplicar
- Abre um formulário **novo** a partir do detalhe completo do servidor, a partir de documento confirmado, rascunho ou cancelado.
- Não clona status, número nem efeitos; nada é gravado até Salvar.
- O `POST` leva `duplicado_de_id`, que só vai para o AuditLog. Uma origem inválida, de outro tenant ou de outra empresa dá 422.
- Se a origem for descartada antes de Salvar, a cópia continua aberta e é gravada sem o vínculo.

### Lista, detalhe e histórico
- A lista tem o filtro `situacao`: `OPERACIONAIS` (padrão), `EXCLUIDOS` ou `TODOS`, com selos de Excluído e Corrigido.
- O detalhe traz:
  - `excluido_em`, `retificado_em` e `exclusao`;
  - `substituido_por`, `substitui` e `duplicado_de_id`;
  - `eventos[]`, com a cadeia nos dois sentidos.
- Na tela, a seção "Histórico de revisões e exclusão" mostra motivo, autor, versões e links.

### Banco
Migration `20261109300000_gestao_p3_03_editar_excluir`, expand-only:
- `OperacaoFinanceira.excluido_em` e `.retificado_em`, `TIMESTAMP(3)`, anuláveis e sem DEFAULT;
- tabela nova `OperacaoFinanceiraEvento`, com 15 colunas, 4 FKs compostas RESTRICT, 4 CHECKs, 2 uniques e 2 índices que começam por `cliente_id`;
- RLS sem FORCE e a política `maike_backend_all` só para `maike_vercel`.

SHA-256 `3f3af00edaffcce8ab0b64336029a93341bfbaba26c847e32e1d2658e4df890b`. O bloco DO `20c6f9ca…9ec9` está pinado em `MIGRATIONS_APROVADAS` e `DO_RLS_APROVADOS`. O classificador dá `expand: true` com 0 violações, sozinha e com a P3-01 e a P3-02.

### Arquivos
- Backend: `operacaoFinanceiraService.js` (elegibilidade, núcleos de confirmar e estornar extraídos sem transação aninhada, retificar, excluir, lista e detalhe), `operacaoFinanceiraRoutes.js`, `estoqueFisicoMotor.js` (`atualizarProcedencia`), `guardasRotas.js` (`porTodas`, `retificar`, `excluirConfirmado`), `autorizacaoTela.js`, `errorCodes.js` e `schema.prisma`.
- Tela: `LancamentosFinanceirosTela`, `FormularioLancamento`, `DialogosLancamento`, `ConsultaLancamento`, `TabelaLancamentos`, `SecoesLancamento`, `lancamentoModelo`, `gestaoErros`, `gestaoPermissions`, a API e o service de operações financeiras.
- Operação: scripts `sql-editor` 01–04 (72 tabelas) e manifesto do classificador.

## 3. Provas

| Prova | Resultado |
|---|---|
| RED backend (`gestaoP3EditarExcluir.test.mjs` contra a `main` `e4e907ea`) | 38 de 38 falham (rotas e campos inexistentes) |
| GREEN backend, mesmo arquivo, PG17 local | **45/45** (E0–E12): duplicar; substituição GERAL/POR_ITEM × VALOR/PERCENTUAL; venda FIFO refeita; 1→3→12 parcelas em BRL/PYG/KWD; todos os bloqueios; exclusão de compra, venda e serviço; cadeia de eventos; concorrência nos dois sentidos; replay; segurança 401/403/404/400/422/409; o banco como última rede (CHECK, UNIQUE, FK e RLS) |
| Regressão Gestão P3 (9 arquivos `gestaoP3*`) | 209/209 |
| `test:backend` completo em banco novo (rodada do implementador) | 1340 pass, 0 fail, 5 todo |
| Medição 200 itens × 120 parcelas | retificar por substituição de 2,0 a 3,1 s; excluir de 0,25 a 0,41 s |
| Tela (RTL) `gestaoLancamentosEditarExcluirDuplicar.test.jsx` | **38/38**, com DUP, EDT, EXC, FIL/DET, MOB (390 e 412 px) e REV (os 5 achados da revisão) |
| Suítes `gestaoLancamentos*` | 293/293 |
| E2E real (tela + backend real + PG17 local), 1280 e 390 px, pools 5 e 3 | **68 ✓, 0 ✗** em cada rodada, 208 capturas. Os passos 30–34 cobrem duplicar, corrigir nos dois modos, excluir e os bloqueios, com conferência exata no banco |
| Classificador, `premerge-migrate.test.mjs` | 14/14 (B1c novo: CHECK, NOT NULL DEFAULT ou UPDATE em tabela antiga são recusados) |
| `prisma migrate diff --exit-code` (migrations→schema e banco→schema) | 0, sem diferenças |
| Ensaio do runbook (caminho B) em PG17 local | o SQL com o identificador de produção é recusado; com o local, `COMMIT` e 36→37; repetir é recusado; o rollback do §9.1 volta a 36; a reaplicação volta a 37; 0 constraint ou índice novo em tabela antiga |

## 4. Revisão adversarial
Três revisores independentes (dinheiro e estoque, banco e concorrência, tela) fizeram **8 achados**, e o corretor confirmou cada um com um teste RED antes de corrigir:

| Achado | Severidade | Correção |
|---|---|---|
| DE-01 a retificação replanejava com o peso por saco **atual** do cadastro | ALTO | `comPesoGravado` no servidor e na tela: o produto que já estava no documento usa o `fator_kg` gravado. Produto novo no documento usa o peso atual |
| DE-02 / BC-01 o NO_LUGAR trocava parceiro, nº e emissão sem levá-los ao movimento e ao lote | MÉDIO | `atualizarProcedencia` no motor e AuditLog `retificar_procedencia` por lote. A prova de proveniência aceita só esse escritor auditado (o teste negativo com AuditLog forjado continua dando `lote_alterado`) |
| TELA-01 a prévia da tela derivava o peso por saco do cadastro | ALTO | mesma regra no `lancamentoModelo`. O diálogo diz que a decisão final é do servidor |
| TELA-02 a mensagem de `lote_alterado` falava de compra também na venda | MÉDIO | mensagens por direção (venda, compra e neutra) |
| TELA-03 a exclusão abria com uma versão diferente da mostrada | BAIXO | a guarda de versão, como na correção. O CAS usa a versão do detalhe |
| TELA-04 a cópia ficava sem saída quando a origem era descartada | BAIXO | a cópia fica aberta e é gravada sem o vínculo, com outro `operation_id` |
| TELA-05 o backend falso divergia do real | BAIXO | o falso espelha a assinatura física, a direção e o peso gravado |

## 5. Gate final
- `verify:all` no HEAD final, em PostgreSQL 17 local novo: ver o relatório final da rodada (bloco text) e o corpo da PR.
- CI da PR no HEAD final: ver o corpo da PR #234.

## 6. Limitações e riscos declarados
- **Produto inativado depois da compra:** a retificação é recusada com 422 `produto_inativo`, e nada muda. Para corrigir, reative o produto. A falha é fechada de propósito, para não criar lote novo de produto inativo.
- **Lote derivado de transferência anterior à correção:** guarda o fornecedor da época, que é a procedência da transferência. Transferências posteriores já copiam o fornecedor corrigido.
- **Qualquer liquidação bloqueia,** mesmo estornada. O caminho é estornar e cancelar, ou lançar um documento novo.
- **Custo da substituição:** cerca de 3 s no pior caso medido (200 itens × 120 parcelas), dentro do tempo da função.
- **Runtime antigo depois do schema:** a lista da P3-02 não esconde excluídos nem versões substituídas, que aparecem como `CANCELADO` (runbook, §0).
- **Colisão de numeração:** a PR #232 anuncia a D-PROD-156, que na `main` é a P3-02. Foi reportada ao proprietário e não alterada. Esta PR usa a D-PROD-157.
- **Nada foi aplicado em produção.** A migration exige GO específico e vem antes do merge.

## 7. Prontidão
| Critério | Estado |
|---|---|
| CODE_READY | **SIM** depois de `verify:all` e CI verdes no HEAD final |
| SCHEMA_APPLIED_PROD | **NÃO** |
| MERGE_READY | **NÃO**: antes, GO específico, migration aplicada e conferida pelo runbook, e CI verde |
