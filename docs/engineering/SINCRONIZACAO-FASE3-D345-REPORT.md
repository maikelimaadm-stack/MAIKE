# Relatório: sincronização, Fase 3, baixar só o que mudou (D-PROD-345)

**Data:** 2026-11-27 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-345](./DECISIONS.md)

## Pedido

O plano de sincronização aprovado pelo proprietário. A auditoria da baixa (H1) mostrou que só lotes, cochos, leituras e lançamentos vinham "só o que mudou". O resto vinha inteiro a cada sincronização. A lista de tarefas, com as fotos dentro, era a que mais pesava.

## O que mudou

| Onde | Mudança |
|---|---|
| `backend/src/modules/mapGeography/pontoReferenciaService.js` · `linhaGeograficaService.js` · `mapGeographyRoutes.js` | `GET /pontos-referencia/mudancas` e `GET /linhas-geograficas/mudancas` |
| `backend/src/modules/lancamentosTarefa/lancamentoTarefaService.js` · `lancamentoTarefaRoutes.js` | `GET /lancamentos-tarefa/mudancas` |
| `src/lib/offline/sincronizacaoIncremental.js` | Novas ordens: `ordemPorCriacaoCrescente` e `ordemPorAtualizacao` |
| `src/apis/mapaGeografia/mapaGeografiaNativePort.js` · `src/apis/tarefas/lancamentoTarefaNativePort.js` | Registram as três listas como incrementais |

**A área ficou de fora.** A listagem dela traz a ocupação (o gado dentro), que muda sem mudar a área.

## Verificação

- `backend/tests/mudancasCadastrosD345.test.mjs`:
  - MC-01: sem `desde` vem tudo, na forma da listagem; com `desde`, vem só o alterado e o excluído (ponto e tarefa) ou o desativado (linha);
  - MC-02: a outra conta não vê nada;
  - MC-03: `desde` inválido dá 400.
  - Os três falham no servidor antigo.
- `tests/smoke/mudancasCadastrosD345.test.js`, MI-01 e MI-02: o registro das três listas e a ordem. Falham no código antigo.
- `sincronizacaoIncremental`, `mapGeographyNativa`, `lancamentoTarefaNativo` e `versaoCadastrosD344` passam.
- `test:smoke`: 4655 de 4655.
- Gates (inclusive `gate:indices` e `gate:tenancy`) passam.

## O que ficou para depois

- **Índice `(cliente_id, updatedAt)` em `PontoReferencia` e `LinhaGeografica`:** pede migration. Só vale a pena quando houver muitos registros por cliente.
- **Áreas, setores e os outros cadastros** continuam vindo inteiros. São listas pequenas.
- **Fase 4, a sincronização com o app fechado:** pede APK novo e decisão do proprietário.
