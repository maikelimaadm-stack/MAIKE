# MOTORBASE1-GLOBAL-SELECT-TITLE-01 — Relatório

## Baseline e entrega

| Campo | Valor |
|---|---|
| Baseline `main` (preflight) | `f740d1beadadf3d73568f844655c2529c5fd69f6` |
| Branch | `cursor/motorbase1-global-select-title-01-516d` |
| PR | **PENDENTE** — token do agente não pode abrir PR; branch pushed; abrir DRAFT manualmente |
| HEAD | `3e7dcfcc` |

## Decisão de produto

Instrução explícita do proprietário revoga a exceção UX-40 (Marcas/Setores/Unidades/Locais/Categorias produto sem checkbox). PR #120 centraliza `colunaSelecao: true` e `selecaoSticky: true` em `BASE1_GRADE_REFERENCE_HEADERS` e exibe `workspaceTitle` no shell `CadastroWorkspace` (`pageLayout='base1-list'`).

## Inventário cadastros Base1

| Cadastro | Checkbox antes | Checkbox depois | Título antes | Título depois |
|---|---|---|---|---|
| Marcas | oculto (override) | visível (preset) | sr-only | h1 visível |
| Setores / fazendas | oculto | visível | sr-only | h1 visível |
| Unidades de medida | oculto | visível | sr-only | h1 visível |
| Locais de estoque | oculto | visível | sr-only | h1 visível |
| Categorias de produtos | oculto | visível | sr-only | h1 visível |
| Produtos | já ativo | mantido | sr-only | h1 visível |
| Grupos de atividades | já ativo | mantido | sr-only | h1 visível |
| Tipos de tarefa | já ativo | mantido | sr-only | h1 visível |
| Categorias de manejo | já ativo | mantido | sr-only | h1 visível |
| CadastroLotes / Empresa / Usuários / Bebedouros | layout `default` ou grade própria | sem mudança de política nesta PR | header legado | inalterado |

## Arquivos alterados (principais)

- `src/components/cadastro/base1/base1VisualPreset.js` — SSOT seleção
- Cinco adapters `Tabela*.jsx` (marcas, setores, unidades, locais, categorias produto)
- `CadastroBase1Grade.jsx` — `onToggleAll` usa janela visível
- `Base1Cards.jsx` — `MgCheck` sempre visível
- `CadastroWorkspace.jsx` + `cadastro-base1.css` — título de página
- `tests/smoke/motorbase1GlobalSelectionTitle.test.jsx`
- Docs: matriz, checklist Marcas, plano paridade

## Testes

```bash
npm run test:smoke -- tests/smoke/motorbase1GlobalSelectionTitle.test.jsx  # 12 passed
npm run verify:all  # local: falhou só test:backend (DATABASE_URL — sem Docker neste pod); demais etapas PASS incl. build
```

Regressões preservadas: `cadastroGradeSelectionStability`, `categoriasHierarchyFix`, `motorbase1Batch01`, demais smokes na suíte `verify:all`.

## Visual

Breakpoints 360/390/768/1024/1280: **PENDING VISUAL** (sem homologação manual autenticada neste ambiente).

## Riscos residuais

- Altura útil da grade reduzida pela faixa de título (~24–32px); monitorar mobile 360px.
- Seleção parcial com paginação keyset: política “todos” limitada à janela filtrada/listada permanece responsabilidade do adapter/controller.

## Status

**GO TÉCNICO** (gates locais + CI da PR). Visual **PENDING**.
