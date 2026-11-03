# PR #174 — Runbook de release e cutover do rebanho (R6)

> Revisado na R7: inventário antes do schema, allowlist EXPAND fechada com verificação do alvo e identidade de produção comprovada.
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

## Fases (cada uma só começa quando a anterior estiver comprovada) — revisão R7

1. **Inventário somente leitura, antes de qualquer migration**
   - Rodar `node scripts/ops/cutover-rebanho.mjs --cliente-id <id> --inventario` (com `CUTOVER_DATABASE_URL` / `CUTOVER_EXPECTED_SYSTEM_IDENTIFIER` só no ambiente do operador).
   - Lê só `information_schema` + `Empresa`/`Lote`/`MovimentacaoMapa`. Sem o schema R2E, responde `CUTOVER_SCHEMA_PENDENTE` com os objetos ausentes. Nunca toca tabela R2E, nunca escreve.
   - O diagnóstico detalhado por empresa (sem `--inventario`) **exige** o schema R2E; antes das migrations, ele sai com exit 3 e `CUTOVER_SCHEMA_PENDENTE`.
2. **Backup restaurável do provedor do PostgreSQL**
   - Snapshot ou PITR, com teste de restauração num ambiente separado, **antes** do premerge.
   - O backup JSON operacional do cutover **não substitui** esse backup: ele só cobre as linhas operacionais de uma empresa.
3. **Migrations EXPAND, antes do merge, em máquina protegida**
   1. Preparar o checkout exato do SHA aprovado:
      ```bash
      git fetch origin main <branch>
      ```
      ```bash
      git checkout <SHA>
      ```
   2. `node scripts/deploy/premerge-migrate.mjs --sha <SHA>` — **análise local**, que só confere arquivos.
      - Conferências: HEAD = SHA; árvore limpa; `origin/main` igual à main remota (`ls-remote`); nenhuma migration da main alterada.
      - As migrations novas têm de ser exatamente as do manifesto pinado (SHA-256), dentro da allowlist estrutural fechada.
      - A saída declara **"alvo remoto NÃO verificado"**. Isso não autoriza aplicar.
   3. Com `MIGRATION_DATABASE_URL` (conexão de sessão/direta, não o pooler 6543) e `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER` só no ambiente do operador, rodar `node scripts/deploy/premerge-migrate.mjs --sha <SHA> --verificar-alvo`.
      - Somente leitura: `system_identifier` e `_prisma_migrations` × arquivos locais.
      - Recusa com `PREMERGE_MIGRATIONS_NAO_COMPROVADAS` se houver migration extra, checksum divergente, aplicação parcial ou pendência fora do manifesto.
   4. `node scripts/deploy/premerge-migrate.mjs --sha <SHA> --aplicar` — refaz tudo acima e só então chama `npm run deploy:migrate`. É o runner oficial, que confere de novo o alvo e recusa o pooler.
4. **Diagnóstico real por empresa**, agora com o schema pronto: estratégia e vínculos de cada empresa. É informativo: o cutover **revalida** estado, vínculos, confirmação e administrador dentro da própria transação.
5. **Merge manual pelo proprietário → deploy automático da Vercel**
   - Conferir que o deployment de produção está `READY` no SHA do merge (merge commit, squash ou fast-forward: vale o SHA **publicado**, que precisa ser o HEAD atual da main remota).
6. **Janela de manutenção dos manejos**: empresas não migradas recebem 409 `REBANHO_CUTOVER_PENDENTE`. Leitura, cadastro e login seguem funcionando. Avise os usuários.
7. **Cutover atômico por empresa** (laboratório primeiro):
   ```bash
   MAIKE_PRODUCAO_ORIGIN=https://<domínio de produção do projeto maike na Vercel> \
   node scripts/ops/cutover-rebanho.mjs --cliente-id … --empresa-id … --executar --estrategia <e> \
     --confirmar-empresa "<nome>" --usuario-admin-id <id> --backup /fora/do/repo/<arquivo>.json \
     --backend-url "$MAIKE_PRODUCAO_ORIGIN" --release-sha <SHA publicado>
   ```
   - Antes de abrir conexão com o banco, o CLI exige `--backend-url` **igual** ao origin configurado. São recusados:
     - preview (`*-git-*`, `*.vercel.app` diferente do configurado);
     - host arbitrário;
     - caminho ou query na URL;
     - http, localhost ou credenciais na URL.
   - Exige também `release-sha` = HEAD da main **remota**.
   - O health de produção é lido **sem seguir redirect**. Ele precisa mostrar:
     - `implantacao.ambiente = production`;
     - `repositorio = maikelimaadm-stack/MAIKE`;
     - `dominio_producao` = host configurado;
     - `release` = SHA;
     - a capacidade `rebanho-ledger-cutover-r6`;
     - `status: ok`.
   - Reset e ativação acontecem em **um único COMMIT**. Falha gera ROLLBACK total. Rodar de novo é no-op (`JA_ATIVA`).
   - Validar: `/rebanho/verificacao` íntegro, saldos, histórico e login.
8. **Encerrar a janela** quando todas as empresas prioritárias estiverem ativas e validadas.

### Onde configurar `MAIKE_PRODUCAO_ORIGIN`
Valor **não-secreto**: o domínio de produção do projeto `maike` (Vercel → Project → Settings → Domains). Ele fica só no ambiente do operador e é conferido contra `VERCEL_PROJECT_PRODUCTION_URL`, exposto pelo próprio health.

## Rollback

| Situação | Ação |
|---|---|
| Migration falhou | O runner oficial para. Corrigir e reaplicar; as migrations são idempotentes por `_prisma_migrations`. O código antigo continua no ar. |
| Deploy novo com problema antes de qualquer cutover | Rollback de deployment na Vercel para o anterior. O banco migrado (EXPAND) atende o código antigo. |
| Problema depois de cutover de uma empresa | **Não** voltar para o código antigo com empresa ativada, porque o antigo ignoraria o ledger e gravaria saldo em `Lote`. Corrigir para frente. |
| Restaurar o backup do provedor (snapshot/PITR) | **Não é rollback inocente.** Volta o **banco inteiro** no tempo: todos os tenants e todas as escritas após o ponto, inclusive as de usuários legítimos. Exige plano explícito (janela, comunicação, reconciliação do que foi lançado depois) e decisão do proprietário. O JSON operacional do cutover só serve para conferência ou reconstrução manual de uma empresa. |

## Estados que bloqueiam (fail-closed)

- `premerge-migrate`: SHA divergente, árvore suja, migration existente alterada ou migration não-EXPAND → exit 3.
- `cutover-rebanho`: alvo divergente (system_identifier), backend antigo ou em outro SHA, SHA fora da main, backup ausente, não conferido ou dentro do repo, vínculos pendentes, confirmação, administrador ou estratégia inválidos → nada alterado.
- Sem credenciais neste ambiente: **REMOTE_MIGRATION_BLOCKED / REMOTE_CUTOVER_BLOCKED**. Nada remoto foi executado na R6.
