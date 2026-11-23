# MAIKE — Produto do implemento no tipo: runbook de release expand-only (D-PROD-279)

> **Estado: PLANO. `SCHEMA_APPLIED_PROD: NÃO`.** A migration foi testada só no PostgreSQL local. Nada foi aplicado
> em produção.
>
> Cada passo exige o GO do proprietário ("aplica") e para no primeiro desvio com **`RELEASE_BLOCKED`**. Valores
> entre `<…>` são preenchidos na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-279](./DECISIONS.md) · Relatório: [`MAIKE-TIPO-IMPLEMENTO-PRODUTO-REPORT.md`](./MAIKE-TIPO-IMPLEMENTO-PRODUTO-REPORT.md).
Molde: [`MAIKE-ENTREGA3-REFORMA-RUNBOOK-RELEASE.md`](./MAIKE-ENTREGA3-REFORMA-RUNBOOK-RELEASE.md) (D-PROD-276, PR
#362, mergeada em `41d9e907` e aplicada em produção em 2026-11-23). **Esta release vem DEPOIS da reforma:** a guarda
do §3 exige a `20261122100000_reforma_planejamento` concluída em produção com o checksum do repositório. Se o
histórico não conferir, o preflight do §2 dá `anterior_ok = 0` ou outra contagem e o caminho B recusa.

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261124100000_tipo_implemento_produto` |
| Natureza | **expand-only** (sem `--contract`): **4 colunas anuláveis, sem DEFAULT e sem CHECK**, na tabela antiga `TipoPatrimonial`: `usa_produto` BOOLEAN, `forma_produto` VARCHAR(16) (hoje só `JATO`), `capacidade` DECIMAL(14,4) e `capacidade_unidade` VARCHAR(8) (`L` ou `KG`). A natureza (só IMPLEMENTO), a forma, a faixa (> 0 e ≤ 100000) e a unidade são conferidas pela API. Nenhuma tabela nova; nenhuma linha muda de valor; nenhum DROP, RENAME, ALTER COLUMN ou DML |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) = checksum do Prisma | `a18362400ec4345487bca6bb4b6c94c62991cb120bb36786448a46c39a64ae45` |
| Bloco RLS | nenhum (nenhuma tabela nova) |
| Classificador | `modo: EXPAND`, `violacoes: []`, `tabelas_novas []`, `colunas_novas_em_tabelas_antigas` só as 4 de `TipoPatrimonial`, `contract: []` (teste B43a) |
| `_prisma_migrations` | esperado **75** concluídas, 0 abertas (a última `20261122100000_reforma_planejamento`, D-PROD-276, checksum `27f16e1d44df673e97a62ef2122199c94d8d6adcdd07d006180ef0f90b873a10`); depois **76**. Recontar no §2 |
| Tabelas em `public` | **111** antes e depois |

**Por que antes do merge (D-PROD-72 item 1):** a Vercel publica a `main` sozinha. O runtime novo seleciona as 4
colunas em toda leitura do tipo (`/patrimonio-tipos`, o "Gerenciar tipos" e o cadastro do bem): sem a migration, essas
rotas respondem 500. O preflight de schema do deploy (`node scripts/deploy/preflight-schema.mjs`) passou a exigir as 4
colunas (`COLUNAS_EXIGIDAS`). O runtime de hoje não conhece as colunas e segue igual com o banco migrado (anuláveis) —
**não há janela**. O Instant Rollback da Vercel continua possível depois.

**Efeito durante a transação:** cada `ADD COLUMN` anulável sem DEFAULT é só catálogo, mas pede `ACCESS EXCLUSIVE` em
`TipoPatrimonial` por um instante (o cadastro de bens e o "Gerenciar tipos" esperam). Milissegundos no volume atual.
Uma espera além do `lock_timeout` de 5 s aborta tudo sem aplicar nada. Fora de pico.

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
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)  AS concluidas,  -- 75
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)   AS ruins,       -- 0
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261122100000_reforma_planejamento'
     AND checksum = '27f16e1d44df673e97a62ef2122199c94d8d6adcdd07d006180ef0f90b873a10' AND finished_at IS NOT NULL
     AND rolled_back_at IS NULL)                                                                      AS anterior_ok, -- 1
  (SELECT migration_name FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 1)                AS ultima,      -- 20261122100000_reforma_planejamento
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261124100000_tipo_implemento_produto') AS registrada, -- 0
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'TipoPatrimonial'
     AND column_name IN ('usa_produto', 'forma_produto', 'capacidade', 'capacidade_unidade'))          AS colunas_ja_existem, -- 0
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public')                                        AS tabelas;     -- 111
```

E, localmente, no `<SHA_APROVADO>`: `sha256sum` do `migration.sql` igual ao pinado e `classificarMigrations` com
`modo: EXPAND` e `violacoes: []` (teste B43a).

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
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261124100000_tipo_implemento_produto') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 75 OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261122100000_reforma_planejamento'
                    AND checksum = '27f16e1d44df673e97a62ef2122199c94d8d6adcdd07d006180ef0f90b873a10'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (20261122100000_reforma_planejamento) não está concluída com o checksum do repositório';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'TipoPatrimonial'
                AND column_name IN ('usa_produto', 'forma_produto', 'capacidade', 'capacidade_unidade')) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: uma das colunas novas de TipoPatrimonial já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'a18362400ec4345487bca6bb4b6c94c62991cb120bb36786448a46c39a64ae45', now(),
        '20261124100000_tipo_implemento_produto', NULL, NULL, now(), 1);
