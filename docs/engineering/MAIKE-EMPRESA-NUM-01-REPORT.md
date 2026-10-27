# MAIKE — EMPRESA-NUM-01 — Relatório

**Data:** 2026-10-27  
**Branch:** `cursor/empresa-num-01-sequencia-persistencia-516d`  
**Base `main` pós-merge PR #102:** `0e8da2e685a9000448bf9eb664bc43623b446d57`  
**PR #102:** MERGED (UX Base1 / Marcas escala + fix CI `prisma:generate` no `verify:all`)

## Diagnóstico — cadastro não salvava

- **Causa estrutural corrigida:** `src/services/empresaService.js` fazia `listEmpresas()` antes de cada `create`/`update`; falha no GET bloqueava o POST (offline, erro transitório, tenant/cache).
- **Autoridade:** unicidade de nome e numeração passam a ser só backend (`409 EMPRESA_NAME_CONFLICT`, sequência transacional).
- **E2E produção/preview autenticado:** não executado neste ambiente — classificar validação externa como **PENDING**.

## Numeração

- Campo `numero_empresa` (`Int`, NOT NULL, `> 0`), `@@unique([cliente_id, numero_empresa])`.
- SSOT: `EntidadeCodigoSequencia` + `reservarNumeroEmpresa` (bootstrap único se linha nova + backfill `MAX+1`).
- Exclusão não reutiliza número; `id` (`cuid`) permanece FK/referências.

## Migration

- `20261028210000_empresa_numero_empresa`: nullable → backfill `ROW_NUMBER` por tenant → NOT NULL → unique → CHECK.
- **Deploy:** `MIGRATION_DATABASE_URL` + `npm run deploy:migrate` **antes** do runtime novo (gate `deploy-migrations`).

## Testes executados (agente)

- `npm run verify:all` (com `.env`: `DATABASE_URL`, `AUTH_SECRET`) — ver commit HEAD da branch.
- `backend/tests/empresaNumero.test.mjs` — sequência 1,2,3 / delete / 4, isolamento tenant, rejeição `numero_empresa`, 409 nome, GET `/api/native/empresas`.

## Pós-merge manual (operador)

1. Backup PostgreSQL produção.
2. `npm run deploy:migrate` com `MIGRATION_DATABASE_URL` (sessão/direct, não pooler de transação).
3. Promover deploy Vercel/backend após migration aplicada.
4. Smoke: login → Empresas → criar sem CPF/CNPJ → coluna **Nº** → refresh.

## Veredito

**GO** para merge da PR EMPRESA-NUM-01 após CI verde no HEAD da branch. Preview/produção real: **PENDING** até smoke manual.
