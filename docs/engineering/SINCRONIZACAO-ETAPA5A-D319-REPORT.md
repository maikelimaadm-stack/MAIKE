# Sincronização, Etapa 5a: id do aparelho em mais três registros; as tarefas presas voltam a subir (D-PROD-319)

**Data:** 2026-11-26 · **Decisão:** [D-PROD-319](./DECISIONS.md) · **Branch:** `claude/nifty-feynman-rh0kdn` · **Migration:** nenhuma

## O que o proprietário vê

| Antes | Agora |
|---|---|
| Medição de forragem, tarefa do mapa e o evento automático da chegada do gado: se a resposta do servidor se perdia, o envio repetido gravava duas vezes (a tarefa também ganhava dois registros no histórico) | Repetir devolve o mesmo registro: nada duplica |
| Tarefa criada no mapa **sem internet** ficava num armazenamento antigo do aparelho que nada enviava, mesmo com o aviso "sincronizará ao conectar" | Vai pela fila de envio como os outros registros e aparece na Sincronização |
| As tarefas que já estavam presas nos aparelhos não chegavam nunca | Sobem sozinhas na próxima sincronização com internet, com as fotos, sem duplicar |
| Sem internet, as fotos da tarefa ficavam guardadas e não subiam | A tela avisa que as fotos precisam de internet: salvar sem as fotos novas e anexar depois |

## Como

### Servidor

Os três `POST` usam `criarComIdDoAparelho`, o mesmo helper do lote e do cocho (D-PROD-308).

| Registro | Rota | Onde | Já excluído |
|---|---|---|---|
| Medição de forragem | `POST /medicoes-forragem` | `medicaoForragemService.criar`; `id` no schema fechado | histórico de exclusão (`foiExcluidoNoHistorico`) |
| Tarefa | `POST /lancamentos-tarefa` | `lancamentoTarefaService.criar`; `id` no schema fechado; o histórico do mapa é gravado só na 1ª criação | histórico de exclusão |
| Evento de suplementação | `POST /suplementacao-eventos` | `suplementacaoEventoService.criar`; corpo aberto; o id que não é UUID segue ignorado | cancelado (`situacao = 'cancelado'`) |

A leitura do id em qualquer tenant serve só para decidir. O registro de outro tenant dá 409 `ID_DO_APARELHO_EM_USO` e não vaza nada.

### App

- **Portas:** `medicaoForragemNativePort`, `lancamentoTarefaNativePort` e `suplementacaoEventoNativePort` ligam `idDoAparelho`; as duas de corpo fechado mandam o `id`.
- **`TarefasMapaPanel`:**
  - sem internet, usa as mesmas mutações que com internet; a porta põe na fila;
  - com fotos novas e sem internet, recusa com o aviso;
  - as mensagens dizem "salva no aparelho".
- **Resgate (`tarefasGuardadasNoAparelhoService`):** roda no fim de cada passada da sincronização com internet (`registrarPassadaExtra` em `gatilhosDeSincronizacao`). Para cada tarefa presa:
  1. ganha um id do aparelho, gravado antes de enviar;
  2. as fotos sobem uma vez, e os endereços ficam gravados;
  3. a tarefa vai pela porta de sempre;
  4. sai do armazenamento antigo.
  - A recusada fica guardada para a próxima vez, sem repetir as fotos e com o mesmo id.
  - Sem resposta, entra na fila de cadastros com o mesmo id.

## Testes

| Arquivo | Casos |
|---|---|
| `backend/tests/idDoAparelhoEtapa5a.test.mjs` | 5A-01..08: repetir devolve o mesmo (uma linha, uma auditoria, um histórico); simultâneas viram uma; outro tenant dá 409; excluída não volta; sem id, como antes; id inválido dá 400 no corpo fechado |
| `tests/smoke/idDoAparelhoEtapa5a.test.js` | AP-01..04: sem internet nasce com UUID e o id vai no envio; com a rede caindo, vai para a fila com o mesmo id. RT-01..04: o resgate (sobe com as fotos; recusada fica sem repetir as fotos e com o mesmo id; rede caindo vai para a fila; sem internet nada é tentado) |

As suítes existentes de medição, tarefa, cancelamento do cocho, id do aparelho e permissões passaram: 95 testes no servidor e 411 no app (27 arquivos).

## Limites

- **Foto sem internet:** continua sem subir. A tela pede para salvar sem ela. Guardar foto para enviar depois exige a fila guardar arquivos, o que fica fora desta parte.
- **Tarefa presa de outra conta:** pode estar no mesmo aparelho, porque o armazenamento antigo não tinha dono. O servidor recusa pela fazenda, e ela fica guardada.
- **Próximas partes da Etapa 5:**
  - 5b: desenhos do mapa com numeração;
  - 5c: cadastros administrativos;
  - 5d: incremental nas outras listas;
  - 5e: versão nas outras entidades;
  - 5f: limpeza dos recibos.
