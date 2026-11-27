# Relatório: a versão na tela da tarefa (D-PROD-358)

**Data:** 2026-11-27 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-358](./DECISIONS.md)

## Pedido

O proprietário pediu "Consegue ir resolvendo todos esses bugs sem parar?". Esta é a terceira pendência da sincronização. Na D-PROD-344, o servidor passou a conferir a versão da tarefa, mas a tela da tarefa ainda não a mandava. O motivo: a foto que sobe sozinha logo depois de salvar muda a versão, e a edição seguinte daria um falso "alterado por outra pessoa".

## O que mudou

| Onde | Mudança |
|---|---|
| `src/lib/offline/versaoVista.js` (novo) | A versão vista, só a que veio do servidor. A cópia montada sem internet não manda versão |
| `src/components/mapa/DetalhesTarefaMapa.jsx` | Manda a versão ao editar e ao mudar o status. A foto que sobe atualiza a versão da tela |
| `src/components/mapa/TarefasMapaPanel.jsx` | Manda a versão. Guarda a versão nova quando a foto sobe com o formulário aberto |
| `FormularioArea.jsx` · `FormularioLinha.jsx` · `FormularioPonto.jsx` | Passam a usar `versaoVista`, então a cópia sem internet não manda versão |

## Verificação

- `tests/smoke/versaoNaTarefaD358.test.js`:
  - VT-01: só a versão do servidor vai; a cópia sem internet não manda nada;
  - VT-02: a tela e a lista mandam a versão e acompanham a foto que subiu.
- `tests/smoke/versaoCadastrosD344.test.js` VA-03: mudado de propósito para a regra `versaoVista`.
- `tests/smoke/tarefaJanelaUnica.test.jsx`: a simulação do serviço de fotos ganhou o nome do aviso novo. O que o teste confere não mudou.
- O servidor que confere a versão da tarefa já está coberto: `backend/tests/versaoCadastrosD344.test.mjs` (VC-01, VC-03).
- `test:smoke`: completo, ver a PR.
- Os gates passam.
