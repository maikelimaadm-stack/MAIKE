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

## UX-15 (2026-10-24) — Paridade de comportamento Base1 (registro + Lançar)

Branch `cursor/ux-base1-paridade-pagina-completa-516d` (PR #44):

| Lacuna vs CONTROLE-DE-ESTOQUE | Correção |
|-------------------------------|----------|
| Detalhe/lista trocava o shell inteiro (`CadastroWorkspace` modo detalhe) e sumia com toolbar de listagem (busca, alternador Tabela/Registro, Mais opções) | `CadastroListaChrome` ganhou **`recordMode`**: corpo embutido + faixa superior com `recordToolbar` / `recordHeader` / `recordBody`; busca e alternador permanecem à direita (com **`secondaryToolsLocked`** durante subfluxos, como edição no MG) |
| Modo Registro não fixava `viewMode` nem voltava à tabela pelo alternador | `useCadastroListaChromeState`: `exitRecordView`, `handleViewModeChange` chama `onExitRecord` ao sair de registro |
| Bebedouros: Lançar/Histórico em `Dialog` shadcn (UX diferente do painel embutido) | `DetalhesBebedouro`: subviews **inline** (`lancamento` / `historico`); barra “Voltar ao resumo” no `recordToolbar`; formulário de lançamento ocupa o painel rolável (sem modal) |
| Bebedouros: “Configurar colunas” no chrome não abria diálogo | `showConfigColunas` ligado ao `CadastroBase1Grade` |
| Navegação entre registros no detalhe | **`CadastroRecordHeader`** (bookmark • título + primeiro/anterior/próximo/último) — piloto **Bebedouros** e **Marcas** |
| Marcas: formulário substituía chrome (paridade frota/equipamentos) | **Marcas** usa `recordMode` no chrome (mesmo padrão de `ResourceForm` + `rightSlot` no estoque) |

**Mapa / manejo:** `MapaGeral` continua usando `DetalhesBebedouro` em diálogo (fora do escopo cadastro Frota).

### Verificação (UX-15)

- `npm run test:smoke`, `npm run gate:types`, `npm run gate:source-closure`, `npm run build`

## UX-16 (2026-10-24) — `recordMode` em todos os cadastros com formulário

Branch `cursor/ux-base1-paridade-pagina-completa-516d` (PR #44):

| Página | Mudança |
|--------|---------|
| Produtos, Lotes, Setores, Categorias (produto + manejo), Grupos, Tipos, Empresa, Unidades, Locais, Usuários (contas + permissões) | Mesmo padrão de **Marcas/Bebedouros**: `CadastroWorkspace` sempre `mode="list"`; formulário em `recordBody`; `exitRecordView` + alternador Tabela/Registro; `CadastroRecordHeader` com navegação entre registros filtrados |

**Já no padrão (UX-15):** Marcas, Bebedouros.

**Fora de escopo:** `MapaGeral`, `MapaCadastro`, `ConfiguracoesGerais` (sem lista/registro Frota).

### Verificação (UX-16)

- `npm run test:smoke`, `npm run gate:types`, `npm run gate:source-closure`, `npm run build`

## UX-17 (2026-10-24) — Cards, rodapé incremental e toolbar secundária (paridade CONTROLE-DE-ESTOQUE)

Branch `cursor/ux-base1-paridade-continua-516d` (após merge do PR #45 em `main`):

| Lacuna vs frota/equipamentos | Correção |
|--------------------------------|----------|
| Modo **Cards** desabilitado (`cardsDisabled`) | `Base1Cards` + prefs (`useCadastroCardsPrefs`) + popovers na faixa de filtros (`Base1CardsToolbar`) |
| Rodapé sem page size / **Carregar mais** alinhados ao MG | `useCadastroListaPagination` + `useCadastroListaFooter`; tamanhos `[100…1000]` (`cadastroBase1List.js`); métricas Listados/Filtrados/Totais via `onListMetrics` na grade |
| **Duplicar** / **Imprimir** só em piloto | `useCadastroDuplicateAction` + `prepareCadastroDuplicate` em todos os cadastros com formulário; `onPrint={() => window.print()}` no chrome |
| Tokens cards / summary footer | `.b1-card`, `.b1-card__badge`, `.mg-summary__footer-actions` em `cadastro-base1.css` |

**Escopo:** Marcas, Setores, Produtos, Lotes, Categorias (produto + manejo), Grupos, Tipos, Empresa, Usuários (contas + permissões), Unidades, Locais, Bebedouros.

**Fora de escopo:** `MapaGeral`, `MapaCadastro`, anexos nativos (ícone permanece com tooltip até auditoria P8).

### Verificação (UX-17)

- `npm run test:smoke`, `npm run gate:types`, `npm run gate:source-closure`, `npm run build`

## UX-18 (2026-10-24) — Paridade visual Base1 (toolbar, grade, cards, registro)

Branch `cursor/ux-base1-paridade-visual-516d` (continua a partir de UX-17 / PR #46, ainda **aberto** em `main`):

| Lacuna vs CONTROLE-DE-ESTOQUE `globals.css` / `features/base1/` | Correção |
|------------------------------------------------------------------|----------|
| Faixa `mg-pills-rail` recolhia com `display: none` (sem animação MG) | Transição `max-width` / `opacity` / `scaleX` como no estoque |
| Cards selecionados com borda 2px verde forte | `.mg-card.b1-card.is-selected`: fundo `mg-selection-bg` + inset 1px `mg-focus-border` |
| Busca: largura fixa na pílula, clear como `tb-btn-icon` | `mg-search-pill-wrap` + botão `mg-search-pill-clear` (ícone vermelho MG) |
| Grade: colunas congeladas sem sombra âncora; checkbox 36px; menu ⋮ 16px quadrado | `is-frozen` / `is-frozen-anchor`, `.th-select`/`.td-select` 36px, `.th-menu` 20px circular, `.is-on` verde |
| Handle de resize só Tailwind ad hoc | Classe `.mg-grid-resize-handle` no CSS Base1 |
| Toolbar superior / cabeçalho de registro | `flex-wrap` na toolbar; `mg-form-scroll` no corpo do registro |
| Cards: padding duplicado no grid | Padding `p-2.5` no viewport da grade (modo cards), alinhado ao `mg-shell__scroll` do estoque |
| Form embutido: labels/bordas shadcn genéricas | Tokens `.cadastro-b1-form-field*` (label 12px MG, borda/foco emerald) |

**Spot check:** Marcas, Produtos, Bebedouros (lista + registro + cards quando habilitado).

**Fora de escopo:** `MapaGeral`, `MapaCadastro`, pesquisa dropdown avançada (`mg-search-dropdown`), favoritos nos cards.

### Verificação (UX-18)

- `npm run verify:all`

## UX-19 (2026-10-24) — Piloto paridade visual **Marcas** (frota/equipamentos)

Branch `cursor/ux-base1-paridade-marcas-516d` (inclui merge de UX-18 / PR #47 quando aplicável):

### Checklist Marcas vs CONTROLE-DE-ESTOQUE (Equipamentos / Base1List)

| Área | Status | Notas |
|------|--------|-------|
| Page shell (workspace header, subtítulo) | **Feito** | `CadastroWorkspace` + header mg-card |
| Toolbar pill (Novo/Editar/Duplicar/Excluir, ícones, disabled) | **Feito** | `CadastroListaChrome`; ícones 14px / 3.5px pencil |
| Busca pill, alternador Tabela/Registro/Cards, menu Mais | **Feito** | UX-18 + `CadastroSearchPill`; anexos visível (desabilitado) |
| Faixa filtros (chips, recolher animado) | **Feito** | UX-18 `mg-pills-rail`; hint quando sem chips |
| Grade (30/26px, seleção, menu coluna, congelar/sombra) | **Feito** | `Base1Grid` via `TabelaMarcas`; coluna Ativo = Sim/Não texto |
| Rodapé summary + page size + carregar mais | **Feito** | `useCadastroListaFooter` |
| Modo cards | **Feito** | `Base1Cards` + prefs; seleção MG |
| Modo registro: toolbar Salvar/Cancelar + bookmark + nav | **Feito** | `recordToolbar` + `CadastroRecordHeader`; nav bloqueada em edição |
| Form registro: campos `mg-field` flutuantes | **Feito** | `B1Field` + `FormularioMarca` embedded sem card duplicado |
| Transições novo/editar/duplicar/voltar lista | **Feito** | `recordMode` + alternador; duplicar abre registro |
| `mg-shell__scroll` no corpo lista/registro | **Feito** | Shell lista e registro alinhados ao MG |

### Pendente antes de replicar outros cadastros

| Item | Motivo |
|------|--------|
| `MgSelect` / `cmd-display` completo (popover pesquisável) | Piloto Marcas usa `<select>` nativo dentro de `mg-field` |
| Modo registro **view** vs **edit** (barra Novo/Editar/Excluir em leitura) | Marcas abre direto em edição; frota alterna view/edit |
| Pesquisa dropdown avançada + favoritos | Fora de escopo UX-18 |
| Anexos / histórico nativos | Aguarda auditoria P8 |
| Propagar `B1Field` + `recordToolbar` | Próximas missões cadastro |

### Verificação (UX-19)

- `npm run test:smoke`, `npm run gate:types`, `npm run gate:source-closure`, `npm run build`

## UX-20 (2026-10-24) — Tela inteira Marcas = inventário frota/equipamentos (DOM Base1List)

Branch `cursor/ux-base1-marcas-tela-inteira-516d` (continua UX-19 / PR #48):

| Lacuna (só CSS; árvore DOM diferente do MG) | Correção |
|---------------------------------------------|----------|
| Cartão extra de título/subtítulo acima da toolbar (não existe no `ResourceList` / `Base1List`) | `CadastroWorkspace` `pageLayout="base1-list"`: sem header mg-card; título só em `sr-only`; fundo `#f0f2f5` e preenchimento `h-full` |
| `cadastro-b1` aninhado + padding `p-3/md:p-4` deslocando a pilha | Um único `.cadastro-b1--full-page`; `CadastroListaChrome` raiz = `flex flex-col gap-2` (sem segunda classe escopo) |
| Corpo lista: `mg-shell--table` + `mg-shell__body` (referência usa `mg-shell--fill` + coluna flex / `mg-shell__scroll` só em cards) | Lista: `flex → mg-shell--fill →` tabela em `flex flex-col` ou cards em `mg-shell__scroll p-2.5`; rodapé `mg-summary` filho direto do shell |
| Registro: bookmark dentro do shell branco | `CadastroRecordHeader` fora do `mg-shell` (toolbar → bookmark → shell formulário), como camadas do MG |
| Toolbar direita com gap largo | `ml-auto flex gap-1.5` (paridade `rightSlot` do `Base1List`) |
| Cards com `p-2.5` duplicado | Padding único no scroll do chrome; removido wrapper extra em `CadastroBase1Grade` (modo cards) |

**Escopo:** piloto **Marcas** (`pageLayout="base1-list"`). Demais cadastros mantêm `pageLayout` padrão até validação.

### Verificação (UX-20)

- `npm run test:smoke`, `npm run gate:types`, `npm run gate:source-closure`, `npm run build`

## UX-21 (2026-10-24) — Paridade **grade + campos** Marcas (frota/equipamentos)

Branch `cursor/ux-base1-marcas-tela-inteira-516d` (PR #49):

| Lacuna vs CONTROLE-DE-ESTOQUE | Correção |
|--------------------------------|----------|
| Filtro de coluna shadcn (lista simples) vs `fpop` Excel no cabeçalho | `referenceHeaders` em `CadastroBase1Grade` / `TabelaMarcas`; `CadastroColunaFiltro` + `cadastroColunaFiltroLogic`; `Base1Grid` abre filtro direto no ⋮; CSS `cadastro-b1ref.css` |
| `mg-field` simplificado (padding no control, inválido vermelho forte, Input shadcn `h-9`) | CSS alinhado a `globals.css` (label 9px, padding 17/5 no valor, `is-open`/`locked`/`disabled`); `FormularioMarca` com `<input>` nativo + `B1Field` |
| Grade: viewport extra, sem `ResizeObserver`/pin, `tfoot` sticky | `mg-grid-wrap` sem `cadastro-grade-viewport`; pin + `ResizeObserver`; `tfoot` sticky; `mg-shell--fill` flex column |
| Âncora do filtro | `data-testid="b1-list"` no `CadastroListaChrome` |

### Pendente (Marcas)

| Item | Motivo |
|------|--------|
| `cmd-display` / `MgSelect` popover pesquisável | Ativo segue `<select>` nativo dentro de `mg-field` |
| Modo registro view vs edit | Fora do escopo UX-20/21 |
| Calendário no filtro de coluna tipo `data` | Inputs texto; Marcas não usa data na grade |

### Verificação (UX-21)

- `npm run test:smoke`, `npm run gate:types`, `npm run gate:source-closure`, `npm run build`
