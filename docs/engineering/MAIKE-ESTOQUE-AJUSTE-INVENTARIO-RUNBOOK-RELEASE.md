# MAIKE — Estoque, ajuste de inventário: runbook de release expand-only (D-PROD-265)

> **Estado: PENDENTE.** `SCHEMA_APPLIED_PROD: NÃO`. Registro no §7.
>
> Este documento é o plano. Cada passo exige o GO do proprietário e para no primeiro desvio com
> **`RELEASE_BLOCKED`**. Valores entre `<…>` são preenchidos na hora, a partir de leituras reais.

Decisão: [D-PROD-265](./DECISIONS.md) · Relatório: [`MAIKE-ESTOQUE-AJUSTE-INVENTARIO-REPORT.md`](./MAIKE-ESTOQUE-AJUSTE-INVENTARIO-REPORT.md).
Molde e precedente executado: [`MAIKE-ESTOQUE-SAIDA-MANUAL-RUNBOOK-RELEASE.md`](./MAIKE-ESTOQUE-SAIDA-MANUAL-RUNBOOK-RELEASE.md)
(a anterior, EXPAND, caminho B, aplicada em 2026-11-20 01:15:39 UTC).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261120200000_estoque_ajustes` |
| Natureza | **expand-only**: 3 tabelas NOVAS — `AjusteEstoque`, `AjusteEstoqueItem`, `AjusteEstoqueEvento` — com índices e uniques começando por `cliente_id`, FKs compostas pelo tenant (Cliente, Empresa, CentroCusto, CentroResultado, Produto, LocalEstoque, EstoqueLoteNota e MovimentacaoEstoque), todas `RESTRICT`, 6 CHECKs e o bloco RLS/REVOKE delas. Nenhuma tabela existente é alterada; nenhum dado migrado ou semeado |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `ac836ddf1b4830c4cd73ca1894e9925a77a8ea6c2bda735ad1859c830f26ccc9` |
| Bloco RLS (`DO_RLS_APROVADOS`) | `4825a207a444b5b3bff8ac669e4e6e4a4db95d5aebd68986125bc8db00094fb8` (mesmo corpo de sempre, lista nova) |
| `_prisma_migrations` | esperado **71** concluídas, 0 abertas (a última `20261120100000_estoque_saidas`, D-PROD-264, checksum `3cc70cddeb743261344ea1641f2e81e6294ed31d077fbef812f55444888114e0`); depois **72**. Recontar no §2 |
| Tabelas em `public` | **105** antes, **108** depois |

**Por que antes do merge (D-PROD-72 item 1):** a Vercel publica a `main` sozinha. Sem as tabelas, o tipo Ajuste do
"Novo movimento" responde 500 (o resto do Estoque segue de pé). O runtime antigo não conhece as tabelas e segue
igual com o banco migrado — **não há janela**.

**Efeito durante a transação:** `CREATE TABLE` e as FKs pedem trava `SHARE ROW EXCLUSIVE` por um instante nas
tabelas referenciadas: leituras seguem, escritas nelas esperam o fim da transação (milissegundos; as tabelas nascem
vazias). Uma espera além do `lock_timeout` de 5 s aborta tudo sem aplicar nada.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** `node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>`
  (depois `--verificar-alvo` e `--aplicar`), numa máquina protegida (EXPAND: sem `--contract`).
- **B — conector Supabase, uma única `execute_sql` (§3):** só com autorização **escrita e específica do
  proprietário para esta migration**, como nas anteriores.

## 2. Preflight — somente leitura (projeto `uuemcasqcdjucflulkne`)

```sql
SELECT
  (SELECT system_identifier FROM pg_control_system())::text                                           AS sid,         -- 7692130048193495360
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)  AS concluidas,  -- 71
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)   AS ruins,       -- 0
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261120100000_estoque_saidas'
     AND checksum = '3cc70cddeb743261344ea1641f2e81e6294ed31d077fbef812f55444888114e0' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS anterior_ok, -- 1
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261120200000_estoque_ajustes')   AS registrada,  -- 0
  (to_regclass('public."AjusteEstoque"') IS NULL AND to_regclass('public."AjusteEstoqueItem"') IS NULL
    AND to_regclass('public."AjusteEstoqueEvento"') IS NULL)                                          AS ausentes,    -- true
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public')                                        AS tabelas;     -- 105
```

## 3. Caminho B — uma transação

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(72707369);
DO $guarda$
DECLARE n_ok int; n_ruim int;
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7692130048193495360 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: alvo divergente';
  END IF;
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261120200000_estoque_ajustes') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 71 OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261120100000_estoque_saidas'
                    AND checksum = '3cc70cddeb743261344ea1641f2e81e6294ed31d077fbef812f55444888114e0'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (20261120100000_estoque_saidas) não está concluída com o checksum do repositório';
  END IF;
  IF to_regclass('public."AjusteEstoque"') IS NOT NULL OR to_regclass('public."AjusteEstoqueItem"') IS NOT NULL
     OR to_regclass('public."AjusteEstoqueEvento"') IS NOT NULL THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: uma das tabelas do ajuste de inventário já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'ac836ddf1b4830c4cd73ca1894e9925a77a8ea6c2bda735ad1859c830f26ccc9', now(),
        '20261120200000_estoque_ajustes', NULL, NULL, now(), 1);
COMMIT;
```

O script pronto, com o `migration.sql` integral, fica fora do repositório, no rascunho da sessão; confira o SHA-256
do trecho da migration antes de usar. Qualquer falha desfaz tudo.

**Ensaio local:** registrado no relatório §5.

## 4. Conferência — somente leitura

| Conferência | Esperado |
|---|---|
| `_prisma_migrations` concluídas / falhadas | 72 / 0; a `20261120200000_estoque_ajustes` com o checksum do §0 e 1 passo |
| tabelas em `public` | 108 |
| as 3 tabelas novas | RLS ligado sem FORCE; política `maike_backend_all` só para `maike_vercel`; sem GRANT para `anon`/`authenticated`; 0 linhas |
| constraints (CHECKs/FKs) | `AjusteEstoque` 2/4; `AjusteEstoqueItem` 3/7; `AjusteEstoqueEvento` 1/2 |
| `get_advisors` (security) | nenhum alerta novo |

## 5. Merge, deploy e smoke

1. Merge **logo depois** do §4. 2. Deploy READY na Vercel. 3. Smoke: `/api/native/estoque/ajustes` sem sessão → 401;
como administrador, Estoque → Movimentos → **Novo movimento** → Ajuste: escolher um produto com saldo, conferir o
"Saldo atual", contar um a menos, lançar e conferir a falta no Kardex; excluir o ajuste (o saldo volta). Nenhum
perfil recebe a ação `ajuste` por padrão.

## 6. Rollback

As tabelas são novas e nenhuma tabela antiga as referencia. Reverter seria uma migration nova com `DROP TABLE`
(CONTRACT, com GO próprio), nunca editando esta. Com o código novo no ar, reverter o código primeiro.

## 7. Registro de execução

| Campo | Valor |
|---|---|
| Data/hora (UTC) | — |
| Caminho | — |
| GO | — |
| Preflight (§2) | — |
| Postcheck (§4) | — |
| Resultado | **PENDENTE** |
