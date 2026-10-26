# Marcas — modelo Base1 (checklist executável)

**Tipo:** checklist de paridade (copiar estrutura ao replicar em outro cadastro)  
**Piloto:** `src/pages/Marcas.jsx`  
**Referência CDE:** `CONTROLE-DE-ESTOQUE` — `features/compras/` (`DocList` + `barraIntegrada`), `features/base1/list.tsx`, `grid.tsx`, `cards.tsx`  
**Checklist normativo:** [`PROMPT-MODELO-VISUAL-AGRO-ERP.md`](./PROMPT-MODELO-VISUAL-AGRO-ERP.md) §11  
**Decisões:** **D-PROD-39**, **D-PROD-40**, **D-PROD-41**

**Legenda:** **DONE** · **PARTIAL** · **TODO** · **DEFER** (fora de escopo) · **P8** (missão futura) · **N/A**

---

## A. Pacote de página (copiar em cada cadastro futuro)

| # | Item | Marcas hoje | Evidência / notas |
|---|------|-------------|-------------------|
| A.1 | `CadastroWorkspace` com `pageLayout="base1-list"` | **DONE** | `Marcas.jsx` |
| A.2 | `joinTableToolbar` + um cartão branco (§11.2) | **DONE** | `portalComprasSkin` |
| A.3 | `showFilterRail={false}` (sem `mg-pills-rail`; portal compras) | **DONE** | §11.4 N/A |
| A.4 | `portalComprasSkin={true}` | **DONE** | `cadastro-b1-portal.css` |
| A.5 | Storage key estável de colunas (`*_v1`) | **DONE** | `colunas_marcas_v1` |
| A.6 | `useCadastroListaChromeState` + footer paging | **DONE** | `useCadastroListaFooter` |
| A.7 | Export CSV / Imprimir / Duplicar no chrome | **DONE** | `onExportCsv`, `onPrint`, `prepareCadastroDuplicate` |
| A.8 | Configurar colunas/cards via **Mais opções** (sem rail) | **DONE** | `onConfigureColumns` + `Base1CardsToolbar` |
| A.9 | `recordMode` + `recordEditing` + form `readOnly` (§11.14) | **DONE** | UX-37 |
| A.10 | Anexos toolbar: visível, desabilitado com motivo até P8 | **DONE** | `attachDisabledReason` — D-PROD-40 |

---

## B. Toolbar e chrome unificado (lista / cards / registro)

| # | Item | Marcas hoje | Evidência / notas |
|---|------|-------------|-------------------|
| B.1 | Busca pílula + aplicar (Enter / botão) | **DONE** | §11.3 |
| B.2 | Alternador Tabela / Cards / Registro (`ViewSwitch`) | **DONE** | UX-41 |
| B.3 | Menu **Mais opções** vertical (export, colunas, limpar filtros) | **DONE** | |
| B.4 | Toolbar join: `data-testid="b1-toolbar"` | **DONE** | UX-43 / paridade CDE |
| B.5 | Toolbar join responsiva (wrap, `height: auto` ≤1023px) | **DONE** | UX-43 |
| B.6 | Toque 44px em pílulas primárias mobile (≤639px) | **DONE** | UX-43 |
| B.7 | Registro: `CadastroRecordHeader` + navegação entre filtrados | **DONE** | |
| B.8 | Registro edição: Salvar/Cancelar na toolbar; leitura mantém Novo/Editar/… | **DONE** | `recordToolbar` condicional |
| B.9 | `mg-summary` 4 colunas (Selecionados / Listados / Filtrados / Totais) | **DONE** | UX-41 |
| B.10 | Page-size rodapé `MgSelect` pill (~4.5rem) | **DONE** | UX-42 |

---

## C. Grade (`CadastroBase1Grade` / `Base1Grid`)

| # | Item | Marcas hoje | Evidência / notas |
|---|------|-------------|-------------------|
| C.1 | `referenceHeaders` + menu ⋮ extendido (§11.5) | **DONE** | `TabelaMarcas` |
| C.2 | Filtro por cabeçalho `fpop` + camadas aninhadas (§11.6) | **DONE** | UX-36, UX-42 |
| C.3 | Resize coluna + duplo clique autoajuste + `_autofit` (§11.7) | **DONE** | |
| C.4 | Congelar colunas + sombra âncora (§11.8) | **DONE** | UX-42 prefs |
| C.5 | Prefs normalizadas `storageKey_prefs` + legado (§11.9) | **DONE** | `cadastroBase1ColumnPrefs.js` |
| C.6 | Ordenação numérica coluna **Nº** | **DONE** | UX-42 |
| C.7 | Sem coluna checkbox seleção (produto Marcas) | **DONE** | `colunaSelecao={false}` UX-40 |
| C.8 | Duplo clique / abrir registro | **DONE** | `onOpen` → `handleEdit` |
| C.9 | Diálogo colunas duas listas + rascunho até ✓ (§11.10) | **DONE** | `ConfiguracaoColunasB1Dialog` UX-38 |
| C.10 | `z-index` `fpop` acima da grade (portal) | **DONE** | UX-41 |

---

## D. Cards

