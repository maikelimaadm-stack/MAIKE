# MAPLIBRE-EDITOR-PARIDADE-VISUAL-01 — relatório

**Decisão:** D-PROD-66\
**Base:** `origin/main` = `e8540e7d` (merge #139), CI `quality` [40876450764](https://github.com/maikelimaadm-stack/MAIKE/actions/runs/40876450764) verde\
**Preflight:** havia zero PRs abertas e o working tree estava limpo. A branch
`claude/new-session-26kpxu` foi recriada a partir de `origin/main`, porque a
#139 já estava mergeada.\
**Referência visual (somente leitura):** `CONTROLE-DE-ESTOQUE`, commit `6aef845e`,
`apps/web/src/features/mapa-de-manejo/camada-desenho.tsx`, mais
`editor-contorno.tsx` (cursor, pan, rótulos) e `editor-desenho.ts` (`rumoGraus`).

## Objetivo

Deixar o desenho e a edição de polígonos no MAIKE com o mesmo acabamento visual
do editor do CONTROLE-DE-ESTOQUE (linhas, pontos, meios, cursor, ímã, Shift),
sem copiar layout, menus, formulários ou domínio, e sem alterar o Mapa Geral.

## Como foi provado

Novo runner WebGL real (Chromium + SwiftShader), `tests/e2e/harness/run-editor-visual.cjs`.
- Ele roda a **mesma sequência** contra `main` (ANTES, worktree em `e8540e7d`)
  e contra a branch (DEPOIS).
- Mede **no PNG da tela**, com DPR 2:
  - solidez da linha (fração de pixels laranja ao longo do segmento);
  - raio visível de vértices e meios (mediana de 8 direções).
- Registra paint e layout das camadas, a ordem das camadas, o `feature-state`
  e o estado do overlay.
- Os dados são sintéticos, do harness: **não** é o app autenticado nem o
  preview da Vercel.

Evidências: `docs/engineering/evidencias/maplibre-editor-visual/{antes,depois}/`.
Cada pasta tem um PNG por cena (recorte; `02` e `09` também com a tela inteira, `-tela`) e um
`resultado.json`.

## Referência × antes × depois

| # | Elemento | Referência (`camada-desenho.tsx`) | ANTES (main, medido) | DEPOIS (medido) | Status |
|---|---|---|---|---|---|
| 1 | Linha entre pontos | sólida 2.2, join/cap round | sólida 2.2, sem `line-join/cap` | solidez 1.0; layout `round/round` | PASS |
| 2 | Elástico último→cursor | **sólido** 2.2, cap round | tracejado `[1.5,1.5]`, opacidade 0.9 — **solidez 0.44** | **solidez 1.0** (`01`), 1.0 com Shift (`06`) | PASS |
| 3 | Rascunho aberto | polilinha **sem** lado de fecho; fill 0.1 | contorno do polígono **com** fecho — solidez P2→P0 **0.945**; fill 0.35 | P2→P0 **0** (`01b`); fill 0.1 aberto / 0.18 fechado | PASS |
| 4 | Vértice normal | r5 branco + borda laranja 2.4 (externo ≈6.2) | `circle-radius` 5 + stroke 2.4 → externo ≈7.4 (stroke do MapLibre é por fora) | raio MapLibre 3.8 (= 5 − 2.4/2); externo medido 6.0–6.5 | PASS |
| 5 | Vértice hover/arrasto | r5.6, mesmo branco/laranja | sem hover; selecionado = disco laranja r8 | `feature-state ativo` → 4.4 (=5.6−1.2); externo 7.0 (`03`, `07`) | PASS |
| 6 | Selecionado (remover) | — (referência não tem) | disco laranja r8 com borda branca | mesmo vértice ativo + anel discreto r8/1.6 (`m1-vertices-selecao`) | PASS (decisão) |
| 7 | Meio da aresta | laranja **sólido** r2.8, sem borda; hover r3.4 | r3.5, opacidade 0.55, borda 1 | r2.8 sólido sem borda; hover r3.4 por `feature-state` (medido 2.75 → 3.5) | PASS |
| 8 | Acerto do meio | `RAIO_MEIO` 8 | só acerto pontual (evento da camada): clique a 6 px **não inseria** | mouse 8 px / toque 14 px: clique a 6 px insere com erro **0.03 px**; toque a 12 px insere (390 e 412) | PASS |
| 9 | Cruzinha livre | cruz 7 px, 1.8, cap round | inexistente | overlay SVG `pointer-events:none`; some com ímã, no pan, fora do canvas e no toque | PASS |
| 10 | Ímã vértice / fechamento | anel r8 / 1.6 + cruz; fechar = ponto branco r4.2 | inexistente (só toast "Encaixado!") | anel+cruz no alvo (`05-ima-vertice`); anel + ponto branco no 1º ponto (`05b`) | PASS |
| 11 | Ímã aresta | faixa 5 px α .22 + linha 2 px | inexistente | camadas `m1-ima-aresta-halo` / `m1-ima-aresta` (solidez 1.0, `05-ima-aresta`) | PASS |
| 12 | Shift 45° | elástico sólido + **guia adicional** pontilhada 4/6, 1.2, ×1.35 + rumo em graus | uma única linha tracejada | elástico sólido (1.0, 45°) + `m1-guia-shift` pontilhada + rótulo "45°" (`06`) | PASS |
| 13 | Área existente em edição | fill e linha na cor salva | fill na cor salva; **linha laranja** | linha e fill na cor salva (contorno medido `#97cd30` ≈ `#92ca25`+5% branco, `09`) | PASS |
| 14 | Rótulos das áreas gravadas | ocultos enquanto desenha (`ocultarRotulos={desenhando}`) | visíveis e cobrindo vértices | ocultos em DESENHAR/EDITAR/MOVER; voltam no NAVEGAR | PASS (decisão) |
| 15 | Ordem das camadas | aresta ímã → fill → contorno → elástico → guia → meios → vértices → cursor | meios **acima** dos vértices | ordem da referência (registrada em `resultado.json`) | PASS |

Nota sobre o item 4: o SVG centraliza o traço no raio, enquanto o MapLibre
desenha `circle-stroke` fora do `circle-radius`. Por isso o raio MapLibre é
`raio SVG − borda/2` (`raioCirculoMapLibre`).

## Critérios VIS

| Critério | Resultado | Evidência |
|---|---|---|
| VIS-01 linha e fecho | **PASS** | `01`, `01b`, `02`. Contorno P3→P0 sólido 1.0 depois de fechar. Fill e contorno continuam pintados após pan e retorno (`08`: `renderizadas: 1`, retorno 0 px). |
| VIS-02 elástico | **PASS** | Solidez 1.0. Some fora do canvas (`06b`), durante o pan (`06c`), no NAVEGAR/EDITAR/MOVER (`08`, `08b`) e após toque (`10_*_aberto`: guia vazia). A guia Shift é adicional (`06`). |
| VIS-03 vértices | **PASS** | Externo 6.0–6.5 normal e 7.0 ativo, igual no desktop e no mobile (DPR 2). |
| VIS-04 meio | **PASS** | r2.8 → r3.4. Clique a 6 px e toque a 12 px inserem. Inserção no meio exato. Undo usado no runner. O mínimo de vértices é preservado (`removerVertice` inalterado). |
| VIS-05 ímã | **PASS** | `05-ima-vertice` (`data-tipo=vertice`), `05-ima-aresta` (aresta destacada), `05b` (fechar). Alt suspende (`05c`: sem ímã). Pan limpa. Regra do snap congelada: os testes provam alvo idêntico entre `findNearestSnap` e `findNearestSnapDetalhado`. |
| VIS-06 cursor | **PASS** | Overlay com `pointer-events: none`. Atualização imperativa, sem estado React por mousemove. Cursor do sistema: crosshair no DESENHAR, move/copy no hover de vértice/meio. |
| VIS-07 cor e transparência | **PASS** | Rascunho laranja 0.1/0.18. A área existente usa a cor salva no fill (0.78) e no contorno. Nada visual é persistido. O Mapa Geral não foi tocado. |
| VIS-08 troca de modo | **PASS** | NAVEGAR: pan de 140×100 px sem criar ou mover pontos (4 → 4). EDITAR: hover e arrasto. MOVER: sem hover, cruz ou ímã (`08b`). |
| VIS-09 estabilidade | **PASS (harness)** | Mapa → Satélite → Mapa no editor (`11`, tiles interceptados): ordem e camadas mantidas, fill/linha/vértices/meios renderizados, zero erros. `run-geo`, `run-geo2` (GEO-08 gravar/reabrir, GEO-09 empresa A/B/A), `run-webgl` e `run-satelite` verdes. Sem console error nem warning WebGL em nenhuma cena. 390/412 sem scroll horizontal. |
| VIS-10 proteção | **PASS** | Sem dependência nova. Formulários, persistência, ícones, backend e satélite inalterados. |
| VIS-11 evidência | **PASS** | Medição em pixels mais paint, layers e estado em `resultado.json`, ANTES × DEPOIS. |
| VIS-12 qualidade | ver Testes | — |

## Arquivos

| Arquivo | O que mudou |
|---|---|
| `src/lib/maplibre/estiloAreas.js` | Tokens `EDITOR_VISUAL`, `raioCirculoMapLibre` e funções de paint do editor. `OPACIDADE_FILL_DESENHO` passa de 0.35 para 0.18 (fechado), mais 0.1 para o aberto. Áreas cadastradas: inalteradas. |
| `src/lib/maplibre/lifecycle.js` | Camadas do editor na ordem da referência. Novas camadas: guia Shift, aresta do ímã e anel de seleção. Inclusão idempotente. |
| `src/lib/maplibre/geojsonBuilders.js` | `buildDesenhoCollection(..., { fechado })`: o rascunho aberto tem polilinha sem fecho, e o padrão continua `true` (GPS e outros callers inalterados). `buildGuiaCollection` agora gera feições tipadas. |
| `src/lib/maplibre/snap.js` | `findNearestSnapDetalhado` (vértice/aresta). `findNearestSnap` delega a ele com o mesmo resultado. |
| `src/lib/maplibre/editorVisual.js` (novo) | `resolverAlvoDesenho` (mesmo alvo para cursor e clique), `acertoEditor` (tolerância 8/14), `rumoGraus`, `pontaGuiaShift`. |
| `src/components/mapa/CursorEditorOverlay.jsx` (novo) | Cruz, anel do ímã e rumo (SVG, `pointer-events: none`, imperativo). |
| `src/components/mapa/MapaDesenho.jsx` | Efeito do cursor (DESENHAR) e hover (EDITAR). Acerto pelo mapa. Meio: clique insere no meio, arrasto cria e arrasta. Ímã visível no arrasto. Rótulos ocultos fora do NAVEGAR. Limpeza em pan, troca de modo e unmount. |
| `tests/smoke/maplibreEditorParidadeVisual.test.jsx` (novo) | 19 testes: tokens, camadas, dados, snap, alvo, acerto, overlay. |
| `tests/smoke/maplibreAreasUnificacao.test.jsx` | Asserção de texto atualizada: a expressão de fill mudou para o SSOT de estilo, sem afrouxar o teste. |
| `tests/e2e/harness/run-editor-visual.cjs` (novo) | Prova visual ANTES × DEPOIS. |
| `docs/engineering/{DECISIONS,CURRENT-STATE}.md`, este relatório, evidências | D-PROD-66. A #139 aparece como mergeada. |

**Sem alteração:**
- `src/pages/MapaGeral.jsx`, `useMapRenderer.jsx`, `mapaGeralRender.js`;
- formulários, catálogo de ícones, `ModalCadastroLotePontos`;
- backend, Prisma, RLS;
- satélite e Google;
- workflows, baselines, manifests.

## Testes

- `git diff --check`: limpo.
- Testes focados: 49/49 (`maplibreEditorParidadeVisual` + `maplibreAreasUnificacao`).
- `npm run verify:all`, com PostgreSQL 16 local real para `test:backend`:
  **PASS**, 29/29 etapas. `test:smoke` teve 891/891 testes em 72 arquivos, e
  `test:backend`, `types`, `lint` e `build` passaram.
- `npm run build`: **PASS**. Fica só o aviso de chunk size, que é anterior a
  esta missão.
- `gate:types` reduziu a dívida (1339 → 1337). O baseline **não** foi
  atualizado, porque baselines estão fora do escopo.
- E2E WebGL: desktop 1440 e mobile 390/412 (toque), além de `run-geo`,
  `run-geo2`, `run-webgl` e `run-satelite`.

## Limitações

- Toda a prova é no **harness sintético**. Não testei no app autenticado nem
  no preview protegido da Vercel (SSO).
- O satélite foi provado só com tiles interceptados (fixture). A imagem real do
  Google continua sem verificação (ver D-PROD-65).
- Não houve teste em iPhone/Android físico. O toque foi emulado no Chromium
  (`hasTouch`, `isMobile`). Pinça real e Safari iOS não foram testados.
- O ganho do overlay imperativo (sem re-render por mousemove) foi inferido do
  código, sem medição de frame time.
