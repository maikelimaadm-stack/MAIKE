/**
 * D-PROD-137 — corpo HTTP só grava COLUNAS do próprio registro.
 *
 * Vários services de cadastro repassavam o corpo ao Prisma (`update({ ...entrada })`)
 * com o schema da rota aberto (`additionalProperties: true`). O Prisma aceita, no
 * mesmo `data`, escritas ANINHADAS em relações: `{ cliente: { update: { usuarios:
 * { updateMany: { data: { papel_tenant: 'administrador' } } } } } }` promovia a
 * conta a administrador real; `{ cliente: { connect: { id } } }` movia o registro
 * para outro tenant; `{ catalogoCategoriaVisual: { update } }` alterava o catálogo
 * global de todas as fazendas. A barreira global de `cliente_id` (app.js) não
 * pegava nenhum desses: a chave era a RELAÇÃO, não a coluna.
 *
 * Regra: a allowlist sai do próprio schema Prisma (`Prisma.dmmf`) — só campos
 * escalares/enum do model, menos identidade, tenant e carimbos. Relação, chave
 * desconhecida ou `cliente_id` → 400 REQUEST_VALIDATION_FAILED, nada gravado.
 * Os campos que o servidor devolve e o cliente pode reenviar ao editar
 * (`id`, `createdAt`, `updatedAt`, `created_date`, `updated_date`) são
 * DESCARTADOS em silêncio — nunca gravados a partir do corpo.
 *
 * Coluna nova no schema entra na allowlist sozinha; relação nova NUNCA entra.
 */

import { Prisma } from '@prisma/client';

import { AppError } from '../errors/AppError.js';

/** Ecos do servidor: ignorados, nunca gravados. */
const ECOS_DO_SERVIDOR = new Set(['id', 'createdAt', 'updatedAt', 'created_date', 'updated_date']);

/** @type {Map<string, ReadonlySet<string>>} */
const cache = new Map();

/**
 * Colunas que um corpo HTTP pode gravar no model (escalares/enum, sem id,
 * cliente_id e carimbos).
 * @param {string} modelo nome do model Prisma (ex.: 'PontoSuplementacao')
 * @returns {ReadonlySet<string>}
 */
export const colunasGravaveis = (modelo) => {
  const emCache = cache.get(modelo);
  if (emCache) return emCache;
  const definicao = Prisma.dmmf.datamodel.models.find((m) => m.name === modelo);
  if (!definicao) throw new Error(`model Prisma desconhecido: ${modelo}`);
  const colunas = new Set(
    definicao.fields
      .filter((f) => (f.kind === 'scalar' || f.kind === 'enum') && !f.isId && !f.isUpdatedAt)
      .map((f) => f.name)
      .filter((nome) => nome !== 'cliente_id' && nome !== 'createdAt' && nome !== 'updatedAt')
  );
  cache.set(modelo, colunas);
  return colunas;
};

/**
 * Relações do model — para mensagens e testes (nunca graváveis pelo corpo).
 * @param {string} modelo
 * @returns {string[]}
 */
export const relacoesDoModelo = (modelo) => {
  const definicao = Prisma.dmmf.datamodel.models.find((m) => m.name === modelo);
  if (!definicao) throw new Error(`model Prisma desconhecido: ${modelo}`);
  return definicao.fields.filter((f) => f.kind === 'object').map((f) => f.name);
};

/**
 * Devolve só as colunas graváveis do corpo; qualquer outra chave → 400.
 *
 * @param {string} modelo nome do model Prisma
 * @param {unknown} entrada corpo da requisição
 * @param {{ proibidas?: readonly string[] }} [opcoes] colunas do model que este
 *   fluxo também não aceita (ex.: saldo do lote de nota)
 * @returns {Record<string, unknown>}
 */
export const exigirSomenteColunasGravaveis = (modelo, entrada, opcoes = {}) => {
  if (!entrada || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'corpo deve ser um objeto', {
      details: { entidade: modelo, reason: 'type' },
    });
  }
  const permitidas = colunasGravaveis(modelo);
  const proibidas = new Set(opcoes.proibidas ?? []);
  /** @type {Record<string, unknown>} */
  const dados = {};
  const recusadas = [];
  for (const [chave, valor] of Object.entries(entrada)) {
    if (ECOS_DO_SERVIDOR.has(chave)) continue;
    if (!permitidas.has(chave) || proibidas.has(chave)) {
      recusadas.push(chave);
      continue;
    }
    dados[chave] = valor;
  }
  if (recusadas.length) {
    throw new AppError('REQUEST_VALIDATION_FAILED', 'campo não gravável neste recurso', {
      details: { entidade: modelo, campos: recusadas },
    });
  }
  return dados;
};
