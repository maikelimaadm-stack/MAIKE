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
- `Confirmado` e `Cancelar`/`X` → só `onClose()`. Desde a R1, `Confirmado` só habilita quando `depositoSelecionadoId` existe na lista filtrada da empresa atual (ver R1-02); o fechamento continua sem `onSelect` extra.
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

## Rodada R1 — auditoria corretiva (`MAPLIBRE-M2B3-SELECAO-DEPOSITO-01-R1`)

HEAD antes: `73a2f914b8198b24dfe91ba402ae369db0e45f49` (CI `quality` run `40849245132` = success).\
HEAD depois: ver commit `fix(maplibre-m2b3): R1 …` na mesma branch; CI do novo HEAD registrado na PR #134.\
Mesma branch `claude/new-session-26kpxu`, mesma PR #134 (DRAFT). Nenhuma outra branch/PR criada.\
PRs abertas no Gate Zero: #134, #135 (splash: `src/App.jsx`, `SplashScreen.jsx`) e #136 (catálogo global R2: `backend/**`, `CLAUDE.md`, relatório próprio) — sem arquivo em comum com esta missão; o proprietário autorizou seguir.

Arquivos alterados na R1: `src/components/mapa/SelecaoDepositoMapa.jsx`, `src/lib/maplibre/selecaoDepositoMapa.js`, `tests/smoke/maplibreSelecaoDepositoMapa.test.jsx`, este relatório.

| Item | Achado | Correção |
|---|---|---|
| R1-01 | Dois cliques/toques rápidos no mesmo marcador chamavam `onSelect` duas vezes | `ultimoEmitidoRef`: não reemite o mesmo id antes do prop mudar; sincronizado com `depositoSelecionadoId`. Sem debounce/timer: a 1ª ativação é imediata e A→B→A emitem todas. `stopPropagation` mantém o clique fora do mapa. Assinatura `onSelect(id)` e `onClose` inalteradas |
| R1-02 | `Confirmado` habilitava com id obsoleto (outra empresa, inativado) | `resolverDepositoSelecionado` (compara ids como string) valida contra a lista filtrada da empresa atual; `Confirmado` desabilitado se inválido, carregando ou com erro; aviso discreto "O depósito vinculado não está disponível nesta empresa"; formulário não é mutado |
| R1-03 | Piso de 20px no eixo menor achatava ícones extremos (1000×10 → 42×20) | Proporção exata (42×1); área de toque mínima 44×44 no `<button>`, separada da imagem. Corrida de `onload/onerror` após troca de empresa coberta; URL inválida → círculo |

### Testes R1 (integração DOM com MapLibre mockado — não é E2E)

| Caso | Resultado |
|---|---|
| Duplo clique no mesmo marcador → 1 `onSelect`; A→B→A → 3 chamadas; clique não chega ao mapa; Cancelar/X não selecionam | PASS |
| Prop atualizado após callback; reclicar selecionado não reemite; marcador é `<button type="button">` (Enter/Space: JSDOM não sintetiza click de keydown — limite honesto; no navegador a ativação nativa gera `click`) | PASS |
| `depositoSelecionadoId` de emp-1 → troca para emp-2: sem dados de emp-1 no DOM, aviso de obsoleto, Confirmado desabilitado até escolher `x1` | PASS |
| Depósito inativado após refetch → seleção inválida; id `"7"` casa com `7` | PASS |
| Loading/erro de consulta não habilitam Confirmado | PASS |
| Ícone antigo carregando após troca de empresa não altera marcador novo; URL inválida → fallback sem exceção | PASS |
| Área de toque ≥44px; nome com HTML é texto puro (sem execução) | PASS |
| Helpers `mesmoId`/`resolverDepositoSelecionado`; aspecto 1000×10 e 10×1000 | PASS |
| Mutação: removendo a guarda R1-01 e voltando `disabled={!depositoSelecionadoId}` → 5 testes R1 falham | confirmado |

### Gates R1 (local)

| Comando | Resultado |
|---|---|
| `git diff --check` | limpo |
| `npx vitest run tests/smoke/maplibreSelecaoDepositoMapa.test.jsx` | 21/21 PASS |
| `npm run verify:all` (PostgreSQL 16 efêmero local, `localhost`) | TODAS AS ETAPAS PASSARAM — smoke 840/840, `test:gates`, todos os gates, `gate:types` (sem regressão; 1ª execução pegou 1 diagnóstico novo de JSDoc, corrigido antes do commit), `typecheck:backend`, `lint`, `test:backend`, `build` |

WebGL real desktop/mobile continua **BLOCKED** (sem navegador com sessão autenticada/dados autorizados no container). Checklist manual acima, mais: duplo toque rápido num depósito; trocar de empresa com depósito já vinculado e ver o aviso + Confirmado desabilitado; ícone muito largo não achatado.

Riscos residuais: guarda R1-01 depende do caller atualizar `depositoSelecionadoId` (o `FormularioPonto` atual atualiza); sem E2E WebGL.
