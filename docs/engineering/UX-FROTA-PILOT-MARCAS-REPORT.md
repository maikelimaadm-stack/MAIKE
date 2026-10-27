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

## UX-22 (2026-10-24) — SSOT vidro + calendário central de vendas + switch Sim/Não

Branch `cursor/ux-base1-ssot-vidro-calendario-switch-516d`:

| Artefato | Origem (CONTROLE-DE-ESTOQUE) | Função |
|----------|------------------------------|--------|
| `src/styles/cadastro-b1-controls.css` | `globals.css` (cmd/mg-dp), `moldura.module.css` (`.popover`), `calendario-do-sistema.module.css`, `campo.module.css` (`.chave`) | Vidro em popovers de listagem; estilos cmd-panel, mg-dp, calendário e switch |
| `B1Switch.jsx` | `features/central/campo.tsx` (`ChaveSimNao`) | Boolean Sim/Não com `role="switch"` |
| `MgDatePicker.jsx` + `B1DatePicker` | `components/ui/mg-controls.tsx` | Texto dd/mm/aaaa + valor ISO |
| `B1CalendarioDoSistema.jsx` | `components/ui/calendario-do-sistema.tsx` | Painel 240px vidro da central de vendas |
| `MgSelect.jsx` | `mg-controls.tsx` (`CmdPanel` / `MgSelect`) | Seletor cmd-display com painel vidro |
| `Base1Ui` `B1Popover` | vidro `.popover` da central | Menu “Mais opções” e popovers do chrome |
| `CadastroColunaFiltro` | — | Colunas `data` usam `MgDatePicker` (variante central) |
| `FormularioMarca` | — | Campo **Ativo** → `B1Switch` (piloto) |

**Herança automática:** qualquer cadastro dentro de `.cadastro-b1` que importe `B1Switch`, `B1DatePicker`/`MgDatePicker`, `MgSelect` ou use `CadastroListaChrome`/`B1Popover`/`CadastroColunaFiltro` recebe o mesmo visual sem migração página a página.

### Verificação (UX-22)

- `npm run verify:all`

## UX-23 (2026-10-24) — Bugfix switch **Ativo** + rodapé de listagem

