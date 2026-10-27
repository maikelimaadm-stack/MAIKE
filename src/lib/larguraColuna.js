/**
 * Largura de coluna pelo texto — paridade CONTROLE-DE-ESTOQUE / largura-coluna.ts.
 */

import { MIN_COL_WIDTH } from "@/lib/cadastroBase1ColumnPrefs";

/** Teto de medição para autofit / duplo clique (CDE `largura-coluna.ts`). */
export const AUTOFIT_MAX_COL_WIDTH = 480;
const TETO = AUTOFIT_MAX_COL_WIDTH;
const PISO = MIN_COL_WIDTH;
const PAD = 18 + 2;
const CHROME_MENU = 20 + 4;
export const CHROME_ICONE_ESTADO = 12 + 4;

let canvas = null;

export function fonteDaCelula(el) {
  if (!el || typeof window === "undefined") return "600 12px system-ui, sans-serif";
  const s = window.getComputedStyle(el);
  return `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
}

function fonteDoCorpo(fontCabecalho) {
  return fontCabecalho.replace(/^\d{3}\s/, "400 ").replace(/^bold\s/i, "400 ");
}

function medir(texto, font) {
  if (typeof document === "undefined") return 0;
  if (!canvas) canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  ctx.font = font;
  const t = String(texto ?? "").replace(/\s+/g, " ").trim();
  if (!t) return 0;
  return ctx.measureText(t).width;
}

/**
 * @param {{
 *   rotulo: string;
 *   textosCelulas: readonly string[];
 *   fontCabecalho: string;
 *   fontCelula?: string;
 *   iconesEstado?: number;
 *   chromeExtraCelula?: number;
 * }} opts
 */
export function medirLarguraColuna(opts) {
  const fontH = opts.fontCabecalho;
  const fontC = opts.fontCelula ?? fonteDoCorpo(fontH);
  const nIcones = Math.max(0, opts.iconesEstado ?? 0);
  const chromeTh = PAD + CHROME_MENU + nIcones * CHROME_ICONE_ESTADO;
  const chromeTd = PAD + (opts.chromeExtraCelula ?? 0);

  const wTh = Math.ceil(medir(opts.rotulo, fontH) + chromeTh);
  let wTd = 0;
  for (const bruto of opts.textosCelulas) {
    const t = String(bruto ?? "").replace(/\s+/g, " ").trim();
    if (!t || t === "—" || t === "–" || t === "…") continue;
    wTd = Math.max(wTd, Math.ceil(medir(t, fontC) + chromeTd));
  }
  return Math.min(TETO, Math.max(PISO, Math.max(wTh, wTd)));
}
