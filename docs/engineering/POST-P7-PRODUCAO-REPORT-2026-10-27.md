# Pós-P7 — produção Supabase + smoke (2026-10-27)

**Missão:** `cursor/pos-p7-producao-516d-b301` (base `main` pós PR **#85**)  
**Produção:** `https://maike-five.vercel.app` · **Supabase:** MAIKE `uuemcasqcdjucflulkne`

## Resumo executivo

| Área | Resultado |
|------|-----------|
| Era pós-Base44 (dados) | **OK** — P5.5 + gates `p54`/`p55`; baseline `gate:base44` com SDK zero em `src/` |
| P7 runtime (PR #85) | **Mergeada** — `VITE_BASE44_*` e `getDataProviderConfig` removidos (D-PROD-52) |
| Supabase DDL | **OK** — 38 tabelas de domínio + fundação presentes |
| `_prisma_migrations` | **Reconciliado 14/14** — 7 linhas inseridas (DDL já aplicada via MCP; sem reexecutar SQL) |
| `/health` produção | **200** — `banco: up`, `configuracaoIncompleta: []` |
| Rotas JWT (sem token) | **401** em `/marcas`, `/empresas`, `/lancamentos-tarefa` |
| `POST /auth/login` | **400** corpo vazio (rota viva); login autenticado **não testado** (senha fora do repo) |
| Vercel env (MCP) | `VITE_MAIKE_API_URL` = `https://maike-five.vercel.app` (**same-origin**) |
| `VITE_SKIP_NATIVE_LOGIN` | Ainda existe com valor **vazio** — MCP não expõe delete; remover no dashboard |
| Seed operacional | **OK** — `Empresa` (`empresa-maike-principal`), `Permissao` (`perm-maike-admin`), 4 `Marca`, 1 `Setor` |
| `verify:all` (agente) | **31/32** — falha só `test:backend` (sem `DATABASE_URL`/Docker local) |

## Reconciliação `_prisma_migrations`

**Problema:** DDL das migrations `p4_5` … `p55` já estava no banco (via `apply_migration` Supabase), mas o ledger Prisma tinha **7/14** linhas — `prisma migrate deploy` no próximo deploy tentaria reaplicar DDL e falharia.

**Ação (2026-10-27):** `INSERT … WHERE NOT EXISTS` para:

- `20261027180000_p4_5_unidade_medida_native`
- `20261027190000_p5_grupo_tipo_tarefa_native`
- `20261027200000_p51_lote_native`
- `20261027210000_p52_categoria_local_produto_native`
- `20261027220000_p53_lancamento_tarefa_native`
- `20261027230000_p54_base44_exit_movimentacao`
- `20261028120000_p55_base44_exit_final`

Checksums = SHA-256 do `migration.sql` no repositório (padrão Prisma). **Nenhum** `migration.sql` foi reexecutado.

## Smoke HTTP (produção)

| Verificação | Resultado |
|-------------|-----------|
| `GET /health` | 200 |
| `GET /marcas` | 401 `TENANT_CONTEXT_REQUIRED` |
| `GET /empresas` | 401 |
| `GET /lancamentos-tarefa` | 401 |
| `POST /auth/login` `{}` | 400 `REQUEST_VALIDATION_FAILED` |
| `GET /` (SPA) | 200 |
| Vercel Deployment Protection na API | **Não observado** (401 de app, não página SSO) |

## Vercel — variáveis relevantes (MCP, projeto `maike`)

| Variável | Observação |
|----------|------------|
| `VITE_MAIKE_API_URL` | `https://maike-five.vercel.app` — correto para monólito |
| `FRONTEND_ORIGINS` | Inclui `maike-five.vercel.app` e preview `main` |
| `DATABASE_URL` / `MIGRATION_DATABASE_URL` | Presentes (valores secretos) |
| `VITE_SKIP_NATIVE_LOGIN` | **Remover** — chave vazia em production+preview; comentário D-PROD-37 |

## Bloqueios / ações do proprietário

1. **Excluir** `VITE_SKIP_NATIVE_LOGIN` no [Vercel → maike → Environment Variables](https://vercel.com/) (agente sem API de delete).
2. **Smoke autenticado:** login `maike` (ou bootstrap) + navegar `/marcas`, `/Empresa`, lançamentos de tarefa no mapa — credencial não versionada.
3. **RLS Supabase:** 39 tabelas sem RLS — esperado até P8; app usa Prisma com credencial de servidor, não anon key.
4. **OWNER-SECURITY-01:** rotação Google Maps permanece pendente.

## Checklist de teste manual (usuário)

- [ ] Abrir `https://maike-five.vercel.app` — tela de login nativa (sem bypass).
- [ ] Entrar com login/senha de produção — JWT em sessão; menu carrega.
- [ ] **Marcas** — listar/criar; rede `GET /marcas` 200 com Bearer.
- [ ] **Empresa** — abrir cadastro; `GET /empresas` 200.
- [ ] **Mapa / tarefas** — fluxo que chama `/lancamentos-tarefa`.
- [ ] **Mapa Geral** — mapa renderiza (`VITE_GOOGLE_MAPS_API_KEY` no build).
- [ ] Opcional: após deploy futuro, confirmar log de deploy **sem** erro de migration.
