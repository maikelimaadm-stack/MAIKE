# MAIKE — Dias de descanso da cultura: runbook de release expand-only (D-PROD-223)

> **Estado: PENDENTE.** `SCHEMA_APPLIED_PROD: NÃO`. Registro no §7.
>
> Este documento é o plano. Cada passo exige o GO do proprietário e para no
> primeiro desvio com **`RELEASE_BLOCKED`** (migration) ou **`BACKFILL_BLOCKED`**
> (dados). Valores entre `<…>` são preenchidos na hora, a partir de leituras reais,
> nunca copiados deste texto.

Decisão: [D-PROD-223](./DECISIONS.md) · Relatório:
[`MAIKE-DESCANSO-ESTIMADO-REPORT.md`](./MAIKE-DESCANSO-ESTIMADO-REPORT.md).
Precedentes executados: [`MAIKE-MEDICAO-FORRAGEM-RUNBOOK-RELEASE.md`](./MAIKE-MEDICAO-FORRAGEM-RUNBOOK-RELEASE.md) §7
(EXPAND, caminho B) e [`MAIKE-AREA-CULTURA-RUNBOOK-RELEASE.md`](./MAIKE-AREA-CULTURA-RUNBOOK-RELEASE.md) §4b
(passo de dados guardado, auditado). Molde: [`MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md)
(§1 explica por que nunca `apply_migration` e nunca DDL solto).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261117300000_cultura_dias_descanso` |
| Natureza | **expand-only**: 1 coluna NOVA, anulável e sem DEFAULT, em tabela existente — `CADCULTURAS.dias_descanso INTEGER`. Sem CHECK (a allowlist EXPAND recusa CHECK em tabela antiga; a faixa 1..365 é da API), sem índice, nenhuma linha muda de valor |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `5a266b174b20a6bc3ca51a7dc15d852378a875d506a805bb7eedfbba01191a4b` |
| Classificação (`classificarMigrations`) | `modo: EXPAND`, `tabelas_novas: []`, `colunas_novas_em_tabelas_antigas: ["CADCULTURAS.dias_descanso"]`, `violacoes: []` (teste B35a) |
| `_prisma_migrations` | esperado **66** concluídas, 0 abertas (a última `20261117200000_medicao_forragem`, D-PROD-219, checksum `66f5fb51b3d2c92419bd8d2320f33b7c632b03edf29a0b598686622e92e7b62f`); depois **67**. Recontar no §2 |
| Tabelas em `public` | **96** antes e depois |
| Preflight do deploy | `COLUNAS_EXIGIDAS` ganha `CADCULTURAS.dias_descanso` (`scripts/deploy/preflightSchemaLib.mjs`) |

**Por que antes do merge (D-PROD-72 item 1):** a Vercel publica a `main` sozinha.
O runtime novo lê a coluna em `/culturas`, em `/areas-pastagem` (a cultura embutida)
e no farol do mapa: sem a migration, essas leituras respondem 500 — **inclusive a
lista de áreas, que o Mapa Geral usa sempre**. O runtime antigo não conhece a coluna e
segue igual com o banco migrado — **não há janela** se a ordem for migration → merge.

**Efeito durante a transação:** `ALTER TABLE … ADD COLUMN` anulável sem DEFAULT é só
catálogo (sem reescrita), mas pede trava `ACCESS EXCLUSIVE` por um instante em
`CADCULTURAS` — leituras e escritas da tabela esperam o fim da transação
(milissegundos). Uma espera além do `lock_timeout` de 5 s aborta tudo sem aplicar nada.

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

O passo de dados (§4b) é **separado**, depois da migration, com GO próprio.

## 2. Preflight — somente leitura (projeto `uuemcasqcdjucflulkne`)

```sql
SELECT system_identifier FROM pg_control_system();            -- 7692130048193495360
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok,
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS ruim
  FROM _prisma_migrations;                                     -- 66, 0
SELECT migration_name, checksum FROM _prisma_migrations
 WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
 ORDER BY finished_at DESC LIMIT 1;                            -- 20261117200000_medicao_forragem, 66f5fb51…
SELECT count(*) FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'CADCULTURAS' AND column_name = 'dias_descanso';  -- 0
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 96
SELECT codigo, nome FROM "CADCULTURAS"
 WHERE cliente_id = 'ca98fddc19f711cde8c2a6383' AND empresa_id = 'cmw13bo4a0003l508adj0rdw2'
 ORDER BY codigo;                                              -- as 11 da lista de referência (para o §4b)
```

E, localmente, no `<SHA_APROVADO>`: `sha256sum` do `migration.sql` igual ao
pinado e a classificação do §0 (teste B35a).

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
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261117300000_cultura_dias_descanso') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 66 OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261117200000_medicao_forragem'
                    AND checksum = '66f5fb51b3d2c92419bd8d2320f33b7c632b03edf29a0b598686622e92e7b62f'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (20261117200000_medicao_forragem) não está concluída com o checksum do repositório';
  END IF;
  IF to_regclass('public."CADCULTURAS"') IS NULL THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: tabela CADCULTURAS ausente';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'CADCULTURAS' AND column_name = 'dias_descanso') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: coluna CADCULTURAS.dias_descanso já existe';
  END IF;
END $guarda$;

-- <migration.sql integral, byte a byte (SHA-256 5a266b17…01191a4b)>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '5a266b174b20a6bc3ca51a7dc15d852378a875d506a805bb7eedfbba01191a4b', now(),
        '20261117300000_cultura_dias_descanso', NULL, NULL, now(), 1);
