/**
 * Rota do Assistente só de leitura (D-PROD-230).
 *
 * Corpo fechado (`additionalProperties: false`): `cliente_id` ou qualquer chave fora
 * do schema vira 400. O tenant vem só da sessão; a fazenda é a aberta no mapa e o
 * serviço confere que ela é deste tenant. É POST porque leva a pergunta e o histórico,
 * mas não grava nada.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { perguntar } from './assistenteService.js';

const ID = { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' };

export const MAX_HISTORICO = 10;

const PERGUNTAR_SCHEMA = {
  body: {
    type: 'object',
    required: ['empresa_id', 'pergunta'],
    additionalProperties: false,
    properties: {
      empresa_id: ID,
      pergunta: { type: 'string', minLength: 1, maxLength: 1000, pattern: '\\S' },
      // Só uma dica de contexto (a tela aberta). Nunca escolhe tenant nem fazenda.
      tela: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_-]+$' },
      historico: {
        type: 'array',
        maxItems: MAX_HISTORICO,
        items: {
          type: 'object',
          required: ['papel', 'texto'],
          additionalProperties: false,
          properties: {
            papel: { type: 'string', enum: ['usuario', 'assistente'] },
            texto: { type: 'string', minLength: 1, maxLength: 4000 },
          },
        },
      },
    },
  },
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarAssistenteRoutes = async (app) => {
  app.post('/assistente/perguntar', { onRequest: [app.autenticar], schema: PERGUNTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return perguntar(request.contexto, /** @type {any} */ (request.body));
  });

  /**
   * Mesma pergunta, com a resposta chegando aos pedaços (Server-Sent Events).
   * Eventos: `ferramenta` {nome} enquanto consulta, `delta` {texto} a cada pedaço,
   * `acao` {tipo, tela, filtros, resumo, aplicar_agora} quando a IA monta um filtro de tela,
   * `fim` {resposta, ferramentas, recusada, acoes} com o texto final (o cliente troca o que
   * juntou por ele) e `erro` {code, message} com os mesmos códigos da rota acima.
   * Auth e corpo são conferidos ANTES de abrir o fluxo: 401/400 continuam JSON normal.
   */
  app.post('/assistente/perguntar/stream', { onRequest: [app.autenticar], schema: PERGUNTAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const cancelar = new AbortController();
    let aberto = true;
    reply.raw.on('close', () => {
      aberto = false;
      cancelar.abort();
    });
    reply.hijack();
    const origem = request.headers.origin;
    // Cabeçalhos que os hooks já puseram (CORS, segurança): o fluxo vai direto no `raw`.
    /** @type {Record<string, string | string[]>} */
    const cors = {};
    for (const [nome, valor] of Object.entries(reply.getHeaders())) {
      if (valor !== undefined) cors[nome] = Array.isArray(valor) ? valor.map(String) : String(valor);
    }
    reply.raw.writeHead(200, {
      ...cors,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
      ...(origem && cors['access-control-allow-origin'] ? { vary: 'Origin' } : {}),
    });
    const enviar = (evento, dados) => {
      if (!aberto) return;
      reply.raw.write(`event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`);
    };
    try {
      const resultado = await perguntar(request.contexto, /** @type {any} */ (request.body), {
        aoTexto: (texto) => enviar('delta', { texto }),
        aoFerramenta: (nome) => enviar('ferramenta', { nome }),
        aoAcao: (acao) => enviar('acao', acao),
        sinal: cancelar.signal,
      });
      enviar('fim', resultado);
    } catch (erro) {
      const conhecido = erro instanceof AppError;
      if (!conhecido) request.log.error({ err: erro }, 'assistente: falha no fluxo');
      else request.log.warn({ code: erro.code, err: erro.cause ?? erro }, 'assistente: erro no fluxo');
      enviar('erro', conhecido ? { code: erro.code, message: erro.message } : { code: 'ASSISTENTE_INDISPONIVEL', message: 'o assistente não respondeu agora' });
    } finally {
      if (aberto) reply.raw.end();
    }
  });
};
