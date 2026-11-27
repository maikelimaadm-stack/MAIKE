# Relatório: fotos sem internet em partes (D-PROD-357)

**Data:** 2026-11-27 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-357](./DECISIONS.md)

## Pedido

O proprietário pediu: "Consegue ir resolvendo todos esses bugs sem parar?". Esta é a segunda pendência da sincronização. A auditoria do servidor (D5) mostrou que muitas fotos tiradas sem internet subiam num pedido só, passavam dos 4 MB e o servidor recusava.

## O que mudou

| Onde | Mudança |
|---|---|
| `src/services/fotosDeTarefaAguardandoService.js` (`enviarDaTarefa`, `emPartesQueCabem`) | As fotos sobem em partes de até 3,5 MB. As fotos de cada parte só saem do aparelho com a resposta dela. A parte sem resposta fica guardada para depois |

## Verificação

- `tests/smoke/fotosEmPartesD357.test.js`:
  - FP-01: cada parte cabe no limite, a foto grande vai sozinha e a ordem se mantém;
  - FP-02: várias partes vão ao servidor, cada uma sai do aparelho com a resposta dela, e a que ficou sem resposta continua guardada.
  - Os dois testes falham no código antigo.
- Os testes antigos das fotos (`tarefaFotosSemInternet`, `filaUnicaFotosETela`) passam.
- `test:smoke`: 4807 de 4807.
- Os gates passam.
