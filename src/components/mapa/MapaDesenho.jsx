import React, { useState, useRef, useEffect, useCallback } from "react";
import { listarAreasAtivas, listarPontosAtivos, listarLinhasAtivas, listarIconesDaEmpresa } from "@/services/mapaService";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { X, Target } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle } from
"@/components/ui/sheet";
import FormularioArea from "./FormularioArea";
import FormularioPonto from "./FormularioPonto";
import FormularioLinha from "./FormularioLinha";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import {
  parseVertices,
  parseVertex,
  inspectVertices,
  areaHectares,
  comprimentoMetros,
  formatHectaresPt,
  formatDistanciaPt,
  validatePolygonForSave,
  validateLineForSave,
} from "@/lib/geografia";
import { BASEMAP_IDS, CENTRO_PADRAO } from "@/lib/maplibre/basemap.js";
import {
  createEditorMap,
  ensureBusinessLayers,
  setSourceData,
  syncDivisaWidth,
  maplibregl,
} from "@/lib/maplibre/lifecycle.js";
import {
  MODOS,
  cursorDoModo,
  desenhoAlterado,
  modoInicial,
  podeAdicionarVertice,
  podeEditarVertices,
  podeMoverArea,
  removerVertice,
  segmentosDaRegua,
  transladarPontos,
  travarAngulo45,
} from "@/lib/maplibre/editorModos.js";
import { pontoRotuloSeguro, textoHectares } from "@/lib/maplibre/mapaGeralRender.js";
import useBasemap from "./useBasemap";
import BasemapAtribuicao from "./BasemapAtribuicao";
import { SOURCE_IDS, LAYER_IDS } from "@/lib/maplibre/estiloAreas.js";
import {
  buildAreasCollection,
  buildLinhasCollection,
  buildPontosCollection,
  buildDesenhoCollection,
  buildVerticesCollection,
  buildMidpointsCollection,
  buildGuiaCollection,
} from "@/lib/maplibre/geojsonBuilders.js";
import { findNearestSnap, isNearFirstVertex } from "@/lib/maplibre/snap.js";
import {
  commitDragTransaction,
  resolvePontoIconUrl,
  hitEditLayers,
} from "@/lib/maplibre/editorInteraction.js";

/** @returns {GeoJSON.FeatureCollection} */
const emptyFc = () => /** @type {GeoJSON.FeatureCollection} */ ({ type: "FeatureCollection", features: [] });

