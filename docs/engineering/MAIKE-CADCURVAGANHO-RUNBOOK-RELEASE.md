# MAIKE — Curvas de Ganho de Peso: runbook de release expand-only (D-PROD-189)

> **Estado: §2 a §4 EXECUTADOS em 2026-11-13. `SCHEMA_APPLIED_PROD: SIM`.**
> Aplicada às 23:18:10 UTC pelo caminho B (conector), com GO escrito do
> proprietário e desvio da D-PROD-74 autorizado. A conferência do §4 passou.
> Merge, deploy e smoke (§5) dependem da autorização do proprietário. Evidências no §7.
>
> Este documento é o plano. Cada passo exige o GO do proprietário e para no
> primeiro desvio com **`RELEASE_BLOCKED`**. Valores entre `<…>` são preenchidos
> na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-189](./DECISIONS.md) · Relatório:
[`MAIKE-CADCURVAGANHO-CADASTRO-REPORT.md`](./MAIKE-CADCURVAGANHO-CADASTRO-REPORT.md).
Precedente executado: [`MAIKE-CADESTACOES-RUNBOOK-RELEASE.md`](./MAIKE-CADESTACOES-RUNBOOK-RELEASE.md) §7 (mesmo formato, 2026-11-13).
Molde: [`MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md)
(§1 explica por que nunca `apply_migration` e nunca DDL solto).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261113600000_cadcurvaganho_cadastro` |
| Natureza | expand-only: 1 tabela nova (`"CADCURVAGANHO"`, 11 colunas), 2 FKs (Cliente; Empresa composta), 1 CHECK (faixa dos 3 GMD), 2 uniques, 1 índice e o bloco DO de RLS/REVOKE; zero `ALTER` em tabela antiga; nenhum dado migrado |
| Tabelas antigas referenciadas (FK) | `Cliente`, `Empresa` |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `137f93f26f2f5edd3feeaeae21ff363d2746fbdb93b729efe75935c631e96ac6` |
| Hash do DO pinado (`DO_RLS_APROVADOS`) | `eaafebfa75191f2e77bd59d6a6ecf6af2c33ee86c536c39fe2b0e881cf1680a7` |
| `_prisma_migrations` | depois das Estações (2026-11-13): **43** concluídas, 0 abertas (a última `20261113400000_cadestacoes_cadastro`); depois **44**. Se a PR #263 (`…300000`) ou a Fatia D (PR #268, `…500000`, CONTRACT) forem aplicadas antes, recontar no §2 |
| Tabelas em `public` | 81 → **82** (a Fatia D não cria nem apaga tabela: renomeia `CategoriaManejo` para `CADCATEGORIA`) |

**Por que antes do merge (D-PROD-72 item 1):** a Vercel publica a `main` sozinha.
O runtime novo sem a tabela responde 500 nas 5 rotas `/curvas-ganho` **e** em
`DELETE /empresas/:id`, que conta todos os models com `cliente_id` e `empresa_id`
pela DMMF (mesma classe do hotfix `0bd52a3`). O runtime antigo ignora a tabela
nova, então o banco migrado o atende sem mudança.

**Efeito durante a transação:** `ADD FOREIGN KEY` toma `SHARE ROW EXCLUSIVE` em
`Cliente` e `Empresa` até o `COMMIT`; escritas nelas esperam alguns instantes.
Com `lock_timeout` de 5 s, uma transação longa nelas aborta tudo sem aplicar nada.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** numa máquina protegida, com
  `MIGRATION_DATABASE_URL` (sessão/direta, nunca o pooler 6543),
  `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360` e `DATABASE_URL` do
  mesmo banco:
  ```bash
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar
  ```
- **B — conector Supabase, uma única `execute_sql` (§3):** só com autorização
  **escrita e específica do proprietário para esta migration**, registrada como
  desvio da D-PROD-74. Nunca presumida de releases anteriores nem de
  autorização genérica ("você tem acesso ao Supabase" não é o GO).

## 2. Preflight — somente leitura (projeto `uuemcasqcdjucflulkne`)

```sql
SELECT system_identifier FROM pg_control_system();            -- 7692130048193495360
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok,
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS ruim
  FROM _prisma_migrations;                                     -- <N_OK>, 0
SELECT to_regclass('public."CADCURVAGANHO"');                  -- NULL
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 81
```

E, localmente, no `<SHA_APROVADO>`:
`sha256sum backend/prisma/migrations/20261113600000_cadcurvaganho_cadastro/migration.sql`
igual ao pinado, e o classificador (`classificarMigrations`) com `expand: true`,
`tabelas_novas = ["CADCURVAGANHO"]` e `violacoes: []`.

## 3. Caminho B — uma transação

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(72707369);  -- a mesma trava do prisma migrate (D-PROD-75)
DO $guarda$
DECLARE n_ok int; n_ruim int;
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7692130048193495360 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: alvo divergente';
  END IF;
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261113600000_cadcurvaganho_cadastro') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> <N_OK> OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF to_regclass('public."CADCURVAGANHO"') IS NOT NULL THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: tabela CADCURVAGANHO já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '137f93f26f2f5edd3feeaeae21ff363d2746fbdb93b729efe75935c631e96ac6', now(),
        '20261113600000_cadcurvaganho_cadastro', NULL, NULL, now(), 1);
