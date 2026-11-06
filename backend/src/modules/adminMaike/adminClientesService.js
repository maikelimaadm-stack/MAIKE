/**
 * Consulta de clientes da plataforma pelo MAIKE Admin (MAIKE-SAAS-ADMIN-S01) —
 * SOMENTE LEITURA.
 *
 * É a única leitura que atravessa tenants, e por isso:
 *
 * - só é chamada por rotas `/admin-maike/*` atrás de `exigirSessaoAdmin()`
 *   (proprietário com MFA verificado). Nenhum JWT de fazenda chega aqui;
 * - nunca instala `auth_context` nem devolve algo que sirva de sessão de
 *   cliente. O `id` da URL é só o alvo da consulta, não uma identidade;
 * - cada consulta tem `select` explícito e mínimo. Ficam de fora `senha_hash`,
 *   `papel_tenant`, permissões, documentos e contatos da empresa (CPF, CNPJ,
 *   e-mail, telefone, endereço) e qualquer dado operacional do rebanho;
 * - toda lista é paginada por keyset (createdAt DESC, id DESC) com teto
 *   `LIMITE_MAXIMO_ADMIN`;
 * - nada aqui grava. Não há evento de auditoria por leitura: o GET fica sem
 *   efeito colateral além do `ultimo_uso_em` da sessão, que a guarda já atualiza.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { adminError } from '../../shared/errors/AppError.js';
import { clausulaKeysetDesc, decodificarCursor, montarEnvelopeKeyset } from '../../shared/pagination/keysetCursor.js';

export const LIMITE_PADRAO_ADMIN = 25;
export const LIMITE_MAXIMO_ADMIN = 50;

/** Mesmo formato da coluna `Cliente.id` (VarChar 64, cuid). */
export const PADRAO_ID = '^[A-Za-z0-9_-]{1,64}$';

const ORDEM = [{ createdAt: /** @type {const} */ ('desc') }, { id: /** @type {const} */ ('desc') }];

/** Inexistente e malformado respondem igual: não revela quais ids existem. */
const clienteNaoEncontrado = () => adminError('ADMIN_ENTRADA_INVALIDA', 'cliente não encontrado');

/**
 * @param {unknown} bruto
 * @returns {{ createdAt: Date, id: string } | null}
 */
const cursorOuErro = (bruto) => {
  if (typeof bruto !== 'string') return null;
  const cursor = decodificarCursor(bruto);
  if (!cursor) throw adminError('ADMIN_ENTRADA_INVALIDA', 'cursor inválido');
  return cursor;
};

/** @param {unknown} bruto */
const limiteDe = (bruto) => {
  const n = Number(bruto);
  if (!Number.isInteger(n) || n < 1) return LIMITE_PADRAO_ADMIN;
  return Math.min(n, LIMITE_MAXIMO_ADMIN);
};

/** @param {unknown} bruto @returns {boolean|null} */
const ativoDe = (bruto) => {
  if (bruto === true || bruto === 'true') return true;
  if (bruto === false || bruto === 'false') return false;
  return null;
};

const iso = (d) => (d instanceof Date ? d.toISOString() : null);

/**
 * `GET /admin-maike/clientes` — lista paginada com busca por nome/código.
 *
 * `total` só na primeira página (sem cursor), como em `GET /usuarios/page`.
 *
 * @param {{ q?: string, ativo?: unknown, limit?: unknown, cursor?: unknown }} query
 */
export const listarClientes = async (query = {}) => {
  const limit = limiteDe(query.limit);
  const cursor = cursorOuErro(query.cursor);
  const q = typeof query.q === 'string' ? query.q.trim() : '';
  const ativo = ativoDe(query.ativo);

  /** @type {import('@prisma/client').Prisma.ClienteWhereInput[]} */
  const filtros = [];
  if (q) {
    filtros.push({
      OR: [{ nome: { contains: q, mode: 'insensitive' } }, { codigo: { contains: q, mode: 'insensitive' } }],
    });
  }
  if (ativo !== null) filtros.push({ ativo });
  const whereBase = filtros.length ? { AND: filtros } : {};
  const where = cursor ? { AND: [...filtros, clausulaKeysetDesc(cursor)] } : whereBase;

  const db = getPrismaClient();
  const [registros, total] = await Promise.all([
    db.cliente.findMany({
      where,
      orderBy: ORDEM,
      take: limit + 1,
      select: {
        id: true,
        codigo: true,
        nome: true,
        ativo: true,
        createdAt: true,
        _count: { select: { usuarios: true, empresas: true } },
      },
    }),
    cursor ? Promise.resolve(null) : db.cliente.count({ where: whereBase }),
  ]);

  return montarEnvelopeKeyset({
    registros,
    limit,
    total: /** @type {number} */ (/** @type {unknown} */ (total)),
    mapItem: (c) => ({
      id: c.id,
      codigo: c.codigo,
      nome: c.nome,
      ativo: c.ativo,
      criado_em: iso(c.createdAt),
      usuarios_total: c._count.usuarios,
      empresas_total: c._count.empresas,
    }),
  });
};

