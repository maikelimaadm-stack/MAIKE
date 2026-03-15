/**
 * UTILITÁRIOS CENTRALIZADOS DO SISTEMA PECUÁRIO
 * 
 * Este arquivo centraliza funções comuns usadas em todo o sistema:
 * - Formatação de números, datas e pesos
 * - Normalização de texto
 * - Agrupamento de lotes por categoria
 * - Parsing de marcações em observações
 */

// ============================================
// FORMATAÇÃO
// ============================================

export function formatDecimal(value, digits = 2, keepIntegers = false) {
  const number = Number(value || 0);
  if (keepIntegers && Number.isInteger(number)) {
    return number.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  }
  return number.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatKg(value, digits = 2) {
  return `${formatDecimal(value, digits)} kg`;
}

export function formatDateBR(value, options = {}) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("pt-BR", options);
}

// ============================================
// NORMALIZAÇÃO DE TEXTO
// ============================================

/**
 * Normaliza texto: remove acentos, converte para UPPERCASE e trim.
 * Substitui normalizeText, removerAcentos e normalize duplicados.
 */
export function normalizeText(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

// ============================================
// AGRUPAMENTO DE LOTES
// ============================================

/**
 * Agrupa lotes por categoria (UPPERCASE).
 * Retorna objeto { CATEGORIA: { categoria, lotes, totalCabecas, pesoMedio } }
 */
export function agruparLotesPorCategoria(lotes = []) {
  return lotes.reduce((acc, lote) => {
    const cat = (lote.categoria || "SEM CATEGORIA").toUpperCase();
    if (!acc[cat]) {
      acc[cat] = {
        categoria: cat,
        lotes: [],
        totalCabecas: 0,
        pesoMedio: lote.peso_medio_kg || 0,
      };
    }
    acc[cat].lotes.push(lote);
    acc[cat].totalCabecas += lote.quantidade_cabecas || 0;
    return acc;
  }, {});
}

// ============================================
// PARSING DE MARCAÇÕES EM OBSERVAÇÕES
// ============================================

/**
 * Extrai IDs de pesagens vinculadas: [PESAGEM_VINCULADA:id1,id2]
 */
export function getLinkedMovementIds(observacoes) {
  const match = String(observacoes || "").match(/\[PESAGEM_VINCULADA:([^\]]+)\]/);
  return match ? match[1].split(",").map((item) => item.trim()).filter(Boolean) : [];
}

/**
 * Extrai snapshot de junção de lotes: [JUNCAO_LOTES]{...}
 */
export function getJuncaoLotesSnapshot(observacoes) {
  const firstLine = String(observacoes || "").split("\n")[0] || "";
  if (!firstLine.startsWith("[JUNCAO_LOTES]")) return null;
  try {
    return JSON.parse(firstLine.replace("[JUNCAO_LOTES]", ""));
  } catch {
    return null;
  }
}

/**
 * Extrai peso anterior de observações: "Peso anterior: XXXkg"
 */
export function getPesoAnteriorFromObs(observacoes) {
  const match = String(observacoes || "").match(/Peso anterior:\s*([\d.]+)\s*kg/i);
  if (!match) return null;
  const peso = parseFloat(match[1]);
  return Number.isNaN(peso) ? null : peso;
}

/**
 * Extrai categoria anterior de observações: "De CATEGORIA para NOVA_CATEGORIA"
 */
export function getCategoriaAnteriorFromObs(observacoes) {
  const match = String(observacoes || "").match(/De\s+(.+?)\s+para\s+/i);
  return match ? match[1] : null;
}

// ============================================
// UTILITÁRIOS NUMÉRICOS
// ============================================

/**
 * Parse de número aceita formato BR (1.234,56) e padrão (1234.56)
 */
export function parseNumber(value) {
  if (typeof value === "number") return value;
  return parseFloat(String(value || 0).replace(/\./g, "").replace(",", ".")) || 0;
}

/**
 * Divisão segura que retorna 0 quando o divisor é 0/null/undefined
 */
export function safeDivide(numerator, denominator) {
  const num = Number(numerator || 0);
  const den = Number(denominator || 0);
  if (den === 0) return 0;
  return num / den;
}