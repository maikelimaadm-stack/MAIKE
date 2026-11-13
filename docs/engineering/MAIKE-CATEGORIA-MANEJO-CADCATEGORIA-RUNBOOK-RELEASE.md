# MAIKE — Categoria de Manejo em `CADCATEGORIA`: runbook de release CONTRACT (D-PROD-187)

> **Estado: NÃO EXECUTADO.** Nada foi aplicado nem lido em produção. Este runbook só roda
> com o GO explícito do proprietário (§2), um para o preflight e outro para a aplicação.

Decisão: [D-PROD-187](./DECISIONS.md). Relatório:
[`MAIKE-CATEGORIA-MANEJO-CADCATEGORIA-REPORT.md`](./MAIKE-CATEGORIA-MANEJO-CADCATEGORIA-REPORT.md).
Modelo: [runbook da D-PROD-183](./MAIKE-TIPO-TAREFA-DROP-COLUNAS-RUNBOOK-RELEASE.md), executado pelo
caminho B em 2026-11-13. Aqui há uma diferença: o `RENAME` da tabela **não tem janela
compatível** (§0).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261113500000_categoria_manejo_cadcategoria` (o `20261113300000` fica livre para a PR #263) |
| Natureza | **CONTRACT**, a terceira exceção fechada à D-PROD-72 item 3 e à D-PROD-107 R7, registrada na D-PROD-187. Roda numa transação: (1) guarda DO; (2) `DROP CONSTRAINT` da FK do ícone e `DROP INDEX` do índice do ícone; (3) `DROP COLUMN` das 16 colunas, nesta ordem: `raca`, `categoria_oficial`, `ganho_peso_anual_kg`, `gmd_janeiro` … `gmd_dezembro`, `catalogo_categoria_visual_id`; (4) `RENAME TO "CADCATEGORIA"` e os 4 renames de pkey, unique, índice e FK |
| O que se perde | os valores das 16 colunas, em **todos** os clientes. Desde a D-PROD-186 ninguém lê nem escreve nas 15 primeiras; o vínculo do ícone está vazio em produção (fato do plano, a reconferir no bloco B) |
| O que não muda | nenhuma tabela é criada nem apagada; o OID, as 12 colunas que ficam, as linhas, a RLS, as políticas e os grants da tabela ficam iguais; `CatalogoCategoriaVisual` só perde a FK que apontava para ela; nenhuma outra tabela é tocada |
| SHA-256 do arquivo (`MIGRATIONS_APROVADAS`) | `83ca58a07439a1cf4e12671fd5f6b89bf62be2aef7ff64112cca6f1418d37e1c` |
| Hash da guarda (`MIGRATIONS_CONTRACT_APROVADAS`) | `0efa2ef32dd4faf3d2419896521a6a62552f89c1af8d151b6cf1eb2495c3e384` |
| Classificador | `modo: CONTRACT`; 16 colunas removidas; 1 constraint e 1 índice removidos; tabela renomeada `CategoriaManejo→CADCATEGORIA`; 4 nomes renomeados; `tabelas_novas: []`; `colunas_novas_em_tabelas_antigas: []`; 0 violações |
| `_prisma_migrations` | antes **43** concluídas / 0 em aberto (última `20261113400000_cadestacoes_cadastro`, da PR #265); depois **44** |
| Tabela | antes `CategoriaManejo` com **28** colunas, 4 índices e 3 constraints; depois `CADCATEGORIA` com **12** colunas (`id`, `cliente_id`, `empresa_id`, `nome`, `sigla`, `especie`, `sexo`, `idade_minima_meses`, `idade_maxima_meses`, `ativo`, `createdAt`, `updatedAt`), 3 índices (`CADCATEGORIA_pkey`, `CADCATEGORIA_cliente_id_id_key`, `CADCATEGORIA_cliente_id_empresa_id_idx`) e 2 constraints (`CADCATEGORIA_pkey`, `CADCATEGORIA_cliente_id_fkey`) |
| Tabelas em `public` | **iguais** antes e depois (81, com `CADESTACOES` da PR #265) |

**Fatos de produção conhecidos (do plano da fatia, NÃO lidos nesta sessão; reconferir no §4):**
- projeto Supabase MAIKE, `system_identifier` `7692130048193495360`, PG 17 (`server_version_num`
  170011 no registro da D-PROD-183);
- preflight de 2026-11-13 (19:5x UTC, só leitura): **43** migrations concluídas, 0 em aberto, última `20261113400000_cadestacoes_cadastro` (aplicada às 19:48 UTC pela sessão da PR #265 antes do merge dela); 81 tabelas; `CategoriaManejo` com OID 18403, 28 colunas, 4 índices e 3 constraints esperados; RLS ligada, política `maike_backend_all`; 6 categorias, 4 com legado (impressão `6190d16c0042`); nenhuma dependência, rotina ou nome novo ocupado; sem pg_cron;
- as categorias de manejo têm o legado no formato da Fatia C: `raca` `'COMPOSTO'`,
  `categoria_oficial` preenchida, os 12 GMDs `0.0000` e ganho nulo. O plano registrou **4**
  linhas com legado; a emenda do proprietário fala em **5** categorias, nenhuma com vínculo de
  ícone. O bloco B dá o número exato;
- em 2026-11-13 as 4 categorias receberam a faixa de idade como dado: 9-12, 13-24, 25-36 e 37+.
  Essas colunas ficam e não entram na impressão;
- o catálogo global não tem nenhuma categoria visual do tipo `lote`.

**Sem janela compatível. Esta é a diferença para a D-PROD-183.**
- O código hoje em produção (`main` `dba4a8c`, Fatia C) consulta `"CategoriaManejo"`. Depois
  da migration, toda leitura e escrita de Categoria de Manejo falha com `P2021` (tabela
  inexistente): cadastro, Formulário de Lote, Nascimento, Mudança de Categoria, regras de
  exclusão e Mapa Geral.
- O código desta PR consulta `"CADCATEGORIA"` e falha com `P2021` **antes** da migration.
- A release exige **acesso bloqueado pelo proprietário** desde o momento em que um dos dois lados
  muda até o deploy novo estar `READY` e conferido (§3).

**Rollback de código:** depois da aplicação, **proibido** o *Instant Rollback* da Vercel para
qualquer deploy anterior ao merge desta PR. Previews de branches sem esta PR usam o mesmo banco e
dão 500 em tudo que lê Categoria de Manejo: não usar essas Previews.

**Por que aplicar ANTES do merge (caminho A):** o `premerge-migrate` só enxerga a migration como
"nova" enquanto ela não está na `main`. Depois do merge, `--contract D-PROD-187` vira
`CONTRACT_INESPERADO`, e o `deploy:migrate` recusa o CONTRACT pendente sem a autorização. Se o
merge vier antes (foi o que aconteceu na D-PROD-183), sobra só o caminho B.

## 1. Caminho

- **Caminho A (padrão, D-PROD-74):** runner oficial `premerge-migrate.mjs --sha <SHA_APROVADO>`,
  primeiro com `--verificar-alvo --contract D-PROD-187` e depois com
  `--aplicar --contract D-PROD-187`, numa máquina protegida do operador (§5).
- **Caminho B (conector Supabase, uma transação):** é o caminho usado na D-PROD-183 e o esperado
  aqui. Só com GO que cite o desvio da D-PROD-74. Envelope no §5.
- O `npm run deploy:migrate` à mão e o `release-migrate.yml` **recusam** esta migration
  (`DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED`) enquanto ela estiver pendente no alvo.
- **Isolamento:** a release tem esta migration e mais nenhuma (`CONTRACT_NAO_ISOLADO`). A PR
  #263 (`20261113300000_estoque_p1_03_indices`) entra antes ou depois, nunca junto.
- **Dependência da PR #265:** a migration `20261113400000_cadestacoes_cadastro` já está em produção
  e ainda não está na `main`. Esta release só roda **depois do merge da #265** e da branch
  atualizada com ela (o premerge recusa migration no banco sem arquivo na release).
- **Contagens fixas:** os números 43 (antes) e 44 (depois) deste runbook — §0, bloco A, o
  `n_ok <> 43` do envelope do caminho B, R1 e §10 — supõem a migration da PR #263 **não**
  aplicada em produção. Se o bloco A mostrar outro total, é `RELEASE_BLOCKED`: atualizar a branch,
  corrigir estes números no runbook (o `migration.sql` não muda), novo SHA e novo GO. Nunca editar
  o envelope na hora.

## 2. Pré-requisitos e GOs

**Pré-requisitos (todos antes da aplicação):**
- a PR foi revista pelo proprietário e marcada como pronta com a autorização dele;
- a branch está atualizada com a `main` e a PR está `mergeable`;
- o CI está verde no `<SHA_APROVADO>` (40 hex);
- nenhuma outra migration nova entrou na `main` depois do `<SHA_APROVADO>`. Se entrou: atualizar
  a branch, gerar SHA novo, repetir o CI e o ensaio (§4.5);
- o proprietário escolheu **como** bloquear o acesso durante a janela (por exemplo, proteção do
  deploy de produção na Vercel ou aviso aos usuários com a janela combinada) e aceita que, depois
  da aplicação, o *Instant Rollback* para antes do merge desta PR fica proibido (§0).

**GOs (nenhum está coberto hoje):**

| GO | O quê | Situação |
|---|---|---|
| GO-1 | rodar o preflight **só leitura** em produção (§4) | **não coberto**: pedir ao proprietário |
| GO-2 | bloquear o acesso, aplicar a migration CONTRACT (§5), mergear e liberar o acesso depois do §8 | **não coberto**: pedir ao proprietário com o §11 preenchido (impressão, contagens por cliente, backup, caminho A ou B, forma de bloqueio) |
| GO-3 | (só se preciso) reversão §9 | **não coberto**: pedir ao proprietário, com a operação exata |

## 3. Ordem

GO-1 → preflight §4 → contagens por cliente + **impressão** anotadas no §11 → [bloco C com
alguma linha: `RELEASE_BLOCKED` até o proprietário decidir] → backup §4.4 → ensaio local §4.5 com
o arquivo do SHA → pré-requisitos do §2 → GO-2 →

1. **bloquear o acesso** (proprietário);
2. repetir a impressão (bloco B) e o bloco D. Se a impressão mudou, parar e levar o fato ao
   proprietário;
3. aplicar a migration (§5);
4. **postcheck** §6 (só leitura);
5. merge §7;
6. esperar o deploy da `main` `READY`;
7. conferência §8;
8. **liberar o acesso** (proprietário).

- A transação dura menos de 1 s. A guarda trava `CategoriaManejo` em `ACCESS EXCLUSIVE`. Se outra
  transação segurar a tabela, a guarda desiste em 5 s (`55P03`) e não aplica nada (§5.1).
- Entre os passos 3 e 6, o código antigo dá `P2021`. É isso que o bloqueio de acesso cobre.
- **Caminho B depois do merge** (se o merge vier antes): no passo 5, o código novo entra no ar e
  dá `P2021` até a aplicação. Por isso o bloqueio vem **antes** do merge, nesse caso também.

## 4. Preflight (somente leitura; `SELECT` no conector ou papel de leitura)

### 4.1 Bloco A — identidade, histórico, colunas, índices e constraints

```sql
SELECT system_identifier FROM pg_control_system();            -- 7692130048193495360
SHOW server_version_num;                                      -- 17xxxx (a guarda foi ensaiada em PG 16 e ignora os NOT NULL do 18)
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS concluidas,
       count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)     AS falha_aberta
  FROM _prisma_migrations;                                    -- 43 | 0
