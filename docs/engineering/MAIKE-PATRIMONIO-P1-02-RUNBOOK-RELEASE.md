# MAIKE — Patrimônio P1-02: runbook de release expand-only (D-PROD-159)

> **Estado: NÃO EXECUTADO. `SCHEMA_APPLIED_PRODUCTION: NÃO`.** Nada deste runbook foi
> rodado contra o Supabase ou a Vercel; nenhum DDL remoto foi executado. A PR está em
> **DRAFT**. O runbook só pode começar com **GO expresso e escrito do proprietário** que
> cite esta migration, o alvo, o caminho (A ou B) e o `<SHA_APROVADO>` (HEAD da PR com
> CI verde).
>
> Valores entre `<…>` são preenchidos na hora da execução, sempre a partir de leituras
> reais. Os valores do fechamento da missão (HEAD e CI) estão na PR #235.

Decisão: [D-PROD-159](./DECISIONS.md). Relatório:
[`MAIKE-PATRIMONIO-P1-02-ABASTECIMENTOS-REPORT.md`](./MAIKE-PATRIMONIO-P1-02-ABASTECIMENTOS-REPORT.md).
Modelo: [runbook da P1-01](./MAIKE-PATRIMONIO-P1-01-RUNBOOK-RELEASE.md) (migration aplicada em
2026-11-09 às 23:04:22 UTC) e [runbook da P3-03](./MAIKE-GESTAO-P3-03-RUNBOOK-RELEASE.md).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261110200000_patrimonio_p1_02_abastecimentos` |
| Natureza | expand-only. **3 tabelas novas** (`ConversaoCombustivelProduto`, `AbastecimentoBem`, `AbastecimentoBemConsumoLote`), com 17 FKs (todas `ON UPDATE CASCADE ON DELETE RESTRICT`, todas com `cliente_id`), 13 CHECKs, 3 PKs, 25 índices no total e um bloco DO de REVOKE/RLS. Nenhuma coluna, índice ou constraint em tabela antiga; nenhum dado migrado; nenhum seed |
| Tabelas antigas referenciadas (FK) | `Cliente` (3), `Usuario` (4), `Empresa`, `BemPatrimonial`, `TanqueBem`, `TipoCombustivelProduto`, `LocalEstoque`, `MovimentacaoEstoque` (2), `EstoqueLoteNota` |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `20f8f9609a8e09f123dac0ed7ba87747069b26ad07411e843481ffec59b15fba` |
| Hash do DO pinado (`DO_RLS_APROVADOS`) | `ac1d201b0ef75b629d018b8c3c98354eb9453d752ab5e62ee4c3edb23c14bddd` |
| Classificador | `expand: true`; `tabelas_novas`: as 3 acima; `colunas_novas_em_tabelas_antigas: []`; 0 violações |
| `_prisma_migrations` | antes **38** concluídas (inclui `20261109300000_gestao_p3_03_editar_excluir`, checksum `3f3af00e…df890b`, e `20261110100000_patrimonio_p1_01_cadastros`, checksum `b8818ba8…ffd64dc`, que é a última pelo nome); depois **39** |
| Tabelas em `public` | antes **82** (81 de domínio + `_prisma_migrations`); depois **85** |

**Por que a migration vem antes do merge:** a Vercel publica a `main` sozinha. Sem as
tabelas novas, o runtime novo responde 500 (P2021) nas 15 rotas de Abastecimentos **e em
rotas antigas** que passam a consultá-las:
- `GET /bens-patrimoniais/:id` e `PATCH /bens-patrimoniais/:id` de bem com contador (piso operacional do medidor, X2);
- `PATCH /estoque-lotes-nota/:id` (fora do nome do local) e `DELETE /estoque-lotes-nota/:id` (X1);
- `DELETE /empresas/:id` (contagem de vínculos por model).

O runtime antigo (`main` com P1-01 e P3-03) não conhece as tabelas novas e continua
funcionando com o banco migrado.

**Efeito durante a transação:** `ADD FOREIGN KEY` toma `SHARE ROW EXCLUSIVE` em `Cliente`,
`Usuario`, `Empresa`, `BemPatrimonial`, `TanqueBem`, `TipoCombustivelProduto`,
`MovimentacaoEstoque`, `EstoqueLoteNota` e `LocalEstoque` até o `COMMIT` (no ensaio local,
sobre um banco com as 38 migrations e sem carga, a transação levou ~76 ms). Escritas nessas
tabelas esperam; leituras não. **O teto de espera depende do caminho:**
- **Caminho B:** o `SET LOCAL lock_timeout = '5s'` do §5 aborta tudo, sem aplicar nada, se
  houver transação longa no caminho.
- **Caminho A:** o runner (`premerge-migrate` → `deploy:migrate` → `prisma migrate deploy`)
  **não** define `lock_timeout`. Sem ele, a migration espera **sem limite** e, enquanto
  espera, já segura `SHARE ROW EXCLUSIVE` nas tabelas que alcançou antes (no ensaio:
  `Cliente`, `Usuario`, `Empresa` e `TipoCombustivelProduto`), bloqueando as escritas nelas.
  Por isso o caminho A **exige** `&options=-c%20lock_timeout%3D5s` na
  `MIGRATION_DATABASE_URL` (§1). Com ele, uma trava no caminho faz o deploy sair 1
  (`P3018`, `55P03 canceling statement due to lock timeout`) sem DDL aplicado, mas deixa a
  linha da P1-02 em `_prisma_migrations` com `finished_at` NULL: a recuperação está no §5.1.

## 1. Caminho

- **Padrão (D-PROD-74):** runner oficial `premerge-migrate.mjs --sha <SHA_APROVADO>`,
  primeiro com `--verificar-alvo` e depois com `--aplicar`, numa máquina protegida do
  operador, com `MIGRATION_DATABASE_URL` direta ou de sessão (porta 5432, nunca o pooler
  6543) **terminada em `&options=-c%20lock_timeout%3D5s`** (ou `?options=…` se a URL não
  tiver outro parâmetro) e `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360`.
  Repita a consulta de transações longas do §4.2 logo antes do `--aplicar` e pare se
  aparecer alguma.
- **Caminho B (conector Supabase, uma transação):** só com GO escrito que cite esta
  migration, este alvo e o desvio da D-PROD-74 (caminho usado na P3-01, P3-02, P3-03 e P1-01).

## 2. Pré-requisitos do GO

1. `main` com a P1-01 aplicada e mergeada: **38 migrations** no repositório e em produção, 0 com falha.
2. PR da P1-02 revisada pelo proprietário e CI `verify:all` verde no `<SHA_APROVADO>` (40 hex) — o run tem de ser o do `<SHA_APROVADO>` (no fechamento da missão: run 42761888698 em `6dd34014`; conferir o do HEAD aprovado).
3. GO expresso e escrito: esta migration, este alvo, caminho A ou B, ciência da janela.
4. Backup comprovado (§4.4).
5. Nenhuma outra migration na janela e **nenhuma escrita de teste na Preview** (a Preview usa o banco de produção).

## 3. Ordem

GO → preflight só leitura (§4) → ensaio local com o arquivo do SHA (§4.6) → migration (§5)
→ postcheck (§6) → registro (§11) → merge manual → deploy → smoke (§8) → concessão de
permissões pelo proprietário.

## 4. Preflight (somente leitura)

Nenhum comando desta seção escreve. Rodar com um papel de leitura ou, no conector, só `SELECT`.

### 4.1 Alvo
```sql
SELECT system_identifier FROM pg_control_system();   -- 7692130048193495360
SHOW server_version;                                  -- 17.x
```
As variáveis de banco do projeto Vercel `maike` precisam vir da integração Supabase deste
projeto (conferir só os **nomes**, nunca os valores).

### 4.2 Histórico e estado
```sql
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)   AS com_falha
  FROM _prisma_migrations;                                          -- 38 | 0
