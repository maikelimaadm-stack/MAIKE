# Relatório — tarefa com foto salva (D-PROD-327)

**Data:** 2026-11-26 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-327](./DECISIONS.md)

## Pedido

O proprietário testou: "tarefas sem imagens ela salva e com imagem não salva".

## Causa

- A foto vai dentro da tarefa, como endereço `data:`.
- As rotas da tarefa aceitavam no máximo **1 MB**, o padrão do Fastify. A foto da câmera tem de 2 a 5 MB, então a tarefa com foto voltava **413** e não era gravada.
- Confirmado no teste TF-01 com a regra antiga: `413 !== 201`.
- Sem internet, a foto guardada ficava tentando subir sem fim. É o provável item que "não sai da fila".

## O que mudou

| Onde | Mudança |
|---|---|
| `src/lib/imagens/reduzirFoto.js` (novo) | Reduz a foto para caber em 1600 px, em JPEG com qualidade 0,75. Nunca piora: com foto já pequena, sem canvas, com imagem que o aparelho não abre ou com reduzida maior, sobe a original. |
| `src/services/tarefasMapaService.js` | `enviarAnexo` reduz a foto antes do upload. Vale para a foto enviada na hora, a guardada sem internet e a da fila antiga. |
| `backend/src/modules/lancamentosTarefa/lancamentoTarefaRoutes.js` | `POST` e `PATCH /lancamentos-tarefa` com `bodyLimit` de 4 MB, abaixo dos 4,5 MB da função serverless. |
| `tests/smoke/setup.js` | O jsdom se comporta como aparelho sem canvas, sem o aviso "Not implemented". |

## Verificação

- **Chromium real** (Playwright): uma imagem de 4000×3000 com **12,3 MB** (ruído, o pior caso) ficou com **588 KB** em 1600×1200. Uma foto comum fica bem menor.
- **Testes do servidor** (`backend/tests/lancamentoTarefaFotos.test.mjs`):
  - TF-01: criar com foto de cerca de 1,5 MB dá 201.
  - TF-02: editar com 3 fotos dá 200.
  - TF-03: acima de 4 MB dá 413.
  - Junto com `lancamentoTarefaNativo`, foram 11 testes, todos passando.
- **Testes do app** (`tests/smoke/tarefaFotoReduzida.test.js`):
  - FR-01: dimensões.
  - FR-02: a foto grande vira JPEG menor.
  - FR-03: nunca piora.
  - FR-04: todo envio de foto de tarefa passa pela redução.
- A suíte das fotos sem internet (FS-01..05) continua passando.
- Suíte `test:smoke` completa: 372 arquivos, 4497 testes, todos passaram; gates passaram.
