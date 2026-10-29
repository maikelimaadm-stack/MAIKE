# MAIKE-CATALOGO-ICONES-LOTES-01 — catálogo global de ícones, MAIKE Admin e ícone no lote

**Missões na PR #145 (DRAFT):**

| Rodada | Missão | O que fez |
|---|---|---|
| R1 | `MAIKE-CATALOGO-GLOBAL-ICONES-LOTES-01` | painel na SPA (revertido) |
| R2 | `MAIKE-PR145-CATALOGO-SUPABASE-LOTES-R2` | vínculo CategoriaManejo → catálogo, D-PROD-69 |
| R3 | `MAIKE-PR145-R3-ADMIN-PRINCIPAL-CATALOGO-ICONES-01` | proprietário independente + MAIKE Admin, D-PROD-70 |
| R4 | `MAIKE-PR145-R4-SEGURANCA-USUARIOS-PERMISSOES-01` | administrador da fazenda server-owned, Permissões, endurecimento do admin, D-PROD-71 (§9) |

**Base:** `main` `1344ffe2` · **Branch:** `claude/catalogo-global-icones-lotes-01` · **Merge:** exclusivo do proprietário.
**Runbook:** `docs/engineering/MAIKE-CATALOGO-OPERACAO-SUPABASE.md`

## 1. Escopo da R3

O proprietário quer administrar o catálogo **visualmente**, mas **fora da SPA dos clientes**:

- uma identidade própria do produto, com MFA, independente dos tenants;
- um app MAIKE Admin com build e deploy isolados;
- cadastro real de ícones, subícones e regras MISTO;
- a R2 (vínculo CategoriaManejo → lote) mantida.

MapLibre/WebGL ficaram fora: o `webglcontextcreationerror` relatado é um problema **independente e pendente para outra PR**. Nenhum arquivo de mapa foi tocado.

## 2. Antes → depois

| Peça | Antes da R3 | Depois da R3 |
|---|---|---|
| Quem escreve no catálogo | `OperadorProdutoMaike`: usuário de tenant + JWT de tenant | `AdminPrincipalMaike`: identidade do produto, sem `cliente_id`; sessão própria + MFA |
| Guarda `/catalogo-global/admin/*` | `app.autenticar` + `exigirOperadorProduto` | `exigirSessaoAdmin()`: cookie opaco + MFA + Origin + CSRF. JWT de tenant e admin de tenant → 403; operador legado → 403; sem credencial → 401 |
| `exigirOperadorProduto`, `bootstrap-operador-produto.mjs` | existiam | **removidos**. A tabela `OperadorProdutoMaike` e o histórico ficam |
| Auditoria do catálogo | `operador_id` | + `admin_id` (aditivo); ator obrigatório |
| UI administrativa | inexistente (painel da R1 revertido) | `apps/admin`: app separado, porta 5174, `npm run build:admin`, `apps/admin/vercel.json` próprio |
| MISTO no backend | criar e publicar | + `PATCH`, desativar, recusa de conjunto duplicado, ícone resultado precisa estar publicado |
| Categoria visual no backend | criar | + `PATCH` (nome, ordem, ativo); o código é imutável |
| Leitura admin | — | `/admin-maike/catalogo`, `/validacao`, `/revisao` |
| CLI de importação | JWT do operador | sessão do proprietário (senha + TOTP); `--apply` só contra API local |
| R2: CategoriaManejo → lote | implementada | **preservada sem alteração funcional** |

## 3. Identidade do proprietário (D-PROD-70)

**Models.** Migration aditiva `20261029300000_admin_principal_maike`, com REVOKE de `anon`/`authenticated` e RLS:

- `AdminPrincipalMaike`;
- `SessaoAdminMaike`;
- `CodigoRecuperacaoAdminMaike`;
- `EventoSegurancaAdminMaike`.

Eles entram na lista fechada `tenancy.productAdminModels`, e `gate:modelobase1-pecuario` cobra essa lista.

