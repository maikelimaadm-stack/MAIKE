# MAIKE-SAAS-ADMIN-S01 — Painel do proprietário: Clientes (consulta, sem faturamento)

> Decisão própria desta missão, registrada aqui e **não** em `DECISIONS.md`. Esse arquivo é editado pela PR #212, que está aberta; o registro como `D-PROD-*` fica para a integração depois dela.
> Base: `origin/main` = `4c530979b584a54002f2a299c9af2fe347a6b449`, com CI `verify:all` verde.

## 1. O que entrou

O app `apps/admin` ganhou a aba **Clientes**, somente leitura. Ela tem:
- lista paginada com busca por nome ou código e filtro de situação;
- ficha de cada cliente com identidade, datas e contagens;
- lista paginada das empresas e dos usuários do cliente.

As abas Ícones, Tipos e categorias, Regras MISTO, Validação e Minha conta continuam iguais.

### Endpoints (todos `GET`, todos com a guarda `verificada` = `exigirSessaoAdmin()` com MFA concluído)

| Rota | Filtros | Resposta |
|---|---|---|
| `GET /admin-maike/clientes` | `q` (nome ou código, sem diferenciar maiúsculas, ≤ 120), `ativo` (`true`/`false`), `limit` (1–50, padrão 25), `cursor` | `{ items: [{ id, codigo, nome, ativo, criado_em, usuarios_total, empresas_total }], next_cursor, has_more, total, limit }` |
| `GET /admin-maike/clientes/:id` | nenhum | `{ cliente: { id, codigo, nome, ativo, criado_em, atualizado_em }, contagens: { usuarios, usuarios_ativos, empresas } }` |
| `GET /admin-maike/clientes/:id/usuarios` | `limit`, `cursor` | envelope com `{ id, nome, login, ativo, criado_em }` |
| `GET /admin-maike/clientes/:id/empresas` | `limit`, `cursor` | envelope com `{ id, numero_empresa, nome, apelido, criado_em }` |

Regras comuns aos quatro endpoints:
- **Parâmetros:** `additionalProperties: false` na query e nos params. Parâmetro desconhecido, como `cliente_id` ou `debug`, é recusado com 400 `REQUEST_VALIDATION_FAILED`.
- **Formato do `:id`:** `^[A-Za-z0-9_-]{1,64}$`, o formato da coluna.
- **Ordem e paginação:** ordem estável `createdAt DESC, id DESC`, com keyset (o mesmo `keysetCursor.js` de `GET /usuarios/page`). `total` vem só na primeira página.
- **Sem N+1:** as contagens da lista vêm de um único `findMany` com `_count`.

### Dados autorizados (matriz)

| Model | Devolvido | Nunca devolvido |
|---|---|---|
| `Cliente` | `id`, `codigo`, `nome`, `ativo`, `createdAt`, `updatedAt` | relações operacionais (rebanho, estoque, mapa…) |
| `Usuario` | `id`, `nome`, `login`, `ativo`, `createdAt` | `senha_hash`, `papel_tenant` (não autorizado expressamente) |
| `Empresa` | `id`, `numero_empresa`, `nome`, `apelido`, `createdAt` | `cpf`, `rg`, `cnpj`, `inscricao_estadual`, `telefone`, `email`, `endereco`, `cidade`, `estado`, `cep`, `logotipo_url`, `observacoes`, `fuso_horario` |
| `Permissao` | nada | tudo (inclusive `is_admin`) |

`Empresa` não tem coluna `ativo`, por isso a lista não tem filtro de situação de empresa. Não houve mudança de model nem migration.

### Autorização

- Só passa a sessão do proprietário (`AdminPrincipalMaike.papel = proprietario`) com `mfa_verificado`. Em qualquer outro caso a requisição é recusada antes da validação dos parâmetros:
  - sem cookie: 401 `ADMIN_SESSAO_REQUIRED`;
  - JWT de fazenda (operador, administrador da fazenda ou conta com `Permissao.is_admin`): 403 `ADMIN_PRINCIPAL_REQUIRED`;
  - sessão antes do MFA: 403 `ADMIN_MFA_REQUIRED`;
  - cookie forjado, revogado ou expirado: 401.
- O `:id` é só o alvo da consulta. Nenhuma rota instala `auth_context` nem abre sessão de fazenda, e não existe rota para editar, ativar, entrar como cliente ou trocar de tenant. As consultas filhas usam o `cliente_id` do registro confirmado no banco, e o cursor só avança dentro daquele cliente.
- Um id inexistente e um id bem formado mas desconhecido têm a **mesma resposta**: 422 `ADMIN_ENTRADA_INVALIDA` "cliente não encontrado". Assim a resposta não revela quais ids existem.
  - O código usado já existia, porque `errorCodes.js` está na PR #212.
  - Na integração, avaliar um `ADMIN_CLIENTE_NOT_FOUND` (404).
