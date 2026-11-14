# MAIKE — Formulações de suplemento: runbook de release expand-only (D-PROD-202)

> **Estado: NÃO EXECUTADO. `SCHEMA_APPLIED_PROD: NÃO`.**
>
> Este documento é o plano. Cada passo exige o GO do proprietário e para no
> primeiro desvio com **`RELEASE_BLOCKED`**. Valores entre `<…>` são preenchidos
> na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-202](./DECISIONS.md) · Relatório:
[`MAIKE-FORMULACOES-REPORT.md`](./MAIKE-FORMULACOES-REPORT.md).
Precedentes executados: [`MAIKE-CADCURVAGANHO-RUNBOOK-RELEASE.md`](./MAIKE-CADCURVAGANHO-RUNBOOK-RELEASE.md)
(EXPAND só com tabela nova) e [`MAIKE-PESO-PROJETADO-RUNBOOK-RELEASE.md`](./MAIKE-PESO-PROJETADO-RUNBOOK-RELEASE.md) §7
(EXPAND, caminho B). Molde: [`MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md)
(§1 explica por que nunca `apply_migration` e nunca DDL solto).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261114600000_cadformulacao` |
| Natureza | **expand-only**: 3 tabelas NOVAS — `CADFORMULACAO`, `CADFORMULACAOINGREDIENTE` e `CADFORMULACAOREGRA` — com índices, FKs compostas pelo tenant (para Cliente, Empresa, Produto, `CADCATEGORIA` e entre elas), 5 CHECKs e o bloco RLS/REVOKE delas. Nenhuma tabela existente é alterada, nenhum dado migrado, nenhum `UPDATE` |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `96f3f3641815960335ddd5321896258a4114a42f62f46448ae53a35907784524` |
| Bloco RLS (`DO_RLS_APROVADOS`) | `b04af24e7e13859c210fa6d93193be060fac3ea2f2fa90cc99f41d0ed028bfd6` (mesmo corpo de sempre, lista nova) |
| `_prisma_migrations` | esperado **53** concluídas, 0 abertas (a última `20261114500000_atividade_cabecalho`, D-PROD-200); depois **54**. Recontar no §2 |
| Tabelas em `public` | **84** antes, **87** depois |

**Por que antes do merge (D-PROD-72 item 1):** a Vercel publica a `main` sozinha.
O runtime novo lê as 3 tabelas na tela Formulações e no lançamento de
suplementação do mapa (`GET /formulacoes/opcoes-lancamento`): sem a migration, as
rotas `/formulacoes*` respondem 500 e o lançamento do cocho fica sem formulação
(e, por ser obrigatória, sem como salvar). O runtime antigo não conhece as
tabelas e segue igual com o banco migrado — **não há janela**.

**Efeito durante a transação:** `CREATE TABLE` e as FKs pedem trava
`SHARE ROW EXCLUSIVE` por um instante nas tabelas referenciadas (`Cliente`,
`Empresa`, `Produto`, `CADCATEGORIA`) — leituras seguem, escritas nelas esperam o
fim da transação (milissegundos; as 3 tabelas nascem vazias). Uma espera além do
`lock_timeout` de 5 s aborta tudo sem aplicar nada.

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
  desvio da D-PROD-74.

## 2. Preflight — somente leitura (projeto `uuemcasqcdjucflulkne`)

```sql
SELECT system_identifier FROM pg_control_system();            -- 7692130048193495360
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok,
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS ruim
  FROM _prisma_migrations;                                     -- 53, 0
SELECT migration_name FROM _prisma_migrations
 WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
 ORDER BY finished_at DESC LIMIT 1;                            -- 20261114500000_atividade_cabecalho
SELECT to_regclass('public."CADFORMULACAO"'), to_regclass('public."CADFORMULACAOINGREDIENTE"'),
       to_regclass('public."CADFORMULACAOREGRA"');             -- null, null, null
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 84
```

E, localmente, no `<SHA_APROVADO>`: `sha256sum` do `migration.sql` igual ao
pinado, e `classificarMigrations` com `modo: EXPAND`,
`tabelas_novas = ["CADFORMULACAO", "CADFORMULACAOINGREDIENTE", "CADFORMULACAOREGRA"]`,
`colunas_novas_em_tabelas_antigas = []` e `violacoes: []` (teste B22a).

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
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261114600000_cadformulacao') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 53 OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF to_regclass('public."CADFORMULACAO"') IS NOT NULL
     OR to_regclass('public."CADFORMULACAOINGREDIENTE"') IS NOT NULL
     OR to_regclass('public."CADFORMULACAOREGRA"') IS NOT NULL THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: tabela de formulação já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '96f3f3641815960335ddd5321896258a4114a42f62f46448ae53a35907784524', now(),
        '20261114600000_cadformulacao', NULL, NULL, now(), 1);
