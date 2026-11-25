# Relatório — saldo do formulário de Entrada/Saída do depósito (D-PROD-299)

**Data:** 2026-11-25 · **Branch:** `claude/nifty-feynman-rh0kdn`

## O que o proprietário viu

Testando com internet, na Entrada (e na Saída) do depósito o saldo do local aparecia enorme e
crescia a cada lançamento. O relatório de estoque mostrava o número certo.

## O que estava acontecendo

- Banco conferido (só leitura): os lotes batem com as movimentações (BARRACÃO 15.795 kg em 2 lotes;
  DEP. 15 / 15 A 495 kg em 2 lotes). Nada gravado estava errado.
- A API devolve os decimais (Prisma `Decimal`) como texto: `"15760"`, `"35"`.
- O formulário somava os lotes com `total + (lote.quantidade_disponivel || 0)`. Com texto, `+` cola:
  `0 + "15760" + "35"` = `"01576035"`, ou seja 1.576.035 kg.
- Com um lote por local o resultado saía certo. Cada transferência cria um lote no destino, então
  daí em diante cada lançamento novo "multiplicava" o saldo da tela.
- O relatório soma no servidor, por isso não tinha o problema.

## Correção

`disponivelDoLote(lote)` em `src/components/suplementacao/estoqueSuplementacaoUtils.jsx` converte
para número (inválido vale 0) e é usado em:

- `obterSaldoProdutoLocal` / `obterSaldoTransferivelProduto`: o saldo do formulário de Entrada/Saída
  do depósito e o saldo do lançamento do cocho;
- `calcularRateioFIFO`: saldo total, lotes com saldo e quantidade consumida de cada lote;
- `localEstoqueService`: a trava "local com saldo não pode ser excluído" também converte.

Sem migration, sem mudança no servidor.

## Testes

- `tests/smoke/saldoLotesDecimalTexto.test.js` — SD-01 (soma com texto), SD-02 (rateio FIFO com
  texto e saldo insuficiente), SD-03 (valor inválido vale 0).
- Smoke de depósito e cocho sem internet continuam passando.

## Em aberto

- "Não consigo ver o histórico dos lançamentos": o servidor tem todas as movimentações gravadas.
  A causa ainda não foi achada; falta saber de qual tela é o histórico e o que aparece nela.
