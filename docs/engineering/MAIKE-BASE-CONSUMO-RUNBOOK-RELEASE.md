# MAIKE — Base do consumo na Formulação: runbook de release CONTRACT (D-PROD-210)

> **Estado: EXECUTADO em 2026-11-16 02:06:55 UTC (caminho B). `SCHEMA_APPLIED_PROD: SIM`.** Registro no §7.
>
> Este documento é o plano. Cada passo exige o GO do proprietário e para no
> primeiro desvio com **`RELEASE_BLOCKED`**. Valores entre `<…>` são preenchidos
> na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-210](./DECISIONS.md) · Relatório:
[`MAIKE-BASE-CONSUMO-REPORT.md`](./MAIKE-BASE-CONSUMO-REPORT.md).
Precedentes: [`MAIKE-FECHAMENTO-CONSUMO-RUNBOOK-RELEASE.md`](./MAIKE-FECHAMENTO-CONSUMO-RUNBOOK-RELEASE.md) §7
(caminho B na mesma tabela) e o CONTRACT aditivo da D-PROD-197
([`MAIKE-TIPO-ATIVIDADE-DEFAULTS-RUNBOOK-RELEASE.md`](./MAIKE-TIPO-ATIVIDADE-DEFAULTS-RUNBOOK-RELEASE.md)).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261116200000_formulacao_base_consumo` |
| Natureza | **CONTRACT** (décima entrada de `MIGRATIONS_CONTRACT_APROVADAS`): guarda DO pinada + **7 instruções pinadas** em `CADFORMULACAO` e `CADFORMULACAOREGRA`; não há resto. Nenhuma tabela nova ou apagada, nenhum dado migrado, nenhum `UPDATE`/`DELETE` |
| As 7 instruções | `CADFORMULACAO.base_consumo VARCHAR(16) NOT NULL DEFAULT 'PV'`; `percentual_pv_padrao DROP NOT NULL`; `DROP CONSTRAINT CADFORMULACAO_percentual_pv_padrao_check`; `ADD CONSTRAINT CADFORMULACAO_base_consumo_check` (PV exige %PV em (0, 5]; G_CAB_DIA exige %PV nulo e `consumo_objetivo_g_cab_dia` > 0); `CADFORMULACAOREGRA.g_cab_dia DECIMAL(10,2)`; `DROP` e `ADD` de `CADFORMULACAOREGRA_forma_check` (não consome = sem %PV e sem gramas; consome = %PV OU gramas) |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `a8c42eeb8c1fc7667833213d2d87c5a7dffd460ad1dea279ab6d5338732c3171` |
| Guarda (hash `a66ff13e…4819` em `MIGRATIONS_CONTRACT_APROVADAS`) | trava `CADFORMULACAO`, `CADFORMULACAOINGREDIENTE` e `CADFORMULACAOREGRA` em ACCESS EXCLUSIVE e exige as **3 VAZIAS**; colunas e constraint novas ausentes; os 2 CHECKs da D-PROD-203 presentes; `percentual_pv_padrao` ainda NOT NULL |
| Aprovação do CONTRACT | Proprietário: "sobre a tabela que já tem dados pode excluir, não tem problema, os dados eram só teste". Conferido só leitura: as 3 tabelas com **0 linhas** e nenhum `SuplementacaoEvento` com `formulacao_id`. Nenhum DELETE é feito |
| Bloco RLS | nenhum (as tabelas já têm RLS desde a D-PROD-203) |
| `_prisma_migrations` | esperado **60** concluídas, 0 abertas (a última `20261116100000_funcionario_tipo_terceirizado`, D-PROD-209); depois **61**. Recontar no §2 |
| Tabelas em `public` | **94** antes e depois |

**Por que antes do merge (D-PROD-72 item 1):** a Vercel publica a `main` sozinha.
O runtime novo lê e grava `base_consumo` e `g_cab_dia` em `/formulacoes`: sem a
migration, a tela Formulações e o lançamento do cocho respondem 500. O runtime
antigo não lê as colunas novas e, com as tabelas vazias, nada que ele grave fere
os CHECKs novos (grava sempre na base PV com %PV) — **não há janela**.

**Efeito durante a transação:** as 3 tabelas ficam travadas (ACCESS EXCLUSIVE)
por instantes; os ALTER só mexem no catálogo e os CHECKs validam tabelas vazias.
Uma espera além do `lock_timeout` de 5 s aborta tudo sem aplicar nada.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74), release ISOLADA com a decisão exata:**
  numa máquina protegida, com `MIGRATION_DATABASE_URL` (sessão/direta, nunca o
  pooler 6543), `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360` e
  `DATABASE_URL` do mesmo banco:
  ```bash
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --contract D-PROD-210
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --contract D-PROD-210 --verificar-alvo
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --contract D-PROD-210 --aplicar
  ```
- **B — conector Supabase, uma única `execute_sql` (§3):** só com autorização
  **escrita e específica do proprietário para esta migration**, registrada como
  desvio da D-PROD-74.

## 2. Preflight — somente leitura (projeto `uuemcasqcdjucflulkne`)

```sql
SELECT system_identifier FROM pg_control_system();            -- 7692130048193495360
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok,
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS ruim
  FROM _prisma_migrations;                                     -- 60, 0
