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

/** Mesmo teto do servidor (D-PROD-215). */
export const ALTURA_MAXIMA_CM = 1000;

/** @param {unknown} tipo @returns {string} */
export const rotuloTipoCultura = (tipo) => TIPOS_CULTURA.find((t) => t.value === tipo)?.label ?? '';

/**
 * Altura para exibir: "25", "25,5"; vazio quando não há.
 * @param {unknown} valor
 * @returns {string}
 */
export const formatarAlturaCm = (valor) => {
  if (valor === null || valor === undefined || valor === '') return '';
  const n = Number(valor);
  if (!Number.isFinite(n)) return '';
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
};

/**
 * Lê a altura digitada (pt-BR). `null` = vazio; `undefined` = inválida
 * (texto, zero, negativa, mais de 1 casa ou acima do teto).
 * @param {unknown} texto
 * @returns {number|null|undefined}
 */
export const lerAlturaCm = (texto) => {
  const t = String(texto ?? '').trim();
  if (!t) return null;
  if (!/^\d+([.,]\d)?$/.test(t)) return undefined;
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > ALTURA_MAXIMA_CM) return undefined;
  return n;
};

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
