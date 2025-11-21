import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Map, Square, MapPin, Minus, Layers, Filter, Save, X, Edit, Eye } from "lucide-react";
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
import DetalhesLote from "../components/mapa/DetalhesLote";

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

export default function MapaGeral() {
  const [mapType, setMapType] = useState('satellite');
  const [modoDesenho, setModoDesenho] = useState(null); // 'poligono', 'ponto', 'linha'
  const [showAreas, setShowAreas] = useState(true);
  const [showPontos, setShowPontos] = useState(true);
  const [showLinhas, setShowLinhas] = useState(true);
  const [showLotes, setShowLotes] = useState(true);
  
  const [currentPoints, setCurrentPoints] = useState([]);
  const [currentMarker, setCurrentMarker] = useState(null);
  
  const [showFormularioArea, setShowFormularioArea] = useState(false);
  const [showFormularioPonto, setShowFormularioPonto] = useState(false);
  const [showFormularioLinha, setShowFormularioLinha] = useState(false);
  const [showDetalhesLote, setShowDetalhesLote] = useState(false);
  
  const [selectedLote, setSelectedLote] = useState(null);
  const [editingItem, setEditingItem] = useState(null);

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const polygonsRef = useRef([]);
  const markersRef = useRef([]);
  const polylinesRef = useRef([]);
  const currentPolygonRef = useRef(null);
  const currentPolylineRef = useRef(null);
  const tempMarkerRef = useRef(null);
  const guideLineRef = useRef(null);

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

  const { data: lotes = [] } = useQuery({
    queryKey: ['lotes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter(l => l.empresa_id === empresaSelecionadaId && l.status === 'Ativo');
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
      renderMap();
    });
  }, []);

  useEffect(() => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setMapTypeId(mapType);
    }
  }, [mapType]);

  useEffect(() => {
    if (mapInstanceRef.current) {
      renderMap();
    }
  }, [areas, pontos, linhas, lotes, showAreas, showPontos, showLinhas, showLotes, iconesConfig]);

  // Listener de clique no mapa para desenhar
  useEffect(() => {
    if (!mapInstanceRef.current || !modoDesenho) return;

    const handleMapClick = (e) => {
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      
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
          toast.success(`Ponto ${updated.length} adicionado`, { duration: 1000 });
          return updated;
        });
      }
    };

    const listener = google.maps.event.addListener(mapInstanceRef.current, 'click', handleMapClick);
    return () => google.maps.event.removeListener(listener);
  }, [modoDesenho]);

  // Listener para mostrar "setinha" (linha guia) ao mover o mouse
  useEffect(() => {
    if (!mapInstanceRef.current || !modoDesenho || currentPoints.length === 0) return;
    if (modoDesenho === 'ponto') return;

    const handleMouseMove = (e) => {
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      const lastPoint = currentPoints[currentPoints.length - 1];

      if (guideLineRef.current) {
        guideLineRef.current.setMap(null);
      }

      guideLineRef.current = new google.maps.Polyline({
        path: [lastPoint, { lat, lng }],
        strokeColor: '#3b82f6',
        strokeOpacity: 0.6,
        strokeWeight: 2,
        map: mapInstanceRef.current
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
  }, [modoDesenho, currentPoints]);

  // Desenhar polígono/linha temporária conforme pontos são adicionados
  useEffect(() => {
    if (!mapInstanceRef.current || currentPoints.length === 0) return;

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

    // Renderizar áreas
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
          strokeWeight: 2.5,
          fillColor: cor,
          fillOpacity: 0.35,
        });

        polygon.setMap(mapInstanceRef.current);
        polygonsRef.current.push(polygon);

        polygon.addListener('click', () => {
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
        });
      });
    }

    // Renderizar pontos
    if (showPontos) {
      pontos.forEach(ponto => {
        const coords = ponto.coordenadas || {};
        if (!coords.lat || !coords.lng) return;

        const configIcone = iconesConfig.find(ic => ic.tipo_entidade === 'Ponto' && ic.categoria === ponto.tipo);
        let markerIcon;

        if (configIcone?.icone_url) {
          markerIcon = {
            url: configIcone.icone_url,
            scaledSize: new google.maps.Size(40, 40),
            anchor: new google.maps.Point(20, 20)
          };
        } else {
          markerIcon = {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 12,
            fillColor: configIcone?.cor_padrao || ponto.cor || '#0066ff',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 3
          };
        }

        const marker = new google.maps.Marker({
          position: { lat: coords.lat, lng: coords.lng },
          map: mapInstanceRef.current,
          icon: markerIcon,
          title: ponto.nome,
        });

        markersRef.current.push(marker);

        marker.addListener('click', () => {
          const infoWindow = new google.maps.InfoWindow({
            content: `
              <div style="padding: 10px;">
                <strong style="font-size: 14px;">${ponto.nome}</strong><br/>
                <span style="font-size: 12px; color: #666;">${ponto.tipo}</span>
              </div>
            `
          });
          infoWindow.open(mapInstanceRef.current, marker);
        });
      });
    }

    // Renderizar linhas
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
          strokeWeight: 3,
        });

        polyline.setMap(mapInstanceRef.current);
        polylinesRef.current.push(polyline);

        polyline.addListener('click', () => {
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
        });
      });
    }

    // Renderizar lotes
    if (showLotes) {
      lotes.forEach(lote => {
        if (!lote.area_atual_id) return;
        const area = areas.find(a => a.id === lote.area_atual_id);
        if (!area || !area.coordenadas?.coords || area.coordenadas.coords.length < 3) return;

        const paths = area.coordenadas.coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
        const bounds = new google.maps.LatLngBounds();
        paths.forEach(p => bounds.extend(p));
        const center = bounds.getCenter();

        const configIcone = iconesConfig.find(ic => ic.tipo_entidade === 'Lote' && ic.categoria === lote.categoria);
        let markerIcon;

        if (configIcone?.icone_url) {
          markerIcon = {
            url: configIcone.icone_url,
            scaledSize: new google.maps.Size(50, 50),
            anchor: new google.maps.Point(25, 25),
            labelOrigin: new google.maps.Point(25, 25)
          };
        } else {
          markerIcon = {
            url: 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690cd380760c45b456c6ef81/c3602d1e3_Designsemnome3.png',
            scaledSize: new google.maps.Size(50, 50),
            anchor: new google.maps.Point(25, 25),
            labelOrigin: new google.maps.Point(25, 25)
          };
        }

        const marker = new google.maps.Marker({
          position: center,
          map: mapInstanceRef.current,
          icon: markerIcon,
          label: {
            text: String(lote.quantidade_cabecas),
            color: '#ffffff',
            fontSize: '14px',
            fontWeight: 'bold'
          },
          title: lote.nome
        });

        markersRef.current.push(marker);

        marker.addListener('click', () => {
          setSelectedLote(lote);
          setShowDetalhesLote(true);
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
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Mapa Geral da Fazenda</h1>
          <p className="text-xs text-slate-600">Gerencie áreas, pontos, linhas e lotes no mapa</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
        <Card className="lg:col-span-4">
          <CardHeader className="bg-slate-50 border-b py-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Map className="w-4 h-4" />
                Mapa Interativo
              </CardTitle>

              <div className="flex gap-2 flex-wrap">
                <div className="flex gap-1 bg-white border rounded-md p-1">
                  <Button
                    variant={mapType === 'roadmap' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setMapType('roadmap')}
                    className="h-7 text-xs"
                  >
                    Mapa
                  </Button>
                  <Button
                    variant={mapType === 'satellite' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setMapType('satellite')}
                    className="h-7 text-xs"
                  >
                    Satélite
                  </Button>
                </div>

                {!modoDesenho && (
                  <>
                    <Button
                      onClick={() => setModoDesenho('poligono')}
                      size="sm"
                      className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                    >
                      <Square className="w-3 h-3 mr-1" />
                      Desenhar Área
                    </Button>
                    <Button
                      onClick={() => setModoDesenho('ponto')}
                      size="sm"
                      className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
                    >
                      <MapPin className="w-3 h-3 mr-1" />
                      Adicionar Ponto
                    </Button>
                    <Button
                      onClick={() => setModoDesenho('linha')}
                      size="sm"
                      className="h-7 text-xs bg-orange-600 hover:bg-orange-700"
                    >
                      <Minus className="w-3 h-3 mr-1" />
                      Desenhar Linha
                    </Button>
                  </>
                )}

                {modoDesenho && (
                  <>
                    <Button
                      onClick={cancelarDesenho}
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                    >
                      <X className="w-3 h-3 mr-1" />
                      Cancelar
                    </Button>
                    {modoDesenho === 'poligono' && (
                      <Button
                        onClick={finalizarPoligono}
                        size="sm"
                        disabled={currentPoints.length < 3}
                        className={`h-7 text-xs ${currentPoints.length >= 3 ? 'bg-emerald-600 hover:bg-emerald-700 animate-pulse' : 'bg-slate-400'}`}
                      >
                        <Save className="w-3 h-3 mr-1" />
                        Finalizar ({currentPoints.length})
                      </Button>
                    )}
                    {modoDesenho === 'linha' && (
                      <Button
                        onClick={finalizarLinha}
                        size="sm"
                        disabled={currentPoints.length < 2}
                        className={`h-7 text-xs ${currentPoints.length >= 2 ? 'bg-orange-600 hover:bg-orange-700 animate-pulse' : 'bg-slate-400'}`}
                      >
                        <Save className="w-3 h-3 mr-1" />
                        Finalizar ({currentPoints.length})
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="p-0 relative">
            <div
              ref={mapRef}
              style={{
                height: '700px',
                width: '100%',
                backgroundColor: '#e5e7eb',
                cursor: modoDesenho ? 'crosshair' : 'default'
              }}
            />
            {modoDesenho && (
              <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-10 bg-blue-600 text-white px-6 py-3 rounded-lg shadow-2xl font-bold text-sm border-2 border-white">
                {modoDesenho === 'poligono' && `🎯 Clique no mapa para desenhar a área (${currentPoints.length} pontos)`}
                {modoDesenho === 'ponto' && '📍 Clique no mapa para posicionar o ponto'}
                {modoDesenho === 'linha' && `➡️ Clique no mapa para desenhar a linha (${currentPoints.length} pontos)`}
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
            <div className="flex items-center justify-between">
              <span className="text-xs">Áreas ({areas.length})</span>
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
              <span className="text-xs">Pontos ({pontos.length})</span>
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
              <span className="text-xs">Linhas ({linhas.length})</span>
              <Button
                variant={showLinhas ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowLinhas(!showLinhas)}
                className="h-7 text-xs"
              >
                {showLinhas ? <Eye className="w-3 h-3" /> : <X className="w-3 h-3" />}
              </Button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs">Lotes ({lotes.length})</span>
              <Button
                variant={showLotes ? 'default' : 'outline'}
                size="sm"
                onClick={() => setShowLotes(!showLotes)}
                className="h-7 text-xs"
              >
                {showLotes ? <Eye className="w-3 h-3" /> : <X className="w-3 h-3" />}
              </Button>
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
            onCancel={() => {
              setShowFormularioArea(false);
              cancelarDesenho();
            }}
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
            onCancel={() => {
              setShowFormularioLinha(false);
              cancelarDesenho();
            }}
          />
        </SheetContent>
      </Sheet>

      <Sheet open={showDetalhesLote} onOpenChange={setShowDetalhesLote}>
        <SheetContent side="right" className="w-[400px] sm:w-[540px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Detalhes do Lote</SheetTitle>
          </SheetHeader>
          {selectedLote && (
            <DetalhesLote
              lote={selectedLote}
              onClose={() => setShowDetalhesLote(false)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}