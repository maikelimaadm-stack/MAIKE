/**
 * D-PROD-221 — Farol de forragem do pasto (fonte única, módulo puro).
 *
 * O farol do pasto é a ÚLTIMA medição de forragem dele (D-PROD-219): o dia da medição e,
 * no mesmo dia, a hora do registro. A cor vem da situação gravada:
 *   RAPADO → vermelho · DESCANSO → amarelo · PRONTO → verde · PASSOU → roxo.
 * Medição com mais de `DIAS_VALIDADE_FORRAGEM` dias (15, decisão do proprietário) não
 * vale mais: o pasto fica cinza, "sem medição recente". Medição pela régua sem situação
 * (pasto sem cultura) também fica cinza. Medição "no olho" usa a mesma cor, um tom mais
 * claro, e é marcada com 👁 — o proprietário vê que não foi régua.
 * Sem nenhuma medição: `null` (o mapa pinta de neutro "sem medição").
 * A estimativa pelos dias de descanso NÃO entra aqui (fica para depois).
 */
import { diasEntre, ehDiaValido } from '@/lib/diaCivil';
import { ROTULO_SITUACAO } from './medicaoForragem';

/** Depois de quantos dias a medição deixa de valer no farol. */
export const DIAS_VALIDADE_FORRAGEM = 15;

/** Cores do farol (hex: o mapa pinta o polígono com elas). */
export const COR_SITUACAO_FORRAGEM = Object.freeze({
  RAPADO: '#dc2626',
  DESCANSO: '#eab308',
  PRONTO: '#16a34a',
  PASSOU: '#9333ea',
});
/** Medição velha (> 15 dias) ou régua sem situação. */
export const COR_FORRAGEM_VENCIDA = '#94a3b8';
/** Pasto que nunca foi medido. */
export const COR_FORRAGEM_SEM_MEDICAO = '#e5e7eb';
/** Marcador da medição no olho. */
export const MARCA_OLHO = '👁';

/** Legenda do modo "Forragem" (rótulo → cor), na ordem em que aparece. */
export const LEGENDA_FORRAGEM = Object.freeze({
  Rapado: COR_SITUACAO_FORRAGEM.RAPADO,
  Descanso: COR_SITUACAO_FORRAGEM.DESCANSO,
  Pronto: COR_SITUACAO_FORRAGEM.PRONTO,
  'Passou do ponto': COR_SITUACAO_FORRAGEM.PASSOU,
  [`Sem medição recente (> ${DIAS_VALIDADE_FORRAGEM} dias)`]: COR_FORRAGEM_VENCIDA,
  'Nunca medido': COR_FORRAGEM_SEM_MEDICAO,
});

/**
 * Clareia um hex (#rrggbb) misturando com branco. @param {string} hex @param {number} t 0..1
 */
export const clarear = (hex, t = 0.45) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
  if (!m) return hex;
  const canal = (h) => Math.round(parseInt(h, 16) + (255 - parseInt(h, 16)) * t).toString(16).padStart(2, '0');
  return `#${canal(m[1])}${canal(m[2])}${canal(m[3])}`;
};

/** @param {any} m */
const chaveDeOrdem = (m) => `${String(m?.data_medicao ?? '').slice(0, 10)}|${String(m?.created_date ?? m?.createdAt ?? '')}|${String(m?.id ?? '')}`;

/**
 * Medições válidas de um pasto, da mais recente para a mais antiga.
 * @param {any[]|null|undefined} medicoes @param {unknown} areaId
 */
export const medicoesDoPasto = (medicoes, areaId) =>
  (Array.isArray(medicoes) ? medicoes : [])
    .filter((m) => m && String(m.area_id) === String(areaId) && ehDiaValido(String(m.data_medicao ?? '').slice(0, 10)))
    .sort((a, b) => (chaveDeOrdem(a) < chaveDeOrdem(b) ? 1 : chaveDeOrdem(a) > chaveDeOrdem(b) ? -1 : 0));

