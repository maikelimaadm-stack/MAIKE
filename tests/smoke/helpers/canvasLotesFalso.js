/**
 * Canvas e <img> falsos para as imagens dos lotes desenhadas pelo mapa (D-PROD-349).
 *
 * O jsdom não desenha (o setup devolve `getContext() === null`) nem carrega imagem. Aqui:
 *  - `Image` falsa: "carrega" a data URL do SVG do marcador no próximo microtask, com `naturalWidth/Height`
 *    lidos do `width`/`height` do SVG; conta quantas figuras foram carregadas;
 *  - contexto 2D falso: guarda as chamadas (`fillText`, `drawImage`, `font`, `fillStyle`, sombras) e devolve
 *    pixels do tamanho do canvas em `getImageData`.
 */
import { vi } from "vitest";

/** SVG dentro da data URL. @param {string} url */
export const svgDaUrl = (url) =>
  new DOMParser().parseFromString(atob(String(url).replace(/^data:image\/svg\+xml;base64,/, "")), "image/svg+xml").documentElement;

/**
 * Instala os falsos. Chamar no `beforeEach` (o `restoreMocks` do vitest desfaz o `getContext`; `unstubGlobals`, a `Image`).
 * @returns {{ chamadas: any[], figurasCarregadas: string[], textos: () => string[], desenhos: () => number }}
 */
export function instalarCanvasFalso() {
  /** @type {any[]} */
  const chamadas = [];
  /** @type {string[]} */
  const figurasCarregadas = [];

  class ImagemFalsa {
    constructor() {
      this.naturalWidth = 0;
      this.naturalHeight = 0;
      /** @type {null | (() => void)} */
      this.onload = null;
      /** @type {null | (() => void)} */
      this.onerror = null;
      this._src = "";
    }
    set src(v) {
      this._src = v;
      queueMicrotask(() => {
        try {
          const svg = svgDaUrl(v);
          this.naturalWidth = Number(svg.getAttribute("width")) || 0;
          this.naturalHeight = Number(svg.getAttribute("height")) || 0;
          figurasCarregadas.push(v);
          this.onload?.();
        } catch {
          this.onerror?.();
        }
      });
    }
    get src() {
      return this._src;
    }
  }
  vi.stubGlobal("Image", ImagemFalsa);
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(data, width, height) {
        this.data = data;
        this.width = width;
        this.height = height;
      }
    }
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => "data:image/png;base64,AAAA");

  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function () {
    const canvas = /** @type {HTMLCanvasElement} */ (this);
    /** @type {Record<string, any>} */
    const estado = { font: "", fillStyle: "", strokeStyle: "", shadowColor: "", shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, textAlign: "", textBaseline: "", lineWidth: 1 };
    const registrar = (nome) => (...args) => {
      chamadas.push({ nome, args, estado: { ...estado }, largura: canvas.width, altura: canvas.height });
    };
    return /** @type {any} */ ({
      get font() { return estado.font; },
      set font(v) { estado.font = v; },
      get fillStyle() { return estado.fillStyle; },
      set fillStyle(v) { estado.fillStyle = v; },
      get strokeStyle() { return estado.strokeStyle; },
      set strokeStyle(v) { estado.strokeStyle = v; },
      get shadowColor() { return estado.shadowColor; },
      set shadowColor(v) { estado.shadowColor = v; },
      get shadowBlur() { return estado.shadowBlur; },
      set shadowBlur(v) { estado.shadowBlur = v; },
      get shadowOffsetX() { return estado.shadowOffsetX; },
      set shadowOffsetX(v) { estado.shadowOffsetX = v; },
      get shadowOffsetY() { return estado.shadowOffsetY; },
      set shadowOffsetY(v) { estado.shadowOffsetY = v; },
      get textAlign() { return estado.textAlign; },
      set textAlign(v) { estado.textAlign = v; },
      get textBaseline() { return estado.textBaseline; },
      set textBaseline(v) { estado.textBaseline = v; },
      get lineWidth() { return estado.lineWidth; },
      set lineWidth(v) { estado.lineWidth = v; },
      setTransform: registrar("setTransform"),
      clearRect: registrar("clearRect"),
      drawImage: registrar("drawImage"),
      fillText: registrar("fillText"),
      fillRect: registrar("fillRect"),
      beginPath: registrar("beginPath"),
      arc: registrar("arc"),
      fill: registrar("fill"),
      stroke: registrar("stroke"),
      clip: registrar("clip"),
      save: registrar("save"),
      restore: registrar("restore"),
      putImageData: registrar("putImageData"),
      measureText: () => ({ width: 10 }),
      getImageData: (/** @type {number} */ _x, /** @type {number} */ _y, /** @type {number} */ w, /** @type {number} */ h) => {
        chamadas.push({ nome: "getImageData", args: [w, h] });
        return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
      },
    });
  });

  return {
    chamadas,
    figurasCarregadas,
    /** textos escritos (inclui os do halo, que saem fora da tela) */
    textos: () => chamadas.filter((c) => c.nome === "fillText").map((c) => c.args[0]),
    /** quantas imagens foram lidas do canvas (uma por imagem desenhada) */
    desenhos: () => chamadas.filter((c) => c.nome === "getImageData").length,
  };
}

/** Espera os microtasks/timers de carregamento das figuras. */
export const esperarImagens = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};
