# MAIKE — Fatia 5 do Lançamento de Atividades: abastecimento ligado à atividade (relatório, D-PROD-211)

> **fatia:** 5 · **branch:** `feat/atividade-abastecimento` · **PR:** #300
> Decisão **D-PROD-211** (nasceu D-PROD-210; a `main` deu a D-PROD-210 à base do consumo da formulação, PR #297) ·
> contrato [`MAIKE-ATIVIDADE-ABASTECIMENTO-CONTRATO.md`](./MAIKE-ATIVIDADE-ABASTECIMENTO-CONTRATO.md) ·
> runbook [`MAIKE-ATIVIDADE-ABASTECIMENTO-RUNBOOK-RELEASE.md`](./MAIKE-ATIVIDADE-ABASTECIMENTO-RUNBOOK-RELEASE.md)

## 1. O que entra

| Área | Entrega |
|---|---|
| Banco | Migration CONTRACT `20261116300000_abastecimento_atividade` (SHA-256 `6dfc825cb908c28e903e66b25d16f2628db5da2cb50b9af73c6f1711b7faa436`): em `AbastecimentoBem`, 7 colunas (`origem`, `atividade_id`, `apontamento_id`, `centro_custo_id`, `medidor_leitura_anterior`, `medidor_delta`, `intervalo_confiavel`), local e movimento passam a aceitar nulo (só no `EXTERNO`), CHECK de status trocado, CHECKs de origem, vínculo e intervalo, 3 FKs, 3 índices; backfill do centro de custo pelo bem. Produção 61 → 62, 94 tabelas |
| Servidor | Origem `EXTERNO` (posto de estrada: sem estoque, valor da nota digitado, limite do custo); vínculo pelo `apontamento_id` com a atividade derivada (exige lançamento confirmado de atividade aberta); snapshots de centro de custo (atividade, senão bem) e da leitura anterior, delta e intervalo confiável; cascata: cancelar o lançamento ou a atividade cancela os ligados (estorno pelo mesmo motor); ligado a atividade concluída não se cancela; totalizador com combustível, custo de combustível/ha e consumo por bem (L/h, km/L); filtros `apontamento_id`, `atividade_id`, `origem` |
| Tela | Formulário com "Origem" (Estoque da fazenda / Posto externo) e "Valor total da nota (R$)"; aberto de um lançamento, mostra atividade e lançamento travados; consulta e tabela com os campos novos; bloco "Abastecimentos" dentro do lançamento; totalizador com combustível e consumo por bem |
| Ops | Scripts 01–04 do SQL Editor: o abastecimento sai antes do apontamento e da atividade |

Não muda: o motor FIFO (o mesmo), o cálculo do consumo do tanque cheio (D-PROD-162, o único do bem), o tipo de medidor
(vem do bem), o centro de custo (nunca digitado). Nada é apagado fisicamente.

## 2. Revisão independente

Sem bloqueio. Corrigidos: custo unitário do `EXTERNO` sem limite (500 → 422 na prévia e na confirmação) e travas de
Produto em duas rodadas na cascata (uma rodada só, ordenada; teste de concorrência reproduz o deadlock no código antigo).
Registrado como reforço futuro: FK composta amarrando o lançamento à atividade (hoje garantido pelo servidor) — feito
na D-PROD-216 ([`MAIKE-ABASTECIMENTO-FK-APONTAMENTO-REPORT.md`](./MAIKE-ABASTECIMENTO-FK-APONTAMENTO-REPORT.md)).

## 3. Validação local (GitHub Actions do proprietário pausado; os jobs que rodaram foram conferidos)

| Verificação | Resultado |
|---|---|
| `prisma migrate deploy` das 62 / `migrate diff --exit-code` | 62 / 0, sem drift |
| `abastecimentoAtividadeMigration` (runbook de ponta a ponta) | 13/13 |
| `atividadeAbastecimento` (servidor da fatia, com concorrência) | 15/15 |
| `scripts/tests/deploy` premerge-migrate / migrations / alvo-banco | 162/162 · 77/77 · 6/6 |
| suíte backend inteira (antes do merge da `main`) | 2211 testes: 2206 passaram, **0 falhas**, 5 `todo` |
| suíte backend inteira (depois do merge da `main`, 62 migrations) | 2216 testes: 2211 passaram, **0 falhas**, 5 `todo` |
| `verify-all --pular=test:backend` (depois do merge) | todas as etapas passaram (smoke, gates, tipos, lint, builds) |

## 4. Release

**Aplicada em produção em 2026-11-16** com o GO escrito do proprietário ("aplica"), pelo caminho B: preflight todo OK
(61/0, colunas novas ausentes, local/movimento ainda NOT NULL, CHECK antigo presente, 94 tabelas), envelope com a
migration integral (SHA `6dfc825c…`) e postcheck **APLICADA E CONFERIDA** (62/0, 7 colunas, 4 CHECKs, 3 FKs, 3
índices, backfill conferido, 94 tabelas). Registro no §9 do runbook. A `main` recebeu a PR #301 (D-PROD-212, sem
migration) antes do merge, trazida por merge.
