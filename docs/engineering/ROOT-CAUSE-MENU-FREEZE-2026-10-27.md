# ROOT-CAUSE-MENU-FREEZE — congelamento ao navegar no menu

**Data:** 2026-10-27  
**Branch:** `cursor/root-cause-menu-freeze-516d`  
**Contexto:** fixes #89–#93 (AppShell, fim do AnimatePresence, DebouncedOutlet → AppRouteContent, mapa persistente, loop teardown)

## Sintoma

Trocas entre Mapa Geral, Lotes, Marcas e demais itens do menu continuavam **congelando a UI** — especialmente após visitar o mapa e navegar para cadastros, ou ao alternar rotas rapidamente.

## Causa raiz nomeada

### RC-MENU-FREEZE-PERSISTENT-MAP (`P4-NAV-PERSISTENT-MAP-MAIN-THREAD`)

**O quê:** `AppRouteContent` (FIX-MENU-NAV-FREEZE-4 / #92) mantinha `MapaGeral` montado fora da rota (`data-persistent-map`, `hidden`), com a rota `MapaGeral` em `element={null}`.

**Por quê congela:** fora de `/mapageral`, o componente **continua montado** e executa:

- dezenas de `useEffect` de sync (`renderer.syncAreas`, `syncLotes`, labels, blink, etc.) no Google Maps;
- queries React Query do mapa (`mapa-cache`, permissões, bebedouros);
- listeners de mapa (`idle`, long-press, geolocation).

A página visível (cadastro) monta **ao mesmo tempo**, com listas, grids e novas queries. Duas superfícies pesadas competem pela **mesma main thread** → navegação parece travada ou ignora cliques até o browser recuperar.

**Trade-off revertido:** remount do SDK ao voltar ao mapa é aceitável; freeze em todo o app não.

### RC-MENU-FREEZE-LAYOUT-CANCEL (`P4-NAV-CANCEL-LAYOUT-EFFECT`)

**O quê:** `cancelQueries({ predicate: fetching })` rodava em **`useLayoutEffect`** a cada mudança de `pathname`.

**Por quê agrava:** `useLayoutEffect` bloqueia paint. Cancelar queries dispara notificações síncronas a todos os observadores — incluindo o **mapa persistente ainda montado** — antes da nova rota pintar, amplificando o pico de trabalho no caminho crítico da navegação.

## Correção aplicada

| Mudança | Arquivo |
|---------|---------|
| Remover mapa persistente; `<Outlet />` único | `src/components/navigation/AppRouteContent.jsx` |
| `MapaGeral` volta a `element={<Page />}` | `src/App.jsx` |
| `cancelQueries` em **`useEffect`** (não layout) | `AppRouteContent.jsx` |
| Limpar `menuNavIntentRef` ao mudar rota (dedupe não prende clique após nav lenta) | `src/Layout.jsx` |

Teardown completo do Google Maps em `MapaGeral` (#91/#93) **permanece** — evita loop de reinit e vazamento de listeners ao desmontar.

## Verificação

```bash
npm run test:smoke -- tests/smoke/menuNavFreeze.test.jsx tests/smoke/vercelSpaRoutes.test.js tests/smoke/scope.test.jsx
npm run verify:all
```

Manual: Mapa Geral → Lotes → Marcas → Mapa Geral em sequência rápida; menu desktop e mobile devem responder sem congelamento perceptível.

## Arquivos

- `src/components/navigation/AppRouteContent.jsx`
- `src/App.jsx`
- `src/Layout.jsx`
- `tests/smoke/menuNavFreeze.test.jsx`
- `tests/smoke/vercelSpaRoutes.test.js`
- `docs/engineering/ROOT-CAUSE-MENU-FREEZE-2026-10-27.md`
