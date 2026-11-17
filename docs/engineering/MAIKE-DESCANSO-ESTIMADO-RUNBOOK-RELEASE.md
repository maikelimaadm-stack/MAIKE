# MAIKE — Dias de descanso e parâmetros do pasto: runbook de release expand-only (D-PROD-223)

> **Estado: EXECUTADO** (migration e passo de dados, 2026-11-17). `SCHEMA_APPLIED_PROD: SIM`. Registro no §7.
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
| Migration | `20261117300000_descanso_e_alturas_por_area` |
| Natureza | **expand-only**: 4 colunas NOVAS, anuláveis e sem DEFAULT, em tabelas existentes — `CADCULTURAS.dias_descanso INTEGER` e, em `AreaPastagem`, `altura_entrada_cm DECIMAL(6,1)`, `altura_saida_cm DECIMAL(6,1)` e `dias_descanso INTEGER` (parâmetros próprios do pasto; vazio = os da cultura). Sem CHECK (a allowlist EXPAND recusa CHECK em tabela antiga; as faixas são da API — D-PROD-223 item 7), sem índice, nenhuma linha muda de valor |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `c391e4b0c28dbefdafa8d0819d948efde952bf8ee5adc20ff58aa930239b477e` |
| Classificação (`classificarMigrations`) | `modo: EXPAND`, `tabelas_novas: []`, `colunas_novas_em_tabelas_antigas: ["AreaPastagem.altura_entrada_cm", "AreaPastagem.altura_saida_cm", "AreaPastagem.dias_descanso", "CADCULTURAS.dias_descanso"]`, `violacoes: []` (teste B35a) |
| `_prisma_migrations` | esperado **66** concluídas, 0 abertas (a última `20261117200000_medicao_forragem`, D-PROD-219, checksum `66f5fb51b3d2c92419bd8d2320f33b7c632b03edf29a0b598686622e92e7b62f`); depois **67**. Recontar no §2 |
| Tabelas em `public` | **96** antes e depois |
| Preflight do deploy | `COLUNAS_EXIGIDAS` ganha as 4 colunas (`scripts/deploy/preflightSchemaLib.mjs`) |

**Por que antes do merge (D-PROD-72 item 1):** a Vercel publica a `main` sozinha.
O runtime novo lê a coluna em `/culturas`, em `/areas-pastagem` (a cultura embutida)
e no farol do mapa: sem a migration, essas leituras respondem 500 — **inclusive a
lista de áreas, que o Mapa Geral usa sempre**. O runtime antigo não conhece a coluna e
segue igual com o banco migrado — **não há janela** se a ordem for migration → merge.

**Efeito durante a transação:** `ALTER TABLE … ADD COLUMN` anulável sem DEFAULT é só
catálogo (sem reescrita), mas pede trava `ACCESS EXCLUSIVE` por um instante em
`CADCULTURAS` e em `AreaPastagem` — leituras e escritas dessas tabelas (inclusive o
mapa lendo as áreas) esperam o fim da transação (milissegundos). Uma espera além do `lock_timeout` de 5 s aborta tudo sem aplicar nada.

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
SELECT table_name, column_name FROM information_schema.columns
 WHERE table_schema = 'public'
   AND ((table_name = 'CADCULTURAS' AND column_name = 'dias_descanso')
     OR (table_name = 'AreaPastagem' AND column_name IN ('altura_entrada_cm', 'altura_saida_cm', 'dias_descanso')));  -- 0 linhas
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
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261117300000_descanso_e_alturas_por_area') THEN
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
  IF to_regclass('public."CADCULTURAS"') IS NULL OR to_regclass('public."AreaPastagem"') IS NULL THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: tabela CADCULTURAS ou AreaPastagem ausente';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND ((table_name = 'CADCULTURAS' AND column_name = 'dias_descanso')
                  OR (table_name = 'AreaPastagem' AND column_name IN ('altura_entrada_cm', 'altura_saida_cm', 'dias_descanso')))) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: alguma das 4 colunas novas já existe';
  END IF;
END $guarda$;

-- <migration.sql integral, byte a byte (SHA-256 c391e4b0…0239b477e)>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'c391e4b0c28dbefdafa8d0819d948efde952bf8ee5adc20ff58aa930239b477e', now(),
        '20261117300000_descanso_e_alturas_por_area', NULL, NULL, now(), 1);
