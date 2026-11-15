# MAIKE — Leitura de cocho: runbook de release expand-only (D-PROD-205)

> **Estado: EXECUTADO em 2026-11-15 15:20:55 UTC (caminho B). `SCHEMA_APPLIED_PROD: SIM`.** Registro no §7.
>
> Este documento é o plano. Cada passo exige o GO do proprietário e para no
> primeiro desvio com **`RELEASE_BLOCKED`**. Valores entre `<…>` são preenchidos
> na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-205](./DECISIONS.md) · Relatório:
[`MAIKE-LEITURA-COCHO-REPORT.md`](./MAIKE-LEITURA-COCHO-REPORT.md).
Precedente executado: [`MAIKE-FORMULACOES-RUNBOOK-RELEASE.md`](./MAIKE-FORMULACOES-RUNBOOK-RELEASE.md) §7
(EXPAND, caminho B). Molde: [`MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md)
(§1 explica por que nunca `apply_migration` e nunca DDL solto).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261115100000_leitura_cocho` |
| Natureza | **expand-only**: 1 tabela NOVA — `LEITURACOCHO` — com 3 índices, FKs compostas pelo tenant (Cliente e Empresa Restrict; PontoSuplementacao CASCADE), 3 CHECKs e o bloco RLS/REVOKE dela. Nenhuma tabela existente é alterada, nenhum dado migrado, nenhum `UPDATE` |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `f31cb0b8dace187b3b7bc76d6b989c0b6f2f0cd96c623834efcd23c0a9bcd1a1` |
| Bloco RLS (`DO_RLS_APROVADOS`) | `60149f94e07596da2c93471f82110e6f37b5f014bcf721c1dc366a2d4b4bcce8` (mesmo corpo de sempre, lista nova) |
| `_prisma_migrations` | esperado **55** concluídas, 0 abertas (a última `20261114700000_cadformulacao`, D-PROD-203); depois **56**. Recontar no §2 |
| Tabelas em `public` | **90** antes, **91** depois |

**Por que antes do merge (D-PROD-72 item 1):** a Vercel publica a `main` sozinha.
O runtime novo lê a tabela no mapa (capacidade `leiturasCocho` do cache, farol do
cocho) e grava nela pela Leitura de cocho: sem a migration, `/leituras-cocho`
responde 500 (o mapa cai no cache e o farol fica cinza; a leitura não salva). O
runtime antigo não conhece a tabela e segue igual com o banco migrado — **não há janela**.

**Efeito durante a transação:** `CREATE TABLE` e as FKs pedem trava
`SHARE ROW EXCLUSIVE` por um instante nas tabelas referenciadas (`Cliente`,
`Empresa`, `PontoSuplementacao`) — leituras seguem, escritas nelas esperam o fim
da transação (milissegundos; a tabela nasce vazia). Uma espera além do
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
  FROM _prisma_migrations;                                     -- 55, 0
SELECT migration_name FROM _prisma_migrations
 WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
 ORDER BY finished_at DESC LIMIT 1;                            -- 20261114700000_cadformulacao
SELECT to_regclass('public."LEITURACOCHO"');                   -- null
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 90
```

E, localmente, no `<SHA_APROVADO>`: `sha256sum` do `migration.sql` igual ao
pinado, e `classificarMigrations` com `modo: EXPAND`,
`tabelas_novas = ["LEITURACOCHO"]`, `colunas_novas_em_tabelas_antigas = []` e
`violacoes: []` (teste B24a).

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
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261115100000_leitura_cocho') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 55 OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF to_regclass('public."LEITURACOCHO"') IS NOT NULL THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: tabela LEITURACOCHO já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'f31cb0b8dace187b3b7bc76d6b989c0b6f2f0cd96c623834efcd23c0a9bcd1a1', now(),
        '20261115100000_leitura_cocho', NULL, NULL, now(), 1);
COMMIT;
```

O script pronto, com o `migration.sql` integral, fica fora do repositório, no
rascunho da sessão (`aplicar205.sql`); confira o SHA-256 do trecho da migration
antes de usar. Qualquer falha desfaz tudo. Confirme pelo §4 que a tabela não
existe e que não há linha nova, corrija a causa e peça novo GO.

**Ensaio local (2026-11-15):** o script acima, com o `migration.sql` integral,
num banco à parte com as 55 migrations da `main`: com o `system_identifier` de
produção recusou (`RELEASE_BLOCKED: alvo divergente`); com o local, aplicou numa
transação (55 → 56 / 0, checksum pinado, `applied_steps_count` 1, a tabela com RLS
ligado e sem FORCE, 91 tabelas em `public`), o `prisma migrate status` disse
"Database schema is up to date!", o `migrate diff` contra o `schema.prisma` saiu
vazio e a 2ª execução recusou (`RELEASE_BLOCKED: migration já registrada`), sem
linha nova.

## 4. Conferência — somente leitura

```sql
SELECT migration_name, checksum, rolled_back_at, applied_steps_count FROM _prisma_migrations
 WHERE migration_name = '20261115100000_leitura_cocho';  -- 1 linha, checksum pinado, null, 1
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) FROM _prisma_migrations;  -- 56, 0
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
 WHERE relname = 'LEITURACOCHO' AND relkind = 'r';             -- 1 linha, t, f
SELECT tablename, policyname FROM pg_policies WHERE tablename = 'LEITURACOCHO';  -- maike_backend_all
SELECT count(*) FROM information_schema.role_table_grants
 WHERE table_name = 'LEITURACOCHO' AND grantee IN ('anon', 'authenticated');  -- 0
SELECT conname FROM pg_constraint WHERE conrelid = 'public."LEITURACOCHO"'::regclass AND contype IN ('c', 'f')
 ORDER BY 1;                                                   -- 3 CHECKs e 3 FKs
SELECT count(*) FROM "LEITURACOCHO";                           -- 0
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 91
```

Mais: `get_advisors` (segurança) sem alerta novo.

## 5. Merge, deploy e smoke

1. Merge **logo depois** do §4. 2. Deploy READY na Vercel: `/api/native/health`
com o `release` da `main` nova. 3. Smoke: `/api/native/leituras-cocho` sem sessão
→ 401; no mapa, abrir um cocho → **Leitura** → registrar "Vazio" e ver o ponto
vermelho no marcador e na seção "Leitura do cocho"; registrar acesso ruim ou
estrutura com problema e ver o aviso; excluir a leitura de teste.

## 6. Rollback

A tabela é nova e nenhuma tabela antiga a referencia. Reverter seria uma
migration nova com `DROP TABLE "LEITURACOCHO"` (CONTRACT, com GO próprio), nunca
editando esta. Com o código novo no ar, reverter o código primeiro.

## 7. Registro de execução

| Campo | Valor |
|---|---|
| Data/hora (UTC) | 2026-11-15 15:20:55 (`finished_at` da linha em `_prisma_migrations`) |
| Caminho | **B**: o SQL do §3 (`aplicar205.sql`, com o `migration.sql` integral) numa transação única pelo `execute_sql` do Supabase, projeto `uuemcasqcdjucflulkne`; guarda exigindo **55** concluídas. Aplicado pela sessão coordenadora |
| GO | Do proprietário, pela aprovação da chamada que ele mesmo pediu no chat ("me envie a solicitação de autorização"), específica desta migration |
| Preflight (§2) | guarda da transação: `system_identifier` 7692130048193495360; 55 concluídas / 0 com falha; `LEITURACOCHO` ausente |
| Ensaio | Banco local com as 55 migrations da `main`: aplicou (56 / 0, 91 tabelas, `migrate status` em dia, `migrate diff` vazio); reexecução recusada (`migration já registrada`); alvo divergente recusado |
| Postcheck (§4) | 56 concluídas / 0 com falha; checksum `f31cb0b8dace187b3b7bc76d6b989c0b6f2f0cd96c623834efcd23c0a9bcd1a1` igual ao pinado; `LEITURACOCHO` com RLS ligado, 1 política; 7 constraints (pkey + 3 FK + 3 CHECK); `anon` sem SELECT; 91 tabelas em `public` |
| Resultado | **APLICADA E CONFERIDA** antes do merge (D-PROD-72) |
