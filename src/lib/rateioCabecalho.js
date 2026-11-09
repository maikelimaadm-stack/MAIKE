/**
 * D-PROD-155 (P3-01, rodada 4) — política "custo de aquisição líquido", em
 * BigInt (unidades mínimas da moeda), sem float. É a MESMA conta do
 * `planejarOperacao` do servidor; os dois lados batem com
 * tests/smoke/fixtures/rateioCabecalhoVetores.json. O servidor continua sendo a
 * autoridade: aqui ela serve ao formulário (apontar a linha antes de salvar) e
 * ao backend falso dos testes.
 *
 *  1. Desconto D e acréscimo A do cabeçalho são rateados SEPARADAMENTE entre
 *     TODAS as linhas (mercadoria e serviço), proporcionais ao subtotal s_i, pelo
 *     método dos maiores restos (empate de resto → menor ordem).
 *  2. valor_liquido_i = s_i − d_i + a_i; Σ = total do documento, exato.
 *     Linha com líquido ≤ 0 → `item_liquido_nao_positivo`.
 *  3. Só PAGAR + MERCADORIA: custo_kg = HALF_UP(líquido / kg, 4) e
 *     residuo_custo = líquido − kg × custo_kg (exato, 8 casas). Resíduo acima de
 *     max(1 unidade mínima, 0,001 × líquido) → `custo_kg_nao_representavel`
 *     (0,1%: o resíduo de HALF_UP é ≤ kg × 0,00005, então custo ≥ 0,06/kg
 *     nunca é recusado).
 *     O resíduo fica FORA do custo FIFO (colunas de estoque com 4 casas).
 */
import { deUnidades, paraUnidades } from './dinheiroDecimal.js';

const CASAS_CUSTO = 4;
const CASAS_QUANTIDADE = 4;
const CASAS_RESIDUO = 8;

/** Divisão HALF_UP de não negativos. @param {bigint} n @param {bigint} d */
const dividirHalfUp = (n, d) => {
  const q = n / d;
  return (n % d) * 2n >= d ? q + 1n : q;
};

/**
 * Maiores restos: cada linha recebe o piso de total × s_i / B; a sobra vai 1
 * unidade por linha às de MAIOR resto (empate → menor ordem). Σ = total exato.
 * @param {bigint} total @param {bigint[]} pesos @returns {bigint[]}
 */
const maioresRestos = (total, pesos) => {
  const base = pesos.reduce((s, p) => s + p, 0n);
  const linhas = pesos.map((p, i) => ({ i, valor: (total * p) / base, resto: (total * p) % base }));
  let sobra = total - linhas.reduce((s, l) => s + l.valor, 0n);
  const ordem = [...linhas].sort((a, b) => (a.resto === b.resto ? a.i - b.i : a.resto > b.resto ? -1 : 1));
  for (const linha of ordem) {
    if (sobra <= 0n) break;
    linha.valor += 1n;
    sobra -= 1n;
  }
  return linhas.map((l) => l.valor);
};

/** @param {bigint} x */
const abs = (x) => (x < 0n ? -x : x);

/**
 * @typedef {{ ordem?: number, tipo_item: string, valor_total: string, quantidade_estoque?: string|null }} ItemDoRateio
 * @typedef {{
 *   ordem: number,
 *   valor_desconto_rateado: string,
 *   valor_acrescimo_rateado: string,
 *   valor_liquido: string,
 *   custo_kg: string|null,
 *   residuo_custo: string|null,
 * }} ItemRateado
 * @typedef {{ field: string, reason: 'item_liquido_nao_positivo'|'custo_kg_nao_representavel', details: Record<string, any> }} ErroDoRateio
 */

/**
 * Rateio do cabeçalho e custo líquido por linha.
 * @param {{ direcao: string, casas: number, valor_desconto?: string|null, valor_acrescimo?: string|null, itens: ItemDoRateio[] }} entrada
 *   valores em texto canônico (dinheiro na escala da moeda; kg com até 4 casas)
 * @returns {{ itens: ItemRateado[], residuo_total: string|null, tem_residuo: boolean, erro: ErroDoRateio|null } | null}
 *   null quando não há base para ratear (sem itens ou soma dos subtotais ≤ 0)
 */
