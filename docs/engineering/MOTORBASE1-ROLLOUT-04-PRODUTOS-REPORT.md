# MOTORBASE1-ROLLOUT-04 — Produtos

**Branch:** `cursor/motorbase1-rollout-produtos-61bd`  
**Base:** `origin/main` @ `a85f348d` (pós merge PR #116)  
**Decisões:** D-PROD-55 (motor), D-PROD-48 (produto nativo)

## Entregas

| ID | Entrega | Estado |
|---|---|---|
| A | `Produtos.jsx` → `useCadastroBase1Controller` + `CadastroBase1Screen` | Implementado |
| A2 | Extensões genéricas do screen: `extraToolbar`, `onExportCsv`, `onPrint` | Implementado |
| B | `GET /produtos/page` keyset; `GET /produtos` array intacto | Implementado |
| C | `FormularioProduto` embedded Base1 (`toolbarActions`, `readOnly`, `FORMULARIO_PRODUTO_ID`) | Implementado |
| D | CSV: export empresa completa vs janela chrome; import sem `numero_produto` no cliente | Implementado |
| E | `DELETE` guarda `PRODUTO_DELETE_BLOCKED` + `details.quantidade` (transação) | Implementado |
| F | `TabelaProdutos`: `ATIVO_BADGE`, cards `nome`/`numero`, bulk delete via controller | Implementado |

## Contratos HTTP

- `GET /produtos` — array completo (dropdowns, exportação empresa).
- `GET /produtos/page` — envelope keyset; `empresa_id` obrigatório; busca `q` em nome/código/categoria/marca/número/barras.
- `DELETE /produtos/:id` — 409 `PRODUTO_DELETE_BLOCKED` quando há `MovimentacaoEstoque` no tenant.

## Preservado

- `storageKey`: `colunas_produtos_v2`
- `droppableId`: `colunas-produtos`
- Regras de formulário, CSV de domínio, importação best-effort, ficha de impressão

## Testes

- `tests/smoke/produtosBase1Rollout.test.jsx`
- `tests/smoke/suporteServices.test.js` (CSV + exclusão)
- `backend/tests/cadastrosEstoqueNativo.test.mjs` (PAGE + DELETE guard)
- `npm run verify:all`

## Homologação visual

Capturas multi-breakpoint — **PENDING MANUAL** (sem sessão autenticada estável no agente).

## Veredito

**GO técnico** — motor Base1 plugado em Produtos, paginação nativa, guarda de exclusão no backend, testes e gates previstos em `verify:all`.