SELECT migration_name, finished_at IS NOT NULL AS concluida, checksum FROM _prisma_migrations
 WHERE migration_name IN ('20261110300000_patrimonio_simplifica', '20261113200000_tipo_tarefa_drop_colunas', '20261113500000_categoria_manejo_cadcategoria')
 ORDER BY 1;                                                  -- as 2 primeiras concluídas (a D-PROD-183 com 47409bb1…); a D-PROD-187 AUSENTE
SELECT to_regclass('public."CategoriaManejo"') IS NOT NULL AS antiga, to_regclass('public."CADCATEGORIA"') IS NULL AS nova_livre;   -- true | true
SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS tipo, a.attnotnull, a.atthasdef
  FROM pg_attribute a
 WHERE a.attrelid = 'public."CategoriaManejo"'::regclass AND a.attnum > 0 AND NOT a.attisdropped
 ORDER BY a.attnum;                                           -- 28 colunas; as 16 anuláveis, sem default, com os tipos do §0
SELECT c.relname FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
 WHERE i.indrelid = 'public."CategoriaManejo"'::regclass ORDER BY 1;          -- os 4 índices de CategoriaManejo_* (§0)
SELECT conname, contype FROM pg_constraint
 WHERE conrelid = 'public."CategoriaManejo"'::regclass AND contype <> 'n' ORDER BY 1;   -- pkey, cliente_id_fkey, catalogo_categoria_visual_id_fkey
