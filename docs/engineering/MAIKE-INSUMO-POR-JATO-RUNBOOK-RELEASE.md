# MAIKE — Insumo por jato: runbook de release expand-only (D-PROD-283)

> **Estado: `SCHEMA_APPLIED_PROD: SIM` (2026-11-24, caminho B, GO do proprietário).** Pós-checagem do §4 conferida.
>
> Cada passo exige o GO do proprietário ("aplica") e para no primeiro desvio com **`RELEASE_BLOCKED`**. Valores
> entre `<…>` são preenchidos na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-283](./DECISIONS.md) · Relatório: [`MAIKE-INSUMO-POR-JATO-REPORT.md`](./MAIKE-INSUMO-POR-JATO-REPORT.md).
Molde: [`MAIKE-TIPO-IMPLEMENTO-PRODUTO-RUNBOOK-RELEASE.md`](./MAIKE-TIPO-IMPLEMENTO-PRODUTO-RUNBOOK-RELEASE.md)
(D-PROD-279, aplicada em produção em 2026-11-23). **Esta release vem DEPOIS do controle de lote** (D-PROD-282, PR #369,
`20261124200000_estoque_controle_lote`): a guarda do §3 exige essa migration concluída em produção com o checksum do
repositório. Se ela ainda não estiver aplicada, o preflight do §2 mostra `anterior_ok = 0` e o caminho B recusa: aplicar
a do controle de lote primeiro (runbook dela).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261125100000_insumo_por_jato` |
| Natureza | **expand-only** (sem `--contract`): **1 coluna anulável, sem DEFAULT e sem CHECK**, na tabela antiga `AtividadeApontamentoProduto`: `jato` INTEGER (o número do jato no dia). A faixa (1 a 999) é conferida pela API. Nenhuma tabela nova; nenhuma linha muda de valor; nenhum DROP, RENAME, ALTER COLUMN ou DML |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) = checksum do Prisma | `725a8c5ac873ad19d0c191cd7c2f303dc84ef97170b74c0bb2133479c76d3551` |
| Bloco RLS | nenhum (nenhuma tabela nova) |
| Classificador | `modo: EXPAND`, `violacoes: []`, `tabelas_novas []`, `colunas_novas_em_tabelas_antigas` só `AtividadeApontamentoProduto.jato`, `contract: []` (teste B43o) |
| `_prisma_migrations` | esperado **77** concluídas, 0 abertas (a última `20261124200000_estoque_controle_lote`, D-PROD-282, checksum `b6b33b0ebb35f44d91d7b3766525a51e839d68348aca78388fd26ab2645948fc`); depois **78**. Recontar no §2 |
| Tabelas em `public` | iguais antes e depois (recontar no §2) |

**Por que antes do merge (D-PROD-72 item 1):** a Vercel publica a `main` sozinha. O runtime novo lê a coluna `jato` em
toda leitura de apontamento (lista, detalhes, registrar, editar a linha de insumo): sem a migration, o lançamento de
atividades responde 500. O preflight de schema do deploy passou a exigir a coluna (`COLUNAS_EXIGIDAS`). O runtime de hoje
não conhece a coluna e segue igual com o banco migrado (anulável): **não há janela**.

**Efeito durante a transação:** o `ADD COLUMN` anulável sem DEFAULT é só catálogo, mas pede `ACCESS EXCLUSIVE` em
`AtividadeApontamentoProduto` por um instante (o lançamento de insumo espera). Milissegundos no volume atual. Uma espera
além do `lock_timeout` de 5 s aborta tudo sem aplicar nada. Fora de pico.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** `node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>`, depois
  `--verificar-alvo` (1 pendente do manifesto) e `--aplicar` (EXPAND: **sem `--contract`**), com
  `MIGRATION_DATABASE_URL` direta ou sessão na 5432, `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360` e
  `DATABASE_URL` do mesmo banco.
- **B — conector Supabase, uma única `execute_sql` (§3):** só com autorização **escrita e específica do
  proprietário para esta migration** ("aplica"), registrada como desvio da D-PROD-74, como nas anteriores.

## 2. Preflight — somente leitura (projeto `uuemcasqcdjucflulkne`)

```sql
SELECT
  (SELECT system_identifier FROM pg_control_system())                                                 AS sid,         -- 7692130048193495360
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)  AS concluidas,  -- 77
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)   AS ruins,       -- 0
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261124200000_estoque_controle_lote'
     AND checksum = 'b6b33b0ebb35f44d91d7b3766525a51e839d68348aca78388fd26ab2645948fc' AND finished_at IS NOT NULL
     AND rolled_back_at IS NULL)                                                                      AS anterior_ok, -- 1
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261125100000_insumo_por_jato')   AS registrada,  -- 0
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
     AND table_name = 'AtividadeApontamentoProduto' AND column_name = 'jato')                          AS coluna_ja_existe, -- 0
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public')                                        AS tabelas;
```

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
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261125100000_insumo_por_jato') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 77 OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261124200000_estoque_controle_lote'
                    AND checksum = 'b6b33b0ebb35f44d91d7b3766525a51e839d68348aca78388fd26ab2645948fc'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (20261124200000_estoque_controle_lote) não está concluída com o checksum do repositório';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'AtividadeApontamentoProduto' AND column_name = 'jato') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a coluna jato já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '725a8c5ac873ad19d0c191cd7c2f303dc84ef97170b74c0bb2133479c76d3551', now(),
        '20261125100000_insumo_por_jato', NULL, NULL, now(), 1);
COMMIT;
```

