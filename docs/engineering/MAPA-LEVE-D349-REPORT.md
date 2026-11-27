# Mapa leve — etapa 2: lotes desenhados pelo mapa (D-PROD-349)

**Data:** 2026-11-27 · sem servidor, sem migration · base: etapa 1 ([D-PROD-347](./MAPA-LEVE-D347-REPORT.md))

> **Numeração:** a `origin/main` já deu a D-PROD-349 ao Diário das atividades (outra sessão). Renumerar esta decisão antes do merge (regra A5).

## O que mudou

Antes, cada pasto com gado tinha um marcador HTML (a figura, a contagem e a bolinha do identificador). Com 200 pastos, o navegador recalculava o estilo de centenas de elementos a cada quadro do arrastar.

Agora o lote é desenhado pelo próprio mapa:

- **Fonte e camadas.** Cada pasto com gado é um ponto na fonte GeoJSON `mg-lotes`. A camada `symbol` `mg-lotes` pinta o ícone. A camada `mg-lotes-ident` pinta o identificador por cima. As duas:
  - nunca somem por colisão (`icon-allow-overlap` e `icon-ignore-placement`);
  - ficam acima das áreas, das linhas e da localização;
  - são recriadas junto com as outras camadas do Mapa Geral (`ensureMgLayers`).
- **Imagem.** É a mesma figura do motor do ícone (D-PROD-191), com 44 px de largura e a altura sem achatar. A contagem vai escrita dentro da imagem, num canvas no `devicePixelRatio`:
  - mesma posição (`CONTAGEM_TOPO_PCT`), cinza `#6b7280`, 9,5 px, negrito;
  - o mesmo halo branco do `text-shadow`;
  - milhar com ponto.

  Não usamos `text-field`: o estilo sem internet não tem fonte de letras.
- **Cache.** A chave da imagem é desenho + contagem. A mesma chave nunca é desenhada de novo. A figura (SVG) é pintada uma vez por desenho, e cada contagem só copia a figura e escreve o número. As imagens são desenhadas em fatias de 8 ms, para a abertura não travar a tela. Na troca satélite ↔ mapa, as imagens voltam pelo `ensureLayers` e, se faltar alguma, pelo `styleimagemissing`.
- **Posição.** O ícone fica em `[0,-26]` sem nome embaixo e em `[0,-14]` com nome. O `icon-offset` lê o atributo `comRotulo` da fonte. Para desviar dos lotes, os nomes calculam a caixa de cada lote: o ponto na tela, mais o deslocamento, mais o tamanho da imagem. Não há mais elemento para medir. O comportamento dos nomes não mudou.
- **Clique.** O clique na camada abre os lotes do pasto. A área por baixo não abre: o clique da área e o da linha conferem se há lote no ponto, e o `hitArea` também enxerga o lote. O cursor vira mão e o nome do pasto aparece como título.
- **Arrastar** (com "Ativar arrasto" ligado):
  - ao pressionar o lote, o mapa não desliza;
  - passados 4 px, uma cópia HTML da mesma imagem segue o dedo e o ícone da camada some;
  - ao soltar, `onDragLotes` recebe os mesmos argumentos do `dragend` antigo, e o ícone volta ao lugar;
  - abaixo de 4 px, é clique;
  - com dois dedos (pinça), não arrasta.
- **Piscar do alerta.** Uma troca de `icon-opacity` (1 ↔ 0,2 a cada 550 ms) na camada do identificador. Todos piscam juntos. Antes, um piscar podia parar outro.

Arquivos:

- `src/lib/maplibre/lotesNoMapa.js` (novo);
- `src/lib/maplibre/iconeSemAchatar.js` (novo, tirado de `mapaGeralRender.js`, que o reexporta);
- `src/components/mapa/useMapRenderer.jsx`;
- `src/lib/maplibre/mapaGeralRender.js`.

## Números (200 pastos, Pixel 7 emulado, CPU 4×, SwiftShader)

`run-perf.cjs` agora conta os lotes pela fonte do mapa (`window.__E2E_MAPS__`, só no harness) e aceita `PERF_DPR`. Antes e depois foram medidos na mesma máquina, em sequência. A máquina estava mais carregada que na etapa 1: o zoom de base deu ≈ 4,5 quadros/s, não os 8,5 do relatório anterior.

**Densidade do Pixel 7 (2,625):**

| Cenário | Antes (2 rodadas) | Depois (2 rodadas) |
|---|---|---|
| Arrastar — quadros/s | 8,5 – 8,8 | 9,8 – 9,9 |
| Arrastar — recálculo de estilo no gesto | 9,3 – 9,7 s | 5,0 – 5,3 s |
| Arrastar — script no gesto | 5,8 – 6,4 s | 4,0 – 4,2 s |
| Arrastar — quadros acima de 50 ms | 218 – 230 | 186 – 190 |
| Zoom — quadros/s | 4,1 – 4,5 | 4,6 – 5,3 |
| Zoom — script no gesto | 11,5 – 12,8 s | 8,2 s |
| Marcadores HTML na abertura | 400 | 200 (só os nomes) |
| Lotes depois dos nomes, na abertura | ≈ 10 ms | ≈ 150 – 280 ms |

**Densidade 1 (`PERF_DPR=1`):**

| Cenário | Antes | Depois |
|---|---|---|
| Arrastar — quadros/s | 21,4 | 33,2 |
| Arrastar — quadro mais lento (p95) | 117 ms | 67 ms |
| Arrastar — quadros acima de 50 ms | 178 de 558 | 65 de 625 |
| Arrastar — recálculo de estilo | 9,0 s | 5,0 s |

