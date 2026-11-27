# Relatório: sem internet, Grupo 2 (D-PROD-337)

**Data:** 2026-11-26 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-337](./DECISIONS.md)

## Pedido

"Continue corrigindo bugs". Este é o Grupo 2 da varredura sem internet ([relatório do Grupo 1](./SEM-INTERNET-GRUPO1-D335-REPORT.md)): as travas e os avisos que enganavam a pessoa no campo.

## O que mudou

| Defeito | Onde | Agora |
|---|---|---|
| "Enviar agora" esperava até 10 min depois de falhas de rede | `motorDeSincronizacao.js` (`liberarEsperaDeRede`, `ESPERA_MAXIMA_MS`), `gatilhosDeSincronizacao.js`, `sincronizacaoService.js`, `sincronizacaoCompletaService.js` | A falha de rede fica marcada. A volta da rede, a volta ao app, a abertura do app e "Enviar agora" liberam a espera. O erro do servidor continua esperando. Uma espera impossível (relógio que voltou) não segura o item. |
| "Tudo sincronizado" com registros parados | `sincronizacaoCompletaService.js` | Mostra "N registros ficaram no celular". |
| Leitura recusada travando os lançamentos do cocho | `motorDeSincronizacao.js` (`parar`, `temQueEsperar`) | O tipo `independente` não disputa o recurso. |
| Edição recusada aparecendo como salva | `offlineEntityRuntime.js` (`aplicarPendentes`) | A recusada não é aplicada nas listas. |
| Tarefa da fazenda A no mapa da fazenda B | `offlineEntityRuntime.js` (`listarItensDaFilaDeEntidades` com `empresaId`), `mapaCacheService.js` | O mapa usa só a fila da fazenda selecionada. |
| "Excluir" deixava o pino e as fotos da tarefa | `sincronizacaoService.js` (`descartarRegistroNaoEnviado`), `gatilhosDeSincronizacao.js` | As fotos saem junto, o mapa relê, e relê também quando os cadastros chegam ao servidor. |
| Sessão vencida em silêncio | `motorDeSincronizacao.js` | O item diz o motivo na janela Sincronização. |

## Verificação

- `tests/smoke/semInternetGrupo2D337.test.js`, G2-01 a G2-07:
  - espera de rede liberada, e a do servidor mantida;
  - relógio que voltou;
  - leitura parada não trava o cocho;
  - edição recusada fora da lista;
  - fila por fazenda no mapa;
  - sessão vencida com motivo;
  - "Excluir" com fotos e mapa.
- `tests/smoke/sincronizacaoCompletaCirculo.test.jsx` SC-06: "N registros ficaram no celular", nunca "Tudo sincronizado".
- Todos os testes novos falham no código antigo e passam no novo.
- `test:smoke`: 4634 de 4634.
- `gate:types`: passa, sem aumento da dívida.

## O que ficou para depois

- **Pedem mudança no servidor:**
  - a transferência do depósito que tentou subir com sinal fraco ainda some do histórico, porque a movimentação de estoque não guarda o código da operação;
  - a edição de cadastro com sinal fraco ainda dá erro, porque o PATCH precisa reconhecer o pedido repetido para a versão não acusar um conflito falso.
- **Grupo 3 (limites):** muitas fotos por tarefa, fotos HEIC ou sem tipo, troca de fazenda sem internet, relógio do celular na fila de cadastros, armazenamento cheio, tarefa duplicada quando guardar a foto falha, e cópias de leitura entre usuários.
- **GPS, a varrer:**
  - "Usar minha localização" aceita uma leitura de baixa precisão;
  - a primeira leitura sempre entra.
