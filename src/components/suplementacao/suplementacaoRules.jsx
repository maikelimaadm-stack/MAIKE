import { normalizeText } from "../utils/pecuariaUtils";

const RULES = [
  {
    matchers: ["SAL MINERAL", "MINERAL"],
    min: 0.03,
    idealMin: 0.06,
    idealMax: 0.12,
    max: 0.2,
    unidadeReferencia: "kg/cab/dia",
    label: "Sal mineral",
  },
  {
    matchers: ["PROTEINADO", "PROTEICO"],
    min: 0.2,
    idealMin: 0.3,
    idealMax: 0.8,
    max: 1.0,
    unidadeReferencia: "kg/cab/dia",
    label: "Proteinado",
  },
  {
    matchers: ["ENERGETICO", "ENERGÉTICO"],
    min: 0.5,
    idealMin: 1.0,
    idealMax: 3.0,
    max: 4.0,
    unidadeReferencia: "kg/cab/dia",
    label: "Energético",
  },
  {
    matchers: ["MISTURA MULTIPLA", "MISTURA MÚLTIPLA", "MULTIPLA", "MÚLTIPLA"],
    min: 0.1,
    idealMin: 0.2,
    idealMax: 0.6,
    max: 0.8,
    unidadeReferencia: "kg/cab/dia",
    label: "Mistura múltipla",
  },
];

export function getSupplementRule(produtoNome) {
  const normalized = normalizeText(produtoNome);
  return RULES.find((rule) => rule.matchers.some((matcher) => normalized.includes(normalizeText(matcher)))) || null;
}

export function evaluateConsumoFaixa(consumoKgCabDia, produtoNome, customLimits) {
  const consumo = Number(consumoKgCabDia || 0);
  if (consumo <= 0) {
    return {
      status: "sem_dados",
      message: "Sem consumo estimado suficiente para análise.",
      rule: getSupplementRule(produtoNome),
    };
  }

  const rule = {
    ...(getSupplementRule(produtoNome) || {}),
    ...(customLimits || {}),
  };

  if (!rule.min && !rule.idealMin && !rule.idealMax && !rule.max) {
    return {
      status: "sem_regra",
      message: "Produto sem faixa técnica configurada.",
      rule: null,
    };
  }

  if (rule.max && consumo > rule.max) {
    return {
      status: "critico_alto",
      message: `Consumo acima do máximo tolerável (${rule.max.toFixed(3)} kg/cab/dia).`,
      rule,
    };
  }

  if (rule.min && consumo < rule.min) {
    return {
      status: "critico_baixo",
      message: `Consumo abaixo do mínimo técnico (${rule.min.toFixed(3)} kg/cab/dia).`,
      rule,
    };
  }

  if (rule.idealMin && consumo < rule.idealMin) {
    return {
      status: "abaixo_ideal",
      message: `Consumo abaixo da faixa ideal (${rule.idealMin.toFixed(3)} a ${rule.idealMax?.toFixed(3) || rule.idealMin.toFixed(3)} kg/cab/dia).`,
      rule,
    };
  }

  if (rule.idealMax && consumo > rule.idealMax) {
    return {
      status: "acima_ideal",
      message: `Consumo acima da faixa ideal (${rule.idealMin?.toFixed(3) || rule.idealMax.toFixed(3)} a ${rule.idealMax.toFixed(3)} kg/cab/dia).`,
      rule,
    };
  }

  return {
    status: "dentro_ideal",
    message: "Consumo dentro da faixa técnica esperada.",
    rule,
  };
}