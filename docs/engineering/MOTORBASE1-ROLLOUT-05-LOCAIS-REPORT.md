# MOTORBASE1-ROLLOUT-05 — Locais de Estoque

**Branch:** `cursor/motorbase1-rollout-locais-estoque-516d`  
**Base:** `origin/main` @ `67855165` (pós merge PR #117)  
**Decisões:** D-PROD-55 (motor Base1), D-PROD-48 (local nativo)

## Entregas

| ID | Entrega | Estado |
|---|---|---|
| A | `LocaisEstoque.jsx` → `useCadastroBase1Controller` + `CadastroBase1Screen` | Implementado |
| B | `TabelaLocaisEstoque` + `FormularioLocalEstoque` | Implementado |
| C | `GET /locais-estoque/page` keyset tenant-global; `GET /locais-estoque` array intacto | Implementado |
| D | `localEstoqueNativePort.listPage` fora do cache offline (janela ≠ lista completa) | Implementado |
| E | `DELETE` guarda `LOCAL_ESTOQUE_DELETE_BLOCKED` (4 vínculos, transação) | Implementado |
| F | Preservados `propagarRename` + `LOCAL_ESTOQUE_PARTIAL_OPERATION` no service | Implementado |

## Contratos HTTP

- `GET /locais-estoque` — array completo (dropdowns, export legado).
- `GET /locais-estoque/page` — envelope keyset; **sem** `empresa_id` (escopo tenant).
- `DELETE /locais-estoque/:id` — 409 `LOCAL_ESTOQUE_DELETE_BLOCKED` com `details.motivo` ∈ `deposito_do_mapa` \| `produtos_vinculados` \| `movimentacoes_vinculadas` \| `saldo_em_estoque`.

## Preservado

- `storageKey`: `colunas_locais_estoque`
- `droppableId`: `colunas-locais-estoque`
- Propagação de rename para mapa (depósito, ponto de referência, cochos) e erro parcial documentado (P1.4)

## Testes

- `tests/smoke/locaisEstoqueBase1Rollout.test.jsx`
- `tests/smoke/suporteServices.test.js` (rename parcial + 4 travas frontend)
- `backend/tests/cadastrosEstoqueNativo.test.mjs` (PAGE + DELETE guard)
- `npm run verify:all`

## Homologação visual

Capturas multi-breakpoint — **PENDING MANUAL** (sem sessão autenticada estável no agente).

## Veredito

**GO técnico** — motor Base1 plugado em Locais de Estoque, paginação nativa tenant-global, guarda de exclusão no backend alinhada às quatro travas do service, testes e gates previstos em `verify:all`.
