# FIX-MENU-NAV-FREEZE-2 — Navegação entre menus após #89

**Data:** 2026-10-27  
**Branch:** `cursor/fix-menu-nav-freeze-2-516d`

## Sintoma

Após o merge de **#89** (AppShell + Layout único), o cadastro de Lotes e a
persistência do shell estavam corretos, mas **trocar rapidamente entre itens do
menu** ainda deixava a UI lenta ou “travada” — especialmente ao sair ou voltar
para **Mapa Geral**.

## Investigação

| Área | Achado |
|------|--------|
| `App.jsx` / AppShell | Layout **não** remonta por rota; `<Outlet />` troca só a página filha. |
| `Layout.jsx` splash / auth | Splash 5s e `getCurrentUser`/`listarPermissoes` rodam **uma vez** (`[]`). |
| `isChangingEmpresa` | Reset via `queueMicrotask` após #89 — OK. |
| `AuthContext` / token | Sem revalidação por `pathname`. |
| React Router | Sem `lazy()` nas páginas; sem `Suspense` no shell. |
| **`AnimatePresence` + `key={location.pathname}`** | Com modo padrão (sem `wait`), a rota **anterior** permanece montada durante o fade (~120ms). **Mapa Geral** mantém instância Google Maps + listeners; cliques rápidos **empilham** páginas pesadas e bloqueiam o thread principal. |
| Gate de permissão | Diálogo modal podia permanecer aberto ao navegar para rota permitida. |

Documentação anterior (UX-09) já registrava evitar `mode="wait"`; o empilhamento
por **exit animation** no modo padrão era o restante do problema.

## Correção (diff mínimo)

1. **`Layout.jsx`:** remover `AnimatePresence`/`motion`; conteúdo da rota em
   `<div className="relative h-full min-h-0 overflow-hidden">` — desmonte imediato
   da página anterior.
2. **`Layout.jsx`:** fechar `PermissionAlertDialog` quando a rota atual é permitida.

## Verificação

```bash
npm run test:smoke -- tests/smoke/scope.test.jsx tests/smoke/appShell.test.jsx
npm run verify:all
```

Smoke novo: `scope.test.jsx` — Layout sem `AnimatePresence` / `key={location.pathname}`.

## Arquivos tocados

- `src/Layout.jsx`
- `tests/smoke/scope.test.jsx`
- `docs/engineering/FIX-MENU-NAV-FREEZE-2-2026-10-27-REPORT.md`