export default function MapaDesenho({ tipoDesenho, usarGPS = false, itemEditando, onSalvar, onCancelar }) {
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(null);
  const [mapEpoch, setMapEpoch] = useState(0);
  const [snappingEnabled, setSnappingEnabled] = useState(true);
  const [modo, setModo] = useState(() => /** @type {string} */ (modoInicial({ tipo: tipoDesenho, editando: !!itemEditando })));
  const [verticeSelecionado, setVerticeSelecionado] = useState(/** @type {number | null} */ (null));
  const [reguaAtiva, setReguaAtiva] = useState(false);
  const [confirmarSaida, setConfirmarSaida] = useState(false);

  const [currentPoints, setCurrentPoints] = useState([]);
  const [currentMarker, setCurrentMarker] = useState(null);
  const [drawingClosed, setDrawingClosed] = useState(false);
  const [undoLen, setUndoLen] = useState(0);
  const [redoLen, setRedoLen] = useState(0);

  const [showFormularioArea, setShowFormularioArea] = useState(usarGPS && tipoDesenho === "area");
  const [showFormularioPonto, setShowFormularioPonto] = useState(usarGPS && tipoDesenho === "ponto");
  const [showFormularioLinha, setShowFormularioLinha] = useState(usarGPS && tipoDesenho === "linha");

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const disposeRef = useRef(null);
  const labelsRef = useRef([]);
  const iconMarkersRef = useRef([]);
  const currentPointsRef = useRef([]);
  const currentMarkerRef = useRef(null);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const snappingRef = useRef(snappingEnabled);
  const drawingClosedRef = useRef(drawingClosed);
  const zoomingRef = useRef(false);
  const zoomTimerRef = useRef(null);
  const hasCenteredRef = useRef(false);
  const dragStateRef = useRef(null);
  const areasRef = useRef([]);
  const linhasRef = useRef([]);
  const pontosRef = useRef([]);
  const iconesConfigRef = useRef([]);
  const styleSwapCancelRef = useRef(null);
  const mountedRef = useRef(true);
  const empresaRef = useRef(null);
  const overlayEpochRef = useRef(0);
  const modoRef = useRef(modo);
  const originalPontosRef = useRef(/** @type {{ lat: number, lng: number }[]} */ ([]));
  const reguaMarkersRef = useRef(/** @type {any[]} */ ([]));

  const syncHistoryUi = useCallback(() => {
    setUndoLen(undoStackRef.current.length);
    setRedoLen(redoStackRef.current.length);
  }, []);

  useEffect(() => {
    currentPointsRef.current = currentPoints;
  }, [currentPoints]);
  useEffect(() => {
    currentMarkerRef.current = currentMarker;
  }, [currentMarker]);
  useEffect(() => {
    snappingRef.current = snappingEnabled;
  }, [snappingEnabled]);
  useEffect(() => {
    drawingClosedRef.current = drawingClosed;
  }, [drawingClosed]);
  useEffect(() => {
    modoRef.current = modo;
    if (modo !== MODOS.EDITAR) setVerticeSelecionado(null);
  }, [modo]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const queryClient = useQueryClient();
  const empresaSelecionadaId = useEmpresaSelecionadaId();

  const { data: areas = [] } = useQuery({
    queryKey: ["areas", empresaSelecionadaId],
    queryFn: async () => listarAreasAtivas(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
  });

  const { data: pontos = [] } = useQuery({
    queryKey: ["pontos", empresaSelecionadaId],
    queryFn: async () => listarPontosAtivos(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
  });

  const { data: linhas = [] } = useQuery({
    queryKey: ["linhas", empresaSelecionadaId],
    queryFn: async () => listarLinhasAtivas(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["configuracao-icones", empresaSelecionadaId],
    queryFn: async () => listarIconesDaEmpresa(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId,
  });

  useEffect(() => {
    areasRef.current = areas;
  }, [areas]);
  useEffect(() => {
    linhasRef.current = linhas;
  }, [linhas]);
  useEffect(() => {
    pontosRef.current = pontos;
  }, [pontos]);
  useEffect(() => {
    iconesConfigRef.current = iconesConfig;
  }, [iconesConfig]);

  const clearLabels = useCallback(() => {
    labelsRef.current.forEach((m) => {
      try {
        m.remove();
      } catch {
        /* ignore */
      }
    });
    labelsRef.current = [];
    iconMarkersRef.current.forEach((m) => {
      try {
        m.remove();
      } catch {
        /* ignore */
      }
    });
    iconMarkersRef.current = [];
  }, []);

  /**
   * SSOT de rótulos/HTML markers (R6-01): limpa e reconstrói a partir do snapshot atual.
   * Usado no load e após style.swap — nunca clearLabels() sem rebuild.
   * @param {import('maplibre-gl').Map} map
   * @param {{ areas?: unknown[], pontos?: unknown[], iconesConfig?: unknown[], editingId?: string | null, tipoDesenho?: string | null }} [snap]
   * @returns {unknown[]} pontos sem ícone (para layer circle)
   */
  const rebuildOverlayMarkers = useCallback(
    (map, snap = {}) => {
      if (!map) return [];
      clearLabels();
      const areasSnap = snap.areas ?? areasRef.current ?? [];
      const pontosSnap = snap.pontos ?? pontosRef.current ?? [];
      const iconesSnap = snap.iconesConfig ?? iconesConfigRef.current ?? [];
      const editingId = snap.editingId ?? itemEditando?.id ?? null;
      const tipo = snap.tipoDesenho ?? tipoDesenho;
      const pontosSemIcone = [];

      pontosSnap.forEach((ponto) => {
        const v = parseVertex(ponto.coordenadas);
        if (!v) return;
        const url = resolvePontoIconUrl(ponto, iconesSnap);
        if (url) {
          const img = document.createElement("img");
          img.src = url;
          img.alt = ponto.nome || "";
          img.style.width = "44px";
          img.style.height = "auto";
          img.style.maxHeight = "44px";
          img.style.objectFit = "contain";
          img.style.pointerEvents = "none";
          const marker = new maplibregl.Marker({ element: img, anchor: "center" })
            .setLngLat([v.lng, v.lat])
            .addTo(map);
          iconMarkersRef.current.push(marker);
        } else {
          pontosSemIcone.push(ponto);
        }
      });

      areasSnap.forEach((area) => {
        if (editingId && area.id === editingId && tipo === "area") return;
        const ring = parseVertices(area.coordenadas?.coords);
        if (ring.length < 3) return;
        // Mesmo ponto seguro e mesmo texto (nome + ha) do Mapa Geral (R1).
        const pos = pontoRotuloSeguro(ring);
        if (!pos) return;
        const { lat, lng } = pos;
        const el = document.createElement("div");
        el.className =
          "pointer-events-none whitespace-nowrap text-center text-[11px] font-bold uppercase leading-tight tracking-[0.02em] text-white";
        el.style.textShadow = "0 1px 3px rgba(0,0,0,0.95)";
        const nomeEl = document.createElement("div");
        nomeEl.textContent = area.nome || area.numero_area || "ÁREA";
        el.appendChild(nomeEl);
        const ha = textoHectares(area);
        if (ha) {
          const haEl = document.createElement("div");
          haEl.className = "text-[10px] font-normal normal-case";
          haEl.textContent = ha;
          el.appendChild(haEl);
        }
        const marker = new maplibregl.Marker({ element: el, anchor: "center" })
          .setLngLat([lng, lat])
          .addTo(map);
        labelsRef.current.push(marker);
      });

      overlayEpochRef.current += 1;
      return pontosSemIcone;
    },
    [clearLabels, itemEditando, tipoDesenho]
  );

  const cancelarDesenho = useCallback(() => {
    const map = mapInstanceRef.current;
    if (map) {
      setSourceData(map, SOURCE_IDS.DESENHO, emptyFc());
      setSourceData(map, SOURCE_IDS.VERTICES, emptyFc());
      setSourceData(map, SOURCE_IDS.MIDPOINTS, emptyFc());
      setSourceData(map, SOURCE_IDS.GUIA, emptyFc());
    }
    undoStackRef.current = [];
    redoStackRef.current = [];
    syncHistoryUi();
    setCurrentPoints([]);
    setCurrentMarker(null);
    setDrawingClosed(false);
  }, [syncHistoryUi]);

  // Troca de empresa: limpa edição e evita misturar layers (R5-08)
  useEffect(() => {
    const prev = empresaRef.current;
    empresaRef.current = empresaSelecionadaId;
    if (!prev || !empresaSelecionadaId || prev === empresaSelecionadaId) return;
    cancelarDesenho();
    hasCenteredRef.current = false;
    clearLabels();
    const map = mapInstanceRef.current;
    if (map) {
      setSourceData(map, SOURCE_IDS.AREAS, emptyFc());
      setSourceData(map, SOURCE_IDS.LINHAS, emptyFc());
      setSourceData(map, SOURCE_IDS.PONTOS, emptyFc());
    }
  }, [empresaSelecionadaId, cancelarDesenho, clearLabels]);

  const rehydrateAllSources = useCallback(
    (map) => {
      // R1: a guarda é "fontes de negócio existem", não isStyleLoaded() (que fica
      // false enquanto tiles carregam e fazia o sync ser pulado sem retry).
      if (!map || !map.getSource(SOURCE_IDS.DESENHO)) return;
      const editingId = itemEditando?.id || null;
      const pts = currentPointsRef.current;
      const marker = currentMarkerRef.current;
      const canEditVerts = drawingClosedRef.current || !!itemEditando;

      setSourceData(
        map,
        SOURCE_IDS.AREAS,
        buildAreasCollection(areasRef.current, {
          hideFillForId: tipoDesenho === "area" ? editingId : null,
        })
      );
      setSourceData(map, SOURCE_IDS.LINHAS, buildLinhasCollection(linhasRef.current));
      const pontosSemIcone = rebuildOverlayMarkers(map, {
        areas: areasRef.current,
        pontos: pontosRef.current,
        iconesConfig: iconesConfigRef.current,
        editingId,
        tipoDesenho,
      });
      setSourceData(map, SOURCE_IDS.PONTOS, buildPontosCollection(pontosSemIcone));
      setSourceData(map, SOURCE_IDS.DESENHO, buildDesenhoCollection(pts, tipoDesenho, marker, { cor: itemEditando?.coordenadas?.cor || itemEditando?.cor || null }));
      if ((tipoDesenho === "area" || tipoDesenho === "linha") && pts.length > 0) {
        setSourceData(map, SOURCE_IDS.VERTICES, buildVerticesCollection(pts));
        setSourceData(
          map,
          SOURCE_IDS.MIDPOINTS,
          canEditVerts ? buildMidpointsCollection(pts, tipoDesenho) : emptyFc()
        );
      } else if (tipoDesenho === "ponto" && marker) {
        setSourceData(map, SOURCE_IDS.VERTICES, buildVerticesCollection([marker]));
        setSourceData(map, SOURCE_IDS.MIDPOINTS, emptyFc());
      } else {
        setSourceData(map, SOURCE_IDS.VERTICES, emptyFc());
        setSourceData(map, SOURCE_IDS.MIDPOINTS, emptyFc());
      }
      setSourceData(map, SOURCE_IDS.GUIA, emptyFc());
    },
    [itemEditando, tipoDesenho, rebuildOverlayMarkers]
  );

  // Init MapLibre — depende de mapEpoch para retry limpo (R5-06)
  useEffect(() => {
    if (!mapRef.current) return undefined;
    let cancelled = false;
    setMapError(null);
    setMapReady(false);

    let created;
    try {
      created = createEditorMap(mapRef.current, {
        basemapId: BASEMAP_IDS.RUAS,
        center: CENTRO_PADRAO,
        zoom: 17,
      });
    } catch (err) {
      if (mountedRef.current) {
        setMapError(err?.message || "Falha ao criar mapa (WebGL?)");
        toast.error("Erro ao carregar mapa.");
      }
      return undefined;
    }

    mapInstanceRef.current = created.map;
    disposeRef.current = created.dispose;
    const map = created.map;

    const onLoad = () => {
      if (cancelled || created.getCancelled() || !mountedRef.current) return;
      try {
        ensureBusinessLayers(map);
        syncDivisaWidth(map);
        setMapReady(true);
      } catch (err) {
        if (mountedRef.current) {
          setMapError(err?.message || "Falha ao preparar camadas");
          toast.error("Erro ao preparar o mapa.");
        }
      }
    };

    const onError = (e) => {
      if (cancelled || !mountedRef.current) return;
      const msg = e?.error?.message || e?.message || "Erro de estilo/tiles";
      if (/style|tile|fetch|network|xhr/i.test(String(msg))) {
        setMapError("Falha ao carregar o estilo ou tiles do mapa. Verifique a rede e tente novamente.");
      }
    };

    const onZoom = (e) => {
      syncDivisaWidth(map);
      // Só gesto do usuário (pinça/roda) bloqueia toques; zoom programático
      // (fitBounds inicial) não pode engolir o 1º toque de desenho (R1).
      if (!e?.originalEvent) return;
      zoomingRef.current = true;
      if (zoomTimerRef.current) window.clearTimeout(zoomTimerRef.current);
      zoomTimerRef.current = window.setTimeout(() => {
        zoomingRef.current = false;
      }, 400);
    };

    map.on("load", onLoad);
    map.on("error", onError);
    map.on("zoom", onZoom);

    return () => {
      cancelled = true;
      styleSwapCancelRef.current?.cancel?.();
      styleSwapCancelRef.current = null;
      map.off("load", onLoad);
      map.off("error", onError);
      map.off("zoom", onZoom);
      if (zoomTimerRef.current) {
        window.clearTimeout(zoomTimerRef.current);
        zoomTimerRef.current = null;
      }
      clearLabels();
      disposeRef.current?.();
      disposeRef.current = null;
      mapInstanceRef.current = null;
      if (mountedRef.current) setMapReady(false);
    };
  }, [mapEpoch, clearLabels]);

  // Carregar item em edição — bloquear se geometria legada corrompida (R5-08)
  useEffect(() => {
    if (itemEditando && tipoDesenho === "area" && itemEditando.coordenadas?.coords) {
      const inspected = inspectVertices(itemEditando.coordenadas.coords);
      if (!inspected.ok && inspected.invalidCount > 0) {
        toast.error(
          `Geometria da área tem ${inspected.invalidCount} vértice(s) inválido(s). Corrija antes de sobrescrever.`
        );
        setCurrentPoints(inspected.vertices);
        setDrawingClosed(false);
        return undefined;
      }
      const coords = inspected.vertices;
      originalPontosRef.current = coords.map((p) => ({ ...p }));
      setCurrentPoints(coords);
      setDrawingClosed(coords.length >= 3);
      const t = window.setTimeout(() => {
        const map = mapInstanceRef.current;
        if (!map || coords.length === 0) return;
        const bounds = new maplibregl.LngLatBounds();
        coords.forEach((c) => bounds.extend([c.lng, c.lat]));
        map.fitBounds(bounds, { padding: 80, maxZoom: 18 });
      }, 400);
      return () => window.clearTimeout(t);
    }
    if (itemEditando && tipoDesenho === "linha" && itemEditando.coordenadas?.coords) {
      const inspected = inspectVertices(itemEditando.coordenadas.coords);
      if (!inspected.ok && inspected.invalidCount > 0) {
        toast.error(
          `Geometria da linha tem ${inspected.invalidCount} vértice(s) inválido(s). Corrija antes de sobrescrever.`
        );
      }
      const coords = inspected.vertices;
      originalPontosRef.current = coords.map((p) => ({ ...p }));
      setCurrentPoints(coords);
      const t = window.setTimeout(() => {
        const map = mapInstanceRef.current;
        if (!map || coords.length === 0) return;
        const bounds = new maplibregl.LngLatBounds();
        coords.forEach((c) => bounds.extend([c.lng, c.lat]));
        map.fitBounds(bounds, { padding: 80, maxZoom: 18 });
      }, 400);
      return () => window.clearTimeout(t);
    }
    if (itemEditando && tipoDesenho === "ponto" && itemEditando.coordenadas) {
      const v = parseVertex(itemEditando.coordenadas);
      if (v) {
        setCurrentMarker(v);
        const t = window.setTimeout(() => {
          const map = mapInstanceRef.current;
          if (!map) return;
          map.setCenter([v.lng, v.lat]);
          map.setZoom(18);
        }, 400);
        return () => window.clearTimeout(t);
      }
    }
    return undefined;
  }, [itemEditando, tipoDesenho]);

  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady || itemEditando || hasCenteredRef.current) return;
    if (areas.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    let hasValid = false;
    areas.forEach((area) => {
      parseVertices(area.coordenadas?.coords).forEach((c) => {
        bounds.extend([c.lng, c.lat]);
        hasValid = true;
      });
    });
    if (hasValid) {
      mapInstanceRef.current.fitBounds(bounds, { padding: 20, maxZoom: 18 });
      hasCenteredRef.current = true;
    }
  }, [areas, mapReady, itemEditando]);

  // Sync GeoJSON + labels/ícones (SSOT rebuildOverlayMarkers)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    if (!map.getSource(SOURCE_IDS.AREAS)) return;

    const editingId = itemEditando?.id || null;
    setSourceData(
      map,
      SOURCE_IDS.AREAS,
      buildAreasCollection(areas, { hideFillForId: tipoDesenho === "area" ? editingId : null })
    );
    setSourceData(map, SOURCE_IDS.LINHAS, buildLinhasCollection(linhas));
    const pontosSemIcone = rebuildOverlayMarkers(map, {
      areas,
      pontos,
      iconesConfig,
      editingId,
      tipoDesenho,
    });
    setSourceData(map, SOURCE_IDS.PONTOS, buildPontosCollection(pontosSemIcone));
  }, [areas, pontos, linhas, iconesConfig, mapReady, itemEditando, tipoDesenho, rebuildOverlayMarkers]);

  // Sync desenho atual
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady || !tipoDesenho) return;
    // R1 (causa raiz do polígono invisível): antes a guarda era isStyleLoaded().
    // Com tiles ainda carregando o estilo reporta "não carregado", o efeito saía
    // sem gravar DESENHO e só rodava de novo na próxima mudança de pontos —
    // vértices (outro efeito, sem a guarda) apareciam; preenchimento/contorno não.
    if (!map.getSource(SOURCE_IDS.DESENHO)) return;

    setSourceData(map, SOURCE_IDS.DESENHO, buildDesenhoCollection(currentPoints, tipoDesenho, currentMarker, { cor: itemEditando?.coordenadas?.cor || itemEditando?.cor || null }));

    const canEditVerts = drawingClosed || !!itemEditando;
    if ((tipoDesenho === "area" || tipoDesenho === "linha") && currentPoints.length > 0) {
      setSourceData(map, SOURCE_IDS.VERTICES, buildVerticesCollection(currentPoints));
      setSourceData(
        map,
        SOURCE_IDS.MIDPOINTS,
        canEditVerts ? buildMidpointsCollection(currentPoints, tipoDesenho) : emptyFc()
      );
    } else if (tipoDesenho === "ponto" && currentMarker) {
      setSourceData(map, SOURCE_IDS.VERTICES, buildVerticesCollection([currentMarker]));
      setSourceData(map, SOURCE_IDS.MIDPOINTS, emptyFc());
    } else {
      setSourceData(map, SOURCE_IDS.VERTICES, emptyFc());
      setSourceData(map, SOURCE_IDS.MIDPOINTS, emptyFc());
    }
  }, [currentPoints, currentMarker, tipoDesenho, drawingClosed, itemEditando, mapReady]);

  // Clique para adicionar pontos — R5-01 (sem map.project inválido)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !tipoDesenho || !mapReady || itemEditando) return undefined;
    if (!podeAdicionarVertice(modo, drawingClosed)) return undefined;

    const MAX_CLICK_DURATION = 400;
    const MAX_CLICK_DISTANCE = 10;
    const canvas = map.getCanvas();
    let downPos = null;
    let downTime = 0;

    const handleAddPoint = (latLng, mods = {}) => {
      if (!latLng) return;
      if (!podeAdicionarVertice(modoRef.current, drawingClosedRef.current)) return;
      if (zoomingRef.current) return;

      if (tipoDesenho === "area" && isNearFirstVertex(map, latLng, currentPointsRef.current, 20)) {
        setDrawingClosed(true);
        setModo(MODOS.EDITAR);
        toast.success("Área fechada! Arraste os pontos, navegue ou clique Salvar.", { duration: 2000 });
        return;
      }

      let { lat, lng } = latLng;
      const ultimo = currentPointsRef.current[currentPointsRef.current.length - 1];
      if (mods.shift && ultimo && tipoDesenho !== "ponto") {
        const travado = travarAngulo45(map.project([ultimo.lng, ultimo.lat]), map.project([lng, lat]));
        const ll = map.unproject([travado.x, travado.y]);
        lat = ll.lat;
        lng = ll.lng;
      }
      const snapped = findNearestSnap(map, { lat, lng }, {
        areas: areasRef.current,
        linhas: linhasRef.current,
        enabled: snappingRef.current && !mods.alt,
      });
      if (snapped) {
        lat = snapped.lat;
        lng = snapped.lng;
        toast.success("Encaixado!", { duration: 600 });
      }

      if (tipoDesenho === "ponto") {
        setCurrentMarker({ lat, lng });
        setShowFormularioPonto(true);
      } else if (tipoDesenho === "area" || tipoDesenho === "linha") {
        const newPoint = { lat, lng };
        setCurrentPoints((prev) => {
          undoStackRef.current.push(prev.map((p) => ({ ...p })));
          redoStackRef.current = [];
          syncHistoryUi();
          const updated = [...prev, newPoint];
          return updated;
        });
        toast.success("Ponto adicionado", { duration: 800 });
      }
    };

    const onDown = (ev) => {
      if (ev.pointerType === "touch" && ev.isPrimary === false) return;
      downPos = { x: ev.clientX, y: ev.clientY };
      downTime = Date.now();
    };

    const onUp = (ev) => {
      if (!downPos) return;
      if (ev.pointerType === "touch" && ev.isPrimary === false) return;
      const elapsed = Date.now() - downTime;
      const dx = ev.clientX - downPos.x;
      const dy = ev.clientY - downPos.y;
      const dist = Math.hypot(dx, dy);
      downPos = null;
      if (elapsed > MAX_CLICK_DURATION || dist > MAX_CLICK_DISTANCE) return;
      if (zoomingRef.current) return;
      if (dragStateRef.current) return;

      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const ll = map.unproject([x, y]);
      // Fechar tocando o 1º vértice tem prioridade sobre "toque em vértice não cria ponto".
      const fechaNoPrimeiro =
        tipoDesenho === "area" && isNearFirstVertex(map, { lat: ll.lat, lng: ll.lng }, currentPointsRef.current, 20);
      if (!fechaNoPrimeiro && hitEditLayers(map, x, y, [LAYER_IDS.VERTICES, LAYER_IDS.MIDPOINTS])) return;

      handleAddPoint({ lat: ll.lat, lng: ll.lng }, { shift: !!ev.shiftKey, alt: !!ev.altKey });
    };

    canvas.addEventListener("pointerdown", onDown, { passive: true });
    canvas.addEventListener("pointerup", onUp, { passive: true });

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
    };
  }, [tipoDesenho, mapReady, itemEditando, drawingClosed, syncHistoryUi, modo]);

  // Guia elástica
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return undefined;
    if (!(tipoDesenho === "area" || tipoDesenho === "linha") || itemEditando) return undefined;

    if (!podeAdicionarVertice(modo, drawingClosed)) {
      setSourceData(map, SOURCE_IDS.GUIA, emptyFc());
      return undefined;
    }

    const onMove = (e) => {
      const pts = currentPointsRef.current;
      const last = pts[pts.length - 1];
      if (!last) {
        setSourceData(map, SOURCE_IDS.GUIA, emptyFc());
        return;
      }
      let target = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      if (e.originalEvent?.shiftKey) {
        const t = travarAngulo45(map.project([last.lng, last.lat]), e.point);
        const ll = map.unproject([t.x, t.y]);
        target = { lat: ll.lat, lng: ll.lng };
      }
      const snapped = findNearestSnap(map, target, {
        areas: areasRef.current,
        linhas: linhasRef.current,
        enabled: snappingRef.current && !e.originalEvent?.altKey,
      });
      if (snapped) target = snapped;
      setSourceData(map, SOURCE_IDS.GUIA, buildGuiaCollection(last, target));
    };

    const onLeave = () => setSourceData(map, SOURCE_IDS.GUIA, emptyFc());

    map.on("mousemove", onMove);
    map.getCanvas().addEventListener("mouseleave", onLeave);

    return () => {
      map.off("mousemove", onMove);
      map.getCanvas().removeEventListener("mouseleave", onLeave);
      setSourceData(map, SOURCE_IDS.GUIA, emptyFc());
    };
  }, [mapReady, tipoDesenho, itemEditando, snappingEnabled, drawingClosed, modo]);

  // Drag vértices/midpoints — pointer + touch (R5-03, R5-04)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady || !tipoDesenho) return undefined;
    if (!podeEditarVertices(modo, tipoDesenho)) return undefined;
    if (tipoDesenho === "ponto" && !currentMarkerRef.current) return undefined;
    const LIMIAR_ARRASTO_PX = 4;

    const canvas = map.getCanvas();

    const endDrag = (lngLat, { cancel = false } = {}) => {
      const st = dragStateRef.current;
      if (!st) return;
      map.dragPan.enable();
      dragStateRef.current = null;

      if (cancel) {
        if (tipoDesenho === "ponto") {
          setCurrentMarker(st.beforeMarker || st.before?.[0] || null);
        } else {
          setCurrentPoints(st.before || []);
        }
        return;
      }

      // Toque sem arrasto em vértice = selecionar (para remover), nunca mover.
      if (!st.moved && st.role === "vertex" && tipoDesenho !== "ponto") {
        setCurrentPoints(st.before || []);
        setVerticeSelecionado(st.index);
        return;
      }
      if (!st.moved && tipoDesenho === "ponto") return;

      let target = lngLat ? { lat: lngLat.lat, lng: lngLat.lng } : null;
      if (target) {
        const snapped = findNearestSnap(map, target, {
          areas: areasRef.current,
          linhas: linhasRef.current,
          enabled: snappingRef.current && !st.alt,
        });
        if (snapped) {
          target = snapped;
          toast.success("Encaixado!", { duration: 600 });
        }
      }

      if (st.role === "midpoint" && target && (tipoDesenho === "area" || tipoDesenho === "linha")) {
        const insertAfter = st.index;
        const before = st.before || [];
        const after = [...before];
        after.splice(insertAfter + 1, 0, target);
        const tx = commitDragTransaction({
          undo: undoStackRef.current,
          redo: redoStackRef.current,
          before,
          after,
        });
        undoStackRef.current = tx.undo;
        redoStackRef.current = tx.redo;
        syncHistoryUi();
        setCurrentPoints(after);
        if (tx.committed) toast.success("Novo ponto inserido", { duration: 800 });
        return;
      }

      if (tipoDesenho === "ponto" && target) {
        const before = st.beforeMarker ? [{ ...st.beforeMarker }] : [];
        const after = [target];
        const tx = commitDragTransaction({
          undo: undoStackRef.current,
          redo: redoStackRef.current,
          before,
          after,
        });
        undoStackRef.current = tx.undo;
        redoStackRef.current = tx.redo;
        syncHistoryUi();
        setCurrentMarker(target);
        return;
      }

      if (st.role === "vertex" && target && tipoDesenho !== "ponto") {
        const before = st.before || [];
        const after = before.map((p) => ({ ...p }));
        if (after[st.index]) after[st.index] = target;
        const tx = commitDragTransaction({
          undo: undoStackRef.current,
          redo: redoStackRef.current,
          before,
          after,
        });
        undoStackRef.current = tx.undo;
        redoStackRef.current = tx.redo;
        syncHistoryUi();
        setCurrentPoints(after);
        if (tx.committed) toast.success(`Ponto ${st.index + 1} reposicionado`, { duration: 800 });
      }
    };

    const onPointerDown = (e) => {
      if (e.pointerType === "touch" && !e.isPrimary) return;
      const layers = [LAYER_IDS.VERTICES, LAYER_IDS.MIDPOINTS].filter((id) => map.getLayer(id));
      if (layers.length === 0) return;
      // Alvo de toque generoso (vértice desenhado tem ~10px).
      const tol = e.originalEvent?.type?.startsWith("touch") ? 14 : 8;
      const feats = map.queryRenderedFeatures(
        [
          [e.point.x - tol, e.point.y - tol],
          [e.point.x + tol, e.point.y + tol],
        ],
        { layers }
      );
      if (!feats.length) return;
      const f = feats[0];
      const role = f.properties?.role;
      const index = Number(f.properties?.index);
      e.preventDefault();
      map.dragPan.disable();
      dragStateRef.current = {
        role,
        index,
        before: currentPointsRef.current.map((p) => ({ ...p })),
        beforeMarker: currentMarkerRef.current ? { ...currentMarkerRef.current } : null,
        pointerId: e.originalEvent?.pointerId,
        downPx: { x: e.point.x, y: e.point.y },
        moved: false,
        alt: !!e.originalEvent?.altKey,
      };
    };

    const onPointerMove = (e) => {
      const st = dragStateRef.current;
      if (!st) return;
      if (!st.moved) {
        if (Math.hypot(e.point.x - st.downPx.x, e.point.y - st.downPx.y) < LIMIAR_ARRASTO_PX) return;
        st.moved = true;
      }
      st.alt = !!e.originalEvent?.altKey;
      let target = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      const snapped = findNearestSnap(map, target, {
        areas: areasRef.current,
        linhas: linhasRef.current,
        enabled: snappingRef.current && !st.alt,
      });
      if (snapped) target = snapped;

      if (tipoDesenho === "ponto") {
        setCurrentMarker(target);
        return;
      }
      if (st.role === "vertex") {
        setCurrentPoints((prev) => {
          const updated = [...prev];
          if (updated[st.index]) updated[st.index] = target;
          return updated;
        });
      }
    };

    const onPointerUp = (e) => {
      if (!dragStateRef.current) return;
      endDrag(e.lngLat, { cancel: false });
    };

    // Soltar FORA do mapa cancela; dentro, quem conclui é o mouseup/touchend do
    // mapa (o pointerup da janela chega antes e cancelava todo arrasto).
    const onWindowPointerUp = (ev) => {
      if (!dragStateRef.current) return;
      const alvo = /** @type {Node | null} */ (ev?.target ?? null);
      if (alvo && (alvo === canvas || canvas.contains(alvo))) return;
      endDrag(null, { cancel: true });
      map.dragPan.enable();
    };

    const onKeyDown = (ev) => {
      if (ev.key === "Escape" && dragStateRef.current) {
        endDrag(null, { cancel: true });
      }
    };

    const onBlur = () => {
      if (dragStateRef.current) endDrag(null, { cancel: true });
    };

    map.on("mousedown", LAYER_IDS.VERTICES, onPointerDown);
    map.on("mousedown", LAYER_IDS.MIDPOINTS, onPointerDown);
    map.on("touchstart", LAYER_IDS.VERTICES, onPointerDown);
    map.on("touchstart", LAYER_IDS.MIDPOINTS, onPointerDown);
    map.on("mousemove", onPointerMove);
    map.on("touchmove", onPointerMove);
    map.on("mouseup", onPointerUp);
    map.on("touchend", onPointerUp);
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      map.off("mousedown", LAYER_IDS.VERTICES, onPointerDown);
      map.off("mousedown", LAYER_IDS.MIDPOINTS, onPointerDown);
      map.off("touchstart", LAYER_IDS.VERTICES, onPointerDown);
      map.off("touchstart", LAYER_IDS.MIDPOINTS, onPointerDown);
      map.off("mousemove", onPointerMove);
      map.off("touchmove", onPointerMove);
      map.off("mouseup", onPointerUp);
      map.off("touchend", onPointerUp);
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("keydown", onKeyDown);
      map.dragPan.enable();
      dragStateRef.current = null;
      void canvas;
    };
  }, [mapReady, tipoDesenho, drawingClosed, itemEditando, syncHistoryUi, modo, currentMarker]);

  // Mover área inteira — só com a mão (MOVER); arrasto no interior translada tudo.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady || !(tipoDesenho === "area" || tipoDesenho === "linha")) return undefined;
    if (modo !== MODOS.MOVER) return undefined;
    /** @type {null | { inicio: { lat: number, lng: number }, before: { lat: number, lng: number }[], moved: boolean }} */
    let mov = null;
    const camadas = () => [LAYER_IDS.DESENHO_FILL, LAYER_IDS.DESENHO_LINE].filter((id) => map.getLayer(id));
    const onDown = (e) => {
      if (!podeMoverArea(modoRef.current, currentPointsRef.current)) return;
      const tol = 6;
      const hit = map.queryRenderedFeatures(
        [
          [e.point.x - tol, e.point.y - tol],
          [e.point.x + tol, e.point.y + tol],
        ],
        { layers: camadas() }
      );
      if (!hit.length) return;
      e.preventDefault();
      map.dragPan.disable();
      mov = { inicio: { lat: e.lngLat.lat, lng: e.lngLat.lng }, before: currentPointsRef.current.map((p) => ({ ...p })), moved: false };
    };
    const onMove = (e) => {
      if (!mov) return;
      mov.moved = true;
      setCurrentPoints(transladarPontos(mov.before, e.lngLat.lat - mov.inicio.lat, e.lngLat.lng - mov.inicio.lng));
    };
    const onUp = (e) => {
      if (!mov) return;
      const m = mov;
      mov = null;
      map.dragPan.enable();
      if (!m.moved || !e?.lngLat) {
        setCurrentPoints(m.before);
        return;
      }
      const after = transladarPontos(m.before, e.lngLat.lat - m.inicio.lat, e.lngLat.lng - m.inicio.lng);
      const tx = commitDragTransaction({ undo: undoStackRef.current, redo: redoStackRef.current, before: m.before, after });
      undoStackRef.current = tx.undo;
      redoStackRef.current = tx.redo;
      syncHistoryUi();
      setCurrentPoints(after);
    };
    const onCancel = () => {
      if (!mov) return;
      setCurrentPoints(mov.before);
      mov = null;
      map.dragPan.enable();
    };
    map.on("mousedown", onDown);
    map.on("touchstart", onDown);
    map.on("mousemove", onMove);
    map.on("touchmove", onMove);
    map.on("mouseup", onUp);
    map.on("touchend", onUp);
    window.addEventListener("blur", onCancel);
    return () => {
      map.off("mousedown", onDown);
      map.off("touchstart", onDown);
      map.off("mousemove", onMove);
      map.off("touchmove", onMove);
      map.off("mouseup", onUp);
      map.off("touchend", onUp);
      window.removeEventListener("blur", onCancel);
      map.dragPan.enable();
    };
  }, [mapReady, tipoDesenho, modo, syncHistoryUi]);

  // Vértice selecionado (destaque) e Delete/Backspace para remover.
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady || !(tipoDesenho === "area" || tipoDesenho === "linha")) return;
    const fc = buildVerticesCollection(currentPoints);
    fc.features.forEach((f) => {
      if (f.properties && Number(f.properties.index) === verticeSelecionado) f.properties.selecionado = true;
    });
    setSourceData(map, SOURCE_IDS.VERTICES, currentPoints.length > 0 ? fc : emptyFc());
  }, [verticeSelecionado, currentPoints, mapReady, tipoDesenho]);

  // Régua: comprimento de cada segmento (DOM markers, textContent).
  useEffect(() => {
    const map = mapInstanceRef.current;
    reguaMarkersRef.current.forEach((m) => m.remove());
    reguaMarkersRef.current = [];
    if (!map || !mapReady || !reguaAtiva || !(tipoDesenho === "area" || tipoDesenho === "linha")) return undefined;
    const fechado = tipoDesenho === "area" && (drawingClosed || !!itemEditando);
    for (const seg of segmentosDaRegua(currentPoints, fechado, (a, b) => comprimentoMetros([a, b]))) {
      const el = document.createElement("div");
      el.className = "pointer-events-none whitespace-nowrap rounded bg-black/70 px-1 text-[10px] font-semibold text-white";
      el.textContent = formatDistanciaPt(seg.metros);
      reguaMarkersRef.current.push(new maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([seg.meio.lng, seg.meio.lat]).addTo(map));
    }
    return () => {
      reguaMarkersRef.current.forEach((m) => m.remove());
      reguaMarkersRef.current = [];
    };
  }, [reguaAtiva, currentPoints, drawingClosed, itemEditando, mapReady, tipoDesenho]);

  const removerVerticeSelecionado = useCallback(() => {
    if (verticeSelecionado == null) return;
    const before = currentPointsRef.current.map((p) => ({ ...p }));
    const after = removerVertice(before, verticeSelecionado, tipoDesenho);
    if (!after) {
      toast.error(tipoDesenho === "area" ? "A área precisa de pelo menos 3 pontos." : "A linha precisa de pelo menos 2 pontos.");
      return;
    }
    const tx = commitDragTransaction({ undo: undoStackRef.current, redo: redoStackRef.current, before, after });
    undoStackRef.current = tx.undo;
    redoStackRef.current = tx.redo;
    syncHistoryUi();
    setCurrentPoints(after);
    setVerticeSelecionado(null);
    toast.success("Ponto removido", { duration: 800 });
  }, [verticeSelecionado, tipoDesenho, syncHistoryUi]);

  useEffect(() => {
    if (verticeSelecionado == null) return undefined;
    const onKey = (ev) => {
      const alvo = /** @type {HTMLElement | null} */ (ev.target);
      if (alvo && /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName)) return;
      if (ev.key === "Delete" || ev.key === "Backspace") {
        ev.preventDefault();
        removerVerticeSelecionado();
      } else if (ev.key === "Escape") {
        setVerticeSelecionado(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [verticeSelecionado, removerVerticeSelecionado]);

  const basemapMap = mapReady ? mapInstanceRef.current : null;
  const basemap = useBasemap(basemapMap, {
    reaplicarCamadas: () => {
      const map = mapInstanceRef.current;
      if (!map) return;
      ensureBusinessLayers(map);
      syncDivisaWidth(map);
      rehydrateAllSources(map);
    },
  });

  const trocarBasemap = (id) => basemap.setBasemap(id);

  const temAlteracoes = () => {
    if (tipoDesenho === "ponto") return !!currentMarker && !itemEditando;
    return desenhoAlterado(itemEditando ? originalPontosRef.current : [], currentPoints);
  };

  const sair = () => {
    if (temAlteracoes()) {
      setConfirmarSaida(true);
      return;
    }
    onCancelar?.();
  };

  const finalizarDesenho = () => {
    if (tipoDesenho === "area") {
      const check = validatePolygonForSave(currentPoints);
      if (!check.ok) {
        toast.error(check.reason || "Polígono inválido");
        return;
      }
      setShowFormularioArea(true);
    } else if (tipoDesenho === "linha") {
      const check = validateLineForSave(currentPoints);
      if (!check.ok) {
        toast.error(check.reason || "Linha inválida");
        return;
      }
      if (check.cleaned) setCurrentPoints(check.cleaned);
      setShowFormularioLinha(true);
    }
  };

  /**
   * Retry via epoch — NÃO limpar innerHTML antes do cleanup (R6-02).
   * O effect de mapEpoch faz map.remove() + listeners/timers no unmount.
   */
  const retryMap = () => {
    setMapError(null);
    setMapReady(false);
    setMapEpoch((n) => n + 1);
  };

  const crosshair = tipoDesenho && mapReady && podeAdicionarVertice(modo, drawingClosed) && !itemEditando;
  const cursorModo = mapReady ? cursorDoModo(modo) : "";
  const desenhaAreaOuLinha = tipoDesenho === "area" || tipoDesenho === "linha";
  const fechadoParaMedir = tipoDesenho === "area" && (drawingClosed || !!itemEditando);
  const botaoModo = (ativo) =>
    `h-11 min-w-[44px] px-2 text-xs font-semibold rounded-md border shadow-sm ${ativo ? "bg-slate-900 text-white border-slate-900 hover:bg-slate-800" : "bg-white text-slate-800 border-slate-300 hover:bg-slate-100"}`;

  return (
    <div className="fixed inset-0 z-50 bg-white">
      <div className="w-full h-full relative">
        <div
          ref={mapRef}
          data-testid="mapa-desenho-maplibre"
          style={{
            height: "100%",
            width: "100%",
            backgroundColor: "#e5e7eb",
            cursor: crosshair ? "crosshair" : cursorModo || "default",
            touchAction: "none",
          }}
          className={crosshair ? "[&_*]:cursor-crosshair" : ""}
        />

        <BasemapAtribuicao atribuicao={basemap.atribuicao} status={basemap.status} mensagem={basemap.mensagem} onRetry={basemap.retry} />

        {confirmarSaida && (
          <div role="alertdialog" aria-label="Descartar alterações" className="absolute left-1/2 top-1/3 z-40 w-[min(92vw,360px)] -translate-x-1/2 space-y-3 rounded-lg bg-white p-4 shadow-2xl">
            <p className="text-sm font-semibold text-slate-900">Descartar o desenho não salvo?</p>
            <p className="text-xs text-slate-600">As alterações no mapa ainda não foram salvas.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" className="h-10" onClick={() => setConfirmarSaida(false)}>
                Voltar ao desenho
              </Button>
              <Button type="button" size="sm" className="h-10 bg-red-600 text-white hover:bg-red-700" onClick={() => { setConfirmarSaida(false); onCancelar?.(); }}>
                Descartar
              </Button>
            </div>
          </div>
        )}

        <Button
          onClick={sair}
          aria-label="Fechar editor"
          variant="secondary"
          size="icon"
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 text-secondary-foreground absolute top-1 left-1 z-20 h-7 w-7 rounded-full bg-white/90 backdrop-blur-sm shadow-lg hover:bg-white"
        >
          <X className="w-6 h-6 text-slate-700" />
        </Button>

        <div className="absolute top-4 right-4 z-20 flex items-center gap-1">
          <Button
            variant={basemap.basemapId === BASEMAP_IDS.RUAS ? "default" : "secondary"}
            size="sm"
            aria-pressed={basemap.basemapId === BASEMAP_IDS.RUAS}
            onClick={() => trocarBasemap(BASEMAP_IDS.RUAS)}
            className="w-9 bg-background text-[hsl(var(--foreground))] px-7 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground active:bg-black active:text-white h-7"
          >
            Mapa
          </Button>
          <Button
            variant={basemap.basemapId === BASEMAP_IDS.SATELITE ? "default" : "secondary"}
            size="sm"
            aria-pressed={basemap.basemapId === BASEMAP_IDS.SATELITE}
            disabled={basemap.status === "carregando"}
            onClick={() => trocarBasemap(BASEMAP_IDS.SATELITE)}
            title="Satélite"
            className="w-9 bg-background text-[hsl(var(--foreground))] px-7 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground active:bg-black active:text-white h-7"
          >
            Satélite
          </Button>
          <Button
            variant="secondary"
            size="icon"
            onClick={() => {
              if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                  (position) => {
                    const pos = {
                      lat: position.coords.latitude,
                      lng: position.coords.longitude,
                    };
                    if (mapInstanceRef.current) {
                      mapInstanceRef.current.setCenter([pos.lng, pos.lat]);
                      mapInstanceRef.current.setZoom(18);
                      toast.success("Centralizado na sua localização");
                    }
                  },
                  () => toast.error("Erro ao obter localização")
                );
              }
            }}
            className="w-9 bg-background text-[hsl(var(--foreground))] px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground active:bg-black active:text-white h-7"
            title="Minha localização"
          >
            <Target className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSnappingEnabled(!snappingEnabled)}
            className="w-9 bg-background text-[hsl(var(--foreground))] px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground active:bg-black active:text-white h-7"
            title={snappingEnabled ? "Ímã ativado (Alt suspende)" : "Ímã desativado"}
            aria-label="Alternar ímã"
            aria-pressed={snappingEnabled}
          >
            <span className="text-base leading-none">🧲</span>
          </Button>
          {desenhaAreaOuLinha && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReguaAtiva((v) => !v)}
              className="w-9 bg-background px-3 text-xs h-7 border border-input shadow-sm"
              title={reguaAtiva ? "Régua ativada" : "Régua desativada"}
              aria-label="Alternar régua"
              aria-pressed={reguaAtiva}
            >
              <span className="text-base leading-none">📏</span>
            </Button>
          )}
        </div>

        {!mapReady && !mapError && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 bg-white px-6 py-4 rounded-lg shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="animate-spin w-6 h-6 border-4 border-emerald-600 border-t-transparent rounded-full" />
              <span className="font-semibold text-slate-700">Carregando mapa...</span>
            </div>
          </div>
        )}

        {mapError && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 bg-white px-6 py-4 rounded-lg shadow-2xl max-w-sm text-center space-y-3">
            <p className="font-semibold text-slate-800">Mapa indisponível</p>
            <p className="text-sm text-slate-600">{mapError}</p>
            <Button size="sm" onClick={retryMap} className="bg-emerald-600 text-white hover:bg-emerald-700">
              Tentar novamente
            </Button>
          </div>
        )}

        {tipoDesenho && mapReady && (
          <>
            {desenhaAreaOuLinha && (
              <div role="toolbar" aria-label="Modo do editor" className="absolute left-1 top-12 z-20 flex flex-col gap-1" style={{ top: "max(3rem, env(safe-area-inset-top))" }}>
                <button type="button" className={botaoModo(modo === MODOS.NAVEGAR)} aria-pressed={modo === MODOS.NAVEGAR} aria-label="Navegar no mapa" title="Navegar: mover e ampliar sem criar pontos" onClick={() => setModo(MODOS.NAVEGAR)}>
                  ✋ Navegar
                </button>
                {!itemEditando && !drawingClosed && (
                  <button type="button" className={botaoModo(modo === MODOS.DESENHAR)} aria-pressed={modo === MODOS.DESENHAR} aria-label="Desenhar pontos" title="Desenhar: toque curto cria ponto (Shift trava 45°)" onClick={() => setModo(MODOS.DESENHAR)}>
                    ✏️ Desenhar
                  </button>
                )}
                <button type="button" className={botaoModo(modo === MODOS.EDITAR)} aria-pressed={modo === MODOS.EDITAR} aria-label="Editar pontos" title="Editar: arraste pontos, toque no meio para inserir, toque num ponto para selecionar" disabled={currentPoints.length === 0} onClick={() => setModo(MODOS.EDITAR)}>
                  ⬚ Editar
                </button>
                <button type="button" className={botaoModo(modo === MODOS.MOVER)} aria-pressed={modo === MODOS.MOVER} aria-label="Mover área inteira" title="Mão: arraste o interior para mover a área inteira" disabled={currentPoints.length === 0} onClick={() => setModo(MODOS.MOVER)}>
                  ✥ Mover
                </button>
              </div>
            )}
            {tipoDesenho === "area" && currentPoints.length >= 3 && (
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
                <div data-testid="medidas-area" className="bg-black/70 text-white px-3 py-1.5 rounded text-sm font-semibold text-center">
                  <div>Área: {formatHectaresPt(areaHectares(currentPoints))} ha</div>
                  {fechadoParaMedir && (
                    <div className="text-[11px] font-normal">Perímetro: {formatDistanciaPt(comprimentoMetros([...currentPoints, currentPoints[0]]))}</div>
                  )}
                </div>
              </div>
            )}
            {tipoDesenho === "linha" && currentPoints.length >= 2 && (
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
                <div className="bg-black/70 text-white px-3 py-1.5 rounded text-sm font-semibold">
                  {formatDistanciaPt(comprimentoMetros(currentPoints))}
                </div>
              </div>
            )}

            <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-20 flex flex-col items-center gap-1">
              {tipoDesenho === "ponto" && !currentMarker && !itemEditando && (
                <div className="bg-black/70 text-white px-4 py-2 rounded-lg text-xs font-semibold">
                  Toque no mapa para marcar
                </div>
              )}
              {(tipoDesenho === "area" || tipoDesenho === "linha") && currentPoints.length === 0 && !itemEditando && (
                <div className="bg-black/70 text-white px-4 py-2 rounded-lg text-xs font-semibold">
                  {tipoDesenho === "area" ? "Toque para desenhar a área" : "Toque para desenhar a linha"}
                </div>
              )}
              {desenhaAreaOuLinha && currentPoints.length > 0 && (
                <div className="bg-black/70 text-white px-4 py-2 rounded-lg text-xs font-semibold">
                  {modo === MODOS.NAVEGAR && "Navegando — o mapa move sem criar pontos"}
                  {modo === MODOS.DESENHAR && "Toque para adicionar pontos"}
                  {modo === MODOS.EDITAR && (verticeSelecionado != null ? `Ponto ${verticeSelecionado + 1} selecionado` : "Arraste os pontos para ajustar")}
                  {modo === MODOS.MOVER && "Arraste o interior para mover a área"}
                </div>
              )}

              <div className="flex items-center gap-1 bg-white/90 backdrop-blur-sm px-2 py-1.5 rounded-full shadow-lg border border-slate-200">
                {(drawingClosed || currentPoints.length > 0) && !itemEditando && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="bg-background text-[hsl(var(--foreground))] px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground h-7"
                    onClick={() => {
                      cancelarDesenho();
                      setModo(MODOS.DESENHAR);
                      toast.success("Desenho reiniciado", { duration: 1000 });
                    }}
                  >
                    Reiniciar
                  </Button>
                )}

                {verticeSelecionado != null && modo === MODOS.EDITAR && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-3 text-xs border-red-300 text-red-700"
                    onClick={removerVerticeSelecionado}
                  >
                    Remover ponto
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="bg-background text-[hsl(var(--foreground))] px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground h-7"
                  onClick={() => {
                    if (undoStackRef.current.length > 0) {
                      setVerticeSelecionado(null);
                      const prevPts = undoStackRef.current.pop();
                      redoStackRef.current.push(currentPoints.map((p) => ({ ...p })));
                      setCurrentPoints(prevPts);
                      syncHistoryUi();
                      toast.success("Desfeito");
                    }
                  }}
                  disabled={undoLen === 0}
                >
                  Desfazer
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="bg-background text-[hsl(var(--foreground))] px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground h-7"
                  onClick={() => {
                    if (redoStackRef.current.length > 0) {
                      setVerticeSelecionado(null);
                      const nextPts = redoStackRef.current.pop();
                      undoStackRef.current.push(currentPoints.map((p) => ({ ...p })));
                      setCurrentPoints(nextPts);
                      syncHistoryUi();
                      toast.success("Refeito");
                    }
                  }}
                  disabled={redoLen === 0}
                >
                  Refazer
                </Button>

                <Button
                  size="sm"
                  className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow rounded-md px-3 h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={
                    !(
                      (tipoDesenho === "area" && (drawingClosed || currentPoints.length >= 3)) ||
                      (tipoDesenho === "linha" && currentPoints.length >= 2) ||
                      (tipoDesenho === "ponto" && !!currentMarker)
                    )
                  }
                  onClick={() => {
                    if (itemEditando) {
                      if (tipoDesenho === "area") {
                        const check = validatePolygonForSave(currentPoints);
                        if (!check.ok) {
                          toast.error(check.reason || "Polígono inválido");
                          return;
                        }
                        setShowFormularioArea(true);
                      } else if (tipoDesenho === "linha") {
                        const check = validateLineForSave(currentPoints);
                        if (!check.ok) {
                          toast.error(check.reason || "Linha inválida");
                          return;
                        }
                        setShowFormularioLinha(true);
                      } else if (tipoDesenho === "ponto") setShowFormularioPonto(true);
                    } else if (tipoDesenho === "ponto") {
                      setShowFormularioPonto(true);
                    } else {
                      finalizarDesenho();
                    }
                  }}
                >
                  {itemEditando ? "Salvar" : drawingClosed ? "Salvar" : "Terminar"}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>

      <Sheet open={showFormularioArea} onOpenChange={setShowFormularioArea}>
        <SheetContent side="right" className="w-[320px] sm:w-[400px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{itemEditando ? "Editar Área" : "Cadastrar Área"}</SheetTitle>
          </SheetHeader>
          <FormularioArea
            coordenadas={currentPoints}
            usarGPS={usarGPS}
            item={itemEditando}
            onSave={() => {
              setShowFormularioArea(false);
              cancelarDesenho();
              queryClient.invalidateQueries({ queryKey: ["areas"] });
              onSalvar();
            }}
            onCancel={() => setShowFormularioArea(false)}
          />
        </SheetContent>
      </Sheet>

      <Sheet open={showFormularioPonto} onOpenChange={setShowFormularioPonto}>
        <SheetContent side="right" className="bg-background px-1 py-1 fixed z-50 gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out inset-y-0 right-0 h-full border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm w-[320px] sm:w-[400px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{itemEditando ? "Editar Ponto" : "Cadastrar Ponto"}</SheetTitle>
          </SheetHeader>
          <FormularioPonto
            coordenadas={currentMarker}
            usarGPS={usarGPS}
            item={itemEditando}
            suggestedDepositoId={null}
            onSave={() => {
              setShowFormularioPonto(false);
              cancelarDesenho();
              queryClient.invalidateQueries({
                predicate: (query) =>
                  Array.isArray(query.queryKey) &&
                  ["pontos", "pontos-suplementacao", "mapa-pontos", "mapa-pontos-supl"].includes(query.queryKey[0]),
              });
              window.dispatchEvent(new CustomEvent("atualizar-mapa"));
              onSalvar();
            }}
            onCancel={() => {
              setShowFormularioPonto(false);
              cancelarDesenho();
            }}
          />
        </SheetContent>
      </Sheet>

      <Sheet open={showFormularioLinha} onOpenChange={setShowFormularioLinha}>
        <SheetContent side="right" className="w-[320px] sm:w-[400px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{itemEditando ? "Editar Linha" : "Cadastrar Linha"}</SheetTitle>
          </SheetHeader>
          <FormularioLinha
            coordenadas={currentPoints}
            usarGPS={usarGPS}
            item={itemEditando}
            onSave={() => {
              setShowFormularioLinha(false);
              cancelarDesenho();
              queryClient.invalidateQueries({ queryKey: ["linhas"] });
              onSalvar();
            }}
            onCancel={() => setShowFormularioLinha(false)}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
