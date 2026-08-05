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

const MESES_GMD = Object.freeze([
  'gmd_janeiro', 'gmd_fevereiro', 'gmd_marco', 'gmd_abril', 'gmd_maio', 'gmd_junho',
  'gmd_julho', 'gmd_agosto', 'gmd_setembro', 'gmd_outubro', 'gmd_novembro', 'gmd_dezembro',
]);

/** Vazio vira `null`; caso contrário converte. Preservado da página. */
const inteiroOuNulo = (valor) => (valor ? parseInt(valor, 10) : null);
const decimalOuNulo = (valor) => (valor ? parseFloat(valor) : null);
const maiusculoOuNulo = (valor) => (valor ? String(valor).toUpperCase() : null);

/**
 * Payload normalizado da categoria de manejo (P1.3-R1).
 *
 * Esta transformação **estava na página**, dentro de `handleSubmit`: uppercase,
 * `parseInt`, `parseFloat`, vazio→null, `empresa_id` e `ativo`, mais os doze
 * GMDs escritos campo a campo. A P1.3 migrou a fronteira de dados mas deixou a
 * regra de payload no componente — e o relatório daquela slice afirmou, por
 * engano, que a tela não normalizava. Ela normalizava; a leitura parou no
 * `mutationFn`, que só repassava o objeto já pronto.
 *
 * A transformação aqui é **idêntica** à anterior, campo a campo. Nada foi
 * corrigido de passagem: `parseFloat` continua sem entender vírgula decimal
 * (DBT-25), porque consertar isso mudaria o dado gravado e é decisão própria.
 *
 * @param {object} formData
 * @param {{empresaId?: string}} [opcoes]
 * @returns {object}
 */
export const normalizarCategoriaManejo = (formData, { empresaId } = {}) => ({
  empresa_id: empresaId ?? formData.empresa_id,
  nome: formData.nome.toUpperCase(),
  sigla: formData.sigla.toUpperCase(),
  especie: formData.especie,
  sexo: formData.sexo || null,
  raca: maiusculoOuNulo(formData.raca),
  idade_minima_meses: inteiroOuNulo(formData.idade_minima_meses),
  idade_maxima_meses: inteiroOuNulo(formData.idade_maxima_meses),
  categoria_oficial: formData.categoria_oficial || null,
  ganho_peso_anual_kg: decimalOuNulo(formData.ganho_peso_anual_kg),
  ...Object.fromEntries(MESES_GMD.map((mes) => [mes, decimalOuNulo(formData[mes])])),
  ativo: true,
});

/**
 * @param {object} formData
 * @param {{empresaId?: string}} [opcoes]
 */
export const criarCategoriaManejo = async (formData, { empresaId } = {}) =>
  createCategoriaManejo(normalizarCategoriaManejo(formData, { empresaId }));

/**
 * @param {string} id
 * @param {object} formData
 * @param {{empresaId?: string}} [opcoes]
 */
export const atualizarCategoriaManejo = async (id, formData, { empresaId } = {}) =>
  updateCategoriaManejo(id, normalizarCategoriaManejo(formData, { empresaId }));

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
