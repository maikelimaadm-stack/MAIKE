/**
 * API do módulo Empresa (P1.1, D-PROD-18).
 *
 * Fronteira pública de dados. Quem consome — service, e por meio dele a página —
 * não sabe qual provider está atrás.
 *
 * Esta camada é adaptador de dados, e só isso:
 *  - não importa React nem React Query;
 *  - não mostra toast;
 *  - não conhece regra de negócio (nome duplicado vive no service);
 *  - não aceita `entityName`;
 *  - devolve dados, nunca objeto do provider.
 */

import { runProviderCall, assertArgument } from '../_core/normalizeApiError.js';
import { empresaProvider } from '../_providers/base44Provider.js';

const RESOURCE = 'Empresa';

/** Ordenação preservada da implementação anterior da página. */
export const EMPRESA_DEFAULT_ORDER = '-created_date';

const isNonEmptyString = (valor) => typeof valor === 'string' && valor.trim().length > 0;
const isPlainObject = (valor) =>
  Boolean(valor) && typeof valor === 'object' && !Array.isArray(valor);

/**
 * Lista empresas.
 * @param {{order?: string}} [opcoes]
 * @returns {Promise<Array<object>>}
 */
export const listEmpresas = async (opcoes = {}) => {
  const order = opcoes.order ?? EMPRESA_DEFAULT_ORDER;
  const contexto = { operation: 'list', resource: RESOURCE };
  assertArgument(isNonEmptyString(order), 'order', contexto);

  const registros = await runProviderCall(() => empresaProvider.list(order), contexto);
  // O provider pode devolver `undefined` quando não há registro; a fronteira
  // sempre entrega uma lista, para a UI não precisar defender contra isso.
  return Array.isArray(registros) ? registros : [];
};

/**
 * Cria uma empresa.
 * @param {object} dados
 * @returns {Promise<object>}
 */
export const createEmpresa = async (dados) => {
  const contexto = { operation: 'create', resource: RESOURCE };
  assertArgument(isPlainObject(dados), 'dados', contexto);
  return runProviderCall(() => empresaProvider.create(dados), contexto);
};

/**
 * Atualiza uma empresa.
 * @param {string} id
 * @param {object} dados
 * @returns {Promise<object>}
 */
export const updateEmpresa = async (id, dados) => {
  const contexto = { operation: 'update', resource: RESOURCE };
  assertArgument(isNonEmptyString(id), 'id', contexto);
  assertArgument(isPlainObject(dados), 'dados', contexto);
  return runProviderCall(() => empresaProvider.update(id, dados), { ...contexto, details: { id } });
};

/**
 * Exclui uma empresa.
 * @param {string} id
 * @returns {Promise<unknown>}
 */
export const deleteEmpresa = async (id) => {
  const contexto = { operation: 'delete', resource: RESOURCE };
  assertArgument(isNonEmptyString(id), 'id', contexto);
  return runProviderCall(() => empresaProvider.delete(id), { ...contexto, details: { id } });
};
