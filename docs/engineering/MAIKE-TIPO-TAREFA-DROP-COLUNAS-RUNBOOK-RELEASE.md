# MAIKE — Tipo de Tarefa sem colunas: runbook de release CONTRACT (D-PROD-183)

> **Estado: NÃO EXECUTADO.** Nada foi lido nem escrito em produção. A migration está pronta na
> PR e **não foi aplicada em nenhum ambiente remoto**. Este runbook só roda com o **GO explícito
> do proprietário** (§2): o pedido da Fatia LIMPEZA diz "NÃO aplique a migration. Só deixe
> pronta na PR" e "autorização explícita minha antes de rodar".
>
> Valores entre `<…>` são preenchidos na hora da execução, sempre a partir de leituras reais.

Decisão: [D-PROD-183](./DECISIONS.md). Relatório:
[`MAIKE-TIPO-TAREFA-DROP-COLUNAS-REPORT.md`](./MAIKE-TIPO-TAREFA-DROP-COLUNAS-REPORT.md).
Modelo: [runbook da D-PROD-162](./MAIKE-PATRIMONIO-SIMPLIFICA-01-RUNBOOK-RELEASE.md), o único
CONTRACT anterior, reduzido ao que um `DROP COLUMN` numa tabela só precisa.

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261113200000_tipo_tarefa_drop_colunas` |
| Natureza | **CONTRACT** (segunda exceção fechada à D-PROD-72 item 3 e à D-PROD-107 R7, registrada na D-PROD-183), numa transação: (1) guarda DO; (2) `ALTER TABLE "TipoTarefa" DROP COLUMN` das 4 colunas, nesta ordem: `exige_area`, `pode_ter_produto`, `pode_ter_maquina`, `pode_ter_implemento` |
| O que se perde | os valores gravados nas 4 colunas, em **todos** os clientes. Desde a D-PROD-181 ninguém lê nem escreve nelas; os `true` que existirem são do cadastro antigo |
| O que não muda | nenhuma tabela é criada nem apagada; nenhuma outra tabela é tocada; as 9 colunas que ficam, as linhas, os índices, as FKs (inclusive `LancamentoTarefa → TipoTarefa`), a RLS e as políticas de `TipoTarefa` ficam iguais |
| SHA-256 do arquivo (`MIGRATIONS_APROVADAS`) | `47409bb1a7d371efe89fffba753ae292aec6f95e1ba7845d35dff74371136c17` |
| Hash da guarda (`MIGRATIONS_CONTRACT_APROVADAS`) | `35e1a698b0567bf07f9e99943f7181a3a6ee8b1e03ea2ff423a939e755984878` |
| Classificador | `modo: CONTRACT`; 0 tabelas removidas; 0 CHECKs alargados; 4 colunas removidas; `tabelas_novas: []`; `colunas_novas_em_tabelas_antigas: []`; 0 violações |
| `_prisma_migrations` | antes **41** concluídas / 0 em aberto; depois **42** |
| Colunas de `TipoTarefa` | antes **13**; depois **9** (`id`, `cliente_id`, `nome_tipo`, `grupo_atividade_id`, `grupo_atividade_nome`, `ativo`, `descricao`, `createdAt`, `updatedAt`) |
| Tabelas em `public` | **iguais** antes e depois |

**Sem janela de erro.** O código hoje em produção (schema da D-PROD-181, com as 4 colunas em
`@ignore`) não cita as colunas em consulta nenhuma: o Prisma Client dele foi gerado e rodado
contra um PG local já sem as colunas, com `create`, `findMany`, `update`, `include` e `delete` de
`TipoTarefa` sem erro. O código desta PR também não as cita. Por isso aplicar antes do merge
não dá 500, e a `main` não precisa ficar congelada por causa do runtime.

**Mas build ANTERIOR à D-PROD-181 quebra.** O Prisma Client da `main` de antes do merge da
PR #254 (`6b85696^1`, schema com as 4 colunas sem `@ignore`) lista as colunas no `SELECT` de
`TipoTarefa`: gerado e rodado contra o PG local sem as colunas, `findMany` falhou com
`P2022 TipoTarefa.exige_area`. Depois da aplicação, portanto:
- **nunca** fazer *Instant Rollback* da Vercel de produção para um deploy anterior ao merge
  `6b85696` (PR #254);
- Previews de branch que não contenha a D-PROD-181 usam o mesmo banco e dão 500 em Tipos de
  Tarefa, Lançamentos de Tarefa e no Mapa: não usar essas Previews.

**Por que aplicar ANTES do merge:** o `premerge-migrate` só enxerga a migration como "nova"
enquanto ela não está na `main`. Depois do merge, o `--contract D-PROD-183` passaria a ser
`CONTRACT_INESPERADO` e o `deploy:migrate` recusaria o CONTRACT pendente sem a autorização. A
ordem é: aplicar (§5) → postcheck (§6) → merge (§7).

## 1. Caminho

- **Caminho A (padrão, D-PROD-74):** runner oficial `premerge-migrate.mjs --sha <SHA_APROVADO>`,
  primeiro com `--verificar-alvo --contract D-PROD-183` e depois com
  `--aplicar --contract D-PROD-183`, numa máquina protegida do operador (§5).
- **Caminho B (conector Supabase, uma transação):** só com GO que cite o desvio da D-PROD-74,
  como na D-PROD-162. Envelope no §5.
- O `npm run deploy:migrate` à mão e o `release-migrate.yml` **recusam** esta migration
  (`DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED`) enquanto ela estiver pendente no alvo: só o
  `premerge-migrate --aplicar --contract D-PROD-183` passa `MIGRATION_CONTRACT_AUTORIZADO`.
- **Isolamento:** a release tem esta migration e mais nenhuma (`CONTRACT_NAO_ISOLADO`). A
  Fatia C (`ApontamentoAtividade`) só entra depois desta aplicada e mergeada.

## 2. Pré-requisitos e GOs

**Pré-requisitos (todos antes da aplicação):**
- a PR foi revista pelo proprietário e marcada como pronta com a autorização dele;
- a branch está atualizada com a `main` e a PR está `mergeable`;
- o CI está verde no `<SHA_APROVADO>` (40 hex);
- nenhuma outra migration nova entrou na `main` depois do `<SHA_APROVADO>`; se entrou,
  atualizar a branch, gerar SHA novo e repetir CI e o ensaio (§4.5);
- o deploy de produção atual da Vercel contém o merge `6b85696` (PR #254, D-PROD-181) ou é
  posterior a ele, e o proprietário aceita que, depois da aplicação, o *Instant Rollback* para
  antes desse merge fica proibido (§0).

**GOs (nenhum está coberto hoje):**

| GO | O quê | Situação |
|---|---|---|
| GO-1 | rodar o preflight **só leitura** em produção (§4) | **não coberto**: pedir ao proprietário |
| GO-2 | aplicar a migration CONTRACT (§5) e mergear em seguida | **não coberto**: pedir ao proprietário com o §11 preenchido (impressão, contagens por cliente, backup, caminho A ou B) |
| GO-3 | (só se preciso) reversão §9 | **não coberto**: pedir ao proprietário, com a operação exata |

## 3. Ordem

GO-1 → preflight §4 → contagens por cliente + **impressão** anotadas no §11 → [bloco C com
alguma linha: `RELEASE_BLOCKED` até o proprietário decidir] → backup §4.4 → ensaio local §4.5 com
o arquivo do SHA → pré-requisitos do §2 → GO-2 → logo antes: repetir a impressão (bloco B) e o
bloco D; se a impressão mudou, parar e levar o fato ao proprietário → migration §5 →
**postcheck** §6 (só leitura) → merge §7 → deploy da `main` READY → conferência §8.

- A transação dura menos de 1 s. A guarda trava `TipoTarefa` em `ACCESS EXCLUSIVE`; se houver
  transação segurando a tabela, ela desiste em 5 s (`55P03`) sem aplicar nada (§5.1).
- Um cadastro de Tipo de Tarefa feito durante a janela espera a trava (≤ 5 s) ou falha e é
  repetido pelo usuário.

## 4. Preflight (somente leitura; `SELECT` no conector ou papel de leitura)

### 4.1 Bloco A — identidade, histórico e colunas

```sql
SELECT system_identifier FROM pg_control_system();            -- 7692130048193495360 (o da D-PROD-162)
SHOW server_version_num;                                      -- 17xxxx (PG 17; a guarda foi ensaiada em 16 e cobre o NOT NULL do 18)
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
       count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)     AS falha_aberta
  FROM _prisma_migrations;                                    -- 41 | 0