**Criação.** `npm run admin:bootstrap`:

- é interativo: login, senha oculta digitada duas vezes e confirmação `CRIAR PROPRIETARIO`;
- é único: `chave_proprietario` unique, à prova de corrida;
- recusa produção sem flag e aprovação;
- nunca imprime senha nem hash.

**Login.**

1. Senha (scrypt `N=2^15, r=8, p=1`, versionado) abre uma pré-sessão de 10 min que só serve para MFA.
2. O TOTP (RFC 6238, janela ±1, anti-replay por passo) ou um código de recuperação promove a sessão. O token é rotacionado.
3. No primeiro acesso, a inscrição do TOTP é **obrigatória**. O segredo fica cifrado com AES-256-GCM sob `ADMIN_MAIKE_CHAVE`. Os 10 códigos de recuperação aparecem uma vez e só o hash é guardado.

**Sessão.**

- token de 256 bits, apenas no cookie `HttpOnly` + `SameSite=Strict` (`Secure` e `__Host-` em produção);
- o banco guarda só o sha256;
- validade de 8 h, ociosidade de 30 min, revogável.

**Mutações.** Exigem `Origin` ∈ `ADMIN_ORIGINS` e o cabeçalho `x-maike-admin-csrf` igual ao HMAC da sessão. A API é acessada pela mesma origin (proxy `/api/native`), sem CORS com credenciais.

**Proteções de login.**

- bloqueio persistido: 5 falhas → 15 min;
- limitador por IP: 10 logins / 15 min → 429;
- mensagem sempre genérica.

**Troca de senha ou login.** Exige senha atual + TOTP novo, valida unicidade e revoga **todas** as sessões. Também é possível encerrar as outras sessões e regerar os códigos de recuperação.

**Escopo.** A conta administra só o catálogo e a própria segurança. A sessão do produto não vira `auth_context` de tenant (provado por teste: `/usuarios`, `/lotes` e o `PATCH` de usuário respondem 401).

## 4. MAIKE Admin (`apps/admin`)

- **Local:** `npm run dev:admin` → http://localhost:5174, com proxy para a API em `:3333`.
- **Build:** `npm run build:admin` → `apps/admin/dist`.
- **Deploy:** projeto Vercel separado (Root Directory `apps/admin`), com CSP, `frame-ancestors 'none'`, HSTS e `noindex`. O rewrite same-origin para o backend real é passo do rollout (runbook §3). Nenhum deploy foi feito.
- **Isolamento:** `gate:admin-isolation` roda antes e depois dos builds e garante:
  - `src/` não importa `apps/admin` nem chama `/admin-maike` ou `/catalogo-global/admin`;
  - `apps/admin` não importa módulos da SPA;
  - nenhuma credencial server-only aparece nos dois;
  - a SPA não tem página nem rewrite de catálogo;
  - os bundles gerados são inspecionados.

  Cache do Vite separado (`node_modules/.vite-admin`).
- **Telas:**
  - Entrar / Segundo fator / Ativar MFA;
  - **Ícones:** filtros e pesquisa; novo ícone com imagem principal + subícone opcional como dois arquivos; prévia local; limites vindos da API (PNG/JPEG/WebP/GIF, 512 KB, SVG recusado); trocar imagem ou subícone mantendo o id; cor de fallback; publicar; desativar;
  - **Tipos e categorias:** código estável, rótulo, ordem e estado; duplicidade recusada; sem exclusão física;
  - **Regras MISTO:** conjunto de categorias, ícone resultado, prioridade, conflitos da validação, rascunho, publicar, editar e desativar; aviso de que **não é o sexo "Misto" do lote e não muda o mapa**;
  - **Validação:** erros e avisos, e prévia de como os clientes verão;
  - **Minha conta.**
- **Concorrência:** toda escrita relê `/admin-maike/catalogo/revisao` e manda `revisao_esperada`. Um 409 recarrega sem sobrescrever.

