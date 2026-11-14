/**
 * Service do cadastro de Curvas de Ganho de Peso da fazenda (D-PROD-189),
 * tabela CADCURVAGANHO.
 *
 * GMD (ganho médio diário) em kg/dia por tipo de estação: ÁGUAS, TRANSIÇÃO e
 * SECA. Toda operação leva a fazenda (`empresa_id`) selecionada no topo. A
 * exclusão devolve **resultado parcial explícito**, como nos demais cadastros.
 */

import { listCurvasGanho, createCurvaGanho, updateCurvaGanho, deleteCurvaGanho } from '@/apis/curvas-ganho';
import { API_ERROR_CODES } from '@/apis/_core/ApiError';

/** Mesma faixa e precisão do servidor (D-PROD-189). */
export const GMD_MINIMO = -2;
export const GMD_MAXIMO = 3;
/** Dias usados para mostrar o ganho por mês (como referência, não como cálculo). */
export const DIAS_POR_MES = 30;

/** Os três GMD, na ordem das estações, com o rótulo exibido. */
export const CAMPOS_GMD = Object.freeze([
  Object.freeze({ campo: 'gmd_aguas', label: 'GMD nas Águas' }),
  Object.freeze({ campo: 'gmd_transicao', label: 'GMD na Transição' }),
  Object.freeze({ campo: 'gmd_seca', label: 'GMD na Seca' }),
]);

/**
 * Texto digitado (vírgula ou ponto, sinal opcional, até 3 casas) → número.
 * `null` quando o texto não é um GMD válido na faixa.
 * @param {unknown} texto
 * @returns {number|null}
 */
export const lerGmd = (texto) => {
  const t = String(texto ?? '').trim().replace(',', '.');
  if (!/^-?\d+(\.\d{1,3})?$/.test(t)) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < GMD_MINIMO || n > GMD_MAXIMO) return null;
  return Number(n.toFixed(3));
};

/**
 * Número → texto de exibição com vírgula ("0,65"; "-0,15"). Vazio sem valor.
 * @param {unknown} valor
 * @param {{ casasMin?: number }} [opcoes]
 */
export const formatarGmd = (valor, opcoes = {}) => {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return '';
  return valor.toLocaleString('pt-BR', { minimumFractionDigits: opcoes.casasMin ?? 0, maximumFractionDigits: 3 });
};

/** @param {string} empresaId */
export const listarCurvasGanho = (empresaId) => listCurvasGanho(empresaId);

/** @param {Record<string, unknown>} dados @param {{ empresaId: string }} escopo */
export const criarCurvaGanho = (dados, { empresaId }) => createCurvaGanho({ ...dados, empresa_id: empresaId });

/** @param {{ id: string, dados: Record<string, unknown>, empresaId: string }} p */
export const atualizarCurvaGanho = ({ id, dados, empresaId }) => updateCurvaGanho(id, { ...dados, empresa_id: empresaId });

/**
 * @param {string | string[]} ids
 * @param {{ empresaId: string }} escopo
 * @returns {Promise<{ excluidos: string[], bloqueados: { id: string, code: string }[] }>}
 */
export const excluirCurvasGanho = async (ids, { empresaId }) => {
  /** @type {string[]} */
  const excluidos = [];
  /** @type {{ id: string, code: string }[]} */
  const bloqueados = [];
  for (const id of Array.isArray(ids) ? ids : [ids]) {
    try {
      await deleteCurvaGanho(id, empresaId);
      excluidos.push(id);
    } catch (erro) {
      bloqueados.push({ id, code: /** @type {{ code?: string }} */ (erro)?.code ?? API_ERROR_CODES.OPERATION_FAILED });
    }
  }
  return { excluidos, bloqueados };
};