/**
 * @typedef {{
 *   situacao: 'RAPADO'|'DESCANSO'|'PRONTO'|'PASSOU'|null,
 *   metodo: 'REGUA'|'OLHO',
 *   olho: boolean,
 *   data: string,
 *   dias: number|null,
 *   vencida: boolean,
 *   cor: string,
 *   rotulo: string,
 *   medicao: any,
 * }} FarolForragem
 */

/**
 * Farol de UMA medição (a última do pasto).
 * @param {any} medicao @param {string|null|undefined} hoje dia civil da fazenda (AAAA-MM-DD)
 * @param {number} [diasValidade]
 * @returns {FarolForragem}
 */
export const farolDaMedicao = (medicao, hoje, diasValidade = DIAS_VALIDADE_FORRAGEM) => {
  const data = String(medicao.data_medicao).slice(0, 10);
  const idade = ehDiaValido(String(hoje ?? '')) ? diasEntre(data, /** @type {string} */ (hoje)) : null;
  const dias = idade === null ? null : Math.max(0, idade);
  const olho = medicao.metodo === 'OLHO';
  const metodo = olho ? 'OLHO' : 'REGUA';
  const situacao = Object.prototype.hasOwnProperty.call(COR_SITUACAO_FORRAGEM, medicao.situacao) ? medicao.situacao : null;
  const vencida = dias === null || dias > diasValidade;
  if (vencida || !situacao) {
    const rotulo = vencida ? 'Sem medição recente' : 'Sem situação (pasto sem cultura)';
    return { situacao, metodo, olho, data, dias, vencida, cor: COR_FORRAGEM_VENCIDA, rotulo, medicao };
  }
  const base = COR_SITUACAO_FORRAGEM[situacao];
  return {
    situacao, metodo, olho, data, dias, vencida: false,
    cor: olho ? clarear(base) : base,
    rotulo: `${ROTULO_SITUACAO[situacao]}${olho ? ` ${MARCA_OLHO}` : ''}`,
    medicao,
  };
};

/**
 * Farol do pasto pela última medição; `null` se nunca foi medido.
 * @param {any[]|null|undefined} medicoes @param {unknown} areaId @param {string|null|undefined} hoje
 * @returns {FarolForragem|null}
 */
export const farolForragemDaArea = (medicoes, areaId, hoje) => {
  const ultima = medicoesDoPasto(medicoes, areaId)[0];
  return ultima ? farolDaMedicao(ultima, hoje) : null;
};

/**
 * Farol de todos os pastos de uma vez (o mapa chama uma vez por render, não por área).
 * @param {any[]|null|undefined} medicoes @param {string|null|undefined} hoje
 * @returns {Record<string, FarolForragem>} por area_id
 */
export const farolForragemPorArea = (medicoes, hoje) => {
  /** @type {Record<string, any>} */
  const ultimaPorArea = {};
  for (const m of Array.isArray(medicoes) ? medicoes : []) {
    if (!m || !ehDiaValido(String(m.data_medicao ?? '').slice(0, 10))) continue;
    const k = String(m.area_id);
    const atual = ultimaPorArea[k];
    if (!atual || chaveDeOrdem(m) > chaveDeOrdem(atual)) ultimaPorArea[k] = m;
  }
  /** @type {Record<string, FarolForragem>} */
  const out = {};
  for (const [k, m] of Object.entries(ultimaPorArea)) out[k] = farolDaMedicao(m, hoje);
  return out;
};

/** Tipos de uso que não têm forragem: o mapa os deixa com a cor normal. */
export const USOS_SEM_FORRAGEM = Object.freeze(['Infraestrutura', 'Reserva', 'APP']);

/**
 * Cor do polígono no modo "Forragem": `null` = cor normal da área (infraestrutura,
 * reserva, APP); nunca medido = neutro; senão a cor do farol.
 * @param {any} area @param {Record<string, FarolForragem>} faroisPorArea
 */
export const corForragemDaArea = (area, faroisPorArea) => {
  if (!area || USOS_SEM_FORRAGEM.includes(area.tipo_cultura)) return null;
  const farol = faroisPorArea?.[String(area.id)];
  return farol ? farol.cor : COR_FORRAGEM_SEM_MEDICAO;
};
