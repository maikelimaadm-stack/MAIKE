/* global google */
import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { listarAreasAtivas, listarPontosAtivos, listarLinhasAtivas, listarIconesPorTipoEntidade, listarTodosPontos, listarTodosPontosSuplementacao, criarPonto, criarPontoSuplementacao } from "@/services/mapaService";
import { criarLocal } from "@/services/estoqueMapaService";
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
  SheetTitle } from
"@/components/ui/sheet";
import FormularioPonto from "./FormularioPonto";
import { loadGoogleMaps } from "@/lib/googleMaps";

const loadGoogleMapsScript = () => loadGoogleMaps();

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

function getAreaLabelContent(text) {
  return (
    <div className="pointer-events-none whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.02em] text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.95)]">
      {text}
    </div>);

}

function createAreaLabelOverlay({ map, position, text }) {
  class LabelOverlay extends google.maps.OverlayView {
    onAdd() {
      const div = document.createElement("div");
      div.style.position = "absolute";
      div.style.transform = "translate(-50%, -50%)";
      div.style.pointerEvents = "none";
      const root = createRoot(div);
      root.render(getAreaLabelContent(text));
      this.div = div;
      this.root = root;
      this.getPanes()?.overlayLayer?.appendChild(div);
    }

    draw() {
      if (!this.div) return;
      const projection = this.getProjection();
      const point = projection?.fromLatLngToDivPixel(position);
      if (!point) return;
      this.div.style.left = `${point.x}px`;
      this.div.style.top = `${point.y}px`;
    }

    onRemove() {
      this.root?.unmount();
      if (this.div?.parentNode) {
        this.div.parentNode.removeChild(this.div);
      }
      this.div = null;
      this.root = null;
    }
  }

  const overlay = new LabelOverlay();
  overlay.setMap(map);
  return overlay;
}

const createPoint = (coords, lastPoint = null, detectedArea = null, detectedDepositoId = "") => ({
  tempId: crypto.randomUUID(),
  nome: "",
  sigla: "",
  tipo: lastPoint?.tipo || "",
  observacoes: lastPoint?.observacoes || "",
  setor_id: detectedArea?.setor_id || "",
  coordenadas: coords,
  configuracao_icone_id: lastPoint?.configuracao_icone_id || "",
  produto_padrao: lastPoint?.produto_padrao || "",
  capacidade_cocho_kg: lastPoint?.capacidade_cocho_kg || "",
  metragem_cocho_m: lastPoint?.metragem_cocho_m || "",
  cobertura_cocho: lastPoint?.cobertura_cocho || "",
  consumo_ideal_por_cabeca_kg: lastPoint?.consumo_ideal_por_cabeca_kg || "",
  limite_minimo_consumo: lastPoint?.limite_minimo_consumo || "",
  limite_maximo_consumo: lastPoint?.limite_maximo_consumo || "",
  dias_alerta_reposicao: lastPoint?.dias_alerta_reposicao || "3",
  estoque_minimo_kg: lastPoint?.estoque_minimo_kg || "",
  alerta_sem_lancamento_dias: lastPoint?.alerta_sem_lancamento_dias || "10",
  area_vinculada_id: detectedArea?.id || "",
  area_vinculada_ids: detectedArea?.id ? [detectedArea.id] : [],
  deposito_origem_id: detectedDepositoId || "",
  suggested_deposito_id: detectedDepositoId || "",
  tipo_categoria: lastPoint?.tipo_categoria || ""
});

