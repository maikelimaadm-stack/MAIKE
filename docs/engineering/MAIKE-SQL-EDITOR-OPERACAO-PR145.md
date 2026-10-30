# MAIKE — inicializar a produção pelo painel do Supabase (PR #145, G4-R2)

**Decisão:** D-PROD-74 · **Para:** o proprietário do MAIKE · **Evidência:** `evidencias/catalogo-icones-lotes-01/rollout-sql-editor/`

**O que está autorizado:**

- as 7 migrations pendentes;
- apagar **definitivamente** os dados de TESTE;
- criar o cliente técnico `maike` e a conta `maike` (Maike) como **administrador da fazenda**.

**O que NÃO está:**

- merge e deploy;
- Vercel, preview, variáveis e segredos;
- Storage e bucket;
- ícones;
- o proprietário do produto (MAIKE Admin).

Nunca cole conexão, senha ou chave no chat.

## A ordem (não pule etapas)

| # | O quê | Onde | Resultado esperado |
|---|---|---|---|
| 1 | `01-precheck-somente-leitura.sql` | SQL Editor | VEREDITO `MIGRAR PRIMEIRO` (18/25) |
| 2 | As 7 migrations, **pelo runner oficial** (`npm run deploy:migrate`) | Ver "Como aplicar as 7 migrations" | 7 × `Applying migration`; na segunda vez, `No pending migrations` |
| 3 | `01-precheck-somente-leitura.sql` de novo | SQL Editor | VEREDITO `PRONTO PARA O 02` e a linha `impressao_inventario` |
| 4 | MAIKE atual no navegador, **só olhando** | Navegador | Login, Usuários, Permissões, Categoria de Manejo e Lotes sem erro |
| 5 | `02-reset-e-bootstrap-maike-POS-25-MIGRATIONS.sql` com a impressão colada | SQL Editor | `CONCLUIDO`, com a senha **mostrada uma única vez** |
| 6 | `03-postcheck-somente-leitura.sql` | SQL Editor | Todas as linhas `OK`; VEREDITO `INICIALIZADO` |
| 7 | Login no MAIKE com `maike` e a senha guardada | Navegador | Entra; as telas aparecem vazias |

Qualquer `PARAR`, erro ou número estranho: **pare** e peça revisão. Os scripts se recusam a seguir quando algo não confere, e nesse caso não alteram nada.

## Passo a passo no SQL Editor

1. Entre em supabase.com → projeto **MAIKE** → menu à esquerda **SQL Editor** → **New query**.
2. No GitHub, abra a PR #145 → aba **Files changed** → o arquivo `scripts/ops/sql-editor/01-precheck-somente-leitura.sql`. Clique **View file** e depois **Raw**, e copie **tudo**.
3. Cole no editor, sem nada selecionado, e clique **Run**.
4. Leia a coluna `status` e a última linha, **VEREDITO**.
5. Para o **02**:
   - copie o arquivo inteiro;
   - no bloco `PARÂMETROS`, troque **só** `COLE_AQUI_A_IMPRESSAO` pelo código de 12 caracteres que o 01 mostrou na linha `impressao_inventario`, depois das migrations;
   - clique **Run uma única vez**.
6. **Senha.** O resultado do 02 mostra a senha da conta `maike` **uma única vez**: 24 caracteres aleatórios, gerados pelo próprio banco.
   - Copie-a **na hora** para o seu gerenciador de senhas.
   - Não tire print e não cole em chat ou mensagem.
   - Depois, feche a aba de resultado, ou rode o 03, que substitui o resultado na tela.
7. Rode o **03**.

### O que o 02 garante

O 02 roda inteiro numa única transação: ou faz tudo, ou não faz nada.

**Antes de apagar, ele confere:**

- o banco certo;
- 25/25 migrations;
- as 53 tabelas exatas, sem view nem tabela estranha;
- as colunas de tenant;
- a ordem das chaves estrangeiras;
- que nenhuma tabela preservada aponta para o teste;
- que a impressão do inventário não mudou desde o 01, com as tabelas travadas contra escrita.

**O que apaga:** **só** as linhas das 38 tabelas de tenant dos clientes de teste, e esses clientes.

**O que nunca toca:**

- o histórico de migrations;
- o catálogo global;
- a identidade do proprietário do produto;
- `auth` e `storage`;
- RLS e grants.

**O que cria:**

- o cliente `maike` (nome MAIKE);
- a conta `maike` (Maike), ativa, com `papel_tenant = 'administrador'`;
- 2 registros de auditoria: a inicialização e a concessão do papel.

**Rodar de novo** não muda nada e **não** mostra a senha outra vez. Se existir `maike` junto com outros dados, ele responde **ANOMALIA** e não apaga nada.

### Riscos honestos do SQL Editor

- **A senha aparece na tela, uma vez.** Quem estiver vendo a tela naquele momento a vê. O navegador também a mantém na memória enquanto o resultado estiver aberto.
- **Onde ela NÃO fica:**
  - no texto do script, que o Supabase pode guardar como snippet ou histórico;
  - em tabela permanente; só fica o hash bcrypt;
  - na auditoria;
  - em log de consulta. É gerada dentro do banco e guardada numa tabela temporária que some no COMMIT, e tabelas temporárias não vão para o WAL.
