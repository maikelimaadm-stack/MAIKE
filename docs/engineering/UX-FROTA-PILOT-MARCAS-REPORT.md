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

## UX-10 (2026-10-23) — Paridade visual com controle de estoque

Branch `cursor/ux-base1-paridade-estoque-516d`:

| Artefato | Mudança |
|----------|---------|
| `cadastroBase1Form.js` | Tokens de campo (input/select) alinhados a Produtos |
| `DynamicFormRenderer.jsx` | Layout label-acima + borda `rounded-md` / foco emerald (cadastro Lotes) |
| `TabelaLotes.jsx` | Grade estilo Produtos: colunas Seleção/Ações, hover cinza, cabeçalho sticky único |
| `FormularioLote.jsx` | Modo embedded em `Card` Base1 |
| `Bebedouros.jsx` | Grade HTML com bordas/cabeçalho sticky no padrão Produtos |

## UX-11 (2026-10-23) — Paridade global cadastros (exceto mapa/manejo)

Branch `cursor/ux-base1-paridade-estoque-516d` (UX-10 + UX-11):

| Artefato | Mudança |
|----------|---------|
| `CadastroFormField.jsx` + `.cadastro-grade-viewport` | SSOT de campo e viewport de grade |
| `cadastro-base1.css` | Classe `.cadastro-grade-viewport` |
| Formulários de **todas** as páginas de cadastro do escopo | `CadastroFormField` (incl. Empresa, Usuário, Conta MAIKE, Marcas, Produtos, Setores, etc.) |
| `TabelaProdutos`, `Marcas`, `Setores`, `Categorias*`, `Grupos`, `Tipos`, `Lotes`, `Empresa` (chrome) | Viewport + cabeçalho sticky estilo estoque |
| `TabelaUsuarios`, `TabelaContasAcesso`, `Bebedouros`, `LocaisEstoque` | Grade alinhada |

**Fora de escopo (explícito):** `MapaGeral`, `MapaCadastro`, tabelas geo do mapa, formulários de **lançamento de manejo no mapa** (`FormularioMovimentacaoLote`, pesagem, morte, etc.).

## UX-12 (2026-10-23) — Página inteira = Produtos (chrome + lançamentos cadastro)

Branch `cursor/ux-base1-paridade-pagina-completa-516d`:

| Artefato | Mudança |
|----------|---------|
| `CadastroFormShell`, `CadastroFormActions`, `CadastroWorkspaceHeader` | Shell de página, rodapé pill e cabeçalho mg-card |
| `CadastroWorkspace` | Cabeçalho/voltar no padrão Base1 |
| Formulários cadastro + **lançamento bebedouro** | mg-card + botões `tb-btn` |
| `Usuarios` | Duplo `CadastroListaChrome` (contas + permissões), grades com seleção |
| `DetalhesBebedouro` | Botões Lançar/Histórico e seções mg-card |

**Fora do padrão lista (por desenho):** `MapaGeral`, `MapaCadastro`.

## UX-13 (2026-10-23) — Motor Base1 (frota/equipamentos CONTROLE-DE-ESTOQUE)

Referência: `ResourceList` + `Base1List` + `Base1Grid` em `/frota` (aba Equipamentos = inventário).

| Artefato | Função |
|----------|--------|
| `Base1Ui.jsx` | `IconBtn`, `PillBtn`, `ViewSwitch`, `B1Popover`, `MenuList`, `MgCheck` |
| `Base1Grid.jsx` | Grade `mg-grid` (30px/26px, seleção verde, menu de coluna, resize/congelar) |
| `selectClick.js` | Seleção Ctrl/Shift como no MG |
| `cadastro-base1.css` | Tokens + `.mg-grid`, `.mg-check`, `.mg-field`, faixa de filtros recolhível |
| `CadastroListaChrome.jsx` | Toolbar completa: Duplicar, Anexos, Mais opções, rodapé com page size / carregar mais |
| `TabelaMarcas.jsx` | **Piloto** migrado para `Base1Grid` (sem colunas legadas Seleção/Ações) |

Próximo passo: repetir `Base1Grid` em Produtos/Setores e demais cadastros; cards/registro embutido quando houver API de preferências ou stub local.

## UX-14 (2026-10-23) — Migração total cadastros → motor Base1

Branch `cursor/ux-base1-paridade-pagina-completa-516d`:

| Artefato | Função |
|----------|--------|
| `CadastroBase1Grade.jsx` | SSOT da listagem: filtros por coluna, sort, prefs `localStorage`, `Base1Grid`, diálogo de colunas |
| `cadastroExportCsv.js` | Export CSV (;) compartilhado |
| Tabelas / páginas abaixo | Grade Base1 via `CadastroBase1Grade` (sem colunas legadas Seleção/Ações duplicadas) |

**Migrados:** Marcas, Setores, Grupos de atividades, Tipos de tarefa, Categorias de manejo, Categorias de produto (árvore), Produtos, Lotes, Empresa, Usuários (contas + permissões), Unidades de medida, Locais de estoque, Bebedouros.

**Limpeza:** removidos diálogos/colunas Sankhya e export PDF/Excel de lotes já desconectados (`gate:source-closure`).

**Chrome:** `CadastroListaChrome` com tooltip padrão de Anexos; export CSV via “Mais opções” onde a página liga `onExportCsv` (piloto completo em Marcas; demais cadastros exportam colunas via helpers exportados das tabelas).

**Fora de escopo:** `MapaGeral`, `MapaCadastro`, tabelas geo, manejo no mapa.

## Verificação (UX-14)

- `npm run test:smoke`, `npm run gate:types`, `npm run gate:source-closure`, `npm run build`
