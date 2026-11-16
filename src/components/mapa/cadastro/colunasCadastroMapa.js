/*
 * Cadastro de Áreas, Pontos e Linhas no motor Base1 (D-PROD-174): colunas e valores de cada aba.
 * As regras de leitura vêm das tabelas antigas do cadastro (removidas na D-PROD-174),
 * sem mudança: só a grade passou a ser a do motor.
 */

import { resolverSuplementacaoDoPonto, bebedourosDoPonto, tipoEhBebedouro } from "@/domain/mapa/ligacaoPontoReferencia";

/** @param {unknown} valor @param {number} casas */
const numeroBr = (valor, casas) => {
  const n = Number(valor);
  if (valor == null || valor === "" || !Number.isFinite(n)) return "";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
};

// ─── Áreas ──────────────────────────────────────────────────────────────────

export const COLUNAS_AREAS = [
  { id: "codigo", label: "Código", default: true, sortable: true, width: 100 },
  { id: "sigla", label: "Sigla", default: true, sortable: true, width: 100 },
  { id: "nome", label: "Nome", default: true, sortable: true, width: 220 },
  { id: "setor", label: "Setor", default: true, sortable: true, width: 160 },
  { id: "uso", label: "Uso", default: true, sortable: true, width: 150 },
  { id: "cultura", label: "Cultura", default: true, sortable: true, width: 170 },
  { id: "tamanho", label: "Tamanho (ha)", default: true, sortable: true, align: "right", width: 130 },
  { id: "capacidade", label: "Capacidade", default: true, sortable: true, align: "right", width: 130 },
  { id: "ocupacao", label: "Ocupação", default: true, sortable: true, width: 130 },
  { id: "status", label: "Status", default: true, sortable: true, width: 150 },
];

/** @param {any} item @param {string} coluna */
export function valorDaArea(item, coluna) {
  if (coluna === "codigo") return item.numero_area || "";
  if (coluna === "sigla") return item.sigla || "";
  if (coluna === "nome") return item.nome || "";
  if (coluna === "setor") return item.setor_nome || "";
  if (coluna === "uso") return item.tipo_cultura || "";
  if (coluna === "cultura") return item.tipo_pastagem || "";
  if (coluna === "tamanho") return item.tamanho_hectares != null ? String(item.tamanho_hectares) : "";
  if (coluna === "capacidade") return item.capacidade_maxima != null ? String(item.capacidade_maxima) : "";
  if (coluna === "ocupacao") return `${item.quantidade_atual || 0} / ${item.capacidade_maxima || 0}`;
  if (coluna === "status") return item.status_ocupacao || "";
  return "";
}

/** @param {any} item @param {string} coluna */
export function celulaDaArea(item, coluna) {
  if (coluna === "tamanho") return numeroBr(item.tamanho_hectares, 2) || "–";
  if (coluna === "capacidade") return item.capacidade_maxima ?? "–";
  return valorDaArea(item, coluna) || "–";
}

// ─── Pontos ─────────────────────────────────────────────────────────────────

export const COLUNAS_PONTOS = [
  { id: "codigo", label: "Código", default: true, sortable: true, width: 100 },
  { id: "nome", label: "Nome", default: true, sortable: true, width: 200 },
  { id: "sigla", label: "Sigla", default: true, sortable: true, width: 110 },
  { id: "tipo", label: "Tipo", default: true, sortable: true, width: 150 },
  { id: "categoria", label: "Categoria", default: true, sortable: true, width: 130 },
  { id: "setor", label: "Setor", default: true, sortable: true, width: 160 },
  { id: "areas", label: "Áreas vinculadas", default: true, sortable: true, width: 230 },
  { id: "deposito", label: "Depósito vinculado", default: true, sortable: true, width: 190 },
  { id: "produto_padrao", label: "Produto padrão", default: true, sortable: true, width: 180 },
  // `capacidade_cocho_kg` é o LIMITE OPERACIONAL do cocho/depósito (D-PROD-178);
  // nos bebedouros a coluna mostra a capacidade em litros.
  { id: "capacidade", label: "Limite op. (kg) / Capac. (L)", default: true, sortable: true, align: "right", width: 190 },
  { id: "metragem", label: "Metragem (m)", default: false, sortable: true, align: "right", width: 130 },
  { id: "cobertura", label: "Cobertura", default: false, sortable: true, width: 130 },
  { id: "estoque_minimo", label: "Estoque mín. (kg)", default: false, sortable: true, align: "right", width: 150 },
  { id: "status", label: "Status", default: true, sortable: true, width: 120 },
  { id: "coordenadas", label: "Coordenadas", default: true, sortable: true, width: 190 },
  { id: "observacoes", label: "Observações", default: true, sortable: true, width: 230 },
];

/**
 * Junta a cada ponto de referência o cocho/depósito e o bebedouro ligados a ele,
 * pela regra única de `@/domain/mapa/ligacaoPontoReferencia`: cocho/depósito por
 * empresa + categoria compatível com o tipo + nome (coordenadas desempatam;
 * sigla sozinha nunca liga); bebedouro só por `ponto_referencia_id`.
 * Ligação ambígua fica sem detalhe e marcada em `ligacao_suplementacao_ambigua`.
 * @param {any[]} pontos @param {any[]} pontosSuplementacao @param {any[]} bebedouros
 */
