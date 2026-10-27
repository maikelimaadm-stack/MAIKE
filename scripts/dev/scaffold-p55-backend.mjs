#!/usr/bin/env node
/**
 * Gera módulos backend P5.5 (documento JSON) — uso único de scaffold.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

const ENTITIES = [
  { model: 'MovimentacaoMapa', route: '/movimentacoes-mapa', folder: 'movimentacoesMapa', bulk: false },
  { model: 'MovimentacaoPecuaria', route: '/movimentacoes-pecuaria', folder: 'movimentacoesPecuaria', bulk: false },
  { model: 'SuplementacaoEvento', route: '/suplementacao-eventos', folder: 'suplementacaoEventos', bulk: false },
  { model: 'SuplementacaoLote', route: '/suplementacao-lotes', folder: 'suplementacaoLotes', bulk: true },
  { model: 'AplicacaoMedicamento', route: '/aplicacoes-medicamento', folder: 'aplicacoesMedicamento', bulk: false },
  { model: 'EventoSanitario', route: '/eventos-sanitarios', folder: 'eventosSanitarios', bulk: false },
  { model: 'ManejoTecnicoRebanho', route: '/manejos-tecnico-rebanho', folder: 'manejosTecnicoRebanho', bulk: false },
  { model: 'BebedouroHistorico', route: '/bebedouros-historico', folder: 'bebedourosHistorico', bulk: false },
  { model: 'BebedouroSanidade', route: '/bebedouros-sanidade', folder: 'bebedourosSanidade', bulk: false },
  { model: 'BebedouroAlerta', route: '/bebedouros-alertas', folder: 'bebedourosAlertas', bulk: false },
];

const prismaDelegate = (model) => model.charAt(0).toLowerCase() + model.slice(1);

const repositoryJs = (model, delegate) => `/**
 * Repositório de ${model} (P5.5).
 */
import { getPrismaClient } from '../../database/prismaClient.js';

export const listarRegistros = async (clienteId, filtros = {}) => {
  const prisma = getPrismaClient();
  const where = { cliente_id: clienteId };
  if (filtros.empresa_id) where.empresa_id = filtros.empresa_id;
  return prisma.${delegate}.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
};

export const buscarRegistro = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.${delegate}.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });
};

export const inserirRegistro = async (tx, dados) => tx.${delegate}.create({ data: dados });

export const inserirRegistros = async (tx, lista) =>
  tx.${delegate}.createMany({ data: lista });

export const atualizarRegistroPorId = async (tx, clienteId, id, dados) =>
  tx.${delegate}.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
  });

export const excluirRegistroPorId = async (tx, clienteId, id) =>
  tx.${delegate}.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });
