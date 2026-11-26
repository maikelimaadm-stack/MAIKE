# Tarefas, parte 2: aba Tarefas no mapa e resumo em cartões (D-PROD-321)

**Data:** 2026-11-26 · **Decisão:** [D-PROD-321](./DECISIONS.md) · **Branch:** `claude/nifty-feynman-rh0kdn` · **Migration:** nenhuma · **Backend:** sem mudança

## O que o proprietário vê

| Antes | Agora |
|---|---|
| A lista de tarefas era a grade de cadastro (cards configuráveis, busca e seleção) | **Resumo em cartões**, igual aos detalhes do lote: abas Abertas e Concluídas, números do topo e um cartão por tarefa |
| O segmento "Tarefas" estava escondido da barra | Barra com **Lotes · Pontos · Tarefas** |
| A "Nova tarefa" não sabia onde a pessoa estava | **Nova tarefa** usa a posição do celular: dentro de um pasto, já vem com o pasto e o ponto |
| O excluir ficava na grade | O **Excluir** fica nos detalhes da tarefa |

No foco **Tarefas**:
- o mapa mostra os alfinetes das tarefas (sem lotes e cochos);
- o cartão de baixo mostra "N tarefas abertas · M atrasadas" e abre a lista;
- o botão verde **Nova tarefa** fica logo acima do cartão.

## Como

- **`MapaControlesMobile`:** o segmento Tarefas volta, com a permissão das tarefas no mapa, e o toque só muda o foco.
- **`MapaGeral`:**
  - No foco Tarefas, o cartão de baixo resume as tarefas, e os alfinetes aparecem mesmo com "ícones de tarefa" desligado.
  - `novaTarefaAqui` usa `getCurrentPosition` (alta precisão, 8 s, cópia de até 1 min) e chama `abrirLancamentoTarefa`, que descobre o pasto pela posição. Sem posição, abre sem local.
  - A janela "Tarefas" abre como os detalhes do lote (`largo somenteLeitura popupDesde="tablet"`).
- **`ResumoTarefasMapa`** (novo), na casca v12 (`CascaDetalhe`):
  - abas, `Kpis`, `ListaItens` e `Item`;
  - ordem: atrasada, prioridade e prazo;
  - o toque abre os detalhes, e "Nova tarefa" fica no rodapé.
- **`TarefasMapaPanel`:** usa o resumo e repassa `onAbrirTarefa`, `onNovaTarefa` e `hoje`. O formulário continua o da parte 1.
- **`DetalhesTarefaMapa`:** ganha a pílula **Excluir**, com confirmação, e chama `onExcluida`. O mapa então fecha o detalhe e relê as tarefas.
- **Saem:**
  - `TarefasCardsMapa` (a grade);
  - `TarefaDetalhesDialog` (o detalhe aberto pela grade; o mapa abre o seu próprio);
  - `tests/smoke/tarefasCardsMapa.test.jsx`.

## Testes

| Arquivo | Casos |
|---|---|
| `tests/smoke/tarefasResumoMapa.test.jsx` | RS-01: ordem, cartão e números. RS-02: aba Concluídas. RS-03: o toque abre os detalhes e "Nova tarefa" funciona. RS-04: sem tarefas |
| `tests/smoke/mapaFocoBarraV12.test.jsx` | A barra com Tarefas, que só liga o foco. BARRA-3: o foco Tarefas (alfinetes, cartão e lista). BARRA-5: sem a permissão, a lista fecha. BARRA-6: "Nova tarefa" com posição dentro do pasto e sem posição |
| `tests/smoke/detalhesV12Tarefa.test.jsx` | Excluir nos detalhes: confirma, exclui e avisa; cancelado não exclui. O rodapé fica Editar · Registrar evento · Concluir · Excluir |
| `tests/smoke/tarefasMapaPadrao.test.jsx`, `tarefasMapaPrimeiraAbertura.test.jsx`, `historicoTarefaExcluirPermissao.test.jsx` | Ajustados ao novo diálogo e ao título em maiúsculas |

As suítes de tarefas e do mapa passaram: 67 arquivos e 1117 testes. O visual foi conferido em 390 px, com o componente real.

## Próxima

Parte 3: tarefas sem internet.
