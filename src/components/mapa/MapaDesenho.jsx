import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Map, Square, MapPin, Minus, Layers, X, Edit, Eye, ArrowLeft, Target, RotateCcw, RotateCw, Check } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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

export default function MapaDesenho({ tipoDesenho, usarGPS = false, itemEditando, onSalvar, onCancelar }) {
  const [mapReady, setMapReady] = useState(false);
  const [mapType, setMapType] = useState('satellite');
  const [snappingEnabled, setSnappingEnabled] = useState(true);
  
  const [currentPoints, setCurrentPoints] = useState([]);
  const [currentMarker, setCurrentMarker] = useState(null);
  
  const [showFormularioArea, setShowFormularioArea] = useState(usarGPS && tipoDesenho === 'area');
  const [showFormularioPonto, setShowFormularioPonto] = useState(usarGPS && tipoDesenho === 'ponto');
  const [showFormularioLinha, setShowFormularioLinha] = useState(usarGPS && tipoDesenho === 'linha');

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const polygonsRef = useRef([]);
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

  useEffect(() => {
    currentPointsRef.current = currentPoints;
  }, [currentPoints]);

  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: areas = [] } = useQuery({
    queryKey: ['areas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: pontos = [] } = useQuery({
    queryKey: ['pontos', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PontoReferencia.list();
      return all.filter(p => p.empresa_id === empresaSelecionadaId && p.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: linhas = [] } = useQuery({
    queryKey: ['linhas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LinhaGeografica.list();
      return all.filter(l => l.empresa_id === empresaSelecionadaId && l.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter(i => i.empresa_id === empresaSelecionadaId && i.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const SNAP_DISTANCE = 6; // snap em pixels

  const findNearestPoint = (mouseLatLng, map) => {
    if (!snappingEnabled) return null;

    const projection = map.getProjection();
    if (!projection) return null;

    const mousePoint = projection.fromLatLngToPoint(mouseLatLng);
    let nearestPoint = null;
    let minDistance = Infinity;

    areas.forEach(area => {
      const coords = area.coordenadas?.coords || [];
      coords.forEach(coord => {
        const point = projection.fromLatLngToPoint(new google.maps.LatLng(coord[0] || coord.lat, coord[1] || coord.lng));
        const distance = Math.sqrt(Math.pow(point.x - mousePoint.x, 2) + Math.pow(point.y - mousePoint.y, 2));
        const scale = Math.pow(2, map.getZoom());
        const pixelDistance = distance * scale;
        
        if (pixelDistance < SNAP_DISTANCE && pixelDistance < minDistance) {
          minDistance = pixelDistance;
          nearestPoint = { lat: coord[0] || coord.lat, lng: coord[1] || coord.lng };
        }
      });
    });

    linhas.forEach(linha => {
      const coords = linha.coordenadas?.coords || [];
      coords.forEach(coord => {
        const point = projection.fromLatLngToPoint(new google.maps.LatLng(coord[0] || coord.lat, coord[1] || coord.lng));
        const distance = Math.sqrt(Math.pow(point.x - mousePoint.x, 2) + Math.pow(point.y - mousePoint.y, 2));
        const scale = Math.pow(2, map.getZoom());
        const pixelDistance = distance * scale;
        
        if (pixelDistance < SNAP_DISTANCE && pixelDistance < minDistance) {
          minDistance = pixelDistance;
          nearestPoint = { lat: coord[0] || coord.lat, lng: coord[1] || coord.lng };
        }
      });
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

    pointMarkersRef.current.forEach(m => m.setMap(null));
    pointMarkersRef.current = [];

    undoStackRef.current = [];
    redoStackRef.current = [];

    setCurrentPoints([]);
    setCurrentMarker(null);
  };

  // Carregar item em edição
  useEffect(() => {
    if (itemEditando && tipoDesenho === 'area' && itemEditando.coordenadas?.coords) {
      const coords = itemEditando.coordenadas.coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      setCurrentPoints(coords);
      // Centralizar no polígono
      setTimeout(() => {
        if (mapInstanceRef.current && coords.length > 0) {
          const bounds = new google.maps.LatLngBounds();
          coords.forEach(c => bounds.extend(c));
          mapInstanceRef.current.fitBounds(bounds, { padding: 80 });
        }
      }, 500);
    } else if (itemEditando && tipoDesenho === 'linha' && itemEditando.coordenadas?.coords) {
      const coords = itemEditando.coordenadas.coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      setCurrentPoints(coords);
      // Centralizar na linha
      setTimeout(() => {
        if (mapInstanceRef.current && coords.length > 0) {
          const bounds = new google.maps.LatLngBounds();
          coords.forEach(c => bounds.extend(c));
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
        zoom: 15,
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

      areas.forEach(area => {
        const coords = area.coordenadas?.coords || [];
        coords.forEach(c => {
          const lat = c[0] || c.lat;
          const lng = c[1] || c.lng;
          if (lat && lng) {
            bounds.extend({ lat, lng });
            hasValidCoords = true;
          }
        });
      });

      if (hasValidCoords) {
        mapInstanceRef.current.fitBounds(bounds, { padding: 50 });
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

  useEffect(() => {
    if (!mapInstanceRef.current || !tipoDesenho || !mapReady || itemEditando) return;

    const handleMapClick = (e) => {
      e.stop();
      
      let lat = e.latLng.lat();
      let lng = e.latLng.lng();
      
      const snappedPoint = findNearestPoint(e.latLng, mapInstanceRef.current);
      if (snappedPoint) {
        lat = snappedPoint.lat;
        lng = snappedPoint.lng;
        toast.success('🧲 Encaixado!', { duration: 600 });
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
        tempMarkerRef.current.addListener('dragend', (e) => {
          let latLng = e.latLng;
          const snap = findNearestPoint(latLng, mapInstanceRef.current);
          const newLat = snap ? snap.lat : latLng.lat();
          const newLng = snap ? snap.lng : latLng.lng();
          setCurrentMarker({ lat: newLat, lng: newLng });
          if (snap) toast.success('🧲 Encaixado!', { duration: 600 });
        });
        setShowFormularioPonto(true);
      } else if (tipoDesenho === 'area' || tipoDesenho === 'linha') {
        const newPoint = { lat, lng };
        setCurrentPoints(prev => {
          undoStackRef.current.push(prev);
          redoStackRef.current = [];
          const updated = [...prev, newPoint];
          toast.success(`✅ Ponto ${updated.length} adicionado`, { duration: 800 });
          return updated;
        });
      }
    };

    const listener = google.maps.event.addListener(mapInstanceRef.current, 'click', handleMapClick);
    return () => google.maps.event.removeListener(listener);
  }, [tipoDesenho, mapReady, itemEditando]);

  // Guia dinâmica do último ponto até o cursor (sem setState em mousemove)
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady) return;
    if (!(tipoDesenho === 'area' || tipoDesenho === 'linha') || itemEditando) return;

    if (!guideLineRef.current) {
      guideLineRef.current = new google.maps.Polyline({
        strokeColor: '#facc15', // sky-600
        strokeOpacity: 0.9,
        strokeWeight: 2,
        zIndex: 9999,
        icons: [{
          icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 3, strokeColor: '#facc15' },
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
  }, [mapReady, tipoDesenho, itemEditando, snappingEnabled]);

  // Linha guia removida - não mostrar mais a linha azul durante desenho

  useEffect(() => {
    if (!mapInstanceRef.current || currentPoints.length === 0 || !tipoDesenho) return;

    pointMarkersRef.current.forEach(m => m.setMap(null));
    pointMarkersRef.current = [];

    currentPoints.forEach((point, index) => {
      const marker = new google.maps.Marker({
        position: point,
        map: mapInstanceRef.current,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 5,
          fillColor: '#ffffff',
          fillOpacity: 1,
          strokeColor: '#facc15',
          strokeWeight: 2
        },
        draggable: true,
        zIndex: 1000
      });

      marker.addListener('dragend', (e) => {
        let latLng = e.latLng;
        const snap = findNearestPoint(latLng, mapInstanceRef.current);
        const newLat = snap ? snap.lat : latLng.lat();
        const newLng = snap ? snap.lng : latLng.lng();
        setCurrentPoints(prev => {
          const updated = [...prev];
          updated[index] = { lat: newLat, lng: newLng };
          return updated;
        });
        if (snap) toast.success('🧲 Encaixado!', { duration: 600 });
        else toast.success(`Ponto ${index + 1} reposicionado`, { duration: 800 });
      });

      pointMarkersRef.current.push(marker);
    });

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
        fillOpacity: 0.35,
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
  }, [currentPoints, tipoDesenho]);

  const renderMap = () => {
    if (!mapInstanceRef.current) return;

    polygonsRef.current.forEach(p => p.setMap(null));
    markersRef.current.forEach(m => m.setMap(null));
    polylinesRef.current.forEach(l => l.setMap(null));
    polygonsRef.current = [];
    markersRef.current = [];
    polylinesRef.current = [];

    // Mostrar áreas/pontos/linhas existentes SEMPRE (inclusive durante edição)
    areas.forEach(area => {
      const coords = area.coordenadas?.coords || [];
      if (coords.length < 3) return;

      const paths = coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      const cor = area.coordenadas?.cor || area.cor || '#10b981';

      const polygon = new google.maps.Polygon({
        paths,
        strokeColor: cor,
        strokeOpacity: 0.5,
        strokeWeight: 1.5,
        fillColor: cor,
        fillOpacity: 0.15,
        clickable: false,
      });

      polygon.setMap(mapInstanceRef.current);
      polygonsRef.current.push(polygon);
    });

    pontos.forEach(ponto => {
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
        clickable: false,
      });

      markersRef.current.push(marker);
    });

    linhas.forEach(linha => {
      const coords = linha.coordenadas?.coords || [];
      if (coords.length < 2) return;

      const paths = coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      const cor = linha.coordenadas?.cor || linha.cor || '#f59e0b';

      const polyline = new google.maps.Polyline({
        path: paths,
        strokeColor: cor,
        strokeOpacity: 0.5,
        strokeWeight: 2,
        clickable: false,
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
            cursor: (tipoDesenho && mapReady && !itemEditando) ? 'crosshair' : 'default',
            touchAction: 'manipulation'
          }}
          className={(tipoDesenho && mapReady && !itemEditando) ? '[&_*]:cursor-crosshair' : ''}
        />
        {/* Botão fechar/voltar no topo esquerdo */}
        <Button
          onClick={onCancelar}
          variant="secondary"
          size="icon"
          className="absolute top-4 left-4 z-20 h-12 w-12 rounded-full bg-white/90 backdrop-blur-sm shadow-lg hover:bg-white"
        >
          <X className="w-6 h-6 text-slate-700" />
        </Button>

        {/* Controles do mapa no topo */}
        <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
          <Button
            variant={mapType === 'roadmap' ? 'default' : 'secondary'}
            size="sm"
            onClick={() => setMapType('roadmap')}
            className="h-9 px-3 text-xs bg-white/90 backdrop-blur-sm shadow-lg"
          >
            Mapa
          </Button>
          <Button
            variant={mapType === 'satellite' ? 'default' : 'secondary'}
            size="sm"
            onClick={() => setMapType('satellite')}
            className="h-9 px-3 text-xs bg-white/90 backdrop-blur-sm shadow-lg"
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
            }}
            className="h-9 w-9 bg-white/90 backdrop-blur-sm shadow-lg"
            title="Minha localização"
          >
            <Target className="w-4 h-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSnappingEnabled(!snappingEnabled)}
            className={snappingEnabled ? "h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white hidden md:flex" : "h-8 text-xs hidden md:flex"}
            title={snappingEnabled ? "Ímã: Ativo" : "Ímã: Inativo"}
          >
            <span className="w-3.5 h-3.5 mr-1.5">🧲</span>
            {snappingEnabled ? 'Ímã Ativo' : 'Ímã Inativo'}
          </Button>
        </div>

        {!mapReady && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 bg-white px-6 py-4 rounded-lg shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="animate-spin w-6 h-6 border-4 border-emerald-600 border-t-transparent rounded-full"></div>
              <span className="font-semibold text-slate-700">Carregando mapa...</span>
            </div>
          </div>
        )}
        {tipoDesenho && mapReady && (
          <>


            {/* Indicador de área/comprimento no centro do polígono */}
            {tipoDesenho === 'area' && currentPoints.length >= 3 && (
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
                <div className="bg-black/70 text-white px-3 py-1.5 rounded text-sm font-semibold">
                  Área: {(() => {
                    if (window.google?.maps?.geometry?.spherical && currentPoints.length >= 3) {
                      const path = currentPoints.map(p => new google.maps.LatLng(p.lat, p.lng));
                      const areaM2 = google.maps.geometry.spherical.computeArea(path);
                      const areaHa = areaM2 / 10000;
                      return areaHa < 1 ? `${(areaHa).toFixed(2)} ha` : `${areaHa.toFixed(1)} ha`;
                    }
                    return '0 ha';
                  })()}
                </div>
              </div>
            )}
            {tipoDesenho === 'linha' && currentPoints.length >= 2 && (
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
                <div className="bg-black/70 text-white px-3 py-1.5 rounded text-sm font-semibold">
                  {(() => {
                    if (window.google?.maps?.geometry?.spherical && currentPoints.length >= 2) {
                      const path = currentPoints.map(p => new google.maps.LatLng(p.lat, p.lng));
                      const lengthM = google.maps.geometry.spherical.computeLength(path);
                      return lengthM < 1000 ? `${lengthM.toFixed(0)} m` : `${(lengthM / 1000).toFixed(2)} km`;
                    }
                    return '0 m';
                  })()}
                </div>
              </div>
            )}

            {/* Toolbar central: Desfazer / Refazer / Terminar */}
            <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-20 flex flex-col items-center gap-2">
              {/* Dicas contextuais */}
              {tipoDesenho === 'ponto' && !currentMarker && !itemEditando && (
                <div className="bg-black/70 text-white px-4 py-2 rounded-lg text-xs font-semibold">
                  📍 Toque no mapa para marcar
                </div>
              )}
              {(tipoDesenho === 'area' || tipoDesenho === 'linha') && currentPoints.length === 0 && !itemEditando && (
                <div className="bg-black/70 text-white px-4 py-2 rounded-lg text-xs font-semibold">
                  {tipoDesenho === 'area' ? '🎯 Toque para desenhar a área' : '➡️ Toque para desenhar a linha'}
                </div>
              )}
              {itemEditando && (
                <div className="bg-black/70 text-white px-4 py-2 rounded-lg text-xs font-semibold">
                  ✏️ Arraste os pontos para ajustar
                </div>
              )}

              <div className="flex items-center gap-2 bg-white/90 backdrop-blur-sm px-2 py-1.5 rounded-full shadow-lg border border-slate-200">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    if (undoStackRef.current.length > 0) {
                      const prevPts = undoStackRef.current.pop();
                      redoStackRef.current.push(currentPoints);
                      setCurrentPoints(prevPts);
                      toast.success('Desfeito');
                    }
                  }}
                  disabled={undoStackRef.current.length === 0}
                >
                  <RotateCcw className="w-3.5 h-3.5 mr-1.5" /> Desfazer
                </Button>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => {
                    if (redoStackRef.current.length > 0) {
                      const nextPts = redoStackRef.current.pop();
                      undoStackRef.current.push(currentPoints);
                      setCurrentPoints(nextPts);
                      toast.success('Refeito');
                    }
                  }}
                  disabled={redoStackRef.current.length === 0}
                >
                  <RotateCw className="w-3.5 h-3.5 mr-1.5" /> Refazer
                </Button>

                <Button
                  size="sm"
                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                  disabled={
                    !(
                      (tipoDesenho === 'area' && currentPoints.length >= 3) ||
                      (tipoDesenho === 'linha' && currentPoints.length >= 2) ||
                      (tipoDesenho === 'ponto' && !!currentMarker)
                    )
                  }
                  onClick={() => {
                    if (itemEditando) {
                      if (tipoDesenho === 'area') setShowFormularioArea(true);
                      else if (tipoDesenho === 'linha') setShowFormularioLinha(true);
                      else if (tipoDesenho === 'ponto') setShowFormularioPonto(true);
                    } else {
                      if (tipoDesenho === 'ponto') setShowFormularioPonto(true);
                      else finalizarDesenho();
                    }
                  }}
                >
                  <Check className="w-3.5 h-3.5 mr-1.5" /> {itemEditando ? 'Salvar' : 'Terminar'}
                </Button>
              </div>
            </div>
          </>
        )}
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
            onCancel={() => setShowFormularioArea(false)}
          />
        </SheetContent>
      </Sheet>

      <Sheet open={showFormularioPonto} onOpenChange={setShowFormularioPonto}>
        <SheetContent side="right" className="w-[320px] sm:w-[400px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{itemEditando ? 'Editar Ponto' : 'Cadastrar Ponto'}</SheetTitle>
          </SheetHeader>
          <FormularioPonto
            coordenadas={currentMarker}
            usarGPS={usarGPS}
            item={itemEditando}
            onSave={() => {
              setShowFormularioPonto(false);
              cancelarDesenho();
              queryClient.invalidateQueries({ queryKey: ['pontos'] });
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
            onCancel={() => setShowFormularioLinha(false)}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}