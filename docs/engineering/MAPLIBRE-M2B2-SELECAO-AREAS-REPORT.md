# MAPLIBRE-M2-B2 — Seleção de áreas no mapa

**Missão:** `MAPLIBRE-M2B2-SELECAO-AREAS-01`  
**Decisão:** **D-PROD-63** (D-PROD-62 = catálogo slice 1 R1 #132 — preservada)  

**Branch:** `cursor/maplibre-m2b2-selecao-areas-01-f5fd`  
**Worktree:** `/home/ubuntu/worktrees/MAIKE-maplibre-m2b2`  
**Base `origin/main`:** `00ab053b819b36b513ddb651883b6f39682128e8` (merge PR #131)  
**HEAD:** `db892fd01ce25725d520fb75b4cf97177eda76b8`  
**CI main:** run `40788297147` — **success**  
**PR DRAFT:** **HOLD_OPEN_PR** — #132 aberta no push; não criar segunda PR.  
Compare (abrir DRAFT só quando #132 fechar):  
https://github.com/maikelimaadm-stack/MAIKE/compare/main...cursor/maplibre-m2b2-selecao-areas-01-f5fd?expand=1  
**Merge = NO-GO** até auditoria.

---

## Objetivo

Migrar **somente** `SelecaoAreasMapa.jsx` de Maps JS → MapLibre, preservando API
pública e callers (`MapaCadastro`, `FormularioPonto`).

## Entregas

| Item | Estado |
|---|---|
| `SelecaoAreasMapa.jsx` sem `loadGoogleMaps` / `google.maps` / `createRoot` overlay | feito |
| `src/lib/maplibre/selecaoAreasMapa.js` | novo |
| Multi-select, preselect, batch (aproveitamento/uso/cultura/cor/renumerar) | feito |
| Zero-safe coords; labels `textContent`; fitBounds inicial; lote parcial; renumeração fail-fast | feito |
| `FormularioPonto` / `MapaCadastro` | **inalterados** |
| `SelecaoDepositoMapa` / `googleMaps.js` / MapaGeral | **preservados** |
| D-PROD-63 + este relatório + CURRENT-STATE | feitos |

## Basemap

Ruas OpenFreeMap Liberty. Legado usava satélite Maps JS — diferença visual
documentada na UI; satélite MapLibre só com `VITE_MAP_SATELLITE_STYLE_URL`.

## Testes / gates (evidências)

| Item | Resultado |
|---|---|
| Gate 0: main `00ab053b`, CI `40788297147` success, 0 PRs | OK |
| `maplibreSelecaoAreasMapa.test.jsx` | PASS (15) |
| `npm run test:smoke` | PASS — **819** |
| gates types/product-scope/import/source-closure/map-geography/backend-types/lint/build | PASS |
| `verify:all` | FAIL só `test:backend` (sem Postgres Docker) |
| E2E WebGL | **BLOCKED** — validação manual antes do merge |

## Próximo

**M2-B3** — `SelecaoDepositoMapa` (ou fatia seguinte do roadmap MapLibre).
