# Relatório: sem internet, Grupo 1 (D-PROD-335)

**Data:** 2026-11-26 · **Branch:** `claude/nifty-feynman-rh0kdn` · **Decisão:** [D-PROD-335](./DECISIONS.md)

## Pedido

O proprietário pediu "Verifique os bugs offiline". A varredura foi dividida em três partes, revisadas ao mesmo tempo:
- a fila dos cochos e depósitos (motor) e a sincronização automática;
- a fila de cadastros e as cópias guardadas no aparelho;
- as tarefas, as fotos e o mapa.

Cada defeito foi reproduzido num teste antes de ser dado como confirmado. Foram 21 confirmados, além dos prováveis.

O proprietário escolheu "Grupo 1 primeiro (Recomendado)": os defeitos que perdem, duplicam ou apagam dados.

## O que mudou (Grupo 1)

1. **Cochos e depósitos não subiam depois de reabrir o app.**
   - **Onde:** `gatilhosDeSincronizacao.js` (`prepararTiposDeEnvio`), `motorDeSincronizacao.js` (`temTipoSemRegistroNaFila`) e `offlineEntityRuntime.js` (`temEntidadeSemPortaNaFila`).
   - **Antes:** os tipos de envio do lançamento e do cancelamento do cocho, e da transferência e do cancelamento do depósito, só se registravam quando a tela de um lote ou de um cocho carregava. Conferido no app gerado: só o `cocho.leitura` estava no pacote inicial.
   - **Agora:** com algo na fila que ninguém sabe enviar, a passada carrega esses módulos e todas as portas antes de enviar. Sem nada assim, o app continua leve.
2. **Cadastro criado em dobro.**
   - **Onde:** `offlineEntityRuntime.js` (`syncOfflineEntityQueue`).
   - **Antes:** editar um registro com outra edição na fila, ou a exclusão só online, chamava a fila direto, fora da vez da sincronização. Duas passadas liam a mesma fila. Marca, Setor, Área e Produto, que não têm id do aparelho, eram criados duas vezes.
   - **Agora:** uma passada por vez. Quem pede durante uma passada recebe ela e mais uma volta em seguida.
3. **Edição ou exclusão perdida durante o envio.**
   - **Onde:** `offlineEntityRuntime.js` (`EM_ENVIO`) e `motorDeSincronizacao.js` (`gravarSeAindaNaFila`).
   - **Fila de cadastros, antes:** a edição feita enquanto a criação subia entrava nela e sumia; a exclusão a tirava da fila, e o servidor a gravava assim mesmo.
   - **Fila de cadastros, agora:** as duas viram um item próprio, depois da criação. A edição nova também não entra mais numa edição recusada, onde sumia sem contar como "aguardando".
   - **Motor, antes:** "Excluir" na janela Sincronização durante o envio era desfeito pela gravação do resultado.
   - **Motor, agora:** o resultado só é gravado se o item ainda está na fila.
4. **Lote sobrescrito sem aviso.**
   - **Onde:** `loteNativePort.js`.
   - **Antes:** a porta descartava `versao_esperada` (D-PROD-316), e o servidor nunca conferia a versão do lote.
   - **Agora:** a versão vai no PATCH.
5. **Fotos de tarefa apagadas do servidor.**
   - **Onde:** backend `lancamentoTarefaRoutes.js` e `lancamentoTarefaService.js`; app `lancamentoTarefaNativePort.js`, `fotosDeTarefaAguardandoService.js`, `tarefasMapaService.js`, `DetalhesTarefaMapa.jsx` e `TarefasMapaPanel.jsx`.
   - **Antes:**
     - A passada lia as fotos da tarefa na cópia do aparelho e mandava a lista inteira. Uma cópia antiga, ou a tarefa fora da cópia (troca de fazenda), apagava as fotos.
     - A foto excluída durante o envio voltava.
     - Com a tela de detalhes aberta, a foto que subia sumia, e a edição seguinte a apagava.
   - **Agora:**
     - O PATCH aceita `fotos_adicionar`. O servidor trava a tarefa e soma.
     - A passada manda só as novas, relê cada foto antes de gravar e espera a criação ou edição da tarefa que está na fila.
     - A foto só sai do aparelho com a resposta do servidor.
     - A tela de detalhes recebe as fotos novas.
     - A edição aberta antes mantém a foto que subiu depois (`fotosDaTela`). A que a pessoa tirou de propósito sai.
