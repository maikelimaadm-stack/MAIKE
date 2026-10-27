#!/usr/bin/env node
/** Gera módulos backend CRUD tenant-scoped (P5.4). */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');

const ENTITIES = [
  {
    model: 'Empresa',
    singular: 'empresa',
    folder: 'empresas',
    path: '/empresas',
    prisma: 'empresa',
    sequencia: null,
    filterFields: [],
    listLimit: false,
  },
  {
    model: 'Permissao',
    singular: 'permissao',
    folder: 'permissoes',
    path: '/permissoes',
    prisma: 'permissao',
    sequencia: null,
    filterFields: [],
    listLimit: false,
  },
  {
    model: 'Fornecedor',
    singular: 'fornecedor',
    folder: 'fornecedores',
    path: '/fornecedores',
    prisma: 'fornecedor',
    sequencia: 'Fornecedor',
    numeroField: 'numero_cadastro',
    filterFields: ['empresa_id'],
    listLimit: false,
  },
  {
    model: 'CategoriaManejo',
    singular: 'categoriaManejo',
    folder: 'categoriasManejo',
    path: '/categorias-manejo',
    prisma: 'categoriaManejo',
    sequencia: null,
    filterFields: ['empresa_id'],
    listLimit: false,
  },
  {
    model: 'Bebedouro',
    singular: 'bebedouro',
    folder: 'bebedouros',
    path: '/bebedouros',
    prisma: 'bebedouro',
    sequencia: null,
    filterFields: ['empresa_id'],
    listLimit: false,
  },
  {
    model: 'PontoSuplementacao',
    singular: 'pontoSuplementacao',
    folder: 'pontosSuplementacao',
    path: '/pontos-suplementacao',
    prisma: 'pontoSuplementacao',
    sequencia: 'PontoSuplementacao',
    numeroField: 'numero_ponto',
    filterFields: ['empresa_id'],
    listLimit: false,
  },
  {
    model: 'EstoqueLoteNota',
    singular: 'estoqueLoteNota',
    folder: 'estoqueLotesNota',
    path: '/estoque-lotes-nota',
    prisma: 'estoqueLoteNota',
    sequencia: null,
    filterFields: ['empresa_id', 'produto_id', 'local_estoque_id'],
    listLimit: false,
  },
  {
    model: 'MovimentacaoEstoque',
    singular: 'movimentacaoEstoque',
    folder: 'movimentacoesEstoque',
    path: '/movimentacoes-estoque',
    prisma: 'movimentacaoEstoque',
    sequencia: 'MovimentacaoEstoque',
    numeroField: 'numero_movimentacao',
    filterFields: ['empresa_id', 'produto_id'],
    listLimit: true,
  },
];

const notFoundCode = (model) =>
  model.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/ /g, '_').toUpperCase() + '_NOT_FOUND';

const repositoryJs = (e) => `/**
 * Repositório de ${e.model} (P5.4).
 */
import { getPrismaClient } from '../../database/prismaClient.js';

export const listarRegistros = async (clienteId, filtros = {}) => {
  const prisma = getPrismaClient();
  const where = { cliente_id: clienteId };
${e.filterFields.map((f) => `  if (filtros.${f}) where.${f} = filtros.${f};`).join('\n')}
  return prisma.${e.prisma}.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
};

export const buscarRegistro = async (clienteId, id, tx) => {
  const cliente = tx || getPrismaClient();
  return cliente.${e.prisma}.findUnique({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });
};

export const inserirRegistro = async (tx, dados) => tx.${e.prisma}.create({ data: dados });

export const atualizarRegistroPorId = async (tx, clienteId, id, dados) =>
  tx.${e.prisma}.update({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
    data: dados,
  });

export const excluirRegistroPorId = async (tx, clienteId, id) =>
  tx.${e.prisma}.delete({
    where: { cliente_id_id: { cliente_id: clienteId, id } },
  });
`;

