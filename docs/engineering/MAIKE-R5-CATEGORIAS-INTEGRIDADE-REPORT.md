# MAIKE R5 — Categorias de Produto: integridade hierárquica

**Data:** 2026-10-27  
**Branch:** `cursor/r5-categorias-integridade-516d`  
**Base referencial:** `origin/main` @ `1c1b73e477d4613d136bfacfc779a27844375f16` (pós PR #97)

## Contexto paralelo

| Missão | Estado | Impacto R5 |
|---|---|---|
| R4 (PR #98 DRAFT) | Em andamento | Arquivos congelados respeitados — nenhum toque em rotas/API Vercel/pages reservadas |
| Lotes | Congelada | Nenhum arquivo de lotes/manejo alterado |

**PR R5:** não aberta enquanto PR #98 (R4) permanece aberta — política do prompt e do usuário (uma PR por vez).

## Matriz CAT-01 … CAT-05

| ID | Falha | Correção | Arquivos | Testes |
|---|---|---|---|---|
| CAT-01 | Ciclo / auto-pai aceito no backend; UI só excluía filhos diretos; árvore sem proteção | Validação de ancestrais na transação (`REQUEST_VALIDATION_FAILED` 400); seletor exclui todos os descendentes; `buildHierarchy` defensiva com `_hierarquiaAnomala` | `categoriaService.js`, `FormularioCategoriaProduto.jsx`, `TabelaCategoriasProduto.jsx` | `BE-R5-01/02`, smoke `buildHierarchy`, `idsDescendentesDe` |
| CAT-02 | DELETE na ordem da seleção (`pai` antes de `filho` falha FK) | `ordenarExclusaoFolhasPrimeiro` + exclusão folha→raiz | `categoriaProdutoService.js` | `C5b` stateful, smoke ordenação |
| CAT-03 | `undefined` omitia campo no PATCH | Payload envia `categoria_pai_id: null` ao escolher raiz | `FormularioCategoriaProduto.jsx` | `BE-R5-03` |
| CAT-04 | Rename do pai não atualizava cache nas filhas | `propagarNomePaiParaFilhas` na mesma transação | `categoriaRepository.js`, `categoriaService.js` | `BE-R5-04` |
| CAT-05 | C5b não assertava ordem nem FK | Mock stateful + asserção `['filho','pai']` | `manejoServices.test.js` | C5b reescrito |

## Gates (HEAD da branch)

Com `DATABASE_URL` carregada de `.env`:

- `npm run verify:all` — **PASS** (após correção lint no teste backend)
- `npm run test:smoke` — **PASS** (+7 testes em `categoriaProdutoIntegridade.test.js`)
- `npm run test:backend` — **PASS** (+4 em `categoriaIntegridadeNativo.test.mjs`, total 171)
- `npm run typecheck:backend` — **PASS**
- `npm run build` / `npm run lint` — **PASS**

Sem `DATABASE_URL`: `test:backend` falha dura (esperado).

## Arquivos tocados (escopo R5)

- `backend/src/modules/categorias/categoriaService.js`
- `backend/src/modules/categorias/categoriaRepository.js`
- `src/services/categoriaProdutoService.js`
- `src/components/categorias-produto/FormularioCategoriaProduto.jsx`
- `src/components/categorias-produto/TabelaCategoriasProduto.jsx`
- `tests/smoke/manejoServices.test.js`
- `tests/smoke/categoriaProdutoIntegridade.test.js` (novo)
- `backend/tests/categoriaIntegridadeNativo.test.mjs` (novo)
- `docs/engineering/MAIKE-R5-CATEGORIAS-INTEGRIDADE-REPORT.md` (este arquivo)

**Não tocados (prova de não conflito):** `src/pages/**`, `src/App.jsx`, `src/Layout.jsx`, `src/lib/navigation/**`, `api/fastify.js`, `backend/src/modules/categorias/categoriaRoutes.js`, `src/apis/categorias/categoriaNativePort.js`, `vercel.json`, `src/components/lotes/**`, `backend/src/modules/lotes/**`, migrations Prisma.

## Próximo passo

Após merge manual da PR #98 (R4): rebase `cursor/r5-categorias-integridade-516d` sobre `main`, resolver conflitos preservando R4, rerodar `npm run verify:all`, abrir **uma** PR DRAFT R5.

**Veredito:** `READY_FOR_REBASE_AFTER_R4`