## 5. R2 preservada (CategoriaManejo → Lote)

Estes pontos continuam como na R2:

- `CategoriaManejo.catalogo_categoria_visual_id` (migration `20261029200000`), validado contra categoria ativa do tipo `lote` com `FOR SHARE`;
- formulário de Categoria de Manejo só com as categorias publicadas;
- prévia do `FormularioLote` ao criar, editar e duplicar, com fallback; a falha do catálogo não bloqueia o salvamento;
- payload do Lote inalterado.

O E2E R2 foi executado de novo contra o catálogo criado **pelo MAIKE Admin**.

## 6. Gates, testes e evidências (local, PostgreSQL 16)

| Gate / teste | Resultado |
|---|---|
| `git diff --check`; `prisma validate`; `migrate deploy` do zero + reexecução idempotente; `migrate diff` migrations→schema vazio | PASS |
| `npm run verify:all` (PG 16, banco recriado do zero) | **PASS — todas as etapas**: gates 628/628, backend 326/326, smoke 940/940 (78 arquivos), types 1337 ≤ 1746, lint 0 erros, build cliente + build admin + `gate:admin-isolation` nos bundles |
| Backend `adminMaikeSeguranca.test.mjs` | **14/14** — bootstrap único e corrida, hash; login, cookie e corpo sem token; Origin; bloqueio e 429; pré-sessão só MFA; inscrição, replay, tentativas; recuperação de uso único; CSRF; sessão expirada, ociosa, revogada e forjada; tenant, admin de tenant e operador legado → 403; sem credencial → 401; sessão do produto sem acesso a tenant; troca de senha e login com revogação; sessões, logout, códigos; auditoria com `admin_id` |
| Backend `adminBootstrapCli.test.mjs` | **2/2** — CLI real: uma vez só, senha nunca impressa, divergência, sem confirmação, senha fraca, produção e sem TTY recusados |
| Backend `catalogoAdminMisto.test.mjs` | **6/6** — principal e subícone distintos; trocar a principal mantém id e subícone; asset inválido ou inexistente 4xx; CAS 409; categoria PATCH, duplicidade, sem DELETE; desativar e republicar mantém id; MISTO criar, editar, publicar, desativar com validações (tipo, categoria inativa, duplicata, ícone não publicado); validação aponta duplicata, empate, ícone não publicado e categoria sem ícone; Lote intocado |
| Backend `catalogoGlobalNativo.test.mjs` | **41/41**, com a guarda nova; CG-02 e R2-11 → 403 `ADMIN_PRINCIPAL_REQUIRED` |
| Backend `catalogoImportacaoIcones.test.mjs` | **4/4** — inclui reaproveitar o rascunho de uma execução interrompida |
| Backend `categoriaManejoVinculoCatalogo.test.mjs` (R2) | **10/10** |
| Gate tests `admin-isolation.test.mjs` | **9/9**; `modelobase1-pecuario.test.mjs` +2 (MB1-07c/d) |
| Smoke `maikeAdmin.test.jsx` | **9/9** — login → MFA obrigatório → catálogo, CSRF só em memória e nas mutações, nada em localStorage; upload principal + subícone com bytes intactos e CAS; limite e SVG sem rede; troca com mesmo id; MISTO; validação; conta |
| Smoke `catalogoGlobalLote.test.jsx` (R2) | **13/13** |
| E2E MAIKE Admin (Chromium + Fastify + Vite admin + PG + Storage falso; PNG sintéticos) | **29/29** — `evidencias/catalogo-icones-lotes-01/admin/e2e-admin-resultado.txt`; capturas 01–09 em 1440/768/390/412 |
| E2E R2 no app dos clientes | **15/15** — `evidencias/catalogo-icones-lotes-01/e2e-ui-resultado.txt` |
| Provas negativas de API | `evidencias/catalogo-icones-lotes-01/admin/provas-negativas-api.txt` |
| CLI de contingência | `evidencias/catalogo-icones-lotes-01/admin/cli-importacao.txt` — dry-run, `--apply` remoto recusado, `--apply` local, reaplicar = nada |

