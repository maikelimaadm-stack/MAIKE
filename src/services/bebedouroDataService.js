/**
 * Service de dados de Bebedouros (P1.3, D-PROD-18).
 *
 * Substitui `src/repositories/bebedouroRepository.js`, removido nesta slice.
 * `src/services/bebedouroService.js` continua existindo e não foi tocado: ele
 * guarda regra visual e de domínio (status, escore, cor), que é outra
 * responsabilidade. Este arquivo cuida só de leitura e escrita.
 */

import {
  listBebedouros,
  createBebedouro,
  updateBebedouro,
  listHistorico,
  createHistorico,
  deleteHistorico,
  listSanidade,
  createSanidade,
  listAlertas,
} from '@/apis/bebedouros';
import { getCurrentUser } from './sessionService';

/**
 * @param {any[]} items
 * @param {string} empresaId
 * @param {string} [bebedouroId]
 * @returns {any[]}
 */
const filtrar = (items, empresaId, bebedouroId) =>
  items.filter(
    (item) => item.empresa_id === empresaId && (!bebedouroId || item.bebedouro_id === bebedouroId)
  );

/** Bebedouros ativos da empresa, na ordem que o repositório usava. */
export const listarBebedouros = async (empresaId) => {
  const todos = await listBebedouros();
  return todos.filter((item) => item.empresa_id === empresaId && item.ativo !== false);
};

export const criarBebedouro = async (dados) => createBebedouro(dados);
export const atualizarBebedouro = async (id, dados) => updateBebedouro(id, dados);

/** @returns {Promise<any[]>} */
export const listarHistorico = async (empresaId, bebedouroId) =>
  filtrar(await listHistorico(), empresaId, bebedouroId);

/**
 * Cria um lançamento de histórico.
 *
 * O responsável vem da **sessão**, não de `base44.auth.me()` chamado dentro do
 * componente: quem sabe resolver usuário — inclusive o fallback offline — é o
 * `sessionService`.
 */
export const criarHistorico = async (dados) => {
  const usuario = await getCurrentUser();
  return createHistorico({
    ...dados,
    responsavel: dados.responsavel || usuario?.full_name || usuario?.email || null,
  });
};

export const excluirHistorico = async (id) => deleteHistorico(id);

/** @returns {Promise<any[]>} */
export const listarSanidade = async (empresaId, bebedouroId) =>
  filtrar(await listSanidade(), empresaId, bebedouroId);

export const criarSanidade = async (dados) => createSanidade(dados);

/** @returns {Promise<any[]>} */
export const listarAlertas = async (empresaId, bebedouroId) =>
  filtrar(await listAlertas(), empresaId, bebedouroId);
