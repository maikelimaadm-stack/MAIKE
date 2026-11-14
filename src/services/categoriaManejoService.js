/**
 * Service de Categorias de Manejo (P1.3, D-PROD-18).
 */

import {
  listCategoriasManejo,
  createCategoriaManejo,
  updateCategoriaManejo,
  deleteCategoriaManejo,
  listOpcoesCurvasGanhoCategoriaManejo,
} from '@/apis/categorias-manejo';
import { listLotes, listMovimentacoesPecuarias, listSuplementacaoLotes } from '@/apis/lotes';
import { listManejosTecnicos } from '@/apis/rebanho';
import { API_ERROR_CODES } from '@/apis/_core/ApiError';
import { assertExclusaoPermitida } from './deleteGuardService';

/** @param {any[]} items @param {string} empresaId @returns {any[]} */
const daEmpresa = (items, empresaId) => items.filter((item) => item.empresa_id === empresaId);

/** @returns {Promise<any[]>} */
export const listarCategoriasManejoDaEmpresa = async (empresaId) =>
  daEmpresa(await listCategoriasManejo(), empresaId);

/** Vazio vira `null`; caso contrário converte. Preservado da página. */
const inteiroOuNulo = (valor) => {
  if (valor === undefined || valor === null || valor === '') return null;
  const parsed = parseInt(String(valor).trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
};
const maiusculoOuNulo = (valor) => (valor ? String(valor).toUpperCase() : null);
/** Id escolhido no select; vazio vira `null` (o servidor responde `curva_obrigatoria`). */
const idOuNulo = (valor) => (typeof valor === 'string' && valor.trim() ? valor.trim() : null);

/**
 * Payload normalizado da categoria de manejo (P1.3-R1).
 *
 * Esta transformação **estava na página**, dentro de `handleSubmit`: uppercase,
 * `parseInt`, vazio→null, `empresa_id` e `ativo`. A P1.3 migrou a fronteira de
 * dados mas deixou a regra de payload no componente — e o relatório daquela
 * slice afirmou, por engano, que a tela não normalizava. Ela normalizava; a
 * leitura parou no `mutationFn`, que só repassava o objeto já pronto.
 *
 * O cadastro tem só nome, sigla, espécie, sexo e faixa de idade. Raça,
 * categoria oficial (texto), ganho de peso anual, os doze GMDs mensais e o
 * vínculo com o ícone oficial (D-PROD-187) saíram do cadastro e **não** são
 * enviados, mesmo que o `formData` ainda os traga (registro antigo aberto
 * para edição).
 *
 * Curva de ganho (D-PROD-195): obrigatória e da MESMA fazenda; `curva_ganho_id`
 * vai SEMPRE, no POST e no PATCH (manter a gravada, mesmo inativada, é permitido).
 *
 * Faixa de idade (decisão do proprietário, 2026-11-13): o formulário só
 * oferece as cinco faixas fixas. Na **edição**, as idades só vão no corpo
 * quando o usuário mexeu no select (`faixa_idade_alterada`): salvar sem
 * mexer deixa o par gravado intocado no servidor, mesmo um par legado fora
 * da lista. Na criação vão sempre (o servidor exige uma das cinco).
 *
 * @param {object} formData
 * @param {{empresaId?: string, edicao?: boolean}} [opcoes]
 * @returns {object}
 */
export const normalizarCategoriaManejo = (formData, { empresaId, edicao = false } = {}) => {
  const payload = {
    empresa_id: empresaId ?? formData.empresa_id,
    nome: formData.nome.toUpperCase(),
    sigla: maiusculoOuNulo(formData.sigla),
    especie: formData.especie || null,
    sexo: formData.sexo || null,
    curva_ganho_id: idOuNulo(formData.curva_ganho_id),
    ativo: true,
  };
  if (edicao && formData.faixa_idade_alterada !== true) return payload;
  return {
    ...payload,
    idade_minima_meses: inteiroOuNulo(formData.idade_minima_meses),
    idade_maxima_meses: inteiroOuNulo(formData.idade_maxima_meses),
  };
};

/**
 * Curvas de ganho da fazenda para o seletor da categoria (D-PROD-195): ativas
 * e inativas, em ordem de nome. Rota própria do cadastro, não a da tela de curvas.
 * @param {string} empresaId
 * @returns {Promise<Array<{ id: string, nome: string, ativo: boolean }>>}
 */
export const listarCurvasGanhoParaCategoria = (empresaId) => listOpcoesCurvasGanhoCategoriaManejo(empresaId);

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
  updateCategoriaManejo(id, normalizarCategoriaManejo(formData, { empresaId, edicao: true }));

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
