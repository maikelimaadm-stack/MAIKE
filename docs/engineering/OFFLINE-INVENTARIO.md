# Inventário: o que funciona sem internet (app)

Situação em 2026-11-24, depois da D-PROD-298 (corrigir sem internet: editar, excluir e cancelar). Atualizar
a cada manejo ligado ao motor.

## Funciona sem internet

| O quê | Como | Decisão |
|---|---|---|
| Abrir o app e continuar conectado | sessão lembrada + último contexto confirmado | D-PROD-294 |
| Mapa: áreas, lotes, setores, cochos, depósitos, bebedouros | cache do mapa + fundo local | D-PROD-294 |
| Satélite das regiões vistas com internet nas últimas 24 h | cache HTTP do aparelho (Google `max-age`) | D-PROD-294 |
| Consultar listas, detalhes, cadastros, estoque, histórico, tarefas | leituras guardadas (IndexedDB) + baixa na 1ª abertura | D-PROD-294 |
| Ver o que está esperando envio e o que precisa de atenção | janela "Dados sem internet" → Envio | D-PROD-295 |

## Grava sem internet e envia depois

### Motor de sincronização (D-PROD-295/296): código único, ordem, "precisa de atenção"

| Tipo | Tela | O que faz no aparelho enquanto espera |
|---|---|---|
| `cocho.leitura` | `FormularioLeituraCocho` | aparece no cocho com "aguardando envio"; excluir tira só do aparelho |
| `cocho.lancamento` (baixa + lançamento + fechamento do período anterior) | `FormularioLancamentoSuplementacao` | aparece como último lançamento do cocho; o período anterior aparece fechado; o saldo do depósito desconta a baixa |
| `deposito.transferencia` | `FormularioTransferenciaDeposito` | o saldo da origem desconta e o destino ganha o lote |

| `cocho.cancelamento` | `CancelarLancamentoCocho` (sem internet) | o lançamento some do cocho; o período que ele fechou reabre; o produto volta ao depósito |
| `deposito.cancelamento-transferencia` | `CancelarTransferenciaDeposito` (sem internet) | as duas pernas somem do histórico; o saldo volta |

Corrigir antes de subir (D-PROD-298): o lançamento do cocho e a transferência que esperam envio têm **Editar** e **Excluir** (no cocho, no depósito e na janela "Dados sem internet"); a leitura de cocho tem **Excluir**. Nada disso deixa rastro no banco.

### Fila antiga por entidade (`offlineEntityRuntime`)

Grava no aparelho sem internet e, desde a D-PROD-295, **é enviada** (antes
guardava e nunca enviava). Sem código único no servidor: se a resposta de uma
criação se perder, ela pode repetir. Cada entidade sai daqui quando passar para
o motor.

Entidades com criação, edição ou exclusão pela fila: aplicação de medicamento,
área de pastagem (criar/editar), tipo de atividade, bebedouro (e alertas,
histórico, sanidade), categoria, empresa, evento sanitário, fornecedor, leitura
de cocho (só as gravadas por versão anterior do app), local de estoque, lote (exclusão só com internet), manejo técnico do
rebanho, geografia do mapa, marca, medição de forragem, movimentação do mapa,
movimentação pecuária, permissão, ponto de suplementação, produto, setor
(criar/editar), evento e lote de suplementação, grupo de atividade, histórico e
lançamento de tarefa, tipo de tarefa, unidade de medida. Categoria de manejo:
criação só com internet. Lote de nota e movimentação de estoque: só edição.

## Precisa de internet

| O quê | Por quê |
|---|---|
| Entrada, saída e ajuste de estoque; motivos | gravação direta, sem fila |
| Manejos de gado por comando (movimentação, junção, baixa, rebanho) | comandos com `operation_id`, gravação direta |
| Exclusão de lote, de categoria de manejo e o que exige elegibilidade | só com confirmação do servidor |
| Números calculados pelo servidor (saldo, posição do rebanho depois de um manejo) | só atualizam com internet |
| Satélite de região nunca vista com internet | política do Google |
