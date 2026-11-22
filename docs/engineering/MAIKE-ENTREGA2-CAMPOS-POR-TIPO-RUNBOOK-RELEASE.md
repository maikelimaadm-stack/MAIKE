# MAIKE — Campos por tipo (Entrega 2): runbook de release expand-only (D-PROD-273)

> **Estado: PLANO. `SCHEMA_APPLIED_PROD: NÃO`.** A migration foi testada só no PostgreSQL local. Nada foi aplicado
> em produção.
>
> Cada passo exige o GO do proprietário ("aplica") e para no primeiro desvio com **`RELEASE_BLOCKED`**. Valores
> entre `<…>` são preenchidos na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-273](./DECISIONS.md) · Relatório: [`MAIKE-ENTREGA2-CAMPOS-POR-TIPO-REPORT.md`](./MAIKE-ENTREGA2-CAMPOS-POR-TIPO-REPORT.md).
Molde e precedente executado de EXPAND: [`MAIKE-ESTOQUE-SAIDA-MANUAL-RUNBOOK-RELEASE.md`](./MAIKE-ESTOQUE-SAIDA-MANUAL-RUNBOOK-RELEASE.md)
(D-PROD-264, caminho B). A anterior em produção: [`MAIKE-NOVA-REALIZACAO-RUNBOOK-RELEASE.md`](./MAIKE-NOVA-REALIZACAO-RUNBOOK-RELEASE.md)
(D-PROD-265, aplicada em 2026-11-20 18:58:29 UTC).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261121100000_atividade_campos_por_tipo` |
| Natureza | **expand-only** (sem `--contract`): 1 tabela NOVA, **`AtividadePlantio`** (o capim plantado `cultura_id` NOT NULL, o consórcio `consorcio_cultura_id`, `forma_plantio`, `semente_incrustada`, `cobertura`), com 2 UNIQUE e 2 índices começando por `cliente_id`, 5 FKs RESTRICT (Cliente; Empresa; Atividade por (`cliente_id`, `empresa_id`, `atividade_id`); CADCULTURAS duas vezes, por (`cliente_id`, `empresa_id`, id)), 2 CHECKs (`AtividadePlantio_forma_plantio_check`, `AtividadePlantio_consorcio_check`) e o bloco RLS/REVOKE dela; e 5 colunas **anuláveis, sem DEFAULT** em tabelas antigas: `Atividade.local` VARCHAR(120), `AtividadeApontamento.numero_receituario` VARCHAR(40), `AtividadeApontamentoProduto.vc_percentual` DECIMAL(5,2), `Produto.carencia_dias` INTEGER e `TipoAtividade.alvo` VARCHAR(60). Nenhuma linha muda de valor; nenhum DROP, RENAME, ALTER COLUMN ou DML; nada é semeado |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) = checksum do Prisma | `9e6487ffddb92a35945c675c1924f363c3396e97dac52e56e8d3c94c20a32a58` |
| Bloco RLS (`DO_RLS_APROVADOS`) | `e47bfde02699052ca52f4c6c750e9f28aec247d1fcaf5c2c308a05e006799765` (o corpo de sempre, lista `['AtividadePlantio']`) |
| Classificador | `modo: EXPAND`, `violacoes: []`, `tabelas_novas ["AtividadePlantio"]`, `colunas_novas_em_tabelas_antigas` as 5 acima, `contract: []` (teste B40a) |
| `_prisma_migrations` | esperado **72** concluídas, 0 abertas (a última `20261120200000_apontamento_data_termino`, D-PROD-265, checksum `a1f8a13c782cfc4fe3d3050749ebb0663eb943d039231db0490ce89fea90c84b`); depois **73**. Recontar no §2 |
| Tabelas em `public` | **105** antes, **106** depois |

**Por que antes do merge (D-PROD-72 item 1):** a Vercel publica a `main` sozinha. O runtime novo lê as colunas novas
em toda leitura da atividade, do apontamento, da linha de produto, do produto e da operação, e a tabela
`AtividadePlantio` no detalhe da atividade: sem a migration, `/atividades`, `/produtos` e `/tipos-atividade`
respondem 500. O preflight de schema do deploy (`node scripts/deploy/preflight-schema.mjs`) passou a exigir as 6
colunas (`COLUNAS_EXIGIDAS`). O runtime de hoje não conhece a tabela nem as colunas e segue igual com o banco
migrado (colunas anuláveis; a tabela nova nasce vazia) — **não há janela**. O Instant Rollback da Vercel continua
possível depois (o código anterior não depende de nada novo).

**Efeito durante a transação:** cada `ADD COLUMN` anulável sem DEFAULT é só catálogo, mas pede `ACCESS EXCLUSIVE`
por um instante em `Atividade`, `AtividadeApontamento`, `AtividadeApontamentoProduto`, `Produto` e
`TipoAtividade` (até o `COMMIT`: as telas de Atividades, Produtos e Operações esperam). As FKs pedem
`SHARE ROW EXCLUSIVE` em `Cliente`, `Empresa`, `Atividade` e `CADCULTURAS` (leituras seguem). Milissegundos no
volume atual. Uma espera além do `lock_timeout` de 5 s aborta tudo sem aplicar nada. Fora de pico.

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
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)  AS concluidas,  -- 72
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)   AS ruins,       -- 0
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261120200000_apontamento_data_termino'
     AND checksum = 'a1f8a13c782cfc4fe3d3050749ebb0663eb943d039231db0490ce89fea90c84b' AND finished_at IS NOT NULL) AS anterior_ok, -- 1
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261121100000_atividade_campos_por_tipo') AS registrada, -- 0
  to_regclass('public."AtividadePlantio"') IS NULL                                                    AS tabela_ausente, -- true
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND (
       (table_name = 'Atividade' AND column_name = 'local')
    OR (table_name = 'AtividadeApontamento' AND column_name = 'numero_receituario')
    OR (table_name = 'AtividadeApontamentoProduto' AND column_name = 'vc_percentual')
    OR (table_name = 'Produto' AND column_name = 'carencia_dias')
    OR (table_name = 'TipoAtividade' AND column_name = 'alvo')))                                      AS colunas_ja_existentes, -- 0
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public')                                        AS tabelas;     -- 105
```