- **Não use o assistente de IA do painel** com esse resultado aberto.
- **Para trocar a senha** por uma escolhida por você, use, depois do merge, a tela **Usuários** do MAIKE → a sua conta → **Nova senha**, com a senha atual.
- **Sem backup restaurável comprovado:** os dados de teste apagados **não voltam**, e voltar a versão do app não os recupera. Essa perda foi aceita.

## Como aplicar as 7 migrations (o SQL Editor NÃO serve para isso)

As migrations têm de passar pelo runner oficial do projeto (`npm run deploy:migrate`, ou seja, `prisma migrate deploy`). Ele grava o histórico `_prisma_migrations` com checksums e usa trava; colar o SQL das migrations no editor e "marcar como aplicadas" é **proibido**. O runner só executa contra um banco remoto se a barreira de dupla conexão conferir: mesmo banco lógico e cluster `7692130048193495360`.

**Fato verificado em 30/10:** este ambiente do Claude Code **não alcança** o Postgres do Supabase. A porta 5432 dos poolers `aws-0/aws-1-sa-east-1.pooler.supabase.com` está fechada para o container; só HTTPS sai.

### Opção 1 — recomendada: pelo próprio Claude Code remoto, sem mexer na `main`

1. **Rede:** no ambiente do Claude Code (menu do ambiente no título da sessão → **Edit** → **Network access**), libere a saída para o **host do Session pooler** que o painel do Supabase mostra em **Connect**, porta 5432. Se só "Allowed domains" não abrir a porta, use o nível de acesso mais amplo durante a janela.
2. **Segredo:** no mesmo lugar, em **Environment variables / secrets**, crie `MIGRATION_DATABASE_URL` com a conexão **Session pooler (porta 5432)** do projeto MAIKE. É o painel do ambiente, não o chat.
3. **Sessão nova:** abra uma sessão nova. O ambiente só é carregado no início. Na sessão nova, o agente:
   - testa se a porta abre;
   - roda `conferir-alvo-banco` e o `preflight-schema --sistema`, esperando 18/25;
   - roda `npm run deploy:migrate` duas vezes, esperando 7 aplicadas e depois `No pending`;
   - roda o `preflight-schema`, esperando 25/25;
   - relata só as saídas, sem o valor da conexão.
4. **Fechar:** **apague a variável** e devolva o acesso de rede ao normal.

O valor fica nas configurações do ambiente. O processo do agente consegue lê-lo, mas os scripts nunca o imprimem e ele não passa pelo chat.

### Opção 2 — GitHub Actions com aprovação manual (exige autorização própria)

Seria um workflow `workflow_dispatch`, com ambiente protegido e o segredo guardado no próprio GitHub.

**Problema:** o GitHub só oferece "Run workflow" para arquivos que já estão na `main`. Por isso, isso exige um PR **só com o workflow** para a `main`, com autorização específica. O merge desse PR republicaria a produção com o mesmo código do app.

Rascunho, que não está ativo e não é commitado em `.github/workflows`:

```yaml
name: migrations-producao-manual
on:
  workflow_dispatch:
    inputs:
      sha:
        description: "SHA auditado da PR #145 (40 caracteres)"
        required: true
permissions:
  contents: read
jobs:
  migrar:
    runs-on: ubuntu-latest
    environment: producao-migrations   # Settings → Environments: "Required reviewers" = proprietário
    steps:
      - uses: actions/checkout@v4
        with: { ref: "${{ inputs.sha }}", persist-credentials: false }
      - uses: actions/setup-node@v4
        with: { node-version: 22 }
      - run: npm ci
      - name: Barreira + migrations
        env:
          MIGRATION_DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}
          DATABASE_URL: ${{ secrets.MIGRATION_DATABASE_URL }}
          MIGRATION_EXPECTED_SYSTEM_IDENTIFIER: "7692130048193495360"
        run: |
          node scripts/deploy/conferir-alvo-banco.mjs
          npm run deploy:migrate
          npm run deploy:migrate
          node scripts/deploy/preflight-schema.mjs --sistema 7692130048193495360
```

Fronteira de confiança do rascunho:

- **Disparo:** só manual. Sem `pull_request`, sem `pull_request_target` e sem `push`.
- **Ambiente:** o job exige aprovação nominal.
- **Escopo do segredo:** existe só nesse ambiente.
- **Código:** o SHA executado é o auditado.
- **Token:** permissões mínimas.

### Opção 3 — o terminal do seu computador

Runbook `MAIKE-CATALOGO-OPERACAO-SUPABASE.md` §0c.

## Depois de tudo

- **Até o merge,** a produção continua rodando a `main` anterior. Ela ignora o papel novo, mas já funciona sobre o schema migrado.
- **O merge da PR #145** continua **manual**, só pelo proprietário e só depois da auditoria final do arquiteto.
- **Depois do merge,** a sessão passa a ser revalidada no banco: conta ou cliente apagado ou desativado recebe 401.
- **Ainda proibido:** testes de escrita em preview, porque o preview compartilha banco e segredo com a produção.
