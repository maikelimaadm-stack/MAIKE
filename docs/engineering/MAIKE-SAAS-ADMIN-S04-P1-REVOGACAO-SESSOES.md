# MAIKE-SAAS-ADMIN-S04-P1 — Revogação durável das sessões de fazenda

> Primeiro slice do S04. Decisão: **D-PROD-143**. Base: `main` `087be1f6` (S03 mergeado).

## 1. Problema (antes)

No S03, `app.autenticar` relia `Usuario.ativo` e `Cliente.ativo` a cada requisição, mas não havia estado durável de sessão.

- **Falha medida (GES-15 do S03):** o mesmo JWT dava `200 → suspender → 401 → reativar → 200`, enquanto não expirasse.
- **Prazo:** até 30 dias com "Manter conectado".
- **Mesma falha em outros caminhos:** desativar e reativar uma conta e trocar a senha não derrubavam os tokens já emitidos.

## 2. Decisão (depois)

**Duas épocas de sessão inteiras, persistidas no PostgreSQL** (`INTEGER` anulável, `NULL` vale 0; ver §5):

| Campo | Avança quando | Efeito |
|---|---|---|
| `Cliente.sessao_epoca` | o cliente é **suspenso** (`ativo: false`) pelo MAIKE Admin | todas as contas da fazenda perdem os tokens anteriores |
| `Usuario.sessao_epoca` | a senha muda (própria, por administrador ou por script de reset); `ativo` muda de valor; `papel_tenant` muda (script ou SQL operacional) | só essa conta perde os tokens anteriores |

**No login.** `/auth/login` lê as duas épocas do banco, do par usuário + cliente autenticado, e grava no JWT:
- `cliente_sessao_epoca`;
- `usuario_sessao_epoca`.

O tenant continua vindo só da linha do `Usuario`.

**Em cada requisição.** `app.autenticar` faz a **mesma consulta única** de antes, agora com `sessao_epoca = <claim>` em `Usuario` e em `Cliente`. A requisição recebe **401 `TENANT_CONTEXT_REQUIRED`** quando:
- falta qualquer uma das claims;
- a claim não é um inteiro entre 0 e 2^31−1 (string, negativo, fração, `null`, acima do teto);
- a claim difere do valor no banco;
- a conta ou o cliente está inativo.

**Princípios.** A guarda falha fechada:
- não aceita época nula ou zero por compatibilidade;
- não guarda nada em cache em memória;
- não tem tolerância de tempo nem compara horários;
- nunca instala `auth_context` para um token recusado.

**Reativação.** Reativar o cliente **não** mexe na época: os tokens anteriores continuam mortos e é preciso entrar de novo. Na conta individual, a reativação também avança, porque `ativo` mudou; isso é inofensivo.

## 3. Invariantes

1. **Incremento atômico.**
   - O único escritor é `UPDATE … SET sessao_epoca = COALESCE(sessao_epoca, 0) + 1 … RETURNING`, em `backend/src/shared/auth/sessaoEpoca.js`.
   - Ele roda **na mesma transação** da mudança de estado (logo depois do `updateMany` condicional da suspensão ou do `update` da conta, com a linha já travada) e da auditoria. O SQL 04 faz a mesma expressão no mesmo `UPDATE`.
   - Se a auditoria falhar, o rollback desfaz `ativo` e a época juntos (SP-05 e SP-06 forçam a falha com trigger).
2. **Corrida, ETag/CAS e conflito.**
   - Corrida perdida, ETag ausente (428) ou ETag obsoleto (409) não avançam a época (SP-05, GES-14).
   - Trocas concorrentes de senha somam os dois incrementos, sem perda: `col = col + 1` sob lock de linha (SP-09).
3. **Isolamento.**
   - Suspender A não toca B (SP-04).
   - A época não é gravável por corpo: os contratos são fechados e a tentativa recebe 400 (SP-11).
   - A época não aparece em leituras públicas, nem na ficha do Admin, nem no `AuditLog` da conta (SP-06, SP-11).
4. **Auditoria.**
   - O evento `cliente_suspender`/`cliente_reativar` grava `antes`/`depois` com `ativo` e `sessao_epoca`, por exemplo 0→1 na suspensão e 1→1 na reativação.
   - O `AuditLog` da conta marca `sessoes_revogadas: true` quando revoga.
   - Nenhum segredo é gravado.