E, localmente, no `<SHA_APROVADO>`: `sha256sum` do `migration.sql` igual ao pinado e `classificarMigrations` com
`modo: EXPAND` e `violacoes: []` (teste B40a).

### 2.1 Fatos para o relatório (somente leitura; não bloqueiam)

A lista de referência de capins mudou **só no código** (o Marandu passa de 25/15 para 35/20; entram 6 capins). O
comando "Incluir lista de referência" pula a cultura que a fazenda já tem pelo nome: **nenhuma linha de fazenda é
reescrita**. Estas consultas dizem quantas linhas de produção ficam diferentes da referência nova, para o proprietário
decidir se ajusta à mão no Cadastro de Culturas:

```sql
-- O Marandu das fazendas: total, quantos diferem de 35/20 e quantos ainda são a cópia intocada da referência antiga.
SELECT count(*)                                                                                       AS marandu,
       count(*) FILTER (WHERE altura_entrada_cm IS DISTINCT FROM 35.0 OR altura_saida_cm IS DISTINCT FROM 20.0) AS diferem_da_nova,
       count(*) FILTER (WHERE altura_entrada_cm = 25.0 AND altura_saida_cm = 15.0
                          AND observacoes = 'Valor de referência (manejo rotacionado). Ajuste para a fazenda.') AS copia_intocada_da_antiga,
       count(DISTINCT (cliente_id, empresa_id))                                                       AS fazendas
  FROM "CADCULTURAS"
 WHERE nome = 'BRACHIARIA BRIZANTHA CV. MARANDU';

-- Quantas áreas estão ligadas a esse Marandu (D-PROD-216) e não têm altura própria (usam a da cultura).
SELECT count(*) AS areas_no_marandu,
       count(*) FILTER (WHERE a.altura_entrada_cm IS NULL AND a.altura_saida_cm IS NULL) AS sem_altura_propria
  FROM "AreaPastagem" a
  JOIN "CADCULTURAS" c ON c.cliente_id = a.cliente_id AND c.id = a.cultura_id
 WHERE c.nome = 'BRACHIARIA BRIZANTHA CV. MARANDU';

-- Os 6 capins novos que alguma fazenda já tem pelo nome (seriam pulados pelo comando).
SELECT nome, count(*) FROM "CADCULTURAS"
 WHERE nome IN ('BRACHIARIA HÍBRIDA BRS RB331 IPYPORÃ', 'BRACHIARIA RUZIZIENSIS BRS INTEGRA', 'PANICUM BRS TAMANI',
                'PANICUM BRS QUÊNIA', 'BRACHIARIA HUMIDICOLA BRS TUPI', 'ESTILOSANTES CAMPO GRANDE')
 GROUP BY nome ORDER BY nome;

-- Operações de Aplicação (o alvo nasce vazio; o proprietário preenche no cadastro da operação) e plantios em aberto
-- sem capim (o registro novo não os continua: o próximo registro de plantio abre outra atividade, com o capim).
SELECT (SELECT count(*) FROM "TipoAtividade" WHERE categoria = 'APLICACAO')                           AS operacoes_de_aplicacao,
       (SELECT count(*) FROM "Atividade" a JOIN "TipoAtividade" t ON t.cliente_id = a.cliente_id AND t.id = a.tipo_atividade_id
         WHERE t.categoria = 'PLANTIO' AND a.status = 'ABERTA')                                        AS plantios_abertos_sem_capim;
```

