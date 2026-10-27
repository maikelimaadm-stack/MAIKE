# Plano — Backend e migrations 100% operacional

**Missão:** `cursor/backend-migracao-organize-516d`  
**Atualizado em:** 2026-10-27  
**Escopo:** infraestrutura backend/migrations/deploy — sem UX Base1.

Este documento é o caminho operacional para deixar **local → CI → Supabase/Railway/Vercel**
alinhados no mesmo conjunto de migrations Prisma e nas mesmas variáveis de ambiente.

---

## Auditoria (estado na `main` + branch desta missão)

### O que funciona

| Área | Evidência |
|---|---|
| Schema Prisma | 6 migrations versionadas; `npm run prisma:validate` na cadeia |
| Backend Fastify | Rotas: `/health`, `/auth/*`, `/setores`, `/areas-pastagem`, geografia (`/configuracao-icones`, `/pontos-referencia`, `/linhas-geograficas`), `/usuarios` |
| Testes | `npm run test:backend` — **142 testes**, 37 suítes (exige `DATABASE_URL` + `AUTH_SECRET`) |
| Runner de deploy | `npm run deploy:migrate` — `MIGRATION_DATABASE_URL` obrigatória, recusa pooler 6543 |
| CI | GitHub Actions `quality.yml` — PostgreSQL 16.13 efêmero + `verify:all` |
| Migrations locais | `docker compose up -d db` + `prisma:deploy` (ou Postgres nativo com credenciais de `.env.example`) |
| Monólito Vercel | `api/fastify.js` + rewrites em `vercel.json` (D-PROD-36) |

### Lacunas / riscos encontrados

| # | Item | Severidade | Ação nesta missão |
|---|---|---|---|
| L1 | `vercel.json` só reescrevia `/auth`, `/health` e `/setores` — P4.2+ quebrava no mesmo deploy | **crítica** | Rewrites completos para todas as rotas nativas |
| L2 | Supabase remoto: relatório de 2026-10-23 aplicou P4.2/P4.3 manualmente; **`p6_1_login_global_hygiene` pode faltar** no projeto `uuemcasqcdjucflulkne` | **alta** | Proprietário: `deploy:migrate` no próximo deploy ou `prisma migrate deploy` com URL de sessão (5432) |
| L3 | Railway: produção pode estar em **3** migrations (último registro DEPLOY-MIGRATION-01) vs **6** no repositório | **alta** | Pre-deploy `npm run deploy:migrate` com `MIGRATION_DATABASE_URL` (sessão, não 6543) |
| L4 | `README_AI.md` / trechos de `CURRENT-STATE.md` ainda citam P4.2 “não iniciada” em parágrafos antigos | documental | Seção backend atualizada em `CURRENT-STATE.md` (esta missão) |
| L5 | DBT-23 em `CURRENT-STATE.md` (“sem backend no repo”) está **obsoleto** — backend existe desde P3 | documental | Não alterado nesta missão (fora do escopo mínimo) |

### Inventário de migrations (`backend/prisma/migrations/`)

| Migration | Conteúdo |
|---|---|
| `20260908174141_p3_foundation` | Cliente, Usuario, AuditLog, sequência, anexos |
| `20260909112833_p4_1_setor_native` | Setor |
| `20260909201703_p4_1_r2_setor_tipo_default` | Default `Setor.tipo` |
| `20260910190000_p4_2_area_pastagem_native` | AreaPastagem |
| `20261023180000_p4_3_map_geography_native` | Ícone, ponto, linha |
| `20261023210000_p6_1_login_global_hygiene` | Login global, unique `lower(login)` ativo |

**Contagem esperada em produção após deploy:** `_prisma_migrations` com **6** linhas aplicadas.

---

## Fase 0 — Pré-requisitos

- Node conforme `.nvmrc`
- `npm ci`
- Copiar `.env.example` → `.env` (backend) e `.env.local` (frontend)
- **Nunca** versionar `.env*` com segredos reais

---

## Fase 1 — Banco local (PostgreSQL)

```bash
npm run db:up          # Docker Compose — postgres:16.13-alpine
# ou Postgres instalado localmente com usuário/banco de .env.example
```

Variáveis mínimas em `.env`:

```bash
DATABASE_URL=postgresql://maike:maike_dev@localhost:5432/maike_dev
MIGRATION_DATABASE_URL=postgresql://maike:maike_dev@localhost:5432/maike_dev
AUTH_SECRET=<gerar com node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))">
FRONTEND_ORIGINS=http://localhost:5173
PORT=3333
```

---

## Fase 2 — Prisma deploy (schema no banco)

```bash
npm run prisma:validate
npm run prisma:generate
npm run prisma:deploy          # dev/local direto
# produção:
npm run deploy:migrate         # exige MIGRATION_DATABASE_URL (sessão)
```

Ordem obrigatória em deploy: **build → `deploy:migrate` (pre-deploy) → subir processo** — nunca migration no `server.js` (D-PROD-28).

---

## Fase 3 — Bootstrap de autenticação (primeiro tenant)

Somente ambiente local / operação manual — **não** é endpoint HTTP:

```bash
export BOOTSTRAP_CLIENTE_CODIGO=...
export BOOTSTRAP_CLIENTE_NOME=...
export BOOTSTRAP_USUARIO_LOGIN=...
export BOOTSTRAP_USUARIO_NOME=...
export BOOTSTRAP_USUARIO_SENHA=...
npm run auth:bootstrap:local
```

