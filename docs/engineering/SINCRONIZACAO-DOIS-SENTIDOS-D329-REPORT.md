# Relatório — sincronização automática nos dois sentidos, com o círculo (D-PROD-329)

**Data:** 2026-11-26 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-329](./DECISIONS.md)

## Pedido

"A sincronização tem que ser automática ao voltar, tanto sincronizando os dados do sistema para o apk e do apk para o sistema, tem que aparecer uma tela de progresso de porcentagem redondo."

Na escolha das opções, o proprietário ficou com o **círculo pequeno no canto**.

## Antes

- **Ao voltar a internet:** o app só enviava. A baixa só acontecia se a última tivesse mais de 6 h.
- **Progresso:** não havia. Só o aviso de texto e a barra dentro da janela, no "Sincronizar agora".

## Agora

| Quando | O que acontece |
|---|---|
| A internet volta | Envia e depois baixa, sempre. |
| Abriu ou voltou ao app | Envia e baixa, se a última baixa tem mais de 10 min. |
| App aberto | A cada 6 h. |
| Dados no formato antigo | Na hora. |
| "Sincronizar agora" | O mesmo, com o círculo. |
| No navegador | Nada automático. |

**O círculo no canto**, embaixo à direita:
- mostra a porcentagem: envio 0–25 %, mapa 25–55 %, cadastros 55–80 %, telas 80–100 %;
- a pessoa continua usando o app enquanto ele aparece;
- tocar abre a "Sincronização";
- no fim mostra ✓ (ou !, quando parte não veio) e some.

O aviso de texto não repete o envio quando o círculo está na tela.

## Arquivos

| Onde | Mudança |
|---|---|
| `src/services/sincronizacaoCompletaService.js` (novo) | `sincronizarNosDoisSentidos`, porcentagem por etapa, `deveSincronizarSozinho`. |
| `src/components/offline/CirculoDeSincronizacao.jsx` (novo) e `src/styles/mk-sincronia.css` | O círculo. |
| `src/App.jsx` | Monta o círculo junto com o aviso. |
| `src/components/offline/DadosOffline.jsx` | Gatilhos: internet voltou, abriu ou voltou ao app, relógio. A baixa passa por `sincronizarNosDoisSentidos`. |
| `src/components/offline/AvisoDeSincronizacao.jsx` | Sem aviso em dobro enquanto o círculo está na tela. |

## Verificação

- **Imagem a 390 px:** o círculo a 68 % no canto, acima do cartão do mapa, e o ✓ no fim.
- **`tests/smoke/sincronizacaoCompletaCirculo.test.jsx`, SC-01..05:**
  - porcentagem por etapa;
  - quando sincronizar sozinho;
  - envia antes de baixar, e a porcentagem só sobe até 100 e some;
  - sem internet não faz nada; um pedido durante outro devolve o mesmo;
  - o círculo mostra %, mostra ✓ e abre a janela.
- **`tests/smoke/sincronizacaoAutomaticaGatilhos.test.jsx`, SA-01..03:**
  - a internet voltou: sincroniza;
  - voltou ao app depois de 10 min: sincroniza;
  - no navegador: nada.
- Suíte `test:smoke` completa: 376 arquivos, 4515 testes, todos passaram; `gate:types` e gates passaram.