SELECT migration_name, finished_at IS NOT NULL AS concluida FROM _prisma_migrations
 WHERE migration_name IN ('20261110300000_patrimonio_simplifica', '20261113100000_tipo_atividade_cadastro', '20261113200000_tipo_tarefa_drop_colunas')
 ORDER BY 1;                                                  -- as 2 primeiras concluídas; a D-PROD-183 AUSENTE
SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS padrao
  FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
 WHERE a.attrelid = 'public."TipoTarefa"'::regclass AND a.attnum > 0 AND NOT a.attisdropped
 ORDER BY a.attnum;                                           -- 13 colunas; as 4 boolean NOT NULL DEFAULT false
```

### 4.2 Bloco B — o que se perde, por cliente, e a impressão

```sql
SELECT t.cliente_id, c.nome AS cliente, count(*) AS tipos_com_algum_true,
       count(*) FILTER (WHERE t.exige_area) AS exige_area, count(*) FILTER (WHERE t.pode_ter_produto) AS pode_ter_produto,
       count(*) FILTER (WHERE t.pode_ter_maquina) AS pode_ter_maquina, count(*) FILTER (WHERE t.pode_ter_implemento) AS pode_ter_implemento
  FROM public."TipoTarefa" t JOIN public."Cliente" c ON c.id = t.cliente_id
 WHERE t.exige_area OR t.pode_ter_produto OR t.pode_ter_maquina OR t.pode_ter_implemento
 GROUP BY 1, 2 ORDER BY 1;