**Leitura honesta.** Na densidade do Pixel 7, o arrastar quase não sobe (≈ 9 → ≈ 10 quadros/s). No harness, o SwiftShader pinta o mapa na CPU, e quase todo o quadro vai nisso. Prova: escondendo todos os marcadores HTML e os lotes, o arrastar continuou em ≈ 8 – 9 quadros/s. Em celular de verdade a GPU faz essa pintura. Por isso o número que mostra o ganho da página é o de densidade 1: o arrastar foi de 21 para 33 quadros/s, e os quadros acima de 50 ms caíram de 178 para 65. O recálculo de estilo caiu quase pela metade nas duas densidades. O zoom mudou pouco: o custo dele é o dos 200 nomes, que continuam em HTML.

## Visual: o que ficou diferente

Capturas em `docs/engineering/evidencias/mapa-leve/` (harness `?cena=geral`, 390 px, deviceScaleFactor 2):

- `d349-antes-geral.png` e `d349-antes-lote.png`;
- `d349-depois-geral.png` e `d349-depois-lote.png`;
- `d349-depois-arrastando.png` (a cópia no meio do arrasto);
- `d349-comparacao-antes-depois-diferenca.png` (antes, depois e a diferença ampliada).

Figura, moldura, cor, contagem e identificador saem iguais. O que muda:

- **Meio pixel.** O ícone inteiro fica ½ px (1 pixel da tela) à direita e acima. O marcador HTML arredondava a posição para o pixel; a camada não arredonda. Alinhadas, as duas imagens diferem só na borda do desenho.
- **Contagem.** O número pode ficar até ½ px mais baixo. A suavização do texto do canvas é um pouco diferente da do HTML.
- **O que fica por cima.** O que é pintado pelo mapa fica abaixo de tudo que continua HTML:
  - um cocho ou ponto de referência em cima de um lote agora cobre o lote (antes o lote ficava por cima do cocho);
  - o nome do pasto, quando encosta no ícone, fica por cima dele.
- **Identificador.** Os identificadores ficam todos numa camada acima de todos os ícones. Se dois lotes se sobrepõem, a bolinha do de baixo aparece sobre o ícone do de cima.
- **Lote com alerta por cima.** Vale dentro de um mesmo ladrilho do mapa (`symbol-sort-key`), não entre ladrilhos.
- **Piscar.** Os identificadores com alerta piscam todos juntos.
- **Arrastar.** O cursor vira "mão fechada" durante o arrasto.

## Testes

- Novo: `tests/smoke/lotesNoMapaD349.test.jsx` (21 casos):
  - mesma chave = mesma imagem, sem redesenhar;
  - contagem com milhar, cor, fonte, posição e halo;
  - posição com e sem nome;
  - clique abre os lotes e não a área;
  - arrasto chama `onDragLotes`, clique curto não, pinça não, sem permissão não;
  - piscar só com alerta e identificador;
  - imagens voltam na troca de estilo;
  - identificador e MISTO.
- Reescritos para a fonte e a camada:
  - `iconeLoteMapa` (ILM-2/3/4);
  - `maplibreAreasUnificacao` (V03 e o deslocamento);
  - `mapaRotulosSemBagunca`, `contagemLote` (CNT-03), `detalhesLoteVisualGesto`, `menuNavFreeze`.
- Os mocks sem uso de `setDraggable` saíram de `cadastroMapaCelularD333`, `cadastroMapaFecharD340`, `mapaMarcadorNivelSuplementacao` e `maplibreAreasUnificacao`.
- Canvas e `<img>` falsos ficam em `tests/smoke/helpers/canvasLotesFalso.js`.
- Conferido no navegador (harness, WebGL real), com mouse e com toque:
  - tocar no lote abre os lotes; tocar na área abre a área;
  - arrastar mostra a cópia, o mapa não desliza, e soltar em outro pasto abre o mover;
  - soltar no mesmo pasto mostra "Arraste para outra área";
  - sem o arrasto ligado, o dedo desliza o mapa.

## O que falta / riscos

- **Aparelho de verdade.**
  - Medir no celular. O harness não mostra o ganho na densidade real.
  - Conferir no app (Android e iOS) que o canvas lê os pixels da figura SVG. Se a WebView "sujar" o canvas, o lote não aparece: não há volta automática para o marcador HTML.
- **Memória.** Cada contagem diferente é uma imagem nova, de ≈ 50 kB na densidade 2,6. As imagens não são apagadas durante a sessão, nem no cache nem no mapa.
- **Abertura.** Com 200 pastos, os lotes aparecem ≈ 0,2 s depois dos nomes, enquanto as imagens são desenhadas.
- **Próximas etapas:**
  - nomes das áreas, cochos e pontos desenhados pelo mapa, com o mesmo cuidado de deixar igual. Os nomes são o custo do zoom e a maior parte do que resta no arrastar;
  - depois, medir de novo.

## Revisão independente e correções

Uma revisão de código independente (somente leitura) achou oito pontos; os seis que mudam comportamento foram corrigidos antes do merge (ver D-PROD-349). Ficam como diferenças conhecidas:
- os lotes ficam abaixo do que ainda é HTML (cocho, ponto, tarefa, nome): um cocho no centro do pasto cobre o lote e recebe o clique;
- a reserva (imagem que não pôde ser desenhada) não mostra a contagem;
- um toque longo em cima do lote abre os lotes, não o lançamento de tarefa.
