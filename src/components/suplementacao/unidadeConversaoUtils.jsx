/**
 * UTILITÁRIOS DE CONVERSÃO DE UNIDADES - SUPLEMENTAÇÃO
 * 
 * Centraliza toda lógica de conversão entre KG e SACOS.
 * O estoque interno SEMPRE opera em KG.
 */

/**
 * Converte sacos para kg.
 */
export function sacosParaKg(sacos, pesoPorSaco) {
  const s = Number(sacos || 0);
  const p = Number(pesoPorSaco || 0);
  return s * p;
}

/**
 * Converte kg para sacos.
 */
export function kgParaSacos(kg, pesoPorSaco) {
  const k = Number(kg || 0);
  const p = Number(pesoPorSaco || 0);
  if (p <= 0) return 0;
  return k / p;
}

/**
 * Retorna a quantidade em kg a partir do input do operador.
 * Se unidade = SACO, converte; se KG, retorna direto.
 */
export function quantidadeParaKg(quantidade, unidade, pesoPorSaco) {
  if (unidade === "SACO") {
    return sacosParaKg(quantidade, pesoPorSaco);
  }
  return Number(quantidade || 0);
}

/**
 * Formata a exibição de quantidade com unidade.
 * Ex: "400 kg (10 sacos)" ou "400 kg"
 */
export function formatQuantidadeComUnidade(kg, pesoPorSaco) {
  const kgNum = Number(kg || 0);
  const pesoSaco = Number(pesoPorSaco || 0);
  const kgFormatado = kgNum.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  
  if (pesoSaco > 0) {
    const sacos = kgParaSacos(kgNum, pesoSaco);
    const sacosFormatado = sacos.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return `${kgFormatado} kg (${sacosFormatado} sacos)`;
  }
  return `${kgFormatado} kg`;
}

/**
 * Dado um produto, retorna se ele suporta sacos.
 */
export function produtoSuportaSacos(produto) {
  return produto?.unidade_principal_estoque === "SACO" && Number(produto?.peso_por_saco_kg || 0) > 0;
}