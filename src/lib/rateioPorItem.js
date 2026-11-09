/**
 * D-PROD-156 (P3-02) — rateio gerencial POR ITEM, em BigInt (unidades mínimas
 * da moeda), sem float. É a MESMA conta do `planejarRateioPorItem` do servidor
 * (vetores compartilhados em tests/smoke/fixtures/rateioPorItemVetores.json). O
 * servidor continua sendo a autoridade: aqui ela serve ao formulário (apontar
 * o item e a linha antes de salvar), à consulta e ao backend falso dos testes.
 *
 *  - A base de cada item é o `valor_liquido` dele (subtotal − desconto rateado +
 *    acréscimo rateado), o MESMO de `ratearCabecalho` (rateioCabecalho.js).
 *  - VALOR: cada linha > 0 e Σ linhas = líquido do item, exato.
 *  - PERCENTUAL: Σ = 100 exato por item; o líquido é distribuído pelos maiores
 *    restos (empate → menor ordem) — o MESMO `ratearPercentual` do rateio geral.
 *  - Consolidado: soma por (natureza, CC, CR) na ordem da 1ª aparição;
 *    percentual sobre o total com 6 casas; Σ = total (nada é contado duas vezes).
 *
 * É só classificação gerencial: não cria título, movimento nem custo.
 */
import { comparar, deUnidades, paraUnidades, percentualDe, ratearPercentual, somar, subtrair } from './dinheiroDecimal.js';
import { maioresRestos } from './rateioCabecalho.js';

export const ESCOPOS_RATEIO = Object.freeze(['GERAL', 'POR_ITEM']);
/** Teto de linhas de UM item (SPEC §3). */
export const MAX_RATEIOS_POR_ITEM = 20;
/** Teto de linhas de todos os itens do documento (SPEC §3). */
export const MAX_RATEIOS_ITENS_TOTAL = 1000;
const CASAS_PERCENTUAL = 6;
const CEM = '100';

/**
 * Escopo do documento como a tela o trata: ausente ou NULL (linhas da P3-01) é
 * GERAL — o mesmo `op.rateio_escopo ?? 'GERAL'` do servidor.
 * @param {unknown} v
 * @returns {'GERAL'|'POR_ITEM'}
 */
export const escopoDoRateio = (v) => (v === 'POR_ITEM' ? 'POR_ITEM' : 'GERAL');

/**
 * Chave da classificação (natureza + centros): linha repetida e consolidado.
 * @param {{ natureza_id?: unknown, centro_custo_id?: unknown, centro_resultado_id?: unknown }} l
 */
export const chaveDaClassificacao = (l) => `${l.natureza_id ?? ''}|${l.centro_custo_id ?? ''}|${l.centro_resultado_id ?? ''}`;

/**
 * @typedef {{ natureza_id?: string|null, centro_custo_id?: string|null, centro_resultado_id?: string|null,
 *   valor?: string|null, percentual?: string|null }} LinhaDoItem
 * @typedef {{ field: string, reason: 'linha_duplicada'|'valor_linha_zero'|'soma_diferente', subindice?: number,
 *   details: Record<string, string|number> }} ErroDoItem
 */

/**
 * Rateio de UM item, na ordem de checagem do servidor: linha repetida →
 * (VALOR) linha zero → soma ≠ líquido · (PERCENTUAL) soma ≠ 100 → distribuição →
 * linha que ficou zero. A PRIMEIRA recusa é a que volta.
 * @param {{ modo: string, liquido: string, linhas: LinhaDoItem[], casas: number }} p
 *   valores em texto canônico (dinheiro na escala da moeda; percentual até 6 casas)
 * @returns {{ valores: Array<string|null>, percentuais: Array<string|null>, fecha: boolean, erro: ErroDoItem|null }}
 */
