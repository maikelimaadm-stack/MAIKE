# MAPLIBRE-M2-B1 — Seletor local de tarefas (TaskLocationPickerDialog)

**Missão:** `MAPLIBRE-M2B1-TASK-LOCATION-PICKER-01`  
**Decisão:** **D-PROD-61** (D-PROD-60 = catálogo global #130 — preservada)  
**Branch:** `cursor/maplibre-m2b1-task-location-picker-f5fd`  
**Worktree:** `/home/ubuntu/worktrees/MAIKE-maplibre-m2b1`  
**Base `origin/main`:** `aa340b526b96f8d9be57acaa1c4964b34ccb0d77` (merge PR #130)  
**HEAD:** `ac1b80630ecefb219d5b18ed487046fe8e3fe64c`  
**PR create via `gh`:** `Resource not accessible by integration` — abrir **uma** DRAFT na UI:  
https://github.com/maikelimaadm-stack/MAIKE/compare/main...cursor/maplibre-m2b1-task-location-picker-f5fd?expand=1  
**Merge = NO-GO** até auditoria manual.

---

## Objetivo

Migrar **somente** `TaskLocationPickerDialog.jsx` de Maps JS → MapLibre, preservando
o contrato com `FormularioTarefaMapa` e coexistência Google fora da slice.

## Entregas

| Item | Estado |
|---|---|
| `TaskLocationPickerDialog.jsx` sem `loadGoogleMaps` / `google.maps.*` | feito |
| `src/lib/maplibre/taskLocationPicker.js` — PIP, centroid, layers, overlap rule | novo (1 helper) |
| Reuso M1/M2-A: basemap, lifecycle, geografia | sim |
| Fix `c[0]\|\|c.lat` (zero válido) | feito |
| Labels `textContent` (sem `innerHTML` XSS) | feito |
| `listarIconesDaEmpresa` (não catálogo global) | preservado |
| `FormularioTarefaMapa` | **inalterado** (contrato) |
| `googleMaps.js` / MapaGeral / SelecaoAreas / CapturaGPS | **preservados** |
| Docs D-PROD-61 + este relatório + CURRENT-STATE | feitos |

## Visual / basemap

| Antes | Depois |
|---|---|
| `mapTypeId: "satellite"` (Maps JS) | Ruas OpenFreeMap Liberty |
| — | Satélite só se `VITE_MAP_SATELLITE_STYLE_URL` licenciada; senão mensagem honesta, **sem** botão falso |

## Contratos

- `onSelect({ lat, lng }, area | null)` uma vez por abertura → `onOpenChange(false)`
- Escape/X/fora: só fecha, sem `onSelect`
- Sobreposição: primeira área na ordem do array; clique em fill usa `properties.id`
- `initialCoordinates` inclui `{0,0}`; `fitBounds` / centroid seguros
- Late query (`tarefas`/`icones`) redesenha overlays sem recriar mapa
- `empresaSelecionadaId` nas queryKeys → refetch

## Testes / gates (evidências deste agente)

| Comando | Resultado |
|---|---|
| Gate 0: 0 PRs abertas; main = merge #130 `aa340b52` | OK |
| CI quality main tip (`40784956215`) | **success** |
| `maplibreTaskLocationPicker.test.js` | PASS (12) |
| `npm run test:smoke` | PASS — **804** testes (MAP15 ajustado ≥2 geometry) |
| `test:gates` / product-scope / import / source-closure / map-geography / types / tenancy / supabase-public-grants / … | PASS |
| `typecheck:backend` / `lint` / `build` | PASS |
| `npm run verify:all` | FAIL **somente** `test:backend` |
| `test:backend` | **FAIL** — sem Docker/Postgres local (não usar Supabase MAIKE) |
| E2E WebGL mobile/desktop | **BLOCKED** — validação manual antes do merge |
| `git diff --check` | PASS |

## Quando o picker deixa de depender de Google

Nesta branch: `TaskLocationPickerDialog` não importa `@/lib/googleMaps` nem chama
`google.maps.*`. Outros consumidores (`MapaGeral`, `SelecaoAreasMapa`, …) e
`src/lib/googleMaps.js` **continuam** Google (prova nos smoke).

## Próximo

**M2-B2** — `SelecaoAreasMapa`.
