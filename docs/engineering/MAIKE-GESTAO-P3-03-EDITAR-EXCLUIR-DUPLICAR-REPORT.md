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
(preenchido ao fim da rodada)

## 3. Provas
(preenchido ao fim da rodada)

## 4. Revisão adversarial
(preenchido ao fim da rodada)

## 5. Gate final
(preenchido com o `verify:all` e o CI do HEAD final)

## 6. Limitações e riscos declarados
(preenchido ao fim da rodada)

## 7. Prontidão
| Critério | Estado |
|---|---|
| CODE_READY | ver §5 |
| SCHEMA_APPLIED_PROD | **NÃO** |
| MERGE_READY | **NÃO**: antes, GO específico, migration aplicada e conferida pelo runbook, e CI verde |