5. **Contratos S03 preservados.** Ficam como estavam:
   - `If-Match` obrigatório (428/409), ETag, CAS;
   - POST atômico, login global único;
   - MFA, Origin, CSRF, no-store.
6. **Época nunca recua.**
   - Nenhum caminho grava valor arbitrário: só `COALESCE(…, 0) + 1`. A coluna não está em nenhum contrato HTTP (SP-11).
   - Sem `CHECK`: a allowlist do pré-merge (D-PROD-107) recusa `CHECK` em tabela antiga, e a regra fica garantida por construção.
   - No overflow do `INTEGER`, o Postgres recusa o incremento ("integer out of range"), a transação falha e nada muda. É falha fechada, sem reset para zero. Na prática, 2^31 suspensões ou trocas de senha da mesma conta são inalcançáveis.

## 4. Inventário de emissores e escritores (busca real no HEAD `087be1f6`)

| Caminho | O que grava | S04-P1 |
|---|---|---|
| `backend/src/modules/auth/authRoutes.js` `POST /auth/login` | **único** `jwtSign` | emite as épocas |
| `backend/src/app.js` `app.autenticar` | **único** `jwtVerify` | compara as épocas, falha fechada |
| `adminMaike/adminClientesGestaoService.js` `alterarSituacaoCliente` | `Cliente.ativo` | suspender: `sessao_epoca + 1` no mesmo `updateMany` |
| `adminMaike/adminClientesGestaoService.js` `editarCliente` | `Cliente.nome`/`codigo` | não revoga (identificação) |
| `adminMaike/adminClientesGestaoService.js` `criarCliente` | cria `Cliente` + `Usuario` | época 0 (default) |
| `usuarios/usuarioService.js` `atualizar` (`PATCH /usuarios/:id`) | `ativo`, `senha_hash`, `nome` | senha ou troca de `ativo`: `+1`; só nome: não |
| `usuarios/usuarioService.js` `criar` (`POST /usuarios`) | cria `Usuario` | época 0 (default) |
| `scripts/auth/reset-password.mjs` | `senha_hash` | `+1` no mesmo `update` |
| `scripts/auth/papel-tenant.mjs` | `papel_tenant` | `+1` no mesmo `updateMany` condicional; auditoria marca `sessoes_revogadas` |
| `scripts/ops/sql-editor/04-limpeza-preservando-maike.sql` | `papel_tenant` (SQL) | `sessao_epoca = sessao_epoca + 1` no mesmo `UPDATE` |
| `scripts/auth/bootstrap-local.mjs`, `scripts/ops/inicializar-tenant-maike.mjs`, `scripts/performance/usuarios-bench.mjs` | criam contas (dev/ops/bench) | época 0 (default); não revogam nada |
| `adminMaike/adminService.js` | `AdminPrincipalMaike` (proprietário) | fora do escopo: sessões do Admin têm revogação própria (`SessaoAdminMaike`) |

Não existe refresh token, nem outro `jwtSign`/`jwtVerify` no backend.

## 5. Migration `20261106200000_s04_p1_sessao_epoca`

- **Tipo:** EXPAND puro, dentro da allowlist fechada do pré-merge (D-PROD-107).
  - `ADD COLUMN "sessao_epoca" INTEGER` em `Cliente` e `Usuario`: anulável, sem DEFAULT, sem `CHECK`, sem `UPDATE`;
  - sem índice novo: a época só é filtrada junto da PK, que já está indexada;
  - nenhuma mudança em ids, uniques ou chaves de tenancy.
- **Por que anulável e não `NOT NULL DEFAULT 0`:**
  - o gate `premerge-migrate` recusa de propósito `NOT NULL DEFAULT` e `CHECK` em tabela antiga (teste B2);
  - a primeira versão desta PR tentou esse caminho e o CI recusou;
  - em vez de afrouxar o gate, o código trata `NULL` como 0: no login (`epocaDe`), na guarda (`filtroEpoca`: `0` aceita `0` ou `NULL`) e no incremento (`COALESCE`).
  - Um passo CONTRACT futuro (backfill + `NOT NULL`) fica opcional e exige decisão própria sobre o gate.