Sem captura da tela de inscrição do MFA: ela mostra a chave TOTP, mesmo sendo de teste.

## 7. Riscos e limitações

1. ~~**`PATCH /usuarios/:id`:** qualquer usuário autenticado do tenant troca a senha de **outro** usuário do mesmo tenant.~~ **Corrigido na R4** (§9, D-PROD-71), junto com `POST /usuarios` e `POST`/`PATCH`/`DELETE /permissoes`.
2. O limitador por IP é por processo (serverless = por instância). O bloqueio por conta é persistido e cobre o caso distribuído.
3. A inscrição do TOTP é por chave digitada ou link `otpauth`; não há QR code (sem dependência nova).
4. A unicidade de conjunto MISTO é verificada na transação; duas criações simultâneas **sem** CAS poderiam passar. O app sempre envia `revisao_esperada`, o que serializa.
5. A URL pública dos assets continua acoplada ao Supabase Storage (runbook §12).
6. Os objetos de rascunho ficam no bucket público, em caminho imprevisível e não listado.
7. MapLibre/WebGL (`webglcontextcreationerror`): pendente, PR posterior.

## 8. Rollout — PENDENTE DE AUTORIZAÇÃO

Produção: **NOT_RUN** para todos estes itens:

- migrations (`20261029200000`, `20261029300000` e as do catálogo);
- `ADMIN_MAIKE_CHAVE` e `ADMIN_ORIGINS`;
- bucket e projeto Vercel do admin;
- bootstrap do proprietário;
- upload das imagens reais.

Nenhuma escrita remota foi feita nesta missão. Ordem: backup → migrations → backend → envs → admin → bootstrap → MFA → imagens → vínculos.

**Veredito (R3):** READY_FOR_ARCHITECT_AUDIT (código e testes locais) · NOT_READY_FOR_PRODUCTION (rollout pendente e risco do item 7.1, fechado na R4).

## 9. R4 — segurança de Usuários e Permissões, endurecimento do MAIKE Admin (D-PROD-71)

### 9.1 Achados reproduzidos (antes da R4, no código da R3)

A1–A7 foram reproduzidos com servidor real sobre o commit `9bad34ce` (worktree separado, banco sintético): `evidencias/catalogo-icones-lotes-01/usuarios-r4/provas-api-antes-r3.txt`. O "depois" está em `provas-api-r4.txt`. A8–A9 vêm da leitura do código da R3 e são provados no depois pelos testes S-15/S-16.

| # | Achado | Severidade | Antes | Depois |
|---|---|---|---|---|
| A1 | `PATCH /usuarios/:id`: usuário comum troca a senha de outro usuário (inclusive do admin da fazenda) | **crítica** (tomada de conta) | 200; senha original → 401; a senha injetada abre a conta do admin | 403 `TENANT_ADMIN_REQUIRED`; hash intacto; senha injetada → 401 |
| A2 | `POST /usuarios`: usuário comum cria contas | alta | 201 | 403 |
| A3 | `POST`/`PATCH`/`DELETE /permissoes`: usuário comum se dá `is_admin`, cria ou apaga permissões | alta (escalada) | 201 / 200 (`is_admin` virou `true`) / 204 | 403 nas três |
| A4 | Autoridade era `Permissao.is_admin`, editável pela própria API | alta | — | autoridade é `Usuario.papel_tenant`, sem endpoint de escrita |
| A5 | `cliente_id` no corpo de `PATCH` genérico (Permissao, CategoriaManejo, …) movia o registro para outro tenant | **crítica** (quebra de isolamento) | 200; a permissão do admin sumiu do tenant original | 400 `REQUEST_VALIDATION_FAILED` em toda a API; registro fica |
| A6 | `GET /permissoes` entregava todas as linhas completas a qualquer usuário | média | 10 colunas, inclusive `is_admin`, telas e módulos | não-admin: a própria linha + `id`, `user_email`, `user_nome` das demais |
| A7 | Troca da própria senha sem a senha atual (sessão roubada = conta roubada) | média | 200 | exige `senha_atual` (403 sem ela) |
| A8 | A guarda do admin não olhava `AdminPrincipalMaike.papel` (latente: hoje só existe a linha do proprietário) | baixa | qualquer papel passava | só `papel = 'proprietario'`; outro → 403 / login genérico |
| A9 | Produção sem `ADMIN_MAIKE_CHAVE` válida: `Error` genérico só no primeiro uso da chave, no meio do fluxo | média | 500 não catalogado | 503 `ADMIN_INDISPONIVEL`, sem sessão |
| A10 | `PERMISSAO_NOT_FOUND` fora do catálogo de erros | baixa | 500 | 404 |
| A11 | Tela Usuários mandava as chamadas sem JWT (bug pré-existente da `main`) | média (tela inutilizável) | sempre "Sua sessão expirou" | funciona |

