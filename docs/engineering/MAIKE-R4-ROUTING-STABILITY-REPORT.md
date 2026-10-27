# MAIKE R4 — Routing stability (pós-PR #97)

**Data:** 2026-10-27  
**Branch:** `cursor/maike-r4-routing-stability-516d`  
**Main inicial:** `1c1b73e477d4613d136bfacfc779a27844375f16` (merge PR #97)  
**HEAD desta missão:** ver `git rev-parse HEAD` na branch após push  
**PR:** DRAFT única (sem merge automático)  
**Escopo congelado:** saldo/movimentação de Lotes — **NÃO ALTERADO** (sem Prisma, regras de quantidade ou telas de movimentação).

---

## 1. Causas raiz

### Comprovadas

| ID | Causa | Evidência |
|---|---|---|
| R4-A1 | Mesmo pathname servia SPA e REST (`/produtos`, `/marcas`, `/categorias`, `/bebedouros`, `/usuarios`) com rewrites condicionados a `Accept` | `vercel.json` gerado tinha ~106 rewrites; colisão documentada em FIX-LOTES-URL-R2 |
| R4-A2 | Navegação de documento com `Accept` composto competia com guard `missing: text/html` — comportamento dependente da plataforma | Testes locais usavam `vercelAcceptMatch.mjs`; não prova independente de produção |
| R4-B1 | `MapaCadastro`, `CategoriasManejo`, `Bebedouros` liam `localStorage.getItem('empresa_selecionada_id')` no render sem reatividade | Grep + diff desta PR |
| R4-B2 | `Layout.jsx` inicializava empresa sem validação `empresa_selecionada_cliente_id` vs JWT | Diff desta PR |
| R4-C1 | `Marcas`, `Categorias`, `Produtos` tratavam falha como lista vazia (`?? []`, `initialData: []` em Produtos) | Diff desta PR |

### Hipóteses pendentes (produção)

- Validação HTTP real em deploy Vercel (preview/prod) com matriz PATH × Accept — **não executada neste agente** (sem URL/credenciais de preview autenticado). Scripts e testes de configuração substituem parcialmente.

---

## 2. Correção (fix)

### R4-A — Namespace `/api/native/*`

- SSOT: `config/nativeApiPath.js` (`NATIVE_API_PATH_PREFIX`, `comPrefixoApiNativa`, `semPrefixoApiNativa`).
- Cliente: `nativeHttpClient.js` prefixa todo caminho antes do `fetch`.
- Vercel: `nativeApiRewriteRules.mjs` — apenas `/api/native` e `/api/native/:path*` → `/api/fastify`; SPA das 16 páginas → `/index.html` (lower, PascalCase, trailing slash).
- Adaptadores: `api/fastify.js` e hook Fastify `aplicarStripPrefixoApiNativa` restauram paths legados (`/produtos`, `/auth/login`, …) no servidor.

**Efeito:** `GET /produtos` (documento) **nunca** roteia para API; `GET /api/native/produtos` com `Accept: application/json` roteia para Fastify.

### R4-B — Empresa tenant-aware

- Páginas: hook `useEmpresaSelecionadaId` + reset de formulário/rascunho ao trocar empresa (`MapaCadastro`, `CategoriasManejo`).
- `Layout`: init/sync via `lerEmpresaSelecionadaIdArmazenada(clienteId)` e listeners de evento/storage.

### R4-C — Erro ≠ vazio

- `Marcas`, `Categorias`, `Produtos`: `isError`, mensagem via `getApiErrorMessage`, botão **Tentar novamente** (`refetch`).

---

## 3. Matriz HTTP (configuração gerada)

| PATH | Accept típico | Destino esperado | Observação |
|---|---|---|---|
| `/produtos` | Chrome document | `/index.html` | Teste `vercelSpaRoutes.test.js` |
| `/produtos` | `application/json` | *sem rewrite API* | Não cai no Fastify pelo path legado |
| `/api/native/produtos` | `application/json` | `/api/fastify` | API inequívoca |
| `/marcas`, `/categorias`, `/bebedouros`, `/usuarios` | document | `/index.html` | Sem rewrite REST no path |
| `/MapaGeral`, `/cadastrolotes/` | document | `/index.html` | PascalCase + trailing slash |
| `/api/native/health` | JSON | Fastify → `/health` | `foundation.test.mjs` BE-02b |

**16 páginas** (`config/mapa-manejo-scope.json` `allowedPages`): cada uma com rewrite SPA lower + PascalCase + variantes `/` (66 rewrites totais vs 106 antes).

---

## 4. Testes e CI

| Suite | Resultado neste agente | Notas |
|---|---|---|
| `npm run test:smoke` | **PASS** (624 testes) | Inclui `vercelSpaRoutes`, `nativeApiPath`, `setorNativo`, `sessaoNativa` |
| `npm run verify:all` | **BLOCKED** em `test:backend` | Docker/PostgreSQL indisponível (`docker: not found`) |
| Gates restantes (até build) | **PASS** na execução anterior completa exceto backend/smoke pré-fix setor | Reexecutar após push no job `quality` com Postgres |

**Comando local recomendado (com banco):**

```bash
npm run db:up
export DATABASE_URL=...
npm run prisma:deploy
npm run test:backend
npm run verify:all
```

---

## 5. Arquivos principais

- `config/nativeApiPath.js`, `src/config/nativeApiPath.js`
- `src/apis/_core/nativeHttpClient.js`
- `scripts/vercel/nativeApiRewriteRules.mjs`, `vercel.json`
- `api/fastify.js`, `backend/src/app.js`, `backend/src/shared/http/nativeApiPathPrefix.js`
- `src/Layout.jsx`, `src/hooks/useEmpresaSelecionadaId.js`
- `src/pages/MapaCadastro.jsx`, `CategoriasManejo.jsx`, `Bebedouros.jsx`, `Marcas.jsx`, `Categorias.jsx`, `Produtos.jsx`
- Testes: `tests/smoke/vercelSpaRoutes.test.js`, `nativeApiPath.test.js`, `setorNativo.test.js`, `sessaoNativa.test.js`, `backend/tests/foundation.test.mjs`

---

## 6. Riscos remanescentes

1. **Produção/preview HTTP** não medido aqui — validar manualmente colisões após deploy com script GET documento vs `/api/native/...` JSON.
2. **Backend CI** necessário para certificar BE-02b e regressões Prisma.
3. Componentes filhos de Bebedouros/mapa ainda com `localStorage` direto (fora do escopo funcional desta missão) — listados no grep da auditoria; risco médio se usados fora das páginas corrigidas.

---

## 7. Declaração de escopo Lotes

Nenhuma alteração a modelos Prisma, migrations, movimentação de lotes, saldo por área ou regras de quantidade. Apenas roteamento, seleção de empresa em telas indicadas e UX de erro em três cadastros.
