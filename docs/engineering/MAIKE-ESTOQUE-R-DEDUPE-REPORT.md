# MAIKE-ESTOQUE-R-DEDUPE — Relatório: a mesma compra não entra duas vezes no estoque (D-PROD-261)

**Data:** 2026-11-19 · **Branch:** `claude/new-session-26kpxu` (a partir da `main` `d447a781`) · **Migration:** nenhuma · **Decisão:** [D-PROD-261](./DECISIONS.md)

## 1. O problema

Uma compra podia entrar no estoque duas vezes:
- pela Central, num lançamento com produtos;
- pela entrada manual (Estoque → Movimentos → Novo movimento → Entrada, motivo Compra).

A entrada já recusava um documento usado num lançamento confirmado. A Central não consultava as entradas: confirmar a compra depois da entrada passava.

## 2. A regra (escolha do proprietário: "bloquear só se mexer no estoque")

| Primeiro | Depois | Resultado |
|---|---|---|
| Entrada manual confirmada, NF X | Central, lançamento **com produtos**, NF X | **recusado** (409 `documento_de_entrada_manual`, com o nº da entrada); a prévia mostra o bloqueio |
| Entrada manual confirmada, NF X | Central, lançamento **sem produtos** (só o pagamento), NF X | aceito |
| Central confirmado **com produtos**, NF X | Entrada manual, NF X | **recusado** (409 `documento_de_compra` / `documento_de_venda`) |
| Central confirmado **sem produtos**, NF X | Entrada manual, NF X | aceito (antes era recusado) |
| Entrada manual confirmada, NF X | Outra entrada, NF X | recusado (como antes) |

Outras regras:
- Entrada excluída, lançamento em rascunho ou cancelado não bloqueiam.
- A retificação na Central também é conferida, no lugar ou por substituição.
- O documento é comparado sem espaços nas pontas e em maiúsculas, por fazenda; outra fazenda não conflita.
- **Corrida:** entrada e compra com o mesmo documento ao mesmo tempo passam pela mesma trava do documento, e só uma grava.

## 3. O que mudou

- `backend/src/modules/estoqueFisico/documentoDeEstoque.js` (novo): a trava do documento e as duas consultas (entrada confirmada com o documento; lançamento confirmado com mercadoria e o documento).
- `backend/src/modules/estoqueEntradas/entradaEstoqueService.js`: `exigirDocumentoLivre` toma a trava e só conflita com lançamento com produtos.
- `backend/src/modules/financeiro/operacaoFinanceiraService.js`: prévia (bloqueio), confirmação e retificação (`exigirDocumentoForaDeEntradaManual`).
- Tela: `src/lib/gestaoErros.js` (mensagem da Central com o nº da entrada) e `src/lib/estoqueEntradasRegras.js` (texto "com produtos").
- Nenhuma migration, nenhuma mudança de banco.

## 4. Constituição: emenda APROVADA

O texto ratificado (`00-CONSTITUICAO.md` §1, expansão D-PROD-177, e `07-DO-NOT-DO.md`, nota D-PROD-177) dizia que a entrada e **qualquer** lançamento da Central com o mesmo parceiro e documento bloqueiam um ao outro. A escolha do proprietário libera o lançamento sem produtos. A emenda da D-PROD-261 foi **aprovada pelo proprietário em 2026-11-19** ("aprovo") e aplicada como parágrafo próprio em `00` §1 e nota própria em `07`, depois das da D-PROD-259.

## 5. Testes

| Arquivo | Resultado |
|---|---|
| `backend/tests/estoqueDocumentoDedupe.test.mjs` (novo, Postgres real) | 8/8 (antes da correção: 4 vermelhos) |
| `backend/tests/estoqueEntradas.test.mjs` | 47/47 |
| `gestaoP3Financeiro` / `Lancamentos` / `EditarExcluir` / `RateioItem` / `Concorrencia` / `Estoque` | 22 / 14 / 47 / 38 / 13 / 17, todos verdes |
| `tests/smoke/gestaoLancamentos.test.jsx` + `estoqueNovoMovimento.test.jsx` | 57/57 |
| `npm run verify:all` | ver o corpo da PR |

## 6. O que continua aberto

- Uma compra ainda entra duas vezes se o documento for **diferente ou omitido** numa das portas. Sem documento não há o que comparar. Por isso nenhum perfil recebe a ação `entrada` por padrão.
- Edição física por revisão, saída manual, ajuste de inventário: fora de escopo.