- **Manifesto:** a migration entrou em `MIGRATIONS_APROVADAS`, com o SHA-256 do arquivo; o fluxo normal de release.
- **Provas em PostgreSQL 16 descartável:**
  - **do zero:** `migrate deploy` completo; colunas `integer`, anuláveis, sem default;
  - **upgrade:** banco com todas as migrations anteriores e clientes/usuários pré-existentes (ativos, inativos e administrador). Depois do `migrate deploy`, todos os dados ficam intactos e com época `NULL` (= 0);
  - o primeiro `COALESCE + 1` sai de `NULL` para 1 (SP-01b); o overflow falha.
- **Gates:** `tenancy`, `indices`, `deploy-migrations`, `modelobase1-pecuario`, `supabase-public-grants` e `premerge-migrate` (B1–B7) passam sem afrouxar nada.
- **Preflight de release:** `scripts/deploy/preflightSchemaLib.mjs` agora exige `Cliente.sessao_epoca` e `Usuario.sessao_epoca` (teste PF-02b).

## 6. Rollout e rollback

**Ordem obrigatória:**
1. aplicar a migration;
2. verificar com `node scripts/deploy/preflight-schema.mjs`;
3. só então publicar o runtime novo.

**Rollout fora de ordem**, com o runtime novo num banco sem a migration (provado localmente):
- `/auth/login` e qualquer rota autenticada respondem **500 `INTERNAL_ERROR`**, sem vazar coluna, Prisma ou ids;
- o preflight acusa "migrations pendentes" e "colunas ausentes" e diz **"NÃO publique"**.

**O inverso é seguro:** o runtime antigo num banco já migrado funciona, porque só ignora as colunas novas.

**Efeito esperado da implantação:**
- **Logout global único.** Todo JWT emitido antes da versão nova (sem as claims) passa a receber 401: cada usuário entra de novo uma vez.
- **Comunicação.** Avisar as fazendas antes da publicação.
- **Apps offline.** Um app offline que guarda o JWT antigo também precisará de novo login quando voltar a falar com o servidor.

**Rollback:**
- **Código:** reverter a PR. O runtime antigo funciona com as colunas presentes, porque são expand-only.
- **Contra-indicação:** reverter o código devolve a falha do S03 (token ressuscita ao reativar), mas não perde dados.
- **Banco:** **não** é preciso remover as colunas: o runtime antigo funciona com elas (provado rodando suítes do `main` no banco migrado). Se necessário, `DROP COLUMN sessao_epoca` só depois de o runtime antigo estar no ar.
- **Produção:** nada disso foi executado em produção.

## 7. Limites honestos

- **Offline.** O servidor recusa o token antigo, mas não consegue apagar dados que um aparelho offline já tem em cache. A revogação vale **no servidor**, a partir da próxima requisição.
- **Expiração.** O TTL não mudou: 8 h normal e 30 dias com `lembrar`. A época só encurta a vida do token, nunca a estende.
- **Sem endpoint de revalidação anônima.** Não há API de "revogar sessão" além dos eventos acima. A revogação manual de uma conta é feita trocando a senha ou desativando e reativando.

## 8. Testes (PostgreSQL 16 local descartável)

**Suíte nova `backend/tests/sessaoTenantRevogacaoS04P1.test.mjs`:** SP-01, SP-01b, SP-02..SP-09, SP-11 e SP-12.
- **RED no runtime do `main`** (schema novo, `backend/src` e `scripts/auth` do `main`): 9 de 12 falham. SP-04, SP-11 e SP-12 são de preservação e já passavam.
- **GREEN:** 12/12.

| Cenário | Prova |
|---|---|
| 1 | SP-01: login normal e `lembrar` com as épocas atuais; TTL 8 h e 30 d; resposta pública inalterada |
| 2 | SP-02: mesmo token 200 → suspender 401 → reativar **401**; login novo 200; eventos 0→1 e 1→1 |
| 3 | SP-03: token legado sem claims, só uma claim, string, negativo, fração, `null`, acima do Int, época futura, expirado e payload alterado → 401 |
| 4 | SP-04: suspender A derruba as duas contas de A; B intacto |
| 5 | SP-05: 428 e 409 sem avanço; auditoria quebrada desfaz `ativo` e época; corrida → `[200, 409]`, época +1, um evento |
| 6 | SP-06: desativar → 401 → reativar → continua 401; só nome não revoga; auditoria quebrada → rollback |
| 7 | SP-07: própria senha (encerra o token do pedido e as outras sessões), senha alheia por administrador (só o alvo), script de reset; senha antiga recusada |
| 8 | SP-08: `papel-tenant.mjs` real, via processo: época +1 e token anterior 401 |
| 9 | SP-09: duas trocas concorrentes de senha → época +2, dois `AuditLog` |
| 10 | Migration do zero e upgrade (§5) |
| 11 | Suítes existentes verdes, com as expectativas atualizadas por evolução legítima (abaixo) |
| 12 | SP-12: `cliente_id` em query, header ou corpo não é autoridade; cookie do proprietário não abre a fazenda |

