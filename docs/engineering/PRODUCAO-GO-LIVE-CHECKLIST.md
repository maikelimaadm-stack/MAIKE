# Produção — checklist go-live (MAIKE Mapa + API nativa)

**Atualizado em:** 2026-10-27  
**Missão:** `cursor/producao-go-live-516d`  
**Plano detalhado:** [`PLAN-BACKEND-MIGRACAO-100.md`](./PLAN-BACKEND-MIGRACAO-100.md)

Este documento consolida o que o **proprietário** e o **CI** precisam para colocar
produção em estado **verificável** — sem afirmar “live” sem smoke nos URLs abaixo.

---

## 1. Arquitetura de deploy (escolha uma)

| Modo | Frontend | API | `VITE_MAIKE_API_URL` (Production) |
|------|----------|-----|-----------------------------------|
| **A — Monólito Vercel (recomendado, D-PROD-36)** | Vercel | `api/fastify.js` + rewrites em `vercel.json` | **Vazio** ou omitido — o cliente usa a origem do navegador |
| **B — Split** | Vercel | Railway `backend:start` | `https://<host-railway>` com esquema; `FRONTEND_ORIGINS` inclui o domínio Vercel |

**Produção (pós-merge PR #73 em `main`, 2026-10-27):** `vercel.json` na `main` inclui rewrites para auth, health, setores, áreas-pastagem, configuracao-icones, pontos-referencia, linhas-geograficas, usuarios e **marcas** → `/api/fastify`. Production em `maike-five.vercel.app` publicou commit `5b0fa1b8` (deploy Vercel READY).

---

## 2. Ordem obrigatória (nunca inverter)

```
1. Schema no PostgreSQL     → npm run deploy:migrate  (pre-deploy)
2. Build do frontend        → npm run prisma:generate && npm run build
3. Subir / publicar API     → Vercel deploy ou Railway backend:start
4. Bootstrap de usuário     → UMA VEZ por ambiente (script local, não HTTP)
5. Smoke HTTP               → /health e login (seção 7)
```

Migration **não** roda no `server.js` (D-PROD-28). Pre-deploy Railway/Vercel: `npm run deploy:migrate`.

---

## 3. Migrations Prisma (fonte: repositório)

| # | `migration_name` |
|---|------------------|
| 1 | `20260908174141_p3_foundation` |
| 2 | `20260909112833_p4_1_setor_native` |
| 3 | `20260909201703_p4_1_r2_setor_tipo_default` |
| 4 | `20260910190000_p4_2_area_pastagem_native` |
| 5 | `20261023180000_p4_3_map_geography_native` |
| 6 | `20261023210000_p6_1_login_global_hygiene` |
| 7 | `20261027140000_p4_marcas_native` |

**Meta:** `SELECT count(*) FROM _prisma_migrations;` → **7**.

### Supabase MAIKE (`uuemcasqcdjucflulkne`, sa-east-1) — estado verificado 2026-10-27 (pós-PR #73)

| Item | Estado |
|------|--------|
| Registros em `_prisma_migrations` | **7/7** — inclui `20261027140000_p4_marcas_native` (DDL + histórico via Supabase MCP pós-merge) |
| Tabela `Marca` (P4.4) | **Presente** |
| Tabelas P4.2/P4.3 | **Existem** (ver `SUPABASE-MAIKE-MIGRATIONS-SYNC-REPORT.md`) |
| Índice `Usuario_login_ativo_global_key` (P6.1) | **Presente** |

**Próximo pre-deploy:** `npm run deploy:migrate` com `MIGRATION_DATABASE_URL` na sessão **5432** deve ser **no-op** (nenhuma migration pendente). Se o histórico divergir de novo, usar `prisma migrate resolve --applied <nome>` só para migrations cujo DDL já estiver no banco — nunca reaplicar DDL manualmente.

```bash
# Referência (já executado no Supabase MAIKE em 2026-10-27):
# resolve --applied 20260910190000_p4_2_area_pastagem_native
# resolve --applied 20261023180000_p4_3_map_geography_native
# resolve --applied 20261023210000_p6_1_login_global_hygiene
npm run deploy:migrate
```

**RLS:** permanece **desligado** até P8 — não habilitar sem políticas.

---

## 4. Variáveis de ambiente

### 4.1 Backend (sem prefixo `VITE_`)

| Variável | Obrigatória | Notas |
|----------|-------------|--------|
| `DATABASE_URL` | Sim | App; pooler Supabase OK para runtime Prisma |
| `MIGRATION_DATABASE_URL` | Pre-deploy | **Sessão/direct 5432**; runner **recusa** Supabase **6543** |
| `AUTH_SECRET` | Sim | Gerar por ambiente; marcar Sensitive no Vercel |
| `FRONTEND_ORIGINS` | Sim | Lista **exata**, vírgula, **sem** barra final |
| `AUTH_TOKEN_TTL` | Não | Default `8h` |

### 4.2 Frontend (build — prefixo `VITE_`)

| Variável | Obrigatória | Notas |
|----------|-------------|--------|
| `VITE_GOOGLE_MAPS_API_KEY` | Sim (mapa) | Restringir no Google Cloud por referrer |
| `VITE_MAIKE_API_URL` | Modo A: vazio | Modo B: URL absoluta do Railway |
| `VITE_SKIP_NATIVE_LOGIN` | **Não em produção estável** | D-PROD-37 — remover quando login OK |

### 4.3 Vercel projeto `maike` (nomes observados — Production/Preview)

**MAIKE nativo (usar):** `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `AUTH_SECRET`, `FRONTEND_ORIGINS`, `AUTH_TOKEN_TTL`, `VITE_MAIKE_API_URL`, `VITE_GOOGLE_MAPS_API_KEY`, `VITE_SKIP_NATIVE_LOGIN`

**Integração Supabase (marketplace — não substituem o contrato Prisma acima):** `POSTGRES_*`, `SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_*`

Valores **nunca** colar em chat nem em docs versionados.

### 4.4 `FRONTEND_ORIGINS` (exemplo Production)

Incluir **todos** os origins reais do navegador, por exemplo:

- `https://maike-five.vercel.app` (alias de produção observado)
- Cada preview estável que precisar de CORS, se testar login
- `http://localhost:5173` só se ainda for necessário em Preview

### 4.5 `VITE_MAIKE_API_URL`

- **Monólito Vercel:** deixar **vazio** e **redeploy** (rebuild) — evita login indo para host errado quando o preview URL ≠ alias.
- **Split Railway:** `https://<seu-servico>.up.railway.app` (com `https://`).

---

## 5. Bootstrap (uma vez por banco)

Não é rota HTTP. Rodar com acesso à `DATABASE_URL` do ambiente (máquina local + tunnel ou job one-off):

```bash
export BOOTSTRAP_CLIENTE_CODIGO=...
export BOOTSTRAP_CLIENTE_NOME=...
export BOOTSTRAP_USUARIO_LOGIN=...
export BOOTSTRAP_USUARIO_NOME=...
export BOOTSTRAP_USUARIO_SENHA=...
npm run auth:bootstrap:local
```

Login na UI: **login + senha** (sem código de cliente — D-PROD-33/35).

Se o usuário já existe, use `npm run auth:reset-password` (ver `AGENTS.md`).

---

## 6. Passos nos painéis (proprietário)

### Supabase → projeto MAIKE

1. **Settings → Database** → copiar connection string **Session mode** ou **Direct**, porta **5432**.
2. Gravar em `MIGRATION_DATABASE_URL` (Railway pre-deploy e/ou Vercel se usar pre-deploy).
3. Se `_prisma_migrations` < 6 mas tabelas já existem: executar `prisma migrate resolve` (seção 3) e depois `deploy:migrate`.
4. Confirmar: SQL `SELECT migration_name FROM _prisma_migrations ORDER BY finished_at;` → 6 linhas.

### Railway (se Modo B — backend separado)

1. Serviço backend → **Variables:** `DATABASE_URL`, `AUTH_SECRET`, `FRONTEND_ORIGINS`, `MIGRATION_DATABASE_URL` (5432).
2. **Deploy → Pre-deploy command:** `npm run deploy:migrate`
3. **Start command:** `npm run backend:start`
4. Deploy **originado da branch mergeada** (não só “Redeploy” da spec antiga — DEPLOY-MIGRATION-01).

### Vercel → projeto `maike`

1. **Settings → Environment Variables:** conferir seção 4.3; corrigir `VITE_MAIKE_API_URL` (vazio no monólito).
2. **Remover** `VITE_SKIP_NATIVE_LOGIN=true` quando login estiver validado.
3. `AUTH_SECRET`: tipo Sensitive; rotacionar se já foi exposto em build legível.
4. Após qualquer `VITE_*` ou `vercel.json`: **novo deploy Production** (build embute env).
5. Opcional pre-deploy Vercel: `npm run deploy:migrate` (exige `MIGRATION_DATABASE_URL` 5432 no projeto).

---

## 7. URLs de health e smoke

Substitua `<ORIGEM>` pelo domínio real (ex.: `https://maike-five.vercel.app`).

| Verificação | Método | Sucesso esperado |
|-------------|--------|------------------|
| Health API | `GET <ORIGEM>/health` | JSON `status: "ok"`, `banco: "up"`, `configuracaoIncompleta: []` |
| Login | UI ou `POST <ORIGEM>/auth/login` | JWT; sem campo `cliente` no body |
| Mapa nativo | Login → Mapa Geral | Setores/áreas/geografia não retornam 404 por rewrite ausente |
| Maps | Mapa carrega tiles | Chave Google configurada |

**Produção (`maike-five.vercel.app`, 2026-10-27):** `/health` **OK** (`banco: up`). Rewrites P4.2+ dependem do deploy ativo em Production (ver `vercel.json` na `main` pós-PR #70).

---

## 8. Certificação local / CI

```bash
npm ci
cp .env.example .env   # preencher DATABASE_URL, AUTH_SECRET, FRONTEND_ORIGINS
npm run db:up
npm run prisma:deploy
npm run verify:all
```

`verify:all` exige PostgreSQL em `DATABASE_URL` na etapa `test:backend`.

---

## 9. Ordem de merge (executado 2026-10-27)

1. **PR #70** — `cursor/producao-go-live-516d` → merge `7cb687e8` (checklist + rewrites; supersede #69)
2. **PR #68** — `cursor/ux-base1-marcas-mobile-unica-516d` → merge `a312f857`
3. **PR #69** — fechar manualmente no GitHub (duplicata de #70; token de agente sem permissão `closePullRequest`)

Após merge em `main`: redeploy Production Vercel + `deploy:migrate` (no-op esperado) + smoke seção 7.

---

## 10. Critério “produção OK”

Marcar go-live somente quando **todos** forem verdadeiros:

- [x] 6/6 migrations em `_prisma_migrations` (Supabase MAIKE, 2026-10-27)
- [x] 10/10 tabelas Prisma + índices no Supabase (auditoria agente 2026-10-27 — `PRODUCAO-TABELAS-SUPABASE-AUDIT-2026-10-27.md`)
- [x] `main` com rewrites completos em `vercel.json` (aguarda redeploy Production se deploy antigo)
- [x] `/health` OK no domínio de produção (`maike-five.vercel.app`, 2026-10-27)
- [ ] Login nativo sem `VITE_SKIP_NATIVE_LOGIN` (Vercel env — agente sem acesso MCP ao projeto)
- [ ] Mapa Geral carrega e APIs nativas do mapa respondem (autenticadas)
- [ ] `npm run verify:all` verde no CI da branch mergeada

---

## Referências

- `AGENTS.md` — comandos
- `.env.example` — contrato de variáveis
- `docs/engineering/SUPABASE-MAIKE-MIGRATIONS-SYNC-REPORT.md`
- `docs/engineering/DECISIONS.md` — D-PROD-28/29/36/37
