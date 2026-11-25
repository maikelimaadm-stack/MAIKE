# MAIKE — Unidade de conversão no cocho, na transferência e na atividade: runbook de release (D-PROD-310)

> **Estado: `SCHEMA_APPLIED_PROD: SIM` (2026-11-25, caminho B, GO do proprietário, antes do merge da PR #396).**
> Pós-checagem do §4 conferida. Registro no §7.
>
> Este documento é o plano. Cada passo exige o GO do proprietário ("aplica") e para no primeiro desvio com
> **`RELEASE_BLOCKED`**. Valores entre `<…>` são preenchidos na hora, a partir de leituras reais, nunca copiados deste
> texto.

Decisão: [D-PROD-310](./DECISIONS.md) · Relatório: [`MAIKE-UNIDADE-CONVERTIDA-LANCAMENTOS-REPORT.md`](./MAIKE-UNIDADE-CONVERTIDA-LANCAMENTOS-REPORT.md) ·
SPEC: [`MAIKE-PRODUTO-UNIDADES-CONVERSAO-SPEC.md`](./MAIKE-PRODUTO-UNIDADES-CONVERSAO-SPEC.md) §7.
Molde: [`MAIKE-PRODUTO-UNIDADES-CONVERSAO-RUNBOOK-RELEASE.md`](./MAIKE-PRODUTO-UNIDADES-CONVERSAO-RUNBOOK-RELEASE.md) (D-PROD-288)
e, para o formato EXPAND sem `--contract`, [`MAIKE-BEM-IMPLEMENTO-PRODUTO-RUNBOOK-RELEASE.md`](./MAIKE-BEM-IMPLEMENTO-PRODUTO-RUNBOOK-RELEASE.md)
(D-PROD-297). **Esta release vem DEPOIS do produto do implemento no bem** (`20261126100000_bem_implemento_produto`,
aplicada em produção em 2026-11-24): a guarda do §3 exige essa migration concluída com o checksum do repositório.

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261126200000_unidade_convertida_lancamentos` |
| Natureza | **expand-only** (sem `--contract`): **6 colunas anuláveis, sem DEFAULT e sem CHECK**, em 2 tabelas antigas: `MovimentacaoEstoque` e `AtividadeApontamentoProduto` — `unidade_lancamento` VARCHAR(8), `quantidade_lancamento` DECIMAL(14,4) e `fator_lancamento` DECIMAL(14,4) em cada. A API confere (conversão ativa do próprio produto, com o uso; a quantidade do movimento fica na unidade de estoque). Nenhuma tabela nova; nenhuma linha muda de valor (todas nulas = "sem conversão"); nenhum DROP, RENAME, ALTER COLUMN ou DML |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) = checksum do Prisma | `3644b7fd9aef0362ecfb8584904aaee6c3844cd1ca981c9691c3db8a1ccbf169` |
| Bloco RLS | nenhum (nenhuma tabela nova) |
| Classificador | `modo: EXPAND`, `violacoes: []`, `tabelas_novas []`, `colunas_novas_em_tabelas_antigas` só as 6, `contract: []` (teste B46a) |
| Preflight de schema do deploy (`COLUNAS_EXIGIDAS`) | as 6 colunas (sem elas o deploy novo para antes de publicar) |
| `_prisma_migrations` | esperado **80** concluídas, 0 abertas (a última `20261126100000_bem_implemento_produto`, D-PROD-297, checksum `330d9318d1658720ffd0871eff4577d7367e5fca58d765fb50b7ab0dde6defbe`); depois **81**. Recontar no §2 |
| Tabelas em `public` | iguais antes e depois (recontar no §2) |

**Por que antes do merge (D-PROD-72 item 1):** a Vercel publica a `main` sozinha. O runtime novo grava as colunas no cocho,
nas transferências e na linha da atividade, as lê em toda leitura da linha de produto (o Prisma seleciona todas as colunas)
e conta a sigla "em uso" no cadastro do produto: sem a migration, o lançamento de atividades, o cocho, a transferência e o
cadastro de produto respondem 500. O runtime de hoje não conhece as colunas e segue igual com o banco migrado (anuláveis):
**não há janela**.

**Efeito durante a transação:** os `ADD COLUMN` anuláveis sem DEFAULT são só catálogo, mas pedem `ACCESS EXCLUSIVE` em
`MovimentacaoEstoque` e `AtividadeApontamentoProduto` por um instante. Milissegundos no volume atual. Uma espera além do
`lock_timeout` de 5 s aborta tudo sem aplicar nada. `MovimentacaoEstoque` é muito lida: **fora do horário de lançamento**.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** `node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>`, depois
  `--verificar-alvo` (1 pendente do manifesto) e `--aplicar` (EXPAND: **sem `--contract`**), com
  `MIGRATION_DATABASE_URL` direta ou sessão na 5432, `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360` e
  `DATABASE_URL` do mesmo banco.
- **B — conector Supabase, uma única `execute_sql` (§3):** só com autorização **escrita e específica do proprietário
  para esta migration** ("aplica"), registrada como desvio da D-PROD-74, como nas anteriores.

## 2. Preflight — somente leitura (projeto `uuemcasqcdjucflulkne`)

```sql
SELECT
  (SELECT system_identifier FROM pg_control_system())                                                 AS sid,         -- 7692130048193495360
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL)  AS concluidas,  -- 80
  (SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)   AS ruins,       -- 0
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261126100000_bem_implemento_produto'
     AND checksum = '330d9318d1658720ffd0871eff4577d7367e5fca58d765fb50b7ab0dde6defbe' AND finished_at IS NOT NULL
     AND rolled_back_at IS NULL)                                                                      AS anterior_ok, -- 1
  (SELECT count(*) FROM _prisma_migrations WHERE migration_name = '20261126200000_unidade_convertida_lancamentos') AS registrada, -- 0
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public'
     AND table_name IN ('MovimentacaoEstoque', 'AtividadeApontamentoProduto')
     AND column_name IN ('unidade_lancamento', 'quantidade_lancamento', 'fator_lancamento'))          AS colunas_ja_existem, -- 0
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public')                                        AS tabelas;     -- <n>
```

## 3. Caminho B — uma transação

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT pg_advisory_xact_lock(72707371);
DO $guarda$
DECLARE n_ok int; n_ruim int;
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7692130048193495360 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: alvo divergente';
  END IF;
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261126200000_unidade_convertida_lancamentos') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 80 OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261126100000_bem_implemento_produto'
                    AND checksum = '330d9318d1658720ffd0871eff4577d7367e5fca58d765fb50b7ab0dde6defbe'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: a anterior (20261126100000_bem_implemento_produto) não está concluída com o checksum do repositório';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name IN ('MovimentacaoEstoque', 'AtividadeApontamentoProduto')
                AND column_name IN ('unidade_lancamento', 'quantidade_lancamento', 'fator_lancamento')) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: alguma das colunas já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '3644b7fd9aef0362ecfb8584904aaee6c3844cd1ca981c9691c3db8a1ccbf169', now(),
        '20261126200000_unidade_convertida_lancamentos', NULL, NULL, now(), 1);
COMMIT;
```

