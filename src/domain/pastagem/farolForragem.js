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
 *
 * D-PROD-223 — sem medição válida, o farol pode vir ESTIMADO pelos dias de descanso:
 * dias desde que o último lote saiu do pasto (ledger do rebanho) contra os dias de
 * descanso da cultura (D):
 *   dias < D → DESCANSO · D ≤ dias ≤ arredondar(D × 1,5) → PRONTO · acima → PASSOU.
 * Nunca RAPADO por estimativa. Pasto ocupado agora fica "Em pastejo" (sem estimativa);
 * sem cultura, sem D ou sem saída conhecida, sem estimativa. Medição válida sempre vence.
 * O estimado usa a mesma família de cor, bem mais clara, e diz "(estimado)".
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
/**
 * Clareia um hex (#rrggbb) misturando com branco. @param {string} hex @param {number} t 0..1
 */
export const clarear = (hex, t = 0.45) => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
  if (!m) return hex;
  const canal = (h) => Math.round(parseInt(h, 16) + (255 - parseInt(h, 16)) * t).toString(16).padStart(2, '0');
  return `#${canal(m[1])}${canal(m[2])}${canal(m[3])}`;
};

/** D-PROD-223: quanto o farol estimado clareia a cor da situação (o "no olho" usa 0,45). */
export const TOM_ESTIMADO = 0.7;
/** D-PROD-223: acima de arredondar(D × 1,5) dias de descanso o pasto passou do ponto. */
export const FATOR_PASSOU_DESCANSO = 1.5;
/** Cor do farol estimado de uma situação. @param {'DESCANSO'|'PRONTO'|'PASSOU'} situacao */
export const corEstimada = (situacao) => clarear(COR_SITUACAO_FORRAGEM[situacao], TOM_ESTIMADO);

export const LEGENDA_FORRAGEM = Object.freeze({
  Rapado: COR_SITUACAO_FORRAGEM.RAPADO,
  Descanso: COR_SITUACAO_FORRAGEM.DESCANSO,
  Pronto: COR_SITUACAO_FORRAGEM.PRONTO,
  'Passou do ponto': COR_SITUACAO_FORRAGEM.PASSOU,
  'Descanso (estimado)': corEstimada('DESCANSO'),
  'Pronto (estimado)': corEstimada('PRONTO'),
  'Passou do ponto (estimado)': corEstimada('PASSOU'),
  [`Sem medição recente (> ${DIAS_VALIDADE_FORRAGEM} dias)`]: COR_FORRAGEM_VENCIDA,
  'Nunca medido': COR_FORRAGEM_SEM_MEDICAO,
});

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

/**
 * D-PROD-223 — situação estimada pelos dias desde a saída do último lote e os dias de
 * descanso da cultura. `null` quando não há como estimar. Nunca RAPADO.
 * @param {number|null|undefined} diasDesdeSaida @param {number|null|undefined} diasDescanso
 * @returns {'DESCANSO'|'PRONTO'|'PASSOU'|null}
 */
export const estimarSituacaoPorDescanso = (diasDesdeSaida, diasDescanso) => {
  if (diasDesdeSaida === null || diasDesdeSaida === undefined || diasDescanso === null || diasDescanso === undefined) return null;
  const d = Number(diasDesdeSaida);
  const D = Number(diasDescanso);
  if (!Number.isInteger(d) || d < 0 || !Number.isInteger(D) || D < 1) return null;
  if (d < D) return 'DESCANSO';
  if (d <= Math.round(D * FATOR_PASSOU_DESCANSO)) return 'PRONTO';
  return 'PASSOU';
};

/**
 * @typedef {{
 *   estimado: true,
 *   emPastejo: boolean,
 *   situacao: 'DESCANSO'|'PRONTO'|'PASSOU'|null,
 *   diasDesdeSaida: number|null,
 *   diasDescanso: number|null,
 *   ultimaSaida: string|null,
 *   cor: string|null,
 *   rotulo: string,
 * }} EstimativaDescanso
 */

/**
 * D-PROD-223 — estimativa de UM pasto. `null` = sem informação de ocupação (nada a dizer).
 * Ocupado agora: "Em pastejo", sem situação e sem cor. Sem cultura/D ou saída futura: sem
 * situação ("Sem estimativa").
 * @param {any} area pasto (com `cultura.dias_descanso`, D-PROD-216/223)
 * @param {{ ocupada?: boolean, ultima_saida?: string|null }|null|undefined} descanso linha do `/medicoes-forragem/descanso`
 * @param {string|null|undefined} hoje dia civil da fazenda
 * @returns {EstimativaDescanso|null}
 */