```

Impressão (uma instrução, com **a mesma expressão** da guarda; é o valor de
`maike.tipo_tarefa_flags_impressao` no §5 e o que se anota no §11):

```sql
SELECT count(*) AS linhas,
       left(md5(array_to_string(coalesce(array_agg(t.cliente_id || '|' || t.id || '|' || t.exige_area || '|' || t.pode_ter_produto || '|' || t.pode_ter_maquina || '|' || t.pode_ter_implemento
                                                   ORDER BY t.cliente_id COLLATE "C", t.id COLLATE "C"), ARRAY[]::text[]), E'\n')), 12) AS impressao
  FROM public."TipoTarefa" t
 WHERE t.exige_area OR t.pode_ter_produto OR t.pode_ter_maquina OR t.pode_ter_implemento;
```

- `linhas = 0`: não há valor a perder. A guarda dispensa o parâmetro (e, se ele for informado,
  ele tem de ser `d41d8cd98f00`, a impressão do vazio).
- `linhas > 0`: a guarda **exige** o parâmetro igual a esta impressão. Ela muda se alguém
  apagar um Tipo de Tarefa com flag `true` entre o preflight e a aplicação (ninguém mais grava
  as flags desde a D-PROD-181).

### 4.3 Bloco C — o que a guarda vai recusar (esperado: 0 linhas nas duas)

```sql
SELECT pg_describe_object(dp.classid, dp.objid, dp.objsubid) AS dependente
  FROM pg_depend dp JOIN pg_attribute a ON a.attrelid = dp.refobjid AND a.attnum = dp.refobjsubid
 WHERE dp.refclassid = 'pg_class'::regclass AND dp.refobjid = 'public."TipoTarefa"'::regclass
   AND a.attname IN ('exige_area', 'pode_ter_produto', 'pode_ter_maquina', 'pode_ter_implemento')
   AND NOT (dp.classid = 'pg_attrdef'::regclass
            AND dp.objid IN (SELECT d.oid FROM pg_attrdef d WHERE d.adrelid = dp.refobjid AND d.adnum = dp.refobjsubid))
   AND NOT (dp.classid = 'pg_constraint'::regclass
            AND dp.objid IN (SELECT k.oid FROM pg_constraint k
                              WHERE k.conrelid = dp.refobjid AND k.contype = 'n' AND k.conkey = ARRAY[dp.refobjsubid]::smallint[]));
