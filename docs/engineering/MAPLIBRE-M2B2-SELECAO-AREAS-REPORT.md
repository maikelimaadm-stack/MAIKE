# MAPLIBRE-M2-B2 — Seleção de áreas no mapa

**Missão:** `MAPLIBRE-M2B2-SELECAO-AREAS-01`  
**Decisão:** **D-PROD-62**  
**Branch:** `cursor/maplibre-m2b2-selecao-areas-01-f5fd`  
**Worktree:** `/home/ubuntu/worktrees/MAIKE-maplibre-m2b2`  
**Base `origin/main`:** `00ab053b819b36b513ddb651883b6f39682128e8` (merge PR #131)  
**CI main:** run `40788297147` — **success**  
**PR:** DRAFT se token permitir; senão compare URL. **Merge = NO-GO** até auditoria.

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
| D-PROD-62 + este relatório + CURRENT-STATE | feitos |

## Basemap

Ruas OpenFreeMap Liberty. Legado usava satélite Maps JS — diferença visual
documentada na UI; satélite MapLibre só com `VITE_MAP_SATELLITE_STYLE_URL`.

## Testes / gates

| Item | Resultado |
|---|---|
| `maplibreSelecaoAreasMapa.test.jsx` | PASS (15) — matriz 1–14 + lifecycle |
| Demais smoke / verify:all | preencher na execução |
| `test:backend` | NOT_RUN/FAIL sem Postgres |
| E2E WebGL | BLOCKED/PENDING |

## Próximo

**M2-B3** — `SelecaoDepositoMapa` (ou fatia seguinte do roadmap MapLibre).
