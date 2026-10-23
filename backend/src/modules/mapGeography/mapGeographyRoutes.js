/**
 * Rotas de geografia do mapa (P4.3, D-PROD-32): ConfiguracaoIcone,
 * PontoReferencia e LinhaGeografica.
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import {
  listar as listarIcones,
  criar as criarIcone,
  atualizar as atualizarIcone,
} from './configuracaoIconeService.js';
import {
  listar as listarPontos,
  criar as criarPonto,
  atualizar as atualizarPonto,
  excluir as excluirPonto,
} from './pontoReferenciaService.js';
import {
  listar as listarLinhas,
  criar as criarLinha,
  atualizar as atualizarLinha,
} from './linhaGeograficaService.js';

const TIPOS_ENTIDADE_ICONE = [
  'Ponto',
  'Area',
  'Lote',
  'Linha',
  'Prioridade Tarefa',
  'Icone Menu Mobile',
];

const TIPOS_LINHA = ['Estrada', 'Cerca', 'Cerca Elétrica', 'Rio', 'Córrego', 'Outro'];

const PARAM_ID = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: { id: { type: 'string', minLength: 1, maxLength: 64, pattern: '\\S' } },
};

/** @param {unknown} corpo @returns {Record<string, unknown>} */
const corpoValidado = (corpo) => /** @type {Record<string, unknown>} */ (corpo);

const CAMPOS_ICONE = Object.freeze({
  empresa_id: { type: ['string', 'null'], maxLength: 64 },
  tipo_entidade: { type: 'string', enum: TIPOS_ENTIDADE_ICONE },
  categoria: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  icone_url: { type: ['string', 'null'], maxLength: 1024 },
  sub_icone_url: { type: ['string', 'null'], maxLength: 1024 },
  cor_padrao: { type: ['string', 'null'], maxLength: 32 },
  descricao: { type: ['string', 'null'], maxLength: 2000 },
  categorias_misto: { type: ['array', 'null'], items: { type: 'string' } },
  ativo: { type: 'boolean' },
});

const CRIAR_ICONE_SCHEMA = {
  body: {
    type: 'object',
    required: ['tipo_entidade', 'categoria'],
    additionalProperties: false,
    properties: { ...CAMPOS_ICONE },
  },
};

const ATUALIZAR_ICONE_SCHEMA = {
  params: PARAM_ID,
  body: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: { ...CAMPOS_ICONE },
  },
};

const CAMPOS_PONTO = Object.freeze({
  empresa_id: { type: 'string', minLength: 1, maxLength: 64, pattern: '\\S' },
  nome: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  sigla: { type: ['string', 'null'], maxLength: 32 },
  tipo: { type: 'string', minLength: 1, maxLength: 128, pattern: '\\S' },
  configuracao_icone_id: { type: ['string', 'null'], maxLength: 64 },
  icone_url: { type: ['string', 'null'], maxLength: 1024 },
  sub_icone_url: { type: ['string', 'null'], maxLength: 1024 },
  coordenadas: { type: ['object', 'null'] },
  cor: { type: ['string', 'null'], maxLength: 32 },
  observacoes: { type: ['string', 'null'], maxLength: 2000 },
  ativo: { type: 'boolean' },
});

const CAMPOS_PONTO_EDIT = Object.freeze(
  Object.fromEntries(Object.entries(CAMPOS_PONTO).filter(([c]) => c !== 'empresa_id'))
);

const CRIAR_PONTO_SCHEMA = {
  body: {
    type: 'object',
    required: ['empresa_id', 'nome', 'tipo'],
    additionalProperties: false,
    properties: { ...CAMPOS_PONTO },
  },
};

const ATUALIZAR_PONTO_SCHEMA = {
  params: PARAM_ID,
  body: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: { ...CAMPOS_PONTO_EDIT },
  },
};