**Expectativas atualizadas, sem enfraquecer nenhuma:**
- **GES-15:** agora espera **401** após reativar, mais login novo 200.
- **U-08:** depois da troca da própria senha, o token antigo recebe 401 e o teste segue com o login novo.
- **PM-06:** o SQL 04 promove o papel e agora encerra a sessão anterior; a conta e a senha continuam preservadas.
- **SR-04:** o token forjado ganhou épocas válidas, para continuar provando o `cliente_id` trocado.
- **Preflight:** PF-01 passou a ter as colunas novas no fixture; o PF-02b é novo.
- **BE-04:** a lista de claims do JWT agora inclui as duas épocas, e o token continua sem senha nem hash.
- **B1 (pré-merge):** as colunas anuláveis novas aparecem na lista de colunas novas em tabela antiga.

## 9. Avaliação de qualidade e escala

| Eixo | Avaliação |
|---|---|
| **Segurança** | **A−.** Revogação durável, falha fechada, sem fonte de época no navegador, atômica com a auditoria. Fica abaixo de A pelo limite do offline (§7) e porque ainda faltam S04-P2/P3 (recuperação do primeiro acesso, troca obrigatória ou convite) |
| **Escalabilidade** | **Zero consulta extra:** a guarda continua sendo **uma** consulta indexada por PK, agora com dois filtros a mais. Sem estado em instância, então funciona igual com N instâncias na Vercel. O login lê as épocas no mesmo `findMany` de antes |
| **Migration** | Expand-only, defaults, sem índice novo, testada do zero e em upgrade, rollback de código seguro |
| **Risco operacional** | Logout global único na implantação (esperado e comunicado). O rollout fora de ordem dá 500, e o preflight bloqueia |
| **Padrões de erro** | 401 `TENANT_CONTEXT_REQUIRED` para sessão revogada ou malformada; 428 e 409 do S03 inalterados; falha interna = rollback total (500) |

## 10. Gates de decisão

| Decisão | Estado |
|---|---|
| CODE_READY | pronto para revisão do arquiteto-chefe |
| SCHEMA_READY_LOCAL | migration provada localmente (zero e upgrade); **não** aplicada em nenhum banco remoto |
| OPERATIONAL_RELEASE_READY | **NO-GO.** Faltam o S04-P2/P3 (recuperação do primeiro acesso / POST idempotente, troca obrigatória ou convite) e o S02 (`ADMIN_MAIKE_CHAVE` e `ADMIN_ORIGINS` em produção, IP confiável atrás do proxy, limite de tentativas distribuído) |

## 11. R1 — UI de troca de senha e release (PR #217)

### 11.1 Defeitos corrigidos na tela `/Usuarios`
- **A. A troca da própria senha não saía da sessão.** O servidor já recusava o token (época +1), mas a tela continuava "autenticada".
  - **Agora:** com a resposta HTTP de sucesso **confirmada**, `src/pages/Usuarios.jsx` chama `useAuth().logout()`. É o fluxo central: limpa token, cache do React Query e empresa.
  - **Aviso:** "Senha alterada. Entre novamente com a nova senha." aparece no Toaster da raiz, que sobrevive à troca para a tela de login.
  - **Própria conta:** decidida pelo **ID autenticado** (`user.id` do AuthContext, vindo de `/auth/contexto`), no momento do envio (`ehTrocaDaPropriaSenha`). Não usa o login textual nem o `currentUser` assíncrono; sem ID, não infere nada.
  - **Outros casos:** um administrador que troca a senha de outra conta não sai da sessão; editar só o nome não sai.
  - **Falhas:** 400, 403 e 409 mostram a mensagem do erro, sem sucesso e sem logout.
  - **Resultado incerto:** rede, tempo esgotado ou indisponibilidade (`resultadoIncerto`) geram "Não foi possível confirmar a troca de senha. Se a mudança tiver sido aplicada, você precisará entrar novamente". Também sem logout e sem nova tentativa automática.
  - **401 global (avaliado, não alterado):** um token recusado faz cada requisição falhar com "Sua sessão expirou" (`TENANT_CONTEXT_REQUIRED`). Nenhuma ação passa em silêncio, e a revalidação da sessão leva ao login.
    - Não foi criado logout automático global em 401, para não misturar com 5xx.
    - O caso específico (troca da própria senha) sai de forma explícita.
