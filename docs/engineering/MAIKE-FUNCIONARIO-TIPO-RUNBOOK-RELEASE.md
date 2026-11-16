# MAIKE — Tipo do funcionário Mensalista, Diarista ou Terceirizado: runbook de release CONTRACT (D-PROD-209)

> **Estado: PLANO. `SCHEMA_APPLIED_PROD: NÃO`.** Aplicação só com o GO explícito e
> escrito do proprietário para **esta** migration.
>
> Cada passo para no primeiro desvio com **`RELEASE_BLOCKED`**. Valores entre `<…>`
> são preenchidos na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-209](./DECISIONS.md) · Relatório:
[`MAIKE-FUNCIONARIO-TIPO-REPORT.md`](./MAIKE-FUNCIONARIO-TIPO-REPORT.md). Precedente
executado: [`MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO-RUNBOOK-RELEASE.md`](./MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO-RUNBOOK-RELEASE.md)
(D-PROD-208, que criou o CHECK que esta troca).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261116100000_funcionario_tipo_terceirizado` |
| Natureza | **CONTRACT** (entrada fechada em `MIGRATIONS_CONTRACT_APROVADAS`, formato de sempre, sem `DROP TABLE`): `DROP CONSTRAINT` + `ADD CONSTRAINT` do mesmo CHECK numa tabela antiga. A guarda aborta a transação inteira se **algum** parceiro tiver `funcionario_tipo = 'TAREFEIRO'` |
| O que muda | o CHECK `Fornecedor_funcionario_check` volta igual, com `TERCEIRIZADO` no lugar de `TAREFEIRO` (tipo `MENSALISTA`/`DIARISTA`/`TERCEIRIZADO`, custos ≥ 0) |
| O que não muda | nenhuma linha, coluna, índice, tabela, FK ou política |
| SHA-256 do arquivo (`MIGRATIONS_APROVADAS`) | `44dd42d800de7b5db034af1c42e0b0425f18666b5e73d260ed599d95d73adab6` |
| Guarda (`guarda_sha256`) | `93612d85d6cc9ec3c39b9586619deedb8db72e5198d1ab64fa3ee9d8e911cca9` |
| Classificador | `modo: CONTRACT`, `violacoes: []`, `contract[0]`: `decisao D-PROD-209`, `constraints_alargadas ["Fornecedor.Fornecedor_funcionario_check"]` (mesmo nome, recriado; o runner rotula "1 CHECKs alargados"), o resto vazio |
| `_prisma_migrations` | antes **59** concluídas, 0 em aberto (a última, a D-PROD-208, `20261116000000_mao_obra_parceiro`, checksum `65a8a4eb8abc7b44e24d3121605a375fee34ea88968bffe875c53b30e9cf9dd0`); depois **60** |
| Tabelas em `public` | **94** antes e depois |

**Ordem: aplicar ANTES do merge (D-PROD-72 item 1).** Nenhum parceiro tem
`funcionario_tipo` preenchido em produção (conferido pelo preflight): a janela não
põe dado em jogo.

- código de hoje com a migration aplicada: escolher **Tarefeiro** na tela Parceiros é
  recusado pelo banco (CHECK); os outros dois tipos seguem;
- código novo sem a migration: escolher **Terceirizado** é recusado pelo banco.

O Instant Rollback da Vercel continua possível depois da aplicação (o código anterior
só não consegue gravar Tarefeiro).

**Travas:** `ACCESS EXCLUSIVE` em `"Fornecedor"` (pela guarda, antes de conferir as
linhas, e pelo `ADD CONSTRAINT`, que valida a tabela) até o `COMMIT`: a tela Parceiros
e as opções de mão de obra esperam menos de 1 s. `lock_timeout` de 5 s: com uma
transação longa segurando `"Fornecedor"`, aborta **sem aplicar nada**. Fora de pico.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** `MIGRATION_DATABASE_URL` (direta ou
  sessão na 5432), `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360` e a
  conexão do runtime no MESMO banco:
  ```bash
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>                                         # ANÁLISE LOCAL OK (CONTRACT D-PROD-209: 1 CHECKs alargados)
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo --contract D-PROD-209  # ALVO VERIFICADO — 1 pendente(s) do manifesto
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar --contract D-PROD-209
  ```
- **B — conector Supabase, uma única `execute_sql` (§5):** desvio da D-PROD-74, só
  com o GO escrito do proprietário **para esta migration**, registrado no §9.

## 2. Pré-requisitos e GO

- validação **local** da PR verde (o GitHub Actions está pausado): `verify:all` e o
  ensaio do §4.2 no `<SHA_APROVADO>`; esta é a **única** migration nova da release;
- nenhum parceiro com `funcionario_tipo = 'TAREFEIRO'` (preflight linha 5). Com
  algum: `RELEASE_BLOCKED` e decisão nova do proprietário (o que fazer com ele).

| GO | O quê | Situação |
|---|---|---|
| GO-1 | preflight **só leitura** em produção (§4) | `<pendente>` |
| GO-2 | aplicar a CONTRACT D-PROD-209 (§5) e mergear em seguida | `<pendente>` |

## 3. Ordem

Validação local verde → preflight §4 → GO-2 → aplicação §5 → postcheck §6 → merge →
deploy READY → Parceiros: o tipo do funcionário oferece Mensalista, Diarista e
Terceirizado.

## 4. Preflight (somente leitura)

### 4.1 Uma consulta, com veredito

<!-- sql:preflight -->
```sql
-- MAIKE · D-PROD-209 · PREFLIGHT (somente leitura). Cole TUDO e rode. Qualquer PARAR = não aplicar.
WITH
esperado AS (SELECT '7692130048193495360'::text AS sid),
mig AS (
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS abertas,
         count(*) FILTER (WHERE migration_name = '20261116100000_funcionario_tipo_terceirizado' AND rolled_back_at IS NULL) AS esta,
         count(*) FILTER (WHERE migration_name = '20261116000000_mao_obra_parceiro'
                            AND checksum = '65a8a4eb8abc7b44e24d3121605a375fee34ea88968bffe875c53b30e9cf9dd0'
                            AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS anterior
    FROM public._prisma_migrations
),
fo AS (SELECT to_regclass('public."Fornecedor"')::oid AS oid),
-- Por SQL dinâmico, só quando a coluna existe (senão NULL: a linha diz PARAR, nunca erro).
tarefeiros AS (
  SELECT CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Fornecedor' AND column_name = 'funcionario_tipo')
              THEN (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public."Fornecedor" WHERE funcionario_tipo = ''TAREFEIRO''', false, true, '')))[1]::text::bigint
         END AS n
),
check_antigo AS (
  SELECT count(*) AS n FROM pg_constraint k
   WHERE k.conrelid = (SELECT oid FROM fo) AND k.conname = 'Fornecedor_funcionario_check' AND k.contype = 'c'
     AND pg_get_constraintdef(k.oid) LIKE '%''TAREFEIRO''%' AND pg_get_constraintdef(k.oid) NOT LIKE '%''TERCEIRIZADO''%'
),
tabelas AS (SELECT count(*) AS n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')),
travas AS (
  SELECT count(*) AS n FROM pg_locks l
   WHERE l.locktype = 'relation' AND l.pid <> pg_backend_pid()
     AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
     AND l.relation = (SELECT oid FROM fo)
),
longas AS (
  SELECT count(*) AS n FROM pg_stat_activity
   WHERE datname = current_database() AND pid <> pg_backend_pid() AND xact_start IS NOT NULL AND now() - xact_start > interval '30 seconds'
),
base(ordem, item, valor, esperado, status) AS (
  SELECT 1, 'alvo: system_identifier', (SELECT system_identifier::text FROM pg_control_system()), (SELECT sid FROM esperado),
         CASE WHEN (SELECT system_identifier::text FROM pg_control_system()) = (SELECT sid FROM esperado) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 2, 'migrations concluídas / em aberto', (SELECT concluidas || ' / ' || abertas FROM mig), '59 / 0',
         CASE WHEN (SELECT concluidas = 59 AND abertas = 0 FROM mig) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 3, '20261116100000_funcionario_tipo_terceirizado já registrada', (SELECT esta::text FROM mig), '0',
         CASE WHEN (SELECT esta FROM mig) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 4, 'a anterior (D-PROD-208) concluída com o checksum do repositório', (SELECT anterior::text FROM mig), '1',
         CASE WHEN (SELECT anterior FROM mig) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 5, 'parceiros com funcionario_tipo = TAREFEIRO (tem de ser 0)', (SELECT coalesce(n::text, 'ausente') FROM tarefeiros), '0',
         CASE WHEN (SELECT n FROM tarefeiros) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 6, 'CHECK Fornecedor_funcionario_check no formato anterior (com TAREFEIRO)', (SELECT n::text FROM check_antigo), '1',
         CASE WHEN (SELECT n FROM check_antigo) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 7, 'tabelas em public', (SELECT n::text FROM tabelas), '94',
         CASE WHEN (SELECT n FROM tabelas) = 94 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 8, 'travas de outras sessões em "Fornecedor", agora', (SELECT n::text FROM travas), '0',
         CASE WHEN (SELECT n FROM travas) = 0 THEN 'OK' ELSE 'ATENÇÃO (repita fora de pico)' END
  UNION ALL
  SELECT 9, 'transações abertas há mais de 30 s', (SELECT n::text FROM longas), '0',
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

Esperado hoje: `7692130048193495360`; `59 / 0`; `0`; `1`; `0`; `1`; `94`; `0`; `0`;
`PRONTO PARA APLICAR`. E, localmente, `sha256sum` do arquivo igual ao do §0.

### 4.2 Ensaio local

Automatizado em `backend/tests/funcionarioTipoTerceirizadoMigration.test.mjs`
(PostgreSQL local, bancos próprios). Roda **este** preflight, **este** envelope e
**este** postcheck (entre os marcadores `sql:…`), trocando só o `system_identifier`:
partida com as 59 anteriores; classificador e barreira do runner (sem
`MIGRATION_CONTRACT_AUTORIZADO=D-PROD-209` exato recusa antes do DDL); RED com um
parceiro TAREFEIRO (a guarda recusa e nada muda); GREEN pelo runner (60/0, 94
tabelas, o CHECK novo aceita TERCEIRIZADO e recusa TAREFEIRO, `migrate diff` vazio,
postcheck `APLICADA`; reaplicar é recusado pela guarda); caminho B (o SID de produção,
histórico fora de 59/0, a D-PROD-208 com outro checksum ou um TAREFEIRO recusam antes
do DDL; o envelope aplica 59 → 60; repetir recusa).

## 5. Aplicação — só com o GO-2

### Caminho A

Os comandos do §1 com `--contract D-PROD-209`.

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
              WHERE migration_name = '20261116100000_funcionario_tipo_terceirizado' AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)
    INTO n_ok, n_aberta FROM _prisma_migrations;
  IF n_ok <> 59 OR n_aberta <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % em aberto', n_ok, n_aberta;
  END IF;
  IF (SELECT count(*) FROM _prisma_migrations
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
         AND migration_name = '20261116000000_mao_obra_parceiro'
         AND checksum = '65a8a4eb8abc7b44e24d3121605a375fee34ea88968bffe875c53b30e9cf9dd0') <> 1 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (D-PROD-208) ausente ou com checksum divergente';
  END IF;
  -- A guarda da migration (logo abaixo) trava "Fornecedor" e confere de novo; esta conferência só para antes, com a mensagem do runbook.
  IF EXISTS (SELECT 1 FROM public."Fornecedor" WHERE "funcionario_tipo" = 'TAREFEIRO') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: há parceiro com funcionario_tipo = TAREFEIRO';
  END IF;
END $alvo$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '44dd42d800de7b5db034af1c42e0b0425f18666b5e73d260ed599d95d73adab6', now(),
        '20261116100000_funcionario_tipo_terceirizado', NULL, NULL, now(), 1);
COMMIT;
```
<!-- /sql:caminho-b -->

O `migration.sql` não tem `BEGIN`/`COMMIT`; a guarda `DO $$ … $$` vai como está. O
`checksum` do `INSERT` é o SHA-256 do arquivo. Qualquer falha desfaz tudo.

**Falha no caminho A** (`55P03`, `guarda: …`): nada fica; conferir pelo preflight;
`DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate resolve --rolled-back 20261116100000_funcionario_tipo_terceirizado --schema backend/prisma/schema.prisma`;
eliminar a causa e confirmar com o proprietário. Com `guarda: há parceiro com
funcionario_tipo = TAREFEIRO`: **não** tentar de novo (decisão nova).
**Falha no caminho B:** nada é aplicado; repetir o preflight e confirmar com o
proprietário.

## 6. Postcheck (antes do merge; só leitura)

<!-- sql:postcheck -->
```sql
-- MAIKE · D-PROD-209 · POSTCHECK (somente leitura). Cole TUDO e rode. Esperado: tudo OK e VEREDITO APLICADA.
WITH
esperado AS (SELECT '7692130048193495360'::text AS sid),
mig AS (
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS abertas,
         count(*) FILTER (WHERE migration_name = '20261116100000_funcionario_tipo_terceirizado'
                            AND checksum = '44dd42d800de7b5db034af1c42e0b0425f18666b5e73d260ed599d95d73adab6'
                            AND finished_at IS NOT NULL AND rolled_back_at IS NULL AND applied_steps_count = 1) AS esta
    FROM public._prisma_migrations
),
fo AS (SELECT to_regclass('public."Fornecedor"')::oid AS oid),
-- O CHECK novo, validado: TERCEIRIZADO no lugar de TAREFEIRO, o resto igual (MENSALISTA, DIARISTA e os 2 custos ≥ 0).
check_novo AS (
  SELECT count(*) AS n FROM pg_constraint k
   WHERE k.conrelid = (SELECT oid FROM fo) AND k.conname = 'Fornecedor_funcionario_check' AND k.contype = 'c' AND k.convalidated
     AND pg_get_constraintdef(k.oid) LIKE '%''MENSALISTA''%' AND pg_get_constraintdef(k.oid) LIKE '%''DIARISTA''%'
     AND pg_get_constraintdef(k.oid) LIKE '%''TERCEIRIZADO''%' AND pg_get_constraintdef(k.oid) NOT LIKE '%''TAREFEIRO''%'
     AND pg_get_constraintdef(k.oid) LIKE '%funcionario_custo_hora >= %' AND pg_get_constraintdef(k.oid) LIKE '%funcionario_custo_diaria >= %'
),
checks_fornecedor AS (SELECT count(*) AS n FROM pg_constraint k WHERE k.conrelid = (SELECT oid FROM fo) AND k.contype = 'c'),
tarefeiros AS (SELECT count(*) AS n FROM public."Fornecedor" WHERE funcionario_tipo = 'TAREFEIRO'),
tabelas AS (SELECT count(*) AS n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')),
base(ordem, item, valor, esperado, status) AS (
  SELECT 1, 'alvo: system_identifier', (SELECT system_identifier::text FROM pg_control_system()), (SELECT sid FROM esperado),
         CASE WHEN (SELECT system_identifier::text FROM pg_control_system()) = (SELECT sid FROM esperado) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 2, '20261116100000_funcionario_tipo_terceirizado concluída (checksum pinado, applied_steps_count 1)', (SELECT esta::text FROM mig), '1',
         CASE WHEN (SELECT esta FROM mig) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 3, 'migrations concluídas / em aberto', (SELECT concluidas || ' / ' || abertas FROM mig), '60 / 0',
         CASE WHEN (SELECT concluidas = 60 AND abertas = 0 FROM mig) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 4, 'CHECK Fornecedor_funcionario_check novo (TERCEIRIZADO, sem TAREFEIRO), validado', (SELECT n::text FROM check_novo), '1',
         CASE WHEN (SELECT n FROM check_novo) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 5, 'CHECKs em "Fornecedor" (nenhum a mais nem a menos)', (SELECT n::text FROM checks_fornecedor), '1',
         CASE WHEN (SELECT n FROM checks_fornecedor) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 6, 'parceiros com funcionario_tipo = TAREFEIRO', (SELECT n::text FROM tarefeiros), '0',
         CASE WHEN (SELECT n FROM tarefeiros) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 7, 'tabelas em public', (SELECT n::text FROM tabelas), '94',
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

Esperado: `1`; `60 / 0`; `1`; `1`; `0`; `94`; VEREDITO `APLICADA E CONFERIDA`.
`get_advisors`: nada novo (nenhuma tabela nem índice novo).

## 7. Reversão

- **Código:** o Instant Rollback é seguro (o código anterior lê tudo; só não grava
  Tarefeiro).
- **Banco:** uma migration **nova**, com decisão e GO próprios, nunca editando esta:
  o CHECK de volta com `TAREFEIRO`. Exata enquanto nenhum parceiro tiver
  `TERCEIRIZADO`; com algum, decisão do proprietário.

## 8. `RELEASE_BLOCKED`

Sem o GO-2; validação local não verde; `system_identifier` diferente; histórico
diferente de 59/0, a D-PROD-208 com outro checksum ou a D-PROD-209 já registrada;
qualquer parceiro com `TAREFEIRO`; qualquer `PARAR` no preflight; outra migration
nova na mesma release; SHA-256 diferente do pinado; ensaio local sem passar.

## 9. Registro da execução

| Campo | Valor |
|---|---|
| GO-1 e GO-2 | GO escrito do proprietário em 2026-11-16 ("pode aplicar"), para esta migration |
| Caminho | B (conector Supabase, uma `execute_sql`) |
| `<SHA_APROVADO>` | `44dd42d800de7b5db034af1c42e0b0425f18666b5e73d260ed599d95d73adab6` (conferido no arquivo antes de colar) |
| Ensaio local (§4.2) | 12/12 (`funcionarioTipoTerceirizadoMigration`) |
| Preflight (§4) | 2026-11-16 ~00:26Z: todas as linhas OK (alvo, 59/0, esta 0, a anterior 1, TAREFEIRO 0, CHECK antigo 1, 94 tabelas, 0 travas, 0 transações longas) · PRONTO PARA APLICAR |
| Aplicação | 2026-11-16 ~00:27Z, envelope do §5 com a migration integral, COMMIT sem erro |
| Postcheck (§6) | 2026-11-16 ~00:28Z: todas as linhas OK (esta 1 com o checksum pinado, 60/0, CHECK novo validado 1, 1 CHECK em `Fornecedor`, TAREFEIRO 0, 94 tabelas) · APLICADA E CONFERIDA |
| Merge e deploy | PR #299, depois da suíte backend local completa verde (deploy automático da Vercel a partir da `main`) |
