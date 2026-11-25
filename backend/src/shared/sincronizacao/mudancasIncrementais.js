/**
 * D-PROD-309 — sincronização incremental: "o que mudou desde a última vez".
 *
 * O aparelho guarda a lista de uma entidade e a MARCA (instante do servidor) da última
 * sincronização. Na próxima, pede só o que mudou desde a marca, em páginas, e as exclusões
 * do período — em vez de baixar a lista inteira a cada vez (o que não escala para milhões
 * de registros por cliente).
 *
 * Contrato da resposta (igual para todas as entidades):
 *   {
 *     agora:     instante do servidor no começo da consulta — a próxima MARCA do aparelho;
 *     itens:     registros novos ou alterados (forma pública, a mesma da listagem);
 *     excluidos: ids que saíram da lista (exclusão física, exclusão lógica, cancelamento);
 *     proximo:   cursor da próxima página, ou null quando acabou;
 *     recarregar: true quando o período tem exclusões demais — o aparelho baixa a lista toda.
 *   }
 *
 * Regras:
 *  - `desde` ausente: tudo (primeira sincronização), em páginas;
 *  - `desde` presente: `updatedAt >= desde - MARGEM`. A margem cobre transações que
 *    gravaram com instante anterior ao da consulta mas só ficaram visíveis depois (o
 *    reenvio repetido é inofensivo: o aparelho junta pelo id);
 *  - páginas em ordem (updatedAt, id) crescente, cursor opaco (keyset): estável mesmo com
 *    gravações acontecendo durante a sincronização;
 *  - exclusões físicas vêm do histórico de auditoria (`AuditLog`, ação `delete`), só na
 *    primeira página de uma sincronização com `desde`;
 *  - tenant só do auth_context (R11): quem chama passa `clienteId` da autenticação.
 */

import { AppError } from '../errors/AppError.js';
import { getPrismaClient } from '../../database/prismaClient.js';

export const MARGEM_MS = 60_000;
export const LIMITE_PADRAO = 500;
export const LIMITE_MAXIMO = 2000;
/** Exclusões num só período acima disto: o aparelho baixa a lista toda (mais barato e seguro). */
export const LIMITE_EXCLUIDOS = 5000;

const ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;

/** Schema da querystring das rotas `/…/mudancas` (objeto novo a cada rota: o Fastify o marca). */
export const schemaMudancas = () => ({
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      desde: { type: 'string', minLength: 10, maxLength: 40 },
      cursor: { type: 'string', minLength: 1, maxLength: 200 },
      limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO },
    },
  },
});

/** @param {unknown} valor */
const instante = (valor) => {
  if (typeof valor !== 'string') return null;
  const d = new Date(valor);
  if (Number.isNaN(d.getTime()) || d.getUTCFullYear() < 2000 || d.getUTCFullYear() > 9999) return null;
  return d;
};

const recusar = (campo) =>
  new AppError('REQUEST_VALIDATION_FAILED', `${campo} inválido`, { details: { field: campo, reason: 'formato' } });

/** @param {{updatedAt: Date|string, id: string}} r */
export const codificarCursorDeMudanca = (r) =>
  Buffer.from(
    JSON.stringify({ u: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt), i: String(r.id) }),
    'utf8'
  ).toString('base64url');

/** @param {string} texto */
const lerCursor = (texto) => {
  try {
    const { u, i } = JSON.parse(Buffer.from(texto, 'base64url').toString('utf8'));
    const d = instante(u);
    if (!d || typeof i !== 'string' || !ID_VALIDO.test(i)) return null;
    return { u: d, i };
  } catch {
    return null;
  }
};

/**
 * @template R
 * @param {{
 *   clienteId: string,
 *   query: {desde?: string, cursor?: string, limite?: number},
 *   modelo: string,
 *   entidadeAuditoria: string,
 *   publico: (registro: R) => unknown,
 *   excluido?: (registro: R) => boolean,
 *   agora?: () => Date,
 * }} p
 *   `modelo`: delegate do Prisma (ex.: 'lote'); `entidadeAuditoria`: nome gravado em
 *   `AuditLog.entidade`; `excluido`: o registro existe mas saiu da lista (exclusão lógica,
 *   cancelado).
 */
export const consultarMudancas = async ({ clienteId, query, modelo, entidadeAuditoria, publico, excluido = () => false, agora = () => new Date() }) => {
  const prisma = /** @type {any} */ (getPrismaClient());
  const agoraDoServidor = agora();
  const limite = Math.min(Number(query?.limite) || LIMITE_PADRAO, LIMITE_MAXIMO);

  let desde = null;
  if (query?.desde !== undefined) {
    desde = instante(query.desde);
    if (!desde) throw recusar('desde');
  }
  let cursor = null;
  if (query?.cursor !== undefined) {
    cursor = lerCursor(query.cursor);
    if (!cursor) throw recusar('cursor');
  }
  const base = desde ? new Date(desde.getTime() - MARGEM_MS) : null;

  /** @type {any[]} */
  const and = [{ cliente_id: clienteId }];
  if (base) and.push({ updatedAt: { gte: base } });
  if (cursor) and.push({ OR: [{ updatedAt: { gt: cursor.u } }, { updatedAt: cursor.u, id: { gt: cursor.i } }] });

  const pagina = await prisma[modelo].findMany({
    where: { AND: and },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: limite + 1,
  });
  const temMais = pagina.length > limite;
  const desta = temMais ? pagina.slice(0, limite) : pagina;

  const itens = [];
  const excluidos = [];
  for (const registro of desta) {
    if (excluido(registro)) excluidos.push(String(registro.id));
    else itens.push(publico(registro));
  }

  // Exclusões físicas do período: uma vez por sincronização (primeira página).
  if (base && !cursor) {
    const apagados = await prisma.auditLog.findMany({
      where: { cliente_id: clienteId, entidade: entidadeAuditoria, acao: 'delete', createdAt: { gte: base } },
      select: { entidade_id: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: LIMITE_EXCLUIDOS + 1,
    });
    if (apagados.length > LIMITE_EXCLUIDOS) {
      return { agora: agoraDoServidor.toISOString(), itens: [], excluidos: [], proximo: null, recarregar: true };
    }
    for (const a of apagados) if (a.entidade_id) excluidos.push(String(a.entidade_id));
  }

  return {
    agora: agoraDoServidor.toISOString(),
    itens,
    excluidos,
    proximo: temMais ? codificarCursorDeMudanca(desta[desta.length - 1]) : null,
    recarregar: false,
  };
};
