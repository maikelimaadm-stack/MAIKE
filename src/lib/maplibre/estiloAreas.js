/**
 * Visual de polígonos/áreas no editor MapLibre (referência CONTROLE-DE-ESTOQUE).
 * Prefere preservar mudanças visuais paralelas futuras — estes são defaults M1.
 */

export const COR_LINHA_AREA = "#ffffff";
export const COR_DESENHO = "#f5a01b";
export const COR_VERTICE_FILL = "#ffffff";
export const COR_VERTICE_STROKE = "#f5a01b";
export const OPACIDADE_FILL_AREA = 0.78;
/** Rascunho fechado sem cor salva (referência `camada-desenho.tsx`: 0.18). */
export const OPACIDADE_FILL_DESENHO = 0.18;
/** Rascunho ainda aberto (referência: 0.1). */
export const OPACIDADE_FILL_DESENHO_ABERTO = 0.1;

/**
 * Editor de desenho/edição — valores da referência CONTROLE-DE-ESTOQUE
 * (`camada-desenho.tsx`, commit 6aef845e), em px de tela como no SVG de lá (D-PROD-66).
 * Só o editor usa estes tokens; áreas cadastradas seguem `paintArea*` abaixo.
 */
export const EDITOR_VISUAL = Object.freeze({
  linha: 2.2,
  vertice: Object.freeze({ raio: 5, raioAtivo: 5.6, borda: 2.4 }),
  meio: Object.freeze({ raio: 2.8, raioHover: 3.4 }),
  /** Anel de seleção (remover ponto) — mesmo desenho do anel do ímã. */
  selecao: Object.freeze({ raio: 8, borda: 1.6 }),
  ima: Object.freeze({ anel: 8, anelBorda: 1.6, anelOpacidade: 0.95, fecharRaio: 4.2, fecharBorda: 2, arestaHalo: 5, arestaHaloOpacidade: 0.22, arestaLinha: 2 }),
  cruz: Object.freeze({ braco: 7, largura: 1.8 }),
  guiaShift: Object.freeze({ largura: 1.2, traco: Object.freeze([4, 6]), opacidade: 0.85, extensao: 1.35 }),
  /** Tolerância de acerto (px) — alvo maior que o círculo visível. */
  acerto: Object.freeze({ mouse: 8, toque: 14 }),
});

/**
 * SVG centraliza o traço no raio; MapLibre desenha `circle-stroke` por FORA do
 * `circle-radius`. Para o mesmo tamanho visível: raio MapLibre = raio SVG − borda/2.
 * @param {number} raioSvg
 * @param {number} borda
 */
export function raioCirculoMapLibre(raioSvg, borda) {
  return raioSvg - borda / 2;
}

/** `line-dasharray` do MapLibre é múltiplo da largura; converte traço em px. */
function tracoEmLarguras(tracoPx, largura) {
  return tracoPx.map((v) => Number((v / largura).toFixed(4)));
}

/** Paleta desejada do cadastro (aceita cores históricas fora da lista). */
export const PALETA_AREAS_CADASTRO = Object.freeze([
  { nome: "Branco", cor: "#f8f9fa" },
  { nome: "Cinza", cor: "#94a3b8" },
  { nome: "Preto", cor: "#1e293b" },
  { nome: "Azul escuro", cor: "#0d67ad" },
  { nome: "Azul celeste", cor: "#61aad9" },
  { nome: "Azul", cor: "#2563eb" },
  { nome: "Verde escuro", cor: "#0f766e" },
  { nome: "Verde", cor: "#16a34a" },
  { nome: "Verde claro", cor: "#92ca25" },
  { nome: "Amarelo", cor: "#efcb19" },
  { nome: "Laranja", cor: "#f5a01b" },
  { nome: "Vermelho", cor: "#dc2626" },
  { nome: "Rosa", cor: "#db2777" },
  { nome: "Roxo", cor: "#966fe1" },
  { nome: "Marrom", cor: "#92400e" },
  { nome: "Turquesa", cor: "#14b8a6" },
]);

/**
 * @param {string} hex
 * @returns {[number, number, number] | null}
 */
function hexParaRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!m) return null;
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {string}
 */
function rgbParaHex(r, g, b) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Preenchimento ~95% cor + 5% branco (leitura sobre basemap).
 * @param {string | null | undefined} cor
 * @returns {string}
 */
export function corExibidaNoMapa(cor) {
  const base = hexParaRgb(cor && String(cor).trim() !== "" ? cor : "#94a3b8") || [148, 163, 184];
  return rgbParaHex(base[0] * 0.95 + 255 * 0.05, base[1] * 0.95 + 255 * 0.05, base[2] * 0.95 + 255 * 0.05);
}

/**
 * Espessura da divisa branca por zoom (px).
 * @param {number} zoom
 * @returns {number}
 */
export function espessuraDivisaPorZoom(zoom) {
  if (!Number.isFinite(zoom)) return 0.45;
  if (zoom <= 10) return 0.3;
  if (zoom <= 13) return 0.45;
  if (zoom <= 16) return 0.55;
  return 0.7;
}

export const LAYER_IDS = Object.freeze({
  AREAS_FILL: "m1-areas-fill",
  AREAS_LINE: "m1-areas-line",
  LINHAS: "m1-linhas",
  PONTOS: "m1-pontos",
  DESENHO_FILL: "m1-desenho-fill",
  DESENHO_LINE: "m1-desenho-line",
  VERTICES: "m1-vertices",
  VERTICES_SELECAO: "m1-vertices-selecao",
  MIDPOINTS: "m1-midpoints",
  GUIA: "m1-guia",
  GUIA_SHIFT: "m1-guia-shift",
  IMA_ARESTA_HALO: "m1-ima-aresta-halo",
  IMA_ARESTA: "m1-ima-aresta",
});

