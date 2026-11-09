# MAIKE — Patrimônio P1-01: runbook de release expand-only (D-PROD-157)

> **Estado: NÃO EXECUTADO. `SCHEMA_APPLIED_PROD: NÃO`.** Nada deste runbook foi
> rodado contra o Supabase ou a Vercel. Ele só pode começar com GO escrito do
> proprietário que cite esta migration, o alvo, o caminho (A ou B) e o
> `<SHA_APROVADO>` (HEAD da PR #232 com CI verde).
>
> Valores entre `<…>` são preenchidos na hora da execução, sempre a partir de
> leituras reais.

Decisão: [D-PROD-157](./DECISIONS.md). Relatório:
[`MAIKE-PATRIMONIO-P1-01-REPORT.md`](./MAIKE-PATRIMONIO-P1-01-REPORT.md).
Modelo: [runbook da P3-02](./MAIKE-GESTAO-P3-02-RUNBOOK-RELEASE.md), executado em
2026-11-09 às 17:42:13 UTC.

## 0. O que muda no banco

| Item | Valor |
|---|---|
| Migration | `20261110100000_patrimonio_p1_01_cadastros` |
| Natureza | expand-only. **10 tabelas novas** (`FamiliaPatrimonial`, `TipoPatrimonial`, `TipoPatrimonialPerfil`, `PerfilMedicao`, `TipoCombustivel`, `TipoCombustivelProduto`, `BemPatrimonial`, `MedicaoBem`, `TanqueBem`, `TanqueBemCombustivel`), com 29 FKs (todas `ON UPDATE CASCADE ON DELETE RESTRICT`, todas com `cliente_id`), 41 CHECKs, 10 PKs, 63 índices no total e um bloco DO de REVOKE/RLS. Nenhuma coluna, índice ou constraint em tabela antiga; nenhum dado migrado; nenhum seed. |
| Tabelas antigas referenciadas (FK) | `Cliente` (10), `Empresa` (2: bem e vínculo), `Fornecedor` (2: proprietário e fornecedor do bem), `CentroCusto`, `Usuario`, `AreaPastagem` (do bem) e `Produto` (do vínculo combustível × produto) |
| SHA-256 pinado (`MIGRATIONS_APROVADAS`) | `b8818ba8f16528580b7ba6053b0c89f07f0d4fd434955f4b9c5830a62ffd64dc` |
| Hash do DO pinado (`DO_RLS_APROVADOS`) | `01dbf9ae4875444fa77082d37e1b71da655f217ecc25cc95a4d1b8a4a108a0a3` |
| SHA inválidos (não usar) | `58fa953b…` (R1) e `f421ba25…` (após a renumeração para D-PROD-157) |
| Classificador | `expand: true`; `tabelas_novas`: as 10 acima; `colunas_novas_em_tabelas_antigas: []`; 0 violações |
| `_prisma_migrations` | antes **36** concluídas (a última é `20261109200000_gestao_p3_02_rateio_por_item`, checksum `df4d1ab2…`); depois **37** |

**Por que a migration vem antes do merge:** a Vercel publica a `main` sozinha.
Sem as tabelas novas, o runtime novo responde 500 (P2021) nas rotas do
Patrimônio **e em rotas antigas** que passam a consultá-las:
`DELETE /fornecedores/:id`, `DELETE /produtos/:id` e `PATCH /produtos/:id` com
troca de fazenda. O runtime antigo (P3-02) não conhece as tabelas novas e
continua funcionando com o banco migrado.

**Runtime antigo com o banco migrado:** enquanto as tabelas novas estiverem
vazias, nada muda para ele. Se o runtime voltar ao da P3-02 **depois** de existir
bem ou vínculo de combustível (§9.2), excluir um Produto vinculado, um Parceiro
dono de bem ou uma Empresa com bens é recusado pela FK RESTRICT e o runtime
antigo traduz o `P2003` em **403 `TENANT_SCOPE_VIOLATION`**. Nada se perde, mas a
resposta engana.

> **Aviso ao suporte (janela de rollback de código):** nessa janela, um 403
> `TENANT_SCOPE_VIOLATION` ao excluir Produto, Parceiro ou Empresa **não é
> incidente de tenancy**: é a FK de um cadastro do Patrimônio. Não "corrigir"
> apagando linhas do Patrimônio no banco.

**Efeito durante a transação:** `ADD FOREIGN KEY` toma `SHARE ROW EXCLUSIVE` nas
tabelas referenciadas (`Cliente`, `Empresa`, `Fornecedor`, `CentroCusto`,
`Usuario`, `AreaPastagem`, `Produto`) até o `COMMIT`: escritas nelas esperam
segundos. O `lock_timeout` de 5 s aborta tudo, sem aplicar nada, se houver uma
transação longa no caminho.

## 1. Caminho

- **Padrão (D-PROD-74):** runner oficial `premerge-migrate.mjs --sha <SHA_APROVADO>`,
  primeiro com `--verificar-alvo` e depois com `--aplicar`, numa máquina
  protegida do operador, com `MIGRATION_DATABASE_URL` direta ou de sessão (porta
  5432, nunca o pooler 6543) e `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=7692130048193495360`.
- **Caminho B (conector Supabase, uma transação):** só com GO escrito que cite
  esta migration, este alvo e o desvio da D-PROD-74 (caminho usado na P1, P2,
  P3-01 e P3-02).

## 2. Pré-requisitos do GO

1. PR #232 aprovada pelo proprietário e CI `verify:all` verde no `<SHA_APROVADO>` (40 hex).
2. GO escrito: esta migration, este alvo, caminho A ou B, ciência da janela.
3. Backup comprovado (§4.4). Em 2026-11-09 o PITR estava **desligado** e havia
   backup físico diário.
4. Nenhuma outra migration na janela e **nenhuma escrita de teste na Preview**. A
   Preview usa o banco de produção.

## 3. Ordem

GO → preflight só leitura (§4) → ensaio local com o arquivo do SHA (§4.6) →
migration (§5) → conferência (§6) → registro (§11) → merge manual → deploy →
smoke (§8).

## 4. Preflight (somente leitura)

### 4.1 Alvo
`SELECT system_identifier FROM pg_control_system();` deve devolver
`7692130048193495360`, e o PostgreSQL deve ser o 17.x. As variáveis de banco do
projeto Vercel `maike` precisam vir da integração Supabase deste projeto
(conferir só os nomes).

### 4.2 Histórico
- Exatamente **36** linhas concluídas e nenhuma com falha; a última é
  `20261109200000_gestao_p3_02_rateio_por_item` (checksum `df4d1ab2…2076f4a0`).
- O Patrimônio está ausente; nenhuma das 10 tabelas existe.
- `conferirHistoricoRemoto` (36 linhas × arquivos do SHA) deve dar `ok: true`,
  `pendentes: [20261110100000_patrimonio_p1_01_cadastros]` e 0 falhas.
- Recontar a `main` no GO; se ela tiver ganhado migration, o número esperado
  muda pela recontagem (e o §5 também).
- Anote as contagens de `Produto`, `Fornecedor`, `Empresa`, `CentroCusto`,
  `Usuario` e `AreaPastagem`.

### 4.3 Checksum
`git show <SHA_APROVADO>:backend/prisma/migrations/20261110100000_patrimonio_p1_01_cadastros/migration.sql | sha256sum`
deve ser igual ao valor de `MIGRATIONS_APROVADAS` (`b8818ba8…ffd64dc`). O valor
gravado em `_prisma_migrations` é o calculado aqui.

### 4.4 Backup
Vale uma destas provas: a API de gestão do Supabase
(`GET /v1/projects/uuemcasqcdjucflulkne/database/backups`, com o token do
proprietário), o painel do Supabase ou um dump lógico do proprietário. Exige
último backup `COMPLETED` anterior à janela. Sem prova → `RELEASE_BLOCKED`.

### 4.5 Classificador
`node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO>` (análise local, sem
credenciais) deve sair 0, com `migrations_novas` = só o Patrimônio, `expand: true`,
10 tabelas novas, nenhuma coluna em tabela antiga e 0 violações.

### 4.6 Ensaio local imediato
Com o arquivo do SHA, num PostgreSQL local que tenha os papéis `anon`,
`authenticated` e `maike_vercel`:
- o SQL do §5 com o identificador de produção é recusado (`alvo divergente`);
- com o identificador local, ele aplica até o `COMMIT`, e `prisma migrate diff --exit-code` dá 0;
- repetir a transação é recusado (`migration já registrada`);
- o rollback do §9.1 funciona.

**Ensaio feito em 2026-11-09** (PostgreSQL 16 local descartável, papéis `anon`,
`authenticated` e `maike_vercel`, arquivo da árvore final da R2, `b8818ba8…`):
banco novo com as 37 migrations → rollback do §9.1 com o identificador local:
`COMMIT`, 36 concluídas e 0 tabelas do Patrimônio → §5 com o identificador de
produção: `RELEASE_BLOCKED: alvo divergente`, nada aplicado → §5 com o
identificador local: `COMMIT`, 37 concluídas, `checksum` `b8818ba8…`,
`applied_steps_count` 1 → repetir: `RELEASE_BLOCKED: migration já registrada` →
`prisma migrate diff --exit-code` 0 e `prisma migrate status` "up to date". A
impressão digital do §6 abaixo é a desse ensaio. **Repetir no GO** com PostgreSQL
17 e o arquivo do SHA aprovado.

## 5. Aplicação (uma transação)

### Caminho A
```bash
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --verificar-alvo
node scripts/deploy/premerge-migrate.mjs --sha <SHA_APROVADO> --aplicar
```

### Caminho B (conector, uma chamada `execute_sql`, só com GO escrito específico)

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(72707369);  -- a mesma trava do prisma migrate (D-PROD-75)
DO $guarda$
DECLARE n_ok int; n_ruim int;
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7692130048193495360 THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: alvo divergente';
  END IF;
  IF EXISTS (SELECT 1 FROM _prisma_migrations
              WHERE migration_name = '20261110100000_patrimonio_p1_01_cadastros') THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: migration já registrada';
  END IF;
  SELECT count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
         count(*) FILTER (WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL)
    INTO n_ok, n_ruim FROM _prisma_migrations;
  IF n_ok <> 36 OR n_ruim <> 0 THEN   -- 36 = recontagem do §4.2
    RAISE EXCEPTION 'RELEASE_BLOCKED: histórico com % concluídas e % com falha', n_ok, n_ruim;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations
                  WHERE migration_name = '20261109200000_gestao_p3_02_rateio_por_item'
                    AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: P3-02 ausente';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
              WHERE ns.nspname = 'public' AND c.relname IN ('FamiliaPatrimonial', 'TipoPatrimonial', 'TipoPatrimonialPerfil', 'PerfilMedicao', 'TipoCombustivel', 'TipoCombustivelProduto', 'BemPatrimonial', 'MedicaoBem', 'TanqueBem', 'TanqueBemCombustivel')) THEN
    RAISE EXCEPTION 'RELEASE_BLOCKED: tabela do Patrimônio já existe';
  END IF;