const serviceJs = (e) => {
  const code = notFoundCode(e.model);
  return `/**
 * Serviço de ${e.model} (P5.4).
 */
import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import {
  listarRegistros,
  buscarRegistro,
  inserirRegistro,
  atualizarRegistroPorId,
  excluirRegistroPorId,
} from './${e.singular}Repository.js';

${e.sequencia ? `export const ENTIDADE_SEQUENCIA = '${e.sequencia}';` : ''}

const erroNaoEncontrado = () => new AppError('${code}', '${e.model} não encontrado');

/** @param {Record<string, unknown>} registro */
export const comoPublico = (registro) => {
  const { createdAt, updatedAt, cliente_id, ...resto } = registro;
  return {
    ...resto,
    created_date: createdAt instanceof Date ? createdAt.toISOString() : createdAt,
    updated_date: updatedAt instanceof Date ? updatedAt.toISOString() : updatedAt,
  };
};

/** @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const listar = async (contexto, filtros = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarRegistros(auth.clienteId, filtros);
  return registros.map(comoPublico);
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const criado = await prisma.$transaction(async (tx) => {
    /** @type {Record<string, unknown>} */
    const dados = { ...entrada, cliente_id: auth.clienteId };
${
  e.sequencia
    ? `    if (!dados.${e.numeroField}) {
      dados.${e.numeroField} = String(
        await reservarNumero(tx, {
          clienteId: auth.clienteId,
          entidade: ENTIDADE_SEQUENCIA,
          escopoTipo: ESCOPO_TENANT,
        })
      );
    }`
    : ''
}
    const registro = await inserirRegistro(tx, dados);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: '${e.model}', entidadeId: registro.id, dadosNovos: comoPublico(registro) },
      tx
    );
    return registro;
  });
  return comoPublico(criado);
};

export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const atualizado = await prisma.$transaction(async (tx) => {
    const existente = await buscarRegistro(auth.clienteId, id, tx);
    if (!existente) throw erroNaoEncontrado();
    const registro = await atualizarRegistroPorId(tx, auth.clienteId, id, { ...entrada });
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: '${e.model}',
        entidadeId: id,
        dadosAnteriores: comoPublico(existente),
        dadosNovos: comoPublico(registro),
      },
      tx
    );
    return registro;
  });
  return comoPublico(atualizado);
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
      { acao: 'delete', entidade: '${e.model}', entidadeId: id, dadosAnteriores: comoPublico(existente) },
      tx
    );
  });
};
`;
};

const routesJs = (e) => {
  const filterProps = e.filterFields
    .map((f) => `${f}: { type: 'string', minLength: 1, maxLength: 64 }`)
    .concat(e.listLimit ? ['limit: { type: \'integer\', minimum: 1, maximum: 5000 }'] : [])
    .join(',\n      ');

  return `/**
 * Rotas de ${e.model} (P5.4).
 */
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { listar, criar, atualizar, excluir } from './${e.singular}Service.js';

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
      ${filterProps || 'placeholder: { type: \'boolean\' }'.replace('placeholder', '_noop')}
    },
  },
};

/** @param {import('fastify').FastifyInstance} app */
export const registrar${e.model}Routes = async (app) => {
  app.get('${e.path}', { onRequest: [app.autenticar], schema: LISTAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const query = /** @type {Record<string, string>} */ (request.query ?? {});
    let registros = await listar(request.contexto, query);
${
  e.listLimit
    ? `    const limite = Number(query.limit);
    if (Number.isFinite(limite) && limite > 0) registros = registros.slice(0, limite);`
    : ''
}
    return registros;
  });

  app.post('${e.path}', { onRequest: [app.autenticar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const registro = await criar(request.contexto, /** @type {Record<string, unknown>} */ (request.body));
    return reply.status(201).send(registro);
  });

  app.patch('${e.path}/:id', { onRequest: [app.autenticar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, /** @type {Record<string, unknown>} */ (request.body));
  });

  app.delete('${e.path}/:id', { onRequest: [app.autenticar], schema: ID_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });
};
`;
};

for (const e of ENTITIES) {
  const base = join(ROOT, 'backend/src/modules', e.folder);
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, `${e.singular}Repository.js`), repositoryJs(e));
  writeFileSync(join(base, `${e.singular}Service.js`), serviceJs(e));
  writeFileSync(join(base, `${e.singular}Routes.js`), routesJs(e));
}

console.log('Generated backend modules for', ENTITIES.length, 'entities');
