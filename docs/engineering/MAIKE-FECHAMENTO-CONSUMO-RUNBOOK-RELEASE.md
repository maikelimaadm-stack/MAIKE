# MAIKE — Fechamento do consumo: runbook de release expand-only (D-PROD-206)

> **Estado: PENDENTE.** `SCHEMA_APPLIED_PROD: NÃO`. Aplicar antes do merge (D-PROD-72), com o GO do proprietário.
>
> Este documento é o plano. Cada passo exige o GO do proprietário e para no
> primeiro desvio com **`RELEASE_BLOCKED`**. Valores entre `<…>` são preenchidos
> na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-206](./DECISIONS.md) · Relatório:
[`MAIKE-FECHAMENTO-CONSUMO-REPORT.md`](./MAIKE-FECHAMENTO-CONSUMO-REPORT.md).
Precedente executado: [`MAIKE-LEITURA-COCHO-RUNBOOK-RELEASE.md`](./MAIKE-LEITURA-COCHO-RUNBOOK-RELEASE.md) §7
(EXPAND, caminho B). Molde de coluna anulável em tabela antiga:
[`MAIKE-PESO-PROJETADO-RUNBOOK-RELEASE.md`](./MAIKE-PESO-PROJETADO-RUNBOOK-RELEASE.md) (D-PROD-198).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261115200000_formulacao_faixa_tolerancia` |
| Natureza | **expand-only**: 1 coluna ANULÁVEL, sem DEFAULT e sem CHECK, numa tabela antiga — `CADFORMULACAO.faixa_tolerancia_percentual DECIMAL(5,2)`. Nenhuma tabela nova, nenhum dado migrado, nenhum `UPDATE`; as formulações que já existem ficam com o campo vazio (= 15%) |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `bb8be379c241341e1ba45a7d7da8258aef77d5f4e089db302c8d655608d58e4c` |
| Bloco RLS | nenhum (a tabela já tem RLS desde a D-PROD-203) |
| `_prisma_migrations` | esperado **56** concluídas, 0 abertas (a última `20261115100000_leitura_cocho`, D-PROD-205); depois **57**. Recontar no §2 |
| Tabelas em `public` | **91** antes e depois |

**Por que antes do merge (D-PROD-72 item 1):** a Vercel publica a `main` sozinha.
O runtime novo lê e grava a coluna em `/formulacoes` (listar, detalhe, opções do
lançamento, criar, editar): sem a migration, a tela Formulações e o lançamento do
cocho respondem 500. O runtime antigo não conhece a coluna e segue igual com o
banco migrado — **não há janela**.

**Efeito durante a transação:** `ALTER TABLE … ADD COLUMN` anulável sem DEFAULT só
mexe no catálogo, mas pede trava `ACCESS EXCLUSIVE` em `CADFORMULACAO` por um
instante (leituras e escritas nela esperam o fim da transação, em milissegundos).
Uma espera além do `lock_timeout` de 5 s aborta tudo sem aplicar nada.

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
  FROM _prisma_migrations;                                     -- 56, 0
SELECT migration_name FROM _prisma_migrations
 WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
 ORDER BY finished_at DESC LIMIT 1;                            -- 20261115100000_leitura_cocho
SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'CADFORMULACAO'
   AND column_name = 'faixa_tolerancia_percentual';            -- nenhuma linha
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 91
```

E, localmente, no `<SHA_APROVADO>`: `sha256sum` do `migration.sql` igual ao
pinado, e `classificarMigrations` com `modo: EXPAND`, `tabelas_novas = []`,
`colunas_novas_em_tabelas_antigas = ["CADFORMULACAO.faixa_tolerancia_percentual"]`
e `violacoes: []` (teste B25a).

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
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261115200000_formulacao_faixa_tolerancia') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 56 OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF to_regclass('public."CADFORMULACAO"') IS NULL THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: tabela CADFORMULACAO ausente';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'CADFORMULACAO' AND column_name = 'faixa_tolerancia_percentual') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: coluna faixa_tolerancia_percentual já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'bb8be379c241341e1ba45a7d7da8258aef77d5f4e089db302c8d655608d58e4c', now(),
        '20261115200000_formulacao_faixa_tolerancia', NULL, NULL, now(), 1);