export const estimativaDoPasto = (area, descanso, hoje) => {
  if (!descanso) return null;
  const diasDescanso = Number.isInteger(area?.cultura?.dias_descanso) ? area.cultura.dias_descanso : null;
  const base = { estimado: /** @type {true} */ (true), diasDescanso };
  if (descanso.ocupada) {
    return { ...base, emPastejo: true, situacao: null, diasDesdeSaida: null, ultimaSaida: null, cor: null, rotulo: 'Em pastejo' };
  }
  const ultimaSaida = ehDiaValido(String(descanso.ultima_saida ?? '')) ? String(descanso.ultima_saida) : null;
  const diasDesdeSaida = ultimaSaida && ehDiaValido(String(hoje ?? '')) ? diasEntre(ultimaSaida, /** @type {string} */ (hoje)) : null;
  const situacao = diasDesdeSaida !== null && diasDesdeSaida >= 0 ? estimarSituacaoPorDescanso(diasDesdeSaida, diasDescanso) : null;
  return {
    ...base,
    emPastejo: false,
    situacao,
    diasDesdeSaida,
    ultimaSaida,
    cor: situacao ? corEstimada(situacao) : null,
    rotulo: situacao ? `${ROTULO_SITUACAO[situacao]} (estimado)` : 'Sem estimativa',
  };
};

/**
 * D-PROD-223 — o farol que vale para o pasto: medição válida (≤ 15 dias, com situação)
 * vence; senão a estimativa pelos dias de descanso; senão o farol da medição (vencida /
 * sem situação) ou nada.
 * @param {FarolForragem|null|undefined} farolMedicao @param {EstimativaDescanso|null|undefined} estimativa
 * @returns {FarolForragem|EstimativaDescanso|null}
 */
export const farolQueVale = (farolMedicao, estimativa) => {
  if (farolMedicao && !farolMedicao.vencida && farolMedicao.situacao) return farolMedicao;
  if (estimativa?.situacao) return estimativa;
  return farolMedicao ?? null;
};

/**
 * D-PROD-223 — farol de todos os pastos com a estimativa (uma vez por render).
 * @param {any[]|null|undefined} areas @param {any[]|null|undefined} medicoes
 * @param {any[]|null|undefined} descansos linhas do `/medicoes-forragem/descanso`
 * @param {string|null|undefined} hoje
 * @returns {Record<string, FarolForragem|EstimativaDescanso>} por area_id
 */
export const farolForragemComEstimativaPorArea = (areas, medicoes, descansos, hoje) => {
  const porMedicao = farolForragemPorArea(medicoes, hoje);
  /** @type {Record<string, any>} */
  const descansoPorArea = {};
  for (const d of Array.isArray(descansos) ? descansos : []) if (d?.area_id) descansoPorArea[String(d.area_id)] = d;
  /** @type {Record<string, any>} */
  const out = { ...porMedicao };
  for (const area of Array.isArray(areas) ? areas : []) {
    if (!area?.id) continue;
    const k = String(area.id);
    const vale = farolQueVale(porMedicao[k], estimativaDoPasto(area, descansoPorArea[k], hoje));
    if (vale) out[k] = vale;
  }
  return out;
};

/** Tipos de uso que não têm forragem: o mapa os deixa com a cor normal. */
export const USOS_SEM_FORRAGEM = Object.freeze(['Infraestrutura', 'Reserva', 'APP']);

/**
 * Cor do polígono no modo "Forragem": `null` = cor normal da área (infraestrutura,
 * reserva, APP); nunca medido = neutro; senão a cor do farol (medido ou estimado).
 * @param {any} area @param {Record<string, FarolForragem|EstimativaDescanso>} faroisPorArea
 */
export const corForragemDaArea = (area, faroisPorArea) => {
  if (!area || USOS_SEM_FORRAGEM.includes(area.tipo_cultura)) return null;
  const farol = faroisPorArea?.[String(area.id)];
  return farol?.cor ? farol.cor : COR_FORRAGEM_SEM_MEDICAO;
};