SELECT p.oid::regprocedure AS rotina
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
 WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema') AND ns.nspname NOT LIKE 'pg\_%'
   AND (p.prosrc || ' ' || coalesce(array_to_string(p.proargnames, ' '), '')) ~* '(exige_area|pode_ter_produto|pode_ter_maquina|pode_ter_implemento)';
SELECT to_regclass('cron.job') IS NOT NULL AS tem_pg_cron;
-- só se tem_pg_cron = true (a guarda não lê cron.job; esta conferência é do operador):
SELECT jobid, jobname FROM cron.job
 WHERE command ~* '(exige_area|pode_ter_produto|pode_ter_maquina|pode_ter_implemento)';
```

- A 1ª lista o que depende das 4 colunas (o próprio `DEFAULT` e, no PG 18, o próprio `NOT NULL`
  ficam de fora): índice, constraint, visão/regra, política, gatilho com `UPDATE OF`, estatística,
  publicação com lista de colunas, coluna gerada ou função SQL com corpo `BEGIN ATOMIC`.
- A 2ª lista função ou procedure fora dos schemas do sistema que cite uma delas no corpo ou nos
  parâmetros de saída (`RETURNS TABLE`/`OUT`). A busca ignora maiúsculas, porque `NEW.Exige_Area`
  sem aspas é a mesma coluna.
- A última lista job do pg_cron cujo comando cite uma delas; ele quebraria em silêncio depois do
  DROP.

Qualquer linha: `RELEASE_BLOCKED` até o proprietário decidir. O repositório não cria nenhum
desses objetos.

### 4.4 Bloco D — transações longas, e backup

```sql
SELECT pid, state, now() - xact_start AS idade, left(query, 80) AS consulta FROM pg_stat_activity
 WHERE datname = current_database() AND xact_start IS NOT NULL AND now() - xact_start > interval '30 seconds';   -- nenhuma
```

- Último backup físico `COMPLETED` anterior à janela (painel do Supabase ou API de gestão com o
  token do proprietário). Sem prova de backup → `RELEASE_BLOCKED`. Ele restaura o banco
  **inteiro**.
- Se o bloco B tiver linhas, o proprietário escolhe e anota no §11:
  - (a) guardar ele mesmo, na máquina dele, a lista com `id` e as 4 flags, pela consulta abaixo;
  - (b) "não há volta parcial; aceito".

  O agente não recebe o arquivo.

```sql
SELECT id, cliente_id, nome_tipo, exige_area, pode_ter_produto, pode_ter_maquina, pode_ter_implemento
  FROM public."TipoTarefa"
 WHERE exige_area OR pode_ter_produto OR pode_ter_maquina OR pode_ter_implemento
 ORDER BY cliente_id, id;
