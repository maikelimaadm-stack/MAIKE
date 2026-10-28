/**
 * Visual de polígonos/áreas no editor MapLibre (referência CONTROLE-DE-ESTOQUE).
 * Prefere preservar mudanças visuais paralelas futuras — estes são defaults M1.
 */

export const COR_LINHA_AREA = "#ffffff";
export const COR_DESENHO = "#f5a01b";
export const COR_VERTICE_FILL = "#ffffff";
export const COR_VERTICE_STROKE = "#f5a01b";
export const OPACIDADE_FILL_AREA = 0.78;
export const OPACIDADE_FILL_DESENHO = 0.35;

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
  MIDPOINTS: "m1-midpoints",
  GUIA: "m1-guia",
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
