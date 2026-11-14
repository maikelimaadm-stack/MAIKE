# MAIKE — Categoria de Manejo com Curva de Ganho: runbook de release CONTRACT (D-PROD-195)

> **Estado: NÃO EXECUTADO. `SCHEMA_APPLIED_PROD: NÃO`.**
>
> Este documento é o plano. Cada passo exige o GO do proprietário e para no
> primeiro desvio com **`RELEASE_BLOCKED`**. Valores entre `<…>` são preenchidos
> na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-195](./DECISIONS.md) · Relatório:
[`MAIKE-CADCATEGORIA-CURVA-GANHO-REPORT.md`](./MAIKE-CADCATEGORIA-CURVA-GANHO-REPORT.md).
Precedente executado: [`MAIKE-CADCURVAGANHO-MENSAL-RUNBOOK-RELEASE.md`](./MAIKE-CADCURVAGANHO-MENSAL-RUNBOOK-RELEASE.md) §7
(CONTRACT, caminho B). Molde: [`MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md`](./MAIKE-GESTAO-P3-01-RUNBOOK-RELEASE.md)
(§1 explica por que nunca `apply_migration` e nunca DDL solto).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261114200000_cadcategoria_curva_ganho` |
| Natureza | **CONTRACT** (quinta exceção fechada): `CADCATEGORIA` ganha `curva_ganho_id VARCHAR(64) NOT NULL`, ligada à `'CURVA PADRÃO'` da fazenda nas categorias que já existem; `CADCURVAGANHO` ganha o `UNIQUE (cliente_id, empresa_id, id)`; FK composta `CADCATEGORIA_cliente_id_empresa_id_curva_ganho_id_fkey` (`ON DELETE RESTRICT`) e índice `CADCATEGORIA_cliente_id_empresa_id_curva_ganho_id_idx`. Nenhuma tabela criada nem apagada |
| Guarda da própria migration | recusa (e desfaz tudo) se as tabelas não existirem, se a coluna já existir ou se alguma fazenda com categoria não tiver **exatamente uma** curva `'CURVA PADRÃO'` |
| Pré-requisito de dado | a `'CURVA PADRÃO'` já cadastrada em cada fazenda com categoria (em produção: 1 fazenda, curva `cc80b49b6d15531f23a6ab11c`, cadastrada em 2026-11-14 13:40:36 UTC — §7) |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `b509ee754722f5e9f70938f2c17ddbe253734c7c86e0aecb55498a37d44e68fb` |
| Guarda pinada (`MIGRATIONS_CONTRACT_APROVADAS`) | `292d2446635c3178f10af0d24c33df0d92513f3725efb1ed2059ccc713cb63a8`; 5 `alter_antigas`; literais `CADCATEGORIA`, `CADCURVAGANHO` |
| `_prisma_migrations` | em 2026-11-14 13:40 UTC: **49** concluídas, 0 abertas (a última `20261114100000_cadcurvaganho_mensal`); depois **50**. Recontar no §2 |
| Tabelas em `public` | **85** antes e depois |

**Janela entre a aplicação e o deploy.** O runtime antigo não conhece
`curva_ganho_id`: ler, editar e excluir categoria seguem normais, mas **criar
categoria** (tela de categorias e cadastro rápido do lote) falha pelo `NOT NULL`
até a `main` nova ficar READY. Por isso o merge vem **logo depois** do §4.

**Por que antes do merge (D-PROD-72 item 1):** o código novo sem a coluna daria
500 em todas as rotas `/categorias-manejo` (o `select` lê `curva_ganho_id`).

**Efeito durante a transação (travas):** `ACCESS EXCLUSIVE` em `CADCATEGORIA`
(coluna, `UPDATE`, `NOT NULL`) e `SHARE` em `CADCURVAGANHO` até o `COMMIT`; a FK
pega `SHARE ROW EXCLUSIVE` nas duas. **Não** toca `Cliente` nem `Empresa`. As duas
tabelas são pequenas (10 categorias, 1 curva): menos de 1 s. Uma espera além do
`lock_timeout` de 5 s aborta tudo sem aplicar nada.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** numa máquina protegida, com
  `MIGRATION_DATABASE_URL` (sessão/direta, nunca o pooler 6543),
  `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360` e `DATABASE_URL` do
  mesmo banco. Release isolada (esta é a única migration nova):
  ```bash
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>                                  # análise local: CONTRACT D-PROD-195
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo --contract D-PROD-195
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar --contract D-PROD-195   # repassa MIGRATION_CONTRACT_AUTORIZADO=D-PROD-195
  ```
- **B — conector Supabase, uma única `execute_sql` (§3):** só com autorização
  **escrita e específica do proprietário para esta migration**, registrada como
  desvio da D-PROD-74.

## 2. Preflight — somente leitura (projeto `uuemcasqcdjucflulkne`)

```sql
SELECT system_identifier FROM pg_control_system();            -- 7692130048193495360
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok,
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS ruim
  FROM _prisma_migrations;                                     -- <N_OK>, 0