COMMIT;
```

O script pronto, com o `migration.sql` integral, fica fora do repositório, no
rascunho da sessão (`aplicar223.sql`); confira o SHA-256 do trecho da migration
antes de usar. Qualquer falha desfaz tudo. Confirme pelo §4 que a coluna não
existe e que não há linha nova, corrija a causa e peça novo GO.

**Ensaio local (2026-11-17):** num banco à parte com as 66 migrations da `main`
(`prisma migrate deploy` de uma cópia das pastas até a `20261117200000_medicao_forragem`:
66 / 0) e 12 culturas na fazenda (as 11 da lista de referência e uma 012 fora dela),
refeito com as 4 colunas: com o `system_identifier` de produção recusou
(`RELEASE_BLOCKED: alvo divergente`, nada aplicado); com o local, aplicou numa transação
(66 → 67, checksum pinado; as 3 colunas de `AreaPastagem` `numeric(6,1)`/`integer`
anuláveis e a de `CADCULTURAS` `integer`, 96 tabelas); o
`migrate diff --exit-code` contra o `schema.prisma` disse "No difference detected."
(exit 0), o `migrate status` "Database schema is up to date!", e a 2ª execução recusou
(`RELEASE_BLOCKED: migration já registrada`), sem linha nova.

## 4. Conferência — somente leitura (depois da migration)

```sql
SELECT migration_name, checksum, rolled_back_at, applied_steps_count FROM _prisma_migrations
 WHERE migration_name = '20261117300000_descanso_e_alturas_por_area';  -- 1 linha, checksum pinado, null, 1
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) FROM _prisma_migrations;  -- 67, 0
SELECT table_name, column_name, data_type, numeric_precision, numeric_scale, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND ((table_name = 'CADCULTURAS' AND column_name = 'dias_descanso')
     OR (table_name = 'AreaPastagem' AND column_name IN ('altura_entrada_cm', 'altura_saida_cm', 'dias_descanso')))
 ORDER BY 1, 2;   -- 4 linhas: numeric 6/1 (2×) e integer (2×), todas YES, sem DEFAULT
SELECT count(*) FILTER (WHERE altura_entrada_cm IS NOT NULL OR altura_saida_cm IS NOT NULL OR dias_descanso IS NOT NULL)
  FROM "AreaPastagem";  -- 0 (sem semente: vale a cultura)
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
dias · descanso da cultura D dias"; um pasto com lote diz "Em pastejo". No cadastro da
Área (uso Pastagem), a seção "Parâmetros do pasto (opcional — vazio usa os da cultura)"
mostra os valores da cultura como dica; gravar, por exemplo, dias de descanso 40 num
piquete faz o painel dizer "descanso 40 dias (do pasto)" e a estimativa usá-los; uma
Medição de Forragem nesse pasto mostra no cabeçalho as alturas e "(do pasto)" quando
forem próprias.

## 6. Rollback

As colunas são novas e nada depende delas no banco. Reverter seria uma migration nova com
`DROP COLUMN` das 4 (CONTRACT, com GO próprio),
nunca editando esta. Com o código novo no ar, reverter o código primeiro. O passo de
dados se desfaz com `UPDATE … SET dias_descanso = NULL` nas mesmas 11 linhas.

## 7. Registro de execução

| Campo | Valor |
|---|---|
| Data/hora (UTC) | **2026-11-17 13:48:31** (`finished_at` da migration); passo de dados às **13:48:50** |
| Caminho | **B** (uma transação via `execute_sql`, exatamente o `aplicar223.sql`: guarda + corpo idêntico ao `migration.sql` + registro em `_prisma_migrations`); depois o `backfill223.sql`, também numa transação |
| GO | "go" (pedido de autorização da D-PROD-223, aprovado pelo proprietário; relayed pela sessão coordenadora) |
| Preflight (§2) | 66 concluídas / 0 com falha; anterior `20261117200000_medicao_forragem` (`66f5fb51…`); 0 das 4 colunas presentes; 11 culturas na fazenda |
| Postcheck (§4) | 67 / 0; `20261117300000_descanso_e_alturas_por_area` com checksum `c391e4b0…0239b477e`; as 4 colunas presentes (`AreaPastagem.altura_entrada_cm` e `altura_saida_cm` numeric, `AreaPastagem.dias_descanso` e `CADCULTURAS.dias_descanso` integer); 96 tabelas |
| Passo de dados (§4b) | 11 culturas com `dias_descanso` (001 30, 002 30, 003 30, 004 28, 005 25, 006 25, 007 35, 008 32, 009 35, 010 28, 011 25); `AuditLog` `backfill_dias_descanso_cultura`, total 11, `request_id = 'd-prod-223-backfill'` |
| Resultado | **EXECUTADO**. Merge depois do CI verde (§5) |