END $guarda$;

-- <<< aqui entra o conteúdo INTEGRAL de migration.sql do <SHA_APROVADO>, sem edição >>>

INSERT INTO _prisma_migrations
  (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '<SHA256_CALCULADO_NO_4.3>', now(),
        '20261110100000_patrimonio_p1_01_cadastros', NULL, NULL, now(), 1);
COMMIT;
```

- O `migration.sql` não tem `BEGIN`/`COMMIT` próprios (o único `BEGIN` é o do
  bloco `DO`) e não tem `DELETE`, `TRUNCATE`, `UPDATE` nem `INSERT` de dado. O
  único `DROP` é `DROP POLICY IF EXISTS` nas tabelas novas.
- Qualquer falha desfaz tudo. Confira com o §6 que nada ficou e peça um novo GO.

## 6. Conferência pós-aplicação (somente leitura)

| # | Conferência | Esperado |
|---|---|---|
| 1 | `_prisma_migrations` | **37** concluídas e 0 com falha; a linha do Patrimônio tem o `checksum` do §4.3 e `applied_steps_count = 1` |
| 2 | Tabelas novas em `public` | as 10; total de tabelas em `public` = 81 (com `_prisma_migrations`) |
| 3 | `pg_class` das novas | RLS ligado e **sem** FORCE nas 10 |
| 4 | Colunas por tabela | `BemPatrimonial` 54 · `FamiliaPatrimonial` 12 · `MedicaoBem` 12 · `PerfilMedicao` 13 · `TanqueBem` 9 · `TanqueBemCombustivel` 6 · `TipoCombustivel` 10 · `TipoCombustivelProduto` 10 · `TipoPatrimonial` 11 · `TipoPatrimonialPerfil` 8 |
| 5 | `pg_constraint` (p / f / c) | totais 10 / 29 / 41. Por tabela (f, c): Bem 9, 17 · Família 1, 3 · Medição 3, 4 · Perfil 1, 6 · Tanque 2, 2 · TanqueCombustível 3, 0 · TipoCombustível 1, 3 · **TipoCombustivelProduto 4, 2** · Tipo 2, 2 · TipoPerfil 3, 2. Todas as FKs `(c,r)` = `ON UPDATE CASCADE ON DELETE RESTRICT` |
| 6 | `pg_index` (pk / unique / outros) | 63 no total. Bem 1/3/9 · Família 1/3/2 · Medição 1/3/2 · Perfil 1/3/1 · Tanque 1/2/1 · TanqueCombustível 1/2/2 · TipoCombustível 1/3/1 · **TipoCombustivelProduto 1/3/4** · Tipo 1/3/2 · TipoPerfil 1/3/1 |
| 7 | `pg_policies` | 1 × `maike_backend_all`, `ALL`, `{maike_vercel}` em cada uma das 10 |
| 8 | Grants das novas | 0 para `anon`, `authenticated` e `PUBLIC`; os demais grantees iguais aos de uma tabela da P3-02 (`OperacaoFinanceiraItemRateio`) |
| 9 | Contagens | as 10 tabelas novas com 0 linhas; as contagens do §4.2 iguais |
| 10 | Advisor de segurança | nenhum alerta novo |
| 11 | Runtime no ar (ainda o da P3-02) | `GET /api/native/health` → 200; Produtos, Parceiros e Lançamentos abrem; nenhum erro novo nos logs em 30 min |

Qualquer divergência → **não fazer o merge**. Registre e avalie o §9.1.

## 7. Merge manual
Só com o §6 inteiro conferido. O merge é do proprietário. O registro do §11 entra
por commit de documentação na própria PR antes do merge, e a CI precisa ficar
verde de novo.

## 8. Deploy e smoke
- Deployment de produção do commit de merge em READY (consulta só leitura).
- **Smoke só leitura**, com a conta do proprietário: health 200; o grupo
  "Patrimônio e Frota" aparece para quem tem permissão; as 5 telas abrem vazias;
  Produtos, Parceiros e Lançamentos continuam abrindo; logs sem 500 novo em 30 min.
- **Nenhum cadastro de teste em produção** (nem o catálogo padrão): o primeiro uso
  é uso real do proprietário.

## 9. Rollback

### 9.1 Antes do merge (as 10 tabelas vazias)
Só com autorização expressa e com a PR **não** mergeada. Ordem: filhas antes das
mães (a mesma do cabeçalho da migration).

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
SELECT pg_advisory_xact_lock(72707369);
DO $guarda$
BEGIN
  IF (SELECT system_identifier FROM pg_control_system()) <> 7692130048193495360 THEN
    RAISE EXCEPTION 'alvo divergente';
  END IF;
  IF EXISTS (SELECT 1 FROM "TipoCombustivelProduto") THEN RAISE EXCEPTION 'tabela TipoCombustivelProduto com linhas: isto não é rollback de schema vazio'; END IF;
  IF EXISTS (SELECT 1 FROM "TanqueBemCombustivel") THEN RAISE EXCEPTION 'tabela TanqueBemCombustivel com linhas: isto não é rollback de schema vazio'; END IF;
  IF EXISTS (SELECT 1 FROM "TanqueBem") THEN RAISE EXCEPTION 'tabela TanqueBem com linhas: isto não é rollback de schema vazio'; END IF;
  IF EXISTS (SELECT 1 FROM "MedicaoBem") THEN RAISE EXCEPTION 'tabela MedicaoBem com linhas: isto não é rollback de schema vazio'; END IF;
  IF EXISTS (SELECT 1 FROM "BemPatrimonial") THEN RAISE EXCEPTION 'tabela BemPatrimonial com linhas: isto não é rollback de schema vazio'; END IF;
  IF EXISTS (SELECT 1 FROM "TipoPatrimonialPerfil") THEN RAISE EXCEPTION 'tabela TipoPatrimonialPerfil com linhas: isto não é rollback de schema vazio'; END IF;
  IF EXISTS (SELECT 1 FROM "TipoPatrimonial") THEN RAISE EXCEPTION 'tabela TipoPatrimonial com linhas: isto não é rollback de schema vazio'; END IF;
  IF EXISTS (SELECT 1 FROM "FamiliaPatrimonial") THEN RAISE EXCEPTION 'tabela FamiliaPatrimonial com linhas: isto não é rollback de schema vazio'; END IF;
  IF EXISTS (SELECT 1 FROM "PerfilMedicao") THEN RAISE EXCEPTION 'tabela PerfilMedicao com linhas: isto não é rollback de schema vazio'; END IF;
  IF EXISTS (SELECT 1 FROM "TipoCombustivel") THEN RAISE EXCEPTION 'tabela TipoCombustivel com linhas: isto não é rollback de schema vazio'; END IF;
  IF (SELECT count(*) FROM _prisma_migrations
       WHERE migration_name = '20261110100000_patrimonio_p1_01_cadastros') <> 1 THEN
    RAISE EXCEPTION 'registro da migration ausente ou duplicado';
  END IF;
END $guarda$;
DROP TABLE "TipoCombustivelProduto";
DROP TABLE "TanqueBemCombustivel";
DROP TABLE "TanqueBem";
DROP TABLE "MedicaoBem";
DROP TABLE "BemPatrimonial";
DROP TABLE "TipoPatrimonialPerfil";
DROP TABLE "TipoPatrimonial";
DROP TABLE "FamiliaPatrimonial";
DROP TABLE "PerfilMedicao";
DROP TABLE "TipoCombustivel";
DELETE FROM _prisma_migrations WHERE migration_name = '20261110100000_patrimonio_p1_01_cadastros';
COMMIT;
```