### 9.2 Contrato de autorização

- `backend/src/shared/auth/exigirAdminTenant.js`: lê o ator no banco por `id` + `cliente_id` do `auth_context`; exige `ativo` e `papel_tenant = 'administrador'`. Chamado antes de qualquer busca e de novo dentro da transação (sem janela de corrida).
- Usuários: `POST` → admin. `PATCH` de outro → admin. `PATCH` próprio → conta ativa; `nova_senha` exige `senha_atual`; desativar a própria conta segue recusado; `papel_tenant` no corpo → 400.
- Permissões: `POST`/`PATCH`/`DELETE` → admin; `GET` reduzido para não-admin; campos do servidor (`id`, `cliente_id`, timestamps) nunca vêm do corpo.
- Global: `cliente_id` em qualquer corpo → 400.
- Auditoria: sem senha nem hash (`dados_novos` só com campos públicos).
- O proprietário do produto não é usuário de tenant: o cookie do admin em `/usuarios` → 401.

### 9.3 Bootstrap confiável do administrador da fazenda

- Migration aditiva `20261029400000_usuario_papel_tenant`: coluna + CHECK; todos ficam `'usuario'`; rollback no topo do arquivo.
- `scripts/auth/papel-tenant.mjs` (runbook §4b): único caminho de elevação, individual, `CONFIRMAR` digitado, auditado, reversível, produção bloqueada sem aprovação.
- Testes antigos usam fixture de banco (`criarTenant({ papelTenant: 'administrador' })`), nunca `Permissao.is_admin`.

### 9.4 Compatibilidade da UI

- Usuários: a porta agora envia o JWT; o formulário pede "Senha atual" só ao trocar a própria senha; a recusa do servidor aparece como "Somente o administrador da fazenda pode fazer isso. Peça ao administrador da sua fazenda."
- Permissões: sem mudança de tela; quem não é admin recebe a mensagem do servidor ao salvar.
- MAIKE Admin, "Novo ícone": falha parcial mostra "Já concluído: …" e **Tentar de novo** reenvia só o que faltou (sem asset duplicado, sem perder a referência).
- Validação do catálogo: aviso `ASSET_SEM_USO` (nada é apagado).

### 9.5 Provas (local, PostgreSQL 16)

