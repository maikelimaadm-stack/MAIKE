import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { MapPin, Trash2, Check, X, Navigation, Crosshair, Satellite, Footprints, Pause, Play, Square } from "lucide-react";
import { toast } from "sonner";
import {
  areaHectares,
  comprimentoMetros,
  formatDistanciaPt,
  formatHectaresPt,
  isValidLatLng,
  validateLineForSave,
  validatePolygonForSave,
} from "@/lib/geografia";
import { BASEMAP_IDS, CENTRO_PADRAO } from "@/lib/maplibre/basemap.js";
import {
  buildDesenhoCollection,
  buildVerticesCollection,
} from "@/lib/maplibre/geojsonBuilders.js";
import {
  createEditorMap,
  ensureBusinessLayers,
  maplibregl,
  setSourceData,
} from "@/lib/maplibre/lifecycle.js";
import { useQuery } from "@tanstack/react-query";
import { listarAreasAtivas, listarLinhasAtivas } from "@/services/mapaService";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import { SOURCE_IDS } from "@/lib/maplibre/estiloAreas.js";
import { buildAreasCollection, buildLinhasCollection } from "@/lib/maplibre/geojsonBuilders.js";
import { PREFIXOS_FONTES_NEGOCIO } from "@/lib/maplibre/basemapController.js";
import useBasemap from "./useBasemap";
import {
  GPS_SOURCE_IDS,
  PRECISAO_AVISO_METROS,
  buildAccuracyCircleCollection,
  buildUserPointCollection,
  checarSuporteGeolocation,
  clearGeolocationWatch,
  ensureGpsCaptureLayers,
  mensagemErroGeolocation,
  parseGeolocationPosition,
  precisaoRuim,
} from "@/lib/maplibre/gpsCapture.js";
import { mensagemFalhaMapa } from "@/lib/maplibre/falhaWebGL";
import { PASSO_PADRAO_M, PRECISAO_MAXIMA_M, deveGravar, simplificarTrilha } from "@/lib/maplibre/gravacaoCaminhando.js";

const COR_AREA = "#10b981";
const COR_LINHA = "#f59e0b";

/**
 * @param {{ lat: number, lng: number, accuracy?: number|null, timestamp?: number|null }[]} pontos
 * @param {'area'|'linha'} tipo
 * @returns {GeoJSON.FeatureCollection}
 */
function buildGpsDesenhoCollection(pontos, tipo) {
  const base = buildDesenhoCollection(pontos, tipo === "linha" ? "linha" : "area");
  const cor = tipo === "linha" ? COR_LINHA : COR_AREA;
  return {
    type: "FeatureCollection",
    features: base.features.map((f) => ({
      ...f,
      properties: { ...(f.properties || {}), cor },
    })),
  };
}

/**
 * @param {{ lat: number, lng: number }[]} pontos
 * @param {'area'|'linha'} tipo
 * @returns {GeoJSON.FeatureCollection}
 */
function buildGpsVerticesCollection(pontos, tipo) {
  const base = buildVerticesCollection(pontos);
  const cor = tipo === "linha" ? COR_LINHA : COR_AREA;
  return {
    type: "FeatureCollection",
    features: base.features.map((f, i) => ({
      ...f,
      properties: { ...(f.properties || {}), cor, label: String(i + 1) },
    })),
  };
}

/**
 * Marcadores HTML numerados e arrastáveis (lifecycle explícito).
 * @param {import('maplibre-gl').Map} map
 * @param {{ lat: number, lng: number, accuracy?: number|null, timestamp?: number|null }[]} pontos
 * @param {'area'|'linha'} tipo
 * @param {(index: number, next: { lat: number, lng: number, accuracy?: number|null, timestamp?: number|null }) => void} onDragEnd
 * @returns {import('maplibre-gl').Marker[]}
 */