export const planejarRateioDoItem = ({ modo, liquido, linhas, casas }) => {
  const nulos = linhas.map(() => null);
  /** @type {Map<string, number>} */
  const vistos = new Map();
  for (let j = 0; j < linhas.length; j += 1) {
    if (linhas[j].natureza_id == null) continue;
    const chave = chaveDaClassificacao(linhas[j]);
    if (vistos.has(chave)) {
      return { valores: nulos, percentuais: nulos, fecha: false, erro: { field: 'natureza_id', reason: 'linha_duplicada', subindice: j, details: { repete_subindice: /** @type {number} */ (vistos.get(chave)) } } };
    }
    vistos.set(chave, j);
  }
  if (modo === 'PERCENTUAL') {
    const pcts = linhas.map((l) => (l.percentual == null ? null : String(l.percentual)));
    const soma = somar(pcts.map((p) => p ?? '0'), CASAS_PERCENTUAL);
    if (comparar(soma, CEM) !== 0 || pcts.some((p) => p == null)) {
      return {
        valores: nulos,
        percentuais: pcts,
        fecha: false,
        erro: {
          field: 'rateios',
          reason: 'soma_diferente',
          details: { modo: 'PERCENTUAL', esperado: somar([CEM], CASAS_PERCENTUAL), informado: soma, diferenca: subtrair(CEM, soma, CASAS_PERCENTUAL) },
        },
      };
    }
    const r = ratearPercentual(liquido, pcts, casas);
    const percentuais = pcts.map((p) => somar([/** @type {string} */ (p)], CASAS_PERCENTUAL));
    const zerada = r.linhasZeradas[0];
    if (zerada !== undefined) {
      return { valores: r.valores, percentuais, fecha: false, erro: { field: 'percentual', reason: 'valor_linha_zero', subindice: zerada, details: {} } };
    }
    return { valores: r.valores, percentuais, fecha: r.fecha100, erro: null };
  }
  const valores = linhas.map((l) => (l.valor == null ? null : deUnidades(paraUnidades(String(l.valor), casas), casas)));
  const zero = valores.findIndex((v) => v == null || comparar(v, '0') <= 0);
  if (zero >= 0) return { valores, percentuais: nulos, fecha: false, erro: { field: 'valor', reason: 'valor_linha_zero', subindice: zero, details: {} } };
  const soma = somar(/** @type {string[]} */ (valores), casas);
  if (comparar(soma, liquido) !== 0) {
    return {
      valores,
      percentuais: nulos,
      fecha: false,
      erro: { field: 'rateios', reason: 'soma_diferente', details: { modo: 'VALOR', esperado: somar([liquido], casas), informado: soma, diferenca: subtrair(liquido, soma, casas) } },
    };
  }
  // Modo VALOR: o percentual é só informativo, sobre o LÍQUIDO do item (6 casas).
  const percentuais = valores.map((v) => percentualDe(/** @type {string} */ (v), liquido, casas, CASAS_PERCENTUAL));
  return { valores, percentuais, fecha: true, erro: null };
};

/**
 * Inicialização GERAL → POR_ITEM: as MESMAS proporções do rateio geral (os
 * valores ou os percentuais das linhas) sobre o líquido de UM item, pelos
 * maiores restos em unidades mínimas (empate → menor ordem). Σ = líquido.
 * @param {{ liquido: string, pesos: string[], casas: number, casasPeso: number }} p
 * @returns {string[]|null} null quando não há base (líquido ≤ 0 ou peso ≤ 0)
 */
export const distribuirProporcional = ({ liquido, pesos, casas, casasPeso }) => {
  const u = paraUnidades(liquido, casas);
  const ws = pesos.map((p) => paraUnidades(p, casasPeso));
  if (u <= 0n || !ws.length || ws.some((w) => w <= 0n)) return null;
  return maioresRestos(u, ws).map((v) => deUnidades(v, casas));
};

/**
 * @typedef {{ natureza_id: string, natureza_nome: string|null, centro_custo_id: string|null, centro_custo_nome: string|null,
 *   centro_resultado_id: string|null, centro_resultado_nome: string|null, valor: string, percentual: string }} LinhaConsolidada
 */

/**
 * Resumo consolidado: soma por (natureza, CC, CR) na ordem da 1ª aparição; o
 * percentual é sobre o `total` do documento (6 casas). No GERAL é igual às
 * linhas do rateio geral.
 * @param {Array<Record<string, any>>} linhas na ordem (item 1 linha 1, item 1 linha 2, …)
 * @param {string} total
 * @param {number} casas
 * @returns {LinhaConsolidada[]}
 */
export const consolidarRateio = (linhas, total, casas) => {
  /** @type {Map<string, { base: Record<string, any>, u: bigint }>} */
  const grupos = new Map();
  for (const l of linhas) {
    if (l?.valor == null) continue;
    const chave = chaveDaClassificacao(l);
    const g = grupos.get(chave);
    const u = paraUnidades(String(l.valor), casas);
    if (g) g.u += u;
    else grupos.set(chave, { base: l, u });
  }
  return [...grupos.values()].map(({ base, u }) => {
    const valor = deUnidades(u, casas);
    return {
      natureza_id: base.natureza_id,
      natureza_nome: base.natureza_nome ?? null,
      centro_custo_id: base.centro_custo_id ?? null,
      centro_custo_nome: base.centro_custo_nome ?? null,
      centro_resultado_id: base.centro_resultado_id ?? null,
      centro_resultado_nome: base.centro_resultado_nome ?? null,
      valor,
      percentual: percentualDe(valor, total, casas, CASAS_PERCENTUAL) ?? somar(['0'], CASAS_PERCENTUAL),
    };
  });
};
