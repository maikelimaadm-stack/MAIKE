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
import {
  BASEMAP_IDS,
  getSatelliteProvider,
  mensagemSateliteNaoConfigurado,
  CENTRO_PADRAO,
} from "@/lib/maplibre/basemap.js";
import {
  createEditorMap,
  ensureBusinessLayers,
  setSourceData,
  syncDivisaWidth,
  applyBasemapStyle,
  maplibregl,
} from "@/lib/maplibre/lifecycle.js";
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
  /** @type {[string, React.Dispatch<React.SetStateAction<string>>]} */
  const [basemapId, setBasemapId] = useState(/** @type {string} */ (BASEMAP_IDS.RUAS));
  const [snappingEnabled, setSnappingEnabled] = useState(true);

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
  const styleSwapCancelRef = useRef(null);
  const mountedRef = useRef(true);
  const empresaRef = useRef(null);

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
      if (!map || !map.isStyleLoaded?.()) return;
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
      setSourceData(map, SOURCE_IDS.PONTOS, buildPontosCollection(
        // pontos sem ícone customizado ficam na layer circle; ícones HTML são markers
        (typeof pontos !== "undefined" ? pontos : []).filter((p) => !resolvePontoIconUrl(p, iconesConfig))
      ));
      setSourceData(map, SOURCE_IDS.DESENHO, buildDesenhoCollection(pts, tipoDesenho, marker));
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
    [itemEditando, tipoDesenho, pontos, iconesConfig]
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

    const onZoom = () => {
      zoomingRef.current = true;
      syncDivisaWidth(map);
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

  // Sync GeoJSON + labels/ícones
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    if (!map.isStyleLoaded()) return;

    const editingId = itemEditando?.id || null;
    setSourceData(
      map,
      SOURCE_IDS.AREAS,
      buildAreasCollection(areas, { hideFillForId: tipoDesenho === "area" ? editingId : null })
    );
    setSourceData(map, SOURCE_IDS.LINHAS, buildLinhasCollection(linhas));

    clearLabels();

    const pontosSemIcone = [];
    pontos.forEach((ponto) => {
      const v = parseVertex(ponto.coordenadas);
      if (!v) return;
      const url = resolvePontoIconUrl(ponto, iconesConfig);
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
    setSourceData(map, SOURCE_IDS.PONTOS, buildPontosCollection(pontosSemIcone));

    areas.forEach((area) => {
      if (editingId && area.id === editingId && tipoDesenho === "area") return;
      const ring = parseVertices(area.coordenadas?.coords);
      if (ring.length < 3) return;
      let lat = 0;
      let lng = 0;
      ring.forEach((p) => {
        lat += p.lat;
        lng += p.lng;
      });
      lat /= ring.length;
      lng /= ring.length;
      const el = document.createElement("div");
      el.className = "pointer-events-none whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.02em] text-white";
      el.style.textShadow = "0 1px 3px rgba(0,0,0,0.95)";
      el.textContent = area.nome || area.numero_area || "ÁREA";
      const marker = new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([lng, lat])
        .addTo(map);
      labelsRef.current.push(marker);
    });
  }, [areas, pontos, linhas, iconesConfig, mapReady, itemEditando, tipoDesenho, clearLabels]);

  // Sync desenho atual
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady || !tipoDesenho) return;
    if (!map.isStyleLoaded()) return;

    setSourceData(map, SOURCE_IDS.DESENHO, buildDesenhoCollection(currentPoints, tipoDesenho, currentMarker));

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

    const MAX_CLICK_DURATION = 400;
    const MAX_CLICK_DISTANCE = 10;
    const canvas = map.getCanvas();
    let downPos = null;
    let downTime = 0;

    const handleAddPoint = (latLng) => {
      if (!latLng) return;
      if (drawingClosedRef.current) return;
      if (zoomingRef.current) return;

      if (tipoDesenho === "area" && isNearFirstVertex(map, latLng, currentPointsRef.current, 20)) {
        setDrawingClosed(true);
        toast.success("Área fechada! Ajuste os pontos ou clique Salvar.", { duration: 2000 });
        return;
      }

      let { lat, lng } = latLng;
      const snapped = findNearestSnap(map, latLng, {
        areas: areasRef.current,
        linhas: linhasRef.current,
        enabled: snappingRef.current,
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
      if (hitEditLayers(map, x, y, [LAYER_IDS.VERTICES, LAYER_IDS.MIDPOINTS])) return;

      const ll = map.unproject([x, y]);
      handleAddPoint({ lat: ll.lat, lng: ll.lng });
    };

    canvas.addEventListener("pointerdown", onDown, { passive: true });
    canvas.addEventListener("pointerup", onUp, { passive: true });

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
    };
  }, [tipoDesenho, mapReady, itemEditando, drawingClosed, syncHistoryUi]);

  // Guia elástica
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return undefined;
    if (!(tipoDesenho === "area" || tipoDesenho === "linha") || itemEditando) return undefined;

    if (drawingClosed) {
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
      const snapped = findNearestSnap(map, target, {
        areas: areasRef.current,
        linhas: linhasRef.current,
        enabled: snappingRef.current,
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
  }, [mapReady, tipoDesenho, itemEditando, snappingEnabled, drawingClosed]);

  // Drag vértices/midpoints — pointer + touch (R5-03, R5-04)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady || !tipoDesenho) return undefined;
    const canDrag = drawingClosed || !!itemEditando || tipoDesenho === "ponto";
    if (!canDrag) return undefined;

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

      let target = lngLat ? { lat: lngLat.lat, lng: lngLat.lng } : null;
      if (target) {
        const snapped = findNearestSnap(map, target, {
          areas: areasRef.current,
          linhas: linhasRef.current,
          enabled: snappingRef.current,
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
      const feats = map.queryRenderedFeatures(e.point, { layers });
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
      };
    };

    const onPointerMove = (e) => {
      const st = dragStateRef.current;
      if (!st) return;
      let target = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      const snapped = findNearestSnap(map, target, {
        areas: areasRef.current,
        linhas: linhasRef.current,
        enabled: snappingRef.current,
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

    const onWindowPointerUp = () => {
      if (!dragStateRef.current) return;
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
  }, [mapReady, tipoDesenho, drawingClosed, itemEditando, syncHistoryUi]);

  const trocarBasemap = (id) => {
    if (id === BASEMAP_IDS.SATELITE) {
      const sat = getSatelliteProvider();
      if (!sat.configured) {
        toast.message(mensagemSateliteNaoConfigurado(), {
          description: "Defina VITE_MAP_SATELLITE_STYLE_URL com um style URL licenciado.",
        });
        return;
      }
    }
    const map = mapInstanceRef.current;
    if (!map) return;
    styleSwapCancelRef.current?.cancel?.();
    setBasemapId(id);
    styleSwapCancelRef.current = applyBasemapStyle(map, id, {
      onReady: () => {
        if (!mountedRef.current) return;
        rehydrateAllSources(map);
        // Reaplicar labels/ícones HTML
        clearLabels();
      },
      onError: () => {
        if (!mountedRef.current) return;
        toast.error("Falha ao trocar o mapa-base.");
        setBasemapId(BASEMAP_IDS.RUAS);
      },
    });
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

  /** Retry via epoch — teardown completo no cleanup do effect (R5-06) */
  const retryMap = () => {
    setMapError(null);
    setMapReady(false);
    if (mapRef.current) mapRef.current.innerHTML = "";
    setMapEpoch((n) => n + 1);
  };

  const crosshair = tipoDesenho && mapReady && !itemEditando && !drawingClosed;

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
            cursor: crosshair ? "crosshair" : "default",
            touchAction: "manipulation",
          }}
          className={crosshair ? "[&_*]:cursor-crosshair" : ""}
        />

        <Button
          onClick={onCancelar}
          variant="secondary"
          size="icon"
          className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 text-secondary-foreground absolute top-1 left-1 z-20 h-7 w-7 rounded-full bg-white/90 backdrop-blur-sm shadow-lg hover:bg-white"
        >
          <X className="w-6 h-6 text-slate-700" />
        </Button>

        <div className="absolute top-4 right-4 z-20 flex items-center gap-1">
          <Button
            variant={basemapId === BASEMAP_IDS.RUAS ? "default" : "secondary"}
            size="sm"
            onClick={() => trocarBasemap(BASEMAP_IDS.RUAS)}
            className="w-9 bg-background text-[hsl(var(--foreground))] px-7 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground active:bg-black active:text-white h-7"
          >
            Mapa
          </Button>
          <Button
            variant={basemapId === BASEMAP_IDS.SATELITE ? "default" : "secondary"}
            size="sm"
            onClick={() => trocarBasemap(BASEMAP_IDS.SATELITE)}
            title={getSatelliteProvider().configured ? "Satélite" : mensagemSateliteNaoConfigurado()}
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
            title={snappingEnabled ? "Ímã ativado" : "Ímã desativado"}
            aria-label="Alternar ímã"
          >
            <span className="text-base leading-none">🧲</span>
          </Button>
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
            {tipoDesenho === "area" && currentPoints.length >= 3 && (
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
                <div className="bg-black/70 text-white px-3 py-1.5 rounded text-sm font-semibold">
                  Área: {formatHectaresPt(areaHectares(currentPoints))} ha
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
              {itemEditando && (
                <div className="bg-black/70 text-white px-4 py-2 rounded-lg text-xs font-semibold">
                  Arraste os pontos para ajustar
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
                      toast.success("Desenho reiniciado", { duration: 1000 });
                    }}
                  >
                    Reiniciar
                  </Button>
                )}

                <Button
                  variant="outline"
                  size="sm"
                  className="bg-background text-[hsl(var(--foreground))] px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground h-7"
                  onClick={() => {
                    if (undoStackRef.current.length > 0) {
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
