# MAPLIBRE-M2B3-SELECAO-DEPOSITO-01 — Relatório

**Decisão:** D-PROD-64\
**Base:** `origin/main` = `91a11e16a6dc171a81e9debadbd3aade808b5065` (merge #133). CI `quality` da base: run `40846032903` — **success**.\
**Branch:** `claude/new-session-26kpxu` (branch designada pela sessão Claude Code; nenhuma outra branch/PR criada para esta missão).\
**PRs abertas no preflight:** 0.\
**Agente:** Claude Code (handoff do Cursor).

## Escopo entregue

| Arquivo | Mudança |
|---|---|
| `src/components/mapa/SelecaoDepositoMapa.jsx` | Reescrito em MapLibre GL JS; zero `google.maps`/`loadGoogleMaps` |
| `src/lib/maplibre/selecaoDepositoMapa.js` | **Novo** — helpers puros (filtro, ícone, distância, linha, bounds, aspecto, layers) |
| `tests/smoke/maplibreSelecaoDepositoMapa.test.jsx` | **Novo** — 13 testes (helpers + integração DOM com MapLibre mockado) |
| `tests/smoke/googleMaps.test.js` | MAP15: `SelecaoDepositoMapa` saiu da lista de consumidores de `geometry` |
| `tests/smoke/maplibreSelecaoAreasMapa.test.jsx`, `tests/smoke/maplibreTaskLocationPicker.test.js` | Prova "Google ainda tem consumidor" passa a apontar para `ModalCadastroLotePontos` (o depósito deixou de ser consumidor) |
| `docs/engineering/DECISIONS.md`, `CURRENT-STATE.md` | D-PROD-64; linha de estado M2-B2 → mergeada, M2-B3 em PR DRAFT |

Arquivos congelados (`MapaGeral`, `useMapRenderer`, `MapaDesenho`, `SelecaoAreasMapa`,
`TaskLocationPickerDialog`, `ModalCadastroLotePontos`, `FormularioPonto`, `backend/**`,
workflows, `CLAUDE.md`, manifests, catálogo): **não tocados**. Nenhuma dependência nova.

## Contratos preservados

- Props `cochoCoords`, `depositoSelecionadoId`, `onSelect`, `onClose` — idênticas.
- Clique/toque/Enter (marker é `<button>`) → `onSelect(deposito.id)` **uma vez**.
- `Confirmado` (desabilitado sem `depositoSelecionadoId`, como antes) e `Cancelar`/`X` → só `onClose()`.
- Queries: mesmas funções e mesmas `queryKey`s por empresa; mesmo filtro empresa/ativo.
- Ícone: legado `icone_url` dos pontos de referência; mesma política de correspondência
  nome **ou** sigla, primeira referência ativa da empresa (ordem da API). Catálogo global não usado.

## Bugs do legado cobertos

1. Zero como coordenada: `parseVertex`/`isValidLatLng` (teste com `0,0` e `lat 0`).
2. Lifecycle: instância única (só retry recria), `map.remove()` via `createEditorMap.dispose`, timers/handlers limpos, sem refit em mudança de seleção/hover.
3. Distância: `comprimentoMetros` (Turf) — sem SDK; teste `0 m` e ~111 m para 0,001° no equador.
4. Ícone assíncrono: `onload/onerror` checam `entry.dead`, são anulados no cleanup; restyle usa estado atual (sem resultado obsoleto). Ícone quebrado → círculo estável.
5. Confirmação: testado que cancelar/fechar não chamam `onSelect` e confirmar não reenvia.
6. Matching: determinístico (primeira ocorrência), dedupe de depósito por id, referências de outra empresa/inativas ignoradas — política inalterada.

Também: troca de empresa limpa hover e refaz fit; dados da empresa anterior não aparecem (query keyed + filtro em `buildDepositos`); erro de consulta, erro de tiles/estilo, falha WebGL e estado vazio são exibidos; safe-area em topo/rodapé; DOM só com `textContent`/atributos (sem `innerHTML`).

Mudança visual consciente: basemap ruas (OpenFreeMap Liberty) em vez do satélite Google; satélite só via `VITE_MAP_SATELLITE_STYLE_URL` (o painel mostra a nota quando não configurado).

## Validação

| Comando | Resultado |
|---|---|
| `npm ci` | OK |
| `npx vitest run tests/smoke/maplibreSelecaoDepositoMapa.test.jsx` | 13/13 PASS |
| `npm run test:smoke` | 70 arquivos / 832 testes PASS |
| `npm run verify:all` (local, PostgreSQL 16 efêmero local em `localhost`, sem banco externo) | **TODAS AS ETAPAS PASSARAM** (inclui `test:gates`, todos os gates, `gate:types`, `typecheck:backend`, `lint`, `test:backend`, `build`) |
| `git diff --check` | limpo |

**WebGL real desktop/mobile: BLOCKED** — o container não tem acesso ao basemap externo nem sessão autenticada do app; os testes DOM mockam o MapLibre (não são E2E). Validação manual pedida ao proprietário no preview Vercel da PR:

1. Abrir um cocho no Mapa Geral → Formulário do ponto → "Selecionar no mapa" (desktop e celular).
2. Conferir: cocho verde, depósitos com ícone ou círculo vermelho, toque seleciona (azul + painel com nome/distância em m), linha tracejada cocho→depósito.
3. Confirmado fecha e o formulário mostra o depósito escolhido; Cancelar fecha sem alterar.
4. Sem rede/tiles: mensagem "Mapa indisponível" + "Tentar novamente".

## Riscos

- Diferença visual satélite → ruas (documentada, mesma política das fatias M1–M2-B2).
- Sem E2E WebGL automatizado nesta fatia.
- Google ainda presente em `ModalCadastroLotePontos` e `MapaGeral` (M3/M4).
