# MAIKE — Teste de volume do cancelamento em lote: margem por direção (relatório)

**Data:** 2026-11-25 · **Escopo:** só o teste `backend/tests/gestaoP3Rodada2.test.mjs` (R7 — CRITICO-2, "volume: 200 itens") ·
**Código de produção:** sem mudança · **Migration:** nenhuma

## Problema

O teste mede o tempo de confirmar e de cancelar um documento de 200 itens, nas duas direções, e exigia sempre que o
cancelamento custasse menos da metade da confirmação. A `main` ficou vermelha com o código igual ao da última rodada
verde: a #398 e a #400 não mexeram no backend. Três rodadas seguidas falharam só na compra (PAGAR):

| Rodada | Compra: confirmar | Compra: cancelar | Proporção |
|---|---|---|---|
| #399 (`76ebe315`) | 921 ms | 501 ms | 0,54 |
| `main` `51bdd26c` | 856 ms | 468 ms | 0,55 |
| #401 (`3f7267a9`) | 911 ms | 483 ms | 0,53 |

Nas rodadas verdes da `main` (9 rodadas, de `789a23b0` a `4d90d4df`), a compra já ficava entre **0,41 e 0,49**, sempre
perto do limite. A venda (RECEBER) ficava em ~0,20.

## Causa

Na compra, confirmar não reparte lotes (só cria a camada de cada item) e já é barato. A proporção natural entre cancelar
e confirmar fica perto de 0,5 e varia com a máquina do runner. A regra "menos da metade" foi pensada para a venda, onde
confirmar reparte 600 lotes; ali o cancelamento item a item nunca terminava.

## Mudança

- **Venda (RECEBER):** continua "cancelar × 2 < confirmar".
- **Compra (PAGAR):** passa a "cancelar < confirmar".
- O laço antigo continua reprovado nas duas direções. Medição local com 200 itens de compra (3 vezes):
  - laço item a item do oráculo do próprio arquivo (`estornarItemAItem`): ~3.550 ms contra ~2.250 ms de confirmar
    (1,57 vez);
  - cancelamento em lote: 960 ms contra 2.499 ms (0,38).
- Nenhum teste foi pulado ou desligado. A equivalência com o laço item a item (lotes, movimentos, saldos, itens e
  fatias) continua igual.
