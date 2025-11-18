import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { MapContainer, TileLayer, Polygon, Popup, useMapEvents } from 'react-leaflet';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Map, ArrowRightLeft, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import 'leaflet/dist/leaflet.css';

const getStatusColor = (status) => {
  const colors = {
    'Disponível': '#10b981',
    'Médio': '#fbbf24',
    'Alto': '#f97316',
    'Sobrepastoreado': '#ef4444'
  };
  return colors[status] || '#64748b';
};

export default function MapaMovimentacao() {
  const [selectedArea, setSelectedArea] = useState(null);
  const [moverLote, setMoverLote] = useState("");
  const [areaDestino, setAreaDestino] = useState("");

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

  const handleMoverLote = () => {
    if (!moverLote || !areaDestino) {
      toast.error('Selecione lote e área destino!');
      return;
    }

    movimentarMutation.mutate({ lote: moverLote, areaDestinoId: areaDestino });
  };

  const lotes = [...new Set(gado.map(g => g.lote).filter(Boolean))];

  const getAnimaisNaArea = (areaId) => {
    return gado.filter(g => g.area_atual_id === areaId);
  };

  const defaultCenter = [-15.0067, -59.9533];
  const defaultPolygons = areas.length === 0 ? [
    { id: 'demo1', nome: 'ÁREA DEMO 1', coords: [[-15.005, -59.955], [-15.005, -59.951], [-15.008, -59.951], [-15.008, -59.955]], status: 'Disponível' }
  ] : [];

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
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Map className="w-4 h-4" />
              Mapa da Fazenda
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div style={{ height: '600px', width: '100%' }}>
              <MapContainer center={defaultCenter} zoom={14} style={{ height: '100%', width: '100%' }}>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                
                {areas.map((area) => {
                  const coords = area.coordenadas?.coords || [
                    [defaultCenter[0] + Math.random() * 0.01, defaultCenter[1] + Math.random() * 0.01],
                    [defaultCenter[0] + Math.random() * 0.01, defaultCenter[1] + Math.random() * 0.01 + 0.005],
                    [defaultCenter[0] + Math.random() * 0.01 + 0.005, defaultCenter[1] + Math.random() * 0.01 + 0.005],
                    [defaultCenter[0] + Math.random() * 0.01 + 0.005, defaultCenter[1] + Math.random() * 0.01]
                  ];

                  return (
                    <Polygon
                      key={area.id}
                      positions={coords}
                      pathOptions={{
                        color: getStatusColor(area.status_ocupacao),
                        fillColor: getStatusColor(area.status_ocupacao),
                        fillOpacity: 0.4,
                        weight: 2
                      }}
                      eventHandlers={{
                        click: () => setSelectedArea(area)
                      }}
                    >
                      <Popup>
                        <div className="text-xs">
                          <div className="font-bold text-sm">{area.nome}</div>
                          <div className="text-slate-600 mt-1">Tamanho: {area.tamanho_hectares} ha</div>
                          <div className="text-slate-600">Capacidade: {area.capacidade_maxima} UA</div>
                          <div className="text-slate-600">Atual: {getAnimaisNaArea(area.id)} animais</div>
                          <div className="text-slate-600">Status: {area.status_ocupacao}</div>
                        </div>
                      </Popup>
                    </Polygon>
                  );
                })}

                {defaultPolygons.map((poly) => (
                  <Polygon
                    key={poly.id}
                    positions={poly.coords}
                    pathOptions={{
                      color: getStatusColor(poly.status),
                      fillColor: getStatusColor(poly.status),
                      fillOpacity: 0.3,
                      weight: 2,
                      dashArray: '5, 5'
                    }}
                  >
                    <Popup>
                      <div className="text-xs">
                        <div className="font-bold">{poly.nome}</div>
                        <div className="text-slate-600 mt-1">Área de demonstração</div>
                        <div className="text-slate-600">Cadastre suas áreas!</div>
                      </div>
                    </Popup>
                  </Polygon>
                ))}
              </MapContainer>
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
              <CardContent className="p-4 space-y-2">
                <div className="text-xs">
                  <div className="font-bold text-sm">{selectedArea.nome}</div>
                  <div className="text-slate-600 mt-2">Tamanho: {selectedArea.tamanho_hectares} ha</div>
                  <div className="text-slate-600">Capacidade: {selectedArea.capacidade_maxima} UA</div>
                  <div className="text-slate-600">Animais: {getAnimaisNaArea(selectedArea.id)}</div>
                  <div className="mt-2">
                    <Badge variant="outline" className={`${getStatusColor(selectedArea.status_ocupacao)} text-xs`}>
                      {selectedArea.status_ocupacao}
                    </Badge>
                  </div>
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
    </div>
  );
}