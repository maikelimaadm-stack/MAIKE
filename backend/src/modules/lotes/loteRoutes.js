/**
 * Rotas de Lote (P5.1, D-PROD-47).
 */

import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { listar, criar, atualizar, excluir, buscarPorId, elegibilidadeExclusao, comoLotePublico } from './loteService.js';
import { elegibilidadeCorrecaoEntrada, corrigirEntradaLote, CAMPOS_ADMINISTRATIVOS_DA_ENTRADA } from './loteCorrecaoEntradaService.js';
import { autorizar, porTela, telaPermite, mapaPermite, TELAS } from '../../shared/auth/autorizacaoTela.js';

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
    properties: {
      ...CAMPOS_ATUALIZACAO,
      // R2A-R1 (D-PROD-99a): compare-and-swap dos campos de saldo/posição.
      estado_esperado: {
        type: 'object',
        additionalProperties: false,
        properties: {
          quantidade_cabecas: { type: ['integer', 'null'] },
          status: { type: ['string', 'null'], maxLength: 32 },
          area_atual_id: { type: ['string', 'null'], maxLength: 64 },
          categoria: { type: ['string', 'null'], maxLength: 128 },
        },
      },
    },
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

/** R1 — correção atômica da entrada original (contrato fechado; o serviço revalida tudo). */
const CORRIGIR_ENTRADA_SCHEMA = {
  params: EXCLUIR_SCHEMA.params,
  body: {
    type: 'object',
    required: ['operation_id', 'motivo', 'estado_esperado', 'campos'],
    additionalProperties: false,
    properties: {
      operation_id: { type: 'string', minLength: 1, maxLength: 128 },
      motivo: { type: 'string', minLength: 1, maxLength: 500, pattern: '\\S' },
      estado_esperado: {
        type: 'object',
        required: ['updated_date'],
        additionalProperties: false,
        properties: { updated_date: { type: 'string', minLength: 1, maxLength: 40 } },
      },
      campos: {
        type: 'object',
        minProperties: 1,
        additionalProperties: false,
        properties: {
          quantidade: { type: 'integer', minimum: 1, maximum: 2147483647 },
          peso_entrada_kg: { type: ['number', 'null'], exclusiveMinimum: 0, maximum: 99999999.9999 },
          data_entrada: { type: 'string', minLength: 10, maxLength: 10 },
          categoria: { type: ['string', 'null'], maxLength: 128 },
          categoria_manejo_id: { type: ['string', 'null'], maxLength: 64 },
          sexo: { type: ['string', 'null'], enum: [...SEXOS, null] },
          setor_id: { type: ['string', 'null'], maxLength: 64 },
          area_entrada_id: { type: ['string', 'null'], maxLength: 64 },
          // R1-R2: administrativos da entrada, mesmas regras da criação (mesma transação).
          ...Object.fromEntries(CAMPOS_ADMINISTRATIVOS_DA_ENTRADA.map((k) => [k, CAMPOS_CRIACAO[k]])),
        },
      },
    },
  },
};

/** Campos que o "Renomear Lote" do Mapa Geral envia (só exibição do cadastro). */
const CAMPOS_DE_RENOMEAR = Object.freeze(['nome', 'identificador_nome', 'identificador_sigla', 'identificador_cor']);

/**
 * PATCH do lote: "editar" no Cadastro de Lotes; OU só renomear (nome/identificação)
 * com "Renomear lote" concedido no Mapa Geral.
 */
const autorizarPatchLote = autorizar((req, aut) => {
  if (telaPermite(aut, TELAS.LOTES, 'editar')) return true;
  const chaves = Object.keys(/** @type {Record<string, unknown>} */ (req.body ?? {}));
  if (chaves.length && chaves.every((k) => CAMPOS_DE_RENOMEAR.includes(k)) && mapaPermite(aut, 'renomear_lotes')) return true;
  return { tela: TELAS.LOTES.tela, acao: 'editar' };
});

/** @param {unknown} corpo @returns {Record<string, unknown>} */
const corpoValidado = (corpo) => /** @type {Record<string, unknown>} */ (corpo);

/** @param {import('fastify').FastifyInstance} app */
export const registrarLoteRoutes = async (app) => {
  app.get('/lotes', { onRequest: [app.autenticar] }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    return listar(request.contexto);
  });

  // MAIKE-LOTES-R1: leitura por id (inclui excluído logicamente) e elegibilidade de exclusão.
  app.get('/lotes/:id', { onRequest: [app.autenticar], schema: EXCLUIR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return buscarPorId(request.contexto, id);
  });

  app.get('/lotes/:id/elegibilidade-exclusao', { onRequest: [app.autenticar], schema: EXCLUIR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return elegibilidadeExclusao(request.contexto, id);
  });

  // R1: elegibilidade (só leitura) e comando de correção da entrada original.
  app.get('/lotes/:id/elegibilidade-correcao-entrada', { onRequest: [app.autenticar], schema: EXCLUIR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return elegibilidadeCorrecaoEntrada(request.contexto, id);
  });

  app.post('/lotes/:id/correcao-entrada', { onRequest: [app.autenticar], preHandler: [porTela(TELAS.LOTES, 'editar')], schema: CORRIGIR_ENTRADA_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    const r = await corrigirEntradaLote(request.contexto, id, corpoValidado(request.body), comoLotePublico);
    return reply.status(r.status).send(r.body);
  });

  app.post('/lotes', { onRequest: [app.autenticar], preHandler: [porTela(TELAS.LOTES, 'novo')], schema: CRIAR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const lote = await criar(request.contexto, corpoValidado(request.body));
    return reply.status(201).send(lote);
  });

  app.patch('/lotes/:id', { onRequest: [app.autenticar], preHandler: [autorizarPatchLote], schema: ATUALIZAR_SCHEMA }, async (request) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    return atualizar(request.contexto, id, corpoValidado(request.body));
  });

  app.delete('/lotes/:id', { onRequest: [app.autenticar], preHandler: [porTela(TELAS.LOTES, 'excluir')], schema: EXCLUIR_SCHEMA }, async (request, reply) => {
    exigirAuthContext(request.contexto.auth);
    const { id } = /** @type {{id: string}} */ (request.params);
    await excluir(request.contexto, id);
    return reply.status(204).send();
  });
};
