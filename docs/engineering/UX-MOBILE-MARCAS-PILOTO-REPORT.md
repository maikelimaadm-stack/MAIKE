# UX mobile piloto Marcas — relatório de execução

**Branch (PR único):** `cursor/ux-base1-marcas-mobile-unica-516d`  
**Substitui:** `cursor/ux-base1-mobile-marcas-516d` (PR #67 — fechada em favor desta branch)  
**Escopo:** toolbar mobile/tablet Marcas, dismiss filtro de data, diálogos layout/campos dos cards (flash popover).

## Commits vs `main` (2026-10-27)

| Commit | Resumo |
|--------|--------|
| `f7ead267` → cherry-pick | Toolbar 3 linhas, filtro data/camada, `ConfiguracaoCardsB1Dialogs`, `MoreVertical`, teste camada |
| `488df0fe` → cherry-pick | JSDoc `MenuList` (`className`, `title`) |
| `c6002243` → cherry-pick | Skin mobile única ≤1023px em `cadastro-b1-portal.css`; diálogos cards paridade colunas; limpeza CSS duplicado |

**Incluído vs `main`:** correções UX mobile piloto Marcas (toolbar, busca, view-seg, safe-area/tablet, Editar/Cancelar/Excluir coerentes ou no menu ⋮, modais cards alinhados a colunas). **Não incluído:** merge em `main` (homologação manual do proprietário).

## Defeitos confirmados e correções

| ID | Causa | Correção |
|----|--------|----------|
| A | Mobile só ampliava `tb-btn-green`/`red` | `cadastro-base1.css`: todos `.tb-btn` da toolbar portal + ícones 44px + `view-seg` |
| B | `FilterX` em linha própria (toolbar antiga) | Toolbar em 3 linhas (`mg-toolbar__row--*`), limpar só no menu ⋮ |
| C | `attachDisabledReason` sem `onAttach` exibia clipe | `showAttachControl = Boolean(onAttach)`; aviso no menu ⋮ |
| D | Ordem dos controles | Busca linha dedicada; visualização/filtros na terceira linha |
| E | `view-seg` / `IconBtn` ~21–25px | Alvos 44px no mobile (piloto full-page) |
| F | Raio como “Mais opções” | `MoreVertical` em `CadastroListaChrome` |
| G | `.b1-dp-filtro` no seletor de camada | Removido; só `.mg-dp-panel[data-state='open']` |
| Cards flash | Popovers layout/campos | `ConfiguracaoCardsB1Dialogs.jsx` (padrão `ConfiguracaoColunasB1Dialog`) |

## Testes

- `npm run test:smoke` — `cadastroColunaFiltroCamada.test.js` (calendário fechado/aberto)
- `npm run verify:all` — gates + smoke + build OK; `test:backend` exige `DATABASE_URL` + Postgres (CI/local)

## Viewports

Checklist manual: ver `MARCAS-H5-MANUAL-TEST.md`. Browser E2E/screenshots: **não testado** neste ambiente.

## Correção UX-67 (2026-10-27) — skin mobile única, sem mistura desktop

**Problema:** a skin Portal (botões 25px, tons acinzentados) continuava vencendo no mobile porque `cadastro-b1-portal.css` carrega depois de `cadastro-base1.css`; regras parciais de toque só em `≤639px` deixavam tablet e alguns pílulas (Editar/Cancelar cinza) menores que Novo/Salvar. Diálogos de cards ainda divergiam do modal de colunas (footer com `PillBtn`, largura inline).

| Área | O que estava misturado | Correção |
|------|------------------------|----------|
| Toolbar ≤1023px | 25px portal + 44px parcial | Bloco único em `cadastro-b1-portal.css`: `--mg-btn-h: 44px`, pílulas verde/cinza/vermelho Base1, ícones e `view-seg` 44px, busca e paginação |
| Layout toolbar | `display:contents` desde 640px | Linhas ações / busca / visualização até **1023px**; flat só ≥1024px |
| Diálogos cards | Shell 440px + Restaurar no rodapé | Paridade `ConfiguracaoColunasB1Dialog`: `.mdlc` SSOT, ↺ no cabeçalho, rodapé só ✓, largura `calc(100vw - 16px)` no mobile |
| CSS duplicado | UX-54/55/56 + bloco 639 | Removidos overrides de toque duplicados em `cadastro-base1.css`; grade 2×2 permanece no bloco ≤1023px (UX-54) |

### Checklist manual — 375px (portrait)

- [ ] Três linhas: **Novo** + ⋮ → busca largura total → **Registro | Tabela | Cards** + ícones alinhados
- [ ] **Novo**, **Salvar**, **Cancelar** (modo registro) com mesma altura (~44px); verde/cinza/vermelho coerentes com Base1
- [ ] **Editar / Duplicar / Excluir** só no menu ⋮ (não pílulas quebradas na toolbar)
- [ ] Modal **Layout dos cards** e **Campos dos cards** centrados, margem lateral, mesmo chrome que **Colunas da tabela**
- [ ] Grade com scroll horizontal interno; página sem scroll lateral
- [ ] Summary 2×2 + seletor de página sem sobrepor bottom nav (safe area)

## PR

- **Abrir (compare):** https://github.com/maikelimaadm-stack/MAIKE/compare/main...cursor/ux-base1-marcas-mobile-unica-516d
- **Fechar duplicata:** PR #67 (`cursor/ux-base1-mobile-marcas-516d`) após o PR acima estar aberto — mesmo conteúdo, branch consolidada.

## Status

**APROVÁVEL PARA HOMOLOGAÇÃO VISUAL** (pendente validação do proprietário em dispositivo real — checklist 375px acima).
