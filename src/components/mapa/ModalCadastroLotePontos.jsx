import React, { useEffect, useMemo, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { X, Check, Trash2, Target, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import useSetorAreas from "@/hooks/useSetorAreas";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const GOOGLE_MAPS_API_KEY = "AIzaSyB-PfoOotwVlkAzt72cBgYE2tl4vJuqFe8";

const loadGoogleMapsScript = () => {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) { resolve(); return; }
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=drawing,geometry`;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

const applyMarkerIconPreservingAspectRatio = (marker, iconUrl, baseSize = 44) => {
  if (!marker || !iconUrl || !window.google?.maps) return;
  const image = new Image();
  image.onload = () => {
    const w = image.naturalWidth || baseSize;
    const h = image.naturalHeight || baseSize;
    const ratio = w / h;
    const width = ratio >= 1 ? baseSize : Math.max(20, Math.round(baseSize * ratio));
    const height = ratio >= 1 ? Math.max(20, Math.round(baseSize / ratio)) : baseSize;
    marker.setIcon({ url: iconUrl, scaledSize: new google.maps.Size(width, height), anchor: new google.maps.Point(width / 2, height / 2) });
  };
  image.src = iconUrl;
};

const createPoint = (coords) => ({
  tempId: crypto.randomUUID(),
  nome: "",
  sigla: "",
  tipo: "",
  observacoes: "",
  setor_id: "",
  coordenadas: coords,
});

export default function ModalCadastroLotePontos({ open, onOpenChange }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const { setores } = useSetorAreas(empresaSelecionadaId);

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const polygonsRef = useRef([]);
  const existingMarkersRef = useRef([]);
  const polylinesRef = useRef([]);
  const newMarkersRef = useRef([]);
  const hasCenteredRef = useRef(false);
  const zoomingRef = useRef(false);

  const [mapReady, setMapReady] = useState(false);
  const [mapType, setMapType] = useState("satellite");
  const [snappingEnabled, setSnappingEnabled] = useState(true);
  const [pontos, setPontos] = useState([]);
  const [activePointId, setActivePointId] = useState(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data: areas = [] } = useQuery({
    queryKey: ["areas", empresaSelecionadaId],
    queryFn: async () => { const all = await base44.entities.AreaPastagem.list(); return all.filter((a) => a.empresa_id === empresaSelecionadaId && a.ativo !== false); },
    enabled: !!empresaSelecionadaId,
  });

  const { data: pontosExistentes = [] } = useQuery({
    queryKey: ["pontos", empresaSelecionadaId],
    queryFn: async () => { const all = await base44.entities.PontoReferencia.list(); return all.filter((p) => p.empresa_id === empresaSelecionadaId && p.ativo !== false); },
    enabled: !!empresaSelecionadaId,
  });

  const { data: linhas = [] } = useQuery({
    queryKey: ["linhas", empresaSelecionadaId],
    queryFn: async () => { const all = await base44.entities.LinhaGeografica.list(); return all.filter((l) => l.empresa_id === empresaSelecionadaId && l.ativo !== false); },
    enabled: !!empresaSelecionadaId,
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["configuracao-icones", empresaSelecionadaId],
    queryFn: async () => { const all = await base44.entities.ConfiguracaoIcone.list(); return all.filter((i) => i.tipo_entidade === "Ponto" && i.ativo !== false); },
    enabled: !!empresaSelecionadaId,
  });

  const activePoint = useMemo(() => pontos.find((p) => p.tempId === activePointId) || null, [pontos, activePointId]);

  const updatePoint = (tempId, changes) => {
    setPontos((prev) => prev.map((item) => (item.tempId === tempId ? { ...item, ...changes } : item)));
  };

  const removePoint = (tempId) => {
    setPontos((prev) => {
      const next = prev.filter((item) => item.tempId !== tempId);
      if (activePointId === tempId) {
        const newActive = next[0]?.tempId || null;
        setActivePointId(newActive);
        if (!newActive) setSheetOpen(false);
      }
      return next;
    });
  };

  const SNAP_DISTANCE = 16;

  const findNearestPoint = (mouseLatLng, map) => {
    if (!snappingEnabled) return null;
    const projection = map.getProjection();
    if (!projection) return null;
    const scale = Math.pow(2, map.getZoom());
    const mousePoint = projection.fromLatLngToPoint(mouseLatLng);
    const mx = mousePoint.x * scale;
    const my = mousePoint.y * scale;
    let nearestPoint = null;
    let minPixelDist = Infinity;

    const evaluateVertex = (lat, lng) => {
      const pt = projection.fromLatLngToPoint(new google.maps.LatLng(lat, lng));
      const dx = pt.x * scale - mx;
      const dy = pt.y * scale - my;
      const pixelDist = Math.sqrt(dx * dx + dy * dy);
      if (pixelDist < SNAP_DISTANCE && pixelDist < minPixelDist) { minPixelDist = pixelDist; nearestPoint = { lat, lng }; }
    };

    const evaluateSegment = (latA, lngA, latB, lngB) => {
      const pA = projection.fromLatLngToPoint(new google.maps.LatLng(latA, lngA));
      const pB = projection.fromLatLngToPoint(new google.maps.LatLng(latB, lngB));
      const ax = pA.x * scale, ay = pA.y * scale, bx = pB.x * scale, by = pB.y * scale;
      const abx = bx - ax, aby = by - ay, lenSq = abx * abx + aby * aby;
      if (lenSq === 0) return;
      let t = ((mx - ax) * abx + (my - ay) * aby) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const projX = ax + t * abx, projY = ay + t * aby;
      const dx = projX - mx, dy = projY - my;
      const pixelDist = Math.sqrt(dx * dx + dy * dy);
      if (pixelDist < SNAP_DISTANCE && pixelDist < minPixelDist) {
        minPixelDist = pixelDist;
        const worldPt = new google.maps.Point(projX / scale, projY / scale);
        const ll = projection.fromPointToLatLng(worldPt);
        nearestPoint = { lat: ll.lat(), lng: ll.lng() };
      }
    };

    const processCoords = (coords, isPolygon) => {
      const parsed = coords.map((c) => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      parsed.forEach((p) => evaluateVertex(p.lat, p.lng));
      for (let i = 0; i < parsed.length - 1; i++) evaluateSegment(parsed[i].lat, parsed[i].lng, parsed[i + 1].lat, parsed[i + 1].lng);
      if (isPolygon && parsed.length >= 3) evaluateSegment(parsed[parsed.length - 1].lat, parsed[parsed.length - 1].lng, parsed[0].lat, parsed[0].lng);
    };

    areas.forEach((area) => { const coords = area.coordenadas?.coords || []; if (coords.length >= 2) processCoords(coords, true); });
    linhas.forEach((linha) => { const coords = linha.coordenadas?.coords || []; if (coords.length >= 2) processCoords(coords, false); });
    return nearestPoint;
  };

  // === INIT MAP ===
  useEffect(() => {
    if (!open) {
      // Cleanup on close
      setPontos([]);
      setActivePointId(null);
      setSheetOpen(false);
      hasCenteredRef.current = false;
      newMarkersRef.current.forEach((m) => m.setMap(null));
      newMarkersRef.current = [];
      polygonsRef.current.forEach((p) => p.setMap(null));
      polygonsRef.current = [];
      existingMarkersRef.current.forEach((m) => m.setMap(null));
      existingMarkersRef.current = [];
      polylinesRef.current.forEach((l) => l.setMap(null));
      polylinesRef.current = [];
      mapInstanceRef.current = null;
      setMapReady(false);
      return;
    }

    loadGoogleMapsScript().then(() => {
      if (!mapRef.current) return;
      // Always create a fresh map instance when opening
      const map = new google.maps.Map(mapRef.current, {
        center: { lat: -15.0067, lng: -59.9533 },
        zoom: 17,
        mapTypeId: "satellite",
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: "greedy",
        zoomControl: false,
        disableDoubleClickZoom: true,
        clickableIcons: false,
      });

      mapInstanceRef.current = map;

      google.maps.event.addListenerOnce(map, "tilesloaded", () => {
        setTimeout(() => setMapReady(true), 100);
      });
    }).catch(() => toast.error("Erro ao carregar mapa"));
  }, [open]);

  // === ZOOM BLOCK ===
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    const zs = google.maps.event.addListener(mapInstanceRef.current, "zoom_changed", () => {
      zoomingRef.current = true;
      setTimeout(() => { zoomingRef.current = false; }, 400);
    });
    return () => google.maps.event.removeListener(zs);
  }, [mapReady]);

  // === MAP TYPE ===
  useEffect(() => {
    if (mapInstanceRef.current) mapInstanceRef.current.setMapTypeId(mapType);
  }, [mapType]);

  // === CENTER ON AREAS ===
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady || hasCenteredRef.current) return;
    if (areas.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      let hasValid = false;
      areas.forEach((area) => {
        (area.coordenadas?.coords || []).forEach((c) => {
          const lat = c[0] || c.lat, lng = c[1] || c.lng;
          if (lat && lng) { bounds.extend({ lat, lng }); hasValid = true; }
        });
      });
      if (hasValid) {
        mapInstanceRef.current.fitBounds(bounds, { padding: 20 });
        hasCenteredRef.current = true;
      }
    }
  }, [areas, mapReady]);

  // === RENDER EXISTING DATA ===
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;

    polygonsRef.current.forEach((p) => p.setMap(null));
    existingMarkersRef.current.forEach((m) => m.setMap(null));
    polylinesRef.current.forEach((l) => l.setMap(null));
    polygonsRef.current = [];
    existingMarkersRef.current = [];
    polylinesRef.current = [];

    areas.forEach((area) => {
      const coords = area.coordenadas?.coords || [];
      if (coords.length < 3) return;
      const paths = coords.map((c) => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      const cor = area.coordenadas?.cor || area.cor || "#10b981";
      const polygon = new google.maps.Polygon({ paths, strokeColor: cor, strokeOpacity: 0.5, strokeWeight: 1.5, fillColor: cor, fillOpacity: 0.15, clickable: false });
      polygon.setMap(mapInstanceRef.current);
      polygonsRef.current.push(polygon);
    });

    pontosExistentes.forEach((ponto) => {
      const coords = ponto.coordenadas || {};
      if (!coords.lat || !coords.lng) return;
      const marker = new google.maps.Marker({
        position: { lat: coords.lat, lng: coords.lng },
        map: mapInstanceRef.current,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#0066ff", fillOpacity: 0.5, strokeColor: "#ffffff", strokeWeight: 2 },
        clickable: false,
      });
      if (ponto.icone_url) applyMarkerIconPreservingAspectRatio(marker, ponto.icone_url, 44);
      existingMarkersRef.current.push(marker);
    });

    linhas.forEach((linha) => {
      const coords = linha.coordenadas?.coords || [];
      if (coords.length < 2) return;
      const paths = coords.map((c) => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      const cor = linha.coordenadas?.cor || linha.cor || "#f59e0b";
      const polyline = new google.maps.Polyline({ path: paths, strokeColor: cor, strokeOpacity: 0.5, strokeWeight: 2, clickable: false });
      polyline.setMap(mapInstanceRef.current);
      polylinesRef.current.push(polyline);
    });
  }, [areas, pontosExistentes, linhas, mapReady]);

  // Track which marker tempIds exist so click handler can check
  const pontosRef = useRef([]);
  useEffect(() => { pontosRef.current = pontos; }, [pontos]);

  // === CLICK HANDLER ===
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;

    const MAX_CLICK_DURATION = 400;
    const MAX_CLICK_DISTANCE = 10;
    const mapDiv = mapInstanceRef.current.getDiv();
    let downPos = null;
    let downTime = 0;

    const isClickOnExistingNewMarker = (latLng) => {
      const map = mapInstanceRef.current;
      const projection = map.getProjection();
      if (!projection) return null;
      const scale = Math.pow(2, map.getZoom());
      const clickPt = projection.fromLatLngToPoint(latLng);
      const cx = clickPt.x * scale, cy = clickPt.y * scale;

      for (const ponto of pontosRef.current) {
        if (!ponto.coordenadas) continue;
        const pt = projection.fromLatLngToPoint(new google.maps.LatLng(ponto.coordenadas.lat, ponto.coordenadas.lng));
        const dx = pt.x * scale - cx, dy = pt.y * scale - cy;
        if (Math.sqrt(dx * dx + dy * dy) < 20) return ponto.tempId;
      }
      return null;
    };

    const onDown = (ev) => { downPos = { x: ev.clientX, y: ev.clientY }; downTime = Date.now(); };
    const onUp = (ev) => {
      if (!downPos) return;
      const elapsed = Date.now() - downTime;
      const dx = ev.clientX - downPos.x, dy = ev.clientY - downPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      downPos = null;
      if (elapsed > MAX_CLICK_DURATION || dist > MAX_CLICK_DISTANCE) return;
      if (zoomingRef.current) return;

      const map = mapInstanceRef.current;
      const bounds = map.getBounds();
      const projection = map.getProjection();
      if (!bounds || !projection) return;

      const topRight = projection.fromLatLngToPoint(bounds.getNorthEast());
      const bottomLeft = projection.fromLatLngToPoint(bounds.getSouthWest());
      const scale = Math.pow(2, map.getZoom());
      const mapRect = mapDiv.getBoundingClientRect();
      const pixelX = ev.clientX - mapRect.left;
      const pixelY = ev.clientY - mapRect.top;
      const worldX = pixelX / scale + bottomLeft.x;
      const worldY = pixelY / scale + topRight.y;
      const worldPoint = new google.maps.Point(worldX, worldY);
      const latLng = projection.fromPointToLatLng(worldPoint);

      // Check if clicked on an existing new marker — just select it
      const existingId = isClickOnExistingNewMarker(latLng);
      if (existingId) {
        setActivePointId(existingId);
        setSheetOpen(true);
        return;
      }

      let lat = latLng.lat();
      let lng = latLng.lng();
      const snapped = findNearestPoint(latLng, map);
      if (snapped) { lat = snapped.lat; lng = snapped.lng; toast.success("🧲 Encaixado!", { duration: 600 }); }

      const novo = createPoint({ lat, lng });
      setPontos((prev) => [...prev, novo]);
      setActivePointId(novo.tempId);
      setSheetOpen(true);
    };

    mapDiv.addEventListener("pointerdown", onDown, { passive: true });
    mapDiv.addEventListener("pointerup", onUp, { passive: true });

    const dblClickListener = google.maps.event.addListener(mapInstanceRef.current, "dblclick", (e) => { if (e?.stop) e.stop(); });

    return () => {
      mapDiv.removeEventListener("pointerdown", onDown);
      mapDiv.removeEventListener("pointerup", onUp);
      google.maps.event.removeListener(dblClickListener);
    };
  }, [mapReady, snappingEnabled, areas, linhas]);

  // === RENDER NEW MARKERS ===
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;

    newMarkersRef.current.forEach((m) => m.setMap(null));
    newMarkersRef.current = [];

    pontos.forEach((ponto, index) => {
      if (!ponto.coordenadas) return;
      const ativo = ponto.tempId === activePointId;
      const marker = new google.maps.Marker({
        position: ponto.coordenadas,
        map: mapInstanceRef.current,
        draggable: true,
        label: { text: String(index + 1), color: "#ffffff", fontSize: "11px", fontWeight: "700" },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: ativo ? 11 : 9,
          fillColor: ativo ? "#16a34a" : "#dc2626",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
        zIndex: 2000,
      });

      marker.addListener("click", () => { setActivePointId(ponto.tempId); setSheetOpen(true); });
      marker.addListener("dragend", (event) => {
        let lat = event.latLng.lat(), lng = event.latLng.lng();
        const snapped = findNearestPoint(event.latLng, mapInstanceRef.current);
        if (snapped) { lat = snapped.lat; lng = snapped.lng; toast.success("🧲 Encaixado!", { duration: 600 }); }
        updatePoint(ponto.tempId, { coordenadas: { lat, lng } });
      });

      newMarkersRef.current.push(marker);
    });
  }, [pontos, activePointId, mapReady]);

  // === SAVE ===
  const saveMutation = useMutation({
    mutationFn: async () => {
      const pontosValidos = pontos.filter((item) => item.nome && item.tipo && item.coordenadas);
      if (!pontosValidos.length) throw new Error("Preencha nome e tipo de pelo menos um ponto.");

      const existentes = await base44.entities.PontoReferencia.list();
      const maxNum = existentes.reduce((max, p) => Math.max(max, parseInt(p.numero_ponto) || 0), 0);

      const payload = pontosValidos.map((item, index) => {
        const configIcone = iconesConfig.find((ic) => ic.categoria === item.tipo);
        return {
          empresa_id: empresaSelecionadaId,
          numero_ponto: String(maxNum + index + 1),
          nome: item.nome.toUpperCase(),
          sigla: item.sigla?.toUpperCase() || "",
          tipo: item.tipo,
          observacoes: item.observacoes?.toUpperCase() || "",
          configuracao_icone_id: configIcone?.id || null,
          icone_url: configIcone?.icone_url || null,
          sub_icone_url: configIcone?.sub_icone_url || null,
          cor: configIcone?.cor_padrao || "#0066ff",
          setor_id: item.setor_id || null,
          ativo: true,
          coordenadas: item.coordenadas,
        };
      });

      return base44.entities.PontoReferencia.bulkCreate(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && ["pontos", "mapa-pontos"].includes(q.queryKey[0]) });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success("Pontos salvos com sucesso.");
      onOpenChange(false);
    },
    onError: (error) => toast.error(error.message || "Erro ao salvar."),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] bg-white">
      {/* MAPA */}
      <div className="w-full h-full relative">
        <div
          ref={mapRef}
          style={{ height: "100%", width: "100%", backgroundColor: "#e5e7eb", cursor: mapReady ? "crosshair" : "default", touchAction: "manipulation" }}
          className={mapReady ? "[&_*]:cursor-crosshair" : ""}
        />

        {/* Fechar */}
        <Button onClick={() => onOpenChange(false)} variant="secondary" size="icon" className="absolute top-4 left-4 z-20 h-12 w-12 rounded-full bg-white/90 backdrop-blur-sm shadow-lg hover:bg-white">
          <X className="w-6 h-6 text-slate-700" />
        </Button>

        {/* Controles */}
        <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
          <Button variant={mapType === "roadmap" ? "default" : "secondary"} size="sm" onClick={() => setMapType("roadmap")} className="h-9 px-3 text-xs bg-white/90 backdrop-blur-sm shadow-lg">Mapa</Button>
          <Button variant={mapType === "satellite" ? "default" : "secondary"} size="sm" onClick={() => setMapType("satellite")} className="h-9 px-3 text-xs bg-white/90 backdrop-blur-sm shadow-lg">Satélite</Button>
          <Button variant="secondary" size="icon" onClick={() => {
            if (navigator.geolocation) {
              navigator.geolocation.getCurrentPosition(
                (pos) => { mapInstanceRef.current?.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude }); mapInstanceRef.current?.setZoom(18); },
                () => toast.error("Erro ao obter localização")
              );
            }
          }} className="h-9 w-9 bg-white/90 backdrop-blur-sm shadow-lg" title="Minha localização">
            <Target className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSnappingEnabled(!snappingEnabled)}
            className={snappingEnabled ? "h-8 w-8 bg-emerald-600 hover:bg-emerald-700 text-white flex justify-center" : "h-8 w-8 flex justify-center"}
            title={snappingEnabled ? "Ímã ativado" : "Ímã desativado"}
          >
            <span className="text-base leading-none">🧲</span>
          </Button>
        </div>

        {/* Loading */}
        {!mapReady && (
          <div className="absolute top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white px-6 py-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="h-6 w-6 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
              <span className="font-semibold text-slate-700">Carregando mapa...</span>
            </div>
          </div>
        )}

        {/* Toolbar inferior */}
        {mapReady && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2">
            {pontos.length === 0 && (
              <div className="bg-black/70 text-white px-4 py-2 rounded-lg text-xs font-semibold">
                📍 Toque no mapa para marcar vários pontos
              </div>
            )}
            <div className="flex items-center gap-2 bg-white/90 backdrop-blur-sm px-2 py-1.5 rounded-full shadow-lg border border-slate-200">
              {pontos.length > 0 && (
                <Button variant="outline" size="sm" className="h-8 text-xs text-red-600 border-red-200 hover:bg-red-50" onClick={() => {
                  newMarkersRef.current.forEach((m) => m.setMap(null));
                  newMarkersRef.current = [];
                  setPontos([]);
                  setActivePointId(null);
                  setSheetOpen(false);
                }}>
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Reiniciar
                </Button>
              )}
              <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" disabled={pontos.length === 0 || saveMutation.isPending}
                onClick={() => saveMutation.mutate()}>
                <Check className="w-3.5 h-3.5 mr-1.5" /> {saveMutation.isPending ? "Salvando..." : `Salvar todos (${pontos.length})`}
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* SHEET LATERAL - mesmo estilo do FormularioPonto */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-[320px] sm:w-[400px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Cadastro em Lote</SheetTitle>
          </SheetHeader>

          {/* Lista de pontos */}
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600 uppercase">{pontos.length} ponto(s) marcado(s)</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {pontos.map((item, index) => (
                <button
                  key={item.tempId}
                  type="button"
                  onClick={() => setActivePointId(item.tempId)}
                  className={`rounded-md border px-2 py-1 text-xs transition-colors ${activePointId === item.tempId ? "border-emerald-600 bg-emerald-50 text-emerald-700 font-semibold" : "border-slate-200 bg-white text-slate-600"}`}
                >
                  {item.nome || `Ponto ${index + 1}`}
                </button>
              ))}
            </div>
          </div>

          {/* Formulário do ponto ativo */}
          {activePoint && (
            <div className="mt-4 rounded-xl border bg-card text-card-foreground shadow-sm border-slate-300">
              <div className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-900">Novo Ponto</div>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => removePoint(activePoint.tempId)}>
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </div>
              </div>
              <div className="p-1 space-y-0.5">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
                  <div>
                    <label className="text-[12px] text-slate-500 pl-1 leading-none">Nome do ponto<span className="text-red-500 ml-0.5">*</span></label>
                    <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors">
                      <Input value={activePoint.nome} onChange={(e) => updatePoint(activePoint.tempId, { nome: e.target.value })} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[12px] text-slate-500 pl-1 leading-none">Sigla</label>
                    <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors">
                      <Input value={activePoint.sigla} onChange={(e) => updatePoint(activePoint.tempId, { sigla: e.target.value })} className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" maxLength={10} />
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-[12px] text-slate-500 pl-1 leading-none">Ponto de referência<span className="text-red-500 ml-0.5">*</span></label>
                  <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors">
                    <Select value={activePoint.tipo} onValueChange={(value) => updatePoint(activePoint.tempId, { tipo: value })}>
                      <SelectTrigger className="h-7 text-xs border-0 shadow-none focus:ring-0 bg-transparent">
                        <SelectValue placeholder="Selecione o tipo do ponto" />
                      </SelectTrigger>
                      <SelectContent>
                        {iconesConfig.map((item) => (
                          <SelectItem key={item.id} value={item.categoria} className="text-xs">{item.categoria}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <label className="text-[12px] text-slate-500 pl-1 leading-none">Observações</label>
                  <div className="rounded-md border border-slate-300 focus-within:border-emerald-500 transition-colors">
                    <Textarea value={activePoint.observacoes} onChange={(e) => updatePoint(activePoint.tempId, { observacoes: e.target.value })} rows={3} className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}