Confira o SHA-256 do trecho da migration antes de usar. Qualquer falha desfaz tudo.

**Ensaio local (2026-11-25, PostgreSQL 16 local, nunca produção):** `npm run deploy:migrate` no banco de teste
`maike_ucl` (81 pastas): a nova aplicou sem erro; `unidadeConvertidaLancamentos.test.mjs` (14/14) e as suítes de cocho,
transferência, atividade, lote e unidades de conversão passaram (relatório §4).

## 4. Conferência — somente leitura

```sql
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
  FROM _prisma_migrations;                                                                  -- 81, 0
SELECT checksum, applied_steps_count FROM _prisma_migrations
 WHERE migration_name = '20261126200000_unidade_convertida_lancamentos';                    -- 3644b7fd…f169, 1
SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name IN ('MovimentacaoEstoque', 'AtividadeApontamentoProduto')
   AND column_name IN ('unidade_lancamento', 'quantidade_lancamento', 'fator_lancamento')
 ORDER BY table_name, column_name;                                                          -- 6 linhas, YES, NULL
SELECT (SELECT count(*) FROM "MovimentacaoEstoque" WHERE unidade_lancamento IS NOT NULL)
     + (SELECT count(*) FROM "AtividadeApontamentoProduto" WHERE unidade_lancamento IS NOT NULL); -- 0
```

Depois: `get_advisors` (security e performance) sem alerta novo.

## 5. Merge, deploy e smoke

1. Merge **logo depois** do §4 (nunca antes). 2. Deploy READY na Vercel. 3. Smoke (produto de teste com a unidade SACO
×25 no cadastro):
- `/api/native/movimentacoes-estoque/comandos/saida-suplementacao` sem sessão → 401.
- Mapa › cocho › Lançar: a **Unidade** aparece ao lado da quantidade; escolher **SACO**, digitar 2 → "= 50 kg"; salvar; o
  depósito baixa 50 kg; Estoque › Movimentos mostra a saída de 50 kg.
- Mapa › depósito › Saída: unidade SACO, 2 → "= 50 kg"; a origem baixa 50 kg e o destino recebe 50 kg.
- Estoque › Novo movimento › Transferência: o mesmo, com o produto de teste.
- Atividade › linha de produto: SACO, 2 → "= 50 kg", dose em kg/ha; editar só a observação mantém 50 kg.
- Produto sem conversão: nenhum seletor novo.
- Excluir os lançamentos de teste (D-PROD-273).

## 6. Rollback

As colunas são anuláveis. Reverter seria uma migration nova (`DROP COLUMN`: CONTRACT, com GO próprio), nunca editando
esta. Com o código novo no ar, reverter o código primeiro: o código antigo não lê as colunas e continua igual. O que o
código novo gravou (a unidade e o fator digitados) se perde no DROP; os movimentos, as linhas, o estoque e o custo ficam
(a quantidade sempre esteve na unidade de estoque).

## 7. Registro

| Data | Quem | O quê |
|---|---|---|
| 2026-11-25 | Claude (sessão D-PROD-310) | plano preparado; migration aplicada e testada só no PostgreSQL local (`maike_ucl`) |
| 2026-11-25 | Claude, com o GO do proprietário ("autorizo a migração" e "assim que ficar pronto pode fazer o merge") | **aplicada em produção pelo caminho B** (desvio da D-PROD-74 autorizado), numa transação só, antes do merge da PR #396: preflight 80/0, anterior `20261126100000_bem_implemento_produto` com o checksum `330d9318…efbe`, colunas ausentes; depois 81/0, a nova com `3644b7fd…f169` e 1 passo, as 6 colunas anuláveis sem DEFAULT, 112 tabelas |
