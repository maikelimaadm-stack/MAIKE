# MAIKE — Funcionário como papel do parceiro (ajuste da Fatia 4): runbook de release CONTRACT (D-PROD-208)

> **Estado: NÃO EXECUTADO. `SCHEMA_APPLIED_PROD: NÃO`.** Só com o GO explícito e escrito do proprietário.
>
> Este documento é o plano. Cada passo para no primeiro desvio com
> **`RELEASE_BLOCKED`**. Valores entre `<…>` são preenchidos na hora, a partir de
> leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-208](./DECISIONS.md) · Contrato:
[`MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO-CONTRATO.md`](./MAIKE-ATIVIDADE-MAO-OBRA-PARCEIRO-CONTRATO.md).
Precedente executado: [`MAIKE-ATIVIDADE-MAO-OBRA-RUNBOOK-RELEASE.md`](./MAIKE-ATIVIDADE-MAO-OBRA-RUNBOOK-RELEASE.md)
(a anterior, EXPAND, caminho B, que criou as tabelas que este ajuste muda). Molde do CONTRACT com guarda:
[`MAIKE-ATIVIDADE-CABECALHO-RUNBOOK-RELEASE.md`](./MAIKE-ATIVIDADE-CABECALHO-RUNBOOK-RELEASE.md) (D-PROD-200).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261116000000_mao_obra_parceiro` |
| Natureza | **CONTRACT condicionado a tabelas vazias** (entrada fechada em `MIGRATIONS_CONTRACT_APROVADAS`, `drop_no_fim`): `DROP COLUMN`, `DROP TABLE` e `ADD COLUMN … NOT NULL` sem `DEFAULT` numa tabela vazia. A guarda da própria migration aborta a transação inteira se `"Funcionario"` ou `"AtividadeApontamentoMaoObra"` tiverem **qualquer** linha |
| O que sai | da linha de mão de obra (`"AtividadeApontamentoMaoObra"`): a FK `AtividadeApontamentoMaoObra_funcionario_fkey`, o índice `AtividadeApontamentoMaoObra_cliente_id_empresa_id_funcionar_idx` e a coluna `funcionario_id`; a tabela `"Funcionario"` inteira (vazia; as 2 FKs dela para `Cliente` e `Empresa` saem com ela) |
| O que entra | em `"AtividadeApontamentoMaoObra"`: `parceiro_id VARCHAR(64) NOT NULL`, `origem VARCHAR(12) NOT NULL`, o CHECK `AtividadeApontamentoMaoObra_origem_check` (`FUNCIONARIO`/`TERCEIRO`), a FK `AtividadeApontamentoMaoObra_parceiro_fkey` `("cliente_id", "parceiro_id") → "Fornecedor"("cliente_id", "id")` `ON DELETE RESTRICT ON UPDATE CASCADE` e o índice `AtividadeApontamentoMaoObra_cliente_id_parceiro_id_idx` (`cliente_id` na frente); em `"Fornecedor"`: `funcionario_tipo VARCHAR(16)`, `funcionario_cargo VARCHAR(120)`, `funcionario_custo_hora DECIMAL(14,4)` e `funcionario_custo_diaria DECIMAL(14,4)`, todas anuláveis e sem `DEFAULT`, e o CHECK `Fornecedor_funcionario_check` (tipo `MENSALISTA`/`DIARISTA`/`TAREFEIRO`, custos ≥ 0) |
| O que não muda | nenhuma linha de nenhuma tabela (as duas que mudam de forma estão vazias; `Fornecedor` só ganha colunas nulas); as outras constraints, índices e políticas de `"AtividadeApontamentoMaoObra"` e `"Fornecedor"`; `"Servico"` e `"AtividadeApontamentoServico"` intactas; nenhuma tabela nova, nenhum RLS novo |
| SHA-256 do arquivo (`MIGRATIONS_APROVADAS`) | `65a8a4eb8abc7b44e24d3121605a375fee34ea88968bffe875c53b30e9cf9dd0` |
| Guarda (`guarda_sha256`) | `9ec960b559bb4173342ed76302c828b04b207f07381f5f39b74aea606751d387` |
| Classificador (`classificarMigrations`) | `modo: CONTRACT`, `expand: false`, `violacoes: []`, `tabelas_novas: []`, `colunas_novas_em_tabelas_antigas: []`, `contract[0]`: `decisao D-PROD-208`, `tabelas_removidas ["Funcionario"]`, `colunas_removidas ["AtividadeApontamentoMaoObra.funcionario_id"]`, `constraints_removidas` e `indices_removidos` (a FK e o índice do funcionário), `colunas_adicionadas` (as 6), `constraints_adicionadas` (os 2 CHECKs e a FK), `conversoes: []` |
| `_prisma_migrations` | antes **58** concluídas, 0 em aberto (a última, a EXPAND da Fatia 4, D-PROD-207, `20261115900000_atividade_mao_obra_servico`, concluída em 2026-11-15 às 19:58:35 UTC, checksum `79f139a0ea5b55253db522f00af78dd4e252529ee259da59ada7b4932dad0725`); depois **59**. Recontar no §4 se algo mais for aplicado antes |
| Tabelas em `public` | **95** antes, **94** depois (− `Funcionario`); de tenant, 80 → 79 |

**Ordem: aplicar ANTES do merge (D-PROD-72 item 1). Há janela curta, sem dado em jogo.**

- código de hoje com a migration aplicada: a tela Funcionários e a mão de obra do
  apontamento (que leem `"Funcionario"` e `funcionario_id`) dão 500 até o merge. As
  duas estão **vazias em produção** (conferido pelo preflight): ninguém perde dado,
  só não consegue abrir esses dois pontos entre a aplicação e o deploy;
- código novo sem a migration: Parceiros (que lê `funcionario_*`) e o apontamento
  (que lê `parceiro_id`/`origem`) dão 500 (`P2022`, coluna inexistente).

Por isso: aplicar (§5) → postcheck (§6) → merge (§7) logo em seguida. O **Instant
Rollback** da Vercel para o deploy anterior **deixa de ser seguro** depois da
aplicação (o código anterior lê `"Funcionario"`, que não existe mais): voltar o
código exige voltar o banco (§9). **Só com o GO explícito e escrito do
proprietário** (§2).

**Travas durante a transação:** `ACCESS EXCLUSIVE` em `"Funcionario"` e
`"AtividadeApontamentoMaoObra"` (pela guarda, antes de conferir que estão vazias),
em `"Fornecedor"` (os `ADD COLUMN`) e em `"Cliente"` e `"Empresa"` (o `DROP TABLE
"Funcionario"` remove os gatilhos das FKs dela nessas duas, medido no ensaio): até o
`COMMIT` ninguém lê nem grava nelas — **inclusive o login, que lê `Cliente`**. Tudo
vazio nas tabelas que mudam: a transação dura menos de 1 s. Se uma transação longa
estiver segurando alguma dessas tabelas, o `lock_timeout` de 5 s (da guarda e do
envelope) estoura e a transação aborta **sem aplicar nada**. Por isso: **fora de
pico**, e o preflight confere as travas e as transações longas.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** numa máquina protegida, com
  `MIGRATION_DATABASE_URL` (direta ou de sessão na 5432, nunca o pooler 6543),
  `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360` e a conexão do
  **runtime** (`DATABASE_URL` ou `POSTGRES_PRISMA_URL`) apontando para o MESMO
  banco (o `deploy:migrate` confere as duas). CONTRACT: `--contract D-PROD-208`
  exato (sem ele, ou com outra decisão, `CONTRACT_NAO_AUTORIZADO` antes de conectar):
  ```bash
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>                                     # ANÁLISE LOCAL OK (CONTRACT D-PROD-208: 1 tabela removida, …)
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo --contract D-PROD-208  # ALVO VERIFICADO — 1 pendente(s) do manifesto
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar --contract D-PROD-208
  ```
  A guarda da migration põe o `lock_timeout` de 5 s e o `statement_timeout` de 120 s
  locais à transação e pega a trava consultiva do `prisma migrate` (72707369).
- **B — conector Supabase, uma única `execute_sql` (§5):** desvio da D-PROD-74,
  registrado no §11, só com o GO escrito do proprietário **para esta migration**
  (§2). Nunca presumido de releases anteriores nem de autorização genérica.

## 2. Pré-requisitos e GOs

**Pré-requisitos (todos antes da aplicação):**
- toda a validação **local** da PR verde (o GitHub Actions está pausado a pedido do
  proprietário: os testes rodam todos localmente): `verify:all` (com `test:backend` e
  `test:smoke`) e o ensaio do §4.2 no `<SHA_APROVADO>`;
- a branch está atualizada com a `main`, a PR está `mergeable` e esta é a **única**
  migration nova da release;
- nenhuma outra migration entrou na `main` nem foi aplicada em produção depois do
  preflight; se entrou, atualizar a branch, recontar o §4 e repetir o ensaio;
- `"Funcionario"` e `"AtividadeApontamentoMaoObra"` **vazias** em produção (preflight
  linhas 5 e 6). Com qualquer linha: `RELEASE_BLOCKED` e decisão nova do proprietário.

**GOs:**

| GO | O quê | Situação |
|---|---|---|
| GO-1 | rodar o preflight **só leitura** em produção (§4) | `<pendente>` |
| GO-2 | aplicar a migration CONTRACT D-PROD-208 (§5) antes do merge da PR do ajuste e mergear em seguida | `<pendente>` — escrito para **esta** migration; vale depois de toda a validação local verde e de um preflight `PRONTO PARA APLICAR`. No caminho B, registrar no §11 como o desvio da D-PROD-74 |

## 3. Ordem

Validação local verde (§2) → preflight §4 (anotar no §11) → ensaio local §4.2 com
o arquivo do SHA → GO-2 conferido → logo antes: repetir o preflight (as linhas 2,
3, 5, 6, 11 e 12 de novo) → aplicação §5 → **postcheck** §6 (só leitura) e alertas
do Supabase → merge §7 → deploy da `main` READY → conferência §8.

## 4. Preflight (somente leitura; `SELECT` no conector ou papel de leitura)

### 4.1 Uma consulta, com veredito

Cole TUDO e rode. Só `SELECT`. Qualquer `PARAR` → `RELEASE_BLOCKED`.

<!-- sql:preflight -->
```sql
-- MAIKE · D-PROD-208 · PREFLIGHT (somente leitura). Cole TUDO e rode. Qualquer PARAR = não aplicar.
WITH
esperado AS (SELECT '7692130048193495360'::text AS sid),
mig AS (
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS abertas,
         count(*) FILTER (WHERE migration_name = '20261116000000_mao_obra_parceiro' AND rolled_back_at IS NULL) AS esta,
         count(*) FILTER (WHERE migration_name = '20261115900000_atividade_mao_obra_servico'
                            AND checksum = '79f139a0ea5b55253db522f00af78dd4e252529ee259da59ada7b4932dad0725'
                            AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS anterior
    FROM public._prisma_migrations
),
-- Linhas nas 2 tabelas que mudam de forma, por SQL dinâmico: tabela ausente → NULL (a linha diz PARAR), nunca erro.
vazias AS (
  SELECT t.nome,
         CASE WHEN to_regclass(format('public.%I', t.nome)) IS NULL THEN NULL
              ELSE (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM public.%I', t.nome), false, true, '')))[1]::text::bigint
         END AS n
    FROM (VALUES ('Funcionario'), ('AtividadeApontamentoMaoObra')) AS t(nome)
),
colunas AS (
  SELECT count(*) FILTER (WHERE table_name = 'AtividadeApontamentoMaoObra' AND column_name = 'funcionario_id') AS antiga,
         count(*) FILTER (WHERE (table_name = 'AtividadeApontamentoMaoObra' AND column_name IN ('parceiro_id', 'origem'))
                             OR (table_name = 'Fornecedor' AND column_name IN ('funcionario_tipo', 'funcionario_cargo', 'funcionario_custo_hora', 'funcionario_custo_diaria'))) AS novas
    FROM information_schema.columns WHERE table_schema = 'public'
),
-- A chave que a FK nova referencia em "Fornecedor" (único exato, sem predicado).
chave AS (
  SELECT count(*) AS n FROM pg_index i
   WHERE i.indrelid = to_regclass('public."Fornecedor"') AND i.indisunique AND i.indpred IS NULL
     AND (SELECT string_agg(att.attname::text, ',' ORDER BY k.ord) FROM unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, ord)
            JOIN pg_attribute att ON att.attrelid = i.indrelid AND att.attnum = k.attnum) = 'cliente_id,id'
),
tabelas AS (SELECT count(*) AS n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')),
-- As que a migration trava em ACCESS EXCLUSIVE (as 2 que mudam, Fornecedor pelos ADD COLUMN; Cliente e Empresa pelo
-- DROP TABLE "Funcionario", que remove os gatilhos das FKs dela nessas duas).
travadas AS (
  SELECT to_regclass(format('public.%I', t))::oid AS oid
    FROM unnest(ARRAY['Funcionario', 'AtividadeApontamentoMaoObra', 'Fornecedor', 'Cliente', 'Empresa']) AS t
),
travas AS (
  SELECT count(*) AS n FROM pg_locks l
   WHERE l.locktype = 'relation' AND l.pid <> pg_backend_pid()
     AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
     AND l.relation IN (SELECT oid FROM travadas WHERE oid IS NOT NULL)
),
longas AS (
  SELECT count(*) AS n FROM pg_stat_activity
   WHERE datname = current_database() AND pid <> pg_backend_pid() AND xact_start IS NOT NULL AND now() - xact_start > interval '30 seconds'
),
base(ordem, item, valor, esperado, status) AS (
  SELECT 1, 'alvo: system_identifier', (SELECT system_identifier::text FROM pg_control_system()), (SELECT sid FROM esperado),
         CASE WHEN (SELECT system_identifier::text FROM pg_control_system()) = (SELECT sid FROM esperado) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 2, 'migrations concluídas / em aberto', (SELECT concluidas || ' / ' || abertas FROM mig), '58 / 0',
         CASE WHEN (SELECT concluidas = 58 AND abertas = 0 FROM mig) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 3, '20261116000000_mao_obra_parceiro já registrada', (SELECT esta::text FROM mig), '0',
         CASE WHEN (SELECT esta FROM mig) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 4, 'a anterior (D-PROD-207) concluída com o checksum do repositório', (SELECT anterior::text FROM mig), '1',
         CASE WHEN (SELECT anterior FROM mig) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 5, '"Funcionario": linhas (tem de estar VAZIA)', (SELECT coalesce(n::text, 'ausente') FROM vazias WHERE nome = 'Funcionario'), '0',
         CASE WHEN (SELECT n FROM vazias WHERE nome = 'Funcionario') = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 6, '"AtividadeApontamentoMaoObra": linhas (tem de estar VAZIA)', (SELECT coalesce(n::text, 'ausente') FROM vazias WHERE nome = 'AtividadeApontamentoMaoObra'), '0',
         CASE WHEN (SELECT n FROM vazias WHERE nome = 'AtividadeApontamentoMaoObra') = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 7, 'coluna antiga AtividadeApontamentoMaoObra.funcionario_id presente', (SELECT antiga::text FROM colunas), '1',
         CASE WHEN (SELECT antiga FROM colunas) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 8, 'colunas novas já presentes (parceiro_id, origem, funcionario_*)', (SELECT novas::text FROM colunas), '0',
         CASE WHEN (SELECT novas FROM colunas) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 9, 'chave (cliente_id, id) de Fornecedor que a FK nova referencia', (SELECT n::text FROM chave), '1',
         CASE WHEN (SELECT n FROM chave) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 10, 'tabelas em public', (SELECT n::text FROM tabelas), '95',
         CASE WHEN (SELECT n FROM tabelas) = 95 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 11, 'travas de outras sessões nas tabelas que a migration trava, agora', (SELECT n::text FROM travas), '0',
         CASE WHEN (SELECT n FROM travas) = 0 THEN 'OK' ELSE 'ATENÇÃO (repita fora de pico)' END
  UNION ALL
  SELECT 12, 'transações abertas há mais de 30 s', (SELECT n::text FROM longas), '0',
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
| migrations | `58 / 0` |
| esta migration registrada | `0` |
| a anterior (D-PROD-207) com o checksum do repositório | `1` |
| `"Funcionario"` e `"AtividadeApontamentoMaoObra"`: linhas | `0` e `0` (vazias em produção, conferido no planejamento; qualquer linha → `PARAR`) |
| coluna antiga presente / colunas novas presentes | `1` / `0` |
| chave de `Fornecedor` | `1` |
| tabelas em `public` | `95` |
| travas de outras sessões e transações longas | `0` e `0` (senão `ATENÇÃO`: esperar e repetir fora de pico) |

E, localmente, no `<SHA_APROVADO>`:
`sha256sum backend/prisma/migrations/20261116000000_mao_obra_parceiro/migration.sql`
igual ao pinado, e a análise local do `premerge-migrate` (§1) com `modo: CONTRACT`,
o `contract[0]` do §0 e `violacoes: []`.

### 4.2 Ensaio local (com o arquivo exato do `<SHA_APROVADO>`)

Automatizado em `backend/tests/atividadeMaoObraParceiroMigration.test.mjs`, só
contra PostgreSQL local, em bancos próprios criados e apagados pelo teste. Ele roda
**este** preflight, **este** envelope do caminho B e **este** postcheck (lidos
deste arquivo, entre os marcadores `sql:…`), trocando só o `system_identifier` de
produção pelo local:

- partida: as 58 migrations de nome anterior a esta, pelo Prisma, com os parceiros e
  um apontamento do dia; preflight `PRONTO`; `migrate diff` da partida contra o
  `schema.prisma` acusa exatamente a diferença que esta migration fecha;
- o classificador (`CONTRACT D-PROD-208`, sem violação) e a barreira do runner: sem
  `MIGRATION_CONTRACT_AUTORIZADO=D-PROD-208` exato, recusa antes de qualquer DDL;
- RED (cada um num banco novo, recusado pela guarda `guarda: …` e **nada** muda): uma
  linha em `"Funcionario"`, uma linha em `"AtividadeApontamentoMaoObra"`;
- GREEN pelo runner oficial com a conferência de alvo e a decisão exata: 59/0, 94
  tabelas, `Funcionario` ausente, `funcionario_id` ausente, as 6 colunas com o tipo
  e a nulidade certos, os 2 CHECKs (23514), a FK nova pelo tenant e `RESTRICT`
  (23503), o índice com `cliente_id` na frente, `migrate diff` vazio, postcheck
  `APLICADA`; reaplicar o `migration.sql` é recusado pela guarda sem mudar nada;
- caminho B: o envelope com o `system_identifier` de produção recusa (alvo
  divergente); histórico fora de 58/0, a D-PROD-207 com outro checksum ou uma linha
  em qualquer das duas tabelas recusam antes do DDL; o envelope aplica (58 → 59,
  checksum = SHA-256 do arquivo, `applied_steps_count` 1, o mesmo schema do runner),
  o Prisma não vê pendência, `migrate diff` vazio, postcheck `APLICADA`; repetir o
  envelope recusa.

Registrar o resultado no §11.

## 5. Aplicação — só com o GO-2 e o §2 cumprido

### Caminho A (padrão)

Os comandos do §1, com o `<SHA_APROVADO>` e `--contract D-PROD-208`. O
`--verificar-alvo` tem de terminar com `ALVO VERIFICADO — 1 pendente(s) do manifesto`.

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
              WHERE migration_name = '20261116000000_mao_obra_parceiro' AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)
    INTO n_ok, n_aberta FROM _prisma_migrations;
  IF n_ok <> 58 OR n_aberta <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % em aberto', n_ok, n_aberta;
  END IF;
  IF (SELECT count(*) FROM _prisma_migrations
       WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
         AND migration_name = '20261115900000_atividade_mao_obra_servico'
         AND checksum = '79f139a0ea5b55253db522f00af78dd4e252529ee259da59ada7b4932dad0725') <> 1 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (D-PROD-207) ausente ou com checksum divergente';
  END IF;
  IF to_regclass('public."Funcionario"') IS NULL OR to_regclass('public."AtividadeApontamentoMaoObra"') IS NULL THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: "Funcionario" ou "AtividadeApontamentoMaoObra" ausente';
  END IF;
  -- A guarda da migration (logo abaixo) trava as duas e confere de novo; esta conferência só para antes, com a mensagem do runbook.
  IF EXISTS (SELECT 1 FROM public."Funcionario") OR EXISTS (SELECT 1 FROM public."AtividadeApontamentoMaoObra") THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: "Funcionario" ou "AtividadeApontamentoMaoObra" não está vazia';
  END IF;
END $alvo$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '65a8a4eb8abc7b44e24d3121605a375fee34ea88968bffe875c53b30e9cf9dd0', now(),
        '20261116000000_mao_obra_parceiro', NULL, NULL, now(), 1);
COMMIT;
```
<!-- /sql:caminho-b -->

- O `migration.sql` não tem `BEGIN`/`COMMIT` próprios; a guarda `DO $$ … $$` dele
  vai como está (o envelope usa `$alvo$`, que não colide) e confere, com as duas
  tabelas travadas, que continuam vazias.
- O `checksum` do `INSERT` é o SHA-256 do arquivo: com outro valor o Prisma acusa
  divergência e o `premerge-migrate` recusa as releases seguintes
  (`PREMERGE_MIGRATIONS_NAO_COMPROVADAS`).
- Qualquer falha desfaz tudo, inclusive o `INSERT` em `_prisma_migrations`.

### 5.1 Falha no caminho A (`55P03`, `guarda: …` ou outro erro)

1. Nada fica (uma transação só): `"Funcionario"` e `funcionario_id` continuam; a
   linha da migration fica com `finished_at` NULL.
2. Conferir pelo preflight (linhas 5 a 8 iguais às de antes).
3. Com a conexão de **produção** explícita (o schema lê `DATABASE_URL`):
   `DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate resolve --rolled-back 20261116000000_mao_obra_parceiro --schema backend/prisma/schema.prisma`.
4. Eliminar a causa e confirmar com o proprietário antes de tentar de novo. Se a
   causa for `guarda: … tem linhas`, **não** tentar de novo: decisão nova.
5. Uma tentativa resolvida (`rolled_back_at` preenchido) não bloqueia o envelope
   do caminho B; uma linha ainda aberta bloqueia (resolver primeiro).

### 5.2 Falha no caminho B

Nada é aplicado (uma transação só). Repetir o preflight (linhas 2, 3, 5, 6, 7 e 8
iguais às de antes), eliminar a causa e confirmar com o proprietário antes de tentar
de novo.

## 6. Postcheck (antes do merge; só leitura)

Qualquer `PARAR`: **não mergear** e chamar o proprietário.

<!-- sql:postcheck -->
```sql
-- MAIKE · D-PROD-208 · POSTCHECK (somente leitura). Cole TUDO e rode. Esperado: tudo OK/CONFIRA e VEREDITO APLICADA.
WITH
esperado AS (SELECT '7692130048193495360'::text AS sid),
mig AS (
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) AS abertas,
         count(*) FILTER (WHERE migration_name = '20261116000000_mao_obra_parceiro'
                            AND checksum = '65a8a4eb8abc7b44e24d3121605a375fee34ea88968bffe875c53b30e9cf9dd0'
                            AND finished_at IS NOT NULL AND rolled_back_at IS NULL AND applied_steps_count = 1) AS esta
    FROM public._prisma_migrations
),
mo AS (SELECT to_regclass('public."AtividadeApontamentoMaoObra"')::oid AS oid),
fo AS (SELECT to_regclass('public."Fornecedor"')::oid AS oid),
-- As 6 colunas novas com o tipo e a nulidade do contrato.
colunas_esperadas(tabela, coluna, tipo, nula) AS (VALUES
  ('AtividadeApontamentoMaoObra', 'parceiro_id', 'character varying(64)', 'NO'),
  ('AtividadeApontamentoMaoObra', 'origem', 'character varying(12)', 'NO'),
  ('Fornecedor', 'funcionario_tipo', 'character varying(16)', 'YES'),
  ('Fornecedor', 'funcionario_cargo', 'character varying(120)', 'YES'),
  ('Fornecedor', 'funcionario_custo_hora', 'numeric(14,4)', 'YES'),
  ('Fornecedor', 'funcionario_custo_diaria', 'numeric(14,4)', 'YES')
),
colunas AS (
  SELECT count(*) AS n FROM colunas_esperadas e
    JOIN information_schema.columns c ON c.table_schema = 'public' AND c.table_name = e.tabela AND c.column_name = e.coluna
   WHERE c.is_nullable = e.nula AND c.column_default IS NULL
     AND (CASE WHEN c.data_type = 'numeric' THEN 'numeric(' || c.numeric_precision || ',' || c.numeric_scale || ')'
               ELSE 'character varying(' || c.character_maximum_length || ')' END) = e.tipo
),
antiga AS (
  SELECT count(*) AS n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'AtividadeApontamentoMaoObra' AND column_name = 'funcionario_id'
),
checks AS (
  SELECT count(*) AS n FROM pg_constraint k
   WHERE k.contype = 'c' AND k.convalidated
     AND ((k.conrelid = (SELECT oid FROM fo) AND k.conname = 'Fornecedor_funcionario_check')
       OR (k.conrelid = (SELECT oid FROM mo) AND k.conname = 'AtividadeApontamentoMaoObra_origem_check'))
),
fk AS (
  SELECT count(*) FILTER (WHERE k.conname = 'AtividadeApontamentoMaoObra_parceiro_fkey' AND k.confrelid = (SELECT oid FROM fo)
                            AND k.confdeltype = 'r' AND k.confupdtype = 'c' AND k.convalidated
                            AND pg_get_constraintdef(k.oid) = 'FOREIGN KEY (cliente_id, parceiro_id) REFERENCES "Fornecedor"(cliente_id, id) ON UPDATE CASCADE ON DELETE RESTRICT') AS nova,
         count(*) FILTER (WHERE k.conname = 'AtividadeApontamentoMaoObra_funcionario_fkey') AS antiga
    FROM pg_constraint k WHERE k.conrelid = (SELECT oid FROM mo) AND k.contype = 'f'
),
indices AS (
  SELECT count(*) FILTER (WHERE indexname = 'AtividadeApontamentoMaoObra_cliente_id_parceiro_id_idx'
                            AND indexdef LIKE '%USING btree (cliente_id, parceiro_id)') AS novo,
         count(*) FILTER (WHERE indexname = 'AtividadeApontamentoMaoObra_cliente_id_empresa_id_funcionar_idx') AS antigo
    FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'AtividadeApontamentoMaoObra'
),
-- Por SQL dinâmico, só quando as 4 colunas do papel existem (antes de aplicar: NULL, nunca erro).
linhas AS (
  SELECT (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public."AtividadeApontamentoMaoObra"', false, true, '')))[1]::text::bigint AS mao_obra,
         CASE WHEN (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'Fornecedor'
                      AND column_name IN ('funcionario_tipo', 'funcionario_cargo', 'funcionario_custo_hora', 'funcionario_custo_diaria')) = 4
              THEN (xpath('/row/n/text()', query_to_xml('SELECT count(*) AS n FROM public."Fornecedor" WHERE funcionario_tipo IS NOT NULL OR funcionario_cargo IS NOT NULL OR funcionario_custo_hora IS NOT NULL OR funcionario_custo_diaria IS NOT NULL', false, true, '')))[1]::text::bigint
         END AS papel
),
tabelas AS (SELECT count(*) AS n FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')),
base(ordem, item, valor, esperado, status) AS (
  SELECT 1, 'alvo: system_identifier', (SELECT system_identifier::text FROM pg_control_system()), (SELECT sid FROM esperado),
         CASE WHEN (SELECT system_identifier::text FROM pg_control_system()) = (SELECT sid FROM esperado) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 2, '20261116000000_mao_obra_parceiro concluída (checksum pinado, applied_steps_count 1)', (SELECT esta::text FROM mig), '1',
         CASE WHEN (SELECT esta FROM mig) = 1 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 3, 'migrations concluídas / em aberto', (SELECT concluidas || ' / ' || abertas FROM mig), '59 / 0',
         CASE WHEN (SELECT concluidas = 59 AND abertas = 0 FROM mig) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 4, 'tabelas em public', (SELECT n::text FROM tabelas), '94',
         CASE WHEN (SELECT n FROM tabelas) = 94 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 5, '"Funcionario" presente', (CASE WHEN to_regclass('public."Funcionario"') IS NULL THEN '0' ELSE '1' END), '0',
         CASE WHEN to_regclass('public."Funcionario"') IS NULL THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 6, 'coluna AtividadeApontamentoMaoObra.funcionario_id presente', (SELECT n::text FROM antiga), '0',
         CASE WHEN (SELECT n FROM antiga) = 0 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 7, 'as 6 colunas novas com o tipo e a nulidade do contrato', (SELECT n::text FROM colunas), '6',
         CASE WHEN (SELECT n FROM colunas) = 6 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 8, 'os 2 CHECKs novos, validados', (SELECT n::text FROM checks), '2',
         CASE WHEN (SELECT n FROM checks) = 2 THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 9, 'FK nova para o parceiro (cliente_id, parceiro_id), RESTRICT/CASCADE, validada / FK antiga do funcionário', (SELECT nova || ' / ' || antiga FROM fk), '1 / 0',
         CASE WHEN (SELECT nova = 1 AND antiga = 0 FROM fk) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 10, 'índice novo (cliente_id, parceiro_id) / índice antigo do funcionário', (SELECT novo || ' / ' || antigo FROM indices), '1 / 0',
         CASE WHEN (SELECT novo = 1 AND antigo = 0 FROM indices) THEN 'OK' ELSE 'PARAR' END
  UNION ALL
  SELECT 11, 'linhas de mão de obra / parceiros com dado de funcionário', (SELECT mao_obra || ' / ' || coalesce(papel::text, '-') FROM linhas), '0 / 0',
         CASE WHEN (SELECT mao_obra = 0 AND papel = 0 FROM linhas) THEN 'OK' ELSE 'CONFIRA (o código novo já gravou?)' END
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

Esperado: `1`; `59 / 0`; `94`; `0`; `0`; `6`; `2`; `1 / 0`; `1 / 0`; `0 / 0`;
VEREDITO `APLICADA E CONFERIDA`. Mais:

- `get_advisors` (segurança e performance): nenhum alerta novo de segurança (nenhuma
  tabela nova; `"Fornecedor"` e `"AtividadeApontamentoMaoObra"` com o RLS de antes).
  **Esperado** e não é motivo para parar: o índice novo aparece como INFO
  `unused_index` até a primeira consulta que o use;
- opcional, no caminho A: `node scripts/deploy/preflight-schema.mjs` com a conexão
  de produção → exit 0 (nenhuma migration pendente; `Fornecedor.funcionario_tipo`,
  `AtividadeApontamentoMaoObra.parceiro_id` e `.origem` em `COLUNAS_EXIGIDAS`
  presentes).

## 7. Merge

Com o §6 todo verde: mergear a PR do ajuste **logo em seguida** (entre a aplicação
e o deploy, a tela Funcionários e a mão de obra do apontamento de hoje dão 500). Se
a `main` andou, atualizar a branch **sem migration nova** e mergear. A Vercel
publica a `main`; o build não roda migration.

## 8. Depois do deploy (proprietário)

1. Deploy READY na Vercel: `/api/native/health` com o `release` da `main` nova.
2. `/api/native/atividades-opcoes/mao-obra` sem sessão → 401; `/api/native/funcionarios`
   não existe mais (404).
3. Parceiros: o papel **Funcionário** aparece entre os papéis; ao marcá-lo, os campos
   tipo, cargo, custo por hora e custo por diária.
4. Lançamento de Atividades: na mão de obra do apontamento do dia, o seletor traz os
   parceiros com papel funcionário e os prestadores de serviço (terceiros). A
   primeira linha de verdade é do proprietário.

## 9. Reversão

- **Código:** o Instant Rollback da Vercel para o deploy anterior **não é seguro**
  depois da aplicação (o código anterior lê `"Funcionario"` e `funcionario_id`).
- **Banco, se for preciso voltar:** uma migration **nova**, com decisão e GO
  próprios, nunca editando esta: recriar `"Funcionario"` como a D-PROD-207 a criou,
  apagar `parceiro_id`, `origem`, os 2 CHECKs, a FK e o índice novos e as 4 colunas
  `funcionario_*` de `"Fornecedor"`, e voltar `funcionario_id`. Só é exato enquanto a
  linha de mão de obra estiver vazia e nenhum parceiro tiver o papel funcionário com
  dados: com dado gravado, a volta exige decisão do proprietário.
- **Rede de segurança:** o backup diário / PITR do Supabase do momento anterior à
  aplicação (anotar o horário no §11).

## 10. `RELEASE_BLOCKED`

- sem o GO-2 (no caminho B, sem o desvio da D-PROD-74 registrado para esta migration);
- validação local da PR não verde;
- alvo com `system_identifier` diferente;
- histórico diferente de 58/0 antes, a D-PROD-207 com outro checksum, ou a D-PROD-208
  já registrada (linha não revertida);
- qualquer linha em `"Funcionario"` ou em `"AtividadeApontamentoMaoObra"`;
- qualquer `PARAR` no preflight;
- outra migration nova na mesma release;
- SHA-256 do arquivo diferente do pinado, ou classificador fora do esperado;
- conexão do runtime ausente ou apontando para outro banco no caminho A;
- ensaio local (§4.2) sem passar no `<SHA_APROVADO>`;
- horário de pico (`Cliente`, `Empresa` e `Fornecedor` ficam travados, inclusive
  para leitura, por menos de 1 s).

## 11. Registro da execução

| Campo | Valor |
|---|---|
| GO-1 e GO-2 | `<pendente>` |
| Caminho | `<A ou B>` |
| `<SHA_APROVADO>` | `<pendente>` |
| Verificação do SHA | `<sha256sum local igual ao pinado>` |
| Ensaio local (§4.2) | `<atividadeMaoObraParceiroMigration.test.mjs n/n>` |
| Preflight (§4) | `<horário; 58 / 0; 0; 1; 0; 0; 1; 0; 1; 95; travas; longas; veredito>` |
| Backup / PITR anterior | `<pendente>` |
| Aplicação | `<horário UTC; checksum; applied_steps_count>` |
| Postcheck (§6) | `<pendente>` |
| Alertas do Supabase | `<pendente>` |
| Merge e deploy | `<PR; data>` |
