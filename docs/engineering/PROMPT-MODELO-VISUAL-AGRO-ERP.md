# PROMPT — Replicar modelo visual/UX Agro ERP (MODELO BASE1)

**Origem:** prompt de paridade visual entre **CONTROLE-DE-ESTOQUE** (Agro ERP) e **MAIKE** (cadastros Mapa + Manejo).  
**Piloto de validação:** página **Marcas** (`src/pages/Marcas.jsx`).  
**Escopo:** listagem/registro estilo Frota/Equipamentos e portal de compras (grade `referenceHeaders`), **não** Mapa Geral nem manejo no mapa.

---

## 1. Objetivo

Reproduzir no MAIKE a **anatomia, tokens, comportamento e controles** do MODELO BASE1 do Agro ERP, usando o repositório de referência apenas como espelho de UX — sem copiar runtime low-code, marketplace ou motores fora do escopo (D-PROD-03, D-PROD-21).

Entrega incremental: um motor compartilhado em `src/components/cadastro/base1/` + CSS em `src/styles/cadastro-base1.css`, `cadastro-b1-controls.css`, `cadastro-b1ref.css`, validado primeiro em **Marcas**, depois propagado aos demais cadastros do manifesto.

---

## 2. Referência canônica (clone)

| Área | Caminhos CONTROLE-DE-ESTOQUE |
|------|------------------------------|
| Tokens + grade | `apps/web/src/app/globals.css` (`--mg-*`, `.mg-grid`, `.tb-btn`) |
| Motor listagem | `apps/web/src/features/base1/list.tsx`, `grid.tsx` |
| Filtro cabeçalho (`fpop`) | `apps/web/src/features/compras/filtro-de-coluna.tsx`, `apps/web/src/app/b1ref.css` |
| Portal compras (join toolbar) | `apps/web/src/features/compras/documentos-compra-list.tsx`, `itens-da-nota.tsx`, `portal-compras.module.css` |
| Colunas (duas listas) | `apps/web/src/features/compras/colunas-dos-itens.tsx` |
| Controles formulário | `apps/web/src/components/ui/mg-controls.tsx`, `features/central/campo.tsx` |
| Personalização (contrato) | `docs/PERSONALIZACAO.md`, `packages/shared/src/preferences.ts` |
| Padrão UI | `docs/UI-STANDARD.md` |

Clone local sugerido: `/tmp/controle-de-estoque`.

---

## 3. Superfície MAIKE (equivalentes)

| Referência | MAIKE |
|------------|--------|
| `Base1List` / `ResourceList` | `CadastroListaChrome.jsx` + `CadastroWorkspace.jsx` (`pageLayout="base1-list"`) |
| `Base1Grid` | `Base1Grid.jsx` via `CadastroBase1Grade.jsx` |
| `FiltroDeColuna` | `CadastroColunaFiltro.jsx` + `cadastroColunaFiltroLogic.js` |
| `ColunasDosItens` | `ConfiguracaoColunasB1Dialog.jsx` |
| `MgSelect` / `CmdPanel` | `MgSelect.jsx` |
| `mg-field` / `ChaveSimNao` | `B1Field.jsx`, `B1ChaveRow.jsx`, `B1Switch.jsx` |
| Cards | `Base1Cards.jsx`, `Base1CardsToolbar.jsx`, `useCadastroCardsPrefs` |
| Preferências coluna (local) | `src/lib/cadastroBase1ColumnPrefs.js` (espelho de `normalizeListPreferences` colunas) |
| Piloto | `src/pages/Marcas.jsx`, `TabelaMarcas.jsx`, `FormularioMarca.jsx` |

---

## 4. Tokens e tipografia

- Escopo `.cadastro-b1`: variáveis `--mg-accent`, `--mg-text-*`, `--mg-gray-fill`, `--mg-field-h`, `--mg-btn-h`, sombras de cartão, seleção de linha, etc. — paridade com `:root` / `.cadastro-b1` do `globals.css` da referência.
- Fonte: **DM Sans** (referência: `@fontsource-variable/dm-sans`); no MAIKE: carga via `index.html` + `font-family` em `src/index.css`.
- Não inventar paleta paralela; ajustes só dentro dos arquivos SSOT listados acima.

---

## 5. Toolbar e chrome de listagem

- Esquerda: **Novo**, **Editar**, **Duplicar**, **Excluir**, **Anexos** (quando aplicável), `extraToolbar`.
- Direita: busca em pílula, alternador **Registro / Tabela / Cards**, **Mais opções** (menu **vertical**, decisão 353 — não radial).
- Modo **join** (portal compras): `joinTableToolbar` — toolbar fundida ao cartão da grade (`mg-toolbar--join`).
- **Marcas (piloto):** `showFilterRail={false}` — sem faixa `mg-pills-rail` de chips; portal compras mantém rail.

---

## 6. Grade (`mg-grid`)

