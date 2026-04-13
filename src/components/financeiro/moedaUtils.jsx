/**
 * Utilitário de formatação de moeda para inputs.
 * Ao digitar, formata automaticamente com pontos de milhar e vírgula decimal.
 * Ex: digitar "100000" → "1.000,00"
 */

// Converte string formatada para número
export function parseMoedaInput(str) {
  if (!str) return 0;
  // Remove tudo exceto dígitos
  const digits = String(str).replace(/\D/g, '');
  if (!digits) return 0;
  // Últimos 2 dígitos são centavos
  return parseInt(digits, 10) / 100;
}

// Formata número para exibição no input (1000.50 → "1.000,50")
export function formatarMoedaInput(valor) {
  if (!valor && valor !== 0) return '';
  const num = typeof valor === 'string' ? parseMoedaInput(valor) : valor;
  if (num === 0) return '0,00';
  return num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Formata número para exibição com R$ (1000.50 → "R$ 1.000,50")
export function formatarMoeda(valor) {
  if (!valor && valor !== 0) return "R$ 0,00";
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}