# MAPLIBRE-PONTOS-MÉDIOS-NO-CADASTRO-03 — relatório

**Decisão:** D-PROD-68\
**Base:** `origin/main` = `d490fad8` (merge #142)\
**Preflight:** working tree limpo e zero PRs abertas. A branch
`claude/new-session-26kpxu` foi recriada de `origin/main`.\
**Referência (somente leitura):** `CONTROLE-DE-ESTOQUE`, commit `6aef845e`:
- `editor-desenho.ts` `acertar`: aberto `n = pts.length − 1`, fechado `n = pts.length`;
- `camada-desenho.tsx`: meios desenhados durante o desenho aberto, ocultos no arrasto;
- `editor-contorno.tsx` `aoPressionar`/`aoSoltar`: no meio, cria o vértice e
  arrasta; ao soltar, sempre registra no histórico. `aoClicar` não adiciona
  ponto quando o clique cai num alvo.

## Diagnóstico ANTES (main `d490fad8`, harness WebGL)

Em `docs/engineering/evidencias/maplibre-meios-cadastro/antes/resultado.json`
(1440, 390 e 412):
- área aberta com 2 pontos: **0 meios** (esperado 1);
- área aberta com 4 pontos: **0 meios** (esperado 3);
- só depois de "Fechar área" os meios apareciam.

**Causa:**
- `pintarEdicao` pintava meios só com `fechado`;
- `buildMidpointsCollection` sempre incluía o último→primeiro para área;
- a interação com meios só existia em EDITAR.

## Depois (mesma sequência)

| Cena | 1440 (mouse) | 390 / 412 (toque emulado) |
|---|---|---|
| 2 pontos | 1 meio, nas arestas certas, sem meio de fecho | idem |
| 4 pontos | 3 meios, sem meio de fecho | idem |
| Hover no meio (6 px) | `hover:true` (r3.4), cruz oculta | — |
| Clique/toque no meio (5 / 10 px) | 5 vértices; o novo no índice 1, **exato** no meio de P0–P1; último continua P3; nenhum ponto final extra; 4 meios | idem |
| Clique em área vazia | adiciona ao fim; os anteriores ficam intactos | idem |
| Desfazer ×2 / Refazer | volta aos 4 originais / reaplica | — |
| Arrastar o meio | 1 só vértice novo, no destino; 0 meios durante o arrasto | idem (arrasto por toque via CDP) |
| Fechar área | meios = n, **inclui o de fecho** | idem |
| Formulário (prévia) | 0 vértices, 0 meios | idem |
| Cancelar | vértices idênticos, meios = n | idem |
| Área existente | 4 meios com o de fecho (como antes) | — |

Nenhuma cena teve erro de console.

## Regressões

- `run-editor-visual` (D-PROD-66): mesmos valores. Elástico 1.0, vértice
  externo 6.0–6.5 / 7.0 no hover, meio 2.5–2.75. A inserção no meio em
  EDITAR passou de erro 0.03 px para **0 px**, porque agora usa o meio exato.
- `run-editor-finalizacao` (D-PROD-67): fechar, prévia sem manipuladores, cor,
  cancelar e salvar/reabrir sem mudanças. A única diferença é a cena A
  (aberto), que agora tem 3 meios, como pedido.
- `run-geo`, `run-geo2`, `run-webgl`: verdes.

## Arquivos

| Arquivo | Motivo |
|---|---|
| `src/lib/maplibre/geojsonBuilders.js` | `buildMidpointsCollection(…, { fechado })`: sem fecho enquanto aberto. O padrão `true` mantém os outros chamadores. |
| `src/lib/maplibre/editorVisual.js` | `pintarEdicao`: meios na área em cadastro. `acertoEditor` aceita `vertices: null` (só meios). |
| `src/components/mapa/MapaDesenho.jsx` | `meiosNoCadastro`: hover e arrasto/inserção só de meios no Desenhar da área aberta; meio exato (`meioDaAresta`); cruz oculta sobre o meio e cursor suspenso durante o arrasto. |
| `tests/smoke/maplibreEditorMeiosCadastro.test.jsx` (novo) | 11 testes: builder A, pintura por estado, acerto só de meios, fonte. |
| `tests/smoke/maplibreEditorFinalizacao.test.jsx` | A cena "A aberto" passa a esperar 3 meios sem o de fecho (a regra mudou por decisão). |
| `tests/e2e/harness/run-editor-meios-cadastro.cjs` (novo) | Prova WebGL antes × depois. |
| `docs/engineering/{DECISIONS,CURRENT-STATE}.md`, este relatório, evidências | D-PROD-68. |

## Limitações

- Tudo foi provado no harness sintético. **Não** testei o app autenticado nem
  o preview Vercel.
- O toque foi emulado no Chromium (tap e arrasto via CDP). Não houve teste em
  aparelho físico nem iOS Safari.
- O arrasto do meio no desktop foi medido com Alt (ímã suspenso). Com o ímã,
  o novo vértice gruda em área vizinha, que é o comportamento esperado.
