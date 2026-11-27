# Relatório: sinal fraco (D-PROD-342)

**Data:** 2026-11-27 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-342](./DECISIONS.md)

## Pedido

"Pode continuar com os itens do servidor". São os dois itens que as D-PROD-337/338 deixaram para uma missão com mudança no servidor:

- a edição de cadastro feita com sinal fraco dava erro em vez de ir para a fila;
- a transferência do depósito que tentou subir com sinal fraco sumia do histórico.

## O que mudou

| Onde | Mudança |
|---|---|
| `backend/src/shared/sincronizacao/versaoDoRegistro.js` | `pedidoJaAplicado`: se o registro já está exatamente como a edição pede, não é conflito. A comparação segue o tipo gravado: texto exato, Decimal com as 4 casas da coluna, data como instante, jsonb com as chaves em ordem. O pedido vazio nunca conta. |
| `backend/src/modules/lotes/loteService.js` · `pontosSuplementacao/pontoSuplementacaoService.js` | Passam os campos pedidos para `exigirVersaoEsperada`. |
| `backend/src/modules/lancamentosTarefa/lancamentoTarefaService.js` | A mesma edição repetida (campos e fotos já na tarefa) não grava outra linha no histórico. |
| `src/lib/offline/offlineEntityRuntime.js` | Edição sem resposta vai para a fila com a versão vista. A recusa com resposta continua indo para a tela. O envio sem resposta marca o item como `ja_tentado`, e o que vem depois dele entra como item próprio. A exclusão que recebe "não existe" conta como feita. Nova opção `edicaoSemResposta`. |
| `src/apis/suplementacao-eventos/…NativePort.js` · `suplementacao-lotes/…NativePort.js` | `edicaoSemResposta: 'erro'`: o fechamento do período do cocho continua com o motor. |
| `src/services/historicoAguardandoEnvioService.js` | Com internet, a transferência e a baixa que tentaram subir pedem a confirmação na hora, no máximo uma vez a cada 20 s, e voltam com os ids reais. Sem internet, aparecem como aguardando. |

## Revisão

Uma auditoria independente do envio achou cinco problemas na primeira versão desta mudança, e todos foram corrigidos antes da PR:

| Problema | Correção |
|---|---|
| A mesma edição da tarefa, repetida, duplicava o histórico ("Conclusão" duas vezes) | Item 3 da decisão |
| O fechamento do período do cocho sem resposta ia para a fila de cadastros, fora da ordem do motor | Item 7 |
| A correção depois de uma edição sem resposta dava conflito consigo mesma | Item 5 |
| A transferência "confirmando" podia aparecer duas vezes no histórico | Item 4: não aparece com internet e é confirmada na hora |
| "07" contava igual a "7", e uma edição velha passava por cima de outra | Comparação pelo tipo gravado |

A mesma auditoria e uma segunda, do servidor, acharam também a edição somada a uma criação já tentada, que se perdia, e a exclusão repetida que ficava em "precisa de atenção". As duas foram corrigidas aqui (itens 5 e 6).

## Verificação

- `backend/tests/versaoDoRegistro.test.mjs`:
  - VR-07: a mesma edição repetida dá 200 (lote e cocho), e outra com a versão antiga dá 409;
  - VR-08: "01" contra "1" dá 409. Coordenadas com as chaves em outra ordem, e o número com mais casas que a coluna, contam como a mesma edição;
  - VR-09: a mesma edição da tarefa não repete o histórico, e o registro só de histórico grava sempre.
  - VR-08 e VR-09 falham no servidor antigo.
- `tests/smoke/sinalFracoD342.test.js`, SF-01 a SF-08. Os testes novos falham no código antigo:
  - SF-03: a transferência tentada não aparece duas vezes com internet, e a confirmação é pedida; sem internet, aparece;
  - SF-04: o fechamento do cocho continua recebendo o erro;
  - SF-05 e SF-06: a correção e a edição depois de um envio sem resposta vão como item próprio;
  - SF-07: a exclusão que recebe "não existe" conta como feita;
  - SF-08: o envio da fila sem resposta marca `ja_tentado`.
- `tests/smoke/envioSemPerdaSemDuplicar.test.js` IA-06, mudado de propósito. Antes esperava que a edição entrasse na criação que caiu. Agora espera o resultado: o registro editado, uma vez só. No código antigo a edição se perde (o servidor devolve "A").
- Testes do servidor relacionados (tarefa, fotos, lote, pontos, id do aparelho): todos passam.
- `test:smoke`: 4643 de 4643.
- `gate:types`: passa, sem aumento da dívida. Os outros gates e `typecheck:backend` também passam.

## O que ficou para as próximas fases

Estes já existiam e entram nas Fases 1 a 3 da sincronização:

- **Criações sem id do aparelho duplicam quando a resposta se perde:** setor, área, linha, ponto de referência e outros. As que têm nome único ficam em "precisa de atenção".
- **Só lote e cocho conferem a versão:** os outros cadastros seguem a regra "a última gravação vale", e a lista de fotos da tarefa vai inteira.
- **A exclusão não confere a versão.**
- **Muitas fotos de uma vez passam de 4 MB num envio só.**
- **Baixar:**
  - cada volta da internet baixa tudo de novo e segura a vez do envio;
  - o que foi criado na fila antiga não aparece no mapa sem internet;
  - a tela aberta não se atualiza ao terminar.
- **A fila de cadastros não guarda a pessoa que criou cada item.**
