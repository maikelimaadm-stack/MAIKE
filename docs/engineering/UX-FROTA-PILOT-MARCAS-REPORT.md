# UX-01 — Piloto workspace Frota em Marcas

**Data:** 2026-10-23  
**Branch:** `cursor/ux-frota-pilot-516d`  
**Referência visual:** CONTROLE-DE-ESTOQUE (workspace de cadastro Frota)

## Objetivo

Introduzir um shell reutilizável de cadastro (cabeçalho, subtítulo, ações, modo lista/detalhe com “Voltar à lista”) e validar o padrão na página **Marcas**, uma das telas de suporte mais simples do escopo Mapa + Manejo.

## Entregas

| Artefato | Função |
|----------|--------|
| `src/components/cadastro/CadastroWorkspace.jsx` | Shell lista/detalhe compartilhável |
| `src/pages/Marcas.jsx` | Migrada para o shell; toolbar com colunas + Adicionar |
| `FormularioMarca` (`variant="embedded"`) | Formulário sem cabeçalho duplicado no modo detalhe |

## Fora de escopo (próximas missões)

- DataTable genérico estilo Frota (Marcas mantém `TabelaMarcas` atual).
- Propagação do shell para Setores, Categorias, Produtos, etc.
- Decisão de produto formal — piloto apenas; sem alteração de `gate:product-scope`.

## Verificação

- `npm run test:smoke`, `npm run lint`, `npm run build` após a mudança.

---

## UX-02 (2026-10-23) — Categorias de produtos

Mesmo padrão aplicado em `src/pages/Categorias.jsx` e `FormularioCategoriaProduto` (`variant="embedded"`), na branch `cursor/ux-frota-categorias-ssot-516d`.

## UX-03 (2026-10-23) — Produtos (cadastro estoque)

`src/pages/Produtos.jsx` migrada para `CadastroWorkspace` (toolbar com import/export/modelo/colunas/Adicionar). `FormularioProduto` ganhou `variant="embedded"`. Próximas candidatas: Unidades de medida, Locais de estoque, Setores.

## UX-04 (2026-10-23) — Unidades, locais e setores

Branch `cursor/ux-frota-unidades-locais-setores-516d`:

| Página | Mudança |
|--------|---------|
| `UnidadesMedida.jsx` | `CadastroWorkspace`; formulário sem `CardHeader` duplicado; toolbar emerald + `Plus` |
| `LocaisEstoque.jsx` | Idem |
| `CadastroSetores.jsx` | Idem; `FormularioSetor` com `variant="embedded"` |

Próximas candidatas: telas de manejo (grupos, tipos tarefa, categorias manejo), bebedouros, empresa.

## UX-05 (2026-10-23) — Chrome Base1 (piloto Marcas)

Branch `cursor/ux-frota-base1-chrome-516d`:

| Artefato | Função |
|----------|--------|
| `src/styles/cadastro-base1.css` | Tokens MG / tb-btn / mg-toolbar / mg-shell (escopo `.cadastro-b1`) |
| `CadastroListaChrome` | Toolbar Novo/Editar/Excluir, busca em pílula, faixa de filtros, rodapé Selecionados/Listados/Filtrados/Totais |
| `Marcas.jsx` + `TabelaMarcas` | Piloto integrado; grade legada dentro do shell Base1 |

## UX-06 (2026-10-23) — Chrome Base1 nos cadastros Frota

Branch `cursor/ux-frota-base1-chrome-cadastros-516d`:

| Artefato / página | Mudança |
|-------------------|---------|
| `useCadastroListaChromeState.js` | Estado compartilhado (seleção, busca aplicada, reset de filtros, modo de vista) |
| `CadastroListaChrome` | `extraToolbar` (Produtos: import/export/modelo/atualizar) |
| Categorias, Produtos, Setores | Chrome + tabelas com busca, reset de filtros e seleção |
| Unidades de medida, Locais de estoque | Chrome integrado na grade inline (mesma UX) |

Próximo: cards/registro completo estilo Base1; grid MG; opcional refatorar Marcas para o hook compartilhado.

## UX-07 (2026-10-23) — Base1 em todo cadastro tipo Frota

Branch `cursor/ux-base1-all-cadastros-516d`:

| Página | Mudança |
|--------|---------|
| `GruposAtividades.jsx` | `CadastroWorkspace` + `CadastroListaChrome` + hook; export na toolbar |
| `TiposTarefa.jsx` | Idem |
| `CategoriasManejo.jsx` | Idem |
| `Marcas.jsx` | Refatorada para `useCadastroListaChromeState` (paridade com Setores/Categorias) |

Formulários: `variant="embedded"`. Tabelas: busca global, seleção e reset de filtros integrados ao chrome.

## UX-08 (2026-10-23) — Base1 nas telas restantes do escopo

Branch `cursor/ux-base1-remaining-cadastros-516d`:

| Página | Mudança |
|--------|---------|
| `Empresa.jsx` | Paridade com Marcas: workspace + chrome + `TabelaEmpresas` modo `chromeLayout` |
| `Bebedouros.jsx` | Workspace + chrome; detalhe em modo registro; link “Cadastrar no mapa” na toolbar |
| `ConfiguracoesGerais.jsx` | Shell `CadastroWorkspace` (conteúdo de ícones inalterado) |
| `Usuarios.jsx` | Workspace unificado; ações no header; formulários em modo detalhe |

## UX-09 (2026-10-23) — Cadastro de Lotes (Base1)

Branch `cursor/ux-base1-cadastro-lotes-516d`:

| Artefato / página | Mudança |
|-------------------|---------|
| `CadastroLotes.jsx` | `CadastroWorkspace` + `CadastroListaChrome` + hook; removidos Sankhya, painel de filtros avançado e export PDF/Excel da toolbar |
| `FormularioLote.jsx` | `variant="embedded"` (sem `LegacyRecordToolbar`; rodapé Salvar/Cancelar/Anexos) |
| `TabelaLotes.jsx` | `resetFiltersKey`, `onFiltersActiveChange`, busca global via chrome |
| `Layout.jsx` | Transição de rota sem `mode="wait"` (evita travar navegação entre páginas) |

Exportações PDF/Excel e painel Sankhya ficam fora desta fatia; filtros por coluna na grade permanecem.

**Fora do padrão lista (por desenho):** `MapaGeral`, `MapaCadastro`.