- **Sem evento de auditoria por leitura.** O GET continua sem efeito colateral. A única exceção é o `ultimo_uso_em` da sessão admin, que a guarda já atualizava antes desta missão, no máximo uma vez por minuto.

### Arquivos

**Backend**
- `backend/src/modules/adminMaike/adminClientesService.js`: novo.
- `backend/src/modules/adminMaike/adminRoutes.js`: registra as 4 rotas.

**Frontend**
- `apps/admin/src/telas/Clientes.jsx`: novo.
- `apps/admin/src/App.jsx`: aba nova.
- `apps/admin/src/api.js`: 4 chamadas GET.
- `apps/admin/src/estilo.css`: estilos da ficha.

**Testes**
- `backend/tests/adminClientesConsulta.test.mjs`: CLI-01..10.
- `tests/smoke/maikeAdminClientes.test.jsx`: 5 testes jsdom.

Esta PR não toca nos arquivos das PRs #209–#212.

## 2. Publicação em `www.makgestao.com/paineladm` — decisão documentada, **não executada**

### Estado observado em 2026-11-06 (somente leitura)

- **`www.makgestao.com/paineladm` não está publicado:** responde 404 da Vercel.
- **Não existe projeto Vercel do admin:** o time tem `maike`, `controle-de-estoque` e `projetomg`. O `apps/admin/vercel.json` e o guia `MAIKE-ADMIN-COLOCAR-NO-AR.md` descrevem um projeto próprio, ainda não criado.
- **A API do admin em produção está desligada:** `GET /api/native/admin-maike/sessao` responde 503 `ADMIN_INDISPONIVEL`. Falta configurar `ADMIN_MAIKE_CHAVE` e `ADMIN_ORIGINS` no projeto `maike`, e o backend falha fechado.

### Alternativa A — `admin.makgestao.com` (origin própria)

- **Deploy:** projeto Vercel `maike-admin` com raiz `apps/admin`, como já descreve o `vercel.json` do admin. O rewrite `/api/native/*` vai para a API e o fallback SPA vai para `index.html`.
- **Cookie:** o `__Host-maike_admin` (`Secure`, `Path=/`, `SameSite=Strict`) nasce na origin `admin.makgestao.com`. A SPA dos clientes, que está em `www.`, nunca recebe nem envia esse cookie.
- **Origem e CSRF:** `ADMIN_ORIGINS=https://admin.makgestao.com`.
- **CSP:** o admin mantém a sua CSP estrita (`connect-src 'self'`, `frame-ancestors 'none'`) sem depender da CSP da SPA.
- **Isolamento:** uma falha de XSS na SPA dos clientes **não** alcança a sessão do proprietário. O `gate:admin-isolation` (código e bundle) continua valendo como hoje.
- **Mudanças necessárias:** um projeto Vercel, um registro DNS (CNAME `admin`) e as variáveis do projeto `maike`. Nenhuma mudança de código.

### Alternativa B — `www.makgestao.com/paineladm` (caminho pedido)

É possível, mas exige mudanças:
1. **Base do build:** no Vite do admin, `base: '/paineladm/'`, com os assets em `/paineladm/assets/*`.
2. **Build único:** o build da SPA dos clientes passa a copiar `apps/admin/dist` para `dist/paineladm`, ou o projeto `maike` vira um monorepo com rewrite para outro deploy.
3. **Rewrite:** `vercel.json` da raiz com `/paineladm/(.*)` → `/paineladm/index.html`.
   - **Lacuna do gate:** o `gate:admin-isolation` ADM-05 procura só `catalogoglobal`, `admin-maike` e `maikeadmin` no `vercel.json` da raiz. Um rewrite `/paineladm` **passaria sem ser visto**.
   - **O que seria preciso:** ampliar a regra e, ao mesmo tempo, abrir exceção para o próprio admin dentro do projeto dos clientes. É o sinal de que o isolamento enfraquece.
4. **CSP:** a CSP do admin teria de coexistir com a da SPA no mesmo projeto, com regras de `headers` por caminho.
5. **Cookie no mesmo domínio da SPA:**
   - **O risco:** o cookie do admin passaria a ser *first-party* do mesmo domínio da SPA. O CSRF só protege mutações. Um XSS em qualquer página de `www.makgestao.com` poderia fazer `fetch('/api/native/admin-maike/clientes')` com o cookie do proprietário e **ler dados de todos os clientes**.
   - **Por que reduzir o caminho não resolve:** restringir o cookie a `Path=/paineladm` exigiria proxy da API em `/paineladm/api/native`. Mas um script na mesma origin ainda chega a esse caminho.

### Recomendação

