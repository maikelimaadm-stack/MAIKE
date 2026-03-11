import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { X, Layers, Target, RefreshCw, ClipboardList, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import DetalhesLote from "../components/mapa/DetalhesLote";
import DetalhesPontoSuplementacao from "../components/mapa/DetalhesPontoSuplementacao";
import AreaPanel from "../components/mapa/AreaPanel";
import TarefasMapaPanel from "../components/mapa/TarefasMapaPanel";
import MapaInsights from "../components/mapa/MapaInsights";
import useMapRenderer from "../components/mapa/useMapRenderer";

const GOOGLE_MAPS_API_KEY = "AIzaSyB-PfoOotwVlkAzt72cBgYE2tl4vJuqFe8";

const loadGoogleMapsScript = () => {
  return new Promise((resolve, reject) => {
    if (window.google?.maps) { resolve(); return; }
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
  const [showInsights, setShowInsights] = useState(false);

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const firstFitDoneRef = useRef(false);

  const renderer = useMapRenderer(mapInstanceRef);

  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  useEffect(() => { firstFitDoneRef.current = false; }, [empresaSelecionadaId]);

  // ─── Data Queries (com staleTime alto para evitar recargas desnecessárias) ───
  const STALE_TIME = 2 * 60 * 1000; // 2 min

  const { data: areas = [], refetch: refetchAreas } = useQuery({
    queryKey: ['mapa-areas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
    staleTime: STALE_TIME,
  });

  const { data: pontos = [], refetch: refetchPontosRef } = useQuery({
    queryKey: ['mapa-pontos', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PontoReferencia.list();
      return all.filter(p => p.empresa_id === empresaSelecionadaId && p.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
    staleTime: STALE_TIME,
  });

  const { data: pontosSuplementacao = [], refetch: refetchPontosSupl } = useQuery({
    queryKey: ['mapa-pontos-supl', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PontoSuplementacao.list();
      return all.filter(p => p.empresa_id === empresaSelecionadaId && p.status === 'Ativo');
    },
    enabled: !!empresaSelecionadaId,
    staleTime: STALE_TIME,
  });

  const { data: linhas = [] } = useQuery({
    queryKey: ['mapa-linhas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LinhaGeografica.list();
      return all.filter(l => l.empresa_id === empresaSelecionadaId && l.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
    staleTime: STALE_TIME,
  });

  const { data: lotes = [], refetch: refetchLotes } = useQuery({
    queryKey: ['mapa-lotes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter(l => l.empresa_id === empresaSelecionadaId && l.status === 'Ativo');
    },
    enabled: !!empresaSelecionadaId,
    staleTime: STALE_TIME,
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['mapa-icones'],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter(i => i.ativo !== false);
    },
    staleTime: 10 * 60 * 1000,
  });

  const { data: eventosSupl = [], refetch: refetchEventosSupl } = useQuery({
    queryKey: ['mapa-eventos-supl', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.SuplementacaoEvento.list();
      return all.filter(e => e.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
    staleTime: STALE_TIME,
  });

  const { data: tarefasMapa = [], refetch: refetchTarefas } = useQuery({
    queryKey: ['mapa-tarefas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.TarefaMapa.list();
      return all.filter(t =>
        t.empresa_id === empresaSelecionadaId &&
        t.coordenadas &&
        (t.status === 'Pendente' || t.status === 'Em Andamento')
      );
    },
    enabled: !!empresaSelecionadaId,
    staleTime: STALE_TIME,
  });

  // ─── Lotes com alertas ───
  const lotesComAlerta = useMemo(() => {
    return lotes.map(lote => {
      const alertas = [];
      const eventosPonto = eventosSupl.filter(e => e.area_id === lote.area_atual_id);
      if (eventosPonto.length > 0) {
        const ultimoEvento = eventosPonto.sort((a, b) => new Date(b.data_lancamento) - new Date(a.data_lancamento))[0];
        const diasSem = Math.floor((new Date() - new Date(ultimoEvento.data_lancamento)) / (1000 * 60 * 60 * 24));
        if (diasSem > 10) alertas.push({ tipo: 'suplementacao', dias: diasSem });
      }
      if (lote.peso_medio_kg && lote.peso_medio_kg < 50 && (lote.categoria?.includes('Bezerr') || lote.categoria?.includes('0 a 12'))) {
        alertas.push({ tipo: 'peso_baixo', peso: lote.peso_medio_kg });
      }
      return { ...lote, alertas };
    });
  }, [lotes, eventosSupl]);

  const categorias = useMemo(() => [...new Set(lotes.map(l => l.categoria).filter(Boolean))].sort(), [lotes]);

  const lotesFiltrados = useMemo(() => {
    return lotesComAlerta.filter(lote => {
      if (filtroCategoria !== 'todas' && lote.categoria !== filtroCategoria) return false;
      if (filtroStatus === 'com_alerta' && lote.alertas.length === 0) return false;
      if (filtroStatus === 'sem_alerta' && lote.alertas.length > 0) return false;
      return true;
    });
  }, [lotesComAlerta, filtroCategoria, filtroStatus]);

  // ─── Inicializar Mapa ───
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
        setMapReady(true);
      });
    }).catch(() => toast.error('Erro ao carregar mapa.'));

    return () => { renderer.clearAll(); };
  }, []);

  useEffect(() => {
    if (mapInstanceRef.current) mapInstanceRef.current.setMapTypeId(mapType);
  }, [mapType]);

  // ─── Fit Bounds uma vez quando áreas carregam ───
  useEffect(() => {
    if (!mapInstanceRef.current || !mapReady || !areas.length || firstFitDoneRef.current) return;
    const bounds = new google.maps.LatLngBounds();
    let hasValid = false;
    areas.forEach(area => {
      (area.coordenadas?.coords || []).forEach(c => {
        const lat = c[0] || c.lat;
        const lng = c[1] || c.lng;
        if (typeof lat === 'number' && typeof lng === 'number' && isFinite(lat) && isFinite(lng)) {
          bounds.extend({ lat, lng });
          hasValid = true;
        }
      });
    });
    if (hasValid) {
      mapInstanceRef.current.fitBounds(bounds, { padding: 50 });
      firstFitDoneRef.current = true;
    }
  }, [areas, mapReady]);

  // ─── Callbacks estáveis para handlers ───
  const handleClickArea = useCallback((area) => {
    setSelectedArea(area);
    setShowDetalhesArea(true);
  }, []);

  const handleRightClickArea = useCallback((area) => {
    setTarefasContext({ areaId: area.id, areaNome: area.nome });
    setShowTarefas(true);
  }, []);

  const handleClickPontoSupl = useCallback((ponto) => {
    setSelectedPontoSupl(ponto);
    setShowDetalhesPontoSupl(true);
  }, []);

  const handleClickLotes = useCallback((lotesNaArea) => {
    setSelectedLote(lotesNaArea);
    setShowDetalhesLote(true);
  }, []);

  const handleDragLotes = useCallback((newPos, lotesNaArea, areaId, allAreas) => {
    // Verificar se dentro da mesma área
    const areaOrigem = allAreas.find(a => a.id === areaId);
    if (areaOrigem) {
      const paths = areaOrigem.coordenadas.coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      if (isInsidePolygon(newPos, paths)) {
        toast.error('Arraste para outra área');
        return;
      }
    }

    // Encontrar área destino
    let areaDest = null;
    for (const a of allAreas) {
      if (a.id === areaId || !a.coordenadas?.coords || a.coordenadas.coords.length < 3) continue;
      const paths = a.coordenadas.coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      if (isInsidePolygon(newPos, paths)) {
        areaDest = a;
        break;
      }
    }

    if (areaDest) {
      window.areaDestinoArrastada = areaDest.id;
      setSelectedLote(lotesNaArea);
      setShowDetalhesLote(true);
      setTimeout(() => window.dispatchEvent(new CustomEvent('open-movimentacao')), 100);
    } else {
      toast.error('Solte sobre outra área');
    }
  }, []);

  const handleClickTarefa = useCallback((tarefa) => {
    setTarefasContext({ areaId: tarefa.area_id, areaNome: tarefa.area_nome });
    setShowTarefas(true);
  }, []);

  // ─── Renderização Incremental (SEM destruir tudo) ───
  useEffect(() => {
    if (!mapReady) return;
    renderer.syncAreas(areas, showAreas, handleClickArea, handleRightClickArea);
  }, [areas, showAreas, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    renderer.syncPontos(pontos, showPontos, iconesConfig);
  }, [pontos, showPontos, iconesConfig, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    renderer.syncLinhas(linhas, showLinhas);
  }, [linhas, showLinhas, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    renderer.syncPontosSuplementacao(pontosSuplementacao, showPontosSuplementacao, iconesConfig, handleClickPontoSupl);
  }, [pontosSuplementacao, showPontosSuplementacao, iconesConfig, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    renderer.syncLotes(lotesFiltrados, areas, showLotes, iconesConfig, handleClickLotes, handleDragLotes);
  }, [lotesFiltrados, areas, showLotes, iconesConfig, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    renderer.syncTarefas(tarefasMapa, handleClickTarefa);
  }, [tarefasMapa, mapReady]);

  useEffect(() => {
    if (!mapReady) return;
    renderer.syncUserLocation(userLocation, showUserLocation);
  }, [userLocation, showUserLocation, mapReady]);

  // ─── Evento de atualização após movimentação ───
  useEffect(() => {
    const handleAtualizar = () => {
      refetchLotes();
      refetchAreas();
      refetchEventosSupl();
    };
    window.addEventListener('atualizar-mapa', handleAtualizar);
    return () => window.removeEventListener('atualizar-mapa', handleAtualizar);
  }, []);

  const handleRefresh = useCallback(() => {
    refetchLotes();
    refetchAreas();
    refetchEventosSupl();
    refetchPontosSupl();
    refetchPontosRef();
    refetchTarefas();
    toast.success('Mapa atualizado');
  }, []);

  const handleCloseDetalhesLote = useCallback((open) => {
    setShowDetalhesLote(open);
    if (!open) {
      // Refetch após fechar — dados atualizados sem piscar
      setTimeout(() => refetchLotes(), 300);
    }
  }, []);

  const handleCloseDetalhesPontoSupl = useCallback((open) => {
    setShowDetalhesPontoSupl(open);
    if (!open) {
      setTimeout(() => {
        refetchEventosSupl();
        refetchLotes();
        refetchPontosSupl();
      }, 300);
    }
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-white" translate="no">
      <div className="w-full h-full relative">
        <div
          ref={mapRef}
          style={{ height: '100%', width: '100%', backgroundColor: '#e5e7eb', touchAction: 'manipulation' }}
        />

        {/* Botões topo esquerdo */}
        <div className="absolute top-4 left-4 z-20 flex gap-2">
          <Link to={createPageUrl("Home")}>
            <Button variant="secondary" size="icon" className="h-12 w-12 rounded-full bg-white/90 backdrop-blur-sm shadow-lg hover:bg-white">
              <X className="w-6 h-6 text-slate-700" />
            </Button>
          </Link>

          <Button variant="secondary" size="icon" onClick={() => { setTarefasContext({}); setShowTarefas(true); }} className="h-12 w-12 rounded-full bg-white/90 backdrop-blur-sm shadow-lg hover:bg-white" title="Tarefas">
            <ClipboardList className="w-6 h-6 text-slate-700" />
          </Button>

          <Button variant="secondary" size="icon" onClick={() => setShowInsights(true)} className="h-12 w-12 rounded-full bg-white/90 backdrop-blur-sm shadow-lg hover:bg-white" title="Insights">
            <BarChart3 className="w-6 h-6 text-slate-700" />
          </Button>

          <Sheet>
            <SheetTrigger asChild>
              <Button variant="secondary" size="icon" className="h-12 w-12 rounded-full bg-white/90 backdrop-blur-sm shadow-lg hover:bg-white">
                <Layers className="w-6 h-6 text-slate-700" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[280px]">
              <SheetHeader>
                <SheetTitle>Filtros do Mapa</SheetTitle>
              </SheetHeader>
              <div className="mt-6 space-y-4">
                {[
                  { label: 'Áreas', checked: showAreas, onChange: () => setShowAreas(v => !v) },
                  { label: 'Pontos', checked: showPontos, onChange: () => setShowPontos(v => !v) },
                  { label: 'Linhas', checked: showLinhas, onChange: () => setShowLinhas(v => !v) },
                  { label: 'Lotes', checked: showLotes, onChange: () => setShowLotes(v => !v) },
                  { label: 'Pontos Suplementação', checked: showPontosSuplementacao, onChange: () => setShowPontosSuplementacao(v => !v) },
                  { label: 'Mostrar Alertas', checked: showAlertas, onChange: () => setShowAlertas(v => !v) },
                  { label: 'Minha Localização', checked: showUserLocation, onChange: () => setShowUserLocation(v => !v) },
                ].map(item => (
                  <label key={item.label} className="flex items-center justify-between cursor-pointer hover:bg-slate-50 px-3 py-2 rounded">
                    <span className="text-sm font-medium text-slate-700">{item.label}</span>
                    <input type="checkbox" checked={item.checked} onChange={item.onChange} className="w-4 h-4 rounded border-slate-300" />
                  </label>
                ))}

                <div className="pt-4 border-t">
                  <div className="text-xs font-semibold text-slate-500 uppercase mb-2 px-3">Filtros</div>
                  <div className="space-y-3 px-3">
                    <div>
                      <label className="text-xs text-slate-600 mb-1 block">Categoria</label>
                      <Select value={filtroCategoria} onValueChange={setFiltroCategoria}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
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
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
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

        {/* Controles topo direito */}
        <div className="absolute top-4 right-4 z-20 flex items-center gap-2">
          <Button variant="secondary" size="icon" onClick={handleRefresh} className="h-9 w-9 bg-white/90 backdrop-blur-sm shadow-lg" title="Atualizar mapa">
            <RefreshCw className="w-4 h-4" />
          </Button>
          <Button variant={mapType === 'roadmap' ? 'default' : 'secondary'} size="sm" onClick={() => setMapType('roadmap')} className="h-9 px-3 text-xs bg-white/90 backdrop-blur-sm shadow-lg">
            Mapa
          </Button>
          <Button variant={mapType === 'satellite' ? 'default' : 'secondary'} size="sm" onClick={() => setMapType('satellite')} className="h-9 px-3 text-xs bg-white/90 backdrop-blur-sm shadow-lg">
            Satélite
          </Button>
          <Button variant="secondary" size="icon" onClick={() => {
            if (navigator.geolocation) {
              navigator.geolocation.getCurrentPosition(
                (pos) => {
                  const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                  setUserLocation(loc);
                  setShowUserLocation(true);
                  if (mapInstanceRef.current) {
                    mapInstanceRef.current.setCenter(loc);
                    mapInstanceRef.current.setZoom(18);
                  }
                },
                () => toast.error('Erro ao obter localização')
              );
            }
          }} className="h-9 w-9 bg-white/90 backdrop-blur-sm shadow-lg" title="Minha localização">
            <Target className="w-4 h-4" />
          </Button>
        </div>

        {/* Indicador de resumo rápido (bottom) */}
        <div className="absolute bottom-4 left-4 right-4 z-10">
          <div className="bg-white/95 backdrop-blur-sm rounded-xl shadow-lg px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-4 text-xs">
              <div className="text-center">
                <div className="font-bold text-emerald-700 text-sm">{lotes.reduce((s, l) => s + (l.quantidade_cabecas || 0), 0)}</div>
                <div className="text-slate-500 text-[10px]">Cabeças</div>
              </div>
              <div className="w-px h-6 bg-slate-200" />
              <div className="text-center">
                <div className="font-bold text-blue-700 text-sm">{areas.length}</div>
                <div className="text-slate-500 text-[10px]">Áreas</div>
              </div>
              <div className="w-px h-6 bg-slate-200" />
              <div className="text-center">
                <div className="font-bold text-slate-700 text-sm">{new Set(lotes.map(l => l.area_atual_id).filter(Boolean)).size}</div>
                <div className="text-slate-500 text-[10px]">Ocupadas</div>
              </div>
              <div className="w-px h-6 bg-slate-200" />
              <div className="text-center">
                <div className="font-bold text-amber-700 text-sm">{lotesComAlerta.filter(l => l.alertas.length > 0).length}</div>
                <div className="text-slate-500 text-[10px]">Alertas</div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowInsights(true)} className="h-7 text-xs gap-1 text-emerald-700">
              <BarChart3 className="w-3.5 h-3.5" />
              Ver Insights
            </Button>
          </div>
        </div>

        {!mapReady && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-10 bg-white px-6 py-4 rounded-lg shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="animate-spin w-6 h-6 border-4 border-emerald-600 border-t-transparent rounded-full" />
              <span className="font-semibold text-slate-700">Carregando mapa...</span>
            </div>
          </div>
        )}
      </div>

      {/* ─── Dialogs ─── */}
      <Dialog open={showDetalhesLote} onOpenChange={handleCloseDetalhesLote}>
        <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle translate="no">Detalhes do Lote</DialogTitle></DialogHeader>
          {selectedLote && (
            <DetalhesLote
              lotes={Array.isArray(selectedLote) ? selectedLote : [selectedLote]}
              onClose={() => handleCloseDetalhesLote(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Sheet open={showDetalhesArea} onOpenChange={setShowDetalhesArea}>
        <SheetContent side="right" className="w-[420px] md:w-[520px] lg:w-[640px] p-0">
          {selectedArea && <AreaPanel area={selectedArea} onClose={() => setShowDetalhesArea(false)} />}
        </SheetContent>
      </Sheet>

      <Dialog open={showDetalhesPontoSupl} onOpenChange={handleCloseDetalhesPontoSupl}>
        <DialogContent className="max-w-[95vw] max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Ponto de Suplementação</DialogTitle></DialogHeader>
          {selectedPontoSupl && (
            <DetalhesPontoSuplementacao
              ponto={selectedPontoSupl}
              onClose={() => handleCloseDetalhesPontoSupl(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={showTarefas} onOpenChange={(open) => { setShowTarefas(open); if (!open) refetchTarefas(); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Tarefas do Mapa</DialogTitle></DialogHeader>
          <TarefasMapaPanel
            areaId={tarefasContext.areaId}
            areaNome={tarefasContext.areaNome}
            loteId={tarefasContext.loteId}
            loteNome={tarefasContext.loteNome}
            pontoSuplId={tarefasContext.pontoSuplId}
            onClose={() => { setShowTarefas(false); refetchTarefas(); }}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={showInsights} onOpenChange={setShowInsights}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><BarChart3 className="w-4 h-4 text-emerald-600" /> Insights do Mapa</DialogTitle></DialogHeader>
          <MapaInsights
            lotes={lotesComAlerta}
            areas={areas}
            eventosSupl={eventosSupl}
            pontosSuplementacao={pontosSuplementacao}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Helpers ───
function isInsidePolygon(latLng, paths) {
  let inside = false;
  const lat = typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat;
  const lng = typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng;
  for (let i = 0, j = paths.length - 1; i < paths.length; j = i++) {
    const xi = paths[i].lat, yi = paths[i].lng;
    const xj = paths[j].lat, yj = paths[j].lng;
    const intersect = ((yi > lng) !== (yj > lng)) && (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}