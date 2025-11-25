import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Map, Square, MapPin, Minus, Layers, X, Edit, Eye, ArrowLeft, Target } from "lucide-react";
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
  const pointMarkersRef = useRef([]);

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

  const SNAP_DISTANCE = 30;

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
    pointMarkersRef.current.forEach(m => m.setMap(null));
    pointMarkersRef.current = [];
    setCurrentPoints([]);
    setCurrentMarker(null);
  };

  // Carregar item em edição
  useEffect(() => {
    if (itemEditando && tipoDesenho === 'area' && itemEditando.coordenadas?.coords) {
      const coords = itemEditando.coordenadas.coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      setCurrentPoints(coords);
    } else if (itemEditando && tipoDesenho === 'linha' && itemEditando.coordenadas?.coords) {
      const coords = itemEditando.coordenadas.coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      setCurrentPoints(coords);
    } else if (itemEditando && tipoDesenho === 'ponto' && itemEditando.coordenadas) {
      setCurrentMarker(itemEditando.coordenadas);
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
        setTimeout(() => setMapReady(true), 100);
      });
    }).catch((error) => {
      console.error('Erro ao carregar mapa:', error);
      toast.error('Erro ao carregar mapa.');
    });
  }, []);

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
          setCurrentMarker({ lat: e.latLng.lat(), lng: e.latLng.lng() });
        });
        setShowFormularioPonto(true);
      } else if (tipoDesenho === 'area' || tipoDesenho === 'linha') {
        const newPoint = { lat, lng };
        setCurrentPoints(prev => {
          const updated = [...prev, newPoint];
          toast.success(`✅ Ponto ${updated.length} adicionado`, { duration: 800 });
          return updated;
        });
      }
    };

    const listener = google.maps.event.addListener(mapInstanceRef.current, 'click', handleMapClick);
    return () => google.maps.event.removeListener(listener);
  }, [tipoDesenho, mapReady, itemEditando]);

  useEffect(() => {
    if (!mapInstanceRef.current || !tipoDesenho || currentPoints.length === 0 || !mapReady || tipoDesenho === 'ponto') {
      if (guideLineRef.current) {
        guideLineRef.current.setMap(null);
        guideLineRef.current = null;
      }
      return;
    }

    const handleMouseMove = (e) => {
      if (!currentPoints.length) return;
      
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      const lastPoint = currentPoints[currentPoints.length - 1];

      const snappedPoint = findNearestPoint(e.latLng, mapInstanceRef.current);
      const targetPoint = snappedPoint || { lat, lng };

      if (guideLineRef.current) {
        guideLineRef.current.setMap(null);
      }

      const lineSymbol = {
        path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        scale: 3,
        strokeColor: '#3b82f6',
      };

      guideLineRef.current = new google.maps.Polyline({
        path: [lastPoint, targetPoint],
        strokeColor: snappedPoint ? '#10b981' : '#3b82f6',
        strokeOpacity: 0.7,
        strokeWeight: snappedPoint ? 4 : 2,
        icons: [{
          icon: lineSymbol,
          offset: '100%'
        }],
        map: mapInstanceRef.current,
        clickable: false,
        zIndex: 1
      });
    };

    const listener = google.maps.event.addListener(mapInstanceRef.current, 'mousemove', handleMouseMove);
    return () => {
      google.maps.event.removeListener(listener);
      if (guideLineRef.current) {
        guideLineRef.current.setMap(null);
        guideLineRef.current = null;
      }
    };
  }, [tipoDesenho, currentPoints.length, mapReady]);

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
          scale: 8,
          fillColor: '#facc15',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2
        },
        draggable: true,
        zIndex: 1000
      });

      marker.addListener('dragend', (e) => {
        const newLat = e.latLng.lat();
        const newLng = e.latLng.lng();
        setCurrentPoints(prev => {
          const updated = [...prev];
          updated[index] = { lat: newLat, lng: newLng };
          return updated;
        });
        toast.success(`Ponto ${index + 1} reposicionado`, { duration: 800 });
      });

      pointMarkersRef.current.push(marker);
    });

    if (tipoDesenho === 'area' && currentPoints.length >= 2) {
      if (currentPolygonRef.current) {
        currentPolygonRef.current.setMap(null);
      }
      currentPolygonRef.current = new google.maps.Polygon({
        paths: currentPoints,
        strokeColor: '#10b981',
        strokeOpacity: 1,
        strokeWeight: 3,
        fillColor: '#10b981',
        fillOpacity: 0.35,
      });
      currentPolygonRef.current.setMap(mapInstanceRef.current);
    } else if (tipoDesenho === 'linha' && currentPoints.length >= 1) {
      if (currentPolylineRef.current) {
        currentPolylineRef.current.setMap(null);
      }
      currentPolylineRef.current = new google.maps.Polyline({
        path: currentPoints,
        strokeColor: '#f59e0b',
        strokeOpacity: 1,
        strokeWeight: 3,
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

    // Mostrar apenas áreas/pontos/linhas existentes quando NÃO estiver editando
    if (!itemEditando) {
      areas.forEach(area => {
        const coords = area.coordenadas?.coords || [];
        if (coords.length < 3) return;

        const paths = coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
        const cor = area.coordenadas?.cor || '#10b981';

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
    }
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
            variant={snappingEnabled ? 'default' : 'secondary'}
            size="sm"
            onClick={() => setSnappingEnabled(!snappingEnabled)}
            className="h-9 px-3 text-xs bg-white/90 backdrop-blur-sm shadow-lg hidden md:flex"
            title="Snap nos pontos"
          >
            🧲
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
        {tipoDesenho && mapReady && !itemEditando && (
          <>
            {/* Botão TERMINAR no topo */}
            {((tipoDesenho === 'area' && currentPoints.length >= 3) || (tipoDesenho === 'linha' && currentPoints.length >= 2)) && (
              <Button
                onClick={finalizarDesenho}
                className="absolute top-4 left-1/2 transform -translate-x-1/2 z-20 bg-emerald-500 hover:bg-emerald-600 text-white font-bold shadow-2xl h-10 px-6 text-sm border-2 border-white"
              >
                TERMINAR
              </Button>
            )}

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

            {/* Botão DESFAZER na parte inferior */}
            <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-20 flex flex-col items-center gap-2">
              {tipoDesenho === 'ponto' && !currentMarker && (
                <div className="bg-black/70 text-white px-4 py-2 rounded-lg text-sm font-semibold">
                  📍 Toque no mapa para marcar
                </div>
              )}
              {(tipoDesenho === 'area' || tipoDesenho === 'linha') && currentPoints.length > 0 && (
                <Button
                  onClick={() => {
                    setCurrentPoints(prev => prev.slice(0, -1));
                    toast.success('Último ponto removido');
                  }}
                  variant="secondary"
                  className="bg-slate-800/90 hover:bg-slate-700 text-white font-bold shadow-2xl h-10 px-6 text-sm border-2 border-white"
                >
                  DESFAZER
                </Button>
              )}
              {(tipoDesenho === 'area' || tipoDesenho === 'linha') && currentPoints.length === 0 && (
                <div className="bg-black/70 text-white px-4 py-2 rounded-lg text-sm font-semibold">
                  {tipoDesenho === 'area' ? '🎯 Toque para desenhar a área' : '➡️ Toque para desenhar a linha'}
                </div>
              )}
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