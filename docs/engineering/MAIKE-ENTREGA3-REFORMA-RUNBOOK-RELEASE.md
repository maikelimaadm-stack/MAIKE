# MAIKE — Reforma de pastagem (Entrega 3): runbook de release expand-only (D-PROD-276)

> **Estado: PLANO. `SCHEMA_APPLIED_PROD: NÃO`.** A migration foi testada só no PostgreSQL local. Nada foi aplicado
> em produção.
>
> Cada passo exige o GO do proprietário ("aplica") e para no primeiro desvio com **`RELEASE_BLOCKED`**. Valores
> entre `<…>` são preenchidos na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-276](./DECISIONS.md) · Relatório: [`MAIKE-ENTREGA3-REFORMA-REPORT.md`](./MAIKE-ENTREGA3-REFORMA-REPORT.md).
Molde: [`MAIKE-ENTREGA2-CAMPOS-POR-TIPO-RUNBOOK-RELEASE.md`](./MAIKE-ENTREGA2-CAMPOS-POR-TIPO-RUNBOOK-RELEASE.md)
(D-PROD-274, PR #354, mergeada em `6cb0b176`). **Esta release vem DEPOIS da Entrega 2:** a guarda do §3 exige a
`20261121100000_atividade_campos_por_tipo` concluída em produção com o checksum do repositório — ela foi aplicada em
produção em 2026-11-23 (pós-checagem 74/0, 109 tabelas). Se o histórico não conferir, o preflight do §2 dá
`anterior_ok = 0` ou outra contagem e o caminho B recusa.

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261122100000_reforma_planejamento` |
| Natureza | **expand-only** (sem `--contract`): 2 tabelas NOVAS — **`Planejamento`** (a reforma: `numero`, `nome`, `tipo` REFORMA/FORMACAO/OUTRO, `safra_ciclo`, `cultura_alvo_id` = o capim que vai ficar, `data_inicio`, `status` ABERTO/CONCLUIDO/CANCELADO, `data_conclusao`, `criado_por_usuario_id`, `versao`) e **`PlanejamentoArea`** (as áreas da reforma e os `hectares` de cada uma, o divisor do R$/ha) — com índices e uniques começando por `cliente_id`, FKs RESTRICT compostas pelo tenant (Cliente; Empresa; CADCULTURAS por (`cliente_id`, `empresa_id`, id); Usuario; Planejamento por (`cliente_id`, `empresa_id`, id); AreaPastagem), 4 CHECKs só nelas (`Planejamento_tipo_check`, `Planejamento_status_check`, `Planejamento_datas_check`, `PlanejamentoArea_hectares_check`) e o bloco RLS/REVOKE delas; em tabela antiga, **1 coluna anulável sem DEFAULT** `Atividade.planejamento_id` VARCHAR(64), o índice não-único `Atividade_cliente_id_planejamento_id_idx` (`cliente_id`, `planejamento_id`) e a FK `Atividade_cliente_id_planejamento_id_fkey` (`cliente_id`, `planejamento_id`) → `Planejamento`(`cliente_id`, `id`) RESTRICT. Nenhuma linha muda de valor; nenhum DROP, RENAME, ALTER COLUMN ou DML; nada é semeado; nenhum custo é gravado (o R$/ha é calculado na leitura) |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) = checksum do Prisma | `27f16e1d44df673e97a62ef2122199c94d8d6adcdd07d006180ef0f90b873a10` |
| Bloco RLS (`DO_RLS_APROVADOS`) | `3dd03bb8d852888ae7f058ec6eb8c6304f93d3dcdb3f4e946d03413a5565c654` (o corpo de sempre, lista `['Planejamento', 'PlanejamentoArea']`) |
| Classificador | `modo: EXPAND`, `violacoes: []`, `tabelas_novas ["Planejamento", "PlanejamentoArea"]`, `colunas_novas_em_tabelas_antigas` só `Atividade.planejamento_id`, `contract: []` (teste B42a) |
| `_prisma_migrations` | esperado **74** concluídas, 0 abertas (a última `20261121100000_atividade_campos_por_tipo`, D-PROD-274, checksum `9e6487ffddb92a35945c675c1924f363c3396e97dac52e56e8d3c94c20a32a58`, aplicada em 2026-11-23); depois **75**. Recontar no §2 |
| Tabelas em `public` | **109** antes, **111** depois |

**Por que antes do merge (D-PROD-72 item 1):** a Vercel publica a `main` sozinha. O runtime novo lê
`Atividade.planejamento_id` (e o resumo da reforma pela relação) em toda leitura da atividade, e as rotas
`/planejamentos` leem as tabelas novas: sem a migration, `/atividades` e o resumo da área do mapa respondem 500. O
preflight de schema do deploy (`node scripts/deploy/preflight-schema.mjs`) passou a exigir `Planejamento.status`,
`PlanejamentoArea.hectares` e `Atividade.planejamento_id` (`COLUNAS_EXIGIDAS`). O runtime de hoje não conhece as
tabelas nem a coluna e segue igual com o banco migrado (coluna anulável; tabelas nascem vazias) — **não há janela**.
O Instant Rollback da Vercel continua possível depois (o código anterior não depende de nada novo).

**Efeito durante a transação:** o `ADD COLUMN` anulável sem DEFAULT é só catálogo, mas pede `ACCESS EXCLUSIVE` em
`Atividade` por um instante; o `CREATE INDEX` (não concorrente) em `Atividade` pede `SHARE` (escritas em `Atividade`
esperam enquanto o índice é montado); a FK nova em `Atividade` pede `SHARE ROW EXCLUSIVE` e confere as linhas (todas
nulas). As outras FKs pedem `SHARE ROW EXCLUSIVE` em `Cliente`, `Empresa`, `CADCULTURAS`, `Usuario` e
`AreaPastagem` (leituras seguem). Até o `COMMIT` as telas de Atividades esperam. Milissegundos no volume atual. Uma
espera além do `lock_timeout` de 5 s aborta tudo sem aplicar nada. Fora de pico.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** numa máquina protegida, com `MIGRATION_DATABASE_URL` (direta ou
  sessão na 5432, nunca o pooler 6543), `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360` e `DATABASE_URL`
  do mesmo banco (EXPAND: **sem `--contract`**):
  ```bash
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>                   # ANÁLISE LOCAL OK (EXPAND)
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo  # ALVO VERIFICADO — 1 pendente(s) do manifesto
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar
  ```
- **B — conector Supabase, uma única `execute_sql` (§3):** só com autorização **escrita e específica do
  proprietário para esta migration**, registrada como desvio da D-PROD-74, como nas anteriores.

## 2. Preflight — somente leitura (projeto `uuemcasqcdjucflulkne`)

```sql
SELECT
  (SELECT system_identifier FROM pg_control_system())                                                 AS sid,         -- 7692130048193495360
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)  AS concluidas,  -- 74
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)   AS ruins,       -- 0
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261121100000_atividade_campos_por_tipo'
     AND checksum = '9e6487ffddb92a35945c675c1924f363c3396e97dac52e56e8d3c94c20a32a58' AND finished_at IS NOT NULL
     AND rolled_back_at IS NULL)                                                                      AS anterior_ok, -- 1
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261122100000_reforma_planejamento') AS registrada, -- 0
  to_regclass('public."Planejamento"') IS NULL                                                        AS planejamento_ausente,      -- true
  to_regclass('public."PlanejamentoArea"') IS NULL                                                    AS planejamento_area_ausente, -- true
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
     AND table_name = 'Atividade' AND column_name = 'planejamento_id')                                AS coluna_ja_existe, -- 0
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public')                                        AS tabelas;     -- 109
```

E, localmente, no `<SHA_APROVADO>`: `sha256sum` do `migration.sql` igual ao pinado e `classificarMigrations` com
`modo: EXPAND` e `violacoes: []` (teste B42a).

### 2.1 Fato para o relatório (somente leitura; não bloqueia)

Nenhum dado antigo é ligado a reforma nenhuma: a coluna nasce nula em todas as atividades. Para o proprietário saber
quanto já existe de reforma "solta" (serviços de reforma lançados antes, que ele pode querer agrupar à mão depois):

```sql
SELECT t.categoria, count(*) AS atividades
  FROM "Atividade" a JOIN "TipoAtividade" t ON t.cliente_id = a.cliente_id AND t.id = a.tipo_atividade_id
 WHERE t.categoria IN ('PREPARO_SOLO', 'PLANTIO', 'TRATO_CULTURAL', 'APLICACAO')  -- TRATO_CULTURAL = Fertilização
 GROUP BY t.categoria ORDER BY t.categoria;
