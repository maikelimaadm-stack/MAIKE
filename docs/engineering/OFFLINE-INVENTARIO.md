# Inventário: o que funciona sem internet (app)

Situação em 2026-11-24, depois da D-PROD-295 (motor de sincronização). Atualizar
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

### Motor de sincronização (D-PROD-295): código único, ordem, "precisa de atenção"

Nenhum manejo ligado ainda. Próximos, nesta ordem (pedido do proprietário):

| Tipo previsto | Tela | Servidor já deduplica? |
|---|---|---|
| `cocho.lancamento` (baixa do depósito + lançamento + fechamento do período anterior) | `FormularioLancamentoSuplementacao` | sim: `saida-suplementacao` e `lancamento-com-lotes` levam `operation_id`; o fechamento (PATCH do evento e dos lotes) ainda não é comando |
| `cocho.leitura` | `FormularioLeituraCocho` | **não**: `POST /leituras-cocho` sem `operation_id` |
| `cocho.cancelamento` | `CancelarLancamentoCocho` | sim |
| `deposito.transferencia` | `FormularioTransferenciaDeposito` | sim (`transferencia-entre-locais`) |
| `deposito.cancelamento-transferencia` | `CancelarTransferenciaDeposito` | sim |

### Fila antiga por entidade (`offlineEntityRuntime`)

Grava no aparelho sem internet e, desde a D-PROD-295, **é enviada** (antes
guardava e nunca enviava). Sem código único no servidor: se a resposta de uma
criação se perder, ela pode repetir. Cada entidade sai daqui quando passar para
o motor.

Entidades com criação, edição ou exclusão pela fila: aplicação de medicamento,
área de pastagem (criar/editar), tipo de atividade, bebedouro (e alertas,
histórico, sanidade), categoria, empresa, evento sanitário, fornecedor, leitura
de cocho, local de estoque, lote (exclusão só com internet), manejo técnico do
rebanho, geografia do mapa, marca, medição de forragem, movimentação do mapa,
movimentação pecuária, permissão, ponto de suplementação, produto, setor
(criar/editar), evento e lote de suplementação, grupo de atividade, histórico e
lançamento de tarefa, tipo de tarefa, unidade de medida. Categoria de manejo:
criação só com internet. Lote de nota e movimentação de estoque: só edição.

## Precisa de internet

| O quê | Por quê |
|---|---|
| Lançamento de suplementação no cocho | comando com baixa de estoque; `exigirConexaoParaComando` (vai para o motor) |
| Transferência entre depósitos e cancelamentos | idem (vai para o motor) |
| Entrada, saída e ajuste de estoque; motivos | gravação direta, sem fila |
| Manejos de gado por comando (movimentação, junção, baixa, rebanho) | comandos com `operation_id`, gravação direta |
| Exclusão de lote, de categoria de manejo e o que exige elegibilidade | só com confirmação do servidor |
| Números calculados pelo servidor (saldo, posição do rebanho depois de um manejo) | só atualizam com internet |
| Satélite de região nunca vista com internet | política do Google |
