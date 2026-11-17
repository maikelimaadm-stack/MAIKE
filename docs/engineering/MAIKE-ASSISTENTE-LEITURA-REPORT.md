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
