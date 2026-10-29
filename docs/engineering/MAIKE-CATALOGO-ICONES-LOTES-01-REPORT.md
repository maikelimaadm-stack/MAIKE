# MAIKE-CATALOGO-ICONES-LOTES-01 — catálogo global de ícones, MAIKE Admin e ícone no lote

**Missões na PR #145 (DRAFT):**

| Rodada | Missão | O que fez |
|---|---|---|
| R1 | `MAIKE-CATALOGO-GLOBAL-ICONES-LOTES-01` | painel na SPA (revertido) |
| R2 | `MAIKE-PR145-CATALOGO-SUPABASE-LOTES-R2` | vínculo CategoriaManejo → catálogo, D-PROD-69 |
| R3 | `MAIKE-PR145-R3-ADMIN-PRINCIPAL-CATALOGO-ICONES-01` | proprietário independente + MAIKE Admin, D-PROD-70 |

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

1. **`PATCH /usuarios/:id`:** qualquer usuário autenticado do tenant troca a senha de **outro** usuário do mesmo tenant. A prova reproduzível está nas provas negativas: o comum troca a senha do admin do tenant e o login antigo passa a falhar.
   - Não alcança o proprietário do produto.
   - Fica **fora desta PR**; tarefa sugerida.
   - **Bloqueia o lançamento** até a correção numa PR própria.
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

**Veredito:** READY_FOR_ARCHITECT_AUDIT (código e testes locais) · NOT_READY_FOR_PRODUCTION (rollout pendente e risco do item 7.1).
