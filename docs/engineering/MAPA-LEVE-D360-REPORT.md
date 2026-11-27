# Mapa leve — etapa 5: satélite sem o mapa de ruas por baixo (D-PROD-360)

**Data:** 2026-11-27 · sem servidor, sem migration, sem APK novo · base: etapa 4 ([D-PROD-354](./MAPA-LEVE-D354-REPORT.md), PR #443)

## Por quê

Depois da etapa 4, medi camada por camada o que ainda pesa no zoom. As camadas da fazenda (áreas, lotes, cochos, pontos, tarefas, nomes) quase não pesam mais. Escondendo uma de cada vez, numa mesma página e alternando, a diferença ficou dentro do ruído.

Sobrou o satélite. Ele é uma camada de imagens posta por cima do estilo de ruas (OpenFreeMap Liberty, ~110 camadas: estradas, rios, nomes de cidades). O satélite cobre a tela inteira, então nada das ruas aparece. Mesmo assim, o MapLibre continuava a cada passo do zoom e do arrasto:

- baixando os tiles de ruas;
- processando esses tiles;
- desenhando as ~110 camadas embaixo do satélite.

No app havia mais um custo. A limpeza do cache do satélite lê até 4.000 imagens guardadas, uma a uma. Ela rodava a cada 200 imagens novas, ou seja, justamente durante o zoom.

## O que mudou

- **Ruas escondidas com o satélite pronto** (`basemapController.js`).
  - Quando o satélite está pronto e carregado na tela (evento `idle` do mapa, com a fonte do satélite carregada), as camadas do estilo de ruas que ficam **abaixo** do satélite recebem `visibility: none`.
  - Ficam visíveis o fundo (`background`) e as camadas de negócio (`PREFIXOS_FONTES_NEGOCIO`).
  - Sem camada visível, a fonte de ruas deixa de ser usada e o MapLibre para de pedir os tiles dela.
  - A visibilidade de cada camada é guardada. Ela volta igual quando o usuário escolhe **Mapa** ou quando o satélite falha. A camada que já estava escondida no estilo continua escondida.
  - Enquanto o satélite carrega, as ruas continuam aparecendo, como antes. Isso vale também quando a fonte do satélite é trocada (sessão renovada depois de um 401/403, nova tentativa).
- **Limpeza do cache fora do zoom** (`sateliteGuardado.js`, só no app). Depois de 200 imagens guardadas, a limpeza fica marcada. Cada imagem nova a empurra para depois, e ela só roda quando o mapa passa 20 s sem gravar imagem nova. Se o mapa nunca parar, ela roda no máximo 2 min depois de marcada. Ela também fica marcada uma vez a cada abertura do app, porque a marcação da sessão anterior se perde quando o app é fechado.

## Números

Harness `?grande=200`, Pixel 7 emulado (densidade 2,625), CPU 4× mais lenta, WebGL por SwiftShader.

O satélite foi simulado por um servidor local de imagens JPEG de 512 px, na mesma posição da camada real (logo abaixo das camadas de negócio, `raster-fade-duration: 0`).

Cada rodada abriu uma página nova (cache vazio) e fez o mesmo roteiro de campo:
1. afastar;
2. arrastar para uma área nova;
3. aproximar;
4. arrastar de novo.

As duas versões foram rodadas alternadas, três vezes cada.

| Satélite ligado | Com ruas por baixo (antes) | Sem ruas (agora) |
|---|---|---|
| Tiles de ruas baixados | 9 · 9 · 9 | **0 · 0 · 0** |
| Quadros/s | 7,7 · 9,7 · 10,3 | 7,8 · 12,2 · 11,9 |
| Quadros acima de 100 ms | 194 · 169 · 157 | 188 · 108 · 115 |
| Trabalho do processador principal | 9,1 · 8,7 · 8,0 s | 8,5 · 7,2 · 7,0 s |

Leitura honesta:

- **Média.** O ganho médio é de ≈ 15% nos quadros/s e ≈ 20% menos quadros lentos. A primeira rodada de cada lado ficou empatada: o navegador ainda estava aquecendo.
- **Onde pesa o resto.** No harness, quase todo o resto do quadro é o SwiftShader pintando a tela na CPU.
- **O que o harness não mede.** Ele não mede o trabalho dos workers que processam os tiles de ruas. Num tablet fraco, esses workers disputam o processador com a tela. O harness também não mede a internet do campo: cada tile de ruas a menos é um download a menos durante o zoom.

Como repetir: os scripts ficam fora do repositório (servidor de imagens em Python com Pillow, roteiro em Playwright), descritos acima. O harness é o de sempre:

```bash
npx vite --config tests/e2e/harness/vite.e2e.config.mjs --force
```

## Visual

Comparei a tela com e sem as ruas por baixo, depois de carregada, com o satélite simulado (celular de 390 px, densidade 2). As duas são idênticas, menos o crédito no rodapé:

- **Crédito do mapa de ruas.** "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" deixa de aparecer no satélite, porque esses dados deixam de ser mostrados. Fica o crédito do satélite: "Google Maps" no site, "© MapTiler © OpenStreetMap" no app.
- **Imagem que falta.** Se faltar uma imagem do satélite (área nunca vista, sinal fraco), aparece o fundo liso do mapa onde antes podiam aparecer as ruas. O MapLibre já usa a imagem do nível de zoom de cima enquanto a nova chega, então isso é raro.

## Revisão independente

Uma revisão só de leitura achou quatro pontos. Todos foram corrigidos, cada um com um teste que falha sem a correção.

1. **Atalhos de "pronto".** Ao voltar para o satélite com a mesma sessão, o controlador confiava em `isSourceLoaded`. Para uma fonte ainda sem uso, o MapLibre devolve `true`, então as ruas sumiam antes de qualquer imagem da área nova: tela no fundo liso até a rede responder.
2. **Sessão renovada.** Com a sessão renovada depois de um 401/403, ou numa nova tentativa, as ruas continuavam escondidas enquanto a fonte nova carregava.
3. **Primeiro tile.** Esconder com a primeira imagem fazia o resto da tela piscar no fundo até as outras chegarem.
4. **Limpeza que nunca roda.** A limpeza adiada podia nunca rodar com o mapa sempre em uso, ou se o app fosse fechado antes dos 20 s.

A correção de 1 e 3 foi esconder só no `idle` do mapa, com a fonte do satélite carregada. A de 2 foi devolver as ruas quando a fonte é trocada. A de 4 foi o teto de 2 min e uma limpeza por abertura do app.

## Testes

- `tests/smoke/maplibreAreasUnificacao.test.jsx`:
  - SR-01: um tile só não esconde as ruas; o `idle` com o satélite carregado esconde; com o satélite ainda carregando, não. O fundo, as camadas de negócio e a camada já escondida ficam como estavam. Voltar para Mapa devolve cada camada como estava. Satélite de novo esconde de novo.
  - SR-02: o satélite que falha (429) volta para Mapa com as ruas visíveis.
  - SR-03: a sessão renovada (401) devolve as ruas até o próximo `idle`.
- `tests/smoke/sateliteGuardadoApp.test.js`:
  - SG-06: depois de 200 imagens a limpeza não roda; cada imagem nova a adia; ela roda depois de 20 s sem imagem nova.
  - SG-07: com uma imagem nova a cada 10 s, ela roda no máximo 2 min depois de marcada.
- Os testes novos falham sem a mudança e passam com ela.

## O que falta / riscos

- **Tablet de verdade.** Medir o zoom com o satélite no tablet do proprietário, no site (Google) e no app (MapTiler).
- **Estilo licenciado** (`VITE_MAP_SATELLITE_STYLE_URL`). Não muda: ele troca o estilo inteiro, sem ruas por baixo.
