# MAIKE — Reforço do abastecimento ligado à atividade: runbook de release CONTRACT (D-PROD-217)

> **Estado: EXECUTADO. `SCHEMA_APPLIED_PROD: SIM` (2026-11-17 00:43:48 UTC, caminho B,
> com o GO explícito e escrito do proprietário para esta migration; registro no §9).**
>
> Cada passo para no primeiro desvio com **`RELEASE_BLOCKED`**. Valores entre `<…>`
> são preenchidos na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-217](./DECISIONS.md) (continua a D-PROD-211) · Relatório:
[`MAIKE-ABASTECIMENTO-FK-APONTAMENTO-REPORT.md`](./MAIKE-ABASTECIMENTO-FK-APONTAMENTO-REPORT.md) ·
Precedente executado:
[`MAIKE-ATIVIDADE-ABASTECIMENTO-RUNBOOK-RELEASE.md`](./MAIKE-ATIVIDADE-ABASTECIMENTO-RUNBOOK-RELEASE.md)
(D-PROD-211, o vínculo que este reforça). A anterior em produção é a D-PROD-216
([`MAIKE-AREA-CULTURA-RUNBOOK-RELEASE.md`](./MAIKE-AREA-CULTURA-RUNBOOK-RELEASE.md), CONTRACT aditiva,
aplicada), depois da D-PROD-215
([`MAIKE-CULTURAS-RUNBOOK-RELEASE.md`](./MAIKE-CULTURAS-RUNBOOK-RELEASE.md), EXPAND, aplicada).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261117100000_abastecimento_fk_apontamento_atividade` |
| Natureza | **CONTRACT** (entrada fechada em `MIGRATIONS_CONTRACT_APROVADAS`, formato de sempre, sem `DROP TABLE` e sem resto): um `UNIQUE` numa tabela antiga e uma FK recriada (mesmo nome) noutra. A guarda aborta a transação inteira se o vínculo não estiver no formato anterior ou se algum abastecimento apontar para um apontamento de outra atividade |
| O que muda | `AtividadeApontamento` ganha o índice único `AtividadeApontamento_empresa_atividade_id_key` (`cliente_id`, `empresa_id`, `atividade_id`, `id`; trivialmente único, o `id` já é; começa por `cliente_id`); a FK `AbastecimentoBem_apontamento_fkey` sai (3 colunas: `cliente_id`, `empresa_id`, `apontamento_id`) e volta com o **mesmo nome** e 4 colunas: (`cliente_id`, `empresa_id`, `atividade_id`, `apontamento_id`) → `AtividadeApontamento`(`cliente_id`, `empresa_id`, `atividade_id`, `id`), `ON DELETE RESTRICT ON UPDATE CASCADE` |
| Efeito | o banco passa a **recusar** (`23503`) um abastecimento cujo apontamento é de **outra** atividade. Com `MATCH SIMPLE` e o CHECK `AbastecimentoBem_atividade_check` (apontamento ⇒ atividade), toda linha com apontamento tem as 4 colunas preenchidas: a FK sempre confere. Abastecimento sem vínculo (as 4 colunas com `apontamento_id` nulo) segue livre, `ESTOQUE` ou `EXTERNO` |
| Dados | nenhum. A guarda só lê: nenhum abastecimento ligado a apontamento de outra atividade (produção: **1** abastecimento, sem vínculo) |
| O que não muda | nenhuma coluna, tabela, política ou CHECK; a FK `AbastecimentoBem_atividade_fkey` fica como está |
| SHA-256 do arquivo (`MIGRATIONS_APROVADAS`) | `1ee8d5a3c3dd64e59d27459bd51224795b69f691c7358088fd5bbec375561c0e` |
| Guarda (`guarda_sha256`) | `8982f86da78ebc1e09700c71ca5f2da2f34c9a8d5a6d45f948b9d88e779eef7c` |
| Classificador | `modo: CONTRACT`, `violacoes: []`, `contract[0]`: `decisao D-PROD-217`, `constraints_alargadas ["AbastecimentoBem.AbastecimentoBem_apontamento_fkey"]` (mesmo nome, recriada; o rótulo do runner é o de sempre, "1 CHECKs alargados"), o resto vazio; o `UNIQUE` é a 1ª das 3 instruções pinadas; não há resto |
| `_prisma_migrations` | antes **64** concluídas, 0 em aberto (a última, a D-PROD-216, `20261117000000_area_cultura`, checksum `e7fd7ee674a8cadff6c4b9fc9ee496e04d9157b19f231e97bff1abb758d8ff26`; antes dela a D-PROD-215, `20261116500000_cadculturas`, e a D-PROD-211, `20261116300000_abastecimento_atividade`, checksum `6dfc825cb908c28e903e66b25d16f2628db5da2cb50b9af73c6f1711b7faa436`); depois **65** |
| Tabelas em `public` | **95** antes e depois |

**Nome da pasta.** A migration nasceu como `20261116400000_abastecimento_fk_apontamento_atividade`.
A `20261116500000_cadculturas` (D-PROD-215, EXPAND) foi aplicada em produção antes dela e a
pasta passou a `20261116600000_…`; depois a `20261117000000_area_cultura` (D-PROD-216, CONTRACT
aditiva) também foi aplicada antes. Para a ordem dos nomes no repositório ser a ordem de
aplicação em produção, a pasta é **`20261117100000_abastecimento_fk_apontamento_atividade`**
(conteúdo idêntico, mesmo SHA-256): o nome com que ela foi registrada em `_prisma_migrations`.

**Ordem:** o código não muda nesta release (o servidor já deriva a atividade do
apontamento e grava as duas juntas, D-PROD-211). A migration pode ir antes ou depois do
merge; o padrão (D-PROD-72 item 1) é **antes**:

- código de hoje com a migration aplicada: segue igual (toda gravação do servidor já
  satisfaz a FK nova);
- código novo sem a migration: segue igual (só o `schema.prisma` muda; o Prisma Client
  não lê o nome nem as colunas da FK).

O Instant Rollback da Vercel continua possível depois da aplicação (o código anterior
grava o mesmo par atividade/apontamento).

**Travas:** a guarda trava `"AtividadeApontamento"` e depois `"AbastecimentoBem"` em
`ACCESS EXCLUSIVE`, as duas até o `COMMIT`: até lá, **leituras e escritas** nas duas
tabelas esperam (a lista e o detalhe do Lançamento de Atividades e a tela de
abastecimentos). `ACCESS EXCLUSIVE` também na referenciada, e já na guarda, porque o
`DROP CONSTRAINT` da FK antiga toma `ACCESS EXCLUSIVE` nas duas tabelas (remove os
gatilhos da FK na referenciada); pegar menos ali e subir só no `DROP`, com
`"AbastecimentoBem"` já travada, fecharia um ciclo com a confirmação do abastecimento
(lê o apontamento, depois grava o abastecimento) e o detector de deadlock poderia
derrubar a requisição do usuário. Na ordem do app (apontamento → abastecimento), uma
transação que já segura uma delas só faz a migration esperar. O índice único e a
validação da FK leem as tabelas inteiras (produção: poucas linhas; menos de 1 s).
`lock_timeout` de 5 s: com uma transação longa segurando uma delas, aborta **sem
aplicar nada** (no caminho A, a linha falha em `_prisma_migrations` pede
`migrate resolve --rolled-back` antes de repetir). Fora de pico.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** `MIGRATION_DATABASE_URL` (direta ou
  sessão na 5432), `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360` e a
  conexão do runtime no MESMO banco:
  ```bash
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>                                         # ANÁLISE LOCAL OK (CONTRACT D-PROD-217: 1 CHECKs alargados)
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo --contract D-PROD-217  # ALVO VERIFICADO — 1 pendente(s) do manifesto
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar --contract D-PROD-217
  ```
- **B — conector Supabase, uma única `execute_sql` (§5):** desvio da D-PROD-74, só
  com o GO escrito do proprietário **para esta migration**, registrado no §9.

## 2. Pré-requisitos e GO

- validação **local** da PR verde (o GitHub Actions está pausado): `verify:all` e o
  ensaio do §4.2 no `<SHA_APROVADO>`; esta é a **única** migration nova da release;
- o vínculo no formato anterior (preflight linhas 6 a 8) e nenhum abastecimento ligado
  a apontamento de outra atividade (linha 9). Fora disso: `RELEASE_BLOCKED` e decisão
  nova do proprietário.

| GO | O quê | Situação |
|---|---|---|
| GO-1 | preflight **só leitura** em produção (§4) | dado (2026-11-17) |
| GO-2 | aplicar a CONTRACT D-PROD-217 (§5) e mergear em seguida | dado (2026-11-17): aplicada pelo caminho B; o merge segue a revisão da PR #303 |

## 3. Ordem

Validação local verde → preflight §4 → GO-2 → aplicação §5 → postcheck §6 → merge →
deploy READY → Lançamento de Atividades: um abastecimento lançado dentro de um
lançamento continua gravando e aparecendo no bloco Abastecimentos.

## 4. Preflight (somente leitura)

### 4.1 Uma consulta, com veredito

<!-- sql:preflight -->
```sql
-- MAIKE · D-PROD-217 · PREFLIGHT (somente leitura). Cole TUDO e rode. Qualquer PARAR = não aplicar.
WITH
esperado AS (SELECT '7692130048193495360'::text AS sid),
mig AS (
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS abertas,
         count(*) FILTER (WHERE migration_name = '20261117100000_abastecimento_fk_apontamento_atividade' AND rolled_back_at IS NULL) AS esta,
         count(*) FILTER (WHERE migration_name = '20261117000000_area_cultura'
                            AND checksum = 'e7fd7ee674a8cadff6c4b9fc9ee496e04d9157b19f231e97bff1abb758d8ff26'
                            AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS anterior,
         count(*) FILTER (WHERE migration_name = '20261116300000_abastecimento_atividade'
                            AND checksum = '6dfc825cb908c28e903e66b25d16f2628db5da2cb50b9af73c6f1711b7faa436'
                            AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS abastecimento
    FROM public._prisma_migrations
),
ab AS (SELECT to_regclass('public."AbastecimentoBem"')::oid AS oid),
fk_antiga AS (
  SELECT count(*) AS n FROM pg_constraint k
   WHERE k.conrelid = (SELECT oid FROM ab) AND k.conname = 'AbastecimentoBem_apontamento_fkey' AND k.contype = 'f'
     AND k.confrelid = to_regclass('public."AtividadeApontamento"') AND array_length(k.conkey, 1) = 3
),
unico AS (SELECT count(*) AS n FROM pg_class WHERE oid = to_regclass('public."AtividadeApontamento_empresa_atividade_id_key"')),
check_atividade AS (
  SELECT count(*) AS n FROM pg_constraint k
   WHERE k.conrelid = (SELECT oid FROM ab) AND k.conname = 'AbastecimentoBem_atividade_check' AND k.contype = 'c'
),
-- Por SQL dinâmico, só quando as colunas existem (senão NULL: a linha diz PARAR, nunca erro).
existe AS (
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'AbastecimentoBem' AND column_name = 'apontamento_id')
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'AbastecimentoBem' AND column_name = 'atividade_id')
     AND to_regclass('public."AtividadeApontamento"') IS NOT NULL AS ok
),
linhas AS (
  SELECT CASE WHEN (SELECT ok FROM existe)
              THEN (xpath('/row/n/text()', query_to_xml('SELECT count(*) || '' / '' || count(a.apontamento_id) || '' / '' || count(*) FILTER (WHERE a.apontamento_id IS NOT NULL AND p.atividade_id IS DISTINCT FROM a.atividade_id) AS n FROM public."AbastecimentoBem" a LEFT JOIN public."AtividadeApontamento" p ON p.cliente_id = a.cliente_id AND p.empresa_id = a.empresa_id AND p.id = a.apontamento_id', false, true, '')))[1]::text
         END AS n
),
tabelas AS (SELECT count(*) AS n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')),
travas AS (
  SELECT count(*) AS n FROM pg_locks l
   WHERE l.locktype = 'relation' AND l.pid <> pg_backend_pid()
     AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
     AND l.relation IN (to_regclass('public."AbastecimentoBem"'), to_regclass('public."AtividadeApontamento"'))
),
longas AS (
  SELECT count(*) AS n FROM pg_stat_activity
   WHERE datname = current_database() AND pid <> pg_backend_pid() AND xact_start IS NOT NULL AND now() - xact_start > interval '30 seconds'
),
base(ordem, item, valor, esperado, status) AS (
  SELECT 1, 'alvo: system_identifier', (SELECT system_identifier::text FROM pg_control_system()), (SELECT sid FROM esperado),
         CASE WHEN (SELECT system_identifier::text FROM pg_control_system()) = (SELECT sid FROM esperado) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 2, 'migrations concluídas / em aberto', (SELECT concluidas || ' / ' || abertas FROM mig), '64 / 0',
         CASE WHEN (SELECT concluidas = 64 AND abertas = 0 FROM mig) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 3, '20261117100000_abastecimento_fk_apontamento_atividade já registrada', (SELECT esta::text FROM mig), '0',
         CASE WHEN (SELECT esta FROM mig) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 4, 'a anterior (D-PROD-216, area_cultura) concluída com o checksum do repositório', (SELECT anterior::text FROM mig), '1',
         CASE WHEN (SELECT anterior FROM mig) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 5, 'a D-PROD-211 (abastecimento ligado à atividade) concluída com o checksum do repositório', (SELECT abastecimento::text FROM mig), '1',
         CASE WHEN (SELECT abastecimento FROM mig) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 6, 'FK AbastecimentoBem_apontamento_fkey ainda a de 3 colunas', (SELECT n::text FROM fk_antiga), '1',
         CASE WHEN (SELECT n FROM fk_antiga) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 7, 'UNIQUE AtividadeApontamento_empresa_atividade_id_key já presente (tem de ser 0)', (SELECT n::text FROM unico), '0',
         CASE WHEN (SELECT n FROM unico) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 8, 'CHECK AbastecimentoBem_atividade_check (apontamento ⇒ atividade) presente', (SELECT n::text FROM check_atividade), '1',
         CASE WHEN (SELECT n FROM check_atividade) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 9, 'abastecimentos / ligados a apontamento / ligados a apontamento de OUTRA atividade', (SELECT coalesce(n, 'ausente') FROM linhas), '<total> / <ligados> / 0',
         CASE WHEN (SELECT n FROM linhas) LIKE '% / % / 0' THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 10, 'tabelas em public', (SELECT n::text FROM tabelas), '95',
         CASE WHEN (SELECT n FROM tabelas) = 95 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 11, 'travas de outras sessões em "AbastecimentoBem" e "AtividadeApontamento", agora', (SELECT n::text FROM travas), '0',
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

Esperado na partida: `7692130048193495360`; `64 / 0`; `0`; `1`; `1`; `1`; `0`; `1`;
`1 / 0 / 0` (a linha de produção, sem vínculo); `95`; `0`; `0`;
`PRONTO PARA APLICAR`. E, localmente, `sha256sum` do arquivo igual ao do §0. Foi o que
produção mostrou em 2026-11-17 (§9). Depois da aplicação, este preflight diz `PARAR`
(65 / 0 e a migration registrada): é o esperado.

### 4.2 Ensaio local

Automatizado em `backend/tests/abastecimentoFkApontamentoMigration.test.mjs`
(PostgreSQL local, bancos próprios). Roda **este** preflight, **este** envelope e
**este** postcheck (entre os marcadores `sql:…`), trocando só o `system_identifier`:
partida com as 64 anteriores (a última, a Área ligada à Cultura da D-PROD-216, depois da
CADCULTURAS da D-PROD-215 e da D-PROD-211, na ordem de produção) e abastecimentos de 2 clientes (um ligado ao apontamento
da própria atividade, um sem vínculo `ESTOQUE`, um `EXTERNO` sem vínculo); classificador
e barreira do runner (sem `MIGRATION_CONTRACT_AUTORIZADO=D-PROD-217` exato recusa antes
do DDL); RED (um abastecimento ligado a apontamento de outra atividade, ou a FK já com 4
colunas, ou o UNIQUE já presente: a guarda recusa e nada muda); GREEN pelo runner (65/0,
95 tabelas, só a FK e o índice mudam, o banco recusa o apontamento de outra atividade
com `23503` e aceita o vínculo certo e os sem vínculo, `migrate diff` vazio, postcheck
`APLICADA`; reaplicar é recusado pela guarda); caminho B (o SID de produção, histórico
fora de 64/0, a D-PROD-216 ou a D-PROD-211 com outro checksum ou o UNIQUE já presente
recusam antes do DDL; o envelope aplica 64 → 65; repetir recusa).

## 5. Aplicação — só com o GO-2

### Caminho A

Os comandos do §1 com `--contract D-PROD-217`.

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
              WHERE migration_name = '20261117100000_abastecimento_fk_apontamento_atividade' AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)
    INTO n_ok, n_aberta FROM _prisma_migrations;
  IF n_ok <> 64 OR n_aberta <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % em aberto', n_ok, n_aberta;
  END IF;
  IF (SELECT count(*) FROM _prisma_migrations
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
         AND migration_name = '20261117000000_area_cultura'
         AND checksum = 'e7fd7ee674a8cadff6c4b9fc9ee496e04d9157b19f231e97bff1abb758d8ff26') <> 1 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (D-PROD-216) ausente ou com checksum divergente';
  END IF;
  IF (SELECT count(*) FROM _prisma_migrations
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
         AND migration_name = '20261116300000_abastecimento_atividade'
         AND checksum = '6dfc825cb908c28e903e66b25d16f2628db5da2cb50b9af73c6f1711b7faa436') <> 1 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a D-PROD-211 ausente ou com checksum divergente';
  END IF;
  -- A guarda da migration (logo abaixo) confere o formato inteiro, trava as 2 tabelas e confere o conteúdo; esta conferência só para antes, com a mensagem do runbook.
  IF to_regclass('public."AtividadeApontamento_empresa_atividade_id_key"') IS NOT NULL THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: o UNIQUE novo já existe em AtividadeApontamento';
  END IF;
END $alvo$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '1ee8d5a3c3dd64e59d27459bd51224795b69f691c7358088fd5bbec375561c0e', now(),
        '20261117100000_abastecimento_fk_apontamento_atividade', NULL, NULL, now(), 1);
