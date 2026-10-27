# FIX-MENU-NAV-FREEZE-3 — Navegação entre menus após #89/#90

**Data:** 2026-10-27  
**Branch:** `cursor/fix-menu-nav-freeze-3-516d`

## Sintoma

Mesmo com **AppShell** (#89) e remoção de **AnimatePresence** (#90), trocas rápidas entre
Mapa Geral, Lotes, Marcas e Produtos ainda congelavam a UI — especialmente ao **sair** do
mapa (Google Maps + dezenas de overlays/listeners + queries em paralelo).

## Investigação

| Área | Achado |
|------|--------|
| **MapaGeral** | No unmount só `renderer.clearAll()`; instância `google.maps.Map`, `OverlayView` e listeners permaneciam; init assíncrono podia criar mapa **após** sair da rota. |
| **useMapRenderer** | `blinkIntervals` (module-level) não era limpo em `clearAll` → timers ativos após desmonte. |
| **Rotas** | Cada clique montava imediatamente a página destino; cliques rápidos empilhavam montagens pesadas (cadastros + mapa). |
| **Fetch** | React Query continuava requests `fetching` da rota anterior competindo com a nova. |
| **Layout** | Shell OK (splash/auth uma vez); slot da página sem fronteira explícita de desmonte. |
| **Menu** | Links `react-router-dom` — sem reload; não era a causa. |
| **Mapa persistente oculto** | **Não adotado** neste PR: teardown completo foi suficiente; manter instância única oculta economiza remount do SDK mas retém ~memória/GPU — tradeoff documentado para revisit se necessário. |

## Correção

1. **`MapaGeral.jsx`:** `teardownMapInstance` — `clearAll`, overlay, `clearInstanceListeners`, null refs, `setMapReady(false)`; flag `cancelled` no init assíncrono.
2. **`useMapRenderer.jsx`:** `clearAllBlinkIntervals()` dentro de `clearAll`.
3. **`DebouncedOutlet.jsx`:** `useLayoutEffect` + 48 ms de settle — desmonta rota ao mudar pathname; monta só quando estabiliza; `cancelQueries` em requests `fetching`.
4. **`App.jsx`:** substituir `<Outlet />` por `<DebouncedOutlet />` no shell.
5. **`Layout.jsx`:** `key={location.pathname}` no slot da página.

## Verificação

```bash
npm run test:smoke -- tests/smoke/menuNavFreeze.test.jsx tests/smoke/scope.test.jsx tests/smoke/appShell.test.jsx
npm run verify:all
```

## Arquivos tocados

- `src/pages/MapaGeral.jsx`
- `src/components/mapa/useMapRenderer.jsx`
- `src/components/navigation/DebouncedOutlet.jsx`
- `src/App.jsx`
- `src/Layout.jsx`
- `tests/smoke/menuNavFreeze.test.jsx`
- `tests/smoke/scope.test.jsx`
- `docs/engineering/FIX-MENU-NAV-FREEZE-3-2026-10-27-REPORT.md`
