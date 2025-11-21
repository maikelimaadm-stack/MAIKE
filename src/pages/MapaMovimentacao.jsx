import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Map, ArrowRightLeft, Plus, RefreshCw, Edit, Trash2, Save, X, PenTool, Layers } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const GOOGLE_MAPS_API_KEY = "AIzaSyB-PfoOotwVlkAzt72cBgYE2tl4vJuqFe8";

const getStatusColor = (status) => {
  const colors = {
    'Disponível': '#10b981',
    'Médio': '#fbbf24',
    'Alto': '#f97316',
    'Sobrepastoreado': '#ef4444'
  };
  return colors[status] || '#64748b';
};

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

export default function MapaMovimentacao() {
  const [selectedArea, setSelectedArea] = useState(null);
  const [moverLote, setMoverLote] = useState("");
  const [areaDestino, setAreaDestino] = useState("");
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState([]);
  const [showNewAreaDialog, setShowNewAreaDialog] = useState(false);
  const [newAreaData, setNewAreaData] = useState({ nome: "", tamanho_hectares: "", capacidade_maxima: "", tipo_pastagem: "" });
  const [editingArea, setEditingArea] = useState(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [mapType, setMapType] = useState('roadmap');

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const polygonsRef = useRef([]);
  const currentPolygonRef = useRef(null);
  const infoWindowRef = useRef(null);

  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');

  const { data: areas = [] } = useQuery({
    queryKey: ['areas', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter(a => a.empresa_id === empresaSelecionadaId && a.ativo);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: gado = [] } = useQuery({
    queryKey: ['gado', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Gado.list();
      return all.filter(g => g.empresa_id === empresaSelecionadaId && g.status === 'Ativo');
    },
    enabled: !!empresaSelecionadaId,
  });

  const movimentarMutation = useMutation({
    mutationFn: async ({ lote, areaDestinoId }) => {
      const animaisLote = gado.filter(g => g.lote === lote);
      
      for (const animal of animaisLote) {
        await base44.entities.Gado.update(animal.id, {
          area_atual_id: areaDestinoId
        });
      }

      const areaOrigem = areas.find(a => a.id === animaisLote[0]?.area_atual_id);
      const destino = areas.find(a => a.id === areaDestinoId);

      await base44.entities.MovimentacaoPecuaria.create({
        empresa_id: empresaSelecionadaId,
        numero_movimentacao: String(Date.now()),
        tipo: 'Transferência de Área',
        data_movimentacao: new Date().toISOString(),
        lote: lote,
        quantidade_animais: animaisLote.length,
        area_origem_id: areaOrigem?.id,
        area_origem_nome: areaOrigem?.nome,
        area_destino_id: areaDestinoId,
        area_destino_nome: destino?.nome,
        motivo: 'Transferência de lote',
        usuario_responsavel: (await base44.auth.me()).email
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gado'] });
      queryClient.invalidateQueries({ queryKey: ['areas'] });
      setMoverLote("");
      setAreaDestino("");
      toast.success('Lote movimentado!');
    }
  });

  const createAreaMutation = useMutation({
    mutationFn: async (data) => {
      const allAreas = await base44.entities.AreaPastagem.list();
      const maxNum = allAreas.reduce((max, a) => Math.max(max, parseInt(a.numero_area) || 0), 0);
      const proximoNumero = maxNum + 1;

      return base44.entities.AreaPastagem.create({
        ...data,
        empresa_id: empresaSelecionadaId,
        numero_area: String(proximoNumero),
        quantidade_atual: 0,
        status_ocupacao: 'Disponível',
        ativo: true
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas'] });
      setIsDrawing(false);
      setCurrentPoints([]);
      setShowNewAreaDialog(false);
      setNewAreaData({ nome: "", tamanho_hectares: "", capacidade_maxima: "", tipo_pastagem: "" });
      if (currentPolygonRef.current) {
        currentPolygonRef.current.setMap(null);
        currentPolygonRef.current = null;
      }
      toast.success('Área cadastrada no mapa!');
    }
  });

  const updateAreaMutation = useMutation({
    mutationFn: async ({ id, coords }) => {
      return base44.entities.AreaPastagem.update(id, {
        coordenadas: { coords }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas'] });
      setEditingArea(null);
      setIsEditMode(false);
      setCurrentPoints([]);
      if (currentPolygonRef.current) {
        currentPolygonRef.current.setMap(null);
        currentPolygonRef.current = null;
      }
      toast.success('Área atualizada!');
    }
  });

  const deleteAreaMutation = useMutation({
    mutationFn: (id) => base44.entities.AreaPastagem.update(id, { ativo: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas'] });
      setSelectedArea(null);
      toast.success('Área removida!');
    }
  });

  const handleMoverLote = () => {
    if (!moverLote || !areaDestino) {
      toast.error('Selecione lote e área destino!');
      return;
    }

    movimentarMutation.mutate({ lote: moverLote, areaDestinoId: areaDestino });
  };

  const handleStartDrawing = () => {
    setIsDrawing(true);
    setCurrentPoints([]);
    setIsEditMode(false);
    setEditingArea(null);
    setSelectedArea(null);
    if (infoWindowRef.current) infoWindowRef.current.close();
    toast.info('Clique no mapa para desenhar a área (mínimo 3 pontos)');
  };

  const handleCancelDrawing = () => {
    setIsDrawing(false);
    setCurrentPoints([]);
    setIsEditMode(false);
    setEditingArea(null);
    if (currentPolygonRef.current) {
      currentPolygonRef.current.setMap(null);
      currentPolygonRef.current = null;
    }
  };

  const handleFinishDrawing = () => {
    if (currentPoints.length < 3) {
      toast.error('Desenhe pelo menos 3 pontos!');
      return;
    }
    setShowNewAreaDialog(true);
  };

  const handleSaveNewArea = () => {
    if (!newAreaData.nome || !newAreaData.tamanho_hectares) {
      toast.error('Preencha nome e tamanho!');
      return;
    }

    const coordsFormatted = currentPoints.map(p => [p.lat, p.lng]);
    createAreaMutation.mutate({ ...newAreaData, coordenadas: { coords: coordsFormatted } });
  };

  const handleEditArea = (area) => {
    setEditingArea(area);
    setIsEditMode(true);
    const coords = area.coordenadas?.coords || [];
    setCurrentPoints(coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng })));
    setSelectedArea(null);
    if (infoWindowRef.current) infoWindowRef.current.close();
    toast.info('Clique no mapa para redefinir a área');
  };

  const handleSaveEditedArea = () => {
    if (currentPoints.length < 3) {
      toast.error('Área precisa ter pelo menos 3 pontos!');
      return;
    }
    const coordsFormatted = currentPoints.map(p => [p.lat, p.lng]);
    updateAreaMutation.mutate({ id: editingArea.id, coords: coordsFormatted });
  };

  const handleDeleteArea = (areaId) => {
    const animais = getAnimaisNaArea(areaId);
    if (animais.length > 0) {
      toast.error(`Área possui ${animais.length} animais. Remova-os primeiro!`);
      return;
    }
    if (window.confirm('⚠️ Remover esta área do mapa?')) {
      deleteAreaMutation.mutate(areaId);
    }
  };

  const lotes = [...new Set(gado.map(g => g.lote).filter(Boolean))];

  const getAnimaisNaArea = (areaId) => {
    return gado.filter(g => g.area_atual_id === areaId);
  };

  const defaultCenter = { lat: -15.0067, lng: -59.9533 };

  useEffect(() => {
    loadGoogleMapsScript().then(() => {
      if (!mapRef.current || mapInstanceRef.current) return;

      const map = new google.maps.Map(mapRef.current, {
        center: defaultCenter,
        zoom: 15,
        mapTypeId: mapType,
        mapTypeControl: true,
        mapTypeControlOptions: {
          style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
          position: google.maps.ControlPosition.TOP_RIGHT,
          mapTypeIds: ['roadmap', 'satellite', 'hybrid', 'terrain']
        },
        streetViewControl: false,
        fullscreenControl: true,
      });

      mapInstanceRef.current = map;
      infoWindowRef.current = new google.maps.InfoWindow();

      map.addListener('click', (e) => {
        if (isDrawing || isEditMode) {
          const newPoint = { lat: e.latLng.lat(), lng: e.latLng.lng() };
          setCurrentPoints(prev => [...prev, newPoint]);
        }
      });

      renderAreas();
    });
  }, []);

  useEffect(() => {
    if (mapInstanceRef.current) {
      mapInstanceRef.current.setMapTypeId(mapType);
    }
  }, [mapType]);

  useEffect(() => {
    if (mapInstanceRef.current) {
      renderAreas();
    }
  }, [areas, isDrawing, isEditMode, editingArea]);

  useEffect(() => {
    if (mapInstanceRef.current && (isDrawing || isEditMode) && currentPoints.length > 0) {
      if (currentPolygonRef.current) {
        currentPolygonRef.current.setMap(null);
      }

      if (currentPoints.length >= 2) {
        currentPolygonRef.current = new google.maps.Polygon({
          paths: currentPoints,
          strokeColor: '#3b82f6',
          strokeOpacity: 1,
          strokeWeight: 3,
          fillColor: '#3b82f6',
          fillOpacity: 0.2,
          editable: false,
          draggable: false,
        });
        currentPolygonRef.current.setMap(mapInstanceRef.current);
      }
    } else if (currentPolygonRef.current) {
      currentPolygonRef.current.setMap(null);
      currentPolygonRef.current = null;
    }
  }, [currentPoints, isDrawing, isEditMode]);

  const renderAreas = () => {
    if (!mapInstanceRef.current) return;

    polygonsRef.current.forEach(polygon => polygon.setMap(null));
    polygonsRef.current = [];

    if (isDrawing || isEditMode) return;

    areas.forEach(area => {
      if (editingArea?.id === area.id) return;

      const coords = area.coordenadas?.coords || [];
      if (coords.length < 3) return;

      const paths = coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }));
      const animaisNaArea = getAnimaisNaArea(area.id).length;

      const polygon = new google.maps.Polygon({
        paths: paths,
        strokeColor: getStatusColor(area.status_ocupacao),
        strokeOpacity: 1,
        strokeWeight: 2.5,
        fillColor: getStatusColor(area.status_ocupacao),
        fillOpacity: 0.35,
        editable: false,
        draggable: false,
      });

      polygon.setMap(mapInstanceRef.current);
      polygonsRef.current.push(polygon);

      polygon.addListener('click', () => {
        setSelectedArea(area);
        
        const percentual = area.capacidade_maxima > 0 ? (animaisNaArea / area.capacidade_maxima) * 100 : 0;

        const content = `
          <div style="padding: 8px; min-width: 220px;">
            <div style="font-weight: bold; font-size: 16px; margin-bottom: 8px; color: #0f172a;">${area.nome}</div>
            <div style="font-size: 12px; color: #475569; line-height: 1.6;">
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span>Tamanho:</span>
                <span style="font-weight: 600;">${area.tamanho_hectares} ha</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span>Capacidade:</span>
                <span style="font-weight: 600;">${area.capacidade_maxima} UA</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
                <span>Animais:</span>
                <span style="font-weight: 600;">${animaisNaArea}</span>
              </div>
              <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
                <span>Ocupação:</span>
                <span style="font-weight: 600;">${percentual.toFixed(0)}%</span>
              </div>
              <div style="padding: 4px 8px; background-color: ${getStatusColor(area.status_ocupacao)}20; 
                          border: 1px solid ${getStatusColor(area.status_ocupacao)}; 
                          color: ${getStatusColor(area.status_ocupacao)}; 
                          border-radius: 4px; text-align: center; font-size: 11px; font-weight: 600;">
                ${area.status_ocupacao}
              </div>
            </div>
          </div>
        `;

        const bounds = new google.maps.LatLngBounds();
        paths.forEach(p => bounds.extend(p));
        
        infoWindowRef.current.setContent(content);
        infoWindowRef.current.setPosition(bounds.getCenter());
        infoWindowRef.current.open(mapInstanceRef.current);
      });

      polygon.addListener('mouseover', () => {
        polygon.setOptions({ fillOpacity: 0.6, strokeWeight: 3 });
      });

      polygon.addListener('mouseout', () => {
        polygon.setOptions({ fillOpacity: 0.35, strokeWeight: 2.5 });
      });
    });
  };

  return (
    <div className="p-4 md:p-6 space-y-2">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Mapa de Movimentação</h1>
          <p className="text-xs text-slate-600">Visualizar e movimentar lotes entre áreas</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        <Card className="lg:col-span-3">
          <CardHeader className="bg-slate-50 border-b py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Map className="w-4 h-4" />
                Mapa da Fazenda
              </CardTitle>
              <div className="flex gap-2">
                {!isDrawing && !isEditMode && (
                  <Button onClick={handleStartDrawing} size="sm" className="h-8 text-xs bg-blue-600 hover:bg-blue-700">
                    <PenTool className="w-3.5 h-3.5 mr-1" />
                    Desenhar Área
                  </Button>
                )}
                {(isDrawing || isEditMode) && (
                  <>
                    <Button onClick={handleCancelDrawing} variant="outline" size="sm" className="h-8 text-xs">
                      <X className="w-3.5 h-3.5 mr-1" />
                      Cancelar
                    </Button>
                    <Button 
                      onClick={isEditMode ? handleSaveEditedArea : handleFinishDrawing} 
                      size="sm" 
                      className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
                      disabled={currentPoints.length < 3}
                    >
                      <Save className="w-3.5 h-3.5 mr-1" />
                      {isEditMode ? 'Salvar Edição' : `Finalizar (${currentPoints.length} pts)`}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div style={{ height: '600px', width: '100%', position: 'relative' }}>
              <div 
                ref={mapRef} 
                style={{ 
                  height: '100%', 
                  width: '100%', 
                  borderRadius: '0 0 8px 8px',
                  backgroundColor: '#e5e7eb'
                }}
              />

              {(isDrawing || isEditMode) && (
                <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-[1000] bg-blue-600 text-white px-4 py-2 rounded-lg shadow-lg text-sm font-medium">
                  {isEditMode ? 'Clique no mapa para redefinir a área' : `Clique no mapa para desenhar (${currentPoints.length} pontos)`}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3">
          <Card>
            <CardHeader className="bg-slate-50 border-b py-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <ArrowRightLeft className="w-4 h-4" />
                Mover Lote
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Lote</Label>
                <Select value={moverLote} onValueChange={setMoverLote}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {lotes.map((lote) => {
                      const animais = gado.filter(g => g.lote === lote);
                      return (
                        <SelectItem key={lote} value={lote} className="text-xs">
                          {lote} ({animais.length} animais)
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Área Destino</Label>
                <Select value={areaDestino} onValueChange={setAreaDestino}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {areas.map((area) => (
                      <SelectItem key={area.id} value={area.id} className="text-xs">
                        {area.nome}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={handleMoverLote} className="w-full h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                Movimentar
              </Button>
            </CardContent>
          </Card>

          {selectedArea && (
            <Card>
              <CardHeader className="bg-blue-50 border-b py-3">
                <CardTitle className="text-sm font-semibold">Área Selecionada</CardTitle>
              </CardHeader>
              <CardContent className="p-4 space-y-3">
                <div className="text-xs">
                  <div className="font-bold text-sm">{selectedArea.nome}</div>
                  <div className="text-slate-600 mt-2">Tamanho: {selectedArea.tamanho_hectares} ha</div>
                  <div className="text-slate-600">Capacidade: {selectedArea.capacidade_maxima} UA</div>
                  <div className="text-slate-600">Animais: {getAnimaisNaArea(selectedArea.id).length}</div>
                  <div className="mt-2">
                    <Badge variant="outline" className={`text-xs`} style={{ 
                      backgroundColor: getStatusColor(selectedArea.status_ocupacao) + '20',
                      color: getStatusColor(selectedArea.status_ocupacao),
                      borderColor: getStatusColor(selectedArea.status_ocupacao)
                    }}>
                      {selectedArea.status_ocupacao}
                    </Badge>
                  </div>
                </div>
                <div className="flex gap-2 pt-2 border-t">
                  <Button 
                    size="sm" 
                    variant="outline" 
                    className="h-7 text-xs flex-1"
                    onClick={() => handleEditArea(selectedArea)}
                  >
                    <Edit className="w-3 h-3 mr-1" />
                    Editar
                  </Button>
                  <Button 
                    size="sm" 
                    variant="outline" 
                    className="h-7 text-xs flex-1 text-red-600"
                    onClick={() => handleDeleteArea(selectedArea.id)}
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    Excluir
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="bg-slate-50 border-b py-3">
              <CardTitle className="text-sm font-semibold">Legenda</CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: '#10b981' }}></div>
                <span className="text-xs">Disponível (0-60%)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: '#fbbf24' }}></div>
                <span className="text-xs">Médio (61-90%)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: '#f97316' }}></div>
                <span className="text-xs">Alto (91-100%)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: '#ef4444' }}></div>
                <span className="text-xs">Sobrepastoreado (&gt;100%)</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={showNewAreaDialog} onOpenChange={setShowNewAreaDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Nova Área - Dados</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Nome da Área *</Label>
              <Input
                value={newAreaData.nome}
                onChange={(e) => setNewAreaData({ ...newAreaData, nome: e.target.value })}
                placeholder="PIQUETE 01"
                className="h-8 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tamanho (hectares) *</Label>
              <Input
                type="number"
                step="0.01"
                value={newAreaData.tamanho_hectares}
                onChange={(e) => setNewAreaData({ ...newAreaData, tamanho_hectares: e.target.value })}
                placeholder="0.00"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Capacidade Máxima (UA)</Label>
              <Input
                type="number"
                value={newAreaData.capacidade_maxima}
                onChange={(e) => setNewAreaData({ ...newAreaData, capacidade_maxima: e.target.value })}
                placeholder="0"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Tipo de Pastagem</Label>
              <Input
                value={newAreaData.tipo_pastagem}
                onChange={(e) => setNewAreaData({ ...newAreaData, tipo_pastagem: e.target.value })}
                placeholder="BRACHIARIA, TIFTON, ETC"
                className="h-8 text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
              />
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setShowNewAreaDialog(false)} size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button onClick={handleSaveNewArea} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                Salvar Área
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}