- Coluna de seleção circular (`MgCheck`), cabeçalho 30px / linha 26px, zebrado, hover, menu ⋮ por coluna.
- **referenceHeaders:** filtro `fpop` Excel, congelar até coluna N, autoajustar, ocultar, resize com alça e duplo clique.
- Persistência: larguras, ordem, visíveis, `frozen`, `autoFit` — normalizar como na referência (decisões 355–356); chave unificada `{storageKey}_prefs` + chaves legadas para migração.
- Rodapé: `Selecionados · Listados · Filtrados · Totais`, page size pill (`MgSelect`), carregar mais.

---

## 7. Filtro de coluna (`fpop`)

- Painel ancorado ao `<th>`, sem overlay escuro de página inteira (UX-35).
- Form com Enter = aplicar; rodapé ícones X / ✓; reposiciona em scroll/resize.
- **Camadas aninhadas (357–360):** clique fora não fecha se o alvo estiver em popover Radix, `cmd-panel`, calendário (`b1-dp-filtro`) ou vidro Base1 — função `camadaAninhadaAberta` / `deveFecharPorFora`.

---

## 8. Modo registro

- `recordMode` no chrome: `CadastroRecordHeader` (bookmark + navegação), corpo `mg-form-scroll`.
- **`recordEditing`:** `true` = toolbar Salvar/Cancelar (`recordToolbar`); `false` = leitura com toolbar de lista (Novo/Editar/…) — paridade frota (UX-37).
- Formulário: grade 12 colunas, campos texto em **`B1Field` / `mg-field`**; boolean **Ativo** em **`B1ChaveRow` + `B1Switch`** (não `mg-field` flutuante no piloto Marcas).

---

## 9. Modo cards

- `Base1Cards` + prefs locais; popovers de layout e campos com `CheckRow`/`RadioRow` e rodapé Restaurar/OK.
- Configuração de colunas/cards no menu **Mais opções** quando a faixa de filtros está desligada (Marcas).

---

## 10. Popovers e `MgSelect`

- Painéis portados com classe `cadastro-b1` + `cmd-panel`; opções em **coluna** (`flex-direction: column`).
- **Largura mínima (359):** `min-width: max(220px, var(--radix-popover-trigger-width))` no painel cmd.

---

## 11. Checklist de paridade (auditoria)

| # | Item | Marcas / Base1 |
|---|------|----------------|
| 11.1 | Shell `base1-list` sem header duplicado | Feito |
| 11.2 | Toolbar join + um cartão branco | Feito |
| 11.3 | Busca pílula + alternador + Mais opções vertical | Feito |
| 11.4 | Faixa chips (`mg-pills-rail`) | N/A Marcas (`showFilterRail={false}`); OK portal compras |
| 11.5 | Grade `referenceHeaders` + menu ⋮ extendido | Feito |
| 11.6 | `fpop` + camadas aninhadas | Feito (UX-36 reforço Radix popover) |
| 11.7 | Resize / duplo clique / autoajuste + `_autofit` | Feito |
| 11.8 | Congelar + sombra âncora | Feito |
| 11.9 | Prefs coluna normalizadas (`_prefs` + legado) | Feito (UX-36) |
| 11.10 | Diálogo colunas duas listas | Feito |
| 11.11 | Cards + popovers SSOT | Feito |
| 11.12 | Tokens `--mg-*` + DM Sans | Feito (UX-36) |
| 11.13 | Form Nome/Descrição `mg-field`; Ativo `B1ChaveRow` | Feito |
| 11.14 | Modo registro view vs edit (frota) | Feito (UX-37) |
| 11.15 | Pesquisa dropdown avançada / favoritos | Fora de escopo |
| 11.16 | Anexos nativos | Pendente (P8) |

---

## 12. Verificação

```bash
npm run verify:all
```

Relatório de missão: `docs/engineering/UX-FROTA-PILOT-MARCAS-REPORT.md` (seções UX-*).

---

## 13. Governança

- Decisão de produto: **D-PROD-39** — SSOT deste prompt + `globals.css` da referência para tokens/comportamento Base1.
- Não duplicar design system fora de `cadastro/base1` e `src/styles/cadastro-*.css`.
- Uma missão = um PR; piloto modelo: **Marcas** (`cursor/ux-base1-marcas-modelo-516d`); motor compartilhado: PR #51 (`cursor/ux-base1-cards-colunas-878d`). Rollout outros cadastros: **D-PROD-41** (pausado).

---

## Apêndice — Mapeamento rápido MAIKE

| Artefato MAIKE | Função |
|----------------|--------|
| `src/components/cadastro/base1/*` | Motor UI Base1 compartilhado |
| `src/styles/cadastro-base1.css` | Tokens e superfícies `.cadastro-b1` |
| `src/styles/cadastro-b1-controls.css` | cmd-panel, calendário, switch, vidro |
| `src/styles/cadastro-b1ref.css` | `fpop`, `.mdl`, utilitários ref |
| `src/pages/Marcas.jsx` | Piloto integrado |
| `src/lib/cadastroBase1ColumnPrefs.js` | Normalização `localStorage` colunas |
| `docs/engineering/UX-FROTA-PILOT-MARCAS-REPORT.md` | Histórico de fatias UX |
