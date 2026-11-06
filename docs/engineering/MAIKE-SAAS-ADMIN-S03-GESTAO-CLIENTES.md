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
| `PATCH /admin-maike/clientes/:id` | `{ nome?, codigo? }` (pelo menos 1) | 200 `{ cliente }` |
| `POST /admin-maike/clientes/:id/situacao` | `{ ativo: boolean, justificativa: string(10..500) }` | 200 `{ cliente }` |

Regras de formato (validadas no servidor):
- **código:** normalizado em minúsculas, `^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$`;
- **login:** normalizado em minúsculas, `^[a-z0-9._@-]{3,120}$`;
- **nomes:** pelo menos 2 caracteres.

**Erros:**

| Código | HTTP | Quando |
|---|---|---|
| `ADMIN_CLIENTE_CODIGO_DUPLICADO` | 409 | código já usado (checagem prévia ou unique `Cliente.codigo` em corrida) |
| `ADMIN_LOGIN_DUPLICADO` | 409 | login já usado por **conta ativa de qualquer cliente**, inclusive suspenso. Vem do índice parcial `Usuario_login_ativo_global_key` (`lower(login) WHERE ativo`) |
| `ADMIN_ENTRADA_INVALIDA` | 422 | formato inválido, cliente inexistente (mesma resposta da S01), situação repetida |
| `ADMIN_SESSAO_REQUIRED` / `ADMIN_PRINCIPAL_REQUIRED` / `ADMIN_MFA_REQUIRED` / `ADMIN_ORIGEM_RECUSADA` | 401/403 | anônimo, JWT de fazenda, pré-MFA, Origin ou CSRF |

As quatro leituras da S01 (`GET /clientes`, `/clientes/:id`, `/usuarios`, `/empresas`) continuam com o mesmo contrato e a mesma projeção (GES-09).

## 3. Decisões sensíveis

### 3.1 Senha inicial
- **Geração:** gerada no backend com `crypto.randomInt` (CSPRNG). São 16 símbolos de um alfabeto de 57, sem `0 O 1 l I`, cerca de 93 bits, no formato `Xxxx-Xxxx-Xxxx-Xxxx`.
- **Armazenamento:** guardada só como **hash bcrypt**, pelo mesmo `gerarSenhaHash` de `authService` usado no cadastro de usuários.
- **Onde aparece:** **uma única vez**, no corpo do `POST`, com `no-store`.
  - Nunca aparece em GET, auditoria, log, URL, aviso (toast) ou storage.
  - Na interface, fica só no estado React do painel "Cliente cadastrado" e some ao confirmar "Já entreguei/guardei".
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
- **Sem outros caminhos:** não existe refresh token, e o único `jwtVerify` do backend é esse.
- **Teste:** GES-08 prova token antigo 401, login novo 401, outro tenant intacto, empresa e usuários preservados, e reativação devolvendo o login.
- **Sem efeito no domínio:** suspender só muda `Cliente.ativo`. Não altera `Usuario.ativo`, não apaga nada e não mexe em estoque, rebanho ou empresa.
- **Logins continuam reservados:** os logins de um cliente suspenso continuam ocupando o índice global (contas ativas), então a reativação não colide com outro tenant.
- **Concorrência:** a mudança é condicional (`updateMany where ativo = atual`), então duas suspensões simultâneas não geram dois eventos.

### 3.5 Auditoria
- **Tabela:** `EventoSegurancaAdminMaike` (já existe, é `productAdminModels`, sem migration). Ações: `cliente_criar`, `cliente_editar`, `cliente_suspender`, `cliente_reativar`.
- **O que cada evento grava:**
  - `admin_id` da **sessão** (nunca do corpo; GES-10);
  - `request_id` e `ip`;
  - `dados`: `cliente_id`, `antes`, `depois`, `justificativa`, `administrador.{id, login}`.
- **Sem segredos:** nunca grava senha, hash ou dados da fazenda.
- **Por que não `AuditLog`:** ele é tenant-scoped, e o ator é um `Usuario` da fazenda (FK composta). O proprietário não é usuário de fazenda, e forjar um ator ou instalar `auth_context` seria falso. O GES-02 prova que nenhum `AuditLog` é criado.
- **Limitação conhecida:** sem `trustProxy` atrás da Vercel, o `ip` registrado sai como `127.0.0.1` (risco já registrado na S02).

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