| Prova | Resultado |
|---|---|
| `git diff --check`; `prisma validate`; `migrate deploy` do zero + reexecução ("No pending migrations"); `migrate diff` migrations→schema | PASS; após a migration, `papel_tenant` = `'usuario'` em todas as linhas e CHECK presente |
| `npm run verify:all` (PG 16, banco recriado do zero) | **PASS — todas as etapas**: gates 634/634 (26 arquivos), backend 340/340, smoke 944/944 (79 arquivos), types 1337 ≤ 1746, typecheck backend 0, lint 0 erros (2 avisos pré-existentes fora do diff), build cliente + `build:admin` + `gate:admin-isolation` nos bundles |
| Backend completo | **340/340** — inclui `usuariosAutorizacaoTenant.test.mjs` 10/10 (U-01..U-10), `papelTenantCli.test.mjs` 2/2, `adminMaikeSeguranca.test.mjs` 16/16 (S-15 papel ≠ proprietário; S-16 chave ausente/inválida → 503 e `ADMIN_ORIGINS` vazio → 403) |
| Gate tests | `admin-deploy-smoke.test.mjs` 6/6; `admin-isolation.test.mjs` 9/9 |
| Smokes | `usuariosAutorizacaoR4.test.jsx` 3/3; `maikeAdmin.test.jsx` 10/10 (retry); Usuários 12/12 |
| Provas de API com servidor real | `evidencias/catalogo-icones-lotes-01/usuarios-r4/provas-api-r4.txt` — negativas A1–A8, positivas do admin da fazenda, revogação com JWT antigo → 403 |
| CLI de papel | `usuarios-r4/papel-tenant-cli.txt` (id de auditoria ocultado) |
| E2E Usuários (Chromium) | `usuarios-r4/resultado-usuarios.txt` — sem papel (só `is_admin`): recusado com a mensagem do servidor; após `papel-tenant`: cria a conta. Capturas 01 e 02 |
| E2E MAIKE Admin | **29/29** no código da R4, 1440/768/390/412 |
| E2E R2 (lote) | **15/15** no código da R4, 1440/768/390/412 |
| Smoke de deploy contra o Vite local | `usuarios-r4/smoke-deploy-local.txt` — proxy, Origin, login genérico, tenant fechado e bundle **PASS**; CSP, `X-Frame-Options` e `noindex` **FAIL por definição** (o Vite não aplica `vercel.json`). A prova real só existe contra o deploy |

### 9.6 Gate de rollout do admin

| Pronto localmente | Falta (operacional, com aprovação) |
|---|---|
| `apps/admin/vercel.json` com cabeçalhos; `build:admin`; `gate:admin-isolation` nos bundles | Projeto Vercel do admin com Root Directory `apps/admin` |
| Smoke `smoke-admin-deploy.mjs` com diagnóstico por falha | Endereço real do admin + rewrite `/api/native` → backend real (não inventado aqui) |
| Falha fechada sem chave / sem origin | `ADMIN_MAIKE_CHAVE` e `ADMIN_ORIGINS` no backend do ambiente |
| Migrations testadas do zero e idempotentes | Aplicar `20261028250000`…`20261029400000` com backup |
| `admin:bootstrap` e `papel-tenant.mjs` testados | Criar o proprietário; promover o administrador de cada fazenda |
| Troca de imagem sem deploy (mesmo id, URL versionada) | Upload das imagens reais pelo proprietário |

### 9.7 Riscos remanescentes

1. **JWT de tenant (8 h):** um usuário desativado ou rebaixado perde na hora toda ação privilegiada (o papel é relido), mas o JWT ainda abre rotas **não privilegiadas** até expirar. Revogação de sessão de tenant fica para PR própria.
2. **Provisionamento:** após o deploy nenhuma fazenda tem administrador; ninguém cria contas até `papel-tenant.mjs` (intencional, falha fechada).
3. Códigos `*_NOT_FOUND` não catalogados em outros módulos (aplicação de medicamento, bebedouro, evento sanitário, fornecedor, manejo técnico, movimentações, ponto e suplementação) → 500 em vez de 404, sem vazamento.
4. Limitador por IP do admin por instância (o bloqueio por conta é persistido).
5. MapLibre/WebGL: fora do escopo, pendente.

**Veredito da R4:** ver o relatório final da rodada na PR. Produção: NOT_RUN.