SELECT count(*) FROM pg_constraint WHERE confrelid = 'public."CategoriaManejo"'::regclass;   -- 0 (ninguém aponta para ela)
SELECT oid, relrowsecurity, relforcerowsecurity, relacl FROM pg_class WHERE oid = 'public."CategoriaManejo"'::regclass;   -- anotar o OID (R2)
SELECT count(*) AS linhas,
       md5(coalesce(string_agg(concat_ws('|', id, cliente_id, empresa_id, quote_nullable(nome), quote_nullable(sigla), quote_nullable(especie), quote_nullable(sexo),
                                         quote_nullable(idade_minima_meses), quote_nullable(idade_maxima_meses), ativo, "createdAt", "updatedAt"),
                               E'\n' ORDER BY cliente_id COLLATE "C", id COLLATE "C"), '')) AS md5_12_colunas
  FROM public."CategoriaManejo";                              -- anotar (R5): as 12 colunas que ficam, linha a linha
SELECT polname, polcmd FROM pg_policy WHERE polrelid = 'public."CategoriaManejo"'::regclass;   -- anotar (esperado: maike_backend_all, ALL)
SELECT count(*) FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
 WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p');      -- 81
```

### 4.2 Bloco B — o que se perde, por cliente, e a impressão

Contagens por cliente (só para o humano ler no GO; `SQL_CONTAGENS` do ensaio):

```sql
SELECT t.cliente_id, count(*) AS categorias,
       count(*) FILTER (WHERE num_nonnulls(t.raca, t.categoria_oficial, t.ganho_peso_anual_kg, t.gmd_janeiro, t.gmd_fevereiro, t.gmd_marco, t.gmd_abril, t.gmd_maio, t.gmd_junho, t.gmd_julho, t.gmd_agosto, t.gmd_setembro, t.gmd_outubro, t.gmd_novembro, t.gmd_dezembro, t.catalogo_categoria_visual_id) > 0) AS categorias_com_valor,
       count(t.raca) AS raca, count(t.categoria_oficial) AS categoria_oficial, count(t.ganho_peso_anual_kg) AS ganho,
       count(t.gmd_janeiro) AS gmd_janeiro, count(t.gmd_dezembro) AS gmd_dezembro,
       count(t.catalogo_categoria_visual_id) AS icone
  FROM public."CategoriaManejo" t
 GROUP BY 1 ORDER BY 1 COLLATE "C";
