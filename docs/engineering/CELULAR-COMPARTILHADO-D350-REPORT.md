# Relatório: celular de mais de uma pessoa (D-PROD-350)

**Data:** 2026-11-27 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-350](./DECISIONS.md)

## Pedido

O proprietário perguntou como o AgriWebb faz e escolheu fazer igual: "faz assim".

## Como o AgriWebb faz (lido no app dele)

| Situação | AgriWebb |
|---|---|
| Sair da conta | "Sair do AgriWebb? Você vai precisar de uma conexão à internet para entrar novamente." |
| Tirar uma fazenda do celular | Mostra "Verificando alterações não sincronizadas…" e avisa que o que não foi sincronizado será descartado |
| Reiniciar o app | "Todos os dados não sincronizados serão perdidos." |
| Separar por pessoa | Não separa: os dados ficam por fazenda baixada |

## O que mudou

| Onde | Mudança |
|---|---|
| `src/lib/offline/sincronizacao/motorDeSincronizacao.js` (`eDaSessao`) | O dono da fila é a conta da fazenda. Antes era a conta e também a pessoa |
| `src/services/sairComPendencias.js` (novo) · `src/Layout.jsx` | Ao sair, o app confere a fila na hora, tenta enviar com internet (até 20 s) e avisa quantos ficaram, com o texto certo |

## Verificação

- `tests/smoke/motorSincronizacao.test.js` MS-15, mudado de propósito. O registro de outra pessoa da mesma conta agora sobe, e o de outra conta continua sem subir. A pessoa que lançou continua gravada. O teste falha no código antigo.
- `tests/smoke/sairComPendenciasD350.test.js`, SP-01 a SP-03:
  - com internet, o app envia antes e conta de novo;
  - um envio que não responde não trava o sair;
  - sem internet, não espera;
  - o texto do aviso.
- `lancamentoCochoOffline.test.js` e `telaNaoPisca.test.js` isolavam cada teste por pessoa. Com a regra nova, eles isolam por conta da fazenda. O que os testes conferem não mudou.
- `test:smoke`: 4741 de 4741.
- Gates passam.

## O que ficou para depois

- **Mostrar na janela Sincronização quem lançou cada registro.** O dado já está no item.
