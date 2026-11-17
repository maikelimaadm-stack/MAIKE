/**
 * Service do Cadastro de Culturas (D-PROD-215), tabela CADCULTURAS.
 *
 * Toda operação leva a fazenda (`empresa_id`) selecionada no topo. O código
 * (numeração "001", "002"…) é sugerido pelo servidor quando vem vazio. As
 * alturas de referência são em cm, digitadas em pt-BR ("25,5") e enviadas como
 * TEXTO (o servidor lê vírgula ou ponto). A exclusão devolve **resultado
 * parcial explícito**, como nos demais cadastros do motor Base1.
 */

import { listCulturas, createCultura, incluirListaReferenciaCulturas, updateCultura, deleteCultura } from '@/apis/culturas';
import { API_ERROR_CODES } from '@/apis/_core/ApiError';

/** Tipos aceitos pelo servidor, com o rótulo exibido. */
export const TIPOS_CULTURA = Object.freeze([
  Object.freeze({ value: 'PASTAGEM', label: 'PASTAGEM' }),
  Object.freeze({ value: 'CAPINEIRA', label: 'CAPINEIRA' }),
  Object.freeze({ value: 'LAVOURA', label: 'LAVOURA' }),
  Object.freeze({ value: 'SILAGEM', label: 'SILAGEM' }),
]);

// D-PROD-223: as leituras puras das alturas e dos dias de descanso moram no domínio
// (também usadas pelo formulário da Área); reexportadas aqui como antes.
export { ALTURA_MAXIMA_CM, DIAS_DESCANSO_MAXIMO, formatarAlturaCm, lerAlturaCm, lerDiasDescanso } from '@/domain/pastagem/parametrosManejo';

/** @param {unknown} tipo @returns {string} */
export const rotuloTipoCultura = (tipo) => TIPOS_CULTURA.find((t) => t.value === tipo)?.label ?? '';

/** @param {string} empresaId */
export const listarCulturas = (empresaId) => listCulturas(empresaId);

/** @param {Record<string, unknown>} dados @param {{ empresaId: string }} escopo */
export const criarCultura = (dados, { empresaId }) => createCultura({ ...dados, empresa_id: empresaId });

/** @param {{ id: string, dados: Record<string, unknown>, empresaId: string }} p */
export const atualizarCultura = ({ id, dados, empresaId }) => updateCultura(id, { ...dados, empresa_id: empresaId });

/** @param {string} empresaId */
export const incluirListaReferencia = (empresaId) => incluirListaReferenciaCulturas(empresaId);

/**
 * @param {string | string[]} ids
 * @param {{ empresaId: string }} escopo
 * @returns {Promise<{ excluidos: string[], bloqueados: { id: string, code: string }[] }>}
 */
export const excluirCulturas = async (ids, { empresaId }) => {
  /** @type {string[]} */
  const excluidos = [];
  /** @type {{ id: string, code: string }[]} */
  const bloqueados = [];

  for (const id of Array.isArray(ids) ? ids : [ids]) {
    try {
      await deleteCultura(id, empresaId);
      excluidos.push(id);
    } catch (erro) {
      bloqueados.push({
        id,
        code: /** @type {{ code?: string }} */ (erro)?.code ?? API_ERROR_CODES.OPERATION_FAILED,
      });
    }
  }

  return { excluidos, bloqueados };
};