Login na UI: **usuário + senha** (sem código de cliente — D-PROD-33/35).

Redefinição de senha (global):

```bash
RESET_PASSWORD_LOGIN=... RESET_PASSWORD_NOVA_SENHA=... RESET_PASSWORD_CONFIRM=sim npm run auth:reset-password
```

---

## Fase 4 — API e health

```bash
npm run backend:dev    # :3333 com watch
curl -s http://localhost:3333/health | jq .
```

Corpo esperado quando OK: `status: "ok"`, `banco: "up"`, `configuracaoIncompleta: []`.

Testes automatizados:

```bash
export DATABASE_URL=... AUTH_SECRET=... FRONTEND_ORIGINS=http://localhost:5173
npm run test:backend
```

---

## Fase 5 — Variáveis de ambiente (referência)

### Frontend (build — prefixo `VITE_`)

| Variável | Onde | Notas |
|---|---|---|
| `VITE_MAIKE_API_URL` | Vercel / Railway front | Absoluta com `https://` ou vazia no monólito Vercel (D-PROD-36). Local: `http://localhost:3333` |
| `VITE_GOOGLE_MAPS_API_KEY` | Vercel | Pública no bundle; restrinja no Google Cloud |
| `VITE_SKIP_NATIVE_LOGIN` | Emergência | Só enquanto login quebrado (D-PROD-37) — remover depois |

### Backend (processo — **sem** `VITE_`)

| Variável | Onde | Notas |
|---|---|---|
| `DATABASE_URL` | Railway / Vercel serverless / local | Pooler OK para app; não para migration |
| `MIGRATION_DATABASE_URL` | Pre-deploy Railway | Supabase: porta **5432** (sessão ou direta), **não** 6543 |
| `AUTH_SECRET` | Todos | Obrigatório; sem fallback |
| `FRONTEND_ORIGINS` | Todos | Lista exata, separada por vírgula; vazio = nenhum browser |
| `AUTH_TOKEN_TTL` | Opcional | Default `8h` |

---

## Fase 6 — Supabase (PostgreSQL remoto)

Projeto documentado: **MAIKE** (`uuemcasqcdjucflulkne`, sa-east-1) — ver
`docs/engineering/SUPABASE-MAIKE-MIGRATIONS-SYNC-REPORT.md`.

1. Obter URL de **sessão** (5432) no painel Supabase → Settings → Database.
2. Definir `MIGRATION_DATABASE_URL` no serviço que roda pre-deploy (Railway) **ou** executar uma vez:
   `MIGRATION_DATABASE_URL='postgresql://...' npm run deploy:migrate`
3. `DATABASE_URL` da aplicação pode usar pooler, se suportar prepared statements do Prisma.
4. **RLS:** permanece desligado até P8 — não habilitar sem políticas.
5. Confirmar: `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at;` → 6 registros.

---

## Fase 7 — Vercel (frontend + API same-origin)

| Artefato | Função |
|---|---|
| `vercel.json` | `buildCommand`: `prisma:generate` + `build`; rewrites das rotas nativas → `/api/fastify` |
| `api/fastify.js` | Handler serverless reutilizando `construirApp` |

Variáveis no projeto Vercel (Production + Preview):

- `DATABASE_URL`, `AUTH_SECRET`, `FRONTEND_ORIGINS` (origins exatas dos domínios reais)
- `VITE_MAIKE_API_URL` vazio ou coerente com D-PROD-36
- `MIGRATION_DATABASE_URL` se pre-deploy Vercel executar `deploy:migrate` (mesma regra Railway)

Backend **separado** no Railway: manter `VITE_MAIKE_API_URL=https://<host-railway>` com esquema e `FRONTEND_ORIGINS` incluindo o domínio Vercel.

---

## Fase 8 — Certificação

```bash
npm run verify:all
```

Exige PostgreSQL acessível via `DATABASE_URL` na etapa `test:backend`. CI já fornece.

---

## Próximos passos do proprietário (checklist)

- [ ] Confirmar 6/6 migrations no Supabase (`_prisma_migrations`)
- [ ] Railway: pre-deploy `npm run deploy:migrate` ativo; redeploy após merge desta PR (rewrites Vercel)
- [ ] Vercel: `DATABASE_URL`, `AUTH_SECRET`, `FRONTEND_ORIGINS` em Production/Preview; rebuild após alterar `VITE_*`
- [ ] Rotacionar / validar `AUTH_SECRET` por ambiente (nunca reutilizar dev → prod)
- [ ] Smoke manual: login → mapa → listar setores/áreas (dados nativos vazios até recadastro — D-PROD-27)
- [ ] Manter PR #68 (UX) em merge separado conforme combinado

---

## Referências

- [`PRODUCAO-GO-LIVE-CHECKLIST.md`](./PRODUCAO-GO-LIVE-CHECKLIST.md) — checklist consolidado para o proprietário
- `AGENTS.md` — comandos operacionais
- `.env.example` — contrato de variáveis
- `docs/engineering/DECISIONS.md` — D-PROD-28/29 (migrations), D-PROD-36 (Vercel), D-PROD-33/35 (login)
- `docs/engineering/GATE-REGISTRY.md` — `gate:deploy-migrations`, `test:backend`