### 9.2 Depois do merge
- Não fazer `DROP`: podem existir cadastros reais.
- Problema de código → rollback de deployment na Vercel ou revert da PR. As
  tabelas ficam; o comportamento do runtime antigo está no §0 (falha segura, sem
  perda de dado, com 403 que engana em exclusões de Produto, Parceiro ou Empresa
  ligados ao Patrimônio).

### 9.3 Restaurar backup
Não é rollback desta release. Volta o banco inteiro, com todos os tenants. Exige
plano explícito e decisão do proprietário (ver o runbook da P3-01, §9.3).

## 10. Estados que bloqueiam (`RELEASE_BLOCKED`)
- `system_identifier` divergente;
- histórico ≠ 36/0 (ou ≠ recontagem da `main` no GO);
- Patrimônio já registrado ou alguma das 10 tabelas já existente;
- checksum diferente do manifesto (inclusive os SHA inválidos `58fa953b…` e `f421ba25…`);
- classificador com violação;
- sem prova de backup;
- CI não verde no SHA aprovado;
- sem GO escrito;
- qualquer erro na transação.

## 11. Registro de execução (preencher só quando executado)

| Campo | Valor |
|---|---|
| GO do proprietário (texto e data/hora UTC) | `<pendente>` |
| Caminho (A runner / B conector) | `<pendente>` |
| `system_identifier` e vínculo Vercel ↔ Supabase | `<pendente>` |
| Histórico antes | `<pendente>` |
| SHA-256 calculado no §4.3 | `<pendente>` |
| Evidência de backup | `<pendente>` |
| Classificador e ensaio local | `<pendente>` |
| Resultado da transação | `<pendente>` |
| Conferência do §6 | `<pendente>` |
| Merge, deployment e smoke | `<pendente>` |
