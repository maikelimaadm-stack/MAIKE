/**
 * UTILITÁRIOS DE CONSUMO BASEADO EM %PV (PESO VIVO)
 * 
 * Centraliza todo o cálculo de consumo esperado baseado em 
 * percentual do peso vivo do animal.
 * 
 * Fórmula: consumo_esperado (kg/dia) = peso_vivo × (%PV / 100) × cabeças
 */

import { safeDivide } from "../utils/pecuariaUtils";

/**
 * Calcula o consumo esperado por cabeça por dia baseado em %PV.
 * 
 * @param {number} pesoMedioKg - Peso médio do animal (kg)
 * @param {number} percentualPV - Percentual de consumo sobre peso vivo (ex: 0.3 = 0.3%)
 * @returns {number} Consumo esperado em kg/cabeça/dia
 */
export function consumoEsperadoPorCabecaDia(pesoMedioKg, percentualPV) {
  const peso = Number(pesoMedioKg || 0);
  const pct = Number(percentualPV || 0);
  return peso * (pct / 100);
}

/**
 * Calcula o consumo esperado total do grupo por dia baseado em %PV.
 * 
 * @param {number} pesoMedioKg - Peso médio do animal (kg)
 * @param {number} percentualPV - Percentual de consumo sobre peso vivo
 * @param {number} cabecas - Número de cabeças
 * @returns {number} Consumo esperado total do grupo em kg/dia
 */
export function consumoEsperadoGrupoDia(pesoMedioKg, percentualPV, cabecas) {
  return consumoEsperadoPorCabecaDia(pesoMedioKg, percentualPV) * Number(cabecas || 0);
}

/**
 * Calcula o consumo esperado para um período inteiro.
 * 
 * @param {number} pesoMedioKg - Peso médio do animal (kg)
 * @param {number} percentualPV - Percentual de consumo sobre peso vivo
 * @param {number} cabecas - Número de cabeças
 * @param {number} dias - Dias do período
 * @returns {number} Consumo esperado total em kg
 */
export function consumoEsperadoPeriodo(pesoMedioKg, percentualPV, cabecas, dias) {
  return consumoEsperadoGrupoDia(pesoMedioKg, percentualPV, cabecas) * Math.max(1, Number(dias || 1));
}

/**
 * Avalia o consumo real contra o esperado pelo %PV do produto.
 * 
 * @param {number} consumoRealKgCabDia - Consumo real em kg/cabeça/dia
 * @param {number} pesoMedioKg - Peso médio do lote
 * @param {object} produto - Objeto do produto com percentual_consumo_pv, consumo_minimo_pv, consumo_maximo_pv
 * @returns {{ status, message, consumoEsperado, diferencaPercentual }}
 */
export function avaliarConsumoPV(consumoRealKgCabDia, pesoMedioKg, produto) {
  const consumoReal = Number(consumoRealKgCabDia || 0);
  const peso = Number(pesoMedioKg || 0);
  
  if (consumoReal <= 0 || peso <= 0) {
    return { status: "sem_dados", message: "Sem dados suficientes para avaliar.", consumoEsperado: 0, diferencaPercentual: 0 };
  }
  
  const pctPadrao = Number(produto?.percentual_consumo_pv || 0);
  const pctMin = Number(produto?.consumo_minimo_pv || 0);
  const pctMax = Number(produto?.consumo_maximo_pv || 0);
  
  if (pctPadrao <= 0) {
    return { status: "sem_config", message: "Produto sem %PV configurado.", consumoEsperado: 0, diferencaPercentual: 0 };
  }
  
  const consumoEsperado = consumoEsperadoPorCabecaDia(peso, pctPadrao);
  const consumoMin = pctMin > 0 ? consumoEsperadoPorCabecaDia(peso, pctMin) : 0;
  const consumoMax = pctMax > 0 ? consumoEsperadoPorCabecaDia(peso, pctMax) : 0;
  const diferencaPercentual = safeDivide((consumoReal - consumoEsperado), consumoEsperado) * 100;
  
  if (consumoMax > 0 && consumoReal > consumoMax * 1.2) {
    return { status: "critico_alto", message: `Consumo muito acima do máximo tolerável (${consumoMax.toFixed(3)} kg/cab/dia).`, consumoEsperado, diferencaPercentual };
  }
  
  if (consumoMin > 0 && consumoReal < consumoMin * 0.5) {
    return { status: "critico_baixo", message: `Consumo muito abaixo do mínimo técnico (${consumoMin.toFixed(3)} kg/cab/dia).`, consumoEsperado, diferencaPercentual };
  }
  
  if (consumoMax > 0 && consumoReal > consumoMax) {
    return { status: "acima_ideal", message: `Consumo acima da faixa ideal (máx: ${consumoMax.toFixed(3)} kg/cab/dia). Diferença: ${diferencaPercentual.toFixed(0)}%.`, consumoEsperado, diferencaPercentual };
  }
  
  if (consumoMin > 0 && consumoReal < consumoMin) {
    return { status: "abaixo_ideal", message: `Consumo abaixo da faixa ideal (mín: ${consumoMin.toFixed(3)} kg/cab/dia). Diferença: ${diferencaPercentual.toFixed(0)}%.`, consumoEsperado, diferencaPercentual };
  }
  
  return { status: "dentro_ideal", message: `Consumo dentro da faixa técnica esperada. Diferença: ${diferencaPercentual.toFixed(0)}%.`, consumoEsperado, diferencaPercentual };
}

