# MAIKE-ADMIN-S02 — Publicação do MAIKE Admin em `admin.makgestao.com`

Este runbook prepara a publicação, mas **ainda não a executa**. Cada passo marcado como 👤 é feito pelo proprietário no painel da Vercel. Nenhum valor de segredo aparece aqui.

Base: `main` = `7a95b8c5dcccdbb78dab8a5b204cc4b3741d5981` (PR #213, aba Clientes).
URL aprovada pelo proprietário: `https://admin.makgestao.com`. O admin fica numa origin própria e **não** é embutido em `www.makgestao.com/paineladm` (ver S01 §2).

## 1. Estado verificado em 2026-11-06 (somente leitura)

| Item | Evidência | Situação |
|---|---|---|
| Domínio `makgestao.com` | Vercel → domínio da equipe, nameservers `ns1/ns2.vercel-dns.com`, `verified: true` | ✅ zona DNS gerenciada pela Vercel |
| DNS de `admin.makgestao.com` | registro curinga `*` ALIAS → `cname.vercel-dns-016.com` (gerenciado pela Vercel) | ✅ já resolve para a Vercel, **sem precisar de DNS novo** |
| `https://admin.makgestao.com` | `404 DEPLOYMENT_NOT_FOUND` | ❌ nenhum projeto ligado ao nome |
| Projeto Vercel do admin | projetos da equipe: `maike`, `controle-de-estoque`, `projetomg` | ❌ não existe |
| Backend `maike` | `GET https://www.makgestao.com/api/native/health` → 200 | ✅ |
| API do admin em produção | `GET /api/native/admin-maike/sessao` → `503 ADMIN_INDISPONIVEL` | ❌ desligada (falha fechada) |
| `ADMIN_MAIKE_CHAVE` (projeto `maike`) | lista de variáveis, só nomes | ❌ ausente |
| `ADMIN_ORIGINS` (projeto `maike`) | idem | ❌ ausente |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (projeto `maike`) | idem | ✅ presentes, alvo Production (upload de ícones) |
| Domínios do projeto `maike` | `www.makgestao.com` (principal), `makgestao.com` (308 → www), `maike-five.vercel.app` | ✅ |

## 2. O que esta PR muda (e por quê)

Só `apps/admin/vercel.json` muda:

1. **Destino do rewrite** `/api/native/:path*`: deixa de ser `https://maike-five.vercel.app` e passa a ser `https://www.makgestao.com`.
   - **Por quê:** o projeto `maike` já usou a Deployment Protection "Standard: todos exceto domínios próprios". Nesse modo, `*.vercel.app` fica protegido e o domínio próprio não. Se a proteção voltar a ser ligada, o admin com o destino antigo receberia a tela de login da Vercel no lugar da API e pararia de funcionar.
   - **O que não muda:** o domínio próprio é o mesmo deploy de produção; método, corpo, `Origin`, `Cookie` e `Set-Cookie` continuam passando pelo proxy.
2. **`Cache-Control: no-store`** em `/api/native/(.*)`: as respostas carregam sessão, CSRF e dados de clientes, e nunca devem ficar em cache no navegador ou na borda.

O resto já estava correto e **não muda**:
- build próprio, sem a SPA dos clientes;
- CSP estrita;
- `X-Frame-Options: DENY`;
- `noindex`;
- HSTS;
- fallback SPA que não captura `/api/native`.

O teste `tests/smoke/adminVercelConfig.test.js` (ADM-DEPLOY-01..04) trava essas regras.

## 3. Arquitetura publicada

```
navegador ──https──▶ admin.makgestao.com (projeto Vercel "maike-admin", estático)
                       │  /            → dist/index.html (SPA do admin)
                       │  /assets/*    → dist/assets/* (hash no nome)
                       │  /api/native/* ──rewrite externo──▶ https://www.makgestao.com/api/native/*
                       ▼                                       (projeto "maike": Fastify serverless)
                 cookie __Host-maike_admin  ◀── Set-Cookie repassado pelo proxy
```

**Cookie** (`backend/src/modules/adminMaike/adminSessao.js`):
- Em produção (`NODE_ENV=production`, que a Vercel define) o nome é `__Host-maike_admin`, com `Secure; HttpOnly; SameSite=Strict; Path=/` e **sem `Domain`**. O navegador guarda o cookie só para `admin.makgestao.com`.
- `www.makgestao.com` nunca recebe esse cookie: a SPA dos clientes não carrega a sessão do proprietário.

**Origin e CSRF:**
- Login e mutações exigem `Origin` presente em `ADMIN_ORIGINS`.
- Mutações também exigem o cabeçalho `x-maike-admin-csrf`, com o HMAC da sessão.
- O rewrite externo repassa o `Origin` do navegador (`https://admin.makgestao.com`). O `Host` muda para `www.makgestao.com`, mas a guarda não usa o `Host`.

**MFA:**
- TOTP obrigatório antes de qualquer rota além das de MFA (`exigirSessaoAdmin()`). A pré-sessão dura 10 minutos.
- A sessão verificada dura 8 h, com ociosidade de 30 min (`ADMIN_SESSAO_HORAS`, `ADMIN_SESSAO_OCIOSA_MINUTOS`).

**Rate limit:**
- Por conta: persistido no banco (`tentativas_falhas`, `bloqueado_ate`).
- Por IP: em memória do processo.

## 4. Runbook de publicação (👤 = proprietário; nada disso foi executado)

### Passo 0 — antes de começar
- [ ] Esta PR (S02) mesclada na `main`, com CI `verify:all` verde no merge.
- [ ] Gerenciador de senhas aberto, para gerar e guardar a `ADMIN_MAIKE_CHAVE`.

### Passo 1 👤 — variáveis no projeto **`maike`** (o backend)
Vercel → projeto **maike** → Settings → Environment Variables:

| Nome | Valor | Tipo | Ambiente |
|---|---|---|---|
| `ADMIN_MAIKE_CHAVE` | ≥ 40 caracteres aleatórios, sem espaço, gerados no gerenciador de senhas | **Sensitive** | **somente Production** |
| `ADMIN_ORIGINS` | `https://admin.makgestao.com` (sem barra final) | Plain | **somente Production** |

Cuidados com as variáveis:
- **Ambiente "somente Production":** as prévias do `maike` usam o mesmo banco de produção e estão sem a Deployment Protection. Sem a chave nas prévias, a API admin delas continua em 503, falha fechada.
- **Onde as variáveis não entram:**
  - nunca no projeto `maike-admin`: o admin é estático e não lê segredo;
  - nunca em variável `VITE_*`, que iria para o bundle;
  - nunca em chat ou no repositório.
- **A chave não é trocável à toa:** ela cifra o segredo do autenticador (MFA) e assina o CSRF. Se for trocada, o MFA do proprietário deixa de valer; nesse caso, ver o §6.

Em seguida: **Deployments → último deploy de Production → Redeploy**.

Conferência, sem segredo:
- `curl -s https://www.makgestao.com/api/native/admin-maike/primeiro-acesso` deve responder `{"disponivel":true}`, em vez de 503.

### Passo 2 👤 — criar o projeto **`maike-admin`**
Vercel → Add New → Project → repositório `maikelimaadm-stack/MAIKE`:

| Campo | Valor |
|---|---|
| Project Name | `maike-admin` |
| Root Directory | `apps/admin` |
| Framework Preset | Other (o `apps/admin/vercel.json` já define `framework: null`) |
| Build / Install / Output | **deixar em branco**: vêm do `apps/admin/vercel.json` (`npm ci --prefix ../..`, `npm run build:admin --prefix ../..`, `dist`) |
| "Include files outside the root directory" | **ligado** (padrão), necessário para o `npm ci` na raiz do monorepo |
| Production Branch | `main` |
| Environment Variables | **nenhuma** |

Em Settings → Deployment Protection:
- **Standard Protection** (Vercel Authentication em tudo, exceto domínios próprios).
- As prévias do admin ficam atrás do login da Vercel.
- O domínio `admin.makgestao.com` fica aberto, protegido pelo login e MFA do MAIKE.

Depois do primeiro deploy, abra a URL `*.vercel.app` gerada. Ela fica protegida pela Vercel; entrando com a sua conta Vercel, deve aparecer a tela "Entrar" do MAIKE Admin. Nessa URL, o login responde "origem não autorizada", e **isso está correto**: só `admin.makgestao.com` está em `ADMIN_ORIGINS`.

### Passo 3 👤 — domínio
Projeto `maike-admin` → Settings → Domains → Add → `admin.makgestao.com`, no ambiente Production.
- A zona é da própria equipe na Vercel e o registro curinga já aponta para a Vercel. Por isso, **não é preciso criar registro DNS**: a verificação é automática e o certificado é emitido em minutos.
- Não adicione `admin.makgestao.com` ao projeto `maike`.

### Passo 4 👤 — primeiro acesso e MFA
1. Abra `https://admin.makgestao.com` e aguarde a tela **Primeiro acesso**.
2. Cole a `ADMIN_MAIKE_CHAVE`, defina o login e uma senha (≥ 12 caracteres) e clique em **Criar proprietário**.
3. Entre e cadastre o autenticador. Guarde os 10 códigos de recuperação fora do computador.
4. Abra a aba **Clientes**: a lista deve mostrar os clientes reais, somente leitura.

### Passo 5 — verificação pós-publicação (pode ser feita por mim, só leitura)

Primeiro, o smoke automático, sem credencial. O único POST é um login com usuário aleatório inexistente:

```bash
node scripts/admin/smoke-admin-deploy.mjs --url https://admin.makgestao.com
```

Ele precisa terminar com todas as linhas `PASS`: página, CSP, X-Frame-Options, noindex, HSTS, proxy, `no-store`, Origin aceita, API de tenant fechada e bundle sem credencial.

| Estado | Resultado do smoke |
|---|---|
| **Hoje (antes da publicação)** | 9 FAIL: `404` (sem projeto), `cache-control: public, max-age=0, must-revalidate` (resposta da Vercel, não da API). É o estado esperado de NO-GO. |
| **Local** (`--url http://localhost:5174 --permitir-http`, `vite preview` + backend local) | proxy, Origin, login genérico, API de tenant e bundle: PASS. CSP, X-Frame-Options e noindex: FAIL, porque o `vite preview` não aplica o `vercel.json`. Esse trecho só é verificável no deploy real. |

Depois, as checagens manuais:

| Checagem | Esperado |
|---|---|
| `curl -sI https://admin.makgestao.com/` | 200; `content-security-policy` com `connect-src 'self'`; `x-frame-options: DENY`; `x-robots-tag: noindex, nofollow`; `strict-transport-security` |
| `curl -sI https://admin.makgestao.com/api/native/admin-maike/sessao` | 401 `ADMIN_SESSAO_REQUIRED`; `cache-control: no-store` |
| `curl -s https://admin.makgestao.com/qualquer/rota` | HTML do admin (fallback SPA) |
| `curl -s https://admin.makgestao.com/api/native/rota-inexistente` | JSON 404 da API, nunca o HTML |
| Navegador → DevTools → Application → Cookies em `admin.makgestao.com` | `__Host-maike_admin`, HttpOnly, Secure, SameSite Strict, sem Domain |
| Mesmo navegador em `www.makgestao.com` | nenhum cookie `__Host-maike_admin` |
| Login de fazenda (JWT) chamando `/api/native/admin-maike/clientes` | 403 `ADMIN_PRINCIPAL_REQUIRED` |
| `GET /api/native/admin-maike/primeiro-acesso` depois do passo 4 | `{"disponivel":false}`; a tela de primeiro acesso não volta |

## 5. GO / NO-GO

**Merge do código (esta PR): GO** quando:
- a CI `verify:all` estiver verde no HEAD final;
- `build:admin` e `gate:admin-isolation` tiverem passado, com o bundle sem código da SPA e sem nome de segredo;
- os testes novos tiverem passado:
  - ADM-DEPLOY-01..04;
  - PUB-01..03, de produção simulada: cookie `__Host-`, Origin restrita, Clientes com MFA, JWT de fazenda recusado.

**Produção: NO-GO** até:
- os passos 1–4 terem sido feitos pelo proprietário;
- a tabela do passo 5 estar toda conferida;
- o primeiro acesso ter sido consumido pelo proprietário, o que fecha a tela de primeiro acesso para sempre.

Enquanto o passo 4 não for concluído, **qualquer pessoa que tenha a chave** poderia criar o proprietário. Por isso, os passos 3 e 4 devem ser feitos em seguida, pela mesma pessoa.

## 6. Rollback

| Situação | Ação | Efeito |
|---|---|---|
| Admin com defeito visual ou de build | `maike-admin` → Deployments → deploy anterior → **Promote to Production** (Instant Rollback) | volta em segundos; o backend não muda |
| Tirar o admin do ar | `maike-admin` → Settings → Domains → remover `admin.makgestao.com`, ou pausar o projeto | o domínio volta a responder 404 |
| Fechar a API admin | projeto `maike` → remover `ADMIN_ORIGINS`, ou a `ADMIN_MAIKE_CHAVE` → Redeploy | sem `ADMIN_ORIGINS`: login recusado (403); sem chave: 503 em tudo |
| Suspeita de sessão comprometida | MAIKE Admin → Minha conta → "Encerrar outras sessões" e trocar a senha | revoga todas as sessões |
| Chave vazou | fechar a API na hora (linha acima) e abrir uma missão para trocar a `ADMIN_MAIKE_CHAVE` | ⚠️ trocar a chave invalida o MFA cadastrado. **Hoje não existe ferramenta de redefinição de MFA:** o `admin:bootstrap` recusa rodar quando já existe proprietário. A troca só deve acontecer junto com um script de redefinição, numa missão própria. Os códigos de recuperação não resolvem esse caso. |
| Destino do rewrite | se `www.makgestao.com` mudar, ajustar `apps/admin/vercel.json` (o teste ADM-DEPLOY-02 aponta o lugar) | — |

Nenhum rollback mexe no banco: o admin publicado não tem migration nem escrita de dados de clientes.

## 7. Riscos residuais

- **Rate limit por IP inútil atrás da Vercel:** o Fastify não usa `trustProxy`, então `request.ip` na função é o endereço interno (`127.0.0.1`). O limite por IP (login 10 tentativas por 15 min, por instância) vira um limite **global por instância**. O bloqueio por conta, persistido, continua valendo.
  - **Efeito:** rajadas de terceiros podem atrasar o login do proprietário em alguns minutos, sem dar acesso a ninguém.
  - **Pelo mesmo motivo:** o `ip` registrado nas sessões e eventos do admin sai como `127.0.0.1`.
  - **Correção:** `trustProxy` restrito ao cabeçalho da Vercel, numa missão própria, porque afeta todas as rotas.
- **Dependência do domínio do backend:** o admin depende de `www.makgestao.com` continuar sendo o domínio de produção do `maike`.
- **`AUTH_SECRET` legível:** no projeto `maike`, essa variável é do tipo *Encrypted* ("readable secret"), não *Sensitive*. Recomenda-se recriá-la como Sensitive com o **mesmo valor**, porque um valor novo derrubaria todas as sessões de fazenda. Isso é fora do escopo e não foi alterado.
- **Prévias do `maike`:** usam o banco de produção e estão sem Deployment Protection, por decisão anterior do proprietário. Por isso, a `ADMIN_MAIKE_CHAVE` deve ficar **só em Production**.

## 8. Evidências desta PR

- **Build e bundle:**
  - `npm run build:admin` executado com a raiz `apps/admin`, como a Vercel faria (`npm run build:admin --prefix ../..`). Gera `apps/admin/dist/{index.html, assets/index-*.js, assets/index-*.css}`.
  - Varredura do bundle: zero ocorrências de `maplibre`, `MapaGeral`, `Base1`, `/usuarios/page`, `localStorage.setItem` e de nomes de segredo (`service_role`, `DATABASE_URL`, `ADMIN_MAIKE_CHAVE`, `eyJ`, `postgres://`). O bundle só chama rotas `/admin-maike/*`.
- **E2E no navegador** (Playwright, banco local descartável):
  - **Montagem:** backend local + `vite preview` do admin, com o proxy `/api/native` fazendo o papel do rewrite da Vercel.
  - **Fluxo:** login → cadastro do TOTP → códigos de recuperação → aba Clientes → ficha com empresas e usuários.
  - **Resultado:** cookie HttpOnly e SameSite=Strict; `localStorage` e `sessionStorage` vazios; CNPJ não aparece na tela.
  - **Captura:** `docs/engineering/evidencias/admin-s02/e2e-clientes-ficha.png`.
- **Testes:**
  - `backend/tests/adminPublicacaoProducao.test.mjs` (PUB-01..03);
  - `tests/smoke/adminVercelConfig.test.js` (ADM-DEPLOY-01..04);
  - `scripts/tests/gates/admin-deploy-smoke.test.mjs` (SMK-07 novo: `no-store`).
