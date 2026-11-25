/**
 * D-PROD-308 — criação com o id gerado no aparelho (idempotente por natureza).
 *
 * O app (online ou sem internet) gera o id do registro novo (UUID) e o manda no
 * POST. O id é definitivo desde o aparelho: nada a trocar depois (antes: id
 * `offline_…` remapeado), e repetir a MESMA criação — resposta perdida, app
 * fechado no meio, duas abas — devolve o registro já criado em vez de criar
 * outro (e de repetir efeitos como a entrada no rebanho ou a numeração).
 *
 * Regras:
 *  - só UUID (versões 1–8, variante RFC 4122) é aceito como id do aparelho;
 *    qualquer outro valor segue o caminho de sempre (o servidor gera o id);
 *  - o id já existe NESTE tenant → devolve o registro (`repetido: true`);
 *  - existe em OUTRO tenant → 409 `ID_DO_APARELHO_EM_USO` (sem dizer de quem);
 *  - existe mas foi excluído → 409 `ID_DO_APARELHO_EXCLUIDO` (não recria);
 *  - duas criações simultâneas com o mesmo id: a do banco (PK) decide; a que
 *    perde relê e devolve o registro da que ganhou.
 */

import { getPrismaClient } from '../../database/prismaClient.js';
import { AppError } from '../errors/AppError.js';

const PADRAO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Schema JSON do campo `id` no corpo de criação. */
export const SCHEMA_ID_DO_APARELHO = Object.freeze({
  type: 'string',
  minLength: 36,
  maxLength: 36,
  pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
});

/**
 * O id do aparelho no corpo, normalizado (minúsculas), ou `null`.
 * @param {unknown} valor
 * @returns {string|null}
 */
export const idDoAparelhoDe = (valor) => {
  if (typeof valor !== 'string') return null;
  const id = valor.trim().toLowerCase();
  return PADRAO_UUID.test(id) ? id : null;
};

/** @param {unknown} erro */
const conflitoDeId = (erro) => {
  const e = /** @type {{code?: string, meta?: {target?: unknown}}} */ (erro);
  if (e?.code !== 'P2002') return false;
  const alvo = e.meta?.target;
  // Sem alvo (alguns drivers), trata como conflito do id: a releitura confirma.
  if (alvo === undefined || alvo === null) return true;
  const campos = Array.isArray(alvo) ? alvo.map(String) : [String(alvo)];
  return campos.some((c) => c === 'id' || c.endsWith('_pkey'));
};

/**
 * @typedef {{ cliente_id: string, excluido?: boolean, registro: unknown }} Existente
 */

/**
 * @param {Existente} existente
 * @param {string} clienteId
 * @param {string} id
 * @param {string} entidade
 */
const resolverExistente = (existente, clienteId, id, entidade) => {
  if (existente.cliente_id !== clienteId) {
    throw new AppError('ID_DO_APARELHO_EM_USO', 'este id já está em uso; gere outro', { details: { id, entidade } });
  }
  if (existente.excluido) {
    throw new AppError('ID_DO_APARELHO_EXCLUIDO', 'este registro já foi criado e depois excluído; não é recriado', {
      details: { id, entidade },
    });
  }
  return { registro: existente.registro, repetido: true };
};

/**
 * Cria com o id do aparelho; repetir devolve o mesmo registro.
 *
 * @template T
 * @param {{
 *   id: string|null,
 *   clienteId: string,
 *   entidade: string,
 *   buscar: (id: string) => Promise<Existente|null>,
 *   criar: (id: string|null) => Promise<T>,
 * }} p `buscar` lê pelo id em QUALQUER tenant (só para decidir; nada vaza);
 *     `criar` grava com o id dado (ou sem id, quando `null`), em transação própria.
 * @returns {Promise<{registro: T|unknown, repetido: boolean}>}
 */
export const criarComIdDoAparelho = async ({ id, clienteId, entidade, buscar, criar }) => {
  if (!id) return { registro: await criar(null), repetido: false };
  const antes = await buscar(id);
  if (antes) return resolverExistente(antes, clienteId, id, entidade);
  try {
    return { registro: await criar(id), repetido: false };
  } catch (erro) {
    if (!conflitoDeId(erro)) throw erro;
    const depois = await buscar(id);
    if (!depois) throw erro;
    return resolverExistente(depois, clienteId, id, entidade);
  }
};

/**
 * Para entidade apagada de vez (sem `excluido_em`): o histórico de auditoria diz se este id
 * deste tenant já foi excluído — a criação repetida depois da exclusão não o recria.
 * @param {string} clienteId
 * @param {string} entidade nome gravado em `AuditLog.entidade`
 * @param {string} id
 */
export const foiExcluidoNoHistorico = async (clienteId, entidade, id) =>
  Boolean(
    await getPrismaClient().auditLog.findFirst({
      where: { cliente_id: clienteId, entidade, entidade_id: id, acao: 'delete' },
      select: { id: true },
    })
  );
