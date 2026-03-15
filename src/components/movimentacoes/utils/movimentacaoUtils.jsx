// Utils de Movimentações de Estoque
// Padroniza slugs/labels, leitura de locais (DISPLAY) e prepara dados 100% compatíveis com o schema

import { normalizeText } from "../../utils/pecuariaUtils";

const removerAcentos = (str = "") => String(str).normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// A) Label -> slug consistente (ex.: "Ajuste Positivo" -> "ajuste_positivo")
export function toValue(label) {
  if (!label) return "";
  let s = removerAcentos(String(label).trim().toLowerCase());
  s = s.replace(/[\s-]+/g, "_");
  s = s.replace(/[^a-z0-9_]/g, "");
  s = s.replace(/_+/g, "_");
  return s;
}

// B) slug -> Label amigável (ex.: "ajuste_negativo" -> "Ajuste Negativo")
export function getLabelOperacao(value) {
  if (!value) return "-";
  const raw = String(value);
  const parts = raw.replace(/[-]+/g, "_").split("_").filter(Boolean);
  if (parts.length === 0) return "-";
  return parts.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

// Compatibilidade (alguns lugares importam toLabel)
export const toLabel = getLabelOperacao;

// Detecta se uma string parece um ID de LocalEstoque (heurística simples: tem padrão de id base44 ou comprimento >= 10 sem espaços)
const pareceId = (v) => {
  if (!v) return false;
  const s = String(v).trim();
  if (s.includes(" ")) return false;
  return s.length >= 10; // heurística suficiente para diferenciar de nomes curtos
};

// Resolve nome do local a partir do id e lista de locais
const resolverNomeLocal = (id, locais = []) => {
  if (!id) return "";
  const l = locais.find(x => x.id === id);
  return l?.nome || "";
};

// Resolve id do local a partir do nome e lista de locais (case/trim insensitive)
const resolverIdPorNome = (nome, locais = []) => {
  if (!nome) return "";
  const alvo = removerAcentos(String(nome).trim().toLowerCase());
  const l = locais.find(x => removerAcentos(String(x.nome).trim().toLowerCase()) === alvo);
  return l?.id || "";
};

// C) prepararLocaisParaSalvar - ÚNICA responsável por mapear IDs/Nomes -> campos do schema
// Aceita dois formatos:
// 1) Objeto: {
//    tipo_movimentacao: 'Entrada'|'Saída'|'Transferência'|'Ajuste',
//    tipo_detalhado?: 'ajuste_positivo'|'ajuste_negativo'|..., // slug
//    origemId?, origemNome?, destinoId?, destinoNome?,
//    local_estoque_origem?, local_origem?, local_estoque_destino?, local_destino?,
//    locais?: lista de locais [{id, nome}] (opcional para resolver nomes/ids)
// }
// 2) Assinatura legada: prepararLocaisParaSalvar(tipo, operacao, origemId, destinoId, locais)
export function prepararLocaisParaSalvar(a, b, c, d, e) {
  let tipoMov;
  let tipoDet;
  let origemId = "";
  let origemNome = "";
  let destinoId = "";
  let destinoNome = "";
  let locais = [];

  if (typeof a === 'string') {
    // assinatura legada
    tipoMov = a === 'ENTRADA' ? 'Entrada' : a === 'SAIDA' ? 'Saída' : a === 'TRANSFERENCIA' ? 'Transferência' : 'Ajuste';
    tipoDet = toValue(b);
    origemId = c || "";
    destinoId = d || "";
    locais = Array.isArray(e) ? e : [];
    origemNome = resolverNomeLocal(origemId, locais);
    destinoNome = resolverNomeLocal(destinoId, locais);
  } else {
    const input = a || {};
    locais = Array.isArray(input.locais) ? input.locais : (Array.isArray(e) ? e : []);
    tipoMov = input.tipo_movimentacao || '';
    tipoDet = toValue(input.tipo_detalhado || b || '');

    // Se já vieram nos campos de schema, tente aproveitar
    let _lo_id = input.local_estoque_origem || "";
    let _lo_nm = input.local_origem || "";
    let _ld_id = input.local_estoque_destino || "";
    let _ld_nm = input.local_destino || "";

    // Ou vieram como origemId/destinoId e origemNome/destinoNome
    origemId = input.origemId || _lo_id || "";
    destinoId = input.destinoId || _ld_id || "";
    origemNome = input.origemNome || _lo_nm || "";
    destinoNome = input.destinoNome || _ld_nm || "";

    // Se origemId/destinoId não parecerem IDs, tentar resolver por nome
    if (!pareceId(origemId) && origemNome) origemId = resolverIdPorNome(origemNome, locais) || origemId;
    if (!pareceId(destinoId) && destinoNome) destinoId = resolverIdPorNome(destinoNome, locais) || destinoId;

    // Se nomes vazios mas temos IDs, resolver nomes
    if (!origemNome && pareceId(origemId)) origemNome = resolverNomeLocal(origemId, locais);
    if (!destinoNome && pareceId(destinoId)) destinoNome = resolverNomeLocal(destinoId, locais);
  }

  // Normalização para AJUSTE
  const isAjuste = tipoMov === 'Ajuste';
  const isAjustePos = isAjuste && toValue(tipoDet).includes('ajuste_positivo');
  const isAjusteNeg = isAjuste && toValue(tipoDet).includes('ajuste_negativo');

  let local_estoque_origem = "";
  let local_origem = "";
  let local_estoque_destino = "";
  let local_destino = "";

  if (tipoMov === 'Entrada' || isAjustePos) {
    local_estoque_destino = destinoId || origemId || "";
    local_destino = destinoNome || origemNome || "";
  } else if (tipoMov === 'Saída' || isAjusteNeg) {
    local_estoque_origem = origemId || destinoId || "";
    local_origem = origemNome || destinoNome || "";
  } else if (tipoMov === 'Transferência') {
    local_estoque_origem = origemId || "";
    local_origem = origemNome || "";
    local_estoque_destino = destinoId || "";
    local_destino = destinoNome || "";
  }

  return {
    local_estoque_origem,
    local_origem,
    local_estoque_destino,
    local_destino,
  };
}

// D) DISPLAY APENAS (proibido usar para filtro/agrupamento)
export function getLocalEstoque(m) {
  if (!m) return "";
  const tipo = m.tipo_movimentacao;
  const origemNome = m.local_origem || "";
  const destinoNome = m.local_destino || "";

  if (tipo === 'Transferência') {
    if (origemNome && destinoNome) return `${origemNome} → ${destinoNome}`;
    return origemNome || destinoNome || "";
  }
  if (tipo === 'Entrada') return destinoNome || "";
  if (tipo === 'Saída') return origemNome || "";
  if (tipo === 'Ajuste') return destinoNome || origemNome || "";
  return origemNome || destinoNome || "";
}