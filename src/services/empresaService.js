/**
 * Service do módulo Empresa (P1.1, D-PROD-18).
 *
 * A regra de nome duplicado estava dentro das mutations da página. Ela vinha
 * junto com um efeito colateral silencioso: a comparação usava a lista que o
 * React Query tinha em memória, então a validação dependia do estado do cache.
 * Aqui ela passa a comparar contra a leitura atual do provider.
 *
 * O comportamento observável é o mesmo de antes:
 *  - comparação sem diferença entre maiúsculas e minúsculas;
 *  - `trim` nas extremidades;
 *  - `create` recusa nome já existente;
 *  - `update` ignora o próprio registro;
 *  - mesma mensagem para o usuário.
 *
 * O que muda é como a UI identifica o conflito: pelo código
 * `EMPRESA_NAME_CONFLICT`, não pelo texto (QLT-P11-04).
 */

import {
  listEmpresas as listEmpresasApi,
  createEmpresa as createEmpresaApi,
  updateEmpresa as updateEmpresaApi,
  deleteEmpresa as deleteEmpresaApi,
} from '@/apis/empresa';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';

/** Chave de comparação de nome: sem espaço nas pontas, sem caixa. */
const chaveDeNome = (nome) => (typeof nome === 'string' ? nome.trim().toUpperCase() : '');

const conflito = (operation) =>
  new ApiError(API_ERROR_CODES.EMPRESA_NAME_CONFLICT, {
    operation,
    resource: 'Empresa',
  });

/**
 * Já existe outra empresa com este nome?
 * @param {Array<object>} empresas
 * @param {string} nome
 * @param {string|null} ignorarId registro que não conta (o próprio, no update)
 */
const nomeJaUsado = (empresas, nome, ignorarId = null) => {
  const alvo = chaveDeNome(nome);
  if (!alvo) return false;
  return empresas.some(
    (empresa) => chaveDeNome(empresa?.nome) === alvo && empresa?.id !== ignorarId
  );
};

/**
 * Lista empresas na ordem padrão do módulo.
 * @returns {Promise<Array<object>>}
 */
export const listEmpresas = () => listEmpresasApi();

/**
 * Cria uma empresa, recusando nome já cadastrado.
 * @param {object} dados
 * @returns {Promise<object>}
 * @throws {ApiError} `EMPRESA_NAME_CONFLICT`
 */
export const createEmpresa = async (dados) => {
  const empresas = await listEmpresasApi();
  if (nomeJaUsado(empresas, dados?.nome)) throw conflito('create');
  return createEmpresaApi(dados);
};

/**
 * Atualiza uma empresa, recusando nome já usado por **outro** registro.
 * @param {string} id
 * @param {object} dados
 * @returns {Promise<object>}
 * @throws {ApiError} `EMPRESA_NAME_CONFLICT`
 */
export const updateEmpresa = async (id, dados) => {
  const empresas = await listEmpresasApi();
  if (nomeJaUsado(empresas, dados?.nome, id)) throw conflito('update');
  return updateEmpresaApi(id, dados);
};

/**
 * Exclui uma empresa.
 * @param {string} id
 */
export const deleteEmpresa = (id) => deleteEmpresaApi(id);
