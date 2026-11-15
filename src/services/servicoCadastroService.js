/**
 * Service do cadastro de Serviços da fazenda (D-PROD-205, Fatia 4 do
 * Lançamento de Atividades).
 *
 * Toda operação leva a fazenda (`empresa_id`) selecionada no topo. A unidade de
 * medida vem do cadastro de Unidades de Medida existente (por cliente); o centro
 * de custo padrão, dos centros ATIVOS da fazenda. Não há exclusão: o serviço é
 * inativado.
 */

import {
  createServico,
  listOpcoesCentrosCustoServico,
  listServicosPage,
  setSituacaoServico,
  updateServico,
} from '@/apis/servicos';
import { listUnidades } from '@/apis/unidades-medida';
import { camposAlterados, exigirEmpresa, paginaVazia } from './gestaoCadastroComum.js';

const CAMPOS = Object.freeze(['nome', 'unidade_medida_id', 'centro_custo_padrao_id', 'valor_referencia']);

/**
 * @param {string|null} empresaId
 * @param {{ limit?: number, cursor?: string|null, q?: string, ativo?: boolean }} [opts]
 */
export const listarServicosPagina = async (empresaId, opts = {}) => {
  if (!empresaId) return paginaVazia(opts.limit);
  return listServicosPage({ empresa_id: empresaId, limit: opts.limit, cursor: opts.cursor ?? undefined, q: opts.q, ativo: opts.ativo });
};

/** @param {string|null} empresaId @param {Record<string, any>} dados */
export const criarServico = async (empresaId, dados) => {
  const empresa = exigirEmpresa(empresaId, 'criarServico', 'Servico');
  return createServico({ ...camposAlterados({}, dados, CAMPOS), empresa_id: empresa });
};

/**
 * PATCH só com o que mudou (`centro_custo_padrao_id: null` tira o padrão).
 * @param {string|null} empresaId @param {Record<string, any>} original @param {Record<string, any>} dados
 * @returns {Promise<{ alterado: boolean, registro: object }>}
 */
export const atualizarServico = async (empresaId, original, dados) => {
  const empresa = exigirEmpresa(empresaId, 'atualizarServico', 'Servico');
  const corpo = camposAlterados(original, dados, CAMPOS);
  if (!Object.keys(corpo).length) return { alterado: false, registro: original };
  return { alterado: true, registro: await updateServico(original.id, { empresa_id: empresa, ...corpo }) };
};

/** @param {string|null} empresaId @param {string} id @param {boolean} ativo */
export const alterarSituacaoServico = async (empresaId, id, ativo) =>
  setSituacaoServico(id, exigirEmpresa(empresaId, 'alterarSituacaoServico', 'Servico'), ativo === true);

/**
 * Inativação em lote (best-effort, na ordem pedida).
 * @param {string|null} empresaId @param {string[]} ids
 */
export const inativarServicos = async (empresaId, ids) => {
  const ok = [];
  const falhas = [];
  for (const id of ids) {
    try {
      await alterarSituacaoServico(empresaId, id, false);
      ok.push(id);
    } catch (erro) {
      falhas.push({ id, erro });
    }
  }
  return { ok, falhas };
};

/** Centros de custo ATIVOS da fazenda (`[{ id, numero, nome }]`) para o centro padrão. @param {string} empresaId */
export const listarCentrosCustoDoServico = (empresaId) => listOpcoesCentrosCustoServico(empresaId);

/** Unidades de medida do cliente (ativas e inativas; o formulário oferece só as ativas e a gravada). */
export const listarUnidadesDoServico = () => listUnidades();
