# MAIKE — Tipo de Atividade com padrões e flags: runbook de release CONTRACT (D-PROD-195)

> **Estado: NÃO EXECUTADO. `SCHEMA_APPLIED_PROD: NÃO`.**
>
> Este documento é o plano. Cada passo exige o GO do proprietário e para no
> primeiro desvio com **`RELEASE_BLOCKED`**. Valores entre `<…>` são preenchidos
> na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-195](./DECISIONS.md) · Contrato:
[`MAIKE-TIPO-ATIVIDADE-DEFAULTS-CONTRATO.md`](./MAIKE-TIPO-ATIVIDADE-DEFAULTS-CONTRATO.md) · Relatório:
[`MAIKE-TIPO-ATIVIDADE-DEFAULTS-REPORT.md`](./MAIKE-TIPO-ATIVIDADE-DEFAULTS-REPORT.md).
Precedentes executados: [`MAIKE-CADCURVAGANHO-MENSAL-RUNBOOK-RELEASE.md`](./MAIKE-CADCURVAGANHO-MENSAL-RUNBOOK-RELEASE.md)
(a CONTRACT anterior, caminho B) e [`MAIKE-TIPO-TAREFA-DROP-COLUNAS-RUNBOOK-RELEASE.md`](./MAIKE-TIPO-TAREFA-DROP-COLUNAS-RUNBOOK-RELEASE.md)
(CONTRACT com guarda, caminho B depois de o caminho A fechar). Molde:
[`MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md) (§1 explica por que nunca
`apply_migration` e nunca DDL solto).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261114200000_tipo_atividade_defaults` |
| Natureza | **CONTRACT** (quinta exceção fechada à D-PROD-72 item 3 e à D-PROD-107 R7, depois da D-PROD-162, da D-PROD-183, da D-PROD-187 e da D-PROD-194), numa transação, e **aditiva**: em `"TipoAtividade"`, 5 colunas anuláveis (`categoria` `VARCHAR(24)`, `centro_custo_padrao_id`, `centro_resultado_padrao_id`, `unidade_producao_id` `VARCHAR(64)` e `coeficiente_padrao` `DECIMAL(14,4)`), 8 flags `BOOLEAN NOT NULL DEFAULT false` (`exige_area`, `exige_safra`, `exige_maquina`, `permite_implemento`, `permite_produto`, `permite_servico`, `permite_mao_obra`, `exige_producao`), 3 FKs compostas pelo tenant `ON DELETE RESTRICT ON UPDATE CASCADE` (→ `CentroCusto`, `CentroResultado`, `UnidadeMedida` em (`cliente_id`, `id`)), 2 CHECKs (categoria na lista fechada de 9; coeficiente > 0) e 3 índices não-únicos começando por `cliente_id` |
| Por que CONTRACT, sendo aditiva | a allowlist EXPAND recusa, em tabela antiga, coluna `NOT NULL DEFAULT`, FK para tabela antiga e CHECK. O caminho é o dos alargamentos de CHECK da D-PROD-162: guarda pinada como 1ª instrução, depois exatamente as 18 instruções pinadas (13 `ADD COLUMN`, 3 FKs, 2 CHECKs, nesta ordem) e, no resto, os 3 `CREATE INDEX` pela allowlist EXPAND |
| O que se perde | **nada**: nenhum `DROP`, `DELETE`, `UPDATE` ou `TRUNCATE`. As linhas que existem leem `false` nas flags e `NULL` nos padrões (DEFAULT constante: o PostgreSQL 11+ não reescreve a tabela) |
| O que não muda | nenhuma tabela é criada nem apagada; nenhuma coluna existente é tocada; as linhas, a RLS, as políticas e os grants de `TipoAtividade` ficam iguais; `CentroCusto`, `CentroResultado` e `UnidadeMedida` só ganham a FK que entra (nenhuma coluna, linha ou índice deles muda) |
| Guarda da própria migration | recusa (e desfaz tudo) se `TipoAtividade` não existir; se qualquer das 13 colunas, das 5 constraints ou dos 3 índices novos já existir; ou se `CentroCusto`, `CentroResultado` ou `UnidadeMedida` não existir ou não tiver índice único exatamente em (`cliente_id`, `id`). Toda mensagem começa com `tipo_atividade_defaults:` |
| SHA-256 do arquivo (`MIGRATIONS_APROVADAS`) | `b65d4f08de5f587cd69b893bcb2626df5cc775e1f4ca5b68fdaac863aab55dbf` |
| Guarda pinada (`MIGRATIONS_CONTRACT_APROVADAS`) | `e15780190baf9494f20535c2e3ced21eb20ea6b8f362eeac0b2477dcf6dab3b0`; `drop: []`; `literais_guarda`: `TipoAtividade`, `CentroCusto`, `CentroResultado`, `UnidadeMedida`; 18 `alter_antigas` |
| Classificador (`classificarMigrations`) | `modo: CONTRACT`, `violacoes: []`, `tabelas_novas: []`, `colunas_novas_em_tabelas_antigas: []` (as 13 colunas ficam no descritor da CONTRACT); `contract[0]`: `decisao: "D-PROD-195"`, `colunas_adicionadas` (13), `constraints_adicionadas` (5), `constraints_alargadas: []`, `tabelas_removidas: []`, `colunas_removidas: []` |
| `_prisma_migrations` | antes **49** concluídas, 0 em aberto (a última, a curva mensal da D-PROD-194, concluída em 2026-11-14 às 13:29:18 UTC); depois **50**. Recontar no §4 se algo mais for aplicado antes |
| Tabelas em `public` | **85** antes e depois |

**Sem janela de erro para o código de hoje.** A produção roda o código anterior à
D-PROD-195. O Prisma Client dele lista só as 9 colunas antigas de `TipoAtividade`:
coluna a mais, anulável ou com DEFAULT, não quebra `SELECT`, `INSERT` nem
`UPDATE`. Conferido localmente: o Prisma Client gerado do schema da `main`
(`a65ea468`) rodou `create`, `findMany` com `include`, `findUnique`, `update` e
`delete` de `TipoAtividade` num PostgreSQL já com as 13 colunas, sem erro, e a
linha criada por ele leu `false` nas flags e `NULL` nos padrões. Nenhum padrão é
gravado antes do código novo, então nenhuma FK nova é exercida antes do merge.
*Instant Rollback* da Vercel para um deploy anterior continua seguro depois da
aplicação.

**Por que ANTES do merge (D-PROD-72 item 1):** o código novo sem a migration dá
500 (`P2022`, coluna inexistente) em tudo o que lê `TipoAtividade`: a tela Tipos
de Atividade, `/tipos-atividade` e os fluxos do Apontamento de Atividade que leem
o tipo. E o `premerge-migrate` só enxerga a migration como "nova" enquanto ela
não está na `main`: depois do merge o `--contract D-PROD-195` vira
`CONTRACT_INESPERADO` e o caminho A fecha (aconteceu na D-PROD-183). A ordem é:
aplicar (§5) → postcheck (§6) → merge (§7).

**Travas durante a transação (conferido no PostgreSQL 16 local, `pg_locks` da
própria sessão antes do `COMMIT`):** `ACCESS EXCLUSIVE` em `"TipoAtividade"` (a
guarda trava antes de conferir), que **bloqueia até leitura** da tabela;
`SHARE ROW EXCLUSIVE` em `"CentroCusto"`, `"CentroResultado"` e `"UnidadeMedida"`
(o `ADD CONSTRAINT … FOREIGN KEY`), que bloqueia escrita nelas (cadastro de
centros e unidades) mas não leitura; e a trava consultiva `72707369`. A transação
leva menos de 1 s (a tabela é pequena e os padrões nascem nulos: a validação das
FKs e dos CHECKs é imediata). Quem tocar `TipoAtividade` nesse intervalo (tela de
tipos, apontamento de atividade) espera o `COMMIT`. Se uma transação longa
estiver segurando alguma dessas tabelas, o `lock_timeout` de 5 s estoura e a
transação aborta **sem aplicar nada**. Por isso: **aplicar fora de pico** e
conferir no preflight as travas e as transações longas.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** numa máquina protegida, com
  `MIGRATION_DATABASE_URL` (direta ou de sessão na 5432, nunca o pooler 6543),
  `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360` e a conexão do
  **runtime** (`DATABASE_URL` ou `POSTGRES_PRISMA_URL`) apontando para o MESMO
  banco (o `deploy:migrate` confere as duas). Por ser CONTRACT, a release é
  **isolada** (esta é a única migration nova; senão `CONTRACT_NAO_ISOLADO`) e exige
  a decisão exata:
  ```bash
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>                                  # ANÁLISE LOCAL OK (CONTRACT D-PROD-195: …)
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo --contract D-PROD-195
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar --contract D-PROD-195   # repassa MIGRATION_CONTRACT_AUTORIZADO=D-PROD-195
  ```
  A guarda põe o próprio `lock_timeout` (5 s); não é preciso parâmetro na URL.
- **B — conector Supabase, uma única `execute_sql` (§5):** só com autorização
  **escrita e específica do proprietário para esta migration**, registrada como
  desvio da D-PROD-74. Nunca presumida de releases anteriores (D-PROD-183,
  D-PROD-194) nem de autorização genérica.
- O `npm run deploy:migrate` à mão e o `release-migrate.yml` **recusam** esta
  migration (`DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED`) enquanto ela estiver
  pendente no alvo: só o `premerge-migrate --aplicar --contract D-PROD-195`
  passa `MIGRATION_CONTRACT_AUTORIZADO`. A mensagem do runner diz "ela apaga
  dados" para toda CONTRACT; esta não apaga, mas a barreira vale igual.

## 2. Pré-requisitos e GOs

**Pré-requisitos (todos antes da aplicação):**
- a PR foi revista pelo proprietário e marcada como pronta com a autorização dele;
- a branch está atualizada com a `main`, a PR está `mergeable` e esta é a **única**
  migration nova da release;
- a verificação do `<SHA_APROVADO>` (40 hex) está verde: CI ou, com o GitHub
  Actions pausado, a análise local registrada no §11 (como na D-PROD-194);
- nenhuma outra migration entrou na `main` nem foi aplicada em produção depois do
  preflight; se entrou, atualizar a branch, recontar o §4 e repetir o ensaio.

**GOs (nenhum está coberto hoje):**

| GO | O quê | Situação |
|---|---|---|
| GO-1 | rodar o preflight **só leitura** em produção (§4) | **não coberto**: pedir ao proprietário |
| GO-2 | aplicar a migration CONTRACT (§5) e mergear em seguida; no caminho B, com o desvio da D-PROD-74 escrito para ESTA migration | **não coberto**: pedir ao proprietário com o §11 preenchido (preflight, ensaio, caminho A ou B, janela fora de pico) |

## 3. Ordem

GO-1 → preflight §4 (anotar no §11) → ensaio local §4.2 com o arquivo do SHA →
pré-requisitos do §2 → GO-2 → logo antes: repetir o preflight (as linhas 2, 3,
12 e 13 de novo) → aplicação §5 → **postcheck** §6 (só leitura) e alertas do
Supabase → merge §7 → deploy da `main` READY → conferência §8.

## 4. Preflight (somente leitura; `SELECT` no conector ou papel de leitura)

### 4.1 Uma consulta, com veredito

Cole TUDO e rode. Só `SELECT`. Qualquer `PARAR` → `RELEASE_BLOCKED`.

<!-- sql:preflight -->
```sql
-- MAIKE · D-PROD-195 · PREFLIGHT (somente leitura). Cole TUDO e rode. Qualquer PARAR = não aplicar.
WITH
esperado AS (SELECT '7692130048193495360'::text AS sid),
mig AS (
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS abertas,
         count(*) FILTER (WHERE migration_name = '20261114200000_tipo_atividade_defaults' AND rolled_back_at IS NULL) AS esta,
         count(*) FILTER (WHERE migration_name = '20261113100000_tipo_atividade_cadastro'
                            AND checksum = '5a0ded9c62f108c818c5796c2fe9d116faaceaf62bc4da6312562ec74d3a724e'
                            AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS cadastro,
         count(*) FILTER (WHERE migration_name = '20261114100000_cadcurvaganho_mensal'
                            AND checksum = 'a18b2845815a637398ccd8d1e0f9cbcbad1bab8e8b628e988d26cf09c302953c'
                            AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS anterior
    FROM public._prisma_migrations
),
tipo AS (SELECT to_regclass('public."TipoAtividade"')::oid AS oid),
achadas AS (
  SELECT (SELECT string_agg(a.attname::text, ', ' ORDER BY a.attname) FROM tipo JOIN pg_attribute a ON a.attrelid = tipo.oid
           WHERE a.attnum > 0 AND NOT a.attisdropped
             AND a.attname IN ('categoria', 'centro_custo_padrao_id', 'centro_resultado_padrao_id', 'unidade_producao_id', 'coeficiente_padrao',
                               'exige_area', 'exige_safra', 'exige_maquina', 'permite_implemento', 'permite_produto', 'permite_servico',
                               'permite_mao_obra', 'exige_producao')) AS colunas,
         (SELECT string_agg(k.conname::text, ', ' ORDER BY k.conname) FROM tipo JOIN pg_constraint k ON k.conrelid = tipo.oid
           WHERE k.conname IN ('TipoAtividade_cliente_id_centro_custo_padrao_id_fkey', 'TipoAtividade_cliente_id_centro_resultado_padrao_id_fkey',
                               'TipoAtividade_cliente_id_unidade_producao_id_fkey', 'TipoAtividade_categoria_check',
                               'TipoAtividade_coeficiente_padrao_check')) AS constraints,
         (SELECT string_agg(c.relname::text, ', ' ORDER BY c.relname) FROM pg_class c
           WHERE c.relnamespace = 'public'::regnamespace
             AND c.relname IN ('TipoAtividade_cliente_id_centro_custo_padrao_id_idx', 'TipoAtividade_cliente_id_centro_resultado_padrao_id_idx',
                               'TipoAtividade_cliente_id_unidade_producao_id_idx')) AS indices
),
alvos AS (
  SELECT t.nome, to_regclass(format('public.%I', t.nome))::oid AS oid
    FROM unnest(ARRAY['CentroCusto', 'CentroResultado', 'UnidadeMedida']) AS t(nome)
),
alvos_ok AS (
  SELECT count(*) AS n, coalesce(string_agg(a.nome, ', ' ORDER BY a.nome), '-') AS nomes FROM alvos a
   WHERE EXISTS (
     SELECT 1 FROM pg_index i
      WHERE i.indrelid = a.oid AND i.indisunique AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts = 2
        AND (SELECT array_agg(att.attname::text ORDER BY k.ord)
               FROM unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_attribute att ON att.attrelid = a.oid AND att.attnum = k.attnum
              WHERE k.ord <= 2) = ARRAY['cliente_id', 'id'])
),
tabelas AS (SELECT count(*) AS n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')),
seguranca AS (
  SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forcar,
         coalesce((SELECT string_agg(p.polname::text, ', ' ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid = c.oid), '-') AS politicas
    FROM tipo JOIN pg_class c ON c.oid = tipo.oid
),
travas AS (
  SELECT count(*) AS n FROM pg_locks l
   WHERE l.locktype = 'relation' AND l.pid <> pg_backend_pid()
     AND l.relation IN (SELECT oid FROM tipo UNION ALL SELECT oid FROM alvos)
),
longas AS (
  SELECT count(*) AS n FROM pg_stat_activity
   WHERE datname = current_database() AND pid <> pg_backend_pid() AND xact_start IS NOT NULL AND now() - xact_start > interval '30 seconds'
),
base(ordem, item, valor, esperado, status) AS (
  SELECT 1, 'alvo: system_identifier', (SELECT system_identifier::text FROM pg_control_system()), (SELECT sid FROM esperado),
         CASE WHEN (SELECT system_identifier::text FROM pg_control_system()) = (SELECT sid FROM esperado) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 2, 'migrations concluídas / em aberto', (SELECT concluidas || ' / ' || abertas FROM mig), '49 / 0',
         CASE WHEN (SELECT concluidas = 49 AND abertas = 0 FROM mig) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 3, '20261114200000_tipo_atividade_defaults já registrada', (SELECT esta::text FROM mig), '0',
         CASE WHEN (SELECT esta FROM mig) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 4, 'TipoAtividade (D-PROD-182) e curva mensal (D-PROD-194) concluídas com o checksum do repositório',
         (SELECT cadastro || ' / ' || anterior FROM mig), '1 / 1',
         CASE WHEN (SELECT cadastro = 1 AND anterior = 1 FROM mig) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 5, 'colunas novas já em TipoAtividade', coalesce((SELECT colunas FROM achadas), '-'), '-',
         CASE WHEN (SELECT oid FROM tipo) IS NULL THEN 'PARAR (TipoAtividade não existe)'
              WHEN (SELECT colunas FROM achadas) IS NULL THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 6, 'constraints novas já em TipoAtividade', coalesce((SELECT constraints FROM achadas), '-'), '-',
         CASE WHEN (SELECT constraints FROM achadas) IS NULL THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 7, 'índices novos já em public', coalesce((SELECT indices FROM achadas), '-'), '-',
         CASE WHEN (SELECT indices FROM achadas) IS NULL THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 8, 'alvos das FKs com índice único exatamente em (cliente_id, id)', (SELECT nomes FROM alvos_ok), 'CentroCusto, CentroResultado, UnidadeMedida',
         CASE WHEN (SELECT n FROM alvos_ok) = 3 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 9, 'tabelas em public', (SELECT n::text FROM tabelas), '85',
         CASE WHEN (SELECT n FROM tabelas) = 85 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 10, 'TipoAtividade: RLS / FORCE / políticas',
         coalesce((SELECT rls || ' / ' || forcar || ' / ' || politicas FROM seguranca), '-'), 'true / false / (anote; o postcheck repete)',
         CASE WHEN (SELECT rls AND NOT forcar FROM seguranca) THEN 'CONFIRA' ELSE 'PARAR' END
  UNION ALL
  SELECT 11, 'TipoAtividade: linhas (anote; o postcheck repete)',
         (SELECT count(*)::text FROM public."TipoAtividade"), '-', 'CONFIRA'
  UNION ALL
  SELECT 12, 'travas de outras sessões em TipoAtividade e nos 3 alvos, agora', (SELECT n::text FROM travas), '0',
         CASE WHEN (SELECT n FROM travas) = 0 THEN 'OK' ELSE 'ATENÇÃO (repita fora de pico)' END
  UNION ALL
  SELECT 13, 'transações abertas há mais de 30 s', (SELECT n::text FROM longas), '0',
         CASE WHEN (SELECT n FROM longas) = 0 THEN 'OK' ELSE 'ATENÇÃO (a trava espera 5 s e desiste)' END
)
SELECT item, valor, esperado, status FROM (
  SELECT * FROM base
  UNION ALL
  SELECT 999, 'VEREDITO',
         CASE WHEN EXISTS (SELECT 1 FROM base WHERE status LIKE 'PARAR%') THEN 'PARAR: há linha PARAR acima'
              ELSE 'PRONTO PARA APLICAR (confira as linhas CONFIRA/ATENÇÃO)' END, '-', '-'
) x ORDER BY ordem;
```
<!-- /sql:preflight -->

| Linha | Esperado hoje |
|---|---|
| alvo | `7692130048193495360` |
| migrations | `49 / 0` |
| esta migration registrada | `0` |
| D-PROD-182 e D-PROD-194 com o checksum do repositório | `1 / 1` |
| colunas, constraints e índices novos já presentes | `-` nas três |
| alvos das FKs | `CentroCusto, CentroResultado, UnidadeMedida` |
| tabelas em `public` | `85` |
| RLS / FORCE / políticas de `TipoAtividade` | `true / false / maike_backend_all` (anotar; o §6 repete) |
| linhas de `TipoAtividade` | anotar `<N_TIPOS>` (o §6 repete) |
| travas de outras sessões e transações longas | `0` e `0` (senão `ATENÇÃO`: esperar e repetir fora de pico) |

E, localmente, no `<SHA_APROVADO>`:
`sha256sum backend/prisma/migrations/20261114200000_tipo_atividade_defaults/migration.sql`
igual ao pinado, e a análise local do `premerge-migrate` (§1) com `modo: CONTRACT`,
`contract[0].decisao = "D-PROD-195"`, `colunas_adicionadas` com as 13 colunas,
`constraints_adicionadas` com as 5 constraints e `violacoes: []`.

### 4.2 Ensaio local (com o arquivo exato do `<SHA_APROVADO>`)

Automatizado em `backend/tests/tipoAtividadeDefaultsMigration.test.mjs`, só contra
PostgreSQL local, em bancos próprios criados e apagados pelo teste. Ele roda
**este** preflight, **este** envelope do caminho B e **este** postcheck (lidos
deste arquivo, entre os marcadores `sql:…`), trocando só o `system_identifier` de
produção pelo local:

- partida: as 49 migrations de nome anterior a esta, pelo Prisma; 2 clientes com
  grupos, tipos de atividade (um inativo), centros e unidades; preflight `PRONTO`;
- RED (todos recusam e nada muda): `TipoAtividade` ausente, coluna, constraint ou
  índice novo já existente, alvo ausente, alvo sem índice único em
  (`cliente_id`, `id`) (sem índice, invertido, parcial, não-único), trava
  concorrente (`55P03` em ~5 s); e o `deploy:migrate` com a conferência de alvo
  exigida e sem `MIGRATION_CONTRACT_AUTORIZADO=D-PROD-195` →
  `DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED` antes de qualquer DDL;
- GREEN pelo runner oficial (conferência exigida, decisão exata) e GREEN pelo
  envelope do caminho B: 50/0, as 13 colunas, as 5 constraints, os 3 índices,
  linhas antigas intactas (`false`/`NULL`), FKs (mesmo cliente aceita, outro
  cliente recusa, unidade usada não sai), CHECKs, unicidade mantida,
  `migrate diff` vazio, postcheck `APLICADA`; reaplicar o `migration.sql` e
  repetir o envelope são recusados sem mudar nada.

Registrar o resultado no §11.

## 5. Aplicação — só com o GO-2 e o §2 cumprido

### Caminho A (padrão)

Os comandos do §1, com o `<SHA_APROVADO>`. O `--verificar-alvo` tem de terminar
com `ALVO VERIFICADO — 1 pendente(s) do manifesto`.

### Caminho B (conector, uma `execute_sql`, só com GO escrito para ESTA migration)

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
              WHERE migration_name = '20261114200000_tipo_atividade_defaults' AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)
    INTO n_ok, n_aberta FROM _prisma_migrations;
  IF n_ok <> 49 OR n_aberta <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % em aberto', n_ok, n_aberta;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261113100000_tipo_atividade_cadastro'
                    AND checksum = '5a0ded9c62f108c818c5796c2fe9d116faaceaf62bc4da6312562ec74d3a724e'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: TipoAtividade (D-PROD-182) ausente ou com checksum divergente';
  END IF;
