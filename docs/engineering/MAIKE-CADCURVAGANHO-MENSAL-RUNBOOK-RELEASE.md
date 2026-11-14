# MAIKE — Curva de Ganho mensal: runbook de release CONTRACT (D-PROD-190)

> **Estado: NÃO EXECUTADO. `SCHEMA_APPLIED_PROD: NÃO`.**
>
> Este documento é o plano. Cada passo exige o GO do proprietário e para no
> primeiro desvio com **`RELEASE_BLOCKED`**. Valores entre `<…>` são preenchidos
> na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-190](./DECISIONS.md) · Relatório:
[`MAIKE-CADCURVAGANHO-MENSAL-REPORT.md`](./MAIKE-CADCURVAGANHO-MENSAL-REPORT.md).
Precedentes executados: [`MAIKE-CADCURVAGANHO-RUNBOOK-RELEASE.md`](./MAIKE-CADCURVAGANHO-RUNBOOK-RELEASE.md) §7
(mesmo formato, caminho B) e [`MAIKE-TIPO-TAREFA-DROP-COLUNAS-RUNBOOK-RELEASE.md`](./MAIKE-TIPO-TAREFA-DROP-COLUNAS-RUNBOOK-RELEASE.md)
(CONTRACT com guarda). Molde: [`MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md)
(§1 explica por que nunca `apply_migration` e nunca DDL solto).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261114100000_cadcurvaganho_mensal` |
| Natureza | **CONTRACT** (terceira exceção fechada, depois da D-PROD-162 e da D-PROD-183): apaga a tabela `"CADCURVAGANHO"` **vazia** e a cria de novo com os 12 GMD mensais (`gmd_jan` … `gmd_dez`, `DECIMAL(6,3)`, -2 a 3). Mesmo nome físico, mesmas FKs de escopo, índices, CHECK `CADCURVAGANHO_gmd_check` (agora sobre os 12 meses) e o mesmo bloco RLS/REVOKE. Nenhuma outra tabela é tocada; nenhum dado é migrado |
| Guarda da própria migration | recusa (e desfaz tudo) se a tabela não existir, se não tiver exatamente as 3 colunas por estação, se tiver **qualquer curva**, FK de outra tabela, gatilho de usuário, política além de `maike_backend_all` ou função citando as colunas antigas |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `a18b2845815a637398ccd8d1e0f9cbcbad1bab8e8b628e988d26cf09c302953c` |
| Guarda pinada (`MIGRATIONS_CONTRACT_APROVADAS`) | `3cd5adc49d6e0cab0e155b190d7c095a419b7ddbb0ef617bc5000bc9bdfb0b6d`; `drop = ["CADCURVAGANHO"]`, sem `alter_antigas` |
| Hash do DO de RLS | `eaafebfa75191f2e77bd59d6a6ecf6af2c33ee86c536c39fe2b0e881cf1680a7` (o mesmo da D-PROD-189, já aprovado) |
| `_prisma_migrations` | antes: **44** concluídas, 0 abertas (a última `20261113600000_cadcurvaganho_cadastro`); depois **45**. Se a Fatia D (PR #268, `…500000`, CONTRACT) for aplicada antes, recontar no §2 |
| Tabelas em `public` | **82** antes e depois |

**Janela entre a aplicação e o deploy.** A produção roda o código da D-PROD-189,
que lê `gmd_aguas`, `gmd_transicao` e `gmd_seca`. Do `COMMIT` até a `main` nova
ficar READY na Vercel, as 5 rotas `/curvas-ganho` respondem 500 (coluna
inexistente). Nada mais é afetado: `DELETE /empresas/:id` só **conta** as curvas
(não lê colunas de GMD). A tabela está vazia e a tela é nova, então o impacto é
só a tela de Curvas de Ganho por alguns minutos. Por isso o merge vem **logo
depois** da conferência do §4.

**Por que antes do merge (D-PROD-72 item 1):** o código novo sem a migration
daria 500 nas mesmas rotas, pelo motivo inverso (colunas `gmd_jan` … ausentes).
Os dois lados da janela afetam só esta tela; a ordem do runbook é a de sempre.

**Efeito durante a transação:** `ACCESS EXCLUSIVE` em `"CADCURVAGANHO"` e, pelas
FKs recriadas, `SHARE ROW EXCLUSIVE` em `Cliente` e `Empresa` até o `COMMIT`. Com
`lock_timeout` de 5 s, uma transação longa nelas aborta tudo sem aplicar nada.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** numa máquina protegida, com
  `MIGRATION_DATABASE_URL` (sessão/direta, nunca o pooler 6543),
  `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360` e `DATABASE_URL` do
  mesmo banco. Por ser CONTRACT, a release é **isolada** (esta é a única
  migration nova) e exige a decisão exata:
  ```bash
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>                                  # análise local: CONTRACT D-PROD-190
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo --contract D-PROD-190
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar --contract D-PROD-190   # repassa MIGRATION_CONTRACT_AUTORIZADO=D-PROD-190
  ```
- **B — conector Supabase, uma única `execute_sql` (§3):** só com autorização
  **escrita e específica do proprietário para esta migration**, registrada como
  desvio da D-PROD-74. Nunca presumida de releases anteriores nem de
  autorização genérica.

## 2. Preflight — somente leitura (projeto `uuemcasqcdjucflulkne`)

```sql
SELECT system_identifier FROM pg_control_system();            -- 7692130048193495360
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok,
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS ruim
  FROM _prisma_migrations;                                     -- <N_OK>, 0
SELECT count(*) FROM "CADCURVAGANHO";                          -- 0 (senão: RELEASE_BLOCKED, novo GO)
SELECT string_agg(column_name, ',' ORDER BY column_name) FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'CADCURVAGANHO' AND column_name LIKE 'gmd%';
                                                               -- gmd_aguas,gmd_seca,gmd_transicao
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 82
```

E, localmente, no `<SHA_APROVADO>`:
`sha256sum backend/prisma/migrations/20261114100000_cadcurvaganho_mensal/migration.sql`
igual ao pinado, e o classificador (`classificarMigrations`) com `modo: CONTRACT`,
`contract[0].decisao = "D-PROD-190"`, `tabelas_removidas = ["CADCURVAGANHO"]`,
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
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261114100000_cadcurvaganho_mensal') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> <N_OK> OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>
-- (a guarda da própria migration confere tabela vazia, estrutura por estação e dependências)

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'a18b2845815a637398ccd8d1e0f9cbcbad1bab8e8b628e988d26cf09c302953c', now(),
        '20261114100000_cadcurvaganho_mensal', NULL, NULL, now(), 1);
COMMIT;
```

- O `migration.sql` não tem `BEGIN`/`COMMIT` próprios. Os únicos `DROP` são o
  `DROP TABLE "CADCURVAGANHO"` (tabela vazia, conferido pela guarda) e o
  `DROP POLICY IF EXISTS` na tabela recriada. Nenhum `DELETE`, `TRUNCATE` ou `UPDATE`.
- Qualquer falha desfaz tudo. Confirme pelo §4 que a tabela continua com as 3
  colunas por estação e que não há linha nova, corrija a causa e peça novo GO.

## 4. Conferência — somente leitura

```sql
SELECT migration_name, checksum, rolled_back_at, applied_steps_count FROM _prisma_migrations
 WHERE migration_name = '20261114100000_cadcurvaganho_mensal';  -- 1 linha, checksum pinado, null, 1
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
  FROM _prisma_migrations;                                     -- <N_OK> + 1, 0
SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'CADCURVAGANHO' AND column_name LIKE 'gmd%';
  -- gmd_jan,gmd_fev,gmd_mar,gmd_abr,gmd_mai,gmd_jun,gmd_jul,gmd_ago,gmd_set,gmd_out,gmd_nov,gmd_dez
SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'CADCURVAGANHO';  -- t, f
SELECT conname FROM pg_constraint WHERE conrelid = 'public."CADCURVAGANHO"'::regclass ORDER BY 1;
  -- CADCURVAGANHO_cliente_id_empresa_id_fkey, CADCURVAGANHO_cliente_id_fkey,
  -- CADCURVAGANHO_gmd_check, CADCURVAGANHO_pkey
SELECT policyname, roles FROM pg_policies WHERE tablename = 'CADCURVAGANHO';  -- maike_backend_all, {maike_vercel}
SELECT has_table_privilege('anon', 'public."CADCURVAGANHO"', 'SELECT'),
       has_table_privilege('authenticated', 'public."CADCURVAGANHO"', 'SELECT');  -- f, f
SELECT count(*) FROM "CADCURVAGANHO";                          -- 0
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 82
```

Mais: `get_advisors` (segurança) sem alerta novo para `CADCURVAGANHO`.

## 5. Merge, deploy e smoke (proprietário)

1. Merge da PR **logo depois** do §4 (a janela da tela de curvas fica aberta até
   o deploy). 2. Deploy READY na Vercel: `/api/native/health` com o `release` da
   `main` nova. 3. Smoke: `/api/native/curvas-ganho` sem sessão → 401; na tela
   Manejo → Curvas de Ganho, com uma fazenda selecionada, criar uma curva de
   teste com os 12 meses, editar um mês e excluir.

## 6. Rollback

Não há reversão automática. A tabela sai e volta **vazia**: antes de qualquer
curva cadastrada, voltar à estrutura por estação seria uma migration nova, com
GO próprio, nunca editando esta. Com o código novo no ar, reverter o código
primeiro. É proibido voltar a Vercel para o deploy anterior com o schema novo
aplicado.

## 7. Registro de execução

_(vazio — preencher com data/hora UTC, caminho usado, GO citado, resultado do §4.)_
