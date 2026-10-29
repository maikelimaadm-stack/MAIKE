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
 *   timeoutProvaMs?: number,
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
  /** Prova de raster: só "pronto" depois de tile real carregado (R1-01). */
  let prova = { pedido: 0, ok: 0, erros: 0, errosSeguidos: 0, renovou: false };
  /** @type {ReturnType<typeof setTimeout> | null} */
  let provaTimer = null;
  let viewportSeq = 0;
  const limparProvaTimer = () => {
    if (provaTimer) clearTimeout(provaTimer);
    provaTimer = null;
  };

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
        const seq = ++viewportSeq;
        const sessao = sessaoAtiva.session;
        const r = await fetchImpl(url, ctrl ? { signal: ctrl.signal } : undefined);
        if (!r || !r.ok) return;
        const j = await r.json();
        // Resposta atrasada (outra câmera/sessão/base) não sobrescreve a mais recente.
        if (disposed || ctrl?.signal.aborted || seq !== viewportSeq) return;
        if (estado.basemapId !== BASEMAP_IDS.SATELITE || sessaoAtiva?.session !== sessao) return;
        emit({ atribuicao: textoAtribuicaoGoogle(j?.copyright) });
      } catch {
        /* atribuição mínima "Google Maps" já exibida */
      }
    }, 400);
  };

  const falhar = (mensagem) => {
    limparProvaTimer();
    prova = { ...prova, pedido: -1 };
    viewportAbort?.abort();
    setSatVisivel(false);
    sessaoAtiva = null;
    emit({ basemapId: BASEMAP_IDS.RUAS, status: "erro", provedor: provedorSatelite(), mensagem, atribuicao: null });
  };

  /**
   * Erro pertence ao satélite? MapLibre nem sempre preenche `sourceId`
   * (falha de rede/CORS de tile chega só com a URL na mensagem).
   */
  const ehErroDoSatelite = (e) => {
    if (e?.sourceId === SAT_SOURCE_ID || e?.source?.id === SAT_SOURCE_ID) return true;
    if (e?.sourceId) return false;
    const txt = `${e?.error?.url || ""} ${e?.error?.message || ""} ${e?.message || ""}`;
    return txt.includes("tile.googleapis.com");
  };

  const statusDoErro = (e) => {
    const n = Number(e?.error?.status ?? e?.status);
    if (Number.isFinite(n) && n > 0) return n;
    const m = /\b(4\d\d|5\d\d)\b/.exec(String(e?.error?.message || e?.message || ""));
    return m ? Number(m[1]) : null;
  };

  const onMapError = (e) => {
    if (disposed || !ehErroDoSatelite(e)) return;
    if (prova.pedido !== pedido || prova.pedido < 0) return;
    const status = statusDoErro(e);
    prova.erros += 1;
    prova.errosSeguidos += 1;
    // 401/403: sessão expirada/recusada → renova UMA vez; se repetir, falha.
    if ((status === 401 || status === 403) && !prova.renovou && sessaoAtiva) {
      prova.renovou = true;
      descartarSessoesMapTiles();
      void ativarSateliteGoogle(true, { renovacao: true });
      return;
    }
    if (status === 401 || status === 403 || status === 429) {
      falhar(classificarFalhaMapTiles(status).mensagem);
      return;
    }
    // 404/5xx/rede/CORS: antes de qualquer tile ok, 3 erros bastam; depois,
    // só uma sequência longa sem sucesso (falha isolada/retry não derruba).
    const limite = prova.ok === 0 ? 3 : 8;
    if (prova.errosSeguidos >= limite) falhar(classificarFalhaMapTiles(status).mensagem);
  };

  const onSourceData = (e) => {
    if (disposed || e?.sourceId !== SAT_SOURCE_ID || !e?.tile) return;
    if (prova.pedido !== pedido || prova.pedido < 0) return;
    prova.ok += 1;
    prova.errosSeguidos = 0;
    if (estado.status === "carregando") {
      limparProvaTimer();
      emit({ basemapId: BASEMAP_IDS.SATELITE, status: "pronto", mensagem: null, atribuicao: estado.atribuicao || ATRIBUICAO_GOOGLE });
      atualizarAtribuicao();
    }
  };

  map.on("moveend", atualizarAtribuicao);
  map.on("error", onMapError);
  map.on("sourcedata", onSourceData);

  const ativarSateliteGoogle = async (forcar, extra = {}) => {
    const meu = ++pedido;
    limparProvaTimer();
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
      prova = { pedido: meu, ok: 0, erros: 0, errosSeguidos: 0, renovou: !!extra.renovacao };
      setSatVisivel(true);
      // Mesma sessão já com tiles em cache do MapLibre: a fonte pode já estar carregada.
      if (mesmaSessao && map.isSourceLoaded?.(SAT_SOURCE_ID)) {
        prova.ok = 1;
        emit({ basemapId: BASEMAP_IDS.SATELITE, status: "pronto", mensagem: null, atribuicao: estado.atribuicao || ATRIBUICAO_GOOGLE });
        atualizarAtribuicao();
        return;
      }
      provaTimer = setTimeout(() => {
        provaTimer = null;
        if (disposed || meu !== pedido || prova.ok > 0) return;
        falhar("Satélite indisponível: as imagens não chegaram a tempo (rede ou provedor).");
      }, opts.timeoutProvaMs ?? 15000);
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
    limparProvaTimer();
    prova = { ...prova, pedido: -1 };
    viewportAbort?.abort();
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
      limparProvaTimer();
      viewportAbort?.abort();
      try {
        map.off("moveend", atualizarAtribuicao);
        map.off("error", onMapError);
        map.off("sourcedata", onSourceData);
      } catch {
        /* ignore */
      }
    },
  };
}
