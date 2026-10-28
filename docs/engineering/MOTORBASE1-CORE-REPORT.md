# MotorBase1-CORE — relatório de missão

**Branch:** `cursor/motorbase1-core-independente-516d`  
**Base:** `origin/main` @ `8316bee8` (pós merge PR #109)  
**Data:** 2026-10-28

## Objetivo

Tornar o Motor Base1 SSOT visual independente de Marcas/Mapa, preservando o visual aprovado de Marcas.

## Mapa de dependências ANTES → DEPOIS

| De | Para | Antes | Depois |
|---|---|---|---|
| `CadastroBase1Grade.jsx` | `@/components/mapa/ConfiguracaoColunasMapaDialog` | import direto (legado `referenceHeaders=false`) | `@/components/cadastro/base1/ConfiguracaoColunasLegacyDialog` |
| `ConfiguracaoColunasMapaDialog.jsx` | implementação | JSX no Mapa | reexport do LegacyDialog |
| `Marcas.jsx` / `TabelaMarcas.jsx` | flags visuais inline | props literais | `BASE1_MARCAS_MODEL_VISUAL` (`base1VisualPreset.js`) |
| Consumidores Mapa (`TabelaAreasGeo`, etc.) | `ConfiguracaoColunasMapaDialog` | inalterado | reexport compatível |

Grafo alvo preservado: **Página/adapter → Motor Base1 → ui/common/lib** (gate `P55-MOTORBASE1-DOMAIN-IMPORT`).

## Arquivos tocados

- `src/components/cadastro/base1/base1VisualPreset.js` (novo SSOT)
- `src/components/cadastro/base1/ConfiguracaoColunasLegacyDialog.jsx` (extraído)
- `src/components/mapa/ConfiguracaoColunasMapaDialog.jsx` (reexport)
- `src/components/cadastro/base1/CadastroBase1Grade.jsx`
- `src/pages/Marcas.jsx`, `src/components/marcas/TabelaMarcas.jsx`
- `scripts/gates/gate-motorbase1-independence.mjs`, `scripts/gates/lib/motorbase1-independence.mjs`
- `scripts/tests/gates/motorbase1-independence.test.mjs`
- `tests/smoke/motorBase1FictitiousEntity.test.jsx`
- `package.json`, `scripts/gates/verify-all.mjs`, `docs/engineering/*`

## Intacto (escopo negativo)

- `colunas_marcas_v1`, `droppableId="colunas-marcas"`, query keys Marcas, backend, migrations, Prisma, Vercel config.
- Defaults globais de `CadastroListaChrome` (outras telas).
- CSS Base1 (`cadastro-base1.css`, portal, b1ref, controls).

## Testes

- Gate RED/GREEN: `scripts/tests/gates/motorbase1-independence.test.mjs`
- Smoke entidade fictícia: `tests/smoke/motorBase1FictitiousEntity.test.jsx`
- Regressões Marcas/lote existentes: via `npm run test:smoke` no `verify:all`

## Visual Marcas

Homologação comparativa 360/390/768/1024/1280: **PENDING** (sem captura browser neste ambiente). Comportamento e DOM esperados inalterados — preset congela os mesmos valores de props.

## Pendências

- Sign-off visual manual operador (checklist `MARCAS-H5-MANUAL-TEST.md`).
- Rollout preset para outros cadastros: missões futuras (1 cadastro = 1 PR).

## Veredito técnico

**GO** — acoplamento Mapa removido do grade compartilhado, preset SSOT, gate na cadeia `verify:all`.