/**
 * D-PROD-201 — peso de um lote para a conta de consumo por %PV: o PESO
 * PROJETADO de hoje (D-PROD-198; sem curva ele já é o último peso), senão o
 * último peso gravado (pesagem ou entrada). Sem peso: 0 e origem 'sem_peso' —
 * o lote NÃO entra na média como peso zero.
 * @param {{ projecao_peso?: { disponivel?: boolean, peso_kg?: number } | null, peso_medio_kg?: unknown } | null | undefined} lote
 * @returns {{ peso: number, origem: 'projetado' | 'ultimo_peso' | 'sem_peso' }}
 */
export function pesoDeConsumoDoLote(lote) {
  const projecao = lote?.projecao_peso;
  const projetado = Number(projecao?.peso_kg);
  if (projecao?.disponivel && Number.isFinite(projetado) && projetado > 0) return { peso: projetado, origem: "projetado" };
  const ultimo = Number(lote?.peso_medio_kg);
  if (Number.isFinite(ultimo) && ultimo > 0) return { peso: ultimo, origem: "ultimo_peso" };
  return { peso: 0, origem: "sem_peso" };
}

/**
 * D-PROD-201 — peso médio dos lotes, ponderado pelas cabeças, SÓ entre os lotes
 * com peso (projetado ou último). Antes, lote sem peso entrava como 0 kg e
 * puxava a média para baixo (30 cab × 400 kg + 20 cab sem peso → 240 kg).
 * `cabecasSemPeso`/`lotesSemPeso` permitem avisar na tela.
 * @param {Array<any>} lotes
 */
export function resumoPesoDosLotes(lotes) {
  let cabecasComPeso = 0;
  let somaPesos = 0;
  let cabecasSemPeso = 0;
  let cabecasProjetado = 0;
  const lotesSemPeso = [];
  for (const lote of lotes || []) {
    const cab = Number(lote?.quantidade_cabecas || 0);
    if (!(cab > 0)) continue;
    const { peso, origem } = pesoDeConsumoDoLote(lote);
    if (origem === "sem_peso") {
      cabecasSemPeso += cab;
      lotesSemPeso.push(lote);
      continue;
    }
    cabecasComPeso += cab;
    somaPesos += peso * cab;
    if (origem === "projetado") cabecasProjetado += cab;
  }
  return {
    pesoMedio: cabecasComPeso > 0 ? safeDivide(somaPesos, cabecasComPeso) : 0,
    cabecasComPeso,
    cabecasSemPeso,
    cabecasProjetado,
    lotesSemPeso,
  };
}

/**
 * Peso médio ponderado pelas cabeças, só entre os lotes com peso (D-PROD-201).
 * @param {Array<any>} lotes
 */
export function pesoMedioPonderadoLotes(lotes) {
  return resumoPesoDosLotes(lotes).pesoMedio;
}

