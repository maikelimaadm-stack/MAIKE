# Relatório — fila única da sincronização (D-PROD-328)

**Data:** 2026-11-26 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-328](./DECISIONS.md)

## Pedido

O proprietário pediu:
- "As filas de sincronização estão confusas demais."
- "Tem uma fila que não sai de jeito algum."
- "Nas filas, eu tenho que ver o que aconteceu e excluir ele ou tentar repetir o lançamento."

## Antes

| Fila | Na janela "Sincronização" | Preso sem saída |
|---|---|---|
| Motor (cochos, depósitos) | sim | "confirmando" (tentou, sem resposta): sem botão |
| Fila antiga (cadastros) | só os recusados; o resto era um número | exclusão retida, cadastro esperando |
| Fotos de tarefa guardadas | não | recusada pelo servidor: tentava sem fim, em silêncio |
| Tarefas do armazenamento antigo | não | recusada: tentava sem fim, em silêncio |

## Agora

Uma lista só (`lerFilaDeEnvio`). Para cada item:

- **o que é**: o rótulo leva o nome do registro, por exemplo "Alteração de bebedouro: BEBEDOURO 3";
- **quando** foi feito;
- **situação**:
  - aguardando envio;
  - enviado, esperando a confirmação do sistema;
  - esperando outro registro subir antes;
  - precisa de atenção;
- **motivo**, em palavras simples;
- **Ver detalhes**: situação, tentativas com erro, última tentativa, "o que aconteceu" e o conteúdo do registro, em linhas simples;
- **Excluir**: pede confirmação e avisa o que acontece. Por exemplo:
  - a criação leva junto as alterações e sai do celular;
  - a baixa de estoque já feita não é desfeita;
  - o registro pode já ter chegado ao sistema;
- **Tentar de novo**: envia já e tira a recusa. Só não aparece no retido pela regra da entidade.

A foto e a tarefa antiga param de tentar sozinhas depois de 3 falhas com resposta do servidor e passam a "precisa de atenção". Sem internet não conta.

## Arquivos

| Onde | Mudança |
|---|---|
| `src/services/sincronizacaoService.js` | A fila única (quatro origens), `detalhesDoConteudo`, e as ações por origem. |
| `src/components/offline/FilaDeEnvio.jsx` | A lista nova, com Ver detalhes, Excluir e Tentar de novo em todo item. |
| `src/lib/offline/offlineEntityRuntime.js` | `listarItensDaFilaDeEntidades`, `tentarDeNovoNaFilaDeEntidades`, `excluirDaFilaDeEntidades`. O último erro passa a ficar no item. |
| `src/lib/offline/sincronizacao/motorDeSincronizacao.js` | `descartarDaFila(id, { mesmoSemResposta })`. O resumo leva o conteúdo (`payload`). |
| `src/services/fotosDeTarefaAguardandoService.js` | Tentativas e motivo por foto, para depois de 3, `listarFotosAguardandoEnvio`, `tentarDeNovoFotosDaTarefa`. |
| `src/services/tarefasGuardadasNoAparelhoService.js` | Tentativas e motivo, para depois de 3, listar, tentar de novo e excluir. |

## Testes

- `tests/smoke/filaUnicaSincronizacao.test.js` (FU-01..05):
  - cadastro esperando aparece com o nome e o motivo;
  - excluir a criação leva as alterações;
  - o retido não tem "Tentar de novo";
  - "Tentar de novo" tira a recusa;
  - o detalhe sai em linhas simples.
- `tests/smoke/filaUnicaFotosETela.test.jsx` (FU-06..09):
  - foto recusada conta as tentativas, para em 3, tenta de novo e exclui;
  - tarefa antiga sem id;
  - registro "confirmando" do motor;
  - tela com os três botões e os detalhes.
- `tests/smoke/auditoriaSincronizacao.test.js` (AU-12): o rótulo agora leva o nome.
- Suíte `test:smoke` completa: 374 arquivos, 4506 testes, todos passaram; `gate:types` e gates passaram.
