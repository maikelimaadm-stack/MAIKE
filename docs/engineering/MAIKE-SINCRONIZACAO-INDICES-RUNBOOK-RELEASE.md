# MAIKE — Índices da sincronização incremental: runbook de release (D-PROD-315)

> **Estado: `SCHEMA_APPLIED_PROD: NÃO`.** Plano preparado e ensaiado só no PostgreSQL local.
>
> Este documento é o plano. Cada passo exige o GO do proprietário ("aplica") e para no primeiro desvio com
> **`RELEASE_BLOCKED`**. Valores entre `<…>` são preenchidos na hora, a partir de leituras reais, nunca copiados deste
> texto.

Decisão: [D-PROD-315](./DECISIONS.md) · Relatório: [`MAIKE-SINCRONIZACAO-INDICES-REPORT.md`](./MAIKE-SINCRONIZACAO-INDICES-REPORT.md) ·
Molde: [`MAIKE-UNIDADE-CONVERTIDA-LANCAMENTOS-RUNBOOK-RELEASE.md`](./MAIKE-UNIDADE-CONVERTIDA-LANCAMENTOS-RUNBOOK-RELEASE.md)
(D-PROD-310) e, para índices em tabela antiga, a `20261113300000_estoque_p1_03_indices` (Estoque P1-03).
**Esta release vem DEPOIS da unidade convertida** (`20261126200000_unidade_convertida_lancamentos`, aplicada em produção
em 2026-11-25): a guarda do §3 exige essa migration concluída com o checksum do repositório.

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261126300000_sincronizacao_incremental_indices` |
| Natureza | **expand-only** (sem `--contract`): **5 CREATE INDEX não-únicos**, tenant primeiro (R10), em 5 tabelas antigas — `Lote`, `PontoSuplementacao`, `LEITURACOCHO` e `SuplementacaoEvento` em `(cliente_id, "updatedAt", id)`; `AuditLog` em `(cliente_id, entidade, acao, "createdAt", id)`. Nenhuma tabela, coluna, constraint, dado, função, gatilho, RLS ou GRANT muda |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) = checksum do Prisma | `a1cdcd2f6f4b21499f5d1b1b5a905abeb1ef84e426d85c460bb03a8edb5ffc3c` |
| Bloco RLS | nenhum (nenhuma tabela nova) |
| Classificador | `modo: EXPAND`, `violacoes: []`, `tabelas_novas []`, `colunas_novas_em_tabelas_antigas []`, `contract: []` (teste B47a) |
| Preflight de schema do deploy (`COLUNAS_EXIGIDAS`) | não muda: o código funciona sem os índices (só fica mais lento com volume) |
| `_prisma_migrations` | esperado **81** concluídas, 0 abertas (a última `20261126200000_unidade_convertida_lancamentos`, D-PROD-310, checksum `3644b7fd9aef0362ecfb8584904aaee6c3844cd1ca981c9691c3db8a1ccbf169`); depois **82**. Recontar no §2 |
| Tabelas em `public` | iguais antes e depois (recontar no §2) |

**Ordem com o merge:** o código não depende dos índices. Eles só aceleram `GET /…/mudancas` (D-PROD-309). Aplicar antes ou
depois do merge dá o mesmo resultado. Mantém-se a prática de aplicar **antes** do merge, para a `main` nunca ter uma
migration que a produção não tem.

**Efeito durante a transação:** cada `CREATE INDEX` (sem `CONCURRENTLY`, que o classificador não aceita) toma `SHARE LOCK`
na tabela dele até o `COMMIT`. **Leituras seguem; escritas nas 5 tabelas esperam até o fim**, inclusive as do
`AuditLog`, que quase todo comando grava. Ou seja, todo lançamento espera durante a construção dos 5 índices. No volume
de hoje são frações de segundo (recontar no §2). A ordem é domínio primeiro e `AuditLog` por último, a mesma dos
comandos, para não formar ciclo de espera. Uma espera além do `lock_timeout` de 5 s aborta tudo sem aplicar nada.
**Aplicar fora do horário de lançamento.**

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** `node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>`, depois
  `--verificar-alvo` (1 pendente do manifesto) e `--aplicar` (EXPAND: **sem `--contract`**), com
  `MIGRATION_DATABASE_URL` direta ou sessão na 5432, `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360` e
  `DATABASE_URL` do mesmo banco.
- **B — conector Supabase, uma única `execute_sql` (§3):** só com autorização **escrita e específica do proprietário
  para esta migration** ("aplica"), registrada como desvio da D-PROD-74, como nas anteriores.

## 2. Preflight — somente leitura (projeto `uuemcasqcdjucflulkne`)

```sql
SELECT
  (SELECT system_identifier FROM pg_control_system())                                                 AS sid,         -- 7692130048193495360
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)  AS concluidas,  -- 81
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)   AS ruins,       -- 0
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261126200000_unidade_convertida_lancamentos'
     AND checksum = '3644b7fd9aef0362ecfb8584904aaee6c3844cd1ca981c9691c3db8a1ccbf169' AND finished_at IS NOT NULL
     AND rolled_back_at IS NULL)                                                                      AS anterior_ok, -- 1
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261126300000_sincronizacao_incremental_indices') AS registrada, -- 0
  (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
     'Lote_cliente_id_updatedAt_id_idx', 'PontoSuplementacao_cliente_id_updatedAt_id_idx',
     'LEITURACOCHO_cliente_id_updatedAt_id_idx', 'SuplementacaoEvento_cliente_id_updatedAt_id_idx',
     'AuditLog_cliente_id_entidade_acao_createdAt_id_idx'))                                           AS indices_ja_existem, -- 0
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public')                                        AS tabelas;     -- <n>
-- Volume (para estimar a construção): linhas e tamanho das 5 tabelas.
SELECT relname, n_live_tup, pg_size_pretty(pg_total_relation_size(relid)) FROM pg_stat_user_tables
 WHERE relname IN ('Lote', 'PontoSuplementacao', 'LEITURACOCHO', 'SuplementacaoEvento', 'AuditLog') ORDER BY relname;