const CAMPOS_LINHA = Object.freeze({
  empresa_id: { type: 'string', minLength: 1, maxLength: 64, pattern: '\\S' },
  nome: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  sigla: { type: ['string', 'null'], maxLength: 32 },
  tipo: { type: 'string', enum: TIPOS_LINHA },
  coordenadas: { type: ['object', 'null'] },
  comprimento_metros: { type: ['number', 'null'], minimum: 0, maximum: 99999999.9999 },
  cor: { type: ['string', 'null'], maxLength: 32 },
  observacoes: { type: ['string', 'null'], maxLength: 2000 },
  ativo: { type: 'boolean' },
});

const CAMPOS_LINHA_EDIT = Object.freeze(
  Object.fromEntries(Object.entries(CAMPOS_LINHA).filter(([c]) => c !== 'empresa_id'))
);

const CRIAR_LINHA_SCHEMA = {
  body: {
    type: 'object',
    required: ['empresa_id', 'nome', 'tipo'],
    additionalProperties: false,
    properties: { ...CAMPOS_LINHA },
  },
};

const ATUALIZAR_LINHA_SCHEMA = {
  params: PARAM_ID,
  body: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: { ...CAMPOS_LINHA_EDIT },
  },
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarMapGeographyRoutes = async (app) => {
  app.get('/configuracao-icones', { onRequest: [app.autenticar] }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listarIcones(request.contexto);
  });

  app.post(
    '/configuracao-icones',
    { onRequest: [app.autenticar], schema: CRIAR_ICONE_SCHEMA },
    async (request, reply) => {
      exigirAuthContext(request.contexto.auth);
      const icone = await criarIcone(request.contexto, corpoValidado(request.body));
      return reply.status(201).send(icone);
    }
  );

  app.patch(
    '/configuracao-icones/:id',
    { onRequest: [app.autenticar], schema: ATUALIZAR_ICONE_SCHEMA },
    async (request) => {
      exigirAuthContext(request.contexto.auth);
      const { id } = /** @type {{id: string}} */ (request.params);
      return atualizarIcone(request.contexto, id, corpoValidado(request.body));
    }
  );

  app.get('/pontos-referencia', { onRequest: [app.autenticar] }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listarPontos(request.contexto);
  });

  app.post(
    '/pontos-referencia',
    { onRequest: [app.autenticar], schema: CRIAR_PONTO_SCHEMA },
    async (request, reply) => {
      exigirAuthContext(request.contexto.auth);
      const ponto = await criarPonto(request.contexto, corpoValidado(request.body));
      return reply.status(201).send(ponto);
    }
  );

  app.patch(
    '/pontos-referencia/:id',
    { onRequest: [app.autenticar], schema: ATUALIZAR_PONTO_SCHEMA },
    async (request) => {
      exigirAuthContext(request.contexto.auth);
      const { id } = /** @type {{id: string}} */ (request.params);
      return atualizarPonto(request.contexto, id, corpoValidado(request.body));
    }
  );

  app.delete(
    '/pontos-referencia/:id',
    { onRequest: [app.autenticar], schema: { params: PARAM_ID } },
    async (request, reply) => {
      exigirAuthContext(request.contexto.auth);
      const { id } = /** @type {{id: string}} */ (request.params);
      const removido = await excluirPonto(request.contexto, id);
      return reply.status(200).send(removido);
    }
  );

  app.get('/linhas-geograficas', { onRequest: [app.autenticar] }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listarLinhas(request.contexto);
  });

  app.post(
    '/linhas-geograficas',
    { onRequest: [app.autenticar], schema: CRIAR_LINHA_SCHEMA },
    async (request, reply) => {
      exigirAuthContext(request.contexto.auth);
      const linha = await criarLinha(request.contexto, corpoValidado(request.body));
      return reply.status(201).send(linha);
    }
  );

  app.patch(
    '/linhas-geograficas/:id',
    { onRequest: [app.autenticar], schema: ATUALIZAR_LINHA_SCHEMA },
    async (request) => {
      exigirAuthContext(request.contexto.auth);
      const { id } = /** @type {{id: string}} */ (request.params);
      return atualizarLinha(request.contexto, id, corpoValidado(request.body));
    }
  );
};
