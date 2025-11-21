import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Map, Square, MapPin, Minus, Layers, X, Edit, Eye } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import FormularioArea from "../components/mapa/FormularioArea";
import FormularioPonto from "../components/mapa/FormularioPonto";
import FormularioLinha from "../components/mapa/FormularioLinha";

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

export default function MapaCadastro() {
  const [mapReady, setMapReady] = useState(false);
  const [mapType, setMapType] = useState('satellite');
  const [modoDesenho, setModoDesenho] = useState(null);
  const [modoEdicao, setModoEdicao] = useState(false);
  const [snappingEnabled, setSnappingEnabled] = useState(true);
  const [showAreas, setShowAreas] = useState(true);
  const [showPontos, setShowPontos] = useState(true);
  const [showLinhas, setShowLinhas] = useState(true);
  
  const [currentPoints, setCurrentPoints] = useState([]);
  const [currentMarker, setCurrentMarker] = useState(null);
  
  const [showFormularioArea, setShowFormularioArea] = useState(false);
  const [showFormularioPonto, setShowFormularioPonto] = useState(false);
  const [showFormularioLinha, setShowFormularioLinha] = useState(false);

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
    setModoDesenho(null);
    setCurrentPoints([]);
    setCurrentMarker(null);
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
  };

  useEffect(() => {
    loadGoogleMapsScript().then(() => {
      if (!mapRef.current || mapInstanceRef.current) return;

      const map = new google.maps.Map(mapRef.current, {
        center: { lat: -15.0067, lng: -59.9533 },
        zoom: 15,
        mapTypeId: mapType,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
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
  }, [areas, pontos, linhas, showAreas, showPontos, showLinhas, iconesConfig, mapReady, modoEdicao]);

  useEffect(() => {
    if (!mapInstanceRef.current || !modoDesenho || !mapReady) return;

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
      
      if (modoDesenho === 'ponto') {
        setCurrentMarker({ lat, lng });
        if (tempMarkerRef.current) {
          tempMarkerRef.current.setMap(null);
        }
        tempMarkerRef.current = new google.maps.Marker({
          position: { lat, lng },
          map: mapInstanceRef.current,
          draggable: true
        });
        setShowFormularioPonto(true);
      } else if (modoDesenho === 'poligono' || modoDesenho === 'linha') {
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
  }, [modoDesenho, mapReady]);

  useEffect(() => {
    if (!mapInstanceRef.current || !modoDesenho || currentPoints.length === 0 || !mapReady || modoDesenho === 'ponto') {
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
  }, [modoDesenho, currentPoints.length, mapReady]);

  useEffect(() => {
    if (!mapInstanceRef.current || currentPoints.length === 0 || !modoDesenho) return;

    pointMarkersRef.current.forEach(m => m.setMap(null));
    pointMarkersRef.current = [];

    currentPoints.forEach((point, index) => {
      const marker = new google.maps.Marker({
        position: point,
        map: mapInstanceRef.current,
        label: {
          text: String(index + 1),
          color: '#ffffff',
          fontSize: '12px',
          fontWeight: 'bold'
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 10,
          fillColor: '#3b82f6',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3
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

    if (modoDesenho === 'poligono' && currentPoints.length >= 2) {
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
    } else if (modoDesenho === 'linha' && currentPoints.length >= 1) {
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
  }, [currentPoints, modoDesenho]);

  const renderMap = () => {
    if (!mapInstanceRef.current) return;

    polygonsRef.current.forEach(p => p.setMap(null));
    markersRef.current.forEach(m => m.setMap(null));
    polylinesRef.current.forEach(l => l.setMap(null));
    polygonsRef.current = [];
    markersRef.current = [];
    polylinesRef.current = [];

    if (showAreas) {
      areas.forEach(area => {
        const coords = area.coordenadas?.coords || [];
        if (coords.length < 3) return;

        const paths = coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
        const cor = area.coordenadas?.cor || '#10b981';

        const polygon = new google.maps.Polygon({
          paths,
          strokeColor: cor,
          strokeOpacity: 1,
          strokeWeight: modoEdicao ? 3 : 2.5,
          fillColor: cor,
          fillOpacity: modoEdicao ? 0.25 : 0.35,
          editable: modoEdicao,
          draggable: false,
        });

        polygon.setMap(mapInstanceRef.current);
        polygonsRef.current.push(polygon);

        if (modoEdicao) {
          const updateAreaMutation = async () => {
            const newPaths = polygon.getPath().getArray().map(p => [p.lat(), p.lng()]);
            await base44.entities.AreaPastagem.update(area.id, {
              coordenadas: { coords: newPaths, cor }
            });
            queryClient.invalidateQueries({ queryKey: ['areas'] });
            toast.success('Área atualizada!');
          };

          google.maps.event.addListener(polygon.getPath(), 'set_at', updateAreaMutation);
          google.maps.event.addListener(polygon.getPath(), 'insert_at', updateAreaMutation);
        }

        polygon.addListener('click', (e) => {
          if (!modoEdicao && e.vertex === undefined) {
            const infoWindow = new google.maps.InfoWindow({
              content: `
                <div style="padding: 8px;">
                  <strong>${area.nome}</strong><br/>
                  <span style="font-size: 12px;">Área: ${area.tamanho_hectares || 0} ha</span>
                </div>
              `
            });
            const bounds = new google.maps.LatLngBounds();
            paths.forEach(p => bounds.extend(p));
            infoWindow.setPosition(bounds.getCenter());
            infoWindow.open(mapInstanceRef.current);
          }
        });
      });
    }

    if (showPontos) {
      pontos.forEach(ponto => {
        const coords = ponto.coordenadas || {};
        if (!coords.lat || !coords.lng) return;

        const configIcone = iconesConfig.find(ic => ic.tipo_entidade === 'Ponto' && ic.categoria === ponto.tipo);
        let markerIcon;

        if (configIcone?.icone_url) {
          markerIcon = {
            url: configIcone.icone_url,
            scaledSize: new google.maps.Size(70, 70),
            anchor: new google.maps.Point(35, 35)
          };
        } else {
          markerIcon = {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 18,
            fillColor: configIcone?.cor_padrao || ponto.cor || '#0066ff',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 4
          };
        }

        const marker = new google.maps.Marker({
          position: { lat: coords.lat, lng: coords.lng },
          map: mapInstanceRef.current,
          icon: markerIcon,
          title: ponto.nome,
          draggable: modoEdicao,
        });

        markersRef.current.push(marker);

        if (modoEdicao) {
          marker.addListener('dragend', async (e) => {
            const newPos = { lat: e.latLng.lat(), lng: e.latLng.lng() };
            await base44.entities.PontoReferencia.update(ponto.id, { coordenadas: newPos });
            queryClient.invalidateQueries({ queryKey: ['pontos'] });
            toast.success('Ponto reposicionado!');
          });
        }

        marker.addListener('click', () => {
          if (!modoEdicao) {
            const infoWindow = new google.maps.InfoWindow({
              content: `
                <div style="padding: 10px;">
                  <strong style="font-size: 14px;">${ponto.nome}</strong><br/>
                  <span style="font-size: 12px; color: #666;">${ponto.tipo}</span>
                </div>
              `
            });
            infoWindow.open(mapInstanceRef.current, marker);
          }
        });
      });
    }

    if (showLinhas) {
      linhas.forEach(linha => {
        const coords = linha.coordenadas?.coords || [];
        if (coords.length < 2) return;

        const paths = coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
        const cor = linha.coordenadas?.cor || linha.cor || '#f59e0b';

        const polyline = new google.maps.Polyline({
          path: paths,
          strokeColor: cor,
          strokeOpacity: 1,
          strokeWeight: modoEdicao ? 4 : 3,
          editable: modoEdicao,
          draggable: false,
        });

        polyline.setMap(mapInstanceRef.current);
        polylinesRef.current.push(polyline);

        if (modoEdicao) {
          const updateLinhaMutation = async () => {
            const newPaths = polyline.getPath().getArray().map(p => [p.lat(), p.lng()]);
            
            let comprimentoMetros = 0;
            if (window.google?.maps?.geometry) {
              comprimentoMetros = google.maps.geometry.spherical.computeLength(polyline.getPath());
            }

            await base44.entities.LinhaGeografica.update(linha.id, {
              coordenadas: { coords: newPaths, cor },
              comprimento_metros: comprimentoMetros
            });
            queryClient.invalidateQueries({ queryKey: ['linhas'] });
            toast.success('Linha atualizada!');
          };

          google.maps.event.addListener(polyline.getPath(), 'set_at', updateLinhaMutation);
          google.maps.event.addListener(polyline.getPath(), 'insert_at', updateLinhaMutation);
        }

        polyline.addListener('click', () => {
          if (!modoEdicao) {
            const infoWindow = new google.maps.InfoWindow({
              content: `
                <div style="padding: 8px;">
                  <strong>${linha.nome}</strong><br/>
                  <span style="font-size: 12px;">${linha.tipo} - ${linha.comprimento_metros ? (linha.comprimento_metros/1000).toFixed(2) + ' km' : 'N/A'}</span>
                </div>
              `
            });
            const bounds = new google.maps.LatLngBounds();
            paths.forEach(p => bounds.extend(p));
            infoWindow.setPosition(bounds.getCenter());
            infoWindow.open(mapInstanceRef.current);
          }
        });
      });
    }
  };

  const finalizarPoligono = () => {
    if (currentPoints.length < 3) {
      toast.error('Desenhe pelo menos 3 pontos!');
      return;
    }
    setShowFormularioArea(true);
  };

  const finalizarLinha = () => {
    if (currentPoints.length < 2) {
      toast.error('Desenhe pelo menos 2 pontos!');
      return;
    }
    setShowFormularioLinha(true);
  };

  return (
    <div className="p-6 max-w-screen-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Mapa de Cadastro</h1>
        <p className="text-sm text-slate-600">Cadastre e edite áreas, pontos de referência e linhas geográficas</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-6 gap-4">
        <Card className="xl:col-span-5">
          <CardHeader className="bg-gradient-to-r from-emerald-50 to-blue-50 border-b">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Map className="w-5 h-5 text-emerald-600" />
                Mapa de Cadastro
              </CardTitle>

              <div className="flex gap-2 flex-wrap">
                <div className="flex gap-1 bg-white border rounded-lg p-1">
                  <Button
                    variant={mapType === 'roadmap' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setMapType('roadmap')}
                    className="h-8 text-xs"
                  >
                    Mapa
                  </Button>
                  <Button
                    variant={mapType === 'satellite' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setMapType('satellite')}
                    className="h-8 text-xs"
                  >
                    Satélite
                  </Button>
                </div>

                {!modoDesenho && (
                  <>
                    <Button
                      onClick={() => setModoEdicao(!modoEdicao)}
                      size="sm"
                      variant={modoEdicao ? 'default' : 'outline'}
                      className={`h-8 text-xs ${modoEdicao ? 'bg-purple-600 hover:bg-purple-700' : ''}`}
                    >
                      <Edit className="w-4 h-4 mr-1" />
                      {modoEdicao ? 'Editando' : 'Editar'}
                    </Button>
                    <Button
                      onClick={() => setModoDesenho('poligono')}
                      size="sm"
                      className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                      disabled={modoEdicao}
                    >
                      <Square className="w-4 h-4 mr-1" />
                      Desenhar Área
                    </Button>
                    <Button
                      onClick={() => setModoDesenho('ponto')}
                      size="sm"
                      className="h-8 text-xs bg-blue-600 hover:bg-blue-700"
                      disabled={modoEdicao}
                    >
                      <MapPin className="w-4 h-4 mr-1" />
                      Adicionar Ponto
                    </Button>
                    <Button
                      onClick={() => setModoDesenho('linha')}
                      size="sm"
                      className="h-8 text-xs bg-orange-600 hover:bg-orange-700"
                      disabled={modoEdicao}
                    >
                      <Minus className="w-4 h-4 mr-1" />
                      Desenhar Linha
                    </Button>
                  </>
                )}

                {modoDesenho && (
                  <Button
                    onClick={cancelarDesenho}
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                  >
                    <X className="w-4 h-4 mr-1" />
                    Cancelar
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0 relative">
            <div
              ref={mapRef}
              style={{
                height: '750px',
                width: '100%',
                backgroundColor: '#e5e7eb',
                cursor: (modoDesenho && mapReady) ? 'crosshair' : 'default'
              }}
              className={modoDesenho && mapReady ? '[&_*]:cursor-crosshair' : ''}
            />
            {!mapReady && (
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 bg-white px-6 py-4 rounded-lg shadow-2xl">
                <div className="flex items-center gap-3">
                  <div className="animate-spin w-6 h-6 border-4 border-emerald-600 border-t-transparent rounded-full"></div>
                  <span className="font-semibold text-slate-700">Carregando mapa...</span>
                </div>
              </div>
            )}
            {modoDesenho && mapReady && (
              <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-10 flex flex-col items-center gap-3">
                <div className="bg-blue-600 text-white px-8 py-4 rounded-xl shadow-2xl font-bold text-base border-4 border-white">
                  {modoDesenho === 'poligono' && `🎯 Clique no mapa para adicionar pontos (${currentPoints.length}) • Arraste os pontos para editar`}
                  {modoDesenho === 'ponto' && '📍 Clique no mapa para posicionar o ponto'}
                  {modoDesenho === 'linha' && `➡️ Clique no mapa para adicionar pontos (${currentPoints.length}) • Arraste os pontos para editar`}
                </div>
                {modoDesenho === 'poligono' && currentPoints.length >= 3 && (
                  <Button
                    onClick={finalizarPoligono}
                    size="lg"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-2xl animate-pulse h-14 px-10 text-lg"
                  >
                    ✓ FINALIZAR ÁREA
                  </Button>
                )}
                {modoDesenho === 'linha' && currentPoints.length >= 2 && (
                  <Button
                    onClick={finalizarLinha}
                    size="lg"
                    className="bg-orange-600 hover:bg-orange-700 text-white font-bold shadow-2xl animate-pulse h-14 px-10 text-lg"
                  >
                    ✓ FINALIZAR LINHA
                  </Button>
                )}
              </div>
            )}
            {modoEdicao && !modoDesenho && mapReady && (
              <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-10 bg-purple-600 text-white px-8 py-4 rounded-xl shadow-2xl font-bold text-base border-4 border-white">
                ✏️ MODO EDIÇÃO - Arraste vértices e elementos para editar
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="bg-slate-50 border-b py-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Layers className="w-4 h-4" />
              Camadas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            {modoEdicao && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-3">
                <div className="text-xs font-semibold text-purple-900 mb-1">✏️ Modo Edição Ativo</div>
                <div className="text-[10px] text-purple-700">
                  Arraste vértices e elementos
                </div>
              </div>
            )}
            
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">🧲 Snapping</span>
              <Button
                variant={snappingEnabled ? 'default' : 'outline'}
                size="sm"
                onClick={() => setSnappingEnabled(!snappingEnabled)}
                className="h-7 text-xs"
              >
                {snappingEnabled ? 'ON' : 'OFF'}
              </Button>
            </div>

            <div className="border-t pt-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Áreas ({areas.length})</span>
                <Button
                  variant={showAreas ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setShowAreas(!showAreas)}
                  className="h-7 text-xs"
                >
                  {showAreas ? <Eye className="w-3 h-3" /> : <X className="w-3 h-3" />}
                </Button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Pontos ({pontos.length})</span>
                <Button
                  variant={showPontos ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setShowPontos(!showPontos)}
                  className="h-7 text-xs"
                >
                  {showPontos ? <Eye className="w-3 h-3" /> : <X className="w-3 h-3" />}
                </Button>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Linhas ({linhas.length})</span>
                <Button
                  variant={showLinhas ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setShowLinhas(!showLinhas)}
                  className="h-7 text-xs"
                >
                  {showLinhas ? <Eye className="w-3 h-3" /> : <X className="w-3 h-3" />}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Sheet open={showFormularioArea} onOpenChange={setShowFormularioArea}>
        <SheetContent side="right" className="w-[400px] sm:w-[540px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Cadastrar Área</SheetTitle>
          </SheetHeader>
          <FormularioArea
            coordenadas={currentPoints}
            onSave={() => {
              setShowFormularioArea(false);
              cancelarDesenho();
              queryClient.invalidateQueries({ queryKey: ['areas'] });
            }}
            onCancel={() => setShowFormularioArea(false)}
          />
        </SheetContent>
      </Sheet>

      <Sheet open={showFormularioPonto} onOpenChange={setShowFormularioPonto}>
        <SheetContent side="right" className="w-[400px] sm:w-[540px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Cadastrar Ponto</SheetTitle>
          </SheetHeader>
          <FormularioPonto
            coordenadas={currentMarker}
            onSave={() => {
              setShowFormularioPonto(false);
              cancelarDesenho();
              queryClient.invalidateQueries({ queryKey: ['pontos'] });
            }}
            onCancel={() => {
              setShowFormularioPonto(false);
              cancelarDesenho();
            }}
          />
        </SheetContent>
      </Sheet>

      <Sheet open={showFormularioLinha} onOpenChange={setShowFormularioLinha}>
        <SheetContent side="right" className="w-[400px] sm:w-[540px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Cadastrar Linha</SheetTitle>
          </SheetHeader>
          <FormularioLinha
            coordenadas={currentPoints}
            onSave={() => {
              setShowFormularioLinha(false);
              cancelarDesenho();
              queryClient.invalidateQueries({ queryKey: ['linhas'] });
            }}
            onCancel={() => setShowFormularioLinha(false)}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}