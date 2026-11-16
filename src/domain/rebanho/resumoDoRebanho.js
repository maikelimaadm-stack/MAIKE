/**
 * D-PROD-213 — Resumo do Rebanho (Mapa Geral): contas PURAS do diálogo.
 *
 * Sem React, sem rede, sem `new Date()` sem argumento: o dia de "hoje" (no fuso
 * da fazenda) chega por parâmetro.
 *
 * Peso de hoje = `projecao_peso.peso_kg` que o servidor manda em cada posição
 * (D-PROD-197/198, curva de ganho da categoria). Sem projeção, o peso gravado
 * (`peso_medio_kg`) e a cabeça conta como "sem projeção".
 * Peso em 90 dias = interpolação LINEAR entre os pontos que o servidor já manda
 * (hoje e o fim de cada um dos 12 meses seguintes, `projecao_mensal`). Dentro de
 * um mês o GMD da curva é constante, então a reta entre dois pontos é a própria
 * curva: nada de GMD inventado aqui.
 */

/** Peso vivo de uma arroba viva (o mesmo `KG_POR_ARROBA` do servidor). */
export const KG_POR_ARROBA = 30;
/** Unidade animal: 450 kg de peso vivo. */
export const KG_POR_UA = 450;
/** Horizonte do cartão "Em 90 dias". */
export const DIAS_HORIZONTE = 90;
/** Valor do filtro que mostra todas as fazendas. */
export const TODAS_FAZENDAS = "__todas__";

const DIA_RE = /^\d{4}-\d{2}-\d{2}$/;

/** @param {string} dia */
const msDoDia = (dia) => Date.UTC(Number(dia.slice(0, 4)), Number(dia.slice(5, 7)) - 1, Number(dia.slice(8, 10)));

/**
 * @param {string} dia AAAA-MM-DD
 * @param {number} dias
 * @returns {string}
 */
export const somarDias = (dia, dias) => new Date(msDoDia(dia) + dias * 86400000).toISOString().slice(0, 10);

/** @param {unknown} v */
const numero = (v) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * Peso projetado numa data, interpolando os pontos da `projecao_peso`.
 * Antes (ou no) dia da projeção: o peso de hoje. Depois do último fim de mês: null.
 * @param {any} projecao `projecao_peso` de uma posição
 * @param {string} dia AAAA-MM-DD
 * @returns {number|null}
 */
export function pesoProjetadoNoDia(projecao, dia) {
  if (!projecao || projecao.disponivel !== true || typeof dia !== "string" || !DIA_RE.test(dia)) return null;
  const base = numero(projecao.peso_kg);
  if (base === null || typeof projecao.dia !== "string" || !DIA_RE.test(projecao.dia)) return null;
  if (dia <= projecao.dia) return base;
  const pontos = [{ dia: projecao.dia, peso: base }];
  for (const m of Array.isArray(projecao.projecao_mensal) ? projecao.projecao_mensal : []) {
    const p = numero(m?.peso_kg);
    if (p === null || typeof m?.dia !== "string" || !DIA_RE.test(m.dia) || m.dia <= pontos[pontos.length - 1].dia) continue;
    pontos.push({ dia: m.dia, peso: p });
  }
  for (let i = 1; i < pontos.length; i += 1) {
    const a = pontos[i - 1];
    const b = pontos[i];
    if (dia <= b.dia) {
      const total = msDoDia(b.dia) - msDoDia(a.dia);
      const parte = msDoDia(dia) - msDoDia(a.dia);
      return a.peso + (b.peso - a.peso) * (total > 0 ? parte / total : 1);
    }
  }
  return null;
}

/**
 * Rótulo curto da fazenda: o `setor_nome` sem o prefixo "FAZENDA ".
 * @param {string} setor
 */
export const rotuloFazenda = (setor) => String(setor || "").replace(/^\s*fazenda\s+/i, "").trim() || String(setor || "");

/**
 * @typedef {{ nome: string, cabecas: number, pesoHoje: number|null, peso90: number|null }} LinhaCategoria
 * @typedef {{ id: string, nome: string, fazenda: string, cabecas: number, pesoHoje: number|null, hectares: number|null, uaHa: number|null }} LinhaPasto
 * @typedef {{
 *   fazendas: Array<{ id: string, rotulo: string }>,
 *   cabecas: number, cabecasSemPeso: number, cabecasSemProjecao: number,
 *   pesoMedioHoje: number|null, pesoMedio90: number|null,
 *   arrobasHoje: number|null, arrobasGanho90: number|null,
 *   categorias: LinhaCategoria[], pastos: LinhaPasto[],
 * }} ResumoRebanho
 */

/**
 * Resumo do rebanho da fazenda (ou de uma fazenda do filtro).
 *
 * @param {{
 *   posicoes: any[],
 *   areas: any[],
 *   categoriasManejo?: any[],
 *   hoje: string|null,
 *   fazenda?: string,
 * }} p
 * @returns {ResumoRebanho}
 */
