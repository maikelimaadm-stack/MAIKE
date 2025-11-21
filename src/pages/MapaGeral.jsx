import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
  const [showMapa, setShowMapa] = useState(false); // controla se mostra mapa ou lista
  const [mapReady, setMapReady] = useState(false);
  const [mapType, setMapType] = useState('satellite');
  const [modoDesenho, setModoDesenho] = useState(null); // 'poligono', 'ponto', 'linha'
  const [modoEdicao, setModoEdicao] = useState(false); // modo de edição/visualização
  const [modoAjuste, setModoAjuste] = useState(false); // modo de ajuste antes de salvar
  const [snappingEnabled, setSnappingEnabled] = useState(true);
  const [showAreas, setShowAreas] = useState(true);
  const [showPontos, setShowPontos] = useState(true);
  const [showLinhas, setShowLinhas] = useState(true);
  const [showLotes, setShowLotes] = useState(true);
  const [activeTab, setActiveTab] = useState('areas'); // 'areas', 'pontos', 'linhas'
  
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
  const pointMarkersRef = useRef([]);
  const lastClickTimeRef = useRef(0);
  const lastClickPositionRef = useRef(null);

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

  const SNAP_DISTANCE = 30; // pixels

  const findNearestPoint = (mouseLatLng, map) => {
    if (!snappingEnabled) return null;

    const projection = map.getProjection();
    if (!projection) return null;

    const mousePoint = projection.fromLatLngToPoint(mouseLatLng);
    let nearestPoint = null;
    let minDistance = Infinity;

    // Verificar pontos de áreas
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

    // Verificar pontos de linhas
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
    setModoAjuste(false);
    setCurrentPoints([]);
    setCurrentMarker(null);
    setShowMapa(false);
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
    // Limpar marcadores dos pontos
    pointMarkersRef.current.forEach(m => m.setMap(null));
    pointMarkersRef.current = [];
  };

  const iniciarDesenho = (tipo) => {
    setModoDesenho(tipo);
    setShowMapa(true);
    setCurrentPoints([]);
    setCurrentMarker(null);
  };

  useEffect(() => {
    if (!showMapa) {
      setMapReady(false);
      if (mapInstanceRef.current) {
        mapInstanceRef.current = null;
      }
      return;
    }
    
    loadGoogleMapsScript().then(() => {
      if (!mapRef.current) return;

      // Se já existe mapa, apenas marca como ready
      if (mapInstanceRef.current) {
        setMapReady(true);
        return;
      }

      const map = new google.maps.Map(mapRef.current, {
        center: { lat: -15.0067, lng: -59.9533 },
        zoom: 15,
        mapTypeId: mapType,
        mapTypeControl: true,
        streetViewControl: false,
        fullscreenControl: true,
      });

      mapInstanceRef.current = map;
      
      // Aguardar mapa carregar completamente
      google.maps.event.addListenerOnce(map, 'tilesloaded', () => {
        setTimeout(() => {
          setMapReady(true);
        }, 100);
      });
    }).catch((error) => {
      console.error('Erro ao carregar mapa:', error);
      toast.error('Erro ao carregar mapa. Tente novamente.');
    });
  }, [showMapa]);

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

  // Listener de clique no mapa para desenhar
  useEffect(() => {
    if (!mapInstanceRef.current || !modoDesenho || !mapReady || modoAjuste) return;

    const handleMapClick = (e) => {
      e.stop();
      
      let lat = e.latLng.lat();
      let lng = e.latLng.lng();
      
      // Aplicar snapping
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
    return () => {
      google.maps.event.removeListener(listener);
    };
  }, [modoDesenho, mapReady, modoAjuste]);

  // Listener para mostrar "setinha" (linha guia) ao mover o mouse
  useEffect(() => {
    if (!mapInstanceRef.current || !modoDesenho || currentPoints.length === 0 || !mapReady) {
      if (guideLineRef.current) {
        guideLineRef.current.setMap(null);
        guideLineRef.current = null;
      }
      return;
    }
    if (modoDesenho === 'ponto') return;

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

  // Desenhar polígono/linha temporária e marcadores nos pontos
  useEffect(() => {
    if (!mapInstanceRef.current || currentPoints.length === 0 || !modoDesenho) return;

    // Limpar marcadores anteriores
    pointMarkersRef.current.forEach(m => m.setMap(null));
    pointMarkersRef.current = [];

    // Criar marcadores editáveis para cada ponto
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

      // Atualizar posição ao arrastar
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
          strokeWeight: modoEdicao ? 3 : 2.5,
          fillColor: cor,
          fillOpacity: modoEdicao ? 0.25 : 0.35,
          editable: modoEdicao,
          draggable: modoEdicao,
        });

        polygon.setMap(mapInstanceRef.current);
        polygonsRef.current.push(polygon);

        // Salvar alterações quando editar
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
          google.maps.event.addListener(polygon, 'dragend', updateAreaMutation);
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

        // Salvar posição ao arrastar em modo de edição
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
          strokeWeight: modoEdicao ? 4 : 3,
          editable: modoEdicao,
          draggable: modoEdicao,
        });

        polyline.setMap(mapInstanceRef.current);
        polylinesRef.current.push(polyline);

        // Salvar alterações quando editar
        if (modoEdicao) {
          const updateLinhaMutation = async () => {
            const newPaths = polyline.getPath().getArray().map(p => [p.lat(), p.lng()]);
            
            // Recalcular comprimento
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
          google.maps.event.addListener(polyline, 'dragend', updateLinhaMutation);
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

  const continuarDesenho = () => {
    setModoAjuste(false);
  };

  if (!showMapa) {
    return (
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">Cadastro de Elementos do Mapa</h1>
            <p className="text-xs text-slate-600">Gerencie áreas, pontos e linhas da fazenda</p>
          </div>
        </div>

        <div className="flex gap-2 border-b">
          <Button
            variant={activeTab === 'areas' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('areas')}
            className="h-8 text-xs"
          >
            Áreas ({areas.length})
          </Button>
          <Button
            variant={activeTab === 'pontos' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('pontos')}
            className="h-8 text-xs"
          >
            Pontos ({pontos.length})
          </Button>
          <Button
            variant={activeTab === 'linhas' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setActiveTab('linhas')}
            className="h-8 text-xs"
          >
            Linhas ({linhas.length})
          </Button>
        </div>

        {activeTab === 'areas' && (
          <Card>
            <CardHeader className="bg-slate-50 border-b py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Áreas Cadastradas</CardTitle>
                <Button
                  onClick={() => iniciarDesenho('poligono')}
                  size="sm"
                  className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                >
                  <Square className="w-3 h-3 mr-1" />
                  Nova Área
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Código</th>
                      <th className="text-left px-3 py-2 font-semibold">Nome</th>
                      <th className="text-left px-3 py-2 font-semibold">Tipo</th>
                      <th className="text-left px-3 py-2 font-semibold">Área (ha)</th>
                      <th className="text-left px-3 py-2 font-semibold">Capacidade</th>
                      <th className="text-left px-3 py-2 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {areas.length === 0 ? (
                      <tr>
                        <td colSpan="6" className="text-center py-8 text-slate-500">
                          Nenhuma área cadastrada. Clique em "Nova Área" para começar.
                        </td>
                      </tr>
                    ) : (
                      areas.map(area => (
                        <tr key={area.id} className="border-b hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono">#{area.numero_area}</td>
                          <td className="px-3 py-2 font-semibold">{area.nome}</td>
                          <td className="px-3 py-2">{area.tipo_pastagem}</td>
                          <td className="px-3 py-2">{area.tamanho_hectares} ha</td>
                          <td className="px-3 py-2">{area.capacidade_maxima} UA</td>
                          <td className="px-3 py-2">
                            <Badge variant="outline">{area.status_ocupacao}</Badge>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === 'pontos' && (
          <Card>
            <CardHeader className="bg-slate-50 border-b py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Pontos de Referência</CardTitle>
                <Button
                  onClick={() => iniciarDesenho('ponto')}
                  size="sm"
                  className="h-8 text-xs bg-blue-600 hover:bg-blue-700"
                >
                  <MapPin className="w-3 h-3 mr-1" />
                  Novo Ponto
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Código</th>
                      <th className="text-left px-3 py-2 font-semibold">Nome</th>
                      <th className="text-left px-3 py-2 font-semibold">Tipo</th>
                      <th className="text-left px-3 py-2 font-semibold">Observações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pontos.length === 0 ? (
                      <tr>
                        <td colSpan="4" className="text-center py-8 text-slate-500">
                          Nenhum ponto cadastrado. Clique em "Novo Ponto" para começar.
                        </td>
                      </tr>
                    ) : (
                      pontos.map(ponto => (
                        <tr key={ponto.id} className="border-b hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono">#{ponto.numero_ponto}</td>
                          <td className="px-3 py-2 font-semibold">{ponto.nome}</td>
                          <td className="px-3 py-2">{ponto.tipo}</td>
                          <td className="px-3 py-2 text-slate-500">{ponto.observacoes || '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === 'linhas' && (
          <Card>
            <CardHeader className="bg-slate-50 border-b py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Linhas Geográficas</CardTitle>
                <Button
                  onClick={() => iniciarDesenho('linha')}
                  size="sm"
                  className="h-8 text-xs bg-orange-600 hover:bg-orange-700"
                >
                  <Minus className="w-3 h-3 mr-1" />
                  Nova Linha
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="text-left px-3 py-2 font-semibold">Código</th>
                      <th className="text-left px-3 py-2 font-semibold">Nome</th>
                      <th className="text-left px-3 py-2 font-semibold">Tipo</th>
                      <th className="text-left px-3 py-2 font-semibold">Comprimento</th>
                      <th className="text-left px-3 py-2 font-semibold">Observações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="text-center py-8 text-slate-500">
                          Nenhuma linha cadastrada. Clique em "Nova Linha" para começar.
                        </td>
                      </tr>
                    ) : (
                      linhas.map(linha => (
                        <tr key={linha.id} className="border-b hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono">#{linha.numero_linha}</td>
                          <td className="px-3 py-2 font-semibold">{linha.nome}</td>
                          <td className="px-3 py-2">{linha.tipo}</td>
                          <td className="px-3 py-2">
                            {linha.comprimento_metros ? `${(linha.comprimento_metros/1000).toFixed(2)} km` : '-'}
                          </td>
                          <td className="px-3 py-2 text-slate-500">{linha.observacoes || '-'}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {modoDesenho === 'poligono' && 'Desenhar Nova Área'}
            {modoDesenho === 'ponto' && 'Adicionar Novo Ponto'}
            {modoDesenho === 'linha' && 'Desenhar Nova Linha'}
            {!modoDesenho && 'Mapa Geral da Fazenda'}
          </h1>
          <p className="text-xs text-slate-600">
            {modoDesenho ? 'Clique no mapa para desenhar' : 'Visualize e edite elementos'}
          </p>
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
                      onClick={() => setModoEdicao(!modoEdicao)}
                      size="sm"
                      variant={modoEdicao ? 'default' : 'outline'}
                      className={`h-7 text-xs ${modoEdicao ? 'bg-purple-600 hover:bg-purple-700' : ''}`}
                    >
                      <Edit className="w-3 h-3 mr-1" />
                      {modoEdicao ? 'Modo Edição' : 'Editar'}
                    </Button>
                    <Button
                      onClick={() => setModoDesenho('poligono')}
                      size="sm"
                      className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700"
                      disabled={modoEdicao}
                    >
                      <Square className="w-3 h-3 mr-1" />
                      Área
                    </Button>
                    <Button
                      onClick={() => setModoDesenho('ponto')}
                      size="sm"
                      className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
                      disabled={modoEdicao}
                    >
                      <MapPin className="w-3 h-3 mr-1" />
                      Ponto
                    </Button>
                    <Button
                      onClick={() => setModoDesenho('linha')}
                      size="sm"
                      className="h-7 text-xs bg-orange-600 hover:bg-orange-700"
                      disabled={modoEdicao}
                    >
                      <Minus className="w-3 h-3 mr-1" />
                      Linha
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
                cursor: (modoDesenho && mapReady) ? 'crosshair' : 'default'
              }}
              className={modoDesenho && mapReady ? '[&_*]:cursor-crosshair' : ''}
            />
            {!mapReady && showMapa && (
              <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 bg-white px-6 py-4 rounded-lg shadow-2xl">
                <div className="flex items-center gap-3">
                  <div className="animate-spin w-6 h-6 border-4 border-emerald-600 border-t-transparent rounded-full"></div>
                  <span className="font-semibold text-slate-700">Carregando mapa...</span>
                </div>
              </div>
            )}
            {modoDesenho && mapReady && (
              <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-10 flex flex-col items-center gap-2">
                <div className="bg-blue-600 text-white px-6 py-3 rounded-lg shadow-2xl font-bold text-sm border-2 border-white">
                  {modoDesenho === 'poligono' && `🎯 Clique no mapa para adicionar pontos (${currentPoints.length}) • Arraste os pontos para editar`}
                  {modoDesenho === 'ponto' && '📍 Clique no mapa para posicionar o ponto'}
                  {modoDesenho === 'linha' && `➡️ Clique no mapa para adicionar pontos (${currentPoints.length}) • Arraste os pontos para editar`}
                </div>
                {modoDesenho === 'poligono' && currentPoints.length >= 3 && (
                  <Button
                    onClick={finalizarPoligono}
                    size="lg"
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold shadow-2xl animate-pulse h-12 px-8"
                  >
                    ✓ FINALIZAR DESENHO
                  </Button>
                )}
                {modoDesenho === 'linha' && currentPoints.length >= 2 && (
                  <Button
                    onClick={finalizarLinha}
                    size="lg"
                    className="bg-orange-600 hover:bg-orange-700 text-white font-bold shadow-2xl animate-pulse h-12 px-8"
                  >
                    ✓ FINALIZAR DESENHO
                  </Button>
                )}
              </div>
            )}
            {modoEdicao && !modoDesenho && mapReady && (
              <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-10 bg-purple-600 text-white px-6 py-3 rounded-lg shadow-2xl font-bold text-sm border-2 border-white">
                ✏️ MODO EDIÇÃO - Arraste vértices para editar elementos
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
              <div className="bg-purple-50 border border-purple-200 rounded p-2 mb-3">
                <div className="text-xs font-semibold text-purple-900 mb-1">✏️ Modo Edição</div>
                <div className="text-[10px] text-purple-700">
                  Arraste vértices e elementos para editar
                </div>
              </div>
            )}
            
            <div className="flex items-center justify-between">
              <span className="text-xs">🧲 Snapping</span>
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