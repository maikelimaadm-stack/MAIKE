# MAIKE — Produto do implemento no bem: runbook de release expand-only (D-PROD-297)

> **Estado: `SCHEMA_APPLIED_PROD: NÃO`.** Aguarda o GO do proprietário ("aplica").
>
> Cada passo exige o GO do proprietário ("aplica") e para no primeiro desvio com **`RELEASE_BLOCKED`**. Valores
> entre `<…>` são preenchidos na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-297](./DECISIONS.md) · Relatório: [`MAIKE-BEM-IMPLEMENTO-PRODUTO-REPORT.md`](./MAIKE-BEM-IMPLEMENTO-PRODUTO-REPORT.md).
Molde: [`MAIKE-INSUMO-POR-JATO-RUNBOOK-RELEASE.md`](./MAIKE-INSUMO-POR-JATO-RUNBOOK-RELEASE.md) (D-PROD-283, aplicada em
produção em 2026-11-24). **Esta release vem DEPOIS das unidades de conversão** (D-PROD-288,
`20261125200000_produto_unidades_conversao`): a guarda do §3 exige essa migration concluída em produção com o checksum do
repositório. Se ela ainda não estiver aplicada, o preflight do §2 mostra `anterior_ok = 0` e o caminho B recusa: aplicar
a das unidades de conversão primeiro (runbook dela).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261126100000_bem_implemento_produto` |
| Natureza | **expand-only** (sem `--contract`): **4 colunas anuláveis, sem DEFAULT e sem CHECK**, na tabela antiga `BemPatrimonial`: `usa_produto` BOOLEAN, `forma_produto` VARCHAR(16), `capacidade` DECIMAL(14,4), `capacidade_unidade` VARCHAR(8). A API confere (só implemento, por jato, capacidade > 0 e até 100.000, L ou KG). Nenhuma tabela nova; nenhuma linha muda de valor; nenhum DROP, RENAME, ALTER COLUMN ou DML |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) = checksum do Prisma | `330d9318d1658720ffd0871eff4577d7367e5fca58d765fb50b7ab0dde6defbe` |
| Bloco RLS | nenhum (nenhuma tabela nova) |
| Classificador | `modo: EXPAND`, `violacoes: []`, `tabelas_novas []`, `colunas_novas_em_tabelas_antigas` só as 4 de `BemPatrimonial`, `contract: []` (teste B45a) |
| `_prisma_migrations` | esperado **79** concluídas, 0 abertas (a última `20261125200000_produto_unidades_conversao`, D-PROD-288, checksum `779347bf9780ecb391dc76e64048601e6adcad449b5b868a44811def12be863b`); depois **80**. Recontar no §2 |
| Tabelas em `public` | iguais antes e depois (recontar no §2) |

**Por que antes do merge (D-PROD-72 item 1):** a Vercel publica a `main` sozinha. O runtime novo lê as 4 colunas em toda
leitura do bem (lista, detalhe, gravar) e na lista de implementos e na linha de máquina do lançamento: sem a migration, o
cadastro de bens e o lançamento de atividades respondem 500. O preflight de schema do deploy passou a exigir as colunas
(`COLUNAS_EXIGIDAS`). O runtime de hoje não conhece as colunas e segue igual com o banco migrado (anuláveis): **não há
janela**.

**Efeito durante a transação:** os `ADD COLUMN` anuláveis sem DEFAULT são só catálogo, mas pedem `ACCESS EXCLUSIVE` em
`BemPatrimonial` por um instante. Milissegundos no volume atual. Uma espera além do `lock_timeout` de 5 s aborta tudo sem
aplicar nada. Fora de pico.

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
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)  AS concluidas,  -- 79
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)   AS ruins,       -- 0
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261125200000_produto_unidades_conversao'
     AND checksum = '779347bf9780ecb391dc76e64048601e6adcad449b5b868a44811def12be863b' AND finished_at IS NOT NULL
     AND rolled_back_at IS NULL)                                                                      AS anterior_ok, -- 1
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261126100000_bem_implemento_produto') AS registrada, -- 0
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'BemPatrimonial'
     AND column_name IN ('usa_produto', 'forma_produto', 'capacidade', 'capacidade_unidade'))           AS colunas_ja_existem, -- 0
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
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261126100000_bem_implemento_produto') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 79 OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261125200000_produto_unidades_conversao'
                    AND checksum = '779347bf9780ecb391dc76e64048601e6adcad449b5b868a44811def12be863b'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (20261125200000_produto_unidades_conversao) não está concluída com o checksum do repositório';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'BemPatrimonial'
                AND column_name IN ('usa_produto', 'forma_produto', 'capacidade', 'capacidade_unidade')) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: alguma das colunas já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '330d9318d1658720ffd0871eff4577d7367e5fca58d765fb50b7ab0dde6defbe', now(),
        '20261126100000_bem_implemento_produto', NULL, NULL, now(), 1);
COMMIT;
```