COMMIT;
```
<!-- /sql:caminho-b -->

O `migration.sql` não tem `BEGIN`/`COMMIT`; a guarda `DO $$ … $$` vai como está. O
`checksum` do `INSERT` é o SHA-256 do arquivo. Qualquer falha desfaz tudo.

**Falha no caminho A** (`55P03`, `40P01`, `guarda: …`): nada fica; conferir pelo
preflight;
`DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate resolve --rolled-back 20261117100000_abastecimento_fk_apontamento_atividade --schema backend/prisma/schema.prisma`;
eliminar a causa e confirmar com o proprietário. Com `guarda: o vínculo do abastecimento
com o apontamento não está no formato anterior` ou `guarda: há abastecimento ligado a
um apontamento de outra atividade`: **não** tentar de novo (decisão nova: corrigir o
dado é do proprietário, nunca desta release).
**Falha no caminho B:** nada é aplicado; repetir o preflight e confirmar com o
proprietário.

## 6. Postcheck (antes do merge; só leitura)

<!-- sql:postcheck -->
```sql
-- MAIKE · D-PROD-217 · POSTCHECK (somente leitura). Cole TUDO e rode. Esperado: tudo OK e VEREDITO APLICADA.
WITH
esperado AS (SELECT '7692130048193495360'::text AS sid),
mig AS (
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS abertas,
         count(*) FILTER (WHERE migration_name = '20261117100000_abastecimento_fk_apontamento_atividade'
                            AND checksum = '1ee8d5a3c3dd64e59d27459bd51224795b69f691c7358088fd5bbec375561c0e'
                            AND finished_at IS NOT NULL AND rolled_back_at IS NULL AND applied_steps_count = 1) AS esta
    FROM public._prisma_migrations
),
ab AS (SELECT to_regclass('public."AbastecimentoBem"')::oid AS oid),
-- A FK do apontamento: o mesmo nome, 4 colunas nesta ordem, para AtividadeApontamento, RESTRICT, validada.
fk_nova AS (
  SELECT count(*) AS n FROM pg_constraint k
   WHERE k.conrelid = (SELECT oid FROM ab) AND k.conname = 'AbastecimentoBem_apontamento_fkey' AND k.contype = 'f'
     AND k.convalidated AND k.confdeltype = 'r' AND k.confrelid = to_regclass('public."AtividadeApontamento"')
     AND array_length(k.conkey, 1) = 4
     AND pg_get_constraintdef(k.oid) LIKE 'FOREIGN KEY (cliente_id, empresa_id, atividade_id, apontamento_id) REFERENCES "AtividadeApontamento"(cliente_id, empresa_id, atividade_id, id)%'
),
-- A FK da atividade fica como estava (3 colunas, para Atividade).
fk_atividade AS (
  SELECT count(*) AS n FROM pg_constraint k
   WHERE k.conrelid = (SELECT oid FROM ab) AND k.conname = 'AbastecimentoBem_atividade_fkey' AND k.contype = 'f'
     AND k.convalidated AND k.confdeltype = 'r' AND k.confrelid = to_regclass('public."Atividade"') AND array_length(k.conkey, 1) = 3
),
fks_ab AS (SELECT count(*) AS n FROM pg_constraint k WHERE k.conrelid = (SELECT oid FROM ab) AND k.contype = 'f'),
checks_ab AS (SELECT count(*) AS n FROM pg_constraint k WHERE k.conrelid = (SELECT oid FROM ab) AND k.contype = 'c'),
unico AS (
  SELECT count(*) AS n FROM pg_indexes
   WHERE schemaname = 'public' AND tablename = 'AtividadeApontamento' AND indexname = 'AtividadeApontamento_empresa_atividade_id_key'
     AND indexdef LIKE 'CREATE UNIQUE INDEX%(cliente_id, empresa_id, atividade_id, id)'
),
-- Por SQL dinâmico, só quando as colunas existem (senão NULL: a linha diz PARAR, nunca erro).
existe AS (
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'AbastecimentoBem' AND column_name = 'apontamento_id') AS ok
),
outra_atividade AS (
  SELECT CASE WHEN (SELECT ok FROM existe)
              THEN (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public."AbastecimentoBem" a LEFT JOIN public."AtividadeApontamento" p ON p.cliente_id = a.cliente_id AND p.empresa_id = a.empresa_id AND p.id = a.apontamento_id WHERE a.apontamento_id IS NOT NULL AND p.atividade_id IS DISTINCT FROM a.atividade_id', false, true, '')))[1]::text::bigint
         END AS n
),
tabelas AS (SELECT count(*) AS n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')),
base(ordem, item, valor, esperado, status) AS (
  SELECT 1, 'alvo: system_identifier', (SELECT system_identifier::text FROM pg_control_system()), (SELECT sid FROM esperado),
         CASE WHEN (SELECT system_identifier::text FROM pg_control_system()) = (SELECT sid FROM esperado) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 2, '20261117100000_abastecimento_fk_apontamento_atividade concluída (checksum pinado, applied_steps_count 1)', (SELECT esta::text FROM mig), '1',
         CASE WHEN (SELECT esta FROM mig) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 3, 'migrations concluídas / em aberto', (SELECT concluidas || ' / ' || abertas FROM mig), '65 / 0',
         CASE WHEN (SELECT concluidas = 65 AND abertas = 0 FROM mig) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 4, 'FK AbastecimentoBem_apontamento_fkey com 4 colunas (com a atividade), RESTRICT, validada', (SELECT n::text FROM fk_nova), '1',
         CASE WHEN (SELECT n FROM fk_nova) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 5, 'FK AbastecimentoBem_atividade_fkey intacta (3 colunas, RESTRICT)', (SELECT n::text FROM fk_atividade), '1',
         CASE WHEN (SELECT n FROM fk_atividade) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 6, 'FKs / CHECKs em "AbastecimentoBem" (nenhuma a mais nem a menos)', (SELECT n::text FROM fks_ab) || ' / ' || (SELECT n::text FROM checks_ab), '14 / 10',
         CASE WHEN (SELECT n FROM fks_ab) = 14 AND (SELECT n FROM checks_ab) = 10 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 7, 'UNIQUE AtividadeApontamento_empresa_atividade_id_key (cliente_id, empresa_id, atividade_id, id)', (SELECT n::text FROM unico), '1',
         CASE WHEN (SELECT n FROM unico) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 8, 'abastecimentos ligados a apontamento de OUTRA atividade', (SELECT coalesce(n::text, 'ausente') FROM outra_atividade), '0',
         CASE WHEN (SELECT n FROM outra_atividade) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 9, 'tabelas em public', (SELECT n::text FROM tabelas), '95',
         CASE WHEN (SELECT n FROM tabelas) = 95 THEN 'OK' ELSE 'PARAR' END
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

Esperado: `1`; `65 / 0`; `1`; `1`; `14 / 10`; `1`; `0`; `95`; VEREDITO
`APLICADA E CONFERIDA`. `get_advisors`: nada novo (o índice
`AbastecimentoBem_apontamento_idx` continua cobrindo a FK pelo prefixo
`cliente_id, empresa_id`).

## 7. Reversão

- **Código:** nada a reverter (o código não muda nesta release).
- **Banco:** uma migration **nova**, com decisão e GO próprios, nunca editando esta:
  a FK do apontamento volta a 3 colunas e o UNIQUE sai. Exata sempre (nenhum dado muda).

## 8. `RELEASE_BLOCKED`

Sem o GO-2; validação local não verde; `system_identifier` diferente; histórico
diferente de 64/0, a D-PROD-216 ou a D-PROD-211 com outro checksum ou a D-PROD-217 já
registrada; o
vínculo fora do formato anterior; algum abastecimento ligado a apontamento de outra
atividade; qualquer `PARAR` no preflight; outra migration nova na mesma release;
SHA-256 diferente do pinado; ensaio local sem passar.

## 9. Registro da execução

| Campo | Valor |
|---|---|
| GO-1 e GO-2 | dados pelo proprietário, por escrito, para **esta** migration (2026-11-17) |
| Caminho | **B** (conector, uma `execute_sql`; o envelope do §5 com o `migration.sql` integral) |
| `<SHA_APROVADO>` | o `migration.sql` com SHA-256 `1ee8d5a3c3dd64e59d27459bd51224795b69f691c7358088fd5bbec375561c0e` (o mesmo desde a abertura da PR #303) |
| Ensaio local (§4.2) | verde: `backend/tests/abastecimentoFkApontamentoMigration.test.mjs` com a partida de 64 (a Área ligada à Cultura por último) → 65 |
| Tentativas anteriores | duas, paradas no preflight com `PARAR` na linha 2 (a produção com `63` concluídas quando o runbook esperava `62`, e depois com `64` quando esperava `63`), porque outra sessão aplicou antes a `20261116500000_cadculturas` (D-PROD-215) e depois a `20261117000000_area_cultura` (D-PROD-216). **Nada foi aplicado** nessas duas; o preflight e o envelope passaram à partida real (64/0, a anterior = a D-PROD-216) |
| Preflight (§4) | **PRONTO PARA APLICAR**: `64 / 0`; a migration ainda não registrada (`0`); a anterior `20261117000000_area_cultura` com o checksum `e7fd7ee6…` (`1`); a D-PROD-211 com o checksum `6dfc825c…` (`1`); a FK de 3 colunas (`1`); o UNIQUE ausente (`0`); o CHECK da atividade presente (`1`); `1 / 0 / 0`; 95 tabelas; 0 travas; 0 transações longas |
| Envelope (§5) | guardas: `n_ok <> 64`, a anterior = `20261117000000_area_cultura` (`e7fd7ee6…`), a D-PROD-211 (`6dfc825c…`), o UNIQUE ausente; `INSERT` com o nome `20261117100000_abastecimento_fk_apontamento_atividade` e o checksum `1ee8d5a3…` |
| Aplicação | **2026-11-17 00:43:48 UTC**, caminho B, numa transação; `SCHEMA_APPLIED_PROD: SIM` |
| Postcheck (§6) | **APLICADA E CONFERIDA**: `65 / 0`; a última registrada é esta, checksum `1ee8d5a3…`; FK = `FOREIGN KEY (cliente_id, empresa_id, atividade_id, apontamento_id) REFERENCES "AtividadeApontamento"(cliente_id, empresa_id, atividade_id, id) ON UPDATE CASCADE ON DELETE RESTRICT`; UNIQUE `AtividadeApontamento_empresa_atividade_id_key` em (`cliente_id`, `empresa_id`, `atividade_id`, `id`); `AbastecimentoBem_atividade_fkey` e `AbastecimentoBem_atividade_check` presentes; 95 tabelas; dados intactos (`AbastecimentoBem` 1 linha, `AtividadeApontamento` 4) |
| Ordem em produção | … `20261116300000_abastecimento_atividade` (D-PROD-211) → `20261116500000_cadculturas` (D-PROD-215) → `20261117000000_area_cultura` (D-PROD-216) → **`20261117100000_abastecimento_fk_apontamento_atividade` (D-PROD-217)**: a mesma ordem dos nomes no repositório |
| Merge e deploy | depois da revisão da PR #303 (o código não muda nesta release; o `schema.prisma` já é o de produção) |