SELECT migration_name, checksum, finished_at FROM _prisma_migrations
 WHERE migration_name IN ('20261109300000_gestao_p3_03_editar_excluir',
                          '20261110100000_patrimonio_p1_01_cadastros',
                          '20261110200000_patrimonio_p1_02_abastecimentos');
-- esperado: P3-03 (3f3af00e…df890b) e P1-01 (b8818ba8…ffd64dc) concluídas; P1-02 AUSENTE
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('ConversaoCombustivelProduto','AbastecimentoBem','AbastecimentoBemConsumoLote');  -- 0 linhas
SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind IN ('r','p');            -- 82
SELECT pid, state, now() - xact_start AS idade, left(query, 80) AS consulta
  FROM pg_stat_activity
 WHERE datname = current_database() AND xact_start IS NOT NULL
   AND now() - xact_start > interval '30 seconds';                 -- nenhuma transação longa
```
- `conferirHistoricoRemoto` (38 linhas × arquivos do SHA) deve dar `ok: true`,
  `pendentes: [20261110200000_patrimonio_p1_02_abastecimentos]` e 0 falhas.
- Recontar a `main` no GO; se ela tiver ganhado migration, o número esperado muda pela
  recontagem (e o §5 e o §9.1 também).
- Anote as contagens de `Cliente`, `Usuario`, `Empresa`, `BemPatrimonial`, `TanqueBem`,
  `TipoCombustivelProduto`, `LocalEstoque`, `MovimentacaoEstoque` e `EstoqueLoteNota`
  (`SELECT count(*) FROM "<tabela>"`).
- **Impressão digital das tabelas antigas** (base do §6 item 10): rode a consulta abaixo
  (uma instrução, só leitura, sem metacomando do psql, então o conector também roda) e
  anote as 7 linhas (`TOTAL`, `coluna`, `constraint`, `fk_entrando`, `indice`, `politica`,
  `tabela`). O valor **de produção** é a referência. O do ensaio local não serve, porque a
  impressão inclui as ACLs (`relacl`) e as do Supabase são outras: no PG17 local deu
  `TOTAL|2223|f4b51b600e72ea43a44e14220a4a044a`, antes e depois da P1-02.

```sql
-- Impressão digital das tabelas ANTIGAS de public (só leitura; uma instrução).
-- Exclui as 3 tabelas da P1-02 e as FKs que saem delas. Saída: categoria | n | md5 (e TOTAL).
WITH novas(t) AS (VALUES ('AbastecimentoBem'), ('AbastecimentoBemConsumoLote'), ('ConversaoCombustivelProduto')),
tab AS (
  SELECT c.oid, c.relname::text AS t, c.relrowsecurity AS rls, c.relforcerowsecurity AS force, coalesce(c.relacl::text, '') AS acl
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND c.relname NOT IN (SELECT t FROM novas)
),
linhas AS (
  SELECT 'tabela' AS cat, t || '|rls=' || rls || '|force=' || force || '|acl=' || acl AS l FROM tab
  UNION ALL
  SELECT 'coluna', t.t || '.' || a.attname::text || '|' || a.attnum || '|' || format_type(a.atttypid, a.atttypmod) || '|nn=' || a.attnotnull
         || '|def=' || coalesce(pg_get_expr(d.adbin, d.adrelid), '') || '|coll=' || coalesce(co.collname::text, '')
    FROM tab t JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
    LEFT JOIN pg_collation co ON co.oid = a.attcollation AND a.attcollation <> 0
  UNION ALL
  SELECT 'constraint', t.t || '|' || k.conname::text || '|' || k.contype::text || '|' || pg_get_constraintdef(k.oid, true)
    FROM tab t JOIN pg_constraint k ON k.conrelid = t.oid
  UNION ALL
  SELECT 'indice', t.t || '|' || i.relname::text || '|' || pg_get_indexdef(i.oid)
    FROM tab t JOIN pg_index x ON x.indrelid = t.oid JOIN pg_class i ON i.oid = x.indexrelid
  UNION ALL
  SELECT 'politica', p.tablename::text || '|' || p.policyname::text || '|' || p.cmd || '|' || array_to_string(p.roles, ',') || '|' || coalesce(p.qual, '') || '|' || coalesce(p.with_check, '')
    FROM pg_policies p JOIN tab t ON t.t = p.tablename::text WHERE p.schemaname = 'public'
  UNION ALL
  SELECT 'gatilho', t.t || '|' || g.tgname::text || '|' || pg_get_triggerdef(g.oid)
    FROM tab t JOIN pg_trigger g ON g.tgrelid = t.oid AND NOT g.tgisinternal
  UNION ALL
  SELECT 'fk_entrando', t.t || '<-' || k.conrelid::regclass::text || '|' || k.conname::text
    FROM tab t JOIN pg_constraint k ON k.confrelid = t.oid AND k.contype = 'f'
    JOIN pg_class o ON o.oid = k.conrelid
   WHERE o.relname NOT IN (SELECT t FROM novas)
)
SELECT categoria, n, md5 FROM (
  SELECT cat AS categoria, count(*) AS n, md5(string_agg(l, E'\n' ORDER BY l COLLATE "C")) AS md5 FROM linhas GROUP BY cat
  UNION ALL
  SELECT 'TOTAL', count(*), md5(string_agg(cat || ':' || l, E'\n' ORDER BY cat COLLATE "C", l COLLATE "C")) FROM linhas
) r
ORDER BY categoria COLLATE "C";
```
No PG17 local essa consulta dá exatamente as linhas da impressão do ensaio (variante
"antigas" do `fingerprint.sql`), e as 7 linhas ficam iguais de 38 para 39.

### 4.3 Checksum
`git show <SHA_APROVADO>:backend/prisma/migrations/20261110200000_patrimonio_p1_02_abastecimentos/migration.sql | sha256sum`
deve ser igual ao valor de `MIGRATIONS_APROVADAS` (`20f8f960…5fba`). O valor gravado em
`_prisma_migrations` é o calculado aqui.

### 4.4 Backup
Vale uma destas provas: a API de gestão do Supabase
(`GET /v1/projects/uuemcasqcdjucflulkne/database/backups`, com o token do proprietário), o
painel do Supabase ou um dump lógico do proprietário. Exige último backup `COMPLETED`
anterior à janela. Sem prova → `RELEASE_BLOCKED`.

### 4.5 Classificador
`node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>` (análise local, sem
credenciais, árvore limpa) deve sair 0, com `migrations_novas` = só a P1-02, `expand: true`,
3 tabelas novas, nenhuma coluna em tabela antiga e 0 violações.

### 4.6 Ensaio local imediato
Com o arquivo do SHA, num PostgreSQL **17** local que tenha os papéis `anon`,
`authenticated` e `maike_vercel`, a partir de um banco com as 38 migrations da `main`:
- o SQL do §5 com o identificador de produção é recusado (`alvo divergente`);
- com o identificador local, ele aplica até o `COMMIT`, e `prisma migrate diff --exit-code` dá 0;
- repetir a transação é recusado (`migration já registrada`);
- o rollback do §9.1 **sem** modo de ensaio é recusado no cluster local (`alvo divergente`);
  com `PGOPTIONS='-c maike.rollback_p102_ensaio_alvo=<system_identifier local>'` ele faz
  o `COMMIT` e volta a 38. O texto do SQL é o mesmo de produção: nada é editado para ensaiar.

**Ensaio feito na missão (2026-11-10)**, PostgreSQL 17.11 local descartável, papéis `anon`,
`authenticated`, `service_role` e `maike_vercel`, com o default do Supabase simulado
(`GRANT ALL ON TABLES TO anon, authenticated, service_role`):
- banco vazio → 39 migrations; 2ª execução "No pending migrations to apply"; 85 tabelas, nenhuma sem RLS, nenhuma com FORCE; 0 privilégios para `anon`/`authenticated`/`PUBLIC`; checksum `20f8f960…5fba`, `applied_steps_count = 1`; `migrate diff --exit-code` 0;
- **upgrade** de um banco com as 38 da `main` (82 tabelas) pelo runner `--verificar-alvo` ("ALVO VERIFICADO — 1 pendente") e `--aplicar`: 39/0, 85 tabelas; histórico 38 → 39 só com a P1-02; impressão digital das 82 tabelas antigas (colunas, constraints, índices, políticas, gatilhos, RLS/ACL, FKs entrando) **idêntica** antes e depois (`TOTAL|2223|129448571f9f2c161c27979033c53721`);
- default hostil (re-`GRANT ALL` depois das 38): privilégios nas 3 = 0 (o REVOKE do DO funciona);
- rollback do §9.1: com 1 linha em `ConversaoCombustivelProduto` → recusado, nada alterado; vazio → `COMMIT`, 38/0, 82 tabelas, impressão = a de 38; repetir → recusado; reaplicar → 39 de novo.
- **Re-ensaio do rollback com a guarda de alvo embutida** (revisão final, PG17.11, cluster
  `7706296865171723100`): sem modo de ensaio → `alvo divergente (system_identifier 7706296865171723100, esperado 7692130048193495360)`, nada alterado (39/0);
  modo de ensaio nomeando outro cluster (o id de produção, ou `123`) → recusado; cópia com
  o id local no lugar do de produção (simula o alvo certo, termina em `ROLLBACK`): com o modo
  de ensaio ligado → `modo de ensaio ligado no alvo de PRODUÇÃO`, recusado; sem ele → a
  guarda passa e o resto roda até o fim; modo de ensaio + 1 linha → recusado pela guarda de
  vazio; modo de ensaio com o id local → `COMMIT`, 38/0, 82 tabelas, impressão **idêntica**
  à de 38 (md5 por categoria, TOTAL e linhas brutas); repetir → recusado; reaplicar → 39.

**Repetir no GO** com o arquivo do SHA aprovado e o SQL do §5 (inclusive a guarda de alvo).

## 5. Aplicação (uma transação) — só com GO expresso

### Caminho A
```bash
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar
```

### Caminho B (conector, uma chamada `execute_sql`, só com GO escrito específico)

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(72707369);  -- a mesma trava do prisma migrate (D-PROD-75)
DO $guarda$
DECLARE n_ok int; n_ruim int;
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7692130048193495360 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: alvo divergente';
  END IF;
  IF EXISTS (SELECT 1 FROM _prisma_migrations
              WHERE migration_name = '20261110200000_patrimonio_p1_02_abastecimentos') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 38 OR n_ruim <> 0 THEN   -- 38 = recontagem do §4.2
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261110100000_patrimonio_p1_01_cadastros'
                    AND checksum = 'b8818ba8f16528580b7ba6053b0c89f07f0d4fd434955f4b9c5830a62ffd64dc'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: P1-01 ausente ou com checksum divergente';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261109300000_gestao_p3_03_editar_excluir'
                    AND checksum = '3f3af00edaffcce8ab0b64336029a93341bfbaba26c847e32e1d2658e4df890b'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: P3-03 ausente ou com checksum divergente';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
              WHERE ns.nspname = 'public'
                AND c.relname IN ('ConversaoCombustivelProduto', 'AbastecimentoBem', 'AbastecimentoBemConsumoLote')) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: tabela da P1-02 já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '<SHA256_CALCULADO_NO_4.3>', now(),
        '20261110200000_patrimonio_p1_02_abastecimentos', NULL, NULL, now(), 1);
COMMIT;
```