/**
 * `GET /admin-maike/clientes/:id` — ficha do cliente com contagens.
 *
 * @param {string} id
 */
export const obterCliente = async (id) => {
  const db = getPrismaClient();
  const cliente = await db.cliente.findUnique({
    where: { id },
    select: {
      id: true,
      codigo: true,
      nome: true,
      ativo: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { usuarios: true, empresas: true } },
    },
  });
  if (!cliente) throw clienteNaoEncontrado();
  const usuariosAtivos = await db.usuario.count({ where: { cliente_id: cliente.id, ativo: true } });
  return {
    cliente: {
      id: cliente.id,
      codigo: cliente.codigo,
      nome: cliente.nome,
      ativo: cliente.ativo,
      criado_em: iso(cliente.createdAt),
      atualizado_em: iso(cliente.updatedAt),
    },
    contagens: {
      usuarios: cliente._count.usuarios,
      usuarios_ativos: usuariosAtivos,
      empresas: cliente._count.empresas,
    },
  };
};

/** Confirma que o cliente existe antes de listar filhos (lista vazia ≠ cliente inexistente). */
const exigirCliente = async (id) => {
  const existe = await getPrismaClient().cliente.findUnique({ where: { id }, select: { id: true } });
  if (!existe) throw clienteNaoEncontrado();
  return existe.id;
};

/**
 * Página de filhos de UM cliente: o `cliente_id` vem do registro confirmado,
 * e o cursor só anda dentro desse cliente.
 *
 * @template T
 * @param {string} id
 * @param {{ limit?: unknown, cursor?: unknown }} query
 * @param {(clienteId: string, extra: object, take: number) => Promise<T[]>} buscar
 * @param {(clienteId: string) => Promise<number>} contar
 * @param {(row: T) => object} mapItem
 */
const paginaDoCliente = async (id, query, buscar, contar, mapItem) => {
  const limit = limiteDe(query.limit);
  const cursor = cursorOuErro(query.cursor);
  const clienteId = await exigirCliente(id);
  const [registros, total] = await Promise.all([
    buscar(clienteId, cursor ? clausulaKeysetDesc(cursor) : {}, limit + 1),
    cursor ? Promise.resolve(null) : contar(clienteId),
  ]);
  return montarEnvelopeKeyset({
    registros: /** @type {any[]} */ (registros),
    limit,
    total: /** @type {number} */ (/** @type {unknown} */ (total)),
    mapItem,
  });
};

/**
 * `GET /admin-maike/clientes/:id/usuarios` — sem `senha_hash`, sem papel.
 *
 * @param {string} id
 * @param {{ limit?: unknown, cursor?: unknown }} query
 */
export const listarUsuariosDoCliente = (id, query = {}) =>
  paginaDoCliente(
    id,
    query,
    (clienteId, extra, take) =>
      getPrismaClient().usuario.findMany({
        where: { cliente_id: clienteId, ...extra },
        orderBy: ORDEM,
        take,
        select: { id: true, nome: true, login: true, ativo: true, createdAt: true },
      }),
    (clienteId) => getPrismaClient().usuario.count({ where: { cliente_id: clienteId } }),
    (u) => ({ id: u.id, nome: u.nome, login: u.login, ativo: u.ativo, criado_em: iso(u.createdAt) })
  );

/**
 * `GET /admin-maike/clientes/:id/empresas` — só identificação da empresa.
 *
 * @param {string} id
 * @param {{ limit?: unknown, cursor?: unknown }} query
 */
export const listarEmpresasDoCliente = (id, query = {}) =>
  paginaDoCliente(
    id,
    query,
    (clienteId, extra, take) =>
      getPrismaClient().empresa.findMany({
        where: { cliente_id: clienteId, ...extra },
        orderBy: ORDEM,
        take,
        select: { id: true, numero_empresa: true, nome: true, apelido: true, createdAt: true },
      }),
    (clienteId) => getPrismaClient().empresa.count({ where: { cliente_id: clienteId } }),
    (e) => ({ id: e.id, numero_empresa: e.numero_empresa, nome: e.nome, apelido: e.apelido, criado_em: iso(e.createdAt) })
  );