export const SOURCE_IDS = Object.freeze({
  AREAS: "m1-areas",
  LINHAS: "m1-linhas",
  PONTOS: "m1-pontos",
  DESENHO: "m1-desenho",
  VERTICES: "m1-vertices",
  MIDPOINTS: "m1-midpoints",
  GUIA: "m1-guia",
});

/**
 * SSOT de pintura de áreas cadastradas (editor, seleção e Mapa Geral) — D-PROD-65.
 * Mesmos valores da referência (Controle de Estoque `mapa-base.tsx`):
 * preenchimento pela cor salva (+5% branco), divisa branca fina por zoom e
 * destaque (hover/seleção) só na linha branca mais marcada.
 */
export const LARGURA_DIVISA_EXPR = Object.freeze(["interpolate", ["linear"], ["zoom"], 10, 0.3, 13, 0.45, 16, 0.55, 18, 0.7]);
export const LARGURA_DESTAQUE_EXPR = Object.freeze(["interpolate", ["linear"], ["zoom"], 10, 1.4, 14, 1.8, 18, 2.2]);

/** @param {string} [corProp] propriedade com a cor já exibida */
export function paintAreaFill(corProp = "fill") {
  return {
    "fill-color": ["coalesce", ["get", corProp], "#94a3b8"],
    "fill-opacity": OPACIDADE_FILL_AREA,
  };
}

export function paintAreaDivisa() {
  return { "line-color": COR_LINHA_AREA, "line-opacity": 1, "line-width": /** @type {any} */ ([...LARGURA_DIVISA_EXPR]) };
}

export function paintAreaDestaque() {
  return {
    "line-color": COR_LINHA_AREA,
    "line-opacity": [
      "case",
      ["boolean", ["feature-state", "selecionada"], false],
      1,
      ["boolean", ["feature-state", "hover"], false],
      1,
      0,
    ],
    "line-width": /** @type {any} */ ([...LARGURA_DESTAQUE_EXPR]),
  };
}

const ativoOuSelecionado = /** @type {any} */ ([
  "any",
  ["boolean", ["feature-state", "ativo"], false],
  ["boolean", ["get", "selecionado"], false],
]);

/** Contorno/linha do rascunho: laranja; área existente em edição usa a cor salva. */
export function paintEditorContorno() {
  return { "line-color": ["coalesce", ["get", "fill"], COR_DESENHO], "line-width": EDITOR_VISUAL.linha, "line-opacity": 1 };
}

/** Preenchimento: cor salva 0.78; rascunho fechado 0.18; aberto 0.1. */
export function paintEditorPreenchimento() {
  return {
    "fill-color": ["coalesce", ["get", "fill"], COR_DESENHO],
    "fill-opacity": [
      "case",
      ["has", "fill"],
      OPACIDADE_FILL_AREA,
      ["boolean", ["get", "fechado"], true],
      OPACIDADE_FILL_DESENHO,
      OPACIDADE_FILL_DESENHO_ABERTO,
    ],
  };
}

export const LAYOUT_LINHA_REDONDA = Object.freeze({ "line-cap": "round", "line-join": "round" });

/** Linha elástica último ponto → cursor: sólida, 2.2px, ponta redonda. */
export function paintElastico() {
  return { "line-color": COR_DESENHO, "line-width": EDITOR_VISUAL.linha, "line-opacity": 1 };
}

/** Guia ADICIONAL do Shift (45°): pontilhada 4/6 px, 1.2px, 0.85. */
export function paintGuiaShift() {
  const g = EDITOR_VISUAL.guiaShift;
  return { "line-color": COR_DESENHO, "line-width": g.largura, "line-opacity": g.opacidade, "line-dasharray": tracoEmLarguras(g.traco, g.largura) };
}

/** Aresta sob o ímã: faixa espessa translúcida + linha fina. */
export function paintImaAresta(halo) {
  const i = EDITOR_VISUAL.ima;
  return halo
    ? { "line-color": COR_DESENHO, "line-width": i.arestaHalo, "line-opacity": i.arestaHaloOpacidade }
    : { "line-color": COR_DESENHO, "line-width": i.arestaLinha, "line-opacity": 1 };
}

/** Vértice: branco com borda laranja; hover/arrasto/selecionado um pouco maior. */
export function paintEditorVertices() {
  const v = EDITOR_VISUAL.vertice;
  return {
    "circle-radius": ["case", ativoOuSelecionado, raioCirculoMapLibre(v.raioAtivo, v.borda), raioCirculoMapLibre(v.raio, v.borda)],
    "circle-color": COR_VERTICE_FILL,
    "circle-stroke-color": COR_VERTICE_STROKE,
    "circle-stroke-width": v.borda,
    "circle-pitch-alignment": "viewport",
  };
}

/** Anel discreto do vértice selecionado (para remover) — só a borda. */
export function paintVerticeSelecao() {
  const s = EDITOR_VISUAL.selecao;
  return {
    "circle-radius": raioCirculoMapLibre(s.raio, s.borda),
    "circle-opacity": 0,
    "circle-stroke-color": COR_DESENHO,
    "circle-stroke-width": s.borda,
    "circle-stroke-opacity": EDITOR_VISUAL.ima.anelOpacidade,
  };
}

/** Ponto do meio: laranja sólido, sem borda; maior no hover. */
export function paintEditorMeios() {
  const m = EDITOR_VISUAL.meio;
  return {
    "circle-radius": ["case", ["boolean", ["feature-state", "hover"], false], m.raioHover, m.raio],
    "circle-color": COR_DESENHO,
    "circle-opacity": 1,
    "circle-stroke-width": 0,
  };
}