- O `migration.sql` não tem `BEGIN`/`COMMIT` próprios (o único `BEGIN` é o do bloco `DO`)
  e não tem `DELETE`, `TRUNCATE`, `UPDATE` nem `INSERT` de dado. O único `DROP` é
  `DROP POLICY IF EXISTS` nas tabelas novas.
- **Caminho B:** qualquer falha desfaz tudo (é uma transação só, inclusive o `INSERT` em
  `_prisma_migrations`). Confira com o §4.2 que nada ficou e peça um novo GO.
- **Caminho A:** a falha também desfaz o DDL, mas o Prisma deixa a linha da P1-02 em
  `_prisma_migrations` com `finished_at` NULL. Siga o §5.1 antes de qualquer outra tentativa.

### 5.1 Recuperação depois de falha no caminho A (ex.: `P3018` / `55P03 lock timeout`)

Ensaiado no PG16 local: uma transação segurando `ROW EXCLUSIVE` em `BemPatrimonial` e o
caminho A com `options=-c lock_timeout=5s` deram exit 1 em ~6 s (`P3018`, `55P03`), sem
nenhuma das 3 tabelas e com a linha da P1-02 sem `finished_at`. Um novo deploy, sem resolver,
foi recusado com `P3009`.

1. Confirme que nada do DDL ficou (deve dar **0**):
   ```sql
   SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname IN ('ConversaoCombustivelProduto','AbastecimentoBem','AbastecimentoBemConsumoLote');
   ```
   Se der mais que 0, **pare**: não é este caso (`RELEASE_BLOCKED`).