export default function ModalCadastroLotePontos({ open, onOpenChange }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const { setores } = useSetorAreas(empresaSelecionadaId);

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const polygonsRef = useRef([]);
  const areaLabelsRef = useRef([]);
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
    queryFn: () => listarAreasAtivas(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId
  });

  const { data: pontosExistentes = [] } = useQuery({
    queryKey: ["pontos", empresaSelecionadaId],
    queryFn: () => listarPontosAtivos(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId
  });

  const { data: linhas = [] } = useQuery({
    queryKey: ["linhas", empresaSelecionadaId],
    queryFn: () => listarLinhasAtivas(empresaSelecionadaId),
    enabled: !!empresaSelecionadaId
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["configuracao-icones", empresaSelecionadaId],
    queryFn: () => listarIconesPorTipoEntidade("Ponto"),
    enabled: !!empresaSelecionadaId
  });

  const { data: pontosSuplementacao = [] } = useQuery({
    queryKey: ["pontos-suplementacao-lote", empresaSelecionadaId],
    queryFn: async () => {
      const all = await listarTodosPontosSuplementacao();
      return all.filter((ponto) => ponto.empresa_id === empresaSelecionadaId && ponto.status === "Ativo");
    },
    enabled: !!empresaSelecionadaId
  });

  const activePoint = useMemo(() => pontos.find((p) => p.tempId === activePointId) || null, [pontos, activePointId]);

  const updatePoint = (tempId, changes) => {
    setPontos((prev) => prev.map((item) => item.tempId === tempId ? { ...item, ...changes } : item));
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

  const depositosDisponiveis = useMemo(() => {
    return pontosSuplementacao.filter((ponto) => ponto.categoria_ponto === "DEPOSITO" && ponto.coordenadas?.lat && ponto.coordenadas?.lng);
  }, [pontosSuplementacao]);

  const detectNearestDeposito = (pontoCoords) => {
    if (!window.google?.maps?.geometry?.spherical || !pontoCoords || !depositosDisponiveis.length) return "";

    let nearestId = "";
    let minDistance = Infinity;

    depositosDisponiveis.forEach((deposito) => {
      const distance = google.maps.geometry.spherical.computeDistanceBetween(
        new google.maps.LatLng(pontoCoords.lat, pontoCoords.lng),
        new google.maps.LatLng(deposito.coordenadas.lat, deposito.coordenadas.lng)
      );
      if (distance < minDistance) {
        minDistance = distance;
        nearestId = deposito.id;
      }
    });

    return minDistance <= 20 ? nearestId : "";
  };

  const detectAreaByCoords = (pontoCoords) => {
    if (!pontoCoords || !areas.length) return null;

    for (const area of areas) {
      const areaCoords = area.coordenadas?.coords || [];
      if (areaCoords.length < 3) continue;

      const polygon = areaCoords.map((coord) => ({ lat: coord[0] || coord.lat, lng: coord[1] || coord.lng }));
      let inside = false;
      for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].lat;
        const yi = polygon[i].lng;
        const xj = polygon[j].lat;
        const yj = polygon[j].lng;
        const intersect = yi > pontoCoords.lng !== yj > pontoCoords.lng && pontoCoords.lat < (xj - xi) * (pontoCoords.lng - yi) / (yj - yi) + xi;
        if (intersect) inside = !inside;
      }
      if (inside) return area;
    }

    return null;
  };

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
      if (pixelDist < SNAP_DISTANCE && pixelDist < minPixelDist) {minPixelDist = pixelDist;nearestPoint = { lat, lng };}
    };

    const evaluateSegment = (latA, lngA, latB, lngB) => {
      const pA = projection.fromLatLngToPoint(new google.maps.LatLng(latA, lngA));
      const pB = projection.fromLatLngToPoint(new google.maps.LatLng(latB, lngB));
      const ax = pA.x * scale,ay = pA.y * scale,bx = pB.x * scale,by = pB.y * scale;
      const abx = bx - ax,aby = by - ay,lenSq = abx * abx + aby * aby;
      if (lenSq === 0) return;
      let t = ((mx - ax) * abx + (my - ay) * aby) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const projX = ax + t * abx,projY = ay + t * aby;
      const dx = projX - mx,dy = projY - my;
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

    areas.forEach((area) => {const coords = area.coordenadas?.coords || [];if (coords.length >= 2) processCoords(coords, true);});
    linhas.forEach((linha) => {const coords = linha.coordenadas?.coords || [];if (coords.length >= 2) processCoords(coords, false);});
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
      areaLabelsRef.current.forEach((label) => label.setMap(null));
      polygonsRef.current = [];
      areaLabelsRef.current = [];
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
        clickableIcons: false
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
      setTimeout(() => {zoomingRef.current = false;}, 400);
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
          const lat = c[0] || c.lat,lng = c[1] || c.lng;
          if (lat && lng) {bounds.extend({ lat, lng });hasValid = true;}
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
    areaLabelsRef.current.forEach((label) => label.setMap(null));
    existingMarkersRef.current.forEach((m) => m.setMap(null));
    polylinesRef.current.forEach((l) => l.setMap(null));
    polygonsRef.current = [];
    areaLabelsRef.current = [];
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

      const boundsArea = new google.maps.LatLngBounds();
      paths.forEach((point) => boundsArea.extend(point));
      const center = boundsArea.getCenter();
      const overlay = createAreaLabelOverlay({
        map: mapInstanceRef.current,
        position: center,
        text: area.nome || area.numero_area || "ÁREA"
      });
      areaLabelsRef.current.push(overlay);
    });

    pontosExistentes.forEach((ponto) => {
      const coords = ponto.coordenadas || {};
      if (!coords.lat || !coords.lng) return;
      const marker = new google.maps.Marker({
        position: { lat: coords.lat, lng: coords.lng },
        map: mapInstanceRef.current,
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#0066ff", fillOpacity: 0.5, strokeColor: "#ffffff", strokeWeight: 2 },
        clickable: false
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
  useEffect(() => {pontosRef.current = pontos;}, [pontos]);

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
      const cx = clickPt.x * scale,cy = clickPt.y * scale;

      for (const ponto of pontosRef.current) {
        if (!ponto.coordenadas) continue;
        const pt = projection.fromLatLngToPoint(new google.maps.LatLng(ponto.coordenadas.lat, ponto.coordenadas.lng));
        const dx = pt.x * scale - cx,dy = pt.y * scale - cy;
        if (Math.sqrt(dx * dx + dy * dy) < 20) return ponto.tempId;
      }
      return null;
    };

    const onDown = (ev) => {downPos = { x: ev.clientX, y: ev.clientY };downTime = Date.now();};
    const onUp = (ev) => {
      if (!downPos) return;
      const elapsed = Date.now() - downTime;
      const dx = ev.clientX - downPos.x,dy = ev.clientY - downPos.y;
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

      if (window.__markerClicked) return;

      let lat = latLng.lat();
      let lng = latLng.lng();
      const snapped = findNearestPoint(latLng, map);
      if (snapped) {lat = snapped.lat;lng = snapped.lng;toast.success("🧲 Encaixado!", { duration: 600 });}

      const ultimoPonto = pontosRef.current.length > 0 ? pontosRef.current[pontosRef.current.length - 1] : null;
      const areaDetectada = detectAreaByCoords({ lat, lng });
      const depositoDetectadoId = detectNearestDeposito({ lat, lng });
      const novo = createPoint({ lat, lng }, ultimoPonto, areaDetectada, depositoDetectadoId);
      setPontos((prev) => [...prev, novo]);
      setActivePointId(novo.tempId);
      setSheetOpen(true);
    };

    mapDiv.addEventListener("pointerdown", onDown, { passive: true });
    mapDiv.addEventListener("pointerup", onUp, { passive: true });

    const dblClickListener = google.maps.event.addListener(mapInstanceRef.current, "dblclick", (e) => {if (e?.stop) e.stop();});

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
          strokeWeight: 2
        },
        zIndex: 2000
      });

      marker.addListener("click", () => {
        window.__markerClicked = true;
        setTimeout(() => {window.__markerClicked = false;}, 300);
        setActivePointId(ponto.tempId);
        setSheetOpen(true);
      });
      marker.addListener("dragend", (event) => {
        let lat = event.latLng.lat(),lng = event.latLng.lng();
        const snapped = findNearestPoint(event.latLng, mapInstanceRef.current);
        if (snapped) {lat = snapped.lat;lng = snapped.lng;toast.success("🧲 Encaixado!", { duration: 600 });}
        updatePoint(ponto.tempId, {
          coordenadas: { lat, lng },
          suggested_deposito_id: detectNearestDeposito({ lat, lng })
        });
      });

      newMarkersRef.current.push(marker);
    });
  }, [pontos, activePointId, mapReady]);

  // === SAVE ===
  const saveMutation = useMutation({
    mutationFn: async () => {
      const pontosValidos = pontos.filter((item) => item.nome && item.tipo && item.coordenadas);
      if (!pontosValidos.length) throw new Error("Preencha nome e tipo de pelo menos um ponto.");

      const existentes = await listarTodosPontos();
      const maxNum = existentes.reduce((max, p) => Math.max(max, parseInt(p.numero_ponto) || 0), 0);

      // Suplementacao Data
      const pontosSuplementacaoEmpresa = await listarTodosPontosSuplementacao();
      const pontosAtivosEmpresa = pontosSuplementacaoEmpresa.filter((p) => p.empresa_id === empresaSelecionadaId && p.status === "Ativo");
      const maiorNumero = pontosAtivosEmpresa.reduce((max, p) => Math.max(max, parseInt(String(p.numero_ponto || "").replace(/\D/g, "")) || 0), 0);

      let offsetSuplementacao = 1;

      for (let index = 0; index < pontosValidos.length; index++) {
        const item = pontosValidos[index];
        const configIcone = iconesConfig.find((ic) => ic.categoria === item.tipo) || iconesConfig.find((ic) => ic.id === item.configuracao_icone_id);

        await criarPonto({
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
          ativo: true,
          coordenadas: item.coordenadas
        });

        if (item.tipo_categoria === "DEPOSITO" || item.tipo_categoria === "COCHO") {
          let localEstoqueId = null;
          let localEstoqueNome = null;

          if (item.tipo_categoria === "DEPOSITO") {
            const descricaoLocal = `DEPÓSITO DE SUPLEMENTAÇÃO - ${item.nome.toUpperCase()}`;
            const localCriado = await criarLocal({ nome: item.nome.toUpperCase(), descricao: descricaoLocal });
            localEstoqueId = localCriado.id;
            localEstoqueNome = localCriado.nome;
          }

          const prefixo = item.tipo_categoria === "DEPOSITO" ? "DEP" : "COCHO";
          const areasVinculadas = areas.filter((area) => (item.area_vinculada_ids || []).includes(area.id));
          const areaVinculadaPrincipal = areasVinculadas[0] || null;
          const setorSelecionado = setores.find((setor) => setor.id === item.setor_id);

          let deposito_origem_nome = null;
          if (item.tipo_categoria === "COCHO" && item.deposito_origem_id) {
            const existingDep = pontosAtivosEmpresa.find((p) => p.id === item.deposito_origem_id);
            if (existingDep) deposito_origem_nome = existingDep.nome_ponto;
          }

          await criarPontoSuplementacao({
            empresa_id: empresaSelecionadaId,
            numero_ponto: `${prefixo}-${String(maiorNumero + offsetSuplementacao).padStart(4, "0")}`,
            setor_id: item.setor_id || null,
            setor_nome: setorSelecionado?.nome || null,
            nome_ponto: item.nome.toUpperCase(),
            sigla: item.sigla?.toUpperCase() || "",
            categoria_ponto: item.tipo_categoria,
            tipo: item.tipo,
            produto_padrao: item.tipo_categoria === "COCHO" ? item.produto_padrao || null : null,
            capacidade_cocho_kg: item.capacidade_cocho_kg ? parseFloat(item.capacidade_cocho_kg) : null,
            metragem_cocho_m: item.tipo_categoria === "COCHO" && item.metragem_cocho_m ? parseFloat(item.metragem_cocho_m) : null,
            cobertura_cocho: item.tipo_categoria === "COCHO" ? item.cobertura_cocho || null : null,
            area_vinculada_id: item.tipo_categoria === "COCHO" ? areaVinculadaPrincipal?.id || null : null,
            area_vinculada_nome: item.tipo_categoria === "COCHO" ? areaVinculadaPrincipal?.nome || "" : null,
            area_vinculada_ids: item.tipo_categoria === "COCHO" ? item.area_vinculada_ids || [] : [],
            area_vinculada_nomes: item.tipo_categoria === "COCHO" ? areasVinculadas.map((a) => a.nome) : [],
            deposito_origem_id: item.tipo_categoria === "COCHO" ? item.deposito_origem_id || null : null,
            deposito_origem_nome: deposito_origem_nome,
            local_estoque_id: item.tipo_categoria === "DEPOSITO" ? localEstoqueId : null,
            local_estoque_nome: item.tipo_categoria === "DEPOSITO" ? localEstoqueNome : null,
            coordenadas: item.coordenadas,
            status: "Ativo",
            observacoes: item.observacoes?.toUpperCase() || null,
            consumo_ideal_por_cabeca_kg: item.tipo_categoria === "COCHO" && item.consumo_ideal_por_cabeca_kg ? parseFloat(item.consumo_ideal_por_cabeca_kg) : null,
            limite_minimo_consumo: item.tipo_categoria === "COCHO" && item.limite_minimo_consumo ? parseFloat(item.limite_minimo_consumo) : null,
            limite_maximo_consumo: item.tipo_categoria === "COCHO" && item.limite_maximo_consumo ? parseFloat(item.limite_maximo_consumo) : null,
            dias_alerta_reposicao: item.tipo_categoria === "COCHO" && item.dias_alerta_reposicao ? parseInt(item.dias_alerta_reposicao) : 3,
            estoque_minimo_kg: item.tipo_categoria === "DEPOSITO" && item.estoque_minimo_kg ? parseFloat(item.estoque_minimo_kg) : null,
            alerta_sem_lancamento_dias: item.tipo_categoria === "COCHO" ? parseInt(item.alerta_sem_lancamento_dias || 10) : null
          });

          offsetSuplementacao++;
        }
      }
      return true;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && ["pontos", "mapa-pontos", "pontos-suplementacao", "pontos-suplementacao-form"].includes(q.queryKey[0]) });
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
      toast.success("Pontos salvos com sucesso.");
      onOpenChange(false);
    },
    onError: (error) => toast.error(error.message || "Erro ao salvar.")
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-white">
      {/* MAPA */}
      <div className="w-full h-full relative">
        <div
          ref={mapRef}
          style={{ height: "100%", width: "100%", backgroundColor: "#e5e7eb", cursor: mapReady ? "crosshair" : "default", touchAction: "manipulation" }}
          className={mapReady ? "[&_*]:cursor-crosshair" : ""} />
        

        {/* Fechar */}
        <Button onClick={() => onOpenChange(false)} variant="secondary" size="icon" className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 text-secondary-foreground absolute top-1 left-1 z-20 h-7 w-7 rounded-full bg-white/90 backdrop-blur-sm shadow-lg hover:bg-white">
          <X className="w-6 h-6 text-slate-700" />
        </Button>

        {/* Controles */}
        <div className="absolute top-4 right-4 z-20 flex items-center gap-1">
          <Button variant={mapType === "roadmap" ? "default" : "secondary"} size="sm" onClick={() => setMapType("roadmap")} className="w-9 bg-background text-[hsl(var(--foreground))] px-7 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground active:bg-black active:text-white h-7">Mapa</Button>
          <Button variant={mapType === "satellite" ? "default" : "secondary"} size="sm" onClick={() => setMapType("satellite")} className="w-9 bg-background text-[hsl(var(--foreground))] px-7 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground active:bg-black active:text-white h-7">Satélite</Button>
          <Button variant="secondary" size="icon" onClick={() => {
            if (navigator.geolocation) {
              navigator.geolocation.getCurrentPosition(
                (pos) => {mapInstanceRef.current?.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });mapInstanceRef.current?.setZoom(18);},
                () => toast.error("Erro ao obter localização")
              );
            }
          }} className="w-9 bg-background text-[hsl(var(--foreground))] px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground active:bg-black active:text-white h-7" title="Minha localização">
            <Target className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setSnappingEnabled(!snappingEnabled)} className="w-9 bg-background text-[hsl(var(--foreground))] px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground active:bg-black active:text-white h-7"

          title={snappingEnabled ? "Ímã ativado" : "Ímã desativado"}>
            
            <span className="text-base leading-none">🧲</span>
          </Button>
        </div>

        {/* Loading */}
        {!mapReady &&
        <div className="absolute top-1/2 left-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-lg bg-white px-6 py-4 shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="h-6 w-6 animate-spin rounded-full border-4 border-emerald-600 border-t-transparent" />
              <span className="font-semibold text-slate-700">Carregando mapa...</span>
            </div>
          </div>
        }

        {/* Toolbar inferior */}
        {mapReady &&
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2">
            {pontos.length === 0 &&
          <div className="bg-black/70 text-white px-4 py-2 rounded-lg text-xs font-semibold">
                📍 Toque no mapa para marcar vários pontos
              </div>
          }
            <div className="flex items-center gap-1 bg-white/90 backdrop-blur-sm px-2 py-1.5 rounded-full shadow-lg border border-slate-200">
              {pontos.length > 0 &&
            <Button variant="outline" size="sm" className="bg-background text-[hsl(var(--foreground))] px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground h-7" onClick={() => {
              newMarkersRef.current.forEach((m) => m.setMap(null));
              newMarkersRef.current = [];
              setPontos([]);
              setActivePointId(null);
              setSheetOpen(false);
            }}>
                   Reiniciar
                </Button>
            }
              <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white" disabled={pontos.length === 0 || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}>
                 {saveMutation.isPending ? "Salvando..." : `Salvar todos (${pontos.length})`}
              </Button>
            </div>
          </div>
        }
      </div>

      {/* SHEET LATERAL - mesmo estilo do FormularioPonto */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="bg-background px-1 py-1 fixed z-50 gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out inset-y-0 right-0 h-full border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm w-[320px] sm:w-[400px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Cadastro em Lote</SheetTitle>
          </SheetHeader>

          {/* Lista de pontos */}
          <div className="mt-1 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-600 uppercase">{pontos.length} ponto(s) marcado(s)</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {pontos.map((item, index) =>
              <button
                key={item.tempId}
                type="button"
                onClick={() => setActivePointId(item.tempId)}
                className={`rounded-md border px-2 py-1 text-xs transition-colors ${activePointId === item.tempId ? "border-emerald-600 bg-emerald-50 text-emerald-700 font-semibold" : "border-slate-200 bg-white text-slate-600"}`}>
                
                  {item.nome || `Ponto ${index + 1}`}
                </button>
              )}
            </div>
          </div>

          {/* Formulário do ponto ativo */}
          {activePoint &&
          <div className="relative mt-2">
              <Button
              type="button"
              variant="ghost"
              size="icon" className=" inline-flex items-center justify-center gap-1 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 hover:text-accent-foreground absolute right-1 top-1 z-10 h-6 w-6 hover:bg-red-100"

              onClick={() => removePoint(activePoint.tempId)}
              title="Remover ponto do lote">
              
                <Trash2 className="w-4 h-4 text-red-600" />
              </Button>
              <FormularioPonto
              item={activePoint}
              coordenadas={activePoint.coordenadas}
              suggestedDepositoId={activePoint.suggested_deposito_id || ""}
              onBatchUpdate={(data) => {
                updatePoint(activePoint.tempId, data);
                toast.success("Ponto configurado no lote!");
              }}
              onCancel={() => setSheetOpen(false)} />
            
            </div>
          }
        </SheetContent>
      </Sheet>
    </div>);

}