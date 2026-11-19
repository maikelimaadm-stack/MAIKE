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

Outros pontos tocados: a prévia do lançamento financeiro simula as saídas seguintes do mesmo poço com a reavaliação (`operacaoFinanceiraPlano.js`); o detalhe da compra mostra o custo de aquisição (líquido ÷ kg) em vez do `custo_unitario` da camada, que agora é valor vigente (`operacaoFinanceiraService.js`); a linhagem da transferência na reconciliação (Q4) não compara mais o custo da camada de destino; textos da tela (Custo médio na consulta do abastecimento, Saldo, explicação do rateio). A elegibilidade de exclusão/retificação da compra (`provaDaCompra`) reconhece a reavaliação do motor: camada irmã com quantidade intacta, custo igual ao médio do poço e movimento posterior no mesmo produto × local deixa de ser `lote_alterado`; alteração SQL isolada do custo continua bloqueada.

## Cutover

Daqui para a frente. Movimentos, fatias e consumos já gravados não mudam; o saldo restante de cada produto × depósito é o poço de partida. O estorno de uma saída FIFO antiga devolve o valor FIFO gravado nela (C4 monta o estado pré-cutover no banco).

## O que roda no merge

**Nada no banco.** Sem DDL, sem reescrita de dados, sem entrada em `MIGRATIONS_CONTRACT_APROVADAS`, sem runbook. A reavaliação das camadas acontece dentro da transação do próximo movimento de cada poço. Esta sessão não executou nada em produção. O merge continua condicionado à aprovação do proprietário da **emenda constitucional proposta** (§1 do `00-CONSTITUICAO.md` e nota no `07-DO-NOT-DO.md`).

## Testes

- Novo: `backend/tests/estoqueCustoMedio.test.mjs` (C1–C9, 18 testes).
- Atualizados para o médio: `estoqueP0MotorUnico`, `gestaoP3Estoque` (+ renomeações em `estoqueP1M5Concorrencia`, `estoqueP1MCenario`).
- Também atualizados: `atividadeLinhaProduto`, `atividadeAbastecimento`, `atividadeIntegracaoTela`, `gestaoP3CustoLiquido`, `gestaoP3Lancamentos`, `gestaoP3UnidadeLitros` (o hash dourado mudou só em `modo_saida_fifo` das 2 saídas, conferido campo a campo contra a `main`), `patrimonioP1Abastecimentos*` (+ vetor `abastecimentoVetores.json`), `estoqueP0ReconciliacaoR2` (RV1: o custo da camada de destino deixou de ser divergência) e um smoke de tela.
- Local (2026-11-19): front-end `vitest` 298 arquivos / 3721 testes verdes; gates types, tenancy, indices, governance-paths, product-scope, import-integrity, no-secrets e base44 verdes; backend: os 72 arquivos de estoque/financeiro/abastecimento/patrimônio/atividade e 9 outros que tocam camadas, **rodados um a um com o banco recriado**, verdes, exceto `estoqueP0CorrecoesR2` C01 (falha local conhecida, passa na CI). Observação: rodar vários arquivos no mesmo banco local sujo faz falhas de limpeza em cascata (FK) sem relação com a mudança.

## Pontos abertos para a PR 2 (D-PROD-257)

1. `aplicarEntradaEstoque` já aceita `origem.sistema = entrada_estoque` (D-PROD-177); a Entrada manual usa o mesmo caminho e a mesma regra do poço. A regra "custo zero só com motivo" é dela.
2. Reconciliação: a entrada documentada entra em `ORIGENS_PROTOCOLO` e no CTE do estorno junto com as tabelas (P7: só o motor cita `entrada_estoque`).
3. Edição/exclusão de entrada confirmada exige "nenhuma camada consumida" (D-PROD-177): com o custo médio, a prova continua sobre quantidade; vale revisar se a regra de "camada à frente da fila" ainda faz sentido (a ordem de baixa não afeta mais o custo).
4. A emenda da Constituição aqui proposta precisa estar ratificada antes de a PR 2 depender dela.
