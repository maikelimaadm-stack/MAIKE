/**
 * Marcadores do Mapa Geral no mapa do Google do APP (D-PROD-372): o SDK nativo só aceita imagem de arquivo do app ou
 * de endereço `https`, não a imagem desenhada na hora (lote com a contagem, cocho com o nível e o farol). As imagens
 * ficam num `div` por cima do mapa nativo: uma por marcador, o centro dela no ponto mais o deslocamento em px, a ordem
 * por `z-index`, posicionadas pela câmera (`projetarNaCamera`). O site tem a camada própria dele, dentro do mapa do
 * Google (`mapaGoogleWeb.js`).
 *
 * O `div` não pega o toque (vai para o mapa nativo); só a imagem pega, e só para o clique.
 */

/**
 * @typedef {import('./mapaGoogleWeb.js').MarcadorWeb} Marcador
 * @typedef {(lat: number, lng: number) => ({ x: number, y: number } | null)} Projetar
 */

/**
 * @param {HTMLElement} div onde as imagens moram
 * @param {{ aoTocar?: () => void }} [opcoes] `aoTocar`: um toque começou num marcador (antes do clique)
 */
export function criarCamadaDeImagens(div, opcoes = {}) {
  /** @type {Map<string, { m: Marcador, el: HTMLImageElement }>} */
  const itens = new Map();
  /** @type {Projetar | null} */
  let projetarAtual = null;

  /** @param {Marcador} m @param {HTMLImageElement} el */
  const posicionar = (m, el) => {
    const p = projetarAtual?.(m.lat, m.lng);
    if (!p) return;
    const x = Math.round(p.x + (m.dx || 0) - m.w / 2);
    const y = Math.round(p.y + (m.dy || 0) - m.h / 2);
    el.style.transform = `translate(${x}px, ${y}px)`;
  };

  return {
    itens,
    /** Reposiciona todas as imagens com a projeção dada (ou a última). @param {Projetar} [projetar] */
    posicionarTodos(projetar) {
      if (projetar) projetarAtual = projetar;
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
          el.style.cssText = "position:absolute;left:0;top:0;cursor:pointer;pointer-events:auto;user-select:none;-webkit-user-drag:none;";
          // o dedo em cima do ícone nunca dá zoom nem rola a página
          el.style.touchAction = "none";
          el.dataset.marcador = k;
          el.addEventListener("pointerdown", () => opcoes.aoTocar?.());
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            itens.get(k)?.m.onClick?.();
          });
          div.appendChild(el);
          it = { m, el };
          itens.set(k, it);
        }
        it.m = m;
        const { el } = it;
        if (el.getAttribute("src") !== m.url) el.src = m.url;
        el.style.width = `${m.w}px`;
        el.style.height = `${m.h}px`;
        el.style.zIndex = String(m.z ?? 0);
        el.title = m.titulo || "";
        posicionar(m, el);
      }
    },
    /** Tira todas as imagens. */
    limpar() {
      for (const { el } of itens.values()) el.remove();
      itens.clear();
    },
  };
}

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
