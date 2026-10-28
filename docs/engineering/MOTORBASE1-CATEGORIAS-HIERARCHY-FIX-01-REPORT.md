# MOTORBASE1-CATEGORIAS-HIERARCHY-FIX-01

## Problema

Duplo filtro na lista de Categorias:

1. `flattenVisible` / projeção hierárquica incluía **ancestrais estruturais** ao buscar (ex.: busca por “Neta” → Raiz + Filha + Neta).
2. `CadastroBase1Grade` aplicava de novo `matchesSearch` sobre `rows`, removendo ancestrais que não casavam com o texto.

Sintoma: folha encontrada na busca “sumia” da grade ou rodapé `Listados` divergia do render.

## Correção

| Peça | Mudança |
|------|---------|
| `projectCategoriasGradeRows` | Função **pura** SSOT: `buildHierarchy` + `flattenVisible` + `appliedSearch` / `searchPickId` / `revealRowIds` |
| `TabelaCategoriasProduto` | Grade recebe linhas já projetadas; **não** passa `searchQuery` nem `matchesSearch` à grade |
| `getCategoriasListFooterMetrics` | Usa a mesma projeção (expand padrão `{}`) para `listados` |
| `Categorias.jsx` | Prop `searchPickId` na tabela (pick de sugestão não reexpande todos os matches) |

## Arquivos

- `src/components/categorias-produto/TabelaCategoriasProduto.jsx`
- `src/pages/Categorias.jsx`
- `tests/smoke/categoriasHierarchyFix.test.jsx`

## Testes

- Projeção pura + métricas de rodapé
- Integração **CadastroBase1Grade real** + `Base1Grid` mockado capturando `rows` após pipeline da grade

`npm run verify:all`

## Preflight

- PR #115 merge `9a108b22` em `main`
- CI `40712896123` success
