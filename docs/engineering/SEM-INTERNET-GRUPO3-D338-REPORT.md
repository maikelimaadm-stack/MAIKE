# Relatório: sem internet, Grupo 3 (D-PROD-338)

**Data:** 2026-11-27 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-338](./DECISIONS.md)

## Pedido

"Vamos continuar nas partes de offline, de ajuste, de bug, correções de bug". Este é o Grupo 3 da varredura sem internet: os limites. Os grupos anteriores estão em [Grupo 1](./SEM-INTERNET-GRUPO1-D335-REPORT.md) e [Grupo 2](./SEM-INTERNET-GRUPO2-D337-REPORT.md).

## O que mudou

| Defeito | Onde | Agora |
|---|---|---|
| Relógio do celular voltando: o lote subia antes da área que ele cita | `offlineEntityRuntime.js` (`naOrdemDeEntrada`) | A fila anda pela chave do armazenamento (a ordem de entrada) |
| Armazenamento cheio: o registro aparecia como salvo sem estar na fila | `offlineEntityRuntime.js` (criação e edição sem internet) | A fila é gravada antes da cópia; na edição, a cópia volta ao valor de antes; a tela recebe o erro |
| Guardar a foto falhava depois de a tarefa ser criada, e salvar de novo duplicava a tarefa | `fotosDeTarefaAguardandoService.js`, `TarefasMapaPanel.jsx`, `DetalhesTarefaMapa.jsx` | Guardar a foto não lança mais. As que não couberam viram aviso, e a tarefa fica salva |
| Foto HEIC ou sem tipo recusada pelo servidor; muitas fotos passavam de 4 MB | `src/lib/imagens/fotosDaTarefa.js` (novo), `FormularioTarefaMapa.jsx`, `useFotosGuardadasDaTarefa.js` | A foto é conferida e reduzida na escolha, e a soma das fotos não passa de 3,5 MB por tarefa. As miniaturas são liberadas ao sair do formulário |
| Outra pessoa via, sem internet, as cópias de leitura da anterior | `sessionService.js` (`entrarComSessaoNativa`, `trocarDonoDasCopias`) | Ao entrar outra pessoa, as cópias do cliente saem |
| Trocar de fazenda sem internet deixava os cadastros vazios | `offlineEntityRuntime.js` (`daCopiaDeOutraFazenda`) | A lista usa, das cópias das outras fazendas, os registros da fazenda selecionada |

## Verificação

- `tests/smoke/semInternetGrupo3D338.test.js`, G3-01 a G3-07: ordem de entrada, armazenamento cheio na criação e na edição, foto que não cabe, conferência e soma das fotos, cópias entre usuários e troca de fazenda.
  - Os testes de comportamento falham no código antigo e passam no novo.
  - O G3-05 testa o módulo novo `fotosDaTarefa.js`.
- `tests/smoke/offlineMapaDeIdsEntrePassadas.test.js` (c): a montagem da fila agora segue a ordem de entrada. O que o teste confere não mudou.
- `test:smoke`: 4641 de 4641.
- `gate:types`: passa, sem aumento da dívida.

## O que ficou para depois

- **Pedem mudança no servidor:**
  - a transferência do depósito que tentou subir com sinal fraco ainda some do histórico;
  - a edição de cadastro com sinal fraco ainda dá erro em vez de ir para a fila.
- **Defeitos relatados pelo proprietário, em investigação:**
  - o "+" da aba Pontos abre o cadastro e volta;
  - fechar o cadastro do mapa trava a tela.
- **GPS:**
  - "Usar minha localização" aceita uma leitura de baixa precisão;
  - a primeira leitura sempre entra.
