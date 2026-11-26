# Relatório — a tarefa abre numa janela só (D-PROD-325)

**Data:** 2026-11-26 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-325](./DECISIONS.md)

## Pedido

"Quando clico para abrir tarefa já me aparece uma tela de fundo junto também, isso é ruim, tem que ajustar isso também, fica aparecendo toda hora."

## Causa

A lista de tarefas, os detalhes e o formulário eram três janelas (`LancLoteDialogo`) empilhadas. Abrir uma tarefa pela lista (ou "Nova tarefa") punha uma janela nova por cima da lista: a lista aparecia atrás durante a entrada, cada janela somava a sua sombra, e a lista continuava aberta embaixo.

## O que mudou

| Onde | Mudança |
|---|---|
| `src/pages/MapaGeral.jsx` | Uma janela de tarefas (`showTarefas \|\| showDetalhesTarefa`). Título e modo vêm da tela: "Tarefas" (só leitura), "Detalhes da tarefa" (só leitura), "Nova tarefa"/"Editar tarefa" (✕ · ✓). Guarda o formulário aberto (`formularioTarefa`) e a animação da troca (`animTelaTarefa`). Ao fechar, a janela mantém a última tela. `abrirTarefaDaLista` (com ‹ Voltar) e `handleClickTarefa` (alfinete, sem ‹). "Nova tarefa" pela lista mantém o recorte dela e volta para ela. |
| `src/components/mapa/TarefasMapaPanel.jsx` | O formulário aparece no lugar da lista (sem diálogo próprio). Estado do formulário controlável (`formulario`, `onFormularioChange`); sem ele, guarda sozinho (`openCreateOnMount`). Ao sair: volta para a lista (`voltarParaLista`) ou fecha tudo (`onClose`). |
| `src/components/mapa/DetalhesTarefaMapa.jsx` | `onVoltar` e `anim` passam para a casca (‹ no cabeçalho, entrada deslizando). |
| `src/components/tarefas/ResumoTarefasMapa.jsx` | `anim` (a lista volta deslizando). |

Os diálogos de dentro dos detalhes (Editar, Registrar evento, Histórico) não mudaram (fora do pedido; mesmo padrão das ações dos detalhes do lote).

## Testes

- `tests/smoke/mapaFocoBarraV12.test.jsx` — **BARRA-7** (novo): da lista, os detalhes entram no lugar dela (1 janela) e o ‹ volta; o formulário entra na mesma janela com o título e o ✓; "Nova tarefa" pela lista volta para ela, pelo mapa fecha tudo e reabrir a lista começa pela lista. **BARRA-6** atualizado (o formulário abre na própria janela).
- `tests/smoke/tarefaJanelaUnica.test.jsx` — **JU-01..03** (novo): o painel mostra o formulário sem segunda janela; o ✕ volta para a lista ou fecha tudo.
- `tests/smoke/tarefasMapaPadrao.test.jsx` — atualizado para a janela única.

## Verificação

- `npm run gate:types`: passou (361 diagnósticos, abaixo do teto).
- Testes das tarefas e do mapa: passaram; suíte `test:smoke` completa: 369 arquivos, 4475 testes, todos passaram.
- Gates rápidos (governance-paths, product-scope, import-integrity, source-closure, no-secrets, base44, lancamento-tarefa-native): passaram.
