# MAIKE-ASSISTENTE-LEITURA — relatório (D-PROD-230)

**Data:** 2026-11-17 · **Branch:** `claude/kind-knuth-tztu1v` · **Migration:** nenhuma.

## O que entrou

| Parte | Arquivos |
|---|---|
| Rota | `backend/src/modules/assistente/assistenteRoutes.js` (`POST /assistente/perguntar`, corpo fechado) |
| Laço da IA | `backend/src/modules/assistente/assistenteService.js` (Claude `claude-opus-5-5`, até 8 voltas, recusa e falhas tratadas) |
| Ferramentas | `backend/src/modules/assistente/assistenteFerramentas.js` (5 leituras fechadas sobre os serviços existentes) |
| Erros | `ASSISTENTE_NAO_CONFIGURADO`, `ASSISTENTE_INDISPONIVEL` (503) no backend e no catálogo do frontend |
| Tela | `src/components/assistente/AssistenteFlutuante.jsx` montado uma vez em `src/Layout.jsx`; porta `src/apis/assistente/assistenteNativePort.js` |
| Dependência | `@anthropic-ai/sdk` 1.10.0 (versão exata) |

## Garantias testadas

`backend/tests/assistenteLeitura.test.mjs` (PostgreSQL real, API falsa):
- as ferramentas são só as 5 de leitura; nome de ferramenta desconhecido não executa nada;
- dois tenants: a IA de A só recebe o pasto de A; pedir o pasto de B pelo id devolve vazio; nenhum pedido à API contém dado de B;
- `cliente_id` no corpo → 400; fazenda de outro tenant → recusada antes de chamar a IA; sem login → 401;
- contagens de medições, áreas e auditoria iguais antes e depois (nada gravado);
- histórico limitado (11 falas → 400, papel inválido → 400) e repassado na ordem; `tela` validada e repassada;
- sem `ANTHROPIC_API_KEY` → 503 `ASSISTENTE_NAO_CONFIGURADO`; falha da API → 503 `ASSISTENTE_INDISPONIVEL`;
- recusa da IA → resposta amigável com `recusada: true`; o laço para em 8 voltas;
- a estimativa por descanso é a mesma regra da tela (D-PROD-223).

`tests/smoke/assistenteFlutuante.test.jsx`: botão abre o painel; pergunta vai com fazenda, tela e histórico; conversa sobrevive a fechar/reabrir e à troca de tela; erro "não configurado" aparece; sem fazenda não chama o servidor; o Layout monta o assistente uma vez.

## Para ligar em produção

1. Vercel → projeto → Settings → Environment Variables: `ANTHROPIC_API_KEY` = a chave do proprietário, ambiente **Production**.
2. Novo deploy (variável nova só vale em deploy novo).
3. Recomendado: limite de gasto mensal no console da Anthropic.

## Ressalvas

- Cada pergunta manda à Anthropic a pergunta, o histórico curto e os dados das ferramentas usadas.
- A conversa some ao recarregar a página (não é salva).
- A regra de forragem do servidor é espelho da tela (`src/domain/pastagem/farolForragem.js`); se uma mudar, a outra muda junto (teste de espelho cobre a estimativa).

## Ajuste pós-release (2026-11-17)
- Produção recusou a chave do proprietário: chave da organização sem workspace (400 "This API key is not scoped to a workspace"). Nova variável opcional `ANTHROPIC_WORKSPACE_ID` (o id `wrkspc_…`, não é segredo): quando presente, o cliente envia o cabeçalho `anthropic-workspace-id`. Chave criada dentro de um workspace dispensa a variável.
- O `nativeHttpClient` tratava todo 503 como "Serviço de dados indisponível"; 503 do backend com código `ASSISTENTE_*` agora mostra a mensagem do assistente (`tests/smoke/nativeHttpClientAssistente.test.js`).
- Formato das respostas: o painel mostrava `**` crus. `TextoAssistente.jsx` renderiza negrito e listas sem HTML (React só com texto); o prompt pede resposta direta primeiro, listas curtas, sem tabelas/títulos/emojis e números no padrão brasileiro (`tests/smoke/textoAssistente.test.jsx`).
- Rapidez: esforço de raciocínio `low`, `max_tokens` 4000 e instrução para pedir várias ferramentas de uma vez.

