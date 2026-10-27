# FIX-MENU-NAV-FREEZE-4 — Navegação entre menus após #89/#90/#91

**Data:** 2026-10-27  
**Branch:** `cursor/fix-menu-nav-freeze-4-516d`

## Sintoma

Mesmo com AppShell (#89), remoção de AnimatePresence (#90) e debounce de 48 ms + teardown
do mapa (#91), trocas rápidas entre Mapa Geral, Lotes, Marcas e Produtos ainda congelavam a UI —
especialmente ao **sair e voltar** ao mapa.

## Causa raiz (esta iteração)

| Área | Achado |
|------|--------|
| **DebouncedOutlet + Layout `key={pathname}`** | O `key` remontava o outlet a cada rota, anulando o settle e empilhando fase “vazia” + montagem imediata — sensação de freeze e flicker. |
| **Debounce 48 ms** | Slot em branco (`data-nav-pending`) entre rotas sem reduzir custo real do Google Maps (reinit a cada retorno ao mapa). |
| **Mapa Geral** | Desmonte completo ao sair da rota; cada retorno pagava init do SDK + renderer. |
| **Menu desktop** | `<Link><Button>` (HTML inválido) e cliques repetidos na mesma rota/disparos rápidos podiam gerar navegação duplicada. |

## Correção

1. **`AppRouteContent.jsx`** (substitui `DebouncedOutlet`): sem `setTimeout`; `cancelQueries` em `fetching` no `useLayoutEffect`; **Mapa Geral persistente** — monta na primeira visita, fica `hidden` fora de `/mapageral`.
2. **`App.jsx`:** rota `MapaGeral` com `element={null}` (instância única no shell); shell usa `AppRouteContent`.
3. **`Layout.jsx`:** remove `key={location.pathname}`; menu com `Button asChild` + `Link`; `deveBloquearCliqueMenu` (mesma rota + dedupe 400 ms).
4. **`menuNavigation.js`:** helper testável para dedupe.

Mapa persistente oculto: trade-off memória/GPU documentado (D-PROD / NAV3); adotado neste PR porque o debounce não resolvia o custo de reinit.

## Verificação

```bash
npm run test:smoke -- tests/smoke/menuNavFreeze.test.jsx tests/smoke/scope.test.jsx tests/smoke/appShell.test.jsx
npm run verify:all
```

Validação manual: navegação rápida entre Mapa Geral ↔ Lotes ↔ Marcas no deploy Vercel (Preview/Production).

## Arquivos tocados

- `src/components/navigation/AppRouteContent.jsx` (novo)
- `src/components/navigation/DebouncedOutlet.jsx` (removido)
- `src/App.jsx`
- `src/Layout.jsx`
- `src/lib/menuNavigation.js` (novo)
- `tests/smoke/menuNavFreeze.test.jsx`
- `tests/smoke/scope.test.jsx`
- `docs/engineering/FIX-MENU-NAV-FREEZE-4-2026-10-27-REPORT.md`
