# MAIKE — Saída manual com lote numa unidade de conversão (D-PROD-312)

**Decisão:** [D-PROD-312](./DECISIONS.md) · **Data:** 2026-11-25 · **Branch:** `claude/saida-lote-unidade-convertida` · **Migration:** nenhuma

## Problema

Achado da D-PROD-310: na Saída manual do Estoque, com produto que controla lote, lançada numa unidade de conversão do cadastro (SC, galão, CX…), o campo "Lote" comparava os lotes (em kg ou L) com a quantidade digitada na unidade de conversão. A tela errava a sugestão e a conferência, e o servidor recusava com `lotes_nao_somam`.

## Correção

- `src/lib/estoqueLotesRegras.js` — `quantidadeDeEstoque` converte a unidade de conversão ativa do produto pela mesma conta do servidor: multiplica ou divide, 4 casas, HALF_UP. A conversão SACO do cadastro vem antes do peso do saco legado. Sem conversão, a conta não muda.
- `src/lib/dinheiroDecimal.js` — recebe `dividirArredondar`, que saiu de `estoqueEntradasRegras.js`; este último continua exportando a função, então os chamadores não mudam.
- Quem usa a conta: `CampoLotesSaida`, `erroDosLotes` e `lotesUsados`, ou seja, a sugestão FEFO, a soma dos lotes e o aviso de vencido na Saída e na transferência da tela Estoque.

## Testes

- Novo: `tests/smoke/saidaLoteUnidadeConvertida.test.js`, com 4 casos. No código da `main`, 3 falham e o de regressão passa; com a correção, os 4 passam.
- Rodados: smoke de estoque, lote, financeiro, unidades e lançamentos (27 arquivos, 365 testes, todos verdes). `gate:types`, `test:gates` e os gates rápidos estão no CI da PR.

## Fora

- Mostrar a unidade digitada na lista de movimentos e no histórico do depósito (D-PROD-310, "Fora").