SELECT c.cliente_id, c.empresa_id, count(*) AS categorias,
       (SELECT count(*) FROM "CADCURVAGANHO" k
         WHERE k.cliente_id = c.cliente_id AND k.empresa_id = c.empresa_id AND k.nome = 'CURVA PADRÃO') AS padroes
  FROM "CADCATEGORIA" c GROUP BY 1, 2;                         -- padroes = 1 em TODAS as linhas
SELECT count(*) FROM information_schema.columns
 WHERE table_name = 'CADCATEGORIA' AND column_name = 'curva_ganho_id';  -- 0
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 85
```

E, localmente, no `<SHA_APROVADO>`: `sha256sum` do `migration.sql` igual ao
pinado, e `classificarMigrations` com `modo: CONTRACT`, `contract[0].decisao =
"D-PROD-195"` e `violacoes: []`.

## 3. Caminho B — uma transação

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(72707369);
DO $guarda$
DECLARE n_ok int; n_ruim int;
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7692130048193495360 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: alvo divergente';
  END IF;
  IF EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261114200000_cadcategoria_curva_ganho') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> <N_OK> OR n_ruim <> 0 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, 'b509ee754722f5e9f70938f2c17ddbe253734c7c86e0aecb55498a37d44e68fb', now(),
        '20261114200000_cadcategoria_curva_ganho', NULL, NULL, now(), 1);
COMMIT;
```

Qualquer falha desfaz tudo. Confirme pelo §4 que a coluna não existe e que não há
linha nova, corrija a causa e peça novo GO.

## 4. Conferência — somente leitura

```sql
SELECT migration_name, checksum, rolled_back_at, applied_steps_count FROM _prisma_migrations
 WHERE migration_name = '20261114200000_cadcategoria_curva_ganho';  -- 1 linha, checksum pinado, null, 1
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) FROM _prisma_migrations;  -- <N_OK> + 1
SELECT is_nullable FROM information_schema.columns
 WHERE table_name = 'CADCATEGORIA' AND column_name = 'curva_ganho_id';  -- NO
SELECT count(*), count(*) FILTER (WHERE c.curva_ganho_id = k.id AND k.nome = 'CURVA PADRÃO')
  FROM "CADCATEGORIA" c JOIN "CADCURVAGANHO" k
    ON k.cliente_id = c.cliente_id AND k.empresa_id = c.empresa_id AND k.id = c.curva_ganho_id;  -- iguais ao total de categorias
SELECT conname FROM pg_constraint WHERE conrelid = 'public."CADCATEGORIA"'::regclass ORDER BY 1;
  -- inclui CADCATEGORIA_cliente_id_empresa_id_curva_ganho_id_fkey
SELECT indexname FROM pg_indexes WHERE tablename IN ('CADCATEGORIA', 'CADCURVAGANHO') ORDER BY 1;
  -- inclui CADCATEGORIA_cliente_id_empresa_id_curva_ganho_id_idx e CADCURVAGANHO_cliente_id_empresa_id_id_key
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 85
```

Mais: `get_advisors` (segurança) sem alerta novo.

## 5. Merge, deploy e smoke

1. Merge **logo depois** do §4. 2. Deploy READY na Vercel: `/api/native/health`
com o `release` da `main` nova. 3. Smoke: `/api/native/categorias-manejo` e
`/api/native/categorias-manejo-opcoes/curvas-ganho` sem sessão → 401; na tela
Manejo → Categorias de Manejo, a coluna "Curva de ganho" mostra CURVA PADRÃO nas
categorias existentes.

## 6. Rollback

Não há reversão automática. Desfazer seria uma migration nova (DROP da FK, do
índice, do `UNIQUE` e da coluna), com GO próprio, nunca editando esta. Com o código
novo no ar, reverter o código primeiro.

## 7. Registro de execução

**Dado prévio (2026-11-14 13:40:36 UTC, conector Supabase, uma transação):** a
pedido do proprietário ("cadastre uma curva chamada curva padrão, todos com 0,100
nos mês e você já cadastre nas categorias também, isso tudo via banco ok"), a curva
`'CURVA PADRÃO'` (0,100 kg/dia nos 12 meses, ativa) foi inserida em
`"CADCURVAGANHO"` na única fazenda com categorias (`empresa_id`
`cmw13bo4a0003l508adj0rdw2`, 10 categorias), id `cc80b49b6d15531f23a6ab11c`. A
transação tinha guarda: exatamente uma fazenda com categorias e nenhuma CURVA
PADRÃO nela. Escrita direta, sem auditoria da aplicação. A ligação das categorias
fica com a migration (passos acima).

_(aplicação da migration: vazio — preencher com data/hora UTC, caminho usado, GO citado, resultado do §4.)_
