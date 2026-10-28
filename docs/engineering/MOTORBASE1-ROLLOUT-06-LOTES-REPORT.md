# MOTORBASE1-ROLLOUT-06 — Cadastro de Lotes

**Branch:** `cursor/motorbase1-rollout-lotes-01-337f`  
**Base:** `origin/main` @ `0a999928` (pós merge PR #120)  
**Decisões:** D-PROD-55 (motor Base1), D-PROD-47 (lote nativo), D-PROD-18 (guarda de exclusão)

## Entregas

| ID | Entrega | Estado |
|---|---|---|
| A | `CadastroLotes.jsx` → `useCadastroBase1FullListController` + `CadastroBase1Screen` | Implementado |
| B | `FormularioLote` visual Base1 (`DynamicFormRenderer` variant + layout configurável preservado) | Implementado |
| C | `TabelaLotes` — agregação, `onDisplayChange`, `storageKey` `colunas_cadastro_lotes` | Preservado |
| D | Anexos (`RegistroAnexosDialog`) + refresh do mapa só após mutações bem-sucedidas | Implementado |
| E | `DELETE /lotes/:id` — 409 `LOTE_DELETE_BLOCKED` (5 famílias, transação) | Implementado |
| F | `excluirLotes` — relatório honesto `{ excluidos, bloqueados }` | Implementado |

## Contratos HTTP

- `DELETE /lotes/:id` — 409 `LOTE_DELETE_BLOCKED` com `details.vinculo` ∈ `movimentacoes_mapa` \| `movimentacoes_pecuarias` \| `suplementacao_lote` \| `lancamentos_tarefa` \| `manejos_tecnicos` (JSON `lote_id` nas entidades documento).

## Preservado

- `storageKey`: `colunas_cadastro_lotes`
- `droppableId`: `colunas-cadastro-lotes`
- Layout/aggregation localStorage (`cadastro_lotes_form_layout_config`, `cadastro_lotes_table_aggregation_config`)
- Filtro `incluirSistema: false` na listagem do cadastro

## Testes

- `tests/smoke/lotesBase1Rollout.test.jsx`
- `backend/tests/loteNativo.test.mjs` (DELETE guard)
- `npm run verify:all`

## Homologação visual

Capturas multi-breakpoint — **PENDING MANUAL**.

## Veredito

**GO técnico** — motor Base1 full-list plugado em Cadastro de Lotes, formulário com variant Base1 sem perder campos/abas configuráveis, guarda de exclusão no backend alinhada às cinco travas do domínio, exclusão em lote com contagem explícita.
