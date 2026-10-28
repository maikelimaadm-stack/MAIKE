# MAIKE — PR #107 — Correção global «filtros da consulta» (ingresso Vercel)

## Veredito

**CONFIRMADO EM CÓDIGO:** o normalizador `config/vercelFastifyIngress.js` deixava `__native_route` (e `path` legado coincidente) na query quando `req.url` chegava com pathname `/api/native/{rota}` em vez de `/api/fastify`. O AJV rejeitava com `field: query`, `reason: unknown_field` → mensagem «filtros da consulta». A correção consome metadados de transporte também nessa família de URL, com rejeição de rota contraditória/duplicada.

**OBSERVADO EM VERCEL:** nenhuma medição em preview/deploy autorizado nesta execução.

**PENDENTE/BLOCKED:** validação E2E em preview Vercel real; confirmação de migration `20261028230000_operacao_idempotente` aplicada em produção.

## Causa raiz

Rewrite SSOT: `/api/native/:path*` → `/api/fastify?__native_route=:path*`. Dependendo do runtime, o handler pode ver `/api/fastify?…` **ou** `/api/native/{rota}?__native_route={rota}&…`. A PR #105 só removia metadados quando `pathname === '/api/fastify'`.

## Correção

- `consumirMetadadosQueryComPathnameNativo`: em pathname `/api/native/…`, valida `__native_route` contra a rota do path (rejeita troca), remove `path` legado só se coincidir; preserva `path` arbitrário para o AJV.
- Testes RED→GREEN: contraexemplo documentado; handler `api/fastify.js` com mock HTTP mínimo.

## IDENTIDADE

| Campo | Valor |
|---|---|
| `origin/main` início | `7e6e61ecfa504e889be9ecd9f4a24fc2f49a129d` (merge PR #106) |
| Branch | `cursor/pr107-ingress-query-global-516d` |
| HEAD | `989e27602ae640aa95a613c7fd03e426df000362` |
| Base | `main` |
| PR GitHub | **Pendente** — branch pushed; abrir DRAFT manualmente se integração não criar |
| Arquivos principais | `config/vercelFastifyIngress.js`, `tests/smoke/vercelFastifyIngress.test.js`, `tests/smoke/vercelSpaRoutes.test.js`, `backend/tests/listagemLimitNativo.test.mjs`, `backend/tests/vercelFastifyHandlerNativo.test.mjs` |

## PROVAS

- **RED (pré-fix):** `normalizarIngressoServerlessVercel('/api/native/empresas?__native_route=empresas&limit=200')` → `/empresas?__native_route=empresas&limit=200`.
- **GREEN:** mesma entrada → `/empresas?limit=200`; backend inject + handler serverless 200 autenticado; `foo=1` continua 400 em `field: foo`.
- **`npm run verify:all`:** executado nesta branch (ver CI do PR).

## CONTRATO

Sem alteração de tenant source, JWT, CORS, schema de domínio, migrations adicionais ou relaxamento de `additionalProperties` / `removeAdditional`.

## RISCOS RESTANTES

Diferença entre famílias de `req.url` observadas só na Vercel; CI local não substitui preview same-origin.
