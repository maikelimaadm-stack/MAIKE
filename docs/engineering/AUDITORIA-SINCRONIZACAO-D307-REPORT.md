# Relatório — Auditoria da sincronização (D-PROD-307)

**Data:** 2026-11-25 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-307](./DECISIONS.md)

## Pedido

> "Antes de mudarmos para os outros, quero que analise tudo sobre as sincronizações, carregamentos de dados, lançamentos — vamos achar os bugs e corrigi-los. Também referente a várias sincronizações ao mesmo tempo: não vai dar complicação?"

## Como foi feita

Três frentes de leitura do código:

1. **Filas de envio:** o motor (`motorDeSincronizacao`) e a fila antiga por entidade (`offlineEntityRuntime`).
2. **Carregamento:** a baixa de dados (`dadosOfflineService`), o cache do mapa (`mapaCacheService`) e as cópias do `nativeRequest`.
3. **Lançamentos:** o cocho (baixa, lançamento e fechamento), a transferência e as leituras.

Cada achado foi classificado como grave, médio ou estrutural. Esta PR corrige os graves e os médios, e cada um tem um teste que falhava antes da correção.

## Achados corrigidos

| # | Achado | Gravidade | Correção |
|---|---|---|---|
| 1 | A baixa de dados e o envio rodavam juntos: a baixa podia gravar uma resposta de antes do envio por cima do que acabou de subir | grave | `vezDaSincronia`: um de cada vez; a baixa envia primeiro |
| 2 | Duas baixas ao mesmo tempo (automática de 6 h + "Sincronizar agora") faziam o dobro das leituras e se atropelavam | médio | uma baixa de cada vez; quem pede depois acompanha a mesma; outra fazenda espera |
| 3 | Uma conta entrando no meio da baixa podia ficar marcada como "já preparada" com dados da outra | grave | a baixa fica presa à conta de quando começou; se a conta muda, para sem marcar nada |
| 4 | Uma baixa em que nada veio ficava marcada como "baixado" | médio | sem marcação; o preparo continua pedindo |
| 5 | Uma leitura forçada do mapa reaproveitava outra que tinha saído antes da gravação | grave | a forçada espera a anterior e lê de novo; as repetidas viram uma |
| 6 | Com internet fraca, a cópia do aparelho (devolvida depois de 6 s) era gravada no cache como se fosse do servidor e apagava o que a tela tinha acabado de gravar | grave | contador de cópias: com cópia, não grava; a baixa conta como falha |
| 7 | O fechamento do período no lançamento do cocho decidia com a cópia do aparelho ou sem rede | grave | sem rede ou com cópia, o lançamento fica na fila e fecha na próxima passada, sem repetir a baixa nem o lançamento (LCO-15) |
| 8 | Na fila antiga, um registro que o servidor recusava de vez voltava a cada minuto e travava a fila inteira, de todas as entidades | grave | fica retido com o motivo, a fila segue; aparece em "precisa de atenção" com Tentar de novo e Descartar |
| 9 | Motor: erro sem código era tratado como recusa definitiva | médio | erro sem código conta como erro do servidor e tenta de novo |
| 10 | Motor: uma falha passageira no envio direto perdia o registro | grave | guarda na fila |
| 11 | Motor: um pedido de sincronização feito durante uma passada se perdia | médio | roda logo depois da passada |
| 12 | Oito portas nativas guardavam cache e fila sem dono: uma conta podia ver ou enviar o que era de outra no mesmo aparelho | grave | `tenantScoped`; o que ficou da versão anterior é adotado pela sessão (não descartado) |
| 13 | Com o cache dessas oito portas em chave nova, a atualização deixaria os cadastros invisíveis sem internet até as 6 h | médio | `FORMATO_DOS_DADOS = 2`: a 1ª abertura com internet depois da atualização baixa de novo |
| 14 | Um item criado sem internet podia aparecer duas vezes na lista | médio | a criação substitui a entrada de mesmo id |
| 15 | Leitura do corpo da resposta que falhava não era tratada como falta de rede | médio | `erroDeIndisponibilidade` (vai para a cópia ou para a fila) |

## Várias sincronizações ao mesmo tempo: como fica

- **Disparos:** a sincronização automática (a cada minuto e na volta da internet), o "Enviar agora", o "Sincronizar agora", a baixa de 6 h e o preparo podem pedir ao mesmo tempo.
- **Uma de cada vez:** o envio das duas filas e a baixa entram na mesma vez (`naVezDaSincronia`), sempre um depois do outro.
- **Pedidos repetidos:** uma passada pedida durante outra roda logo depois; uma baixa pedida durante outra acompanha a mesma.
- **Mesmo registro:** cada registro do motor tem um código único (`operation_id`). O servidor reconhece o código e não grava duas vezes, mesmo que o celular reenvie depois de perder a resposta.
- **Fila antiga:** o que ainda não tem esse código continua na fila antiga e é a parte estrutural da próxima missão.

## Fora desta PR (estrutural, próxima missão)

1. Gravar na fila o envio direto do motor antes de ele sair (hoje ele só é gravado se falhar).
2. Trava entre abas do navegador (`navigator.locks`), só para a web. No app há uma aba só.
3. `operation_id` nas criações da fila antiga (idempotência no servidor). Exige mudança no servidor.
4. Uma política única de overlay para o que já tentou subir, usando o `operation_id` exposto nas entidades.
5. Remapeamento de ids `offline_` entre a fila antiga e o motor.
6. Tratar o intervalo entre "enviado" e a próxima leitura.
7. Mostrar no histórico do depósito o cancelamento do cocho feito sem internet.

## Verificação

- `npm run test:smoke`: passa toda a suíte. Três contratos antigos foram atualizados para o comportamento novo: SO-05, PR167-R2 F e categoria (e).
- Testes novos:
  - `auditoriaSincronizacao.test.js` (AU-01..12);
  - `baixaUmaDeCada.test.js` (BX-01..05);
  - `lancamentoCochoOffline.test.js` (LCO-15).
- Gates passam: `gate:types` (sem regressão), `gate:import-integrity`, `gate:source-closure`, `gate:product-scope`, `gate:api-boundary`, `gate:admin-isolation`, `gate:governance-paths`, `gate:no-secrets` e `gate:base44`.
- `npm run build` passa.
- Sem migration e sem mudança no servidor.