2. Marque a tentativa como revertida, com a mesma `MIGRATION_DATABASE_URL`:
   `npx prisma migrate resolve --rolled-back 20261110200000_patrimonio_p1_02_abastecimentos --schema backend/prisma/schema.prisma`
3. Elimine a causa (a transação longa do §4.2) e repita **pelo caminho A** (`--verificar-alvo` e
   `--aplicar`). Não troque para o caminho B sem novo GO: a guarda dele (`migration já
   registrada`) recusa enquanto houver a linha revertida.
4. Depois disso o histórico tem 39 concluídas, 0 com falha em aberto e **1 linha da P1-02 com
   `rolled_back_at` preenchido**. No §6 item 1, conte a falha em aberto como
   `finished_at IS NULL AND rolled_back_at IS NULL` (deve dar 0) e aceite exatamente essa
   linha revertida. O rollback do §9.1 continua válido: as guardas dele contam só falha em
   aberto, e o `DELETE` final remove as duas linhas da P1-02.

## 6. Postcheck (somente leitura)

| # | Conferência | Esperado |
|---|---|---|
| 1 | `_prisma_migrations` | **39** concluídas e 0 com falha; a linha da P1-02 tem o `checksum` do §4.3 e `applied_steps_count = 1`; as outras 38 iguais às do §4.2. Depois de uma recuperação do §5.1: 0 com falha **em aberto** (`finished_at IS NULL AND rolled_back_at IS NULL`) e exatamente 1 linha revertida, a da tentativa da P1-02 |
| 2 | Tabelas em `public` | as 3 novas; total = **85** (com `_prisma_migrations`) |
| 3 | `pg_class` das novas | RLS ligado e **sem** FORCE nas 3 |
| 4 | Colunas por tabela | `ConversaoCombustivelProduto` 16 · `AbastecimentoBem` 34 · `AbastecimentoBemConsumoLote` 10 |
| 5 | `pg_constraint` (p / f / c) | totais 3 / 17 / 13. Por tabela: Conversão 1 / 4 / 4 · Abastecimento 1 / 10 / 8 · ConsumoLote 1 / 3 / 1. Todas as FKs `(c,r)` = `ON UPDATE CASCADE ON DELETE RESTRICT` |
| 6 | `pg_index` (pk / unique / outros) | 25 no total. Conversão 1 / 4 / 2 · Abastecimento 1 / 6 / 6 · ConsumoLote 1 / 3 / 1 |
| 7 | `pg_policies` | 1 × `maike_backend_all`, `ALL`, `{maike_vercel}` em cada uma das 3 |
| 8 | Grants das novas | 0 para `anon`, `authenticated` e `PUBLIC` (`has_table_privilege` e `information_schema.role_table_grants`); os demais grantees iguais aos de uma tabela da P1-01 (`TipoCombustivelProduto`) |
| 9 | Contagens | as 3 novas com 0 linhas; as contagens do §4.2 iguais |
| 10 | Tabelas antigas | a consulta de impressão digital do §4.2, rodada de novo, dá as **mesmas 7 linhas** anotadas em produção no §4.2 (colunas, constraints, índices, políticas, gatilhos, RLS/ACL e FKs entrando das 82 antigas; as FKs novas **saindo** das 3 ficam fora). Qualquer md5 diferente → divergência |
| 11 | Advisor de segurança | nenhum alerta novo |
| 12 | Runtime no ar (ainda o da `main`) | `GET /api/native/health` → 200; Bens, Combustíveis, Produtos e Lançamentos abrem; nenhum erro novo nos logs em 30 min |

