/**
 * D-PROD-157 / D-PROD-162 / D-PROD-163 — Famílias patrimoniais (catálogo do
 * TENANT, sem empresa).
 *
 * D-PROD-163 (SIMPLIFICA-02): o CADASTRO de família saiu (POST/PATCH → 404).
 * Ninguém cria nem edita família: cada "Tipo de bem" (natureza) tem a sua
 * família PADRÃO, garantida automaticamente por `garantirCatalogoPadrao`
 * (`patrimonioCatalogoPadrao.js`); famílias antigas criadas à mão continuam
 * valendo para os tipos delas. Aqui ficam só a LEITURA (lista, detalhe e
 * opções) e as formas pública e de auditoria (usadas pela garantia).
 *
 * Regras de leitura:
 *  - `cliente_id` só da sessão; registro de outro tenant = mesmo 404 de inexistente;
 *  - lista keyset com filtros `ativo`/`natureza` e busca literal.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { AppError } from '../../shared/errors/AppError.js';
import { invalido, iso } from '../gestao/gestaoComum.js';
import { lerAtivo, listarKeyset, paginacaoOpcoes, paginarPorNome, termoDeBusca } from './patrimonioComum.js';
import { NATUREZAS } from './patrimonioDominio.js';

export const ENTIDADE = 'FamiliaPatrimonial';

const SELECAO = Object.freeze({
  id: true, codigo: true, nome: true, natureza: true, descricao: true, ordem: true, vida_util_meses_padrao: true,
  ativo: true, versao: true, createdAt: true, updatedAt: true,
});

export const naoEncontrada = () => new AppError('FAMILIA_PATRIMONIAL_NAO_ENCONTRADA', 'família patrimonial não encontrada');

/** Forma pública (sem tenant). */
export const comoFamiliaPublica = (r) => ({
  id: r.id,
  codigo: r.codigo,
  nome: r.nome,
  natureza: r.natureza,
  descricao: r.descricao ?? null,
  ordem: r.ordem ?? null,
  vida_util_meses_padrao: r.vida_util_meses_padrao ?? null,
  ativo: r.ativo,
  versao: r.versao,
  created_date: iso(r.createdAt),
  updated_date: iso(r.updatedAt),
});

/** Auditoria por allowlist (sem nome nem descrição). */
export const paraAuditoria = (r) => ({ id: r.id, codigo: r.codigo, natureza: r.natureza, ativo: r.ativo, versao: r.versao });

const buscar = (db, clienteId, id) => db.familiaPatrimonial.findFirst({ where: { cliente_id: clienteId, id }, select: SELECAO });

/** @param {unknown} n */
const exigirNatureza = (n) => {
  if (typeof n !== 'string' || !NATUREZAS.includes(n)) throw invalido('natureza inválida', { field: 'natureza', reason: 'natureza_invalida' });
  return n;
};

export const listar = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  /** @type {Record<string, any>} */
  const where = { cliente_id: auth.clienteId };
  const ativo = lerAtivo(query.ativo);
  if (ativo !== null) where.ativo = ativo;
  if (query.natureza !== undefined) where.natureza = exigirNatureza(query.natureza);
  const q = termoDeBusca(query.q);
  const busca = q
    ? [{ codigo: { contains: q, mode: 'insensitive' } }, { nome: { contains: q, mode: 'insensitive' } }, { descricao: { contains: q, mode: 'insensitive' } }]
    : [];
  return listarKeyset(getPrismaClient().familiaPatrimonial, { where, busca, query, select: SELECAO, mapItem: comoFamiliaPublica });
};

export const detalhar = async (contexto, id) => {
  const auth = exigirAuthContext(contexto?.auth);
  const r = await buscar(getPrismaClient(), auth.clienteId, id);
  if (!r) throw naoEncontrada();
  return comoFamiliaPublica(r);
};

/** Opções de seletor: famílias ATIVAS em ordem alfabética, `{id, codigo, nome, natureza}`. */
export const opcoes = async (contexto, query = {}) => {
  const auth = exigirAuthContext(contexto?.auth);
  const { limit, cursor, q } = paginacaoOpcoes(query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: auth.clienteId, ativo: true }];
  if (q) filtros.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { codigo: { contains: q, mode: 'insensitive' } }] });
  return paginarPorNome(getPrismaClient().familiaPatrimonial, {
    where: { AND: filtros },
    select: { id: true, codigo: true, nome: true, natureza: true },
    limit,
    cursor,
    mapear: (linhas) => linhas.map((r) => ({ id: r.id, codigo: r.codigo, nome: r.nome, natureza: r.natureza })),
  });
};
