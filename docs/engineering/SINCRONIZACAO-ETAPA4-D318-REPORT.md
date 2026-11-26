# Sincronização, Etapa 4: a tela nunca "pisca" (D-PROD-318)

**Data:** 2026-11-26 · **Decisão:** [D-PROD-318](./DECISIONS.md) · **Branch:** `claude/nifty-feynman-rh0kdn` · **Migration:** nenhuma · **Backend:** sem mudança

## O que o proprietário vê

Enquanto um registro feito no aparelho espera a confirmação do servidor, todas as telas mostram o mesmo estado. Quando chega a confirmação, a cópia do servidor toma o lugar do registro sem ele sumir e voltar, sem aparecer duas vezes e sem o saldo pular.

| Antes | Agora |
|---|---|
| O lançamento recém-confirmado sumia da lista do cocho até a lista ser relida | Continua na lista, com o id do servidor, até a lista trazê-lo |
| A baixa que já tinha tentado subir sumia do histórico do depósito | Aparece com o id real da baixa |
| Saldo 100 → 70 → 100 → 70 (voltava depois da 1ª tentativa) | 100 → 70 → 70 → 70 |
| O cancelamento recém-confirmado deixava o original reaparecer | O original continua fora até a lista ser relida |
| Com internet, o que tentou sem resposta podia aparecer duas vezes no cocho | Aparece uma vez só (sem internet, como "aguardando") |

## Como

1. **Fila** (`motorDeSincronizacao.js`, `filaDeEnvio.js`):
   - o item ganha `tentado_em`, a hora da 1ª tentativa. Ela é gravada ao criar o item já tentado, na falha do envio direto e quando a passada pega o item;
   - `registrosDoAparelhoDoTipo` devolve o que espera e o que foi confirmado nos últimos 30 minutos, com a resposta do servidor (`resultado`);
   - `mostrarComoAguardando` concentra a regra "aparece como aguardando".
2. **Lista do cocho** (`lancamentoCochoAguardandoService.js`): o confirmado entra com `resultado.evento`, marcado `_confirmadoAgora`, se a lista do servidor ainda não tem esse id. O que tentou sem resposta só aparece sem internet. O recusado continua na lista.
3. **Histórico do depósito** (`historicoAguardandoEnvioService.js`, `mapaCacheService.js`):
   - o confirmado entra com as movimentações de `resultado`;
   - a baixa já feita entra com `progresso.saida_feita.movimentacao_id`;
   - `comMovimentacoesDoAparelho` junta o que o aparelho sabe com a lista do servidor pelo id.
4. **Cancelamentos** (`cancelamentosAguardandoService.js`): o cancelamento confirmado há pouco continua valendo na tela. O recusado não vale.
5. **Saldo** (`estoqueAguardandoEnvioService.js`, `nativeHttpClient.js`, `respostasOffline.js`, `horaDasRespostas.js`):
   - a hora da lista é a da saída do pedido que a trouxe, para a resposta do servidor (na sincronização incremental, a da 1ª página) e para a cópia guardada (`pedido_em`, gravada junto dela);
   - o que tentou só desconta se essa hora é anterior a `tentado_em`;
   - hora desconhecida: como antes, só o que nunca tentou.

Nada é gravado no cache além do que o servidor respondeu. Tudo é visão aplicada na leitura, como desde a D-PROD-296.

## Testes

`tests/smoke/telaNaoPisca.test.js` usa a cadeia real (serviço → motor → fila em IndexedDB → comandos → `nativeHttpClient`), com um servidor falso:

| Caso | O que prova |
|---|---|
| TN-01 | O confirmado aparece com o id real até a lista do servidor trazê-lo; depois, uma vez só |
| TN-02 | O que tentou sem resposta aparece "aguardando" só sem internet; a baixa aparece com o id real |
| TN-03 | O histórico do depósito casa pelo id depois da confirmação, sem buraco e sem dobro |
| TN-04 | O saldo desconta o que tentou só se a cópia é de antes da 1ª tentativa; sem hora, como antes; o confirmado segue a mesma regra |
| TN-05 | A hora da cópia vem da leitura dos lotes, também depois de reabrir o app e quando a cópia é servida sem internet |
| TN-06 | Sequência completa: o saldo visto é `100, 20, 20, 20, 20, 20` (sem pulo) |
| TN-07 | O cancelamento confirmado continua escondendo o original |
| TN-08 | O recusado fica na lista do cocho e não vale no saldo nem no histórico |

As suítes existentes de sincronização, estoque, cocho e histórico passaram sem mudança: 141 arquivos e 2033 testes.

## Limites conhecidos

- **Duas contagens por instantes:** uma leitura de lotes que sai antes do envio e é atendida pelo servidor depois dele pode contar o registro duas vezes até a próxima leitura. A janela é de milissegundos e o saldo fica a menor, nunca a maior.
- **Com internet, o que tentou sem resposta some até a próxima passada** (segundos), em vez de arriscar aparecer em dobro.
- **Fica para a Etapa 5:** outras entidades e a limpeza dos recibos.