COMMIT;
```

Qualquer falha desfaz tudo. Confirme pelo §4 que as tabelas não existem e que não
há linha nova, corrija a causa e peça novo GO.

**Ensaio local (2026-11-14):** o script acima, com o `migration.sql` integral,
num banco à parte com as 53 migrations da `main`: com o `system_identifier` de
produção recusou (`RELEASE_BLOCKED: alvo divergente`); com o local, aplicou numa
transação (53 → 54 / 0, checksum pinado, `applied_steps_count` 1, as 3 tabelas
com RLS ligado e sem FORCE, 87 tabelas em `public`), o `prisma migrate status`
disse "Database schema is up to date!", o `migrate diff` contra o
`schema.prisma` saiu vazio e a 2ª execução recusou
(`RELEASE_BLOCKED: migration já registrada`), sem linha nova.

## 4. Conferência — somente leitura

```sql
SELECT migration_name, checksum, rolled_back_at, applied_steps_count FROM _prisma_migrations
 WHERE migration_name = '20261114600000_cadformulacao';  -- 1 linha, checksum pinado, null, 1
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) FROM _prisma_migrations;  -- 54, 0
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
 WHERE relname IN ('CADFORMULACAO', 'CADFORMULACAOINGREDIENTE', 'CADFORMULACAOREGRA') AND relkind = 'r'
 ORDER BY relname;                                             -- 3 linhas, t, f
SELECT tablename, policyname FROM pg_policies
 WHERE tablename LIKE 'CADFORMULACAO%' ORDER BY 1;             -- maike_backend_all nas 3
SELECT count(*) FROM information_schema.role_table_grants
 WHERE table_name LIKE 'CADFORMULACAO%' AND grantee IN ('anon', 'authenticated');  -- 0
SELECT conname FROM pg_constraint WHERE conrelid IN ('public."CADFORMULACAO"'::regclass,
  'public."CADFORMULACAOINGREDIENTE"'::regclass, 'public."CADFORMULACAOREGRA"'::regclass) AND contype = 'c'
 ORDER BY 1;                                                   -- os 5 CHECKs
SELECT (SELECT count(*) FROM "CADFORMULACAO"), (SELECT count(*) FROM "CADFORMULACAOINGREDIENTE"),
       (SELECT count(*) FROM "CADFORMULACAOREGRA");            -- 0, 0, 0
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 87
```

Mais: `get_advisors` (segurança) sem alerta novo.

## 5. Merge, deploy e smoke

1. Merge **logo depois** do §4. 2. Deploy READY na Vercel: `/api/native/health`
com o `release` da `main` nova. 3. Smoke: `/api/native/formulacoes?empresa_id=x`
e `/api/native/formulacoes/opcoes-lancamento?empresa_id=x` sem sessão → 401; na
tela Manejo → Formulações, cadastrar um PRONTO (sal mineral) e uma BATELADA
(total e % da batida); dar a tela `pec-formulacoes` aos perfis que cadastram
(não há concessão automática); no mapa, o lançamento do cocho com a Formulação
escolhida sozinha quando há uma só.

## 6. Rollback

As 3 tabelas são novas e nenhuma tabela antiga as referencia. Reverter seria uma
migration nova com `DROP TABLE "CADFORMULACAOREGRA"`, `"CADFORMULACAOINGREDIENTE"`
e `"CADFORMULACAO"` (CONTRACT, com GO próprio), nunca editando esta. Com o
código novo no ar, reverter o código primeiro (o lançamento exige formulação).

## 7. Registro de execução

| Campo | Valor |
|---|---|
| Data/hora (UTC) | |
| Caminho | |
| GO | |
| Preflight (§2) | |
| Postcheck (§4) | |
| Resultado | |
