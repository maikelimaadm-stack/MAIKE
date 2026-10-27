/**
 * Serviço de LocalEstoque (P5.2, D-PROD-48).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import { localEstoqueNotFound } from '../../shared/errors/AppError.js';
import {
  listarLocais,
  buscarLocal,
  inserirLocal,
  atualizarLocalPorId,
  excluirLocalPorId,
} from './localEstoqueRepository.js';

export const ENTIDADE_SEQUENCIA = 'LocalEstoque';
export const escopoDaNumeracao = () => ESCOPO_TENANT;

const textoOuNulo = (valor) => {
  if (typeof valor !== 'string') return valor === undefined ? undefined : null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
};

/** @param {Record<string, unknown>} registro */
export const comoLocalPublico = (registro) => ({
  id: registro.id,
  numero_local: registro.numero_local,
  nome: registro.nome,
  descricao: registro.descricao ?? null,
  capacidade: registro.capacidade ?? null,
  ativo: registro.ativo,
  created_date:
    registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date:
    registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

const CAMPOS_EDITAVEIS = Object.freeze({
  nome: (v) => textoOuNulo(v),
  descricao: (v) => textoOuNulo(v),
  capacidade: (v) => textoOuNulo(v),
  ativo: (v) => (v === undefined ? undefined : Boolean(v)),
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
  const registros = await listarLocais(auth.clienteId);
  return registros.map(comoLocalPublico);
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {Record<string, unknown>} entrada */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const campos = camposDe(entrada);

  const criado = await prisma.$transaction(async (tx) => {
    const numero = await reservarNumero(tx, {
      clienteId: auth.clienteId,
      entidade: ENTIDADE_SEQUENCIA,
      escopoTipo: escopoDaNumeracao(),
    });

    const registro = await inserirLocal(tx, {
      ...campos,
      cliente_id: auth.clienteId,
      numero_local: String(numero),
      nome: String(campos.nome),
    });

    const publico = comoLocalPublico(registro);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: 'LocalEstoque', entidadeId: registro.id, dadosNovos: publico },
      tx
    );
    return publico;
  });

  return criado;
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id @param {Record<string, unknown>} entrada */
export const atualizar = async (contexto, id, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  return prisma.$transaction(async (tx) => {
    const anterior = await buscarLocal(auth.clienteId, id, tx);
    if (!anterior) throw localEstoqueNotFound();

    const campos = camposDe(entrada);
    const registro = Object.keys(campos).length
      ? await atualizarLocalPorId(tx, auth.clienteId, id, campos)
      : anterior;

    const publico = comoLocalPublico(registro);
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'LocalEstoque',
        entidadeId: id,
        dadosAnteriores: comoLocalPublico(anterior),
        dadosNovos: publico,
      },
      tx
    );
    return publico;
  });
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {string} id */
export const excluir = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();

  await prisma.$transaction(async (tx) => {
    const anterior = await buscarLocal(auth.clienteId, id, tx);
    if (!anterior) throw localEstoqueNotFound();

    await excluirLocalPorId(tx, auth.clienteId, id);
    await registrarEvento(
      contexto,
      {
        acao: 'delete',
        entidade: 'LocalEstoque',
        entidadeId: id,
        dadosAnteriores: comoLocalPublico(anterior),
      },
      tx
    );
  });
};
