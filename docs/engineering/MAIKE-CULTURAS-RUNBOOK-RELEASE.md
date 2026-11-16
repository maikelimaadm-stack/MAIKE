# MAIKE — Cadastro de Culturas: runbook de release expand-only (D-PROD-215)

> **Estado: PENDENTE — aguardando o GO escrito do proprietário para esta migration.** `SCHEMA_APPLIED_PROD: NÃO`.
>
> Este documento é o plano. Cada passo exige o GO do proprietário e para no
> primeiro desvio com **`RELEASE_BLOCKED`**. Valores entre `<…>` são preenchidos
> na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-215](./DECISIONS.md) · Relatório:
[`MAIKE-CULTURAS-REPORT.md`](./MAIKE-CULTURAS-REPORT.md).
Precedente executado: [`MAIKE-LEITURA-COCHO-RUNBOOK-RELEASE.md`](./MAIKE-LEITURA-COCHO-RUNBOOK-RELEASE.md) §7
(EXPAND, caminho B). Molde: [`MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md)
(§1 explica por que nunca `apply_migration` e nunca DDL solto).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261116400000_cadculturas` |
| Natureza | **expand-only**: 1 tabela NOVA — `CADCULTURAS` — com 1 índice, 3 uniques (todos começando por `cliente_id`), FKs compostas pelo tenant (Cliente e Empresa, `RESTRICT`), 2 CHECKs (`tipo` e alturas) e o bloco RLS/REVOKE dela. Nenhuma tabela existente é alterada, nenhum dado migrado ou semeado (a lista de referência é criada pela API, nunca pela migration) |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `37a71c46f138f457022fbab8316d645eb4f39a6e2a3ddfe4c8a3394e19665715` |
| Bloco RLS (`DO_RLS_APROVADOS`) | `cd8830aa244ba849ca957e7d480606bcd38e093e95e028b3e31973611784ea7b` (mesmo corpo de sempre, lista nova) |
| `_prisma_migrations` | esperado **62** concluídas, 0 abertas (a última `20261116300000_abastecimento_atividade`, D-PROD-211, checksum `6dfc825cb908c28e903e66b25d16f2628db5da2cb50b9af73c6f1711b7faa436`); depois **63**. Recontar no §2 |
| Tabelas em `public` | **94** antes, **95** depois |

**Por que antes do merge (D-PROD-72 item 1):** a Vercel publica a `main` sozinha.
O runtime novo lê e grava a tabela pela tela Culturas: sem a migration,
`/culturas` responde 500 (só a tela nova; nenhuma outra tela lê a tabela). O
runtime antigo não conhece a tabela e segue igual com o banco migrado — **não há janela**.

**Efeito durante a transação:** `CREATE TABLE` e as FKs pedem trava
`SHARE ROW EXCLUSIVE` por um instante nas tabelas referenciadas (`Cliente` e
`Empresa`) — leituras seguem, escritas nelas esperam o fim da transação
(milissegundos; a tabela nasce vazia). Uma espera além do `lock_timeout` de 5 s
aborta tudo sem aplicar nada.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** numa máquina protegida, com
  `MIGRATION_DATABASE_URL` (sessão/direta, nunca o pooler 6543),
  `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360` e `DATABASE_URL` do
  mesmo banco (EXPAND: sem `--contract`):
  ```bash
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar
  ```
- **B — conector Supabase, uma única `execute_sql` (§3):** só com autorização
  **escrita e específica do proprietário para esta migration**, registrada como
  desvio da D-PROD-74.

## 2. Preflight — somente leitura (projeto `uuemcasqcdjucflulkne`)

```sql
SELECT system_identifier FROM pg_control_system();            -- 7692130048193495360
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok,
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS ruim
  FROM _prisma_migrations;                                     -- 62, 0
SELECT migration_name, checksum FROM _prisma_migrations
 WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
 ORDER BY finished_at DESC LIMIT 1;                            -- 20261116300000_abastecimento_atividade, 6dfc825c…
SELECT to_regclass('public."CADCULTURAS"');                    -- null
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 94
```

E, localmente, no `<SHA_APROVADO>`: `sha256sum` do `migration.sql` igual ao
pinado, e `classificarMigrations` com `modo: EXPAND`,
`tabelas_novas = ["CADCULTURAS"]`, `colunas_novas_em_tabelas_antigas = []` e
`violacoes: []` (teste B31a).

## 3. Caminho B — uma transação

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(72707369);
DO $guarda$
DECLARE n_ok int; n_ruim int;
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7692130048193495360 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: alvo divergente';
  END IF;
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261116400000_cadculturas') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 62 OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261116300000_abastecimento_atividade'
                    AND checksum = '6dfc825cb908c28e903e66b25d16f2628db5da2cb50b9af73c6f1711b7faa436'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (20261116300000_abastecimento_atividade) não está concluída com o checksum do repositório';
  END IF;
  IF to_regclass('public."CADCULTURAS"') IS NOT NULL THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: tabela CADCULTURAS já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '37a71c46f138f457022fbab8316d645eb4f39a6e2a3ddfe4c8a3394e19665715', now(),
        '20261116400000_cadculturas', NULL, NULL, now(), 1);
