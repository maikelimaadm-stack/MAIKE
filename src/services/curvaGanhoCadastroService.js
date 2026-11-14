/**
 * Service do cadastro de Curvas de Ganho de Peso da fazenda (D-PROD-189;
 * mensal desde a D-PROD-194), tabela CADCURVAGANHO.
 *
 * GMD (ganho médio diário) em kg/dia para cada mês do calendário, de janeiro a
 * dezembro. A curva não depende das Estações: o mês já diz o GMD. Toda operação
 * leva a fazenda (`empresa_id`) selecionada no topo. A exclusão devolve
 * **resultado parcial explícito**, como nos demais cadastros.
 */

import { listCurvasGanho, createCurvaGanho, updateCurvaGanho, deleteCurvaGanho } from '@/apis/curvas-ganho';
import { API_ERROR_CODES } from '@/apis/_core/ApiError';

/** Mesma faixa e precisão do servidor (D-PROD-189/190). */
export const GMD_MINIMO = -2;
export const GMD_MAXIMO = 3;
/** Dias de um ano comum (fevereiro com 28), base do ganho no ano e da média. */
export const DIAS_NO_ANO = 365;

/**
 * Os 12 meses, na ordem do calendário: campo da API, rótulo curto, nome e
 * dias do mês (fevereiro com 28, ano comum). O ganho do mês usa os dias reais,
 * não 30 fixos.
 */
export const MESES = Object.freeze(
  /** @type {Array<[string, string, string, number]>} */ ([
    ['jan', 'Jan', 'Janeiro', 31],
    ['fev', 'Fev', 'Fevereiro', 28],
    ['mar', 'Mar', 'Março', 31],
    ['abr', 'Abr', 'Abril', 30],
    ['mai', 'Mai', 'Maio', 31],
    ['jun', 'Jun', 'Junho', 30],
    ['jul', 'Jul', 'Julho', 31],
    ['ago', 'Ago', 'Agosto', 31],
    ['set', 'Set', 'Setembro', 30],
    ['out', 'Out', 'Outubro', 31],
    ['nov', 'Nov', 'Novembro', 30],
    ['dez', 'Dez', 'Dezembro', 31],
  ]).map(([mes, curto, nome, dias]) => Object.freeze({ campo: /** @type {string} */ (`gmd_${mes}`), curto, nome, dias })),
);

/** Os 12 campos `gmd_<mes>`, na ordem. */
export const CAMPOS_GMD = Object.freeze(MESES.map((m) => m.campo));

/**
 * Divisão inteira arredondada, com meio arredondado para longe do zero
 * (-1,55 → -1,6, como 1,55 → 1,6). Os GMD têm no máximo 3 casas, então as
 * contas correm em gramas inteiros, sem ruído de ponto flutuante.
 * @param {number} inteiro @param {number} divisor
 */
const dividirArredondado = (inteiro, divisor) => Math.sign(inteiro) * Math.round(Math.abs(inteiro) / divisor);
/** GMD (kg/dia, até 3 casas) → gramas por dia, inteiro. @param {number} gmd */
const gramas = (gmd) => Math.round(gmd * 1000);

/**
 * Ganho do mês em kg: GMD × dias do mês, arredondado a 1 casa.
 * @param {number} gmd @param {number} dias
 */
export const ganhoNoMes = (gmd, dias) => dividirArredondado(gramas(gmd) * dias, 100) / 10;

/**
 * Resumo da curva: ganho no ano (kg, soma de GMD × dias de cada mês) e a média
 * diária ponderada pelos dias (ganho no ano ÷ 365). `null` se algum mês falta.
 * @param {Array<number|null|undefined>} valores os 12 GMD, de janeiro a dezembro
 * @returns {{ ganhoAno: number, mediaDia: number } | null}
 */
