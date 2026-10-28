import { getPrismaClient } from '../../database/prismaClient.js';

const CHAVES_PROIBIDAS = new Set([
  'senha',
  'senha_hash',
  'token',
  'authorization',
  'service_role',
  'secret',
  'conteudo_base64',
]);

/** @param {unknown} valor */
const filtrarValor = (valor) => {
  if (valor === null || valor === undefined) return valor;
  if (typeof valor === 'string') {
    if (valor.length > 500) return `${valor.slice(0, 500)}…`;
    return valor;
  }
  if (Array.isArray(valor)) return valor.slice(0, 20).map(filtrarValor);
  if (typeof valor === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (valor))) {
      if (CHAVES_PROIBIDAS.has(k.toLowerCase())) continue;
      out[k] = filtrarValor(v);
    }
    return out;
  }
  return valor;
};

/**
 * @param {object} params
 * @param {string | null | undefined} params.operadorId
 * @param {string} params.acao
 * @param {string} params.entidade
 * @param {string | null | undefined} params.entidadeId
 * @param {Record<string, unknown> | null | undefined} params.dados
 * @param {string} params.requestId
 */
export const registrarAuditoriaCatalogo = async ({
  operadorId,
  acao,
  entidade,
  entidadeId,
  dados,
  requestId,
}) => {
  const prisma = getPrismaClient();
  await prisma.auditoriaCatalogoGlobal.create({
    data: {
      operador_id: operadorId ?? null,
      acao,
      entidade,
      entidade_id: entidadeId ?? null,
      dados: dados ? filtrarValor(dados) : undefined,
      request_id: requestId,
    },
  });
};