| # | Item | Marcas hoje | Evidência / notas |
|---|------|-------------|-------------------|
| D.1 | `Base1Cards` + prefs SSOT (`useCadastroCardsPrefs`) | **DONE** | §11.11 |
| D.2 | Padding card `p-4`, grid `gap-3` | **DONE** | UX-43 vs CDE `cards.tsx` |
| D.3 | Viewport scroll cards `p-2.5` | **DONE** | = CDE `list.tsx` |
| D.4 | Popovers colunas/cards via menu ⚡ | **DONE** | UX-33+ |
| D.5 | `scrollIntoView({ block: "center" })` ao focar card | **DONE** | UX-43 |

---

## E. Formulário de registro

| # | Item | Marcas hoje | Evidência / notas |
|---|------|-------------|-------------------|
| E.1 | Grid `grid-cols-12 gap-3`, classe `b1` | **DONE** | `FormularioMarca` |
| E.2 | Nome / Descrição em `B1Field` + `B1_FIELD_CTL_CLS` (§11.13) | **DONE** | |
| E.3 | Ativo em `B1ChaveRow` + `B1Switch` (não select nativo) | **DONE** | UX-36 |
| E.4 | Modo leitura: campos `readOnly` / `locked` | **DONE** | §11.14 |
| E.5 | `MgSelect` cmd-display em todos os selects do form | **N/A** | Marcas não tem select de domínio no form |

---

## F. Tokens e SSOT visual

| # | Item | Marcas hoje | Evidência / notas |
|---|------|-------------|-------------------|
| F.1 | Tokens `--mg-*` + DM Sans no escopo `.cadastro-b1` (§11.12) | **DONE** | UX-36, D-PROD-39 |
| F.2 | Popovers `cadastro-b1` + `cmd-panel` min-width (§10) | **DONE** | |
| F.3 | Status Ativo Sim/Não com classes `mg-b1-status--*` na grade | **DONE** | `TabelaMarcas` |

---

## G. Itens explicitamente fora do modelo (não bloqueiam sign-off)

| # | Item | Marcas hoje | Evidência / notas |
|---|------|-------------|-------------------|
| G.1 | §11.15 Pesquisa dropdown avançada / favoritos cards | **DEFER** | D-PROD-40 |
| G.2 | §11.16 Anexos nativos (upload, grid 210px, P8) | **P8** | Toolbar placeholder — D-PROD-40 |
| G.3 | `TopNoticeDialog` / `RegistroAnexosDialog` política dismiss (UX-A/B) | **PARTIAL** | Transversal Fase 3; Marcas usa `ConfirmDialog` |
| G.4 | Tenancy `empresa_selecionada_id` / filtro servidor | **PARTIAL** | UI legada Base44; PR segurança separada |
| G.5 | Numeração `max+1` concorrente | **PARTIAL** | `marcaService`; backend P6+ |

---

## H. Gate de sign-off (bloqueia rollout — D-PROD-41)

| # | Item | Marcas hoje | Responsável |
|---|------|-------------|-------------|
| H.1 | Seções **A–F**: todos os itens **DONE** ou **N/A** | **DONE** | Engenharia |
| H.2 | Seção **G**: apenas **DEFER** / **P8** / **PARTIAL** documentados | **DONE** | Este arquivo + DECISIONS |
| H.3 | `npm run verify:all` verde no commit de referência | **TODO** | CI / agente (PR modelo) |
| H.4 | Teste manual §11 + matriz 360 / 390 / 768 / 1280 | **DONE** | UX-43, UX-44 |
| H.5 | Aceite explícito do proprietário (“Marcas modelo OK”) | **TODO** | Produto |
| H.6 | Motor UX-29–43 integrado na `main` (PR #51 + piloto) | **TODO** | Review merge |

**Rollout Fase 2:** **PAUSADO** até H.3, H.5 e H.6 — ver [`PLAN-EXECUCAO-PARIDADE-BASE1.md`](./PLAN-EXECUCAO-PARIDADE-BASE1.md).

---

## I. Réplica futura (1 cadastro = 1 PR)

Ao clonar Marcas em outro cadastro, percorrer **A → H** nesta ordem:

1. Copiar pacote de props de `Marcas.jsx` (seção A).
2. Trocar colunas, storage key, service e formulário.
3. Ajustar `colunaSelecao` / checkbox conforme produto.
4. Abrir PR só da página; `npm run verify:all`; relatório `UX-PARIDADE-<PAGINA>-REPORT.md` opcional.
5. **Não iniciar** até gate H completo (**D-PROD-41**).

---

## Resumo quantitativo (Marcas, 2026-10-26)

| Status | Contagem (itens A–G) |
|--------|----------------------|
| **DONE** | 42 |
| **N/A** | 1 |
| **DEFER** | 1 |
| **P8** | 1 |
| **PARTIAL** | 3 |
| **TODO** (só gate H processo) | 3 |

**Caminho crítico técnico (A–F):** 42/43 itens **DONE** ou **N/A** → **~98%** do checklist aplicável.  
**Sign-off completo (incl. H):** aguarda merge na `main` + aceite H.5.
