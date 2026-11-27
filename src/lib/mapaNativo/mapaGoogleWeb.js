/**
 * Mapa do Google no SITE, direto pela Maps JavaScript API (D-PROD-369). O app continua no mapa nativo do plugin
 * `@capacitor/google-maps` (D-PROD-366).
 *
 * Por que não a versão web do plugin: ela não dá acesso ao mapa e só põe marcador com a ponta embaixo, sem
 * deslocamento nem a ordem de cada um. Os lotes, cochos, pontos e tarefas do Mapa Geral ficam centrados (ou deslocados
 * em px, como no MapLibre) e numa ordem fixa. Aqui eles são imagens numa camada `OverlayView`, posicionadas em px
 * a cada quadro: a mesma posição e o mesmo desenho do MapLibre.
 *
 * O objeto devolvido tem os nomes de método do `GoogleMap` do plugin que o `MapaGoogleNativo` usa, então o
 * componente é o mesmo no app e no site. `definirMarcadores` só existe aqui.
 *
 * Carregador: o canônico do produto (`loadGoogleMaps`, chave `VITE_GOOGLE_MAPS_API_KEY`).
 */
import { loadGoogleMaps } from "@/lib/googleMaps";

/**
 * Marcador numa imagem: posição, imagem já pronta (URL), tamanho em px da página, deslocamento do CENTRO da imagem
 * em relação ao ponto (px), ordem (maior por cima), título (dica do mouse) e o clique.
 * @typedef {{ id: string, lat: number, lng: number, url: string, w: number, h: number, dx?: number, dy?: number, z?: number, titulo?: string, onClick?: () => void }} MarcadorWeb
 */

/** @param {string} tipo "Satellite" | "Normal" (os nomes do plugin) */
const tipoDaApi = (tipo) => (String(tipo).toLowerCase() === "satellite" ? "satellite" : "roadmap");

/**
 * Camada dos marcadores: um `div` no painel que recebe o mouse, uma imagem por marcador, reposicionadas no `draw`.
 * A classe nasce depois que a API carregou (`google.maps.OverlayView` não existe antes).
 * @param {any} g `google.maps`
 */
function criarCamada(g) {
  class CamadaDeMarcadores extends g.OverlayView {
    constructor() {
      super();
      this.div = document.createElement("div");
      this.div.style.cssText = "position:absolute;left:0;top:0;";
      this.div.dataset.testid = "mapa-google-marcadores";
      /** @type {Map<string, { m: MarcadorWeb, el: HTMLImageElement }>} */
      this.itens = new Map();
    }

    onAdd() {
      this.getPanes()?.overlayMouseTarget?.appendChild(this.div);
    }

    onRemove() {
      this.div.remove();
    }

    draw() {
      const proj = this.getProjection();
      if (!proj) return;
      for (const { m, el } of this.itens.values()) this.posicionar(proj, m, el);
    }

    /** @param {any} proj @param {MarcadorWeb} m @param {HTMLImageElement} el */
    posicionar(proj, m, el) {
      const p = proj.fromLatLngToDivPixel(new g.LatLng(m.lat, m.lng));
      if (!p) return;
      const x = Math.round(p.x + (m.dx || 0) - m.w / 2);
      const y = Math.round(p.y + (m.dy || 0) - m.h / 2);
      el.style.transform = `translate(${x}px, ${y}px)`;
    }

    /**
     * Troca os marcadores de um grupo (os outros grupos ficam): o que saiu some, o que entrou aparece, o resto é
     * atualizado no lugar (sem piscar).
     * @param {string} grupo @param {MarcadorWeb[]} lista
     */
    definir(grupo, lista) {
      const novos = new Map(lista.map((m) => [`${grupo}|${m.id}`, m]));
      for (const [k, it] of this.itens) {
        if (k.startsWith(`${grupo}|`) && !novos.has(k)) {
          it.el.remove();
          this.itens.delete(k);
        }
      }
      const proj = this.getProjection();
      for (const [k, m] of novos) {
        let it = this.itens.get(k);
        if (!it) {
          const el = document.createElement("img");
          el.alt = "";
          el.draggable = false;
          // `touch-action: none`: a pinça e o arrasto com o dedo em cima do ícone são do mapa; sem isso o navegador do
          // celular dava zoom na página inteira
          el.style.cssText = "position:absolute;left:0;top:0;cursor:pointer;user-select:none;-webkit-user-drag:none;";
          el.style.touchAction = "none";
          el.dataset.marcador = k;
          // A roda do mouse, o arrasto e a pinça em cima do marcador continuam do mapa (como no MapLibre): só o
          // clique é do marcador. O Google não usa o clique do DOM para o polígono: quem decide se o clique no
          // polígono é do marcador é o gesto que o começou (`gestoNoMarcador`, no mapa).
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            this.itens.get(k)?.m.onClick?.();
          });
          this.div.appendChild(el);
          it = { m, el };
          this.itens.set(k, it);
        }
        it.m = m;
        const { el } = it;
        if (el.getAttribute("src") !== m.url) el.src = m.url;
        el.style.width = `${m.w}px`;
        el.style.height = `${m.h}px`;
        el.style.zIndex = String(m.z ?? 0);
        el.title = m.titulo || "";
        if (proj) this.posicionar(proj, m, el);
      }
    }
  }
  return new CamadaDeMarcadores();
}

