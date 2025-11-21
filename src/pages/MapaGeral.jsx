import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Map, Layers, Eye, X } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  const [mapReady, setMapReady] = useState(false);
  const [mapType, setMapType] = useState('satellite');
  const [showAreas, setShowAreas] = useState(true);
  const [showPontos, setShowPontos] = useState(true);
  const [showLinhas, setShowLinhas] = useState(true);
  const [showLotes, setShowLotes] = useState(true);
  
  const [showDetalhesLote, setShowDetalhesLote] = useState(false);
  const [selectedLote, setSelectedLote] = useState(null);

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const polygonsRef = useRef([]);
  const markersRef = useRef([]);
  const polylinesRef = useRef([]);

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
  }, [areas, pontos, linhas, lotes, showAreas, showPontos, showLinhas, showLotes, iconesConfig, mapReady]);

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
          strokeWeight: 2,
          fillColor: cor,
          fillOpacity: 0.2,
        });

        polygon.setMap(mapInstanceRef.current);
        polygonsRef.current.push(polygon);

        polygon.addListener('click', (e) => {
          if (e.vertex === undefined) {
            const infoWindow = new google.maps.InfoWindow({
              content: `
                <div style="padding: 10px;">
                  <strong style="font-size: 14px;">${area.nome}</strong><br/>
                  <span style="font-size: 12px; color: #666;">Área: ${area.tamanho_hectares || 0} ha</span><br/>
                  <span style="font-size: 12px; color: #666;">Tipo: ${area.tipo_pastagem || '-'}</span>
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
              <div style="padding: 10px;">
                <strong style="font-size: 14px;">${linha.nome}</strong><br/>
                <span style="font-size: 12px; color: #666;">${linha.tipo} - ${linha.comprimento_metros ? (linha.comprimento_metros/1000).toFixed(2) + ' km' : 'N/A'}</span>
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
            scaledSize: new google.maps.Size(70, 70),
            anchor: new google.maps.Point(35, 35),
            labelOrigin: new google.maps.Point(35, 35)
          };
        } else {
          markerIcon = {
            url: 'https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690cd380760c45b456c6ef81/c3602d1e3_Designsemnome3.png',
            scaledSize: new google.maps.Size(70, 70),
            anchor: new google.maps.Point(35, 35),
            labelOrigin: new google.maps.Point(35, 35)
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
          title: lote.nome,
          zIndex: 1000
        });

        markersRef.current.push(marker);

        marker.addListener('click', (e) => {
          e.stop();
          setSelectedLote(lote);
          setShowDetalhesLote(true);
        });
      });
    }
  };

  return (
    <div className="p-6 max-w-screen-2xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Mapa Geral - Manejo</h1>
        <p className="text-sm text-slate-600">Visualize lotes, movimentações e informações da fazenda</p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-6 gap-4">
        <Card className="xl:col-span-5">
          <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Map className="w-5 h-5 text-blue-600" />
                Mapa de Manejo
              </CardTitle>

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
            </div>
          </CardHeader>

          <CardContent className="p-0 relative">
            <div
              ref={mapRef}
              style={{
                height: '750px',
                width: '100%',
                backgroundColor: '#e5e7eb'
              }}
            />
            {!mapReady && (
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 bg-white px-6 py-4 rounded-lg shadow-2xl">
                <div className="flex items-center gap-3">
                  <div className="animate-spin w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full"></div>
                  <span className="font-semibold text-slate-700">Carregando mapa...</span>
                </div>
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
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3">
              <div className="text-xs font-semibold text-blue-900 mb-1">ℹ️ Modo Visualização</div>
              <div className="text-[10px] text-blue-700">
                Clique nos elementos para ver detalhes
              </div>
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
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Lotes ({lotes.length})</span>
                <Button
                  variant={showLotes ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setShowLotes(!showLotes)}
                  className="h-7 text-xs"
                >
                  {showLotes ? <Eye className="w-3 h-3" /> : <X className="w-3 h-3" />}
                </Button>
              </div>
            </div>

            {showLotes && lotes.length > 0 && (
              <div className="border-t pt-3 space-y-2">
                <div className="text-xs font-semibold text-slate-700 mb-2">Lotes Ativos</div>
                {lotes.map(lote => {
                  const area = areas.find(a => a.id === lote.area_atual_id);
                  return (
                    <button
                      key={lote.id}
                      onClick={() => {
                        setSelectedLote(lote);
                        setShowDetalhesLote(true);
                      }}
                      className="w-full text-left p-2 rounded-lg hover:bg-slate-100 transition-colors"
                    >
                      <div className="text-xs font-semibold text-slate-900">{lote.nome}</div>
                      <div className="text-[10px] text-slate-600 flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] px-1 py-0">{lote.quantidade_cabecas} cabeças</Badge>
                        <span>{area?.nome || '-'}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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