```

## 3. Caminho B — uma transação

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SELECT pg_advisory_xact_lock(72707371);
DO $guarda$
DECLARE n_ok int; n_ruim int;
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7692130048193495360 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: alvo divergente';
  END IF;
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261126300000_sincronizacao_incremental_indices') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 81 OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261126200000_unidade_convertida_lancamentos'
                    AND checksum = '3644b7fd9aef0362ecfb8584904aaee6c3844cd1ca981c9691c3db8a1ccbf169'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (20261126200000_unidade_convertida_lancamentos) não está concluída com o checksum do repositório';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
       'Lote_cliente_id_updatedAt_id_idx', 'PontoSuplementacao_cliente_id_updatedAt_id_idx',
       'LEITURACOCHO_cliente_id_updatedAt_id_idx', 'SuplementacaoEvento_cliente_id_updatedAt_id_idx',
       'AuditLog_cliente_id_entidade_acao_createdAt_id_idx')) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: algum dos índices já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'a1cdcd2f6f4b21499f5d1b1b5a905abeb1ef84e426d85c460bb03a8edb5ffc3c', now(),
        '20261126300000_sincronizacao_incremental_indices', NULL, NULL, now(), 1);
COMMIT;
```

Confira o SHA-256 do trecho da migration antes de usar. Qualquer falha desfaz tudo.

**Ensaio local (2026-11-25, PostgreSQL 16 local, nunca produção):**
- `npm run deploy:migrate` no banco de teste (82 pastas): a nova aplicou sem erro.
- `prisma migrate diff` das migrations contra o `schema.prisma`: vazio.
- `sincronizacaoIncremental.test.mjs` passou, inclusive o MU-09, que prova pelo `EXPLAIN` que as 5 consultas usam os índices novos.
- `premerge-migrate.test.mjs` passou inteiro, com o B47a/b/c.
- As suítes de migration do backend passaram (relatório).

## 4. Conferência — somente leitura

```sql
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
  FROM _prisma_migrations;                                                                  -- 82, 0
SELECT checksum, applied_steps_count FROM _prisma_migrations
 WHERE migration_name = '20261126300000_sincronizacao_incremental_indices';                 -- a1cdcd2f…fc3c, 1
SELECT tablename, indexname, indexdef FROM pg_indexes
 WHERE schemaname = 'public' AND indexname IN (
   'Lote_cliente_id_updatedAt_id_idx', 'PontoSuplementacao_cliente_id_updatedAt_id_idx',
   'LEITURACOCHO_cliente_id_updatedAt_id_idx', 'SuplementacaoEvento_cliente_id_updatedAt_id_idx',
   'AuditLog_cliente_id_entidade_acao_createdAt_id_idx')
 ORDER BY indexname;                                                                         -- 5 linhas, nenhuma UNIQUE
SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
 WHERE c.relname IN ('Lote_cliente_id_updatedAt_id_idx', 'PontoSuplementacao_cliente_id_updatedAt_id_idx',
   'LEITURACOCHO_cliente_id_updatedAt_id_idx', 'SuplementacaoEvento_cliente_id_updatedAt_id_idx',
   'AuditLog_cliente_id_entidade_acao_createdAt_id_idx') AND i.indisvalid;                   -- 5 (todos válidos)
```

Depois: `get_advisors` (security e performance) sem alerta novo. O performance pode listar os índices como "não usados"
nos primeiros dias, o que é esperado.

## 5. Merge, deploy e smoke

1. Merge **logo depois** do §4.
2. Deploy READY na Vercel. O código não muda; só documentação, schema, migration e testes. Pela D-PROD-275, a Vercel nem
   faz build se nada mudou fora de `docs/` e de `tests/`. O `schema.prisma` muda, então o build roda.
3. Smoke:
   - abrir o app com internet;
   - "Sincronizar agora" termina sem erro;
   - lotes, cochos e lançamentos continuam iguais;
   - os logs da Vercel não mostram 500 em `/…/mudancas`.

## 6. Rollback

Índice não muda dado. Reverter seria uma migration nova (`DROP INDEX`, com GO próprio), nunca editando esta. Sem os
índices, as consultas voltam a ser como hoje: corretas, só mais lentas com volume.

## 7. Registro

| Data | Quem | O quê |
|---|---|---|
| 2026-11-25 | Claude (sessão D-PROD-315) | plano preparado; migration aplicada e testada só no PostgreSQL local |
| 2026-11-25 | Claude (sessão D-PROD-315), só leitura | preflight do §2 em produção: `sid` 7692130048193495360, 81 concluídas e 0 ruins, a anterior com `3644b7fd…f169`, esta não registrada, nenhum dos 5 índices existe, 112 tabelas. Volume: `AuditLog` 1.303 linhas (5,9 MB), `Lote` 84, `SuplementacaoEvento` 5, `LEITURACOCHO` 2 e `PontoSuplementacao` 2. A construção leva milissegundos |