Consultas de apoio (somente leitura):
```sql
SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public'
   AND c.relname IN ('ConversaoCombustivelProduto','AbastecimentoBem','AbastecimentoBemConsumoLote');
SELECT conrelid::regclass, contype, count(*) FROM pg_constraint
 WHERE conrelid IN ('"ConversaoCombustivelProduto"'::regclass, '"AbastecimentoBem"'::regclass, '"AbastecimentoBemConsumoLote"'::regclass)
 GROUP BY 1, 2 ORDER BY 1, 2;
SELECT tablename, policyname, cmd, roles FROM pg_policies
 WHERE tablename IN ('ConversaoCombustivelProduto','AbastecimentoBem','AbastecimentoBemConsumoLote');
SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
 WHERE table_name IN ('ConversaoCombustivelProduto','AbastecimentoBem','AbastecimentoBemConsumoLote')
   AND grantee IN ('anon','authenticated','PUBLIC');   -- 0 linhas
```

Qualquer divergência → **não fazer o merge**. Registre e avalie o §9.1.

## 7. Merge manual
Só com o §6 inteiro conferido. O merge é do proprietário. O registro do §11 entra por commit
de documentação na própria PR antes do merge, e a CI precisa ficar verde de novo.

## 8. Deploy e smoke
- Deployment de produção do commit de merge em READY (consulta só leitura).
- **Smoke só leitura**, com a conta do proprietário: health 200; o item "Abastecimentos"
  aparece no grupo "Patrimônio e Frota" para o administrador; a tela abre vazia; Bens,
  Combustíveis, Produtos e Lançamentos continuam abrindo; logs sem 500 novo em 30 min.
