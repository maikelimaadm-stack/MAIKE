# Relatório: sincronização, Fase 2, versão em mais cadastros (D-PROD-344)

**Data:** 2026-11-27 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-344](./DECISIONS.md)

## Pedido

O plano de sincronização aprovado pelo proprietário. A auditoria do servidor (D8) mostrou que só o lote e o cocho conferiam a versão. Nos outros cadastros, quando duas pessoas editavam o mesmo registro (uma delas sem internet), valia a última gravação, e a edição da outra se perdia sem aviso.

## O que mudou

| Onde | Mudança |
|---|---|
| `backend/src/modules/areas/areaPastagemService.js` · `mapGeography/pontoReferenciaService.js` · `mapGeography/linhaGeograficaService.js` | Com `versao_esperada`: trava a linha e confere a versão (`exigirVersaoEsperada`, com a repetição da D-PROD-342) |
| `backend/src/modules/lancamentosTarefa/lancamentoTarefaService.js` | Idem, só na edição de campos (fotos somadas e histórico não conferem) |
| Rotas (`areaPastagemRoutes.js`, `mapGeographyRoutes.js`, `lancamentoTarefaRoutes.js`) | O PATCH aceita `versao_esperada` |
| `backend/src/shared/sincronizacao/versaoDoRegistro.js` | `escalas` por coluna Decimal |
| `src/apis/areas/areaPastagemNativePort.js` · `src/apis/mapaGeografia/mapaGeografiaNativePort.js` · `src/apis/tarefas/lancamentoTarefaNativePort.js` | Repassam `versao_esperada` (a área só com algo a gravar) |
| `src/components/mapa/FormularioArea.jsx` · `FormularioPonto.jsx` · `FormularioLinha.jsx` | Mandam o `updated_date` do registro aberto |

## Verificação

- `backend/tests/versaoCadastrosD344.test.mjs`:
  - VC-01, em área, ponto, linha e tarefa: a versão vista grava, a repetição dá 200, a versão velha com outra edição dá 409 e, sem versão, grava;
  - VC-02: a altura "30,5" repetida conta como a mesma edição;
  - VC-03: histórico e fotos somadas não conferem a versão.
  - Os três falham no servidor antigo.
- `tests/smoke/versaoCadastrosD344.test.js`, VA-01 a VA-03: as portas e os formulários mandam a versão. Falham no código antigo.
- Testes do servidor de área, cultura, mapa, pontos, tarefa e fotos: todos passam.
- `test:smoke`: 4653 de 4653.
- Gates (inclusive `gate:indices` e `gate:tenancy`) e `typecheck:backend` passam.
- O servidor, o site e o pacote do app sobem juntos na mesma publicação da Vercel. Assim o app novo nunca manda a versão a um servidor antigo, que a recusaria.

## O que ficou para depois

- **A tela da tarefa mandar a versão.** As fotos que sobem sozinhas mudam a versão; antes, a tela precisa reler a tarefa depois do envio das fotos.
- **A exclusão conferir a versão** (auditoria D7).
- **Os outros cadastros com a regra "a última gravação vale"** (setor, marca, produto, etc.). São editados quase só no escritório.