- **B. Senhas em estado de tela.** O `onSuccess` fazia `...dados` na ficha (`editingItem`), e `senha_atual`/`nova_senha` ficavam em memória e no `initialData`.
  - **Ficha:** `contaPublica`/`contaPublicaAposAtualizar` (allowlist explícita `CAMPOS_PUBLICOS_CONTA`) para a base, o formulário e a resposta. A criação também passa pela allowlist.
  - **React Query:** guarda as `variables` da mutação no MutationCache. As duas mutações de conta usam `gcTime: 0`, e `onSettled` chama `descartarCredenciais` sobre o próprio objeto retido, em sucesso ou erro.
  - **Limite:** não se promete apagar a memória física do JS. O formulário já zerava os campos de senha no envio.
  - **Backend:** o contrato público continua sem senha nem hash.

### 11.2 Testes de UI (`tests/smoke/usuariosSenhaSessaoS04P1.test.jsx`, 9 casos)
- **Montagem:** página real (controller Base1, React Query e mutações reais). Só tabela, formulário e rede são stubs.
- **Casos:**
  - **Própria senha:** `logout` chamado uma vez e aviso exibido.
  - **Senha de outra conta:** sem logout.
  - **Nome (própria ou de outra):** sem logout.
  - **Falhas 400, 403, 409, indisponibilidade e erro desconhecido:** sem sucesso nem logout, com a mensagem honesta de incerteza nos dois últimos.
  - **Detecção pelo ID:** com `currentUser` divergente e com `currentUser` que nunca carrega; uma conta de outro com o mesmo login textual não conta como própria.
- **Todos os casos:** nenhuma senha na ficha, no QueryCache, no MutationCache nem nos toasts.
- **RED:** com o código anterior, 8 de 9 falham.
- **Mutações:** recolocar `...dados` falha 1; tirar o `logout()` falha 2; tirar o descarte das variables falha 7.
- **Mocks existentes:** `usuariosPaginacaoScale`, `usuariosPermissoesSplit` e `r3PostPr96Bugfix` passaram a usar os helpers reais via `importOriginal`.

