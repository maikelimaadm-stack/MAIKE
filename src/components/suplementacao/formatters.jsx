/**
 * Re-exporta formatadores centralizados para manter compatibilidade.
 * Todos os novos usos devem importar de @/components/utils/pecuariaUtils.
 */
export { formatDecimal, formatKg, formatDateBR } from "../utils/pecuariaUtils";

export const formatConsumoKgCabDia = (value) => {
  const number = Number(value || 0);
  return number.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
};

export const formatConsumoGramasCabDia = (valueKg) => {
  const grams = Number(valueKg || 0) * 1000;
  return grams.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
};

export const formatQuantidadeTecnica = (value, digits = 3) => {
  const number = Number(value || 0);
  return number.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

export const formatPercentualPV = (value) => {
  const number = Number(value || 0);
  return `${number.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
};

export const formatSacos = (kg, pesoPorSaco) => {
  const kgNum = Number(kg || 0);
  const pesoSaco = Number(pesoPorSaco || 0);
  if (pesoSaco <= 0) return "";
  const sacos = kgNum / pesoSaco;
  return `${sacos.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} saco(s)`;
};