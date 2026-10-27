# FIX-MENU-FREEZE-STRUCTURAL — ciclo de seleção nos cadastros

**Data:** 2026-10-27  
**Branch:** `cursor/fix-menu-freeze-structural-516d`  
**Base:** `main` @ `3000f17b` (inclui #94 — mapa persistente removido)  
**SHA corrigido (agente):** `d0e7ef3e`

## Sintoma

Alternar menus (Mapa → cadastros → outro cadastro) podia **travar URL/UI** ou gerar avalanche de renders, especialmente com listagens ainda carregando (`data` undefined) e grade Base1 montada.

## Cadeia de eventos (causa prioritária)

1. Página usa `const { data: rows = [] } = useQuery(...)` — cada render com `data === undefined` cria **novo** `[]`.
2. `CadastroBase1Grade` recebe `rows` com referência nova → efeito de reconciliação de seleção executa `setSelectedItems(p => p.filter(...))`.
3. `filter` em seleção vazia ainda produzia **array novo** → efeito `onSelectionChange(selectedItems)`.
4. `useCadastroListaChromeState.onSelectionChange` fazia `setSelectedIds(ids)` sem comparar → re-render do pai → volta ao passo 1.

Páginas auditadas com fallback instável: **Marcas**, **CadastroSetores**, **Categorias**, **CategoriasManejo** (+ `iconesConfig` na mesma tela). Outras telas com `initialData: []` explícito não foram alteradas (semântica de cache/loading distinta).

Simulação JS isolada (prompt de análise): ~1000 ciclos sem estabilizar; com reconciliação idempotente ou fallback estável, ~2 renders do pai.

## Correção estrutural (A–D)

| Item | Arquivo | Mudança |
|------|---------|---------|
| A | `src/components/cadastro/base1/CadastroBase1Grade.jsx` | `EMPTY_ROWS` estável; reconciliação retorna `prev` se `next.length === prev.length` |
| B | `src/hooks/useCadastroListaChromeState.js` | `onSelectionChange` idempotente (mesmos IDs/ordem → `prev`) |
| C | `Marcas.jsx`, `CadastroSetores.jsx`, `Categorias.jsx`, `CategoriasManejo.jsx` | `const EMPTY_* = []` + `data ?? EMPTY_*` (sem `initialData: []` indiscriminado) |
| D | `src/hooks/useCadastroListaFooter.js` | `setMetrics` idempotente por `filtrados`/`totais` |

## Segundo problema: cancelamento global por URL

`AppRouteContent` ainda cancelava **todas** as queries `fetching` a cada mudança de pathname/search/hash (#94 já tinha removido mapa persistente; cancel permanecia).

- **Removido** `queryClientInstance.cancelQueries(...)` — arquivo reduzido a `<Outlet />`.
- Motivo: não delimita rota anterior; atinge sessão/empresa/dados compartilhados; não substitui `AbortSignal` por rota.

Contratos em `tests/smoke/menuNavFreeze.test.jsx` atualizados (não exigem mais `cancelQueries`).

## Mapa / roteamento

#94 (`3000f17b`) já desmonta `MapaGeral` com a rota. Esta missão **não** altera persistência do mapa nem `teardownMapInstance` (#93).

## Testes

Novo: `tests/smoke/cadastroGradeSelectionStability.test.jsx`

- Grade + chrome com `rows = []` **novo a cada render** (simula bug do pai) — commits &lt; 40 em 200 ms.
- `TabelaMarcas` + lista vazia estável + loading.
- `onSelectionChange` idempotente — pai não re-renderiza em loop.
- Página **Marcas** real com `listarMarcasDaEmpresa` pendente (mock) — sem avalanche de renders.

**Antes da correção:** o primeiro cenário (rows instável + filter sempre novo) reproduz loop em React (Maximum update depth / commits &gt;&gt; 40).  
**Depois:** mesmos testes passam na branch corrigida.

Atualizado: `tests/smoke/menuNavFreeze.test.jsx` — Outlet sem cancel global.

Navegação Mapa → Marcas → Setores → … **não** foi revalidada manualmente com Google Maps real neste ambiente cloud; smoke cobre contratos de código + regressão de seleção. Mapa mockado nos testes de `render.test.jsx`; mapa real = validação manual pendente.

## Verificação local (agente)

```bash
npm run verify:all
```

| Etapa | Resultado |
|-------|-----------|
| Gates, lint, smoke, build | PASS |
| `gate:types` | PASS (1746, sem regressão) |
| `test:backend` | **SKIP/FAIL** — `DATABASE_URL` ausente no pod cloud (PostgreSQL local não provisionado) |

## Limitações

- Deploy Vercel não exercido neste run; SHA acima é o testado no agente.
- Backend integration tests exigem `npm run db:up` + `DATABASE_URL` local.
- Overlays/portais: sem evidência nova de bloqueio de clique além do escopo cadastro/seleção.

## PR

Branch `cursor/fix-menu-freeze-structural-516d` → `main`, **sem merge automático**.
