# Catálogo global — slice 1 backend (D-PROD-57 / D-PROD-60)

**Missão:** `CATALOGO-GLOBAL-SLICE1-BACKEND-01`  
**Branch:** `cursor/catalogo-global-slice1-516d`

## Entregue

- Prisma: 9 models globais + migrations `20261028250000_catalogo_global_slice1` e fix `20261028250100_catalogo_global_slice1_schema_fix` (RLS/revoke P8 nas tabelas novas).
- Contrato ModeloBase1: `globalCatalogModels` + `modelsWithoutTenantField` (D-PROD-60).
- Fastify: `/catalogo-global/*` leitura autenticada; `/catalogo-global/admin/*` exige `OperadorProdutoMaike`.
- Storage: upload server-side com validação MIME/sha256/dimensões; adaptador memória em teste; Supabase REST quando `SUPABASE_*` configurados.
- Scripts: `scripts/catalogo/bootstrap-operador-produto.mjs`, `scripts/catalogo/bootstrap-storage-bucket.sql` (documentação idempotente).
- Testes: `backend/tests/catalogoGlobalNativo.test.mjs` (CG-01…CG-08).

## Fora de escopo (preservado)

Mapa Geral, MapLibre UI, `GerenciadorIcones`, `ConfiguracaoIcone` legado, `mapGeography`.

## Rollout

1. `deploy:migrate`  
2. Conferir RLS/grants nas 9 tabelas  
3. Bootstrap bucket Storage (manual)  
4. Bootstrap primeiro operador (manual, script)  
5. Smoke read/write operador
