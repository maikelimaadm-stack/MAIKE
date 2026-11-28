# Sincronização como no AgriWebb: leve e por baixo (D-PROD-379)

**Data:** 2026-11-28 · **Decisão:** [D-PROD-379](./DECISIONS.md) · **Migration:** nenhuma · **APK:** nenhum novo

## Pedido

"Toda hora que estou entrando no meu sistema parece que fica sincronizando, aí mostra sincronizando, telas etc.
Olha o AgriWebb, veja como funciona tudo isso e faça igual." O proprietário escolheu fazer primeiro a Etapa 1
(comportamento e avisos) e deixar o SQLite para a Etapa 2.

## Como estava

| Momento | O que o app fazia |
|---|---|
| Abrir / voltar ao app (mais de 10 min) | baixava TUDO: 23 listas do mapa, todos os cadastros e até 3000 telas guardadas |
| Internet voltou (mais de 3 min) | o mesmo |
| App aberto | o mesmo a cada 6 h |
| Na tela | cartão "Sincronizando %" no meio; aviso "Sincronizando — Enviando N registro(s)…"; ícone do topo girando até sem nada a enviar |

## Como o AgriWebb faz (fontes públicas)

- Sincroniza sozinho ao abrir o app com internet e, com a "sincronização em segundo plano", uns 5 s depois de cada
  registro salvo. Na tela: uma faixa com quantos registros faltam enviar e "Sincronizar agora".
  <https://help.agriwebb.com/en/articles/6828757-syncing-the-mobile-app-best-practice>
- Guarda os dados da fazenda no aparelho ("farms currently on the device", "Reset Sync Status").
  <http://help.agriwebb.com/en/articles/3285378-mobile-app-settings>
- Não resolve conflito sozinho (o mesmo lote mexido em dois celulares sem internet aparece duplicado); orienta um
  login por pessoa. <https://www.agriwebb.com/blog/5-trending-questions-for-our-support-team/>
- Banco local: provavelmente SQLite (repositórios públicos `android-sqlite-*` da AgriWebb), sem fonte que confirme.
  <https://github.com/orgs/agriwebb/repositories>

## O que mudou

| Momento | Agora |
|---|---|
| Abrir / voltar ao app / internet voltou | a LEVE, por baixo: envia e atualiza só as listas que vêm pelo que mudou (lotes, pontos, cochos, linhas, eventos de suplementação, leituras de cocho, tarefas), se a última sincronização tem mais de 2 min |
| App aberto | a leve a cada 15 min |
| Baixa completa | só na primeira vez (tela de preparo), no formato antigo, no "Sincronizar agora" e, por baixo, quando a última completa passou de 12 h |
| Cartão do meio da tela | só no "Sincronizar agora" (pedir durante uma automática passa a mostrá-la) |
| Aviso flutuante | nada enquanto envia; no fim, "Tudo enviado" / "N enviados" só se algo feito sem internet subiu; "precisam de atenção" como antes |
| Ícone do topo | gira só enviando algo; senão o número que falta, ou ✓ |
| Janela Sincronização | "Última sincronização: agora mesmo / há N min / há N h" |

Arquivos: `src/services/dadosOfflineService.js` (`baixarSoOQueMudou`, `CHAVES_DA_SINCRONIA_LEVE`,
`ultimaSincronizacaoLeve`), `src/services/sincronizacaoCompletaService.js` (`modo`, `mostrar`, `visivel`,
`deveSincronizarSozinho`), `src/components/offline/DadosOffline.jsx`, `CirculoDeSincronizacao.jsx`,
`AvisoDeSincronizacao.jsx`, `BotaoSincronizacao.jsx`.

## O que fica para a Etapa 2

- Guardar registro por registro num banco SQLite no celular (hoje cada lista é um bloco inteiro no IndexedDB), com
  APK novo e a passagem do que já está guardado.
- Telas lendo do celular primeiro e atualizando por trás. Ficou fora desta etapa de propósito: em cima dos blocos
  inteiros, arriscava mostrar dado velho logo depois de gravar.
- "Só o que mudou" no servidor para as listas que ainda vêm inteiras (áreas, estoque, manejos, cadastros).

## Testes

- Novo `tests/smoke/sincronizacaoLeveD379.test.js` (SL-01..05): só as chaves da leve, com `force`; envia antes;
  marca a leve e não a completa; sem internet nada; tudo falhou não marca; conta trocada não marca; logout esquece.
- `sincronizacaoCompletaCirculo` SC-02 (regras novas) e SC-07 (leve sem cartão; pedir no meio mostra);
  `sincronizacaoAutomaticaGatilhos` SA-01/02/04; `sincronizacaoOrganizada` SO-03, SO-06, SO-07.