SELECT count(*) AS categorias_visuais_lote FROM public."CatalogoCategoriaVisual" v
  JOIN public."CatalogoTipoEntidade" t ON t.id = v.tipo_id WHERE t.codigo = 'lote';   -- 0 (fato do plano)
```

Impressão: uma instrução, com **a mesma expressão** da guarda (`SQL_IMPRESSAO` do ensaio, conferido
letra por letra pelo teste CD-01). O resultado é o valor de `maike.categoria_manejo_legado_impressao`
no §5 e o que se anota no §11:

```sql
WITH g AS (
  SELECT coalesce(array_agg(concat_ws('|', t.cliente_id, t.id, quote_nullable(t.raca), quote_nullable(t.categoria_oficial), quote_nullable(t.ganho_peso_anual_kg), quote_nullable(t.gmd_janeiro), quote_nullable(t.gmd_fevereiro), quote_nullable(t.gmd_marco), quote_nullable(t.gmd_abril), quote_nullable(t.gmd_maio), quote_nullable(t.gmd_junho), quote_nullable(t.gmd_julho), quote_nullable(t.gmd_agosto), quote_nullable(t.gmd_setembro), quote_nullable(t.gmd_outubro), quote_nullable(t.gmd_novembro), quote_nullable(t.gmd_dezembro), quote_nullable(t.catalogo_categoria_visual_id))
                            ORDER BY t.cliente_id COLLATE "C", t.id COLLATE "C"), ARRAY[]::text[]) AS linhas,
         count(*) AS total
    FROM public."CategoriaManejo" t
   WHERE num_nonnulls(t.raca, t.categoria_oficial, t.ganho_peso_anual_kg, t.gmd_janeiro, t.gmd_fevereiro, t.gmd_marco, t.gmd_abril, t.gmd_maio, t.gmd_junho, t.gmd_julho, t.gmd_agosto, t.gmd_setembro, t.gmd_outubro, t.gmd_novembro, t.gmd_dezembro, t.catalogo_categoria_visual_id) > 0
)
SELECT total::int AS linhas, left(md5(array_to_string(linhas, E'\n')), 12) AS impressao
  FROM g;
