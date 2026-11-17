# MAIKE — Medição de Forragem: runbook de release expand-only (D-PROD-219)

> **Estado: PENDENTE.** `SCHEMA_APPLIED_PROD: NÃO`. Registro no §7.
>
> Este documento é o plano. Cada passo exige o GO do proprietário e para no
> primeiro desvio com **`RELEASE_BLOCKED`**. Valores entre `<…>` são preenchidos
> na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-219](./DECISIONS.md) · Relatório:
[`MAIKE-MEDICAO-FORRAGEM-REPORT.md`](./MAIKE-MEDICAO-FORRAGEM-REPORT.md).
Precedente executado: [`MAIKE-CULTURAS-RUNBOOK-RELEASE.md`](./MAIKE-CULTURAS-RUNBOOK-RELEASE.md) §7
(EXPAND, caminho B). Molde: [`MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md)
(§1 explica por que nunca `apply_migration` e nunca DDL solto).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261117200000_medicao_forragem` |
| Natureza | **expand-only**: 1 tabela NOVA — `MEDICAOFORRAGEM` — com 3 índices e 1 unique (todos começando por `cliente_id`), FKs compostas pelo tenant (Cliente, Empresa, AreaPastagem e CADCULTURAS pela fazenda, todas `RESTRICT`), 4 CHECKs (método, situação, campos do método, valores) e o bloco RLS/REVOKE dela. Nenhuma tabela existente é alterada (a FK para CADCULTURAS usa o UNIQUE `(cliente_id, empresa_id, id)` que a D-PROD-216 já criou), nenhum dado migrado ou semeado |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `66f5fb51b3d2c92419bd8d2320f33b7c632b03edf29a0b598686622e92e7b62f` |
| Bloco RLS (`DO_RLS_APROVADOS`) | `b2d54fa5991b7a8200801a2cb5613fed353c1f1756d740268c27d3feadf92718` (mesmo corpo de sempre, lista nova) |
| `_prisma_migrations` | esperado **65** concluídas, 0 abertas (a última `20261117100000_abastecimento_fk_apontamento_atividade`, D-PROD-217, checksum `1ee8d5a3c3dd64e59d27459bd51224795b69f691c7358088fd5bbec375561c0e`); depois **66**. Recontar no §2 |
| Tabelas em `public` | **95** antes, **96** depois |

**Por que antes do merge (D-PROD-72 item 1):** a Vercel publica a `main` sozinha.
O runtime novo lê a tabela pelo cache do mapa (`/medicoes-forragem`) e grava pelo
botão "Medição de Forragem" do pasto: sem a migration, `/medicoes-forragem` responde
500 (o mapa segue de pé; só a medição falha). O runtime antigo não conhece a tabela e
segue igual com o banco migrado — **não há janela**.

**Efeito durante a transação:** `CREATE TABLE` e as FKs pedem trava
`SHARE ROW EXCLUSIVE` por um instante nas tabelas referenciadas (`Cliente`,
`Empresa`, `AreaPastagem` e `CADCULTURAS`) — leituras seguem, escritas nelas esperam o
fim da transação (milissegundos; a tabela nasce vazia). Uma espera além do
`lock_timeout` de 5 s aborta tudo sem aplicar nada.

**Depois da PR #303 (D-PROD-217).** A #303 (`20261117100000_abastecimento_fk_apontamento_atividade`) foi mergeada e aplicada em produção antes desta: produção tem 65 concluídas, a última é ela. Esta é a 66ª, com ela como anterior; as duas são independentes (a #303 só toca AbastecimentoBem; esta só cria a MEDICAOFORRAGEM).

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

## 2. Preflight — somente leitura (projeto `uuemcasqcdjucflulkne`)

```sql
SELECT system_identifier FROM pg_control_system();            -- 7692130048193495360
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok,
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS ruim
  FROM _prisma_migrations;                                     -- 65, 0
SELECT migration_name, checksum FROM _prisma_migrations
 WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
 ORDER BY finished_at DESC LIMIT 1;                            -- 20261117100000_abastecimento_fk_apontamento_atividade, 1ee8d5a3…
SELECT to_regclass('public."MEDICAOFORRAGEM"');                -- null
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 95
```

E, localmente, no `<SHA_APROVADO>`: `sha256sum` do `migration.sql` igual ao
pinado, e `classificarMigrations` com `modo: EXPAND`,
`tabelas_novas = ["MEDICAOFORRAGEM"]`, `colunas_novas_em_tabelas_antigas = []` e
`violacoes: []` (teste B34a).

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
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261117200000_medicao_forragem') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 65 OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261117100000_abastecimento_fk_apontamento_atividade'
                    AND checksum = '1ee8d5a3c3dd64e59d27459bd51224795b69f691c7358088fd5bbec375561c0e'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (20261117100000_abastecimento_fk_apontamento_atividade) não está concluída com o checksum do repositório';
  END IF;
  IF to_regclass('public."MEDICAOFORRAGEM"') IS NOT NULL THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: tabela MEDICAOFORRAGEM já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '66f5fb51b3d2c92419bd8d2320f33b7c632b03edf29a0b598686622e92e7b62f', now(),
        '20261117200000_medicao_forragem', NULL, NULL, now(), 1);
