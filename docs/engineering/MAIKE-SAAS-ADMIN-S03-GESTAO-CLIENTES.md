# MAIKE-SAAS-ADMIN-S03 — Gestão de clientes e provisionamento inicial

> Decisão desta missão, registrada aqui e não em `DECISIONS.md`. Esse arquivo é editado pela PR #211, que está aberta; promover a D-PROD-* na integração.
> Base: `main` = `e972ea325b016522dee01972afd9b64a19009e3f` (merge da PR #214), CI `verify:all` verde.

## 1. O que entrou

Na aba **Clientes** do MAIKE Admin, o proprietário agora pode:
1. **cadastrar cliente** junto com o **primeiro administrador da fazenda**, numa única transação;
2. **editar a identificação** do cliente (`nome`, `codigo`);
3. **suspender e reativar** o cliente, com confirmação e justificativa.

Fica de fora desta missão:
- planos, assinaturas e pagamentos;
- autocadastro e Google;
- impersonação ("entrar como cliente");
- exclusão física;
- gestão de usuários secundários (é a S04);
- qualquer mudança na SPA dos clientes ou no `/auth/login`.

## 2. Contrato da API (todas as rotas com `exigirSessaoAdmin()`)

As escritas usam a guarda que já existia:
- sessão do **proprietário** com **MFA verificado**;
- `Origin` em `ADMIN_ORIGINS`;
- cabeçalho `x-maike-admin-csrf` igual ao HMAC da sessão.

Corpo e query são `additionalProperties: false`, então campo extra recebe 400 `REQUEST_VALIDATION_FAILED`. Isso inclui `id`, `cliente_id`, `ativo`, `papel_tenant`, `senha`, `admin_id` e contadores.

Toda resposta `/admin-maike/*` sai com `Cache-Control: no-store`, por um hook do plugin admin.

| Método e rota | Corpo | Resposta |
|---|---|---|
| `POST /admin-maike/clientes` | `{ nome, codigo, administrador: { nome, login } }` | 201 `{ cliente: {id, codigo, nome, ativo, criado_em, atualizado_em}, administrador: {id, nome, login}, senha_temporaria }` |
| `PATCH /admin-maike/clientes/:id` | `{ nome?, codigo? }` (pelo menos 1) + cabeçalho **`If-Match` obrigatório** (S03-R2) | 200 `{ cliente }` + `ETag` novo |
| `POST /admin-maike/clientes/:id/situacao` | `{ ativo: boolean, justificativa: string(10..500) }` + **`If-Match` obrigatório** | 200 `{ cliente }` + `ETag` novo |

**Revisão da ficha (S03-R2):**
- `GET /admin-maike/clientes/:id` devolve o cabeçalho `ETag: "r1-<sha256 base64url>"`, calculado sobre `[id, atualizado_em, ativo, codigo, nome]` (os mesmos campos públicos da ficha). A projeção JSON da S01 **não mudou**.
- `PATCH` e `situacao` exigem `If-Match` com exatamente uma revisão nesse formato:
  - ausente, `*`, fraca (`W/`), lista ou malformada → **428 `ADMIN_REVISAO_REQUERIDA`**;
  - bem formada mas diferente do estado atual (ficha obsoleta, ou revisão de outro cliente) → **409 `ADMIN_CLIENTE_EDICAO_CONCORRENTE`**.
- A revisão vai **só em cabeçalho**: no corpo é campo desconhecido (400). Ela não carrega tenant nem ator; só compara estado. A autoridade continua sendo o CAS do `UPDATE` no banco.

Regras de formato (validadas no servidor):
- **código:** normalizado em minúsculas, `^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$`;
- **login:** normalizado em minúsculas, `^[a-z0-9._@-]{3,120}$`;
- **nomes:** pelo menos 2 caracteres.

**Erros:**

| Código | HTTP | Quando |
|---|---|---|
| `ADMIN_CLIENTE_CODIGO_DUPLICADO` | 409 | código já usado (checagem prévia ou unique `Cliente.codigo` em corrida) |
| `ADMIN_LOGIN_DUPLICADO` | 409 | login já usado por **conta ativa de qualquer cliente**, inclusive suspenso. Vem do índice parcial `Usuario_login_ativo_global_key` (`lower(login) WHERE ativo`) |
| `ADMIN_CLIENTE_EDICAO_CONCORRENTE` | 409 | (S03-R1) o cliente mudou em outra sessão entre a leitura e a escrita (`PATCH` ou `situacao`). Nada é gravado nem auditado; a tela pede para reabrir e revisar. Nunca é reexecutado automaticamente |
| `ADMIN_REVISAO_REQUERIDA` | 428 | (S03-R2) `If-Match` ausente ou malformado em `PATCH`/`situacao` |
| `ADMIN_ENTRADA_INVALIDA` | 422 | formato inválido, cliente inexistente (mesma resposta da S01), situação repetida |
| `ADMIN_SESSAO_REQUIRED` / `ADMIN_PRINCIPAL_REQUIRED` / `ADMIN_MFA_REQUIRED` / `ADMIN_ORIGEM_RECUSADA` | 401/403 | anônimo, JWT de fazenda, pré-MFA, Origin ou CSRF |

As quatro leituras da S01 (`GET /clientes`, `/clientes/:id`, `/usuarios`, `/empresas`) continuam com o mesmo contrato e a mesma projeção (GES-09).

## 3. Decisões sensíveis

### 3.1 Senha inicial
- **Geração:** gerada no backend com `crypto.randomInt` (CSPRNG). São 16 símbolos de um alfabeto de 57, sem `0 O 1 l I`, cerca de 93 bits, no formato `Xxxx-Xxxx-Xxxx-Xxxx`.
- **Armazenamento:** guardada só como **hash bcrypt**, pelo mesmo `gerarSenhaHash` de `authService` usado no cadastro de usuários.
- **Onde aparece:** **uma única vez**, no corpo do `POST`, com `no-store`.
  - Nunca aparece em GET, auditoria, log, URL, aviso (toast) ou storage.
  - Na interface, fica só no estado React do painel "Cliente cadastrado" e some **da tela** ao confirmar "Já entreguei/guardei".
  - **Área de transferência:** se o proprietário usar "Copiar senha", ela fica na área de transferência do dispositivo, que está fora do controle do app, até ele copiar outra coisa. A interface avisa isso. Não afirmamos que a senha some "de todo lugar".
  - A captura de tela com a senha **não** foi versionada.
- **Não existe troca obrigatória no primeiro login:**
  - o sistema não tem campo nem fluxo para isso;
  - a interface diz isso ao proprietário e orienta a entrega por canal seguro;
  - o administrador troca a senha em Usuários (`PATCH /usuarios/:id` com `senha_atual` e `nova_senha`, fluxo que já existe);
  - a troca forçada e o convite ficam para a S04 (§6).

### 3.2 Primeiro administrador
- **Papel:** `Usuario.papel_tenant = 'administrador'`, a autoridade real da fazenda que `exigirAdminTenant` relê a cada ação.
- **Sem Permissao nem Empresa:** **nenhuma** linha de `Permissao` é criada (`is_admin` não entra nisso) e **nenhuma** `Empresa`. A fazenda é criada depois, pelo fluxo normal do cliente, com fuso e nome.
- **Prova (GES-03):** a senha temporária autentica pelo `/auth/login` normal, o `/auth/contexto` devolve `administrador_fazenda: true` e a conta consegue `POST /usuarios`, que é restrito ao administrador.
- **Mudança de governança:** até a S02, nenhuma rota HTTP gravava `papel_tenant` (só `scripts/auth/papel-tenant.mjs`). Agora o MAIKE Admin, com proprietário e MFA, grava **só o primeiro** administrador, na criação. O comentário de `exigirAdminTenant.js` foi atualizado. Rotas de tenant continuam sem gravar papel.

### 3.3 Atomicidade e corrida
- `Cliente` + `Usuario` + evento de auditoria ficam numa `prisma.$transaction`.
- Há checagem prévia de código e login, para dar mensagem específica.
- **A decisão final é do unique do banco:**
  - duas criações com o mesmo código, ou com o mesmo login, criam **exatamente um** cliente;
  - a perdedora recebe 409, e o rollback não deixa tenant órfão;
  - os dois caminhos do unique foram exercitados no GES-05: `codigo` e `lower(login)`.

### 3.4 Suspensão — efeito comprovado antes de liberar o botão
- **Login novo:** `buscarUsuarioAtivoPorLogin` já filtra `cliente: { ativo: true }`, então cliente suspenso não entra.
- **Tokens já emitidos:** `app.autenticar` (`backend/src/app.js`) relê **a cada requisição** `usuario.ativo` e `cliente.ativo` (PR145-G4). O JWT de um cliente suspenso recebe 401 na hora, sem esperar a expiração.
- **Atualização S04-P1 (D-PROD-143):** o texto abaixo descreve o estado **até o S04-P1**. Desde então a suspensão avança `Cliente.sessao_epoca`, e o mesmo token fica **401 também depois de reativar** (GES-15 e SP-02); ver `MAIKE-SAAS-ADMIN-S04-P1-REVOGACAO-SESSOES.md`.
- **(Histórico, antes do S04-P1) Era bloqueio TRANSITÓRIO, não revogação (S03-R1, GES-15):** o mesmo JWT dá 200 → suspender → 401 → reativar → **200 de novo**, sem novo login, enquanto não expirar (inclusive o TTL maior de "Manter conectado"). Suspender **bloqueia**; não **encerra** sessões. A tela diz isso nos dois sentidos.
  - **Por que não foi corrigido aqui:** revogação permanente exige estado no banco (migration), fora do limite da S03. Lista em memória ou comparação por horário não serve: a Vercel roda várias instâncias.
  - **Proposta (bloqueio para S04 / pré-produção):** coluna `sessao_epoca Int` em `Cliente` (e/ou `Usuario`), gravada no JWT no login e comparada em `app.autenticar` (que já lê as duas linhas a cada requisição, então o custo é zero). Suspender incrementa a época, e todo token anterior morre de vez.
- **Sem outros caminhos:** não existe refresh token, e o único `jwtVerify` do backend é esse.
- **Teste:** GES-08 prova token antigo 401, login novo 401, outro tenant intacto, empresa e usuários preservados, e reativação devolvendo o login.
- **Sem efeito no domínio:** suspender só muda `Cliente.ativo`. Não altera `Usuario.ativo`, não apaga nada e não mexe em estoque, rebanho ou empresa.
- **Logins continuam reservados:** os logins de um cliente suspenso continuam ocupando o índice global (contas ativas), então a reativação não colide com outro tenant.
- **Concorrência:** a mudança é condicional (`updateMany where ativo = atual`), então duas suspensões simultâneas não geram dois eventos. A perdedora recebe 409 `ADMIN_CLIENTE_EDICAO_CONCORRENTE` (antes era 422; GES-14).

### 3.5 Auditoria
- **Tabela:** `EventoSegurancaAdminMaike` (já existe, é `productAdminModels`, sem migration). Ações: `cliente_criar`, `cliente_editar`, `cliente_suspender`, `cliente_reativar`.
- **O que cada evento grava:**
  - `admin_id` da **sessão** (nunca do corpo; GES-10);
  - `request_id` e `ip`;
  - `dados`: `cliente_id`, `antes`, `depois`, `justificativa`, `administrador.{id, login}`.
- **Sem segredos:** nunca grava senha, hash ou dados da fazenda.
- **Por que não `AuditLog`:** ele é tenant-scoped, e o ator é um `Usuario` da fazenda (FK composta). O proprietário não é usuário de fazenda, e forjar um ator ou instalar `auth_context` seria falso. O GES-02 prova que nenhum `AuditLog` é criado.
- **Limitação conhecida:** sem `trustProxy` atrás da Vercel, o `ip` registrado pode sair como loopback (`127.0.0.1`). **Não é IP de origem confiável** até a configuração de proxy ser endurecida e testada na infraestrutura real (pendência da S02).

### 3.6 Concorrência da edição e auditoria (S03-R1)
- **Problema:** `findUnique → update → auditoria` numa transação READ COMMITTED deixava duas edições lerem o mesmo estado e gravarem as duas. O segundo evento registrava um `antes` que já não era o estado real. O RED do GES-11 mostrou dois 200 e dois eventos com o mesmo `antes`.
- **Correção (sem schema):** CAS no próprio `UPDATE`: `updateMany where { id, nome, codigo, updatedAt }` com os valores lidos.
  - Com o lock da linha, o Postgres reavalia o `WHERE` na versão nova, e quem perde recebe `count = 0` → 409, com rollback e sem evento.
  - Logo, o `antes` auditado é o estado imediatamente anterior àquela escrita.
  - `updatedAt` (`@updatedAt`, avançado pelo Prisma em `update`/`updateMany`) entra no CAS para pegar mudanças de `ativo` ou ABA de nome/código.
  - P2034 (conflito/deadlock do banco) também vira 409. P2002 de código segue `ADMIN_CLIENTE_CODIGO_DUPLICADO`.
  - Sem fila em memória e sem retry automático.
- **Provas** (barreira determinística: uma transação à parte segura a linha com `FOR UPDATE`, e as edições só seguem quando o `pg_stat_activity` mostra todas esperando lock):
  - **GES-11:** duas edições (nome×nome e código×nome) → `[200, 409]`, um evento, `antes` = original, `depois` = linha persistida, vizinho intacto;
  - **GES-12:** escrita externa confirmada entre a leitura e o UPDATE → 409, nada gravado, zero eventos; a edição seguinte audita o `antes` real;
  - **GES-13:** dois clientes disputando o mesmo código novo → `[200, 409 CODIGO_DUPLICADO]`, um evento;
  - **GES-14:** duas suspensões → `[200, 409]`, um evento.

#### 3.6.1 CAS intra-requisição × revisão da ficha (S03-R2)
- **Lacuna da R1:** o CAS comparava o `UPDATE` com o que **a própria requisição** acabara de ler. No fluxo normal da tela, A e B abrem a ficha em X, A salva Y, e minutos depois B envia o formulário antigo. A requisição de B lia Y, o CAS passava, e B sobrescrevia Y.
  - **Reproduzido no código da R1:** A 200, B 200, nome final = o do formulário velho de B, dois eventos.
- **Correção:** a revisão que **o navegador** leu (`ETag` do GET) volta em `If-Match` e é comparada, dentro da transação, com o estado lido. Em seguida vem o mesmo CAS do `UPDATE` (agora também na `situacao`: `id`, `ativo`, `nome`, `codigo`, `updatedAt`).
  - Ficha obsoleta → 409, sem gravar nem auditar (GES-16, para edição, suspensão e reativação).
  - Precondição ausente ou malformada → 428 (GES-17).
  - A tela manda o `ETag` da ficha carregada e recarrega a ficha depois de cada escrita.
- **Risco residual (ABA):** como não há contador monotônico (sem migration), a revisão depende de `updatedAt` com precisão de milissegundo. Ela só falharia se o estado fosse X→Y→X com o **mesmo** `updatedAt` em milissegundos e os mesmos campos. Na prática, isso exige duas escritas no mesmo milissegundo que voltem ao estado original. O risco é residual baixo e está registrado; a garantia estrita exige um contador de versão (S04 / pré-produção).

### 3.7 Resposta do cadastro perdida depois do COMMIT (S03-R1)
- **Risco:** o banco pode confirmar o cadastro e a conexão cair antes da resposta. Nesse caso cliente e administrador existem, a senha nunca chegou e reenviar daria 409. Não há idempotência no `POST`.
- **Mitigação na tela (revista na S03-R2):**
  - **Incerto:** rede/timeout (fetch rejeita) ou **qualquer 5xx**, inclusive 500 com `code` do backend, porque a falha pode ter vindo depois do COMMIT. Só 4xx (recusa antes de gravar) continua recuperável.
  - **Ao ficar incerto:**
    - o botão de cadastrar some, o Enter não reenvia e os dados digitados ficam;
    - **nenhuma verificação reabilita o envio**;
    - a tela avisa que Cancelar fecha o formulário mas **não** cancela o pedido no servidor.
  - **"Verificar se o cliente foi criado" / "Verificar novamente"** (só leitura):
    - percorre **todas** as páginas de `GET /clientes?q=<código>` por cursor, até `has_more = false`, procurando o código **exato**;
    - tem teto de 40 páginas e detecta cursor repetido;
    - não muda a projeção nem as rotas da S01.
  - **Resultados da verificação:**
    - **achou:** "já existe cliente com este código". A tela **não** afirma que foi este envio que o criou, não mostra senha e manda não cadastrar outra vez;
    - **não achou:** "não encontramos **ainda**; isso **não** confirma que o pedido original falhou". O envio continua bloqueado;
    - **página falhou, cursor repetido ou teto atingido:** **inconclusivo**, e o envio continua bloqueado.
  - **Por que nada é definitivo:** o POST original pode ainda estar em execução quando o GET roda. Sem chave de idempotência persistida, não há como provar que a criação não aconteceu, e a tela não simula essa certeza.
  - **Se não existe de fato:** o operador cancela e cadastra de novo. Se o primeiro POST tiver comitado nesse meio-tempo, o unique de código/login devolve 409 e não duplica.
- **Reproduzido no código da R1:**
  - um GET negativo com o POST em andamento reabilitava o envio e dizia "não foi concluído";
  - a busca olhava só a 1ª página (código exato na 2ª página = falso negativo);
  - "foi criado" afirmava causalidade;
  - 500 com `code` era tratado como recuperável.
  - Testes de tela R2: 7 falhas no código R1, 11/11 depois.
- **Limitação operacional:** um cliente nessa situação fica sem senha conhecida até existir **recuperação/reset da credencial inicial** ou um **POST idempotente com chave persistida** (S04 / pré-produção). **Onboarding de produção bloqueado até lá.**

## 4. Interface (`apps/admin/src/telas/Clientes.jsx`)

- **"Cadastrar cliente":**
  - nome, código (sugerido a partir do nome, sem acentos, editável) e o administrador (nome e login);
  - botão com estado ocupado, que impede clique duplo;
  - erro recuperável mantém o que foi digitado.
- **Sucesso:** painel com login e senha inicial, botão **Copiar senha** e o aviso de entrega segura. Ao fechar, a lista recarrega e a ficha do novo cliente abre.
- **Ficha:**
  - **Editar identificação:** envia só o que mudou; código duplicado aparece de forma recuperável.
  - **Suspender / Reativar cliente:** painel que explica o efeito real, com justificativa obrigatória (o botão fica desabilitado com menos de 10 caracteres). A ficha e a lista se atualizam depois.
- **Proibições que continuam:** não existe botão de excluir, entrar como cliente ou senha (testes jsdom).
- **Celular:** a lista virou cartões com o rótulo de cada campo (`td[data-rotulo]`), sem rolagem horizontal (E2E em 390 px).

## 5. Configurações globais × da fazenda

| Onde | O quê | Quem edita |
|---|---|---|
| **MAIKE Admin** (`apps/admin`, global do produto) | catálogo global de ícones, tipos e categorias, regras MISTO; cadastro, identificação e situação dos **clientes**; conta do proprietário | proprietário (MFA) |
| **SPA dos clientes** (`src/`, tenant-scoped) | empresas da fazenda (fuso, dados), usuários e permissões da fazenda, mapa, rebanho, estoque, configurações de ícone da própria fazenda | administrador ou usuários da fazenda |

Nada do catálogo foi movido ou duplicado nesta missão.

## 6. Extensibilidade (só documentação; nada implementado)

- **Autocadastro / Google (futuro):**
  - **Entidades:** as mesmas `Cliente` e `Usuario`.
  - **Identidade externa:** uma tabela tenant-scoped, por exemplo `IdentidadeExternaUsuario { cliente_id, usuario_id, provedor, sujeito }`, com unique em `(provedor, sujeito)`. Ela vincula `sub` verificado ao `Usuario`, sem substituir login e senha.
  - **Tenant:** continua vindo só do `auth_context`, emitido depois da verificação do token do provedor no servidor. Nunca de parâmetro do navegador.
  - **Autocadastro:** criaria `Cliente` + `Usuario` administrador pelo **mesmo** `criarCliente`, sem senha, com identidade externa, e passaria pela mesma auditoria.
- **Convite (S04):**
  - **Modelo:** um `ConviteUsuario { cliente_id, login, token_hash, expira_em, usado_em }`, com token aleatório guardado só como hash.
  - **Ativação:** o convidado define a própria senha.
  - **Efeito:** substitui a senha temporária e permite a troca obrigatória.
- **S04 — gestão de usuários do cliente pelo Admin:** listar, criar, editar, desativar e resetar, convites, papéis e riscos de recuperação, sempre com trilha. Os fluxos de usuários da fazenda continuam como estão.

## 7. Rollback

- **Código:** reverter a PR remove as três rotas de escrita e a interface. Os dados já criados continuam válidos: são `Cliente`/`Usuario` normais.
- **Banco:** nenhuma migration, nenhuma mudança de schema. Não há rollback de banco.
- **Desfazer um cadastro errado:** suspender o cliente, sem exclusão física, por desenho. Se for preciso apagar de fato, isso exige operação de banco autorizada à parte.
- **Desfazer uma suspensão:** reativar. Contas e dados nunca foram alterados.

## 8. Evidências

- **S03-R1:** GES-11..15 (backend) e 3 testes novos de tela. RED com o código anterior: GES-11, GES-12 e GES-14 falharam (dois 200; 200 em vez de 409); GES-13 e GES-15 já passavam (o comportamento existia e agora está provado). Os 3 testes de tela novos falharam, e o de suspensão também, pelo texto. GREEN: 15/15 e 8/8.
- **Testes de backend** (PostgreSQL local descartável): `backend/tests/adminClientesGestao.test.mjs`, GES-01..10.
  - **RED no `main`:** 0/10, com rotas inexistentes (esperado 401/201, veio 404).
  - **GREEN na branch:** 10/10.
- **Suíte da S01:** `adminClientesConsulta` CLI-03 foi ajustado. Agora prova que `POST` e `PATCH` com `ativo` no corpo recebem 400, e que não existem exclusão, impersonação nem `PUT`.
- **Testes de tela:** `tests/smoke/maikeAdminClientesGestao.test.jsx` (5), mais `maikeAdminClientes` (5, ajustado) e `maikeAdmin` (11) verdes.
- **E2E no navegador** (Playwright, backend local + `vite preview`):
  - cadastro pelo formulário, com o código sugerido `fazenda-tres-lagoas`;
  - a senha inicial autentica no `/auth/login` (200);
  - edição;
  - suspensão: token anterior 401 e login 401;
  - reativação: login 200;
  - a senha some da tela depois de fechar, e não aparece em URL nem em storage;
  - celular sem rolagem horizontal.
  - Capturas em `docs/engineering/evidencias/admin-s03/` (sem a da senha).
- **E2E S03-R1** (mesmo roteiro, tela nova):
  - **mesmo JWT após reativar: 200** (bloqueio transitório confirmado no navegador real);
  - **resposta cortada depois do commit** (`route.fetch()` seguido de `abort('connectionreset')`): 1 único POST, aviso de resultado incerto, botão de cadastrar ausente, a verificação encontra o cliente e diz que a senha não pode ser mostrada de novo;
  - suspensão em 390 px sem rolagem horizontal.
  - Capturas novas: `s03-6-cadastro-incerto.png`, `s03-7-cadastro-incerto-verificado.png`, `s03-8-mobile-suspender.png`. As anteriores foram regeradas com os textos novos. Nenhuma mostra senha; a do painel de senha é gerada só no scratchpad e apagada.

## 9. Integração com o main pós-PR #211 (S03-R2)

- **Resultado do `verify:all` na combinação (`main` 157ef2a0 + S03-R2):**
  - backend 1054/1059 (5 todo, 0 falhas);
  - telas: 1557/1558.
- **Única falha:** `tests/smoke/appShell.test.jsx` › SHELL2b. Ela é **herdada do `main`**: o CI `quality` de `157ef2a0` já está vermelho (run 42243418074) e a falha reproduz idêntica num worktree do `main` puro.
  - **Causa:** a #211 trocou `DialogContent`/`SheetContent` em `MapaGeral.jsx` por `LancLoteDialogo`, e o teste ainda procura os nomes antigos.
  - **Fora do escopo S03:** não foi corrigida aqui. Há uma proposta de patch no comentário da PR #215.
- **E2E na combinação** (backend local + build do admin, banco descartável):
  - **ficha obsoleta em duas abas:** a aba 2 salva, a aba 1 recebe "alterado em outra sessão e nada foi salvo" (`s03-9-ficha-obsoleta.png`);
  - **cadastro incerto:** sem senha na tela, sem afirmar causalidade, 1 único POST;
  - **demais itens:** a semântica do token e o 390 px seguem como antes.
- **Varredura de segredos depois do E2E:**
  - log da API: 0 hashes bcrypt. O único trecho com formato de senha era parte de um `request_id` (UUID), um falso positivo;
  - `EventoSegurancaAdminMaike`: 0 eventos com senha ou hash, nas ações `cliente_*`;
  - URL e storage sem senha;
  - captura do painel de senha não versionada.

- O `main` foi integrado à mesma branch por **merge normal** (sem rebase nem force-push), e a combinação foi validada com `verify:all` completo, localmente e no CI. Os SHAs estão no relatório da missão e na PR #215.
- Não havia arquivos em comum com a #211. `src/App.jsx` e `DECISIONS.md` não foram tocados pela #215.

## 10. Gates de decisão

| Decisão | Estado |
|---|---|
| **CODE_READY** (auditoria do código S03 + R1 + R2) | pronto para revisão do arquiteto-chefe |
| **OPERATIONAL_RELEASE_READY** (onboarding em produção) | **NO-GO** até existirem: (1) troca obrigatória da senha inicial ou convite; (2) recuperação do primeiro acesso / POST idempotente; (3) ~~revogação permanente de sessões na suspensão~~ — feita no S04-P1 (D-PROD-143); e as pendências da S02 (variáveis do admin em produção, IP confiável atrás do proxy, limite de tentativas fora da memória) |
