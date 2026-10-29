/**
 * Controle Mapa ↔ Satélite sobre UMA instância MapLibre (D-PROD-65).
 *
 * - Mapa (ruas): estilo vetorial OpenFreeMap Liberty, carregado na criação.
 * - Satélite (preferência): camada raster da Google Map Tiles API inserida
 *   ACIMA do estilo-base e ABAIXO das camadas de negócio. Trocar de base só
 *   liga/desliga visibilidade: polígonos, desenho, histórico, centro e zoom
 *   ficam intactos (sem setStyle, sem remontar).
 * - Alternativa: `VITE_MAP_SATELLITE_STYLE_URL` (estilo licenciado), via
 *   setStyle + callback `reaplicarCamadas` da superfície.
 * - Falha (sem chave, 401/403/429, rede): volta para Mapa com estado `erro`
 *   e mensagem visível — nunca deixa "Satélite" ativo sem imagem.
 */
import { BASEMAP_IDS, getSatelliteProvider, PROVIDER_RUAS } from "./basemap.js";
import {
  ATRIBUICAO_GOOGLE,
  SAT_LAYER_ID,
  SAT_SOURCE_ID,
  classificarFalhaMapTiles,
  descartarSessoesMapTiles,
  fonteRasterMapTiles,
  mapTilesConfigurado,
  obterSessaoMapTiles,
  textoAtribuicaoGoogle,
  urlViewportMapTiles,
} from "./googleMapTiles.js";

/** Prefixos das fontes de negócio (camadas do produto, nunca do estilo-base). */
export const PREFIXOS_FONTES_NEGOCIO = Object.freeze(["m1-", "maike-", "mg-", "selecao-", "task-", "gps-"]);

/**
 * @typedef {{
 *   basemapId: string,
 *   status: "pronto" | "carregando" | "erro",
 *   provedor: "openfreemap" | "google-map-tiles" | "estilo-licenciado" | "indisponivel",
 *   mensagem: string | null,
 *   atribuicao: string | null,
 * }} EstadoBasemap
 */

/** Provedor de satélite que será usado neste build. */
export function provedorSatelite() {
  if (mapTilesConfigurado()) return "google-map-tiles";
  if (getSatelliteProvider().configured) return "estilo-licenciado";
  return "indisponivel";
}

/**
 * Primeiro layer de negócio (para inserir o raster logo abaixo dele).
 * @param {{ getStyle: () => any }} map
 * @param {readonly string[]} [prefixos]
 * @returns {string | undefined}
 */
export function primeiraCamadaDeNegocio(map, prefixos = PREFIXOS_FONTES_NEGOCIO) {
  const layers = map.getStyle?.()?.layers || [];
  for (const l of layers) {
    const src = typeof l.source === "string" ? l.source : "";
    if (l.id === SAT_LAYER_ID) continue;
    if (prefixos.some((p) => src.startsWith(p) || String(l.id).startsWith(p))) return l.id;
  }
  return undefined;
}

/**
 * @param {import('maplibre-gl').Map} map
 * @param {{
 *   onState?: (s: EstadoBasemap) => void,
 *   fetchImpl?: typeof fetch,
 *   reaplicarCamadas?: () => void,
 *   prefixosNegocio?: readonly string[],
 * }} [opts]
 */
