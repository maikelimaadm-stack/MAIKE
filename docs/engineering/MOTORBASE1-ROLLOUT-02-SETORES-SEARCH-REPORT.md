# MOTORBASE1-ROLLOUT-02 — Setores + pesquisa integrada fechada

**Missão:** PR #114 (draft) · branch `cursor/motorbase1-rollout-setores-search-closed-516d`  
**Decisões:** D-PROD-55 (motor), D-PROD-25 (setor sem DELETE)

## Entregas

| ID | Entrega | Estado |
|---|---|---|
| A | Busca integrada (`joinTableToolbar`) inicia **fechada** (lupa) em Marcas/Unidades/Setores | Implementado em `CadastroListaChrome.jsx` |
| B | `CadastroSetores` consome `useCadastroBase1Controller` + `CadastroBase1Screen` + preset integrado | Implementado |
| B7 | Paginação keyset `GET /setores/page` (aditiva; `GET /setores` array intacto) | Implementado |

## Antes → depois (Setores)

| Aspecto | Antes | Depois |
|---|---|---|
| Orquestração | `useCadastroListaChromeState` + chrome manual | Motor Base1 |
| Listagem | `GET /setores` full + filtro browser | `GET /setores/page?empresa_id=&q=&cursor=` |
| Grade | `CadastroBase1Grade` sem preset/badge SSOT | `BASE1_LISTA_INTEGRADA_VISUAL` + `cellKind: ativo-badge` |
| Form | Inputs legados, sem `readOnly` real | `B1Field` / `B1ChaveRow`, `toolbarActions`, `readOnly` |
| storageKey | `colunas_largura_setores` | **preservado** |
| droppableId | `colunas-setores` | **preservado** |
| Exclusão | `SETOR_DELETE_UNAVAILABLE` | **inalterada** — sem rota DELETE |

## Contratos HTTP

- `GET /setores` — array completo (mapa, offline, dropdowns).
- `GET /setores/page` — envelope `{ items, next_cursor, has_more, total, limit }`; `empresa_id` obrigatório; tenant via JWT; busca `q` em nome/sigla/responsável/cidade/numero_setor; filtro `ativo`; keyset `(createdAt DESC, id DESC)`.
- Sem `DELETE /setores/:id`.

## Frontend

- `listSetoresPage` / `listarSetoresPagina` — fora do cache offline (`operacoesNativas.listPage`).
- Query desligada sem `empresaSelecionadaId`; troca de empresa zera seleção/form/busca.

## Matriz D1–D9 (Setores pós-rollout)

| Dim | Descrição | PASS |
|---|---|---|
| D1 | Shell lista integrada | PASS |
| D2 | Chrome portal + busca fechada | PASS |
| D3 | Grade referenceHeaders / cards | PASS |
| D4 | Form embedded read/edit | PASS |
| D5 | Badge ativo SSOT | PASS |
| D6 | Busca servidor + sugestões janela | PASS |
| D7 | Paginação keyset | PASS |
| D8 | CSV janela + aviso | PASS |
| D9 | Exclusão bloqueada | PASS |

## Testes

- `tests/smoke/cadastroSearchInitiallyClosed.test.jsx`
- `tests/smoke/setoresBase1Rollout.test.jsx`
- `backend/tests/setorNativo.test.mjs` (BE-P41-PAGE-*)
- `tests/smoke/motorbase1MarcasUnidadesParity.test.jsx` (+ Setores)

## Homologação visual

Capturas 360–1280 px: **PENDING MANUAL** (ambiente agente sem sessão autenticada estável).

Roteiro operador (5 ações):

1. Abrir Marcas, Unidades e Setores em desktop — confirmar **lupa fechada** ao entrar.
2. Clicar lupa — input focado; Enter aplica busca; Escape fecha UI sem limpar filtro aplicado.
3. Setores: trocar empresa — lista vazia até carregar; nenhum registro da empresa anterior.
4. Setores: abrir registro — leitura; Editar — campos mutáveis; Cancelar — volta leitura.
5. Setores: tentar Excluir — diálogo indisponível; confirmar não há chamada de rede destrutiva.

## Screenshots

Não capturados nesta execução (PENDING MANUAL).