/**
 * D-PROD-203 — %PV de um lote para a formulação: a regra da Categoria de Manejo
 * do lote, quando houver (não consome → 0; consome → o %PV da regra), senão o
 * %PV padrão da formulação.
 * @param {{ categoria_manejo_id?: string | null } | null | undefined} lote
 * @param {{ percentual_pv_padrao?: unknown, regras?: Array<{ categoria_manejo_id?: string, consome?: boolean, percentual_pv?: unknown }> } | null | undefined} formulacao
 * @returns {{ percentual: number, consome: boolean, origem: 'padrao' | 'regra' | 'nao_consome' }}
 */
export function percentualPVDoLote(lote, formulacao) {
  const categoria = lote?.categoria_manejo_id ? String(lote.categoria_manejo_id) : null;
  const regra = categoria ? (formulacao?.regras || []).find((r) => String(r?.categoria_manejo_id) === categoria) : null;
  if (regra && regra.consome === false) return { percentual: 0, consome: false, origem: "nao_consome" };
  if (regra) {
    const pv = Number(regra.percentual_pv);
    return { percentual: Number.isFinite(pv) && pv > 0 ? pv : 0, consome: true, origem: "regra" };
  }
  const padrao = Number(formulacao?.percentual_pv_padrao);
  return { percentual: Number.isFinite(padrao) && padrao > 0 ? padrao : 0, consome: true, origem: "padrao" };
}

/**
 * D-PROD-203 — consumo esperado (kg/dia) por FORMULAÇÃO, lote a lote:
 * `peso do lote × %PV do lote / 100 × cabeças`, com o %PV da regra da categoria
 * (ou o padrão). Lote sem peso usa o peso médio ponderado dos lotes COM peso
 * (a mesma extrapolação da D-PROD-201), com o %PV da própria categoria. Lote
 * cuja categoria não consome entra com 0 kg. Sem formulação, tudo 0.
 * @param {{ lotes: Array<any>, formulacao: any }} p
 * @returns {{
 *   totalKgDia: number,
 *   porLote: Array<{ id: unknown, cabecas: number, peso: number, pesoExtrapolado: boolean, percentualPV: number, consome: boolean, origem: string, esperadoKgDia: number | null }>,
 *   cabecasNaoConsomem: number,
 *   cabecasConsomem: number,
 *   cabecasSemPeso: number,
 *   pesoMedioReferencia: number,
 * }}
 */
export function consumoEsperadoPorFormulacao({ lotes, formulacao }) {
  const resumo = resumoPesoDosLotes(lotes);
  let totalKgDia = 0;
  let cabecasNaoConsomem = 0;
  let cabecasConsomem = 0;
  const porLote = [];
  for (const lote of lotes || []) {
    const cabecas = Number(lote?.quantidade_cabecas || 0);
    if (!(cabecas > 0)) continue;
    const { peso: pesoProprio, origem: origemPeso } = pesoDeConsumoDoLote(lote);
    const pesoExtrapolado = origemPeso === "sem_peso";
    const peso = pesoExtrapolado ? resumo.pesoMedio : pesoProprio;
    const pv = formulacao ? percentualPVDoLote(lote, formulacao) : { percentual: 0, consome: true, origem: "padrao" };
    if (!pv.consome) cabecasNaoConsomem += cabecas;
    else cabecasConsomem += cabecas;
    let esperadoKgDia = null;
    if (!pv.consome) esperadoKgDia = 0;
    else if (peso > 0 && pv.percentual > 0) esperadoKgDia = consumoEsperadoPorCabecaDia(peso, pv.percentual) * cabecas;
    if (esperadoKgDia) totalKgDia += esperadoKgDia;
    porLote.push({ id: lote?.id, cabecas, peso, pesoExtrapolado, percentualPV: pv.percentual, consome: pv.consome, origem: pv.origem, esperadoKgDia });
  }
  return { totalKgDia, porLote, cabecasNaoConsomem, cabecasConsomem, cabecasSemPeso: resumo.cabecasSemPeso, pesoMedioReferencia: resumo.pesoMedio };
}
