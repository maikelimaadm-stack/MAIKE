# MAIKE — Peso objetivo na Categoria de Manejo: runbook de release expand-only (D-PROD-198)

> **Estado: NÃO EXECUTADO. `SCHEMA_APPLIED_PROD: NÃO`.**
>
> Este documento é o plano. Cada passo exige o GO do proprietário e para no
> primeiro desvio com **`RELEASE_BLOCKED`**. Valores entre `<…>` são preenchidos
> na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-198](./DECISIONS.md) · Relatório:
[`MAIKE-PESO-PROJETADO-REPORT.md`](./MAIKE-PESO-PROJETADO-REPORT.md).
Precedente executado: [`MAIKE-CADESTACOES-RUNBOOK-RELEASE.md`](./MAIKE-CADESTACOES-RUNBOOK-RELEASE.md) §7
(EXPAND, caminho B). Molde: [`MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md)
(§1 explica por que nunca `apply_migration` e nunca DDL solto).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261114400000_cadcategoria_peso_objetivo` |
| Natureza | **expand-only**: uma coluna anulável, sem DEFAULT, numa tabela antiga — `ALTER TABLE "CADCATEGORIA" ADD COLUMN "peso_objetivo_kg" DECIMAL(10,2)`. Nenhuma tabela nova, nenhum dado migrado, nenhum `UPDATE` |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `d44f80701c8936b62a8213f68fecb912a846c2a646f6cae79133964b653fb1a9` |
| `_prisma_migrations` | em 2026-11-14 (leitura das 17:2x UTC): **51** concluídas, 0 abertas (a última `20261114300000_tipo_atividade_defaults`, D-PROD-197); depois **52**. Recontar no §2 |
| Tabelas em `public` | **85** antes e depois |

**Por que antes do merge (D-PROD-72 item 1):** a Vercel publica a `main` sozinha.
O runtime novo lê `peso_objetivo_kg` em toda leitura de Categoria de Manejo e na
lista de posições do mapa (a projeção do peso): sem a coluna, as rotas
`/categorias-manejo` e `/rebanho/posicoes` respondem 500. O runtime antigo não
conhece a coluna e segue igual com o banco migrado — **não há janela**.

**Efeito durante a transação:** `ADD COLUMN` anulável sem DEFAULT só mexe no
catálogo: `ACCESS EXCLUSIVE` em `CADCATEGORIA` por um instante (10 linhas). Uma
espera além do `lock_timeout` de 5 s aborta tudo sem aplicar nada.

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
  FROM _prisma_migrations;                                     -- <N_OK>, 0
SELECT count(*) FROM information_schema.columns
 WHERE table_name = 'CADCATEGORIA' AND column_name = 'peso_objetivo_kg';  -- 0
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 85
```

E, localmente, no `<SHA_APROVADO>`: `sha256sum` do `migration.sql` igual ao
pinado, e `classificarMigrations` com `modo: EXPAND`,
`colunas_novas_em_tabelas_antigas = ["CADCATEGORIA.peso_objetivo_kg"]` e `violacoes: []`.

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
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261114400000_cadcategoria_peso_objetivo') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> <N_OK> OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'CADCATEGORIA' AND column_name = 'peso_objetivo_kg') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: coluna peso_objetivo_kg já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'd44f80701c8936b62a8213f68fecb912a846c2a646f6cae79133964b653fb1a9', now(),
        '20261114400000_cadcategoria_peso_objetivo', NULL, NULL, now(), 1);
COMMIT;
```

Qualquer falha desfaz tudo. Confirme pelo §4 que a coluna não existe e que não há
linha nova, corrija a causa e peça novo GO.

## 4. Conferência — somente leitura

```sql
SELECT migration_name, checksum, rolled_back_at, applied_steps_count FROM _prisma_migrations
 WHERE migration_name = '20261114400000_cadcategoria_peso_objetivo';  -- 1 linha, checksum pinado, null, 1
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) FROM _prisma_migrations;  -- <N_OK> + 1
SELECT data_type, numeric_precision, numeric_scale, is_nullable, column_default FROM information_schema.columns
 WHERE table_name = 'CADCATEGORIA' AND column_name = 'peso_objetivo_kg';  -- numeric, 10, 2, YES, null
SELECT count(*), count(peso_objetivo_kg) FROM "CADCATEGORIA";  -- <total>, 0
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 85
```

Mais: `get_advisors` (segurança) sem alerta novo.

## 5. Merge, deploy e smoke

1. Merge **logo depois** do §4. 2. Deploy READY na Vercel: `/api/native/health`
com o `release` da `main` nova. 3. Smoke: `/api/native/categorias-manejo` e
`/api/native/rebanho/posicoes` sem sessão → 401; na tela Manejo → Categorias de
Manejo, o campo "Peso objetivo (kg)" e a coluna; no mapa, os Detalhes do Lote
com o peso projetado na seção Pesagem.

## 6. Rollback

A coluna é nova e nada a exige. Reverter seria uma migration nova com
`ALTER TABLE "CADCATEGORIA" DROP COLUMN "peso_objetivo_kg"` (CONTRACT, com GO
próprio), nunca editando esta. Com o código novo no ar, reverter o código primeiro.

## 7. Registro de execução

_(vazio — preencher com data/hora UTC, caminho usado, GO citado, resultado do §4.)_