6. **Lançamento do cocho sumindo com sinal fraco.**
   - **Onde:** backend `suplementacaoEventoComandoService.js`; app `lancamentoCochoAguardandoService.js`.
   - **Antes:** com o celular dizendo ter internet, o lançamento que tentou subir sem resposta sumia da lista, e a pessoa lançava de novo.
   - **Agora:** o servidor grava o `operation_id` no lançamento, fora do fingerprint. O app mostra o lançamento até a lista do servidor trazer o mesmo código, e nunca mostra em dobro.

## Verificação

**App:**
- `tests/smoke/semInternetGrupo1D335.test.js`, G1-01 a G1-08:
  - duas passadas criam uma vez só;
  - edição e exclusão durante o envio não se perdem;
  - a edição nova não entra numa edição recusada;
  - o lote manda a versão;
  - a passada carrega o tipo do cocho;
  - "Excluir" durante o envio não é desfeito;
  - o servidor grava o código da operação.
- `tests/smoke/tarefaFotosSemInternet.test.js`, FS-06 a FS-09: a foto é somada, a excluída durante o envio sai, a foto espera a edição da tarefa na fila, e a edição aberta antes não apaga a foto.
- Atualizados para a regra nova:
  - FS-01 e o servidor falso do mesmo arquivo: a foto vai como `fotos_adicionar`;
  - `telaNaoPisca.test.js` TN-02: o lançamento que tentou subir continua na lista até o servidor trazê-lo.
- Todos os testes novos falham no código antigo e passam no novo.

**Servidor:**
- `backend/tests/lancamentoTarefaFotos.test.mjs` TF-04 e TF-05: a soma sem repetir, e a soma sobre a lista enviada.
- `backend/tests/suplementacaoLancamentoCodigoOperacao.test.mjs` LO-01: o código volta na resposta e na lista, e repetir não duplica.
- Os testes do servidor ligados às mudanças passaram: tarefas, cocho, sincronização incremental, lote e versão, 76 de 76.

## O que ficou para depois

### Grupo 2: travas e avisos que enganam

- **Espera longa:** "Enviar agora", a volta da internet e a volta ao app não zeram a espera depois de falhas de rede, que pode chegar a 10 min (`motor:751`).
- **"Tudo sincronizado" sem nada enviado:** o cartão diz isso mesmo quando ficou algo na fila (`sincronizacaoCompletaService.js:96`).
- **Leitura recusada travando o cocho:** uma leitura "independente" recusada segura os lançamentos do mesmo cocho (`leituraCochoNativePort.js:72`, `motor:709/747/481`).
- **Valor recusado aparecendo como salvo:** a edição recusada continua pintada por cima do servidor nas listas (`offlineEntityRuntime.js`, `aplicarPendentes`).
- **Tarefa de outra fazenda no mapa:** a edição de uma tarefa da fazenda A na fila aparece no mapa da fazenda B (`mapaCacheService.js:216-218`).
- **Pino que fica no mapa:** "Excluir" na fila deixa o pino até o mapa ser relido.
- **Fotos guardadas sem dono:** fotos de uma tarefa excluída ficam guardadas e vão para "precisa de atenção".
- **Sessão vencida em silêncio:** a sessão vencida com o app aberto deixa a fila parada, sem motivo e sem pedir login (`motor:846`).
- **Histórico do depósito:** a transferência que tentou subir some do histórico com sinal fraco. É a mesma regra antiga do item 6 (`historicoAguardandoEnvioService.js`).
- **Edição de cadastro com sinal fraco:** com sinal fraco, ela dá erro em vez de ir para a fila. Só a criação tinha essa saída.

### Grupo 3: limites

- **Muitas fotos:** uma tarefa com várias fotos passa de 4 MB. São cerca de 4 a 9 fotos, e nada confere o tamanho antes de enviar.
- **Fotos que não encolhem:** HEIC, arquivo sem tipo e fotos muito grandes não são reduzidas, e o servidor as recusa.
- **Troca de fazenda sem internet:** os cadastros aparecem vazios, porque a cópia é guardada por fazenda selecionada.
- **Relógio do celular voltando:**
  - a fila de cadastros, ordenada pela hora do aparelho, pode mandar um registro antes do outro de que ele depende;
  - a espera do motor pode ficar sem fim.
- **Armazenamento cheio:** o registro aparece como salvo sem estar em nenhuma fila.
- **Tarefa duplicada:** se guardar a foto falha depois de a tarefa ser criada, salvar de novo cria outra tarefa.
- **Cópias de leitura entre usuários:** são guardadas por cliente, não por usuário, e não são apagadas quando a sessão é recusada.