export function resumoDoRebanho({ posicoes, areas, categoriasManejo = [], hoje, fazenda = TODAS_FAZENDAS }) {
  const areaPorId = new Map((Array.isArray(areas) ? areas : []).filter((a) => a && a.id != null).map((a) => [String(a.id), a]));
  const lista = (Array.isArray(posicoes) ? posicoes : []).filter((p) => p && Number(p.quantidade_cabecas) > 0);

  // Fazendas = setores das áreas que têm rebanho (filtro), em ordem alfabética.
  const setores = new Set();
  for (const p of lista) {
    const s = areaPorId.get(String(p.area_atual_id ?? p.area_id ?? ""))?.setor_nome;
    if (s) setores.add(String(s));
  }
  const fazendas = [...setores].sort((a, b) => a.localeCompare(b, "pt-BR")).map((s) => ({ id: s, rotulo: rotuloFazenda(s) }));

  const dia90 = typeof hoje === "string" && DIA_RE.test(hoje) ? somarDias(hoje, DIAS_HORIZONTE) : null;
  const doFiltro = lista.filter((p) => {
    if (!fazenda || fazenda === TODAS_FAZENDAS) return true;
    return String(areaPorId.get(String(p.area_atual_id ?? p.area_id ?? ""))?.setor_nome ?? "") === fazenda;
  });

  // Ordem das categorias: faixa de idade da Categoria de Manejo (idade mínima), depois o nome.
  const idadePorNome = new Map();
  const idadePorId = new Map();
  for (const c of Array.isArray(categoriasManejo) ? categoriasManejo : []) {
    const idade = numero(c?.idade_minima_meses);
    if (c?.id != null) idadePorId.set(String(c.id), idade);
    if (c?.nome) idadePorNome.set(String(c.nome).toUpperCase(), idade);
  }

  let cabecas = 0;
  let cabecasSemPeso = 0;
  let cabecasSemProjecao = 0;
  let cabComPeso = 0;
  let kgHoje = 0;
  let kg90 = 0;
  /** @type {Map<string, { nome: string, idade: number|null, cab: number, cabPeso: number, kg: number, kg90: number }>} */
  const porCategoria = new Map();
  /** @type {Map<string, { id: string, nome: string, fazenda: string, ha: number|null, cab: number, cabPeso: number, kg: number }>} */
  const porPasto = new Map();

  for (const p of doFiltro) {
    const cab = Number(p.quantidade_cabecas);
    const projecao = p.projecao_peso;
    const projetado = projecao?.disponivel === true ? numero(projecao.peso_kg) : null;
    const pesoHoje = projetado ?? numero(p.peso_medio_kg);
    const pesoFuturo = projetado !== null && dia90 ? pesoProjetadoNoDia(projecao, dia90) : null;
    // Sem projeção (ou além do último mês projetado): o peso não muda no horizonte.
    const peso90 = pesoFuturo ?? pesoHoje;
    cabecas += cab;
    if (projetado === null || pesoFuturo === null) cabecasSemProjecao += cab;
    if (pesoHoje === null) cabecasSemPeso += cab;
    else {
      cabComPeso += cab;
      kgHoje += cab * pesoHoje;
      kg90 += cab * /** @type {number} */ (peso90);
    }

    const nomeCat = String(p.categoria_manejo_nome || p.categoria || "Sem categoria");
    const idade = (p.categoria_manejo_id != null ? idadePorId.get(String(p.categoria_manejo_id)) : undefined) ?? idadePorNome.get(nomeCat.toUpperCase()) ?? null;
    const cat = porCategoria.get(nomeCat) || { nome: nomeCat, idade, cab: 0, cabPeso: 0, kg: 0, kg90: 0 };
    cat.cab += cab;
    if (pesoHoje !== null) {
      cat.cabPeso += cab;
      cat.kg += cab * pesoHoje;
      cat.kg90 += cab * /** @type {number} */ (peso90);
    }
    porCategoria.set(nomeCat, cat);

    const areaId = String(p.area_atual_id ?? p.area_id ?? "");
    const area = areaPorId.get(areaId);
    const pasto = porPasto.get(areaId) || {
      id: areaId,
      nome: String(area?.nome || p.area_atual_nome || "Sem área"),
      fazenda: area?.setor_nome ? rotuloFazenda(area.setor_nome) : "",
      ha: numero(area?.tamanho_hectares),
      cab: 0, cabPeso: 0, kg: 0,
    };
    pasto.cab += cab;
    if (pesoHoje !== null) {
      pasto.cabPeso += cab;
      pasto.kg += cab * pesoHoje;
    }
    porPasto.set(areaId, pasto);
  }

  const categorias = [...porCategoria.values()]
    .sort((a, b) => {
      const ia = a.idade ?? Number.POSITIVE_INFINITY;
      const ib = b.idade ?? Number.POSITIVE_INFINITY;
      return ia === ib ? a.nome.localeCompare(b.nome, "pt-BR") : ia - ib;
    })
    .map((c) => ({
      nome: c.nome,
      cabecas: c.cab,
      pesoHoje: c.cabPeso > 0 ? c.kg / c.cabPeso : null,
      peso90: c.cabPeso > 0 ? c.kg90 / c.cabPeso : null,
    }));

  const pastos = [...porPasto.values()]
    .map((x) => ({
      id: x.id,
      nome: x.nome,
      fazenda: x.fazenda,
      cabecas: x.cab,
      pesoHoje: x.cabPeso > 0 ? x.kg / x.cabPeso : null,
      hectares: x.ha,
      uaHa: x.ha !== null && x.ha > 0 && x.cabPeso > 0 ? x.kg / KG_POR_UA / x.ha : null,
    }))
    .sort((a, b) => (b.uaHa ?? -1) - (a.uaHa ?? -1) || a.nome.localeCompare(b.nome, "pt-BR"));

  return {
    fazendas,
    cabecas,
    cabecasSemPeso,
    cabecasSemProjecao,
    pesoMedioHoje: cabComPeso > 0 ? kgHoje / cabComPeso : null,
    pesoMedio90: cabComPeso > 0 ? kg90 / cabComPeso : null,
    arrobasHoje: cabComPeso > 0 ? kgHoje / KG_POR_ARROBA : null,
    arrobasGanho90: cabComPeso > 0 ? (kg90 - kgHoje) / KG_POR_ARROBA : null,
    categorias,
    pastos,
  };
}
