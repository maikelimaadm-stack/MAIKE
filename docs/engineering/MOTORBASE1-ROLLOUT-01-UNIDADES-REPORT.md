# MOTORBASE1-ROLLOUT-01 — Unidades de medida

**Branch:** `cursor/motorbase1-rollout-unidades-b63e`  
**Base:** `origin/main` @ `b5addbf3` (pós merge PR #110)  
**Data:** 2026-10-28  
**Escopo:** 1 cadastro — `UnidadesMedida` (visual preset apenas)

## Objetivo

Renomear o preset visual SSOT para perfil genérico de lista integrada Base1 e migrar **somente** a camada visual de `UnidadesMedida.jsx`, preservando identidade de persistência/UI (`storageKey`, `droppableId`, query keys, services).

## Preset

| Antes | Depois |
|---|---|
| `BASE1_MARCAS_MODEL_VISUAL` | `BASE1_LISTA_INTEGRADA_VISUAL` |

Objetos congelados inalterados (`workspace`, `chrome`, `grade`). Consumidores: `Marcas.jsx`, `TabelaMarcas.jsx`, `UnidadesMedida.jsx`.

## Gate motorbase1-independence

Correção: imports **relativos** (`../../marcas/...`) agora resolvem para caminho sob `src/` e classificam como domínio proibido (`classifyImportInFile`). Teste RED/GREEN em `scripts/tests/gates/motorbase1-independence.test.mjs`.

## Intacto (escopo negativo)

- `colunas_unidades_medida`, `droppableId="colunas-unidades-medida"`, `queryKey: ["unidades_medida"]`
- `unidadeMedidaService`, APIs, backend, migrations, Vercel/Supabase
- Comportamento CRUD, formulário, export CSV

## Arquivos tocados

- `src/components/cadastro/base1/base1VisualPreset.js`
- `src/pages/UnidadesMedida.jsx`, `src/pages/Marcas.jsx`, `src/components/marcas/TabelaMarcas.jsx`
- `scripts/gates/lib/motorbase1-independence.mjs`
- `scripts/tests/gates/motorbase1-independence.test.mjs`
- `tests/smoke/motorBase1FictitiousEntity.test.jsx`
- `tests/smoke/unidadesMedidaBase1Rollout.test.jsx`
- `docs/engineering/MOTOR-BASE1-LISTA.md`

## Testes

- Preset smoke: `tests/smoke/motorBase1FictitiousEntity.test.jsx`
- Unidades RTL: `tests/smoke/unidadesMedidaBase1Rollout.test.jsx`
- Gate: `npm run test:gates` (motorbase1-independence RED/GREEN)
- Cadeia completa: `npm run verify:all`

## Visual

Unidades passa a usar `pageLayout="base1-list"`, chrome portal integrado e `referenceHeaders` — paridade com Marcas. Subtítulo legado do workspace default removido (comportamento base1-list). Homologação manual multi-breakpoint: **PENDING**.

## Veredito

**GO técnico** — preset renomeado, Unidades no SSOT visual, traversal relativo fechado no gate, testes e `verify:all` verdes.
