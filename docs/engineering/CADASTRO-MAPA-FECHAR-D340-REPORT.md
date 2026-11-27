# Relatório: fechar o cadastro do mapa não derruba o app (D-PROD-340)

**Data:** 2026-11-27 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-340](./DECISIONS.md)

## Pedido

O proprietário relatou dois defeitos, na web e no app:
- "Quando eu clico em cadastrar ponto … leva para o mapa de cadastro e depois volta."
- "Quando eu abro o mapa, eu vou fechar de cadastro … ele trava tudo."

## Como foi reproduzido

Os dois foram reproduzidos num navegador real (Playwright, Chromium e SwiftShader), com o Layout, o `AppRouteContent` e as páginas carregadas sob demanda. Os resultados ao fechar o editor:

| Cenário ao fechar o editor | Antes |
|---|---|
| Área nova | `#root` vazio (tela branca) e erro `Cannot read properties of undefined (reading 'getSource')` |
| Linha nova | `#root` vazio |
| Ponto marcado ("+", toque no mapa, "Fechar editor") | `#root` vazio; o toque seguinte não responde |
| Ponto vazio, ou formulário cancelado ou salvo | OK |

**Causa da tela branca:**
- Em `MapaDesenho.jsx`, o efeito que cria o mapa é declarado antes dos efeitos do cursor e do arrasto.
- Ao desmontar, o React roda as limpezas nessa mesma ordem. Assim, `map.remove()` acontecia primeiro e só depois as limpezas chamavam `setSourceData`, que lançava ao chamar `map.getSource`.
- Sem ErrorBoundary, o React desmontava o app inteiro.
- No caso da área e da linha, o defeito já existia antes da D-PROD-333. No caso do ponto, ficou alcançável com ela, porque o toque passou a só marcar o ponto.

**O "vai e volta" do "+":** não houve uma navegação de volta. O que a pessoa via era a soma de três coisas:
- **O "+" ficava por baixo da coluna da direita.** No centro dele, `elementFromPoint` devolvia "Atualizar mapa", e só uma faixa de 14 px abria o cadastro.
- **A lista do cadastro aparecia por um instante** na ida (antes do editor) e na volta.
- **Fechar o editor com o ponto marcado causava a tela branca** descrita acima.

## O que mudou

| Onde | Mudança |
|---|---|
| `src/lib/maplibre/lifecycle.js` (`setSourceData`) | A leitura da fonte fica protegida: com o mapa removido, não faz nada. Vale para todos os mapas que usam essa função. |
| `src/components/mapa/MapaControlesMobile.jsx` · `src/pages/MapaGeral.jsx` · `src/styles/mapa-geral.css` | O "+" passa para dentro da coluna da direita (`acimaDaPilha`), acima de Atualizar, Localizar e Mover. |
| `src/pages/MapaCadastro.jsx` | Com `?novo=ponto`, o cadastro já nasce no editor de ponto. Ao fechar, volta direto ao Mapa Geral, sem mostrar a lista. |

## Verificação

- `tests/smoke/cadastroMapaFecharD340.test.jsx` usa um mapa falso que lança como o MapLibre depois de `remove()`. Os testes:
  - FC-01: fechar o editor de área nova, linha nova e ponto marcado não lança;
  - FC-02: aberto pelo "+", a lista do cadastro nunca aparece, e o editor volta ao Mapa Geral;
  - FC-03: o "+" fica dentro da coluna da direita.
- Os 5 testes falham no código antigo e passam no novo.
- No navegador real, com a mesma proteção: área nova, linha nova e ponto marcado fecham sem erro, o app continua montado, e o fluxo "+" → fechar volta ao Mapa Geral.
- `test:smoke`: 4646 de 4646.
- `gate:types`: passa, sem aumento da dívida.

## O que ficou para depois

- **ErrorBoundary nas rotas:** que um erro numa tela não apague o app inteiro. É uma missão à parte.
- **Aviso de permissão de localização:** com a localização negada, o editor avisa "Permita a localização…" assim que abre. É ruído, não é defeito; dá para tratar junto com o GPS.
