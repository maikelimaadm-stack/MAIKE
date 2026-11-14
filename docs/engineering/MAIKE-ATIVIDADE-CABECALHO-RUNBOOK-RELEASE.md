# MAIKE — Atividade cabeçalho (Fatia 2): runbook de release CONTRACT (D-PROD-200)

> **Estado: NÃO EXECUTADO. `SCHEMA_APPLIED_PROD: NÃO`.**
>
> Este documento é o plano. Cada passo para no primeiro desvio com
> **`RELEASE_BLOCKED`**. Valores entre `<…>` são preenchidos na hora, a partir de
> leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-200](./DECISIONS.md) · Contrato:
[`MAIKE-ATIVIDADE-CABECALHO-CONTRATO.md`](./MAIKE-ATIVIDADE-CABECALHO-CONTRATO.md) (§2 a migration, §9 a release e o
GO do proprietário). Precedentes executados: [`MAIKE-TIPO-ATIVIDADE-DEFAULTS-RUNBOOK-RELEASE.md`](./MAIKE-TIPO-ATIVIDADE-DEFAULTS-RUNBOOK-RELEASE.md)
(a CONTRACT anterior, caminho B) e [`MAIKE-CADCURVAGANHO-MENSAL-RUNBOOK-RELEASE.md`](./MAIKE-CADCURVAGANHO-MENSAL-RUNBOOK-RELEASE.md)
(CONTRACT com `DROP TABLE`, caminho B). Molde: [`MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md)
(§1 explica por que nunca `apply_migration` e nunca DDL solto).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261114500000_atividade_cabecalho` |
| Natureza | **CONTRACT** (sétima exceção fechada à D-PROD-72 item 3 e à D-PROD-107 R7, depois da D-PROD-162, da D-PROD-183, da D-PROD-187, da D-PROD-194, da D-PROD-195 e da D-PROD-197) e a primeira no **formato conversão** do portão, numa transação só: guarda → as 2 tabelas novas → a conversão pinada → os 3 `DROP TABLE` pinados no fim |
| O que entra | `"Atividade"` (cabeçalho) e `"AtividadeApontamento"` (dia/turno), pela allowlist EXPAND: 2 `CREATE TABLE`, 15 índices (6 únicos; o de (`cliente_id`, `atividade_id`, `data_operacional`, `turno`, `sequencia`) é `NULLS NOT DISTINCT`), 14 CHECKs, 21 FKs compostas pelo tenant `ON DELETE RESTRICT ON UPDATE CASCADE` e o RLS de sempre (REVOKE de `anon`/`authenticated`, RLS sem FORCE, política `maike_backend_all` para `maike_vercel`) |
| A conversão (texto pinado) | cada linha de `"ApontamentoAtividade"` vira uma `"Atividade"` com id `'atv_' \|\| id antigo`, o **mesmo número**, nome `<tipo> (apontamento nº <n>)`, tipo e grupo (snapshots), área com o **setor da área**, máquina (`bem_id`), safra, centros de custo e de resultado, a unidade de texto em `unidade_producao_sigla`, a data como `data_inicio`, a tarefa, a produção (só se `CONFIRMADO`) e status `ABERTA` (ou `CANCELADA` com o cancelamento); e um `"AtividadeApontamento"` filho com o **mesmo id antigo**, sequência 1, sem turno, operador, produção do dia, observação, origem `WEB`, status e cancelamento, versão e datas de criação/alteração. O contador `EntidadeCodigoSequencia` da entidade `ApontamentoAtividade` passa a ser o da entidade `Atividade` (o mesmo próximo número) |
| O que sai | `"ApontamentoAtividadeItemConsumoLote"`, `"ApontamentoAtividadeItem"` e `"ApontamentoAtividade"`, nessa ordem (filhas primeiro), com os índices, as FKs, o RLS e as políticas delas |
| O que se perde | **nada que exista hoje**: a guarda recusa (e desfaz tudo) se houver item de custo ou fatia FIFO, apontamento com implemento, hora de início/fim ou horas trabalhadas (o modelo novo não tem onde guardar), status fora de `CONFIRMADO`/`CANCELADO`, cancelamento incompleto ou contador da entidade `Atividade` já existente |
| O que não muda | nenhuma outra tabela ganha ou perde coluna, linha ou índice; as tabelas que as FKs novas referenciam só ganham essas FKs e perdem as das antigas |
| Guarda da própria migration | `lock_timeout` 5 s e `statement_timeout` 120 s locais à transação; `pg_advisory_xact_lock(72707369)`; as 3 antigas existem e as 2 novas não; **as 3 antigas travadas em `ACCESS EXCLUSIVE` antes de conferir** (até o `COMMIT`, ninguém grava nelas: o que a guarda conferiu é o que a conversão lê e o `DROP` apaga); depois as conferências da linha acima. Toda mensagem começa com `guarda:` |
| SHA-256 do arquivo (`MIGRATIONS_APROVADAS`) | `c288cf47c1bbb1de1b25295ffc57c37185c2ce1060e092eec7088d9d501f1feb` |
| Entrada pinada (`MIGRATIONS_CONTRACT_APROVADAS`) | guarda `6d192b5423d728d425d20d4a98d28335b7617a6261ae96999162a71578856f64`; `drop`: as 3 antigas, filhas primeiro; `literais_guarda`: `CONFIRMADO`, `CANCELADO`, `EntidadeCodigoSequencia`; `alter_antigas: []`; `conversao`: as 3 instruções |
| RLS das novas (`DO_RLS_APROVADOS`) | `8f0b1b5ccc478778e1f9aeb94945e9bfde631f4accb12a55abb09e944cc5b98c` |
| Classificador (`classificarMigrations`) | `modo: CONTRACT`, `violacoes: []`, `tabelas_novas: ["Atividade", "AtividadeApontamento"]`, `colunas_novas_em_tabelas_antigas: []`; `contract[0]`: `decisao: "D-PROD-200"`, `conversoes` (`INSERT INTO Atividade`, `INSERT INTO AtividadeApontamento`, `UPDATE EntidadeCodigoSequencia`), `tabelas_removidas` (as 3) |
| `_prisma_migrations` | antes **52** concluídas, 0 em aberto (a CONTRACT anterior, os padrões do Tipo de Atividade da D-PROD-197, `20261114300000_tipo_atividade_defaults`, concluída em 2026-11-14 às 17:05:05 UTC; a última, a EXPAND do peso objetivo da D-PROD-198, `20261114400000_cadcategoria_peso_objetivo`, concluída em 2026-11-14 às 19:00:00 UTC); depois **53**. Recontar no §4 se algo mais for aplicado antes |
| Tabelas em `public` | **85** antes, **84** depois (− 3 + 2) |
| Linhas (produção hoje) | `ApontamentoAtividade` 2 (`CONFIRMADO`), itens 0, fatias 0; contador `ApontamentoAtividade` / `tenant` / próximo 3 → depois `Atividade` 2 e `AtividadeApontamento` 2 (`ABERTA` e `CONFIRMADO`, números 1 e 2), contador `Atividade` / `tenant` / próximo 3 |

**Não há ordem sem janela.** A migration **apaga a tabela que o código em
produção usa** e cria as que o código novo usa:

- código de hoje com a migration aplicada: a tela **Apontamentos de Atividade** e
  as rotas `/apontamentos-atividade` dão 500 (`P2021`, tabela inexistente). O
  resto não depende dessas tabelas: a reconciliação de estoque, a exclusão de lote
  e a de empresa leem o catálogo (`to_regclass`) antes de tocar nelas (lição do
  hotfix #259), e as FKs que barravam excluir tipo, grupo, área, bem, centro ou
  tarefa usados num apontamento saem com as tabelas;
- código novo sem a migration: a tela nova **Lançamento de Atividades** dá 500
  (tabelas inexistentes) e a antiga já saiu do menu.

Por isso: **aplicar logo antes do merge, fora de pico**, e mergear logo depois do
postcheck. A janela é a do deploy da Vercel (do `COMMIT` da migration até o deploy
da `main` nova ficar READY): nesse intervalo a tela antiga quebra. E o
`premerge-migrate` só enxerga a migration como "nova" enquanto ela não está na
`main`: depois do merge o `--contract D-PROD-200` vira `CONTRACT_INESPERADO` e o
caminho A fecha (aconteceu na D-PROD-183). A ordem é: aplicar (§5) → postcheck (§6)
→ merge (§7). **Só com o GO explícito e escrito do proprietário** (§2).

**Instant Rollback da Vercel NÃO é seguro depois da aplicação:** o código anterior
procura `ApontamentoAtividade`, que não existe mais (ver §9).

**Travas durante a transação (conferido no PostgreSQL 16 local, `pg_locks` da
própria sessão antes do `COMMIT`):** `ACCESS EXCLUSIVE` nas 3 antigas desde a
guarda; `SHARE ROW EXCLUSIVE` nas tabelas que as FKs novas referenciam
(`Cliente`, `Empresa`, `TipoAtividade`, `GrupoAtividade`, `AreaPastagem`, `Setor`,
`BemPatrimonial`, `CentroCusto`, `CentroResultado`, `UnidadeMedida`,
`LancamentoTarefa`, `Usuario`), que bloqueia escrita nelas; `ROW EXCLUSIVE` em
`EntidadeCodigoSequencia` (o `UPDATE` do contador); e, no fim, os `DROP TABLE`
levam **`ACCESS EXCLUSIVE` em toda tabela que as 3 antigas referenciavam**
(`Cliente`, `Empresa`, `Usuario`, `TipoAtividade`, `GrupoAtividade`,
`AreaPastagem`, `BemPatrimonial`, `CentroCusto`, `CentroResultado`,
`LancamentoTarefa`, `Produto`, `LocalEstoque`, `MovimentacaoEstoque`,
`EstoqueLoteNota`) até o `COMMIT`. Como toda requisição autenticada lê `Usuario` e
`Cliente`, **o sistema inteiro espera** esse fim de transação (menos de 1 s: são 2
linhas). Se uma transação longa estiver segurando alguma dessas tabelas, o
`lock_timeout` de 5 s estoura e a transação aborta **sem aplicar nada**; um
*deadlock* com uma requisição da tela antiga também aborta uma das duas (se for a
migration, nada é aplicado). Por isso: **fora de pico**, e o preflight confere as
travas e as transações longas.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** numa máquina protegida, com
  `MIGRATION_DATABASE_URL` (direta ou de sessão na 5432, nunca o pooler 6543),
  `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360` e a conexão do
  **runtime** (`DATABASE_URL` ou `POSTGRES_PRISMA_URL`) apontando para o MESMO
  banco (o `deploy:migrate` confere as duas). Por ser CONTRACT, a release é
  **isolada** (esta é a única migration nova; senão `CONTRACT_NAO_ISOLADO`) e exige
  a decisão exata:
  ```bash
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>                                  # ANÁLISE LOCAL OK (CONTRACT D-PROD-200: 3 conversões (…), 3 tabelas removidas)
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo --contract D-PROD-200
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar --contract D-PROD-200   # repassa MIGRATION_CONTRACT_AUTORIZADO=D-PROD-200
  ```
  A guarda põe o próprio `lock_timeout` (5 s); não é preciso parâmetro na URL.
- **B — conector Supabase, uma única `execute_sql` (§5):** desvio da D-PROD-74,
  registrado no §11, só com o GO escrito do proprietário **para esta migration**
  (§2). Nunca presumido de releases anteriores nem de autorização genérica.
- O `npm run deploy:migrate` à mão e o `release-migrate.yml` **recusam** esta
  migration (`DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED`) enquanto ela estiver
  pendente no alvo: só o `premerge-migrate --aplicar --contract D-PROD-200`
  passa `MIGRATION_CONTRACT_AUTORIZADO`, e `d-prod-200`, ` D-PROD-200 ` ou a
  decisão de outra CONTRACT não servem.

## 2. Pré-requisitos e GOs

**Pré-requisitos (todos antes da aplicação):**
- toda a validação local da PR verde: `verify:all` (com `test:backend` e
  `test:smoke`) e o ensaio do §4.2 no `<SHA_APROVADO>`;
- a branch está atualizada com a `main`, a PR está `mergeable` e esta é a **única**
  migration nova da release;
- nenhuma outra migration entrou na `main` nem foi aplicada em produção depois do
  preflight; se entrou, atualizar a branch, recontar o §4 e repetir o ensaio;
- o deploy da `main` nova pode começar logo depois do merge (Vercel sem fila nem
  pausa): a janela da tela antiga é o tempo desse deploy.

**GOs:**

| GO | O quê | Situação |
|---|---|---|
| GO-1 | rodar o preflight **só leitura** em produção (§4) | coberto pelo GO de 2026-11-14 (o preflight `PRONTO PARA APLICAR` é condição dele) |
| GO-2 | aplicar a migration CONTRACT (§5) logo antes do merge da PR da Fatia 2 e mergear em seguida | **dado em 2026-11-14** ("autorizo pode enviar", contrato §9), escrito para esta migration; vale depois de toda a validação local verde e de um preflight `PRONTO PARA APLICAR`; não vale para a Fatia 3 nem para outra migration. No caminho B, registrar no §11 como o desvio da D-PROD-74 |

## 3. Ordem

Validação local verde (§2) → preflight §4 (anotar no §11) → ensaio local §4.2 com
o arquivo do SHA → GO-2 conferido → logo antes: repetir o preflight (as linhas 2,
3 e 14 a 16 de novo) → aplicação §5 → **postcheck** §6 (só leitura) e alertas do
Supabase → merge §7 → deploy da `main` READY → conferência §8.

## 4. Preflight (somente leitura; `SELECT` no conector ou papel de leitura)

### 4.1 Uma consulta, com veredito

Cole TUDO e rode. Só `SELECT` (as contagens nas tabelas antigas passam por
`query_to_xml`, que só lê, para a consulta rodar — e dizer `PARAR` — também quando
elas já não existem). Qualquer `PARAR` → `RELEASE_BLOCKED`.

<!-- sql:preflight -->
```sql
-- MAIKE · D-PROD-200 · PREFLIGHT (somente leitura). Cole TUDO e rode. Qualquer PARAR = não aplicar.
WITH
esperado AS (SELECT '7692130048193495360'::text AS sid),
mig AS (
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS abertas,
         count(*) FILTER (WHERE migration_name = '20261114500000_atividade_cabecalho' AND rolled_back_at IS NULL) AS esta,
         count(*) FILTER (WHERE migration_name = '20261113700000_apontamento_atividade'
                            AND checksum = 'a9735833d64b5ebd50d35b12e6eaaa20e1d70bbad6defc131db1dd50e5fab75e'
                            AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS apontamento,
         count(*) FILTER (WHERE migration_name = '20261113800000_apontamento_atividade_item'
                            AND checksum = '866dc9944772afb08ee851dd653d62db73dccfa5e152f611f2205c3eb594533c'
                            AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS itens,
         count(*) FILTER (WHERE migration_name = '20261114300000_tipo_atividade_defaults'
                            AND checksum = 'b65d4f08de5f587cd69b893bcb2626df5cc775e1f4ca5b68fdaac863aab55dbf'
                            AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS anterior,
         count(*) FILTER (WHERE migration_name = '20261114400000_cadcategoria_peso_objetivo'
                            AND checksum = 'd44f80701c8936b62a8213f68fecb912a846c2a646f6cae79133964b653fb1a9'
                            AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS peso
    FROM public._prisma_migrations
),
tabelas_alvo AS (
  SELECT t.nome, t.antiga, to_regclass(format('public.%I', t.nome))::oid AS oid
    FROM (VALUES ('ApontamentoAtividade', true), ('ApontamentoAtividadeItem', true), ('ApontamentoAtividadeItemConsumoLote', true),
                 ('Atividade', false), ('AtividadeApontamento', false)) AS t(nome, antiga)
),
-- Contagens nas antigas, por SQL dinâmico: tabela ausente → NULL (a linha diz PARAR), nunca erro.
consultas(chave, tabela, filtro) AS (VALUES
  ('linhas', 'ApontamentoAtividade', 'true'),
  ('confirmados', 'ApontamentoAtividade', '"status" = ''CONFIRMADO'''),
  ('cancelados', 'ApontamentoAtividade', '"status" = ''CANCELADO'''),
  ('sem_lugar', 'ApontamentoAtividade', '"implemento_bem_id" IS NOT NULL OR "hora_inicio" IS NOT NULL OR "hora_fim" IS NOT NULL OR "horas_trabalhadas" IS NOT NULL'),
  ('status_fora', 'ApontamentoAtividade', '"status" NOT IN (''CONFIRMADO'', ''CANCELADO'') OR ("status" = ''CANCELADO'') <> ("cancelado_em" IS NOT NULL)'),
  ('itens', 'ApontamentoAtividadeItem', 'true'),
  ('fatias', 'ApontamentoAtividadeItemConsumoLote', 'true'),
  -- cliente com apontamento e sem o contador tenant coerente (próximo maior que o maior número; número só com dígitos)
  ('sem_contador', 'ApontamentoAtividade', '"cliente_id" IN (SELECT a."cliente_id" FROM public."ApontamentoAtividade" a GROUP BY a."cliente_id" HAVING bool_or(a."numero" !~ ''^[0-9]{1,18}$'') OR NOT EXISTS (SELECT 1 FROM public."EntidadeCodigoSequencia" s WHERE s."cliente_id" = a."cliente_id" AND s."entidade" = ''ApontamentoAtividade'' AND s."escopo_tipo" = ''tenant'' AND s."escopo_id" = a."cliente_id" AND s."proximo_valor" > max(CASE WHEN a."numero" ~ ''^[0-9]{1,18}$'' THEN a."numero"::bigint END)))')
),
contagens AS (
  SELECT c.chave,
         CASE WHEN to_regclass(format('public.%I', c.tabela)) IS NULL THEN NULL
              ELSE (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I WHERE %s', c.tabela, c.filtro), false, true, '')))[1]::text::bigint
         END AS n
    FROM consultas c
),
n AS (SELECT jsonb_object_agg(chave, n) AS j FROM contagens),
contador AS (
  SELECT count(*) FILTER (WHERE entidade = 'Atividade') AS atividade,
         coalesce(string_agg(escopo_tipo || ' / ' || proximo_valor, ', ' ORDER BY cliente_id, escopo_tipo) FILTER (WHERE entidade = 'ApontamentoAtividade'), '-') AS antigo
    FROM public."EntidadeCodigoSequencia"
),
tabelas AS (SELECT count(*) AS n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')),
-- As 3 antigas, as tabelas que os DROP travam em ACCESS EXCLUSIVE e as que as FKs novas travam.
travadas AS (
  SELECT to_regclass(format('public.%I', t))::oid AS oid
    FROM unnest(ARRAY['ApontamentoAtividade', 'ApontamentoAtividadeItem', 'ApontamentoAtividadeItemConsumoLote', 'Cliente', 'Empresa', 'Usuario',
                      'TipoAtividade', 'GrupoAtividade', 'AreaPastagem', 'Setor', 'BemPatrimonial', 'CentroCusto', 'CentroResultado', 'UnidadeMedida',
                      'LancamentoTarefa', 'Produto', 'LocalEstoque', 'MovimentacaoEstoque', 'EstoqueLoteNota', 'EntidadeCodigoSequencia']) AS t
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
  SELECT 2, 'migrations concluídas / em aberto', (SELECT concluidas || ' / ' || abertas FROM mig), '52 / 0',
         CASE WHEN (SELECT concluidas = 52 AND abertas = 0 FROM mig) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 3, '20261114500000_atividade_cabecalho já registrada', (SELECT esta::text FROM mig), '0',
         CASE WHEN (SELECT esta FROM mig) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 4, 'apontamento (D-PROD-190), itens (D-PROD-193), a CONTRACT anterior (D-PROD-197) e o peso objetivo (D-PROD-198) com o checksum do repositório',
         (SELECT apontamento || ' / ' || itens || ' / ' || anterior || ' / ' || peso FROM mig), '1 / 1 / 1 / 1',
         CASE WHEN (SELECT apontamento = 1 AND itens = 1 AND anterior = 1 AND peso = 1 FROM mig) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 5, 'tabelas antigas presentes / novas já presentes',
         (SELECT count(*) FILTER (WHERE antiga AND oid IS NOT NULL) || ' / ' || count(*) FILTER (WHERE NOT antiga AND oid IS NOT NULL) FROM tabelas_alvo), '3 / 0',
         CASE WHEN (SELECT count(*) FILTER (WHERE antiga AND oid IS NOT NULL) = 3 AND count(*) FILTER (WHERE NOT antiga AND oid IS NOT NULL) = 0 FROM tabelas_alvo)
              THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 6, 'itens de custo / fatias FIFO no apontamento antigo', coalesce((SELECT (j->>'itens') || ' / ' || (j->>'fatias') FROM n), '-'), '0 / 0',
         CASE WHEN (SELECT (j->>'itens')::bigint = 0 AND (j->>'fatias')::bigint = 0 FROM n) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 7, 'apontamentos com implemento, hora ou horas trabalhadas (sem lugar no modelo novo)', coalesce((SELECT j->>'sem_lugar' FROM n), '-'), '0',
         CASE WHEN (SELECT (j->>'sem_lugar')::bigint = 0 FROM n) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 8, 'apontamentos com status fora de CONFIRMADO/CANCELADO ou cancelamento incompleto', coalesce((SELECT j->>'status_fora' FROM n), '-'), '0',
         CASE WHEN (SELECT (j->>'status_fora')::bigint = 0 FROM n) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 9, 'ApontamentoAtividade: CONFIRMADO / CANCELADO (anote; o postcheck repete)',
         coalesce((SELECT (j->>'confirmados') || ' / ' || (j->>'cancelados') FROM n), '-'), '2 / 0 (produção hoje)',
         CASE WHEN (SELECT j->>'linhas' FROM n) IS NULL THEN 'PARAR' ELSE 'CONFIRA' END
  UNION ALL
  SELECT 10, 'contador da entidade Atividade já existente', (SELECT atividade::text FROM contador), '0',
         CASE WHEN (SELECT atividade FROM contador) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 11, 'apontamentos de cliente sem contador tenant coerente (próximo > maior número)', coalesce((SELECT j->>'sem_contador' FROM n), '-'), '0',
         CASE WHEN (SELECT (j->>'sem_contador')::bigint = 0 FROM n) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 12, 'contador ApontamentoAtividade: escopo / próximo (anote; o postcheck repete na entidade Atividade)', (SELECT antigo FROM contador), 'tenant / 3 (produção hoje)',
         'CONFIRA'
  UNION ALL
  SELECT 13, 'tabelas em public', (SELECT n::text FROM tabelas), '85',
         CASE WHEN (SELECT n FROM tabelas) = 85 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 14, 'travas de outras sessões nas 3 antigas e nas tabelas que a migration trava, agora', (SELECT n::text FROM travas), '0',
         CASE WHEN (SELECT n FROM travas) = 0 THEN 'OK' ELSE 'ATENÇÃO (repita fora de pico)' END
  UNION ALL
  SELECT 15, 'transações abertas há mais de 30 s', (SELECT n::text FROM longas), '0',
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
| migrations | `52 / 0` |
| esta migration registrada | `0` |
| D-PROD-190, D-PROD-193, D-PROD-197 e D-PROD-198 com o checksum do repositório | `1 / 1 / 1 / 1` |
| tabelas antigas / novas | `3 / 0` |
| itens / fatias | `0 / 0` |
| sem lugar no modelo novo; status fora | `0`; `0` |
| `ApontamentoAtividade` `CONFIRMADO` / `CANCELADO` | `2 / 0` (anotar `<N_CONFIRMADOS>` / `<N_CANCELADOS>`; o §6 repete) |
| contador `Atividade` já existente; apontamentos de cliente sem contador coerente | `0`; `0` |
| contador `ApontamentoAtividade` | `tenant / 3` (anotar `<PROXIMO>`; o §6 repete) |
| tabelas em `public` | `85` |
| travas de outras sessões e transações longas | `0` e `0` (senão `ATENÇÃO`: esperar e repetir fora de pico) |

E, localmente, no `<SHA_APROVADO>`:
`sha256sum backend/prisma/migrations/20261114500000_atividade_cabecalho/migration.sql`
igual ao pinado, e a análise local do `premerge-migrate` (§1) com `modo: CONTRACT`,
`contract[0].decisao = "D-PROD-200"`, as 3 `conversoes`, as 3 `tabelas_removidas`,
`tabelas_novas` com as 2 novas e `violacoes: []`.

### 4.2 Ensaio local (com o arquivo exato do `<SHA_APROVADO>`)

Automatizado em `backend/tests/atividadeCabecalhoMigration.test.mjs`, só contra
PostgreSQL local, em bancos próprios criados e apagados pelo teste. Ele roda
**este** preflight, **este** envelope do caminho B e **este** postcheck (lidos
deste arquivo, entre os marcadores `sql:…`), trocando só o `system_identifier` de
produção pelo local:

- partida: as 52 migrations de nome anterior a esta, pelo Prisma, e **os 2
  apontamentos com a forma exata dos de produção** (o nº 1, tipo `TESTE`, com área
  e setor, máquina com horímetro, operador, centros, produção 1 `KM`; o nº 2, tipo
  `TES`, sem área e sem operador, com máquina, centros, produção 150 `HA`), o
  contador `tenant` / próximo 3; preflight `PRONTO`;
- RED (cada um num banco novo, todos recusam e nada muda): item de custo, fatia
  FIFO, implemento, hora de início, horas trabalhadas, status fora da lista,
  cancelamento incompleto, contador `Atividade` já existente, tabela nova já
  existente, tabela antiga ausente, trava concorrente (`55P03` em ~5 s), item
  gravado por uma transação concorrente enquanto a migration espera a trava
  (recusado, o item fica) e o mesmo item pelo runner (falha aberta → `migrate
  resolve --rolled-back`); e o `deploy:migrate` com a conferência de alvo exigida e
  sem `MIGRATION_CONTRACT_AUTORIZADO=D-PROD-200` exato →
  `DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED` antes de qualquer DDL;
- GREEN pelo runner oficial (conferência exigida, decisão exata) e GREEN pelo
  envelope do caminho B: 53/0, 84 tabelas, as 2 atividades e os 2 apontamentos
  campo a campo, o contador `Atividade` / próximo 3, as 3 antigas fora, RLS nas
  2 novas, `migrate diff` vazio, o unique `NULLS NOT DISTINCT`, CHECKs e FKs,
  postcheck `APLICADA`; reaplicar o `migration.sql` e repetir o envelope são
  recusados sem mudar nada; e um apontamento cancelado (de outro cliente) vira
  `CANCELADA` + `CANCELADO` com o cancelamento.

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
              WHERE migration_name = '20261114500000_atividade_cabecalho' AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)
    INTO n_ok, n_aberta FROM _prisma_migrations;
  IF n_ok <> 52 OR n_aberta <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % em aberto', n_ok, n_aberta;
  END IF;
  IF (SELECT count(*) FROM _prisma_migrations
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
         AND ((migration_name = '20261113700000_apontamento_atividade' AND checksum = 'a9735833d64b5ebd50d35b12e6eaaa20e1d70bbad6defc131db1dd50e5fab75e')
           OR (migration_name = '20261113800000_apontamento_atividade_item' AND checksum = '866dc9944772afb08ee851dd653d62db73dccfa5e152f611f2205c3eb594533c')
           OR (migration_name = '20261114300000_tipo_atividade_defaults' AND checksum = 'b65d4f08de5f587cd69b893bcb2626df5cc775e1f4ca5b68fdaac863aab55dbf')
           OR (migration_name = '20261114400000_cadcategoria_peso_objetivo' AND checksum = 'd44f80701c8936b62a8213f68fecb912a846c2a646f6cae79133964b653fb1a9'))) <> 4 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: apontamento (D-PROD-190), itens (D-PROD-193), a CONTRACT anterior (D-PROD-197) ou o peso objetivo (D-PROD-198) ausentes ou com checksum divergente';
  END IF;
END $alvo$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'c288cf47c1bbb1de1b25295ffc57c37185c2ce1060e092eec7088d9d501f1feb', now(),
        '20261114500000_atividade_cabecalho', NULL, NULL, now(), 1);
COMMIT;
```
<!-- /sql:caminho-b -->

- O `migration.sql` não tem `BEGIN`/`COMMIT` próprios; o `DROP` está nele, pinado,
  depois da conversão, e a guarda trava as 3 antigas antes de conferir.
- O `checksum` do `INSERT` é o SHA-256 do arquivo: com outro valor o Prisma acusa
  divergência e o `premerge-migrate` recusa as releases seguintes
  (`PREMERGE_MIGRATIONS_NAO_COMPROVADAS`).
- Qualquer falha desfaz tudo, inclusive a conversão, os `DROP` e o `INSERT` em
  `_prisma_migrations`.

### 5.1 Falha no caminho A (guarda, `55P03` ou *deadlock*)

1. Nada fica (uma transação só): as 3 antigas e os 2 apontamentos continuam; a
   linha da migration fica com `finished_at` NULL.
2. Conferir pelo preflight que as novas não existem e as antigas continuam (linha 5
   `3 / 0`, linha 9 igual à de antes).
3. Com a conexão de **produção** explícita (o schema lê `DATABASE_URL`):
   `DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate resolve --rolled-back 20261114500000_atividade_cabecalho --schema backend/prisma/schema.prisma`.
4. Eliminar a causa (a mensagem da guarda diz qual) e confirmar com o proprietário
   antes de tentar de novo.
5. Uma tentativa resolvida (`rolled_back_at` preenchido) não bloqueia o envelope
   do caminho B; uma linha ainda aberta bloqueia (resolver primeiro). No §6,
   aceitar exatamente essa linha revertida.

### 5.2 Falha no caminho B

Nada é aplicado (uma transação só). Repetir o preflight (linhas 2, 3, 5 e 9 iguais
às de antes), eliminar a causa e confirmar com o proprietário antes de tentar de
novo.

## 6. Postcheck (antes do merge; só leitura)

Qualquer `PARAR`: **não mergear** e chamar o proprietário. As contagens nas tabelas
novas também passam por `query_to_xml` (a consulta roda, e diz `PARAR`, antes da
aplicação).

<!-- sql:postcheck -->
```sql
-- MAIKE · D-PROD-200 · POSTCHECK (somente leitura). Cole TUDO e rode. Esperado: tudo OK/CONFIRA e VEREDITO APLICADA.
WITH
esperado AS (SELECT '7692130048193495360'::text AS sid),
mig AS (
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS abertas,
         count(*) FILTER (WHERE migration_name = '20261114500000_atividade_cabecalho'
                            AND checksum = 'c288cf47c1bbb1de1b25295ffc57c37185c2ce1060e092eec7088d9d501f1feb'
                            AND finished_at IS NOT NULL AND rolled_back_at IS NULL AND applied_steps_count = 1) AS esta
    FROM public._prisma_migrations
),
tabelas_alvo AS (
  SELECT t.nome, t.antiga, to_regclass(format('public.%I', t.nome))::oid AS oid
    FROM (VALUES ('ApontamentoAtividade', true), ('ApontamentoAtividadeItem', true), ('ApontamentoAtividadeItemConsumoLote', true),
                 ('Atividade', false), ('AtividadeApontamento', false)) AS t(nome, antiga)
),
-- Contagens nas novas, por SQL dinâmico: tabela ausente → NULL (a linha diz PARAR), nunca erro.
consultas(chave, tabela, filtro) AS (VALUES
  ('atividades', 'Atividade', 'true'),
  ('abertas', 'Atividade', '"status" = ''ABERTA'''),
  ('canceladas', 'Atividade', '"status" = ''CANCELADA'''),
  ('apontamentos', 'AtividadeApontamento', 'true'),
  ('confirmados', 'AtividadeApontamento', '"status" = ''CONFIRMADO'''),
  ('cancelados', 'AtividadeApontamento', '"status" = ''CANCELADO'''),
  -- convertida (id 'atv_' || id antigo) sem exatamente um filho com o id antigo, sequência 1, sem turno, a mesma data,
  -- a origem WEB, o status e a produção coerentes, e o nome '<tipo> (apontamento nº <n>)'
  ('convertidas_incoerentes', 'Atividade', '"id" LIKE ''atv\_%'' AND ((SELECT count(*) FROM public."AtividadeApontamento" f WHERE f."cliente_id" = "Atividade"."cliente_id" AND f."atividade_id" = "Atividade"."id") <> 1 OR "nome" <> left("tipo_atividade_nome" || '' (apontamento nº '' || "numero" || '')'', 120) OR NOT EXISTS (SELECT 1 FROM public."AtividadeApontamento" f WHERE f."cliente_id" = "Atividade"."cliente_id" AND f."empresa_id" = "Atividade"."empresa_id" AND f."atividade_id" = "Atividade"."id" AND f."id" = substr("Atividade"."id", 5) AND f."sequencia" = 1 AND f."turno" IS NULL AND f."data_operacional" = "Atividade"."data_inicio" AND f."origem" = ''WEB'' AND ((f."status" = ''CONFIRMADO'' AND "Atividade"."status" = ''ABERTA'' AND f."quantidade_produzida_dia" IS NOT DISTINCT FROM "Atividade"."quantidade_produzida") OR (f."status" = ''CANCELADO'' AND "Atividade"."status" = ''CANCELADA'' AND "Atividade"."quantidade_produzida" IS NULL AND f."cancelado_em" IS NOT DISTINCT FROM "Atividade"."cancelada_em" AND f."motivo_cancelamento" IS NOT DISTINCT FROM "Atividade"."motivo_cancelamento"))))'),
  -- cliente com atividade sem o contador tenant coerente (próximo maior que o maior número)
  ('sem_contador', 'Atividade', '"cliente_id" IN (SELECT a."cliente_id" FROM public."Atividade" a GROUP BY a."cliente_id" HAVING bool_or(a."numero" !~ ''^[0-9]{1,18}$'') OR NOT EXISTS (SELECT 1 FROM public."EntidadeCodigoSequencia" s WHERE s."cliente_id" = a."cliente_id" AND s."entidade" = ''Atividade'' AND s."escopo_tipo" = ''tenant'' AND s."escopo_id" = a."cliente_id" AND s."proximo_valor" > max(CASE WHEN a."numero" ~ ''^[0-9]{1,18}$'' THEN a."numero"::bigint END)))')
),
contagens AS (
  SELECT c.chave,
         CASE WHEN to_regclass(format('public.%I', c.tabela)) IS NULL THEN NULL
              ELSE (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I WHERE %s', c.tabela, c.filtro), false, true, '')))[1]::text::bigint
         END AS n
    FROM consultas c
),
n AS (SELECT jsonb_object_agg(chave, n) AS j FROM contagens),
contador AS (
  SELECT count(*) FILTER (WHERE entidade = 'ApontamentoAtividade') AS antigo,
         coalesce(string_agg(escopo_tipo || ' / ' || proximo_valor, ', ' ORDER BY cliente_id, escopo_tipo) FILTER (WHERE entidade = 'Atividade'), '-') AS novo
    FROM public."EntidadeCodigoSequencia"
),
novas AS (SELECT oid FROM tabelas_alvo WHERE NOT antiga AND oid IS NOT NULL),
checks_esperados(nome) AS (VALUES
  ('Atividade_status_check'), ('Atividade_area_planejada_check'), ('Atividade_area_executada_check'), ('Atividade_quantidade_produzida_check'),
  ('Atividade_datas_check'), ('Atividade_conclusao_check'), ('Atividade_cancelamento_check'), ('AtividadeApontamento_turno_check'),
  ('AtividadeApontamento_origem_check'), ('AtividadeApontamento_status_check'), ('AtividadeApontamento_sequencia_check'),
  ('AtividadeApontamento_area_executada_dia_check'), ('AtividadeApontamento_quantidade_produzida_dia_check'), ('AtividadeApontamento_cancelamento_check')
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
unico_dia AS (
  SELECT count(*) AS n FROM pg_indexes
   WHERE schemaname = 'public' AND indexname = 'AtividadeApontamento_atividade_dia_turno_sequencia_key'
     AND indexdef = 'CREATE UNIQUE INDEX "AtividadeApontamento_atividade_dia_turno_sequencia_key" ON public."AtividadeApontamento" USING btree (cliente_id, atividade_id, data_operacional, turno, sequencia) NULLS NOT DISTINCT'
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
   WHERE table_schema = 'public' AND table_name IN ('Atividade', 'AtividadeApontamento') AND grantee IN ('anon', 'authenticated', 'PUBLIC')
),
base(ordem, item, valor, esperado, status) AS (
  SELECT 1, 'alvo: system_identifier', (SELECT system_identifier::text FROM pg_control_system()), (SELECT sid FROM esperado),
         CASE WHEN (SELECT system_identifier::text FROM pg_control_system()) = (SELECT sid FROM esperado) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 2, '20261114500000_atividade_cabecalho concluída (checksum pinado, applied_steps_count 1)', (SELECT esta::text FROM mig), '1',
         CASE WHEN (SELECT esta FROM mig) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 3, 'migrations concluídas / em aberto', (SELECT concluidas || ' / ' || abertas FROM mig), '53 / 0',
         CASE WHEN (SELECT concluidas = 53 AND abertas = 0 FROM mig) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 4, 'tabelas antigas que restam / novas presentes',
         (SELECT count(*) FILTER (WHERE antiga AND oid IS NOT NULL) || ' / ' || count(*) FILTER (WHERE NOT antiga AND oid IS NOT NULL) FROM tabelas_alvo), '0 / 2',
         CASE WHEN (SELECT count(*) FILTER (WHERE antiga AND oid IS NOT NULL) = 0 AND count(*) FILTER (WHERE NOT antiga AND oid IS NOT NULL) = 2 FROM tabelas_alvo)
              THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 5, 'tabelas em public', (SELECT n::text FROM tabelas), '84',
         CASE WHEN (SELECT n FROM tabelas) = 84 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 6, 'Atividade ABERTA / CANCELADA (igual ao CONFIRMADO / CANCELADO do preflight)',
         coalesce((SELECT (j->>'abertas') || ' / ' || (j->>'canceladas') FROM n), '-'), '2 / 0 (produção hoje)',
         CASE WHEN (SELECT j->>'atividades' FROM n) IS NULL THEN 'PARAR' ELSE 'CONFIRA' END
  UNION ALL
  SELECT 7, 'AtividadeApontamento CONFIRMADO / CANCELADO (igual ao preflight)',
         coalesce((SELECT (j->>'confirmados') || ' / ' || (j->>'cancelados') FROM n), '-'), '2 / 0 (produção hoje)',
         CASE WHEN (SELECT j->>'apontamentos' FROM n) IS NULL THEN 'PARAR'
              WHEN (SELECT (j->>'atividades')::bigint = (j->>'apontamentos')::bigint FROM n) THEN 'CONFIRA' ELSE 'PARAR' END
  UNION ALL
  SELECT 8, 'convertidas sem o filho coerente (id, sequência 1, sem turno, data, status, produção, nome)', coalesce((SELECT j->>'convertidas_incoerentes' FROM n), '-'), '0',
         CASE WHEN (SELECT (j->>'convertidas_incoerentes')::bigint = 0 FROM n) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 9, 'contador ApontamentoAtividade restante / atividades de cliente sem contador Atividade coerente',
         (SELECT antigo::text FROM contador) || ' / ' || coalesce((SELECT j->>'sem_contador' FROM n), '-'), '0 / 0',
         CASE WHEN (SELECT antigo FROM contador) = 0 AND (SELECT (j->>'sem_contador')::bigint = 0 FROM n) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 10, 'contador Atividade: escopo / próximo (igual ao do ApontamentoAtividade no preflight)', (SELECT novo FROM contador), 'tenant / 3 (produção hoje)',
         'CONFIRA'
  UNION ALL
  SELECT 11, 'unique (cliente, atividade, dia, turno, sequência) NULLS NOT DISTINCT', (SELECT n::text FROM unico_dia), '1',
         CASE WHEN (SELECT n FROM unico_dia) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 12, 'os 14 CHECKs, validados', (SELECT n::text FROM checks), '14',
         CASE WHEN (SELECT n FROM checks) = 14 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 13, 'FKs: total / compostas pelo cliente, RESTRICT/CASCADE e validadas', (SELECT total || ' / ' || certas FROM fks), '21 / 21',
         CASE WHEN (SELECT total = 21 AND certas = 21 FROM fks) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 14, 'índices (sem as pkeys): total / começando por cliente_id / únicos', (SELECT total || ' / ' || por_cliente || ' / ' || unicos FROM indices), '15 / 15 / 6',
         CASE WHEN (SELECT total = 15 AND por_cliente = 15 AND unicos = 6 FROM indices) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 15, 'RLS / FORCE / políticas das 2 novas', (SELECT texto FROM seguranca), 'true / false / maike_backend_all nas duas',
         CASE WHEN (SELECT certas FROM seguranca) = 2 THEN 'CONFIRA' ELSE 'PARAR' END
  UNION ALL
  SELECT 16, 'grants para anon/authenticated/PUBLIC nas 2 novas', (SELECT n::text FROM grants), '0',
         CASE WHEN (SELECT n FROM grants) = 0 THEN 'OK' ELSE 'PARAR' END
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

Esperado: `1`; `53 / 0`; `0 / 2`; `84`; `2 / 0` e `2 / 0` (**iguais ao preflight**);
`0` convertidas incoerentes; `0 / 0` no contador; contador `Atividade` `tenant / 3`
(**igual ao do preflight**); `1`; `14`; `21 / 21`; `15 / 15 / 6`; RLS `true / false /
maike_backend_all` nas duas; `0` grants; VEREDITO `APLICADA E CONFERIDA`. Mais:

- `get_advisors` (segurança e performance): nenhum alerta novo de segurança (as 2
  novas com RLS, sem FORCE, com a política do backend e sem grant para `anon`/
  `authenticated`) e nenhum "FK sem índice" para `Atividade` ou
  `AtividadeApontamento`. **Esperado** e não é motivo para parar: índices recém-
  criados aparecem como INFO `unused_index` até a primeira consulta que os use;
- opcional, no caminho A: `node scripts/deploy/preflight-schema.mjs` com a conexão
  de produção → exit 0 (nenhuma migration pendente).

## 7. Merge

Com o §6 todo verde: **mergear logo em seguida** (a tela antiga está quebrada até
o deploy novo). Se a `main` andou, atualizar a branch **sem migration nova** e
mergear. A Vercel publica a `main`; o build não roda migration.

## 8. Depois do deploy (proprietário)

1. Deploy READY na Vercel: `/api/native/health` com o `release` da `main` nova.
2. `/api/native/atividades` sem sessão → 401.
3. Menu: "Lançamento de Atividades" no lugar de "Apontamentos de Atividade".
4. A lista mostra as 2 atividades convertidas (números 1 e 2, `TESTE (apontamento
   nº 1)` e `TES (apontamento nº 2)`, `ABERTA`); abrir a nº 1 mostra o cabeçalho
   com a área e o setor dela, a máquina, os centros e a unidade `KM`, e o
   apontamento do dia 14/11/2026 (sequência 1, sem turno, o operador, produção 1).
   A primeira escrita (uma atividade de teste, que deve receber o nº 3) é do
   proprietário.

## 9. Reversão

Não há reversão automática: as 3 tabelas antigas deixam de existir no `COMMIT`.

- **Código:** o Instant Rollback da Vercel para o deploy anterior **não** é seguro
  depois da aplicação (a tela e as rotas antigas dão 500 sem `ApontamentoAtividade`).
  Se o código novo falhar, o caminho é corrigir para a frente.
- **Banco, se for preciso voltar:** uma CONTRACT **nova**, com decisão e GO
  próprios, nunca editando esta: recriar as 3 tabelas com o DDL das migrations
  `20261113700000_apontamento_atividade` e `20261113800000_apontamento_atividade_item`;
  copiar de volta pelo mapeamento inverso do §0 (id antigo = id do apontamento; o
  número, o tipo, o grupo, a área, a máquina, a safra, os centros, a tarefa e a
  unidade (`unidade_producao_sigla`) do cabeçalho; operador, data, produção do dia,
  observação, status e cancelamento do apontamento); devolver o contador à entidade
  `ApontamentoAtividade`; apagar as 2 novas. Só é exato enquanto cada atividade
  tiver **exatamente um** apontamento e nada que o modelo antigo não guarda (turno,
  sequência > 1, área planejada ou executada, conclusão, reabertura); depois do uso
  da tela nova, a volta perde dado e precisa de decisão do proprietário.
- **Rede de segurança:** o backup diário / PITR do Supabase do momento anterior à
  aplicação (anotar o horário no §11).

## 10. `RELEASE_BLOCKED`

- sem o GO-2 (no caminho B, sem o desvio da D-PROD-74 registrado para esta migration);
- validação local da PR não verde;
- alvo com `system_identifier` diferente;
- histórico diferente de 52/0 antes, ou a D-PROD-200 já registrada (linha não revertida);
- qualquer `PARAR` no preflight;
- outra migration nova na mesma release (`CONTRACT_NAO_ISOLADO`);
- SHA-256 do arquivo diferente do pinado, ou classificador fora do esperado;
- conexão do runtime ausente ou apontando para outro banco no caminho A;
- ensaio local (§4.2) sem passar no `<SHA_APROVADO>`;
- horário de pico (a aplicação para o sistema por menos de 1 s e quebra a tela
  antiga até o deploy).

## 11. Registro da execução

| Campo | Valor |
|---|---|
| GO-1 e GO-2 | GO de 2026-11-14 ("autorizo pode enviar", contrato §9); conferir as condições na hora |
| Caminho | `<A ou B>` (B = desvio da D-PROD-74 para esta migration) |
| `<SHA_APROVADO>` | `<40 hex>` |
| Verificação do SHA | `<verify:all, test:backend, test:smoke, portão e runner>` |
| Ensaio local (§4.2) | `<atividadeCabecalhoMigration.test.mjs n/n>` |
| Preflight (§4) | `<horário UTC>`; `<52 / 0>`; `<CONFIRMADO / CANCELADO>`; `<contador>`; travas `<n>`; transações longas `<n>`; `<veredito>` |
| Backup / PITR anterior | `<horário>` |
| Aplicação | `<finished_at>`; checksum `c288cf47c1bbb1de1b25295ffc57c37185c2ce1060e092eec7088d9d501f1feb`; `applied_steps_count` 1 |
| Postcheck (§6) | `<veredito>`; `<53 / 0>`; `<Atividade / AtividadeApontamento>`; `<contador>`; 84 tabelas |
| Alertas do Supabase | `<segurança / performance>` |
| Merge e deploy | `<PR, commit do merge, deploy READY e duração da janela>` |
