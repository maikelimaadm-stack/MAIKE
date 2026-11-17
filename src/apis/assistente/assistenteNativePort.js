/**
 * Porta nativa do Assistente só de leitura (D-PROD-230), `POST /assistente/perguntar`.
 * Só online: a resposta vem da API do Claude pelo servidor; nada vai para a fila offline.
 */
import { nativeRequest } from '../_core/nativeHttpClient.js';

/** O servidor pode levar alguns ciclos de ferramenta: prazo maior que o padrão. */
const PRAZO_MS = 120_000;

/**
 * @param {{ empresa_id: string, pergunta: string, tela?: string|null, historico?: Array<{papel: 'usuario'|'assistente', texto: string}> }} dados
 * @returns {Promise<{ resposta: string, ferramentas: string[], recusada: boolean }>}
 */
export const perguntarAoAssistente = (dados) => {
  const body = { empresa_id: dados.empresa_id, pergunta: dados.pergunta };
  if (dados.tela && /^[A-Za-z0-9_-]{1,64}$/.test(dados.tela)) body.tela = dados.tela;
  if (dados.historico?.length) body.historico = dados.historico;
  return /** @type {any} */ (
    nativeRequest('/assistente/perguntar', { method: 'POST', body, autenticado: true, timeoutMs: PRAZO_MS }, { operation: 'perguntarAssistente', resource: 'Assistente' })
  );
};