- **Nenhum fator, abastecimento ou cadastro de teste em produção:** o primeiro uso é uso
  real do proprietário (configurar o fator kg/L de cada produto, depois abastecer).
- **Permissões:** a tela nasce **negada** para todos os perfis. O proprietário concede
  `pat-abastecimentos` (`visualizar`, `novo`/`salvar`) e as ações extras `cancelar` e
  `configurar_conversao` só a quem deve usar.

## 9. Rollback

### 9.1 Antes do merge (as 3 tabelas vazias) — rollback de schema vazio
Só com autorização expressa e com a PR **não** mergeada (ou com o runtime antigo no ar e
**nenhum** fator ou abastecimento gravado). Ordem: filhas antes das mães, **sem CASCADE**.

**Antes (obrigatório):** rode o preflight só leitura do §4.1 e do §4.2 no mesmo alvo e pare se
`system_identifier` ≠ `7692130048193495360` ou se o histórico não for 39/0 com a P1-02 por
último. A guarda de alvo agora também está **dentro** do script, como primeira instrução do
primeiro `DO`, na mesma transação dos `DROP`: em qualquer outro cluster ele aborta antes de
qualquer `DROP` (`alvo divergente`), mesmo que o preflight tenha rodado em outra conexão.

**Ensaio local** (§4.6): o mesmo texto, sem edição, com o modo de ensaio ligado **fora** do
SQL, só na conexão do ensaio:
`PGOPTIONS='-c maike.rollback_p102_ensaio_alvo=<system_identifier local>' psql <url local> -v ON_ERROR_STOP=1 -f rollback.sql`.
O modo só vale no cluster cujo id foi nomeado e é recusado no alvo de produção. Em produção
**nunca** se liga o modo (o conector não passa `PGOPTIONS`, e nenhum `SET` dele vai no texto).

Script testado (cópia exata do SQL ensaiado no PostgreSQL 17.11 local; guarda de alvo
embutida, guarda por checksum pinado, 39 concluídas, nada depois da P1-02, tabelas vazias sob
`ACCESS EXCLUSIVE`, nenhuma FK externa apontando para elas; conferência final 38/0):