Confira o SHA-256 do trecho da migration antes de usar. Qualquer falha desfaz tudo.

**Ensaio local (2026-11-24, PostgreSQL local, nunca produção):** `prisma migrate deploy` no banco de teste
`maike_va2` (78 pastas): a nova aplicou sem erro; `backend/tests/insumoPorJato.test.mjs` (6/6) e as provas de migration
que sobem os espelhos sem ela (`diaDaD223`, `categoriaManejoCadcategoriaMigration`, `patrimonioSimplificaMigration`,
`estoqueEntradasMotivosMigration` e as demais que usam os espelhos: 203/203) passaram.

## 4. Conferência — somente leitura

```sql
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
  FROM _prisma_migrations;                                                                  -- 78, 0
SELECT checksum, applied_steps_count FROM _prisma_migrations
 WHERE migration_name = '20261125100000_insumo_por_jato';                                    -- 725a8c5a…3551, 1
SELECT data_type, is_nullable, column_default FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'AtividadeApontamentoProduto' AND column_name = 'jato'; -- integer, YES, NULL
SELECT count(*) FROM "AtividadeApontamentoProduto" WHERE jato IS NOT NULL;                   -- 0
```

Depois: `get_advisors` (security e performance) sem alerta novo.

## 5. Merge, deploy e smoke

1. Merge **logo depois** do §4 (nunca antes). 2. Deploy READY na Vercel. 3. Smoke numa fazenda de teste:
- Cadastrar um tipo de implemento "Usa produto? Sim · Por jato · 2.000 L" (D-PROD-279) e um implemento desse tipo.
- Abrir uma atividade com esse implemento na máquina: no lugar de "Insumos" aparece **"Jatos de hoje"**. "+ Jato",
  escolher o produto e a quantidade, "Pronto"; "+ Repetir o jato anterior"; o total do dia aparece; Salvar.
- O estoque do produto cai pela soma dos jatos.
- Com outro implemento (grade, roçadeira): a seção "Insumos" de sempre.

## 6. Rollback

A coluna é anulável. Reverter seria uma migration nova (`DROP COLUMN`: CONTRACT, com GO próprio), nunca editando esta.
Com o código novo no ar, reverter o código primeiro. O que o código novo gravou (o número do jato) se perde no DROP; as
linhas de insumo, o estoque e o custo ficam.

## 7. Registro

| Data | Quem | O quê |
|---|---|---|
| 2026-11-24 | Claude (sessão D-PROD-283) | plano preparado; migration aplicada e testada no PostgreSQL local |
| 2026-11-24 | Claude, com o GO do proprietário ("me manda a autorização para você aplicar a migração") | **aplicada em produção pelo caminho B** (desvio da D-PROD-74 autorizado): preflight 77/0, anterior `estoque_controle_lote` com o checksum, coluna ausente, 111 tabelas; depois 78/0, a nova com `725a8c5a…3551` e 1 passo, `jato` integer anulável sem DEFAULT, 0 linhas preenchidas, 111 tabelas |
