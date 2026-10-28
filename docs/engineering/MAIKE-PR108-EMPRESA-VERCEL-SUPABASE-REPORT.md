# MAIKE — PR #108 — Cadastro de Empresas (Vercel + Supabase)

Relatório de missão: diagnóstico e correção do fluxo **Empresas** na arquitetura
**frontend + Fastify serverless (Vercel) + PostgreSQL (Supabase)**.

## Identidade

| Item | Valor |
|------|--------|
| Base `main` (início) | `be1ee97143179efbd403229a464cc48f386c3aa3` (merge PR #107) |
| HEAD desta PR | `10ce6483` (branch `cursor/pr108-empresa-vercel-supabase-516d`) |
| Supabase project ref | `uuemcasqcdjucflulkne` |
| Vercel project | `maike` (`prj_jbLcws3pOJqXu2Fo3joKFJG86dzh`) |

## Evidências — raiz por tipo

### CONFIRMADO — Achado A (UX / código descartado)

- `src/apis/_core/nativeHttpClient.js` não preservava `EMPRESA_NAME_CONFLICT`.
- Resposta HTTP **409** com `code: EMPRESA_NAME_CONFLICT` era traduzida para
  `API_OPERATION_FAILED` → toast genérico *"Não foi possível concluir a operação."*
- **Correção:** código adicionado a `CODIGOS_PRESERVADOS` + teste
  `tests/smoke/nativeHttpClientEmpresa.test.js` (RED→GREEN).

### CONFIRMADO — Achado B (schema Supabase vs código em `main`)

Inspeção read-only via Supabase MCP (sem credenciais expostas):

1. **`_prisma_migrations`:** última aplicada `20261028120000_p55_base44_exit_final`.
   **Ausentes** no banco de produção:
   - `20261028200000_p54_marca_list_keyset_indexes`
   - `20261028210000_empresa_numero_empresa`
   - `20261028230000_operacao_idempotente`

2. **`information_schema` — tabela `Empresa`:** coluna **`numero_empresa` não existe**
   (19 colunas de domínio + timestamps; alinhado ao schema **pré** EMPRESA-NUM-01).

3. **Consequência:** runtime Vercel com SHA que inclui `empresaService.criar` +
   `numero_empresa` NOT NULL no Prisma → **POST tende a `INTERNAL_ERROR` (500)** por
   DDL incompatível, não por conflito de nome. Isso explica o sintoma do usuário
   **independente** do bug de mapeamento 409.

### CONFIRMADO — Achado C (build Vercel ≠ migrate)

- `vercel.json`: `buildCommand` = `npm run prisma:generate && npm run build` —
  **não** executa `prisma migrate deploy`.
- Migrations versionadas exigem **`npm run deploy:migrate`** one-shot com
  `MIGRATION_DATABASE_URL` (sessão/direct **5432**, nunca pooler **6543**) — ver
  `docs/engineering/PRODUCAO-GO-LIVE-CHECKLIST.md` e D-PROD-28.

### PENDING — Preview autenticado / logs Vercel

- MCP Vercel: `list_deployments` retornou **403 forbidden** (sem permissão de listagem).
- Não houve captura DevTools de `POST /api/native/empresas` em preview autenticado.
- Operador deve correlacionar `request_id` da resposta com **Vercel Functions** após deploy.

### HIPÓTESE — Outras causas (não reproduzidas em produção autenticada)

- Payload com campos rejeitados, timeout, falha pós-POST no GET — mitigadas parcialmente
  na UI (cache otimista + `invalidateQueries` sem bloquear toast).

## Alterações implementadas

| Área | Mudança |
|------|---------|
| Cliente HTTP | `EMPRESA_NAME_CONFLICT` em `CODIGOS_PRESERVADOS` |
| Backend | `empresaUniqueViolation.js` — P2002 distingue `nome` / `numero_empresa` / fallback |
| UI `Empresa.jsx` | Mescla registro salvo no cache; `invalidateQueries` assíncrono; toast de sucesso não depende de refetch |
| Testes | `nativeHttpClientEmpresa.test.js`, `empresaUniqueViolation.test.mjs`, extensão `empresaPage.test.jsx` |

## Testes executados

- `npm run test:smoke` (casos Empresa + nativeHttpClient Empresa)
- `npm run verify:all` (gate completo — ver CI da PR)

## Pré-deploy Vercel + Supabase (operador)

Ordem **obrigatória** antes de promover runtime que depende de `numero_empresa`:

1. Backup recente do projeto Supabase `uuemcasqcdjucflulkne`.
2. Confirmar `MIGRATION_DATABASE_URL` aponta para o **mesmo** banco que `DATABASE_URL`
   / `POSTGRES_PRISMA_URL` do runtime (identidade lógica — não misturar projetos).
3. One-shot (máquina/CI autorizada, **não** função serverless por request):

   ```bash
   export MIGRATION_DATABASE_URL='postgresql://…:5432/…'  # sessão/direct
   npm run deploy:migrate
   ```

4. Validar pós-migrate (read-only):

   ```sql
   SELECT migration_name FROM _prisma_migrations
   WHERE migration_name LIKE '%empresa_numero%' OR migration_name LIKE '%operacao_idempotente%';
   SELECT column_name FROM information_schema.columns
   WHERE table_name = 'Empresa' AND column_name = 'numero_empresa';
   ```

5. Redeploy **Production** Vercel da `main` (ou merge desta PR + deploy).
6. Smoke: `GET /api/native/health`, `POST /api/native/empresas` (201), nome duplicado (409
   + mensagem específica), `GET /api/native/empresas`.

**Rollback:** reverter deploy Vercel para SHA anterior; **não** remover coluna
`numero_empresa` sem plano de dados — migration é forward-only.

## Veredito

| Escopo | Status |
|--------|--------|
| GO técnico (código + gates locais/CI) | Alvo desta PR após CI verde |
| GO produção (schema) | **OK** — migrations `20261028200000` … `20261028230000` aplicadas no Supabase `uuemcasqcdjucflulkne` em **2026-10-28** (MCP + `_prisma_migrations` alinhado) |
| GO produção (runtime) | **Pendente redeploy Vercel** se Production ainda não inclui PR #108 |

## O que o operador precisa fazer

1. Revisar e mergear PR #108 (DRAFT) manualmente quando satisfeito.
2. ~~Executar **`npm run deploy:migrate`**~~ — **feito** no Supabase (2026-10-28); próximo `deploy:migrate` deve ser no-op.
3. Redeploy Production Vercel; confirmar SHA deployado = commit mergeado.
4. Smoke autenticado Cadastro Empresas (criar, duplicar nome, listar).
5. Se persistir 500: usar `request_id` nos logs Vercel Functions — não Railway.
