/**
 * Porta nativa do Assistente só de leitura (D-PROD-230), `POST /assistente/perguntar`.
 * Só online: a resposta vem da API do Claude pelo servidor; nada vai para a fila offline.
 */
import { nativeRequest, nativeStream } from '../_core/nativeHttpClient.js';

/** O servidor pode levar alguns ciclos de ferramenta: prazo maior que o padrão. */
const PRAZO_MS = 120_000;

/** @param {{ tela?: string|null, empresa_id: string, pergunta: string, historico?: Array<{papel: 'usuario'|'assistente', texto: string}> }} dados */
const corpoDe = (dados) => {
  const body = { empresa_id: dados.empresa_id, pergunta: dados.pergunta };
  if (dados.tela && /^[A-Za-z0-9_-]{1,64}$/.test(dados.tela)) body.tela = dados.tela;
  if (dados.historico?.length) body.historico = dados.historico;
  return body;
};

/**
 * @param {{ empresa_id: string, pergunta: string, tela?: string|null, historico?: Array<{papel: 'usuario'|'assistente', texto: string}> }} dados
 * @param {{ signal?: AbortSignal }} [opcoes]
 * @returns {Promise<{ resposta: string, ferramentas: string[], recusada: boolean }>}
 */
export const perguntarAoAssistente = (dados, opcoes = {}) => {
  const body = corpoDe(dados);
  return /** @type {any} */ (
    nativeRequest('/assistente/perguntar', { method: 'POST', body, autenticado: true, timeoutMs: PRAZO_MS, signal: opcoes.signal }, { operation: 'perguntarAssistente', resource: 'Assistente' })
  );
};

/**
 * A mesma pergunta pela rota com fluxo (`/assistente/perguntar/stream`): `aoTexto` recebe
 * cada pedaço, `aoFerramenta` o nome da consulta em andamento. Resolve com o resultado
 * final (o mesmo formato da rota sem fluxo).
 * @param {Parameters<typeof perguntarAoAssistente>[0]} dados
 * @param {{ aoTexto?: (t: string) => void, aoFerramenta?: (nome: string) => void, signal?: AbortSignal }} [opcoes]
 * @returns {Promise<{ resposta: string, ferramentas: string[], recusada: boolean }>}
 */
export const perguntarAoAssistenteAoVivo = async (dados, opcoes = {}) => {
  let final = null;
  let recebeu = false;
  await nativeStream(
    '/assistente/perguntar/stream',
    { body: corpoDe(dados), signal: opcoes.signal },
    { operation: 'perguntarAssistente', resource: 'Assistente' },
    ({ evento, dados: d }) => {
      recebeu = true;
      if (evento === 'delta' && typeof d?.texto === 'string') opcoes.aoTexto?.(d.texto);
      else if (evento === 'ferramenta' && typeof d?.nome === 'string') opcoes.aoFerramenta?.(d.nome);
      else if (evento === 'fim') final = d;
    },
  );
  if (!final) throw Object.assign(new Error('fluxo terminou sem resposta final'), { recebeuAlgo: recebeu });
  return final;
};