COMMIT;
```

O script pronto, com o `migration.sql` integral, fica fora do repositório, no
rascunho da sessão (`aplicar206.sql`); confira o SHA-256 do trecho da migration
antes de usar (o trecho entre a guarda e o `INSERT` dá
`bb8be379c241341e1ba45a7d7da8258aef77d5f4e089db302c8d655608d58e4c`). Qualquer
falha desfaz tudo. Confirme pelo §4 que a coluna não existe e que não há linha
nova, corrija a causa e peça novo GO.

**Ensaio local (2026-11-15):** o script acima, com o `migration.sql` integral,
num banco à parte com as 56 migrations da `main`: com o `system_identifier` de
produção recusou (`RELEASE_BLOCKED: alvo divergente`); com o local, aplicou numa
transação (56 → 57 / 0, checksum pinado, `applied_steps_count` 1, a coluna
`numeric(5,2)` anulável e sem DEFAULT, 91 tabelas em `public`), o
`prisma migrate status` disse "Database schema is up to date!", o `migrate diff`
contra o `schema.prisma` saiu vazio e a 2ª execução recusou
(`RELEASE_BLOCKED: migration já registrada`), sem linha nova.

## 4. Conferência — somente leitura

```sql
SELECT migration_name, checksum, rolled_back_at, applied_steps_count FROM _prisma_migrations
 WHERE migration_name = '20261115200000_formulacao_faixa_tolerancia';  -- 1 linha, checksum pinado, null, 1
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) FROM _prisma_migrations;  -- 57, 0
SELECT data_type, numeric_precision, numeric_scale, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'CADFORMULACAO'
   AND column_name = 'faixa_tolerancia_percentual';            -- numeric, 5, 2, YES, null
SELECT count(*) FILTER (WHERE faixa_tolerancia_percentual IS NOT NULL) FROM "CADFORMULACAO";  -- 0
SELECT relrowsecurity FROM pg_class WHERE relname = 'CADFORMULACAO' AND relkind = 'r';     -- t
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 91
```

Mais: `get_advisors` (segurança) sem alerta novo.

## 5. Merge, deploy e smoke

1. Merge **logo depois** do §4. 2. Deploy READY na Vercel: `/api/native/health`
com o `release` da `main` nova. 3. Smoke: `/api/native/formulacoes` sem sessão
→ 401; na tela Formulações, abrir uma formulação e ver "Faixa de tolerância (%)"
vazia (placeholder 15); no mapa, abastecer um cocho com período aberto e ver a
prévia do farol; depois do abastecimento, o cartão "Último período fechado" no
detalhe do cocho.

## 6. Rollback

A coluna é nova e anulável; o runtime antigo não a lê. Reverter seria uma
migration nova com `DROP COLUMN` (CONTRACT, com GO próprio), nunca editando esta.
Com o código novo no ar, reverter o código primeiro. Os campos gravados nos
eventos (JSON) não dependem da coluna e podem ficar.

## 7. Registro de execução

| Campo | Valor |
|---|---|
| Data/hora (UTC) | `<preencher: finished_at da linha em _prisma_migrations>` |
| Caminho | `<A ou B>` |
| GO | `<texto do GO do proprietário>` |
| Preflight (§2) | `<system_identifier; 56 / 0; coluna ausente>` |
| Ensaio | Banco local com as 56 migrations da `main`: aplicou (57 / 0, 91 tabelas, `migrate status` em dia, `migrate diff` vazio); reexecução recusada (`migration já registrada`); alvo divergente recusado |
| Postcheck (§4) | `<57 / 0; checksum; tipo da coluna; 91 tabelas>` |
| Resultado | **PENDENTE** |