SELECT migration_name FROM _prisma_migrations
 WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
 ORDER BY finished_at DESC LIMIT 1;                            -- 20261115900000_atividade_mao_obra_servico
SELECT (SELECT count(*) FROM "CADFORMULACAO") AS f, (SELECT count(*) FROM "CADFORMULACAOINGREDIENTE") AS i,
       (SELECT count(*) FROM "CADFORMULACAOREGRA") AS r;       -- 0, 0, 0
SELECT count(*) FROM "SuplementacaoEvento" WHERE dados ? 'formulacao_id';  -- 0
SELECT table_name, column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND ((table_name = 'CADFORMULACAO' AND column_name = 'base_consumo')
    OR (table_name = 'CADFORMULACAOREGRA' AND column_name = 'g_cab_dia'));   -- nenhuma linha
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 94
```

E, localmente, no `<SHA_APROVADO>`: `sha256sum` do `migration.sql` igual ao
pinado, e `classificarMigrations` com `modo: CONTRACT`, a entrada D-PROD-210 e
`violacoes: []` (testes B29a/B29b).

## 3. Caminho B — uma transação

O SQL é o envelope abaixo com o `migration.sql` INTEGRAL no meio, sem edição
(arquivo pronto da sessão: `aplicar208.sql`). Qualquer `RAISE` desfaz tudo.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(72707369);
DO $guarda$
DECLARE n_ok int; n_ruim int; n bigint;
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7692130048193495360 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: alvo divergente';
  END IF;
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261116200000_formulacao_base_consumo') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 60 OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261116100000_funcionario_tipo_terceirizado' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (D-PROD-209, tipo Terceirizado) não está concluída';
  END IF;
  IF to_regclass('public."CADFORMULACAO"') IS NULL OR to_regclass('public."CADFORMULACAOINGREDIENTE"') IS NULL OR to_regclass('public."CADFORMULACAOREGRA"') IS NULL THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: tabelas de Formulações ausentes';
  END IF;
  SELECT (SELECT count(*) FROM public."CADFORMULACAO") + (SELECT count(*) FROM public."CADFORMULACAOINGREDIENTE") + (SELECT count(*) FROM public."CADFORMULACAOREGRA") INTO n;
  IF n <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: as 3 tabelas de Formulações precisam estar VAZIAS (% linhas)', n;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
              AND ((table_name = 'CADFORMULACAO' AND column_name = 'base_consumo') OR (table_name = 'CADFORMULACAOREGRA' AND column_name = 'g_cab_dia'))) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: coluna nova já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'a8c42eeb8c1fc7667833213d2d87c5a7dffd460ad1dea279ab6d5338732c3171', now(),
        '20261116200000_formulacao_base_consumo', NULL, NULL, now(), 1);
COMMIT;
```

## 4. Conferência — somente leitura

