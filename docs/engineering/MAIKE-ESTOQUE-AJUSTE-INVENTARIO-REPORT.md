# MAIKE-ESTOQUE-AJUSTE-INVENTARIO — Relatório: ajuste de inventário no "Novo movimento" (D-PROD-269)

**Data:** 2026-11-20 · **Branch:** `claude/new-session-26kpxu` (a partir da `main` `46fe34f5`, com a `main` `3c8329b1` integrada) · **PR:** #350 · **Migration:** `20261120300000_estoque_ajustes` (**EXPAND**, 3 tabelas novas) · **Decisão:** [D-PROD-269](./DECISIONS.md) · **Runbook:** [`MAIKE-ESTOQUE-AJUSTE-INVENTARIO-RUNBOOK-RELEASE.md`](./MAIKE-ESTOQUE-AJUSTE-INVENTARIO-RUNBOOK-RELEASE.md)

## 1. Pedido e escolhas do proprietário

Próximo passo do Estoque: **ajuste de inventário**. Escolhas (2026-11-20):

| Pergunta | Escolha |
|---|---|
| Como se conta | Digita o **saldo contado**; o sistema mostra o saldo atual e lança a diferença |
| Custo da sobra | Custo médio do depósito; sem saldo, o custo informado na linha |
| Excluir | Sim, só se nada mexeu depois naqueles produtos e depósitos |
| Quem lança | Permissão própria `ajuste` |

Decidido pelo agente e dito ao proprietário: o ajuste vale **sempre para hoje** (sem data retroativa), porque a contagem é comparada com o saldo de agora.

Também a pedido do proprietário: a **edição completa de entrada e saída** vem logo depois, numa PR própria.

## 2. Como funciona

Por linha, o contado (KG, SACO pelo peso do saco, L) é comparado com o saldo do depósito, sob a trava do produto, na hora de gravar:

| Caso | O que acontece |
|---|---|
| Contado > saldo (**sobra**) | Entra a diferença pelo motor, com camada nova ao custo médio do depósito (ou ao custo informado, sem saldo) |
| Contado < saldo (**falta**) | Sai a diferença pelo motor, a custo médio |
| Igual (**sem diferença**) | Só o registro da contagem |

- A tela pede o saldo e o custo médio por `GET /estoque/ajustes/saldo` e mostra a diferença. O servidor recalcula ao gravar; vale a do servidor.
- Excluir estorna cada linha pelo motor, só sem movimento posterior (409 `AJUSTE_ESTOQUE_MOVIMENTO_POSTERIOR`). Editar: só a observação.
- O Kardex leva ao ajuste (`documento.tipo = AJUSTE_ESTOQUE`).

## 3. O que mudou

- **Backend:**
  - módulo `estoqueAjustes` (regras, serviço, rotas);
  - motor: origem `ajuste_estoque` e os invólucros da sobra, da falta e dos estornos, mais `pocoDoDeposito`;
  - reconciliação: explica a camada da sobra estornada; a regra de "saída legada sem recibo" passa a valer só para as origens antigas (suplementação e depósito);
  - consulta: o detalhe do movimento aponta o ajuste;
  - ação extra `ajuste`.
- **"Nada mexeu depois":** o ajuste usa o helper compartilhado da `main` (`buscarMovimentoPosteriorA`, D-PROD-268), o mesmo da saída manual, com o critério fail-closed da D-PROD-264. A mudança de critério que esta branch tinha feito na saída foi retirada no merge.
- **Tela:** tipo Ajuste no "Novo movimento" (por linha: produto, unidade, depósito, contado, saldo atual e diferença com sinal; custo só na sobra de depósito sem saldo; data fixa "Hoje"); detalhe do ajuste pelo Kardex e logo depois de lançar, com editar observação e excluir (motivo). Sem lista própria de ajustes, como na saída.

## 4. Constituição: emenda APROVADA

A constituição punha "ajuste ou inventário" explicitamente fora. O proprietário aprovou a emenda em 2026-11-20 ("Aprovo as duas", junto com o GO da migration); ela foi aplicada como parágrafo próprio em `00-CONSTITUICAO.md` §1 e nota própria em `07-DO-NOT-DO.md`, com o texto da D-PROD-269.

## 4a. Numeração e nome da pasta

Esta missão nasceu D-PROD-265, com a pasta `20261120200000_estoque_ajustes`. Antes do merge, a `main` deu a D-PROD-265 à Nova realização (PR #349), com a CONTRACT `20261120200000_apontamento_data_termino` no mesmo carimbo, já aplicada em produção. O preflight de produção acusou 72 migrations em vez de 71 (**RELEASE_BLOCKED**, nada aplicado). A decisão passou a D-PROD-266 e a pasta a `20261120300000_estoque_ajustes`, estritamente depois da dela; o conteúdo é o mesmo e o checksum não muda. Depois a `main` deu a D-PROD-266 à exclusão direta nos históricos do mapa (PR #351, sem migration), e esta decisão passou a D-PROD-267; depois a `main` deu a D-PROD-267 ao serviço de vários dias (PR #352, sem migration), e esta decisão passou a D-PROD-268; depois a `main` deu a D-PROD-268 ao estorno do cocho e da transferência (PR #353, sem migration), e esta decisão é a **D-PROD-269**.

## 5. Migration e ensaio

- **EXPAND puro** (`classificarMigrations`: ok, as 3 tabelas novas, nenhuma coluna em tabela antiga).
- SHA-256 `ac836ddf…6ccc9` e bloco RLS `4825a207…94fb8` pinados.
- `migrate diff` vazio.
- **Ensaio do envelope do caminho B** (PostgreSQL 17 local, base com as 72 migrations de produção, a última a data de término), refeito depois da renomeação:

  | Passo | Resultado |
  |---|---|
  | `system_identifier` de produção | recusou (`alvo divergente`), nada aplicado (72) |
  | `system_identifier` local | aplicou: 73 concluídas, 108 tabelas, checksum pinado |
  | 2ª execução | recusou (`migration já registrada`) |
  | `migrate status` | up to date |
  | `migrate diff --exit-code` | 0 |

- **Produção: NÃO aplicada.** Exige o GO escrito do proprietário.

## 6. Testes

| Arquivo | Resultado |
|---|---|
| `backend/tests/estoqueAjustes.test.mjs` (novo, Postgres real) | 12/12 |
| `estoqueSaidas` / `estoqueEntradas` / `estoqueConsulta` | 15 / 47 / 23, todos passaram |
| `estoqueP0Reconciliacao*`, `estoqueP0MotorUnico`, `estoqueP1M2MotorParametros` | todos passaram |
| provas da release (`test:gates`) e testes de migration | 1051/1051 · 54/54 (B40a/B40b/B40k novos) |
| smoke `estoqueNovoMovimento` (12 novos) · `tests/smoke` inteiro | 38/38 · 3791/3791 |
| `verify:all` em banco novo (72 migrations) | todas as etapas passaram (a de tipos do backend depois de ajustar o JSDoc de `exigirLocaisEstoque`) |

## 7. Fora de escopo

Inventário em etapas (rascunho), contagem cega, ajuste com data retroativa, edição da contagem lançada.
