/**
 * Canvas e <img> falsos para as imagens dos lotes desenhadas pelo mapa (D-PROD-349).
 *
 * O jsdom não desenha (o setup devolve `getContext() === null`) nem carrega imagem. Aqui:
 *  - `Image` falsa: "carrega" a data URL do SVG do marcador no próximo microtask, com `naturalWidth/Height`
 *    lidos do `width`/`height` do SVG; conta quantas figuras foram carregadas;
 *  - contexto 2D falso: guarda as chamadas (`fillText`, `drawImage`, `font`, `fillStyle`, sombras) e devolve
 *    pixels do tamanho do canvas em `getImageData`.
 *
 * D-PROD-353 (pontos desenhados pelo mapa): URL http(s) "carrega" com 64 × 64 (ou falha, por `falharUrl`); uma figura
 * de outra origem pode SUJAR o canvas em que é desenhada (`sujarCom`), e daí em diante `getImageData` daquele canvas
 * lança, como no navegador; `measureText` mede 6 px por letra; caminho com `moveTo`/`lineTo`/`closePath`.
 */
import { vi } from "vitest";

/** SVG dentro da data URL (base64 ou `charset=utf-8,` com encodeURIComponent, como as do cocho e da tarefa). @param {string} url */
export const svgDaUrl = (url) => {
  const u = String(url);
  const texto = u.startsWith("data:image/svg+xml;base64,")
    ? atob(u.replace(/^data:image\/svg\+xml;base64,/, ""))
    : decodeURIComponent(u.replace(/^data:image\/svg\+xml(;charset=utf-8)?,/, ""));
  return new DOMParser().parseFromString(texto, "image/svg+xml").documentElement;
};

/**
 * Instala os falsos. Chamar no `beforeEach` (o `restoreMocks` do vitest desfaz o `getContext`; `unstubGlobals`, a `Image`).
 * `falharLeitura(largura, altura)`: quando devolve true, `getImageData` lança (canvas "sujo"), para simular a
 * imagem do lote que não pôde ser desenhada.
 * `falharFigura`: quando true, a figura (SVG) não carrega (`onerror`).
 * `falharUrl(url)`: quando devolve true, aquela figura não carrega. `sujarCom(url)`: quando devolve true, desenhar
 * aquela figura suja o canvas (a leitura dos pixels dele passa a lançar). `penderUrl(url)`: aquela figura nunca responde.
 * @returns {{ chamadas: any[], figurasCarregadas: string[], textos: () => string[], desenhos: () => number, falharLeitura: null | ((w: number, h: number) => boolean), falharFigura: boolean, falharUrl: null | ((url: string) => boolean), sujarCom: null | ((url: string) => boolean), penderUrl: null | ((url: string) => boolean), crossOrigin: string[] }}
 */
export function instalarCanvasFalso() {
  /** @type {{ falharLeitura: null | ((w: number, h: number) => boolean) }} */
  const controle = { falharLeitura: null, falharFigura: false, falharUrl: null, sujarCom: null, penderUrl: null };
  /** `crossOrigin` de cada figura pedida (na ordem). */
  const crossOrigin = [];
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
      this.crossOrigin = null;
    }
    set src(v) {
      this._src = v;
      crossOrigin.push(this.crossOrigin);
      if (controle.penderUrl?.(v)) return; // servidor que nunca responde: nem onload, nem onerror
      queueMicrotask(() => {
        try {
          if (controle.falharFigura) throw new Error("figura não carregou");
          if (controle.falharUrl?.(v)) throw new Error("figura não carregou");
          if (/^https?:/.test(v)) {
            this.naturalWidth = 64;
            this.naturalHeight = 64;
            figurasCarregadas.push(v);
            this.onload?.();
            return;
          }
          const svg = svgDaUrl(v);
          if (svg.nodeName !== "svg") throw new Error("não é SVG");
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
      drawImage: (/** @type {any[]} */ ...args) => {
        registrar("drawImage")(...args);
        if (controle.sujarCom?.(String(args[0]?._src ?? ""))) /** @type {any} */ (canvas).__sujo = true;
      },
      moveTo: registrar("moveTo"),
      lineTo: registrar("lineTo"),
      closePath: registrar("closePath"),
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
      measureText: (/** @type {string} */ t) => ({ width: 6 * String(t).length }),
      getImageData: (/** @type {number} */ _x, /** @type {number} */ _y, /** @type {number} */ w, /** @type {number} */ h) => {
        chamadas.push({ nome: "getImageData", args: [w, h] });
        if (controle.falharLeitura?.(w, h)) throw new Error("canvas sujo");
        if (/** @type {any} */ (canvas).__sujo) throw new Error("canvas sujo (figura de outra origem)");
        return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
      },
    });
  });

  return {
    get falharLeitura() {
      return controle.falharLeitura;
    },
    set falharLeitura(f) {
      controle.falharLeitura = f;
    },
    get falharFigura() {
      return controle.falharFigura;
    },
    set falharFigura(v) {
      controle.falharFigura = !!v;
    },
    get falharUrl() {
      return controle.falharUrl;
    },
    set falharUrl(f) {
      controle.falharUrl = f;
    },
    get penderUrl() {
      return controle.penderUrl;
    },
    set penderUrl(f) {
      controle.penderUrl = f;
    },
    get sujarCom() {
      return controle.sujarCom;
    },
    set sujarCom(f) {
      controle.sujarCom = f;
    },
    crossOrigin,
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
