# PROMPT — Colunas Base1 (resize, autofit, freeze, prefs)

**Origem:** contrato de colunas do **CONTROLE-DE-ESTOQUE** (portal compras / `grid.tsx` + `preferences.ts`) replicado no piloto **Marcas** (`referenceHeaders`).  
**Decisão:** **D-PROD-42** · **Relatório:** `UX-FROTA-PILOT-MARCAS-REPORT.md` (UX-53)  
**Escopo:** comportamento de largura, autoajuste persistente, congelamento e persistência local — **não** domínio de compras nem APIs.

---

## 1. Contexto

A grade Base1 (`mg-grid`) expõe dois callbacks distintos para largura:

- **`onResize(colKey, widthPx)`** — persiste largura explícita (arraste manual, duplo clique “ajustar uma vez”, ou recálculo quando autoajuste está **ligado**).
- **`onAutoFit(colKey)`** — alterna membership em `autoFitKeys` (modo **persistente** “Auto ajustar coluna” no menu ⋮); **não** recebe largura.

Medição de conteúdo para autofit / duplo clique usa canvas (`medirLarguraColuna`), com **teto 480px** (paridade `largura-coluna.ts`). Persistência manual aceita **48–1200px** (`normalizeColumnWidths`).

Prefs versionadas: `{storageKey}_prefs` (`columns.widths`, `order`, `visible`, `frozen`, `autoFit`) + chaves legadas `_largura`, `_ordem`, `_visiveis`, `_congeladas`, `_autofit` (migração).

---

## 2. Tabela de contrato (CDE ↔ MAIKE)

| Evento / ação | CDE (`grid.tsx`) | MAIKE | `onResize` | `onAutoFit` | Persistência |
|---------------|------------------|-------|------------|-------------|--------------|
| Arraste na alça 6px | Atualiza largura; desliga autoajuste se estava ligado | `Base1Grid.startResize` → `mouseup` | Sim (clamp 48–1200 em `CadastroBase1Grade`) | Só se coluna ∈ `autoFitKeys` (toggle **off**) | `columns.widths` |
| Duplo clique na alça | Ajusta largura **uma vez**; **não** liga autoajuste | `ajustarLarguraUmaVez` | Sim (medida, teto 480) | **Não** | `columns.widths` |
| Menu ⋮ “Auto ajustar coluna” (off→on) | Liga modo + mede | `aplicarAutoAjuste(..., false)` | Sim (medida com ícone Scaling no chrome) | Sim (toggle **on**) | `widths` + `autoFit` |
| Menu ⋮ “Desativar auto ajustar” | Desliga modo | `aplicarAutoAjuste(..., true)` | **Não** | Sim (toggle **off**) | `autoFit` |
| Linhas / sort / filtros mudam | Recalcula colunas em autoajuste | `useEffect` em `Base1Grid` | Sim, se `c.width !== w` | **Não** | `widths` |
| Congelar até coluna N | `frozen` ≤ visíveis | `onFreeze` + `normalizeFrozenCount` | — | — | `columns.frozen` |
| Ocultar coluna / diálogo colunas | Clamp `frozen` + `autoFit` às visíveis | `clampColumnPrefsToVisible` | — | Filtra set | `_prefs` |
| Largura mínima grade | 48px | `MIN_COL_WIDTH` | clamp | — | normalização load |
| Teto medição autofit | 480px | `TETO` em `larguraColuna.js` | via medida | — | largura salva ≤480 quando só autofit |
| Teto arraste manual | (CDE) acima do autofit | `MAX_COL_WIDTH` 1200 | clamp | — | normalização load |

**Invariáveis:**

1. Duplo clique **nunca** chama `onAutoFit` (não liga ícone Scaling por duplo clique).
2. Arraste **nunca** liga autoajuste; só **desliga** se já estava ligado.
3. `onAutoFit` é **toggle** de conjunto, não setter de largura.
4. `e.detail > 1` no `mousedown` da alça ignora o segundo clique do duplo clique no arraste.

---

## 3. Referência CDE (clone)

| Área | Caminho CONTROLE-DE-ESTOQUE |
|------|-----------------------------|
| Grade + alça | `apps/web/src/features/base1/grid.tsx` |
| Medição | `apps/web/src/features/base1/largura-coluna.ts` (ou pacote shared equivalente) |
| Prefs colunas | `packages/shared/src/preferences.ts` (`normalizeListPreferences`, decisões 355–356) |
| CSS alça | `apps/web/src/app/globals.css` (`.mg-grid-resize-handle`) |

---

## 4. Superfície MAIKE (SSOT)

| Papel | Arquivo |
|-------|---------|
| Grade (UI + arraste / duplo clique / efeito autofit) | `src/components/cadastro/base1/Base1Grid.jsx` |
| Estado + persistência + clamp resize | `src/components/cadastro/base1/CadastroBase1Grade.jsx` |
| Prefs `localStorage` | `src/lib/cadastroBase1ColumnPrefs.js` |
| Medição canvas (PISO 48, **TETO 480**) | `src/lib/larguraColuna.js` |
| Piloto | `src/pages/Marcas.jsx`, `src/components/marcas/TabelaMarcas.jsx` |
| Testes prefs | `tests/smoke/cadastroBase1ColumnPrefs.test.js` |

---

## 5. Verificação

```bash
npm run test:smoke
npm run verify:all
```

Manual (Marcas, `colunas_marcas_v1_prefs`): arraste → largura salva; duplo clique → ajuste sem ícone Scaling novo; menu autoajustar → ícone + recálculo ao filtrar; arraste com autoajuste ligado → ícone some; recarregar → prefs intactas.

---

## 6. Relacionados

- `docs/engineering/PROMPT-MODELO-VISUAL-AGRO-ERP.md` (§11.7)
- `docs/engineering/PLAN-PORTAL-COMPRAS-PARIDADE-BASE1.md`
- `docs/engineering/MARCAS-MODELO-BASE1-CHECKLIST.md` (C.3–C.5)
