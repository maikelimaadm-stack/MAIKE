# FIX-MAP-LOOP-SPA-ROUTES — loop do Mapa + deep links SPA

**Data:** 2026-10-27  
**Branch:** `cursor/fix-map-loop-spa-routes-516d`

## Sintomas

1. **Mapa Geral:** ao entrar em Mapa, loop de reinicialização (mapa persistente / Google Maps reinit contínuo).
2. **Deep link:** `GET https://maike-five.vercel.app/bebedouros` com navegador devolvia JSON `TENANT_CONTEXT_REQUIRED` em vez do SPA (login + rota cliente).

## Causa raiz — Task A (map loop)

`MapaGeral` montava `teardownMapInstance` com dependência `[renderer]`. `useMapRenderer` devolve um **objeto novo a cada render**, embora `clearAll` seja `useCallback` estável.

Ciclo:

1. Render → novo `renderer` → novo `teardownMapInstance`
2. `useEffect` de init do mapa roda cleanup → `teardownMapInstance()` → `setMapReady(false)`
3. Init de novo → `setMapReady(true)` → render → volta ao passo 1

Correção: dependência `[renderer.clearAll]` (referência estável).

**Refino em `AppRouteContent`:** o `<Outlet />` deixou de ser desmontado quando `onMapa` (`!onMapa && …`), passando a ficar invisível/inerte. Evita instabilidade do React Router com rota `MapaGeral` (`element={null}`) + mapa persistente.

## Causa raiz — Task B (deep links)

`vercel.json` reescrevia **todo** `GET /bebedouros` (e demais prefixos REST) para `/api/fastify`. Navegação documento (`Accept` com `text/html`) era tratada como API.

Correção (D-PROD-36 preservado):

- SSOT: `scripts/vercel/nativeApiRewriteRules.mjs`
- Rotas REST: rewrite só se `missing: accept text/html` (intenção API / fetch JSON / mutações)
- `/auth/*`, `/health`, uploads: rewrites incondicionais (sem colisão com páginas)
- Gerador: `node scripts/vercel/sync-vercel-json.mjs`

## Testes / guardas

- `tests/smoke/vercelSpaRoutes.test.js` — sync `vercel.json`, guard `text/html`, contrato `teardownMapInstance`, Outlet sempre montado
- `tests/smoke/menuNavFreeze.test.jsx` — contratos NAV4 intactos

## Verificação

```bash
npm run verify:all
```

Neste ambiente, `test:backend` falhou por `DATABASE_URL` ausente (sem Docker). Demais etapas verdes, incluindo `test:smoke`, gates e `build`.

**Smoke manual pós-deploy:**

```bash
curl -sS -D - -o /dev/null -H 'Accept: text/html' 'https://maike-five.vercel.app/bebedouros' | head
# Esperado: 200 text/html (index SPA), não application/json TENANT_CONTEXT_REQUIRED

curl -sS -H 'Accept: application/json' 'https://maike-five.vercel.app/bebedouros'
# Esperado: JSON 401 TENANT_CONTEXT_REQUIRED (API)
```

## Arquivos principais

| Arquivo | Mudança |
|---------|---------|
| `src/pages/MapaGeral.jsx` | deps estáveis no teardown do mapa |
| `src/components/navigation/AppRouteContent.jsx` | Outlet sempre montado |
| `scripts/vercel/nativeApiRewriteRules.mjs` | SSOT rewrites SPA-aware |
| `scripts/vercel/sync-vercel-json.mjs` | sync `vercel.json` |
| `vercel.json` | regenerado (74 rewrites) |