```

### 4.5 Ensaio local (com o arquivo exato do `<SHA_APROVADO>`)

Automatizado por `scripts/dev/ensaio-tipo-tarefa-drop-colunas.mjs` (mesma prova do CI em
`backend/tests/tipoTarefaDropColunasMigration.test.mjs`), só contra banco local:

```bash
node scripts/dev/ensaio-tipo-tarefa-drop-colunas.mjs --url postgresql://<usuario>@localhost:5432/postgres
```

**RED (todos recusam e nada muda):** sem impressão; impressão errada; índice, visão, política
ou função citando uma coluna; gatilho com `NEW.Exige_Area` (caixa mista); função com a coluna só
no `RETURNS TABLE`; trava concorrente (`55P03` em ~5 s, pelo `lock_timeout` da própria guarda); `deploy:migrate` com a
conferência de alvo exigida e sem `MIGRATION_CONTRACT_AUTORIZADO=D-PROD-183` →
`DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED` antes de qualquer DDL.

**GREEN:** runner oficial com a conferência exigida, `MIGRATION_CONTRACT_AUTORIZADO=D-PROD-183` e
a impressão na URL → 42/0, `TipoTarefa` com as 9 colunas, linhas idênticas nas 9, mesmas
tabelas, `migrate diff --exit-code` 0, 2ª execução "No pending".

Registrar o resultado no §11.

## 5. Aplicação — só com o GO-2 e o §2 cumprido

### Caminho A (padrão)

- Máquina protegida.
- `MIGRATION_DATABASE_URL` direta ou de sessão na 5432 (nunca 6543), com
  `&options=-c%20lock_timeout%3D5s%20-c%20maike.tipo_tarefa_flags_impressao%3D<IMPRESSAO_DO_PREFLIGHT>`
  (sem `true` no bloco B, o parâmetro pode ficar de fora).
- `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360`.
- A conexão do **runtime** também, apontando para o **mesmo** banco de produção:
  `DATABASE_URL` (ou `POSTGRES_PRISMA_URL`, que tem prioridade). O `deploy:migrate` confere que
  migration e runtime são o mesmo banco lógico, e sem ela recusa com `runtime: conexão ausente`.
  Nenhum `.env` na raiz da checkout pode apontar para outro banco (o backend o lê com `dotenv`).

```bash
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>                                  # ANÁLISE LOCAL OK (CONTRACT D-PROD-183: 4 colunas removidas (…))
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo --contract D-PROD-183
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar --contract D-PROD-183   # repassa MIGRATION_CONTRACT_AUTORIZADO=D-PROD-183 ao deploy:migrate
```

Se o pooler de sessão descartar o `options`, a guarda recusa com `= ausente` (falha fechada,
nada aplicado). Nesse caso usar a conexão direta ou o caminho B.

### Caminho B (conector, uma `execute_sql`, só com GO que cite o desvio da D-PROD-74)

```sql
BEGIN;
SET LOCAL maike.tipo_tarefa_flags_impressao = '<IMPRESSAO_DO_PREFLIGHT>';
DO $alvo$
DECLARE
  sid text := (SELECT system_identifier::text FROM pg_control_system());
  ensaio text := nullif(current_setting('maike.tipo_tarefa_ensaio_alvo', true), '');
  n_ok bigint;
  n_ruim bigint;
BEGIN
  IF sid <> '7692130048193495360' AND (ensaio IS NULL OR ensaio <> sid) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: alvo divergente';
  END IF;
  IF EXISTS (SELECT 1 FROM _prisma_migrations
              WHERE migration_name = '20261113200000_tipo_tarefa_drop_colunas' AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 41 OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % em aberto', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261113100000_tipo_atividade_cadastro'
                    AND checksum = '5a0ded9c62f108c818c5796c2fe9d116faaceaf62bc4da6312562ec74d3a724e'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: TipoAtividade ausente ou com checksum divergente';
  END IF;
END $alvo$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '47409bb1a7d371efe89fffba753ae292aec6f95e1ba7845d35dff74371136c17', now(),
        '20261113200000_tipo_tarefa_drop_colunas', NULL, NULL, now(), 1);