COMMIT;
```

O script pronto, com o `migration.sql` integral, fica fora do repositório, no
rascunho da sessão (`aplicar223.sql`); confira o SHA-256 do trecho da migration
antes de usar. Qualquer falha desfaz tudo. Confirme pelo §4 que a coluna não
existe e que não há linha nova, corrija a causa e peça novo GO.

**Ensaio local (2026-11-17):** num banco à parte com as 66 migrations da `main`
(`prisma migrate deploy` de uma cópia das pastas até a `20261117200000_medicao_forragem`:
66 / 0) e 12 culturas na fazenda (as 11 da lista de referência e uma 012 fora dela):
com o `system_identifier` de produção recusou (`RELEASE_BLOCKED: alvo divergente`, nada
aplicado); com o local, aplicou numa transação (66 → 67, checksum pinado); o
`migrate diff --exit-code` contra o `schema.prisma` disse "No difference detected."
(exit 0), o `migrate status` "Database schema is up to date!", e a 2ª execução recusou
(`RELEASE_BLOCKED: migration já registrada`), sem linha nova.

## 4. Conferência — somente leitura (depois da migration)

```sql
SELECT migration_name, checksum, rolled_back_at, applied_steps_count FROM _prisma_migrations
 WHERE migration_name = '20261117300000_cultura_dias_descanso';  -- 1 linha, checksum pinado, null, 1
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) FROM _prisma_migrations;  -- 67, 0
SELECT data_type, is_nullable, column_default FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'CADCULTURAS' AND column_name = 'dias_descanso';  -- integer, YES, null
SELECT count(*) FILTER (WHERE dias_descanso IS NOT NULL) FROM "CADCULTURAS";  -- 0 (antes do §4b)
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 96
```

Mais: `get_advisors` (segurança) sem alerta novo.

### 4b. Os dias de descanso de referência nas 11 culturas da fazenda (DML, uma transação)

Separado da migration, com **GO próprio**. Fazenda `cmw13bo4a0003l508adj0rdw2`
(cliente `ca98fddc19f711cde8c2a6383`). Casa **código e nome** com a lista de
referência e só preenche onde `dias_descanso` está vazio:

| Código | Nome | Dias |
|---|---|---|
| 001 | BRACHIARIA BRIZANTHA CV. MARANDU | 30 |
| 002 | BRACHIARIA BRIZANTHA CV. XARAÉS | 30 |
| 003 | BRACHIARIA BRIZANTHA CV. PIATÃ | 30 |
| 004 | BRACHIARIA BRIZANTHA CV. PAIAGUÁS | 28 |
| 005 | BRACHIARIA DECUMBENS | 25 |
| 006 | BRACHIARIA HUMIDICOLA | 25 |
| 007 | PANICUM CV. MOMBAÇA | 35 |
| 008 | PANICUM CV. TANZÂNIA | 32 |
| 009 | PANICUM CV. ZURI | 35 |
| 010 | PANICUM CV. MASSAI | 28 |
| 011 | TIFTON 85 | 25 |

A guarda confere o alvo, a migration concluída com o checksum pinado e **exatamente
11** culturas a preencher; o `UPDATE` confere que tocou 11 linhas; qualquer
divergência → `BACKFILL_BLOCKED` e nada muda. Um evento no `AuditLog`
(`acao = 'backfill_dias_descanso_cultura'`, `request_id = 'd-prod-223-backfill'`)
registra o passo e os valores. Script pronto no rascunho da sessão (`backfill223.sql`),
com o postcheck no fim (as culturas da fazenda com os dias e a linha da auditoria).

**Ensaio local (2026-11-17), no mesmo banco do §3:** antes da migration recusou
(`BACKFILL_BLOCKED: a migration … não está concluída`); com o `system_identifier` de
produção recusou (`alvo divergente`); com o local, preencheu as 11 (a 012 fora da lista
ficou vazia) e gravou 1 evento na auditoria; a 2ª execução recusou
(`0 culturas de referência sem dias de descanso na fazenda, esperado 11`).

## 5. Merge, deploy e smoke

1. Merge **logo depois** do §4. 2. Deploy READY na Vercel: `/api/native/health`
com o `release` da `main` nova. 3. Smoke: `/api/native/medicoes-forragem/descanso`
sem sessão → 401; como administrador, **Culturas** mostra a coluna "Dias de descanso"
(30 na 001 depois do §4b) e o formulário aceita 1..365; no Mapa Geral, Visualização →
**Forragem**: um pasto sem medição recente, sem lote e com saída conhecida aparece no
tom bem claro, e o painel Forragem dele diz "<Situação> (estimado) · lote saiu há N
dias · descanso da cultura D dias"; um pasto com lote diz "Em pastejo".

## 6. Rollback

A coluna é nova e nada depende dela no banco. Reverter seria uma migration nova com
`ALTER TABLE "CADCULTURAS" DROP COLUMN "dias_descanso"` (CONTRACT, com GO próprio),
nunca editando esta. Com o código novo no ar, reverter o código primeiro. O passo de
dados se desfaz com `UPDATE … SET dias_descanso = NULL` nas mesmas 11 linhas.

## 7. Registro de execução

| Campo | Valor |
|---|---|
| Data/hora (UTC) | `<pendente>` |
| Caminho | `<A ou B>` |
| GO | `<texto do GO do proprietário>` |
| Preflight (§2) | `<pendente>` |
| Postcheck (§4) | `<pendente>` |
| Passo de dados (§4b) | `<pendente — GO próprio>` |
| Resultado | **PENDENTE** |
