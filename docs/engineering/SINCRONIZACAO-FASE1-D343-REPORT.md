# Relatório: sincronização, Fase 1, proteção (D-PROD-343)

**Data:** 2026-11-27 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-343](./DECISIONS.md)

## Pedido

O proprietário aprovou o plano de sincronização: "fazer as implementações para melhorar". Esta é a Fase 1, a proteção. Os itens vêm da auditoria do lado da baixa, que reproduziu cada defeito com um teste temporário.

## O que mudou

| Defeito (auditoria) | Onde | Agora |
|---|---|---|
| O cocho, a área, o ponto e a linha feitos sem internet não apareciam no mapa | `src/services/mapaCacheService.js` (`comFilaDaEntidade`) | A fila de cadastros é aplicada na leitura da cópia do mapa, como nas tarefas |
| Cada volta da internet baixava tudo de novo | `src/services/sincronizacaoCompletaService.js` (`deveSincronizarSozinho`) | Baixa de novo só se a última baixa tem mais de 3 min; o envio continua imediato |
| A baixa segurava a vez do envio por minutos | `src/services/dadosOfflineService.js` | A vez é tomada por parte (mapa, cadastros, telas) |
| "Baixado" sem ter vindo; o lote excluído continuava no celular; minutos de espera no Wi-Fi sem dados | `src/apis/offline/offlineApi.js` · `src/lib/offline/respostasOffline.js` (`esquecerResposta`) | 5xx e 401 contam como falha; o 404 tira a cópia; para depois de 6 faltas de rede seguidas |
| A resposta lenta apagava a mais nova | `src/lib/offline/respostasOffline.js` (`guardarResposta`) | Fica a do pedido mais recente |
| A tela aberta não mudava depois de "Tudo sincronizado" | `src/services/sincronizacaoCompletaService.js` | O mapa relê a cópia nova; as outras telas releem |
| O sistema podia apagar os dados do app com o celular cheio | `src/lib/offline/armazenamentoPersistente.js` (novo) · `src/main.jsx` | `navigator.storage.persist()` ao abrir |

## Verificação

- `tests/smoke/sincronizacaoFase1D343.test.js`, F1-01 a F1-07:
  - mapa com a fila;
  - a baixa das telas: falha honesta, 404 e parada;
  - a resposta mais nova fica;
  - a vez por parte;
  - as telas se atualizam;
  - armazenamento protegido.
  - F1-01 a F1-06 falham no código antigo e passam no novo. F1-07 testa o módulo novo.
- `tests/smoke/sincronizacaoCompletaCirculo.test.jsx` SC-02, mudado de propósito: a volta da internet com a última baixa de 1 min atrás não baixa mais; com 4 min, baixa.
- `tests/smoke/sincronizacaoAutomaticaGatilhos.test.jsx` SA-01, mudado de propósito pela mesma regra.
- `test:smoke`: 4650 de 4650.
- Gates e `gate:types` passam, sem aumento da dívida.

## O que ficou para depois

- **Dono por pessoa na fila de cadastros, a decidir com o proprietário.** Pular os itens de outra pessoa faria o registro dela esperar até ela entrar de novo. Hoje eles sobem com a conta de quem está no celular.
- **O servidor recusar o app desatualizado:** junto da Fase 4, com APK novo.
- **Também da auditoria da baixa:**
  - a cópia do mapa guarda a lista com a fila já aplicada (M8): o "Descartar" deixa sobra até a próxima baixa;
  - a corrida da cópia dos cadastros (M2);
  - o mapa só da fazenda selecionada (H5);
  - a troca de pessoa no mesmo celular mantém as cópias do mapa e dos cadastros (M6).
- **Fases 2 e 3:** versão em todos os cadastros, e baixar só o que mudou.
