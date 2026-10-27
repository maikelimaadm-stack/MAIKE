/**
 * Rotas de Lote (P5.1, D-PROD-47).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { listar, criar, atualizar, excluir } from './loteService.js';

const MOTIVOS = ['Compra', 'Ajuste', 'Inventário', 'Outros'];
const STATUS = ['Ativo', 'Inativo', 'Vendido', 'Abatido', 'Transferido'];
const SEXOS = ['Macho', 'Fêmea', 'Misto'];

const CAMPOS_CRIACAO = Object.freeze({
  empresa_id: { type: 'string', minLength: 1, maxLength: 64, pattern: '\\S' },
  nome: { type: 'string', minLength: 1, maxLength: 255, pattern: '\\S' },
  identificador_nome: { type: ['string', 'null'], maxLength: 255 },
  identificador_sigla: { type: ['string', 'null'], maxLength: 32 },
  identificador_cor: { type: ['string', 'null'], maxLength: 32 },
  quantidade_cabecas: { type: 'integer', minimum: 0, maximum: 2147483647 },
  categoria: { type: ['string', 'null'], maxLength: 128 },
  categoria_manejo_id: { type: ['string', 'null'], maxLength: 64 },
  categoria_manejo_nome: { type: ['string', 'null'], maxLength: 255 },
  sexo: { type: ['string', 'null'], enum: [...SEXOS, null] },
  peso_medio_kg: { type: ['number', 'null'], minimum: 0, maximum: 99999999.9999 },
  idade_media_meses: { type: ['integer', 'null'], minimum: 0, maximum: 2147483647 },
  setor_id: { type: ['string', 'null'], maxLength: 64 },
  area_entrada_id: { type: ['string', 'null'], maxLength: 64 },
  area_atual_id: { type: ['string', 'null'], maxLength: 64 },
  raca_predominante: { type: ['string', 'null'], maxLength: 128 },
  sistema_produtivo: { type: ['string', 'null'], maxLength: 128 },
  data_entrada: { type: ['string', 'null'], maxLength: 32 },
  motivo_entrada: { type: 'string', enum: MOTIVOS },
  origem: { type: ['string', 'null'], maxLength: 128 },
  fornecedor_id: { type: ['string', 'null'], maxLength: 64 },
  fornecedor_nome: { type: ['string', 'null'], maxLength: 255 },
  nota_fiscal: { type: ['string', 'null'], maxLength: 64 },
  chave_nfe: { type: ['string', 'null'], maxLength: 64 },
  numero_gta: { type: ['string', 'null'], maxLength: 64 },
  cidade_origem: { type: ['string', 'null'], maxLength: 128 },
  estado_origem: { type: ['string', 'null'], maxLength: 8 },
  valor_total_compra: { type: ['number', 'null'], minimum: 0, maximum: 99999999.9999 },
  valor_por_cabeca: { type: ['number', 'null'], minimum: 0, maximum: 99999999.9999 },
  valor_frete: { type: ['number', 'null'], minimum: 0, maximum: 99999999.9999 },
  motivo_ajuste: { type: ['string', 'null'], maxLength: 255 },
  motivo_outros: { type: ['string', 'null'], maxLength: 255 },
  observacoes: { type: ['string', 'null'], maxLength: 2000 },
  status: { type: 'string', enum: STATUS },
  campos_personalizados: { type: 'object' },
});

const CAMPOS_ATUALIZACAO = Object.freeze(
  Object.fromEntries(
    Object.entries(CAMPOS_CRIACAO).filter(([campo]) => campo !== 'empresa_id' && campo !== 'area_entrada_id')
  )
);

const CRIAR_SCHEMA = {
  body: {
    type: 'object',
    required: ['empresa_id', 'nome', 'quantidade_cabecas', 'motivo_entrada'],
    additionalProperties: false,
    properties: { ...CAMPOS_CRIACAO },
  },
};

const ATUALIZAR_SCHEMA = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
  body: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: { ...CAMPOS_ATUALIZACAO },
  },
};

const EXCLUIR_SCHEMA = {
  params: {
    type: 'object',
    required: ['id'],
    additionalProperties: false,
    properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
  },
};

/** @param {unknown} corpo @returns {Record<string, unknown>} */
const corpoValidado = (corpo) => /** @type {Record<string, unknown>} */ (corpo);

/** @param {import('fastify').FastifyInstance} app */
export const registrarLoteRoutes = async (app) => {
  app.get('/lotes', { onRequest: [app.autenticar] }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listar(request.contexto);
  });

  app.post('/lotes', { onRequest: [app.autenticar], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const lote = await criar(request.contexto, corpoValidado(request.body));
    return reply.status(201).send(lote);
  });

  app.patch('/lotes/:id', { onRequest: [app.autenticar], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, corpoValidado(request.body));
  });

  app.delete('/lotes/:id', { onRequest: [app.autenticar], schema: EXCLUIR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });
};