COMMIT;
```

Confira o SHA-256 do trecho da migration antes de usar. Qualquer falha desfaz tudo.

**Ensaio local (2026-11-23, PostgreSQL local, nunca produção; sobre a `main` `d62a4ef8`):** banco novo
(`maike_tip_rb`) com as 75 migrations da `main` (`prisma migrate deploy` numa cópia da pasta sem a migration nova):
75 concluídas, 0 com falha, a última `20261122100000_reforma_planejamento` com o checksum `27f16e1d…3a10`, 111
tabelas. O envelope acima, montado com o conteúdo integral do `migration.sql` (sha256 `a1836240…ae45`): com o
identificador de produção, no banco local, recusou antes (`RELEASE_BLOCKED: alvo divergente`); com o
`system_identifier` do banco local no lugar do de produção (o resto byte a byte igual), aplicou numa transação: 76 / 0,
a nova com o checksum `a1836240…ae45` e 1 passo, 111 tabelas, as 4 colunas anuláveis sem DEFAULT (`boolean`,
`character varying` 16, `numeric` 14,4, `character varying` 8), 0 linhas preenchidas. A 2ª execução recusou
(`RELEASE_BLOCKED: migration já registrada`). Depois, com a pasta completa do repositório: `prisma migrate status`
"76 migrations found … Database schema is up to date!" e `prisma migrate diff --from-url <banco>
--to-schema-datamodel backend/prisma/schema.prisma` "No difference detected.". O banco do ensaio foi apagado.

## 4. Conferência — somente leitura

```sql
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
  FROM _prisma_migrations;                                                                  -- 76, 0
SELECT checksum, applied_steps_count FROM _prisma_migrations
 WHERE migration_name = '20261124100000_tipo_implemento_produto';                            -- a1836240…ae45, 1
SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'TipoPatrimonial'
   AND column_name IN ('usa_produto', 'forma_produto', 'capacidade', 'capacidade_unidade') ORDER BY column_name;
SELECT count(*) FROM "TipoPatrimonial"
 WHERE usa_produto IS NOT NULL OR forma_produto IS NOT NULL OR capacidade IS NOT NULL OR capacidade_unidade IS NOT NULL;
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';
```

| Conferência | Esperado (igual ao ensaio local) |
|---|---|
| `_prisma_migrations` | 76 / 0; a `20261124100000_tipo_implemento_produto` com o checksum do §0 e 1 passo |
| colunas | 4: `capacidade` numeric(14,4), `capacidade_unidade` varchar(8), `forma_produto` varchar(16), `usa_produto` boolean; todas `YES` (anuláveis), sem DEFAULT |
| linhas preenchidas | 0 |
| tabelas em `public` | 111 |
| `get_advisors` (security e performance) | nenhum alerta novo |
| `node scripts/deploy/preflight-schema.mjs` | ok (as 4 colunas exigidas presentes) |

## 5. Merge, deploy e smoke

1. Merge **logo depois** do §4 (nunca antes). 2. Deploy READY na Vercel: `/api/native/health` com o `release` da
`main` nova. 3. Smoke numa fazenda de teste:
- Bens → **⋯ › Gerenciar tipos** → **+ Novo tipo**, Tipo de bem **Implemento**: aparece "Usa produto?" (Não marcado)
  e a dica "Ex.: pulverizador 2.000 L. A grade não usa produto."; Sim → "Como conta: Por jato (tanque)",
  "Capacidade do jato" 2.000, Unidade L; salvar. Na lista: "usa produto · jato 2.000 L".
- O mesmo com Tipo de bem **Máquina**: o bloco não aparece; o tipo é criado como antes.
- Um implemento com "Não" (a grade): sem o texto do produto na lista.

## 6. Rollback

As colunas são anuláveis. Reverter seria uma migration nova (`DROP COLUMN` das 4: CONTRACT, com GO próprio), nunca
editando esta. Com o código novo no ar, reverter o código primeiro (o código anterior não depende de nada novo). O que
o código novo gravou (o produto dos tipos de implemento) se perde no DROP; os tipos e os bens ficam.

## 7. Ordem com outras releases

Em 2026-11-23 esta é a 76ª pasta. A 75ª (`20261122100000_reforma_planejamento`, Entrega 3, D-PROD-276, PR #362)
foi mergeada (`41d9e907`) e aplicada em produção. Se outra migration entrar na `main` antes desta, recontar o §2 (o
número de concluídas e a "anterior" mudam) e ajustar a guarda do §3.

## 8. Registro

| Data | Quem | O quê |
|---|---|---|
| 2026-11-23 | Claude (sessão D-PROD-279) | plano preparado sobre a `main` `d62a4ef8`; migration aplicada e testada só no PostgreSQL local (banco de teste e banco do ensaio do §3); **nada aplicado em produção** |
