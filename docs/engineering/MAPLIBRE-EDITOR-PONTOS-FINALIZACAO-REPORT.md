# MAPLIBRE-EDITOR-PONTOS-FINALIZACAO-02 — relatório

**Decisão:** D-PROD-67\
**Base:** `origin/main` = `8f489416` (merges #141 e #140), CI `quality` [40891011505](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/40891011505) verde\
**Preflight:** zero PRs abertas, sem conflito a analisar. A branch
`claude/new-session-26kpxu` foi recriada de `origin/main`, porque a #141 já
estava mergeada.\
**Referência (somente leitura):** `CONTROLE-DE-ESTOQUE`, commit `6aef845e`,
`mapa-de-manejo/editor-contorno.tsx` e `camada-desenho.tsx`.

## Referência: comportamento por estado

| Estado | CONTROLE-DE-ESTOQUE |
|---|---|
| Aberto | polilinha + elástico; botão "Fechar polígono" com ≥3 pontos |
| `confirmar()` aberto | `fechar()`: fecha e continua desenhando (manipuladores, meios da aresta de fecho); **não grava** |
| `confirmar()` fechado | `onGravar()` + `sairDoDesenho()`: o editor zera, os manipuladores, cursor e ímã somem, e o contorno fica na ficha como área normal |
| Cor | `corPreview = cor da ficha` (ao vivo) quando fechado |

## Diagnóstico ANTES (main `8f489416`, medido no harness WebGL)

`docs/engineering/evidencias/maplibre-editor-finalizacao/antes/resultado.json`:

- **B:** "Terminar" com a área aberta (4 pontos) **abria o formulário com o
  polígono aberto**. O desenho ficava com `fechado:false`, sem a aresta de
  fecho, com preenchimento 0.1 e **0 meios**
  (`formulario_abriu_com_poligono_aberto: true`, em 1440, 390 e 412).
- **D:** com o formulário aberto, **4 vértices continuavam pintados** e o
  editor seguia ativo por trás. A prévia não usava a cor do formulário: com
  "Laranja" escolhido, `fill: null` e a cor seguia a de rascunho.
- **C (existente):** com o formulário aberto, 4 vértices e 4 meios
  continuavam visíveis.

## Causa raiz

1. `finalizarDesenho()` validava e abria o Sheet sem fechar a área.
   `drawingClosed` ficava `false`, e o sync pintava a área como rascunho aberto.
2. Não havia um estado de **prévia**. O sync de vértices e meios e todos os
   efeitos de interação dependiam só de `modo`, nunca do formulário aberto.
3. A cor do formulário não chegava ao mapa: o editor usava apenas a cor salva
   do item.

## Correção

- **`MapaDesenho.jsx`:**
  - `finalizarDesenho()` fecha primeiro (como `confirmar()`), e o rótulo vira
    "Fechar área";
  - `emPrevia` + `modoInteracao` desligam clique, cursor, hover, arrasto,
    mover e Delete enquanto o Sheet está aberto;
  - a cor de prévia é limpa ao cancelar ou salvar;
  - o efeito de seleção duplicado foi incorporado ao sync.
- **`editorVisual.js`:** `pintarEdicao`, o SSOT do que se pinta em edição e em
  prévia.
- **`FormularioArea.jsx`:** prop opcional `onCorChange`, que só informa a cor
  escolhida.
- **Testes:**
  - `tests/smoke/maplibreEditorFinalizacao.test.jsx` (9 testes);
  - runner `tests/e2e/harness/run-editor-finalizacao.cjs`;
  - `tests/e2e/harness/main.jsx` fecha o editor ao salvar/cancelar, como
    `MapaCadastro`.

## Antes × depois (harness, `resultado.json`)

| Cena | ANTES | DEPOIS |
|---|---|---|
| A aberto (4 pts) | polilinha sem fecho, 0 meios, botão "Terminar" | igual; botão "Fechar área" |
| B 1º comando | formulário abre com polígono **aberto** | **não abre**; `fechado:true`, contorno inteiro, **4 meios** (inclui último→primeiro), modo Editar |
| D formulário | 4 vértices visíveis, editor ativo, cor de rascunho | **0 vértices, 0 meios, 0 seleção**, cruz e ímã ocultos; prévia fechada na cor do formulário (`#69aedb` padrão → `#f6a526` ao escolher Laranja) |
| D cancelar | — | 4 vértices + 4 meios voltam; geometria **idêntica** (1e-12) |
| D clique no mapa com formulário aberto | — | Sheet fecha (cancelar); geometria idêntica; nenhum ponto criado ou movido |
| E salvar | editor seguia montado no harness | editor encerrado (listagem), overlay fora do DOM; gravado com a cor escolhida e as coordenadas iguais ao desenho |
| E área salva | — | aparece em `m1-areas` (`#f6a526`, estilo normal), sem manipuladores |
| E reabrir | 4 vértices + 4 meios | 4 vértices + 4 meios nas coordenadas exatas persistidas; modo Editar; 0 selecionados |
| C existente → formulário | 4 vértices + 4 meios visíveis | 0 manipuladores; prévia na cor salva (`#97cd30`); cancelar restaura |

O mobile (390 e 412, toque) segue A → B → D → cancelar com os mesmos
resultados. Nenhuma cena teve erro de console.

A aparência dos pontos (raios, borda, meios sólidos, alvo de acerto 8/14 px)
continua a da D-PROD-66, sem mudanças. Regressões verdes: `run-geo`,
`run-geo2` (GEO-08 gravar/reabrir, GEO-09 A/B/A), `run-webgl` e
`run-editor-visual`.

## Evidências

`docs/engineering/evidencias/maplibre-editor-finalizacao/{antes,depois}/`, com `resultado.json` e PNG.
- **Polígono fechado com manipuladores:** `1440-B-apos-1o-comando.png`.
- **Formulário aberto sem manipuladores:** `1440-D-formulario-previa.png` e
  `1440-D-formulario-cor-escolhida.png`.
- **Cancelado:** `1440-D-cancelado-edicao-restaurada.png`.
- **Salvo:** `1440-E-salvo-editor-encerrado.png` e
  `1440-E-area-salva-estado-normal.png`.
- **Reaberto:** `1440-E-reaberto-manipuladores.png`.
- **Área existente:** `C-existente-*`.
- **Mobile:** `390-*` e `412-*`.

## Limitações

- Tudo foi provado no **harness sintético**. Não testei no app autenticado nem
  no preview Vercel.
- Não houve teste em aparelho físico nem iOS Safari. O toque foi emulado no
  Chromium.
- Na área nova, antes do formulário, o rascunho fechado continua laranja: o
  formulário só existe depois de "Salvar". Na referência a ficha está sempre
  aberta, então a cor aparece desde o fechamento.
- Os meios aparecem só com a área fechada (Editar), como na máquina de modos
  do MAIKE (D-PROD-65). Na referência eles aparecem também durante o desenho
  aberto. Mantive a regra de modos do MAIKE.
