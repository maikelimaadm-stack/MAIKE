/**
 * Serviço de Categoria (P5.2, D-PROD-48).
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { registrarEvento } from '../auditoria/auditService.js';
import { reservarNumero, ESCOPO_TENANT } from '../sequencias/entidadeCodigoService.js';
import {
  categoriaNotFound,
  categoriaPaiNotFound,
  categoriaDeleteBlocked,
} from '../../shared/errors/AppError.js';
import {
  listarCategorias,
  buscarCategoria,
  contarFilhas,
  inserirCategoria,
  atualizarCategoriaPorId,
  excluirCategoriaPorId,
} from './categoriaRepository.js';

export const ENTIDADE_SEQUENCIA = 'Categoria';
export const escopoDaNumeracao = () => ESCOPO_TENANT;

const textoOuNulo = (valor) => {
  if (typeof valor !== 'string') return valor === undefined ? undefined : null;
  const limpo = valor.trim();
  return limpo === '' ? null : limpo;
};

const inteiroOuNulo = (valor) => {
  if (valor === undefined) return undefined;
  if (valor === null || valor === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** @param {Record<string, unknown>} registro */
export const comoCategoriaPublica = (registro) => ({
  id: registro.id,
  numero_categoria: registro.numero_categoria,
  nome: registro.nome,
  categoria_pai_id: registro.categoria_pai_id ?? null,
  categoria_pai_nome: registro.categoria_pai_nome ?? null,
  descricao: registro.descricao ?? null,
  ordem: registro.ordem ?? null,
  ativo: registro.ativo,
  created_date:
    registro.createdAt instanceof Date ? registro.createdAt.toISOString() : registro.createdAt,
  updated_date:
    registro.updatedAt instanceof Date ? registro.updatedAt.toISOString() : registro.updatedAt,
});

const CAMPOS_EDITAVEIS = Object.freeze({
  nome: (v) => textoOuNulo(v),
  categoria_pai_id: (v) => textoOuNulo(v),
  descricao: (v) => textoOuNulo(v),
  ordem: (v) => inteiroOuNulo(v),
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

const resolverPai = async (tx, auth, paiId) => {
  if (!paiId) return { categoria_pai_id: null, categoria_pai_nome: null };
  const pai = await buscarCategoria(auth.clienteId, paiId, tx);
  if (!pai) throw categoriaPaiNotFound();
  return { categoria_pai_id: pai.id, categoria_pai_nome: pai.nome };
};

/** @param {{auth: import('../../shared/auth/authContext.js').AuthContext}} contexto */
export const listar = async (contexto) => {
  const auth = exigirAuthContext(contexto?.auth);
  const registros = await listarCategorias(auth.clienteId);
  return registros.map(comoCategoriaPublica);
};

/** @param {{requestId: string, auth: import('../../shared/auth/authContext.js').AuthContext}} contexto @param {Record<string, unknown>} entrada */
export const criar = async (contexto, entrada) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const campos = camposDe(entrada);

  const criada = await prisma.$transaction(async (tx) => {
    const pai = await resolverPai(tx, auth, campos.categoria_pai_id ?? null);
    const numero = await reservarNumero(tx, {
      clienteId: auth.clienteId,
      entidade: ENTIDADE_SEQUENCIA,
      escopoTipo: escopoDaNumeracao(),
    });

    const registro = await inserirCategoria(tx, {
      ...campos,
      ...pai,
      cliente_id: auth.clienteId,
      numero_categoria: String(numero),
      nome: String(campos.nome),
    });

    const publica = comoCategoriaPublica(registro);
    await registrarEvento(
      contexto,
      { acao: 'create', entidade: 'Categoria', entidadeId: registro.id, dadosNovos: publica },
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
    const anterior = await buscarCategoria(auth.clienteId, id, tx);
    if (!anterior) throw categoriaNotFound();

    const campos = camposDe(entrada);
    if (Object.prototype.hasOwnProperty.call(campos, 'categoria_pai_id')) {
      const pai = await resolverPai(tx, auth, campos.categoria_pai_id ?? null);
      Object.assign(campos, pai);
    }

    const registro = Object.keys(campos).length
      ? await atualizarCategoriaPorId(tx, auth.clienteId, id, campos)
      : anterior;

    const publica = comoCategoriaPublica(registro);
    await registrarEvento(
      contexto,
      {
        acao: 'update',
        entidade: 'Categoria',
        entidadeId: id,
        dadosAnteriores: comoCategoriaPublica(anterior),
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
    const anterior = await buscarCategoria(auth.clienteId, id, tx);
    if (!anterior) throw categoriaNotFound();

    const filhas = await contarFilhas(tx, auth.clienteId, id);
    if (filhas > 0) throw categoriaDeleteBlocked();

    await excluirCategoriaPorId(tx, auth.clienteId, id);
    await registrarEvento(
      contexto,
      {
        acao: 'delete',
        entidade: 'Categoria',
        entidadeId: id,
        dadosAnteriores: comoCategoriaPublica(anterior),
      },
      tx
    );
  });
};
