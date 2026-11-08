/**
 * Service das Naturezas Financeiras gerenciais (D-PROD-152).
 *
 * Catálogo GERENCIAL por empresa (RECEITA | DESPESA, hierarquia opcional) —
 * não é plano de contas e não gera lançamento ou valor. `tipo` é escolhido na
 * criação e nunca vai no PATCH. O servidor valida hierarquia, nome e permissão.
 */

import {
  listNaturezasFinanceirasPage,
  createNaturezaFinanceira,
  updateNaturezaFinanceira,
  listOpcoesPaiNaturezaFinanceira,
} from '@/apis/naturezas-financeiras';
import { camposAlterados, exigirEmpresa, paginaVazia } from './gestaoCadastroComum.js';

const RESOURCE = 'NaturezaFinanceira';

export const TIPOS_NATUREZA = Object.freeze(['DESPESA', 'RECEITA']);
export const ROTULO_TIPO_NATUREZA = Object.freeze({ DESPESA: 'Despesa', RECEITA: 'Receita' });

/** Campos editáveis (sem `tipo`: imutável). */
const CAMPOS_EDICAO = Object.freeze(['nome', 'descricao', 'pai_id', 'ativo']);

/** @param {unknown} t @returns {t is 'RECEITA'|'DESPESA'} */
export const ehTipoNatureza = (t) => t === 'RECEITA' || t === 'DESPESA';

/**
 * @param {string|null} empresaId
 * @param {{ limit?: number, cursor?: string|null, q?: string, ativo?: boolean, tipo?: string }} [opts]
 */
export const listarNaturezasPagina = async (empresaId, opts = {}) => {
  if (!empresaId) return paginaVazia(opts.limit);
  return listNaturezasFinanceirasPage({
    empresa_id: empresaId,
    limit: opts.limit,
    cursor: opts.cursor ?? undefined,
    q: opts.q,
    ativo: opts.ativo,
    tipo: ehTipoNatureza(opts.tipo) ? opts.tipo : undefined,
  });
};

/** @param {string|null} empresaId @param {Record<string, any>} dados */
export const criarNatureza = async (empresaId, dados) => {
  const empresa = exigirEmpresa(empresaId, 'criarNatureza', RESOURCE);
  const corpo = camposAlterados({}, dados, ['tipo', 'nome', 'descricao', 'pai_id']);
  return createNaturezaFinanceira({ ...corpo, empresa_id: empresa });
};

/**
 * PATCH só com o que mudou (nunca `tipo`). `pai_id: null` = virar raiz.
 * @param {string|null} empresaId @param {Record<string, any>} original @param {Record<string, any>} dados
 * @returns {Promise<{ alterado: boolean, registro: object }>}
 */
export const atualizarNatureza = async (empresaId, original, dados) => {
  const empresa = exigirEmpresa(empresaId, 'atualizarNatureza', RESOURCE);
  const corpo = camposAlterados(original, dados, CAMPOS_EDICAO);
  if (!Object.keys(corpo).length) return { alterado: false, registro: original };
  const registro = await updateNaturezaFinanceira(original.id, { empresa_id: empresa, ...corpo });
  return { alterado: true, registro };
};

/** @param {string|null} empresaId @param {string} id @param {boolean} ativo */
export const alterarSituacaoNatureza = async (empresaId, id, ativo) => {
  const empresa = exigirEmpresa(empresaId, 'alterarSituacaoNatureza', RESOURCE);
  return updateNaturezaFinanceira(id, { empresa_id: empresa, ativo: ativo === true });
};

/** Inativação em lote (best-effort, na ordem pedida). @param {string|null} empresaId @param {string[]} ids */
export const inativarNaturezas = async (empresaId, ids) => {
  const ok = [];
  const falhas = [];
  for (const id of ids) {
    try {
      await alterarSituacaoNatureza(empresaId, id, false);
      ok.push(id);
    } catch (erro) {
      falhas.push({ id, erro });
    }
  }
  return { ok, falhas };
};

/**
 * Uma página de opções de pai, pesquisada no servidor. Sem empresa ou sem tipo
 * não há busca (nada é carregado "para depois filtrar").
 * @param {string|null} empresaId
 * @param {{ tipo?: string|null, q?: string, excluirId?: string|null, limit?: number, cursor?: string|null }} opts
 */
export const listarOpcoesPaiNatureza = async (empresaId, opts) => {
  if (!empresaId || !ehTipoNatureza(opts?.tipo)) return { itens: [], has_more: false, next_cursor: null };
  return listOpcoesPaiNaturezaFinanceira({
    empresa_id: empresaId,
    tipo: opts.tipo,
    q: opts.q?.trim() || undefined,
    excluir_id: opts.excluirId || undefined,
    limit: opts.limit ?? 50,
    cursor: opts.cursor || undefined,
  });
};

/** Caminho do PAI a partir do caminho do nó ("A / B / C" → "A / B"). @param {{ caminho?: string|null, pai_nome?: string|null, pai_id?: string|null }} item */
export const caminhoDoPai = (item) => {
  if (!item?.pai_id) return '';
  const partes = String(item.caminho || '').split(' / ');
  return partes.length > 1 ? partes.slice(0, -1).join(' / ') : item.pai_nome || '';
};
