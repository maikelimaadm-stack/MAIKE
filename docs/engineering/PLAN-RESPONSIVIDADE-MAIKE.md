# Plano — Responsividade MAIKE (Base1 / Marcas)

**Missão:** UX-54 — adaptação viewport sem redesign (cores, fontes, botões, bordas, sombras e identidade Base1 intactas).

**Referência:** skill `resposividade` (mobile-first, sem overflow horizontal).  
**Breakpoints já adotados no projeto:** `768px` (min-width em padding/form), `1023px` e `639px` (max-width toolbar join — UX-43).

## Step 0 — Convenções extraídas

| Área | Fonte | Convenção |
|------|-------|-----------|
| Estilo | `cadastro-base1.css`, `cadastro-b1-portal.css`, `cadastro-b1-controls.css` | CSS escopado `.cadastro-b1`; Tailwind só em JSX (grid `col-span-12` + `md:col-span-*` em `B1Field`) |
| Breakpoints | UX-43 + `cadastro-base1.css` | `639px`, `768px`, `1023px` — **não inventar novos** |
| Tokens | `--mg-*` em `.cadastro-b1` | Não alterar valores nesta missão |
| Shell lista | `CadastroWorkspace` `pageLayout="base1-list"` | `.cadastro-b1--full-page` |
| Chrome | `CadastroListaChrome` | `joinTableToolbar` + `portalComprasSkin` (Marcas) |
| Formulário | `mg-b1-form-grid` + `B1Field` | 1 coluna &lt;768px (`col-span-12`) |

## Matriz de auditoria (causas)

| Viewport | Problema | Causa provável | Prioridade |
|----------|----------|----------------|------------|
| 320–414 | Summary 4 colunas apertadas | `mg-summary__counts` `repeat(4, …)` sem reflow em mobile | **P0** |
| 320–414 | Scroll horizontal da página | Cadeia flex sem `min-w-0`; grade larga vaza do shell | **P0** |
| 375–1023 | Grade empurra layout | `overflow-x` na `.mg-grid-wrap` só ≤639px (UX-43 parcial) | **P0** |
| 320–390 | Popover/menu corta na borda | `w-72` / `min-w-[220px]` sem `max-width` viewport | **P0** |
| 639 | Busca não usa largura útil | `.mg-search-pill-wrap` fixo 220px na linha quebrada da toolbar | **P1** |
| 639 | Toolbar direita não empilha busca | `.ml-auto` flex row com muitos controles | **P1** |
| 768–1023 | Summary contadores 4 col estreitas | Mesma grade 4 col em tablet portrait | **P1** |
| 320–639 | Ícones portal 25px (CDE) | Paridade visual — toque primário já 44px em Novo/Excluir (UX-43); ícones = **P2** (hit area sem mudar skin) |
| 1280+ | — | Comportamento estável pós UX-43 | — |

## Arquivos a tocar (implementação)

| Arquivo | Mudança |
|---------|---------|
| `src/styles/cadastro-base1.css` | Summary 2×2 ≤1023px; stack summary ≤639px (existente); grid `overflow-x` ≤1023px; busca/toolbar mobile; `min-w-0` full-page |
| `src/styles/cadastro-b1-controls.css` | `max-width: min(calc(100vw - 16px), …)` em vidro/cmd-panel |
| `src/components/cadastro/CadastroWorkspace.jsx` | `min-w-0` na raiz `base1-list` |
| `src/components/cadastro/base1/CadastroListaChrome.jsx` | `min-w-0` na cadeia flex do chrome |
| `docs/engineering/UX-FROTA-PILOT-MARCAS-REPORT.md` | Seção **UX-54** |
| `docs/engineering/PLAN-RESPONSIVIDADE-MAIKE.md` | Este documento |

**Fora de escopo:** lógica de negócio, tokens `--mg-*`, skin portal 25px, Mapa Geral, rollout outros cadastros (replicar CSS depois).

## Verificação

### Automatizada

```bash
npm run verify:all
```

(`test:backend` exige `DATABASE_URL` local; gates + build são o alvo desta missão.)

### Manual — matriz (Marcas `/Marcas`)

| Largura | Checklist |
|---------|-----------|
| 320 | Sem scroll horizontal na página; summary 2×2; grade rola dentro do cartão |
| 375 / 390 / 414 | Toolbar join quebra; busca largura total na linha inferior; popover “Mais opções” não ultrapassa viewport |
| 768 | Summary 2×2; grade scroll horizontal no wrap |
| 1024 / 1280 / 1440 / 1920 | Layout desktop inalterado visualmente |
| Registro (editar marca) | Campos empilhados &lt;768px; sem clip no formulário |

*Não há `scripts/check-overflow.js` no repositório; usar DevTools device mode ou redimensionar janela.*

## Prioridades não implementadas nesta PR (P2)

- Área de toque 44px em ícones portal 25px (pseudo-elemento / gap) sem quebrar `cadastro-b1-portal.css`
- Responsividade global do `Layout.jsx` (menu/search) — fora do piloto Base1
- Demais cadastros além de Marcas (herdam CSS compartilhado automaticamente)
