export function formatDecimal(value, digits = 2) {
  const number = Number(value || 0);
  return number.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatKg(value, digits = 2) {
  return `${formatDecimal(value, digits)} kg`;
}

export function formatDateBR(value, options = {}) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("pt-BR", options);
}