# PR #174 — Runbook de release e cutover do rebanho (R6)

> Substitui a "ordem segura" da R5, que mandava fazer reset/cutover **antes** do merge. Essa ordem estava errada: enquanto o backend antigo (a main publicada) atende requisições, ele grava saldo em `Lote` e ignora a ativação, e isso gera drift. Decisão registrada na D-PROD-107 (complemento R6).

## Onde roda cada coisa

| Peça | Onde | Quem configura |
|---|---|---|
| Backend (Fastify serverless, `api/fastify.js`) | Vercel, projeto `maike` (production / preview) | Proprietário, no painel da Vercel |
| PostgreSQL | Serviço externo (não é a Vercel) | Proprietário |
| `DATABASE_URL` de runtime | Variáveis de ambiente da Vercel (production) | Proprietário |
| `MIGRATION_DATABASE_URL` (sessão/direta, **não** o pooler 6543) e `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER` | **Só** no ambiente do runner/máquina do operador (pré-merge) ou nos secrets do environment `production` do GitHub (pós-merge). Os secrets da Vercel **não** passam para o GitHub Actions. | Proprietário |
| `CUTOVER_DATABASE_URL` e `CUTOVER_EXPECTED_SYSTEM_IDENTIFIER` | Só no ambiente do operador, durante o cutover | Proprietário |

Nenhum valor secreto é pedido, impresso, versionado ou gravado em log/artefato.

## Por que o `release-migrate.yml` não serve antes do merge

O GitHub só deixa disparar `workflow_dispatch` (pela UI ou pela API) para um workflow que **já está na branch padrão**. Como `.github/workflows/release-migrate.yml` ainda não existe na `main`, ele não pode ser o caminho pré-merge. Ele continua na PR para uso **depois** do merge, em releases futuras.

O caminho pré-merge é `scripts/deploy/premerge-migrate.mjs`, que roda num runner ou máquina protegida do operador.

## Fases (cada uma só começa quando a anterior estiver comprovada)

1. **Auditoria (somente leitura)**
   - Rodar `node scripts/ops/cutover-rebanho.mjs --cliente-id … --empresa-id …`, sem `--executar`, para cada empresa.
   - Registrar a estratégia de cada uma: `entradas`, `reset_e_entradas` ou `saldo_abertura`.
   - Registrar também os vínculos pendentes.
2. **Backup**
   - Fazer um backup completo restaurável do banco no provedor do PostgreSQL (snapshot/PITR), antes de qualquer migration.
   - O backup operacional por empresa é gravado automaticamente pelo cutover. Ele fica **fora** do repositório, com modo 0600, é exclusivo e é relido e conferido pelo manifesto sha256.
3. **Migrations EXPAND, antes do merge** (código antigo continua no ar)
   - Fazer checkout exato do SHA aprovado da PR:
     ```bash
     git fetch origin main <branch> && git checkout <SHA>
     ```
   - Conferir o plano (dry-run): `node scripts/deploy/premerge-migrate.mjs --sha <SHA>`. Precisa sair `expand: true` e `PLANO OK`.
   - Aplicar: com as duas variáveis `MIGRATION_*` no ambiente, rodar `node scripts/deploy/premerge-migrate.mjs --sha <SHA> --aplicar`. Isso executa `npm run deploy:migrate`, que confere o system_identifier e recusa o pooler.
   - Por que é seguro: as migrations da PR são EXPAND **comprovado** (`premergeMigrateLib.classificarMigrations`, teste `scripts/tests/deploy/premerge-migrate.test.mjs`).
     - Só criam tabelas novas.
     - Os DROPs são de constraints e policies dessas tabelas novas.
     - Em tabela existente, apenas `LancamentoTarefa.posicao_id`, anulável, com FK.
   - O backend antigo funciona com o banco migrado.
4. **Merge manual pelo proprietário → deploy automático da Vercel**
   - Conferir que o deployment de production está `READY` no SHA do merge.
   - Conferir `GET https://<produção>/api/native/health` → `release` = SHA do merge, `capacidades` contém `rebanho-ledger-cutover-r6` e `status: ok`.
   - O backend antigo não expõe essa capacidade. Vercel serverless troca o roteamento de uma vez; as requisições antigas em voo terminam dentro do `maxDuration` da função.
5. **Janela de manutenção dos manejos (barreira real)**
   - A partir do deploy, toda empresa ainda não migrada recebe **409 `REBANHO_CUTOVER_PENDENTE`** em todo comando do mapa, sem gravar nada.
   - O modo legado de escrita em `Lote` não existe mais no código novo, e é isso que bloqueia: não depende de nenhuma feature ausente na main.
   - Indisponibilidade **gerenciada e visível**: leitura, cadastro, login e o restante do sistema seguem funcionando. Avise os usuários antes.
   - Cadastro/PATCH de `Lote` concorrente com o cutover espera as travas e é recontado; provado pelo teste A6.
6. **Cutover atômico por empresa** (uma empresa de laboratório primeiro, depois as demais)
   - Rodar `node scripts/ops/cutover-rebanho.mjs … --executar --estrategia <e> --confirmar-empresa "<nome>" --usuario-admin-id <id> --backup /fora/do/repo/<arquivo>.json --backend-url https://<produção> --release-sha <SHA do merge>`.
   - O CLI **recusa** se:
     - o health de produção não provar o backend novo nesse SHA;
     - o SHA não estiver na `origin/main`.
   - Reset e ativação acontecem em **um único COMMIT**. Qualquer falha gera ROLLBACK total, e o backup que sobrar é cópia do pré-estado.
   - Rodar de novo numa empresa já ativada é no-op (`JA_ATIVA`).
   - Depois de cada empresa, validar:
     - `GET /rebanho/verificacao?empresa_id=…` (`integro: true`);
     - posições/saldos contra o cadastro;
     - histórico;
     - login de um usuário.
7. **Encerrar a janela** quando todas as empresas prioritárias estiverem ativas e validadas.

## Rollback

| Situação | Ação |
|---|---|
| Migration falhou | O runner oficial para. Corrigir e reaplicar; as migrations são idempotentes por `_prisma_migrations`. O código antigo continua no ar. |
| Deploy novo com problema antes de qualquer cutover | Rollback de deployment na Vercel para o anterior. O banco migrado (EXPAND) atende o código antigo. |
| Problema depois de cutover de uma empresa | **Não** voltar para o código antigo com empresa ativada, porque o antigo ignoraria o ledger. Corrigir para frente. Para desfazer o cutover de uma empresa, restaurar o backup do provedor (fase 2). |

## Estados que bloqueiam (fail-closed)

- `premerge-migrate`: SHA divergente, árvore suja, migration existente alterada ou migration não-EXPAND → exit 3.
- `cutover-rebanho`: alvo divergente (system_identifier), backend antigo ou em outro SHA, SHA fora da main, backup ausente, não conferido ou dentro do repo, vínculos pendentes, confirmação, administrador ou estratégia inválidos → nada alterado.
- Sem credenciais neste ambiente: **REMOTE_MIGRATION_BLOCKED / REMOTE_CUTOVER_BLOCKED**. Nada remoto foi executado na R6.