COMMIT;
```

O script pronto, com o `migration.sql` integral, fica fora do repositório, no
rascunho da sessão (`aplicar214.sql`); confira o SHA-256 do trecho da migration
antes de usar. Qualquer falha desfaz tudo. Confirme pelo §4 que a tabela não
existe e que não há linha nova, corrija a causa e peça novo GO.

**Ensaio local (2026-11-16):** o script acima, com o `migration.sql` integral,
num banco à parte com as 62 migrations da `main` (`prisma migrate deploy` de uma
cópia com as pastas até a `20261116300000_abastecimento_atividade`: 62 / 0, 94
tabelas): com o `system_identifier` de produção recusou
(`RELEASE_BLOCKED: alvo divergente`, nada aplicado, 62 / 0); com o local,
aplicou numa transação (62 → 63 / 0, checksum pinado, `applied_steps_count` 1,
a tabela com RLS ligado e sem FORCE, 1 política, os 2 CHECKs e as 2 FKs, vazia,
95 tabelas em `public`); o `prisma migrate status` disse "63 migrations found …
Database schema is up to date!", o `migrate diff --exit-code` contra o
`schema.prisma` disse "No difference detected." (exit 0) e a 2ª execução recusou
(`RELEASE_BLOCKED: migration já registrada`), sem linha nova.

## 4. Conferência — somente leitura

```sql
SELECT migration_name, checksum, rolled_back_at, applied_steps_count FROM _prisma_migrations
 WHERE migration_name = '20261116400000_cadculturas';  -- 1 linha, checksum pinado, null, 1
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) FROM _prisma_migrations;  -- 63, 0
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
 WHERE relname = 'CADCULTURAS' AND relkind = 'r';              -- 1 linha, t, f
SELECT tablename, policyname FROM pg_policies WHERE tablename = 'CADCULTURAS';  -- maike_backend_all
SELECT count(*) FROM information_schema.role_table_grants
 WHERE table_name = 'CADCULTURAS' AND grantee IN ('anon', 'authenticated');  -- 0
SELECT conname FROM pg_constraint WHERE conrelid = 'public."CADCULTURAS"'::regclass AND contype IN ('c', 'f')
 ORDER BY 1;                                                   -- 2 CHECKs (alturas, tipo) e 2 FKs
SELECT indexname FROM pg_indexes WHERE tablename = 'CADCULTURAS' ORDER BY 1;  -- pkey, 3 uniques e o índice (cliente_id, empresa_id, ativo)
SELECT count(*) FROM "CADCULTURAS";                            -- 0
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 95
```

Mais: `get_advisors` (segurança) sem alerta novo.

## 5. Merge, deploy e smoke

1. Merge **logo depois** do §4. 2. Deploy READY na Vercel: `/api/native/health`
com o `release` da `main` nova. 3. Smoke: `/api/native/culturas?empresa_id=x`
sem sessão → 401; com uma conta com a tela `pec-culturas` (o administrador
concede em Permissões, não há concessão automática), abrir **Manejo → Culturas**,
clicar **Incluir lista de referência** (11 culturas incluídas, 001–011), clicar
de novo ("já estavam cadastradas", nada duplicado), editar uma altura em pt-BR
("25,5") e conferir na lista.

## 6. Rollback

A tabela é nova e nenhuma tabela antiga a referencia. Reverter seria uma
migration nova com `DROP TABLE "CADCULTURAS"` (CONTRACT, com GO próprio), nunca
editando esta. Com o código novo no ar, reverter o código primeiro.

## 7. Registro de execução

| Campo | Valor |
|---|---|
| Data/hora (UTC) | `<preencher com o finished_at da linha em _prisma_migrations>` |
| Caminho | `<A ou B>`. No caminho B: o SQL do §3 (`aplicar214.sql`, com o `migration.sql` integral) numa transação única pelo `execute_sql` do Supabase, projeto `uuemcasqcdjucflulkne`; guarda exigindo **62** concluídas, a anterior `20261116300000_abastecimento_atividade` concluída com o checksum do repositório e `CADCULTURAS` ausente |
| GO | `<texto do GO escrito do proprietário, específico desta migration>` |
| Preflight (§2) | `<system_identifier; concluídas / com falha; a anterior e o checksum dela; CADCULTURAS ausente; tabelas>` |
| Ensaio | Banco local com as 62 migrations da `main`: aplicou (63 / 0, 95 tabelas, `migrate status` em dia, `migrate diff` vazio); reexecução recusada (`migration já registrada`); alvo divergente recusado (§3) |
| Postcheck (§4) | `<63 / 0; checksum; RLS; política; constraints; grants; 95 tabelas>` |
| Resultado | `<APLICADA E CONFERIDA antes do merge (D-PROD-72) ou RELEASE_BLOCKED com o motivo>` |
