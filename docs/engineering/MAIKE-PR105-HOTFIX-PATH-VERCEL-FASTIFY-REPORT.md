# MAIKE — PR #105 — HOTFIX-PATH-ROUTING-01

**Data:** 2026-10-27  
**Branch:** `cursor/hotfix-path-vercel-fastify-516d`  
**Base `main` verificada:** `8703a6291f79cc07573542f081398b704af4d1db` (merge PR #104)  
**PR #104:** merged — CI PR `40599437805`, main `40601026950` SUCCESS

## Causa raiz (INC-01)

Rewrite SSOT `{ source: '/api/native/:path*', destination: '/api/fastify' }` não consumia o curinga `:path*`. A Vercel propaga o parâmetro nomeado `path` na query do destino. O adaptador `api/fastify.js` aplicava apenas `reescreverUrlApiNativa` (prefixo), mantendo `?path=…` na query. Rotas GET com `additionalProperties: false` rejeitavam com `field: path`, `reason: unknown_field` → mensagem «Verifique o campo «path»…».

## Correção (transporte)

1. **Rewrite SSOT:** destino `'/api/fastify?__native_route=:path*'` (`scripts/vercel/nativeApiRewriteRules.mjs` + `vercel.json` regenerado).
2. **Ingresso serverless:** `config/vercelFastifyIngress.js` — `normalizarIngressoServerlessVercel()` reconstrói `/api/native/{segmentos}` + query limpa, valida segmentos (sem `..`, `//`, `\`), remove `__native_route` e `path` da query antes do AJV. Suporte legado a `?path=` **somente** na entrada `/api/fastify` (mesmo vetor que a Vercel usava).
3. **`api/fastify.js`:** usa o normalizador; rota inválida → HTTP 400 `INVALID_NATIVE_ROUTE`.

Fastify direto (`rewriteUrl` em `backend/src/app.js`) inalterado — idempotente, sem metadados Vercel.

## Correção (INC-02 — `?limit` residuais)

| Porta / rota | Antes | Depois |
|---|---|---|
| `aplicacoes-medicamento` | MISMATCH | **MATCH** — `querystringListagemEmpresa()` + `opcoesTakeDeFiltros` no repositório |
| `eventos-sanitarios` | MISMATCH | **MATCH** — idem |
| Demais ports com `?limit=` (mapa, suplementação, bebedouros, …) | MATCH (PR #104) | MATCH |
| `movimentacoes-estoque` port com `?limit` | PENDING — rota ainda sem `limit` no schema (fora do par escopo auditoria) | backlog |
| `historicos-lancamento-tarefa` (`?limite=`) | contrato próprio | MATCH (teste existente) |

## Testes (RED → GREEN)

- `tests/smoke/vercelFastifyIngress.test.js` — injeção `path` / `__native_route`, traversal, SSOT rewrite.
- `backend/tests/listagemLimitNativo.test.mjs` — simulação `/api/fastify?path=…` e `__native_route=…`; endpoints sanitários com `?limit=200`.
- `tests/smoke/vercelSpaRoutes.test.js` — destino API atualizado; 16 SPA deep links preservados.

## Gates locais (HEAD da branch)

```text
npm run verify:all — TODAS AS ETAPAS PASSARAM (PostgreSQL local + AUTH_SECRET de teste)
```

Inclui: `test:backend` 200 testes, `test:smoke` 646 testes, `gate:native-api`, build production.

## Preview / produção E2E

**PENDING** — preview autenticado não exercitado nesta sessão (sem URL/credenciais de preview). Validar após deploy da PR: `GET /api/native/health`, `GET /api/native/empresas` (JWT), `GET …/movimentacoes-mapa?limit=200`, login POST, query desconhecida ainda 400.

## Riscos documentados (não executados nesta missão)

- **INC-03:** `loteManejoService.js` — `limit=200` + filtro de lote em memória (falso negativo histórico).
- **INC-04:** `TarefasMapaPanel` update + histórico sem reconciliação idempotente.

## Rollback

Reverter commit da PR; redeploy Vercel restaura rewrite antigo (reintroduz erro `path`).
