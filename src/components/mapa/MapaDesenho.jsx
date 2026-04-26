/* global google */
import React, { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Map, Square, MapPin, Minus, Layers, X, Edit, Eye, ArrowLeft, Target, RotateCcw, RotateCw, Check, RefreshCw } from "lucide-react";
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

const GOOGLE_MAPS_API_KEY = "AIzaSyB-PfoOotwVlkAzt72cBgYE2tl4vJuqFe8";

const loadGoogleMapsScript = () => {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) {
      resolve();
      return;
    }
    const script = document.createElement('script');
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
    const widthRatio = image.naturalWidth || baseSize;
    const heightRatio = image.naturalHeight || baseSize;
    const ratio = widthRatio / heightRatio;
    const width = ratio >= 1 ? baseSize : Math.max(20, Math.round(baseSize * ratio));
    const height = ratio >= 1 ? Math.max(20, Math.round(baseSize / ratio)) : baseSize;
    marker.setIcon({
      url: iconUrl,
      scaledSize: new google.maps.Size(width, height),
      anchor: new google.maps.Point(width / 2, height / 2)
    });
  };
  image.src = iconUrl;
};

function getAreaLabelContent(text) {
  return (
    <div className="pointer-events-none whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.02em] text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.95)]">
      {text}
    </div>);

}

