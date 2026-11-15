/**
 * Service do cadastro de Funcionários da fazenda (D-PROD-203, Fatia 4 do
 * Lançamento de Atividades).
 *
 * Toda operação leva a fazenda (`empresa_id`) selecionada no topo: a lista e o
 * detalhe são por fazenda e o servidor confere que ela é do tenant. Não há
 * exclusão: o funcionário é inativado (cadastro com custo nunca é apagado). Não
 * é folha: sem salário, encargos, ponto ou pagamento.
 */

import { createFuncionario, listFuncionariosPage, setSituacaoFuncionario, updateFuncionario } from '@/apis/funcionarios';
import { camposAlterados, exigirEmpresa, paginaVazia } from './gestaoCadastroComum.js';

/** Tipos aceitos pelo servidor, com o rótulo exibido e a medida sugerida na linha de mão de obra. */
export const TIPOS_FUNCIONARIO = Object.freeze([
  Object.freeze({ value: 'MENSALISTA', label: 'MENSALISTA' }),
  Object.freeze({ value: 'DIARISTA', label: 'DIARISTA' }),
  Object.freeze({ value: 'TAREFEIRO', label: 'TAREFEIRO' }),
]);

/** @param {unknown} tipo @returns {string} */
export const rotuloTipoFuncionario = (tipo) => TIPOS_FUNCIONARIO.find((t) => t.value === tipo)?.label ?? '';

const CAMPOS = Object.freeze(['nome', 'cargo', 'tipo', 'custo_hora', 'custo_diaria']);

/**
 * @param {string|null} empresaId
 * @param {{ limit?: number, cursor?: string|null, q?: string, ativo?: boolean }} [opts]
 */
export const listarFuncionariosPagina = async (empresaId, opts = {}) => {
  if (!empresaId) return paginaVazia(opts.limit);
  return listFuncionariosPage({ empresa_id: empresaId, limit: opts.limit, cursor: opts.cursor ?? undefined, q: opts.q, ativo: opts.ativo });
};

/** @param {string|null} empresaId @param {Record<string, any>} dados */
export const criarFuncionario = async (empresaId, dados) => {
  const empresa = exigirEmpresa(empresaId, 'criarFuncionario', 'Funcionario');
  return createFuncionario({ ...camposAlterados({}, dados, CAMPOS), empresa_id: empresa });
};

/**
 * PATCH só com o que mudou (texto vazio limpa o campo).
 * @param {string|null} empresaId @param {Record<string, any>} original @param {Record<string, any>} dados
 * @returns {Promise<{ alterado: boolean, registro: object }>}
 */
export const atualizarFuncionario = async (empresaId, original, dados) => {
  const empresa = exigirEmpresa(empresaId, 'atualizarFuncionario', 'Funcionario');
  const corpo = camposAlterados(original, dados, CAMPOS);
  if (!Object.keys(corpo).length) return { alterado: false, registro: original };
  return { alterado: true, registro: await updateFuncionario(original.id, { empresa_id: empresa, ...corpo }) };
};

/** @param {string|null} empresaId @param {string} id @param {boolean} ativo */
export const alterarSituacaoFuncionario = async (empresaId, id, ativo) =>
  setSituacaoFuncionario(id, exigirEmpresa(empresaId, 'alterarSituacaoFuncionario', 'Funcionario'), ativo === true);

/**
 * Inativação em lote (best-effort, na ordem pedida).
 * @param {string|null} empresaId @param {string[]} ids
 */
export const inativarFuncionarios = async (empresaId, ids) => {
  const ok = [];
  const falhas = [];
  for (const id of ids) {
    try {
      await alterarSituacaoFuncionario(empresaId, id, false);
      ok.push(id);
    } catch (erro) {
      falhas.push({ id, erro });
    }
  }
  return { ok, falhas };
};
