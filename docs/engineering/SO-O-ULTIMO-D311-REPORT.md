# Relatório — Só o último da sequência e revisão geral de lote, nutrição e depósito (D-PROD-311)

**Data:** 2026-11-25 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-311](./DECISIONS.md)

## Pedido

> "Eu lancei um suplemento no cocho e depois lancei outro no mesmo cocho. E aí eu excluí o primeiro… ao sincronizar ele não deixou, porque o lançamento dependia do outro. A gente vai ter que ajustar a mesma regra de não poder excluir registro anterior, sempre o atual… [no lote] está permitindo excluir movimentações e não pode, se tiver registro posterior vinculado ao lote todo… Quero que você dê uma olhada geral em lotes, interligação de nutrição, depósito etc."

Na movimentação do lote, a regra escolhida pelo proprietário vale para **origem e destino**.

## Como foi feita

- **Revisão:** três agentes revisaram o código em paralelo, só lendo:
  1. movimentação e exclusão do lote;
  2. nutrição e cocho;
  3. depósito e estoque.
- **Correções:** cada defeito corrigido ganhou teste.

## Corrigido

| # | Área | Defeito | Correção | Teste |
|---|---|---|---|---|
| 1 | Cocho, sem internet | Excluir o 1º lançamento com o 2º na fila deixava o 2º órfão | A fila recusa excluir ou editar quem tem posterior dependente; a tela diz qual excluir antes | MS-10, MS-26, LCO-12 |
| 2 | Lote | Movimentação excluída com nutrição (ou outra movimentação, pesagem, sanidade) lançada DEPOIS na origem ou no destino | Servidor: nada posterior em nenhuma posição tocada (`REBANHO_EXCLUSAO_REGISTRO_POSTERIOR`) | EX-C, CERT-3/4/5/9 |
| 3 | Lote, sem internet | Nutrição feita sem internet não bloqueava excluir a movimentação | A exclusão fica bloqueada enquanto há nutrição da fazenda aguardando envio | NL-01 |
| 4 | Depósito, sem internet | Transferência editável ou excluível com lançamento posterior dependendo do estoque dela | A mesma regra da fila (recurso `estoque:`) | MS-10b |
| 5 | Depósito, sem internet | Excluir sem internet uma transferência do servidor não conferia nada | Confere o que aguarda envio no mesmo estoque e o histórico guardado no aparelho | TR-01, TR-02 |
| 6 | Cocho e depósito | `parseNumber` apagava o ponto: 12.5 → 125, 12.00 → 1200 (transferência, "aproveitar sobra", troca kg↔sacos) | O ponto só é milhar com vírgula decimal | NU-01 |
| 7 | Depósito, sem internet | O saldo inventava estoque (o destino recebia tudo mesmo sem a origem ter) | O destino recebe só o que saiu | ES-01 |
| 8 | Depósito e cocho | Cancelamento recusado escondia o original no histórico, enquanto o saldo o mostrava | O recusado não vale na visão | CA-01 |
| 9 | Cocho | Excluir pela tela um lançamento recusado com a baixa já feita deixava a baixa sem lançamento | Recusa e orienta para "Tentar de novo" ou Sincronização | — |

## Para decisão do proprietário

**Cancelar transferência ou entrada cujo estoque já foi usado.**
- Hoje o servidor aceita: em produto sem controle de lote, recalcula o custo e reatribui o consumo a outra camada.
- Isso foi aprovado na D-PROD-273 ("fatia 5"), mas contradiz a regra de agora, de que nada depois pode depender.
- Para aplicar a regra nova: recusar com 409 quando a camada que sai já foi consumida, também no recálculo.

## Achados para as próximas missões (não corrigidos aqui)

| Achado | Gravidade | Proposta |
|---|---|---|
| Lançamento órfão de versões anteriores (`REFERENCIA_DESCARTADA`): "Tentar de novo" mantém a referência | Médio | Religar ao último lançamento ativo do servidor, como em `LANCAMENTO_DESATUALIZADO` |
| Cancelamento na fila pode deixar um período antigo aberto | Médio | Reabrir na visão pelo antecessor, ou o envio do seguinte reconferir no servidor |
| Rateio de lotes calculado no formulário (o lote movido ou excluído antes do envio) | Médio | Recalcular no "Tentar de novo" ou conferir antes da baixa |
| A falha de rede tira o efeito da visão (`tentado`) | Médio | Etapa 4 (política única de visão) |
| O servidor não confere a ordem de datas do lançamento do cocho | Baixo/médio | Recusar data anterior ao último ativo |
| PATCH reabre qualquer período | Baixo | Só o último fechado |
| Lançamento automático de sobra sem recibo não é cancelável | Baixo | Criar com recibo |
| Histórico do depósito ignora o cancelamento do cocho na fila | Baixo | Etapa 4 |
| Histórico do cocho ordena só por criação | Baixo | Ordenar pela data do lançamento |
| A visão do saldo sem internet usa FIFO; o servidor usa FEFO ou a escolha | Baixo | Total igual; por lote pode diferir |
| Empresa do `SuplementacaoLote` vem do corpo | Baixo | Conferir pela posição ao gravar |

## Verificação

- **Backend:** passam, contra PostgreSQL 16 local, `exclusaoMovimentacaoLedger` (29), `certificacaoManejosExclusoes` (15), `r2eR1ManejosLedger`, `r2eR2Fechamento`, `r2eR3IntegridadeFatos`, `r2eR5*`, `r2eR6CutoverAtomicoVinculos`, `movimentacaoCancelamentoR2A`, `loteExclusaoCancelados` e `suplementacaoCancelamentoCocho`. Duas falhas locais já existiam antes desta mudança, idênticas com e sem ela (datas futuras em relação ao relógio do ambiente): `r2eP1LedgerRebanho` V1 e uma de `suplementacaoCancelamentoCochoVinculos`. O CI é a referência.
- **App:** a suíte `test:smoke` completa e `tests/smoke/soOUltimoDaSequencia.test.js`.
- **Gates:** os 30 gates do projeto e `typecheck:backend`.
- **Banco:** sem migration.