Anotar os números no §6. No banco local de teste e no do ensaio, as duas primeiras deram 0.

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
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261121100000_atividade_campos_por_tipo') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 72 OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261120200000_apontamento_data_termino'
                    AND checksum = 'a1f8a13c782cfc4fe3d3050749ebb0663eb943d039231db0490ce89fea90c84b'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (20261120200000_apontamento_data_termino) não está concluída com o checksum do repositório';
  END IF;
  IF to_regclass('public."AtividadePlantio"') IS NOT NULL THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a tabela AtividadePlantio já existe';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND (
       (table_name = 'Atividade' AND column_name = 'local')
    OR (table_name = 'AtividadeApontamento' AND column_name = 'numero_receituario')
    OR (table_name = 'AtividadeApontamentoProduto' AND column_name = 'vc_percentual')
    OR (table_name = 'Produto' AND column_name = 'carencia_dias')
    OR (table_name = 'TipoAtividade' AND column_name = 'alvo'))) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: uma das 5 colunas novas já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '9e6487ffddb92a35945c675c1924f363c3396e97dac52e56e8d3c94c20a32a58', now(),
        '20261121100000_atividade_campos_por_tipo', NULL, NULL, now(), 1);
COMMIT;
```

Confira o SHA-256 do trecho da migration antes de usar. Qualquer falha desfaz tudo.

**Ensaio local (2026-11-21, PostgreSQL local, nunca produção):** banco novo com as 72 migrations anteriores
(`prisma migrate deploy` sem a pasta nova; 72 / 0, 105 tabelas); o envelope acima, com o `system_identifier` do banco
local no lugar do de produção (o resto byte a byte igual), aplicou numa transação: 73 / 0, a nova com o checksum
`9e6487ff…2a58` e 1 passo, 106 tabelas. A 2ª execução recusou (`RELEASE_BLOCKED: migration já registrada`); o envelope
com o identificador de produção, num banco local, recusou (`RELEASE_BLOCKED: alvo divergente`). Depois:
`prisma migrate status` "Database schema is up to date!" (73 migrations) e `prisma migrate diff --from-url <banco>
--to-schema-datamodel backend/prisma/schema.prisma` vazio ("This is an empty migration.").

## 4. Conferência — somente leitura

```sql
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
  FROM _prisma_migrations;                                                                  -- 73, 0
SELECT checksum, applied_steps_count FROM _prisma_migrations
 WHERE migration_name = '20261121100000_atividade_campos_por_tipo';                          -- 9e6487ff…2a58, 1
