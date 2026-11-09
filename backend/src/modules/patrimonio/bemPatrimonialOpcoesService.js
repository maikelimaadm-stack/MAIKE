/**
 * D-PROD-157 (A3) — opções dos seletores do formulário do bem que dependem da
 * EMPRESA: responsáveis, parceiros, centros de custo e áreas. As de catálogo
 * (famílias, tipos, perfis, combustíveis) são do tenant e ficam nos services
 * de cada catálogo (`opcoes`).
 *
 * Só ATIVOS, keyset (nome, id) crescente, busca literal no servidor e
 * envelope `{ itens, has_more, next_cursor }` (limite padrão 50, máx. 100).
 * `empresa_id` é obrigatório e validado no tenant; os responsáveis são
 * usuários ATIVOS do tenant (a empresa é só escopo) e saem SÓ com
 * `{id, nome}` — o login é credencial e nunca aparece.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { exigirAuthContext } from '../../shared/auth/authContext.js';
import { exigirEmpresaDoTenant } from '../gestao/gestaoComum.js';
import { paginacaoOpcoes, paginarPorNome } from './patrimonioComum.js';

/**
 * Escopo comum: tenant da sessão, empresa validada, paginação e busca.
 * @param {any} contexto @param {Record<string, any>} query
 */
const escopo = async (contexto, query) => {
  const auth = exigirAuthContext(contexto?.auth);
  const prisma = getPrismaClient();
  const empresaId = await exigirEmpresaDoTenant(prisma, auth.clienteId, query.empresa_id);
  return { prisma, clienteId: auth.clienteId, empresaId, ...paginacaoOpcoes(query) };
};

/** Responsáveis: usuários ATIVOS do tenant, `{id, nome}`. */
export const opcoesResponsaveis = async (contexto, query = {}) => {
  const { prisma, clienteId, limit, cursor, q } = await escopo(contexto, query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: clienteId, ativo: true }];
  if (q) filtros.push({ nome: { contains: q, mode: 'insensitive' } });
  return paginarPorNome(prisma.usuario, {
    where: { AND: filtros },
    select: { id: true, nome: true },
    limit,
    cursor,
    mapear: (linhas) => linhas.map((u) => ({ id: u.id, nome: u.nome })),
  });
};

/** Parceiros (proprietário ou fornecedor) ATIVOS da empresa, `{id, nome}`. */
export const opcoesParceiros = async (contexto, query = {}) => {
  const { prisma, clienteId, empresaId, limit, cursor, q } = await escopo(contexto, query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: clienteId, empresa_id: empresaId, ativo: true }];
  if (q) filtros.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { razao_social: { contains: q, mode: 'insensitive' } }, { numero_cadastro: { contains: q } }] });
  return paginarPorNome(prisma.fornecedor, {
    where: { AND: filtros },
    select: { id: true, nome: true },
    limit,
    cursor,
    mapear: (linhas) => linhas.map((p) => ({ id: p.id, nome: p.nome })),
  });
};

/** Centros de custo ATIVOS da empresa, `{id, numero, nome}`. */
export const opcoesCentrosCusto = async (contexto, query = {}) => {
  const { prisma, clienteId, empresaId, limit, cursor, q } = await escopo(contexto, query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: clienteId, empresa_id: empresaId, ativo: true }];
  if (q) filtros.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { numero: { contains: q } }] });
  return paginarPorNome(prisma.centroCusto, {
    where: { AND: filtros },
    select: { id: true, numero: true, nome: true },
    limit,
    cursor,
    mapear: (linhas) => linhas.map((c) => ({ id: c.id, numero: c.numero, nome: c.nome })),
  });
};

/** Áreas (pastagens) ATIVAS da empresa, `{id, nome}`. */
export const opcoesAreas = async (contexto, query = {}) => {
  const { prisma, clienteId, empresaId, limit, cursor, q } = await escopo(contexto, query);
  /** @type {any[]} */
  const filtros = [{ cliente_id: clienteId, empresa_id: empresaId, ativo: true }];
  if (q) filtros.push({ OR: [{ nome: { contains: q, mode: 'insensitive' } }, { numero_area: { contains: q } }] });
  return paginarPorNome(prisma.areaPastagem, {
    where: { AND: filtros },
    select: { id: true, nome: true },
    limit,
    cursor,
    mapear: (linhas) => linhas.map((a) => ({ id: a.id, nome: a.nome })),
  });
};