`;

const serviceJs = (model) => `/**
 * Serviço de ${model} (P5.5).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { documentoComoPublico, montarDocumento } from '../../shared/jsonDocument/jsonDocumentPublic.js';
import {
  listarRegistros,
  buscarRegistro,
  inserirRegistro,
  inserirRegistros,
  atualizarRegistroPorId,
  excluirRegistroPorId,
} from './${model.charAt(0).toLowerCase() + model.slice(1)}Repository.js';

const ENTIDADE = '${model}';
const erroNaoEncontrado = () => new AppError('${model.toUpperCase()}_NOT_FOUND', '${model} não encontrado');

export const listar = async (contexto, filtros = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarRegistros(auth.clienteId, filtros);
  return registros.map(documentoComoPublico);
};

export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const criado = await prisma.$transaction(async (tx) => {
    const dados = montarDocumento(auth.clienteId, entrada);
    const registro = await inserirRegistro(tx, dados);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: ENTIDADE, entidadeId: registro.id, dadosNovos: documentoComoPublico(registro) },
      tx
    );
    return registro;
  });
  return documentoComoPublico(criado);
};

export const criarEmLote = async (contexto, registros) => {
  const auth = exigirAuthContext(contexto?.auth);
  if (!Array.isArray(registros) || registros.length === 0) {
    throw new AppError('VALIDATION_FAILED', 'lista vazia');
  }
  const prisma = getPrismaClient();
  const criados = await prisma.$transaction(async (tx) => {
    const saida = [];
    for (const entrada of registros) {
      const dados = montarDocumento(auth.clienteId, entrada);
      const registro = await inserirRegistro(tx, dados);
      saida.push(registro);
    }
    return saida;
  });
  return criados.map(documentoComoPublico);
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const atualizado = await prisma.$transaction(async (tx) => {
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    const patch = montarDocumento(auth.clienteId, { ...documentoComoPublico(existente), ...entrada }, { atualizacao: true, id });
    const registro = await atualizarRegistroPorId(tx, auth.clienteId, id, patch);
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: ENTIDADE,
        entidadeId: id,
        dadosAnteriores: documentoComoPublico(existente),
        dadosNovos: documentoComoPublico(registro),
      },
      tx
    );
    return registro;
  });
  return documentoComoPublico(atualizado);
};

export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  await prisma.$transaction(async (tx) => {
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    await excluirRegistroPorId(tx, auth.clienteId, id);
    await registrarEvento(
      contexto,
      { acao: 'delete', entidade: ENTIDADE, entidadeId: id, dadosAnteriores: documentoComoPublico(existente) },
      tx
    );
  });
};
`;

const routesJs = (model, route, bulk) => {
  const bulkRoute = bulk
    ? `
  app.post('${route}/bulk', { onRequest: [app.autenticar], schema: BULK_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const body = /** @type {{registros: object[]}} */ (request.body);
    const lista = await criarEmLote(request.contexto, body.registros);
    return reply.status(201).send(lista);
  });`
    : '';
  const bulkImport = bulk ? ', criarEmLote' : '';
  const bulkSchema = bulk
    ? `
const BULK_SCHEMA = {
  body: {
    type: 'object',
    required: ['registros'],
    additionalProperties: false,
    properties: {
      registros: { type: 'array', items: { type: 'object' }, minItems: 1 },
    },
  },
};`
    : '';

  return `/**
 * Rotas de ${model} (P5.5).
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { listar, criar, atualizar, excluir${bulkImport} } from './${model.charAt(0).toLowerCase() + model.slice(1)}Service.js';

const ID_SCHEMA = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
};

const CRIAR_SCHEMA = {
  body: { type: 'object', additionalProperties: true, minProperties: 1 },
};

const ATUALIZAR_SCHEMA = {
  ...ID_SCHEMA,
  body: { type: 'object', additionalProperties: true, minProperties: 1 },
};

const LISTAR_SCHEMA = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      empresa_id: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
};
${bulkSchema}

/** @param {import('fastify').FastifyInstance} app */
export const registrar${model}Routes = async (app) => {
  app.get('${route}', { onRequest: [app.autenticar], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const query = /** @type {Record<string, string>} */ (request.query ?? {});
    return listar(request.contexto, query);
  });

  app.post('${route}', { onRequest: [app.autenticar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const registro = await criar(request.contexto, /** @type {Record<string, unknown>} */ (request.body));
    return reply.status(201).send(registro);
  });

  app.patch('${route}/:id', { onRequest: [app.autenticar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, /** @type {Record<string, unknown>} */ (request.body));
  });

  app.delete('${route}/:id', { onRequest: [app.autenticar], schema: ID_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });${bulkRoute}
};
`;
};

for (const ent of ENTITIES) {
  const delegate = prismaDelegate(ent.model);
  const repoName = ent.model.charAt(0).toLowerCase() + ent.model.slice(1);
  const dir = join(ROOT, 'backend/src/modules', ent.folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${repoName}Repository.js`), repositoryJs(ent.model, delegate));
  writeFileSync(join(dir, `${repoName}Service.js`), serviceJs(ent.model));
  writeFileSync(join(dir, `${repoName}Routes.js`), routesJs(ent.model, ent.route, ent.bulk));
}

console.log(`Scaffolded ${ENTITIES.length} backend modules.`);