SELECT table_name, column_name, data_type, character_maximum_length, numeric_precision, numeric_scale, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND (
       (table_name = 'Atividade' AND column_name = 'local')
    OR (table_name = 'AtividadeApontamento' AND column_name = 'numero_receituario')
    OR (table_name = 'AtividadeApontamentoProduto' AND column_name = 'vc_percentual')
    OR (table_name = 'Produto' AND column_name = 'carencia_dias')
    OR (table_name = 'TipoAtividade' AND column_name = 'alvo'))
 ORDER BY table_name;
SELECT contype, count(*) FROM pg_constraint WHERE conrelid = 'public."AtividadePlantio"'::regclass GROUP BY contype;
SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'AtividadePlantio';
SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'public."AtividadePlantio"'::regclass;
SELECT policyname, roles FROM pg_policies WHERE schemaname = 'public' AND tablename = 'AtividadePlantio';
SELECT grantee, privilege_type FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND table_name = 'AtividadePlantio' AND grantee IN ('anon', 'authenticated');
SELECT count(*) FROM "AtividadePlantio";
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';
```

| Conferência | Esperado (igual ao ensaio local) |
|---|---|
| `_prisma_migrations` | 73 / 0; a `20261121100000_atividade_campos_por_tipo` com o checksum do §0 e 1 passo |
| as 5 colunas | `local` varchar 120, `numero_receituario` varchar 40, `vc_percentual` numeric (5,2), `carencia_dias` integer, `alvo` varchar 60; todas `YES` (anuláveis) e sem DEFAULT |
| `AtividadePlantio` | constraints: 1 `p`, 5 `f`, 2 `c` (`AtividadePlantio_forma_plantio_check`, `AtividadePlantio_consorcio_check`); 5 índices (pkey, 2 unique, 2 btree); RLS ligado sem FORCE; política `maike_backend_all` só para `maike_vercel`; nenhum GRANT para `anon`/`authenticated`; 0 linhas |
| tabelas em `public` | 106 |
| `get_advisors` (security e performance) | nenhum alerta novo |
| `node scripts/deploy/preflight-schema.mjs` | ok (as 6 colunas exigidas presentes) |

## 5. Merge, deploy e smoke

1. Merge **logo depois** do §4 (nunca antes). 2. Deploy READY na Vercel: `/api/native/health` com o `release` da
`main` nova. 3. Smoke numa fazenda de teste:
- Cadastro de Produtos: abrir um defensivo, preencher **Carência (dias)**, salvar e reabrir.
- Cadastro de Operações: uma operação de Aplicação com **Alvo**; "Outro (escrever)" grava o texto em maiúsculas.
- Atividades → **+ Nova realização** → **Plantio de pastagem**: Capim plantado obrigatório, Safra só leitura
  ("2026/27" para dia entre 01/07/2026 e 30/06/2027), salvar; a atividade nasce com o capim e a safra.
- **Aplicação**: Alvo só leitura, Nº do receituário, "Pasto liberado em" com a carência do produto.
- **Manutenção** sem área: Local obrigatório, Quantidade feita 1,2 KM; salvar; a lista mostra o local na coluna Área.
- Celular (390 px): o rótulo das datas não cobre o valor.

## 6. Rollback

A tabela é nova e nenhuma tabela antiga a referencia; as colunas são anuláveis. Reverter seria uma migration nova
(`DROP TABLE "AtividadePlantio"` e `DROP COLUMN` das 5 colunas: CONTRACT, com GO próprio), nunca editando esta. Com o
código novo no ar, reverter o código primeiro (o código anterior não depende de nada novo). O que o código novo
gravou (capim, local, receituário, VC, carência, alvo) se perde no DROP.

## 7. Ordem com outras releases

Em 2026-11-21 esta é a 73ª pasta e a única pendente da `main` + esta branch. Se outra migration entrar na `main`
antes, recontar o §2 (o número de concluídas e a "anterior" mudam) e ajustar a guarda do §3.

## 8. Registro

| Data | Quem | O quê |
|---|---|---|
| 2026-11-21 | Claude (sessão D-PROD-273) | plano preparado; migration aplicada e testada só no PostgreSQL local (banco de teste e banco do ensaio do §3); **nada aplicado em produção** |
