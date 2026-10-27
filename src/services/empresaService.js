/**
 * Service do módulo Empresa (P1.1, D-PROD-18, EMPRESA-NUM-01).
 *
 * Duplicidade de nome é autoridade do backend — POST/PATCH não dependem de GET prévio.
 */

import {
  createEmpresa as createEmpresaApi,
  updateEmpresa as updateEmpresaApi,
  deleteEmpresa as deleteEmpresaApi,
  listEmpresas as listEmpresasApi,
} from '@/apis/empresa';

/**
 * Lista empresas na ordem padrão do módulo.
 * @returns {Promise<Array<object>>}
 */
export const listEmpresas = () => listEmpresasApi();

/**
 * Cria uma empresa (conflito de nome vem do backend).
 * @param {object} dados
 * @returns {Promise<object>}
 */
export const createEmpresa = (dados) => createEmpresaApi(dados);

/**
 * Atualiza uma empresa.
 * @param {string} id
 * @param {object} dados
 * @returns {Promise<object>}
 */
export const updateEmpresa = (id, dados) => updateEmpresaApi(id, dados);

/**
 * Exclui uma empresa.
 * @param {string} id
 */
export const deleteEmpresa = (id) => deleteEmpresaApi(id);