```

Anotar os números no §8. Esta entrega não liga atividades antigas a uma reforma (ver o relatório, pontos em aberto).

## 3. Caminho B — uma transação

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(72707370);
DO $guarda$
DECLARE n_ok int; n_ruim int;
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7692130048193495360 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: alvo divergente';
  END IF;
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261122100000_reforma_planejamento') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 74 OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261121100000_atividade_campos_por_tipo'
                    AND checksum = '9e6487ffddb92a35945c675c1924f363c3396e97dac52e56e8d3c94c20a32a58'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (20261121100000_atividade_campos_por_tipo) não está concluída com o checksum do repositório';
  END IF;
  IF to_regclass('public."Planejamento"') IS NOT NULL OR to_regclass('public."PlanejamentoArea"') IS NOT NULL THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: uma das tabelas novas (Planejamento, PlanejamentoArea) já existe';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'Atividade' AND column_name = 'planejamento_id') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a coluna Atividade.planejamento_id já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '27f16e1d44df673e97a62ef2122199c94d8d6adcdd07d006180ef0f90b873a10', now(),
        '20261122100000_reforma_planejamento', NULL, NULL, now(), 1);
COMMIT;
```

Confira o SHA-256 do trecho da migration antes de usar. Qualquer falha desfaz tudo.