export function pontosComDetalhes(pontos, pontosSuplementacao, bebedouros) {
  return (pontos || []).map((item) => {
    const ligacao = resolverSuplementacaoDoPonto(item, pontosSuplementacao, { outrosPontos: pontos });
    const bebedouro = tipoEhBebedouro(item.tipo) ? bebedourosDoPonto(item, bebedouros)[0] || null : null;
    return {
      ...item,
      detalhe_suplementacao: ligacao.registro,
      detalhe_bebedouro: bebedouro,
      ligacao_suplementacao_ambigua: ligacao.ambiguo,
    };
  });
}

/** @param {any} item @param {string} coluna */
export function valorDoPonto(item, coluna) {
  const detalhe = item.detalhe_suplementacao || {};
  const bebedouro = item.detalhe_bebedouro || {};
  const ehBebedouro = tipoEhBebedouro(item.tipo);
  if (coluna === "codigo") return item.numero_ponto || detalhe.numero_ponto || bebedouro.codigo_interno || "";
  if (coluna === "nome") return item.nome || detalhe.nome_ponto || bebedouro.nome || "";
  if (coluna === "sigla") return item.sigla || detalhe.sigla || bebedouro.codigo_interno || "";
  if (coluna === "tipo") return ehBebedouro ? bebedouro.tipo || item.tipo || "" : item.tipo || detalhe.tipo || "";
  if (coluna === "categoria") return ehBebedouro ? "BEBEDOURO" : detalhe.categoria_ponto || "";
  if (coluna === "setor") return ehBebedouro ? bebedouro.setor_nome || "" : detalhe.setor_nome || "";
  if (coluna === "areas") {
    if (ehBebedouro) {
      return Array.isArray(bebedouro.area_vinculada_nomes) && bebedouro.area_vinculada_nomes.length
        ? bebedouro.area_vinculada_nomes.join(", ")
        : bebedouro.pasto_nome || "";
    }
    return Array.isArray(detalhe.area_vinculada_nomes) && detalhe.area_vinculada_nomes.length
      ? detalhe.area_vinculada_nomes.join(", ")
      : detalhe.area_vinculada_nome || "";
  }
  if (coluna === "deposito") return detalhe.deposito_origem_nome || "";
  if (coluna === "produto_padrao") return detalhe.produto_padrao || "";
  if (coluna === "capacidade") {
    if (ehBebedouro) return bebedouro.capacidade_litros != null ? String(bebedouro.capacidade_litros) : "";
    return detalhe.capacidade_cocho_kg != null ? String(detalhe.capacidade_cocho_kg) : "";
  }
  if (coluna === "metragem") return detalhe.metragem_cocho_m != null ? String(detalhe.metragem_cocho_m) : "";
  if (coluna === "cobertura") return detalhe.cobertura_cocho || "";
  if (coluna === "estoque_minimo") return detalhe.estoque_minimo_kg != null ? String(detalhe.estoque_minimo_kg) : "";
  if (coluna === "status") return ehBebedouro ? bebedouro.status || "" : detalhe.status || "";
  if (coluna === "coordenadas") {
    const c = item.coordenadas;
    return c?.lat && c?.lng ? `${Number(c.lat).toFixed(6)}, ${Number(c.lng).toFixed(6)}` : "";
  }
  if (coluna === "observacoes") {
    return ehBebedouro ? bebedouro.observacoes || item.observacoes || "" : detalhe.observacoes || item.observacoes || "";
  }
  return "";
}

/** @param {any} item @param {string} coluna */
export const celulaDoPonto = (item, coluna) => valorDoPonto(item, coluna) || "–";

// ─── Linhas ─────────────────────────────────────────────────────────────────

export const COLUNAS_LINHAS = [
  { id: "codigo", label: "Código", default: true, sortable: true, width: 100 },
  { id: "nome", label: "Nome", default: true, sortable: true, width: 220 },
  { id: "tipo", label: "Tipo", default: true, sortable: true, width: 160 },
  { id: "comprimento", label: "Comprimento", default: true, sortable: true, align: "right", width: 140 },
  { id: "observacoes", label: "Observações", default: true, sortable: true, width: 260 },
];

/** @param {any} item @param {string} coluna */
export function valorDaLinha(item, coluna) {
  if (coluna === "codigo") return item.numero_linha || "";
  if (coluna === "nome") return item.nome || "";
  if (coluna === "tipo") return item.tipo || "";
  if (coluna === "comprimento") return item.comprimento_metros != null ? String(item.comprimento_metros) : "";
  if (coluna === "observacoes") return item.observacoes || "";
  return "";
}

/** @param {any} item @param {string} coluna */
export function celulaDaLinha(item, coluna) {
  if (coluna === "comprimento") return item.comprimento_metros ? `${numeroBr(item.comprimento_metros / 1000, 2)} km` : "–";
  return valorDaLinha(item, coluna) || "–";
}

/** Ordem numérica para as colunas de número (a grade compara texto nas demais). */
const NUMERICAS = new Set(["tamanho", "capacidade", "comprimento", "metragem", "estoque_minimo"]);

/**
 * @param {(item: any, coluna: string) => string} valor
 * @returns {(a: any, b: any, coluna: string) => number | undefined}
 */
export const comparadorNumerico = (valor) => (a, b, coluna) => {
  if (!NUMERICAS.has(coluna)) return undefined;
  const na = Number(valor(a, coluna));
  const nb = Number(valor(b, coluna));
  const va = valor(a, coluna) === "" || Number.isNaN(na) ? null : na;
  const vb = valor(b, coluna) === "" || Number.isNaN(nb) ? null : nb;
  if (va === null && vb === null) return 0;
  if (va === null) return 1;
  if (vb === null) return -1;
  return va - vb;
};