COMMIT;
```

O script pronto, com o `migration.sql` integral, fica fora do repositório, no
rascunho da sessão (`aplicar219.sql`); confira o SHA-256 do trecho da migration
antes de usar. Qualquer falha desfaz tudo. Confirme pelo §4 que a tabela não
existe e que não há linha nova, corrija a causa e peça novo GO.

**Ensaio local (2026-11-17, refeito depois do merge da #303):** o script acima, com o `migration.sql` integral, num
banco à parte com as 65 migrations da `main` (`prisma migrate deploy` de uma cópia
com as pastas até a `20261117100000_abastecimento_fk_apontamento_atividade`: 65 / 0): com o `system_identifier`
de produção recusou (`RELEASE_BLOCKED: alvo divergente`, nada aplicado, 65); com o
local, aplicou numa transação (65 → 66, checksum pinado, a tabela com RLS ligado, 96
tabelas em `public`); o `migrate diff --exit-code` contra o `schema.prisma` disse "No
difference detected." (exit 0) e a 2ª execução recusou (`RELEASE_BLOCKED: migration
já registrada`), sem linha nova.

## 4. Conferência — somente leitura

```sql
SELECT migration_name, checksum, rolled_back_at, applied_steps_count FROM _prisma_migrations
 WHERE migration_name = '20261117200000_medicao_forragem';  -- 1 linha, checksum pinado, null, 1
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) FROM _prisma_migrations;  -- 66, 0
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
 WHERE relname = 'MEDICAOFORRAGEM' AND relkind = 'r';          -- 1 linha, t, f
SELECT tablename, policyname FROM pg_policies WHERE tablename = 'MEDICAOFORRAGEM';  -- maike_backend_all
SELECT count(*) FROM information_schema.role_table_grants
 WHERE table_name = 'MEDICAOFORRAGEM' AND grantee IN ('anon', 'authenticated');  -- 0
SELECT conname FROM pg_constraint WHERE conrelid = 'public."MEDICAOFORRAGEM"'::regclass AND contype IN ('c', 'f')
 ORDER BY 1;                                                   -- 4 CHECKs e 4 FKs
SELECT count(*) FROM "MEDICAOFORRAGEM";                        -- 0
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 96
```

Mais: `get_advisors` (segurança) sem alerta novo.

## 5. Merge, deploy e smoke

1. Merge **logo depois** do §4. 2. Deploy READY na Vercel: `/api/native/health`
com o `release` da `main` nova. 3. Smoke: `/api/native/medicoes-forragem` sem
sessão → 401; como administrador, no Mapa Geral clicar num pasto → painel
**Forragem** com o botão **Medição de Forragem**; lançar pela régua
("22 26 24 20 28 25 23 27 24 21", amostra 0,25 m² / 450 g / 112,5 g → média 24,0 cm,
Descanso, 18.000 kg/ha verde, 25% MS, 4.500 kg MS/ha) e no olho ("Pronto"); conferir
a última medição no painel e excluir uma. Operador comum só lança com a chave do mapa
**"Lançar medição de forragem"** (Permissões → Mapa Geral → Pastos); não há concessão
automática.

## 6. Rollback

A tabela é nova e nenhuma tabela antiga a referencia. Reverter seria uma
migration nova com `DROP TABLE "MEDICAOFORRAGEM"` (CONTRACT, com GO próprio), nunca
editando esta. Com o código novo no ar, reverter o código primeiro.

## 7. Registro de execução

| Campo | Valor |
|---|---|
| Data/hora (UTC) | `<…>` |
| Caminho | `<A ou B>` |
| GO | `<texto do proprietário>` |
| Preflight (§2) | `<…>` |
| Postcheck (§4) | `<…>` |
| Resultado | `<…>` |