### 11.3 Release: a migration tem de chegar antes do runtime
- **Evidência (Vercel, só leitura):**
  - **`maike`** (`prj_jbLcws3p…`, Vite + `api/fastify.js` serverless):
    - cada merge na `main` gerou deploy **production** `READY` (#210, #213, #214, #211, #216, #215, #218), com os domínios `www.makgestao.com` e `makgestao.com`;
    - existe também o ambiente customizado **`staging`**, com deploys de commits fora da `main`.
  - **`admmakgestao`** (`prj_9tjMbWWW…`, `apps/admin`): também ligado ao repositório, com production em `admmakgestao.vercel.app`.
  - **Conclusão:** um merge da #217 publica o runtime novo em produção **automaticamente**.
- **Alvo do banco:**
  - **Não verificado** (`DATABASE_TARGET_UNVERIFIED`): os valores das variáveis não foram lidos, por regra.
  - **Escopo conhecido:** a variável de banco da Vercel também está no escopo *preview*. O proprietário estendeu esse escopo nesta sessão para ter preview com dados reais.
  - **Consequência:** previews desta PR podem falar com o banco real, que **ainda não tem** as colunas, e nesse caso login e rotas autenticadas do preview dão 500.
  - **Sem E2E de mutação em preview:** os testes só rodaram em PostgreSQL local descartável.
- **Caminho exequível**, já documentado (runbook `MAIKE-PR174-RELEASE-CUTOVER-RUNBOOK.md` §3, D-PROD-107):
  - a migration é **EXPAND** e o runtime antigo funciona com o banco migrado (provado: suítes do `main` 52/52 no banco migrado);
  - logo, ela pode ser aplicada **antes** do merge, sem pausar a Vercel, e o merge publica o runtime novo sobre um banco já pronto.
- **Ordem:**
  1. **Backup restaurável** do provedor.
  2. **Análise local:** `premerge-migrate --sha <SHA>` (OK, alvo não verificado).
  3. **Verificação do alvo:** `--verificar-alvo`, com `MIGRATION_DATABASE_URL` de **sessão/direta (5432, não o pooler 6543)** e `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER`, só no ambiente do operador.
  4. **Aplicação:** `--aplicar` (runner oficial `run-migrations.mjs`, sem fallback de URL).
  5. **Conferência:** `preflight-schema` somente leitura, verde no **mesmo** alvo.
  6. **Merge manual.**
  7. **Deploy:** conferir o production `READY` no SHA do merge.
  8. **Logout global único:** comunicado antes às fazendas.
- **Pré-condições do merge (todas pendentes, dependem do proprietário):**
  - identificação inequívoca do banco de produção (`system_identifier`);
  - credencial de migração de sessão/direta no ambiente do operador;
  - autorização explícita;
  - backup;
  - preflight verde no alvo;
  - plano de rollback (§6);
  - comunicação do logout.
- **Nada foi executado:** migration, SQL, variáveis, pausa e promoção na Vercel ficam para autorização posterior.

## 12. R2 — HTTP 500 na troca da própria senha e gate de release

### 12.1 Defeito e correção
- **Cadeia real:**
  - `nativeHttpClient` traduz `500 {code:'INTERNAL_ERROR'}`, e qualquer código desconhecido, em `API_OPERATION_FAILED`;
  - `ApiError` só marca `PROVIDER_UNAVAILABLE` como `retryable`;
  - a R1 usava `retryable` para decidir "resultado incerto".
  - Consequência: um 500 era mostrado como falha comum, embora o servidor possa ter falhado **depois** de gravar a senha.
- **Correção local:**
  - `resultadoIncerto` (`usuarioAdminService.js`), usado só na troca da própria senha em `Usuarios.jsx`, passa a incluir `OPERATION_FAILED`;
  - a tabela global `RETRYABLE` e a semântica de outras operações (rebanho, lotes, mapa, offline) **não** mudaram.
  - `INVALID_ARGUMENT`, `USUARIO_SENHA_ATUAL_INVALIDA` e `CONCURRENCY_CONFLICT` continuam sendo rejeição.
- **UX:**
  - 500, 502/503/504, rede, tempo esgotado e erro desconhecido → "Não foi possível confirmar a troca de senha…";
  - sem afirmar que a senha permaneceu, sem logout e sem nova tentativa (o PATCH sai uma vez);
  - nenhum texto cru do servidor, stack ou dado de senha é exibido;
  - o tratamento global de 401 não mudou.

### 12.2 Provas
- **`tests/smoke/usuariosSenhaHttp500S04P1.test.jsx`** (11 casos), com cadeia **real** até o `fetch` (serviço → porta → `nativeRequest`):
  - **500, com e sem JSON:** `OPERATION_FAILED`, incerto;
  - **502/503/504 e rede:** `PROVIDER_UNAVAILABLE`, incerto;
  - **400/403/409:** rejeição;
  - `fetch` chamado **1×** (zero repetições), e a mensagem/detalhes exibíveis sem senha;
  - `retryable` global inalterado;
  - **formulário real:** envia senha atual e nova, depois limpa os campos e o DOM.
- **`tests/smoke/usuariosSenhaSessaoS04P1.test.jsx`** (12 casos):
  - mais o caso `OPERATION_FAILED` (incerto, sem logout, sem retenção);
  - "zero retries" em todas as falhas;
  - **criação com senha inicial**, em sucesso (servidor que ecoa `senha` é filtrado pela allowlist) e em erro: sem senha em ficha, QueryCache, MutationCache ou toast.
- **RED** com o `usuarioAdminService.js` anterior: 3 falhas (os casos de 500). **GREEN:** 23/23.

### 12.3 Compatibilidade de schema (por que a ordem importa)
- **Runtime antigo + schema novo = compatível.** A migration só ADICIONA colunas anuláveis, sem default nem constraint. O código antigo não as lê, e os INSERTs dele ficam com NULL, que vale época 0. Provado: as suítes do `main` passam no banco migrado.
- **Runtime novo + schema antigo = incompatível.** O login seleciona `sessao_epoca` e a guarda filtra por ela. Sem as colunas, o login e todas as rotas autenticadas respondem **500** (provado localmente, sem vazar detalhe). O preflight acusa "colunas ausentes".
- **Conclusão:** a migration precisa estar aplicada **antes** de o runtime novo receber tráfego. Como a Vercel publica a `main` em produção automaticamente (verificado: todos os merges recentes viraram production `READY`), **o merge não pode acontecer antes da migration**. CI verde e preview `READY` provam só código e build, não o schema de produção.

### 12.4 Runbook de execução FUTURA (proprietário/operador autorizado; nada disto foi executado)
Base: `MAIKE-PR174-RELEASE-CUTOVER-RUNBOOK.md` §3 e D-PROD-107.

1. **Identificar o alvo:** o banco de produção usado pela Vercel `maike`, confirmado por `system_identifier`. Registrar também a política de preview (hoje a variável de banco está no escopo preview; o alvo não foi verificado).
2. **Backup restaurável** do provedor (snapshot/PITR), com teste de restauração.
3. **Segregar os alvos:** decidir se o preview continua no banco real (risco registrado) antes de publicar.
4. **Comunicar** às fazendas o logout global único.
5. **Checkout exato** do SHA aprovado e `node scripts/deploy/premerge-migrate.mjs --sha <SHA>` (análise local).
6. **`--verificar-alvo`**, com `MIGRATION_DATABASE_URL` de sessão/direta (5432, **não** o pooler 6543) e `MIGRATION_EXPECTED_SYSTEM_IDENTIFIER`, só no ambiente do operador, sem exibir valores.
7. **Aprovação explícita** do proprietário, e só então `--aplicar` (`run-migrations.mjs`, sem fallback de URL).
8. **`node scripts/deploy/preflight-schema.mjs`** no **mesmo** banco: precisa sair verde.
9. **Merge manual.**
10. **Conferir** o deployment production `READY` no SHA do merge, e um smoke de login com novo token.
11. **Rollback:** rollback de deployment da Vercel. O banco migrado atende o runtime antigo (§6).

| Status | Item |
|---|---|
| **Comprovado** | código e testes locais; migration EXPAND (zero, upgrade, compat); `premerge-migrate` local OK; produção automática da Vercel |
| **Pendente** | alvo verificado (`DATABASE_TARGET_VERIFIED = NÃO`); backup; `--verificar-alvo`; `--aplicar` (`SCHEMA_APPLIED_PRODUCTION = NÃO`); preflight no alvo; comunicação |

## 13. R5/R6 — Migration aplicada na produção (07/11/2026) — registro operacional

**Resumo:** a migration `20261106200000_s04_p1_sessao_epoca` foi aplicada no banco de produção em
07/11/2026, por volta de 08:30 UTC, **por decisão explícita do proprietário**, por um caminho
**diferente** do runbook (§12). O merge **não** foi feito: a PR #217 segue em DRAFT.

### 13.1 Alvo comprovado (somente leitura, antes de aplicar)

- Projeto Supabase `MAIKE` (`uuemcasqcdjucflulkne`, sa-east-1, PostgreSQL 17.11), database
  `postgres`, `system_identifier` **7692130048193495360**.
- **Vínculo com a Vercel Production por correlação:**
  - Os logs de runtime do projeto `maike` (environment = production, 06/11 entre 22:20 e 22:27 UTC)
    têm requisições a `/api/native/lotes/cmw5jgk3c0002l508r6fxynxq/...` e
    `/api/native/lotes/cmw5jgwmm0002i9081kw0bwov/...`.
  - Esses dois IDs (cuid, aleatórios) existem em `public."Lote"` desse banco, com `createdAt`
    06/11 22:21:00 e 22:21:17 UTC.
  - O outro projeto Supabase da organização (`dcroxgdzzgqgiquvfffa`) não tem as tabelas do MAIKE.
- **Limite dessa prova:** é correlação de dados, não o `conferir-alvo-banco.mjs`. A
  `MIGRATION_DATABASE_URL` cadastrada na Vercel **não** foi conferida.
- **Histórico antes:**
  - 30 migrations, 0 com falha. Os nomes coincidem com o repositório.
  - 26 checksums batem com os arquivos.
  - 4 checksums são `'manual'` e são exatamente os nomes da lista `CHECKSUM_MANUAL_HISTORICO`.
  - Única pendente: a S04-P1.

### 13.2 Desvios autorizados pelo proprietário (em relação ao §12 e ao prompt R6)

1. A migration **não** foi aplicada por `premerge-migrate --aplicar`. Esta sessão não tem
   conexão de banco protegida.
   - Foi aplicada pelo conector Supabase (`execute_sql`).
   - Foi **uma única transação**, que reproduz o que o runner faz: as duas instruções do
     `migration.sql` + a linha em `_prisma_migrations`, com o checksum do manifesto.
2. **Não** houve backup lógico novo nem teste de restauração. A proteção aceita foi o backup
   físico automático do Supabase de 06/11/2026 05:48:22 UTC.
   - Ele não cobre escritas posteriores.
   - A restauração dele nunca foi testada.

### 13.3 O que foi executado (exatamente)

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
-- guarda: aborta se system_identifier <> 7692130048193495360 ou se a migration já estiver registrada
ALTER TABLE "Cliente" ADD COLUMN "sessao_epoca" INTEGER;
ALTER TABLE "Usuario" ADD COLUMN "sessao_epoca" INTEGER;
INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count)
VALUES (gen_random_uuid()::text, '52cb8de740a20cf020f82115422425063e09d0d1dc5da5e5b7dc416346a2646c',
        now(), '20261106200000_s04_p1_sessao_epoca', NULL, NULL, now(), 1);
