import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Map, Layers, Filter, Search, Move, Plus, MapPin, Square, X, Save, Edit, Trash2 } from "lucide-react";
import { toast } from "sonner";
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

const GOOGLE_MAPS_API_KEY = "AIzaSyB-PfoOotwVlkAzt72cBgYE2tl4vJuqFe8";

const CORES_DISPONIVEIS = [
  "#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1",
  "#14b8a6", "#a855f7", "#22c55e", "#eab308", "#64748b"
];

const TIPOS_USO = [
  "Pasto/Piquete", "Lavoura", "Reserva Legal", "APP", 
  "Curral", "Sede", "Retiro", "Módulo", "Outro"
];

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

export default function MapaPecuaria() {
  const [mapType, setMapType] = useState('satellite');
  const [showAreas, setShowAreas] = useState(true);
  const [showLotes, setShowLotes] = useState(true);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState([]);
  const [showAreaDialog, setShowAreaDialog] = useState(false);
  const [showMoveDialog, setShowMoveDialog] = useState(false);
  const [selectedLote, setSelectedLote] = useState(null);
  const [selectedArea, setSelectedArea] = useState(null);
  const [editingArea, setEditingArea] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterTipo, setFilterTipo] = useState("all");
  const [filterCategoria, setFilterCategoria] = useState("all");

  const [formData, setFormData] = useState({
    nome: "",
    codigo: "",
    tipo_uso: "Pasto/Piquete",
    area_total: "",
    capacidade_maxima: "",
    tipo_pastagem: "",
    irrigado: false,
    cor: CORES_DISPONIVEIS[0],
    observacoes: ""
  });

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const polygonsRef = useRef([]);
  const markersRef = useRef([]);
  const currentPolygonRef = useRef(null);
  const infoWindowRef = useRef(null);

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

  const { data: lotes = [] } = useQuery({
    queryKey: ['lotes', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Lote.list();
      return all.filter(l => l.empresa_id === empresaSelecionadaId && l.status === 'Ativo');
    },
    enabled: !!empresaSelecionadaId,
  });

  const createAreaMutation = useMutation({
    mutationFn: async (data) => {
      const allAreas = await base44.entities.AreaPastagem.list();
      const maxNum = allAreas.reduce((max, a) => Math.max(max, parseInt(a.numero_area) || 0), 0);
      return base44.entities.AreaPastagem.create({
        ...data,
        empresa_id: empresaSelecionadaId,
        numero_area: String(maxNum + 1),
        quantidade_atual: 0,
        status_ocupacao: 'Disponível',
        ativo: true
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas'] });
      resetForm();
      toast.success('✅ Área cadastrada!');
    }
  });

  const updateAreaMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.AreaPastagem.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas'] });
      toast.success('✅ Área atualizada!');
    }
  });

  const deleteAreaMutation = useMutation({
    mutationFn: (id) => base44.entities.AreaPastagem.update(id, { ativo: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas'] });
      toast.success('✅ Área removida!');
    }
  });

  const moveLoteMutation = useMutation({
    mutationFn: async ({ loteId, areaDestinoId }) => {
      const lote = lotes.find(l => l.id === loteId);
      if (!lote) throw new Error('Lote não encontrado');

      const areaOrigem = areas.find(a => a.id === lote.area_atual_id);
      const destino = areas.find(a => a.id === areaDestinoId);

      // Atualizar o lote com nova área
      await base44.entities.Lote.update(loteId, {
        area_atual_id: areaDestinoId,
        area_atual_nome: destino?.nome
      });

      // Registrar movimentação
      await base44.entities.MovimentacaoPecuaria.create({
        empresa_id: empresaSelecionadaId,
        numero_movimentacao: String(Date.now()),
        tipo: 'Transferência de Área',
        data_movimentacao: new Date().toISOString(),
        lote: lote.nome,
        quantidade_animais: lote.quantidade_cabecas,
        area_origem_id: areaOrigem?.id,
        area_origem_nome: areaOrigem?.nome,
        area_destino_id: areaDestinoId,
        area_destino_nome: destino?.nome,
        motivo: 'Transferência visual via mapa',
        usuario_responsavel: (await base44.auth.me()).email
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lotes'] });
      queryClient.invalidateQueries({ queryKey: ['areas'] });
      setShowMoveDialog(false);
      setSelectedLote(null);
      toast.success('🐄 Lote movido com sucesso!');
    }
  });

  const resetForm = () => {
    setIsDrawing(false);
    setCurrentPoints([]);
    setShowAreaDialog(false);
    setEditingArea(null);
    setFormData({
      nome: "",
      codigo: "",
      tipo_uso: "Pasto/Piquete",
      area_total: "",
      capacidade_maxima: "",
      tipo_pastagem: "",
      irrigado: false,
      cor: CORES_DISPONIVEIS[0],
      observacoes: ""
    });
    if (currentPolygonRef.current) {
      currentPolygonRef.current.setMap(null);
      currentPolygonRef.current = null;
    }
  };

  // Lotes com localização
  const lotesComLocalizacao = lotes
    .filter(lote => lote.area_atual_id)
    .map(lote => {
      const area = areas.find(a => a.id === lote.area_atual_id);
      return {
        ...lote,
        area
      };
    })
    .filter(l => l.area);

  // Filtrar áreas
  const areasFiltered = areas.filter(area => {
    if (searchTerm && !area.nome.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (filterTipo !== 'all' && area.tipo_pastagem !== filterTipo) return false;
    return true;
  });

  // Filtrar lotes
  const lotesFiltered = lotesComLocalizacao.filter(lote => {
    if (searchTerm && !lote.nome.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    if (filterCategoria !== 'all' && lote.categoria !== filterCategoria) return false;
    return true;
  });

  useEffect(() => {
    loadGoogleMapsScript().then(() => {
      if (!mapRef.current || mapInstanceRef.current) return;

      const map = new google.maps.Map(mapRef.current, {
        center: { lat: -15.0067, lng: -59.9533 },
        zoom: 15,
        mapTypeId: mapType,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        zoomControl: true,
      });

      mapInstanceRef.current = map;
      infoWindowRef.current = new google.maps.InfoWindow();
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
  }, [areas, lotes, showAreas, showLotes, areasFiltered, lotesFiltered]);

  useEffect(() => {
    if (!mapInstanceRef.current) return;

    const handleMapClick = (e) => {
      if (isDrawing) {
        const newPoint = { lat: e.latLng.lat(), lng: e.latLng.lng() };
        setCurrentPoints(prev => {
          const updated = [...prev, newPoint];
          toast.success(`Ponto ${updated.length} adicionado`, { duration: 1000 });
          return updated;
        });
      }
    };

    const listener = google.maps.event.addListener(mapInstanceRef.current, 'click', handleMapClick);
    return () => google.maps.event.removeListener(listener);
  }, [isDrawing]);

  useEffect(() => {
    if (mapInstanceRef.current && isDrawing && currentPoints.length > 0) {
      if (currentPolygonRef.current) {
        currentPolygonRef.current.setMap(null);
      }

      if (currentPoints.length >= 2) {
        currentPolygonRef.current = new google.maps.Polygon({
          paths: currentPoints,
          strokeColor: formData.cor,
          strokeOpacity: 1,
          strokeWeight: 3,
          fillColor: formData.cor,
          fillOpacity: 0.35,
        });
        currentPolygonRef.current.setMap(mapInstanceRef.current);

        // Calcular área automaticamente
        const areaM2 = google.maps.geometry.spherical.computeArea(currentPolygonRef.current.getPath());
        const areaHa = (areaM2 / 10000).toFixed(2);
        setFormData(prev => ({ ...prev, area_total: areaHa }));
      }
    }
  }, [currentPoints, isDrawing, formData.cor]);

  const renderMap = () => {
    if (!mapInstanceRef.current) return;

    // Limpar markers e polígonos
    polygonsRef.current.forEach(p => p.setMap(null));
    markersRef.current.forEach(m => m.setMap(null));
    polygonsRef.current = [];
    markersRef.current = [];

    // Renderizar áreas
    if (showAreas) {
      areasFiltered.forEach(area => {
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
          editable: false,
          draggable: false,
        });

        polygon.setMap(mapInstanceRef.current);
        polygonsRef.current.push(polygon);

        polygon.addListener('click', (e) => {
          const lotesNaArea = lotesComLocalizacao.filter(l => l.area_id === area.id);
          const totalAnimais = lotesNaArea.reduce((sum, l) => sum + l.quantidade, 0);

          infoWindowRef.current.setContent(`
            <div style="padding: 12px; min-width: 240px;">
              <div style="font-weight: bold; font-size: 16px; margin-bottom: 8px; color: #0f172a;">${area.nome}</div>
              <div style="font-size: 13px; color: #475569; line-height: 1.8;">
                <div><strong>Código:</strong> ${area.numero_area}</div>
                <div><strong>Tipo:</strong> ${area.tipo_pastagem || 'Não definido'}</div>
                <div><strong>Área:</strong> ${area.tamanho_hectares} ha</div>
                <div><strong>Capacidade:</strong> ${area.capacidade_maxima} UA</div>
                <div><strong>Lotes:</strong> ${lotesNaArea.length}</div>
                <div><strong>Animais:</strong> ${totalAnimais}</div>
                ${area.tipo_pastagem && area.tipo_pastagem !== 'Não definido' ? `<div><strong>Irrigação:</strong> ${area.irrigado ? 'Sim' : 'Não'}</div>` : ''}
              </div>
            </div>
          `);
          const bounds = new google.maps.LatLngBounds();
          paths.forEach(p => bounds.extend(p));
          infoWindowRef.current.setPosition(e.latLng);
          infoWindowRef.current.open(mapInstanceRef.current);
        });
      });
    }

    // Renderizar lotes
    if (showLotes) {
      lotesFiltered.forEach(lote => {
        const coords = lote.area.coordenadas?.coords || [];
        if (coords.length < 3) return;

        const paths = coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
        const bounds = new google.maps.LatLngBounds();
        paths.forEach(p => bounds.extend(p));
        const center = bounds.getCenter();

        // Cor do ícone baseada na categoria
        let corIcone = '#10b981'; // verde padrão
        if (lote.categoria === 'Novilho' || lote.categoria === 'Garrote') corIcone = '#3b82f6'; // azul
        if (lote.categoria === 'Vaca' || lote.categoria === 'Novilha') corIcone = '#ec4899'; // rosa
        if (lote.categoria === 'Touro') corIcone = '#ef4444'; // vermelho

        const marker = new google.maps.Marker({
          position: center,
          map: mapInstanceRef.current,
          label: {
            text: String(lote.quantidade_cabecas),
            color: '#ffffff',
            fontSize: '16px',
            fontWeight: 'bold'
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 20,
            fillColor: corIcone,
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 3
          },
          title: lote.nome
        });

        markersRef.current.push(marker);

        marker.addListener('click', () => {
          infoWindowRef.current.setContent(`
            <div style="padding: 12px; min-width: 220px;">
              <div style="font-weight: bold; font-size: 16px; margin-bottom: 8px; color: #0f172a;">🐄 ${lote.nome}</div>
              <div style="font-size: 13px; color: #475569; line-height: 1.8;">
                <div><strong>Quantidade:</strong> ${lote.quantidade_cabecas} cabeças</div>
                <div><strong>Categoria:</strong> ${lote.categoria || 'Não definida'}</div>
                <div><strong>Peso Médio:</strong> ${lote.peso_medio_kg ? lote.peso_medio_kg + ' kg' : 'N/A'}</div>
                <div><strong>Área atual:</strong> ${lote.area.nome}</div>
              </div>
              <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e2e8f0;">
                <button 
                  onclick="window.moverLote('${lote.id}', '${lote.area_atual_id}')"
                  style="width: 100%; padding: 8px; background: #10b981; color: white; border: none; border-radius: 6px; font-size: 13px; font-weight: 600; cursor: pointer;"
                >
                  🔄 Mover Lote
                </button>
              </div>
            </div>
          `);
          infoWindowRef.current.setPosition(center);
          infoWindowRef.current.open(mapInstanceRef.current);
        });
      });
    }
  };

  // Função global para mover lote (chamada pelo botão no InfoWindow)
  useEffect(() => {
    window.moverLote = (loteId, areaAtualId) => {
      const lote = lotes.find(l => l.id === loteId);
      setSelectedLote(lote);
      setShowMoveDialog(true);
      if (infoWindowRef.current) {
        infoWindowRef.current.close();
      }
    };

    return () => {
      delete window.moverLote;
    };
  }, [lotes]);

  const handleStartDrawing = () => {
    setIsDrawing(true);
    setCurrentPoints([]);
    toast.success('🎯 Clique no mapa para desenhar a área!');
  };

  const handleFinishDrawing = () => {
    if (currentPoints.length < 3) {
      toast.error('Desenhe pelo menos 3 pontos!');
      return;
    }
    setShowAreaDialog(true);
  };

  const handleSaveArea = () => {
    if (!formData.nome || !formData.area_total) {
      toast.error('Preencha nome e área!');
      return;
    }

    const coords = currentPoints.map(p => [p.lat, p.lng]);
    const data = {
      nome: formData.nome.toUpperCase(),
      tamanho_hectares: parseFloat(formData.area_total),
      capacidade_maxima: parseFloat(formData.capacidade_maxima) || 0,
      tipo_pastagem: formData.tipo_uso,
      irrigado: formData.irrigado,
      observacoes: formData.observacoes?.toUpperCase(),
      coordenadas: { coords, cor: formData.cor }
    };

    if (editingArea) {
      updateAreaMutation.mutate({ id: editingArea.id, data });
    } else {
      createAreaMutation.mutate(data);
    }
  };

  const handleMoverLote = () => {
    if (!selectedArea) {
      toast.error('Selecione uma área de destino!');
      return;
    }

    moveLoteMutation.mutate({
      loteId: selectedLote.id,
      areaDestinoId: selectedArea
    });
  };

  const categorias = [...new Set(lotes.map(l => l.categoria).filter(Boolean))];

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Mapa da Pecuária</h1>
          <p className="text-xs text-slate-600">Visualize e gerencie áreas e lotes</p>
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
                  <Button
                    variant={mapType === 'hybrid' ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setMapType('hybrid')}
                    className="h-7 text-xs"
                  >
                    Híbrido
                  </Button>
                </div>

                <Button
                  variant={showAreas ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setShowAreas(!showAreas)}
                  className="h-7 text-xs"
                >
                  <Square className="w-3 h-3 mr-1" />
                  Áreas
                </Button>

                <Button
                  variant={showLotes ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setShowLotes(!showLotes)}
                  className="h-7 text-xs"
                >
                  <MapPin className="w-3 h-3 mr-1" />
                  Lotes
                </Button>

                {!isDrawing && (
                  <Button
                    onClick={handleStartDrawing}
                    size="sm"
                    className="h-7 text-xs bg-blue-600 hover:bg-blue-700"
                  >
                    <Plus className="w-3 h-3 mr-1" />
                    Nova Área
                  </Button>
                )}

                {isDrawing && (
                  <>
                    <Button
                      onClick={resetForm}
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs"
                    >
                      <X className="w-3 h-3 mr-1" />
                      Cancelar
                    </Button>
                    <Button
                      onClick={handleFinishDrawing}
                      size="sm"
                      disabled={currentPoints.length < 3}
                      className={`h-7 text-xs ${currentPoints.length >= 3 ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-400'}`}
                    >
                      <Save className="w-3 h-3 mr-1" />
                      Finalizar ({currentPoints.length})
                    </Button>
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
                cursor: isDrawing ? 'crosshair' : 'default'
              }}
            />
            {isDrawing && (
              <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-10 bg-blue-600 text-white px-6 py-3 rounded-lg shadow-2xl font-bold text-sm border-2 border-white">
                🎯 Clique no mapa para desenhar ({currentPoints.length} pontos)
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="bg-slate-50 border-b py-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Filter className="w-4 h-4" />
              Filtros e Busca
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                <Input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Área ou lote..."
                  className="h-8 text-xs pl-8"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Categoria de Gado</Label>
              <Select value={filterCategoria} onValueChange={setFilterCategoria}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">Todas</SelectItem>
                  {categorias.map(cat => (
                    <SelectItem key={cat} value={cat} className="text-xs">{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="pt-3 border-t">
              <div className="text-xs font-semibold text-slate-700 mb-2">📊 Estatísticas</div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-600">Total de Áreas:</span>
                  <span className="font-semibold">{areas.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Total de Lotes:</span>
                  <span className="font-semibold">{Object.keys(lotesPorArea).length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Total de Animais:</span>
                  <span className="font-semibold">{lotes.reduce((sum, l) => sum + (l.quantidade_cabecas || 0), 0)}</span>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t">
              <div className="text-xs font-semibold text-slate-700 mb-2">🎨 Legenda de Lotes</div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#10b981' }}></div>
                  <span className="text-xs">Outros</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#3b82f6' }}></div>
                  <span className="text-xs">Novilhos/Garrotes</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#ec4899' }}></div>
                  <span className="text-xs">Vacas/Novilhas</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: '#ef4444' }}></div>
                  <span className="text-xs">Touros</span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Dialog de cadastro de área */}
      <Dialog open={showAreaDialog} onOpenChange={setShowAreaDialog}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">Cadastrar Nova Área</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Nome da Área *</Label>
                <Input
                  value={formData.nome}
                  onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                  placeholder="PIQUETE 01"
                  className="h-8 text-xs uppercase"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Tipo de Uso *</Label>
                <Select value={formData.tipo_uso} onValueChange={(v) => setFormData({ ...formData, tipo_uso: v })}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_USO.map(tipo => (
                      <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Área (ha) *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.area_total}
                    onChange={(e) => setFormData({ ...formData, area_total: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Capacidade (UA)</Label>
                  <Input
                    type="number"
                    value={formData.capacidade_maxima}
                    onChange={(e) => setFormData({ ...formData, capacidade_maxima: e.target.value })}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Tipo de Pastagem</Label>
                <Input
                  value={formData.tipo_pastagem}
                  onChange={(e) => setFormData({ ...formData, tipo_pastagem: e.target.value })}
                  placeholder="BRACHIARIA, TIFTON..."
                  className="h-8 text-xs uppercase"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Cor da Área</Label>
                <div className="grid grid-cols-5 gap-2">
                  {CORES_DISPONIVEIS.map(cor => (
                    <button
                      key={cor}
                      type="button"
                      onClick={() => setFormData({ ...formData, cor })}
                      className={`w-full h-10 rounded border-2 transition-all ${formData.cor === cor ? 'border-slate-900 scale-110' : 'border-slate-200'}`}
                      style={{ backgroundColor: cor }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 p-3 bg-slate-50 rounded">
                <input
                  type="checkbox"
                  checked={formData.irrigado}
                  onChange={(e) => setFormData({ ...formData, irrigado: e.target.checked })}
                  className="w-4 h-4"
                />
                <Label className="text-xs">Área Irrigada</Label>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Observações</Label>
                <Input
                  value={formData.observacoes}
                  onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                  placeholder="OBSERVAÇÕES..."
                  className="h-8 text-xs uppercase"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-3 border-t">
            <Button variant="outline" onClick={resetForm} size="sm" className="h-8 text-xs">
              Cancelar
            </Button>
            <Button onClick={handleSaveArea} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
              Salvar Área
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog de movimentação de lote */}
      <Dialog open={showMoveDialog} onOpenChange={setShowMoveDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Mover Lote</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="bg-blue-50 border border-blue-200 rounded p-3">
              <div className="text-xs font-semibold text-blue-900">Lote Selecionado</div>
              <div className="text-sm font-bold text-blue-700">{selectedLote?.nome}</div>
              <div className="text-xs text-blue-600 mt-1">{selectedLote?.quantidade_cabecas} cabeças</div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Área de Destino *</Label>
              <Select value={selectedArea || ''} onValueChange={setSelectedArea}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione a área" />
                </SelectTrigger>
                <SelectContent>
                  {areas.map(area => (
                      <SelectItem key={area.id} value={area.id} className="text-xs">
                        {area.nome} ({area.tamanho_hectares} ha)
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setShowMoveDialog(false)} size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button onClick={handleMoverLote} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                Confirmar Movimentação
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}