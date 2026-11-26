# Relatório — cada aba do mapa com as suas camadas e os seus filtros (D-PROD-326)

**Data:** 2026-11-26 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-326](./DECISIONS.md)

## Pedido

"Nos filtros e camadas, as tarefas, filtros ou pontos etc. vão de acordo com onde eu estiver: se é em lotes, ou pontos, ou tarefas, eles não vão se misturar. Cada um com suas coisas e seus filtros."

## O que mudou

| Onde | Mudança |
|---|---|
| `src/lib/mapaFoco.js` | `camadasDoFoco('lotes')` sem cochos/depósitos e sem tarefas. `painelDoFoco(foco)`: as camadas e os grupos de filtro de cada aba. |
| `src/components/mapa/MapaFiltrosAvancados.jsx` | Prop `foco`: "Mostrar no mapa" só com as camadas da aba. Seção "Filtros de Tarefas" (Setor, Situação, Prioridade, Responsável, Prazo) só na aba Tarefas. "Filtros de Áreas" nas abas Lotes e Pontos. "Filtros de Categorias de Manejo" só na aba Lotes. O "limpar" e o aviso de filtro ligado olham só os filtros da aba. Sem `foco`, tudo como antes. |
| `src/pages/MapaGeral.jsx` | Os filtros escondidos não valem: cultura e pastagem fora da aba Tarefas, filtros de lote fora da aba Lotes. Os filtros de tarefa (estado, carga, gravação e preferência aplicada) valem só na aba Tarefas. Opções de responsável vêm das tarefas do mapa. |
| `src/domain/mapa/mapaGeralDerivados.js` | `filtrarTarefasDoMapa`, `responsaveisDasTarefas`, `SEM_RESPONSAVEL`. |
| `src/lib/mapaGeralFiltrosStorage.js` | Padrão, normalização (multisseleção) e campos do painel com os quatro filtros de tarefa. |
| (prioridade) | O filtro usa `normalizarPrioridadeTarefa` e `PRIORIDADES_TAREFA` de `src/lib/tarefas/prioridade.js` (PR #413): Baixa, Média, Alta, Urgente. |

## Mudança de comportamento a conferir

Na aba **Lotes**, os cochos, os depósitos e as tarefas não aparecem mais no mapa: ficam nas abas **Pontos** e **Tarefas**. A chave "Tarefas" saiu do painel.

## Testes

- `tests/smoke/mapaFiltrosPorAba.test.jsx` (novo), **ABA-01..06**:
  - regra pura;
  - filtros de tarefa;
  - responsáveis;
  - preferências;
  - painel na aba Tarefas e na aba Pontos (o "limpar" só da aba);
  - painel sem aba.
- `tests/smoke/mapaFocoBarraV12.test.jsx`, **BARRA-8** (novo):
  - o painel de cada aba no MapaGeral real;
  - o filtro de lote só vale na aba Lotes;
  - na aba Tarefas valem os filtros de tarefa e não a cultura.
- **BARRA-1/3/5** atualizados: aba Lotes sem cochos e tarefas.
- `tests/smoke/mapaPreferenciasIntegrada.test.jsx` (PREF-04): a chave "Tarefas" saiu do painel e entrou a aba Tarefas na barra.
- `tests/smoke/mapaV2Visualizacao.test.jsx`: forma das camadas do painel.