```sql
-- =============================================================================
-- MAIKE · Patrimônio P1-02 (D-PROD-159) · ROLLBACK DE SCHEMA VAZIO
-- Migration: 20261110200000_patrimonio_p1_02_abastecimentos
-- SHA-256 do migration.sql: 20f8f9609a8e09f123dac0ed7ba87747069b26ad07411e843481ffec59b15fba
--
-- QUANDO: só se a migration foi aplicada e a release precisa ser desfeita ANTES de
-- qualquer abastecimento/fator gravado (PR não mergeada ou runtime antigo no ar; o
-- runtime da P1-02 lendo estas tabelas daria P2021 → 500).
-- O QUE FAZ (uma transação; tudo ou nada):
--   1. trava de migration do Prisma (advisory 72707369) e lock_timeout 5 s;
--   2. guarda de ALVO, antes de tudo: system_identifier = 7692130048193495360 (projeto
--      Supabase MAIKE); qualquer outro cluster → EXCEPTION. Modo de ENSAIO LOCAL só
--      explícito, fora do texto: PGOPTIONS='-c maike.rollback_p102_ensaio_alvo=<id local>'
--      (o id do cluster local, lido no §4.1). Com o modo ligado, só roda no cluster
--      cujo id foi nomeado e é RECUSADO no alvo de produção;
--      guardas: a P1-02 está registrada, concluída, com o checksum pinado e é a
--      ÚLTIMA (39 concluídas, 0 com falha, nada depois dela); as 3 tabelas existem,
--      ficam em ACCESS EXCLUSIVE e estão VAZIAS; nenhuma FK de fora aponta para elas;
--   3. DROP TABLE das 3, filhas antes das mães, SEM CASCADE (nada some escondido);
--   4. DELETE da linha da P1-02 em _prisma_migrations e conferência final (38 / 0).
-- Qualquer guarda falha → EXCEPTION → ROLLBACK: nada foi alterado.
-- Ensaiado no PostgreSQL 17.11 local (impressão digital volta idêntica à de 38).
-- Locks: o DROP de cada tabela também toma ACCESS EXCLUSIVE nas tabelas antigas que
-- ela referencia (remoção dos gatilhos de FK) até o COMMIT — rodar fora de pico.
-- =============================================================================
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(72707369);

DO $$
DECLARE
  c_mig constant text := '20261110200000_patrimonio_p1_02_abastecimentos';
  c_sha constant text := '20f8f9609a8e09f123dac0ed7ba87747069b26ad07411e843481ffec59b15fba';
  c_tabelas constant text[] := ARRAY['AbastecimentoBemConsumoLote','AbastecimentoBem','ConversaoCombustivelProduto'];
  c_alvo constant bigint := 7692130048193495360;  -- projeto Supabase MAIKE (§4.1)
  v_sysid bigint := (SELECT system_identifier FROM pg_control_system());
  v_ensaio text := nullif(current_setting('maike.rollback_p102_ensaio_alvo', true), '');
  v_tab text;
  v_n int;
BEGIN
  -- Guarda de ALVO dentro da transação, antes de qualquer outra leitura e de qualquer DROP.
  IF v_ensaio IS NULL THEN
    IF v_sysid <> c_alvo THEN
      RAISE EXCEPTION 'ROLLBACK-P1-02: alvo divergente (system_identifier %, esperado %). Nada foi alterado.', v_sysid, c_alvo;
    END IF;
  ELSIF v_sysid = c_alvo THEN
    RAISE EXCEPTION 'ROLLBACK-P1-02: modo de ensaio ligado no alvo de PRODUÇÃO; o ensaio só roda em banco local. Nada foi alterado.';
  ELSIF v_ensaio <> v_sysid::text THEN
    RAISE EXCEPTION 'ROLLBACK-P1-02: o modo de ensaio nomeia o cluster %, mas esta conexão está no %. Nada foi alterado.', v_ensaio, v_sysid;
  ELSE
    RAISE NOTICE 'ROLLBACK-P1-02: ENSAIO LOCAL no cluster % (não é produção).', v_sysid;
  END IF;
  SELECT count(*) INTO v_n FROM public."_prisma_migrations"
   WHERE migration_name = c_mig AND finished_at IS NOT NULL AND rolled_back_at IS NULL AND checksum = c_sha;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'ROLLBACK-P1-02: a migration % não está registrada como concluída com o checksum pinado (achei %). Nada foi alterado.', c_mig, v_n;
  END IF;
  IF EXISTS (SELECT 1 FROM public."_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'ROLLBACK-P1-02: há migration com falha/parcial no histórico. Nada foi alterado.';
  END IF;
  IF EXISTS (SELECT 1 FROM public."_prisma_migrations" WHERE migration_name > c_mig AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'ROLLBACK-P1-02: existe migration posterior à P1-02; este rollback não se aplica. Nada foi alterado.';
  END IF;
  SELECT count(*) INTO v_n FROM public."_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;
  IF v_n <> 39 THEN
    RAISE EXCEPTION 'ROLLBACK-P1-02: esperado 39 migrations concluídas, achei %. Nada foi alterado.', v_n;
  END IF;
  FOREACH v_tab IN ARRAY c_tabelas LOOP
    IF to_regclass(format('public.%I', v_tab)) IS NULL THEN
      RAISE EXCEPTION 'ROLLBACK-P1-02: tabela % não existe. Nada foi alterado.', v_tab;
    END IF;
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', v_tab);
    EXECUTE format('SELECT count(*) FROM (SELECT 1 FROM public.%I LIMIT 1) x', v_tab) INTO v_n;
    IF v_n <> 0 THEN
      RAISE EXCEPTION 'ROLLBACK-P1-02: a tabela % tem linhas; rollback de schema VAZIO recusado (dados reais exigem decisão própria). Nada foi alterado.', v_tab;
    END IF;
  END LOOP;
  IF EXISTS (
    SELECT 1 FROM pg_constraint k
     WHERE k.contype = 'f'
       AND k.confrelid IN (SELECT to_regclass(format('public.%I', t)) FROM unnest(c_tabelas) t)
       AND k.conrelid NOT IN (SELECT to_regclass(format('public.%I', t)) FROM unnest(c_tabelas) t)
  ) THEN
    RAISE EXCEPTION 'ROLLBACK-P1-02: há FK de tabela externa apontando para as tabelas da P1-02. Nada foi alterado.';
  END IF;
END $$;

-- Filhas antes das mães; sem CASCADE.
DROP TABLE public."AbastecimentoBemConsumoLote";
DROP TABLE public."AbastecimentoBem";
DROP TABLE public."ConversaoCombustivelProduto";
DELETE FROM public."_prisma_migrations" WHERE migration_name = '20261110200000_patrimonio_p1_02_abastecimentos';

DO $$
DECLARE v_ok int; v_ruim int;
BEGIN
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)
    INTO v_ok, v_ruim FROM public."_prisma_migrations";
  IF v_ok <> 38 OR v_ruim <> 0
     OR to_regclass('public."AbastecimentoBemConsumoLote"') IS NOT NULL
     OR to_regclass('public."AbastecimentoBem"') IS NOT NULL
     OR to_regclass('public."ConversaoCombustivelProduto"') IS NOT NULL THEN
    RAISE EXCEPTION 'ROLLBACK-P1-02: conferência final falhou (concluídas %, com falha %). Nada foi alterado.', v_ok, v_ruim;
  END IF;
  RAISE NOTICE 'ROLLBACK-P1-02: OK — 38 concluídas, 0 com falha, as 3 tabelas removidas (efetiva no COMMIT).';
END $$;
COMMIT;
```

