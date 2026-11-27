# Mapa leve — etapa 4: nomes dos pastos desenhados pelo mapa (D-PROD-354)

**Data:** 2026-11-27 · sem servidor, sem migration · base: etapa 3 ([D-PROD-353](./MAPA-LEVE-D353-REPORT.md), PR #441, `8ddebcf85`)

## Por quê

O proprietário testou num tablet fraco: arrastar ficou bom, o **zoom** ainda travava. Depois das etapas 1 a 3, quase todo o custo do zoom eram os ~200 nomes dos pastos, os últimos marcadores HTML do Mapa Geral. A cada quadro do zoom o navegador reposicionava e reescalava os 200 elementos: num zoom de 200 pastos, ≈ 13 a 16 s de recálculo de estilo e ≈ 3 s de layout.

## O que mudou

Os nomes agora são desenhados pelo próprio mapa, como os lotes (etapa 2) e os pontos (etapa 3). Arquivo novo: `src/lib/maplibre/nomesNoMapa.js`.

- **Fonte e camadas.** Cada pasto é um ponto na fonte `mg-nomes`. Duas camadas `symbol`:
  - `mg-nomes`: pasto **sem lote**, nome centrado no ponto;
  - `mg-nomes-lote`: pasto **com lote**, topo do nome 10 px abaixo do ponto, logo embaixo do ícone (o mesmo par ícone + nome da D-PROD-128). Os 10 px são `icon-translate`, em px da tela (o `icon-offset` seria multiplicado pelo tamanho do nome).
  - As duas ficam por cima de todas as camadas do Mapa Geral (como o HTML ficava), nunca somem por colisão do mapa e **não recebem clique**: tocar no nome continua abrindo o pasto.
- **A imagem do nome.** O texto é escrito num canvas, no `devicePixelRatio`, na letra máxima (12 px). Igual ao rótulo HTML:
  - nome em negrito (700), branco;
  - "ha" em peso normal, branco a 95%;
  - linha extra (lotação, situação do pasto) em peso 600, amarelo claro `#fef08a`;
  - altura da linha 1,15 × a letra, linhas centralizadas, sem sombra e sem contorno (o rótulo de antes não tinha).
  - Nada de `text-field`: o estilo sem internet não tem fonte de letras. Antes do primeiro desenho a Inter é pedida com `document.fonts.load` (espera até 3 s); sem ela, Arial, como o navegador fazia no HTML.
  - Chave da imagem = as linhas desenhadas + as cores. Pastos com o mesmo texto dividem a imagem; a mesma chave nunca é desenhada de novo. Cache, fila em fatias de 8 ms, limite de tentativas, troca de estilo (`ensureLayers` + `styleimagemissing`) e densidade da tela são os dos lotes.
  - Poda: sai do mapa a imagem de um texto que não existe mais (pasto renomeado, hectares ou lotação mudaram). As imagens dos outros níveis do texto atual ficam: trocar de sigla para nome não redesenha nada.
- **Tamanho no zoom pelo mapa, sem JavaScript por quadro.** O `icon-size` da camada é uma interpolação por zoom com paradas de cada pasto (`s8` … `s22` na fonte). Cada parada é a mesma conta de antes: (letra do zoom ÷ 12) × encaixe no pasto. A letra vai de 10 px (zoom ≤ 13) a 12 px (zoom ≥ 17), `fontesRotuloPorZoom`. O encaixe é `escalaRotulo` com a folga do ponto (`pontoEFolga`), nunca abaixo de 60%.
  - A interpolação é exponencial de base 2: o pasto dobra de tamanho a cada nível.
  - O mapa só interpola entre os dois níveis inteiros em volta do zoom, e a conta real tem o mínimo de 60% e o máximo de 100% no meio do caminho. Por isso, a cada publicação, as duas paradas em volta do zoom atual são acertadas: parado, o nome tem o tamanho exato.
- **Nível global sem medir elemento.** Os três níveis (nome + ha + extra, só o nome, só a sigla) continuam valendo para **todos** os nomes ao mesmo tempo (`escolherModoRotulos`, D-PROD-126). A diferença é que as caixas agora são calculadas, não medidas:
  - a do nome sai do tamanho da imagem na letra do zoom e da posição da camada (com ou sem lote), via `map.project`;
  - a da área, dos cantos dela na tela;
  - os ícones de lote de outros pastos são obstáculos; o do próprio pasto não conta.
  - No fim do movimento (`moveend`) decide por todos. Durante o zoom revê no máximo a cada 120 ms, só pelos pastos na tela (D-PROD-129/347), e só troca a fonte se o nível mudar.
- **O que saiu.** O marcador HTML do nome e o código que só servia a ele: `arrumarRotulos`, `escalarNome`, `aplicarFonteRotulo`, `PAR_LOTE` e o ouvinte de zoom que escalava os nomes. `fontesRotuloPorZoom` e `escalaRotulo` foram para `nomesNoMapa.js`; `mapaGeralRender.js` as reexporta.

Agora o Mapa Geral só tem um marcador HTML: a localização do usuário.

## Números

Harness `?grande=200` (200 pastos, 200 lotes, 50 pontos de referência), Pixel 7 emulado, CPU 4× mais lenta, WebGL por SwiftShader (CPU). O "antes" (`8ddebcf85`) e o "depois" rodaram em dois servidores Vite (`--force`) ao mesmo tempo, **alternados**, com o mesmo `run-perf.cjs`. Os números servem para comparar, não como tempo de um aparelho.

`run-perf.cjs` agora espera e conta os nomes pela fonte do mapa (`nomes_no_mapa`) e aceita o rótulo HTML antigo, para medir o "antes".

**Densidade 1 (`PERF_DPR=1`), duas rodadas:**

| Cenário | Antes | Depois |
|---|---|---|
| **Zoom — quadros/s** | **7,2 · 7,0** | **39,9 · 38,0** |
| Zoom — quadros acima de 50 ms | 107 · 101 | 8 · 9 |
| Zoom — p95 do quadro | 367 ms · 367 ms | 50 ms · 50 ms |
| Zoom — recálculo de estilo | 15,8 s · 14,8 s | 0 · 0 |
| Zoom — layout | 3,4 s · 3,2 s | 0 · 0 |
| Zoom — script | 7,7 s · 7,6 s | 3,1 s · 2,4 s |
| Arrastar — quadros/s | 37,5 · 33,3 | 44,3 · 48,1 |
| Arrastar — quadros acima de 50 ms | 40 · 71 | 4 · 3 |
| Arrastar — recálculo de estilo | 4,1 s · 5,0 s | 0,01 s · 0,02 s |

**Densidade do Pixel 7 (2,625), três rodadas:**

| Cenário | Antes | Depois |
|---|---|---|
| **Zoom — quadros/s** | **5,5 · 6,7 · 6,6** | **10,1 · 10,1 · 8,8** |
| Zoom — p95 do quadro | 483 · 383 · 400 ms | 183 · 183 · 233 ms |
| Zoom — recálculo de estilo | 16,4 · 13,4 · 12,6 s | 0 · 0 · 0 |
| Zoom — layout | 3,4 · 2,8 · 2,6 s | 0 · 0 · 0 |
| Zoom — script | 8,6 · 7,8 · 7,2 s | 3,4 · 2,8 · 3,5 s |
| Zoom — onde terminou (o roteiro volta a 11,46) | 11,22 · 11,62 · 11,30 | 11,46 · 11,46 · 11,46 |
| Arrastar — quadros/s | 9,4 · 11,4 · 11,2 | 13,1 · 13,1 · 12,4 |
| Arrastar — p95 do quadro | 217 · 183 · 200 ms | 150 · 117 · 133 ms |
| Arrastar — recálculo de estilo | 5,4 · 4,3 · 4,4 s | 0,02 · 0,02 · 0,02 s |

**Leitura honesta.**

- O ganho que o proprietário pediu é o do zoom: o recálculo de estilo e o layout dos nomes **sumiram** (≈ 15 s e ≈ 3 s → 0). Na densidade 1, que mostra o custo da página, o zoom foi de ≈ 7 para ≈ 39 quadros/s e os quadros lentos caíram de ≈ 100 para ≈ 9.
- Na densidade do Pixel 7 o zoom quase dobrou (≈ 6,3 → ≈ 9,7 quadros/s), e o pior quadro (p95) caiu para menos da metade. O que sobra é o SwiftShader pintando o mapa na CPU: num aparelho com placa de vídeo essa parte é muito menor. Ali, quase todos os quadros do "depois" passam de 50 ms (≈ 100 ms cada, a pintura), enquanto o "antes" alternava quadros rápidos com quadros de 400 ms; por isso "quadros acima de 50 ms" não serve para comparar nessa densidade.
- O "antes" perdia passos da rodinha (a página travada não acompanhava): o zoom terminava em 11,2 a 11,6 em vez de voltar a 11,46. O "depois" sempre voltou ao ponto certo.
- Abertura: os nomes aparecem depois de desenhadas as 200 imagens, ≈ 0,3 a 1,7 s depois do mapa (antes 0,1 a 0,8 s). O mapa abre no mesmo tempo (≈ 4,4 a 5,6 s, com a máquina dividida). A primeira rodada do "depois" (11 s) foi logo depois do `--force`, com o Vite ainda preparando as dependências; não entrou na comparação.

Como repetir:

```bash
npx vite --config tests/e2e/harness/vite.e2e.config.mjs --force --port 5249
E2E_URL=http://localhost:5249/ node tests/e2e/harness/run-perf.cjs 200 rotulo
PERF_DPR=1 E2E_URL=http://localhost:5249/ node tests/e2e/harness/run-perf.cjs 200 rotulo
```

## Visual

Capturas em `docs/engineering/evidencias/mapa-leve/` (celular de 390 px, deviceScaleFactor 2, harness):

| Captura | Antes | Depois |
|---|---|---|
| Visão geral (`?grande=40`, zoom 12,5: siglas) | `d354-antes-geral.png` | `d354-depois-geral.png` |
| Afastado (zoom 11,8: siglas no mínimo) | `d354-antes-afastado.png` | `d354-depois-afastado.png` |
| Pastos com lote e o curral sem lote (zoom 15,3: nome + ha) | `d354-antes-lote.png` | `d354-depois-lote.png` |
| Perto, colorido por Situação (zoom 15,9: nome + ha + "Ocupado 0d"/"Sem gado") | `d354-antes-perto.png` | `d354-depois-perto.png` |

Comparações ampliadas (antes, depois e a diferença): `d354-comparacao-nome-com-lote.png`, `d354-comparacao-nome-sem-lote.png` e `d354-comparacao-sigla.png`.

Os nomes aparecem nos mesmos pastos, com o mesmo nível, o mesmo texto, a mesma letra, as mesmas cores e o mesmo tamanho. As diferenças:

- **Meio a um pixel.** As letras e a posição podem variar ½ a 1 px da tela: o marcador HTML arredondava a posição para o pixel; a camada não.
- **Letra um pouco mais suave quando reduzida.** A imagem é desenhada em 12 px e reduzida pela placa de vídeo; o HTML desenhava a letra já no tamanho final. Aparece nos zooms em que o nome é menor (sigla, mapa afastado).
- **"ha" e linha extra.** No HTML eles eram sempre 1 px menores que o nome (11 → 9 px). Agora encolhem na mesma proporção do nome: na letra de 10 px ficam com ≈ 9,2 px em vez de 9.
- **Durante o zoom**, no pasto cujo nome está chegando ao mínimo de 60% ou ao tamanho normal, o nome pode ficar até ≈ 17% fora do tamanho exato no meio de um nível de zoom (o mapa só interpola entre dois níveis inteiros). Parado, o tamanho é exato. Nos outros pastos a diferença é menor que 0,5%.
- **Troca de nível durante o zoom.** Quando a revisão troca o nível (por exemplo, de nome para sigla), o mapa refaz os nomes daquele trecho. É raro (uma ou duas vezes num gesto) e não roda nada por quadro.
- **Por baixo de janelas.** Como antes, os nomes ficam por baixo da legenda e dos botões do mapa, que são HTML.

## Testes

- Novo: `tests/smoke/nomesNoMapaD354.test.jsx` (27 testes):
  - N354-1: fonte e camadas, nenhum HTML, texto perigoso só pintado, ordem (por cima de tudo) e sem clique, nomes desligados;
  - N354-2: letra, cores, opacidade, alturas e centro das linhas, sem sombra; imagem por chave (texto + cores), refetch não redesenha nem republica, texto novo = imagem nova; linhas por nível;
  - N354-3: `icon-size` exponencial por paradas; parada = (letra ÷ 12) × encaixe, mínimo 60%; folga em px igual à projeção do mapa; acerto das paradas no zoom em que o mapa para; paradas por pasto na fonte; nada por quadro no zoom;
  - N354-4: nível global por colisão (tudo, só nome, sigla), com o lote de outro pasto como obstáculo e o do próprio pasto fora da conta; caixa do nome com e sem lote;
  - N354-5: revisão durante o zoom só pelos pastos na tela, a cada 120 ms no máximo, publica só se o nível muda; nenhum `getBoundingClientRect`;
  - N354-6: posição com e sem lote (`comLote` nos nomes, `comRotulo` nos lotes);
  - N354-7: troca de estilo e `styleimagemissing`, poda, densidade da tela, espera da Inter, `clearAll`.
- Reescritos para a forma nova, sem perder casos: `mapaRotulosSemBagunca` (renderer, D-PROD-128, D-PROD-129), `mapaLeveRotulosD347` (revisão sem DOM), `lotesNoMapaD349` (L349-3) e `maplibreAreasUnificacao` (V03).
- `tests/smoke/helpers/canvasLotesFalso.js` guarda também o `globalAlpha`.
- Harness e2e (`run-geo`, `run-geo2`, `run-webgl`, `run-satelite`, `run-perf`): leem os nomes da fonte `mg-nomes`.
- No navegador (harness, WebGL real): troca satélite ↔ mapa mantém os 3 nomes desenhados (fonte, imagens e camadas), nenhum erro novo na página.
- `npx vitest run tests/smoke`: 397 arquivos, 4.859 testes, todos passando.
- `node scripts/gates/verify-all.mjs --pular=test:backend,test:smoke`: todas as etapas passaram (tipos sem dívida nova, `source-closure`, `lint`, `build`).

## O que falta / riscos

- **Tablet de verdade.** Medir o zoom no tablet do proprietário.
- **App (Android/iOS).** Conferir a letra (Inter ou Arial) e a nitidez do texto reduzido na tela do aparelho.
- **Abertura.** O primeiro desenho dos 200 nomes leva um instante a mais que o HTML (os nomes aparecem até ≈ 1 s depois do mapa no harness lento).
- **Leitor de tela.** O nome do pasto não é mais um elemento de texto na página. Os marcadores de antes também não recebiam foco nem eram anunciados como botões; o nome continua no detalhe que abre ao tocar no pasto.
