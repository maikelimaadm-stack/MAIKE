# MAIKE — Várias áreas por atividade: runbook de release CONTRACT (D-PROD-249)

> **Estado: EXECUTADO. `SCHEMA_APPLIED_PROD: SIM`.** Aplicada em produção em **2026-11-18 às
> 19:05:13 UTC**, pelo **caminho B** (Supabase `execute_sql` com o envelope do §5), com GO do
> proprietário. A PR #327 já estava mergeada, o que fechou o caminho A (`CONTRACT_INESPERADO`,
> como na D-PROD-183). Registro no §9.
>
> Cada passo para no primeiro desvio com **`RELEASE_BLOCKED`**. Valores entre `<…>`
> são preenchidos na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-249](./DECISIONS.md) · Contrato:
[`MAIKE-ATIVIDADE-AREAS-CONTRATO.md`](./MAIKE-ATIVIDADE-AREAS-CONTRATO.md) · Relatório:
[`MAIKE-ATIVIDADE-AREAS-REPORT.md`](./MAIKE-ATIVIDADE-AREAS-REPORT.md) · Precedentes executados:
[`MAIKE-ABASTECIMENTO-FK-APONTAMENTO-RUNBOOK-RELEASE.md`](./MAIKE-ABASTECIMENTO-FK-APONTAMENTO-RUNBOOK-RELEASE.md)
(D-PROD-217, CONTRACT, FK composta) e
[`MAIKE-ATIVIDADE-CABECALHO-RUNBOOK-RELEASE.md`](./MAIKE-ATIVIDADE-CABECALHO-RUNBOOK-RELEASE.md)
(D-PROD-200, CONTRACT no formato CONVERSÃO). A anterior em produção é a D-PROD-223
(`20261117300000_descanso_e_alturas_por_area`, EXPAND, aplicada).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261118100000_atividade_areas` |
| Natureza | **CONTRACT** no formato **CONVERSÃO**, **sem `DROP`** (entrada fechada em `MIGRATIONS_CONTRACT_APROVADAS`): guarda pinada → a coluna nova em tabela antiga (`alter_antigas`) → o resto pela allowlist EXPAND (a tabela nova) → a cauda pinada (o backfill e a FK composta). É CONTRACT porque a allowlist EXPAND recusa DML (o backfill) e a FK de 4 colunas de tabela antiga para a tabela nova |
| O que muda | tabela nova **`AtividadeArea`** (as áreas da atividade: `cliente_id`, `empresa_id`, `atividade_id`, `area_id`, o setor em snapshot, `area_planejada`, `status` PLANEJADA \| EM_ANDAMENTO \| CONCLUIDA, `data_inicio`, `data_conclusao`, `ordem`, autor, `versao`), com 3 UNIQUE e 2 índices começando por `cliente_id`, 6 FKs RESTRICT (cliente, empresa, atividade por (cliente, empresa, atividade), área, setor, autor), 2 CHECKs (o ciclo com a coerência das datas; planejada ≥ 0, ordem ≥ 1, versão ≥ 1) e o RLS de sempre; coluna anulável **`AtividadeApontamento.atividade_area_id`** (VARCHAR(64), sem DEFAULT), o índice `AtividadeApontamento_atividade_area_idx` e a FK **`AtividadeApontamento_atividade_area_fkey`** (`cliente_id`, `empresa_id`, `atividade_id`, `atividade_area_id`) → `AtividadeArea`(`cliente_id`, `empresa_id`, `atividade_id`, `id`), `ON DELETE RESTRICT ON UPDATE CASCADE`: o banco prova que a área do lançamento é **da mesma atividade** |
| Dados (backfill) | cada atividade **com** `area_id` ganha a área nº 1 (`id` = `'ara_' \|\| id da atividade`; a área planejada, o setor e o autor dela). A área já tinha começado: `data_inicio` = o início da atividade, senão o dia do 1º lançamento, senão o dia da criação (nunca depois da conclusão). **CONCLUIDA** (com a `data_conclusao` da atividade) se a atividade está concluída; senão **EM_ANDAMENTO** — a **cancelada também** (ela é só leitura; não ganha uma data de conclusão inventada). Os lançamentos dessas atividades passam a ser dessa área. Atividade **sem** área: nada muda (lançamentos com área nula). Nenhuma linha é apagada; nenhuma coluna existente muda de valor |
| SHA-256 do arquivo (`MIGRATIONS_APROVADAS`) | `098f0d06d45922886f64cb4e2f4bd00644dac26b833e8020feeed2632d31ec06` |
| Guarda (`guarda_sha256`) | `0afbc9bb3eab69cdbe52452425b0829c74c68398d44fc81781e70b8c4800ab7e` |
| RLS (`DO_RLS_APROVADOS`) | `7121f5a6d09747d8c3479411ef0be47cc92eb9a11cf59865429134b18fdd6984` |
| Classificador | `modo: CONTRACT`, `violacoes: []`, `tabelas_novas ["AtividadeArea"]`, `contract[0]`: `decisao D-PROD-249`, `colunas_adicionadas ["AtividadeApontamento.atividade_area_id"]`, `conversoes ["INSERT INTO AtividadeArea", "UPDATE AtividadeApontamento", "ADD CONSTRAINT AtividadeApontamento.AtividadeApontamento_atividade_area_fkey"]`, o resto vazio |
| `_prisma_migrations` | antes **67** concluídas, 0 em aberto (a última, a D-PROD-223, `20261117300000_descanso_e_alturas_por_area`, checksum `c391e4b0c28dbefdafa8d0819d948efde952bf8ee5adc20ff58aa930239b477e`); depois **68** |
| Tabelas em `public` | **96** antes, **97** depois |
| Produção (fatos lidos, só leitura, antes desta PR) | 5 atividades (1 sem área) → **4** áreas criadas; 5 lançamentos |

**Ordem:** a migration **antes** do merge (D-PROD-72 item 1):

- código de hoje com a migration aplicada: segue igual (o código antigo não lê a tabela nova
  nem a coluna nova; o lançamento novo grava `atividade_area_id` nulo, o que a FK aceita —
  `MATCH SIMPLE`; só não aparece em nenhuma área até o código novo);
- código novo sem a migration: **quebra** (a lista, o detalhe e os totais leem
  `AtividadeArea`; o preflight de schema do deploy acusa `AtividadeArea.status` e
  `AtividadeApontamento.atividade_area_id` ausentes). Por isso: migration primeiro.

O Instant Rollback da Vercel continua possível depois da aplicação (o código anterior não
depende da tabela nova).

**Travas:** a guarda trava, na ordem do app (a área é lida, a atividade travada, o
lançamento gravado), `"AreaPastagem"` em `SHARE ROW EXCLUSIVE` (o modo que a FK nova pede
nela: o mapa continua **lendo**; só a gravação de área espera) e `"Atividade"` e
`"AtividadeApontamento"` em `ACCESS EXCLUSIVE`, já no modo mais forte que as instruções
pedem nelas, até o `COMMIT`. Sem subir de trava no meio: subir fecharia um ciclo com o
lançamento do app (trava a atividade `FOR UPDATE` e depois grava o apontamento) e o detector
de deadlock poderia derrubar a requisição do usuário; pegando a atividade em `ACCESS
EXCLUSIVE` primeiro, a transação do app que já segura a atividade só faz a migration
esperar. Até o `COMMIT`, leituras e escritas da atividade e dos lançamentos esperam (a
tela do Lançamento de Atividades). O backfill e a validação da FK leem as tabelas
inteiras (produção: 5 + 5 linhas; menos de 1 s). `lock_timeout` de 5 s: com uma transação
longa segurando uma delas, aborta **sem aplicar nada**. Fora de pico.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** `MIGRATION_DATABASE_URL` (direta ou
  sessão na 5432), `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360` e a
  conexão do runtime no MESMO banco:
  ```bash
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>                                         # ANÁLISE LOCAL OK (CONTRACT D-PROD-249)
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo --contract D-PROD-249  # ALVO VERIFICADO — 1 pendente(s) do manifesto
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar --contract D-PROD-249
  ```
- **B — conector Supabase, uma única `execute_sql` (§5):** desvio da D-PROD-74, só
  com o GO escrito do proprietário **para esta migration**, registrado no §9.

## 2. Pré-requisitos e GO

- validação **local** da PR verde: `verify:all` e o ensaio do §4.2 no `<SHA_APROVADO>`;
  esta é a **única** migration nova da release;
- o preflight (§4) inteiro `OK`. Fora disso: `RELEASE_BLOCKED` e decisão nova do proprietário.

| GO | O quê | Situação |
|---|---|---|
| GO-1 | preflight **só leitura** em produção (§4) | **dado** (2026-11-18, chat; texto literal no §9) |
| GO-2 | aplicar a CONTRACT D-PROD-249 (§5) e mergear em seguida | **dado** (2026-11-18, chat; a PR #327 já estava mergeada, então o caminho foi o B, com o desvio da D-PROD-74 aceito) |

## 3. Ordem

Validação local verde → preflight §4 → GO-2 → aplicação §5 → postcheck §6 → merge →
deploy READY → Lançamento de Atividades: a atividade antiga abre com a área dela "Em
andamento" (ou "Concluída") no card "Áreas da atividade", com os lançamentos de antes
nela; abrir uma atividade nova com 2 áreas, iniciar uma e lançar nela.

## 4. Preflight (somente leitura)

### 4.1 Uma consulta, com veredito

<!-- sql:preflight -->
```sql
-- MAIKE · D-PROD-249 · PREFLIGHT (somente leitura). Cole TUDO e rode. Qualquer PARAR = não aplicar.
WITH
esperado AS (SELECT '7692130048193495360'::text AS sid),
mig AS (
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS abertas,
         count(*) FILTER (WHERE migration_name = '20261118100000_atividade_areas' AND rolled_back_at IS NULL) AS esta,
         count(*) FILTER (WHERE migration_name = '20261117300000_descanso_e_alturas_por_area'
                            AND checksum = 'c391e4b0c28dbefdafa8d0819d948efde952bf8ee5adc20ff58aa930239b477e'
                            AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS anterior
    FROM public._prisma_migrations
),
tabela_nova AS (SELECT count(*) AS n FROM pg_class WHERE oid = to_regclass('public."AtividadeArea"')),
coluna_nova AS (
  SELECT count(*) AS n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'AtividadeApontamento' AND column_name = 'atividade_area_id'
),
alvo_fk AS (SELECT count(*) AS n FROM pg_class WHERE oid = to_regclass('public."Atividade_cliente_id_empresa_id_id_key"')),
atividades AS (
  SELECT count(*) AS total, count(area_id) AS com_area,
         count(*) FILTER (WHERE area_id IS NOT NULL AND status = 'CONCLUIDA') AS concluidas_com_area,
         count(*) FILTER (WHERE area_id IS NOT NULL AND status = 'CONCLUIDA' AND data_conclusao IS NULL) AS concluidas_sem_data
    FROM public."Atividade"
),
lancamentos AS (
  SELECT count(*) AS total, count(*) FILTER (WHERE a.area_id IS NOT NULL) AS ganham_area
    FROM public."AtividadeApontamento" p
    JOIN public."Atividade" a ON a.cliente_id = p.cliente_id AND a.empresa_id = p.empresa_id AND a.id = p.atividade_id
),
tabelas AS (SELECT count(*) AS n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')),
travas AS (
  SELECT count(*) AS n FROM pg_locks l
   WHERE l.locktype = 'relation' AND l.pid <> pg_backend_pid()
     AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
     AND l.relation IN (to_regclass('public."Atividade"'), to_regclass('public."AtividadeApontamento"'), to_regclass('public."AreaPastagem"'))
     AND l.mode <> 'AccessShareLock'
),
longas AS (
  SELECT count(*) AS n FROM pg_stat_activity
   WHERE datname = current_database() AND pid <> pg_backend_pid() AND xact_start IS NOT NULL AND now() - xact_start > interval '30 seconds'
),
base(ordem, item, valor, esperado, status) AS (
  SELECT 1, 'alvo: system_identifier', (SELECT system_identifier::text FROM pg_control_system()), (SELECT sid FROM esperado),
         CASE WHEN (SELECT system_identifier::text FROM pg_control_system()) = (SELECT sid FROM esperado) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 2, 'migrations concluídas / em aberto', (SELECT concluidas || ' / ' || abertas FROM mig), '67 / 0',
         CASE WHEN (SELECT concluidas = 67 AND abertas = 0 FROM mig) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 3, '20261118100000_atividade_areas já registrada', (SELECT esta::text FROM mig), '0',
         CASE WHEN (SELECT esta FROM mig) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 4, 'a anterior (D-PROD-223, descanso_e_alturas_por_area) concluída com o checksum do repositório', (SELECT anterior::text FROM mig), '1',
         CASE WHEN (SELECT anterior FROM mig) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 5, 'tabela AtividadeArea já presente (tem de ser 0)', (SELECT n::text FROM tabela_nova), '0',
         CASE WHEN (SELECT n FROM tabela_nova) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 6, 'coluna AtividadeApontamento.atividade_area_id já presente (tem de ser 0)', (SELECT n::text FROM coluna_nova), '0',
         CASE WHEN (SELECT n FROM coluna_nova) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 7, 'UNIQUE Atividade_cliente_id_empresa_id_id_key (alvo da FK da área) presente', (SELECT n::text FROM alvo_fk), '1',
         CASE WHEN (SELECT n FROM alvo_fk) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 8, 'atividades / com área (ganham a área nº 1) / concluídas com área / concluídas com área SEM data de conclusão',
         (SELECT total || ' / ' || com_area || ' / ' || concluidas_com_area || ' / ' || concluidas_sem_data FROM atividades), '<total> / <com área> / <concluídas> / 0',
         CASE WHEN (SELECT concluidas_sem_data FROM atividades) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 9, 'lançamentos / que ganham a área (os das atividades com área)', (SELECT total || ' / ' || ganham_area FROM lancamentos), '<total> / <ganham>',
         'OK'
  UNION ALL
  SELECT 10, 'tabelas em public', (SELECT n::text FROM tabelas), '96',
         CASE WHEN (SELECT n FROM tabelas) = 96 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 11, 'travas de escrita de outras sessões em "Atividade", "AtividadeApontamento" e "AreaPastagem", agora', (SELECT n::text FROM travas), '0',
         CASE WHEN (SELECT n FROM travas) = 0 THEN 'OK' ELSE 'ATENÇÃO (repita fora de pico)' END
  UNION ALL
  SELECT 12, 'transações abertas há mais de 30 s', (SELECT n::text FROM longas), '0',
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

Esperado na partida de produção: `7692130048193495360`; `67 / 0`; `0`; `1`; `0`; `0`; `1`;
`5 / 4 / <concluídas> / 0`; `5 / <ganham>`; `96`; `0`; `0`; `PRONTO PARA APLICAR`. E,
localmente, `sha256sum` do arquivo igual ao do §0. Depois da aplicação, este preflight diz
`PARAR` (68 / 0, a migration registrada, a tabela e a coluna presentes): é o esperado.

### 4.2 Ensaio local

Automatizado em `backend/tests/atividadeAreasMigration.test.mjs` (PostgreSQL local, bancos
próprios). Roda **este** preflight, **este** envelope e **este** postcheck (entre os
marcadores `sql:…`), trocando só o `system_identifier`: partida com as 67 anteriores (a
última, a D-PROD-223) e atividades de 2 clientes (ABERTA com área e lançamentos, CONCLUIDA
com área, CANCELADA com área, ABERTA sem área com lançamento, ABERTA com área sem
`data_inicio`); classificador e barreira do runner (sem `MIGRATION_CONTRACT_AUTORIZADO=D-PROD-249`
exato recusa antes do DDL); RED (tabela ou coluna já presentes, atividade concluída com área
sem data de conclusão: a guarda recusa e nada muda); concorrência (a transação do app que
trava a atividade e grava o lançamento não fecha deadlock: a migration espera); GREEN pelo
runner (68/0, 97 tabelas, o backfill exato, os lançamentos ligados à área nº 1, o banco
recusa com `23503` a área de **outra** atividade e com `23514` o status fora do ciclo,
`migrate diff` vazio, postcheck `APLICADA`; reaplicar é recusado pela guarda); caminho B
(o SID de produção, histórico fora de 67/0, a D-PROD-223 com outro checksum ou a tabela já
presente recusam antes do DDL; o envelope aplica 67 → 68; repetir recusa).

## 5. Aplicação — só com o GO-2

### Caminho A

Os comandos do §1 com `--contract D-PROD-249`.

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
              WHERE migration_name = '20261118100000_atividade_areas' AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)
    INTO n_ok, n_aberta FROM _prisma_migrations;
  IF n_ok <> 67 OR n_aberta <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % em aberto', n_ok, n_aberta;
  END IF;
  IF (SELECT count(*) FROM _prisma_migrations
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
         AND migration_name = '20261117300000_descanso_e_alturas_por_area'
         AND checksum = 'c391e4b0c28dbefdafa8d0819d948efde952bf8ee5adc20ff58aa930239b477e') <> 1 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (D-PROD-223) ausente ou com checksum divergente';
  END IF;
  -- A guarda da migration (logo abaixo) confere o formato inteiro, trava as 3 tabelas e confere o conteúdo; esta conferência só para antes, com a mensagem do runbook.
  IF to_regclass('public."AtividadeArea"') IS NOT NULL THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a tabela AtividadeArea já existe';
  END IF;
END $alvo$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '098f0d06d45922886f64cb4e2f4bd00644dac26b833e8020feeed2632d31ec06', now(),
        '20261118100000_atividade_areas', NULL, NULL, now(), 1);
COMMIT;
```
<!-- /sql:caminho-b -->

O `migration.sql` não tem `BEGIN`/`COMMIT`; a guarda `DO $$ … $$` vai como está. O
`checksum` do `INSERT` é o SHA-256 do arquivo. Qualquer falha desfaz tudo.

**Falha no caminho A** (`55P03`, `40P01`, `guarda: …`): nada fica; conferir pelo
preflight;
`DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate resolve --rolled-back 20261118100000_atividade_areas --schema backend/prisma/schema.prisma`;
eliminar a causa e confirmar com o proprietário. Com `guarda: as áreas da atividade não
estão no formato anterior` ou `guarda: há atividade concluída com área e sem data de
conclusão`: **não** tentar de novo (decisão nova: corrigir o dado é do proprietário, nunca
desta release).
**Falha no caminho B:** nada é aplicado; repetir o preflight e confirmar com o
proprietário.

## 6. Postcheck (antes do merge; só leitura)

<!-- sql:postcheck -->
```sql
-- MAIKE · D-PROD-249 · POSTCHECK (somente leitura). Cole TUDO e rode. Esperado: tudo OK e VEREDITO APLICADA.
WITH
esperado AS (SELECT '7692130048193495360'::text AS sid),
mig AS (
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS abertas,
         count(*) FILTER (WHERE migration_name = '20261118100000_atividade_areas'
                            AND checksum = '098f0d06d45922886f64cb4e2f4bd00644dac26b833e8020feeed2632d31ec06'
                            AND finished_at IS NOT NULL AND rolled_back_at IS NULL AND applied_steps_count = 1) AS esta
    FROM public._prisma_migrations
),
ar AS (SELECT to_regclass('public."AtividadeArea"')::oid AS oid),
tabela AS (SELECT count(*) AS n FROM pg_class c WHERE c.oid = (SELECT oid FROM ar) AND c.relrowsecurity AND NOT c.relforcerowsecurity),
fks_ar AS (SELECT count(*) AS n FROM pg_constraint k WHERE k.conrelid = (SELECT oid FROM ar) AND k.contype = 'f' AND k.convalidated AND k.confdeltype = 'r'),
checks_ar AS (SELECT count(*) AS n FROM pg_constraint k WHERE k.conrelid = (SELECT oid FROM ar) AND k.contype = 'c' AND k.convalidated),
coluna AS (
  SELECT count(*) AS n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'AtividadeApontamento' AND column_name = 'atividade_area_id'
     AND is_nullable = 'YES' AND data_type = 'character varying' AND character_maximum_length = 64 AND column_default IS NULL
),
-- A FK do lançamento para a área: 4 colunas nesta ordem, para AtividadeArea, RESTRICT, validada.
fk_nova AS (
  SELECT count(*) AS n FROM pg_constraint k
   WHERE k.conrelid = to_regclass('public."AtividadeApontamento"') AND k.conname = 'AtividadeApontamento_atividade_area_fkey' AND k.contype = 'f'
     AND k.convalidated AND k.confdeltype = 'r' AND k.confrelid = (SELECT oid FROM ar) AND array_length(k.conkey, 1) = 4
     AND pg_get_constraintdef(k.oid) LIKE 'FOREIGN KEY (cliente_id, empresa_id, atividade_id, atividade_area_id) REFERENCES "AtividadeArea"(cliente_id, empresa_id, atividade_id, id)%'
),
indice AS (
  SELECT count(*) AS n FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'AtividadeApontamento' AND indexname = 'AtividadeApontamento_atividade_area_idx'
     AND indexdef LIKE '%(cliente_id, empresa_id, atividade_id, atividade_area_id)'
),
-- Por SQL dinâmico, só quando a tabela e a coluna existem (senão NULL: a linha diz PARAR, nunca erro).
existe AS (SELECT (SELECT oid FROM ar) IS NOT NULL AND (SELECT n FROM coluna) = 1 AS ok),
backfill AS (
  SELECT CASE WHEN (SELECT ok FROM existe)
              THEN (xpath('/row/n/text()', query_to_xml('SELECT (SELECT count(*) FROM public."AtividadeArea") || '' / '' || (SELECT count(*) FROM public."Atividade" WHERE area_id IS NOT NULL) AS n', false, true, '')))[1]::text
         END AS n
),
por_status AS (
  SELECT CASE WHEN (SELECT ok FROM existe)
              THEN (xpath('/row/n/text()', query_to_xml('SELECT count(*) FILTER (WHERE status = ''EM_ANDAMENTO'') || '' / '' || count(*) FILTER (WHERE status = ''CONCLUIDA'') || '' / '' || count(*) FILTER (WHERE status = ''PLANEJADA'') || '' / '' || (SELECT count(*) FROM public."Atividade" WHERE area_id IS NOT NULL AND status = ''CONCLUIDA'') AS n FROM public."AtividadeArea"', false, true, '')))[1]::text
         END AS n
),
lancamentos AS (
  SELECT CASE WHEN (SELECT ok FROM existe)
              THEN (xpath('/row/n/text()', query_to_xml('SELECT count(p.atividade_area_id) || '' / '' || count(*) FILTER (WHERE a.area_id IS NOT NULL) || '' / '' || count(*) FILTER (WHERE a.area_id IS NULL AND p.atividade_area_id IS NOT NULL) AS n FROM public."AtividadeApontamento" p JOIN public."Atividade" a ON a.cliente_id = p.cliente_id AND a.empresa_id = p.empresa_id AND a.id = p.atividade_id', false, true, '')))[1]::text
         END AS n
),
coerencia AS (
  SELECT CASE WHEN (SELECT ok FROM existe)
              THEN (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public."AtividadeArea" r JOIN public."Atividade" a ON a.cliente_id = r.cliente_id AND a.empresa_id = r.empresa_id AND a.id = r.atividade_id WHERE r.area_id IS DISTINCT FROM a.area_id OR r.ordem <> 1 OR r.data_inicio IS NULL', false, true, '')))[1]::text::bigint
         END AS n
),
tabelas AS (SELECT count(*) AS n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')),
base(ordem, item, valor, esperado, status) AS (
  SELECT 1, 'alvo: system_identifier', (SELECT system_identifier::text FROM pg_control_system()), (SELECT sid FROM esperado),
         CASE WHEN (SELECT system_identifier::text FROM pg_control_system()) = (SELECT sid FROM esperado) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 2, '20261118100000_atividade_areas concluída (checksum pinado, applied_steps_count 1)', (SELECT esta::text FROM mig), '1',
         CASE WHEN (SELECT esta FROM mig) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 3, 'migrations concluídas / em aberto', (SELECT concluidas || ' / ' || abertas FROM mig), '68 / 0',
         CASE WHEN (SELECT concluidas = 68 AND abertas = 0 FROM mig) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 4, 'tabela AtividadeArea com RLS ligado (sem FORCE)', (SELECT n::text FROM tabela), '1',
         CASE WHEN (SELECT n FROM tabela) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 5, 'FKs / CHECKs em "AtividadeArea" (RESTRICT, validados)', (SELECT n::text FROM fks_ar) || ' / ' || (SELECT n::text FROM checks_ar), '6 / 2',
         CASE WHEN (SELECT n FROM fks_ar) = 6 AND (SELECT n FROM checks_ar) = 2 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 6, 'coluna AtividadeApontamento.atividade_area_id anulável, VARCHAR(64), sem DEFAULT', (SELECT n::text FROM coluna), '1',
         CASE WHEN (SELECT n FROM coluna) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 7, 'FK AtividadeApontamento_atividade_area_fkey com 4 colunas (com a atividade), RESTRICT, validada', (SELECT n::text FROM fk_nova), '1',
         CASE WHEN (SELECT n FROM fk_nova) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 8, 'índice AtividadeApontamento_atividade_area_idx', (SELECT n::text FROM indice), '1',
         CASE WHEN (SELECT n FROM indice) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 9, 'áreas criadas / atividades com área (iguais)', (SELECT coalesce(n, 'ausente') FROM backfill), '<n> / <n>',
         CASE WHEN split_part((SELECT n FROM backfill), ' / ', 1) = split_part((SELECT n FROM backfill), ' / ', 2) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 10, 'áreas EM_ANDAMENTO / CONCLUIDA / PLANEJADA / atividades concluídas com área', (SELECT coalesce(n, 'ausente') FROM por_status), '<a> / <c> / 0 / <c>',
         CASE WHEN split_part((SELECT n FROM por_status), ' / ', 3) = '0'
                   AND split_part((SELECT n FROM por_status), ' / ', 2) = split_part((SELECT n FROM por_status), ' / ', 4) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 11, 'lançamentos com área / das atividades com área (iguais) / com área em atividade SEM área (0)', (SELECT coalesce(n, 'ausente') FROM lancamentos), '<n> / <n> / 0',
         CASE WHEN split_part((SELECT n FROM lancamentos), ' / ', 1) = split_part((SELECT n FROM lancamentos), ' / ', 2)
                   AND split_part((SELECT n FROM lancamentos), ' / ', 3) = '0' THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 12, 'áreas fora do cabeçalho (área ≠ a da atividade, ordem ≠ 1 ou sem início)', (SELECT coalesce(n::text, 'ausente') FROM coerencia), '0',
         CASE WHEN (SELECT n FROM coerencia) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 13, 'tabelas em public', (SELECT n::text FROM tabelas), '97',
         CASE WHEN (SELECT n FROM tabelas) = 97 THEN 'OK' ELSE 'PARAR' END
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

Esperado em produção: `1`; `68 / 0`; `1`; `6 / 2`; `1`; `1`; `1`; `4 / 4`;
`<a> / <c> / 0 / <c>` (a + c = 4); `<n> / <n> / 0`; `0`; `97`; VEREDITO
`APLICADA E CONFERIDA`. `get_advisors`: a tabela nova com RLS e a política de sempre
(nenhum aviso novo esperado; as FKs da tabela nova são cobertas pelos UNIQUE/índices que
começam por `cliente_id`).

## 7. Reversão

- **Código:** Instant Rollback da Vercel (o código anterior não lê a tabela nova).
- **Banco:** uma migration **nova**, com decisão e GO próprios, nunca editando esta: a FK e a
  coluna do lançamento saem e a tabela `AtividadeArea` sai (a área nº 1 de cada atividade
  continua no `area_id` do cabeçalho; as áreas a mais e os lançamentos feitos nelas
  precisariam de decisão sobre para onde vão).

## 8. `RELEASE_BLOCKED`

Sem o GO-2; validação local não verde; `system_identifier` diferente; histórico diferente
de 67/0, a D-PROD-223 com outro checksum ou a D-PROD-249 já registrada; a tabela ou a coluna
já presentes; atividade concluída com área sem data de conclusão; qualquer `PARAR` no
preflight; outra migration nova na mesma release; SHA-256 diferente do pinado; ensaio local
sem passar.

## 9. Registro da execução

| Campo | Valor |
|---|---|
| Merge | A PR #327 (D-PROD-249) foi mergeada **antes** da aplicação. Com isso o caminho A deixou de valer: recusou com `CONTRACT_INESPERADO` (mesma situação da D-PROD-183). Sobrou o caminho B |
| GO-1 e GO-2 | Palavras literais do proprietário, dadas no chat em 2026-11-18 às 15:04 (America/Cuiaba): **"GO: autorizo aplicar a migration 20261118100000_atividade_areas (D-PROD-249) em produção pelo execute_sql do Supabase, seguindo o envelope do runbook, e aceito o desvio da D-PROD-74"** |
| Caminho | **B**: Supabase `execute_sql` com o envelope do §5 |
| `<SHA_APROVADO>` | `417e065e` (a `main` depois da PR #328; a #327 já está nela). O `migration.sql` tem SHA-256 `098f0d06d45922886f64cb4e2f4bd00644dac26b833e8020feeed2632d31ec06` |
| Ensaio local (§4.2) | verde: `backend/tests/atividadeAreasMigration.test.mjs` com a partida de 67 (a D-PROD-223 por último) → 68; preflight `PRONTO PARA APLICAR` → envelope → postcheck `APLICADA E CONFERIDA` com o SID local |
| Preflight (§4) | **`PRONTO PARA APLICAR`**: 67 concluídas / 0 em aberto; atividades 5 / 4 / 0 / 0; lançamentos 5 / 4; 96 tabelas em `public` |
| Aplicação | **2026-11-18 às 19:05:13 UTC** · **`SCHEMA_APPLIED_PROD: SIM`** |
| Postcheck (§6) | **`APLICADA E CONFERIDA`**: 68 concluídas / 0 em aberto; 97 tabelas; `AtividadeArea` com 4 linhas, todas `EM_ANDAMENTO`; 4 de 4 lançamentos ligados a uma área; FK composta de 4 colunas validada; índice presente; 0 alertas (lints) |
| Saúde | health ok na `417e065e` |
| Merge e deploy | O código da #327 já estava na `main` quando a migration foi aplicada (ordem real: merge, depois aplicação pelo caminho B). A entrega seguinte (lançamento pela área, D-PROD-251) **ainda não foi mergeada** e não traz migration nova |