```

- `linhas = 0`: não há valor a perder. A guarda dispensa o parâmetro; se ele for informado, tem
  de ser `d41d8cd98f00`, a impressão do vazio.
- `linhas > 0` (o esperado: as categorias com o legado da Fatia C): a guarda **exige** o parâmetro
  igual a esta impressão. Ela muda se alguém criar, editar ou apagar uma categoria **com** legado
  entre o preflight e a aplicação. O código no ar não grava nas 16 colunas, mas apagar uma
  categoria antiga muda a impressão.

### 4.3 Bloco C — o que a guarda vai recusar (esperado: 0 linhas nas três primeiras)

```sql
SELECT pg_describe_object(dp.classid, dp.objid, dp.objsubid) AS dependente
  FROM pg_depend dp JOIN pg_attribute a ON a.attrelid = dp.refobjid AND a.attnum = dp.refobjsubid
 WHERE dp.refclassid = 'pg_class'::regclass AND dp.refobjid = 'public."CategoriaManejo"'::regclass
   AND a.attname IN ('raca', 'categoria_oficial', 'ganho_peso_anual_kg', 'gmd_janeiro', 'gmd_fevereiro', 'gmd_marco', 'gmd_abril', 'gmd_maio',
                     'gmd_junho', 'gmd_julho', 'gmd_agosto', 'gmd_setembro', 'gmd_outubro', 'gmd_novembro', 'gmd_dezembro', 'catalogo_categoria_visual_id')
   AND NOT (a.attname = 'catalogo_categoria_visual_id' AND dp.classid = 'pg_class'::regclass
            AND dp.objid = 'public."CategoriaManejo_cliente_id_catalogo_categoria_visual_id_idx"'::regclass)
   AND NOT (a.attname = 'catalogo_categoria_visual_id' AND dp.classid = 'pg_constraint'::regclass
            AND dp.objid IN (SELECT k.oid FROM pg_constraint k WHERE k.conrelid = dp.refobjid
                               AND k.conname = 'CategoriaManejo_catalogo_categoria_visual_id_fkey'));
SELECT p.oid::regprocedure AS rotina
  FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
 WHERE ns.nspname NOT IN ('pg_catalog', 'information_schema') AND ns.nspname NOT LIKE 'pg\_%'
   AND (p.prosrc || ' ' || coalesce(array_to_string(p.proargnames, ' '), '')) ~* '\m(categoriamanejo|raca|categoria_oficial|ganho_peso_anual_kg|gmd_(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)|catalogo_categoria_visual_id)\M';
SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
 WHERE ns.nspname = 'public' AND c.relname IN ('CADCATEGORIA', 'CADCATEGORIA_pkey', 'CADCATEGORIA_cliente_id_id_key', 'CADCATEGORIA_cliente_id_empresa_id_idx');
SELECT to_regclass('cron.job') IS NOT NULL AS tem_pg_cron;
-- só se tem_pg_cron = true (a guarda não lê cron.job; esta conferência é do operador):
SELECT jobid, jobname FROM cron.job
 WHERE command ~* '\m(categoriamanejo|raca|categoria_oficial|ganho_peso_anual_kg|gmd_[a-z]+|catalogo_categoria_visual_id)\M';
```

- A 1ª lista o que depende das 16 colunas, fora o índice e a FK do ícone (que a migration remove
  antes): índice, constraint, visão/regra, política, gatilho com `UPDATE OF`, estatística,
  publicação com lista de colunas, coluna gerada ou função SQL `BEGIN ATOMIC`.
- A 2ª lista funções e procedures fora dos schemas do sistema que citem o nome físico antigo ou
  uma das colunas, no corpo ou nos parâmetros de saída. A busca ignora maiúsculas e exige
  fronteira de palavra (`raca` é um token curto). Uma rotina listada aqui quebraria depois do
  `RENAME` ou do `DROP`.
- A 3ª confere que os nomes novos estão livres.
- A última lista job do pg_cron que cite a tabela ou as colunas.

Qualquer linha: `RELEASE_BLOCKED` até o proprietário decidir. O repositório não cria nenhum
desses objetos.

### 4.4 Bloco D — transações longas, e backup

```sql
SELECT pid, state, now() - xact_start AS idade, left(query, 80) AS consulta FROM pg_stat_activity
 WHERE datname = current_database() AND xact_start IS NOT NULL AND now() - xact_start > interval '30 seconds';   -- nenhuma
