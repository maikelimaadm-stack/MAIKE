# MAIKE — Linhas de produto e de máquina (Fatia 3): runbook de release EXPAND (D-PROD-201)

> **Estado: NÃO EXECUTADO. `SCHEMA_APPLIED_PROD: NÃO`.**
>
> Este documento é o plano. Cada passo para no primeiro desvio com
> **`RELEASE_BLOCKED`**. Valores entre `<…>` são preenchidos na hora, a partir de
> leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-201](./DECISIONS.md) · Contrato:
[`MAIKE-ATIVIDADE-LINHAS-CONTRATO.md`](./MAIKE-ATIVIDADE-LINHAS-CONTRATO.md) (§1 o modelo e a migration).
Precedentes executados: [`MAIKE-ATIVIDADE-CABECALHO-RUNBOOK-RELEASE.md`](./MAIKE-ATIVIDADE-CABECALHO-RUNBOOK-RELEASE.md)
(a anterior, CONTRACT, caminho B) e [`MAIKE-PESO-PROJETADO-RUNBOOK-RELEASE.md`](./MAIKE-PESO-PROJETADO-RUNBOOK-RELEASE.md)
(EXPAND com coluna anulável em tabela antiga, caminho B). Molde: [`MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md)
(§1 explica por que nunca `apply_migration` e nunca DDL solto).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261114600000_atividade_linhas_produto_maquina` |
| Natureza | **EXPAND** (allowlist fechada do portão, D-PROD-107 R7): só tabelas novas e duas colunas anuláveis, sem DEFAULT, em tabelas antigas. Nenhum dado migrado, nenhum `UPDATE`, nenhum `DROP` |
| O que entra | `"AtividadeApontamentoProduto"` (linha de produto do apontamento), `"AtividadeApontamentoProdutoConsumoLote"` (as fatias FIFO da linha) e `"AtividadeApontamentoMaquina"` (linha de máquina): 3 `CREATE TABLE`, 20 índices (13 únicos), todos começando por `cliente_id`, 9 CHECKs, 17 FKs compostas pelo tenant `ON DELETE RESTRICT ON UPDATE CASCADE` (o apontamento e o bem por `(cliente_id, empresa_id, id)`: mesma fazenda por construção) e o RLS de sempre (REVOKE de `anon`/`authenticated`, RLS sem FORCE, política `maike_backend_all` para `maike_vercel`) |
| Colunas em tabelas antigas | `"BemPatrimonial"."custo_uso_unitario"` e `"TipoPatrimonial"."salto_maximo_medidor"`, as duas `DECIMAL(14,4)`, anuláveis, sem DEFAULT (só catálogo: nenhuma linha é reescrita) |
| O que não muda | nenhuma outra coluna, constraint, índice ou linha; as tabelas que as FKs novas referenciam só ganham essas FKs |
| SHA-256 do arquivo (`MIGRATIONS_APROVADAS`) | `e374c81d448711894a19825e319ed0d760128c9b77a02953647e4cf7a09a5489` |
| RLS das novas (`DO_RLS_APROVADOS`) | `3991bb1cbddf3772bf580b1bf35de71580b77725d20e77c0d6df7d8a1f2e95d8` |
| Classificador (`classificarMigrations`) | `modo: EXPAND`, `expand: true`, `violacoes: []`, `contract: []`, `tabelas_novas: ["AtividadeApontamentoMaquina", "AtividadeApontamentoProduto", "AtividadeApontamentoProdutoConsumoLote"]`, `colunas_novas_em_tabelas_antigas: ["BemPatrimonial.custo_uso_unitario", "TipoPatrimonial.salto_maximo_medidor"]` |
| `_prisma_migrations` | antes **53** concluídas, 0 em aberto (a última, a CONTRACT da Atividade cabeçalho da D-PROD-200, `20261114500000_atividade_cabecalho`, concluída em 2026-11-14 às 20:25:14 UTC, checksum `c288cf47c1bbb1de1b25295ffc57c37185c2ce1060e092eec7088d9d501f1feb`); depois **54**. Recontar no §4 se algo mais for aplicado antes |
| Tabelas em `public` | **84** antes, **87** depois (+ 3) |

**Ordem: aplicar ANTES do merge (D-PROD-72 item 1). Não há janela.**

- código de hoje com a migration aplicada: o Prisma Client de hoje não conhece as
  2 colunas nem as 3 tabelas e não as lê; tudo segue igual (a migration é aditiva);
- código novo sem a migration: o Prisma Client novo lê `custo_uso_unitario` em toda
  leitura de bem e `salto_maximo_medidor` em toda leitura de tipo patrimonial
  (`P2022`, coluna inexistente: 500 em Bens, Tipos Patrimoniais, Abastecimento e no
  Lançamento de Atividades) e as rotas das linhas dão 500 (`P2021`, tabela
  inexistente).

Por isso: aplicar (§5) → postcheck (§6) → merge (§7). O **Instant Rollback** da
Vercel para o deploy anterior **continua seguro** depois da aplicação (o código
anterior convive com o banco novo). **Só com o GO explícito e escrito do
proprietário** (§2).

**Travas durante a transação (conferido no PostgreSQL 16 local, `pg_locks` da
própria sessão antes do `COMMIT`):** `ACCESS EXCLUSIVE` em `BemPatrimonial` e
`TipoPatrimonial` (o `ADD COLUMN`) até o `COMMIT`, que bloqueia até a leitura dessas
duas (Patrimônio, Abastecimento e a máquina da atividade esperam); `SHARE ROW
EXCLUSIVE` nas tabelas que as FKs novas referenciam (`AtividadeApontamento`,
`Produto`, `LocalEstoque`, `MovimentacaoEstoque`, `EstoqueLoteNota`, `Usuario`,
`Cliente`), que bloqueia escrita nelas (não a leitura). Tudo vazio nas novas: a
transação dura menos de 1 s. Se uma transação longa estiver segurando alguma dessas
tabelas, o `lock_timeout` de 5 s do envelope estoura e a transação aborta **sem
aplicar nada**. Por isso: **fora de pico**, e o preflight confere as travas e as
transações longas.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** numa máquina protegida, com
  `MIGRATION_DATABASE_URL` (direta ou de sessão na 5432, nunca o pooler 6543),
  `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360` e a conexão do
  **runtime** (`DATABASE_URL` ou `POSTGRES_PRISMA_URL`) apontando para o MESMO
  banco (o `deploy:migrate` confere as duas). EXPAND: sem `--contract` (com ele,
  `CONTRACT_INESPERADO`):
  ```bash
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>                   # ANÁLISE LOCAL OK — modo EXPAND, as 3 tabelas e as 2 colunas
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo  # ALVO VERIFICADO — 1 pendente(s) do manifesto
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar
  ```
  A migration não tem guarda própria nem `lock_timeout` (o classificador não aceita
  `SET`): no caminho A, use a conexão **direta** com `options=-c%20lock_timeout%3D5s`
  na `MIGRATION_DATABASE_URL`, que o runner repassa ao `prisma migrate deploy` (forma
  provada na D-PROD-185, [`MAIKE-ESTOQUE-P1-03-RUNBOOK-RELEASE.md`](./MAIKE-ESTOQUE-P1-03-RUNBOOK-RELEASE.md) §0);
  sem ela, o deploy espera a trava sem limite.
- **B — conector Supabase, uma única `execute_sql` (§5):** desvio da D-PROD-74,
  registrado no §11, só com o GO escrito do proprietário **para esta migration**
  (§2). Nunca presumido de releases anteriores nem de autorização genérica.

## 2. Pré-requisitos e GOs

**Pré-requisitos (todos antes da aplicação):**
- toda a validação local da PR verde: `verify:all` (com `test:backend` e
  `test:smoke`) e o ensaio do §4.2 no `<SHA_APROVADO>`;
- a branch está atualizada com a `main`, a PR está `mergeable` e esta é a **única**
  migration nova da release;
- nenhuma outra migration entrou na `main` nem foi aplicada em produção depois do
  preflight; se entrou, atualizar a branch, recontar o §4 e repetir o ensaio.

**GOs:**

| GO | O quê | Situação |
|---|---|---|
| GO-1 | rodar o preflight **só leitura** em produção (§4) | `<pendente>` |
| GO-2 | aplicar a migration EXPAND (§5) antes do merge da PR da Fatia 3 e mergear em seguida | `<pendente>` — escrito para **esta** migration; vale depois de toda a validação local verde e de um preflight `PRONTO PARA APLICAR`. No caminho B, registrar no §11 como o desvio da D-PROD-74 |

## 3. Ordem

Validação local verde (§2) → preflight §4 (anotar no §11) → ensaio local §4.2 com
o arquivo do SHA → GO-2 conferido → logo antes: repetir o preflight (as linhas 2,
3, 9 e 10 de novo) → aplicação §5 → **postcheck** §6 (só leitura) e alertas do
Supabase → merge §7 → deploy da `main` READY → conferência §8.

## 4. Preflight (somente leitura; `SELECT` no conector ou papel de leitura)

### 4.1 Uma consulta, com veredito

Cole TUDO e rode. Só `SELECT`. Qualquer `PARAR` → `RELEASE_BLOCKED`.

<!-- sql:preflight -->
```sql
-- MAIKE · D-PROD-201 · PREFLIGHT (somente leitura). Cole TUDO e rode. Qualquer PARAR = não aplicar.
WITH
esperado AS (SELECT '7692130048193495360'::text AS sid),
mig AS (
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS abertas,
         count(*) FILTER (WHERE migration_name = '20261114600000_atividade_linhas_produto_maquina' AND rolled_back_at IS NULL) AS esta,
         count(*) FILTER (WHERE migration_name = '20261114500000_atividade_cabecalho'
                            AND checksum = 'c288cf47c1bbb1de1b25295ffc57c37185c2ce1060e092eec7088d9d501f1feb'
                            AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS anterior
    FROM public._prisma_migrations
),
novas AS (
  SELECT count(*) AS n FROM (VALUES ('AtividadeApontamentoProduto'), ('AtividadeApontamentoProdutoConsumoLote'), ('AtividadeApontamentoMaquina')) AS t(nome)
   WHERE to_regclass(format('public.%I', t.nome)) IS NOT NULL
),
colunas AS (
  SELECT count(*) AS n FROM information_schema.columns
   WHERE table_schema = 'public'
     AND ((table_name = 'BemPatrimonial' AND column_name = 'custo_uso_unitario') OR (table_name = 'TipoPatrimonial' AND column_name = 'salto_maximo_medidor'))
),
-- As chaves que as FKs compostas novas referenciam (único exato, sem predicado).
alvos(tabela, colunas) AS (VALUES
  ('AtividadeApontamento', 'cliente_id,empresa_id,id'), ('BemPatrimonial', 'cliente_id,empresa_id,id'), ('Produto', 'cliente_id,id'),
  ('LocalEstoque', 'cliente_id,id'), ('MovimentacaoEstoque', 'cliente_id,id'), ('EstoqueLoteNota', 'cliente_id,id'), ('Usuario', 'cliente_id,id')
),
chaves AS (
  SELECT count(*) AS n FROM alvos a
   WHERE EXISTS (
     SELECT 1 FROM pg_index i
      WHERE i.indrelid = to_regclass(format('public.%I', a.tabela)) AND i.indisunique AND i.indpred IS NULL
        AND (SELECT string_agg(att.attname::text, ',' ORDER BY k.ord) FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute att ON att.attrelid = i.indrelid AND att.attnum = k.attnum) = a.colunas)
),
tabelas AS (SELECT count(*) AS n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')),
-- As 2 que o ADD COLUMN trava em ACCESS EXCLUSIVE e as que as FKs novas travam em SHARE ROW EXCLUSIVE.
travadas AS (
  SELECT to_regclass(format('public.%I', t))::oid AS oid
    FROM unnest(ARRAY['BemPatrimonial', 'TipoPatrimonial', 'AtividadeApontamento', 'Produto', 'LocalEstoque', 'MovimentacaoEstoque',
                      'EstoqueLoteNota', 'Usuario', 'Cliente']) AS t
),
travas AS (
  SELECT count(*) AS n FROM pg_locks l
   WHERE l.locktype = 'relation' AND l.pid <> pg_backend_pid() AND l.relation IN (SELECT oid FROM travadas WHERE oid IS NOT NULL)
),
longas AS (
  SELECT count(*) AS n FROM pg_stat_activity
   WHERE datname = current_database() AND pid <> pg_backend_pid() AND xact_start IS NOT NULL AND now() - xact_start > interval '30 seconds'
),
base(ordem, item, valor, esperado, status) AS (
  SELECT 1, 'alvo: system_identifier', (SELECT system_identifier::text FROM pg_control_system()), (SELECT sid FROM esperado),
         CASE WHEN (SELECT system_identifier::text FROM pg_control_system()) = (SELECT sid FROM esperado) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 2, 'migrations concluídas / em aberto', (SELECT concluidas || ' / ' || abertas FROM mig), '53 / 0',
         CASE WHEN (SELECT concluidas = 53 AND abertas = 0 FROM mig) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 3, '20261114600000_atividade_linhas_produto_maquina já registrada', (SELECT esta::text FROM mig), '0',
         CASE WHEN (SELECT esta FROM mig) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 4, 'a anterior (D-PROD-200) concluída com o checksum do repositório', (SELECT anterior::text FROM mig), '1',
         CASE WHEN (SELECT anterior FROM mig) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 5, 'tabelas novas já presentes', (SELECT n::text FROM novas), '0',
         CASE WHEN (SELECT n FROM novas) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 6, 'colunas novas já presentes (BemPatrimonial.custo_uso_unitario, TipoPatrimonial.salto_maximo_medidor)', (SELECT n::text FROM colunas), '0',
         CASE WHEN (SELECT n FROM colunas) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 7, 'chaves compostas que as FKs novas referenciam', (SELECT n::text FROM chaves), '7',
         CASE WHEN (SELECT n FROM chaves) = 7 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 8, 'tabelas em public', (SELECT n::text FROM tabelas), '84',
         CASE WHEN (SELECT n FROM tabelas) = 84 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 9, 'travas de outras sessões nas tabelas que a migration trava, agora', (SELECT n::text FROM travas), '0',
         CASE WHEN (SELECT n FROM travas) = 0 THEN 'OK' ELSE 'ATENÇÃO (repita fora de pico)' END
  UNION ALL
  SELECT 10, 'transações abertas há mais de 30 s', (SELECT n::text FROM longas), '0',
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

| Linha | Esperado hoje |
|---|---|
| alvo | `7692130048193495360` |
| migrations | `53 / 0` |
| esta migration registrada | `0` |
| a anterior (D-PROD-200) com o checksum do repositório | `1` |
| tabelas novas / colunas novas já presentes | `0` / `0` |
| chaves compostas que as FKs referenciam | `7` |
| tabelas em `public` | `84` |
| travas de outras sessões e transações longas | `0` e `0` (senão `ATENÇÃO`: esperar e repetir fora de pico) |

E, localmente, no `<SHA_APROVADO>`:
`sha256sum backend/prisma/migrations/20261114600000_atividade_linhas_produto_maquina/migration.sql`
igual ao pinado, e a análise local do `premerge-migrate` (§1) com `modo: EXPAND`,
`contract: []`, as 3 `tabelas_novas`, as 2 `colunas_novas_em_tabelas_antigas` e
`violacoes: []`.

### 4.2 Ensaio local (com o arquivo exato do `<SHA_APROVADO>`)

Automatizado em `backend/tests/atividadeLinhasMigration.test.mjs`, só contra
PostgreSQL local, em bancos próprios criados e apagados pelo teste. Ele roda
**este** preflight, **este** envelope do caminho B e **este** postcheck (lidos
deste arquivo, entre os marcadores `sql:…`), trocando só o `system_identifier` de
produção pelo local:

- partida: as 53 migrations de nome anterior a esta, pelo Prisma, com um
  apontamento do dia, um bem e um tipo patrimonial já cadastrados; preflight
  `PRONTO`;
- o classificador (`EXPAND`, sem violação) e a release pelo runner oficial com a
  conferência de alvo exigida, **sem** `MIGRATION_CONTRACT_AUTORIZADO`: 54/0, 87
  tabelas, as 3 novas com RLS sem FORCE, a política e nenhum grant público, as 2
  colunas anuláveis sem DEFAULT (o bem e o tipo de antes com `NULL`), os CHECKs
  (status, valores, medidor, implemento ≠ bem, estorno ≠ saída), as FKs compostas
  pelo tenant e pela fazenda e o RESTRICT, `migrate diff` vazio, postcheck
  `APLICADA`; reaplicar o `migration.sql` falha sem mudar nada;
- caminho B: o envelope com o `system_identifier` de produção recusa (alvo
  divergente); com histórico fora de 53/0 ou a D-PROD-200 com outro checksum recusa
  antes do DDL; o envelope aplica (53 → 54, checksum = SHA-256 do arquivo,
  `applied_steps_count` 1, o mesmo schema do runner), o Prisma não vê pendência,
  `migrate diff` vazio, postcheck `APLICADA`; repetir o envelope recusa.

Registrar o resultado no §11.

## 5. Aplicação — só com o GO-2 e o §2 cumprido

### Caminho A (padrão)

Os comandos do §1, com o `<SHA_APROVADO>`. O `--verificar-alvo` tem de terminar
com `ALVO VERIFICADO — 1 pendente(s) do manifesto`.

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
              WHERE migration_name = '20261114600000_atividade_linhas_produto_maquina' AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)
    INTO n_ok, n_aberta FROM _prisma_migrations;
  IF n_ok <> 53 OR n_aberta <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % em aberto', n_ok, n_aberta;
  END IF;
  IF (SELECT count(*) FROM _prisma_migrations
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
         AND migration_name = '20261114500000_atividade_cabecalho'
         AND checksum = 'c288cf47c1bbb1de1b25295ffc57c37185c2ce1060e092eec7088d9d501f1feb') <> 1 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (D-PROD-200) ausente ou com checksum divergente';
  END IF;
  IF to_regclass('public."AtividadeApontamentoProduto"') IS NOT NULL
     OR to_regclass('public."AtividadeApontamentoProdutoConsumoLote"') IS NOT NULL
     OR to_regclass('public."AtividadeApontamentoMaquina"') IS NOT NULL THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: tabela nova já existe';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public'
                AND ((table_name = 'BemPatrimonial' AND column_name = 'custo_uso_unitario')
                  OR (table_name = 'TipoPatrimonial' AND column_name = 'salto_maximo_medidor'))) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: coluna nova já existe';
  END IF;
END $alvo$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'e374c81d448711894a19825e319ed0d760128c9b77a02953647e4cf7a09a5489', now(),
        '20261114600000_atividade_linhas_produto_maquina', NULL, NULL, now(), 1);
COMMIT;
```
<!-- /sql:caminho-b -->

- O `migration.sql` não tem `BEGIN`/`COMMIT` próprios; o bloco `DO $$ … $$` do RLS
  vai como está (o envelope usa `$alvo$`, que não colide).
- O `checksum` do `INSERT` é o SHA-256 do arquivo: com outro valor o Prisma acusa
  divergência e o `premerge-migrate` recusa as releases seguintes
  (`PREMERGE_MIGRATIONS_NAO_COMPROVADAS`).
- Qualquer falha desfaz tudo, inclusive o `INSERT` em `_prisma_migrations`.

### 5.1 Falha no caminho A (`55P03` ou outro erro)

1. Nada fica (uma transação só): as 3 novas e as 2 colunas não existem; a linha da
   migration fica com `finished_at` NULL.
2. Conferir pelo preflight que as novas e as colunas não existem (linhas 5 e 6 `0`).
3. Com a conexão de **produção** explícita (o schema lê `DATABASE_URL`):
   `DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate resolve --rolled-back 20261114600000_atividade_linhas_produto_maquina --schema backend/prisma/schema.prisma`.
4. Eliminar a causa e confirmar com o proprietário antes de tentar de novo.
5. Uma tentativa resolvida (`rolled_back_at` preenchido) não bloqueia o envelope
   do caminho B; uma linha ainda aberta bloqueia (resolver primeiro). No §6,
   aceitar exatamente essa linha revertida.

### 5.2 Falha no caminho B

Nada é aplicado (uma transação só). Repetir o preflight (linhas 2, 3, 5 e 6 iguais
às de antes), eliminar a causa e confirmar com o proprietário antes de tentar de
novo.

## 6. Postcheck (antes do merge; só leitura)

Qualquer `PARAR`: **não mergear** e chamar o proprietário.

<!-- sql:postcheck -->
```sql
-- MAIKE · D-PROD-201 · POSTCHECK (somente leitura). Cole TUDO e rode. Esperado: tudo OK/CONFIRA e VEREDITO APLICADA.
WITH
esperado AS (SELECT '7692130048193495360'::text AS sid),
mig AS (
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS abertas,
         count(*) FILTER (WHERE migration_name = '20261114600000_atividade_linhas_produto_maquina'
                            AND checksum = 'e374c81d448711894a19825e319ed0d760128c9b77a02953647e4cf7a09a5489'
                            AND finished_at IS NOT NULL AND rolled_back_at IS NULL AND applied_steps_count = 1) AS esta
    FROM public._prisma_migrations
),
alvo AS (
  SELECT t.nome, to_regclass(format('public.%I', t.nome))::oid AS oid
    FROM (VALUES ('AtividadeApontamentoProduto'), ('AtividadeApontamentoProdutoConsumoLote'), ('AtividadeApontamentoMaquina')) AS t(nome)
),
novas AS (SELECT oid FROM alvo WHERE oid IS NOT NULL),
-- Linhas nas novas, por SQL dinâmico: tabela ausente → NULL (a linha diz PARAR), nunca erro.
linhas AS (
  SELECT sum(CASE WHEN a.oid IS NULL THEN NULL
                  ELSE (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', a.nome), false, true, '')))[1]::text::bigint
             END) AS n,
         count(*) FILTER (WHERE a.oid IS NULL) AS ausentes
    FROM alvo a
),
colunas AS (
  SELECT count(*) FILTER (WHERE data_type = 'numeric' AND numeric_precision = 14 AND numeric_scale = 4 AND is_nullable = 'YES' AND column_default IS NULL) AS certas
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND ((table_name = 'BemPatrimonial' AND column_name = 'custo_uso_unitario') OR (table_name = 'TipoPatrimonial' AND column_name = 'salto_maximo_medidor'))
),
preenchidas AS (
  SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'BemPatrimonial' AND column_name = 'custo_uso_unitario') AS existe_bem,
         (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'TipoPatrimonial' AND column_name = 'salto_maximo_medidor') AS existe_tipo
),
valores AS (
  SELECT CASE WHEN (SELECT existe_bem FROM preenchidas) = 1
              THEN (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public."BemPatrimonial" WHERE "custo_uso_unitario" IS NOT NULL', false, true, '')))[1]::text::bigint END AS bem,
         CASE WHEN (SELECT existe_tipo FROM preenchidas) = 1
              THEN (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public."TipoPatrimonial" WHERE "salto_maximo_medidor" IS NOT NULL', false, true, '')))[1]::text::bigint END AS tipo
),
checks_esperados(nome) AS (VALUES
  ('AtividadeApontamentoProduto_status_check'), ('AtividadeApontamentoProduto_valores_check'), ('AtividadeApontamentoProduto_textos_check'),
  ('AtividadeApontamentoProduto_movimentos_check'), ('AtividadeApontamentoProdutoConsumoLote_valores_check'),
  ('AtividadeApontamentoMaquina_status_check'), ('AtividadeApontamentoMaquina_medidor_check'), ('AtividadeApontamentoMaquina_valores_check'),
  ('AtividadeApontamentoMaquina_textos_check')
),
checks AS (
  SELECT count(*) AS n FROM pg_constraint k JOIN checks_esperados e ON e.nome = k.conname
   WHERE k.conrelid IN (SELECT oid FROM novas) AND k.contype = 'c' AND k.convalidated
),
fks AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE k.confdeltype = 'r' AND k.confupdtype = 'c' AND k.convalidated
                            AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = k.conrelid AND a.attnum = k.conkey[1]) = 'cliente_id') AS certas
    FROM pg_constraint k WHERE k.conrelid IN (SELECT oid FROM novas) AND k.contype = 'f'
),
indices AS (
  SELECT count(*) FILTER (WHERE NOT i.indisprimary) AS total,
         count(*) FILTER (WHERE NOT i.indisprimary AND (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = i.indrelid AND a.attnum = i.indkey[0]) = 'cliente_id') AS por_cliente,
         count(*) FILTER (WHERE i.indisunique AND NOT i.indisprimary) AS unicos
    FROM pg_index i WHERE i.indrelid IN (SELECT oid FROM novas)
),
tabelas AS (SELECT count(*) AS n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')),
seguranca AS (
  SELECT count(*) FILTER (WHERE c.relrowsecurity AND NOT c.relforcerowsecurity) AS certas,
         coalesce(string_agg(c.relname || ': ' || c.relrowsecurity || ' / ' || c.relforcerowsecurity || ' / '
                    || coalesce((SELECT string_agg(p.polname::text, ', ' ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid = c.oid), '-'), ' · ' ORDER BY c.relname), '-') AS texto
    FROM pg_class c WHERE c.oid IN (SELECT oid FROM novas)
),
grants AS (
  SELECT count(*) AS n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name IN ('AtividadeApontamentoProduto', 'AtividadeApontamentoProdutoConsumoLote', 'AtividadeApontamentoMaquina')
     AND grantee IN ('anon', 'authenticated', 'PUBLIC')
),
base(ordem, item, valor, esperado, status) AS (
  SELECT 1, 'alvo: system_identifier', (SELECT system_identifier::text FROM pg_control_system()), (SELECT sid FROM esperado),
         CASE WHEN (SELECT system_identifier::text FROM pg_control_system()) = (SELECT sid FROM esperado) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 2, '20261114600000_atividade_linhas_produto_maquina concluída (checksum pinado, applied_steps_count 1)', (SELECT esta::text FROM mig), '1',
         CASE WHEN (SELECT esta FROM mig) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 3, 'migrations concluídas / em aberto', (SELECT concluidas || ' / ' || abertas FROM mig), '54 / 0',
         CASE WHEN (SELECT concluidas = 54 AND abertas = 0 FROM mig) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 4, 'tabelas novas presentes / linhas nelas', (SELECT (3 - ausentes) || ' / ' || coalesce(n::text, '-') FROM linhas), '3 / 0',
         CASE WHEN (SELECT ausentes = 0 AND n = 0 FROM linhas) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 5, 'tabelas em public', (SELECT n::text FROM tabelas), '87',
         CASE WHEN (SELECT n FROM tabelas) = 87 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 6, 'as 2 colunas novas: DECIMAL(14,4), anuláveis, sem DEFAULT', (SELECT certas::text FROM colunas), '2',
         CASE WHEN (SELECT certas FROM colunas) = 2 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 7, 'bens com custo de uso / tipos com teto de salto (antes do código novo)',
         coalesce((SELECT bem || ' / ' || tipo FROM valores), '-'), '0 / 0',
         CASE WHEN (SELECT bem IS NULL OR tipo IS NULL FROM valores) THEN 'PARAR' ELSE 'CONFIRA' END
  UNION ALL
  SELECT 8, 'os 9 CHECKs, validados', (SELECT n::text FROM checks), '9',
         CASE WHEN (SELECT n FROM checks) = 9 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 9, 'FKs: total / compostas pelo cliente, RESTRICT/CASCADE e validadas', (SELECT total || ' / ' || certas FROM fks), '17 / 17',
         CASE WHEN (SELECT total = 17 AND certas = 17 FROM fks) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 10, 'índices (sem as pkeys): total / começando por cliente_id / únicos', (SELECT total || ' / ' || por_cliente || ' / ' || unicos FROM indices), '20 / 20 / 13',
         CASE WHEN (SELECT total = 20 AND por_cliente = 20 AND unicos = 13 FROM indices) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 11, 'RLS / FORCE / políticas das 3 novas', (SELECT texto FROM seguranca), 'true / false / maike_backend_all nas três',
         CASE WHEN (SELECT certas FROM seguranca) = 3 THEN 'CONFIRA' ELSE 'PARAR' END
  UNION ALL
  SELECT 12, 'grants para anon/authenticated/PUBLIC nas 3 novas', (SELECT n::text FROM grants), '0',
         CASE WHEN (SELECT n FROM grants) = 0 THEN 'OK' ELSE 'PARAR' END
)
SELECT item, valor, esperado, status FROM (
  SELECT * FROM base
  UNION ALL
  SELECT 999, 'VEREDITO',
         CASE WHEN EXISTS (SELECT 1 FROM base WHERE status LIKE 'PARAR%') THEN 'PARAR: há linha PARAR acima; não mergear'
              ELSE 'APLICADA E CONFERIDA (confira as linhas CONFIRA)' END, '-', '-'
) x ORDER BY ordem;
```
<!-- /sql:postcheck -->

Esperado: `1`; `54 / 0`; `3 / 0`; `87`; `2`; `0 / 0` (antes do código novo,
ninguém preencheu); `9`; `17 / 17`; `20 / 20 / 13`; RLS `true / false /
maike_backend_all` nas três; `0` grants; VEREDITO `APLICADA E CONFERIDA`. Mais:

- `get_advisors` (segurança e performance): nenhum alerta novo de segurança (as 3
  novas com RLS, sem FORCE, com a política do backend e sem grant para `anon`/
  `authenticated`) e nenhum "FK sem índice" para as 3 novas. **Esperado** e não é
  motivo para parar: índices recém-criados aparecem como INFO `unused_index` até a
  primeira consulta que os use; as FKs `criado_por`/`cancelado_por` (para
  `Usuario`) não têm índice próprio, como nas tabelas da D-PROD-200;
- opcional, no caminho A: `node scripts/deploy/preflight-schema.mjs` com a conexão
  de produção → exit 0 (nenhuma migration pendente; as colunas da D-PROD-201 em
  `COLUNAS_EXIGIDAS` presentes).

## 7. Merge

Com o §6 todo verde: mergear a PR da Fatia 3. Se a `main` andou, atualizar a branch
**sem migration nova** e mergear. A Vercel publica a `main`; o build não roda
migration.

## 8. Depois do deploy (proprietário)

1. Deploy READY na Vercel: `/api/native/health` com o `release` da `main` nova.
2. `/api/native/atividades/<id>/totais` sem sessão → 401.
3. Patrimônio: o formulário do bem mostra "Custo por hora/km" e o do tipo
   patrimonial "Teto de salto do medidor", vazios.
4. Lançamento de Atividades: abrir uma atividade aberta; o apontamento do dia mostra
   os blocos "Produtos" e "Máquinas", vazios. A primeira linha de verdade (com baixa
   de estoque) é do proprietário.

## 9. Reversão

- **Código:** o Instant Rollback da Vercel para o deploy anterior **é seguro** depois
  da aplicação (o código anterior não lê as colunas nem as tabelas novas). As linhas
  gravadas pelo código novo ficam no banco, sem uso, até ele voltar.
- **Banco, se for preciso voltar:** uma CONTRACT **nova**, com decisão e GO
  próprios, nunca editando esta: `DROP TABLE` das 3 novas (as fatias primeiro) e
  `DROP COLUMN` das 2 colunas. Só é exato enquanto as 3 estiverem vazias: com linha
  de produto gravada, a baixa de estoque dela (movimento e fatias FIFO) precisa ser
  estornada antes, com decisão do proprietário.
- **Rede de segurança:** o backup diário / PITR do Supabase do momento anterior à
  aplicação (anotar o horário no §11).

## 10. `RELEASE_BLOCKED`

- sem o GO-2 (no caminho B, sem o desvio da D-PROD-74 registrado para esta migration);
- validação local da PR não verde;
- alvo com `system_identifier` diferente;
- histórico diferente de 53/0 antes, a D-PROD-200 com outro checksum, ou a D-PROD-201
  já registrada (linha não revertida);
- qualquer `PARAR` no preflight;
- outra migration nova na mesma release;
- SHA-256 do arquivo diferente do pinado, ou classificador fora do esperado;
- conexão do runtime ausente ou apontando para outro banco no caminho A;
- ensaio local (§4.2) sem passar no `<SHA_APROVADO>`;
- horário de pico (Patrimônio e Abastecimento esperam menos de 1 s).

## 11. Registro da execução

| Campo | Valor |
|---|---|
| GO-1 e GO-2 | `<texto e data do GO do proprietário>` |
| Caminho | `<A ou B>` |
| `<SHA_APROVADO>` | `<sha>` |
| Verificação do SHA | `<CI da PR e validação local>` |
| Ensaio local (§4.2) | `<atividadeLinhasMigration.test.mjs n/n>` |
| Preflight (§4) | `<hora UTC; 53 / 0; 1; 0 / 0; 7; 84; travas; transações longas; veredito>` |
| Backup / PITR anterior | `<horário>` |
| Aplicação | `<data e hora UTC; checksum; applied_steps_count>` |
| Postcheck (§6) | `<54 / 0; 3 / 0; 87; 2; 9; 17 / 17; 20 / 20 / 13; RLS; grants; veredito>` |
| Alertas do Supabase | `<segurança / performance>` |
| Merge e deploy | `<PR e horário>` |
