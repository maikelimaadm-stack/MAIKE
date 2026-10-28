import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { exigirOperadorProduto } from '../../shared/auth/exigirOperadorProduto.js';
import {
  criarCategoria,
  criarIcone,
  criarRegraMisto,
  criarTipo,
  atualizarTipo,
  desativarIcone,
  listarCategoriasPublicadas,
  listarIconesPublicados,
  listarRegrasMistoPublicadas,
  listarTiposPublicados,
  obterManifesto,
  publicarIcone,
  publicarRegraMisto,
  registrarAsset,
} from './catalogoGlobalService.js';

const PREFIX = '/catalogo-global';

const CRIAR_TIPO = {
  body: {
    type: 'object',
    required: ['codigo', 'nome'],
    additionalProperties: false,
    properties: {
      codigo: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z0-9_]+$' },
      nome: { type: 'string', minLength: 1, maxLength: 255 },
      ordem: { type: 'integer', minimum: 0, maximum: 999999 },
      ativo: { type: 'boolean' },
    },
  },
};

const ATUALIZAR_TIPO = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      nome: { type: 'string', minLength: 1, maxLength: 255 },
      ordem: { type: 'integer', minimum: 0, maximum: 999999 },
      ativo: { type: 'boolean' },
      revisao_esperada: { type: 'integer', minimum: 0 },
    },
  },
};

const CRIAR_CATEGORIA = {
  body: {
    type: 'object',
    required: ['tipo_id', 'codigo', 'nome'],
    additionalProperties: false,
    properties: {
      tipo_id: { type: 'string', minLength: 1, maxLength: 64 },
      codigo: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-z0-9_]+$' },
      nome: { type: 'string', minLength: 1, maxLength: 255 },
      ordem: { type: 'integer', minimum: 0, maximum: 999999 },
      ativo: { type: 'boolean' },
    },
  },
};

const ASSET_UPLOAD = {
  body: {
    type: 'object',
    required: ['conteudo_base64', 'mime_type'],
    additionalProperties: false,
    properties: {
      conteudo_base64: { type: 'string', minLength: 1 },
      mime_type: { type: 'string', minLength: 3, maxLength: 128 },
    },
  },
};

const CRIAR_ICONE = {
  body: {
    type: 'object',
    required: ['tipo_id', 'categoria_id'],
    additionalProperties: false,
    properties: {
      tipo_id: { type: 'string', minLength: 1, maxLength: 64 },
      categoria_id: { type: 'string', minLength: 1, maxLength: 64 },
      asset_principal_id: { type: ['string', 'null'], minLength: 1, maxLength: 64 },
      asset_subicone_id: { type: ['string', 'null'], minLength: 1, maxLength: 64 },
      cor_fallback: { type: ['string', 'null'], maxLength: 32 },
    },
  },
};

const PUBLICAR = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    properties: { revisao_esperada: { type: 'integer', minimum: 0 } },
  },
};

const CRIAR_REGRA = {
  body: {
    type: 'object',
    required: ['tipo_id', 'icone_id', 'categoria_ids'],
    additionalProperties: false,
    properties: {
      tipo_id: { type: 'string', minLength: 1, maxLength: 64 },
      icone_id: { type: 'string', minLength: 1, maxLength: 64 },
      categoria_ids: {
        type: 'array',
        minItems: 2,
        maxItems: 32,
        items: { type: 'string', minLength: 1, maxLength: 64 },
      },
      prioridade: { type: 'integer', minimum: 0, maximum: 999999 },
    },
  },
};

