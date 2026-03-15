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
 * Calcula o peso médio ponderado dos lotes pela quantidade de cabeças.
 */
export function pesoMedioPonderadoLotes(lotes) {
  const totalCabecas = lotes.reduce((sum, l) => sum + Number(l.quantidade_cabecas || 0), 0);
  if (totalCabecas <= 0) return 0;
  const somaPesos = lotes.reduce((sum, l) => sum + (Number(l.peso_medio_kg || 0) * Number(l.quantidade_cabecas || 0)), 0);
  return safeDivide(somaPesos, totalCabecas);
}