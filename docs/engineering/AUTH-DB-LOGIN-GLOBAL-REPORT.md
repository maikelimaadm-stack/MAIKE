# Auth — higiene de login global no banco (P6.1)

**Data:** 2026-10-23  
**Decisão:** D-PROD-35  
**Branch:** `cursor/auth-db-login-global-516d`

## Problema

Com login **sem código de cliente** (D-PROD-33), o backend resolve o tenant pelo
`Usuario`. Vários registros ativos com o mesmo login (ou bootstrap legado
`maike` vs operador digitando `admin`) geram **credenciais inválidas** ou
confusão operacional, mesmo com um único `Cliente` no Supabase.

## Solução

| Camada | Entrega |
|--------|---------|
| Migration | `20261023210000_p6_1_login_global_hygiene` — normaliza, deduplica, índice parcial |
| Auth | Login normalizado (trim + minúsculas); busca case-insensitive |
| P6.0 | Criação de conta recusa login já ativo em outro tenant |
| Schema | Comentários: `Cliente.codigo` é interno, não entra na tela |

## Deploy

Rodar `npm run prisma:deploy` (ou pre-deploy Railway) com
`MIGRATION_DATABASE_URL` na sessão Supabase (porta 5432). A migration é
idempotente.

## Verificação

- `npm run test:backend`
- `npm run gate:tenancy` · `npm run gate:indices`
- `npm run verify:all`