/** @param {import('fastify').FastifyInstance} app */
export const registrarCatalogoGlobalRoutes = async (app) => {
  app.get(`${PREFIX}/manifest`, { onRequest: [app.autenticar] }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const manifesto = await obterManifesto();
    reply.header('etag', manifesto.etag);
    return manifesto;
  });

  app.get(`${PREFIX}/tipos`, { onRequest: [app.autenticar] }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listarTiposPublicados();
  });

  app.get(`${PREFIX}/categorias`, { onRequest: [app.autenticar] }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const query = /** @type {{ tipo_id?: string }} */ (request.query ?? {});
    const tipo_id = typeof query.tipo_id === 'string' ? query.tipo_id : undefined;
    return listarCategoriasPublicadas({ tipo_id });
  });

  app.get(`${PREFIX}/icones`, { onRequest: [app.autenticar] }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listarIconesPublicados();
  });

  app.get(`${PREFIX}/regras-misto`, { onRequest: [app.autenticar] }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listarRegrasMistoPublicadas();
  });

  const adminGuard = [app.autenticar, exigirOperadorProduto];

  app.post(`${PREFIX}/admin/tipos`, { onRequest: adminGuard, schema: CRIAR_TIPO }, async (request, reply) => {
    const operador = request.contexto.operadorProduto;
    const criado = await criarTipo({
      dados: /** @type {any} */ (request.body),
      operador,
      requestId: request.contexto.requestId,
    });
    return reply.status(201).send(criado);
  });

  app.patch(
    `${PREFIX}/admin/tipos/:id`,
    { onRequest: adminGuard, schema: ATUALIZAR_TIPO },
    async (request) => {
      const operador = request.contexto.operadorProduto;
      const { id } = /** @type {{id: string}} */ (request.params);
      const body = /** @type {any} */ (request.body);
      return atualizarTipo({
        id,
        dados: body,
        revisaoEsperada: body.revisao_esperada,
        operador,
        requestId: request.contexto.requestId,
      });
    }
  );

  app.post(
    `${PREFIX}/admin/categorias`,
    { onRequest: adminGuard, schema: CRIAR_CATEGORIA },
    async (request, reply) => {
      const operador = request.contexto.operadorProduto;
      const criada = await criarCategoria({
        dados: /** @type {any} */ (request.body),
        operador,
        requestId: request.contexto.requestId,
      });
      return reply.status(201).send(criada);
    }
  );

  app.post(
    `${PREFIX}/admin/assets`,
    { onRequest: adminGuard, schema: ASSET_UPLOAD },
    async (request, reply) => {
      const operador = request.contexto.operadorProduto;
      const { conteudo_base64, mime_type } = /** @type {{conteudo_base64: string, mime_type: string}} */ (
        request.body
      );
      const buffer = Buffer.from(conteudo_base64, 'base64');
      const registro = await registrarAsset({
        buffer,
        mimeDeclarado: mime_type,
        operador,
        requestId: request.contexto.requestId,
      });
      return reply.status(201).send(registro);
    }
  );

  app.post(`${PREFIX}/admin/icones`, { onRequest: adminGuard, schema: CRIAR_ICONE }, async (request, reply) => {
    const operador = request.contexto.operadorProduto;
    const criado = await criarIcone({
      dados: /** @type {any} */ (request.body),
      operador,
      requestId: request.contexto.requestId,
    });
    return reply.status(201).send(criado);
  });

  app.post(
    `${PREFIX}/admin/icones/:id/publicar`,
    { onRequest: adminGuard, schema: PUBLICAR },
    async (request) => {
      const operador = request.contexto.operadorProduto;
      const { id } = /** @type {{id: string}} */ (request.params);
      const body = /** @type {any} */ (request.body) ?? {};
      return publicarIcone({
        id,
        revisaoEsperada: body.revisao_esperada,
        operador,
        requestId: request.contexto.requestId,
      });
    }
  );

  app.post(
    `${PREFIX}/admin/icones/:id/desativar`,
    { onRequest: adminGuard, schema: PUBLICAR },
    async (request) => {
      const operador = request.contexto.operadorProduto;
      const { id } = /** @type {{id: string}} */ (request.params);
      return desativarIcone({
        id,
        operador,
        requestId: request.contexto.requestId,
      });
    }
  );

  app.post(
    `${PREFIX}/admin/regras-misto`,
    { onRequest: adminGuard, schema: CRIAR_REGRA },
    async (request, reply) => {
      const operador = request.contexto.operadorProduto;
      const criada = await criarRegraMisto({
        dados: /** @type {any} */ (request.body),
        operador,
        requestId: request.contexto.requestId,
      });
      return reply.status(201).send(criada);
    }
  );

  app.post(
    `${PREFIX}/admin/regras-misto/:id/publicar`,
    { onRequest: adminGuard, schema: PUBLICAR },
    async (request) => {
      const operador = request.contexto.operadorProduto;
      const { id } = /** @type {{id: string}} */ (request.params);
      const body = /** @type {any} */ (request.body) ?? {};
      return publicarRegraMisto({
        id,
        revisaoEsperada: body.revisao_esperada,
        operador,
        requestId: request.contexto.requestId,
      });
    }
  );
};
