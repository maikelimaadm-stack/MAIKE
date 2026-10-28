/**
 * Serviço de UnidadeMedida (P4.5, D-PROD-44).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import { unidadeMedidaNotFound, unidadeMedidaSiglaConflito } from '../../shared/errors/AppError.js';
import {
  listarUnidades,
  listarUnidadesPagina,
  contarUnidades,
  buscarUnidade,
  existeUnidadeComSigla,
  inserirUnidade,
  atualizarUnidadePorId,
  excluirUnidadePorId,
} from './unidadeMedidaRepository.js';
import {
  decodificarCursor,
  normalizarLimite,
  montarEnvelopeKeyset,
} from '../../shared/pagination/keysetCursor.js';
import { AppError } from '../../shared/errors/AppError.js';

export const ENTIDADE_SEQUENCIA = 'UnidadeMedida';

export const escopoDaNumeracao = () => ESCOPO_TENANT;

const textoOuNulo = (valor) => {
  if (typeof valor !== 'string') return valor === undefined ? undefined : null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
};

const normalizarSigla = (valor) => {
  const limpo = textoOuNulo(valor);
  if (limpo === undefined || limpo === null) return limpo;
  return limpo.toUpperCase();
};

const normalizarDescricao = (valor) => {
  const limpo = textoOuNulo(valor);
  if (limpo === undefined || limpo === null) return limpo;
  return limpo.toUpperCase();
};

/** @param {Record<string, unknown>} registro */
export const comoUnidadePublica = (registro) => ({
  id: registro.id,
  numero_unidade: registro.numero_unidade,
  sigla: registro.sigla,
  descricao: registro.descricao,
  ativo: registro.ativo,
  created_date:
    registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date:
    registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

const CAMPOS_EDITAVEIS = Object.freeze({
  sigla: (v) => normalizarSigla(v),
  descricao: (v) => normalizarDescricao(v),
  ativo: (v) => (v === undefined ? undefined : Boolean(v)),
  numero_unidade: (v) => textoOuNulo(v),
});

/** @param {Record<string, unknown>} entrada */
const camposDe = (entrada) => {
  /** @type {Record<string, unknown>} */
  const saida = {};
  for (const [campo, tratar] of Object.entries(CAMPOS_EDITAVEIS)) {
    if (!Object.prototype.hasOwnProperty.call(entrada, campo)) continue;
    const valor = tratar(entrada[campo]);
    if (valor !== undefined) saida[campo] = valor;
  }
  return saida;
};

/** @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const listar = async (contexto) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarUnidades(auth.clienteId);
  return registros.map(comoUnidadePublica);
};

/**
 * Listagem paginada keyset — motor Base1 (D-PROD-55).
 * @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto
 * @param {Record<string, unknown>} query
 */
export const listarPagina = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const limit = normalizarLimite(query.limit);
  const q = typeof query.q === 'string' ? query.q : null;
  let ativo = null;
  if (query.ativo === true || query.ativo === 'true' || query.ativo === '1') ativo = true;
  if (query.ativo === false || query.ativo === 'false' || query.ativo === '0') ativo = false;

  const cursorBruto = typeof query.cursor === 'string' ? query.cursor : null;
  const cursor = cursorBruto ? decodificarCursor(cursorBruto) : null;
  if (cursorBruto && !cursor) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'cursor inválido');
  }

  const filtro = { q, ativo, cursor, limit };
  const [registros, total] = await Promise.all([
    listarUnidadesPagina(auth.clienteId, filtro),
    contarUnidades(auth.clienteId, { q, ativo }),
  ]);

  return montarEnvelopeKeyset({
    registros,
    limit,
    total,
    mapItem: comoUnidadePublica,
  });
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {Record<string, unknown>} entrada */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const campos = camposDe(entrada);

  const criada = await prisma.$transaction(async (tx) => {
    const sigla = String(campos.sigla);
    if (await existeUnidadeComSigla(auth.clienteId, sigla, undefined, tx)) {
      throw unidadeMedidaSiglaConflito();
    }

    const numero = await reservarNumero(tx, {
      clienteId: auth.clienteId,
      entidade: ENTIDADE_SEQUENCIA,
      escopoTipo: escopoDaNumeracao(),
    });

    const registro = await inserirUnidade(tx, {
      ...campos,
      cliente_id: auth.clienteId,
      numero_unidade: String(numero),
      sigla,
      descricao: String(campos.descricao),
    });

    const publica = comoUnidadePublica(registro);

    await registrarEvento(
      contexto,
      {
        acao: 'create',
        entidade: 'UnidadeMedida',
        entidadeId: registro.id,
        dadosNovos: publica,
      },
      tx
    );

    return publica;
  });

  return criada;
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id @param {Record<string, unknown>} entrada */
export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const anterior = await buscarUnidade(auth.clienteId, id, tx);
    if (!anterior) throw unidadeMedidaNotFound();

    const campos = camposDe(entrada);
    if (campos.sigla && campos.sigla !== anterior.sigla) {
      const sigla = String(campos.sigla);
      if (await existeUnidadeComSigla(auth.clienteId, sigla, id, tx)) {
        throw unidadeMedidaSiglaConflito();
      }
    }

    const registro = Object.keys(campos).length
      ? await atualizarUnidadePorId(tx, auth.clienteId, id, campos)
      : anterior;

    const publica = comoUnidadePublica(registro);

    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'UnidadeMedida',
        entidadeId: id,
        dadosAnteriores: comoUnidadePublica(anterior),
        dadosNovos: publica,
      },
      tx
    );

    return publica;
  });
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id */
export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  await prisma.$transaction(async (tx) => {
    const anterior = await buscarUnidade(auth.clienteId, id, tx);
    if (!anterior) throw unidadeMedidaNotFound();

    await excluirUnidadePorId(tx, auth.clienteId, id);

    await registrarEvento(
      contexto,
      {
        acao: 'delete',
        entidade: 'UnidadeMedida',
        entidadeId: id,
        dadosAnteriores: comoUnidadePublica(anterior),
      },
      tx
    );
  });
};