## Resposta aos pedaços e perguntas de volta (2026-11-17)
- Rota nova `POST /assistente/perguntar/stream` (mesma auth, mesmo schema fechado, mesmo prazo de 50 s e mesma recusa): resposta em Server-Sent Events — `ferramenta` {nome}, `delta` {texto}, `fim` {resposta, ferramentas, recusada}, `erro` {code, message}. Auth e corpo são conferidos antes de abrir o fluxo (401/400 continuam JSON). Usa `cliente.beta.messages.stream()` + `.on('text')` + `finalMessage()` dentro do mesmo laço de ferramentas; a rota sem fluxo continua igual. Cabeçalhos `text/event-stream`, `cache-control: no-store, no-transform`, `x-accel-buffering: no`. Fechar a conexão cancela a chamada à API.
- Cliente: `nativeStream` (mesmas regras de URL, token e erros HTTP do `nativeRequest`) lê o SSE; o painel mostra o texto chegando, uma linha de status por consulta ("Consultando os pastos…") e um botão "Parar". Se o fluxo falhar antes do primeiro byte (rede, proxy que não deixa o fluxo passar), repete pela rota sem fluxo.
- Prompt: pergunta ambígua (qual pasto, lote, categoria, período, mais de uma leitura) recebe UMA pergunta de volta com 2 a 4 opções em vez de chute; pode terminar oferecendo o próximo passo em uma frase; não escreve nada antes de pedir ferramentas.
- Modelo inalterado (`claude-opus-5-5`, esforço `low`).
- Testes: `backend/tests/assistenteLeitura.test.mjs` (15: ordem dos eventos, isolamento entre tenants, auth antes do fluxo, recusa e erro no fluxo), `tests/smoke/assistenteFluxo.test.js` (leitor SSE com cortes no meio do evento, erro com código, volta para a rota sem fluxo), `tests/smoke/assistenteFlutuante.test.jsx` (texto aos pedaços, status, Parar).

## Filtros, agrupamento e calculadora (2026-11-17)
Pedido do proprietário: o assistente pode fazer contas e filtrar o sistema. Continua só de leitura, mesmo modelo.
- Filtros opcionais e fechados por schema (`additionalProperties: false`), aplicados em memória sobre dados já do tenant e da fazenda — nada vira SQL:
  - `listar_pastos`: nome, setor, cultura, situacao (lista), ocupado, hectares_min/max, cabecas_min/max, ordenar_por (nome, setor, hectares, cabecas, dias_descanso, dias_desde_saida), ordem, limite (≤300). Resposta `{ total, mostrados, cortado, pastos }`.
  - `rebanho_por_pasto`: nome, categoria, sexo, pasto, cabecas_min/max, peso_min/max, dias_no_pasto_min/max, acima_do_objetivo, ordenar_por, ordem, limite. Resposta `{ total, mostrados, cortado, cabecas_no_filtro, lotes }`; cada lote ganha `dias_no_pasto`.
  - `medicoes_do_pasto`: data_de/data_ate; `leituras_cocho_recentes`: cocho, escore, data_de/data_ate.
  - Texto compara sem acento e sem caixa ("contém").
- `resumo_agrupado`: rebanho por categoria/sexo/pasto (lotes, cabeças, peso médio ponderado, peso total) ou pastos por setor/situação/cultura (pastos, hectares, cabeças) — contas feitas no servidor.
- `calcular`: analisador aritmético próprio (`assistenteFiltros.js`, sem `eval`/`Function`): números, + − × ÷ % ^, parênteses e as funções soma, media, media_ponderada, minimo, maximo, arred, pct, raiz, abs; várias contas por chamada; limites de tamanho e profundidade.
- Entrada fora do schema volta para a IA como erro da ferramenta (`is_error`), sem derrubar a pergunta.
- Prompt: usar filtros, avisar quando "cortado", usar `calcular`/`resumo_agrupado` para toda conta, fórmulas de UA, lotação e GMD.
- Testes: `backend/tests/assistenteLeitura.test.mjs` (20): filtros e isolamento entre tenants, parâmetros inválidos, agrupamento, calculadora e recusa do que não é conta.
