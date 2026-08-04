/**
 * Service de Categorias de Manejo (P1.3, D-PROD-18).
 *
 * Os ícones de lote vêm da superfície pública do módulo de mapa, que já expõe
 * `ConfiguracaoIcone` por tipo de entidade. Reler a entidade aqui criaria duas
 * fontes para o mesmo dado (QLT-P13-04).
 */

import {
  listCategoriasManejo,
  createCategoriaManejo,
  updateCategoriaManejo,
  deleteCategoriaManejo,
} from '@/apis/categorias-manejo';
import { listLotes, listMovimentacoesPecuarias, listSuplementacaoLotes } from '@/apis/lotes';
import { listManejosTecnicos } from '@/apis/rebanho';
import { API_ERROR_CODES } from '@/apis/_core/ApiError';
import { listarIconesPorTipoEntidade } from './mapaService';
import { assertExclusaoPermitida } from './deleteGuardService';

/** @param {any[]} items @param {string} empresaId @returns {any[]} */
const daEmpresa = (items, empresaId) => items.filter((item) => item.empresa_id === empresaId);

/** @returns {Promise<any[]>} */
export const listarCategoriasManejoDaEmpresa = async (empresaId) =>
  daEmpresa(await listCategoriasManejo(), empresaId);

/**
 * Ícones ativos de Lote da empresa. Reusa a capacidade do módulo de mapa em vez
 * de reler `ConfiguracaoIcone` por conta própria.
 */
export const listarIconesDeLoteDaEmpresa = async (empresaId) => {
  const icones = await listarIconesPorTipoEntidade('Lote');
  return icones.filter((icone) => icone.empresa_id === empresaId && icone.ativo !== false);
};

/**
 * Criação e atualização passam o payload **como a página monta**.
 *
 * Não há normalização de números aqui de propósito: a tela não fazia nenhuma, e
 * introduzir coerção (`'' → null`) nesta slice mudaria o dado gravado sem que a
 * migração de fronteira pedisse. Se essa normalização for desejável, ela é
 * mudança de comportamento e merece decisão própria.
 */
export const criarCategoriaManejo = async (dados) => createCategoriaManejo(dados);

export const atualizarCategoriaManejo = async (id, dados) => updateCategoriaManejo(id, dados);

/** Um carregador por entidade dependente declarada em `deleteRules`. */
const CARREGADORES = Object.freeze({
  Lote: () => listLotes(),
  MovimentacaoPecuaria: () => listMovimentacoesPecuarias(),
  ManejoTecnicoRebanho: () => listManejosTecnicos(),
  SuplementacaoLote: () => listSuplementacaoLotes(),
});

export const excluirCategoriaManejo = async (id) => {
  const atual = (await listCategoriasManejo()).find((item) => item.id === id) || null;
  await assertExclusaoPermitida({
    entityName: 'CategoriaManejo',
    id,
    currentRecord: atual,
    carregadores: CARREGADORES,
    blockedCode: API_ERROR_CODES.CATEGORIA_MANEJO_DELETE_BLOCKED,
    operation: 'excluirCategoriaManejo',
  });
  return deleteCategoriaManejo(id);
};