COMMIT;
```

Nenhum outro comando de escrita foi executado: nenhum DROP, DELETE, TRUNCATE, UPDATE de dados,
restore ou mudança de permissão. `supabase_migrations` não foi usada.

### 13.4 Conferência depois de aplicar (somente leitura)

- **Colunas:**
  - `Cliente.sessao_epoca` e `Usuario.sessao_epoca` são `integer`, anuláveis, sem default.
  - Nenhuma linha tem a coluna preenchida, o que equivale à época 0 (NULL = 0).
- **Histórico:** 31 migrations, 0 com falha ou revertidas. A S04-P1 está concluída, com
  `applied_steps_count = 1` e checksum `52cb8de7…646c`.
- **Contagens preservadas:** `Cliente` 2 → 2; `Usuario` 4 → 4.
- **Preflight:**
  - `avaliarPreflight` (scripts/deploy/preflightSchemaLib.mjs, com `exigirAdminPorCliente`)
    sobre as consultas de `CONSULTAS` lidas do banco: `ok: true`, 31/31 aplicadas, 0 pendentes,
    0 falhas, 0 avisos.
  - O CLI `preflight-schema.mjs` não foi rodado, por falta de conexão direta.
- **Runtime antigo (main `1ebf7780`) no ar:**
  - `GET https://www.makgestao.com/api/native/health` → 200.
  - Zero logs de erro ou fatal em production nos 30 min seguintes.
  - Isso é esperado: a migration é EXPAND e o código antigo ignora as colunas.

### 13.5 Estado e próximos passos

| Item | Estado |
|---|---|
| `SCHEMA_APPLIED_PRODUCTION` | **SIM** (07/11/2026) |
| `PREFLIGHT_PRODUCTION` | **SIM** (avaliador oficial sobre dados lidos; não o CLI) |
| `DATABASE_TARGET_VERIFIED` | **SIM por correlação** (não pelo `conferir-alvo-banco.mjs`) |
| `BACKUP_RESTORE_VERIFIED` | **NÃO** (só o backup físico de 06/11 05:48 UTC) |
| `MERGE_READY` | **CANDIDATO**, sujeito à revisão do arquiteto-chefe |
| `OPERATIONAL_RELEASE_READY` | **NÃO** (S02 e S04-P2/P3 pendentes) |

**Antes do merge manual:**
- comunicar às fazendas o **logout global único**;
- pedir que sincronizem as operações offline pendentes;
- manter o Preview sem escritas de teste, porque ele usa o mesmo banco.

**Rollback de aplicação:** voltar o deployment da Vercel para o anterior. O banco migrado atende
o runtime antigo.

**Rollback do schema:** se um dia for necessário, consiste em remover as duas colunas vazias,
**somente com nova autorização**.
