# Tarefas, parte 3: tarefas sem internet, com as fotos guardadas (D-PROD-324)

**Data:** 2026-11-26 · **Decisão:** [D-PROD-324](./DECISIONS.md) · **Branch:** `claude/nifty-feynman-rh0kdn` · **Migration:** nenhuma · **Backend:** sem mudança

## O que o proprietário vê

Sem internet, a tarefa funciona como com internet. Criar, editar, concluir, registrar e excluir sem sinal já funcionava desde a D-PROD-319 e as partes 1 e 2. Esta parte resolve as fotos:

| Antes | Agora |
|---|---|
| Sem internet, tarefa com foto nova: "Remova as fotos e anexe quando a internet voltar" | Salva normalmente. A foto fica guardada no celular e **sobe sozinha** quando a internet volta |
| Nada mostrava o que ainda não tinha subido | O resumo marca a tarefa com **"aguardando envio"**, e os detalhes mostram **"N fotos aguardando envio"** |
| Só dava para escolher foto da galeria | Duas opções: **Tirar foto** (abre a câmera) e **Galeria** (escolhe as já tiradas) |
| A foto não abria no formulário, e o ✕ só aparecia passando o mouse | A foto guardada **aparece** em miniatura (selo "Aguardando envio"); **toda foto abre em tela cheia** ao tocar; o ✕ fica sempre visível e **exclui** a foto guardada (depois é só tirar outra) |

## Como

- **`fotosDeTarefaAguardandoService` (novo):**
  - `guardarFotosDaTarefa(id, arquivos)` guarda as fotos no IndexedDB (`pending_tarefa_images`, chave `tarefa:<id>`).
  - `fotosAguardandoDaTarefa(id)` conta as fotos guardadas da tarefa.
  - `enviarFotosDeTarefasGuardadas()` roda no fim de cada passada da sincronização com internet (`registrarPassadaExtra`). Para cada tarefa com fotos guardadas:
    1. se a criação da tarefa ainda está na fila, espera a próxima passada;
    2. sobe cada foto **uma vez** (`url_enviada` fica gravada na própria foto antes de seguir);
    3. lê as fotos que a tarefa já tem e grava a tarefa com as antigas mais as novas e um evento "Edição" no histórico (pela porta de sempre: sem resposta, a edição entra na fila);
    4. apaga as fotos guardadas.
- **`TarefasMapaPanel` e `DetalhesTarefaMapa`:** sem internet e com fotos novas, a tarefa vai pela fila e as fotos são guardadas. Com internet, nada muda: as fotos sobem antes de gravar.
- **`ResumoTarefasMapa`:** a tarefa feita sem internet e ainda não enviada (`_isOffline`) mostra "aguardando envio".
- **`VisualizadorDeFotos` (novo):** a foto em tela cheia, separada da galeria. Abre as fotos dos detalhes e as do formulário.
- **`useFotosGuardadasDaTarefa` (novo):** as fotos guardadas, com endereço local para a miniatura. Relê quando uma é guardada, enviada ou excluída.
- **`FotosTarefaGaleria`:** mostra as guardadas depois das enviadas, com o selo e o ✕ (`excluirFotoGuardada`).
- **`FormularioTarefaMapa`:**
  - as miniaturas (enviadas, guardadas e novas) abrem ao tocar, e o ✕ fica sempre visível;
  - **Tirar foto** usa `capture="environment"` e abre a câmera;
  - **Galeria** usa `multiple` para escolher várias fotos.
- **`tarefasMapaService.listarTodasAsTarefas`:** a lista do tenant, também a cópia do aparelho sem internet.

As tarefas presas no armazenamento antigo (D-PROD-319) continuam sendo resgatadas pelo próprio serviço delas. As fotos das duas origens usam chaves diferentes no mesmo lugar e não se misturam.

## Testes

| Arquivo | Casos |
|---|---|
| `tests/smoke/tarefaFotosSemInternet.test.js` | FS-01: tarefa nova com foto: a tarefa sobe, depois a foto entra nas fotos dela e sai do aparelho. FS-02: a criação ainda na fila faz a foto esperar. FS-03: se a gravação falha, a foto já enviada não sobe de novo. FS-04: as fotos antigas ficam. FS-05: sem internet nada é tentado |
| `tests/smoke/tarefasResumoMapa.test.jsx` | RS-05: "aguardando envio" |
| `tests/smoke/tarefaFotosGuardadasTela.test.jsx` | FG-01: galeria (aparece, abre em tela cheia, ✕ exclui). FG-02: formulário (toda foto abre, a guardada aparece, ✕ exclui depois de confirmar). FG-03: Tirar foto (câmera) e Galeria |

As suítes de tarefas passaram: 53 arquivos e 926 testes.

## Limites

- Se o servidor recusar a tarefa ("precisa de atenção" na Sincronização), a foto dela fica guardada até a tarefa ser corrigida ou descartada.
