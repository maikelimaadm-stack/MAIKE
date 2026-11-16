# MAIKE — Abastecimento ligado à atividade (Fatia 5): runbook de release CONTRACT (D-PROD-211)

> **Estado: PLANO. `SCHEMA_APPLIED_PROD: NÃO`.** Aplicação só com o GO explícito e
> escrito do proprietário para **esta** migration.
>
> Cada passo para no primeiro desvio com **`RELEASE_BLOCKED`**. Valores entre `<…>`
> são preenchidos na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-211](./DECISIONS.md) · Contrato:
[`MAIKE-ATIVIDADE-ABASTECIMENTO-CONTRATO.md`](./MAIKE-ATIVIDADE-ABASTECIMENTO-CONTRATO.md) (§1). Precedente
executado: [`MAIKE-BASE-CONSUMO-RUNBOOK-RELEASE.md`](./MAIKE-BASE-CONSUMO-RUNBOOK-RELEASE.md)
(D-PROD-210, a anterior).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261116300000_abastecimento_atividade` |
| Natureza | **CONTRACT** (entrada fechada em `MIGRATIONS_CONTRACT_APROVADAS`, formato de sempre, sem `DROP TABLE`): colunas NOT NULL com DEFAULT, `DROP NOT NULL`, um `UPDATE` de backfill, um CHECK recriado, CHECKs e FKs novos numa tabela antiga. A guarda aborta a transação inteira se `AbastecimentoBem` não estiver no formato anterior |
| O que muda | `AbastecimentoBem` ganha `origem` (`VARCHAR(8)` NOT NULL DEFAULT `'ESTOQUE'`), `atividade_id`, `apontamento_id`, `centro_custo_id` (`VARCHAR(64)`, anuláveis), `medidor_leitura_anterior`, `medidor_delta` (`DECIMAL(14,4)`, anuláveis) e `intervalo_confiavel` (`BOOLEAN` NOT NULL DEFAULT `false`); `local_estoque_id` e `movimentacao_estoque_id` passam a anuláveis; o CHECK `AbastecimentoBem_status_check` volta com o estorno exigido só na origem `ESTOQUE`; CHECKs novos `AbastecimentoBem_origem_check`, `AbastecimentoBem_atividade_check` e `AbastecimentoBem_intervalo_check`; FKs `AbastecimentoBem_atividade_fkey`, `AbastecimentoBem_apontamento_fkey` e `AbastecimentoBem_centro_custo_fkey` (compostas pelo tenant e pela empresa, RESTRICT); índices `AbastecimentoBem_atividade_idx`, `AbastecimentoBem_apontamento_idx` e `AbastecimentoBem_centro_custo_idx` (começam por `cliente_id`) |
| Dados | as linhas existentes ficam `origem = 'ESTOQUE'` e `intervalo_confiavel = false`; o `centro_custo_id` delas vem do bem (`BemPatrimonial.centro_custo_id`); leitura anterior e delta ficam nulos (o snapshot não existia: desconhecido, sem inventar). Nenhuma linha some |
| O que não muda | nenhuma tabela criada ou apagada, nenhuma política, nenhuma outra tabela |
| SHA-256 do arquivo (`MIGRATIONS_APROVADAS`) | `6dfc825cb908c28e903e66b25d16f2628db5da2cb50b9af73c6f1711b7faa436` |
| Guarda (`guarda_sha256`) | `3f5a3a37959e571e3d2ee68cd2ec87e15138aa1b59903db0f13dbe4c90b502fa` |
| Classificador | `modo: CONTRACT`, `violacoes: []`, `contract[0]`: `decisao D-PROD-211`, `constraints_alargadas ["AbastecimentoBem.AbastecimentoBem_status_check"]` (mesmo nome, recriado), `colunas_adicionadas` (as 7), `constraints_adicionadas` (os 3 CHECKs e as 3 FKs), o resto vazio; o resto do arquivo são só os 3 `CREATE INDEX` não-únicos |
| `_prisma_migrations` | antes **61** concluídas, 0 em aberto (a última, a D-PROD-210, `20261116200000_formulacao_base_consumo`, checksum `a8c42eeb8c1fc7667833213d2d87c5a7dffd460ad1dea279ab6d5338732c3171`); depois **62** |
| Tabelas em `public` | **94** antes e depois |

**Ordem: aplicar ANTES do merge (D-PROD-72 item 1).** Produção tem **1** linha em
`AbastecimentoBem` (conferida pelo preflight):

- código de hoje com a migration aplicada: segue igual (grava `ESTOQUE` pelo DEFAULT,
  com local e movimento; não lê as colunas novas);
- código novo sem a migration: o Prisma falha ao ler e gravar `AbastecimentoBem`
  (colunas ausentes). Por isso a migration vem antes do merge.

O Instant Rollback da Vercel continua possível depois da aplicação (o código anterior
grava e lê como sempre; um abastecimento `EXTERNO` gravado pelo código novo aparece na
lista antiga sem local).

**Travas:** `ACCESS EXCLUSIVE` em `"AbastecimentoBem"` (pela guarda e pelos `ALTER
TABLE`) até o `COMMIT`; as FKs novas pegam `SHARE ROW EXCLUSIVE` em `"Atividade"`,
`"AtividadeApontamento"` e `"CentroCusto"` durante a validação. Com 1 linha, a tela de
abastecimentos e o Lançamento de Atividades esperam menos de 1 s. `lock_timeout` de
5 s: com uma transação longa segurando uma delas, aborta **sem aplicar nada**. Fora de
pico.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** `MIGRATION_DATABASE_URL` (direta ou
  sessão na 5432), `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360` e a
  conexão do runtime no MESMO banco:
  ```bash
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>                                         # ANÁLISE LOCAL OK (CONTRACT D-PROD-211: 1 CHECKs alargados, 7 colunas adicionadas (…), 6 constraints adicionadas (…))
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo --contract D-PROD-211  # ALVO VERIFICADO — 1 pendente(s) do manifesto
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar --contract D-PROD-211
  ```
- **B — conector Supabase, uma única `execute_sql` (§5):** desvio da D-PROD-74, só
  com o GO escrito do proprietário **para esta migration**, registrado no §9.

## 2. Pré-requisitos e GO

- validação **local** da PR verde (o GitHub Actions está pausado): `verify:all` e o
  ensaio do §4.2 no `<SHA_APROVADO>`; esta é a **única** migration nova da release;
- `AbastecimentoBem` no formato anterior (preflight linhas 5 a 7). Fora dele:
  `RELEASE_BLOCKED` e decisão nova do proprietário.

| GO | O quê | Situação |
|---|---|---|
| GO-1 | preflight **só leitura** em produção (§4) | `<pendente>` |
| GO-2 | aplicar a CONTRACT D-PROD-211 (§5) e mergear em seguida | `<pendente>` |

## 3. Ordem

Validação local verde → preflight §4 → GO-2 → aplicação §5 → postcheck §6 → merge →
deploy READY → Lançamento de Atividades: dentro de um lançamento, o bloco
Abastecimentos lista os ligados e abre o formulário com a origem (estoque da fazenda
ou posto externo).

## 4. Preflight (somente leitura)

### 4.1 Uma consulta, com veredito

<!-- sql:preflight -->
```sql
-- MAIKE · D-PROD-211 · PREFLIGHT (somente leitura). Cole TUDO e rode. Qualquer PARAR = não aplicar.
WITH
esperado AS (SELECT '7692130048193495360'::text AS sid),
mig AS (
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS abertas,
         count(*) FILTER (WHERE migration_name = '20261116300000_abastecimento_atividade' AND rolled_back_at IS NULL) AS esta,
         count(*) FILTER (WHERE migration_name = '20261116200000_formulacao_base_consumo'
                            AND checksum = 'a8c42eeb8c1fc7667833213d2d87c5a7dffd460ad1dea279ab6d5338732c3171'
                            AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS anterior
    FROM public._prisma_migrations
),
ab AS (SELECT to_regclass('public."AbastecimentoBem"')::oid AS oid),
colunas_novas AS (
  SELECT count(*) AS n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'AbastecimentoBem'
     AND column_name IN ('origem', 'atividade_id', 'apontamento_id', 'centro_custo_id', 'medidor_leitura_anterior', 'medidor_delta', 'intervalo_confiavel')
),
not_null AS (
  SELECT count(*) AS n FROM pg_attribute
   WHERE attrelid = (SELECT oid FROM ab) AND attname IN ('local_estoque_id', 'movimentacao_estoque_id') AND attnotnull AND NOT attisdropped
),
check_antigo AS (
  SELECT count(*) AS n FROM pg_constraint k
   WHERE k.conrelid = (SELECT oid FROM ab) AND k.conname = 'AbastecimentoBem_status_check' AND k.contype = 'c'
     AND pg_get_constraintdef(k.oid) NOT LIKE '%origem%'
),
checks_novos AS (
  SELECT count(*) AS n FROM pg_constraint k
   WHERE k.conrelid = (SELECT oid FROM ab)
     AND k.conname IN ('AbastecimentoBem_origem_check', 'AbastecimentoBem_atividade_check', 'AbastecimentoBem_intervalo_check')
),
-- Por SQL dinâmico, só quando a tabela existe (senão NULL: a linha diz PARAR, nunca erro).
linhas AS (
  SELECT CASE WHEN (SELECT oid FROM ab) IS NOT NULL
              THEN (xpath('/row/n/text()', query_to_xml('SELECT count(*) || '' / '' || count(b.centro_custo_id) AS n FROM public."AbastecimentoBem" a LEFT JOIN public."BemPatrimonial" b ON b.cliente_id = a.cliente_id AND b.empresa_id = a.empresa_id AND b.id = a.bem_id', false, true, '')))[1]::text
         END AS n
),
tabelas AS (SELECT count(*) AS n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')),
travas AS (
  SELECT count(*) AS n FROM pg_locks l
   WHERE l.locktype = 'relation' AND l.pid <> pg_backend_pid()
     AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
     AND l.relation IN (to_regclass('public."AbastecimentoBem"'), to_regclass('public."Atividade"'), to_regclass('public."AtividadeApontamento"'), to_regclass('public."CentroCusto"'))
),
longas AS (
  SELECT count(*) AS n FROM pg_stat_activity
   WHERE datname = current_database() AND pid <> pg_backend_pid() AND xact_start IS NOT NULL AND now() - xact_start > interval '30 seconds'
),
base(ordem, item, valor, esperado, status) AS (
  SELECT 1, 'alvo: system_identifier', (SELECT system_identifier::text FROM pg_control_system()), (SELECT sid FROM esperado),
         CASE WHEN (SELECT system_identifier::text FROM pg_control_system()) = (SELECT sid FROM esperado) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 2, 'migrations concluídas / em aberto', (SELECT concluidas || ' / ' || abertas FROM mig), '61 / 0',
         CASE WHEN (SELECT concluidas = 61 AND abertas = 0 FROM mig) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 3, '20261116300000_abastecimento_atividade já registrada', (SELECT esta::text FROM mig), '0',
         CASE WHEN (SELECT esta FROM mig) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 4, 'a anterior (D-PROD-210) concluída com o checksum do repositório', (SELECT anterior::text FROM mig), '1',
         CASE WHEN (SELECT anterior FROM mig) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 5, 'colunas novas já presentes em AbastecimentoBem (tem de ser 0)', (SELECT n::text FROM colunas_novas), '0',
         CASE WHEN (SELECT n FROM colunas_novas) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 6, 'local_estoque_id e movimentacao_estoque_id ainda NOT NULL', (SELECT n::text FROM not_null), '2',
         CASE WHEN (SELECT n FROM not_null) = 2 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 7, 'CHECK AbastecimentoBem_status_check no formato anterior (sem origem) / CHECKs novos ausentes',
         (SELECT n::text FROM check_antigo) || ' / ' || (SELECT n::text FROM checks_novos), '1 / 0',
         CASE WHEN (SELECT n FROM check_antigo) = 1 AND (SELECT n FROM checks_novos) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 8, 'abastecimentos / com centro de custo no bem (o backfill)', (SELECT coalesce(n, 'ausente') FROM linhas), '<confira com o §0>',
         CASE WHEN (SELECT n FROM linhas) IS NOT NULL THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 9, 'tabelas em public', (SELECT n::text FROM tabelas), '94',
         CASE WHEN (SELECT n FROM tabelas) = 94 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 10, 'travas de outras sessões em "AbastecimentoBem" e nos 3 alvos das FKs, agora', (SELECT n::text FROM travas), '0',
         CASE WHEN (SELECT n FROM travas) = 0 THEN 'OK' ELSE 'ATENÇÃO (repita fora de pico)' END
  UNION ALL
  SELECT 11, 'transações abertas há mais de 30 s', (SELECT n::text FROM longas), '0',
         CASE WHEN (SELECT n FROM longas) = 0 THEN 'OK' ELSE 'ATENÇÃO (a trava espera 5 s e desiste)' END
)
SELECT item, valor, esperado, status FROM (
  SELECT * FROM base
  UNION ALL
  SELECT 999, 'VEREDITO',
         CASE WHEN EXISTS (SELECT 1 FROM base WHERE status LIKE 'PARAR%') THEN 'PARAR: há linha PARAR acima'
              ELSE 'PRONTO PARA APLICAR (confira as linhas ATENÇÃO)' END, '-', '-'
) x ORDER BY ordem;
```
<!-- /sql:preflight -->

Esperado hoje: `7692130048193495360`; `61 / 0`; `0`; `1`; `0`; `2`; `1 / 0`;
`1 / <0 ou 1>` (a linha de produção; com centro no bem, ela recebe o centro);
`94`; `0`; `0`; `PRONTO PARA APLICAR`. E, localmente, `sha256sum` do arquivo igual
ao do §0.

### 4.2 Ensaio local

Automatizado em `backend/tests/abastecimentoAtividadeMigration.test.mjs`
(PostgreSQL local, bancos próprios). Roda **este** preflight, **este** envelope e
**este** postcheck (entre os marcadores `sql:…`), trocando só o `system_identifier`:
partida com as 61 anteriores e abastecimentos de 2 clientes (um com centro de custo
no bem, um sem, um cancelado com estorno); classificador e barreira do runner (sem
`MIGRATION_CONTRACT_AUTORIZADO=D-PROD-211` exato recusa antes do DDL); RED (coluna
nova já presente, ou local já anulável: a guarda recusa e nada muda); GREEN pelo
runner (62/0, 94 tabelas, o backfill do centro de custo vindo do bem, as formas que os
CHECKs aceitam e recusam, `migrate diff` vazio, postcheck `APLICADA`; reaplicar é
recusado pela guarda); caminho B (o SID de produção, histórico fora de 61/0, a
D-PROD-210 com outro checksum ou uma coluna nova já presente recusam antes do DDL; o
envelope aplica 61 → 62; repetir recusa).

## 5. Aplicação — só com o GO-2

### Caminho A

Os comandos do §1 com `--contract D-PROD-211`.

### Caminho B (conector, uma `execute_sql`, só com o GO escrito para ESTA migration)

<!-- sql:caminho-b -->
```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(72707369);  -- a mesma trava do prisma migrate (D-PROD-75)
DO $alvo$
DECLARE n_ok bigint; n_aberta bigint;
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7692130048193495360 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: alvo divergente';
  END IF;
  IF EXISTS (SELECT 1 FROM _prisma_migrations
              WHERE migration_name = '20261116300000_abastecimento_atividade' AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)
    INTO n_ok, n_aberta FROM _prisma_migrations;
  IF n_ok <> 61 OR n_aberta <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % em aberto', n_ok, n_aberta;
  END IF;
  IF (SELECT count(*) FROM _prisma_migrations
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
         AND migration_name = '20261116200000_formulacao_base_consumo'
         AND checksum = 'a8c42eeb8c1fc7667833213d2d87c5a7dffd460ad1dea279ab6d5338732c3171') <> 1 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (D-PROD-210) ausente ou com checksum divergente';
  END IF;
  -- A guarda da migration (logo abaixo) confere o formato inteiro e trava "AbastecimentoBem"; esta conferência só para antes, com a mensagem do runbook.
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'AbastecimentoBem'
               AND column_name IN ('origem', 'atividade_id', 'apontamento_id', 'centro_custo_id', 'medidor_leitura_anterior', 'medidor_delta', 'intervalo_confiavel')) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: AbastecimentoBem já tem coluna nova';
  END IF;
END $alvo$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '6dfc825cb908c28e903e66b25d16f2628db5da2cb50b9af73c6f1711b7faa436', now(),
        '20261116300000_abastecimento_atividade', NULL, NULL, now(), 1);