Recomendo a **A**, mais um **redirecionamento** de `www.makgestao.com/paineladm` para `https://admin.makgestao.com`:
- é um `redirect` 308 no `vercel.json` da raiz, sem servir nada do admin ali;
- na mesma PR, o ADM-05 passa a reprovar *rewrite* de `/paineladm` e a aceitar só o *redirect*, fechando a lacuna descrita na alternativa B.

O proprietário continua digitando o endereço que pediu, e a sessão continua numa origin isolada. A decisão é dele: se preferir a B, o runbook abaixo vale com os passos 1–5 da B e os testes extras da seção 3.

### Runbook da publicação futura (A + redirect) — NÃO executado

1. No projeto `maike` (Vercel → Settings → Environment Variables, Production), conferindo só presença:
   - `ADMIN_MAIKE_CHAVE`: ≥ 32 caracteres aleatórios;
   - `ADMIN_ORIGINS=https://admin.makgestao.com`.
2. Fazer o redeploy do projeto `maike` e conferir que `GET /api/native/admin-maike/sessao` deixou de responder 503.
3. Criar o projeto `maike-admin` (raiz `apps/admin`) e o domínio `admin.makgestao.com` (CNAME na zona DNS).
4. Fazer o primeiro acesso pela web (D-PROD-78) e a inscrição obrigatória do MFA.
5. Abrir uma PR própria com o redirect `/paineladm` → `https://admin.makgestao.com` e o ajuste do ADM-05 (reprova rewrite de `/paineladm`, aceita só o redirect).
6. Gates da publicação:
   - `gate:admin-isolation` e `admin-isolation:bundles` verdes;
   - o cookie `__Host-maike_admin` só aparece em `admin.makgestao.com`;
   - `www.` com JWT de fazenda recebe 403 em `/api/native/admin-maike/clientes`;
   - a CSP do admin está presente.

## 3. Testes e evidências (PostgreSQL local descartável)

**Backend** — `node --test backend/tests/adminClientesConsulta.test.mjs`: 10/10.

Casos positivos:
- CLI-04: lista com contagens e projeção exata.
- CLI-05: busca por nome e código, filtro `ativo`, lista vazia.
- CLI-06: 7 clientes, 3 páginas de 3, dois pares com o mesmo `createdAt`, sem repetir nem pular.
- CLI-07: ficha e filhos sem misturar outro cliente, sem CPF/CNPJ/e-mail/telefone.
- CLI-08: cliente sem filhos.

Casos negativos:
- CLI-01: anônimo, JWT de operador com `is_admin`, administrador da fazenda.
- CLI-02: pré-MFA, cookie forjado, revogado e expirado.
- CLI-03: POST, PATCH, PUT e DELETE, "entrar" e "ativar" não existem (404), e o cliente fica intacto.
- CLI-09: id inexistente e malformado, `limit` fora do teto, `ativo` inválido, parâmetro extra, cursor adulterado, cursor de outro contexto.

Prova de ausência de escrita:
- CLI-10 fotografa `Cliente`, `Usuario`, `Empresa`, `Permissao`, `AuditLog`, `SessaoAdminMaike` (sem `ultimo_uso_em`), `EventoSegurancaAdminMaike` e `AdminPrincipalMaike` antes e depois de 21 GETs (admin, anônimo e JWT). As fotos são idênticas.

**Frontend** — `tests/smoke/maikeAdminClientes.test.jsx`: 5/5.
- Lista, busca e situação viram query; "Carregar mais" acrescenta sem repetir.
- Erro recuperável e lista vazia.
- Ficha com empresas e usuários paginados.
- A tela não tem nenhum botão de editar, ativar, excluir, entrar como ou senha, nem campo sensível. Só faz GET, sem CSRF.
- Troca rápida de cliente descarta a resposta atrasada.
- As abas antigas continuam na ordem; um 401 durante a consulta volta ao login.
- Os 11 testes antigos de `maikeAdmin.test.jsx` continuam verdes.

**Build e gates:** `build:admin`, `gate:admin-isolation`, `gate:tenancy`, `gate:types`, lint e `verify:all` (resultado no relatório da PR).

## 4. Riscos e pendências

- **Contagem da lista:** `cliente.count` com `q` usa `ILIKE '%…%'`. Isso é aceitável para dezenas ou centenas de clientes. Para milhares, avaliar um índice trigram, com migration própria.
- **Ordenação:** `Cliente` não tem índice `(createdAt, id)`, então a ordenação é por varredura. Com poucos clientes é irrelevante; registrar se crescer.
- **Código 404 dedicado:** 422 em vez de 404 para cliente inexistente, até a integração com `errorCodes.js`.
- **Fora do escopo:** planos, cobrança, ativação e impersonação, por decisão da missão.
