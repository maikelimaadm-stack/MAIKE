# UX mobile piloto Marcas — relatório de execução

**Branch:** `cursor/ux-base1-mobile-marcas-516d`  
**Escopo:** toolbar mobile/tablet Marcas, dismiss filtro de data, diálogos layout/campos dos cards (flash popover).

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
- `npm run verify:all` — gate completo

## Viewports

Checklist manual: ver `MARCAS-H5-MANUAL-TEST.md`. Browser E2E/screenshots: **não testado** neste ambiente.

## Status

**APROVÁVEL PARA HOMOLOGAÇÃO VISUAL** (pendente validação do proprietário em dispositivo real).