**Ensaio local (2026-11-23, PostgreSQL local, nunca produção; refeito sobre a `main` `6cb0b176`):** banco novo
(`maike_e3_rb`) com as 74 migrations da `main` (`prisma migrate deploy` numa cópia da pasta sem a migration nova); o
preflight do §2 deu 74 concluídas, 0 com falha, `anterior_ok = 1`, `registrada = 0`, as tabelas e a coluna ausentes e
109 tabelas. O envelope acima, montado com o conteúdo integral do `migration.sql` (sha256 `27f16e1d…3a10`) e com o
`system_identifier` do banco local no lugar do de produção (o resto byte a byte igual ao envelope de produção), aplicou
numa transação: 75 / 0, a nova com o checksum `27f16e1d…3a10` e 1 passo, 111 tabelas, RLS ligado sem FORCE nas duas
novas com a política `maike_backend_all` para `maike_vercel`. O envelope com o identificador de produção, no banco
local, recusou antes (`RELEASE_BLOCKED: alvo divergente`); a 2ª execução recusou (`RELEASE_BLOCKED: migration já
registrada`). Depois, com a pasta completa do repositório: `prisma migrate status` "75 migrations found … Database
schema is up to date!" e `prisma migrate diff --from-url <banco> --to-schema-datamodel backend/prisma/schema.prisma`
"No difference detected.". O banco do ensaio foi apagado.

## 4. Conferência — somente leitura

```sql
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
  FROM _prisma_migrations;                                                                  -- 75, 0
SELECT checksum, applied_steps_count FROM _prisma_migrations
 WHERE migration_name = '20261122100000_reforma_planejamento';                               -- 27f16e1d…3a10, 1
SELECT data_type, character_maximum_length, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'Atividade' AND column_name = 'planejamento_id';
SELECT conname FROM pg_constraint
 WHERE conrelid = 'public."Atividade"'::regclass AND conname = 'Atividade_cliente_id_planejamento_id_fkey';
SELECT indexname FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'Atividade' AND indexname = 'Atividade_cliente_id_planejamento_id_idx';
SELECT conrelid::regclass AS tabela, contype, count(*) FROM pg_constraint
 WHERE conrelid IN ('public."Planejamento"'::regclass, 'public."PlanejamentoArea"'::regclass)
 GROUP BY 1, 2 ORDER BY 1, 2;
SELECT tablename, count(*) FROM pg_indexes
 WHERE schemaname = 'public' AND tablename IN ('Planejamento', 'PlanejamentoArea') GROUP BY tablename;
SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
 WHERE oid IN ('public."Planejamento"'::regclass, 'public."PlanejamentoArea"'::regclass);
SELECT tablename, policyname, roles FROM pg_policies
 WHERE schemaname = 'public' AND tablename IN ('Planejamento', 'PlanejamentoArea');
SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name IN ('Planejamento', 'PlanejamentoArea')
   AND grantee IN ('anon', 'authenticated');
SELECT (SELECT count(*) FROM "Planejamento") AS planejamentos, (SELECT count(*) FROM "PlanejamentoArea") AS areas,
       (SELECT count(*) FROM "Atividade" WHERE planejamento_id IS NOT NULL) AS atividades_ligadas;
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';
```

