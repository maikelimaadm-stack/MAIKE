import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Map, Layers, X, ArrowLeft, Target, RefreshCw, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import DetalhesLote from "../components/mapa/DetalhesLote";
import DetalhesPontoSuplementacao from "../components/mapa/DetalhesPontoSuplementacao";
import DetalhesArea from "../components/mapa/DetalhesArea";
import TarefasMapaPanel from "../components/mapa/TarefasMapaPanel";

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
  const [showPontosSuplementacao, setShowPontosSuplementacao] = useState(true);
  const [filtroCategoria, setFiltroCategoria] = useState('todas');
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [showAlertas, setShowAlertas] = useState(true);
  const [forceUpdate, setForceUpdate] = useState(0);
  
  const [showDetalhesLote, setShowDetalhesLote] = useState(false);
  const [selectedLote, setSelectedLote] = useState(null);
  const [showDetalhesPontoSupl, setShowDetalhesPontoSupl] = useState(false);
  const [selectedPontoSupl, setSelectedPontoSupl] = useState(null);
  const [showDetalhesArea, setShowDetalhesArea] = useState(false);
  const [selectedArea, setSelectedArea] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [showUserLocation, setShowUserLocation] = useState(false);
  const [showTarefas, setShowTarefas] = useState(false);
  const [tarefasContext, setTarefasContext] = useState({});

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const polygonsRef = useRef([]);
  const markersRef = useRef([]);
  const polylinesRef = useRef([]);
  const userMarkerRef = useRef(null);

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: areas = [], refetch: refetchAreas } = useQuery({
    queryKey: ['areas', empresaSelecionadaId, forceUpdate],
    queryFn: async () => {
      if (!navigator.onLine) {
        const cached = localStorage.getItem('cache_areas');
        if (cached) return JSON.parse(cached).filter(a => a.empresa_id === empresaSelecionadaId);
        return [];
      }
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: pontos = [] } = useQuery({
    queryKey: ['pontos', empresaSelecionadaId],
    queryFn: async () => {
      if (!navigator.onLine) {
        const cached = localStorage.getItem('cache_pontos_referencia');
        if (cached) return JSON.parse(cached).filter(p => p.empresa_id === empresaSelecionadaId);
        return [];
      }
      const all = await base44.entities.PontoReferencia.list();
      return all.filter(p => p.empresa_id === empresaSelecionadaId && p.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: pontosSuplementacao = [], refetch: refetchPontos } = useQuery({
    queryKey: ['pontos-suplementacao', empresaSelecionadaId],
    queryFn: async () => {
      if (!navigator.onLine) {
        const cached = localStorage.getItem('cache_pontos_suplementacao');
        if (cached) return JSON.parse(cached).filter(p => p.empresa_id === empresaSelecionadaId);
        return [];
      }
      const all = await base44.entities.PontoSuplementacao.list();
      return all.filter(p => p.empresa_id === empresaSelecionadaId && p.status === 'Ativo');
    },
    enabled: !!empresaSelecionadaId,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: linhas = [] } = useQuery({
    queryKey: ['linhas', empresaSelecionadaId],
    queryFn: async () => {
      if (!navigator.onLine) {
        const cached = localStorage.getItem('cache_linhas');
        if (cached) return JSON.parse(cached).filter(l => l.empresa_id === empresaSelecionadaId);
        return [];
      }
      const all = await base44.entities.LinhaGeografica.list();
      return all.filter(l => l.empresa_id === empresaSelecionadaId && l.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: lotes = [], refetch: refetchLotes } = useQuery({
    queryKey: ['lotes', empresaSelecionadaId, forceUpdate],
    queryFn: async () => {
      if (!navigator.onLine) {
        const cached = localStorage.getItem('cache_lotes');
        if (cached) return JSON.parse(cached).filter(l => l.empresa_id === empresaSelecionadaId && l.status === 'Ativo');
        return [];
      }
      const all = await base44.entities.Lote.list();
      return all.filter(l => l.empresa_id === empresaSelecionadaId && l.status === 'Ativo');
    },
    enabled: !!empresaSelecionadaId,
    staleTime: 0,
    cacheTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones-global'],
    queryFn: async () => {
      if (!navigator.onLine) {
        const cached = localStorage.getItem('cache_icones');
        if (cached) return JSON.parse(cached).filter(i => i.ativo !== false);
        return [];
      }
      const all = await base44.entities.ConfiguracaoIcone.list();
      const filtered = all.filter(i => i.ativo !== false);
      console.log('🎨 ÍCONES CARREGADOS:', filtered.length, filtered);
      return filtered;
    },
  });

  const { data: eventosSupl = [], refetch: refetchEventosSupl } = useQuery({
    queryKey: ['eventos-suplementacao', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoEvento.list();
      return all.filter(e => e.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: pontosSupl = [] } = useQuery({
    queryKey: ['pontos-supl-config', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PontoSuplementacao.list();
      return all.filter(p => p.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: tarefasMapa = [], refetch: refetchTarefas } = useQuery({
    queryKey: ['tarefas-mapa', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.TarefaMapa.list();
      return all.filter(t => 
        t.empresa_id === empresaSelecionadaId && 
        t.coordenadas && 
        (t.status === 'Pendente' || t.status === 'Em Andamento')
      );
    },
    enabled: !!empresaSelecionadaId,
  });

  // Calcular alertas
  const lotesComAlerta = lotes.map(lote => {
    const alertas = [];
    
    // Verificar alerta de suplementação (sem lançamento há mais de 10 dias)
    const eventosPonto = eventosSupl.filter(e => e.area_id === lote.area_atual_id);
    if (eventosPonto.length > 0) {
      const ultimoEvento = eventosPonto.sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento))[0];
      const diasSemLancamento = Math.floor((new Date() - new Date(ultimoEvento.data_lancamento)) / (1000 * 60 * 60 * 24));
      if (diasSemLancamento > 10) {
        alertas.push({ tipo: 'suplementacao', dias: diasSemLancamento });
      }
    }
    
    // Verificar se tem peso baixo (menos de 50kg para categorias jovens)
    if (lote.peso_medio_kg && lote.peso_medio_kg < 50 && 
        (lote.categoria?.includes('Bezerr') || lote.categoria?.includes('0 a 12'))) {
      alertas.push({ tipo: 'peso_baixo', peso: lote.peso_medio_kg });
    }
    
    return { ...lote, alertas };
  });

  // Extrair categorias únicas
  const categorias = [...new Set(lotes.map(l => l.categoria).filter(Boolean))].sort();
  
  // Filtrar lotes
  const lotesFiltrados = lotesComAlerta.filter(lote => {
    if (filtroCategoria !== 'todas' && lote.categoria !== filtroCategoria) return false;
    if (filtroStatus === 'com_alerta' && lote.alertas.length === 0) return false;
    if (filtroStatus === 'sem_alerta' && lote.alertas.length > 0) return false;
    return true;
  });

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
  }, [areas, pontos, linhas, lotesFiltrados, pontosSuplementacao, showAreas, showPontos, showLinhas, showLotes, showPontosSuplementacao, iconesConfig, mapReady, showAlertas, userLocation, showUserLocation, tarefasMapa]);

  useEffect(() => {
    const handleAtualizarMapa = () => {
      setForceUpdate(prev => prev + 1);
      refetchLotes();
      refetchAreas();
    };

    window.addEventListener('atualizar-mapa', handleAtualizarMapa);
    return () => window.removeEventListener('atualizar-mapa', handleAtualizarMapa);
  }, []);

  const renderMap = () => {
    if (!mapInstanceRef.current) return;

    polygonsRef.current.forEach(p => p.setMap(null));
    markersRef.current.forEach(m => m.setMap(null));
    polylinesRef.current.forEach(l => l.setMap(null));
    if (userMarkerRef.current) userMarkerRef.current.setMap(null);
    polygonsRef.current = [];
    markersRef.current = [];
    polylinesRef.current = [];

    // Renderizar localização do usuário
    if (showUserLocation && userLocation) {
      const userMarker = new google.maps.Marker({
        position: userLocation,
        map: mapInstanceRef.current,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: '#4285F4',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3
        },
        title: 'Sua localização',
        zIndex: 10000
      });

      // Círculo de precisão
      new google.maps.Circle({
        map: mapInstanceRef.current,
        center: userLocation,
        radius: 20,
        fillColor: '#4285F4',
        fillOpacity: 0.15,
        strokeColor: '#4285F4',
        strokeOpacity: 0.3,
        strokeWeight: 1,
        zIndex: 9999
      });

      userMarkerRef.current = userMarker;
    }

    if (showAreas) {
      areas.forEach(area => {
        const coords = area.coordenadas?.coords || [];
        if (coords.length < 3) return;

        const paths = coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
        const cor = area.coordenadas?.cor || area.cor || '#61aad9';

        const polygon = new google.maps.Polygon({
          paths,
          strokeColor: cor,
          strokeOpacity: 0.6,
          strokeWeight: 1,
          fillColor: cor,
          fillOpacity: 0.5,
        });

        polygon.addListener('mouseover', () => {
          polygon.setOptions({
            strokeColor: '#ffffff',
            strokeOpacity: 1,
            strokeWeight: 3,
          });
        });

        polygon.addListener('mouseout', () => {
          polygon.setOptions({
            strokeColor: cor,
            strokeOpacity: 0.6,
            strokeWeight: 1,
          });
        });

        polygon.setMap(mapInstanceRef.current);
        polygonsRef.current.push(polygon);

        polygon.addListener('click', (e) => {
                      if (e.vertex === undefined) {
                        // Abrir detalhes da área
                        setSelectedArea(area);
                        setShowDetalhesArea(true);
                      }
                    });

                    // Clique com botão direito para abrir tarefas
                    polygon.addListener('rightclick', (e) => {
                      setTarefasContext({ areaId: area.id, areaNome: area.nome });
                      setShowTarefas(true);
                    });

        // Calcular centro e área em hectares
        const bounds = new google.maps.LatLngBounds();
        paths.forEach(p => bounds.extend(p));
        const center = bounds.getCenter();

        let areaHa = area.tamanho_hectares || 0;
        if (!areaHa && window.google?.maps?.geometry?.spherical) {
          const pathLatLng = paths.map(p => new google.maps.LatLng(p.lat, p.lng));
          const areaM2 = google.maps.geometry.spherical.computeArea(pathLatLng);
          areaHa = areaM2 / 10000;
        }

        // Label com nome do pasto e hectares no centro da área
        const areaLabelDiv = document.createElement('div');
        areaLabelDiv.innerHTML = `
          <div style="
            color: white;
            text-align: center;
            white-space: nowrap;
            text-shadow: 1px 1px 3px rgba(0,0,0,0.8), -1px -1px 3px rgba(0,0,0,0.8);
            pointer-events: none;
          ">
            <div style="font-size: 13px; font-weight: 700;">${area.nome || 'Sem nome'}</div>
            <div style="font-size: 11px; font-weight: 500;">${areaHa.toFixed(0)}ha</div>
          </div>
        `;

        const areaLabelOverlay = new google.maps.OverlayView();
        areaLabelOverlay.onAdd = function() {
          const pane = this.getPanes().overlayLayer;
          pane.appendChild(areaLabelDiv);
        };
        areaLabelOverlay.draw = function() {
          const projection = this.getProjection();
          const position = projection.fromLatLngToDivPixel(center);
          areaLabelDiv.style.position = 'absolute';
          areaLabelDiv.style.left = position.x - 50 + 'px';
          areaLabelDiv.style.top = position.y - 15 + 'px';
          areaLabelDiv.style.width = '100px';
        };
        areaLabelOverlay.onRemove = function() {
          areaLabelDiv.parentNode?.removeChild(areaLabelDiv);
        };
        areaLabelOverlay.setMap(mapInstanceRef.current);
        markersRef.current.push({ setMap: (m) => areaLabelOverlay.setMap(m) });
      });
    }

    if (showPontos) {
      pontos.forEach(ponto => {
        const coords = ponto.coordenadas || {};
        if (!coords.lat || !coords.lng) return;

        const configIcone = iconesConfig.find(ic => ic.tipo_entidade === 'Ponto' && ic.categoria?.toUpperCase().trim() === ponto.tipo?.toUpperCase().trim());
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
            scale: 30,
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

    if (showPontosSuplementacao) {
      pontosSuplementacao.forEach(ponto => {
        const coords = ponto.coordenadas || {};
        if (!coords.lat || !coords.lng) return;

        // Buscar configuração do ícone (tipo Ponto com categoria COCHO)
        const configIcone = iconesConfig.find(ic => 
          ic.categoria?.toUpperCase().trim() === 'COCHO' ||
          ic.categoria?.toUpperCase().trim() === ponto.tipo?.toUpperCase().trim()
        );

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
            scale: 30,
            fillColor: configIcone?.cor_padrao || '#10b981',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 4
          };
        }

        const marker = new google.maps.Marker({
          position: { lat: coords.lat, lng: coords.lng },
          map: mapInstanceRef.current,
          icon: markerIcon,
          title: ponto.nome_ponto,
          zIndex: 500
        });

        markersRef.current.push(marker);

        marker.addListener('click', () => {
          setSelectedPontoSupl(ponto);
          setShowDetalhesPontoSupl(true);
        });
      });
    }

    if (showLotes) {
      // Agrupar lotes por área
      const lotesPorArea = {};
      lotesFiltrados.forEach(lote => {
        if (!lote.area_atual_id) return;
        if (!lotesPorArea[lote.area_atual_id]) {
          lotesPorArea[lote.area_atual_id] = [];
        }
        lotesPorArea[lote.area_atual_id].push(lote);
      });

      // Renderizar um marcador por área
      Object.entries(lotesPorArea).forEach(([areaId, lotesNaArea]) => {
        const area = areas.find(a => a.id === areaId);
        if (!area || !area.coordenadas?.coords || area.coordenadas.coords.length < 3) return;

        const paths = area.coordenadas.coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
        const bounds = new google.maps.LatLngBounds();
        paths.forEach(p => bounds.extend(p));
        const center = bounds.getCenter();

        // Calcular área em hectares
        let areaHa = 0;
        if (window.google?.maps?.geometry?.spherical) {
          const pathLatLng = paths.map(p => new google.maps.LatLng(p.lat, p.lng));
          const areaM2 = google.maps.geometry.spherical.computeArea(pathLatLng);
          areaHa = areaM2 / 10000;
        }

        // Calcular total de cabeças
        const totalCabecas = lotesNaArea.reduce((sum, l) => sum + (l.quantidade_cabecas || 0), 0);

        // Detectar categorias únicas
        const categorias = [...new Set(lotesNaArea.map(l => l.categoria?.toUpperCase().trim()).filter(Boolean))].sort();

        let configIcone;
        let iconeKey = '';

        console.log('🔍 ÁREA:', area.nome, '| Categorias:', categorias);

        // Definir ícone baseado nas categorias
        if (categorias.length === 1) {
          // Uma única categoria - usar ícone específico
          configIcone = iconesConfig.find(ic => 
            ic.tipo_entidade === 'Lote' && 
            ic.categoria?.toUpperCase().trim() === categorias[0]
          );
          iconeKey = categorias[0];
          console.log('✅ Categoria única:', iconeKey, '| Config encontrado:', !!configIcone);
        } else if (categorias.length > 1) {
          // Múltiplas categorias - buscar MISTO
          const configsMisto = iconesConfig.filter(ic => 
            ic.tipo_entidade === 'Lote' && 
            ic.categoria?.toUpperCase() === 'MISTO' &&
            Array.isArray(ic.categorias_misto) &&
            ic.categorias_misto.length > 0
          );

          console.log('📦 Total configs MISTO:', configsMisto.length);

          // Buscar configs que contenham TODAS as categorias da área
          const configsValidos = [];
          for (const config of configsMisto) {
            const categoriasConfig = [...(config.categorias_misto || [])].map(c => c.toUpperCase().trim());

            console.log(`   Testando "${config.descricao}" [${categoriasConfig.join(', ')}]`);

            // Todas as categorias da área devem estar na config
            const todasContidas = categorias.every(cat => categoriasConfig.includes(cat));

            if (todasContidas) {
              console.log(`   ✅ VÁLIDO - todas contidas`);
              configsValidos.push({ config, tamanho: categoriasConfig.length });
            } else {
              console.log(`   ❌ Inválido - faltam categorias`);
            }
          }

          // Pegar a config com MENOR número de categorias (mais específica)
          if (configsValidos.length > 0) {
            configsValidos.sort((a, b) => a.tamanho - b.tamanho);
            configIcone = configsValidos[0].config;
            iconeKey = 'MISTO';
            console.log(`🎯 ESCOLHIDO: "${configIcone.descricao}" com ${configsValidos[0].tamanho} categorias`);
          } else {
            console.log('❌ Nenhuma config MISTO válida encontrada');
          }
        }

        let markerIcon;
        if (configIcone?.icone_url) {
          markerIcon = {
            url: configIcone.icone_url,
            scaledSize: new google.maps.Size(70, 70),
            anchor: new google.maps.Point(35, 35),
            labelOrigin: new google.maps.Point(35, 25)
          };
        } else {
          // Sem ícone configurado - usar marcador padrão colorido
          markerIcon = {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 30,
            fillColor: '#10b981',
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 4,
            labelOrigin: new google.maps.Point(0, 0)
          };
        }

        // Verificar alertas
        const totalAlertas = lotesNaArea.reduce((sum, l) => sum + (l.alertas?.length || 0), 0);
        const temAlerta = totalAlertas > 0;

        const marker = new google.maps.Marker({
          position: center,
          map: mapInstanceRef.current,
          icon: markerIcon,
          label: {
            text: String(totalCabecas),
            color: '#ffffff',
            fontSize: '11px',
            fontWeight: 'bold',
            className: 'marker-label'
          },
          title: area.nome,
          zIndex: temAlerta ? 2000 : 1000,
          draggable: true
        });

        // Label com nome do pasto e hectares abaixo do marcador
        const labelDiv = document.createElement('div');
        labelDiv.innerHTML = `
          <div style="
            background: rgba(0,0,0,0.7);
            color: white;
            padding: 2px 6px;
            border-radius: 3px;
            font-size: 11px;
            font-weight: 600;
            text-align: center;
            white-space: nowrap;
            transform: translateY(8px);
          ">
            ${area.nome}<br/>
            <span style="font-size: 10px; font-weight: 400;">${areaHa.toFixed(0)}ha</span>
          </div>
        `;

        const labelOverlay = new google.maps.OverlayView();
        labelOverlay.onAdd = function() {
          const pane = this.getPanes().overlayMouseTarget;
          pane.appendChild(labelDiv);
        };
        labelOverlay.draw = function() {
          const projection = this.getProjection();
          const position = projection.fromLatLngToDivPixel(center);
          labelDiv.style.position = 'absolute';
          labelDiv.style.left = position.x - 40 + 'px';
          labelDiv.style.top = position.y + 25 + 'px';
        };
        labelOverlay.onRemove = function() {
          labelDiv.parentNode?.removeChild(labelDiv);
        };
        labelOverlay.setMap(mapInstanceRef.current);
        markersRef.current.push({ setMap: (m) => labelOverlay.setMap(m) });

        markersRef.current.push(marker);

        marker.addListener('click', (e) => {
          e.stop();
          setSelectedLote(lotesNaArea);
          setShowDetalhesLote(true);
        });

        marker.addListener('dragend', (e) => {
          const newPos = e.latLng;

          // Retornar marcador para posição original IMEDIATAMENTE
          marker.setPosition(center);

          // Verificar se ainda está dentro da mesma área
          const paths = area.coordenadas.coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
          let dentroAreaOriginal = false;
          for (let i = 0, j = paths.length - 1; i < paths.length; j = i++) {
            const xi = paths[i].lat, yi = paths[i].lng;
            const xj = paths[j].lat, yj = paths[j].lng;
            const intersect = ((yi > newPos.lng()) !== (yj > newPos.lng()))
                && (newPos.lat() < (xj - xi) * (newPos.lng() - yi) / (yj - yi) + xi);
            if (intersect) dentroAreaOriginal = !dentroAreaOriginal;
          }

          if (dentroAreaOriginal) {
            toast.error('❌ Arraste para outra área');
            return;
          }

          // Encontrar área destino
          let areaMaisProxima = null;
          let menorDistancia = Infinity;

          areas.forEach(a => {
            if (a.id === areaId || !a.coordenadas?.coords || a.coordenadas.coords.length < 3) return;

            const paths = a.coordenadas.coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
            
            // Verificar se o ponto está dentro do polígono
            let inside = false;
            for (let i = 0, j = paths.length - 1; i < paths.length; j = i++) {
              const xi = paths[i].lat, yi = paths[i].lng;
              const xj = paths[j].lat, yj = paths[j].lng;
              const intersect = ((yi > newPos.lng()) !== (yj > newPos.lng()))
                  && (newPos.lat() < (xj - xi) * (newPos.lng() - yi) / (yj - yi) + xi);
              if (intersect) inside = !inside;
            }

            if (inside) {
              areaMaisProxima = a;
              menorDistancia = 0;
            }
          });

          if (areaMaisProxima) {
            window.areaDestinoArrastada = areaMaisProxima.id;
            setSelectedLote(lotesNaArea);
            setShowDetalhesLote(true);
            setTimeout(() => {
              const event = new CustomEvent('open-movimentacao');
              window.dispatchEvent(event);
            }, 100);
          } else {
            toast.error('❌ Solte sobre outra área');
          }
        });
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-white" translate="no">
      {/* Mapa em tela cheia */}
      <div className="w-full h-full relative">
        <div
          ref={mapRef}
          style={{
            height: '100%',
            width: '100%',
            backgroundColor: '#e5e7eb',
            touchAction: 'manipulation'
          }}
        />

        {/* Botões no topo esquerdo */}
        <div className="absolute top-4 left-4 z-20 flex gap-2">
          <Link to={createPageUrl("Home")}>
            <Button
              variant="secondary"
              size="icon"
              className="h-12 w-12 rounded-full bg-white/90 backdrop-blur-sm shadow-lg hover:bg-white"
            >
              <X className="w-6 h-6 text-slate-700" />
            </Button>
          </Link>

          <Button
            variant="secondary"
            size="icon"
            onClick={() => { setTarefasContext({}); setShowTarefas(true); }}
            className="h-12 w-12 rounded-full bg-white/90 backdrop-blur-sm shadow-lg hover:bg-white"
            title="Tarefas"
          >
            <ClipboardList className="w-6 h-6 text-slate-700" />
          </Button>
          
          <Sheet>
            <SheetTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="h-12 w-12 rounded-full bg-white/90 backdrop-blur-sm shadow-lg hover:bg-white"
              >
                <Layers className="w-6 h-6 text-slate-700" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[280px]">
              <SheetHeader>
                <SheetTitle>Filtros do Mapa</SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-4">
                <label className="flex items-center justify-between cursor-pointer hover:bg-slate-50 px-3 py-2 rounded">
                  <span className="text-sm font-medium text-slate-700">Áreas</span>
                  <input
                    type="checkbox"
                    checked={showAreas}
                    onChange={() => setShowAreas(!showAreas)}
                    className="w-4 h-4 rounded border-slate-300"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer hover:bg-slate-50 px-3 py-2 rounded">
                  <span className="text-sm font-medium text-slate-700">Pontos</span>
                  <input
                    type="checkbox"
                    checked={showPontos}
                    onChange={() => setShowPontos(!showPontos)}
                    className="w-4 h-4 rounded border-slate-300"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer hover:bg-slate-50 px-3 py-2 rounded">
                  <span className="text-sm font-medium text-slate-700">Linhas</span>
                  <input
                    type="checkbox"
                    checked={showLinhas}
                    onChange={() => setShowLinhas(!showLinhas)}
                    className="w-4 h-4 rounded border-slate-300"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer hover:bg-slate-50 px-3 py-2 rounded">
                  <span className="text-sm font-medium text-slate-700">Lotes</span>
                  <input
                    type="checkbox"
                    checked={showLotes}
                    onChange={() => setShowLotes(!showLotes)}
                    className="w-4 h-4 rounded border-slate-300"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer hover:bg-slate-50 px-3 py-2 rounded">
                  <span className="text-sm font-medium text-slate-700">Pontos Suplementação</span>
                  <input
                    type="checkbox"
                    checked={showPontosSuplementacao}
                    onChange={() => setShowPontosSuplementacao(!showPontosSuplementacao)}
                    className="w-4 h-4 rounded border-slate-300"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer hover:bg-slate-50 px-3 py-2 rounded">
                  <span className="text-sm font-medium text-slate-700">Mostrar Alertas</span>
                  <input
                    type="checkbox"
                    checked={showAlertas}
                    onChange={() => setShowAlertas(!showAlertas)}
                    className="w-4 h-4 rounded border-slate-300"
                  />
                </label>
                <label className="flex items-center justify-between cursor-pointer hover:bg-slate-50 px-3 py-2 rounded">
                  <span className="text-sm font-medium text-slate-700">Minha Localização</span>
                  <input
                    type="checkbox"
                    checked={showUserLocation}
                    onChange={() => setShowUserLocation(!showUserLocation)}
                    className="w-4 h-4 rounded border-slate-300"
                  />
                </label>

                <div className="pt-4 border-t">
                  <div className="text-xs font-semibold text-slate-500 uppercase mb-2 px-3">Filtros</div>

                  <div className="space-y-3 px-3">
                    <div>
                      <label className="text-xs text-slate-600 mb-1 block">Categoria</label>
                      <Select value={filtroCategoria} onValueChange={setFiltroCategoria}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="todas" className="text-xs">Todas</SelectItem>
                          {categorias.map(cat => (
                            <SelectItem key={cat} value={cat} className="text-xs">{cat}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <label className="text-xs text-slate-600 mb-1 block">Status</label>
                      <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="todos" className="text-xs">Todos</SelectItem>
                          <SelectItem value="com_alerta" className="text-xs">Com Alerta</SelectItem>
                          <SelectItem value="sem_alerta" className="text-xs">Sem Alerta</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                </div>
                </SheetContent>
                </Sheet>
        </div>

        {/* Controles do mapa no topo */}
        <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
          <Button
            variant="secondary"
            size="icon"
            onClick={() => {
              refetchLotes();
              refetchAreas();
              refetchEventosSupl();
              refetchPontos();
              toast.success('🔄 Mapa atualizado');
            }}
            className="h-9 w-9 bg-white/90 backdrop-blur-sm shadow-lg"
            title="Atualizar mapa"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
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
                    setUserLocation(pos);
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
        </div>

        {!mapReady && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 bg-white px-6 py-4 rounded-lg shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="animate-spin w-6 h-6 border-4 border-emerald-600 border-t-transparent rounded-full"></div>
              <span className="font-semibold text-slate-700">Carregando mapa...</span>
            </div>
          </div>
        )}
      </div>

      <Dialog open={showDetalhesLote} onOpenChange={(open) => {
        setShowDetalhesLote(open);
        if (!open) {
          setForceUpdate(prev => prev + 1);
        }
      }}>
        <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle translate="no">Detalhes do Lote</DialogTitle>
          </DialogHeader>
          {selectedLote && (
            <DetalhesLote
              lotes={Array.isArray(selectedLote) ? selectedLote : [selectedLote]}
              onClose={() => {
                setShowDetalhesLote(false);
                setForceUpdate(prev => prev + 1);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showDetalhesArea} onOpenChange={setShowDetalhesArea}>
        <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Detalhes da Área</DialogTitle>
          </DialogHeader>
          {selectedArea && (
            <DetalhesArea
              area={selectedArea}
              onClose={() => setShowDetalhesArea(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showDetalhesPontoSupl} onOpenChange={(open) => {
        setShowDetalhesPontoSupl(open);
        if (!open) {
          setTimeout(() => {
            refetchEventosSupl();
            refetchLotes();
            refetchPontos();
          }, 300);
        }
      }}>
        <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ponto de Suplementação</DialogTitle>
          </DialogHeader>
          {selectedPontoSupl && (
            <DetalhesPontoSuplementacao
              ponto={selectedPontoSupl}
              onClose={() => {
                setShowDetalhesPontoSupl(false);
                setTimeout(() => {
                  refetchEventosSupl();
                  refetchLotes();
                  refetchPontos();
                }, 300);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showTarefas} onOpenChange={setShowTarefas}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Tarefas do Mapa</DialogTitle>
          </DialogHeader>
          <TarefasMapaPanel
            areaId={tarefasContext.areaId}
            areaNome={tarefasContext.areaNome}
            loteId={tarefasContext.loteId}
            loteNome={tarefasContext.loteNome}
            pontoSuplId={tarefasContext.pontoSuplId}
            onClose={() => setShowTarefas(false)}
          />
        </DialogContent>
      </Dialog>

    </div>
  );
}