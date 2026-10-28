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
  areaHectares,
  comprimentoMetros,
  formatHectaresPt,
  formatDistanciaPt,
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
import { findNearestSnap, isNearAnyVertex } from "@/lib/maplibre/snap.js";

/** @returns {GeoJSON.FeatureCollection} */
const emptyFc = () => /** @type {GeoJSON.FeatureCollection} */ ({ type: "FeatureCollection", features: [] });

export default function MapaDesenho({ tipoDesenho, usarGPS = false, itemEditando, onSalvar, onCancelar }) {
  const [mapReady, setMapReady] = useState(false);
  const [mapError, setMapError] = useState(null);
  /** @type {[string, React.Dispatch<React.SetStateAction<string>>]} */
  const [basemapId, setBasemapId] = useState(/** @type {string} */ (BASEMAP_IDS.RUAS));
  const [snappingEnabled, setSnappingEnabled] = useState(true);

  const [currentPoints, setCurrentPoints] = useState([]);
  const [currentMarker, setCurrentMarker] = useState(null);
  const [drawingClosed, setDrawingClosed] = useState(false);

  const [showFormularioArea, setShowFormularioArea] = useState(usarGPS && tipoDesenho === "area");
  const [showFormularioPonto, setShowFormularioPonto] = useState(usarGPS && tipoDesenho === "ponto");
  const [showFormularioLinha, setShowFormularioLinha] = useState(usarGPS && tipoDesenho === "linha");

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const disposeRef = useRef(null);
  const labelsRef = useRef([]);
  const iconMarkersRef = useRef([]);
  const currentPointsRef = useRef([]);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const snappingRef = useRef(snappingEnabled);
  const drawingClosedRef = useRef(drawingClosed);
  const zoomingRef = useRef(false);
  const hasCenteredRef = useRef(false);
  const dragStateRef = useRef(null);
  const areasRef = useRef([]);
  const linhasRef = useRef([]);

  useEffect(() => {
    currentPointsRef.current = currentPoints;
  }, [currentPoints]);
  useEffect(() => {
    snappingRef.current = snappingEnabled;
  }, [snappingEnabled]);
  useEffect(() => {
    drawingClosedRef.current = drawingClosed;
  }, [drawingClosed]);

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
    setCurrentPoints([]);
    setCurrentMarker(null);
    setDrawingClosed(false);
  }, []);

  // Init MapLibre once
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;
    let cancelled = false;
    setMapError(null);

    let created;
    try {
      created = createEditorMap(mapRef.current, {
        basemapId: BASEMAP_IDS.RUAS,
        center: CENTRO_PADRAO,
        zoom: 17,
      });
    } catch (err) {
      setMapError(err?.message || "Falha ao criar mapa (WebGL?)");
      toast.error("Erro ao carregar mapa.");
      return undefined;
    }

    mapInstanceRef.current = created.map;
    disposeRef.current = created.dispose;

    const map = created.map;

    const onLoad = () => {
      if (cancelled || created.getCancelled()) return;
      try {
        ensureBusinessLayers(map);
        syncDivisaWidth(map);
        setMapReady(true);
      } catch (err) {
        setMapError(err?.message || "Falha ao preparar camadas");
        toast.error("Erro ao preparar o mapa.");
      }
    };

    const onError = (e) => {
      const msg = e?.error?.message || e?.message || "Erro de estilo/tiles";
      if (/style|tile|fetch|network|xhr/i.test(String(msg))) {
        setMapError("Falha ao carregar o estilo ou tiles do mapa. Verifique a rede e tente novamente.");
      }
    };

    map.on("load", onLoad);
    map.on("error", onError);
    map.on("zoom", () => {
      zoomingRef.current = true;
      syncDivisaWidth(map);
      window.setTimeout(() => {
        zoomingRef.current = false;
      }, 400);
    });

    return () => {
      cancelled = true;
      map.off("load", onLoad);
      map.off("error", onError);
      clearLabels();
      disposeRef.current?.();
      disposeRef.current = null;
      mapInstanceRef.current = null;
      setMapReady(false);
    };
  }, [clearLabels]);

  // Carregar item em edição
  useEffect(() => {
    if (itemEditando && tipoDesenho === "area" && itemEditando.coordenadas?.coords) {
      const coords = parseVertices(itemEditando.coordenadas.coords);
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
      const coords = parseVertices(itemEditando.coordenadas.coords);
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

  // Centralizar nas áreas
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

  // Sync GeoJSON sources + labels
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
    setSourceData(map, SOURCE_IDS.PONTOS, buildPontosCollection(pontos));

    clearLabels();
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

    // Ícones customizados de pontos (HTML marker) — sem centenas de listeners Google
    pontos.forEach((ponto) => {
      const v = parseVertex(ponto.coordenadas);
      if (!v || !ponto.icone_url) return;
      const cfg = (iconesConfig || []).find((c) => c.tipo === ponto.tipo);
      const url = ponto.icone_url || cfg?.icone_url;
      if (!url) return;
      const img = document.createElement("img");
      img.src = url;
      img.alt = ponto.nome || "";
      img.style.width = "44px";
      img.style.height = "auto";
      img.style.pointerEvents = "none";
      const marker = new maplibregl.Marker({ element: img, anchor: "center" })
        .setLngLat([v.lng, v.lat])
        .addTo(map);
      iconMarkersRef.current.push(marker);
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
      if (canEditVerts) {
        setSourceData(map, SOURCE_IDS.MIDPOINTS, buildMidpointsCollection(currentPoints, tipoDesenho));
      } else {
        setSourceData(map, SOURCE_IDS.MIDPOINTS, emptyFc());
      }
    } else if (tipoDesenho === "ponto" && currentMarker) {
      setSourceData(map, SOURCE_IDS.VERTICES, buildVerticesCollection([currentMarker]));
      setSourceData(map, SOURCE_IDS.MIDPOINTS, emptyFc());
    } else {
      setSourceData(map, SOURCE_IDS.VERTICES, emptyFc());
      setSourceData(map, SOURCE_IDS.MIDPOINTS, emptyFc());
    }
  }, [currentPoints, currentMarker, tipoDesenho, drawingClosed, itemEditando, mapReady]);

  // Clique para adicionar pontos (pointer filtering)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !tipoDesenho || !mapReady || itemEditando) return;

    const MAX_CLICK_DURATION = 400;
    const MAX_CLICK_DISTANCE = 10;
    const canvas = map.getCanvas();
    let downPos = null;
    let downTime = 0;

    const handleAddPoint = (latLng) => {
      if (!latLng) return;
      if (drawingClosedRef.current) return;
      if (zoomingRef.current) return;

      if (tipoDesenho === "area" && isNearAnyVertex(map, latLng, currentPointsRef.current, 20)) {
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
          undoStackRef.current.push(prev);
          redoStackRef.current = [];
          const updated = [...prev, newPoint];
          toast.success(`Ponto ${updated.length} adicionado`, { duration: 800 });
          return updated;
        });
      }
    };

    const onDown = (ev) => {
      downPos = { x: ev.clientX, y: ev.clientY };
      downTime = Date.now();
    };

    const onUp = (ev) => {
      if (!downPos) return;
      const elapsed = Date.now() - downTime;
      const dx = ev.clientX - downPos.x;
      const dy = ev.clientY - downPos.y;
      const dist = Math.hypot(dx, dy);
      downPos = null;
      if (elapsed > MAX_CLICK_DURATION || dist > MAX_CLICK_DISTANCE) return;
      if (zoomingRef.current) return;
      if (dragStateRef.current) return;

      // Não adicionar se clicou em vértice/midpoint (edição)
      const feats = map.queryRenderedFeatures(map.project([
        // use event relative to canvas
      ]));
      void feats;

      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      const hit = map.queryRenderedFeatures([x, y], {
        layers: [LAYER_IDS.VERTICES, LAYER_IDS.MIDPOINTS].filter((id) => map.getLayer(id)),
      });
      if (hit.length > 0) return;

      const ll = map.unproject([x, y]);
      handleAddPoint({ lat: ll.lat, lng: ll.lng });
    };

    canvas.addEventListener("pointerdown", onDown, { passive: true });
    canvas.addEventListener("pointerup", onUp, { passive: true });

    return () => {
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
    };
  }, [tipoDesenho, mapReady, itemEditando, drawingClosed]);

  // Guia elástica
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady) return;
    if (!(tipoDesenho === "area" || tipoDesenho === "linha") || itemEditando) return;

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

  // Drag vértices / midpoints / ponto
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !mapReady || !tipoDesenho) return;
    const canDrag = drawingClosed || !!itemEditando || tipoDesenho === "ponto";
    if (!canDrag) return;

    const onMouseDown = (e) => {
      const layers = [LAYER_IDS.VERTICES, LAYER_IDS.MIDPOINTS].filter((id) => map.getLayer(id));
      const feats = map.queryRenderedFeatures(e.point, { layers });
      if (!feats.length) return;
      const f = feats[0];
      const role = f.properties?.role;
      const index = Number(f.properties?.index);
      e.preventDefault();
      map.dragPan.disable();
      dragStateRef.current = { role, index };
    };

    const onMouseMove = (e) => {
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

    const onMouseUp = (e) => {
      const st = dragStateRef.current;
      if (!st) return;
      map.dragPan.enable();

      let target = { lat: e.lngLat.lat, lng: e.lngLat.lng };
      const snapped = findNearestSnap(map, target, {
        areas: areasRef.current,
        linhas: linhasRef.current,
        enabled: snappingRef.current,
      });
      if (snapped) {
        target = snapped;
        toast.success("Encaixado!", { duration: 600 });
      }

      if (st.role === "midpoint" && (tipoDesenho === "area" || tipoDesenho === "linha")) {
        const insertAfter = st.index;
        setCurrentPoints((prev) => {
          undoStackRef.current.push(prev);
          redoStackRef.current = [];
          const updated = [...prev];
          updated.splice(insertAfter + 1, 0, target);
          return updated;
        });
        toast.success("Novo ponto inserido", { duration: 800 });
      } else if (st.role === "vertex" && tipoDesenho !== "ponto") {
        setCurrentPoints((prev) => {
          const updated = [...prev];
          if (updated[st.index]) updated[st.index] = target;
          return updated;
        });
        toast.success(`Ponto ${st.index + 1} reposicionado`, { duration: 800 });
      } else if (tipoDesenho === "ponto") {
        setCurrentMarker(target);
      }

      dragStateRef.current = null;
    };

    map.on("mousedown", LAYER_IDS.VERTICES, onMouseDown);
    map.on("mousedown", LAYER_IDS.MIDPOINTS, onMouseDown);
    map.on("mousemove", onMouseMove);
    map.on("mouseup", onMouseUp);

    return () => {
      map.off("mousedown", LAYER_IDS.VERTICES, onMouseDown);
      map.off("mousedown", LAYER_IDS.MIDPOINTS, onMouseDown);
      map.off("mousemove", onMouseMove);
      map.off("mouseup", onMouseUp);
      map.dragPan.enable();
      dragStateRef.current = null;
    };
  }, [mapReady, tipoDesenho, drawingClosed, itemEditando]);

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
    setBasemapId(id);
    applyBasemapStyle(map, id, {
      onReady: () => {
        // Re-sync data after style swap
        setSourceData(
          map,
          SOURCE_IDS.AREAS,
          buildAreasCollection(areas, {
            hideFillForId: tipoDesenho === "area" ? itemEditando?.id : null,
          })
        );
        setSourceData(map, SOURCE_IDS.LINHAS, buildLinhasCollection(linhas));
        setSourceData(map, SOURCE_IDS.PONTOS, buildPontosCollection(pontos));
        setSourceData(map, SOURCE_IDS.DESENHO, buildDesenhoCollection(currentPoints, tipoDesenho, currentMarker));
        setSourceData(map, SOURCE_IDS.VERTICES, buildVerticesCollection(
          tipoDesenho === "ponto" && currentMarker ? [currentMarker] : currentPoints
        ));
      },
      onError: () => {
        toast.error("Falha ao trocar o mapa-base.");
        setBasemapId(BASEMAP_IDS.RUAS);
      },
    });
  };

  const finalizarDesenho = () => {
    if (tipoDesenho === "area") {
      if (currentPoints.length < 3) {
        toast.error("Desenhe pelo menos 3 pontos!");
        return;
      }
      setShowFormularioArea(true);
    } else if (tipoDesenho === "linha") {
      if (currentPoints.length < 2) {
        toast.error("Desenhe pelo menos 2 pontos!");
        return;
      }
      setShowFormularioLinha(true);
    }
  };

  const retryMap = () => {
    setMapError(null);
    setMapReady(false);
    disposeRef.current?.();
    disposeRef.current = null;
    mapInstanceRef.current = null;
    // Force remount via key-less re-init: clear container and re-run effect by toggling
    if (mapRef.current) {
      mapRef.current.innerHTML = "";
    }
    try {
      const created = createEditorMap(mapRef.current, {
        basemapId: BASEMAP_IDS.RUAS,
        center: CENTRO_PADRAO,
        zoom: 17,
      });
      mapInstanceRef.current = created.map;
      disposeRef.current = created.dispose;
      created.map.once("load", () => {
        ensureBusinessLayers(created.map);
        syncDivisaWidth(created.map);
        setMapReady(true);
      });
      created.map.on("error", () => {
        setMapError("Falha ao carregar o estilo ou tiles do mapa. Verifique a rede e tente novamente.");
      });
    } catch (err) {
      setMapError(err?.message || "Falha ao criar mapa");
    }
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
                      redoStackRef.current.push(currentPoints);
                      setCurrentPoints(prevPts);
                      toast.success("Desfeito");
                    }
                  }}
                  disabled={undoStackRef.current.length === 0}
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
                      undoStackRef.current.push(currentPoints);
                      setCurrentPoints(nextPts);
                      toast.success("Refeito");
                    }
                  }}
                  disabled={redoStackRef.current.length === 0}
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
                      if (tipoDesenho === "area") setShowFormularioArea(true);
                      else if (tipoDesenho === "linha") setShowFormularioLinha(true);
                      else if (tipoDesenho === "ponto") setShowFormularioPonto(true);
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