COMMIT;
```

- O `migration.sql` não tem `BEGIN`/`COMMIT` próprios (o único `BEGIN` está no
  corpo do DO) e o único `DROP` é `DROP POLICY IF EXISTS` na própria tabela nova.
  Nenhum `DELETE`, `TRUNCATE` ou `UPDATE`.
- Qualquer falha desfaz tudo. Confirme pelo §4 que a tabela não existe e que não
  há linha nova, corrija a causa e peça novo GO.

## 4. Conferência — somente leitura

```sql
SELECT migration_name, checksum, applied_steps_count FROM _prisma_migrations
 WHERE migration_name = '20261113600000_cadcurvaganho_cadastro';       -- 1 linha, checksum pinado, 1
SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'CADCURVAGANHO';  -- t, f
SELECT conname FROM pg_constraint WHERE conrelid = 'public."CADCURVAGANHO"'::regclass ORDER BY 1;
  -- CADCURVAGANHO_cliente_id_empresa_id_fkey, CADCURVAGANHO_cliente_id_fkey,
  -- CADCURVAGANHO_gmd_check, CADCURVAGANHO_pkey
SELECT count(*) FROM "CADCURVAGANHO";                                  -- 0
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';            -- 82
```

Mais: `get_advisors` (segurança) sem alerta novo para `CADCURVAGANHO`.

## 5. Merge, deploy e smoke (proprietário)

1. Merge da PR. 2. Deploy READY na Vercel. 3. Smoke: abrir Manejo →
Curvas de Ganho com uma fazenda selecionada, criar uma curva de teste, editar e
excluir; conferir `DELETE /empresas/:id` de uma empresa sem vínculos continua
respondendo (sem 500).

## 6. Rollback

A tabela é nova e nada a referencia. Antes de qualquer escrita real, a reversão
de schema é `DROP TABLE "CADCURVAGANHO";` + remoção da linha em
`_prisma_migrations`, **só com GO próprio** (é CONTRACT). Com o código já no ar,
reverter o código primeiro.

## 7. Registro de execução

**2026-11-13, caminho B (conector Supabase, uma `execute_sql`).**

- **GO do proprietário, escrito no chat da sessão:** "Autorizo" (resposta ao pedido de autorização desta migration pelo conector) e, depois, "Pode aplicar" / "mande de novo". Registrado como o **desvio da D-PROD-74** para ESTA migration, não como precedente.
- **Tentativas sem efeito:** três chamadas anteriores ficaram esperando a confirmação do conector, que não aparece no app do celular, e expiraram sem executar. Antes de cada nova tentativa o preflight foi repetido e mostrou o banco intacto (43/0, tabela ausente).
- **Preflight (§2), somente leitura, logo antes da aplicação:** `system_identifier` 7692130048193495360; `_prisma_migrations` 43 concluídas e 0 com falha (última `20261113400000_cadestacoes_cadastro`); `to_regclass('public."CADCURVAGANHO"')` nulo; 81 tabelas em `public`. A Fatia D (PR #268) segue sem aplicar (`CADCATEGORIA` ausente), então `<N_OK>` = 43.
- **Ensaio local** do mesmo script num banco novo com as 43 migrations (só o `system_identifier` trocado pelo do banco local): aplicou, 44 no histórico, RLS ligado; a 2ª execução parou na guarda (`RELEASE_BLOCKED: migration já registrada`); `prisma migrate status`: "Database schema is up to date".
- **Aplicação:** o §3 com `<N_OK>` = 43 e o `migration.sql` integral do commit `5ebf64a8` (SHA-256 `137f93f2…6ac6`, conferido, e o arquivo está contido byte a byte no script). `finished_at` = **2026-11-13 23:18:10 UTC**. Nenhum erro.
- **Conferência (§4):** linha em `_prisma_migrations` com o checksum pinado, `rolled_back_at` nulo e `applied_steps_count = 1`; 44 concluídas e 0 com falha; RLS ligado, sem FORCE; constraints `CADCURVAGANHO_cliente_id_empresa_id_fkey`, `CADCURVAGANHO_cliente_id_fkey`, `CADCURVAGANHO_gmd_check`, `CADCURVAGANHO_pkey`; índices `…_cliente_id_empresa_id_ativo_idx`, `…_cliente_id_empresa_id_nome_key`, `…_cliente_id_id_key` + pkey; política `maike_backend_all` só para `maike_vercel` (com SELECT/INSERT/UPDATE/DELETE); `anon` e `authenticated` sem SELECT; 0 linhas; **82** tabelas em `public`; `get_advisors` (segurança) sem nenhum alerta.
- **Pendente (proprietário):** autorizar o merge da PR #270; depois, deploy e smoke do §5.