Confira o SHA-256 do trecho da migration antes de usar. Qualquer falha desfaz tudo.

**Ensaio local (2026-11-24, PostgreSQL local, nunca produção):** `prisma migrate deploy` no banco de teste `maike_va2`
(80 pastas): a nova aplicou sem erro; `bemImplementoProduto.test.mjs` (5/5), `insumoPorJato.test.mjs`,
`tipoImplementoProduto.test.mjs`, `patrimonioP1Bens.test.mjs` e as provas de migration que sobem os espelhos sem ela
(`categoriaManejoCadcategoriaMigration`, `patrimonioSimplificaMigration`, `estoqueEntradasMotivosMigration`) passaram.
Ensaio no navegador real (backend + tela locais): cadastro do pulverizador "Leva produto? Sim · 2.000 L", lançamento com
3 jatos, Finalizar com "Fez o pasto todo?".

## 4. Conferência — somente leitura

```sql
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
  FROM _prisma_migrations;                                                                  -- 80, 0
SELECT checksum, applied_steps_count FROM _prisma_migrations
 WHERE migration_name = '20261126100000_bem_implemento_produto';                             -- 330d9318…efbe, 1
SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'BemPatrimonial'
   AND column_name IN ('usa_produto', 'forma_produto', 'capacidade', 'capacidade_unidade')
 ORDER BY column_name;                                                                       -- 4 linhas, YES, NULL
SELECT count(*) FROM "BemPatrimonial" WHERE usa_produto IS NOT NULL OR capacidade IS NOT NULL; -- 0
```

Depois: `get_advisors` (security e performance) sem alerta novo.

## 5. Merge, deploy e smoke

1. Merge **logo depois** do §4 (nunca antes). 2. Deploy READY na Vercel. 3. Smoke:
- Bens › abrir o pulverizador (Implemento): na primeira aba aparece **"Leva produto (veneno, adubo)?"**. Marcar **Sim**,
  "Quanto cabe no tanque" 2.000, **Litros**, Salvar.
- Nova atividade de Aplicação com o trator e esse implemento: no lugar de "Insumos" aparece **"Jatos de hoje · Tanque de
  2.000 L"**; "+ Jato", produto e quantidade, "Pronto", "+ Repetir o jato anterior"; Salvar com "Não, continua": a área
  fica **0 de N ha** (os hectares vêm no Finalizar).
- Finalizar pelo cartão: **"Fez o pasto todo?"** e o "Como ficou" (jatos, horas, produto por hectare, custo).
- Gerenciar tipos: não há mais "Usa produto?" no tipo.

## 6. Rollback

As colunas são anuláveis. Reverter seria uma migration nova (`DROP COLUMN`: CONTRACT, com GO próprio), nunca editando
esta. Com o código novo no ar, reverter o código primeiro. O que o código novo gravou (a marcação do produto no bem) se
perde no DROP; os lançamentos, o estoque e o custo ficam.

## 7. Registro

| Data | Quem | O quê |
|---|---|---|
| 2026-11-24 | Claude (sessão D-PROD-297) | plano preparado; migration aplicada e testada no PostgreSQL local; ensaio no navegador |
