# Marcas — roteiro de teste manual (gate H.5)

**Objetivo:** evidência repetível para aceite do proprietário (“Marcas modelo OK”) antes do rollout Fase 2 (**D-PROD-41**).  
**Piloto:** `/Marcas` (`src/pages/Marcas.jsx`)  
**Referência CDE:** Portal de Compras (`DocList` + `barraIntegrada`) e `features/base1/list.tsx` / `grid.tsx` / `cards.tsx`  
**Checklist normativo:** [`MARCAS-MODELO-BASE1-CHECKLIST.md`](./MARCAS-MODELO-BASE1-CHECKLIST.md) seções A–H  
**Pré-requisitos:** `VITE_MAIKE_API_URL` + login nativo; empresa selecionada (`empresa_selecionada_id`); dados de marcas na conta de teste.

---

## Matriz de viewport (H.4 / UX-43)

| Largura (px) | Foco |
|--------------|------|
| 360 / 390 | Toolbar join sem clip; pílulas primárias tocáveis (~44px); summary empilha |
| 768 | Wrap da toolbar; grade com scroll horizontal |
| 1280 | Shell join único cartão; `fpop` acima da grade |

---

## Roteiro funcional (≈25 min)

### 1. Shell e toolbar (A.1–A.4, B.1–B.6)

1. Abrir **Marcas**: fundo `#f0f2f5`, um cartão branco com toolbar colada à grade (`data-testid="b1-toolbar"`).
2. Confirmar **sem** faixa `mg-pills-rail` de chips.
3. Botões Novo / Editar / Duplicar / Excluir: estados disabled coerentes com seleção.
4. Busca em pílula: digitar, Enter ou aplicar; limpar pelo X da pílula.
5. Alternador **Tabela / Cards / Registro** à direita; segmento ativo verde (skin portal).
6. Menu **Mais opções** (⚡): Exportar CSV, Imprimir, Configurar colunas, Layout/campos dos cards (só em modo cards), **Limpar filtros** (habilitado com filtro de coluna **ou** busca aplicada).

### 2. Grade e `fpop` (C.1–C.10)

1. Cabeçalho: ⋮ → filtro avançado, autoajustar, congelar, ocultar.
2. Abrir `fpop` em **Nome**: operador Radix (`SeletorDeOperador`); rodapé X/✓ estilo portal (25px).
3. Enter aplica; clicar fora fecha (sem fechar ⋮/⚡ antes); com operador/calendário aberto, primeiro clique fora não fecha o shell (camadas 357–360).
4. Resize: alça verde no hover; mínimo 48px; duplo clique ajusta uma vez; arraste desliga autoajustar.
5. Congelar 2–3 colunas: sombra na âncora; rolagem horizontal preserva fixas.
6. Ordenar coluna **Nº**: ordem numérica (1, 2, 10…).
7. Duplo clique / abrir linha → modo registro.

### 3. Colunas e persistência (C.9, C.5)

1. ⚡ → **Configurar colunas**: duas listas, setas centrais, rascunho até ✓; Restaurar padrão.
2. Ocultar coluna congelada → `frozen` coerente após Pronto.
3. Recarregar página: prefs em `localStorage` `colunas_marcas_v1` / `colunas_marcas_v1_prefs`.

### 4. Cards (D.1–D.5)

1. Modo cards: viewport `p-2.5`; cards `p-4`, grid `gap-3`.
2. Seleção por clique; card selecionado com faixa verde; hover sombra CDE.
3. ⚡ → layout e campos dos cards (não na toolbar).
4. Selecionar card e alternar registro: `scrollIntoView` ao focar.

### 5. Registro view / edit (B.7–B.8, E.1–E.4, A.9)

1. Abrir registro existente: toolbar de **lista** (Novo/Editar/…), campos `readOnly`, **Ativo** em `B1ChaveRow` + switch.
2. **Editar** → Salvar/Cancelar na toolbar; busca/alternador bloqueados durante edição.
3. Salvar → volta à **leitura** no mesmo registro (não fecha painel).
4. Cancelar na edição → leitura; Cancelar em registro novo → fecha e volta à tabela.
5. Bookmark + nav primeiro/anterior/próximo/último entre registros **filtrados pela busca**; nav bloqueada em edição.
6. **Novo** e **Duplicar**: formulário com rascunho correto (duplicar após outro “Novo” não reaproveita estado antigo).
7. Campo **Nº** somente leitura em registro existente.

### 6. Exclusão e chrome (G.3, B.3)

1. Excluir: `TopNoticeDialog` com **Cancelar** visível na barra; sem ESC/clique fora para dismiss acidental.
2. Rodapé `mg-summary`: 4 colunas; page-size `MgSelect` pill ~4.5rem mínimo.
3. Anexos: ícone visível, desabilitado com tooltip (P8).

### 7. Limpar filtros (paridade CDE `clearAll`)

1. Aplicar filtro de coluna + busca global → ícone limpar filtros ativo (toolbar e menu ⚡).
2. **Limpar filtros** → remove filtros de cabeçalho **e** zera busca aplicada.

---

## Fora do escopo (não reprovar no H.5)

| Item | Status |
|------|--------|
| §11.15 pesquisa dropdown / favoritos cards | DEFER (**D-PROD-40**) |
| §11.16 anexos nativos | P8 |
| Tenancy `empresa_selecionada_id` / filtro servidor | G.4 — PR backend |
| Numeração `max+1` concorrente | G.5 — backend P6+ |
| Rollout Setores / demais cadastros | **Pausado** (**D-PROD-41**) |

---

## Registro de aceite (produto)

| Campo | Valor |
|-------|--------|
| Testador | |
| Data | |
| Commit / deploy | |
| Viewports exercitados | 360 · 390 · 768 · 1280 |
| Resultado | ☐ Aprovado (“Marcas modelo OK”) · ☐ Reprovado (anexar itens) |
| Observações | |