END $alvo$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'b65d4f08de5f587cd69b893bcb2626df5cc775e1f4ca5b68fdaac863aab55dbf', now(),
        '20261114200000_tipo_atividade_defaults', NULL, NULL, now(), 1);
COMMIT;
```
<!-- /sql:caminho-b -->

- O `migration.sql` não tem `BEGIN`/`COMMIT` próprios e não tem nenhum `DROP`,
  `DELETE`, `UPDATE` ou `TRUNCATE`.
- O `checksum` do `INSERT` é o SHA-256 do arquivo: com outro valor o Prisma acusa
  divergência e o `premerge-migrate` recusa as releases seguintes
  (`PREMERGE_MIGRATIONS_NAO_COMPROVADAS`).
- Qualquer falha desfaz tudo, inclusive o `INSERT` em `_prisma_migrations`.

### 5.1 Falha no caminho A (guarda, `55P03` ou *deadlock*)

1. Nada do DDL fica; a linha da migration fica com `finished_at` NULL.
2. Conferir pelo preflight que as colunas novas não existem.
3. Com a conexão de **produção** explícita (o schema lê `DATABASE_URL`):
   `DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate resolve --rolled-back 20261114200000_tipo_atividade_defaults --schema backend/prisma/schema.prisma`.
4. Eliminar a causa (a mensagem da guarda diz qual) e pedir novo GO.
5. Uma tentativa resolvida (`rolled_back_at` preenchido) não bloqueia o envelope
   do caminho B; uma linha ainda aberta bloqueia (resolver primeiro). No §6,
   aceitar exatamente essa linha revertida.

### 5.2 Falha no caminho B

Nada é aplicado (uma transação só). Repetir o preflight (linhas 2, 3 e 5 a 7
iguais às de antes), eliminar a causa e pedir novo GO.

## 6. Postcheck (antes do merge; só leitura)

Qualquer `PARAR`: **não mergear** e chamar o proprietário.

<!-- sql:postcheck -->
```sql
-- MAIKE · D-PROD-195 · POSTCHECK (somente leitura). Cole TUDO e rode. Esperado: tudo OK/CONFIRA e VEREDITO APLICADA.
WITH
esperado AS (SELECT '7692130048193495360'::text AS sid),
mig AS (
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS abertas,
         count(*) FILTER (WHERE migration_name = '20261114200000_tipo_atividade_defaults'
                            AND checksum = 'b65d4f08de5f587cd69b893bcb2626df5cc775e1f4ca5b68fdaac863aab55dbf'
                            AND finished_at IS NOT NULL AND rolled_back_at IS NULL AND applied_steps_count = 1) AS esta
    FROM public._prisma_migrations
),
tipo AS (SELECT to_regclass('public."TipoAtividade"')::oid AS oid),
colunas_esperadas(nome, tipo, nao_nula, padrao) AS (VALUES
  ('categoria', 'character varying(24)', false, NULL::text),
  ('centro_custo_padrao_id', 'character varying(64)', false, NULL),
  ('centro_resultado_padrao_id', 'character varying(64)', false, NULL),
  ('unidade_producao_id', 'character varying(64)', false, NULL),
  ('coeficiente_padrao', 'numeric(14,4)', false, NULL),
  ('exige_area', 'boolean', true, 'false'),
  ('exige_safra', 'boolean', true, 'false'),
  ('exige_maquina', 'boolean', true, 'false'),
  ('permite_implemento', 'boolean', true, 'false'),
  ('permite_produto', 'boolean', true, 'false'),
  ('permite_servico', 'boolean', true, 'false'),
  ('permite_mao_obra', 'boolean', true, 'false'),
  ('exige_producao', 'boolean', true, 'false')
),
colunas AS (
  SELECT a.attname::text AS nome, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull AS nao_nula, pg_get_expr(d.adbin, d.adrelid) AS padrao
    FROM tipo JOIN pg_attribute a ON a.attrelid = tipo.oid
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   WHERE a.attnum > 0 AND NOT a.attisdropped
),
colunas_erradas AS (
  SELECT e.nome FROM colunas_esperadas e LEFT JOIN colunas c USING (nome)
   WHERE c.nome IS NULL OR c.tipo <> e.tipo OR c.nao_nula <> e.nao_nula OR c.padrao IS DISTINCT FROM e.padrao
),
constraints_esperadas(nome, tipo, definicao) AS (VALUES
  ('TipoAtividade_cliente_id_centro_custo_padrao_id_fkey', 'f',
   'FOREIGN KEY (cliente_id, centro_custo_padrao_id) REFERENCES "CentroCusto"(cliente_id, id) ON UPDATE CASCADE ON DELETE RESTRICT'),
  ('TipoAtividade_cliente_id_centro_resultado_padrao_id_fkey', 'f',
   'FOREIGN KEY (cliente_id, centro_resultado_padrao_id) REFERENCES "CentroResultado"(cliente_id, id) ON UPDATE CASCADE ON DELETE RESTRICT'),
  ('TipoAtividade_cliente_id_unidade_producao_id_fkey', 'f',
   'FOREIGN KEY (cliente_id, unidade_producao_id) REFERENCES "UnidadeMedida"(cliente_id, id) ON UPDATE CASCADE ON DELETE RESTRICT'),
  ('TipoAtividade_categoria_check', 'c', NULL::text),
  ('TipoAtividade_coeficiente_padrao_check', 'c', NULL)
),
constraints AS (
  SELECT k.conname::text AS nome, k.contype::text AS tipo, k.convalidated AS validada, pg_get_constraintdef(k.oid) AS definicao
    FROM tipo JOIN pg_constraint k ON k.conrelid = tipo.oid
),
constraints_erradas AS (
  SELECT e.nome FROM constraints_esperadas e LEFT JOIN constraints c USING (nome)
   WHERE c.nome IS NULL OR c.tipo <> e.tipo OR NOT c.validada
      OR (e.definicao IS NOT NULL AND c.definicao <> e.definicao)
      -- categoria: exatamente os 9 valores (18 aspas = 9 literais), cada um presente.
      OR (e.nome = 'TipoAtividade_categoria_check'
          AND NOT (c.definicao LIKE 'CHECK (((categoria)::text = ANY (%'
                   AND length(c.definicao) - length(replace(c.definicao, '''', '')) = 18
                   AND (SELECT count(*) FROM unnest(ARRAY['PREPARO_SOLO', 'PLANTIO', 'TRATO_CULTURAL', 'APLICACAO', 'COLHEITA', 'PASTAGEM',
                                                         'BENFEITORIA', 'MANEJO_ANIMAL', 'OUTROS']) v
                         WHERE c.definicao LIKE '%''' || v || '''%') = 9))
      -- coeficiente: estritamente maior que zero.
      OR (e.nome = 'TipoAtividade_coeficiente_padrao_check' AND c.definicao <> 'CHECK ((coeficiente_padrao > (0)::numeric))')
),
indices_esperados(nome, definicao) AS (VALUES
  ('TipoAtividade_cliente_id_centro_custo_padrao_id_idx',
   'CREATE INDEX "TipoAtividade_cliente_id_centro_custo_padrao_id_idx" ON public."TipoAtividade" USING btree (cliente_id, centro_custo_padrao_id)'),
  ('TipoAtividade_cliente_id_centro_resultado_padrao_id_idx',
   'CREATE INDEX "TipoAtividade_cliente_id_centro_resultado_padrao_id_idx" ON public."TipoAtividade" USING btree (cliente_id, centro_resultado_padrao_id)'),
  ('TipoAtividade_cliente_id_unidade_producao_id_idx',
   'CREATE INDEX "TipoAtividade_cliente_id_unidade_producao_id_idx" ON public."TipoAtividade" USING btree (cliente_id, unidade_producao_id)'),
  -- o unique de negócio da D-PROD-182 continua.
  ('TipoAtividade_cliente_id_grupo_atividade_id_nome_tipo_key',
   'CREATE UNIQUE INDEX "TipoAtividade_cliente_id_grupo_atividade_id_nome_tipo_key" ON public."TipoAtividade" USING btree (cliente_id, grupo_atividade_id, nome_tipo)')
),
indices_errados AS (
  SELECT e.nome FROM indices_esperados e LEFT JOIN pg_indexes x ON x.schemaname = 'public' AND x.indexname = e.nome
   WHERE x.indexdef IS DISTINCT FROM e.definicao
),
tabelas AS (SELECT count(*) AS n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')),
seguranca AS (
  SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forcar,
         coalesce((SELECT string_agg(p.polname::text, ', ' ORDER BY p.polname) FROM pg_policy p WHERE p.polrelid = c.oid), '-') AS politicas
    FROM tipo JOIN pg_class c ON c.oid = tipo.oid
),
grants AS (
  SELECT count(*) AS n FROM information_schema.role_table_grants
   WHERE table_schema = 'public' AND table_name = 'TipoAtividade' AND grantee IN ('anon', 'authenticated', 'PUBLIC')
),
-- Lido por to_jsonb: a consulta roda (e aponta PARAR acima) mesmo antes da migration, sem as colunas.
linhas_tipo AS (
  SELECT count(*) AS total,
         count(*) FILTER (WHERE EXISTS (
           SELECT 1 FROM jsonb_each(to_jsonb(t)) j
            WHERE (j.key IN ('exige_area', 'exige_safra', 'exige_maquina', 'permite_implemento', 'permite_produto', 'permite_servico',
                             'permite_mao_obra', 'exige_producao') AND j.value <> 'false'::jsonb)
               OR (j.key IN ('categoria', 'centro_custo_padrao_id', 'centro_resultado_padrao_id', 'unidade_producao_id', 'coeficiente_padrao')
                   AND j.value <> 'null'::jsonb))) AS preenchidas
    FROM public."TipoAtividade" t
),
base(ordem, item, valor, esperado, status) AS (
  SELECT 1, 'alvo: system_identifier', (SELECT system_identifier::text FROM pg_control_system()), (SELECT sid FROM esperado),
         CASE WHEN (SELECT system_identifier::text FROM pg_control_system()) = (SELECT sid FROM esperado) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 2, '20261114200000_tipo_atividade_defaults concluída (checksum pinado, applied_steps_count 1)', (SELECT esta::text FROM mig), '1',
         CASE WHEN (SELECT esta FROM mig) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 3, 'migrations concluídas / em aberto', (SELECT concluidas || ' / ' || abertas FROM mig), '50 / 0',
         CASE WHEN (SELECT concluidas = 50 AND abertas = 0 FROM mig) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 4, 'as 13 colunas com tipo, nulidade e DEFAULT exatos', coalesce((SELECT 'erradas: ' || string_agg(nome, ', ' ORDER BY nome) FROM colunas_erradas), '13'), '13',
         CASE WHEN NOT EXISTS (SELECT 1 FROM colunas_erradas) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 5, 'as 5 constraints (3 FK RESTRICT/CASCADE, 2 CHECK), validadas', coalesce((SELECT 'erradas: ' || string_agg(nome, ', ' ORDER BY nome) FROM constraints_erradas), '5'), '5',
         CASE WHEN NOT EXISTS (SELECT 1 FROM constraints_erradas) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 6, 'os 3 índices novos e o unique (cliente_id, grupo_atividade_id, nome_tipo)', coalesce((SELECT 'errados: ' || string_agg(nome, ', ' ORDER BY nome) FROM indices_errados), '4'), '4',
         CASE WHEN NOT EXISTS (SELECT 1 FROM indices_errados) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 7, 'tabelas em public', (SELECT n::text FROM tabelas), '85',
         CASE WHEN (SELECT n FROM tabelas) = 85 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 8, 'TipoAtividade: RLS / FORCE / políticas',
         coalesce((SELECT rls || ' / ' || forcar || ' / ' || politicas FROM seguranca), '-'), 'true / false / (igual ao preflight)',
         CASE WHEN (SELECT rls AND NOT forcar FROM seguranca) THEN 'CONFIRA' ELSE 'PARAR' END
  UNION ALL
  SELECT 9, 'TipoAtividade: grants para anon/authenticated/PUBLIC', (SELECT n::text FROM grants), '0',
         CASE WHEN (SELECT n FROM grants) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 10, 'TipoAtividade: linhas (igual ao preflight)', (SELECT total::text FROM linhas_tipo), '-', 'CONFIRA'
  UNION ALL
  SELECT 11, 'TipoAtividade: linhas com flag true ou padrão preenchido', (SELECT preenchidas::text FROM linhas_tipo), '0',
         CASE WHEN (SELECT preenchidas FROM linhas_tipo) = 0 THEN 'OK' ELSE 'CONFIRA (o código novo já gravou?)' END
)
SELECT item, valor, esperado, status FROM (
  SELECT * FROM base
  UNION ALL
  SELECT 999, 'VEREDITO',
         CASE WHEN EXISTS (SELECT 1 FROM base WHERE status LIKE 'PARAR%') THEN 'PARAR: há linha PARAR acima; não mergear'
              ELSE 'APLICADA E CONFERIDA (confira as linhas CONFIRA com o preflight)' END, '-', '-'
) x ORDER BY ordem;
```
<!-- /sql:postcheck -->

Esperado: `1`; `50 / 0`; `13`; `5`; `4`; `85`; RLS/FORCE/políticas e linhas
**iguais às do preflight**; `0` grants; `0` linhas preenchidas; VEREDITO
`APLICADA E CONFERIDA`. Mais:

- `get_advisors` (segurança e performance): nenhum alerta novo para
  `TipoAtividade`, `CentroCusto`, `CentroResultado` ou `UnidadeMedida` (as 3 FKs
  novas têm índice próprio, então não entram em "FK sem índice");
- opcional, no caminho A: `node scripts/deploy/preflight-schema.mjs` com a conexão
  de produção → exit 0 (nenhuma migration pendente).

## 7. Merge

Com o §6 todo verde: atualizar a branch se a `main` andou (sem migration nova) e
mergear. A Vercel publica a `main`; o build não roda migration.

## 8. Depois do deploy (proprietário)

1. Deploy READY na Vercel: `/api/native/health` com o `release` da `main` nova.
2. `/api/native/tipos-atividade` sem sessão → 401.
3. Tela Tipos de Atividade: a lista carrega com a coluna Categoria e um registro
   abre no formulário com as 3 seções. A primeira escrita (um tipo de teste com
   categoria, centros, unidade e flags) é do proprietário.
4. Abrir um Apontamento de Atividade existente, sem salvar.

## 9. Reversão

Não há reversão automática. Desfazer seria uma CONTRACT nova (`DROP CONSTRAINT`/
`DROP COLUMN`, com decisão e GO próprios), nunca editando esta. Os valores que o
código novo gravar nos padrões e nas flags só existem nessas colunas.

Rollback de código, sim: o código anterior convive com as colunas (§0). Com
padrões gravados, a FK `RESTRICT` continua barrando apagar a unidade usada como
padrão; o código anterior traduz esse erro como o 403 genérico de hoje (o 409
`UNIDADE_MEDIDA_DELETE_BLOCKED` vem com a D-PROD-195).

## 10. `RELEASE_BLOCKED`

- sem GO-1 ou GO-2 (no caminho B, sem o desvio da D-PROD-74 escrito para esta migration);
- alvo com `system_identifier` diferente;
- histórico diferente de 49/0 antes, ou a D-PROD-195 já registrada (linha não revertida);
- qualquer `PARAR` no preflight;
- outra migration nova na mesma release (`CONTRACT_NAO_ISOLADO`);
- SHA-256 do arquivo diferente do pinado, ou classificador fora do esperado;
- conexão do runtime ausente ou apontando para outro banco no caminho A;
- ensaio local (§4.2) sem passar no `<SHA_APROVADO>`.

## 11. Registro da execução

| Campo | Valor |
|---|---|
| GO-1 e GO-2 | `<palavras literais do proprietário>` |
| Caminho | `<A ou B>` |
| `<SHA_APROVADO>` | `<40 hex>` |
| Verificação do SHA | `<CI ou análise local: comandos e contagens>` |
| Ensaio local (§4.2) | `<n/n>` |
| Preflight (§4) | `<hora UTC>`; `<49 / 0>`; linhas de `TipoAtividade` `<N_TIPOS>`; RLS/políticas `<…>`; travas `<0>`; transações longas `<0>` |
| Aplicação | `<hora UTC do finished_at>` |
| Postcheck (§6) | `<VEREDITO>`; `<50 / 0>`; linhas `<N_TIPOS>` |
| Alertas do Supabase | `<segurança / performance>` |
| Merge e deploy | `<PR, commit, hora>` |
