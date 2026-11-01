# Release — Exclusão do Cadastro de Lotes após cancelamento (PR #167, D-PROD-100)

> **Estado: `MIGRATION_APLICADA` (2026-11-01).** A migration
> `20261101100000_lote_exclusao_logica` foi aplicada e conferida no banco de
> runtime com autorização do proprietário (passos 4 a 6). Evidência:
> `evidencias/lotes-r1-exclusao/r2-fechamento-delete-offline/migracao-producao.txt`.
> Merge liberado pelo proprietário; em seguida vem o smoke pós-deploy (passo 8).

Este runbook é a ordem obrigatória. Quem executa é um operador autorizado pelo
proprietário. Esta PR e o agente que a escreveu **não acessam produção** e não
automatizam nenhuma mutação nela.

## O que muda no banco

```sql
ALTER TABLE "Lote" ADD COLUMN "excluido_em" TIMESTAMP(3),
ADD COLUMN "excluido_por_usuario_id" VARCHAR(64);
```

- **Expand-only:** duas colunas NULL, sem default, sem backfill e sem índice. Lote existente continua igual.
- **Código antigo sobre banco migrado:** funciona. Prova local: suíte de lotes da `main` 60667be sobre banco migrado, 53/53.
- **Código novo sobre banco sem a migration:** quebra (P2022). Prova local em `evidencias/lotes-r1-exclusao/r1-cache-release/migration-preflight-local.txt`.
- **Conclusão:** a migration vem ANTES do merge, nunca depois.

## Mecanismo de release real (o que está versionado)

- `vercel.json` → `buildCommand: npm run prisma:generate && npm run build`. **Não migra.**
- `.github/workflows/` só tem `quality.yml`, que é CI contra o banco efêmero do job. **Nenhum pipeline versionado aplica a migration no banco real.**
- Migration de produção = `npm run deploy:migrate` (D-PROD-28):
  - usa `MIGRATION_DATABASE_URL`, sem fallback para `DATABASE_URL`;
  - recusa o pooler de transação;
  - nunca roda no startup.
- **Limitação reconhecida:** se o ambiente tiver outro mecanismo fora do repositório (painel, script local), ele não pode ser verificado daqui. O operador confirma no passo 3.

## Ordem inegociável

### 1. Congelar

- Nenhum merge ou deploy na `main` que dependa deste schema até o passo 7.
- Confirmar:
  - o **HEAD final** da PR #167, igual ao SHA com CI `quality / verify:all` verde;
  - que `backend/prisma/migrations/20261101100000_lote_exclusao_logica/migration.sql` é idêntica à revisada.

### 2. Backup e rollback planejados

- Snapshot ou backup do banco real **antes** de migrar, pelo mecanismo do provedor. Anotar o identificador do snapshot.
- Rollback **da aplicação**: reverter o deploy para o anterior (painel do Vercel) ou reverter o merge. Esse é o rollback normal. **As colunas ficam**: são expand-only, e o código antigo convive com elas.
- Rollback **do schema** só em último caso, e só se nenhum lote tiver sido excluído logicamente:
  ```sql
  SELECT count(*) FROM "Lote" WHERE "excluido_em" IS NOT NULL;  -- precisa ser 0
  ALTER TABLE "Lote" DROP COLUMN "excluido_em", DROP COLUMN "excluido_por_usuario_id";
  ```
  Com lotes já excluídos, **não** derrubar as colunas: isso reativaria lotes que saíram do Cadastro.

### 3. Identificar o banco alvo, com acesso autorizado

- Confirmar com o proprietário qual é o banco de runtime da `main` e quem está autorizado.
- Na sessão que vai migrar, conferir **só com leitura** que runtime e migration apontam para o mesmo cluster esperado:
  ```bash
  MIGRATION_EXPECTED_SYSTEM_IDENTIFIER=<id-do-cluster> node scripts/deploy/conferir-alvo-banco.mjs
  ```
- Precisa responder `ALVO CONFERE` (exit 0). Exit 1 → **pare**.

### 4. Migrar — SOMENTE com aprovação explícita do proprietário, ANTES do merge

- A aprovação é **separada** da aprovação do merge.
- Comando:
  ```bash
  MIGRATION_DATABASE_URL=<conexão direta, não pooler> npm run deploy:migrate
  ```
- Não usar `prisma migrate dev`, `db push` nem SQL manual.

### 5. Verificar com SELECT (no MESMO banco do runtime)

```sql
SELECT migration_name, finished_at IS NOT NULL AS concluida, rolled_back_at IS NOT NULL AS revertida
  FROM "_prisma_migrations" WHERE migration_name = '20261101100000_lote_exclusao_logica';
-- esperado: 1 linha, concluida = true, revertida = false

SELECT column_name, is_nullable FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'Lote'
   AND column_name IN ('excluido_em', 'excluido_por_usuario_id');
-- esperado: as DUAS colunas, is_nullable = YES
```

### 6. Preflight só leitura no banco de destino

```bash
DATABASE_URL=<conexão de runtime> node scripts/deploy/preflight-schema.mjs
```

- Precisa terminar em `PREFLIGHT OK` (exit 0).
- Ele exige as duas colunas e nenhuma migration pendente. Prova local: `pre` dá exit 1 e `pos` dá exit 0.
- Preview do Vercel **não** é evidência de schema real.

### 7. Só então: merge manual

- O proprietário faz o merge da #167. O deploy automático da `main` sai em seguida.

### 8. Smoke pós-deploy (sem dado real alterado sem necessidade)

| Item | O que verificar |
|---|---|
| Saúde | `/health` ok **e** uma chamada autenticada real a `GET /lotes` responde 200. `/health` sozinho não prova schema |
| Cadastro | lista carrega; em um lote de teste combinado com o proprietário, "Excluir" mostra a elegibilidade certa (bloqueado com motivo / confirmação lógica / física) |
| Histórico | histórico da área abre; movimentos cancelados aparecem com motivo e autor |
| Mapa | mapa e totais carregam |
| Offline | com o app aberto, ficar offline e reabrir o Cadastro: um lote excluído não reaparece; voltar online normaliza |

- Falha no smoke → rollback **da aplicação** (passo 2), sem derrubar colunas.

## Passos do proprietário, em resumo

1. Auditar a PR #167 no HEAD final com CI verde.
2. **Aprovar a migration** (decisão 1) e designar o operador e o banco alvo.
3. Operador: backup → conferir alvo → `deploy:migrate` → SELECTs → preflight OK.
4. **Aprovar o merge** (decisão 2), só depois do passo 3.
5. Smoke pós-deploy. Se algo falhar, rollback da aplicação.
