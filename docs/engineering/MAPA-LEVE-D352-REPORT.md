# Mapa leve — etapa 3: cochos, pontos e tarefas desenhados pelo mapa (D-PROD-352)

**Data:** 2026-11-27 · sem servidor, sem migration · base: etapa 2 ([D-PROD-349](./MAPA-LEVE-D349-REPORT.md))

> **Numeração:** nasceu D-PROD-350; a `main` deu a D-PROD-350 a outra decisão (PR #438) e a PR #439 reservou a D-PROD-351. `node scripts/dev/proxima-decisao.mjs` indicou D-PROD-352, que é esta; os arquivos (teste, relatório e capturas) levam o número novo.

## O que mudou

Na etapa 2 os lotes passaram a ser desenhados pelo próprio mapa. Agora o mesmo vale para os outros marcadores do Mapa Geral que não são os nomes das áreas:

- **cochos e depósitos** (`syncPontosSuplementacao`);
- **pontos de referência**, o bebedouro incluído (`syncPontos`);
- **tarefas** (`syncTarefas`).

Só a localização do usuário continua HTML (é um marcador só). Os nomes das áreas também continuam HTML.

Como ficou:

- **Fonte e camada.** Cada grupo é uma fonte GeoJSON e uma camada `symbol`: `mg-supl`, `mg-pontos` e `mg-tarefas`. Nunca somem por colisão (`icon-allow-overlap` e `icon-ignore-placement`). São recriadas com as outras camadas (`ensureMgLayers`).
- **Imagem.** Montada num canvas no `devicePixelRatio`, igual ao marcador antigo:
  - a figura com o lado maior de 36 px (cocho e depósito) ou 40 px (ponto e tarefa), sem achatar;
  - sem figura, o círculo da cor (raio 20, borda branca de 3 px, sombra);
  - cocho e depósito: o selo "?" (cinza) ou "!" (âmbar) no canto de cima à direita e o farol da leitura no canto de baixo, nas mesmas posições, cores, bordas e sombras;
  - tarefa: o indicador do prazo ("3d", "99+", "✓"…) na cor do prazo, 7 px para fora da direita e 4 px acima do pé, como o `aplicarIndicadorTarefa`.
  A imagem é simétrica em volta do centro do ícone, então a âncora `center` da camada cai no mesmo ponto da âncora do marcador.
- **Cache.** A chave da imagem é o que ela desenha: figura (um resumo da URL), tamanho, cor, selo, farol e indicador. Pontos iguais dividem a imagem, e a mesma chave nunca é desenhada de novo. O cache, a fila em fatias de 8 ms e o limite de 3 tentativas são os mesmos dos lotes (`garantirImagens`). As imagens que nenhum ponto do grupo usa saem do mapa e do cache (não quando o grupo está escondido pelo filtro). Na troca satélite ↔ mapa, voltam pelo `ensureLayers` e pelo `styleimagemissing`.
- **Reserva.** Cada ponto tem uma reserva (`coalesce`): o círculo da cor com o mesmo selo, farol ou indicador, desenhado sem figura. Vale quando a figura não carrega ou quando o canvas fica "sujo".
  - Ícone gravado como link `http(s)` (outra origem) é pedido com CORS. Se o servidor não aceitar, ou não responder em 8 s, a figura não carrega e o ponto fica com a reserva. Não quebra nada: um canvas sujo é trocado por um novo, e o próximo desenho (lote ou ponto) sai normal.
  - A figura é carregada **fora** da fila de desenho: uma figura lenta não segura os lotes nem os outros pontos. A falha de um link é lembrada por 2 minutos: N pontos com o mesmo ícone fazem um download só, e a tentativa pulada não conta para o limite de 3.
  - O grupo espera as imagens no máximo 250 ms. O que ainda faltar aparece com a reserva e é trocado quando a imagem chega.
  - Tarefa com ícone enviado que não carrega usa o modelo local da prioridade, como o `onerror` do marcador antigo.
- **Ordem.** A mesma do z-index de antes: localização (HTML) > tarefa Urgente > tarefa > lote com alerta > lote > ponto > cocho.
  - camadas: cocho, ponto, lote, identificador do lote, tarefa;
  - Urgente por cima das outras tarefas pelo `symbol-sort-key`.
- **Clique.** Cada camada chama o callback de sempre (`onClick` do cocho, `onClickPonto`, `onClickTarefa`) com o objeto mais novo — trocado na hora de cada sincronização, mesmo com a imagem nova ainda por desenhar. Ponto sem callback abre o popup de antes (nome e tipo).
  - Só conta o toque no ícone visível: a imagem tem margem transparente (por causa do selo, do farol ou do indicador), e o toque nessa margem é da área por baixo. A fonte leva a meia largura e a meia altura do ícone (`hw`, `hh`); folga de 2 px.
  - Dois ícones sobrepostos na mesma camada: abre o desenhado por cima (a tarefa Urgente; nos lotes, o com alerta). Os dados vão nessa ordem e o `iconeNoTopo` escolhe o de maior prioridade.
  - Só age quem está **por cima** no ponto tocado (`iconeNoTopo`): tarefa em cima do lote abre a tarefa (o lote não abre nem arrasta); lote em cima do ponto abre o lote.
  - A área e a linha por baixo não abrem (`haPontoNoPonto`). O `hitArea` enxerga os pontos, e o novo `hitPonto` também.
  - O toque longo (lançar tarefa) não começa em cima de um ponto (`deveComecarToqueLongo` com `sobrePonto`).
  - O clique que o navegador manda ao soltar um lote arrastado não abre o ponto onde o dedo parou.
- **Texto para leitor de tela e dica do mouse.** O `title`/`aria-label` de cada marcador vira o `titulo` do ponto na fonte. No mouse, o canvas mostra esse título (como o lote mostra o nome do pasto). Ver "Acessibilidade".

Arquivos:

- `src/lib/maplibre/pontosNoMapa.js` (novo);
- `src/lib/maplibre/lotesNoMapa.js` (reaproveitado pelos pontos: `garantirImagens`, `podarImagens` com o grupo, `carregarFigura` com CORS, canvas sujo trocado; lote coberto por tarefa);
- `src/components/mapa/useMapRenderer.jsx` (os três `sync*` e `hitPonto`);
- `src/lib/maplibre/mapaGeralRender.js` (ordem das camadas);
- `src/lib/tarefas/marcador.js` (`tituloDoMarcadorTarefa`, o mesmo texto no marcador DOM e no mapa);
- `src/domain/mapa/cliqueArea.js` e `src/pages/MapaGeral.jsx` (toque longo).

## Números (200 pastos, Pixel 7 emulado, CPU 4×, SwiftShader)

`run-perf.cjs` agora conta os pontos no mapa (`pontos_no_mapa`: fontes `mg-supl`, `mg-pontos` e `mg-tarefas`) e aceita `PERF_FOCO` ("Pontos" ou "Tarefas"). O `?grande=200` ganhou 50 pontos de referência (bebedouros com ícone e porteiras sem ícone), 40 tarefas (uma em cada 4 Urgente, prazos de −2 a +4 dias) e leituras de cocho (farol colorido). Os cochos aparecem só no foco Pontos; as tarefas, só no foco Tarefas; os pontos de referência, em todos.

**Como foi medido.** A máquina estava dividida com outras tarefas, e uma rodada isolada "antes" e outra "depois" variavam mais que a diferença. Por isso o antes e o depois rodaram **alternados**, duas vezes cada, em dois servidores ao mesmo tempo: o "antes" com o `src` da `origin/main` e o "depois" com esta etapa, e o mesmo harness.

**Marcadores HTML na tela** (200 pastos):

| Foco | Antes | Depois |
|---|---|---|
| Lotes (lotes + pontos de referência) | 250 | 200 (só os nomes) |
| Pontos (cochos + pontos de referência) | 300 | 200 |
| Tarefas (tarefas + pontos de referência) | 290 | 200 |

**Densidade 1 (`PERF_DPR=1`), as duas rodadas:**

| Cenário | Antes | Depois |
|---|---|---|
| Pontos — arrastar, quadros/s | 30,7 · 32,5 | 36,1 · 37,4 |
| Pontos — arrastar, quadros acima de 50 ms | 91 · 84 | 51 · 29 |
| Pontos — arrastar, recálculo de estilo | 6,1 s · 5,7 s | 4,5 s · 4,1 s |
| Pontos — zoom, quadros/s | 6,1 · 6,5 | 7,0 · 7,5 |
| Tarefas — arrastar, quadros/s | 35,4 · 36,2 | 39,3 · 40,2 |
| Tarefas — arrastar, quadros acima de 50 ms | 57 · 42 | 21 · 24 |
| Tarefas — arrastar, recálculo de estilo | 5,4 s · 5,0 s | 4,0 s · 3,7 s |
| Tarefas — zoom, quadros/s | 7,0 · 6,8 | 7,2 · 7,2 |
| Lotes — arrastar, quadros/s | 35,9 · 35,2 | 35,0 · 29,5 |
| Lotes — zoom, quadros/s | 6,4 · 5,5 | 6,4 · 6,3 |

**Densidade do Pixel 7 (2,625), foco Lotes:**

| Cenário | Antes | Depois |
|---|---|---|
| Arrastar — quadros/s | 10,5 · 11,7 | 10,4 · 11,3 |
| Arrastar — recálculo de estilo | 5,9 s · 4,8 s | 5,1 s · 4,1 s |
| Zoom — quadros/s | 5,2 · 5,4 | 5,7 · 6,2 |
| Zoom — quadros acima de 50 ms | 220 de 387 · 214 de 383 | 97 de 184 · 96 de 190 |

**Leitura honesta.**

- Onde havia muitos pontos em HTML (focos Pontos e Tarefas, 90 a 100 marcadores a menos), o arrastar ficou ≈ 12 a 18% mais fluido, os quadros lentos caíram pela metade e o recálculo de estilo caiu ≈ 25%. O zoom melhorou pouco (≈ 7 → 7,5 quadros/s): o custo dele continua nos 200 nomes, que ainda são HTML.
- No foco Lotes só 50 pontos saíram do HTML (os lotes já eram do mapa desde a etapa 2). A diferença ficou dentro do ruído: uma rodada do "depois" deu 29,5 quadros/s, a outra 35. Na primeira rodada do "depois", o servidor recarregou o `MapaGeral` no meio da medida (um arquivo do `src` foi salvo, sem mudança de código).
- Na densidade do Pixel 7 o arrastar não muda (≈ 11 quadros/s), pelo mesmo motivo da etapa 2: o SwiftShader pinta o mapa na CPU, e quase todo o quadro vai nisso. O recálculo de estilo caiu ≈ 15%.
- **Zoom na densidade 2,625:** o "depois" contou metade dos quadros do "antes" no mesmo roteiro (≈ 190 × ≈ 385): a duração do gesto variou entre as rodadas. A proporção de quadros acima de 50 ms ficou parecida (≈ 52% × ≈ 56%). Não leve o 5,3 → 6 quadros/s como ganho certo.
- Abertura: os pontos aparecem quando as imagens deles ficam prontas, junto com os lotes (≈ 5,4 – 5,9 s até os lotes nas duas versões, com a máquina carregada).
- Os números acima foram medidos antes das correções da revisão (abaixo). As correções mudam quando a figura é carregada e a ordem dos dados, não o desenho no arrastar; não medi de novo.

## Visual: o que ficou diferente

Capturas em `docs/engineering/evidencias/mapa-leve/` (harness `?cena=geral&grande=40`, 390 px, deviceScaleFactor 2, zoom 13,9):

- `d352-antes-lotes.png` / `d352-depois-lotes.png` (foco Lotes: lotes, bebedouros e porteiras);
- `d352-antes-pontos.png` / `d352-depois-pontos.png` (foco Pontos: cochos com selo "?" e farol, bebedouros, porteiras);
- `d352-antes-tarefas.png` / `d352-depois-tarefas.png` (foco Tarefas);
- `d352-comparacao-cocho-selo-farol.png` e `d352-comparacao-tarefa.png`: antes, depois e a diferença, ampliados 3×.

Figura, selo, farol, indicador, contorno, tamanho e posição saem iguais. O que muda:

- **Meio pixel.** As bordas diferem em até 1 pixel da tela (o marcador HTML arredondava a posição; a camada não). O "?" do selo e o texto do indicador podem ficar ½ px mais altos ou mais baixos: a suavização do texto do canvas é um pouco diferente da do HTML.
- **O nome do pasto fica por cima.** O que o mapa desenha fica abaixo de tudo que continua HTML. O nome do pasto, quando encosta num cocho, ponto ou tarefa, agora fica por cima dele (antes o marcador cobria o nome). O mesmo com o texto de atribuição do mapa e os botões, que agora ficam por cima de um ponto que encosta neles.
- **Lote e ponto voltam à ordem de antes da etapa 2.** Na etapa 2 um bebedouro em cima de um lote cobria o lote (HTML sobre o canvas). Agora o lote fica por cima do ponto e do cocho, e a tarefa por cima do lote, como antes da etapa 2.
- **Área de toque.** Igual à de antes: o ícone visível (34 × 36 no cocho, 36 × 40 na tarefa), com 2 px de folga. O selo, o farol e o indicador não são clicáveis, como antes (eram `pointer-events: none`).
- **Ordem entre ladrilhos.** "Urgente por cima" vale dentro de um mesmo ladrilho do mapa (`symbol-sort-key`), não entre ladrilhos.
- **Âncora "pin".** O marcador antigo tinha uma forma "pin" com âncora embaixo, mas nenhuma chamada usava: todos os pontos já eram ancorados no centro. Continua assim.

## Acessibilidade

O marcador HTML tinha `title` e `aria-label` (no cocho, o nível por extenso: "Cocho Norte — Restante estimado: 150 kg de 200 kg (75%) · Leitura: …"). Desenhado no canvas, o ponto não tem mais elemento próprio, e o leitor de tela não lê o nível no mapa. O que ficou:

- o mesmo texto vai na fonte (`titulo`) e aparece como título do canvas quando o mouse passa sobre o ponto;
- tocar no cocho abre o detalhe, que mostra o nível, o restante, o farol e a leitura por extenso (`DetalhesPontoSuplementacao`); na tarefa, o detalhe mostra prioridade, situação e prazo;
- os marcadores antigos também não recebiam foco pelo teclado, então a navegação por teclado não muda.

Fica registrado como diferença: quem usa leitor de tela não ouve mais o nível ao passar pelo cocho no mapa; ouve ao abrir o detalhe.

## Testes

- Novo: `tests/smoke/pontosNoMapaD352.test.jsx` (P352-1 a P352-8):
  - imagem por chave: pontos iguais dividem a imagem, refetch não redesenha nem republica, nível novo = imagem nova;
  - selo e farol do cocho e indicador da tarefa nas posições, cores e fontes de antes; figura sem achatar e centrada;
  - ordem das camadas (também com um estilo em que os lotes já existiam);
  - clique: callback com o objeto mais novo, área e linha não abrem, quem está por cima ganha, popup sem callback, toque longo, clique depois de arrastar um lote;
  - reserva: figura que não carrega, figura de outra origem que suja o canvas, limite de tentativas, modelo local da tarefa;
  - poda e troca de estilo; `clearAll`; título no mouse.
- Reescritos para a fonte e a camada, sem perder casos: `mapaMarcadorNivelSuplementacao` (nível, selo, farol, virada do dia) e `maplibreAreasUnificacao` (V03 e a ordem das camadas). `lotesNoMapaD349` confere a regra nova do toque longo.
- `tests/smoke/helpers/canvasLotesFalso.js`: data URL `charset=utf-8`, URL externa (carrega, falha ou suja o canvas), `measureText` e caminho com `closePath`.
- `npx vitest run tests/smoke` (já sobre a `main` com a PR #438, depois das correções da revisão): 394 arquivos, 4.770 testes, todos passando. `node scripts/gates/verify-all.mjs --pular=test:backend,test:smoke`: todas as etapas passaram (tipos sem dívida nova, source-closure).
- No navegador (harness, WebGL real, celular emulado com toque): tocar no cocho abre o detalhe do cocho; tocar no bebedouro abre o detalhe do bebedouro; tocar na tarefa abre a tarefa; tocar no pasto fora do ponto abre a área. Nenhum erro na página.

## O que falta / riscos

- **Aparelho de verdade.** Medir no celular e conferir no app (Android e iOS) que o canvas lê os pixels dos SVGs do cocho, do depósito e da tarefa.
- **Ícones antigos com link de outro servidor.** O envio de ícone do app devolve a imagem como `data:` URL (`/arquivos/upload`), que não tem problema de origem. Um ícone antigo gravado como link `http(s)` de outro servidor, sem `Access-Control-Allow-Origin`, aparece como o círculo da cor (na tarefa, o modelo local da prioridade). Antes ele aparecia. Sem internet, esse link também não carrega (antes podia vir do cache do navegador).
- **Leitor de tela.** Ver "Acessibilidade".
- **Abertura.** Os pontos aparecem quando as imagens deles ficam prontas, em no máximo ≈ 250 ms; o que demorar mais aparece com a reserva (o círculo da cor) e troca quando chegar. Numa abertura lenta pode aparecer o círculo por um instante.
- **Ícone que voltou.** Um link que falhou só é tentado de novo depois de 2 minutos (e até 3 vezes na sessão).
- **Próxima etapa:** os nomes das áreas, que são o custo do zoom e o último grupo grande em HTML.

## Revisão independente e correções

Uma revisão de código (somente leitura) achou quatro pontos; os quatro foram corrigidos (commit `a5dc1c950`):

1. **(alta) Figura remota lenta travava a fila de desenho.** A figura do ponto era baixada dentro da fila, que é uma só para lotes e pontos; e cada grupo só publicava com todas as imagens. Agora a figura é carregada fora da fila (só o desenho entra nela), com tempo-limite de 8 s; a falha de um link é lembrada por 2 minutos (um download para N pontos com o mesmo ícone); e o grupo publica em no máximo 250 ms, com a reserva no que faltar. Teste: uma figura que nunca responde não atrasa os lotes nem os outros pontos.
2. **(média) Clique em sobrepostos abria o de baixo.** O `symbol-sort-key` põe a Urgente (e o lote com alerta) por cima, mas o MapLibre devolve o clique na ordem inversa dos dados. Agora os dados vão na ordem de desenho, e o `iconeNoTopo` escolhe o de maior prioridade.
3. **(baixa-média) Clique entregava o objeto velho** enquanto as imagens novas eram desenhadas. Agora o mapa id → objeto é trocado na hora.
4. **(baixa) Área de toque maior que o ícone.** O toque na margem transparente agora é da área por baixo.

Conferido de novo no navegador (harness, WebGL real, toque): cocho, bebedouro, tarefa e área abrem o detalhe certo; o toque no canto do selo do cocho (fora do ícone) abre a área.