```

- Último backup físico `COMPLETED` anterior à janela, pelo painel do Supabase ou pela API de gestão
  com o token do proprietário. Sem prova de backup → `RELEASE_BLOCKED`. Ele restaura o banco
  **inteiro**.
- Se o bloco B tiver linhas, o proprietário escolhe e anota no §11:
  - (a) guardar ele mesmo, na máquina dele, a lista com `id` e as 16 colunas, pela consulta abaixo;
  - (b) "não há volta parcial; aceito".

  O agente não recebe o arquivo.

```sql
SELECT id, cliente_id, nome, raca, categoria_oficial, ganho_peso_anual_kg,
       gmd_janeiro, gmd_fevereiro, gmd_marco, gmd_abril, gmd_maio, gmd_junho,
       gmd_julho, gmd_agosto, gmd_setembro, gmd_outubro, gmd_novembro, gmd_dezembro, catalogo_categoria_visual_id
  FROM public."CategoriaManejo"
 ORDER BY cliente_id, id;
```

### 4.5 Ensaio local (com o arquivo exato do `<SHA_APROVADO>`)

Automatizado por `scripts/dev/ensaio-categoria-manejo-cadcategoria.mjs`. A mesma prova roda no CI
em `backend/tests/categoriaManejoCadcategoriaMigration.test.mjs`, só contra banco local:

```bash
node scripts/dev/ensaio-categoria-manejo-cadcategoria.mjs --url postgresql://<usuario>@localhost:5432/postgres
```

**RED (todos recusam e nada muda):**
- sem impressão; impressão errada;
- índice numa coluna apagada; índice a mais numa coluna que fica;
- visão numa coluna apagada e na coluna do ícone; política;
- função citando coluna; função com o nome físico `"CategoriaManejo"`; gatilho com
  `NEW.Ganho_Peso_Anual_Kg` (caixa mista); função com a coluna só no `RETURNS TABLE`;
- `CADCATEGORIA` já existente; nome novo de índice ocupado;
- trava concorrente: `55P03` em ~5 s, pelo `lock_timeout` da própria guarda;
- `deploy:migrate` com a conferência de alvo exigida e sem
  `MIGRATION_CONTRACT_AUTORIZADO=D-PROD-187`: `DEPLOY-MIGRATION-CONTRACT-UNAUTHORIZED` antes de
  qualquer DDL.

**GREEN:** runner oficial com a conferência exigida, `MIGRATION_CONTRACT_AUTORIZADO=D-PROD-187` e
a impressão na URL. Resultado esperado:
- 43/0;
- `CADCATEGORIA` com o mesmo OID, ACL, RLS e políticas, as 12 colunas, linhas idênticas nelas, os 3
  índices e as 2 constraints novos, FK validada;
- mesmas tabelas; `migrate diff --exit-code` 0;
- `prisma.categoriaManejo.findMany()` lendo;
- 2ª execução "No pending".

**Envelope do caminho B:** antes do GO-2, rodar o envelope do §5 contra um banco local no estado de
produção:
- sem o parâmetro de ensaio, ele tem de recusar com `RELEASE_BLOCKED: alvo divergente`;
- com `PGOPTIONS='-c maike.categoria_manejo_ensaio_alvo=<sid local>'` e a impressão local, aplica.

Registrar o resultado no §11.

## 5. Aplicação — só com o GO-2, o §2 cumprido e o acesso bloqueado

### Caminho A (padrão)

- Máquina protegida.
- `MIGRATION_DATABASE_URL` direta ou de sessão na 5432 (nunca 6543), com
  `&options=-c%20lock_timeout%3D5s%20-c%20maike.categoria_manejo_legado_impressao%3D<IMPRESSAO_DO_PREFLIGHT>`.
  Sem linhas no bloco B, o parâmetro pode ficar de fora.
- `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360`.
- A conexão do **runtime** também, apontando para o **mesmo** banco de produção: `DATABASE_URL`
  (ou `POSTGRES_PRISMA_URL`, que tem prioridade). Nenhum `.env` na raiz da checkout pode apontar
  para outro banco.

```bash
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>                                  # ANÁLISE LOCAL OK (CONTRACT D-PROD-187: 1 constraints removidas (…), 1 índices removidos (…), 16 colunas removidas (…), tabela renomeada (CategoriaManejo→CADCATEGORIA), 4 nomes renomeados (…))
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo --contract D-PROD-187
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar --contract D-PROD-187   # repassa MIGRATION_CONTRACT_AUTORIZADO=D-PROD-187 ao deploy:migrate
```

Se o pooler de sessão descartar o `options`, a guarda recusa com `= ausente` (falha fechada,
nada aplicado). Nesse caso, usar a conexão direta ou o caminho B.

### Caminho B (conector, uma `execute_sql`, só com GO que cite o desvio da D-PROD-74)

```sql
BEGIN;
SET LOCAL maike.categoria_manejo_legado_impressao = '<IMPRESSAO_DO_PREFLIGHT>';
DO $alvo$
DECLARE
  sid text := (SELECT system_identifier::text FROM pg_control_system());
  ensaio text := nullif(current_setting('maike.categoria_manejo_ensaio_alvo', true), '');
  n_ok bigint;
  n_ruim bigint;
