# Catálogo global — slice 1 R1 backend (D-PROD-62)

**Missão:** `CATALOGO-GLOBAL-SLICE1-R1-BACKEND-01`  
**Branch:** `cursor/catalogo-global-slice1-r1-516d`  
**Base:** `main` pós-merge PR #130

## Correções (handoff 1–9)

| # | Item | Implementação |
|---|---|---|
| 1 | Storage fail-closed | `exigirArmazenamentoCatalogoAoVivo()` — produção exige Supabase live; parcial URL/key reprova |
| 2 | Paths + revisão | Upload usa `CatalogoMeta.revisao`; unique `(sha256, revisao)` |
| 3 | MIME real | `validarBufferAssetCatalogo` (mantido/reforçado) |
| 4 | Compensação DB/Storage | `registrarAsset` remove objeto se transação falhar após upload |
| 5 | Lista ícones + URLs | `listarIconesPublicados` → `asset_principal_url`, `asset_subicone_url` |
| 6 | Validação tipo/categoria | `catalogoValidacao.js` em ícone e categoria |
| 7 | Regras MISTO | Normalização IDs, tipo do ícone, publicação |
| 8 | CAS 409 | `revisao_esperada` + `assertRevisaoCatalogo` → `CONCURRENCY_CONFLICT` |
| 9 | Runbook + bootstrap | `bootstrap-storage-bucket.sql`, `bootstrap-operador-produto.mjs` |

## API nova

- `PATCH /catalogo-global/admin/icones/:id` — atualiza `asset_principal_id`, `asset_subicone_id`, `cor_fallback` (id estável).

## Migration

- `20261028250200_catalogo_global_slice1_r1_assets` — unique `CatalogoAsset(sha256, revisao)`.

## Testes

- `backend/tests/catalogoGlobalNativo.test.mjs` — CG-01…CG-15.

## Rollout (sem prod nesta missão)

1. `deploy:migrate`  
2. Bucket + env Supabase server-only  
3. Bootstrap operador (script endurecido)  
4. Smoke CAS + upload + leitura URLs