function createVertexMarkers(map, pontos, tipo, onDragEnd) {
  const cor = tipo === "linha" ? COR_LINHA : COR_AREA;
  /** @type {import('maplibre-gl').Marker[]} */
  const markers = [];
  pontos.forEach((ponto, idx) => {
    if (!isValidLatLng(ponto.lat, ponto.lng)) return;
    const el = document.createElement("button");
    el.type = "button";
    el.className = "m2a-gps-vertex";
    el.textContent = String(idx + 1);
    el.setAttribute("aria-label", `Vértice ${idx + 1}`);
    el.style.cssText = [
      "width:28px",
      "height:28px",
      "border-radius:9999px",
      `background:${cor}`,
      "color:#fff",
      "font-size:12px",
      "font-weight:700",
      "border:3px solid #fff",
      "box-shadow:0 1px 4px rgba(0,0,0,.35)",
      "cursor:grab",
      "padding:0",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "touch-action:none",
    ].join(";");

    const marker = new maplibregl.Marker({ element: el, draggable: true, anchor: "center" })
      .setLngLat([ponto.lng, ponto.lat])
      .addTo(map);

    marker.on("dragend", () => {
      const ll = marker.getLngLat();
      if (!isValidLatLng(ll.lat, ll.lng)) return;
      onDragEnd(idx, {
        lat: ll.lat,
        lng: ll.lng,
        accuracy: ponto.accuracy ?? null,
        timestamp: ponto.timestamp ?? null,
      });
    });

    markers.push(marker);
  });
  return markers;
}

/**
 * Captura GPS de área/linha — MapLibre M2-A (sem google.maps.*).
 * Contrato público: onSalvar(pontos[{lat,lng,accuracy?,timestamp?}]), onCancelar(), tipo.
 *
 * @param {{
 *   tipo?: 'area' | 'linha',
 *   onSalvar: (pontos: { lat: number, lng: number, accuracy?: number, timestamp?: number }[]) => void,
 *   onCancelar: () => void,
 * }} props
 */
