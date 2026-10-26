# Plano — Paridade Portal de Compras × Base1 (Marcas piloto)

**Missão:** UX-39 · Branch `cursor/ux-base1-cards-colunas-878d` (PR #51)  
**SSOT:** [`PROMPT-MODELO-VISUAL-AGRO-ERP.md`](./PROMPT-MODELO-VISUAL-AGRO-ERP.md) · Decisão **D-PROD-39**  
**Referência:** clone `CONTROLE-DE-ESTOQUE` → `/tmp/controle-de-estoque`  
**Piloto MAIKE:** `src/pages/Marcas.jsx` + motor `src/components/cadastro/base1/`

---

## Overview

Replicar no piloto **Marcas** (modo `joinTableToolbar` + `referenceHeaders`) a mesma experiência de tabela, cabeçalhos, filtros `fpop`, menus ⋮, resize/congelar, popovers e régua de botões do **Portal de Compras** do Agro ERP — sem copiar domínio de compras, APIs ou rotas fora do escopo Mapa + Manejo.

Abordagem: diff profundo CDE × MAIKE, correções no motor compartilhado Base1 e CSS SSOT (`cadastro-base1.css`, `cadastro-b1ref.css`, `cadastro-b1-controls.css`, novo `cadastro-b1-portal.css`), validação em Marcas e `npm run verify:all`.

---

## Specification link

| Documento | Uso |
|-----------|-----|
| `PROMPT-MODELO-VISUAL-AGRO-ERP.md` | Checklist 11.x, mapeamento de arquivos |
| `UX-FROTA-PILOT-MARCAS-REPORT.md` | Fatias UX-35…UX-39 |
| `PLAN-EXECUCAO-PARIDADE-BASE1.md` | Rollout cadastros + fases 0–4 |
| CDE `docs/UI-STANDARD.md`, `docs/PERSONALIZACAO.md` | Comportamento de prefs e grade |

---

## Mapeamento CDE → MAIKE

| Área Portal Compras (CDE) | MAIKE |
|---------------------------|--------|
| `features/compras/documentos-compra-list.tsx` + `portal-compras.module.css` | `CadastroListaChrome` (`joinTableToolbar`) + `cadastro-b1-portal.css` |
| `features/base1/list.tsx` (`barraIntegrada`, `referenceHeaders`) | `CadastroListaChrome` + `CadastroBase1Grade` |
| `features/base1/grid.tsx` | `Base1Grid.jsx` |
| `features/compras/filtro-de-coluna.tsx` | `CadastroColunaFiltro.jsx` + `SeletorDeOperador.jsx` |
| `components/ui/seletor-de-operador.tsx` | `SeletorDeOperador.jsx` (Radix Select + `.foperadores`) |
| `features/compras/colunas-dos-itens.tsx` | `ConfiguracaoColunasB1Dialog.jsx` |
| `app/b1ref.css` | `cadastro-b1ref.css` |
| `app/globals.css` (`.mg-grid`, decisão 349) | `cadastro-base1.css` |

---

## Fases

### Fase 1 — Auditoria (Part B)

- [x] Clone CDE em `/tmp/controle-de-estoque`
- [x] Diff: `grid.tsx`, `filtro-de-coluna.tsx`, `portal-compras.module.css`, `b1ref.css`, `globals.css` (grade)
- [x] Lacunas registradas em UX-39 (skin portal, operador Radix, borda última coluna, `foperadores` 359)

### Fase 2 — Motor filtro e operador (Part C)

- [x] `SeletorDeOperador.jsx` (paridade Radix + `data-filtro-camada`)
- [x] `CadastroColunaFiltro.jsx`: trocar `<select>` nativo; classe `b1-portal-compras` no `fpop` quando skin ativa
- [x] `cadastro-b1ref.css`: `.foperadores` `width: max-content; min-width: var(--radix-select-trigger-width)`

### Fase 3 — Skin Portal Compras (Part C)

- [x] `cadastro-b1-portal.css` (escopo `.cadastro-b1--portal-compras` + global `.b1-portal-compras`)
- [x] `CadastroListaChrome`: prop `portalComprasSkin`; classe no shell join; provider de contexto
- [x] `Base1Grid` / `ConfiguracaoColunasB1Dialog`: marcador portal em popovers portados
- [x] `Marcas.jsx`: `portalComprasSkin` com `joinTableToolbar`

### Fase 4 — Grade e cabeçalho (Part C)

- [x] Remover `border-right: 0` na última coluna (decisão 349 CDE)
- [x] `.th-menu` / resize handle alinhados ao portal (hover `#0f172a`, alça 6px)

### Fase 5 — Verificação e entrega (Part D)

- [x] `npm run verify:all` (18/19 — `test:backend` exige PostgreSQL local; indisponível neste ambiente)
- [x] Seção **UX-39** em `UX-FROTA-PILOT-MARCAS-REPORT.md`
- [ ] Commit, push, atualizar corpo do PR #51 (preservar edições humanas)

---

## Dependencies

- PR #50 mergeado na linha da branch (vidro/calendário/switch)
- `@radix-ui/react-select` já no `package.json`
- Piloto Marcas com `referenceHeaders`, `joinTableToolbar`, `showFilterRail={false}`

---

## Risks

| Risco | Mitigação |
|-------|-----------|
| CSS portal conflita com outros cadastros | Skin só com `portalComprasSkin={true}`; escopo duplo (shell + `b1-portal-compras` no body) |
| Select Radix + dismiss do filtro (357–360) | `data-filtro-camada`, `deveFecharFiltroPorFora` já em `cadastroColunaFiltroCamada.js` |
| Prop drilling | Contexto leve `PortalComprasSkinContext` |
| Regressão gates | `verify:all` obrigatório antes do push |

---

## Acceptance criteria

1. Marcas em modo tabela: toolbar join, grade, rodapé e botões com régua visual do Portal Compras (25px, sombra verde, `th-menu` sem círculo).
2. ⋮ → filtro: painel `fpop` com **SeletorDeOperador** estilo CDE; Enter aplica; camadas aninhadas não fecham o shell no primeiro clique fora.
3. Resize (arraste + duplo clique), congelar, autoajustar, ocultar coluna — comportamento igual ao `grid.tsx` da referência.
4. Última coluna da grade mantém borda direita (paridade decisão 349).
5. Configurar colunas (⚡): diálogo `mdl` com skin portal nos botões do rodapé.
6. `npm run verify:all` verde.
7. Plano persistido neste arquivo; relatório UX-39 com passos de teste manual.

---

## Technical approach

Incremental no motor Base1 existente — sem novo framework. Portal skin como camada CSS + contexto booleano, espelhando `barraIntegrada` + `b1-portal-compras` do CDE. Operador de filtro portado como componente isolado reutilizável em futuros cadastros com `referenceHeaders`.
