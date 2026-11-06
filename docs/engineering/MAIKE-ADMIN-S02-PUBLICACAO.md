# MAIKE-ADMIN-S02 — Publicação do MAIKE Admin em `admmakgestao.vercel.app`, com atalho `makgestao.com/admmakgestao`

Este runbook prepara a publicação e não a executa. Os passos marcados com 👤 são feitos pelo proprietário no painel da Vercel. Nenhum valor de segredo aparece aqui.

Base: `main` = `7a95b8c5dcccdbb78dab8a5b204cc4b3741d5981` (PR #213, aba Clientes).

## 0. Decisão do proprietário (2026-11-06)

O proprietário pediu que o painel **não** use `admin.makgestao.com`. A pedido dele, o endereço digitado é **`makgestao.com/admmakgestao`**.

Para isso, ele escolheu (entre três opções apresentadas) o **atalho que redireciona**:
- `makgestao.com/admmakgestao` e `www.makgestao.com/admmakgestao` levam, com redirect 307, a **`https://admmakgestao.vercel.app`**.
- Esse é o endereço de produção do projeto Vercel próprio `admmakgestao`. Não tem custo de domínio.
- O painel **não** é servido dentro de `www.makgestao.com`, porque:
  - a sessão de administrador ficaria no mesmo domínio da SPA dos clientes;
  - uma falha de XSS no sistema da fazenda poderia ler dados de todos os clientes (ver S01 §2, alternativa B).

As outras duas opções foram recusadas:
- servir o painel dentro do mesmo site, pelo risco acima;
- comprar `admmakgestao.com` (disponível, US$ 12,03 por ano na Vercel), que fica possível no futuro, se o proprietário autorizar a compra.

## 1. Estado verificado em 2026-11-06 (somente leitura)

| Item | Evidência | Situação |
|---|---|---|
| `https://admmakgestao.vercel.app` | `404 DEPLOYMENT_NOT_FOUND` | ❌ sem projeto; o nome parece livre (ver risco no §7) |
| `www.makgestao.com/admmakgestao` | antes desta PR: rota da SPA (sem atalho) | ❌ o redirect entra no deploy do `maike` após o merge |
| Projeto Vercel do admin | projetos da equipe: `maike`, `controle-de-estoque`, `projetomg` | ❌ não existe |
| Backend `maike` | `GET https://www.makgestao.com/api/native/health` → 200 | ✅ |
| API do admin em produção | `GET /api/native/admin-maike/sessao` → `503 ADMIN_INDISPONIVEL` | ❌ desligada (falha fechada) |
| `ADMIN_MAIKE_CHAVE` (projeto `maike`) | lista de variáveis, só nomes | ❌ ausente |
| `ADMIN_ORIGINS` (projeto `maike`) | idem | ❌ ausente |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (projeto `maike`) | idem | ✅ presentes, alvo Production (upload de ícones) |
| Domínios do projeto `maike` | `www.makgestao.com` (principal), `makgestao.com` (308 → www), `maike-five.vercel.app` | ✅ |
| Zona `makgestao.com` | Vercel DNS (`ns1/ns2.vercel-dns.com`), registro curinga `*` → Vercel | ✅ nenhum DNS novo é necessário |

## 2. O que esta PR muda (e por quê)

1. **`apps/admin/vercel.json`, proxy `/api/native/:path*`:** o destino passa de `https://maike-five.vercel.app` para `https://www.makgestao.com`.
   - **Por quê:** com a Deployment Protection "Standard: todos exceto domínios próprios", o `*.vercel.app` do backend fica protegido e o admin pararia de funcionar.
   - **O que continua igual:** o domínio próprio é o mesmo deploy de produção. Método, corpo, `Origin`, `Cookie` e `Set-Cookie` continuam passando pelo proxy.
2. **`apps/admin/vercel.json`, `Cache-Control: no-store` em `/api/native/(.*)`:** as respostas carregam sessão, CSRF e dados de clientes, e nunca devem ficar em cache.
3. **`vercel.json` da raiz (SPA dos clientes), `redirects`:** `/admmakgestao`, `/admmakgestao/` e `/admmakgestao/:path*` vão para `https://admmakgestao.vercel.app/` com 307 (`permanent: false`). Assim, trocar o destino depois não fica preso no cache dos navegadores.
   - A chave é própria. O `scripts/vercel/sync-vercel-json.mjs` só regenera `rewrites` e preserva o resto (conferido: ele foi rodado e o redirect permaneceu).
4. **`gate:admin-isolation`, ADM-05 ampliado:** no site dos clientes, `/admmakgestao` e `/paineladm` podem **só redirecionar**, e só para uma origin `https` **fora** de `makgestao.com`.
   - Um rewrite (painel servido no domínio dos clientes) reprova.
   - Um redirect para o próprio domínio dos clientes também reprova.
5. **Smoke pós-deploy:** passa a conferir o `no-store` (SMK-07).

O resto já estava correto e **não muda**:
- build próprio, sem a SPA dos clientes;
- CSP estrita;
- `X-Frame-Options: DENY`;
- `noindex`;
- HSTS;
- fallback SPA que não captura `/api/native`.

## 3. Arquitetura publicada

```
makgestao.com/admmakgestao ──308──▶ www.makgestao.com/admmakgestao ──307──▶ https://admmakgestao.vercel.app/

navegador ──https──▶ admmakgestao.vercel.app (projeto Vercel "admmakgestao", estático)
                       │  /            → dist/index.html (SPA do admin)
                       │  /assets/*    → dist/assets/* (hash no nome)
                       │  /api/native/* ──rewrite externo──▶ https://www.makgestao.com/api/native/*
                       ▼                                       (projeto "maike": Fastify serverless)
                 cookie __Host-maike_admin  ◀── Set-Cookie repassado pelo proxy
```

**Cookie** (`backend/src/modules/adminMaike/adminSessao.js`):
- Em produção (`NODE_ENV=production`, que a Vercel define) o nome é `__Host-maike_admin`, com `Secure; HttpOnly; SameSite=Strict; Path=/` e **sem `Domain`**.
- O navegador guarda o cookie só para `admmakgestao.vercel.app`. Como `vercel.app` está na Public Suffix List, nenhum outro `*.vercel.app` consegue ler ou escrever esse cookie.
- `www.makgestao.com` nunca recebe esse cookie.

**Origin e CSRF:**
- Login e mutações exigem `Origin` presente em `ADMIN_ORIGINS`.
- Mutações também exigem o cabeçalho `x-maike-admin-csrf`, com o HMAC da sessão.
- O proxy repassa o `Origin` do navegador (`https://admmakgestao.vercel.app`).

**MFA e sessão:**
- TOTP obrigatório (`exigirSessaoAdmin()`). A pré-sessão dura 10 minutos.
- A sessão verificada dura 8 h, com ociosidade de 30 min.

**Rate limit:** por conta (persistido no banco) e por IP (em memória). Ver os riscos no §7.

## 4. Runbook de publicação (👤 = proprietário; nada disso foi executado)

### Passo 0 — antes de começar
- [ ] Esta PR (S02) mesclada na `main`, com CI `verify:all` verde. O deploy do `maike` publica o atalho `/admmakgestao`.
- [ ] Gerenciador de senhas aberto, para gerar e guardar a `ADMIN_MAIKE_CHAVE`.

### Passo 1 👤 — criar o projeto **`admmakgestao`**
Vercel → Add New → Project → repositório `maikelimaadm-stack/MAIKE`:

| Campo | Valor |
|---|---|
| Project Name | **`admmakgestao`** (o endereço de produção vira `admmakgestao.vercel.app`) |
| Root Directory | `apps/admin` |
| Framework Preset | Other (o `apps/admin/vercel.json` já define `framework: null`) |
| Build / Install / Output | **deixar em branco**: vêm do `apps/admin/vercel.json` (`npm ci --prefix ../..`, `npm run build:admin --prefix ../..`, `dist`) |
| "Include files outside the root directory" | **ligado** (padrão), necessário para o `npm ci` na raiz do monorepo |
| Production Branch | `main` |
| Environment Variables | **nenhuma** |

Depois do primeiro deploy, confirme em Settings → Domains que o domínio de produção é **exatamente** `admmakgestao.vercel.app`. Se a Vercel tiver dado outro nome (por exemplo, por o nome já estar em uso), **pare** e me avise, porque `ADMIN_ORIGINS` e o redirect precisam do nome real.

Em Settings → Deployment Protection, escolha **"Only Preview Deployments"**:
- as prévias de branch do admin ficam atrás do login da Vercel;
- a produção, `admmakgestao.vercel.app`, fica aberta, protegida pelo login e MFA do MAIKE.

**Não** escolha "Standard Protection" neste projeto: ela também protegeria o `admmakgestao.vercel.app`, que não é domínio próprio.

### Passo 2 👤 — variáveis no projeto **`maike`** (o backend)
Vercel → projeto **maike** → Settings → Environment Variables:

| Nome | Valor | Tipo | Ambiente |
|---|---|---|---|
| `ADMIN_MAIKE_CHAVE` | ≥ 40 caracteres aleatórios, sem espaço, gerados no gerenciador de senhas | **Sensitive** | **somente Production** |
| `ADMIN_ORIGINS` | `https://admmakgestao.vercel.app` (sem barra final) | Plain | **somente Production** |

Cuidados com as variáveis:
- **"Somente Production":** as prévias do `maike` usam o banco de produção e estão sem Deployment Protection. Sem a chave nas prévias, a API admin delas continua em 503, falha fechada.
- **Onde as variáveis não entram:**
  - nunca no projeto `admmakgestao`: ele é estático e não lê segredo;
  - nunca em variável `VITE_*`, que iria para o bundle;
  - nunca em chat ou no repositório.
- **A chave não é trocável à toa:** ela cifra o segredo do autenticador (MFA) e assina o CSRF. Ver o §6.

Em seguida: **Deployments → último deploy de Production → Redeploy**.

Conferência, sem segredo:
- `curl -s https://www.makgestao.com/api/native/admin-maike/primeiro-acesso` deve responder `{"disponivel":true}`, em vez de 503.

### Passo 3 👤 — primeiro acesso e MFA (logo após o passo 2, pela mesma pessoa)
1. Abra `https://makgestao.com/admmakgestao`. A página deve ir sozinha para `https://admmakgestao.vercel.app` e mostrar **Primeiro acesso**.
2. Cole a `ADMIN_MAIKE_CHAVE`, defina o login e uma senha (≥ 12 caracteres) e clique em **Criar proprietário**.
3. Entre e cadastre o autenticador. Guarde os 10 códigos de recuperação fora do computador.
4. Abra a aba **Clientes**: a lista deve mostrar os clientes reais, somente leitura.

### Passo 4 — verificação pós-publicação (pode ser feita por mim, só leitura)

```bash
node scripts/admin/smoke-admin-deploy.mjs --url https://admmakgestao.vercel.app
```

O resultado precisa ser todo `PASS`: página, CSP, X-Frame-Options, noindex, HSTS, proxy, `no-store`, Origin aceita, API de tenant fechada e bundle sem credencial. O único POST do smoke é um login com usuário aleatório inexistente.

| Estado | Resultado do smoke |
|---|---|
| **Hoje (antes da publicação)**, contra `admin.makgestao.com` | 9 FAIL: 404 (sem projeto). É o estado esperado de NO-GO; vale o mesmo para `admmakgestao.vercel.app`. |
| **Local** (`--url http://localhost:5174 --permitir-http`) | proxy, Origin, login genérico, API de tenant e bundle: PASS. CSP, X-Frame-Options e noindex: FAIL, porque o `vite preview` não aplica o `vercel.json`. |

Checagens manuais:

| Checagem | Esperado |
|---|---|
| `curl -sI https://makgestao.com/admmakgestao` | 308 → `https://www.makgestao.com/admmakgestao` |
| `curl -sI https://www.makgestao.com/admmakgestao` (também com `/` no fim) | 307 → `https://admmakgestao.vercel.app/` |
| `curl -sI https://admmakgestao.vercel.app/api/native/admin-maike/sessao` | 401; `cache-control: no-store` |
| `curl -s https://admmakgestao.vercel.app/api/native/rota-inexistente` | JSON 404 da API, nunca o HTML |
| DevTools → Cookies em `admmakgestao.vercel.app` | `__Host-maike_admin`, HttpOnly, Secure, SameSite Strict, sem Domain |
| Mesmo navegador em `www.makgestao.com` | nenhum cookie `__Host-maike_admin` |
| JWT de fazenda chamando `/api/native/admin-maike/clientes` | 403 `ADMIN_PRINCIPAL_REQUIRED` |
| `GET /api/native/admin-maike/primeiro-acesso` depois do passo 3 | `{"disponivel":false}` |

## 5. GO / NO-GO

**Merge do código (esta PR): GO** quando:
- a CI `verify:all` estiver verde no HEAD final;
- `build:admin` e `gate:admin-isolation` tiverem passado, com o bundle limpo;
- os testes tiverem passado: ADM-DEPLOY-01..05, PUB-01..03, SMK-07 e ADM-05 (redirect aceito, rewrite e redirect interno recusados).

Antes do passo 1, o atalho `/admmakgestao` leva a um 404 da Vercel. Isso é inofensivo e não afeta o sistema das fazendas.

**Produção: NO-GO** até:
- os passos 1–3 terem sido feitos;
- o smoke e as checagens do passo 4 terem dado PASS.

Entre os passos 2 e 3, quem tiver a chave poderia criar o proprietário. Por isso, os dois devem ser feitos em sequência, pela mesma pessoa.

## 6. Rollback

| Situação | Ação | Efeito |
|---|---|---|
| Admin com defeito | `admmakgestao` → Deployments → deploy anterior → **Promote to Production** | volta em segundos |
| Tirar o admin do ar | pausar o projeto `admmakgestao` (Settings → General) | `admmakgestao.vercel.app` deixa de responder; o atalho leva a erro |
| Fechar a API admin | projeto `maike` → remover `ADMIN_ORIGINS`, ou a `ADMIN_MAIKE_CHAVE` → Redeploy | sem `ADMIN_ORIGINS`: login recusado (403); sem chave: 503 em tudo |
| Remover o atalho | PR revertendo `redirects` do `vercel.json` da raiz | `/admmakgestao` volta a ser rota da SPA (tela padrão) |
| Sessão comprometida | MAIKE Admin → Minha conta → "Encerrar outras sessões" e trocar a senha | revoga todas as sessões |
| Chave vazou | fechar a API na hora (linha "Fechar a API admin") e abrir uma missão para trocar a chave | ⚠️ trocar a `ADMIN_MAIKE_CHAVE` invalida o MFA cadastrado. **Hoje não existe ferramenta de redefinição de MFA:** o `admin:bootstrap` recusa rodar quando já existe proprietário. A troca só deve acontecer junto com um script de redefinição, numa missão própria. |

Nenhum rollback mexe no banco.

## 7. Riscos residuais

- **Nome `admmakgestao.vercel.app`:** hoje responde `DEPLOYMENT_NOT_FOUND`, o que indica que está livre, mas só a criação do projeto confirma. Se a Vercel der outro nome, é preciso ajustar `ADMIN_ORIGINS`, o redirect e o teste ADM-DEPLOY-05 (passo 1).
- **Endereço `*.vercel.app` em vez de domínio próprio:**
  - **Funcional:** não há diferença, porque o cookie é host-only e `vercel.app` está na PSL.
  - **Marca:** quem olha a barra de endereço vê "vercel.app". Isso muda se o proprietário autorizar a compra de `admmakgestao.com` (US$ 12,03 por ano).
- **Rate limit por IP inútil atrás da Vercel:** o Fastify não usa `trustProxy`, então `request.ip` é `127.0.0.1`. O limite por IP vira um limite global por instância. O bloqueio por conta, persistido, continua valendo, e o IP registrado nas sessões e eventos sai como `127.0.0.1`. A correção (`trustProxy`) vale para todas as rotas e fica para uma missão própria.
- **Dependência do domínio do backend:** o admin depende de `www.makgestao.com` continuar sendo o domínio de produção do `maike`.
- **`AUTH_SECRET` legível:** no projeto `maike`, essa variável é do tipo *Encrypted* ("readable secret"). Recomenda-se recriá-la como *Sensitive* com o **mesmo valor**. Fora do escopo; não foi alterado.
- **Prévias do `maike`:** usam o banco de produção e estão sem Deployment Protection, por decisão anterior do proprietário. Por isso, a chave e `ADMIN_ORIGINS` devem ficar **só em Production**.

## 8. Evidências desta PR

- **Build e bundle:**
  - `npm run build:admin` executado com a raiz `apps/admin`, como a Vercel faria. Gera `apps/admin/dist/{index.html, assets/*}`.
  - Varredura do bundle: zero ocorrências de `maplibre`, `MapaGeral`, `Base1`, `/usuarios/page`, `localStorage.setItem` e de nomes de segredo. O bundle só chama `/admin-maike/*`.
- **E2E no navegador** (Playwright, banco local descartável):
  - **Montagem:** backend local + `vite preview` do admin, com o proxy `/api/native`.
  - **Fluxo:** login → TOTP → códigos de recuperação → aba Clientes → ficha com empresas e usuários.
  - **Resultado:** cookie HttpOnly e SameSite=Strict; storage vazio; CNPJ ausente da tela.
  - **Captura:** `docs/engineering/evidencias/admin-s02/e2e-clientes-ficha.png`.
- **Atalho conferido na prévia desta branch** (`maike-git-claude-new-…vercel.app`):
  - `/admmakgestao` e `/admmakgestao/qualquer` → 307 `https://admmakgestao.vercel.app/`;
  - `/mapageral` → 200, sem efeito no sistema das fazendas;
  - `/admmakgestao/` dava 404 e ganhou regra própria.
- **Testes:**
  - `backend/tests/adminPublicacaoProducao.test.mjs` (PUB-01..03, produção simulada com `ADMIN_ORIGINS=https://admmakgestao.vercel.app`);
  - `tests/smoke/adminVercelConfig.test.js` (ADM-DEPLOY-01..05);
  - `scripts/tests/gates/admin-deploy-smoke.test.mjs` (SMK-07);
  - `scripts/tests/gates/admin-isolation.test.mjs` (ADM-05 do atalho).
