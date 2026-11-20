# MAIKE — Nova realização: runbook de release da CONTRACT aditiva `data_termino` (D-PROD-265)

> **Estado: APLICADA em produção em 2026-11-20 às 18:58:29 UTC** pelo caminho B, com o GO do proprietário ("Aplica",
> dado pelo telefone, como exceção que ele mesmo autorizou para esta migration). `SCHEMA_APPLIED_PROD: SIM`. Registro no §6.
>
> Cada passo exige o GO do proprietário e para no primeiro desvio com **`RELEASE_BLOCKED`**. Valores entre
> `<…>` são preenchidos na hora, a partir de leituras reais, nunca copiados deste texto.

Decisão: [D-PROD-265](./DECISIONS.md) · Relatório: [`MAIKE-NOVA-REALIZACAO-REPORT.md`](./MAIKE-NOVA-REALIZACAO-REPORT.md).
Precedente executado de CONTRACT aditiva: [`MAIKE-AREA-CULTURA-RUNBOOK-RELEASE.md`](./MAIKE-AREA-CULTURA-RUNBOOK-RELEASE.md) (D-PROD-216).

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261120200000_apontamento_data_termino` |
| Natureza | **CONTRACT aditiva** (entrada fechada em `MIGRATIONS_CONTRACT_APROVADAS`, decisão D-PROD-265): coluna anulável `AtividadeApontamento.data_termino` DATE, sem DEFAULT, e o CHECK `AtividadeApontamento_data_termino_check` (`data_termino IS NULL OR data_termino >= data_operacional`). Nenhuma linha muda, nenhum DROP, nenhuma tabela nova, nenhum índice. É CONTRACT só porque a allowlist EXPAND recusa DATE e CHECK em tabela antiga |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `a1f8a13c782cfc4fe3d3050749ebb0663eb943d039231db0490ce89fea90c84b` |
| Guarda pinada (`guarda_sha256`) | `5518e0acb080aab98bd066d026d328d3cec549c763de6ad86ddd3f5d1735a4b4` |
| `_prisma_migrations` | esperado **71** concluídas, 0 abertas (a última `20261120100000_estoque_saidas`, D-PROD-264, checksum `3cc70cddeb743261344ea1641f2e81e6294ed31d077fbef812f55444888114e0`); depois **72**. Recontar no §2 |
| Tabelas em `public` | **105** antes e depois (recontar no §2) |
| Dados | nenhum passo de dados: a coluna nasce vazia em todas as linhas |

**Por que antes do merge (D-PROD-72 item 1):** o runtime novo lê `AtividadeApontamento.data_termino` em toda
leitura do apontamento (lista, detalhe, histórico da área, registro de campo): sem a migration, essas rotas
respondem 500. O runtime antigo não conhece a coluna e segue igual com o banco migrado (coluna anulável; o que
ele grava fica sem término e passa no CHECK) — **não há janela**.

**Efeito durante a transação:** `AtividadeApontamento` fica em ACCESS EXCLUSIVE (a guarda trava até o COMMIT;
o ADD COLUMN anulável sem DEFAULT é só catálogo; o ADD CONSTRAINT CHECK lê a tabela uma vez, com a coluna nula
em todas as linhas). Milissegundos no volume atual; espera além do `lock_timeout` de 5 s aborta tudo sem
aplicar nada.

## 1. Caminhos

- **A — runner oficial (padrão, D-PROD-74):** numa máquina protegida, com `MIGRATION_DATABASE_URL`
  (sessão/direta, nunca o pooler 6543), `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER` do projeto e `DATABASE_URL` do
  mesmo banco:
  ```bash
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --contract D-PROD-265
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --contract D-PROD-265 --verificar-alvo
  node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --contract D-PROD-265 --aplicar
  ```
- **B — conector Supabase, uma única `execute_sql`:** só com autorização **escrita e específica do
  proprietário para esta migration**, registrada como desvio da D-PROD-74: o conteúdo exato do `migration.sql`
  e, na MESMA transação, a linha em `_prisma_migrations` com o checksum do §0 (como nos precedentes do caminho B).

## 2. Preflight — somente leitura

```sql
SELECT system_identifier FROM pg_control_system();            -- o do projeto
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ok,
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL) AS ruim
  FROM _prisma_migrations;                                     -- 71, 0
