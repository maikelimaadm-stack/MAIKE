# MAPLIBRE-M1 — Editor Cadastro de Áreas (MapLibre)

**Missão:** `MAPLIBRE-M1-EDITOR-AREAS-01` (R4 + R5 + **R6 pós-#126**)  
**Decisão MapLibre:** **D-PROD-58** (D-PROD-57 da PR #126 = Configurações Gerais / catálogo global — preservada)  
**Branch:** `cursor/maplibre-m1-editor-areas-f5fd`  
**Base original R4:** `d4e07df960f58acfb9eee65a8ee08909a6d9f7c5`  
**Base após merge R5:** `1590655fc9ef080d8d178d270c22f9ec3c50fe1d` (PR #125)  
**Base após merge R6:** `origin/main` @ `fbbf8363bd382847b5cdc086ab8b37c01ec5aa0c` (PR #126)  
**Worktree:** `/home/ubuntu/worktrees/MAIKE-maplibre-m1`  
**PR:** DRAFT autorizável após R6 (ver seção R6); **merge = NO-GO** até auditoria do arquiteto + aprovação manual.

---

## Objetivo

Migrar o editor do **Cadastro do Mapa** (`MapaDesenho` usado por `MapaCadastro`) de Google Maps JS para **MapLibre GL JS**, preservando botões, formulários, APIs, modos área/ponto/linha e o contrato JSONB `{ coords: [[lat,lng],...], cor }`.

## O que entrou

| Item | Estado |
|---|---|
| `maplibre-gl` + `@turf/area` / `@turf/length` / `@turf/helpers` | dependências |
| `src/lib/geografia/` — adapters + medidas geodésicas | novo |
| `src/lib/maplibre/` — basemap, estilo, lifecycle, snap, GeoJSON builders | novo |
| `MapaDesenho.jsx` — motor MapLibre (área/linha/ponto, undo/redo, snap, labels) | migrado |
| `FormularioArea` / `FormularioLinha` — sem `google.maps.geometry`; fix `0` vs ausente | migrado |
| `CapturaGPSPoligono` | **inalterado** (ainda Google; M2) |
| `MapaGeral` / `useMapRenderer` / pickers | **inalterados** (ainda Google; M3) |
| Supabase / Prisma / RLS / grants | **inalterados** |
| Base1 / Marcas keyset | **inalterados** |
| Catálogo global ícones (D-PROD-57 #126) | **não implementado** neste slice; leitura legado compatível |

## Provider de basemap

| Id | Fonte | Status |
|---|---|---|
| `ruas` | OpenFreeMap Liberty `https://tiles.openfreemap.org/styles/liberty` | real / atribuição OSM + OpenFreeMap |
| `satelite` | `VITE_MAP_SATELLITE_STYLE_URL` | **não configurado** — UI: "Satélite não configurado" |

Não se usa `VITE_GOOGLE_MAPS_API_KEY` como autorização da Google Map Tiles API.

## Contrato de dados

- Persistência: `{ coords: [[lat,lng],...], cor }` JSONB; GeoJSON `[lng,lat]` só na UI.
- Round-trip testado; closing vertex não regravado; `0` válido; geometria legada corrupta bloqueia save destrutivo.
- Sem migration Prisma/PostGIS; 4 áreas remotas não tocadas.

## Lifecycle / freeze

- Uma instância MapLibre por montagem; `map.remove()` no unmount.
- Troca de basemap via `setStyle` + rehydrate completo (sources + overlays).
- Não altera `App` / `Layout` / `AppRouteContent` / `MapaGeral`.

## R5 — correções de interação (2026-10-28)

| ID | Correção |
|---|---|
| R5-01 | Removido `map.project([])` morto; hit-test `[x,y]` |
| R5-02 | Fechar só no primeiro vértice |
| R5-03 | Transação de drag / undo |
| R5-04 | Touch handlers; E2E mobile BLOCKED |
| R5-05 | Style swap cancel + rehydrate GeoJSON |
| R5-06 | Retry via `mapEpoch` |
| R5-07 | `resolvePontoIconUrl` legado |
| R5-08 | Validação save + limpeza empresa |

## R6 — pós-merge PR #126 (2026-10-28)

| ID | Correção |
|---|---|
| R6-01 | SSOT `rebuildOverlayMarkers` — style swap reconstrói labels/ícones (não `clearLabels` solto) |
| R6-02 | `retryMap` sem `innerHTML=''` prematuro; só epoch + cancel style |
| R6-03 | Fluxos clique/close/drag/undo mantidos; sem reintroduzir `map.project([])` |
| R6-04 | Contrato JSONB + `inspectVertices` / validate* preservados |
| R6-05 | Sem catálogo global; leitura legado `ConfiguracaoIcone` |
| R6-06 | Google remanescente fora do editor; E2E WebGL = BLOCKED neste ambiente |
| R6-07 | Satélite só via style URL licenciada |
| Docs | D-PROD-57 (#126) preservada; MapLibre renumerado para **D-PROD-58** |

**Colisão docs:** único overlap com main foi `DECISIONS.md` — resolvido semanticamente. Worktree `/workspace` limpo; zero PRs abertas no preflight R6. Branch local `cursor/config-gerais-separacao-mapa-516d` já mergeada (#126). Trabalho local de mapa paralelo não visível em outros worktrees neste VM.

## Testes / gates (preencher na execução R6)

Ver seção final após `verify:all`.

## Vereditos

| Critério | Veredito |
|---|---|
| PR DRAFT | **GO** se gates executáveis PASS e zero PRs abertas no momento do create |
| MERGE | **NO-GO** até auditoria do arquiteto + aprovação manual do proprietário |
| E2E WebGL / backend Postgres | **BLOCKED/NOT_RUN** — limitações de ambiente, documentadas |
