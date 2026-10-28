# MAPLIBRE-M1 — Editor Cadastro de Áreas (MapLibre)

**Missão:** `MAPLIBRE-M1-EDITOR-AREAS-01` (+ **R5 corretiva**)  
**Decisão:** D-PROD-57  
**Branch:** `cursor/maplibre-m1-editor-areas-f5fd` (mesma; sem nova PR)  
**Base original R4:** `d4e07df960f58acfb9eee65a8ee08909a6d9f7c5`  
**Base após merge R5:** `origin/main` @ `1590655fc9ef080d8d178d270c22f9ec3c50fe1d` (PR #125 Usuários/Permissões — sem interseção com `MapaDesenho`/`maplibre/`)  
**Worktree:** `/home/ubuntu/worktrees/MAIKE-maplibre-m1`  
**PR:** **não aberta** — barreira R4/R5 mantida enquanto configuração de mapa paralela estiver ativa.

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

## Provider de basemap

| Id | Fonte | Status |
|---|---|---|
| `ruas` | OpenFreeMap Liberty `https://tiles.openfreemap.org/styles/liberty` | real / atribuição OSM + OpenFreeMap |
| `satelite` | `VITE_MAP_SATELLITE_STYLE_URL` | **não configurado** neste ambiente — botão informa "Satélite não configurado" e permanece em ruas |

Não se usa a chave `VITE_GOOGLE_MAPS_API_KEY` como autorização da Google Map Tiles API. Não há demotiles em produção.

## Contrato de dados

- Persistência continua `[lat, lng]` no JSONB; GeoJSON só na UI (`[lng, lat]`, anel fechado).
- Round-trip coberto por testes; closing vertex não é regravado.
- `tamanho_hectares` / `comprimento_metros` calculados com Turf no submit do formulário do editor; **não** há recalculo em massa das áreas remotas.

## Diferenças conhecidas

1. **ImportarGeoJSON** ainda usa cálculo projetado antigo — não refatorado (fora do slice).
2. **GPS** (`CapturaGPSPoligono`) permanece Google até M2; integração pelo formulário preservada.
3. Default visual do basemap no editor M1 é **ruas** (satélite sem licença). Preferência: ao reconciliar com o trabalho visual paralelo, preservar o visual final da outra configuração.
4. Medidas Turf podem divergir levemente de `google.maps.geometry.spherical` (tolerância geodésica); testes fixam ordem de grandeza, não bit-identity com Google.
5. Ícones de ponto com `icone_url` usam `maplibregl.Marker` HTML; pontos sem ícone usam layer circle.

## Lifecycle / freeze

- Uma instância MapLibre por montagem; `map.remove()` no unmount; flag cancelled impede late-init.
- Troca de basemap via `setStyle` + reaplicação das layers de negócio.
- Não altera `App` / `Layout` / `AppRouteContent` / `MapaGeral`.

## Colisões

- Trabalho paralelo de mapa declarado pelo proprietário (pode ser invisível no GitHub).
- Branch `cursor/alteracoes-visuais-26e2` existe (UX Base1/Marcas); no instante da auditoria **não** havia diff de arquivos `mapa/*` vs `main`, mas o protocolo R4 exige **não abrir PR** até declaração de conclusão + reconciliação.
- Zero PRs abertas no início; push da branch M1 é permitido para preservar progresso; merge/PR Draft só após gate do proprietário.

## Testes / gates (evidências)

| Comando | Resultado |
|---|---|
| `gate:supabase-public-grants` | PASS |
| `gate:area-pastagem-native` | PASS |
| `gate:map-geography-native` | PASS |
| `gate:product-scope` | PASS |
| `gate:api-boundary` | PASS |
| `gate:import-integrity` | PASS |
| `gate:source-closure` | PASS |
| `gate:types` | PASS (dívida ↓; zero diagnóstico novo nos módulos M1) |
| `lint` | PASS (2 warnings pré-existentes fora do M1) |
| `test:smoke` | PASS — **749** testes |
| `test:gates` | PASS |
| `build` | PASS (~3,4 MB JS com maplibre-gl; CSS +maplibre) |
| `verify:all` | **1 falha:** `test:backend` — `DATABASE_URL` ausente; Docker indisponível neste ambiente → **NOT_RUN** (não executado contra Supabase remoto) |

E2E browser real (desenhar/editar/salvar): **não executado** neste ambiente cloud (sem browser automation solicitada neste slice). Cobertura automatizada via Vitest + mock MapLibre lifecycle.