SELECT migration_name, checksum FROM _prisma_migrations
 WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
 ORDER BY finished_at DESC LIMIT 1;                            -- 20261120100000_estoque_saidas, 3cc70cdd…
SELECT count(*) FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'AtividadeApontamento' AND column_name = 'data_termino';  -- 0
SELECT count(*) FROM pg_constraint
 WHERE conrelid = 'public."AtividadeApontamento"'::regclass AND conname = 'AtividadeApontamento_data_termino_check';  -- 0
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 105
SELECT count(*) FROM "AtividadeApontamento";                   -- <N> (anotar)
```

Qualquer valor diferente → `RELEASE_BLOCKED` (ajustar o plano antes de pedir o GO).

## 3. Postcheck — somente leitura

```sql
SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
       count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
  FROM _prisma_migrations;                                     -- 72, 0
SELECT checksum FROM _prisma_migrations WHERE migration_name = '20261120200000_apontamento_data_termino';  -- a1f8a13c…
SELECT data_type, is_nullable, column_default FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'AtividadeApontamento' AND column_name = 'data_termino';   -- date, YES, null
SELECT pg_get_constraintdef(oid) FROM pg_constraint
 WHERE conrelid = 'public."AtividadeApontamento"'::regclass AND conname = 'AtividadeApontamento_data_termino_check';
 -- CHECK (((data_termino IS NULL) OR (data_termino >= data_operacional)))
SELECT count(*) FROM "AtividadeApontamento" WHERE data_termino IS NOT NULL;  -- 0
SELECT count(*) FROM pg_tables WHERE schemaname = 'public';    -- 105
```

Depois: advisors de segurança e desempenho sem alerta novo; merge da PR; no ar, abrir a "Nova realização" e
registrar um serviço com Data de término numa fazenda de teste.

## 4. Reversão operacional (não executada)

```sql
ALTER TABLE "AtividadeApontamento" DROP CONSTRAINT "AtividadeApontamento_data_termino_check";
ALTER TABLE "AtividadeApontamento" DROP COLUMN "data_termino";
```

Só com o runtime anterior no ar (o novo lê a coluna) e com o GO do proprietário; o término gravado se perde.

## 5. Ordem com outras releases

Nenhuma outra migration pendente na `main` em 2026-11-20: esta é a 72ª pasta e a única pendente. Se outra
CONTRACT entrar na `main` antes desta, o runner recusa as duas juntas (nunca duas CONTRACT de uma vez): aplicar
uma de cada vez, cada uma com a própria decisão.

## 6. Registro

| Data | Quem | O quê |
|---|---|---|
| 2026-11-20 | Claude (sessão D-PROD-265) | plano preparado; migration testada só no Postgres local; **nada aplicado em produção** |
| 2026-11-20 18:58:29 UTC | Claude, com o GO do proprietário ("Aplica", pelo telefone, exceção autorizada por ele para esta migration; desvio da D-PROD-74 pelo caminho B) | **preflight** PRONTO: `system_identifier` do projeto, 71 / 0, a última `20261120100000_estoque_saidas` com o checksum `3cc70cdd…14e0`, coluna e CHECK ausentes, 105 tabelas, 1 apontamento. **Aplicação:** uma transação via `execute_sql` (guarda externa do caminho B + `migration.sql` integral + registro em `_prisma_migrations`). **Postcheck:** 72 / 0; checksum `a1f8a13c…c84b`; `data_termino` date anulável sem DEFAULT; CHECK `((data_termino IS NULL) OR (data_termino >= data_operacional))`; 0 apontamentos com término; 1 apontamento; 105 tabelas. Advisors não conferidos nesta janela |
