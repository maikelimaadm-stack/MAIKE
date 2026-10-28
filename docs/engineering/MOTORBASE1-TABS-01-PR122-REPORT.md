# MOTORBASE1-TABS-01 — PR #122 — Abas Base1 + Ativo compacto (Lotes)

## Baseline

| Item | Valor |
|---|---|
| Base | `origin/main` pós-merge PR #121 (`f3c85ceb`) |
| Branch | `cursor/motorbase1-tabs-lotes-ativo-516d` |
| CI main | run `40751394762` SUCCESS |
| PR abertas no preflight | nenhuma |

## Referência (somente leitura)

Repositório `maikelimaadm-stack/CONTROLE-DE-ESTOQUE`, commit `6aef845e`.

| Arquivo | Trecho / uso |
|---|---|
| `apps/web/src/features/resources/resource-form.tsx` | `PanelTabs` (~312–328): abas horizontais + sidebar, painéis montados, toggle `PanelLeft`/`LayoutGrid` |
| `apps/web/src/app/globals.css` | `.mg-panel-tabs-rail`, `.seg-tab.active::after` (sublinhado 2px preto), `.mg-tabs`, `.mg-panel-sidebar-layout`, `.mg-panel-list__tab`, `.mg-motion-panel--animate` (~231–259) |
| `packages/domain/src/resources/registries.ts` | Entidade `equipments` — seções renderizadas via `PanelTabs` |

**Não** usado: `FichaEmAbas`, abas globais do Workspace.

## Inventário — abas internas de formulário no MAIKE

| Tela | Abas internas legadas | Base1PanelTabs nesta PR |
|---|---|---|
| Cadastro de Lotes | `LegacyTabs` (Geral/Motivo/…) | **Sim** (visual Base1) |
| Marcas, Unidades, Setores, Produtos, … | Formulário single-panel / campos diretos | Não (sem abas compatíveis) |
| Parceiros / fichas Base44 | `LegacyTabs` ou layouts legados | Fora de escopo MotorBase1 |

Componente `Base1PanelTabs` fica disponível em `src/components/cadastro/base1/` para futuros cadastros multi-painel.

## Mudanças por arquivo

| Arquivo | Mudança |
|---|---|
| `src/components/cadastro/base1/Base1PanelTabs.jsx` | **Novo** — abas horizontais/lateral, ARIA, teclado, preferência `tabs\|sidebar`, painéis montados |
| `src/styles/cadastro-base1.css` | Tokens `.b1-panel-*` (paridade visual Novo Equipamento) |
| `src/components/lotes/FormularioLote.jsx` | Base1 → `Base1PanelTabs`; legado → `LegacyTabs`; `status` via conversores string |
| `src/components/dynamic/DynamicFormRenderer.jsx` | Switch Base1 → `B1ChaveRow` genérico (`switchGetChecked` / `switchToValue`) |
| `src/components/cadastro/base1/B1ChaveRow.jsx` | Prop `dataField` |
| `tests/smoke/base1PanelTabs.test.jsx` | **Novo** |
| `tests/smoke/formularioLoteBase1Tabs.test.jsx` | **Novo** |

Preferência de layout de abas Lotes: `localStorage.motorbase1_lotes_panel_style` — **isolada** de `cadastro_lotes_form_layout_config`.

## Testes executados

```bash
npm run test:smoke -- tests/smoke/base1PanelTabs.test.jsx tests/smoke/formularioLoteBase1Tabs.test.jsx
# 9 passed
```

`npm run verify:all` (agente, 99.3s): **31/32 etapas PASS**; `test:backend` **FAIL** local (sem `DATABASE_URL` — comportamento esperado AGENTS.md). Gates relevantes: `product-scope`, `motorbase1-independence`, `lote-native`, `source-closure`, `tenancy`, `no-secrets`, `test:smoke`, `build` — PASS.

## Homologação visual

**PENDING VISUAL** — breakpoints 360/390/768/1024/1280+, abas horizontal/sidebar, Ativo on/off/readonly: não executado neste ambiente (sem browser dedicado).

## Riscos / diferenças inevitáveis

- Classes CSS escopadas `.cadastro-b1 .b1-panel-*` em vez de `.mg-panel-tabs-rail` / `.seg-tab` globais (evita colisão com outras telas).
- Lotes monta um `DynamicFormRenderer` por painel (estado preservado); custo de render maior que aba única trocando `activePanelId`.
- Quatro painéis vazios customizados no layout continuam respeitando regras existentes de ocultação.

## Critérios GO

| Critério | Status |
|---|---|
| Origem PanelTabs (Novo Equipamento) | OK |
| Visual abas (sublinhado inferior, sem traço verde superior) | OK (CSS + componente) |
| Ativo compacto (`data-chave-row`, sem `mg-field--switch`) | OK |
| `status` string Ativo/Inativo | OK |
| Sem perda de valor ao trocar aba (painéis montados) | OK (teste DOM) |
| Regressões gates / CI | pendente `verify:all` |