function getAreaLabelOverlay(map, position, text) {
  class AreaLabelOverlay extends google.maps.OverlayView {
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

  const overlay = new AreaLabelOverlay();
  overlay.setMap(map);
  return overlay;
}

export default function MapaDesenho({ tipoDesenho, usarGPS = false, itemEditando, onSalvar, onCancelar }) {
  const [mapReady, setMapReady] = useState(false);
  const [mapType, setMapType] = useState('satellite');
  const [snappingEnabled, setSnappingEnabled] = useState(true);

  const [currentPoints, setCurrentPoints] = useState([]);
  const [currentMarker, setCurrentMarker] = useState(null);
  const [drawingClosed, setDrawingClosed] = useState(false);

  const [showFormularioArea, setShowFormularioArea] = useState(usarGPS && tipoDesenho === 'area');
  const [showFormularioPonto, setShowFormularioPonto] = useState(usarGPS && tipoDesenho === 'ponto');
  const [showFormularioLinha, setShowFormularioLinha] = useState(usarGPS && tipoDesenho === 'linha');

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const polygonsRef = useRef([]);
  const areaLabelsRef = useRef([]);
  const markersRef = useRef([]);
  const polylinesRef = useRef([]);
  const currentPolygonRef = useRef(null);
  const currentPolylineRef = useRef(null);
  const tempMarkerRef = useRef(null);
  const guideLineRef = useRef(null);
  const mouseMoveListenerRef = useRef(null);
  const currentPointsRef = useRef([]);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);

  const pointMarkersRef = useRef([]);
  const midPointMarkersRef = useRef([]);
  const mouseDownPosRef = useRef(null);
  const mouseDownTimeRef = useRef(0);
  const CLOSE_SNAP_PX = 20; // distância em pixels para fechar polígono clicando no ponto 1

  useEffect(() => {
    currentPointsRef.current = currentPoints;
  }, [currentPoints]);

  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: areas = [] } = useQuery({
    queryKey: ['areas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter((a) => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: pontos = [] } = useQuery({
    queryKey: ['pontos', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PontoReferencia.list();
      return all.filter((p) => p.empresa_id === empresaSelecionadaId && p.ativo !== false);
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: linhas = [] } = useQuery({
    queryKey: ['linhas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LinhaGeografica.list();
      return all.filter((l) => l.empresa_id === empresaSelecionadaId && l.ativo !== false);
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((i) => i.empresa_id === empresaSelecionadaId && i.ativo !== false);
    },
    enabled: !!empresaSelecionadaId
  });

  const SNAP_DISTANCE = 16; // snap em pixels

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

    // Helper: avaliar um ponto (vértice)
    const evaluateVertex = (lat, lng) => {
      const pt = projection.fromLatLngToPoint(new google.maps.LatLng(lat, lng));
      const dx = pt.x * scale - mx;
      const dy = pt.y * scale - my;
      const pixelDist = Math.sqrt(dx * dx + dy * dy);
      if (pixelDist < SNAP_DISTANCE && pixelDist < minPixelDist) {
        minPixelDist = pixelDist;
        nearestPoint = { lat, lng };
      }
    };

    // Helper: avaliar projeção no segmento entre A e B
    const evaluateSegment = (latA, lngA, latB, lngB) => {
      const pA = projection.fromLatLngToPoint(new google.maps.LatLng(latA, lngA));
      const pB = projection.fromLatLngToPoint(new google.maps.LatLng(latB, lngB));
      const ax = pA.x * scale,ay = pA.y * scale;
      const bx = pB.x * scale,by = pB.y * scale;
      const abx = bx - ax,aby = by - ay;
      const lenSq = abx * abx + aby * aby;
      if (lenSq === 0) return;
      let t = ((mx - ax) * abx + (my - ay) * aby) / lenSq;
      t = Math.max(0, Math.min(1, t));
      const projX = ax + t * abx;
      const projY = ay + t * aby;
      const dx = projX - mx;
      const dy = projY - my;
      const pixelDist = Math.sqrt(dx * dx + dy * dy);
      if (pixelDist < SNAP_DISTANCE && pixelDist < minPixelDist) {
        minPixelDist = pixelDist;
        // Converter pixel de volta para LatLng
        const worldPt = new google.maps.Point(projX / scale, projY / scale);
        const ll = projection.fromPointToLatLng(worldPt);
        nearestPoint = { lat: ll.lat(), lng: ll.lng() };
      }
    };

    const processCoords = (coords, isPolygon) => {
      const parsed = coords.map((c) => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      // Vértices primeiro (prioridade)
      parsed.forEach((p) => evaluateVertex(p.lat, p.lng));
      // Segmentos
      for (let i = 0; i < parsed.length - 1; i++) {
        evaluateSegment(parsed[i].lat, parsed[i].lng, parsed[i + 1].lat, parsed[i + 1].lng);
      }
      // Fechar polígono
      if (isPolygon && parsed.length >= 3) {
        evaluateSegment(parsed[parsed.length - 1].lat, parsed[parsed.length - 1].lng, parsed[0].lat, parsed[0].lng);
      }
    };

    areas.forEach((area) => {
      const coords = area.coordenadas?.coords || [];
      if (coords.length >= 2) processCoords(coords, true);
    });

    linhas.forEach((linha) => {
      const coords = linha.coordenadas?.coords || [];
      if (coords.length >= 2) processCoords(coords, false);
    });

    return nearestPoint;
  };

  const cancelarDesenho = () => {
    if (currentPolygonRef.current) {
      currentPolygonRef.current.setMap(null);
      currentPolygonRef.current = null;
    }
    if (currentPolylineRef.current) {
      currentPolylineRef.current.setMap(null);
      currentPolylineRef.current = null;
    }
    if (tempMarkerRef.current) {
      tempMarkerRef.current.setMap(null);
      tempMarkerRef.current = null;
    }
    if (guideLineRef.current) {
      guideLineRef.current.setMap(null);
      guideLineRef.current = null;
    }
    if (mouseMoveListenerRef.current) {
      google.maps.event.removeListener(mouseMoveListenerRef.current);
      mouseMoveListenerRef.current = null;
    }

    pointMarkersRef.current.forEach((m) => m.setMap(null));
    pointMarkersRef.current = [];
    midPointMarkersRef.current.forEach((m) => m.setMap(null));
    midPointMarkersRef.current = [];

    undoStackRef.current = [];
    redoStackRef.current = [];

    setCurrentPoints([]);
    setCurrentMarker(null);
    setDrawingClosed(false);
  };

  // Carregar item em edição
  useEffect(() => {
    if (itemEditando && tipoDesenho === 'area' && itemEditando.coordenadas?.coords) {
      const coords = itemEditando.coordenadas.coords.map((c) => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      setCurrentPoints(coords);
      // Centralizar no polígono
      setTimeout(() => {
        if (mapInstanceRef.current && coords.length > 0) {
          const bounds = new google.maps.LatLngBounds();
          coords.forEach((c) => bounds.extend(c));
          mapInstanceRef.current.fitBounds(bounds, { padding: 80 });
        }
      }, 500);
    } else if (itemEditando && tipoDesenho === 'linha' && itemEditando.coordenadas?.coords) {
      const coords = itemEditando.coordenadas.coords.map((c) => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      setCurrentPoints(coords);
      // Centralizar na linha
      setTimeout(() => {
        if (mapInstanceRef.current && coords.length > 0) {
          const bounds = new google.maps.LatLngBounds();
          coords.forEach((c) => bounds.extend(c));
          mapInstanceRef.current.fitBounds(bounds, { padding: 80 });
        }
      }, 500);
    } else if (itemEditando && tipoDesenho === 'ponto' && itemEditando.coordenadas) {
      setCurrentMarker(itemEditando.coordenadas);
      // Mostrar marcador e centralizar
      setTimeout(() => {
        if (mapInstanceRef.current) {
          mapInstanceRef.current.setCenter(itemEditando.coordenadas);
          mapInstanceRef.current.setZoom(18);
          if (tempMarkerRef.current) {
            tempMarkerRef.current.setMap(null);
          }
          tempMarkerRef.current = new google.maps.Marker({
            position: itemEditando.coordenadas,
            map: mapInstanceRef.current,
            draggable: true
          });
          tempMarkerRef.current.addListener('dragend', (e) => {
            let latLng = e.latLng;
            const snap = findNearestPoint(latLng, mapInstanceRef.current);
            const newLat = snap ? snap.lat : latLng.lat();
            const newLng = snap ? snap.lng : latLng.lng();
            setCurrentMarker({ lat: newLat, lng: newLng });
            if (snap) toast.success('🧲 Encaixado!', { duration: 600 });
          });
        }
      }, 500);
    }
  }, [itemEditando, tipoDesenho]);

  useEffect(() => {
    loadGoogleMapsScript().then(() => {
      if (!mapRef.current || mapInstanceRef.current) return;

      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

      const map = new google.maps.Map(mapRef.current, {
        center: { lat: -15.0067, lng: -59.9533 },
        zoom: 17,
        mapTypeId: mapType,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: 'greedy',
        zoomControl: false,
        disableDoubleClickZoom: false,
        draggable: true,
        scrollwheel: true,
        disableDefaultUI: isMobile,
        clickableIcons: false
      });

      mapInstanceRef.current = map;

      google.maps.event.addListenerOnce(map, 'tilesloaded', () => {
        setTimeout(() => {
          setMapReady(true);
        }, 100);
      });
    }).catch((error) => {
      console.error('Erro ao carregar mapa:', error);
      toast.error('Erro ao carregar mapa.');
    });
  }, []);

  // Centralizar nas áreas cadastradas quando os dados estiverem disponíveis
  const hasCenteredRef = useRef(false);
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady || itemEditando || hasCenteredRef.current) return;

    if (areas.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      let hasValidCoords = false;

      areas.forEach((area) => {
        const coords = area.coordenadas?.coords || [];
        coords.forEach((c) => {
          const lat = c[0] || c.lat;
          const lng = c[1] || c.lng;
          if (lat && lng) {
            bounds.extend({ lat, lng });
            hasValidCoords = true;
          }
        });
      });

      if (hasValidCoords) {
        mapInstanceRef.current.fitBounds(bounds, { padding: 20 });
        const zoomAtual = mapInstanceRef.current.getZoom?.();
        if (typeof zoomAtual === 'number' && zoomAtual > 18) {
          mapInstanceRef.current.setZoom(18);
        }
        hasCenteredRef.current = true;
      }
    }
  }, [areas, mapReady, itemEditando]);

  useEffect(() => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setMapTypeId(mapType);
    }
  }, [mapType]);

  useEffect(() => {
    if (mapInstanceRef.current && mapReady) {
      renderMap();
    }
  }, [areas, pontos, linhas, iconesConfig, mapReady, itemEditando]);

  // Ref para bloquear cliques falsos após zoom
  const zoomingRef = useRef(false);
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    const zs = google.maps.event.addListener(mapInstanceRef.current, 'zoom_changed', () => {
      zoomingRef.current = true;
      setTimeout(() => {zoomingRef.current = false;}, 400);
    });
    return () => google.maps.event.removeListener(zs);
  }, [mapReady]);

  useEffect(() => {
    if (!mapInstanceRef.current || !tipoDesenho || !mapReady || itemEditando) return;

    const MAX_CLICK_DURATION = 400; // ms
    const MAX_CLICK_DISTANCE = 10; // pixels

    // Verifica se clicou perto de qualquer ponto existente (para fechar polígono)
    const isNearExistingPoint = (latLng) => {
      const pts = currentPointsRef.current;
      if (tipoDesenho !== 'area' || pts.length < 3) return false;
      const map = mapInstanceRef.current;
      const projection = map.getProjection();
      if (!projection) return false;
      const scale = Math.pow(2, map.getZoom());
      const click = projection.fromLatLngToPoint(latLng);
      for (let i = 0; i < pts.length; i++) {
        const pt = projection.fromLatLngToPoint(new google.maps.LatLng(pts[i].lat, pts[i].lng));
        const dx = (click.x - pt.x) * scale;
        const dy = (click.y - pt.y) * scale;
        if (Math.sqrt(dx * dx + dy * dy) < CLOSE_SNAP_PX) return true;
      }
      return false;
    };

    const handleAddPoint = (latLng) => {
      if (!latLng) return;
      if (drawingClosed) return;
      if (zoomingRef.current) return;

      // Verificar se deve fechar o polígono
      if (isNearExistingPoint(latLng)) {
        setDrawingClosed(true);
        toast.success('\u2705 Área fechada! Ajuste os pontos ou clique Salvar.', { duration: 2000 });
        return;
      }

      let lat = latLng.lat();
      let lng = latLng.lng();

      const snappedPoint = findNearestPoint(latLng, mapInstanceRef.current);
      if (snappedPoint) {
        lat = snappedPoint.lat;
        lng = snappedPoint.lng;
        toast.success('\ud83e\uddf2 Encaixado!', { duration: 600 });
      }

      if (tipoDesenho === 'ponto') {
        setCurrentMarker({ lat, lng });
        if (tempMarkerRef.current) {
          tempMarkerRef.current.setMap(null);
        }
        tempMarkerRef.current = new google.maps.Marker({
          position: { lat, lng },
          map: mapInstanceRef.current,
          draggable: true
        });
        tempMarkerRef.current.addListener('dragend', (ev) => {
          const snap = findNearestPoint(ev.latLng, mapInstanceRef.current);
          const newLat = snap ? snap.lat : ev.latLng.lat();
          const newLng = snap ? snap.lng : ev.latLng.lng();
          setCurrentMarker({ lat: newLat, lng: newLng });
          if (snap) toast.success('\ud83e\uddf2 Encaixado!', { duration: 600 });
        });
        setShowFormularioPonto(true);
      } else if (tipoDesenho === 'area' || tipoDesenho === 'linha') {
        const newPoint = { lat, lng };
        setCurrentPoints((prev) => {
          undoStackRef.current.push(prev);
          redoStackRef.current = [];
          const updated = [...prev, newPoint];
          toast.success(`\u2705 Ponto ${updated.length} adicionado`, { duration: 800 });
          return updated;
        });
      }
    };

    // Usar pointerdown/pointerup no DOM para filtrar arraste/zoom vs clique real
    const mapDiv = mapInstanceRef.current.getDiv();
    let downPos = null;
    let downTime = 0;

    const onDown = (ev) => {
      downPos = { x: ev.clientX, y: ev.clientY };
      downTime = Date.now();
    };

    const onUp = (ev) => {
      if (!downPos) return;
      const elapsed = Date.now() - downTime;
      const dx = ev.clientX - downPos.x;
      const dy = ev.clientY - downPos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      downPos = null;
      if (elapsed > MAX_CLICK_DURATION || dist > MAX_CLICK_DISTANCE) return;
      if (zoomingRef.current) return;

      // Converter pixel para LatLng
      const map = mapInstanceRef.current;
      const overlay = new google.maps.OverlayView();
      overlay.draw = function () {};
      overlay.setMap(map);

      // Usar bounds do mapa para converter
      const bounds = map.getBounds();
      const projection2 = map.getProjection();
      if (!bounds || !projection2) return;

      const topRight = projection2.fromLatLngToPoint(bounds.getNorthEast());
      const bottomLeft = projection2.fromLatLngToPoint(bounds.getSouthWest());
      const scale = Math.pow(2, map.getZoom());

      const mapRect = mapDiv.getBoundingClientRect();
      const pixelX = ev.clientX - mapRect.left;
      const pixelY = ev.clientY - mapRect.top;

      const worldX = pixelX / scale + bottomLeft.x;
      const worldY = pixelY / scale + topRight.y;
      const worldPoint = new google.maps.Point(worldX, worldY);
      const latLng = projection2.fromPointToLatLng(worldPoint);

      overlay.setMap(null);
      handleAddPoint(latLng);
    };

    mapDiv.addEventListener('pointerdown', onDown, { passive: true });
    mapDiv.addEventListener('pointerup', onUp, { passive: true });

    const dblClickListener = google.maps.event.addListener(mapInstanceRef.current, 'dblclick', (e) => {
      if (e?.stop) e.stop();
    });

    return () => {
      mapDiv.removeEventListener('pointerdown', onDown);
      mapDiv.removeEventListener('pointerup', onUp);
      google.maps.event.removeListener(dblClickListener);
    };
  }, [tipoDesenho, mapReady, itemEditando, drawingClosed]);

  // Guia dinâmica do último ponto até o cursor (sem setState em mousemove)
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    if (!(tipoDesenho === 'area' || tipoDesenho === 'linha') || itemEditando) return;

    // Se a área foi fechada, não mostrar linha guia
    if (drawingClosed) {
      if (guideLineRef.current) {
        guideLineRef.current.setPath([]);
        guideLineRef.current.setMap(null);
        guideLineRef.current = null;
      }
      return;
    }

    if (!guideLineRef.current) {
      guideLineRef.current = new google.maps.Polyline({
        strokeColor: '#facc15',
        strokeOpacity: 0.9,
        strokeWeight: 2,
        zIndex: 9999,
        icons: [{
          icon: { path: 'M -3,-3 L 3,3 M -3,3 L 3,-3', strokeColor: '#facc15', strokeWeight: 2 },
          offset: '100%'
        }]
      });
      guideLineRef.current.setMap(mapInstanceRef.current);
    }

    const handleMouseMove = (e) => {
      const pts = currentPointsRef.current;
      const last = pts[pts.length - 1];
      if (!last) return;
      let latLng = e.latLng;
      const snapped = findNearestPoint(latLng, mapInstanceRef.current);
      const target = snapped ? new google.maps.LatLng(snapped.lat, snapped.lng) : latLng;
      guideLineRef.current.setPath([new google.maps.LatLng(last.lat, last.lng), target]);
    };

    const moveL = google.maps.event.addListener(mapInstanceRef.current, 'mousemove', handleMouseMove);
    mouseMoveListenerRef.current = moveL;

    const handleMouseOut = () => {
      if (guideLineRef.current) guideLineRef.current.setPath([]);
    };
    const outL = google.maps.event.addListener(mapInstanceRef.current, 'mouseout', handleMouseOut);

    return () => {
      if (guideLineRef.current) {
        guideLineRef.current.setPath([]);
        guideLineRef.current.setMap(null);
        guideLineRef.current = null;
      }
      if (moveL) google.maps.event.removeListener(moveL);
      if (outL) google.maps.event.removeListener(outL);
      mouseMoveListenerRef.current = null;
    };
  }, [mapReady, tipoDesenho, itemEditando, snappingEnabled, drawingClosed]);

  // Linha guia removida - não mostrar mais a linha azul durante desenho

  useEffect(() => {
    if (!mapInstanceRef.current || currentPoints.length === 0 || !tipoDesenho) return;

    pointMarkersRef.current.forEach((m) => m.setMap(null));
    pointMarkersRef.current = [];
    midPointMarkersRef.current.forEach((m) => m.setMap(null));
    midPointMarkersRef.current = [];

    const canDrag = drawingClosed || itemEditando;
    currentPoints.forEach((point, index) => {
      const marker = new google.maps.Marker({
        position: point,
        map: mapInstanceRef.current,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: '#ffffff',
          fillOpacity: 1,
          strokeColor: '#facc15',
          strokeWeight: 2
        },
        draggable: canDrag,
        zIndex: 1000
      });

      if (canDrag) {
        marker.addListener('dragend', (e) => {
          const snap = findNearestPoint(e.latLng, mapInstanceRef.current);
          const newLat = snap ? snap.lat : e.latLng.lat();
          const newLng = snap ? snap.lng : e.latLng.lng();
          setCurrentPoints((prev) => {
            const updated = [...prev];
            updated[index] = { lat: newLat, lng: newLng };
            return updated;
          });
          if (snap) toast.success('\ud83e\uddf2 Encaixado!', { duration: 600 });else
          toast.success(`Ponto ${index + 1} reposicionado`, { duration: 800 });
        });
      }

      pointMarkersRef.current.push(marker);
    });

    if (canDrag && (tipoDesenho === 'area' || tipoDesenho === 'linha') && currentPoints.length >= 2) {
      const segCount = tipoDesenho === 'area' ? currentPoints.length : currentPoints.length - 1;
      for (let index = 0; index < segCount; index += 1) {
        const start = currentPoints[index];
        const end = currentPoints[(index + 1) % currentPoints.length];
        const midPoint = {
          lat: (start.lat + end.lat) / 2,
          lng: (start.lng + end.lng) / 2
        };

        const insertAfter = index;
        const midMarker = new google.maps.Marker({
          position: midPoint,
          map: mapInstanceRef.current,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 4,
            fillColor: '#facc15',
            fillOpacity: 0.5,
            strokeColor: '#facc15',
            strokeWeight: 1
          },
          draggable: true,
          zIndex: 900
        });

        midMarker.addListener('dragend', (e) => {
          const snap = findNearestPoint(e.latLng, mapInstanceRef.current);
          const newLat = snap ? snap.lat : e.latLng.lat();
          const newLng = snap ? snap.lng : e.latLng.lng();
          setCurrentPoints((prev) => {
            const updated = [...prev];
            updated.splice(insertAfter + 1, 0, { lat: newLat, lng: newLng });
            return updated;
          });
          if (snap) toast.success('\ud83e\uddf2 Encaixado!', { duration: 600 });else
          toast.success('Novo ponto inserido', { duration: 800 });
        });

        midPointMarkersRef.current.push(midMarker);
      }
    }

    if (tipoDesenho === 'area' && currentPoints.length >= 2) {
      if (currentPolygonRef.current) {
        currentPolygonRef.current.setMap(null);
      }
      currentPolygonRef.current = new google.maps.Polygon({
        paths: currentPoints,
        strokeColor: '#facc15',
        strokeOpacity: 1,
        strokeWeight: 3,
        fillColor: '#facc15',
        fillOpacity: 0.35
      });
      currentPolygonRef.current.setMap(mapInstanceRef.current);
    } else if (tipoDesenho === 'linha' && currentPoints.length >= 1) {
      if (currentPolylineRef.current) {
        currentPolylineRef.current.setMap(null);
      }
      currentPolylineRef.current = new google.maps.Polyline({
        path: currentPoints,
        strokeColor: '#facc15',
        strokeOpacity: 1,
        strokeWeight: 3,
        icons: [{
          icon: {
            path: 'M 0,-1 0,1',
            strokeOpacity: 1,
            strokeColor: '#ffffff',
            scale: 3
          },
          offset: '0',
          repeat: '15px'
        }]
      });
      currentPolylineRef.current.setMap(mapInstanceRef.current);
    }
  }, [currentPoints, tipoDesenho, drawingClosed, itemEditando]);

  const renderMap = () => {
    if (!mapInstanceRef.current) return;

    polygonsRef.current.forEach((p) => p.setMap(null));
    areaLabelsRef.current.forEach((label) => label.setMap(null));
    markersRef.current.forEach((m) => m.setMap(null));
    polylinesRef.current.forEach((l) => l.setMap(null));
    polygonsRef.current = [];
    areaLabelsRef.current = [];
    markersRef.current = [];
    polylinesRef.current = [];

    // Mostrar áreas/pontos/linhas existentes SEMPRE (inclusive durante edição)
    areas.forEach((area) => {
      const coords = area.coordenadas?.coords || [];
      if (coords.length < 3) return;

      const paths = coords.map((c) => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      const cor = area.coordenadas?.cor || area.cor || '#10b981';

      const polygon = new google.maps.Polygon({
        paths,
        strokeColor: cor,
        strokeOpacity: 0.5,
        strokeWeight: 1.5,
        fillColor: cor,
        fillOpacity: 0.15,
        clickable: false
      });

      polygon.setMap(mapInstanceRef.current);
      polygonsRef.current.push(polygon);

      const boundsArea = new google.maps.LatLngBounds();
      paths.forEach((point) => boundsArea.extend(point));
      const center = boundsArea.getCenter();
      const areaLabel = getAreaLabelOverlay(
        mapInstanceRef.current,
        center,
        area.nome || area.numero_area || 'ÁREA'
      );
      areaLabelsRef.current.push(areaLabel);
    });

    pontos.forEach((ponto) => {
      const coords = ponto.coordenadas || {};
      if (!coords.lat || !coords.lng) return;

      const marker = new google.maps.Marker({
        position: { lat: coords.lat, lng: coords.lng },
        map: mapInstanceRef.current,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#0066ff',
          fillOpacity: 0.5,
          strokeColor: '#ffffff',
          strokeWeight: 2
        },
        clickable: false
      });

      if (ponto.icone_url) {
        applyMarkerIconPreservingAspectRatio(marker, ponto.icone_url, 44);
      }

      markersRef.current.push(marker);
    });

    linhas.forEach((linha) => {
      const coords = linha.coordenadas?.coords || [];
      if (coords.length < 2) return;

      const paths = coords.map((c) => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      const cor = linha.coordenadas?.cor || linha.cor || '#f59e0b';

      const polyline = new google.maps.Polyline({
        path: paths,
        strokeColor: cor,
        strokeOpacity: 0.5,
        strokeWeight: 2,
        clickable: false
      });

      polyline.setMap(mapInstanceRef.current);
      polylinesRef.current.push(polyline);
    });
  };

  const finalizarDesenho = () => {
    if (tipoDesenho === 'area') {
      if (currentPoints.length < 3) {
        toast.error('Desenhe pelo menos 3 pontos!');
        return;
      }
      setShowFormularioArea(true);
    } else if (tipoDesenho === 'linha') {
      if (currentPoints.length < 2) {
        toast.error('Desenhe pelo menos 2 pontos!');
        return;
      }
      setShowFormularioLinha(true);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-white">
      {/* Mapa em tela cheia */}
      <div className="w-full h-full relative">
        <div
          ref={mapRef}
          style={{
            height: '100%',
            width: '100%',
            backgroundColor: '#e5e7eb',
            cursor: tipoDesenho && mapReady && !itemEditando && !drawingClosed ? 'crosshair' : 'default',
            touchAction: 'manipulation'
          }}
          className={tipoDesenho && mapReady && !itemEditando && !drawingClosed ? '[&_*]:cursor-crosshair' : ''} />
        
        {/* Botão fechar/voltar no topo esquerdo */}
        <Button
          onClick={onCancelar}
          variant="secondary"
          size="icon" className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 text-secondary-foreground absolute top-1 left-1 z-20 h-7 w-7 rounded-full bg-white/90 backdrop-blur-sm shadow-lg hover:bg-white">
          
          
          <X className="w-6 h-6 text-slate-700" />
        </Button>

        {/* Controles do mapa no topo */}
        <div className="absolute top-4 right-4 z-20 flex items-center gap-1">
          <Button
            variant={mapType === 'roadmap' ? 'default' : 'secondary'}
            size="sm"
            onClick={() => setMapType('roadmap')} className="w-9 bg-background text-[hsl(var(--foreground))] px-7 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground active:bg-black active:text-white h-7">
            
            
            Mapa
          </Button>
          <Button
            variant={mapType === 'satellite' ? 'default' : 'secondary'}
            size="sm"
            onClick={() => setMapType('satellite')} className="w-9 bg-background text-[hsl(var(--foreground))] px-7 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground active:bg-black active:text-white h-7">
            
            
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
                      lng: position.coords.longitude
                    };
                    if (mapInstanceRef.current) {
                      mapInstanceRef.current.setCenter(pos);
                      mapInstanceRef.current.setZoom(18);
                      toast.success('📍 Centralizado na sua localização');
                    }
                  },
                  () => toast.error('Erro ao obter localização')
                );
              }
            }} className="w-9 bg-background text-[hsl(var(--foreground))] px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground active:bg-black active:text-white h-7"

            title="Minha localização">
            
            <Target className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSnappingEnabled(!snappingEnabled)} className="w-9 bg-background text-[hsl(var(--foreground))] px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground active:bg-black active:text-white h-7"

            title={snappingEnabled ? "Ímã ativado" : "Ímã desativado"}
            aria-label="Alternar ímã">
            
            <span className="text-base leading-none">🧲</span>
          </Button>
        </div>

        {!mapReady &&
        <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 bg-white px-6 py-4 rounded-lg shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="animate-spin w-6 h-6 border-4 border-emerald-600 border-t-transparent rounded-full"></div>
              <span className="font-semibold text-slate-700">Carregando mapa...</span>
            </div>
          </div>
        }
        {tipoDesenho && mapReady &&
        <>


            {/* Indicador de área/comprimento no centro do polígono */}
            {tipoDesenho === 'area' && currentPoints.length >= 3 &&
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
                <div className="bg-black/70 text-white px-3 py-1.5 rounded text-sm font-semibold">
                  Área: {(() => {
                if (window.google?.maps?.geometry?.spherical && currentPoints.length >= 3) {
                  const path = currentPoints.map((p) => new google.maps.LatLng(p.lat, p.lng));
                  const areaM2 = google.maps.geometry.spherical.computeArea(path);
                  const areaHa = areaM2 / 10000;
                  return areaHa.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ha';
                }
                return '0,00 ha';
              })()}
                </div>
              </div>
          }
            {tipoDesenho === 'linha' && currentPoints.length >= 2 &&
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
                <div className="bg-black/70 text-white px-3 py-1.5 rounded text-sm font-semibold">
                  {(() => {
                if (window.google?.maps?.geometry?.spherical && currentPoints.length >= 2) {
                  const path = currentPoints.map((p) => new google.maps.LatLng(p.lat, p.lng));
                  const lengthM = google.maps.geometry.spherical.computeLength(path);
                  if (lengthM < 1000) return lengthM.toLocaleString('pt-BR', { maximumFractionDigits: 0 }) + ' m';
                  return (lengthM / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' km';
                }
                return '0 m';
              })()}
                </div>
              </div>
          }

            {/* Toolbar central: Desfazer / Refazer / Terminar */}
            <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-20 flex flex-col items-center gap-1">
              {/* Dicas contextuais */}
              {tipoDesenho === 'ponto' && !currentMarker && !itemEditando &&
            <div className="bg-black/70 text-white px-4 py-2 rounded-lg text-xs font-semibold">
                  📍 Toque no mapa para marcar
                </div>
            }
              {(tipoDesenho === 'area' || tipoDesenho === 'linha') && currentPoints.length === 0 && !itemEditando &&
            <div className="bg-black/70 text-white px-4 py-2 rounded-lg text-xs font-semibold">
                  {tipoDesenho === 'area' ? '🎯 Toque para desenhar a área' : '➡️ Toque para desenhar a linha'}
                </div>
            }
              {itemEditando &&
            <div className="bg-black/70 text-white px-4 py-2 rounded-lg text-xs font-semibold">
                  ✏️ Arraste os pontos para ajustar
                </div>
            }

              <div className="flex items-center gap-1 bg-white/90 backdrop-blur-sm px-2 py-1.5 rounded-full shadow-lg border border-slate-200">
                {/* Botão Reiniciar — volta ao modo de desenho do zero */}
                {(drawingClosed || currentPoints.length > 0) && !itemEditando &&
              <Button
                variant="outline"
                size="sm" className="bg-background text-[hsl(var(--foreground))] px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground h-7"

                onClick={() => {
                  // Limpar polígono/polyline atual
                  if (currentPolygonRef.current) {
                    currentPolygonRef.current.setMap(null);
                    currentPolygonRef.current = null;
                  }
                  if (currentPolylineRef.current) {
                    currentPolylineRef.current.setMap(null);
                    currentPolylineRef.current = null;
                  }
                  pointMarkersRef.current.forEach((m) => m.setMap(null));
                  pointMarkersRef.current = [];
                  midPointMarkersRef.current.forEach((m) => m.setMap(null));
                  midPointMarkersRef.current = [];
                  undoStackRef.current = [];
                  redoStackRef.current = [];
                  setCurrentPoints([]);
                  setDrawingClosed(false);
                  toast.success('Desenho reiniciado', { duration: 1000 });
                }}>
                
                     Reiniciar
                  </Button>
              }

                <Button
                variant="outline"
                size="sm" className="bg-background text-[hsl(var(--foreground))] px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground h-7"

                onClick={() => {
                  if (undoStackRef.current.length > 0) {
                    const prevPts = undoStackRef.current.pop();
                    redoStackRef.current.push(currentPoints);
                    setCurrentPoints(prevPts);
                    toast.success('Desfeito');
                  }
                }}
                disabled={undoStackRef.current.length === 0}>
                
                   Desfazer
                </Button>

                <Button
                variant="outline"
                size="sm" className="bg-background text-[hsl(var(--foreground))] px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input shadow-sm hover:bg-accent hover:text-accent-foreground h-7"

                onClick={() => {
                  if (redoStackRef.current.length > 0) {
                    const nextPts = redoStackRef.current.pop();
                    undoStackRef.current.push(currentPoints);
                    setCurrentPoints(nextPts);
                    toast.success('Refeito');
                  }
                }}
                disabled={redoStackRef.current.length === 0}>
                
                   Refazer
                </Button>

                <Button
                size="sm" className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow rounded-md px-3 h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"

                disabled={
                !(
                tipoDesenho === 'area' && (drawingClosed || currentPoints.length >= 3) ||
                tipoDesenho === 'linha' && currentPoints.length >= 2 ||
                tipoDesenho === 'ponto' && !!currentMarker)

                }
                onClick={() => {
                  if (itemEditando) {
                    if (tipoDesenho === 'area') setShowFormularioArea(true);else
                    if (tipoDesenho === 'linha') setShowFormularioLinha(true);else
                    if (tipoDesenho === 'ponto') setShowFormularioPonto(true);
                  } else {
                    if (tipoDesenho === 'ponto') setShowFormularioPonto(true);else
                    finalizarDesenho();
                  }
                }}>
                
                   {itemEditando ? 'Salvar' : drawingClosed ? 'Salvar' : 'Terminar'}
                </Button>
              </div>
            </div>
          </>
        }
      </div>

      <Sheet open={showFormularioArea} onOpenChange={setShowFormularioArea}>
        <SheetContent side="right" className="w-[320px] sm:w-[400px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{itemEditando ? 'Editar Área' : 'Cadastrar Área'}</SheetTitle>
          </SheetHeader>
          <FormularioArea
            coordenadas={currentPoints}
            usarGPS={usarGPS}
            item={itemEditando}
            onSave={() => {
              setShowFormularioArea(false);
              cancelarDesenho();
              queryClient.invalidateQueries({ queryKey: ['areas'] });
              onSalvar();
            }}
            onCancel={() => setShowFormularioArea(false)} />
          
        </SheetContent>
      </Sheet>

      <Sheet open={showFormularioPonto} onOpenChange={setShowFormularioPonto}>
        <SheetContent side="right" className="bg-background px-1 py-1 fixed z-50 gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=open]:animate-in data-[state=closed]:animate-out inset-y-0 right-0 h-full border-l data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right sm:max-w-sm w-[320px] sm:w-[400px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{itemEditando ? 'Editar Ponto' : 'Cadastrar Ponto'}</SheetTitle>
          </SheetHeader>
          <FormularioPonto
            coordenadas={currentMarker}
            usarGPS={usarGPS}
            item={itemEditando}
            suggestedDepositoId={null}
            onSave={() => {
              setShowFormularioPonto(false);
              cancelarDesenho();
              queryClient.invalidateQueries({ predicate: (query) => Array.isArray(query.queryKey) && ['pontos', 'pontos-suplementacao', 'mapa-pontos', 'mapa-pontos-supl'].includes(query.queryKey[0]) });
              window.dispatchEvent(new CustomEvent('atualizar-mapa'));
              onSalvar();
            }}
            onCancel={() => {
              setShowFormularioPonto(false);
              cancelarDesenho();
            }} />
          
        </SheetContent>
      </Sheet>

      <Sheet open={showFormularioLinha} onOpenChange={setShowFormularioLinha}>
        <SheetContent side="right" className="w-[320px] sm:w-[400px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{itemEditando ? 'Editar Linha' : 'Cadastrar Linha'}</SheetTitle>
          </SheetHeader>
          <FormularioLinha
            coordenadas={currentPoints}
            usarGPS={usarGPS}
            item={itemEditando}
            onSave={() => {
              setShowFormularioLinha(false);
              cancelarDesenho();
              queryClient.invalidateQueries({ queryKey: ['linhas'] });
              onSalvar();
            }}
            onCancel={() => setShowFormularioLinha(false)} />
          
        </SheetContent>
      </Sheet>
    </div>);

}