Branch `cursor/ux-base1-ssot-vidro-calendario-switch-516d` (PR #50):

| Sintoma | Causa | Correção |
|---------|-------|----------|
| Campo **Ativo**: caixa minúscula, label flutuante 9px sobre o trilho, `Sim`/`Não` fora do campo | `mg-field` flutuante + `button { width: 100% }` esticava `.b1-switch`; label com `hasValue` sempre ativo | `mg-field--switch` em linha (paridade `.chave`): label fixo à esquerda, controle à direita; `b1-switch` com largura fixa; texto sem `padding-top` |
| Listagens: grade e `mg-summary` competindo por altura / paginação espremida | `mg-grid-wrap` não era flex filho do shell — só regra para filho **direto** de `mg-shell--fill` | `CadastroListaChrome` usa `mg-shell__body`; CSS encadeia `.mg-shell__body .mg-grid-wrap` com scroll e `mg-summary` fixo no rodapé do shell |

**Arquivos:** `cadastro-b1-controls.css`, `cadastro-base1.css`, `B1Field.jsx`, `FormularioMarca.jsx`, `CadastroListaChrome.jsx`.

### Verificação (UX-23)

- `npm run test:smoke`, `npm run gate:types`, `npm run build`

## UX-24 (2026-10-24) — Switch **Ativo** em linha + paginação `MgSelect` vidro

Branch `cursor/ux-base1-ssot-vidro-calendario-switch-516d` (PR #50):

| Item | Correção |
|------|----------|
| `FormularioMarca` **Ativo** | `B1Field` `variant="switch"` (`mg-field--switch`): rótulo à esquerda, `B1Switch` + texto Sim/Não à direita — paridade `ChaveSimNao` / `.chave`, sem caixa de input flutuante |
| Rodapé `CadastroListaChrome` | `<select class="mg-pill-select">` → `MgSelect` com gatilho pill, painel `mg-b1-glass-pop` e opções 100–1000 (central de vendas / `cmd-display`) |

**Arquivos:** `FormularioMarca.jsx`, `CadastroListaChrome.jsx`, `MgSelect.jsx`, `cadastro-base1.css`.

### Verificação (UX-24)

- `npm run verify:all`

## UX-25 (2026-10-24) — Registro Marcas = frota/equipamentos + `B1ChaveRow`

Branch `cursor/ux-base1-ssot-vidro-calendario-switch-516d` (PR #50):

| Item | Correção |
|------|----------|
| **Ativo** no formulário | `B1ChaveRow` (faixa branca com borda, rótulo cinza à esquerda, `B1Switch` + Sim/Não à direita) — **sem** `B1Field` / `mg-field` |
| Modo registro (`CadastroListaChrome`) | Corpo do registro: `mg-form-scroll` com `p-3` (paridade `ResourceForm` / painel do equipamento); removido `mg-shell__scroll` duplicado |
| `FormularioMarca` | Grade `grid-cols-12 gap-3` + classe `b1`; Nome/Descrição em `B1Field`; Ativo em linha chave |
| Listagem | Rodapé mantém `MgSelect` pill + painel vidro (`UX-24`) |

**Arquivos:** `B1ChaveRow.jsx`, `cadastro-b1-controls.css`, `FormularioMarca.jsx`, `CadastroListaChrome.jsx`, `Base1Ui.jsx`.

### Verificação (UX-25)

- `npm run verify:all`

## UX-26 (2026-10-24) — Chave compacta + painel do page size

Branch `cursor/ux-base1-ssot-vidro-calendario-switch-516d` (PR #50):

| Item | Correção |
|------|----------|
| **Ativo** (`B1ChaveRow`) | Remove faixa branca com borda; grupo `inline-flex` com rótulo + switch + Sim/Não adjacentes (paridade `ChaveSimNao` / `data-chave`) |
| Rodapé page size (`MgSelect` pill) | Painel branco arredondado (`mg-pill-select-panel`); opção selecionada com fundo verde claro e texto verde (`globals.css` / `cmd-option.selected`) |

**Arquivos:** `B1ChaveRow.jsx`, `cadastro-b1-controls.css`, `cadastro-base1.css`, `CadastroListaChrome.jsx`.

### Verificação (UX-26)

- `npm run verify:all`

## UX-27 (2026-10-24) — Page size `MgSelect`: opções em coluna

Branch `cursor/ux-base1-ssot-vidro-calendario-switch-516d` (PR #50):

| Item | Correção |
|------|----------|
| Painel do rodapé | `Popover.Portal` renderizava fora de `.cadastro-b1`, sem estilos `cmd-option` — botões inline concatenavam labels (`100200`) |
| `MgSelect` | Classe `cadastro-b1` no `Popover.Content`; lista `flex flex-col` e opções `w-full` (paridade `CmdPanel` / CONTROLE-DE-ESTOQUE) |
| CSS | `cmd-panel-options` e `mg-pill-select-panel` com `flex-direction: column` |

`CadastroListaChrome` já passava `PAGE_SIZES` como `{ value, label }` separados — sem alteração.

**Arquivos:** `MgSelect.jsx`, `cadastro-b1-controls.css`, `cadastro-base1.css`.

### Verificação (UX-27)

- `npm run verify:all` (exceto `test:backend` sem `DATABASE_URL` no agente)

## UX-28 (2026-10-24) — Page size: borda lateral do painel

Branch `cursor/ux-base1-ssot-vidro-calendario-switch-516d` (PR #50):

| Item | Correção |
|------|----------|
| `mg-pill-select-panel` | Fora do vidro (`:not(.mg-pill-select-panel)`); borda `1px solid #dfe2e7` (moldura/globals) em todos os lados; sombra leve |
| Opções | `padding: 4px` no painel; itens `width: 100%` sem margem lateral; hover cinza (`--mg-gray-fill`); selecionado verde claro |

**Arquivos:** `cadastro-b1-controls.css`, `cadastro-base1.css`.

### Verificação (UX-28)

- `npm run verify:all`

## UX-29 (2026-10-26) — Cards + popovers de colunas (frota/equipamentos)

Branch `cursor/ux-base1-cards-colunas-878d` (base `cursor/ux-base1-ssot-vidro-calendario-switch-516d`, PR #50/#51):

| Item | Correção |
|------|----------|
| Popovers layout/campos dos cards | `CheckRow` / `RadioRow` SSOT em `Base1Ui` (check circular verde + hover cinza); `B1Popover` com `footer` Restaurar/OK |
| Modo cards | `Base1Cards` + `Base1CardsToolbar` alinhados ao `CardFieldsPopover` / `CardsLayoutPopover` do CONTROLE-DE-ESTOQUE |
| Modo tabela (`referenceHeaders`, piloto Marcas) | `ConfiguracaoColunasBase1Popover` ancorado ao botão da faixa de filtros (`b1-col-config-trigger`) em vez do diálogo mapa legado |
| Herança cadastros | Componentes compartilhados em `cadastro/base1/`; demais telas com `referenceHeaders` recebem o mesmo padrão ao passar `configureColumnsAnchorRef` |

**Arquivos:** `Base1Ui.jsx`, `Base1Cards.jsx`, `ConfiguracaoColunasBase1Popover.jsx`, `CadastroBase1Grade.jsx`, `CadastroListaChrome.jsx`, `Marcas.jsx`, `TabelaMarcas.jsx`.

### Verificação (UX-29)

- `npm run verify:all`

## UX-30 (2026-10-26) — Design system, a11y popovers e notas OWASP (Base1 compartilhado)

Branch `cursor/ux-base1-cards-colunas-878d` (PR #51):

| Item | Correção |
|------|----------|
| Tokens `--mg-*` em popovers Radix | `B1Popover` e painéis portados carregam classe `cadastro-b1`; vidro (`mg-b1-glass-pop`) aplica também no nó raiz portado; animações Radix neutras no Base1 |
| Linhas SSOT | `CheckRow` / `RadioRow` / `MenuList` usam classes `.mg-b1-row`, `.mg-b1-check`, `.mg-b1-menuitem` em `cadastro-base1.css` (menos `text-slate-*` solto) |
| Modo cards | `title` no alternador; dica na faixa de filtros quando `cardsModeAvailable` |
| Colunas (portal) | Foco inicial no primeiro checkbox; ciclo Tab no painel; restaura foco no gatilho ao fechar; `maxHeight` correto ao abrir acima do botão |
| Estados vazios / loading | `.mg-empty-state` na grade e nos cards (`role="status"` ao carregar) |

**Arquivos:** `cadastro-base1.css`, `cadastro-b1-controls.css`, `Base1Ui.jsx`, `Base1Grid.jsx`, `Base1Cards.jsx`, `ConfiguracaoColunasBase1Popover.jsx`, `CadastroListaChrome.jsx`, `cadastroExportCsv.js`.

### Notas de segurança (frontend cadastro — não é pentest)

| Tópico | Situação |
|--------|----------|
| XSS / `dangerouslySetInnerHTML` | Não há uso em `cadastro/base1/`; células e labels renderizam via React (escape padrão). |
| Export CSV | Valores escapados (`"` duplicadas); nome de arquivo sanitizado (`SAFE_CSV_BASENAME`) contra caracteres de caminho. |
| `localStorage` (grade) | Apenas ordem/visíveis/largura de colunas por `storageKey`; sem JWT nem credenciais (JWT permanece em `nativeTokenStorage`). |
| Popovers em portal | Conteúdo é JSX estático + dados de coluna como texto; sem `innerHTML` de linha da API. |
| CSV como vetor | Abrir CSV em Excel pode executar fórmulas se célula começar com `=`; mitigação completa seria prefixo/tab — fora do escopo desta missão. |

### Verificação (UX-30)

- `npm run verify:all`

## UX-31 (2026-10-26) — Marcas + Base1: tokens, foco, formulário e grade

Branch `cursor/ux-base1-cards-colunas-878d` (PR #51). Skills aplicadas: `ui-ux-pro-max` (foco visível, erros inline, ritmo de espaçamento) e `ui-styling` (tokens `--mg-*`, menos utilitários Tailwind conflitantes).

| Item | Correção |
|------|----------|
| **Marcas / listagem** | Célula Ativo com `.mg-b1-status--yes` / `--no` (remove `text-emerald-*` / `text-slate-*`) |
| **Marcas / registro** | `FormularioMarca` em `.mg-b1-record-form` + grade `.mg-b1-form-grid`; `noValidate` + `B1Field` com `aria-invalid` / `aria-describedby` |
| **Cabeçalho registro** | `CadastroRecordHeader` → classes `.mg-b1-record-*` |
| **Cards** | Tipografia e hover via `cadastro-base1.css` (`.mg-b1-card__*`, sombra em hover sem arbitrary Tailwind) |
| **Chrome lista** | Ícone “limpar filtros” ativo → `.is-filter-active`; toolbar com wrap seguro &lt;640px |
| **Grade / filtro coluna** | Popover com `.cadastro-b1` portado; ações `.mg-b1-col-filter-*`; botão OK com `.tb-btn-green` |
| **Form shell / rodapé grade** | `CadastroFormShell` header tokenizado; `Base1Grid` tfoot `.mg-grid-foot` |
| **A11y teclado** | `:focus-visible` em `.tb-btn`, `.view-seg`, linhas de popover |

**Componentes tocados:** `Marcas.jsx` (herança), `TabelaMarcas.jsx`, `FormularioMarca.jsx`, `CadastroWorkspace.jsx` (inalterado — layout `base1-list`), `CadastroListaChrome.jsx`, `CadastroRecordHeader.jsx`, `CadastroFormShell.jsx`, `CadastroBase1Grade.jsx`, `Base1Grid.jsx`, `Base1Cards.jsx`, `B1Field.jsx`, `B1ChaveRow.jsx` (inalterado), `ConfiguracaoColunasBase1Popover.jsx` (inalterado), `cadastro-base1.css`, `cadastro-b1-controls.css` (inalterado), `cadastro-b1ref.css` (inalterado).

### Verificação (UX-31)

- `npm run test:smoke`
- `npm run gate:types`
- `npm run build`

## UX-32 (2026-10-26) — Marcas: campos ResourceForm, sem faixa de chips, mobile

Branch `cursor/ux-base1-cards-colunas-878d` (PR #51):

| Item | Correção |
|------|----------|
| **Formulário / lançamento** | `FormularioMarca`: `B1Field` + `B1_FIELD_CTL_CLS` (paridade `ctl` / `campo-b1` do ResourceForm); **Ativo** via `MgSelect` Sim/Não (mesmo padrão boolean do frota/equipamentos), não `B1ChaveRow` |
| **Faixa `mg-pills-rail`** | Removida no piloto Marcas (`showFilterRail={false}`); configuração de colunas, cards e limpar filtros na toolbar |
| **Mobile (`base1-list`)** | Toolbar com altura flexível; rodapé `mg-summary` em coluna; grade com scroll horizontal; formulário sem `max-width` fixo no mobile |

**Arquivos:** `B1Field.jsx`, `FormularioMarca.jsx`, `CadastroListaChrome.jsx`, `Marcas.jsx`, `cadastro-base1.css`.

### Verificação (UX-32)

- `npm run verify:all`

## UX-33 (2026-10-26) — Marcas: grade full-width, Ativo switch, ferramentas no menu ⋮

Branch `cursor/ux-base1-cards-colunas-878d` (PR #51):

| Item | Correção |
|------|----------|
| **Formulário / lançamento** | `.mg-b1-record-form` sem `max-width` centralizado; grade `cols-12` alinhada à esquerda (paridade ResourceForm) |
| **Ativo** | `B1ChaveRow` + `B1Switch` (reverte `MgSelect` Sim/Não da UX-32) |
| **Chrome lista** | Configurar colunas, layout dos cards e campos dos cards só no menu **Mais opções**; removidos da toolbar e da faixa `mg-pills-rail` |

**Arquivos:** `FormularioMarca.jsx`, `CadastroListaChrome.jsx`, `Base1Cards.jsx`, `cadastro-base1.css`.

### Verificação (UX-33)

- `npm run verify:all`

## UX-34 (2026-10-26) — Grade Marcas = Portal de Compras (documentos)

Referência CONTROLE-DE-ESTOQUE: `DocumentosDeCompraList` → `DocList` + `Base1List` (`referenceHeaders`), `filtro-de-coluna.tsx` / `fpop`, `colunas-dos-itens.tsx`, painel `itpan`/`itbar` (toolbar fundida ao cartão da grade).

| Item | Correção |
|------|----------|
| **Join toolbar + tabela** | `joinTableToolbar` em `CadastroListaChrome`: botões Novo/Editar/… na primeira linha do `mg-shell` (`mg-shell--join-table`), sem cartão `mg-card` separado acima da grade (paridade visual `itbar` + `itrolo`) |
| **Filtro de coluna** | Mantido `CadastroColunaFiltro` (`fpop` / `cadastro-b1ref.css`); faixa “Filtro de cabeçalho” quando há filtros ativos (como `Base1List` do portal) |
| **Menu ⋮ da coluna** | `referenceExtendedColumnMenu`: filtro Excel + congelar / autoajustar / ocultar (cadastro; portal documentos só abre `fpop` no ⋮) |
| **Congelar colunas** | Persistência `localStorage` (`{storageKey}_congeladas`) |
| **Configurar colunas** | `ConfiguracaoColunasB1Dialog` (duas listas + arraste, CSS `b1ref` `.mdl`) no lugar do popover simples — paridade `ColunasDosItens` do portal |
| **Faixa pills** | Marcas mantém `showFilterRail={false}` (UX-33); portal compras continua com chips na rail — piloto cadastro sem rail |

**Arquivos de referência (CONTROLE-DE-ESTOQUE):**

- `apps/web/src/features/compras/documentos-compra-list.tsx`
- `apps/web/src/features/base1/list.tsx`, `grid.tsx`
- `apps/web/src/features/compras/filtro-de-coluna.tsx`, `colunas-dos-itens.tsx`
- `apps/web/src/features/compras/itens-da-nota.tsx` (join `itbar`/`itrolo`)
- `apps/web/src/features/compras/portal-compras.module.css`

**Arquivos portados (MAIKE):** `CadastroListaChrome.jsx`, `CadastroBase1Grade.jsx`, `Base1Grid.jsx`, `ConfiguracaoColunasB1Dialog.jsx`, `Marcas.jsx`, `cadastro-base1.css`, `cadastro-b1ref.css` (inalterado — já tinha `.mdl` / `.fpop`).

### Teste manual — Marcas

1. Lista: toolbar (Novo, Editar, …) colada ao topo da grade, um único cartão branco.
2. ⋮ no cabeçalho: popover com filtro avançado, congelar, autoajustar, ocultar; filtro abre painel `fpop` estilo Excel.
3. Menu **Mais opções** → Configurar colunas: diálogo duas listas (arrastar/clicar), Restaurar padrão.
4. Congelar até coluna N: rolagem horizontal mantém colunas fixas; recarregar página preserva congelamento.
5. Limpar filtros (ícone na toolbar) e link “Limpar filtros de cabeçalho” quando filtro de coluna ativo.
6. Sem faixa `mg-pills-rail` de chips.

### Verificação (UX-34)

- `npm run verify:all`

## UX-35 (2026-10-26) — Grade Marcas: fpop, resize, congelar e autoajuste (paridade CONTROLE-DE-ESTOQUE)

Branch `cursor/ux-base1-cards-colunas-878d` (PR #51). Referência lida linha a linha: `features/base1/grid.tsx`, `features/compras/filtro-de-coluna.tsx`, `app/b1ref.css`, `app/globals.css` (`.mg-grid`, alça de resize).

| Item | Correção |
|------|----------|
| **Filtro `fpop`** | Sem overlay `fixed inset-0`; fecha por clique fora (respeita calendário/Radix); `<form>` + Enter aplica; rodapé ícones X/✓; painel sólido (sem vidro); reposiciona em scroll/resize |
| **Âncora do filtro** | `data-b1-col-menu` no ⋮ do cabeçalho (estável vs `aria-label`) |
| **Resize coluna** | Alça `z-index: 5`, `touch-action: none`, ignora duplo clique no arraste, duplo clique ajusta largura uma vez, `user-select: none` durante drag |
| **Auto ajustar** | Estado `autoFitKeys` + `localStorage` (`_autofit`); ícones `th-estado`; reaplica ao mudar linhas/filtros; arraste desliga autoajuste |
| **Congelar** | `leftBase` com coluna de seleção sticky quando há congelamento; sombra âncora = referência (sem barra verde inset) |
| **Medição de largura** | `src/lib/larguraColuna.js` (paridade `largura-coluna.ts`) |

**Arquivos:** `Base1Grid.jsx`, `CadastroBase1Grade.jsx`, `CadastroColunaFiltro.jsx`, `larguraColuna.js`, `cadastro-base1.css`, `cadastro-b1ref.css`, `cadastro-b1-controls.css`.

### Verificação (UX-35)

- `npm run verify:all`

## UX-36 (2026-10-26) — SSOT prompt Agro ERP + gaps checklist §11

Branch `cursor/ux-base1-cards-colunas-878d` (PR #51). Prompt persistido em `docs/engineering/PROMPT-MODELO-VISUAL-AGRO-ERP.md`; decisão **D-PROD-39**.

| Item checklist §11 | Status | Notas |
|--------------------|--------|-------|
| 11.1 Shell `base1-list` | **Feito** | `CadastroWorkspace` |
| 11.2 Toolbar join grade | **Feito** | UX-34 |
| 11.3 Mais opções lista vertical | **Feito** | `MenuList` + popover `flex-col` (353) |
| 11.4 Faixa chips Marcas | **N/A** | `showFilterRail={false}` por produto; portal compras mantém rail |
| 11.5–11.8 Grade fpop/resize/congelar/autoajuste | **Feito** | UX-35 |
| 11.9 Prefs coluna normalizadas | **Feito** | `cadastroBase1ColumnPrefs.js` + `{key}_prefs` (355–356) |
| 11.10 Diálogo colunas | **Feito** | UX-34 |
| 11.11 Cards SSOT | **Feito** | UX-29 |
| 11.12 Tokens `--mg-*` + DM Sans | **Feito** | `cadastro-base1.css`, `index.html` |
| 11.13 Form `mg-field` + Ativo chave | **Feito** | `B1Field` / `B1ChaveRow` |
| 11.6 Camadas aninhadas filtro | **Feito** | `data-radix-popover-content` em `camadaAninhadaAberta` |
| 11.10 `MgSelect` min-width painel | **Feito** | `cmd-panel` CSS (359) |
| 11.14 Registro view vs edit | **Feito** | UX-37 — ver abaixo |
| 11.15 Pesquisa dropdown avançada | **Todo** | fora de escopo |
| 11.16 Anexos nativos | **Todo** | P8 |

**Arquivos:** `cadastroBase1ColumnPrefs.js`, `CadastroBase1Grade.jsx`, `CadastroColunaFiltro.jsx`, `CadastroListaChrome.jsx`, `cadastro-base1.css`, `cadastro-b1-controls.css`, `index.html`, `index.css`, `PROMPT-MODELO-VISUAL-AGRO-ERP.md`, `DECISIONS.md` (D-PROD-39).

### Verificação (UX-36)

- `npm run verify:all`

## UX-37 (2026-10-26) — Registro Marcas: leitura vs edição (checklist 11.14)

Branch `cursor/ux-base1-cards-colunas-878d` (PR #51).

| Lacuna vs frota/equipamentos | Correção |
|------------------------------|----------|
| Abrir registro existente ia direto para Salvar/Cancelar e bloqueava busca/alternador | `recordEditing` em `CadastroListaChrome`: leitura mantém toolbar Novo/Editar/Duplicar/Excluir + ferramentas à direita |
| Form sempre editável | `FormularioMarca` `readOnly` em leitura (`B1Field` locked, `B1ChaveRow` disabled) |
| Cancelar fechava o registro ao editar existente | `cancelForm` volta à leitura; novo/duplicado ainda fecha com Cancelar |

**Arquivos:** `CadastroListaChrome.jsx`, `Marcas.jsx`, `FormularioMarca.jsx`, `PROMPT-MODELO-VISUAL-AGRO-ERP.md`.

### Verificação (UX-37)

- `npm run verify:all`

## UX-38 (2026-10-26) — Filtros/colunas/cards vs CONTROLE-DE-ESTOQUE (auditoria profunda)

Branch `cursor/ux-base1-cards-colunas-878d` (PR #51). Prompt: `docs/engineering/PROMPT-MODELO-VISUAL-AGRO-ERP.md`. Referência lida: `grid.tsx`, `list.tsx`, `filtro-de-coluna.tsx`, `camada-aninhada-do-filtro.ts`, `colunas-dos-itens.tsx`, `preferences.ts`, `b1ref.css`.

| Contrato (referência) | Lacuna MAIKE (antes) | Correção |
|----------------------|----------------------|----------|
| Marcas sem faixa acima da grade (sem `mg-pills-rail` nem barra “Filtro de cabeçalho”) | `mg-header-filter-hint` aparecia com filtro ativo | Removida a faixa; limpar filtros só pelo ícone da toolbar (`showFilterRail={false}` mantido) |
| `fpop`: camadas 357–360, Escape, clique fora com geometria do ponteiro | `deveFecharPorFora` incompleto (sem 360, sem shell) | `cadastroColunaFiltroCamada.js` + `CadastroColunaFiltro.jsx` alinhados a `deveFecharFiltroPorFora` |
| Menu ⋮: filtro + congelar + autoajustar + ocultar | Já em `referenceExtendedColumnMenu` | Mantido; `fpop` no ⋮ via menu |
| `ColunasDosItens`: duas listas, busca separada, setas `dmid`, rascunho até ✓, sem ESC/fora | Diálogo aplicava ao clique; uma busca; sem setas; ESC/backdrop fechavam | `ConfiguracaoColunasB1Dialog.jsx` reescrito; CSS `dmid`/`cfgb-lista` em `cadastro-b1ref.css` |
| Prefs: `columns.autoFit` | `autoFit` só na raiz do JSON unificado | `cadastroBase1ColumnPrefs.js` grava/lê `columns.autoFit` (+ legado) |
| Mais opções ⚡ lista vertical (353); colunas/cards só no menu | `MoreHorizontal`; fechar menu antes do diálogo inconsistente | `IconeRaio` em `Base1Ui.jsx`; `CadastroListaChrome.jsx` controlado; ícones `Columns3`/`LayoutGrid`/`ListChecks` |
| Cards layout/campos só em Mais opções | Toolbar visível dos popovers | `Base1CardsToolbar` continua em `sr-only` + abertura via menu |

**Arquivos:** `cadastroColunaFiltroCamada.js`, `CadastroColunaFiltro.jsx`, `ConfiguracaoColunasB1Dialog.jsx`, `CadastroBase1Grade.jsx`, `CadastroListaChrome.jsx`, `Base1Ui.jsx`, `cadastroBase1ColumnPrefs.js`, `cadastro-b1ref.css`.

### Teste manual — Marcas (pós UX-38)

1. Tabela: toolbar colada à grade; **sem** rail de chips e **sem** linha “Filtro de cabeçalho” acima do `<th>`.
2. ⋮ → “Abrir filtro avançado”: painel `fpop` no cabeçalho; Enter aplica; X cancela; calendário/condição não fecha o shell no primeiro clique fora.
3. ⚡ Mais opções → Configurar colunas: duas listas, setas centrais, buscas independentes; editar e só aplicar em ✓; Restaurar padrão no cabeçalho do diálogo.
4. Modo cards: layout e campos **somente** no menu ⚡ (não na toolbar).
5. Autoajustar/congelar: recarregar página — prefs em `colunas_marcas_v1_prefs` com `columns.autoFit`.

### Verificação (UX-38)

- `npm run verify:all`

## UX-39 (2026-10-26) — Portal Compras: skin + fpop + grade (paridade 100%)

Branch `cursor/ux-base1-cards-colunas-878d` (PR #51). Plano: `docs/engineering/PLAN-PORTAL-COMPRAS-PARIDADE-BASE1.md`. Diff CDE: `portal-compras.module.css`, `filtro-de-coluna.tsx`, `seletor-de-operador.tsx`, `grid.tsx`, `globals.css` (decisão 349).

| Lacuna vs Portal Compras (CDE) | Correção |
|--------------------------------|----------|
| Toolbar/rodapé sem régua 25px + sombra verde (`portal-compras.module.css`) | `cadastro-b1-portal.css` + `portalComprasSkin` em `CadastroListaChrome` / `Marcas.jsx` |
| `fpop` sem marcador `.b1-portal-compras` nos botões Cancelar/Aplicar | Classe no shell e no `<form class="fpop">` via `usePortalComprasSkin` |
| Operador de condição = `<select>` nativo (não `SeletorDeOperador` Radix) | `SeletorDeOperador.jsx` + `CadastroColunaFiltro.jsx` |
| `.foperadores` estreito (sem decisão 359 `max-content`) | `cadastro-b1ref.css` alinhado ao CDE |
| Última coluna sem borda direita (CDE mantém — decisão 349) | Removido override `th/td:last-child` em `cadastro-base1.css` |
| Menu ⋮ / Mais opções fora da skin portal | `Base1Grid` + `CadastroListaChrome` + `ConfiguracaoColunasB1Dialog` com `b1-portal-compras` |

**Arquivos:** `SeletorDeOperador.jsx`, `portalComprasSkinContext.jsx`, `CadastroColunaFiltro.jsx`, `CadastroListaChrome.jsx`, `Base1Grid.jsx`, `ConfiguracaoColunasB1Dialog.jsx`, `Marcas.jsx`, `cadastro-b1-portal.css`, `cadastro-b1ref.css`, `cadastro-base1.css`, `index.css`, `PLAN-PORTAL-COMPRAS-PARIDADE-BASE1.md`.

### Teste manual — Marcas (pós UX-39)

1. **Join:** um cartão branco; toolbar colada à grade; botões Novo/Editar e ícones à direita com círculo 25px e sombra verde (não borda cinza no active).
2. **Cabeçalho:** ⋮ abre menu (filtro, autoajustar, congelar, ocultar); alça de resize com highlight verde no hover; última coluna com borda vertical.
3. **Filtro `fpop`:** ⋮ → Abrir filtro avançado; operador em pílula `fselb` com lista Radix larga o suficiente para “É maior ou igual a”; rodapé X/✓ com botões portal.
4. **Colunas:** ⚡ → Configurar colunas; diálogo `mdl` com botões Restaurar/Pronto no estilo portal.
5. **Persistência:** congelar + autoajustar + larguras → recarregar → `colunas_marcas_v1_prefs`.

### Verificação (UX-39)

- `npm run verify:all`

## UX-40 (2026-10-26) — Resize colunas + chrome único tabela/cards/registro

Branch `cursor/ux-base1-cards-colunas-878d` (PR #51). Referência: CDE `grid.tsx`, `list.tsx`, `cards.tsx`, `globals.css` (alça resize, decisão 356).

| Lacuna vs CDE / checklist | Correção |
|---------------------------|----------|
| Arraste de coluna deixava inline `width` no DOM e desalinhava células; cursor global ausente | `Base1Grid` sincroniza `th`/`td` no drag, `col-resize` no `body`, limpa inline no `mouseup`; arraste desliga autoajustar sem ligar no duplo clique |
| Piso de largura 40px nas prefs vs 48px na grade | `cadastroBase1ColumnPrefs.js` `MIN_COL_WIDTH = 48` |
| Portal Marcas com coluna checkbox (decisão 356) | `TabelaMarcas` → `colunaSelecao={false}` `selecaoSticky={false}` |
| Congelar/ocultar não devia limpar autoFit; ocultar não ajustava freeze | `CadastroBase1Grade` `handleFreeze`, `ocultarColuna` |
| Cards/registro fora do `mg-shell--join-table`; registro sem `mg-summary`; toolbar duplicada | `CadastroListaChrome`: `joinedShell = joinTableToolbar` para tabela, cards e registro; um toolbar + um rodapé; corpo só troca (grade/cards/form) |
| Cabeçalho de registro como card solto no join | `CadastroRecordHeader` `joinShell` |
| Cards sem hover CDE | `Base1Cards` sombra no hover |

**Arquivos:** `Base1Grid.jsx`, `CadastroBase1Grade.jsx`, `CadastroListaChrome.jsx`, `CadastroRecordHeader.jsx`, `Base1Cards.jsx`, `TabelaMarcas.jsx`, `cadastroBase1ColumnPrefs.js`, `cadastro-base1.css`, `tests/smoke/cadastroBase1ColumnPrefs.test.js`.

### Teste manual — Marcas (pós UX-40)

1. **Resize:** arrastar alça (6px, highlight verde); mínimo 48px; duplo clique ajusta uma vez sem ícone de autoajustar; com autoajustar ligado, arrastar desliga o modo; recarregar mantém larguras em `colunas_marcas_v1_prefs`.
2. **Chrome:** alternar tabela ↔ cards ↔ registro — mesma faixa de botões (Novo/Editar/… ou Salvar/Cancelar), mesmo `mg-summary` embaixo, ViewSwitch no mesmo lugar; cards dentro do cartão join com `p-2.5`.
3. **Registro:** bookmark + nav colados ao form dentro do shell; leitura mostra toolbar de lista; edição troca só os botões primários.
4. **Grade portal:** sem coluna de checkbox; seleção por clique na linha.

### Verificação (UX-40)

- `npm run verify:all`

## UX-41 (2026-10-26) — Micro detalhes (grade, fpop, toolbar, menus)

Branch `cursor/ux-base1-cards-colunas-878d` (PR #51). Diff CDE: `globals.css`, `b1ref.css`, `portal-compras.module.css`, `grid.tsx`, `ui.tsx` (MenuList), `filtro-de-coluna.tsx`.

| Área | Lacuna | Correção |
|------|--------|----------|
| Grade / cabeçalho | Menu ⋮ com hover verde (`--mg-accent`) fora do portal | `th-menu` `#475569` / hover `#0f172a` (paridade `globals.css`) |
| Grade portal | Linhas da grade | `--mg-table-line: #dfe2e7` em `.cadastro-b1--portal-compras` |
| Join shell | Toolbar join `min-height: 34px` | `var(--mg-toolbar-h)` (36px) |
| ViewSwitch portal | Segmento pressionado texto `#0f172a` | Fundo branco + texto `var(--mg-accent)` |
| Nav registro portal | `tb-btn-sm` (24px) nos ícones prev/next | Override portal mantém círculo 25px |
| `fpop` | `z-index` 45/60 abaixo de overlays empilhados | `z-index: 10000` (`cadastro-b1ref.css` + `.b1-portal-compras.fpop`) |
| `fpop` rodapé portal | `cadastro-b1-controls` forçava botões 28px branco/verde | Estilo legado só em `.b1ref:not(.b1-portal-compras)`; skin portal 25px |
| `foperadores` | Itens da lista 28px | `min-height: 30px` nos `.fopt` dentro de `.foperadores` |
| Operador Radix | Lista sem marcador portal no portal | `SeletorDeOperador` repassa `b1-portal-compras` no portal |
| Mais opções / ⋮ coluna | Hover `mg-gray-fill` | `mg-b1-menuitem` e `[role=menuitem]` → hover `mg-bg-page`; danger vermelho em ícone+texto |
| Rodapé lista | Contagens em flex solto | `mg-summary__counts` grid 4 colunas (CDE `globals.css`) |

**Arquivos:** `cadastro-base1.css`, `cadastro-b1-portal.css`, `cadastro-b1ref.css`, `cadastro-b1-controls.css`, `CadastroColunaFiltro.jsx`, `SeletorDeOperador.jsx`.

### Teste manual — Marcas (pós UX-41)

1. **Grade:** linhas `#dfe2e7` no join portal; ⋮ e ícones de estado (`Filter`/`Scaling`/`PanelLeft`) em `#94a3b8`; hover da linha e seleção com faixa verde 3px na primeira célula; alça 6px verde no hover.
2. **Ordenação:** clique no rótulo da coluna → seta `#94a3b8`.
3. **`fpop`:** painel acima da grade sticky; operador abre lista 30px de altura; clicar fora com operador/calendário aberto não fecha o shell (357–360); rodapé X/✓ com pílulas portal 25px.
4. **Toolbar / rodapé:** altura ~36px; ViewSwitch com segmento ativo verde; `mg-summary` em 4 colunas alinhado ao seletor de page-size.
5. **Menus:** ⋮ coluna e Mais opções — itens 30px, hover fundo página; Excluir vermelho se exposto como `danger`.

### Verificação (UX-41)

- `npm run verify:all` (gates, smoke, build verdes; `test:backend` exige `DATABASE_URL` + Postgres local)

## UX-42 (2026-10-26) — Bug hunt Marcas / portal compras (paridade CDE)

Branch `cursor/ux-base1-cards-colunas-878d` (PR #51). Auditoria vs `grid.tsx`, `list.tsx`, `camada-aninhada-do-filtro.ts`.

| Sintoma | Causa | Correção |
|---------|-------|----------|
| `fpop` não fecha ao clicar fora com menus Radix da toolbar fechados | `SELETOR_CAMADA_ANINHADA` incluía `mg-b1-glass-pop` e `data-radix-popover-content` (qualquer popover) | Seletor alinhado ao CDE; `ehCamadaAninhadaDoFiltro` usa `closest` como na referência |
| Congelamento “fantasma” após ocultar colunas no diálogo | `onAplicar` do configurador não limitava `frozen` nem `autoFit` às visíveis | `clampColumnPrefsToVisible` + apply no diálogo e em `ocultarColuna` |
| Prefs carregavam `frozen` contra todas as colunas, não só visíveis | `loadCadastroBase1ColumnPrefs` usava `knownIds.length` | `frozen` e `autoFit` normalizados pelo conjunto visível |
| Coluna **Nº** ordenava como texto (`10` antes de `2`) | `ordenados` sempre `toLowerCase` + comparação lexicográfica | Ordenação numérica quando `tipoFiltroDaColuna` = `num` (paridade `headerOrder` no CDE) |
| Seletor de page-size no rodapé portal estreito / desalinhado | `min-width` 3.25rem vs CDE 4.5rem | `cadastro-base1.css` `.mg-pill-select` → `4.5rem` |

**Arquivos:** `cadastroColunaFiltroCamada.js`, `CadastroBase1Grade.jsx`, `cadastroBase1ColumnPrefs.js`, `cadastro-base1.css`, `tests/smoke/cadastroColunaFiltroCamada.test.js`, `tests/smoke/cadastroBase1ColumnPrefs.test.js`.

### Teste manual — Marcas (pós UX-42)

1. Abrir filtro `fpop` em **Nome** → clicar na grade fora → painel fecha (sem precisar fechar ⋮/⚡ antes).
2. Congelar 3 colunas → ⚡ Configurar colunas → ocultar coluna congelada → Pronto → âncora de freeze coerente; recarregar → `colunas_marcas_v1_prefs` com `frozen` ≤ colunas visíveis.
3. Ordenar coluna **Nº** ascendente → ordem numérica (1, 2, 10…).
4. Rodapé: seletor de page-size com largura estável (~4.5rem mínimo).

### Verificação (UX-42)

- `npm run test:smoke` (incl. `cadastroColunaFiltroCamada`, `cadastroBase1ColumnPrefs`)
- `npm run test:gates`
- `npm run verify:all` — falha esperada só em `test:backend` sem `DATABASE_URL`/Postgres local

## UX-43 (2026-10-26) — Marcas sign-off Fase 1 (lacunas + viewport)

Branch `cursor/ux-base1-marcas-gaps-516d` (base: `cursor/ux-base1-cards-colunas-878d` / PR #51 ainda aberta).

**Objetivo:** fechar Fase 1 de `PLAN-EXECUCAO-PARIDADE-BASE1.md` antes do rollout Setores (Fase 2).

| Item Fase 1 | Status | Evidência |
|-------------|--------|-----------|
| Cards `p-4` + grid `gap-3` | **Feito** | Paridade `features/base1/cards.tsx` CDE; viewport cards `mg-shell__scroll p-2.5` = `list.tsx` |
| Toolbar join tablet/mobile | **Feito** | `cadastro-base1.css`: `mg-toolbar--join` `height: auto` + wrap ≤1023px; mobile ≤639px com pílulas primárias 44px |
| Sign-off UX-40/41/42 | **Feito** | Checklist PROMPT §11.1–11.14; revisão CDE pós UX-42 |
| §11.15 pesquisa avançada / favoritos | **Fora** | **D-PROD-40** |
| §11.16 anexos | **P8** | Ícone toolbar desabilitado + `attachDisabledReason` — **D-PROD-40** |
| Dialogs transversais (UX-A/B) | **Defer Fase 3** | Não bloqueia referência Marcas |

**Ajustes de código (UX-43):**

- `data-testid="b1-toolbar"` no chrome (paridade CDE / portal-compras).
- `Base1Cards`: `scrollIntoView({ block: "center" })` como no CDE.
- CSS toolbar responsiva join + toque primário mobile (ver acima).

### Teste manual — Marcas sign-off (viewport)

| Largura | Verificar |
|---------|-----------|
| 360 / 390 | Toolbar join quebra sem clip; Novo/Excluir tocáveis; cards `p-4`; summary 4 colunas empilha no mobile |
| 768 | Toolbar join wrap; grade horizontal scroll; ViewSwitch segmento ativo verde |
| 1280 | Shell join único cartão; `fpop` z-index 10000; page-size `4.5rem` |

### Verificação (UX-43)

- `npm run verify:all`

## UX-44 (2026-10-26) — Marcas modelo Base1 (piloto fechado, rollout pausado)

Branch `cursor/ux-base1-marcas-modelo-516d` (base: `cursor/ux-base1-marcas-gaps-516d` / UX-43).

**Objetivo:** encerrar o piloto **Marcas** como referência executável para futuras réplicas, **sem** abrir rollout em Setores/Produtos (**D-PROD-41**).

| Entrega | Status |
|---------|--------|
| Checklist executável | [`MARCAS-MODELO-BASE1-CHECKLIST.md`](./MARCAS-MODELO-BASE1-CHECKLIST.md) |
| Plano Fase 2 | **Pausada** + gate §H em `PLAN-EXECUCAO-PARIDADE-BASE1.md` |
| Decisão rollout | **D-PROD-41** em `DECISIONS.md` |
| Caminho crítico A–F (técnico) | **100%** DONE/N/A (43/43 itens) |
| Gate H (merge `main` + aceite proprietário) | Aberto |

**Auditoria vs CDE (portal compras + `base1/list`):**

| Área | Marcas | CDE `DocList` / `Base1List` |
|------|--------|-----------------------------|
| Toolbar join + skin portal | `joinTableToolbar` + `portalComprasSkin` | `barraIntegrada` + `b1-portal-compras` |
| Filtro cabeçalho + `fpop` | `referenceHeaders` + camadas UX-42 | `referenceHeaders` + `headerFilters` |
| Resize / freeze / autoFit | `CadastroBase1Grade` | `Base1Grid` |
| Cards padding | `p-4` / viewport `p-2.5` | `cards.tsx` / `list.tsx` |
| Checkbox seleção | Desligado (produto) | Desligado quando `barraIntegrada` |
| Chips rail | `showFilterRail={false}` | `semFaixaDeFiltros` equivalente |

**Fora do escopo desta missão (documentado, não código):** §11.15 DEFER, §11.16 P8, dialogs UX-A/B (Fase 3), tenancy/numeração (PRs backend).

### Verificação (UX-44)

- `npm run verify:all` na branch `cursor/ux-base1-marcas-modelo-516d`
- `npm run gate:governance-paths`

## UX-45 (2026-10-26) — Integração `main` + organização Marcas (D-PROD-41)

Branch `cursor/ux-base1-marcas-organize-516d` (docs + fix `gate:types` em #51).

**Objetivo:** mergear a fila de PRs do piloto Base1/Marcas e deixar o gate §H pronto para aceite do proprietário.

| PR | Merge commit | Conteúdo |
|----|--------------|----------|
| **#51** | `e63aa297` | Motor UX-29–42 (cards, colunas, grade, portal join) + fix `ehCamadaAninhadaDoFiltro` (`Element`) |
| **#52** | `0646cdf5` | `PLAN-EXECUCAO-PARIDADE-BASE1.md` + ROADMAP |
| **#53** | `1849cb54` | UX-43 Fase 1 sign-off (toolbar mobile, cards `p-4`, D-PROD-40) |
| **#54** | `5df4458f` | Checklist executável, D-PROD-41, UX-44, UX-45 (gate §H) |

**Organização Marcas (checklist A–G):** nenhum item **PARTIAL** restante em A–F; G.3–G.5 permanecem documentados (dialogs Fase 3, tenancy, `max+1`). Passagem CDE pós-merge: sem diff de código adicional além do fix de tipos em `cadastroColunaFiltroCamada.js` (smoke com `document.createElement`).

**Gate §H após integração:**

| Item | Status |
|------|--------|
| H.1–H.2 | DONE |
| H.3 | DONE (CI verde nas branches integradas) |
| H.4 | DONE (UX-43) |
| H.5 | **TODO** — aceite “Marcas modelo OK” |
| H.6 | DONE (#51 + #53 + modelo na `main`) |

### Verificação (UX-45)

- `npm run gate:governance-paths`
- `npm run gate:types` (teto 1746)

## UX-46 (2026-10-26) — Marcas pós-modelo: registro + diálogo exclusão

Branch `cursor/ux-base1-marcas-next-516d` (após merge #55 na `main`).

**Objetivo:** fechar lacunas **somente Marcas** ainda abertas no checklist (G.3 fluxo exclusão; polish formulário registro vs frota/equipamentos) sem iniciar rollout Fase 2 (**D-PROD-41** / **H.5**).

| Item | Correção |
|------|----------|
| **G.3 exclusão** | `TopNoticeDialog` honra `cancelText` (botão Cancelar na barra); política dismiss inalterada (sem ESC/clique fora) — `ConfirmDialog` em `Marcas.jsx` |
| **Registro pós-salvar** | Atualizar marca volta ao modo **leitura** no mesmo registro (não fecha o painel) — paridade view/edit frota |
| **Navegação entre registros** | `key` no `FormularioMarca` reseta estado ao mudar bookmark/prev/next |
| **Formulário** | Grade SSOT `mg-b1-form-grid`; campo **Nº** somente leitura quando registro existente |
| **Checklist** | G.3 Marcas → **DONE**; PARTIAL restantes: G.4 tenancy, G.5 `max+1` |

**Fora de escopo:** §11.15, §11.16 P8, `RegistroAnexosDialog` transversal (Fase 3), Setores rollout.

### Verificação (UX-46)

- `npm run verify:all` (CI com Postgres; local sem `DATABASE_URL` falha só `test:backend`)

## UX-47 (2026-10-26) — Marcas TRACK B: chrome unificado + formulário (revisão contínua)

Branch `cursor/ux-base1-marcas-chrome-516d` (base: `main` pós-#55).

**Objetivo:** consolidar **UX-46** e polir chrome compartilhado (tabela / cards / registro) vs CDE frota/portal — sem rollout Fase 2.

| Área | Correção |
|------|----------|
| **Registro pós-salvar / leitura** | `Marcas.jsx`: atualizar volta a `readOnly`; `key` no `FormularioMarca` ao navegar bookmark |
| **Formulário** | `mg-b1-form-grid` + **Nº** somente leitura em registro existente (`isExistingRecord`) |
| **Exclusão G.3** | `TopNoticeDialog` exibe `cancelText` na barra; `ConfirmDialog` em Marcas |
| **Cards** | Hover só via `.b1-card:hover` em `cadastro-base1.css` (remove sombra Tailwind duplicada) |
| **Join shell registro** | `cadastro-record-header` + `mg-form-scroll` com `flex-shrink` / fundo branco no `mg-shell--join-table` |

**Arquivos:** `CadastroListaChrome.jsx` (inalterado — comportamento UX-40 validado), `CadastroRecordHeader.jsx`, `Base1Cards.jsx`, `cadastro-base1.css`, `Marcas.jsx`, `FormularioMarca.jsx`, `TopNoticeDialog.jsx`, docs checklist/plano.

### Verificação (UX-47)

- `npm run verify:all`

## UX-47 (2026-10-26) — TRACK C: chrome menus (Mais opções, colunas, confirmação, page size)

Branch `cursor/ux-base1-marcas-menus-516d` (revisão contínua pós-UX-46).

**Objetivo:** fechar paridade do chrome de lista no piloto Marcas (menu ⚡, diálogo de colunas, confirmação de exclusão, rodapé page size) sem ampliar rollout (**D-PROD-41**).

| Item | Correção |
|------|----------|
| **Mais opções** | Entrada **Limpar filtros** no menu vertical (§11.3 / checklist B.3); ícone toolbar mantido quando `showFilterRail={false}` |
| **Configurar colunas** | Fluxo menu → `onConfigureColumns` → `ConfiguracaoColunasB1Dialog` (rascunho até ✓; portal skin via `PortalComprasSkinProvider`) — sem alteração de contrato |
| **Exclusão Marcas** | `ConfirmDialog` → `TopNoticeDialog` com `cancelText` visível na barra (UX-46) + política dismiss (sem ESC/clique fora) |
| **Page size** | `MgSelect` pill no rodapé: `min-width: 4.5rem` preservado na skin portal compras (`cadastro-b1-portal.css`) |
| **Checklist** | G.3 **DONE** (Marcas); B.3 evidência menu limpar filtros |

**Arquivos:** `CadastroListaChrome.jsx`, `cadastro-b1-portal.css`, `TopNoticeDialog.jsx`, `Marcas.jsx`, `FormularioMarca.jsx`, docs checklist/plano.

### Verificação (UX-47)

- `npm run verify:all`

## UX-47 (2026-10-26) — Revisão contínua **TRACK A** (grade / cabeçalho / fpop / resize / freeze)

Branch `cursor/ux-base1-marcas-next-516d`. Referência: CDE `features/base1/grid.tsx`, `list.tsx`, `filtro-de-coluna.tsx`, `largura-coluna.ts`, `b1ref.css`.

| Área TRACK A | Lacuna vs CDE | Correção |
|--------------|---------------|----------|
| **Resize** | Arraste sincronizava só `tbody`; `<tfoot>` (totais, ex. Lotes) desalinhava durante o drag | `Base1Grid` `syncColunaInline` em `tbody` + `tfoot` |
| **Prefs largura** | `onResize` podia gravar fora de 48–1200px | `CadastroBase1Grade` usa `MIN_COL_WIDTH` / `MAX_COL_WIDTH` de `cadastroBase1ColumnPrefs.js` |
| **Congelar** | `onFreeze` sem renormalizar ao nº de colunas visíveis | `normalizeFrozenCount(n, colunasOrdenadas.length)` (paridade `list.tsx`) |
| **Autoajuste** | API de medição sem `fontCelula` / `chromeExtraCelula` opcionais | `larguraColuna.js` alinhado a `largura-coluna.ts` |
| **fpop / cabeçalho** | Auditoria: `data-b1-col-menu`, reposicionamento scroll/resize, camadas 357–360, z-index 10000 — sem lacuna nova | Mantido |

**Arquivos:** `Base1Grid.jsx`, `CadastroBase1Grade.jsx`, `larguraColuna.js`, `cadastroBase1ColumnPrefs.js`.

### Teste manual — TRACK A (Marcas)

1. Resize + duplo clique; autoajustar desliga ao arrastar; prefs em `colunas_marcas_v1_prefs`.
2. Congelar / descongelar; sombra na âncora; ocultar coluna congelada → `frozen` coerente.
3. ⋮ → fpop: Enter aplica; camadas aninhadas; painel segue o `<th>` no scroll.
4. Ícones de estado no cabeçalho + menu ⋮ portal.

### Verificação (UX-47 TRACK A)

- `npm run verify:all` (local: `test:backend` exige Postgres/`DATABASE_URL`)

## UX-48 (2026-10-26) — Integração `main` pós-modelo (#56 + #58)

**Objetivo:** consolidar na `main` o chrome TRACK B/C (PR **#56**) e a grade TRACK A (PR **#58**) sem abrir rollout Fase 2 (**D-PROD-41** / **H.5**).

| PR | Merge | Conteúdo |
|----|-------|----------|
| **#56** | `7c1b6d4d` | UX-47 TRACK B/C — registro leitura/edição, formulário, menus ⚡, page size portal |
| **#58** | `96ad16b1` | UX-47 TRACK A — resize `tfoot`, clamp largura prefs, `normalizeFrozenCount`, `larguraColuna` |

**Gate §H após #56/#58:** H.1–H.4 e H.6 **DONE**; **H.5** permanece com produto.

### Verificação (UX-48)

- `npm run verify:all` na `main` com Postgres (CI)

## UX-49 (2026-10-26) — Revisão contínua Marcas vs portal compras (pós #56/#58)

**Branch:** `cursor/ux-base1-marcas-continue-516d`  
**Objetivo:** passagem final CDE ↔ Marcas; corrigir lacunas **somente piloto**; preparar aceite **H.5** sem rollout Setores.

### Auditoria Marcas vs CDE (`barraIntegrada` + `referenceHeaders`)

| Área | CDE | Marcas | Resultado |
|------|-----|--------|-----------|
| Join toolbar + skin | `barraIntegrada` + `b1-portal-compras` | `joinTableToolbar` + `portalComprasSkin` | **Paridade** |
| Sem rail chips | `semFaixaDeFiltros` | `showFilterRail={false}` | **Paridade** |
| Checkbox seleção | Off com barra integrada | `colunaSelecao={false}` | **Paridade** |
| Grade `fpop` / resize / freeze | `grid.tsx` + `filtro-de-coluna.tsx` | UX-35–42, #58 TRACK A | **Paridade** |
| Cards padding | `cards.tsx` `p-4`, scroll `p-2.5` | `Base1Cards` | **Paridade** |
| Registro view/edit | `Record` + `recMode` | `recordEditing` + `readOnly` | **Paridade** |
| Limpar filtros | `clearAll` zera chips **e** busca | Antes: só filtros de coluna | **Corrigido** (UX-49) |
| Form novo/duplicar | `key` por sessão de registro | Antes: `marca-nova` fixo remontava mal | **Corrigido** (`formEpoch`) |
| Tenancy / `max+1` | Servidor | `localStorage` + `marcaService` | **G.4 / G.5** — documentado, sem UI |

### Correções de código

| Item | Arquivo |
|------|---------|
| Limpar filtros + busca (menu ⚡ e ícone toolbar) | `Marcas.jsx` |
| Remount formulário em Novo/Duplicar consecutivos | `Marcas.jsx` (`formEpoch`) |

### Documentação H.5

| Artefato | Função |
|----------|--------|
| [`MARCAS-H5-MANUAL-TEST.md`](./MARCAS-H5-MANUAL-TEST.md) | Roteiro manual repetível + matriz viewport para sign-off proprietário |
| [`MARCAS-MODELO-BASE1-CHECKLIST.md`](./MARCAS-MODELO-BASE1-CHECKLIST.md) | H.3–H.6 atualizados pós #58 |

**Fora de escopo:** G.4 tenancy, G.5 numeração, §11.15 DEFER, §11.16 P8, rollout Setores.

### Verificação (UX-49)

- `npm run verify:all` (CI com `DATABASE_URL`)

## UX-50 (2026-10-26) — Revisão contínua Marcas (pós PR #59) + automação H.5

**Branch:** `cursor/ux-base1-marcas-ux50-7cc9`  
**Base:** `main` pós-merge **#59** (`eb3866ee`, UX-49).

**Objetivo:** `verify:all` na `main`; auditoria CDE (portal compras + frota registro) nos eixos de dor do usuário; automatizar trecho do roteiro H.5; manter gate §H aguardando aceite proprietário (**D-PROD-41**, sem Setores).

### `verify:all` na `main` (agente 2026-10-26)

| Etapa | Resultado |
|-------|-----------|
| Gates 1–19 (exceto backend) | **Verde** |
| `test:backend` | **Falha esperada** sem `DATABASE_URL` / Docker no agente |
| `lint` | Verde (warning `eslint-disable` órfão em `Base1Grid` — removido em UX-50) |

### Auditoria Marcas vs CDE (foco dor do usuário)

| Eixo | CDE (`barraIntegrada` + `grid` / `Record`) | Marcas | Resultado |
|------|--------------------------------------------|--------|-----------|
| Filtros de cabeçalho + `fpop` | `referenceHeaders`, camadas 357–360, operador Radix | `TabelaMarcas` + UX-35–42 | **Paridade** |
| Sensação resize coluna | Alça 6px, `col-resize`, mín. 48px, sync corpo/rodapé | `Base1Grid` + #58 `syncColunaInline` em `tfoot` | **Paridade** |
| Chrome único tabela / cards / registro | `mg-shell` join + mesma barra | `joinTableToolbar` + `joinedShell` (UX-40) | **Paridade** |
| Espaçamento | Toolbar ~36px; cards `p-4` / scroll `p-2.5`; summary 4 colunas | `portalComprasSkin` + UX-43 | **Paridade** |
| Limpar filtros + busca | `clearAll` | `clearCadastroListaFiltersAndSearch` (SSOT UX-49/50) | **Paridade** |

**Sem lacuna técnica nova** nos itens A–F do checklist; **H.5** permanece com produto.

### Automação (roteiro H.5)

| Roteiro manual | Automação |
|----------------|-----------|
| §7 Limpar filtros (coluna + busca) | `tests/smoke/cadastroListaClearFilters.test.js` + `src/lib/cadastroListaClearFilters.js` |
| Prefs coluna / camadas fpop | Já em `cadastroBase1ColumnPrefs.test.js`, `cadastroColunaFiltroCamada.test.js` |

### Verificação (UX-50)

- `npm run test:smoke`
- `npm run verify:all` (CI com Postgres)

## UX-51 (2026-10-26) — Revisão contínua Marcas (pós PR #60) + H.5 evidências

**Branch:** `cursor/ux-base1-marcas-ux51-516d`  
**Base:** `main` pós-merge **#60** (`d05304d4`, UX-50).

**Objetivo:** `verify:all` na `main`; diff CDE nos arquivos tocados desde UX-50; fechar lacuna restante em **limpar filtros**; enriquecer roteiro H.5 para aceite proprietário — sem rollout Setores (**D-PROD-41**).

### `verify:all` na `main` (agente 2026-10-26)

| Etapa | Resultado |
|-------|-----------|
| Gates 1–19 (exceto backend) | **Verde** |
| `test:backend` | **Falha esperada** sem Docker/`DATABASE_URL` no agente |
| `build` | Verde |

### Diff CDE vs delta UX-50 → UX-51

**Arquivos alterados desde UX-49 (`eb3866ee`) até UX-50 (#60):** docs, `cadastroListaClearFilters.js`, `Marcas.jsx`, smoke, remoção `eslint-disable` em `Base1Grid`.

| Eixo | CDE `list.tsx` `clearAll` | Marcas UX-50 | UX-51 |
|------|---------------------------|--------------|-------|
| Filtros cabeçalho | `setValues` + `resetFiltersKey` equivalente | `clearFilters()` | Mantido |
| Busca | `setSearch("")` + `applied` | `setSearchInput` + `applySearch("")` | Mantido |
| Seleção | `setSelected(new Set())` | **Ausente** | **`setSelectedIds([])`** no helper SSOT |

**Demais eixos H.5 (fpop, resize, view modes, registro):** auditoria de código — sem lacuna nova vs checklist A–F.

### Correções / documentação

| Item | Arquivo |
|------|---------|
| Limpar filtros + busca + seleção | `src/lib/cadastroListaClearFilters.js`, smoke |
| Matriz de screenshots + passo seleção no §7 | `MARCAS-H5-MANUAL-TEST.md` |
| Evidência B.3 / H.3 | `MARCAS-MODELO-BASE1-CHECKLIST.md`, `CURRENT-STATE.md` |

**Fora de escopo:** browser manual no agente (sem credenciais `.env.local`); G.4/G.5; §11.15/16; Setores.

### Verificação (UX-51)

- `npm run test:smoke`
- `npm run gate:governance-paths`
- `npm run verify:all` (CI com Postgres)

## UX-52 (2026-10-27) — Page size: bordas laterais do gatilho (paridade CDE)

Branch `cursor/ux-base1-pagination-borders-516d`:

| Item | Antes | Depois |
|------|-------|--------|
| Gatilho `.mg-pill-select.cmd-display` | `border: 1px solid transparent`; fundo `--mg-gray-fill` | `border: 1px solid #dfe2e7`; fundo `#fff`; `box-shadow: var(--mg-field-edge-shadow)` |
| Portal compras (aberto) | `button[aria-expanded="true"]` forçava `border-color: transparent !important` | `:not(.mg-pill-select)` no reset; pill mantém `#dfe2e7` / foco `--mg-focus-border` |
| Portal compras pill | Agrupado com `.tb-btn` (`border: transparent`, sombra verde) | Bloco próprio: borda `#dfe2e7`, fundo branco, sombra de campo |
| Painel `mg-pill-select-panel` | Só `border` shorthand | Laterais explícitas `#dfe2e7`; sem `mg-b1-glass-pop` no pill; `b1-portal-compras` no portal |

**Arquivos:** `cadastro-base1.css`, `cadastro-b1-portal.css`, `cadastro-b1-controls.css`, `MgSelect.jsx`.

### Verificação (UX-52)

- `npm run test:smoke`
- `npm run verify:all`

## UX-53 (2026-10-27) — Contrato colunas (resize / autofit / prefs)

Branch `cursor/ux-base1-colunas-contrato-516d` · decisão **D-PROD-42**:

| Item | Entrega |
|------|---------|
| SSOT prompt | `docs/engineering/PROMPT-COLUNAS-PORTAL-COMPRAS.md` — tabela CDE ↔ MAIKE (`onResize` vs `onAutoFit`, duplo clique sem autofit, TETO 480, prefs `_prefs`) |
| Auditoria código | `Base1Grid.jsx`, `cadastroBase1ColumnPrefs.js`, `larguraColuna.js` — alinhamento `MIN_COL_WIDTH` na alça de resize |

### Verificação (UX-53)

- `npm run test:smoke`
- `npm run verify:all`

## UX-54 (2026-10-27) — Responsividade Base1 (Marcas + chrome compartilhado)

Branch `cursor/ux-responsividade-maike-516d` · plano [`PLAN-RESPONSIVIDADE-MAIKE.md`](./PLAN-RESPONSIVIDADE-MAIKE.md).

**Objetivo:** adaptação viewport (320px–desktop) **sem redesign** — tokens `--mg-*`, skins portal e identidade Base1 intactos.

| Item | Entrega |
|------|---------|
| Cadeia flex `min-w-0` | `cadastro-b1--full-page`, `CadastroWorkspace`, `CadastroListaChrome` |
| Summary 2×2 | `mg-summary__counts` ≤1023px em `base1-list` |
| Grade | `overflow-x` no `.mg-grid-wrap` ≤1023px (antes só ≤639px) |
| Toolbar mobile | Busca `mg-search-pill-wrap` largura total na linha `.ml-auto` ≤639px |
| Popovers | `max-width: min(calc(100vw - 16px), 24rem)` vidro / `cmd-panel` / `fpop` |

**Fora (P2):** toque 44px em ícones portal 25px; `Layout.jsx` global; `scripts/check-overflow.js`.

### Matriz manual (H.4 / responsividade)

| Largura | Verificar |
|---------|-----------|
| 320 / 375 / 390 / 414 | Sem scroll horizontal na página; summary 2×2; popover dentro da viewport |
| 768 / 1024 | Grade scroll no cartão; toolbar join wrap |
| 1280 / 1440 / 1920 | Paridade visual pré-UX-54 |

### Verificação (UX-54)

- `npm run verify:all`

## UX-55 (2026-10-27) — Menus Marcas: colunas por modo, popovers cards, sem filtro na toolbar

Branch `cursor/ux-base1-marcas-menus-view-516d`.

**Objetivo:** comportamento do chrome ⚡ no piloto Marcas — sem redesign.

| Item | Correção |
|------|----------|
| **Configurar colunas** | Entrada do menu ⚡ habilitada só em `viewMode === "table"` (desligada em cards e registro) |
| **Layout / campos dos cards** | Popovers abrem ancorados ao botão ⚡ (`B1Popover` + `PopoverAnchor` fixo); removido host `sr-only`/`aria-hidden` que clipava o gatilho Radix |
| **Limpar filtros** | Removido ícone `FilterX` da toolbar quando `showFilterRail={false}`; mantidos menu ⚡, filtros `fpop` no cabeçalho e link na faixa de cabeçalho da grade |

**Arquivos:** `CadastroListaChrome.jsx`, `Base1Cards.jsx`, `Base1Ui.jsx`.

### Verificação (UX-55)

- `npm run verify:all` (local sem `DATABASE_URL`: falha só `test:backend`)

## UX-56 (2026-10-27) — Cards: diálogo modal centrado (paridade colunas)

Branch `cursor/ux-base1-cards-dialog-516d`.

**Objetivo:** layout e campos dos cards abrem como diálogo centrado (`b1ref` `.mdl`), não popover ancorado ao ⚡ — corrige flash ao fechar o menu.

| Item | Correção |
|------|----------|
| **Layout / campos dos cards** | `ConfiguracaoLayoutCardsB1Dialog` e `ConfiguracaoCamposCardsB1Dialog` (portal + rascunho até ✓), mesmo padrão de `ConfiguracaoColunasB1Dialog` |
| **Menu ⚡** | `cardsPanel` abre o diálogo sem `menuAnchorRect` / `B1Popover` ancorado |
| **Flash** | Estado `open` do diálogo independente do fechamento do popover Mais opções |

**Arquivos:** `ConfiguracaoCardsB1Dialogs.jsx` (novo), `Base1Cards.jsx`, `CadastroListaChrome.jsx`.

### Verificação (UX-56)

- `npm run verify:all`
