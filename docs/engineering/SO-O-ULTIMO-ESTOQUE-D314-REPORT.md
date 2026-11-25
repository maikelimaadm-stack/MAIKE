# Relatório — Estoque: só o último sai (D-PROD-314)

**Data:** 2026-11-25 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-314](./DECISIONS.md) · **Migration:** nenhuma

## Pedido do proprietário

Na D-PROD-311 (lote e cocho), sobrou uma pergunta: cancelar uma transferência ou entrada de estoque cujo estoque já foi usado. Hoje o servidor deixava e recalculava o custo (D-PROD-273). Resposta do proprietário: **"não posso de forma alguma excluir registros posteriores que vincularam algo"**. A regra do lote vale também no depósito: só o mais recente sai.

## O que mudou

### Servidor

| Antes (D-PROD-273) | Agora (D-PROD-314) |
|---|---|
| Qualquer movimento podia sair com algo depois; o custo médio de tudo o que veio depois era recalculado | Com um registro depois que ainda vale, no mesmo produto e depósito (na transferência, origem ou destino): **409 `ESTOQUE_EXCLUSAO_REGISTRO_POSTERIOR`**, nada gravado |
| Abastecimento, atividade, venda e "camada intocada" saíam pelo estorno exato mesmo com algo depois | Também recusados |
| Pares excluídos pelo estorno exato continuavam na conta do recálculo | Saem da conta junto com o movimento e ficam marcados |

**Pontos do código**

- `estoqueFisico/movimentoPosterior.js`:
  - `buscarRegistroPosteriorValendo` acha o registro mais recente que ainda vale. Não contam:
    - o par já excluído com recálculo;
    - o original 'Estornada' com o estorno dele;
    - o estorno de um original 'Estornada'.
  - `recusaRegistroPosterior` monta a mensagem: "há registro lançado depois deste movimento no depósito X; exclua primeiro o mais recente (o lançamento no cocho nº 42 de 12/11/2026); nada foi alterado".
  - `buscarParesExcluidosDepois` acha os pares já excluídos pelo estorno exato que vêm depois.
- `estoqueRecalculo/estoqueExclusaoRecalculo.js`, `planejarExclusaoComRecalculo`: é por onde passam **todas** as exclusões e cancelamentos de estoque:
  - saída manual;
  - cocho;
  - linha de produto da atividade;
  - abastecimento;
  - venda e compra do financeiro;
  - entrada documentada;
  - ajuste de inventário;
  - transferência.

  O planejador recusa antes de qualquer escrita. Quando depois só há pares já excluídos, eles saem da simulação junto com o movimento, e `aplicarUm` marca esses pares fora da sequência. Sem isso, a saída de um par cancelado deixava um saldo negativo falso no meio da conta, e o registro anterior nunca mais saía. Os ajudantes de teste acharam esse caso; o exemplo é a cadeia A→B→C.
- `estoqueRecalculo/estoqueRecalculoService.js`, `previaExclusao`: a prévia dá a mesma recusa e tira os mesmos pares da simulação.
- `estoqueEntradas/entradaEstoqueService.js`, `provaDeCamadaIntocada`: a fatia guardada por um par já excluído com recálculo deixou de contar como consumo da camada. Isso vale tanto para `lotes_consumidos` quanto para as fatias `*ConsumoLote` de venda, abastecimento e atividade.
- A contagem de inventário posterior continua recusando antes, como na escolha de 2026-11-23.

### App

- `mensagemRecalculoDaExclusao` (`src/lib/gestaoErros.js`) traduz o código novo para todas as telas de exclusão: estoque, cocho, depósito, atividade e patrimônio. Exemplo: "Há registro lançado depois deste no depósito DEP 15. Exclua primeiro o mais recente: a transferência nº 42 de 12/11/2026. Nada foi alterado."
- O cancelamento do cocho passa os detalhes da recusa à mensagem, tanto no botão (elegibilidade) quanto na confirmação.

### Constituição

Nova emenda D-PROD-314 em `00-CONSTITUICAO.md` §1 e nota em `07-DO-NOT-DO.md`. Para movimento com registro posterior, ela substitui a "exclusão com recálculo" da emenda D-PROD-273. O "some das telas" e a trilha de auditoria continuam valendo.

## Testes

- **Servidor:** foram reescritos para a regra nova os testes que provavam o recálculo ou o estorno exato com algo depois. Em cada um, o caso com registro posterior dá 409 e não grava nada; depois de excluir do mais recente para o mais antigo, o original sai. Arquivos:
  - `estoqueExclusaoRecalculoSaidas`
  - `estoqueExclusaoRecalculoEntradas`
  - `estoqueRecalculoAjuste`
  - `estoqueRecalculoReplay`
  - `depositoCancelarTransferencia`
  - `suplementacaoCancelamentoCocho`
  - `estoqueAjustes`
  - `estoqueConsultaExcluidos`
  - `estoqueControleLote`
  - `estoqueControleLoteRevisao`
  - `estoqueSaidas`
  - `estoqueSaidasEdicao`
  - `estoqueEntradasEdicao`
  - `estoqueP0MotorUnico`
  - `gestaoP3Estoque`
  - `gestaoP3Lancamentos`
  - `patrimonioP1Abastecimentos`
  - `patrimonioP1AbastecimentosConcorrencia`
  - `atividadeAbastecimento`
  - `atividadeReforma`
  - `estoqueP0MotorConcorrencia` (o 409 é aceito só nos estornos, e as invariantes não mudam)
  - `patrimonioP1AbastecimentosMedidor`
  - `patrimonioP1AbastecimentosSeguranca`

  Nenhum teste foi pulado. Os casos que exigiam a ordem certa cobrem:
  - a cadeia A→B→C;
  - a entrada com a camada reavaliada;
  - a entrada depois de uma transferência cancelada.
- **App:** `tests/smoke/soOUltimoEstoque.test.js` (SE-01..04) e a suíte `test:smoke` completa.
- **Gates:** os 30 gates e `typecheck:backend`.
- **Local:**
  - Os 20 arquivos do estoque, rodados juntos: 272 de 272 passam.
  - O resto do backend passa, menos os 3 testes de `transporteNativo` e o RX1 de `estoqueP0ReconciliacaoR2`. Esses 4 falham neste ambiente local também sem a mudança.

## Para decisão do proprietário

1. **Edição da linha de produto da atividade** com movimento depois no depósito: continua como antes, com estorno exato da linha antiga e lançamento da nova, sem recalcular. A edição da entrada e da saída manual (D-PROD-271) já exigia "nada depois". A pergunta é se a edição da atividade deve seguir a mesma regra.
2. **Cancelar a atividade ou o apontamento** cancela os abastecimentos e as linhas ligados. Com a regra nova, isso é recusado se houver um abastecimento ou consumo posterior no mesmo tanque ou depósito. É a regra pedida, mas muda o dia a dia: para corrigir uma atividade antiga, é preciso excluir antes o que veio depois naquele depósito.

## Observações

- **Teste instável:** os testes de concorrência do cocho que usam `esperarNaFila` contam as travas do servidor PostgreSQL inteiro. Rodando suítes em paralelo, em bancos diferentes do mesmo servidor, eles podem falhar. No CI cada job tem o seu servidor. Fica sugerido filtrar por `pg_locks.database`, num trabalho à parte.
