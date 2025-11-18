import React, { useState, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, Polygon, Popup, Marker, useMapEvents, LayersControl } from 'react-leaflet';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Map, ArrowRightLeft, Plus, RefreshCw, Edit, Trash2, Save, X, PenTool, Satellite, MapPin } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import 'leaflet/dist/leaflet.css';

const { BaseLayer } = LayersControl;

const getStatusColor = (status) => {
  const colors = {
    'Disponível': '#10b981',
    'Médio': '#fbbf24',
    'Alto': '#f97316',
    'Sobrepastoreado': '#ef4444'
  };
  return colors[status] || '#64748b';
};

// Componente para desenhar no mapa
const MapDrawer = ({ onComplete, isDrawing, currentPoints, onPointAdd }) => {
  useMapEvents({
    click: (e) => {
      if (isDrawing) {
        onPointAdd([e.latlng.lat, e.latlng.lng]);
      }
    },
  });

  return currentPoints.length > 0 && isDrawing ? (
    <Polygon
      positions={currentPoints.length < 3 ? [...currentPoints, ...currentPoints] : currentPoints}
      pathOptions={{
        color: '#3b82f6',
        fillColor: '#3b82f6',
        fillOpacity: 0.2,
        weight: 3,
        dashArray: '10, 5'
      }}
    />
  ) : null;
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
        coordenadas: { coords: currentPoints },
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
    toast.info('Clique no mapa para desenhar a área (mínimo 3 pontos)');
  };

  const handleCancelDrawing = () => {
    setIsDrawing(false);
    setCurrentPoints([]);
    setIsEditMode(false);
    setEditingArea(null);
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

    createAreaMutation.mutate(newAreaData);
  };

  const handleEditArea = (area) => {
    setEditingArea(area);
    setIsEditMode(true);
    setCurrentPoints(area.coordenadas?.coords || []);
    setSelectedArea(null);
    toast.info('Clique no mapa para redefinir a área');
  };

  const handleSaveEditedArea = () => {
    if (currentPoints.length < 3) {
      toast.error('Área precisa ter pelo menos 3 pontos!');
      return;
    }
    updateAreaMutation.mutate({ id: editingArea.id, coords: currentPoints });
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

  const handlePointAdd = (point) => {
    setCurrentPoints([...currentPoints, point]);
  };

  const lotes = [...new Set(gado.map(g => g.lote).filter(Boolean))];

  const getAnimaisNaArea = (areaId) => {
    return gado.filter(g => g.area_atual_id === areaId);
  };

  const defaultCenter = [-15.0067, -59.9533];

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
              <MapContainer 
                center={defaultCenter} 
                zoom={15} 
                style={{ height: '100%', width: '100%', borderRadius: '0 0 8px 8px' }}
                zoomControl={true}
              >
                <LayersControl position="topright">
                  <BaseLayer checked name="Mapa">
                    <TileLayer
                      attribution='&copy; Google Maps'
                      url="https://mt1.google.com/vt/lyrs=r&x={x}&y={y}&z={z}"
                    />
                  </BaseLayer>
                  <BaseLayer name="Satélite">
                    <TileLayer
                      attribution='&copy; Google Maps'
                      url="https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}"
                    />
                  </BaseLayer>
                  <BaseLayer name="Híbrido">
                    <TileLayer
                      attribution='&copy; Google Maps'
                      url="https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"
                    />
                  </BaseLayer>
                </LayersControl>
                
                <MapDrawer 
                  isDrawing={isDrawing || isEditMode}
                  currentPoints={currentPoints}
                  onPointAdd={handlePointAdd}
                />

                {!isDrawing && !isEditMode && areas.map((area) => {
                  const coords = area.coordenadas?.coords || [];
                  if (coords.length < 3) return null;

                  const animaisNaArea = getAnimaisNaArea(area.id).length;
                  const percentual = area.capacidade_maxima > 0 ? (animaisNaArea / area.capacidade_maxima) * 100 : 0;

                  return (
                    <Polygon
                      key={area.id}
                      positions={coords}
                      pathOptions={{
                        color: getStatusColor(area.status_ocupacao),
                        fillColor: getStatusColor(area.status_ocupacao),
                        fillOpacity: 0.35,
                        weight: 2.5
                      }}
                      eventHandlers={{
                        click: () => setSelectedArea(area),
                        mouseover: (e) => e.target.setStyle({ fillOpacity: 0.6, weight: 3 }),
                        mouseout: (e) => e.target.setStyle({ fillOpacity: 0.35, weight: 2.5 })
                      }}
                    >
                      <Popup closeButton={false} className="custom-popup">
                        <div className="p-2" style={{ minWidth: '200px' }}>
                          <div className="font-bold text-base mb-2 text-slate-900">{area.nome}</div>
                          <div className="space-y-1 text-xs text-slate-700">
                            <div className="flex justify-between">
                              <span>Tamanho:</span>
                              <span className="font-semibold">{area.tamanho_hectares} ha</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Capacidade:</span>
                              <span className="font-semibold">{area.capacidade_maxima} UA</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Animais:</span>
                              <span className="font-semibold">{animaisNaArea}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Ocupação:</span>
                              <span className="font-semibold">{percentual.toFixed(0)}%</span>
                            </div>
                            <div className="mt-2 pt-2 border-t">
                              <Badge 
                                variant="outline" 
                                className="text-xs"
                                style={{
                                  backgroundColor: getStatusColor(area.status_ocupacao) + '20',
                                  color: getStatusColor(area.status_ocupacao),
                                  borderColor: getStatusColor(area.status_ocupacao)
                                }}
                              >
                                {area.status_ocupacao}
                              </Badge>
                            </div>
                          </div>
                          <div className="flex gap-1 mt-3">
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="h-7 text-xs flex-1"
                              onClick={() => handleEditArea(area)}
                            >
                              <Edit className="w-3 h-3 mr-1" />
                              Editar
                            </Button>
                            <Button 
                              size="sm" 
                              variant="outline" 
                              className="h-7 text-xs flex-1 text-red-600 hover:bg-red-50"
                              onClick={() => handleDeleteArea(area.id)}
                            >
                              <Trash2 className="w-3 h-3 mr-1" />
                              Excluir
                            </Button>
                          </div>
                        </div>
                      </Popup>
                    </Polygon>
                  );
                })}
              </MapContainer>

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