# MAIKE-ESTOQUE-CUSTO-MEDIO — Relatório: custo médio ponderado no motor único (D-PROD-256)

**Data:** 2026-11-19 · **Branch:** `cursor/estoque-custo-medio` (a partir da `main` `75464e88`) · **Migration:** nenhuma · **Decisão:** [D-PROD-256](./DECISIONS.md) · **PR 1 de 2** (a PR 2 é a aba Entradas, D-PROD-257)

## O que mudou

O motor único (`backend/src/modules/estoqueFisico/estoqueFisicoMotor.js`) deixou de valorizar a saída pelo custo FIFO da camada consumida e passou ao **custo médio ponderado do poço produto × depósito**.

| Antes | Agora |
|---|---|
| `consumirFifo`, `aplicarSaidaFifo` | `consumirCustoMedio`, `aplicarSaida` (chamadores e testes renomeados; não existe segundo motor) |
| saída = Σ fatia × custo da camada | saída = quantidade × médio (V ÷ Q, 4 casas); toda fatia leva o médio |
| camada restante com o custo de aquisição | camadas disponíveis restantes reavaliadas ao médio de depois |
| estorno devolvia o valor do original | idem, e depois reavalia o poço (valor antes + valor devolvido) ÷ (qtd antes + qtd devolvida) |
| transferência: destino com o custo de cada camada de origem | destino entra com o valor da saída (médio da origem) e recalcula o médio dele |
| `modo_saida_fifo = 'FIFO'` | `'CUSTO_MEDIO'` nas saídas novas (as antigas seguem `'FIFO'`) |
| `custo_medio_antes/depois` = preço de custo do cadastro / custo da saída | médio do poço antes / depois |

Outros pontos tocados: a prévia do lançamento financeiro simula as saídas seguintes do mesmo poço com a reavaliação (`operacaoFinanceiraPlano.js`); o detalhe da compra mostra o custo de aquisição (líquido ÷ kg) em vez do `custo_unitario` da camada, que agora é valor vigente (`operacaoFinanceiraService.js`); a linhagem da transferência na reconciliação (Q4) não compara mais o custo da camada de destino; textos da tela (Custo médio na consulta do abastecimento, Saldo, explicação do rateio).

## Cutover

Daqui para a frente. Movimentos, fatias e consumos já gravados não mudam; o saldo restante de cada produto × depósito é o poço de partida. O estorno de uma saída FIFO antiga devolve o valor FIFO gravado nela (C4 monta o estado pré-cutover no banco).

## O que roda no merge

**Nada no banco.** Sem DDL, sem reescrita de dados, sem entrada em `MIGRATIONS_CONTRACT_APROVADAS`, sem runbook. A reavaliação das camadas acontece dentro da transação do próximo movimento de cada poço. Esta sessão não executou nada em produção. O merge continua condicionado à aprovação do proprietário da **emenda constitucional proposta** (§1 do `00-CONSTITUICAO.md` e nota no `07-DO-NOT-DO.md`).

## Testes

- Novo: `backend/tests/estoqueCustoMedio.test.mjs` (C1–C9, 18 testes).
- Atualizados para o médio: `estoqueP0MotorUnico`, `gestaoP3Estoque` (+ renomeações em `estoqueP1M5Concorrencia`, `estoqueP1MCenario`).
- `npm run verify:all`: ver o fim desta página.

## Pontos abertos para a PR 2 (D-PROD-257)

1. `aplicarEntradaEstoque` já aceita `origem.sistema = entrada_estoque` (D-PROD-177); a Entrada manual usa o mesmo caminho e a mesma regra do poço. A regra "custo zero só com motivo" é dela.
2. Reconciliação: a entrada documentada entra em `ORIGENS_PROTOCOLO` e no CTE do estorno junto com as tabelas (P7: só o motor cita `entrada_estoque`).
3. Edição/exclusão de entrada confirmada exige "nenhuma camada consumida" (D-PROD-177): com o custo médio, a prova continua sobre quantidade; vale revisar se a regra de "camada à frente da fila" ainda faz sentido (a ordem de baixa não afeta mais o custo).
4. A emenda da Constituição aqui proposta precisa estar ratificada antes de a PR 2 depender dela.
