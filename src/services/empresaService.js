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

/**
 * Exclusão em lote — resultado honesto por id (sem contagem falsa).
 * @param {string[]} ids
 * @returns {Promise<{ excluidos: string[], bloqueados: { id: string, erro: unknown }[] }>}
 */
export const excluirEmpresas = async (ids) => {
  const excluidos = [];
  const bloqueados = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    try {
      await deleteEmpresaApi(id);
      excluidos.push(id);
    } catch (erro) {
      bloqueados.push({ id, erro });
    }
  }
  return { excluidos, bloqueados };
};