export default function CapturaGPSPoligono({ tipo = "area", onSalvar, onCancelar }) {
  /** @type {'area' | 'linha'} */
  const modo = tipo === "linha" ? "linha" : "area";

  const [pontos, setPontos] = useState(
    /** @type {{ lat: number, lng: number, accuracy?: number|null, timestamp?: number|null }[]} */ ([])
  );
  const [localizacaoAtual, setLocalizacaoAtual] = useState(
    /** @type {{ lat: number, lng: number, accuracy: number|null, timestamp: number, stale?: boolean } | null} */ (null)
  );
  const [gpsStatus, setGpsStatus] = useState(
    /** @type {'iniciando'|'ativo'|'erro'|'inativo'} */ ("iniciando")
  );
  const [gpsErro, setGpsErro] = useState(/** @type {string | null} */ (null));
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(/** @type {string | null} */ (null));
  const [mapEpoch, setMapEpoch] = useState(0);
  const [seguirGps, setSeguirGps] = useState(true);
  // D-PROD-363: caminhar gravando o contorno sozinho (cada leitura boa a ≥ 5 m da última vira ponto).
  const [gravacao, setGravacao] = useState(/** @type {'parada'|'gravando'|'pausada'} */ ("parada"));

  const empresaSelecionadaId = useEmpresaSelecionadaId();
  const { data: areas = [] } = useQuery({
    queryKey: ["areas", empresaSelecionadaId],
    queryFn: async () => listarAreasAtivas(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
  });
  const { data: linhas = [] } = useQuery({
    queryKey: ["linhas", empresaSelecionadaId],
    queryFn: async () => listarLinhasAtivas(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
  });
  const areasRef = useRef(areas);
  areasRef.current = areas;
  const linhasRef = useRef(linhas);
  linhasRef.current = linhas;
  const localizacaoRef = useRef(localizacaoAtual);
  localizacaoRef.current = localizacaoAtual;

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const disposeRef = useRef(null);
  const watchIdRef = useRef(null);
  const mountedRef = useRef(true);
  const followRef = useRef(true);
  const pontosRef = useRef([]);
  const vertexMarkersRef = useRef([]);
  const salvandoRef = useRef(false);
  const userInteractedRef = useRef(false);

  useEffect(() => {
    pontosRef.current = pontos;
  }, [pontos]);

  useEffect(() => {
    followRef.current = seguirGps;
  }, [seguirGps]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const limparVertexMarkers = useCallback(() => {
    vertexMarkersRef.current.forEach((m) => {
      try {
        m.remove();
      } catch {
        /* best-effort */
      }
    });
    vertexMarkersRef.current = [];
  }, []);

  const pararRastreamento = useCallback(() => {
    clearGeolocationWatch(watchIdRef.current);
    watchIdRef.current = null;
    if (mountedRef.current) {
      setGpsStatus((prev) => (prev === "erro" ? "erro" : "inativo"));
    }
  }, []);

  const iniciarRastreamento = useCallback(() => {
    const suporte = checarSuporteGeolocation();
    if (!suporte.ok) {
      setGpsStatus("erro");
      setGpsErro(suporte.reason || "GPS indisponível");
      toast.error(suporte.reason || "GPS indisponível");
      return;
    }

    // Uma assinatura por ativação — cancela anterior (inclui id 0).
    clearGeolocationWatch(watchIdRef.current);
    watchIdRef.current = null;
    setGpsErro(null);
    setGpsStatus("iniciando");

    const id = navigator.geolocation.watchPosition(
      (position) => {
        if (!mountedRef.current) return;
        const parsed = parseGeolocationPosition(position);
        if (!parsed) {
          setGpsErro("Leitura GPS inválida (coordenadas não finitas).");
          return;
        }
        setLocalizacaoAtual(parsed);
        setGpsStatus("ativo");
        setGpsErro(parsed.stale ? "Última leitura desatualizada — aguarde atualização." : null);
      },
      (error) => {
        if (!mountedRef.current) return;
        const msg = mensagemErroGeolocation(error);
        setGpsStatus("erro");
        setGpsErro(msg);
        toast.error(msg);
        // Sem auto-restart após PERMISSION_DENIED.
        if (error && error.code === 1) {
          clearGeolocationWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10_000,
      }
    );
    watchIdRef.current = id;
  }, []);

  // GPS independente de tiles — inicia na montagem.
  useEffect(() => {
    iniciarRastreamento();
    return () => {
      pararRastreamento();
    };
  }, [iniciarRastreamento, pararRastreamento]);

  // Mapa MapLibre — uma instância por epoch (retry).
  useEffect(() => {
    if (!mapRef.current) return undefined;
    let cancelled = false;
    setMapReady(false);
    setMapError(null);

    let created;
    try {
      created = createEditorMap(mapRef.current, {
        basemapId: BASEMAP_IDS.RUAS,
        center: CENTRO_PADRAO,
        zoom: 18,
      });
    } catch (err) {
      if (mountedRef.current) {
        setMapError(mensagemFalhaMapa(err, "Falha ao criar o mapa."));
      }
      return undefined;
    }

    mapInstanceRef.current = created.map;
    disposeRef.current = created.dispose;
    const map = created.map;
    userInteractedRef.current = false;

    const onLoad = () => {
      if (cancelled || created.getCancelled() || !mountedRef.current) return;
      try {
        // D-PROD-363: os pastos e linhas já cadastrados por baixo da trilha (antes a tela só mostrava o GPS).
        ensureBusinessLayers(map);
        ensureGpsCaptureLayers(map);
        setMapReady(true);
      } catch (err) {
        if (mountedRef.current) {
          setMapError(err?.message || "Falha ao preparar camadas do GPS");
        }
      }
    };

    const onError = (e) => {
      if (cancelled || !mountedRef.current) return;
      // D-PROD-294: sem internet o mapa abre com o fundo local; não é falha.
      if (created?.erroContornado?.()) return;
      const msg = e?.error?.message || e?.message || "Erro de estilo/tiles";
      if (/style|tile|fetch|network|xhr|401|403|404/i.test(String(msg))) {
        setMapError("Falha ao carregar o estilo ou tiles do mapa. GPS continua ativo — tente novamente.");
      }
    };

    const markUserPan = () => {
      if (!userInteractedRef.current) return;
      if (followRef.current) {
        setSeguirGps(false);
      }
    };

    const onDragStart = () => {
      userInteractedRef.current = true;
      markUserPan();
    };
    const onZoomStart = () => {
      userInteractedRef.current = true;
      markUserPan();
    };

    map.on("load", onLoad);
    map.on("error", onError);
    map.on("dragstart", onDragStart);
    map.on("zoomstart", onZoomStart);

    return () => {
      cancelled = true;
      map.off("load", onLoad);
      map.off("error", onError);
      map.off("dragstart", onDragStart);
      map.off("zoomstart", onZoomStart);
      limparVertexMarkers();
      disposeRef.current?.();
      disposeRef.current = null;
      mapInstanceRef.current = null;
      if (mountedRef.current) setMapReady(false);
    };
  }, [mapEpoch, limparVertexMarkers]);

  // Posição do usuário + círculo de precisão + follow opcional.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady || !localizacaoAtual) return;

    setSourceData(map, GPS_SOURCE_IDS.USER, buildUserPointCollection(localizacaoAtual));
    setSourceData(
      map,
      GPS_SOURCE_IDS.ACCURACY,
      buildAccuracyCircleCollection(localizacaoAtual, localizacaoAtual.accuracy)
    );

    if (seguirGps) {
      try {
        map.easeTo({
          center: [localizacaoAtual.lng, localizacaoAtual.lat],
          duration: 400,
        });
      } catch {
        map.setCenter([localizacaoAtual.lng, localizacaoAtual.lat]);
      }
    }
  }, [localizacaoAtual, mapReady, seguirGps]);

  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    setSourceData(map, SOURCE_IDS.AREAS, buildAreasCollection(areas));
    setSourceData(map, SOURCE_IDS.LINHAS, buildLinhasCollection(linhas));
  }, [areas, linhas, mapReady]);

  // D-PROD-363: gravando, cada leitura boa do GPS longe o bastante da última vira ponto da trilha.
  useEffect(() => {
    if (gravacao !== "gravando" || !localizacaoAtual) return;
    setPontos((prev) => {
      if (!deveGravar(prev[prev.length - 1], localizacaoAtual)) return prev;
      return [...prev, { lat: localizacaoAtual.lat, lng: localizacaoAtual.lng, accuracy: localizacaoAtual.accuracy, timestamp: localizacaoAtual.timestamp }];
    });
  }, [localizacaoAtual, gravacao]);

  // Gravando, a tela não apaga (com a tela apagada o celular para o GPS do app).
  useEffect(() => {
    if (gravacao !== "gravando" || typeof navigator === "undefined" || !navigator.wakeLock?.request) return undefined;
    let trava = null;
    let solto = false;
    navigator.wakeLock.request("screen").then((t) => { if (solto) t.release?.(); else trava = t; }).catch(() => {});
    return () => { solto = true; trava?.release?.().catch?.(() => {}); };
  }, [gravacao]);

  // Polígono/linha + vértices (GeoJSON) + marcadores numerados arrastáveis.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;

    setSourceData(map, GPS_SOURCE_IDS.DESENHO, buildGpsDesenhoCollection(pontos, modo));
    setSourceData(map, GPS_SOURCE_IDS.VERTICES, buildGpsVerticesCollection(pontos, modo));

    limparVertexMarkers();
    vertexMarkersRef.current = createVertexMarkers(map, pontos, modo, (index, next) => {
      setPontos((prev) => {
        if (index < 0 || index >= prev.length) return prev;
        const copy = [...prev];
        copy[index] = next;
        return copy;
      });
      toast.success(`Ponto ${index + 1} reposicionado`);
    });
  }, [pontos, modo, mapReady, limparVertexMarkers]);

  const retryMap = () => {
    limparVertexMarkers();
    disposeRef.current?.();
    disposeRef.current = null;
    mapInstanceRef.current = null;
    setMapReady(false);
    setMapError(null);
    setMapEpoch((n) => n + 1);
  };

  /** Refaz as camadas da captura (depois de um fundo que troca o estilo inteiro). */
  const reaplicarCamadas = () => {
    const map = mapInstanceRef.current;
    if (!map) return;
    ensureBusinessLayers(map);
    ensureGpsCaptureLayers(map);
    setSourceData(map, SOURCE_IDS.AREAS, buildAreasCollection(areasRef.current));
    setSourceData(map, SOURCE_IDS.LINHAS, buildLinhasCollection(linhasRef.current));
    setSourceData(map, GPS_SOURCE_IDS.USER, buildUserPointCollection(localizacaoRef.current));
    setSourceData(map, GPS_SOURCE_IDS.ACCURACY, buildAccuracyCircleCollection(localizacaoRef.current, localizacaoRef.current?.accuracy));
    setSourceData(map, GPS_SOURCE_IDS.DESENHO, buildGpsDesenhoCollection(pontosRef.current, modo));
    setSourceData(map, GPS_SOURCE_IDS.VERTICES, buildGpsVerticesCollection(pontosRef.current, modo));
  };
  // D-PROD-363: o mesmo controle de fundo do editor — abre no satélite (guardado para usar sem internet no app,
  // D-PROD-294). Antes esta tela abria nas ruas e o satélite usava o provedor antigo ("Satélite não configurado").
  const basemap = useBasemap(mapReady ? mapInstanceRef.current : null, {
    inicial: BASEMAP_IDS.SATELITE,
    reaplicarCamadas,
    prefixosNegocio: [...PREFIXOS_FONTES_NEGOCIO, "m2a-"],
  });
  const basemapId = basemap.basemapId;
  const satMsg = basemap.status === "erro" ? basemap.mensagem : null;
  const trocarBasemap = (id) => basemap.setBasemap(id);

  const centralizarEmMim = () => {
    const map = mapInstanceRef.current;
    if (!localizacaoAtual) {
      toast.error("Aguarde capturar localização GPS");
      return;
    }
    setSeguirGps(true);
    userInteractedRef.current = false;
    if (map) {
      map.easeTo({
        center: [localizacaoAtual.lng, localizacaoAtual.lat],
        zoom: Math.max(map.getZoom(), 17),
        duration: 500,
      });
    }
  };

  const adicionarPonto = () => {
    if (!localizacaoAtual) {
      toast.error("Aguarde capturar localização GPS");
      return;
    }
    if (!isValidLatLng(localizacaoAtual.lat, localizacaoAtual.lng)) {
      toast.error("Coordenada GPS inválida");
      return;
    }

    const novoPonto = {
      lat: localizacaoAtual.lat,
      lng: localizacaoAtual.lng,
      accuracy: localizacaoAtual.accuracy,
      timestamp: localizacaoAtual.timestamp,
      // D-PROD-363: canto marcado à mão nunca sai quando a trilha gravada é enxugada.
      fixo: true,
    };

    if (precisaoRuim(localizacaoAtual.accuracy)) {
      toast.message(
        `Precisão aproximada ~${Math.round(localizacaoAtual.accuracy)} m (acima de ${PRECISAO_AVISO_METROS} m). Ponto marcado mesmo assim.`
      );
    }

    setPontos((prev) => [...prev, novoPonto]);
    toast.success(`Ponto ${pontos.length + 1} marcado`);
  };

  const iniciarGravacao = () => {
    if (gpsStatus === "erro") {
      toast.error("Ligue o GPS para gravar caminhando");
      return;
    }
    setGravacao("gravando");
    setSeguirGps(true);
    userInteractedRef.current = false;
    toast.success(`Gravando: ande pela divisa. Um ponto a cada ${PASSO_PADRAO_M} m.`, { duration: 2500 });
  };

  const terminarGravacao = () => {
    setGravacao("parada");
    setPontos((prev) => {
      const enxuta = simplificarTrilha(prev);
      if (enxuta.length !== prev.length) toast.success(`Gravação terminada: ${enxuta.length} pontos (de ${prev.length})`, { duration: 2000 });
      return enxuta;
    });
  };

  const removerUltimoPonto = () => {
    setPontos((prev) => {
      if (prev.length === 0) return prev;
      toast.info("Último ponto removido");
      return prev.slice(0, -1);
    });
  };

  const medidaTexto = () => {
    if (modo === "area" && pontos.length >= 3) {
      return { valor: formatHectaresPt(areaHectares(pontos)), unidade: "ha" };
    }
    if (modo === "linha" && pontos.length >= 2) {
      return { valor: formatDistanciaPt(comprimentoMetros(pontos)), unidade: "" };
    }
    return null;
  };

  const handleSalvar = () => {
    if (salvandoRef.current) return;
    // D-PROD-363: confirmar no meio da gravação termina a gravação (e enxuga a trilha) antes de salvar.
    const pontos = gravacao === "parada" ? pontosRef.current : simplificarTrilha(pontosRef.current);
    if (gravacao !== "parada") setGravacao("parada");
    const minimos = modo === "area" ? 3 : 2;
    if (pontos.length < minimos) {
      toast.error(`Marque pelo menos ${minimos} pontos`);
      return;
    }

    const validation =
      modo === "area" ? validatePolygonForSave(pontos) : validateLineForSave(pontos);
    if (!validation.ok) {
      toast.error(validation.reason || "Geometria inválida");
      return;
    }

    salvandoRef.current = true;
    pararRastreamento();
    limparVertexMarkers();
    // Payload: objetos {lat,lng,accuracy?,timestamp?} — formulários usam toPersistedCoords.
    const payload = pontos.map((p) => ({
      lat: p.lat,
      lng: p.lng,
      ...(p.accuracy != null ? { accuracy: p.accuracy } : {}),
      ...(p.timestamp != null ? { timestamp: p.timestamp } : {}),
    }));
    onSalvar(payload);
  };

  const handleCancelar = () => {
    pararRastreamento();
    limparVertexMarkers();
    onCancelar();
  };

  const medida = medidaTexto();
  const gpsAtivo = gpsStatus === "ativo";
  const statusLabel =
    gpsStatus === "ativo"
      ? "GPS ativo"
      : gpsStatus === "iniciando"
        ? "Obtendo GPS…"
        : gpsStatus === "erro"
          ? "GPS com erro"
          : "GPS inativo";

  const tela = (
    <div className="fixed inset-0 bg-slate-900 z-50 flex flex-col" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} data-mk-captura-gps="">
      <div className="bg-white border-b border-slate-200 p-3 shadow-lg" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900 truncate">
              {modo === "area" ? "Captura de Área" : "Captura de Linha"}
            </h3>
            <p className="text-xs text-slate-600 mt-0.5">
              {gravacao === "gravando"
                ? `Gravando: ande pela divisa (um ponto a cada ${PASSO_PADRAO_M} m)`
                : gravacao === "pausada"
                  ? "Gravação pausada"
                  : "Grave caminhando ou marque cada canto"}
            </p>
          </div>
          <Button onClick={handleCancelar} variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="Cancelar">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="flex-1 relative min-h-0">
        <div ref={mapRef} className="w-full h-full" />

        {!mapReady && !mapError && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white px-6 py-4 rounded-lg shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="animate-spin w-6 h-6 border-4 border-emerald-600 border-t-transparent rounded-full" />
              <span className="font-semibold text-slate-700">Carregando mapa…</span>
            </div>
          </div>
        )}

        {mapError && (
          <div className="absolute inset-x-4 top-1/3 bg-white rounded-lg shadow-2xl p-4 space-y-3 z-10">
            <p className="text-sm font-semibold text-slate-900">Mapa indisponível</p>
            <p className="text-xs text-slate-600">{mapError}</p>
            <p className="text-xs text-slate-500">
              O rastreamento GPS não depende dos tiles — você ainda pode marcar pontos se houver localização.
            </p>
            <Button onClick={retryMap} className="w-full h-10 bg-emerald-600 hover:bg-emerald-700">
              Tentar novamente
            </Button>
          </div>
        )}

        <div className="absolute top-3 left-3 right-3 flex flex-col gap-2 pointer-events-none">
          <div
            className={`pointer-events-auto px-3 py-2 rounded-lg shadow-lg text-white ${
              gpsAtivo ? "bg-emerald-600" : gpsStatus === "erro" ? "bg-amber-700" : "bg-slate-600"
            }`}
          >
            <div className="flex items-center gap-2">
              <Navigation className={`w-4 h-4 shrink-0 ${gpsAtivo ? "animate-pulse" : ""}`} />
              <div className="text-xs font-semibold min-w-0">
                <div>
                  {statusLabel}
                  {localizacaoAtual?.accuracy != null &&
                    Number.isFinite(localizacaoAtual.accuracy) &&
                    ` · Precisão ~${Math.round(localizacaoAtual.accuracy)} m`}
                </div>
                {(gpsErro || (localizacaoAtual && precisaoRuim(localizacaoAtual.accuracy))) && (
                  <div className="font-normal opacity-90 mt-0.5">
                    {gpsErro ||
                      `Aviso: precisão aproximada (dispositivo). Acima de ${PRECISAO_AVISO_METROS} m — marque com critério.`}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="pointer-events-auto bg-white/95 backdrop-blur rounded-lg shadow-xl px-3 py-2">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <div className="text-xl font-bold text-slate-900">{pontos.length}</div>
                <div className="text-xs text-slate-600">pontos</div>
              </div>
              {gravacao !== "parada" && (
                <>
                  <div className="h-4 w-px bg-slate-300" />
                  <div data-mk-gravando={gravacao} className={`flex items-center gap-1 text-xs font-bold ${gravacao === "gravando" ? "text-red-600" : "text-slate-500"}`}>
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${gravacao === "gravando" ? "bg-red-600 animate-pulse" : "bg-slate-400"}`} />
                    {gravacao === "gravando" ? "Gravando" : "Pausado"}
                  </div>
                </>
              )}
              {medida && (
                <>
                  <div className="h-4 w-px bg-slate-300" />
                  <div className="flex items-center gap-2">
                    <div className={`text-xl font-bold ${modo === "area" ? "text-emerald-600" : "text-amber-600"}`}>
                      {medida.valor}
                    </div>
                    {medida.unidade ? <div className="text-xs text-slate-600">{medida.unidade}</div> : null}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="absolute bottom-3 right-3 flex flex-col gap-2">
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className="h-10 w-10 shadow-lg bg-white"
            onClick={centralizarEmMim}
            aria-label="Centralizar em mim"
            title="Centralizar em mim"
          >
            <Crosshair className="w-4 h-4" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="secondary"
            className={`h-10 w-10 shadow-lg ${basemapId === BASEMAP_IDS.SATELITE ? "bg-emerald-100" : "bg-white"}`}
            onClick={() =>
              trocarBasemap(basemapId === BASEMAP_IDS.SATELITE ? BASEMAP_IDS.RUAS : BASEMAP_IDS.SATELITE)
            }
            aria-label="Alternar satélite"
            title={satMsg || "Alternar satélite"}
          >
            <Satellite className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="bg-white border-t border-slate-200 p-3 sm:p-4 space-y-2 shadow-2xl">
        {gpsStatus === "erro" && (
          <Button
            type="button"
            variant="outline"
            className="w-full h-10 text-sm"
            onClick={iniciarRastreamento}
          >
            Tentar GPS novamente
          </Button>
        )}

        {/* D-PROD-363: gravar caminhando (como no AgriWebb) ou marcar cada canto à mão; dá para misturar. */}
        {gravacao === "parada" ? (
          <div className="grid grid-cols-2 gap-2">
            <Button
              onClick={iniciarGravacao}
              disabled={gpsStatus === "erro"}
              className="h-12 sm:h-14 text-sm sm:text-base font-bold bg-red-600 hover:bg-red-700 disabled:opacity-50"
            >
              <Footprints className="w-5 h-5 mr-2" />
              {pontos.length ? "Continuar gravando" : "Gravar caminhando"}
            </Button>
            <Button
              onClick={adicionarPonto}
              disabled={!localizacaoAtual}
              className="h-12 sm:h-14 text-sm sm:text-base font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
            >
              <MapPin className="w-5 h-5 mr-2" />
              Marcar ponto {pontos.length + 1}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <Button
              onClick={() => setGravacao(gravacao === "gravando" ? "pausada" : "gravando")}
              variant="outline"
              className="h-12 sm:h-14 text-sm font-bold"
            >
              {gravacao === "gravando" ? <Pause className="w-5 h-5 mr-1" /> : <Play className="w-5 h-5 mr-1" />}
              {gravacao === "gravando" ? "Pausar" : "Continuar"}
            </Button>
            <Button
              onClick={adicionarPonto}
              disabled={!localizacaoAtual}
              title="Marca um canto exato agora (nunca sai quando a trilha é enxugada)"
              className="h-12 sm:h-14 text-sm font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
            >
              <MapPin className="w-5 h-5 mr-1" />
              Canto
            </Button>
            <Button
              onClick={terminarGravacao}
              className="h-12 sm:h-14 text-sm font-bold bg-slate-800 hover:bg-slate-900"
            >
              <Square className="w-4 h-4 mr-1" />
              Terminar
            </Button>
          </div>
        )}
        {gravacao === "gravando" && localizacaoAtual?.accuracy != null && localizacaoAtual.accuracy > PRECISAO_MAXIMA_M && (
          <p className="text-xs font-semibold text-amber-700">
            Sinal do GPS fraco (~{Math.round(localizacaoAtual.accuracy)} m): esperando melhorar para gravar.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button
            onClick={removerUltimoPonto}
            disabled={pontos.length === 0}
            variant="outline"
            className="h-11 sm:h-12 text-sm"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Remover último
          </Button>

          <Button
            onClick={handleSalvar}
            disabled={pontos.length < (modo === "area" ? 3 : 2) || salvandoRef.current}
            className="h-11 sm:h-12 text-sm bg-blue-600 hover:bg-blue-700"
          >
            <Check className="w-4 h-4 mr-2" />
            Confirmar ({pontos.length})
          </Button>
        </div>
      </div>
    </div>
  );
  // D-PROD-363: a captura abre de dentro do formulário lateral (uma janela com transform); no `body` ela sempre
  // ocupa a tela inteira, sem ser cortada pela janela.
  return typeof document !== "undefined" ? createPortal(tela, document.body) : tela;
}