BEGIN
  IF sid <> '7692130048193495360' AND (ensaio IS NULL OR ensaio <> sid) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: alvo divergente';
  END IF;
  IF EXISTS (SELECT 1 FROM _prisma_migrations
              WHERE migration_name = '20261113500000_categoria_manejo_cadcategoria' AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 43 OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % em aberto', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261113200000_tipo_tarefa_drop_colunas'
                    AND checksum = '47409bb1a7d371efe89fffba753ae292aec6f95e1ba7845d35dff74371136c17'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: D-PROD-183 ausente ou com checksum divergente';
  END IF;
END $alvo$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '83ca58a07439a1cf4e12671fd5f6b89bf62be2aef7ff64112cca6f1418d37e1c', now(),
        '20261113500000_categoria_manejo_cadcategoria', NULL, NULL, now(), 1);
COMMIT;
```

- O modo de ensaio do alvo só existe por `PGOPTIONS='-c maike.categoria_manejo_ensaio_alvo=<sid local>'`,
  nunca editando o texto. Em produção o parâmetro não existe.
- Qualquer falha desfaz tudo, inclusive o `INSERT` em `_prisma_migrations`. Conferir pelo bloco
  A que `CategoriaManejo` continua com as 28 colunas e pedir novo GO.
- Uma tentativa anterior do caminho A que falhou e foi resolvida (§5.1, `rolled_back_at`
  preenchido) não bloqueia o B. Uma linha ainda aberta (`finished_at` e `rolled_back_at` NULL)
  bloqueia: resolver primeiro.

### 5.1 Falha no caminho A (guarda, `55P03` ou *deadlock*)

1. Nada do DDL fica; a linha fica com `finished_at` NULL.
2. Conferir pelo bloco A que `CategoriaManejo` continua com 28 colunas e que `CADCATEGORIA` não
   existe.
3. Resolver com a conexão de **produção** explícita:
   `DATABASE_URL="$MIGRATION_DATABASE_URL" npx prisma migrate resolve --rolled-back 20261113500000_categoria_manejo_cadcategoria --schema backend/prisma/schema.prisma`.
4. Eliminar a causa. A mensagem da guarda (`categoria_manejo_cadcategoria: …`) diz qual: impressão,
   dependente, rotina, colunas, índices, constraints ou nome ocupado.
5. Refazer o bloco B. Se a impressão mudou, parar e levar o fato ao proprietário.
6. Repetir pelo A ou pelo B. No postcheck, aceitar exatamente essas linhas revertidas.
7. Enquanto isso, o acesso continua bloqueado. Se a release for abortada, **não mergear**: o
   código antigo continua funcionando com o schema antigo, e o acesso pode ser liberado.

## 6. Postcheck (antes do merge; só leitura)

Qualquer divergência: **não mergear**, manter o acesso bloqueado e chamar o proprietário.

| # | Conferência | Esperado |
|---|---|---|
| R1 | `_prisma_migrations` | 44 concluídas, 0 em aberto (mais as revertidas do §5.1, se houve); a nova com checksum `83ca58a0…7e1c` e `applied_steps_count = 1` |
| R2 | `to_regclass('public."CategoriaManejo"')` / `to_regclass('public."CADCATEGORIA"')` | NULL / não NULL, com o **mesmo OID** anotado no bloco A |
| R3 | colunas de `CADCATEGORIA` | as 12, nesta ordem: `id`, `cliente_id`, `empresa_id`, `nome`, `sigla`, `especie`, `sexo`, `idade_minima_meses`, `idade_maxima_meses`, `ativo`, `createdAt`, `updatedAt` |
| R4 | índices e constraints | `CADCATEGORIA_cliente_id_empresa_id_idx`, `CADCATEGORIA_cliente_id_id_key`, `CADCATEGORIA_pkey`; `CADCATEGORIA_cliente_id_fkey` (validada) e `CADCATEGORIA_pkey`; nenhuma FK para `CatalogoCategoriaVisual` |
| R5 | linhas | a mesma consulta `md5_12_colunas` do bloco A, agora em `public."CADCATEGORIA"`: `linhas` e `md5_12_colunas` **iguais** aos anotados (as 12 colunas que ficam, linha a linha) |
| R6 | tabelas em `public` | 81, as mesmas de antes |
| R7 | RLS e grants | `relrowsecurity` true, sem FORCE, as mesmas políticas e o mesmo `relacl` do bloco A |
| R8 | `node scripts/deploy/preflight-schema.mjs`, com a conexão de produção do §5 | exit 0: nenhuma migration pendente e `CADCATEGORIA.idade_minima_meses` presente |

## 7. Merge

Com o §6 todo verde: atualizar a branch se a `main` andou (sem migration nova) e mergear. A Vercel
publica a `main`; o build não roda migration. Esperar o deploy `READY`.

## 8. Depois do deploy (só leitura), ainda com o acesso bloqueado

- Abrir **Categorias de Manejo**: a lista carrega, um registro abre no formulário com Nome, Sigla,
  Espécie, Sexo e Faixa de idade, sem "Ícone oficial". Não salvar nada.
- Abrir o **Formulário de Lote** de um lote existente: a Categoria de Manejo aparece, sem a prévia
  do ícone. Não salvar nada.
- Abrir o **Mapa Geral**: os lotes aparecem.
- Nenhum erro novo nos logs do Postgres (`relation "CategoriaManejo" does not exist`) nem no runtime
  da Vercel no intervalo.
- O proprietário libera o acesso. A primeira escrita em produção depois da release é dele.

## 9. Reversão

Não há reversão automática. As colunas voltariam **vazias**, e o nome antigo só com uma migration
nova, com decisão própria — nunca editando a D-PROD-187. Os valores apagados só voltam do que o
proprietário guardou no §4.4 ou do backup físico, que restaura o banco inteiro.

Rollback de código, **não**: nenhum deploy anterior ao merge desta PR funciona com `CADCATEGORIA`
(§0). Um defeito no código novo se corrige com deploy novo (*roll forward*).

## 10. `RELEASE_BLOCKED`

- sem GO-1 ou GO-2;
- sem forma de bloqueio de acesso combinada, ou acesso liberado antes do §8;
- `server_version_num` fora de 17xxxx sem nova revisão da guarda;
- conexão do runtime ausente ou apontando para outro banco no caminho A;
- job do pg_cron que cite a tabela ou as colunas;
- alvo com `system_identifier` diferente;
- histórico diferente de 43/0 antes, D-PROD-183 ausente, ou a D-PROD-187 já registrada;
- `CategoriaManejo` ausente; `CADCATEGORIA` ou um nome novo ocupado; alguma das 16 colunas
  ausente ou com tipo, nulidade ou default diferente; índices ou constraints diferentes do §0; linha
  no bloco C;
- impressão diferente entre o preflight e a aplicação;
- sem prova de backup;
- classificador local fora do esperado (não `CONTRACT`, ≠ 16 colunas removidas, alguma violação);
- outra migration nova na mesma release (por exemplo, a da PR #263).

## 11. Registro da execução

**NÃO EXECUTADO.** Preencher na execução, como no §11 da D-PROD-183.

| Campo | Valor |
|---|---|
| Merge | — |
| GO-1 e GO-2 | — |
| Forma de bloqueio de acesso | — |
| Escolha do §4.4 | — |
| Alvo | — |
| Bloco A | — |
| Bloco B | — |
| Bloco C | — |
| Bloco D e backup | — |
| Ensaio local (§4.5) | Feito na fatia, contra PG 16 local: ensaio automatizado **OK** (14 RED recusados sem mudar nada, runner sem autorização recusado, GREEN 43/0, 12 colunas, mesmo OID, `migrate diff` 0, Prisma Client lendo, 2ª execução sem pendência); teste da migration 20/20. Envelope do caminho B: ver o relatório. **Repetir com o arquivo do `<SHA_APROVADO>`** |
| Caminho | — |
| Aplicação | — |
| Postcheck R1–R8 | — |
| Deploy e §8 | — |
| Acesso liberado | — |