| Conferência | Esperado (igual ao ensaio local) |
|---|---|
| `_prisma_migrations` | 75 / 0; a `20261122100000_reforma_planejamento` com o checksum do §0 e 1 passo |
| `Atividade.planejamento_id` | `character varying` 64, `YES` (anulável), sem DEFAULT; a FK `Atividade_cliente_id_planejamento_id_fkey` e o índice `Atividade_cliente_id_planejamento_id_idx` presentes |
| `Planejamento` | constraints: 1 `p`, 4 `f`, 3 `c` (`Planejamento_tipo_check`, `Planejamento_status_check`, `Planejamento_datas_check`); 7 índices (pkey, 3 unique, 3 btree) |
| `PlanejamentoArea` | constraints: 1 `p`, 4 `f`, 1 `c` (`PlanejamentoArea_hectares_check`); 4 índices (pkey, 2 unique, 1 btree) |
| as duas tabelas novas | RLS ligado sem FORCE; política `maike_backend_all` só para `maike_vercel`; nenhum GRANT para `anon`/`authenticated`; 0 linhas; 0 atividades ligadas |
| tabelas em `public` | 111 |
| `get_advisors` (security e performance) | nenhum alerta novo |
| `node scripts/deploy/preflight-schema.mjs` | ok (as 3 colunas exigidas presentes) |

## 5. Merge, deploy e smoke

1. Merge **logo depois** do §4 (nunca antes). 2. Deploy READY na Vercel: `/api/native/health` com o `release` da
`main` nova. 3. Smoke numa fazenda de teste:
- Atividades → **Planejar** → a escolha "Reforma de pastagem" / "Um serviço" → **Reforma de pastagem**: uma área com
  os hectares, Tipo Reforma, Capim que vai ficar, Início previsto; o nome sugerido "Reforma · <ÁREA> · 2026/27";
  salvar. A lista abre filtrada pela reforma nova, com a barra (custo total R$ 0,00, sem serviços).
- **+ Nova realização** de uma Fertilização nessa área: "Faz parte de: Reforma · <ÁREA> · 2026/27" já marcado; salvar.
  Na barra: custo total, R$/ha = total ÷ hectares da reforma, o custo por tipo e o serviço com a situação.
- **Mapa** → a área → Detalhes: "Em reforma desde DD/MM".
- **Concluir reforma** com o capim diferente do da área: a pergunta "Trocar o capim da área para <CAPIM>?"; "Sim,
  trocar e concluir" troca o capim da área (conferir no Cadastro do Mapa) e a reforma fica Concluída.
- Uma segunda reforma de teste: **Cancelar**; a reforma fica Cancelada e os serviços continuam na lista.
- Celular (390 px): a data do "Concluir a reforma" não fica coberta pelo rótulo.

## 6. Rollback

As tabelas são novas; a coluna em `Atividade` é anulável. Reverter seria uma migration nova (DROP da FK e do índice
em `Atividade`, `DROP COLUMN "planejamento_id"` e `DROP TABLE` de `PlanejamentoArea` e depois de `Planejamento`:
CONTRACT, com GO próprio), nunca editando esta. Com o código novo no ar, reverter o código primeiro (o código anterior
não depende de nada novo). O que o código novo gravou (as reformas, as áreas de cada uma e a ligação das realizações)
se perde no DROP; os serviços, os custos e o capim trocado das áreas ficam.

## 7. Ordem com outras releases

Em 2026-11-23 esta é a 75ª pasta. A 74ª (`20261121100000_atividade_campos_por_tipo`, Entrega 2, D-PROD-274, PR #354)
foi aplicada em produção em 2026-11-23 e mergeada (`6cb0b176`); a 73ª é a `20261120300000_estoque_ajustes`
(D-PROD-272, PR #350). Se outra migration entrar na `main` antes desta, recontar o §2 (o número
de concluídas e a "anterior" mudam) e ajustar a guarda do §3.

## 8. Registro

| Data | Quem | O quê |
|---|---|---|
| 2026-11-21 | Claude (sessão D-PROD-276) | plano preparado; migration aplicada e testada só no PostgreSQL local (banco de teste e banco do ensaio do §3); **nada aplicado em produção** |
| 2026-11-23 | Claude (sessão D-PROD-276) | branch refeita sobre a `main` `6cb0b176` (Entrega 2 aplicada e mergeada): preflight 74/0 e 109 tabelas, guarda `n_ok <> 74` com a anterior `20261121100000_atividade_campos_por_tipo` (`9e6487ff…2a58`), pós-checagem 75/0 e 111 tabelas; ensaio do §3 refeito no PostgreSQL local; **nada aplicado em produção** |
