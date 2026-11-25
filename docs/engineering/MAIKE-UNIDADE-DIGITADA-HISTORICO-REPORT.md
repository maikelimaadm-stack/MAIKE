# MAIKE — A unidade digitada na lista de movimentos e no histórico do depósito: relatório (D-PROD-313)

**Data:** 2026-11-25 · **Decisão:** [D-PROD-313](./DECISIONS.md) · **Branch:** `claude/unidade-digitada-historico` ·
**Migration:** nenhuma · **Constituição:** sem mudança

## Pedido

A D-PROD-310 deixou registrada uma pendência, e o proprietário pediu que ela fosse feita ("pode ser"). Quando a
quantidade foi digitada numa unidade de conversão (3 SC de 25 kg), as telas de consulta precisam mostrar isso, e não só
os 75 kg.

## O que havia

- **Histórico do depósito no mapa:** a lista `GET /movimentacoes-estoque` (que vai para o cache do mapa) já trazia
  `unidade_lancamento`, `quantidade_lancamento` e `fator_lancamento`, porque o serializador devolve todas as colunas. A
  tela não mostrava esses campos. O que ainda espera envio vinha num formato fixo, sem eles.
- **Grade de Movimentos do Estoque:** `GET /estoque/movimentos` (lista e detalhe) usa uma lista fechada de campos
  (`comoMovimentoResumo` e `COLUNAS_RESUMO`). As três colunas não chegavam ao app.

## Mudança

**Servidor** (`backend/src/modules/estoqueConsulta/estoqueConsultaService.js`)
- `COLUNAS_RESUMO` lê as três colunas.
- `comoMovimentoResumo` as devolve por `unidadePublica`: texto canônico de 4 casas, ou nulas sem conversão. É a mesma
  função da linha da atividade.
- O detalhe herda o resumo e também passa a trazer os três campos.

**App**
- `textoDaUnidadeDigitada(r)` (`src/lib/unidadeLancamentoRegras.js`) devolve "3 SC" ou "2,5 CX", ou '' quando não
  houve conversão.
- `quantidadeComDigitada(m)` (`src/lib/estoqueConsultaRegras.js`) devolve "− 75 kg (3 SC)". A grade de Movimentos usa
  essa função, e a exportação sai igual.
- A janela do movimento ganhou a linha "Digitado como" (`movimento-digitado`).
- Histórico do depósito no mapa:
  - "Digitado como: 3 SC" vem logo depois da unidade (`HistoricoDepositoSuplementacao`).
  - No cartão curto do detalhe do depósito, "3 SC" fica no lugar dos sacos calculados pelo peso do cadastro
    (`DetalhesDepositoSuplementacao`).
- O que espera envio guarda a unidade e a quantidade digitada (`historicoAguardandoEnvioService`).
- A quantidade que vale continua sendo a da unidade de estoque. Sem conversão, nenhuma tela muda.

## Testes

| Onde | O quê |
|---|---|
| `backend/tests/estoqueConsulta.test.mjs` | lista e detalhe trazem `SC`, `3.0000` e `25.0000`; sem conversão vêm nulos. Falha sem a mudança no servidor (23/24) e passa com ela (24/24) |
| `tests/smoke/unidadeDigitadaHistorico.test.js` (novo) | o texto da digitada, inclusive os casos sem dado, e a grade com e sem conversão |
| `tests/smoke/estoqueTela.test.jsx` | a grade mostra "− 300 kg (12 SC)", a janela "Digitado como: 12 SC", e o movimento sem conversão não tem a linha |
| `tests/smoke/historicosMapaEstiloManejo.test.jsx` | o cartão do histórico do depósito mostra "Digitado como: 3 SC" |
| `tests/smoke/detalhesV12Deposito.test.jsx` | o cartão curto mostra "16 SC" e "Saíram 400,00 kg, 16 SC" |
| `tests/smoke/depositoTransferenciaOffline.test.js` (ET-09) | as duas pernas da transferência que espera envio trazem `SACO` e `2`; a transferência sem unidade traz nulos |

## Fora

- A linha de produto da atividade já mostrava a unidade digitada na edição (D-PROD-310).
- Nas outras telas da atividade, nada muda.