Depois: repetir o §4.2 (38/0, P1-02 ausente, 82 tabelas) e o runtime antigo continua no ar.
Locks do rollback: `ACCESS EXCLUSIVE` em `BemPatrimonial`, `Cliente`, `Empresa`,
`EstoqueLoteNota`, `LocalEstoque`, `MovimentacaoEstoque`, `TanqueBem`,
`TipoCombustivelProduto` e `Usuario` até o `COMMIT` (bloqueia leitura também): rodar fora de pico.

### 9.2 Depois do merge
- Não fazer `DROP`: podem existir fatores e abastecimentos reais (com baixa de estoque).
- Problema de código → rollback de deployment na Vercel ou revert da PR. As tabelas ficam.
- **Janela de runtime antigo com abastecimentos gravados:** o runtime antigo não conhece
  X1 nem X2. Nessa janela:
  - o administrador consegue alterar o saldo de um lote consumido por abastecimento; o
    cancelamento exato desse abastecimento passa a ser recusado (`devolucao_excede_entrada`,
    fail-closed) — **não editar lotes consumidos** nessa janela;
  - o PATCH do medidor do bem não respeita o piso operacional — **não ajustar medidores**
    de bens com abastecimento nessa janela;
  - excluir **lote manual** (que não veio de compra P3) consumido por abastecimento cai na
    FK RESTRICT (`AbastecimentoBemConsumoLote_lote_fkey`) e o runtime antigo traduz o
    `P2003` em **403 `TENANT_SCOPE_VIOLATION`**. Nada se perde, mas a resposta engana.
    Lote de compra P3 dá **409 `REGISTRO_OPERACIONAL_IMUTAVEL`**; produto dá **409
    `PRODUTO_DELETE_BLOCKED`** (o abastecimento criou movimentação de estoque) e empresa dá
    **409 `EMPRESA_COM_VINCULOS`**, os dois recusados antes de chegar à FK.

> **Aviso ao suporte (janela de rollback de código):** um 403 `TENANT_SCOPE_VIOLATION` ao
> excluir um **lote** **não é incidente de tenancy**: é a FK de um abastecimento que consumiu
> o lote. Não "corrigir" apagando linhas das tabelas da P1-02 no banco.

### 9.3 Restaurar backup
Não é rollback desta release. Volta o banco inteiro, com todos os tenants. Exige plano
explícito e decisão do proprietário (ver o runbook da P3-01, §9.3).

## 10. Estados que bloqueiam (`RELEASE_BLOCKED`)
- `system_identifier` divergente;
- histórico ≠ 38/0 (ou ≠ recontagem da `main` no GO), P1-01 ou P3-03 ausente ou com checksum divergente;
- P1-02 já registrada ou alguma das 3 tabelas já existente;
- checksum diferente do manifesto (`20f8f960…5fba`);
- classificador com violação;
- sem prova de backup;
- CI não verde no SHA aprovado;
- sem GO expresso e escrito;
- transação longa no caminho (§4.2) ou qualquer erro na transação.

## 11. Registro de execução (preencher só quando executado)

| Campo | Valor |
|---|---|
| GO do proprietário (texto e data/hora UTC) | `<pendente>` |
| Caminho (A runner / B conector) | `<pendente>` |
| `<SHA_APROVADO>` e run de CI | `<pendente>` (HEAD final da PR #235 no momento da aprovação; código final da missão `6dd34014`) |
| `system_identifier` e vínculo Vercel ↔ Supabase | `<pendente>` |
| Histórico antes | `<pendente>` |
| SHA-256 calculado no §4.3 | `<pendente>` |
| Evidência de backup | `<pendente>` |
| Classificador e ensaio local | `<pendente>` |
| Resultado da transação | `<pendente>` |
| Postcheck do §6 | `<pendente>` |
| Merge, deployment e smoke | `<pendente>` |
| Concessão de permissões pelo proprietário | `<pendente>` |
