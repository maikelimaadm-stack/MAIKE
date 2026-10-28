# MAPLIBRE-M2-A — Captura GPS de áreas e linhas

**Missão:** `MAPLIBRE-M2A-GPS-AREAS-LINHAS-01`  
**Decisão:** **D-PROD-59**  
**Branch:** `cursor/maplibre-m2a-gps-areas-linhas-f5fd`  
**Worktree:** `/home/ubuntu/worktrees/MAIKE-maplibre-m2a`  
**Base `origin/main`:** `ed32521abc57b68202a536ac5229c99464f2224e` (merge PR #127 — MapLibre M1)  
**CI `quality` pós-#127:** run `40779939571` — **success** (Gate 0)  
**PR:** DRAFT se token permitir; senão compare URL (sem duplicar). **Merge = NO-GO** até auditoria manual.

---

## Objetivo

Migrar `CapturaGPSPoligono` de Google Maps JS para **MapLibre GL JS**, preservando
callbacks (`onSalvar` / `onCancelar` / `tipo`), persistência JSONB `[lat,lng]` e
coexistência com Google fora da slice (MapaGeral, pickers, M2-B/M3).

## Entregas

| Item | Estado |
|---|---|
| `CapturaGPSPoligono.jsx` sem `google.maps.*` / `loadGoogleMaps` | feito |
| `src/lib/maplibre/gpsCapture.js` — watch/clearWatch(0), parse, accuracy circle, layers | novo |
| Reuso M1: `geografia/*`, `basemap`, `lifecycle`, `geojsonBuilders` | sim |
| Medidas: `areaHectares` / `comprimentoMetros` / `validate*` (substitui fórmula legado) | sim |
| `FormularioArea` / `FormularioLinha` contratos públicos | preservados (sem mudança quebradora) |
| `CapturaGPSPonto` | **inalterado** (já sem Google) |
| `MapaGeral` / pickers / `googleMaps.js` / `VITE_GOOGLE_MAPS_API_KEY` | **preservados** |
| Supabase / Prisma / RLS / Base1 keyset / D-PROD-57 UI | **não tocados** |
| Docs: D-PROD-59, este relatório, CURRENT-STATE | feitos |

## Comportamento GPS (antigo → novo)

| Aspecto | Legado (Google) | M2-A (MapLibre) |
|---|---|---|
| Motor | `loadGoogleMaps` + `google.maps.Map` | `createEditorMap` + layers GPS |
| Watch | `if (watchId)` (quebra id `0`) | `clearGeolocationWatch` com `id != null` |
| Precisão | Circle criado uma vez, sem update | GeoJSON accuracy atualizado a cada fix |
| Recenter | Sempre `setCenter` a cada fix | Follow opcional + “Centralizar em mim” |
| Área/dist | Grau² equatorial / Haversine local | Turf via `geografia/medidas` |
| Tiles | GPS amarrado a `tilesloaded` no marcador | GPS inicia independente; mapa com retry |
| Satélite | `mapTypeId: satellite` Google | só com `VITE_MAP_SATELLITE_STYLE_URL` |

## Coordenadas

- UI/MapLibre: `[lng, lat]` só nas sources GeoJSON.
- Callback / formulário: `{ lat, lng, accuracy?, timestamp? }`.
- Persistência: `toPersistedCoords` → `[[lat,lng],…]` JSONB (accuracy/timestamp **não** gravados).

## Testes / gates

| Comando | Resultado |
|---|---|
| `tests/smoke/maplibreGpsCapture.test.js` | PASS (13) |
| Demais smoke + gates / `verify:all` | preencher após execução completa |
| `test:backend` | **NOT_RUN** se sem `DATABASE_URL`/Docker |
| E2E browser WebGL mobile | **BLOCKED** neste ambiente agente — validação manual antes do merge |

## Riscos / rollback

- WebGL/tile falha: UI de erro + retry; GPS pode continuar marcar se houver fix.
- Follow GPS desliga no pan do usuário — operador usa “Centralizar em mim”.
- Rollback M2-A: reverter branch/PR; Google permanece nos outros consumidores.
- Próximo: **M2-B** seletores; **M3** Mapa Geral.

## Colisões (Gate 0)

- Zero PRs abertas no preflight; CI main pós-127 success.
- Worktrees paralelos: `/workspace` (supabase), `MAIKE-maplibre-m1` (M1 tip), este M2-A isolado.
- Anti-colisão: sem Base1/keyset, sem RLS Supabase, sem Config Gerais.