```sql
SELECT migration_name, checksum, rolled_back_at, applied_steps_count FROM _prisma_migrations
 WHERE migration_name = '20261116200000_formulacao_base_consumo';     -- 1 linha, checksum pinado, null, 1
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) FROM _prisma_migrations;  -- 61, 0
SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
 WHERE table_schema = 'public' AND ((table_name = 'CADFORMULACAO' AND column_name IN ('base_consumo', 'percentual_pv_padrao'))
    OR (table_name = 'CADFORMULACAOREGRA' AND column_name = 'g_cab_dia')) ORDER BY 1, 2;
  -- base_consumo varchar NO 'PV'; percentual_pv_padrao numeric YES; g_cab_dia numeric YES
SELECT conname FROM pg_constraint WHERE conrelid IN ('public."CADFORMULACAO"'::regclass, 'public."CADFORMULACAOREGRA"'::regclass)
   AND contype = 'c' ORDER BY 1;
  -- CADFORMULACAOREGRA_forma_check, CADFORMULACAO_base_consumo_check, CADFORMULACAO_consumo_objetivo_check,
  -- CADFORMULACAO_tipo_check (sem CADFORMULACAO_percentual_pv_padrao_check)
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 94
```

Mais: `get_advisors` (segurança) sem alerta novo.

## 5. Merge, deploy e smoke

1. Merge **logo depois** do §4. 2. Deploy READY na Vercel: `/api/native/health`
com o `release` da `main` nova. 3. Smoke: `/api/native/formulacoes` sem sessão →
401; na tela Formulações, criar uma formulação "g por cabeça por dia" (80 g,
VACA 1500 g = 1,5 kg) e ver só os campos de gramas; no mapa, abastecer um cocho
com ela e ver "Consumo esperado em g/cab/dia".

## 6. Rollback

Não há reversão automática. Desfazer seria uma CONTRACT nova (voltar o NOT NULL
exige que nenhuma formulação esteja na base G), com GO próprio, nunca editando
esta. Com o código novo no ar, reverter o código primeiro.

## 7. Registro de execução

| Campo | Valor |
|---|---|
| Data/hora (UTC) | 2026-11-16 02:06:55 (`finished_at` da linha em `_prisma_migrations`) |
| Caminho | **B**: `aplicar210.sql` (guarda + `migration.sql` com as mesmas instruções + INSERT com o checksum) numa transação única pelo `execute_sql` do Supabase, projeto `uuemcasqcdjucflulkne`. Aplicado pela sessão coordenadora. Uma tentativa anterior (com a guarda de 58) foi barrada pela guarda porque a produção já tinha 59 — nada foi alterado |
| GO | "go", escrito pelo proprietário para esta migration (mesmo conteúdo, renumerado de D-PROD-208 para D-PROD-210), e a aprovação da chamada no app |
| Preflight (§2) | leitura antes e guarda da transação: `system_identifier` 7692130048193495360; 60 concluídas / 0 com falha, a última `20261116100000_funcionario_tipo_terceirizado`; as 3 tabelas de Formulações com 0 linhas; colunas novas ausentes |
| Ensaio | Banco local com as 60 migrations da `main` `18426967` (sem esta; a última a D-PROD-209): alvo de produção recusado (`RELEASE_BLOCKED: alvo divergente`); com o `system_identifier` local aplicou numa transação (61 / 0, 94 tabelas, checksum `a8c42eeb…` igual ao pinado, `migrate status` "Database schema is up to date!", `migrate diff` "No difference detected."); repetir recusado (`RELEASE_BLOCKED: migration já registrada`). SQL: `aplicar210.sql` (scratchpad da sessão) |
| Postcheck (§4) | 61 concluídas / 0 com falha; checksum `a8c42eeb8c1fc7667833213d2d87c5a7dffd460ad1dea279ab6d5338732c3171` igual ao pinado; `base_consumo` NOT NULL DEFAULT 'PV'; `percentual_pv_padrao` anulável; `CADFORMULACAOREGRA.g_cab_dia` numeric anulável; CHECKs `CADFORMULACAO_base_consumo_check` e `CADFORMULACAOREGRA_forma_check` presentes, `CADFORMULACAO_percentual_pv_padrao_check` removido; 94 tabelas em `public` |
| Resultado | **APLICADA E CONFERIDA** antes do merge (D-PROD-72) |
