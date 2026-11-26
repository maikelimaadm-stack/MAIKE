# Tarefas, parte 3: tarefas sem internet, com as fotos guardadas (D-PROD-324)

**Data:** 2026-11-26 · **Decisão:** [D-PROD-324](./DECISIONS.md) · **Branch:** `claude/nifty-feynman-rh0kdn` · **Migration:** nenhuma · **Backend:** sem mudança

## O que o proprietário vê

Sem internet, a tarefa funciona como com internet. Criar, editar, concluir, registrar e excluir sem sinal já funcionava desde a D-PROD-319 e as partes 1 e 2. Esta parte resolve as fotos:

| Antes | Agora |
|---|---|
| Sem internet, tarefa com foto nova: "Remova as fotos e anexe quando a internet voltar" | Salva normalmente. A foto fica guardada no celular e **sobe sozinha** quando a internet volta |
| Nada mostrava o que ainda não tinha subido | O resumo marca a tarefa com **"aguardando envio"**, e os detalhes mostram **"N fotos aguardando envio"** |

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
- **`tarefasMapaService.listarTodasAsTarefas`:** a lista do tenant, também a cópia do aparelho sem internet.

As tarefas presas no armazenamento antigo (D-PROD-319) continuam sendo resgatadas pelo próprio serviço delas. As fotos das duas origens usam chaves diferentes no mesmo lugar e não se misturam.

## Testes

| Arquivo | Casos |
|---|---|
| `tests/smoke/tarefaFotosSemInternet.test.js` | FS-01: tarefa nova com foto: a tarefa sobe, depois a foto entra nas fotos dela e sai do aparelho. FS-02: a criação ainda na fila faz a foto esperar. FS-03: se a gravação falha, a foto já enviada não sobe de novo. FS-04: as fotos antigas ficam. FS-05: sem internet nada é tentado |
| `tests/smoke/tarefasResumoMapa.test.jsx` | RS-05: "aguardando envio" |

As suítes de tarefas passaram: 53 arquivos e 926 testes.

## Limites

- A foto guardada não aparece em miniatura antes de subir; aparece só a contagem.
- Se o servidor recusar a tarefa ("precisa de atenção" na Sincronização), a foto dela fica guardada até a tarefa ser corrigida ou descartada.