COMMIT;
```

- O modo de ensaio do alvo só existe por `PGOPTIONS='-c maike.tipo_tarefa_ensaio_alvo=<sid local>'`,
  nunca editando o texto. Em produção o parâmetro não existe.
- Qualquer falha desfaz tudo, inclusive o `INSERT` em `_prisma_migrations`. Conferir com o
  bloco A que as 13 colunas continuam e pedir novo GO.
- Uma tentativa anterior do caminho A que falhou e foi resolvida (§5.1, `rolled_back_at`
  preenchido) não bloqueia o B. Uma linha ainda aberta (`finished_at` e `rolled_back_at` NULL)
  bloqueia: resolver primeiro.

### 5.1 Falha no caminho A (guarda, `55P03` ou *deadlock*)

1. Nada do DDL fica; a linha fica com `finished_at` NULL.
2. Conferir pelo bloco A que `TipoTarefa` continua com 13 colunas.
3. Com a conexão de **produção** explícita (o schema lê `DATABASE_URL`; sem isto o resolve
   cai num `.env` local e a linha de produção continua aberta):
   `DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate resolve --rolled-back 20261113200000_tipo_tarefa_drop_colunas --schema backend/prisma/schema.prisma`.
4. Eliminar a causa (a mensagem da guarda diz qual: impressão, dependente, rotina, colunas).
5. Refazer o bloco B. Se a impressão mudou, parar e levar o fato ao proprietário.
6. Repetir pelo A ou pelo B. No postcheck, aceitar exatamente essas linhas revertidas.

## 6. Postcheck (antes do merge; só leitura)

Qualquer divergência: **não mergear** e chamar o proprietário.

| # | Conferência | Esperado |
|---|---|---|
| R1 | `_prisma_migrations` | 42 concluídas, 0 em aberto (+ as revertidas do §5.1, se houve); a nova com o checksum `47409bb1…6c17` e `applied_steps_count = 1` |
| R2 | colunas de `TipoTarefa` (bloco A) | as 9, nesta ordem: `id`, `cliente_id`, `nome_tipo`, `grupo_atividade_id`, `grupo_atividade_nome`, `ativo`, `descricao`, `createdAt`, `updatedAt` |
| R3 | linhas de `TipoTarefa` | `count(*)` por cliente igual ao de antes |
| R4 | tabelas em `public` | o mesmo número de antes |
| R5 | RLS de `TipoTarefa` | `relrowsecurity` true, sem FORCE, as mesmas políticas de antes |
| R6 | `node scripts/deploy/preflight-schema.mjs`, com `DATABASE_URL` (ou `POSTGRES_PRISMA_URL`) de produção, a mesma do §5 | exit 0 (nenhuma migration pendente) |

## 7. Merge

Com o §6 todo verde: atualizar a branch se a `main` andou (sem migration nova) e mergear. A
Vercel publica a `main`; o build não roda migration.

## 8. Depois do deploy (só leitura, nenhuma escrita)

- Abrir **Tipos de Tarefa** e **Tipos de Atividade**: a lista carrega e um registro abre no
  formulário, **sem salvar nada**.
- Abrir **Lançamentos de Tarefa** e um lançamento existente, sem salvar.
- Nenhum erro novo em runtime da Vercel no intervalo.
- A primeira escrita em produção depois da release é do proprietário, como na D-PROD-162.

## 9. Reversão

Não há reversão automática. As colunas voltariam **vazias** (`DEFAULT false`) só por uma
migration EXPAND nova, com decisão própria — nunca editando a D-PROD-183. Os valores apagados
só voltam do que o proprietário guardou no §4.4 ou do backup físico (que restaura o banco
inteiro).

Rollback de código, sim: qualquer deploy que contenha o merge `6b85696` (D-PROD-181) funciona
com ou sem as colunas. Para antes dele, não (§0).

## 10. `RELEASE_BLOCKED`

- sem GO-1 ou GO-2;
- deploy de produção anterior ao merge `6b85696` (PR #254);
- `server_version_num` fora de 17xxxx sem nova revisão da guarda;
- conexão do runtime ausente ou apontando para outro banco no caminho A;
- job do pg_cron que cite as colunas;
- alvo com `system_identifier` diferente;
- histórico diferente de 41/0 antes, ou a D-PROD-183 já registrada;
- `TipoTarefa` sem alguma das 4 colunas, com tipo/nulidade/default diferente, ou com linha no bloco C;
- impressão diferente entre o preflight e a aplicação;
- sem prova de backup;
- classificador local fora do esperado (não `CONTRACT`, ≠ 4 colunas removidas, alguma violação);
- outra migration nova na mesma release.

## 11. Registro da execução

| Campo | Valor |
|---|---|
| GO-1 (preflight) | `<data, palavras do proprietário>` |
| GO-2 (aplicação) | `<data, palavras do proprietário>` |
| `<SHA_APROVADO>`, CI | `<sha>`, `<link>` |
| Alvo | `<system_identifier>` |
| Bloco A | `<41/0; colunas>` |
| Bloco B (por cliente) e impressão | `<tabela>`; `<linhas>` · `<hex12>` |
| Bloco C | `<0 linhas / 0 linhas>` |
| Bloco D e backup | `<transações longas>`; `<backup>`; escolha (a)/(b) |
| Ensaio local (§4.5) | `<resultado>` |
| Caminho | `<A/B>` |
| Aplicação | `<hora, saída>` |
| Postcheck R1–R6 | `<resultado>` |
| Merge e deploy | `<merge>`, `<deploy READY>` |