export function createBasemapController(map, opts = {}) {
  const fetchImpl = opts.fetchImpl || (typeof fetch === "function" ? fetch.bind(globalThis) : undefined);
  let disposed = false;
  let pedido = 0;
  /** @type {{ session: string, key: string } | null} */
  let sessaoAtiva = null;
  /** @type {AbortController | null} */
  let viewportAbort = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let viewportTimer = null;
  let falhaTileTratada = false;

  /** @type {EstadoBasemap} */
  let estado = {
    basemapId: BASEMAP_IDS.RUAS,
    status: "pronto",
    provedor: "openfreemap",
    mensagem: null,
    atribuicao: null,
  };

  const emit = (patch) => {
    estado = { ...estado, ...patch };
    if (!disposed) opts.onState?.(estado);
  };

  const setSatVisivel = (visivel) => {
    try {
      if (map.getLayer(SAT_LAYER_ID)) map.setLayoutProperty(SAT_LAYER_ID, "visibility", visivel ? "visible" : "none");
    } catch {
      /* ignore */
    }
  };

  const atualizarAtribuicao = () => {
    if (disposed || !sessaoAtiva || estado.basemapId !== BASEMAP_IDS.SATELITE || !fetchImpl) return;
    if (viewportTimer) clearTimeout(viewportTimer);
    viewportTimer = setTimeout(async () => {
      viewportTimer = null;
      if (disposed || !sessaoAtiva) return;
      viewportAbort?.abort();
      const ctrl = typeof AbortController === "function" ? new AbortController() : null;
      viewportAbort = ctrl;
      try {
        const b = map.getBounds();
        const url = urlViewportMapTiles(sessaoAtiva, {
          zoom: map.getZoom(),
          north: b.getNorth(),
          south: b.getSouth(),
          east: b.getEast(),
          west: b.getWest(),
        });
        const r = await fetchImpl(url, ctrl ? { signal: ctrl.signal } : undefined);
        if (!r || !r.ok) return;
        const j = await r.json();
        if (disposed || ctrl?.signal.aborted || estado.basemapId !== BASEMAP_IDS.SATELITE) return;
        emit({ atribuicao: textoAtribuicaoGoogle(j?.copyright) });
      } catch {
        /* atribuição mínima "Google Maps" já exibida */
      }
    }, 400);
  };

  const falhar = (mensagem) => {
    setSatVisivel(false);
    sessaoAtiva = null;
    emit({ basemapId: BASEMAP_IDS.RUAS, status: "erro", provedor: provedorSatelite(), mensagem, atribuicao: null });
  };

  const onMapError = (e) => {
    if (disposed || e?.sourceId !== SAT_SOURCE_ID) return;
    const status = Number(e?.error?.status) || null;
    if (status === 401 || status === 403 || status === 429) {
      if (falhaTileTratada) return;
      falhaTileTratada = true;
      descartarSessoesMapTiles();
      falhar(classificarFalhaMapTiles(status).mensagem);
    }
  };

  map.on("moveend", atualizarAtribuicao);
  map.on("error", onMapError);

  const ativarSateliteGoogle = async (forcar) => {
    const meu = ++pedido;
    emit({ status: "carregando", provedor: "google-map-tiles", mensagem: null });
    const s = await obterSessaoMapTiles({ fetchImpl, forcar });
    if (disposed || meu !== pedido) return;
    if (!s.ok) {
      falhar(s.mensagem);
      return;
    }
    try {
      const src = map.getSource(SAT_SOURCE_ID);
      const novaFonte = /** @type {any} */ (fonteRasterMapTiles({ session: String(s.session), key: String(s.key), tileSize: s.tileSize }));
      const mesmaSessao = sessaoAtiva && sessaoAtiva.session === s.session;
      if (src && !mesmaSessao) {
        if (map.getLayer(SAT_LAYER_ID)) map.removeLayer(SAT_LAYER_ID);
        map.removeSource(SAT_SOURCE_ID);
      }
      if (!map.getSource(SAT_SOURCE_ID)) map.addSource(SAT_SOURCE_ID, novaFonte);
      if (!map.getLayer(SAT_LAYER_ID)) {
        map.addLayer(
          { id: SAT_LAYER_ID, type: "raster", source: SAT_SOURCE_ID, paint: { "raster-fade-duration": 0 } },
          primeiraCamadaDeNegocio(map, opts.prefixosNegocio)
        );
      }
      sessaoAtiva = { session: String(s.session), key: String(s.key) };
      falhaTileTratada = false;
      setSatVisivel(true);
      emit({ basemapId: BASEMAP_IDS.SATELITE, status: "pronto", mensagem: null, atribuicao: ATRIBUICAO_GOOGLE });
      atualizarAtribuicao();
    } catch (err) {
      falhar(err instanceof Error && err.message ? `Satélite indisponível: ${err.message}` : "Satélite indisponível.");
    }
  };

  const ativarEstiloLicenciado = () => {
    const meu = ++pedido;
    const sat = getSatelliteProvider();
    emit({ status: "carregando", provedor: "estilo-licenciado", mensagem: null });
    const onStyle = () => {
      if (disposed || meu !== pedido) return;
      try {
        opts.reaplicarCamadas?.();
      } catch {
        /* superfície reporta */
      }
      emit({ basemapId: BASEMAP_IDS.SATELITE, status: "pronto", atribuicao: sat.attribution });
    };
    map.once("style.load", onStyle);
    try {
      map.setStyle(/** @type {string} */ (sat.styleUrl));
    } catch {
      falhar("Satélite indisponível: estilo licenciado não carregou.");
    }
  };

  /**
   * @param {string} id
   * @param {{ forcar?: boolean }} [o]
   */
  const setBasemap = (id, o = {}) => {
    if (disposed) return;
    if (id === BASEMAP_IDS.SATELITE) {
      const prov = provedorSatelite();
      if (prov === "google-map-tiles") {
        void ativarSateliteGoogle(!!o.forcar);
        return;
      }
      if (prov === "estilo-licenciado") {
        ativarEstiloLicenciado();
        return;
      }
      emit({
        basemapId: BASEMAP_IDS.RUAS,
        status: "erro",
        provedor: "indisponivel",
        mensagem: "Satélite não configurado: defina VITE_GOOGLE_MAPS_API_KEY com acesso à Map Tiles API.",
        atribuicao: null,
      });
      return;
    }
    pedido++;
    if (estado.provedor === "estilo-licenciado" && estado.basemapId === BASEMAP_IDS.SATELITE) {
      const meu = pedido;
      map.once("style.load", () => {
        if (disposed || meu !== pedido) return;
        try {
          opts.reaplicarCamadas?.();
        } catch {
          /* ignore */
        }
      });
      try {
        map.setStyle(/** @type {string} */ (PROVIDER_RUAS.styleUrl));
      } catch {
        /* ignore */
      }
    }
    setSatVisivel(false);
    emit({ basemapId: BASEMAP_IDS.RUAS, status: "pronto", provedor: "openfreemap", mensagem: null, atribuicao: null });
  };

  return {
    setBasemap,
    retry: () => setBasemap(BASEMAP_IDS.SATELITE, { forcar: true }),
    getState: () => estado,
    dispose: () => {
      disposed = true;
      pedido++;
      if (viewportTimer) clearTimeout(viewportTimer);
      viewportAbort?.abort();
      try {
        map.off("moveend", atualizarAtribuicao);
        map.off("error", onMapError);
      } catch {
        /* ignore */
      }
    },
  };
}
