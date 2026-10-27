# FIX-LOTES-URL-R2 — Lotes (onDisplayChange) + URLs diretas SPA

**Data:** 2026-10-27  
**Branch:** `cursor/lotes-url-direta-r2-516d`  
**Base:** `main` @ `4a75bc96` (PR #95 — menu freeze estrutural)

## Sintomas

1. **Cadastro de Lotes** ainda travava ao sair da lista — ciclo residual `TabelaLotes` ↔ `CadastroBase1Grade` via `onDisplayChange`, independente da correção de `selectedItems` da #95.
2. **Deep links** em produção (`https://maike-five.vercel.app`): `/produtos` e `/cadastrolotes` com `Accept: text/html` retornavam **404 HTML**; Accept composto de navegador caía na API (**401 JSON**).

## Causa 1 — ciclo onDisplayChange (Lotes)

| Passo | Onde |
|------|------|
| `matchesSearch` inline a cada render | `TabelaLotes.jsx` |
| `filtrados` / `ordenados` sempre novos (mesmo busca vazia) | `CadastroBase1Grade.jsx` |
| efeito `onDisplayChange({ rows, selectedIds })` | grade |
| `setDisplayState` incondicional + `readColumnLayout` / agregações | `TabelaLotes.jsx` |
| novo render → nova `matchesSearch` | reinício do ciclo |

Reproduzível com `lotes=[]` omitido ou instável; não exige API lenta.

## Correção 1

| Item | Arquivo | Mudança |
|------|---------|---------|
| A | `TabelaLotes.jsx` | `matchesSearch` em `useCallback([colunasDisponiveis, getFieldValue])` |
| B | `TabelaLotes.jsx` | `displayPayloadEquivalent` + `setDisplayState` idempotente (refs/ordem de `rows` e `selectedIds`) |
| C | `TabelaLotes.jsx` | `notifyVisibleDataChange` só em `useEffect` dependente de `displayState` |
| D | `TabelaLotes.jsx` | `EMPTY_LOTES` estável quando prop omitida |
| F | — | Sem debounce, lock de menu ou remoção de deps de hooks |

**Teste:** `tests/smoke/tabelaLotesDisplayStability.test.jsx` — lista omitida/vazia estável, limite 40 renders / 250 ms; propagação quando referência do row muda (mesmo id).

**Antes (código pré-correção):** `matchesSearch` instável + `setDisplayState` sempre novo → avalanche de commits com grade real mockada (padrão idêntico ao teste de Marcas em #95).  
**Depois:** mesmos cenários estabilizam na branch corrigida.

## Causa 2 — roteamento Vercel

| Problema | Efeito |
|----------|--------|
| Sem rewrite SPA → `/index.html` para páginas do manifesto | 404 em paths só-cliente (`/cadastrolotes`) |
| Guard `missing: accept = text/html` (igualdade exata) | Accept composto do Chrome não conta como documento → rewrite para `/api/fastify` → 401 JSON |

## Correção 2

| Item | Arquivo | Mudança |
|------|---------|---------|
| SSOT | `scripts/vercel/vercelAcceptMatch.mjs` | Regex `(?i)…text/html…` + simulador `resolveRewrite` para testes |
| SSOT | `scripts/vercel/nativeApiRewriteRules.mjs` | Guard composto; rewrites SPA por `allowedPages` → `/index.html` (+ alias PascalCase); API antes, SPA depois |
| Gerado | `vercel.json` | `node scripts/vercel/sync-vercel-json.mjs` (106 rewrites) |
| Testes | `tests/smoke/vercelSpaRoutes.test.js` | Matching real (Accept isolado, Chrome, JSON, `*/*`); colisão REST vs SPA |

Preservados: `/auth`, `/health`, `/arquivos/upload`, `/referencias/sincronizar`, prefixos API, assets (sem catch-all `/(.*)`).

## Verificação local (agente)

```bash
npm run verify:all
```

| Etapa | Resultado |
|-------|-----------|
| Gates, lint, smoke (608), build | **PASS** |
| `test:backend` | **FAIL** — `DATABASE_URL` ausente no pod cloud |
| PR #95 regressions (`cadastroGradeSelectionStability`, `menuNavFreeze`) | **PASS** (incluídas no smoke) |

## HTTP produção (pré-deploy desta branch)

Medição em `https://maike-five.vercel.app` **antes** do merge desta correção (SHA de produção ainda `4a75bc96`):

| GET | Accept | Observado |
|-----|--------|-----------|
| `/produtos` | `text/html` | 404 |
| `/produtos` | Accept composto Chrome | 401 JSON (`TENANT_CONTEXT_REQUIRED`) |
| `/produtos` | `application/json` | 401 JSON (esperado sem token) |

**Validação pós-deploy:** pendente até preview/produção com SHA desta branch. Não declarar produção corrigida até GET documento 200 + `index.html` em `/produtos`, `/cadastrolotes`, `/marcas`, etc.

## Arquivos alterados

- `src/components/lotes/TabelaLotes.jsx`
- `scripts/vercel/vercelAcceptMatch.mjs` (novo)
- `scripts/vercel/nativeApiRewriteRules.mjs`
- `vercel.json` (regenerado)
- `tests/smoke/tabelaLotesDisplayStability.test.jsx` (novo)
- `tests/smoke/vercelSpaRoutes.test.js`

## PR

Abrir contra `main`; **sem merge automático**.