/**
 * Cria o mapa do Google do site dentro de `element`.
 * @param {{ element: HTMLElement, config: { center: { lat: number, lng: number }, zoom: number, mapTypeId?: string } & Record<string, any> }} p
 */
export async function criarMapaGoogleWeb({ element, config }) {
  await loadGoogleMaps();
  const g = /** @type {any} */ (globalThis).google.maps;
  const div = document.createElement("div");
  div.style.cssText = "width:100%;height:100%;";
  element.appendChild(div);
  const mapa = new g.Map(div, { ...config, tilt: 0, rotateControl: false });
  /** @type {Map<string, any>} */
  const poligonos = new Map();
  /** @type {any[]} */
  const ouvintes = [];
  let proximoId = 1;
  /** @type {null | ((e: { polygonId: string, tag?: string }) => void)} */
  let aoClicarPoligono = null;
  const camada = criarCamada(g);
  camada.setMap(mapa);
  // Cada gesto (mouse, dedo ou caneta) que começa no mapa diz se começou num marcador; o clique no polígono que esse
  // gesto gerar é ignorado. Um arrasto que saiu do marcador não gera clique, e o próximo gesto, fora dele, libera a
  // área de novo; segurar o marcador por quanto tempo for não deixa a área abrir junto.
  let gestoNoMarcador = false;
  /** @param {PointerEvent} e */
  const aoComecarGesto = (e) => {
    const alvo = /** @type {any} */ (e.target);
    gestoNoMarcador = Boolean(alvo?.closest?.("[data-marcador]"));
  };
  div.addEventListener("pointerdown", aoComecarGesto, true);

  return {
    /** @param {string} tipo */
    async setMapType(tipo) {
      mapa.setMapTypeId(tipoDaApi(tipo));
    },
    /** @param {Array<{ paths: any[], tag?: string } & Record<string, any>>} lista */
    async addPolygons(lista) {
      return lista.map(({ tag, ...opcoes }) => {
        const id = String(proximoId++);
        const p = new g.Polygon({ ...opcoes, map: mapa });
        p.addListener("click", () => {
          // o gesto começou num marcador: o clique é dele (ele já abriu o detalhe dele), não da área por baixo
          if (gestoNoMarcador) return;
          aoClicarPoligono?.({ polygonId: id, tag });
        });
        poligonos.set(id, p);
        return id;
      });
    },
    /** @param {string[]} ids */
    async removePolygons(ids) {
      for (const id of ids) {
        poligonos.get(id)?.setMap(null);
        poligonos.delete(id);
      }
    },
    /** @param {{ southwest: { lat: number, lng: number }, northeast: { lat: number, lng: number } }} caixa @param {number} [margem] */
    async fitBounds(caixa, margem = 0) {
      mapa.fitBounds(new g.LatLngBounds(caixa.southwest, caixa.northeast), margem);
    },
    /** @param {(e: { polygonId: string, tag?: string }) => void} cb */
    async setOnPolygonClickListener(cb) {
      aoClicarPoligono = cb;
    },
    /** @param {(e: { latitude: number, longitude: number, zoom: number }) => void} cb */
    async setOnCameraIdleListener(cb) {
      ouvintes.push(
        mapa.addListener("idle", () => {
          const c = mapa.getCenter();
          if (c) cb({ latitude: c.lat(), longitude: c.lng(), zoom: mapa.getZoom() });
        })
      );
    },
    // no site o mapa fica dentro da página: não há toque para soltar ou pegar (só o mapa nativo do app precisa)
    async enableTouch() {},
    async disableTouch() {},
    /** @param {string} grupo @param {MarcadorWeb[]} lista */
    definirMarcadores(grupo, lista) {
      camada.definir(grupo, lista);
    },
    async destroy() {
      div.removeEventListener("pointerdown", aoComecarGesto, true);
      ouvintes.forEach((o) => o.remove?.());
      poligonos.forEach((p) => p.setMap(null));
      poligonos.clear();
      camada.setMap(null);
      g.event?.clearInstanceListeners?.(mapa);
      div.remove();
    },
  };
}
