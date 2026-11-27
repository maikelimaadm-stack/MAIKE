/**
 * Marcadores do Mapa Geral no mapa do Google do APP (D-PROD-372): o SDK nativo só aceita imagem de arquivo do app ou
 * de endereço `https`, não a imagem desenhada na hora (lote com a contagem, cocho com o nível e o farol). As imagens
 * ficam num `div` por cima do mapa nativo: uma por marcador, o centro dela no ponto mais o deslocamento em px, a ordem
 * por `z-index`, posicionadas pela câmera (`projetarNaCamera`). O site tem a camada própria dele, dentro do mapa do
 * Google (`mapaGoogleWeb.js`).
 *
 * O `div` e as imagens não pegam toque (vai tudo para o mapa nativo, D-PROD-373): o toque rápido num ícone chega
 * pelo clique do mapa e é conferido aqui (`tocar`).
 */

import { caixaDoMarcador, porNaCaixa } from "./posicaoDoMarcador.js";

/**
 * @typedef {import('./mapaGoogleWeb.js').MarcadorWeb} Marcador
 * @typedef {(lat: number, lng: number) => ({ x: number, y: number } | null)} Projetar
 */

/**
 * @param {HTMLElement} div onde as imagens moram
 */
export function criarCamadaDeImagens(div) {
  /** @type {Map<string, { m: Marcador, el: HTMLImageElement }>} */
  const itens = new Map();
  /** @type {Projetar | null} */
  let projetarAtual = null;
  /** Zoom do MapLibre da última projeção (o tamanho dos nomes segue o zoom). */
  let zoomAtual = 14;

  /** Caixa da imagem na tela, ou null sem projeção. @param {Marcador} m */
  const caixa = (m) => {
    const p = projetarAtual?.(m.lat, m.lng);
    return p ? caixaDoMarcador(m, p, zoomAtual) : null;
  };

  /** @param {Marcador} m @param {HTMLImageElement} el */
  const posicionar = (m, el) => {
    const c = caixa(m);
    if (c) porNaCaixa(el, c);
  };

  return {
    itens,
    /**
     * Reposiciona todas as imagens com a projeção dada (ou a última).
     * @param {Projetar} [projetar] @param {number} [zoom] zoom do MapLibre (o do Google − 1)
     */
    posicionarTodos(projetar, zoom) {
      if (projetar) projetarAtual = projetar;
      if (Number.isFinite(zoom)) zoomAtual = /** @type {number} */ (zoom);
      for (const { m, el } of itens.values()) posicionar(m, el);
    },
    /**
     * Troca os marcadores de um grupo (os outros grupos ficam): o que saiu some, o que entrou aparece, o resto é
     * atualizado no mesmo elemento (sem piscar).
     * @param {string} grupo @param {Marcador[]} lista
     */
    definir(grupo, lista) {
      const novos = new Map(lista.map((m) => [`${grupo}|${m.id}`, m]));
      for (const [k, it] of itens) {
        if (k.startsWith(`${grupo}|`) && !novos.has(k)) {
          it.el.remove();
          itens.delete(k);
        }
      }
      for (const [k, m] of novos) {
        let it = itens.get(k);
        if (!it) {
          const el = document.createElement("img");
          el.alt = "";
          el.draggable = false;
          // A imagem não pega toque nenhum (D-PROD-373): todo toque vai para o mapa nativo, então a pinça e o arrasto
          // que começam em cima de um ícone mexem o mapa. O toque rápido num ícone chega pelo clique do mapa
          // (`tocar`, com o ponto na tela).
          el.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;user-select:none;-webkit-user-drag:none;will-change:transform;";
          el.dataset.marcador = k;
          div.appendChild(el);
          it = { m, el };
          itens.set(k, it);
        }
        it.m = m;
        const { el } = it;
        if (el.getAttribute("src") !== m.url) el.src = m.url;
        if (!m.escala) {
          el.style.width = `${m.w}px`;
          el.style.height = `${m.h}px`;
        }
        el.style.zIndex = String(m.z ?? 0);
        el.title = m.titulo || "";
        posicionar(m, el);
      }
    },
    /**
     * Toque no mapa em (x, y) px da tela: o ícone de cima que está nesse ponto (com uma folga para o dedo) recebe o
     * clique. Devolve se algum recebeu.
     * @param {number} x @param {number} y @param {number} [folga] px em volta do ícone
     */
    tocar(x, y, folga = FOLGA_TOQUE_PX) {
      /** @type {Marcador | null} */
      let achado = null;
      for (const { m } of itens.values()) {
        // o nome do pasto não recebe toque (o toque é da área)
        if (m.semToque || !m.onClick) continue;
        const c = caixa(m);
        if (!c) continue;
        const dentro = x >= c.x - folga && x <= c.x + c.w + folga && y >= c.y - folga && y <= c.y + c.h + folga;
        // empate de z-index: o de cima é o posto depois (a ordem do Map é a das imagens no div)
        if (dentro && (!achado || (m.z ?? 0) >= (achado.z ?? 0))) achado = m;
      }
      if (!achado) return false;
      achado.onClick?.();
      return true;
    },
    /** Tira todas as imagens. */
    limpar() {
      for (const { el } of itens.values()) el.remove();
      itens.clear();
    },
  };
}

/** Folga em volta do ícone para o toque do dedo (px). */
export const FOLGA_TOQUE_PX = 4;

/** Tamanho do mundo em px no zoom do Google (ladrilho de 256 px, em px da página = dp no app). @param {number} zoom */
const mundo = (zoom) => 256 * 2 ** zoom;

/** Ponto do mundo (Web Mercator) em px no zoom. @param {number} lat @param {number} lng @param {number} zoom */
function noMundo(lat, lng, zoom) {
  const s = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  const tam = mundo(zoom);
  return { x: ((lng + 180) / 360) * tam, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * tam };
}

/**
 * Projeção do mapa nativo do app a partir da câmera (o plugin não dá a projeção, só a câmera quando o mapa para):
 * Web Mercator no zoom do Google, centro da câmera no meio do elemento, girado pelo rumo (bearing). Mapa inclinado
 * (tilt) não tem projeção plana: devolve null e os marcadores ficam escondidos.
 * @param {{ latitude: number, longitude: number, zoom: number, bearing?: number, tilt?: number }} camera
 * @param {number} largura @param {number} altura px do elemento do mapa
 * @returns {Projetar | null}
 */
export function projetarNaCamera(camera, largura, altura) {
  if (!camera || !Number.isFinite(camera.latitude) || !Number.isFinite(camera.zoom)) return null;
  if (Number(camera.tilt) > 0.5) return null;
  const centro = noMundo(camera.latitude, camera.longitude, camera.zoom);
  const tam = mundo(camera.zoom);
  const b = ((Number(camera.bearing) || 0) * Math.PI) / 180;
  const cos = Math.cos(b);
  const sin = Math.sin(b);
  return (lat, lng) => {
    const p = noMundo(lat, lng, camera.zoom);
    let dx = p.x - centro.x;
    // o caminho mais curto pelo meridiano 180
    if (dx > tam / 2) dx -= tam;
    if (dx < -tam / 2) dx += tam;
    const dy = p.y - centro.y;
    return { x: largura / 2 + dx * cos + dy * sin, y: altura / 2 - dx * sin + dy * cos };
  };
}