export const resumoDaCurva = (valores) => {
  if (!Array.isArray(valores) || valores.length !== MESES.length) return null;
  if (valores.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return null;
  const g = valores.reduce((soma, v, i) => soma + gramas(/** @type {number} */ (v)) * MESES[i].dias, 0);
  return { ganhoAno: dividirArredondado(g, 100) / 10, mediaDia: dividirArredondado(g, DIAS_NO_ANO) / 1000 };
};

/** Os 12 GMD de uma curva da API, na ordem dos meses. @param {Record<string, unknown> | null | undefined} curva */
export const gmdsDaCurva = (curva) => CAMPOS_GMD.map((c) => /** @type {number|undefined} */ (curva?.[c]));

/**
 * Peso em kg com vírgula e 1 casa ("21,7"; "-1,6").
 * @param {unknown} valor
 */
export const formatarKg = (valor) => {
  if (typeof valor !== 'number' || !Number.isFinite(valor)) return '';
  return (valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
};

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
  // `|| 0` troca o -0 (de um arredondamento negativo até zero) por 0: nunca "-0".
  return (valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: opcoes.casasMin ?? 0, maximumFractionDigits: 3 });
};

/** @param {string} empresaId */
export const listarCurvasGanho = (empresaId) => listCurvasGanho(empresaId);

/** @param {Record<string, unknown>} dados @param {{ empresaId: string }} escopo */
export const criarCurvaGanho = (dados, { empresaId }) => createCurvaGanho({ ...dados, empresa_id: empresaId });

/** @param {{ id: string, dados: Record<string, unknown>, empresaId: string }} p */
export const atualizarCurvaGanho = ({ id, dados, empresaId }) => updateCurvaGanho(id, { ...dados, empresa_id: empresaId });

/**
 * D-PROD-195: frase do 409 `CURVA_GANHO_EM_USO`, com quantas categorias de
 * manejo usam a curva (`details.categorias`); sem a contagem, a do catálogo.
 * @param {unknown} categorias
 */
export const mensagemCurvaEmUso = (categorias) => {
  const n = Number(categorias);
  return Number.isInteger(n) && n > 0
    ? `Esta curva está ligada a ${n} categoria(s) de manejo e não pode ser excluída.`
    : 'Esta curva está ligada a categoria(s) de manejo e não pode ser excluída.';
};

/**
 * Aviso das curvas não excluídas: uma só, em uso → a frase com a contagem;
 * várias → quantas falharam e quantas estão ligadas a categorias.
 * @param {{ id: string, code: string, categorias?: number }[]} bloqueados
 */
export const mensagemExclusaoBloqueada = (bloqueados) => {
  const emUso = bloqueados.filter((b) => b.code === API_ERROR_CODES.CURVA_GANHO_EM_USO);
  if (bloqueados.length === 1) {
    return emUso.length ? mensagemCurvaEmUso(emUso[0].categorias) : '1 curva de ganho não pôde ser excluída.';
  }
  const total = `${bloqueados.length} curvas de ganho não puderam ser excluídas.`;
  if (!emUso.length) return total;
  return `${total} ${emUso.length === 1 ? '1 está ligada' : `${emUso.length} estão ligadas`} a categorias de manejo.`;
};

/**
 * @param {string | string[]} ids
 * @param {{ empresaId: string }} escopo
 * @returns {Promise<{ excluidos: string[], bloqueados: { id: string, code: string, categorias?: number }[] }>}
 */
export const excluirCurvasGanho = async (ids, { empresaId }) => {
  /** @type {string[]} */
  const excluidos = [];
  /** @type {{ id: string, code: string, categorias?: number }[]} */
  const bloqueados = [];
  for (const id of Array.isArray(ids) ? ids : [ids]) {
    try {
      await deleteCurvaGanho(id, empresaId);
      excluidos.push(id);
    } catch (erro) {
      const e = /** @type {{ code?: string, details?: { categorias?: unknown } }} */ (erro);
      const code = e?.code ?? API_ERROR_CODES.OPERATION_FAILED;
      const categorias = Number(e?.details?.categorias);
      // D-PROD-195: a curva em uso diz quantas categorias a usam.
      bloqueados.push(
        code === API_ERROR_CODES.CURVA_GANHO_EM_USO && Number.isInteger(categorias) && categorias > 0
          ? { id, code, categorias }
          : { id, code },
      );
    }
  }
  return { excluidos, bloqueados };
};
