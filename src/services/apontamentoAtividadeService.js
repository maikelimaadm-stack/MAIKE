/**
 * Service de Apontamentos de Atividade (D-PROD-190, Fatia C).
 *
 * A TAREFA (`LancamentoTarefa`) é a demanda; o APONTAMENTO é a EXECUÇÃO de um
 * Tipo de Atividade (D-PROD-182): a operação feita, com máquina, implemento,
 * operador, área, horário e produção. Base enxuta, SEM itens de custo.
 *
 * Da EMPRESA real: sem empresa nada é lido nem gravado. Edição por PATCH
 * MÍNIMO com a `versao` lida (CAS no servidor); sem DELETE físico — cancelar
 * exige motivo e também leva a `versao`. Os seletores vêm das rotas PRÓPRIAS
 * da tela; tipos (só os ativos são oferecidos) e áreas reaproveitam as leituras
 * já abertas a quem está autenticado.
 */

import {
  listApontamentosAtividadePage,
  getApontamentoAtividade,
  createApontamentoAtividade,
  updateApontamentoAtividade,
  cancelarApontamentoAtividade,
  listOpcoesApontamentoAtividade,
} from '@/apis/atividades';
import { ApiError, API_ERROR_CODES } from '@/apis/_core/ApiError';
import { MOTIVO_MINIMO, camposAlteradosDoApontamento } from '@/lib/apontamentoAtividadeRegras';
import { exigirEmpresa, paginaVazia } from './gestaoCadastroComum.js';
import { listarAreasAtivas } from './mapaService.js';

export { listarTiposAtividade } from './tipoAtividadeCadastroService.js';

const RESOURCE = 'ApontamentoAtividade';

/** Página padrão da lista. */
export const POR_PAGINA_APONTAMENTOS = 100;

/** @param {unknown} v */
const textoOuIndefinido = (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

// ─── Leitura ─────────────────────────────────────────────────────────────

/**
 * Uma página (keyset) dos apontamentos da empresa. Sem empresa: página vazia, nada é lido.
 * @param {string|null} empresaId
 * @param {{ limit?: number, cursor?: string|null, q?: string, dataDe?: string|null, dataAte?: string|null,
 *   bemId?: string|null, tipoAtividadeId?: string|null, areaId?: string|null, status?: string|null }} [opts]
 */
export const listarApontamentosPagina = async (empresaId, opts = {}) => {
  const limit = opts.limit ?? POR_PAGINA_APONTAMENTOS;
  if (!empresaId) return paginaVazia(limit);
  return listApontamentosAtividadePage({
    empresa_id: empresaId,
    data_de: textoOuIndefinido(opts.dataDe),
    data_ate: textoOuIndefinido(opts.dataAte),
    bem_id: textoOuIndefinido(opts.bemId),
    tipo_atividade_id: textoOuIndefinido(opts.tipoAtividadeId),
    area_id: textoOuIndefinido(opts.areaId),
    status: textoOuIndefinido(opts.status),
    q: textoOuIndefinido(opts.q),
    limit,
    cursor: textoOuIndefinido(opts.cursor),
  });
};

/** @param {string|null} empresaId @param {string} id */
export const detalharApontamento = async (empresaId, id) =>
  getApontamentoAtividade(id, exigirEmpresa(empresaId, 'detalharApontamento', RESOURCE));

/**
 * Opções de um seletor da tela (bens, operadores, centros de custo e de
 * resultado ATIVOS). Sem empresa: vazio, nada é lido.
 * @param {'bens'|'operadores'|'centros-custo'|'centros-resultado'} recurso
 * @param {string|null} empresaId
 * @param {{ q?: string, cursor?: string|null, limit?: number, natureza?: readonly string[] }} [opts]
 */
export const listarOpcoesApontamento = async (recurso, empresaId, opts = {}) => {
  if (!empresaId) return { itens: [], has_more: false, next_cursor: null };
  return listOpcoesApontamentoAtividade(recurso, {
    empresa_id: empresaId,
    q: textoOuIndefinido(opts.q),
    cursor: textoOuIndefinido(opts.cursor),
    limit: opts.limit,
    ...(recurso === 'bens' && Array.isArray(opts.natureza) && opts.natureza.length ? { natureza: [...opts.natureza] } : {}),
  });
};

/** Áreas ATIVAS da empresa (o seletor; a área gravada que ficou inativa vem do próprio registro). @param {string|null} empresaId */
export const listarAreasDoApontamento = async (empresaId) => (empresaId ? listarAreasAtivas(empresaId) : []);

// ─── Gravação ────────────────────────────────────────────────────────────

/**
 * POST: o corpo do formulário (`corpoDoFormulario`) na empresa real.
 * @param {string|null} empresaId @param {Record<string, unknown>} dados
 */
export const criarApontamento = async (empresaId, dados) =>
  createApontamentoAtividade({ ...dados, empresa_id: exigirEmpresa(empresaId, 'criarApontamento', RESOURCE) });

/**
 * PATCH mínimo: só o que mudou, com a `versao` lida. Nada mudou → nenhuma
 * requisição (`alterado: false`).
 * @param {string|null} empresaId @param {any} original @param {Record<string, any>} dados
 * @returns {Promise<{ alterado: boolean, registro: any }>}
 */
export const atualizarApontamento = async (empresaId, original, dados) => {
  const emp = exigirEmpresa(empresaId, 'atualizarApontamento', RESOURCE);
  const mudancas = camposAlteradosDoApontamento(original, dados);
  if (!Object.keys(mudancas).length) return { alterado: false, registro: original };
  const registro = await updateApontamentoAtividade(String(original.id), { ...mudancas, empresa_id: emp, versao: original.versao });
  return { alterado: true, registro };
};

/**
 * Cancelamento (sem DELETE): motivo de pelo menos 3 caracteres e a `versao`
 * lida. Motivo curto falha ANTES da rede.
 * @param {string|null} empresaId @param {{ id: string, versao: number }} registro @param {string} motivo
 */
export const cancelarApontamento = async (empresaId, registro, motivo) => {
  const emp = exigirEmpresa(empresaId, 'cancelarApontamento', RESOURCE);
  const limpo = typeof motivo === 'string' ? motivo.trim() : '';
  if ([...limpo].length < MOTIVO_MINIMO) {
    throw new ApiError(API_ERROR_CODES.INVALID_ARGUMENT, {
      operation: 'cancelarApontamento',
      resource: RESOURCE,
      details: { field: 'motivo', reason: 'min_length' },
    });
  }
  return cancelarApontamentoAtividade(String(registro.id), { empresa_id: emp, versao: registro.versao, motivo: limpo });
};
