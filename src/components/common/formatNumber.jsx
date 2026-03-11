/**
 * Formata número no padrão brasileiro (vírgula decimal, ponto milhar)
 * @param {number} value - Valor numérico
 * @param {number} decimals - Casas decimais (padrão: auto - inteiro se possível)
 * @returns {string} Número formatado
 */
export function fmtNum(value, decimals) {
  if (value === null || value === undefined || isNaN(value)) return '-';
  const num = Number(value);
  
  // Se decimais não definido, detectar automaticamente
  if (decimals === undefined) {
    // Se é inteiro, sem decimais
    if (Number.isInteger(num)) return num.toLocaleString('pt-BR');
    // Se tem decimais, usar 2
    return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  
  return num.toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/**
 * Formata hectares (sempre com vírgula)
 */
export function fmtHa(value) {
  if (value === null || value === undefined || isNaN(value)) return '-';
  const num = Number(value);
  if (Number.isInteger(num)) return num.toLocaleString('pt-BR') + ' ha';
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ha';
}

/**
 * Formata peso em kg
 */
export function fmtKg(value) {
  if (value === null || value === undefined || isNaN(value)) return '-';
  const num = Number(value);
  if (Number.isInteger(num)) return num.toLocaleString('pt-BR') + ' kg';
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' kg';
}