COMMIT;
```
<!-- /sql:caminho-b -->

O `migration.sql` não tem `BEGIN`/`COMMIT`; a guarda `DO $$ … $$` vai como está. O
`checksum` do `INSERT` é o SHA-256 do arquivo. Qualquer falha desfaz tudo.

**Falha no caminho A** (`55P03`, `guarda: …`): nada fica; conferir pelo preflight;
`DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate resolve --rolled-back 20261116300000_abastecimento_atividade --schema backend/prisma/schema.prisma`;
eliminar a causa e confirmar com o proprietário. Com `guarda: o abastecimento não está
no formato anterior` ou `guarda: os CHECKs do abastecimento não estão no formato
anterior`: **não** tentar de novo (decisão nova).
**Falha no caminho B:** nada é aplicado; repetir o preflight e confirmar com o
proprietário.

## 6. Postcheck (antes do merge; só leitura)

<!-- sql:postcheck -->
```sql
-- MAIKE · D-PROD-211 · POSTCHECK (somente leitura). Cole TUDO e rode. Esperado: tudo OK e VEREDITO APLICADA.
WITH
esperado AS (SELECT '7692130048193495360'::text AS sid),
mig AS (
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS abertas,
         count(*) FILTER (WHERE migration_name = '20261116300000_abastecimento_atividade'
                            AND checksum = '6dfc825cb908c28e903e66b25d16f2628db5da2cb50b9af73c6f1711b7faa436'
                            AND finished_at IS NOT NULL AND rolled_back_at IS NULL AND applied_steps_count = 1) AS esta
    FROM public._prisma_migrations
),
ab AS (SELECT to_regclass('public."AbastecimentoBem"')::oid AS oid),
-- As 7 colunas, cada uma com o tipo, a nulidade e o DEFAULT do contrato.
colunas AS (
  SELECT count(*) AS n FROM information_schema.columns c
   WHERE c.table_schema = 'public' AND c.table_name = 'AbastecimentoBem' AND (
         (c.column_name = 'origem' AND c.data_type = 'character varying' AND c.character_maximum_length = 8 AND c.is_nullable = 'NO' AND c.column_default LIKE '''ESTOQUE''%')
      OR (c.column_name IN ('atividade_id', 'apontamento_id', 'centro_custo_id') AND c.data_type = 'character varying' AND c.character_maximum_length = 64 AND c.is_nullable = 'YES' AND c.column_default IS NULL)
      OR (c.column_name IN ('medidor_leitura_anterior', 'medidor_delta') AND c.data_type = 'numeric' AND c.numeric_precision = 14 AND c.numeric_scale = 4 AND c.is_nullable = 'YES' AND c.column_default IS NULL)
      OR (c.column_name = 'intervalo_confiavel' AND c.data_type = 'boolean' AND c.is_nullable = 'NO' AND c.column_default = 'false'))
),
anulaveis AS (
  SELECT count(*) AS n FROM pg_attribute
   WHERE attrelid = (SELECT oid FROM ab) AND attname IN ('local_estoque_id', 'movimentacao_estoque_id') AND NOT attnotnull AND NOT attisdropped
),
checks_novos AS (
  SELECT count(*) AS n FROM pg_constraint k
   WHERE k.conrelid = (SELECT oid FROM ab) AND k.contype = 'c' AND k.convalidated
     AND ((k.conname = 'AbastecimentoBem_status_check' AND pg_get_constraintdef(k.oid) LIKE '%origem%EXTERNO%')
          OR k.conname IN ('AbastecimentoBem_origem_check', 'AbastecimentoBem_atividade_check', 'AbastecimentoBem_intervalo_check'))
),
checks_ab AS (SELECT count(*) AS n FROM pg_constraint k WHERE k.conrelid = (SELECT oid FROM ab) AND k.contype = 'c'),
fks AS (
  SELECT count(*) AS n FROM pg_constraint k
   WHERE k.conrelid = (SELECT oid FROM ab) AND k.contype = 'f' AND k.convalidated AND k.confdeltype = 'r'
     AND ((k.conname = 'AbastecimentoBem_atividade_fkey' AND k.confrelid = to_regclass('public."Atividade"'))
          OR (k.conname = 'AbastecimentoBem_apontamento_fkey' AND k.confrelid = to_regclass('public."AtividadeApontamento"'))
          OR (k.conname = 'AbastecimentoBem_centro_custo_fkey' AND k.confrelid = to_regclass('public."CentroCusto"')))
     AND array_length(k.conkey, 1) = 3
),
indices AS (
  SELECT count(*) AS n FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'AbastecimentoBem'
     AND indexname IN ('AbastecimentoBem_atividade_idx', 'AbastecimentoBem_apontamento_idx', 'AbastecimentoBem_centro_custo_idx')
     AND indexdef NOT LIKE 'CREATE UNIQUE%' AND indexdef LIKE '%(cliente_id, empresa_id, %'
),
-- Por SQL dinâmico, só quando a coluna existe (senão NULL: a linha diz PARAR, nunca erro).
existe AS (
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'AbastecimentoBem' AND column_name = 'centro_custo_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'AbastecimentoBem' AND column_name = 'intervalo_confiavel') AS ok
),
backfill AS (
  SELECT CASE WHEN (SELECT ok FROM existe)
              THEN (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public."AbastecimentoBem" a JOIN public."BemPatrimonial" b ON b.cliente_id = a.cliente_id AND b.empresa_id = a.empresa_id AND b.id = a.bem_id WHERE a.centro_custo_id IS DISTINCT FROM b.centro_custo_id', false, true, '')))[1]::text::bigint
         END AS n
),
formato AS (
  SELECT CASE WHEN (SELECT ok FROM existe)
              THEN (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public."AbastecimentoBem" WHERE origem <> ''ESTOQUE'' OR intervalo_confiavel OR medidor_leitura_anterior IS NOT NULL OR medidor_delta IS NOT NULL OR atividade_id IS NOT NULL OR apontamento_id IS NOT NULL', false, true, '')))[1]::text::bigint
         END AS n
),
tabelas AS (SELECT count(*) AS n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')),
base(ordem, item, valor, esperado, status) AS (
  SELECT 1, 'alvo: system_identifier', (SELECT system_identifier::text FROM pg_control_system()), (SELECT sid FROM esperado),
         CASE WHEN (SELECT system_identifier::text FROM pg_control_system()) = (SELECT sid FROM esperado) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 2, '20261116300000_abastecimento_atividade concluída (checksum pinado, applied_steps_count 1)', (SELECT esta::text FROM mig), '1',
         CASE WHEN (SELECT esta FROM mig) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 3, 'migrations concluídas / em aberto', (SELECT concluidas || ' / ' || abertas FROM mig), '62 / 0',
         CASE WHEN (SELECT concluidas = 62 AND abertas = 0 FROM mig) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 4, 'as 7 colunas novas com o tipo, a nulidade e o DEFAULT do contrato', (SELECT n::text FROM colunas), '7',
         CASE WHEN (SELECT n FROM colunas) = 7 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 5, 'local_estoque_id e movimentacao_estoque_id anuláveis', (SELECT n::text FROM anulaveis), '2',
         CASE WHEN (SELECT n FROM anulaveis) = 2 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 6, 'CHECKs status (com origem), origem, atividade e intervalo, validados', (SELECT n::text FROM checks_novos), '4',
         CASE WHEN (SELECT n FROM checks_novos) = 4 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 7, 'CHECKs em "AbastecimentoBem" (nenhum a mais nem a menos)', (SELECT n::text FROM checks_ab), '10',
         CASE WHEN (SELECT n FROM checks_ab) = 10 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 8, 'FKs atividade, apontamento e centro de custo (compostas, RESTRICT), validadas', (SELECT n::text FROM fks), '3',
         CASE WHEN (SELECT n FROM fks) = 3 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 9, 'índices novos não-únicos começando por (cliente_id, empresa_id)', (SELECT n::text FROM indices), '3',
         CASE WHEN (SELECT n FROM indices) = 3 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 10, 'abastecimentos com centro de custo diferente do do bem (o backfill)', (SELECT coalesce(n::text, 'ausente') FROM backfill), '0',
         CASE WHEN (SELECT n FROM backfill) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 11, 'abastecimentos fora do formato de antes (origem, vínculo, leitura anterior, delta, intervalo)', (SELECT coalesce(n::text, 'ausente') FROM formato), '0',
         CASE WHEN (SELECT n FROM formato) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 12, 'tabelas em public', (SELECT n::text FROM tabelas), '94',
         CASE WHEN (SELECT n FROM tabelas) = 94 THEN 'OK' ELSE 'PARAR' END
)
SELECT item, valor, esperado, status FROM (
  SELECT * FROM base
  UNION ALL
  SELECT 999, 'VEREDITO',
         CASE WHEN EXISTS (SELECT 1 FROM base WHERE status LIKE 'PARAR%') THEN 'PARAR: há linha PARAR acima; não mergear'
              ELSE 'APLICADA E CONFERIDA' END, '-', '-'
) x ORDER BY ordem;
```
<!-- /sql:postcheck -->

Esperado: `1`; `62 / 0`; `7`; `2`; `4`; `10`; `3`; `3`; `0`; `0`; `94`; VEREDITO
`APLICADA E CONFERIDA`. `get_advisors`: nada novo (os 3 índices cobrem as 3 FKs).

## 7. Reversão

- **Código:** o Instant Rollback é seguro (o código anterior grava `ESTOQUE` pelo
  DEFAULT, com local e movimento, e não lê as colunas novas).
- **Banco:** uma migration **nova**, com decisão e GO próprios, nunca editando esta:
  sair as FKs, os CHECKs novos, os índices e as colunas, e voltar o CHECK de status e o
  NOT NULL de local e movimento. Exata enquanto nenhum abastecimento for `EXTERNO`; com
  algum, decisão do proprietário (o externo não tem local nem movimento).

## 8. `RELEASE_BLOCKED`

Sem o GO-2; validação local não verde; `system_identifier` diferente; histórico
diferente de 61/0, a D-PROD-210 com outro checksum ou a D-PROD-211 já registrada;
`AbastecimentoBem` fora do formato anterior; qualquer `PARAR` no preflight; outra
migration nova na mesma release; SHA-256 diferente do pinado; ensaio local sem passar.

## 9. Registro da execução

| Campo | Valor |
|---|---|
| GO-1 e GO-2 | `<pendente>` |
| Caminho | `<pendente>` |
| `<SHA_APROVADO>` | `<pendente>` |
| Ensaio local (§4.2) | `<pendente>` |
| Preflight (§4) | `<pendente>` |
| Aplicação | `<pendente>` |
| Postcheck (§6) | `<pendente>` |
| Merge e deploy | `<pendente>` |
