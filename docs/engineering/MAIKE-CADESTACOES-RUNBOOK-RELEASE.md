# MAIKE — Estações da fazenda: runbook de release expand-only (D-PROD-188)

> **Estado: NÃO EXECUTADO. `SCHEMA_APPLIED_PROD: NÃO`.**
>
> Este documento é o plano. Cada passo exige o GO do proprietário e para no
> primeiro desvio com **`RELEASE_BLOCKED`**. Valores entre `<…>` são preenchidos
> na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-188](./DECISIONS.md) · Relatório:
[`MAIKE-CADESTACOES-CADASTRO-REPORT.md`](./MAIKE-CADESTACOES-CADASTRO-REPORT.md).
Molde: [`MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md)
(§1 explica por que nunca `apply_migration` e nunca DDL solto).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261113400000_cadestacoes_cadastro` |
| Natureza | expand-only: 1 tabela nova (`"CADESTACOES"`, 11 colunas), 2 FKs (Cliente; Empresa composta), 2 CHECKs, 2 uniques, 2 índices e o bloco DO de RLS/REVOKE; zero `ALTER` em tabela antiga; nenhum dado migrado |
| Tabelas antigas referenciadas (FK) | `Cliente`, `Empresa` |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `5d295863216619103ac9e645229edb9d3ffa25a06774097df3429b5358dc90f7` |
| Hash do DO pinado (`DO_RLS_APROVADOS`) | `10d6c749779b4a22ea4d7fbbdf7455da1c618b7a4981bbcf10c14391b4056f5f` |
| `_prisma_migrations` | leitura de 2026-11-13: **42** concluídas, 0 abertas (a última `20261113200000_tipo_tarefa_drop_colunas`); depois **43**. Se a PR #263 (`20261113300000_…`) for aplicada antes, recontar no §2 |
| Tabelas em `public` | 80 → **81** |

**Por que antes do merge (D-PROD-72 item 1):** a Vercel publica a `main` sozinha.
O runtime novo sem a tabela responde 500 nas 5 rotas `/estacoes` **e** em
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
SELECT to_regclass('public."CADESTACOES"');                    -- NULL
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 80
```

E, localmente, no `<SHA_APROVADO>`:
`sha256sum backend/prisma/migrations/20261113400000_cadestacoes_cadastro/migration.sql`
igual ao pinado, e o classificador (`classificarMigrations`) com `expand: true`,
`tabelas_novas = ["CADESTACOES"]` e `violacoes: []`.

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
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261113400000_cadestacoes_cadastro') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> <N_OK> OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF to_regclass('public."CADESTACOES"') IS NOT NULL THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: tabela CADESTACOES já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '5d295863216619103ac9e645229edb9d3ffa25a06774097df3429b5358dc90f7', now(),
        '20261113400000_cadestacoes_cadastro', NULL, NULL, now(), 1);
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
 WHERE migration_name = '20261113400000_cadestacoes_cadastro';         -- 1 linha, checksum pinado, 1
SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'CADESTACOES';  -- t, f
SELECT conname FROM pg_constraint WHERE conrelid = 'public."CADESTACOES"'::regclass ORDER BY 1;
  -- CADESTACOES_cliente_id_empresa_id_fkey, CADESTACOES_cliente_id_fkey,
  -- CADESTACOES_periodo_check, CADESTACOES_pkey, CADESTACOES_tipo_check
SELECT count(*) FROM "CADESTACOES";                                    -- 0
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';            -- 81
```

Mais: `get_advisors` (segurança) sem alerta novo para `CADESTACOES`.

## 5. Merge, deploy e smoke (proprietário)

1. Merge manual da PR. 2. Deploy READY na Vercel. 3. Smoke: abrir Manejo →
Estações com uma fazenda selecionada, criar uma estação de teste, editar e
excluir; conferir `DELETE /empresas/:id` de uma empresa sem vínculos continua
respondendo (sem 500).

## 6. Rollback

A tabela é nova e nada a referencia. Antes de qualquer escrita real, a reversão
de schema é `DROP TABLE "CADESTACOES";` + remoção da linha em
`_prisma_migrations`, **só com GO próprio** (é CONTRACT). Com o código já no ar,
reverter o código primeiro.

## 7. Registro de execução

_(vazio — preencher com data/hora UTC, caminho usado, GO citado, resultado do §4.)_
