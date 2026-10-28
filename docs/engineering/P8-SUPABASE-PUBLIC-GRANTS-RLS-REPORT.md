# P8 — Supabase public: REVOKE Data API + RLS (D-PROD-56)

**Data:** 2026-10-28  
**Branch:** `cursor/supabase-seguranca-rls-26e2`  
**Base:** `main`  
**HEAD:** `3c91e059e4d32e371423d0453daad01cc5411396`  
**Compare:** https://github.com/maikelimaadm-stack/MAIKE/compare/main...cursor/supabase-seguranca-rls-26e2?expand=1  
**PR:** [#123](https://github.com/maikelimaadm-stack/MAIKE/pull/123)  
**Missão:** correção prioritária de acesso direto ao PostgreSQL Supabase  
**Decisão:** D-PROD-56  

### Apply remoto (2026-10-28) — AUTORIZADO

Autorização explícita do proprietário:
`AUTORIZO APPLY REMOTO SUPABASE — D-PROD-56 / migration 20261028240000_p8_supabase_public_revoke_rls — PR #123`

| Item | Resultado |
|---|---|
| Caminho | Supabase MCP `apply_migration` (DDL) + insert em `_prisma_migrations` com checksum Prisma SHA-256 |
| Por que não `npm run deploy:migrate` neste agente | `MIGRATION_DATABASE_URL` no Vercel é `sensitive` — MCP não devolve o valor; `.env` local só aponta para `127.0.0.1` |
| Pending no remoto antes | só `20261028240000_p8_supabase_public_revoke_rls` (17/17 até `operacao_idempotente`) |
| Ledger após | **18/18**; checksum `fe60da87828cc890b57c5fefb6f30a3e6ee8c67788b747c8a73b2b6a5b13ea54` |
| RLS | **40/40** `relrowsecurity=true`, **0** FORCE |
| Grants `anon`/`authenticated` | **0** linhas em `role_table_grants` (public) |
| Políticas | só `maike_backend_all` × 40 → `{maike_vercel}` |
| Privilegios spot-check | `maike_vercel` SELECT em `Cliente` = true; `anon`/`authenticated` = false |
| Advisors Security | **0** lints (antes: 40× `rls_disabled_in_public`) |
| Defaults `supabase_admin` | ainda concedem a anon em objetos **futuros** criados por esse papel — residual documentado |

---

## 1. Vulnerabilidades confirmadas (somente leitura — pré-apply)

| Achado | Evidência |
|---|---|
| Projeto Supabase | `MAIKE` / `uuemcasqcdjucflulkne` / `sa-east-1` / host `db.uuemcasqcdjucflulkne.supabase.co` |
| Vercel | projeto `maike` / `prj_jbLcws3pOJqXu2Fo3joKFJG86dzh` / `maike-five.vercel.app` |
| Ledger Prisma remoto | **17/17** migrations aplicadas (até `operacao_idempotente`) |
| Tabelas `public` | **40** (domínio + `_prisma_migrations`), owner `postgres` |
| RLS | **todas** com `relrowsecurity = false` (advisors: 40× `rls_disabled_in_public` ERROR) |
| Grants | `anon` e `authenticated` com SELECT/INSERT/UPDATE/DELETE (+ TRUNCATE/…) em **todas** as 40 |
| Default privileges | `postgres` **e** `supabase_admin` em `public` concedem `arwdDxtm` a `anon`/`authenticated` em tabelas novas |
| Papel app | `maike_vercel` (login, **sem** `BYPASSRLS`) tem grants em 40 tabelas |
| Consumidores HTTP Supabase no MAIKE | **nenhum** em `src/` / `backend/src/` — zero `@supabase/supabase-js`, zero PostgREST client |
| Runtime dados | Fastify + Prisma (`DATABASE_URL` / `POSTGRES_PRISMA_URL`) |

`public` permanece no schema exposto da Data API do Supabase; com grants atuais,
chave `anon` (publishable) bastaria para CRUD se a API estiver habilitada.
A autenticação JWT do Fastify **não** mitiga chamada direta ao PostgREST.

### Achados colaterais (fora do DDL desta PR — não alterados)

| Item | Nota |
|---|---|
| `VITE_SKIP_NATIVE_LOGIN` | Presente no Vercel (Production/Preview); comentário “bypass disabled”; **não** removido/alterado nesta PR |
| `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_ANON_KEY` | Injetados pela integração marketplace; app não consome — ação separada de higiene |
| `AUTH_SECRET` | Advisor Vercel `readable-secret` — rotação/fora desta missão |
| Defaults `supabase_admin` | Migration altera defaults de `postgres`/current_user; ACL de `supabase_admin` pode exigir passo com privilégio adequado |

---

## 2. Estratégia adotada

Arquitetura = **só backend → Prisma**. Preferência: **bloquear Data API** nos
dados de domínio, não inventar RLS tenant via `auth.uid()` (JWT próprio).

1. `REVOKE ALL` de `anon`/`authenticated` (tabelas, sequências, rotinas) em `public`
2. `ALTER DEFAULT PRIVILEGES` para o grantor efetivo
3. `ENABLE ROW LEVEL SECURITY` em todas as tabelas `public` — **sem FORCE**
4. Política `maike_backend_all` **somente** `TO maike_vercel` (se o papel existir)
5. Gate estático `gate:supabase-public-grants` + lab em Postgres descartável

**Não** truncar/dropar tabelas. DDL remoto foi aplicado **após** autorização explícita do dono (ver bloco Apply remoto).

---

## 3. Mudanças no repositório

| Artefato | Função |
|---|---|
| `backend/prisma/migrations/20261028240000_p8_supabase_public_revoke_rls/migration.sql` | Correção versionada idempotente |
| `scripts/gates/gate-supabase-public-grants.mjs` | Gate absoluto |
| `scripts/tests/gates/supabase-public-grants.test.mjs` | Provas negativas do gate |
| `backend/tests/supabasePublicGrantsNativo.test.mjs` | Lab: anon bloqueado, Prisma OK, RLS on |
| `docs/engineering/DECISIONS.md` | D-PROD-56 |
| `docs/engineering/P8-SUPABASE-*-ROLLBACK.sql` | SQL de emergência (não destrutivo de dados) |
| `package.json` / `verify-all.mjs` / `GATE-REGISTRY.md` / `AGENTS.md` | Wiring |

**Fora de escopo (R7 / anti-colisão):** MapLibre, `useCadastroInfiniteList`,
`cadastroListaScale`, `Base1Grid`, keyset Marcas, forms, CSS, tenancy de negócio,
JWT auth.

---

## 4. Colisões verificadas

| Branch / PR | Risco Prisma | Ação |
|---|---|---|
| `origin/main` | Base da missão; última migration `20261028230000_operacao_idempotente` | Nova migration `…240000_p8_…` |
| `cursor/alteracoes-visuais-26e2` / `lista-escala-marcas-26e2` | Só índices keyset `Marca` + UX lista; **sem** overlap de grants/RLS | Sem merge de UX nesta PR |
| PRs abertas | Nenhuma open no momento da auditoria | PR draft nova |

---

## 5. SQL de verificação (pós-apply remoto — executar após autorização)

```sql
-- RLS ligado?
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r'
ORDER BY 1;

-- Grants residuais Data API?
SELECT grantee, table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon', 'authenticated')
ORDER BY 1, 2, 3;

-- Políticas perigosas?
SELECT schemaname, tablename, policyname, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public';
```

Advisors Security do Supabase devem ser reexecutados **e** os grants acima
conferidos — ausência de lint sozinha não basta.

---

## 6. Rollout proposto (remoto)

1. **Backup** snapshot/PITR Supabase MAIKE  
2. Manter janela curta; app usa Prisma — REVOKE em anon não corta o monólito  
3. Preferir `npm run deploy:migrate` com `MIGRATION_DATABASE_URL` sessão **5432**  
   — neste apply: MCP `apply_migration` + ledger Prisma (URL sensitive indisponível ao agente)  
4. Rodar SQL de verificação + advisors — **feito**  
5. Smoke: login nativo, listar/criar área/lote (ambiente autorizado) — dono  
6. Se precisar reverter grants/RLS: ver `P8-SUPABASE-PUBLIC-GRANTS-RLS-ROLLBACK.sql`  
   (não apaga dados; reabre exposição — só emergência)

---

## 7. Efeito no Prisma

- Owner `postgres` e papéis com `BYPASSRLS` (`service_role`) não são bloqueados
  por RLS sem FORCE.
- `maike_vercel` recebe política explícita para continuar CRUD sob RLS.
- Lab local (owner `maike`) bypassa RLS como owner; testes Prisma passam.
- Migrations futuras: defaults de `postgres` deixam de auto-grantar a anon.

---

## 8. Testes

| Comando | Resultado |
|---|---|
| `npm run gate:supabase-public-grants` | **PASS** |
| `npm run test:gates` (604, incl. P56-*) | **PASS** |
| `npm run prisma:validate` | **PASS** |
| Lab Postgres local — migration apply + BE-P8-GRANTS-* | **PASS** (4/4); RLS 40/40 |
| `npm run test:backend` | **PASS** (236) |
| `npm run verify:all` | **PASS** (todas as etapas, incl. build) |
| Apply DDL remoto Supabase | **EXECUTADO** 2026-10-28 (autorização dono; ver bloco Apply remoto) |
| Data API com anon key de produção | **NÃO** — proibido logar chave real |
| Criação automática de PR draft | PR **#123** (abertura anterior / compare) |

---

## 9. Riscos e próximos passos

| Risco | Mitigação / próximo |
|---|---|
| Defaults `supabase_admin` ainda concedem a anon em objetos criados por esse papel | Passo operacional com privilégio adequado (fora deste DDL) |
| `service_role` mantém grants + bypass | Correto para admin; segredo nunca no frontend |
| Marketplace `NEXT_PUBLIC_SUPABASE_*` | Higiene env separada |
| Políticas tenant no PostgREST | Desnecessário enquanto Data API bloqueada; P8+ se reabrir superfície |
| Próximo `npm run deploy:migrate` | Deve ser **no-op** (18/18); se checksum divergir, investigar antes de `--applied` |
| Smoke app pós-apply | Login nativo + listar/criar área/lote no ambiente autorizado (agente sem senha de usuário) |

**Verdict merge manual:** conteúdo da PR = **GO para revisão**.  
**Verdict apply remoto:** **APLICADO e verificado** (RLS 40/40; grants Data API zerados; ledger Prisma 18/18).
