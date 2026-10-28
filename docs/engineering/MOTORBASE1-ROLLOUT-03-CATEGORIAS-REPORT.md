# MOTORBASE1-ROLLOUT-03 — Categorias hierárquicas

## Antes / depois

| Aspecto | Antes | Depois |
|---------|-------|--------|
| Orquestração | `CadastroWorkspace` + chrome/handlers manuais | `useCadastroBase1HierarchicalController` + `CadastroBase1Screen` |
| Lista | Hook legado + paginação local via `useCadastroPageListBindings` | `GET /categorias` full-list (`listarTodasCategorias`), cache `['categorias_produto']` |
| Árvore | `TabelaCategoriasProduto` (preservada) | Mesma árvore + preset `BASE1_LISTA_INTEGRADA_VISUAL` + `ATIVO_BADGE` |
| Formulário | Card shadcn + rodapé próprio | `B1Field` / `CadastroFormShell` + toolbar do motor (`readOnly` real) |

## Arquivos principais

- `src/hooks/useCadastroBase1FullList.js` — fonte full-list neutra (sem keyset falso)
- `src/hooks/useCadastroBase1HierarchicalController.js` — orquestração Base1 para hierarquia
- `src/pages/Categorias.jsx` — adapter de domínio
- `src/components/categorias-produto/TabelaCategoriasProduto.jsx` — helpers export/nav + preset
- `src/components/categorias-produto/FormularioCategoriaProduto.jsx` — formulário Base1
- `tests/smoke/categoriasBase1Rollout.test.jsx`

## Contrato fonte hierárquica

- **Fonte real:** `listarTodasCategorias()` → array completo do tenant (cadastro global, sem `empresa_id`).
- **Sem** `/categorias/page` nem `hasMore`/`Carregar mais` sobre subset truncado.
- **Rodapé:** `Totais` = tenant; `Filtrados` = matches de busca; `Listados` = nós renderizados na árvore (inclui ancestrais estruturais quando busca/reveal exige).
- **Export:** ordem hierárquica (`flattenHierarchyOrdered`); filtro exporta só matches, não ancestrais extras.
- **Navegação registro:** `filterCategoriasRecordNavRows` — só matches reais.

## Escala / limitação

O endpoint legado devolve a lista inteira. Adequado para centenas de categorias por tenant; acima disso, caminho futuro: paginação hierárquica no backend (subárvore + ancestrais garantidos), não fatiar array no cliente.

## Exclusão

Preservado `excluirCategorias` (validação prévia, folha→raiz, `CATEGORIA_PARTIAL_DELETE`, `CATEGORIA_HAS_CHILDREN`).

## Testes

- `tests/smoke/categoriasBase1Rollout.test.jsx`
- `tests/smoke/categoriaProdutoIntegridade.test.js` (ampliado)
- `npm run verify:all`

## Follow-up FIX-01 (PR #116)

- **Double-filter:** grade não re-filtra busca quando a árvore já projeta linhas (`projectCategoriasGradeRows`).
- Relatório: [`MOTORBASE1-CATEGORIAS-HIERARCHY-FIX-01-REPORT.md`](./MOTORBASE1-CATEGORIAS-HIERARCHY-FIX-01-REPORT.md)
- Teste: `tests/smoke/categoriasHierarchyFix.test.jsx`

## Pendências

- Revisão visual manual 360/390/768/1024/1280 px — **PENDING VISUAL** (sem browser autenticado neste run).
