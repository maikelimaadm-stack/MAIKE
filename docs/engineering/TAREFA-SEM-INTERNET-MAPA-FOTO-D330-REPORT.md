# Relatório — tarefa sem internet: no mapa, e a foto com o sinal fraco (D-PROD-330)

**Data:** 2026-11-26 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-330](./DECISIONS.md)

## Pedido

O proprietário testou sem internet:

- "A parte da imagem ainda de tarefa não funciona."
- "Quando eu lanço a tarefa, aparece na listagem mas não no mapa."

## Causas

| Problema | Causa |
|---|---|
| Não aparece no mapa | O mapa lê a cópia do servidor (`mapaCacheService`, chave `tarefas`), sem a fila de cadastros. A lista lê a porta da entidade, que inclui a fila. |
| A foto derruba a tarefa | O app só guardava a foto se `navigator.onLine` fosse falso. Com sinal fraco ou Wi-Fi sem dados, o celular "acha" que tem internet. O upload falhava sem resposta e a tarefa dava erro antes de ir para a fila. |

## O que mudou

| Onde | Mudança |
|---|---|
| `src/services/mapaCacheService.js` | Visão `tarefas`: aplica a fila de cadastros por cima da cópia, casando pelo id. A criação entra com "Pendente" e `_isOffline`. A alteração mistura. A exclusão tira. Recusado e outra fazenda não entram. Só tarefas abertas e com ponto. |
| `src/services/fotosDeTarefaAguardandoService.js` | `enviarOuSepararFotos`: uma foto que falha por falta de rede, e as seguintes, ficam guardadas. Recusa do servidor continua sendo erro. |
| `src/components/mapa/TarefasMapaPanel.jsx`, `DetalhesTarefaMapa.jsx` | Usam `enviarOuSepararFotos`. O aviso "as fotos ficaram no celular e sobem quando a internet firmar" aparece quando a tarefa subiu, mas a foto ficou guardada. |

## Testes

`tests/smoke/tarefaSemInternetMapaEFoto.test.js`:

- **TM-01:** a tarefa criada sem internet entra no mapa; sem ponto, não entra.
- **TM-02:** alteração e exclusão são aplicadas; recusada e outra fazenda ficam de fora.
- **TM-03:** com sinal fraco, a 1ª foto sobe e a 2ª e a 3ª ficam guardadas.
- **TM-04:** sem internet, nada é tentado; a recusa do servidor é erro.

`tests/smoke/tarefaFotoOfflineCaminhoTodo.test.jsx`, que faz o caminho inteiro com o armazenamento real do aparelho:

- **TF-OFF-01:** sem internet, tira a foto pela câmera e salva. Nada sobe para o servidor. Depois a galeria mostra "Aguardando envio", a foto abre em tela cheia e o ✕ a exclui.
- **TF-OFF-02:** com sinal fraco, a tarefa salva e a foto fica guardada.

## Verificação

- Suíte `test:smoke` completa: 377 arquivos, 4519 testes, todos passaram.
- `gate:types` passou.