export const ratearCabecalho = ({ direcao, casas, valor_desconto, valor_acrescimo, itens }) => {
  if (!Array.isArray(itens) || !itens.length) return null;
  const subtotais = itens.map((i) => paraUnidades(i.valor_total, casas));
  if (subtotais.some((s) => s <= 0n)) return null;
  const desconto = maioresRestos(paraUnidades(valor_desconto || '0', casas), subtotais);
  const acrescimo = maioresRestos(paraUnidades(valor_acrescimo || '0', casas), subtotais);
  const liquidos = subtotais.map((s, i) => s - desconto[i] + acrescimo[i]);
  const ordemDe = (/** @type {number} */ i) => (Number.isInteger(itens[i].ordem) ? /** @type {number} */ (itens[i].ordem) : i + 1);
  const dinheiro = (/** @type {bigint} */ u) => deUnidades(u, casas);

  // Como o servidor: linha a linha, na ordem — primeiro o líquido, depois o custo;
  // a PRIMEIRA linha recusada é a que volta no erro.
  /** @type {ErroDoRateio|null} */
  let erro = null;

  // Escala 8 (resíduo exato): líquido × 10^(8−casas) − kg(4) × custo(4).
  const fatorLiquido = 10n ** BigInt(CASAS_RESIDUO - casas);
  const umaUnidade = 10n ** BigInt(CASAS_RESIDUO);
  const RELATIVO_8 = 100000n; // 0,001 × 10^8 (limite relativo de 0,1%)
  let residuoTotal = /** @type {bigint|null} */ (null);
  let temResiduo = false;
  const rateados = itens.map((item, i) => {
    let custo = /** @type {string|null} */ (null);
    let residuo = /** @type {string|null} */ (null);
    const kg = item.quantidade_estoque ? paraUnidades(item.quantidade_estoque, CASAS_QUANTIDADE) : 0n;
    if (!erro && liquidos[i] <= 0n) {
      erro = {
        field: 'valor_desconto',
        reason: 'item_liquido_nao_positivo',
        details: {
          colecao: 'itens',
          indice: i,
          item_ordem: ordemDe(i),
          valor_total: dinheiro(subtotais[i]),
          valor_desconto_rateado: dinheiro(desconto[i]),
          valor_acrescimo_rateado: dinheiro(acrescimo[i]),
          valor_liquido: dinheiro(liquidos[i]),
        },
      };
    }
    if (direcao === 'PAGAR' && item.tipo_item === 'MERCADORIA' && kg > 0n && liquidos[i] > 0n) {
      const liquido8 = liquidos[i] * fatorLiquido;
      const custoU = dividirHalfUp(liquido8, kg);
      const residuoU = liquido8 - kg * custoU;
      custo = deUnidades(custoU, CASAS_CUSTO);
      residuo = deUnidades(residuoU, CASAS_RESIDUO);
      residuoTotal = (residuoTotal ?? 0n) + residuoU;
      if (residuoU !== 0n) temResiduo = true;
      // |r| > max(10^-casas, 0,001 × líquido), em inteiros: os dois lados
      // × 10^(8+casas). |r| vira |residuoU| × 10^casas; 10^-casas vira 10^8;
      // 0,001 × líquido vira liquido_u × 10^5.
      const limite = umaUnidade > liquidos[i] * RELATIVO_8 ? umaUnidade : liquidos[i] * RELATIVO_8;
      if (!erro && abs(residuoU) * 10n ** BigInt(casas) > limite) {
        erro = {
          field: 'valor_unitario',
          reason: 'custo_kg_nao_representavel',
          details: {
            colecao: 'itens',
            indice: i,
            item_ordem: ordemDe(i),
            valor_liquido: dinheiro(liquidos[i]),
            quantidade_estoque: deUnidades(kg, CASAS_QUANTIDADE),
            custo_kg: custo,
            residuo_custo: residuo,
          },
        };
      }
    }
    return {
      ordem: ordemDe(i),
      valor_desconto_rateado: dinheiro(desconto[i]),
      valor_acrescimo_rateado: dinheiro(acrescimo[i]),
      valor_liquido: dinheiro(liquidos[i]),
      custo_kg: custo,
      residuo_custo: residuo,
    };
  });
  return { itens: rateados, residuo_total: residuoTotal === null ? null : deUnidades(residuoTotal, CASAS_RESIDUO), tem_residuo: temResiduo, erro };
};
