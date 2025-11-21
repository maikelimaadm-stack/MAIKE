import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Map, Maximize2, Square, MapPin, Save, X, Edit, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const GOOGLE_MAPS_API_KEY = "AIzaSyB-PfoOotwVlkAzt72cBgYE2tl4vJuqFe8";

const CORES_DISPONIVEIS = [
  "#ff6b00", "#ffaa00", "#66ff99", "#00cc66",
  "#66ccff", "#0066ff", "#999999", "#ff1744", "#ff99cc",
  "#9933ff", "#000000", "#006666", "#664400", "#ccff00"
];

const TIPOS_PONTOS = [
  "Cocho", "Bebedouro", "Armazém", "Depósito", "Silo", 
  "Porteira", "Curral", "Tronco", "Balança", "Casa Sede"
];

const ICONES_PONTOS = {
  "Cocho": "https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/690cd380760c45b456c6ef81/093b10b89_47631448-vaca-em-pe-dentro-uma-fazenda-construcao-para-gado-reproducao-vetor.jpg",
  "Bebedouro": "💧",
  "Armazém": "🏪",
  "Depósito": "📦",
  "Silo": "🌾",
  "Porteira": "🚪",
  "Curral": "🐄",
  "Tronco": "🔨",
  "Balança": "⚖️",
  "Casa Sede": "🏠"
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

export default function CadastroAreasReferencia() {
  const [tipoEntidade, setTipoEntidade] = useState("area");
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoints, setCurrentPoints] = useState([]);
  const [currentMarker, setCurrentMarker] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const [corSelecionada, setCorSelecionada] = useState(CORES_DISPONIVEIS[3]);
  const [editingItem, setEditingItem] = useState(null);

  const [formData, setFormData] = useState({
    nome: "",
    numero_codigo: "",
    area_total: "",
    tipo_uso: "",
    tipo_ponto: "",
    observacoes: ""
  });

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const polygonsRef = useRef([]);
  const markersRef = useRef([]);
  const currentPolygonRef = useRef(null);
  const tempMarkerRef = useRef(null);

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
      toast.success('Área cadastrada!');
    }
  });

  const updateAreaMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.AreaPastagem.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas'] });
      resetForm();
      toast.success('Área atualizada!');
    }
  });

  const deleteAreaMutation = useMutation({
    mutationFn: (id) => base44.entities.AreaPastagem.update(id, { ativo: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas'] });
      toast.success('Área removida!');
    }
  });

  const createPontoMutation = useMutation({
    mutationFn: async (data) => {
      const allPontos = await base44.entities.PontoReferencia.list();
      const maxNum = allPontos.reduce((max, p) => Math.max(max, parseInt(p.numero_ponto) || 0), 0);
      return base44.entities.PontoReferencia.create({
        ...data,
        empresa_id: empresaSelecionadaId,
        numero_ponto: String(maxNum + 1),
        ativo: true
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pontos'] });
      resetForm();
      toast.success('Ponto de referência cadastrado!');
    }
  });

  const updatePontoMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.PontoReferencia.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pontos'] });
      resetForm();
      toast.success('Ponto atualizado!');
    }
  });

  const deletePontoMutation = useMutation({
    mutationFn: (id) => base44.entities.PontoReferencia.update(id, { ativo: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pontos'] });
      toast.success('Ponto removido!');
    }
  });

  const resetForm = () => {
    setIsDrawing(false);
    setCurrentPoints([]);
    setCurrentMarker(null);
    setShowDialog(false);
    setEditingItem(null);
    setFormData({ nome: "", numero_codigo: "", area_total: "", tipo_uso: "", tipo_ponto: "", observacoes: "" });
    if (currentPolygonRef.current) {
      currentPolygonRef.current.setMap(null);
      currentPolygonRef.current = null;
    }
    if (tempMarkerRef.current) {
      tempMarkerRef.current.setMap(null);
      tempMarkerRef.current = null;
    }
  };

  useEffect(() => {
    loadGoogleMapsScript().then(() => {
      if (!mapRef.current || mapInstanceRef.current) return;

      const map = new google.maps.Map(mapRef.current, {
        center: { lat: -15.0067, lng: -59.9533 },
        zoom: 16,
        mapTypeId: 'satellite',
        mapTypeControl: true,
        mapTypeControlOptions: {
          style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
          position: google.maps.ControlPosition.TOP_CENTER,
          mapTypeIds: ['roadmap', 'satellite', 'hybrid']
        },
        streetViewControl: false,
        fullscreenControl: true,
        clickableIcons: false,
        disableDoubleClickZoom: true,
      });

      mapInstanceRef.current = map;
      console.log('✅ Mapa Google carregado e pronto!');

      renderItems();
    }).catch(err => {
      console.error('❌ Erro ao carregar Google Maps:', err);
      toast.error('Erro ao carregar o mapa');
    });
  }, []);

  useEffect(() => {
    if (mapInstanceRef.current) {
      renderItems();
    }
  }, [areas, pontos, tipoEntidade]);

  useEffect(() => {
    if (!mapInstanceRef.current) {
      console.log('⚠️ Mapa ainda não foi inicializado');
      return;
    }

    console.log('🔄 Configurando listener - Estado:', { isDrawing, tipoEntidade });

    const handleMapClick = (e) => {
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      
      console.log('🖱️ CLIQUE NO MAPA!', { lat, lng, isDrawing, tipoEntidade });

      if (!isDrawing) {
        console.log('⚠️ Modo desenho NÃO está ativo');
        return;
      }

      if (tipoEntidade === 'area') {
        const newPoint = { lat, lng };
        console.log('➕ Adicionando ponto à área:', newPoint);
        
        setCurrentPoints(prev => {
          const updated = [...prev, newPoint];
          console.log('📍 Total de pontos:', updated.length);
          toast.success(`✅ Ponto ${updated.length} adicionado!`, { duration: 1000 });
          return updated;
        });
      } else if (tipoEntidade === 'ponto') {
        const position = { lat, lng };
        console.log('📌 Posicionando ponto de referência');
        
        setCurrentMarker(position);
        
        if (tempMarkerRef.current) {
          tempMarkerRef.current.setMap(null);
        }

        const iconUrl = formData.tipo_ponto && ICONES_PONTOS[formData.tipo_ponto];
        let markerIcon;

        if (iconUrl && iconUrl.startsWith('http')) {
          markerIcon = {
            url: iconUrl,
            scaledSize: new google.maps.Size(40, 40),
            anchor: new google.maps.Point(20, 20)
          };
        } else {
          markerIcon = {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 12,
            fillColor: corSelecionada,
            fillOpacity: 1,
            strokeColor: '#ffffff',
            strokeWeight: 3
          };
        }

        tempMarkerRef.current = new google.maps.Marker({
          position,
          map: mapInstanceRef.current,
          icon: markerIcon,
          draggable: true
        });

        toast.success('✅ Ponto posicionado!');
        setShowDialog(true);
      }
    };

    console.log('🎯 Adicionando listener ao mapa...');
    const listener = google.maps.event.addListener(mapInstanceRef.current, 'click', handleMapClick);
    console.log('✅ Listener adicionado!');

    return () => {
      console.log('🗑️ Removendo listener...');
      google.maps.event.removeListener(listener);
    };
  }, [isDrawing, tipoEntidade, corSelecionada]);

  useEffect(() => {
    if (mapInstanceRef.current && isDrawing && tipoEntidade === 'area' && currentPoints.length > 0) {
      if (currentPolygonRef.current) {
        currentPolygonRef.current.setMap(null);
      }

      if (currentPoints.length >= 2) {
        currentPolygonRef.current = new google.maps.Polygon({
          paths: currentPoints,
          strokeColor: corSelecionada,
          strokeOpacity: 1,
          strokeWeight: 3,
          fillColor: corSelecionada,
          fillOpacity: 0.4,
        });
        currentPolygonRef.current.setMap(mapInstanceRef.current);
      }
    } else if (currentPolygonRef.current) {
      currentPolygonRef.current.setMap(null);
      currentPolygonRef.current = null;
    }
  }, [currentPoints, isDrawing, tipoEntidade, corSelecionada]);

  const renderItems = () => {
    if (!mapInstanceRef.current) return;

    polygonsRef.current.forEach(p => p.setMap(null));
    markersRef.current.forEach(m => m.setMap(null));
    polygonsRef.current = [];
    markersRef.current = [];

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
        fillOpacity: 0.4,
        editable: true,
        draggable: true,
      });

      polygon.setMap(mapInstanceRef.current);
      polygonsRef.current.push(polygon);

      // Salvar alterações quando o usuário editar o polígono
      const saveChanges = () => {
        const newPaths = polygon.getPath().getArray().map(p => [p.lat(), p.lng()]);
        updateAreaMutation.mutate({
          id: area.id,
          data: { coordenadas: { coords: newPaths, cor } }
        });
        toast.success('Área atualizada!');
      };

      google.maps.event.addListener(polygon.getPath(), 'set_at', saveChanges);
      google.maps.event.addListener(polygon.getPath(), 'insert_at', saveChanges);
      google.maps.event.addListener(polygon, 'dragend', saveChanges);

      polygon.addListener('click', (e) => {
        // Só mostra info se não estiver editando
        if (e.vertex === undefined) {
          const infoWindow = new google.maps.InfoWindow({
            content: `
              <div style="padding: 8px;">
                <strong>${area.nome}</strong><br/>
                <span style="font-size: 12px;">Tamanho: ${area.tamanho_hectares || 0} ha</span><br/>
                <span style="font-size: 11px; color: #10b981;">✏️ Clique e arraste os pontos para editar</span>
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

    pontos.forEach(ponto => {
      const coords = ponto.coordenadas || {};
      if (!coords.lat || !coords.lng) return;

      const iconUrl = ICONES_PONTOS[ponto.tipo];
      let markerIcon;

      if (iconUrl && iconUrl.startsWith('http')) {
        // Usar imagem customizada
        markerIcon = {
          url: iconUrl,
          scaledSize: new google.maps.Size(40, 40),
          anchor: new google.maps.Point(20, 20)
        };
      } else {
        // Usar emoji/texto como fallback
        markerIcon = {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 12,
          fillColor: ponto.cor || '#0066ff',
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
        draggable: true,
      });

      markersRef.current.push(marker);

      // Salvar posição ao arrastar
      marker.addListener('dragend', (e) => {
        const newPos = { lat: e.latLng.lat(), lng: e.latLng.lng() };
        updatePontoMutation.mutate({
          id: ponto.id,
          data: { coordenadas: newPos }
        });
        toast.success('Ponto reposicionado!');
      });

      marker.addListener('click', () => {
        const infoWindow = new google.maps.InfoWindow({
          content: `
            <div style="padding: 10px;">
              <strong style="font-size: 14px;">${ponto.nome}</strong><br/>
              <span style="font-size: 12px; color: #666;">${ponto.tipo}</span><br/>
              <span style="font-size: 11px; color: #10b981; margin-top: 4px; display: block;">🖱️ Arraste para reposicionar</span>
            </div>
          `
        });
        infoWindow.open(mapInstanceRef.current, marker);
      });
    });
  };

  const handleStartDrawing = () => {
    if (!tipoEntidade) {
      toast.error('❌ Selecione o tipo primeiro (Área ou Ponto)!');
      return;
    }
    if (!mapInstanceRef.current) {
      toast.error('❌ Aguarde o mapa carregar!');
      return;
    }
    
    console.log('🎨 INICIANDO DESENHO:', tipoEntidade);
    setIsDrawing(true);
    setCurrentPoints([]);
    setCurrentMarker(null);
    
    if (tipoEntidade === 'area') {
      toast.success('🎯 CLIQUE NO MAPA para desenhar a área!', { duration: 5000 });
    } else {
      toast.success('🎯 CLIQUE NO MAPA para marcar o ponto!', { duration: 5000 });
    }
  };

  const handleFinishArea = () => {
    if (currentPoints.length < 3) {
      toast.error('Desenhe pelo menos 3 pontos!');
      return;
    }
    setShowDialog(true);
  };

  const handleSave = () => {
    if (tipoEntidade === 'area') {
      if (!formData.nome || !formData.area_total) {
        toast.error('Preencha nome e área total!');
        return;
      }

      const coords = currentPoints.map(p => [p.lat, p.lng]);
      const data = {
        nome: formData.nome.toUpperCase(),
        tamanho_hectares: parseFloat(formData.area_total),
        capacidade_maxima: parseFloat(formData.capacidade_maxima) || 0,
        tipo_pastagem: formData.tipo_uso?.toUpperCase(),
        observacoes: formData.observacoes?.toUpperCase(),
        coordenadas: { coords, cor: corSelecionada }
      };

      if (editingItem) {
        updateAreaMutation.mutate({ id: editingItem.id, data });
      } else {
        createAreaMutation.mutate(data);
      }
    } else {
      if (!formData.nome || !formData.tipo_ponto) {
        toast.error('Preencha nome e tipo!');
        return;
      }

      const data = {
        nome: formData.nome.toUpperCase(),
        tipo: formData.tipo_ponto,
        cor: corSelecionada,
        coordenadas: currentMarker,
        observacoes: formData.observacoes?.toUpperCase()
      };

      if (editingItem) {
        updatePontoMutation.mutate({ id: editingItem.id, data });
      } else {
        createPontoMutation.mutate(data);
      }
    }
  };

  return (
    <div className="p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Cadastro de Áreas e Pontos de Referência</h1>
          <p className="text-xs text-slate-600">Desenhe áreas e marque pontos importantes no mapa</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
        <Card className="lg:col-span-3">
          <CardHeader className="bg-slate-50 border-b py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Map className="w-4 h-4" />
                Mapa de Cadastro
              </CardTitle>
              <div className="flex gap-2">
                {!isDrawing && (
                  <Button 
                    onClick={handleStartDrawing} 
                    size="sm" 
                    className="h-8 text-xs bg-blue-600 hover:bg-blue-700"
                    disabled={!tipoEntidade}
                  >
                    {tipoEntidade === 'area' ? <Square className="w-3.5 h-3.5 mr-1" /> : <MapPin className="w-3.5 h-3.5 mr-1" />}
                    {tipoEntidade ? 'Iniciar Desenho' : 'Selecione o Tipo Primeiro'}
                  </Button>
                )}
                {isDrawing && tipoEntidade === 'area' && (
                  <>
                    <Button onClick={resetForm} variant="outline" size="sm" className="h-8 text-xs">
                      <X className="w-3.5 h-3.5 mr-1" />
                      Cancelar
                    </Button>
                    <Button 
                      onClick={handleFinishArea} 
                      size="sm" 
                      className={`h-8 text-xs ${currentPoints.length >= 3 ? 'bg-emerald-600 hover:bg-emerald-700 animate-pulse' : 'bg-slate-400'}`}
                      disabled={currentPoints.length < 3}
                    >
                      <Save className="w-3.5 h-3.5 mr-1" />
                      Finalizar ({currentPoints.length} pts)
                    </Button>
                  </>
                )}
                {isDrawing && tipoEntidade === 'ponto' && (
                  <Button onClick={resetForm} variant="outline" size="sm" className="h-8 text-xs">
                    <X className="w-3.5 h-3.5 mr-1" />
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
                height: '600px', 
                width: '100%',
                backgroundColor: '#e5e7eb',
                position: 'relative',
                cursor: isDrawing ? 'crosshair' : 'default'
              }}
            />
            {isDrawing && (
              <div style={{
                position: 'absolute',
                bottom: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 1000,
                backgroundColor: '#16a34a',
                color: 'white',
                padding: '16px 32px',
                borderRadius: '12px',
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                fontSize: '15px',
                fontWeight: 700,
                border: '3px solid white',
                animation: 'pulse 2s infinite'
              }}>
                {tipoEntidade === 'area' 
                  ? `🎯 CLIQUE NO MAPA PARA DESENHAR (${currentPoints.length} pontos)` 
                  : '🎯 CLIQUE NO MAPA PARA POSICIONAR'}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="bg-slate-50 border-b py-3">
            <CardTitle className="text-sm font-semibold">Configurações</CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Tipo de Entidade *</Label>
              <Select value={tipoEntidade} onValueChange={(v) => { 
                console.log('🔄 Mudando tipo para:', v);
                setTipoEntidade(v); 
                resetForm(); 
              }}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="area" className="text-xs">📐 Área / Polígono</SelectItem>
                  <SelectItem value="ponto" className="text-xs">📍 Ponto de Referência</SelectItem>
                </SelectContent>
              </Select>
              {tipoEntidade && (
                <div className="mt-1 text-[10px] text-green-600 font-semibold">
                  ✅ Selecionado: {tipoEntidade === 'area' ? 'Área' : 'Ponto'}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Escolha a Cor</Label>
              <div className="grid grid-cols-7 gap-1.5">
                {CORES_DISPONIVEIS.map(cor => (
                  <button
                    key={cor}
                    type="button"
                    onClick={() => setCorSelecionada(cor)}
                    className={`w-8 h-8 rounded transition-all ${corSelecionada === cor ? 'ring-2 ring-slate-900 ring-offset-2 scale-110' : 'hover:scale-105'}`}
                    style={{ backgroundColor: cor }}
                    title={cor}
                  />
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                <div className="w-4 h-4 rounded" style={{ backgroundColor: corSelecionada }} />
                <span>Cor selecionada: {corSelecionada}</span>
              </div>
            </div>

            <div className="pt-3 border-t">
              <div className="text-xs font-semibold text-slate-700 mb-2">📍 Áreas Cadastradas ({areas.length})</div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {areas.length === 0 ? (
                  <div className="text-xs text-slate-500 italic">Nenhuma área cadastrada</div>
                ) : (
                  areas.map(area => (
                    <div key={area.id} className="flex items-center justify-between gap-2 p-2 bg-white border rounded hover:bg-slate-50">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold truncate">{area.nome}</div>
                        <div className="text-[10px] text-slate-500">{area.tamanho_hectares} ha</div>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => {
                            setEditingItem(area);
                            setTipoEntidade('area');
                            const coords = area.coordenadas?.coords || [];
                            setCurrentPoints(coords.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng })));
                            setFormData({
                              nome: area.nome,
                              area_total: area.tamanho_hectares,
                              capacidade_maxima: area.capacidade_maxima,
                              tipo_uso: area.tipo_pastagem,
                              observacoes: area.observacoes
                            });
                            setCorSelecionada(area.coordenadas?.cor || CORES_DISPONIVEIS[3]);
                            setIsDrawing(true);
                            toast.info('Clique no mapa para redefinir a área');
                          }}
                        >
                          <Edit className="w-3 h-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-red-600"
                          onClick={() => {
                            if (window.confirm(`Remover área ${area.nome}?`)) {
                              deleteAreaMutation.mutate(area.id);
                            }
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="text-xs font-semibold text-slate-700 mb-2 mt-4">🗺️ Pontos de Referência ({pontos.length})</div>
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {pontos.length === 0 ? (
                  <div className="text-xs text-slate-500 italic">Nenhum ponto cadastrado</div>
                ) : (
                  pontos.map(ponto => (
                    <div key={ponto.id} className="flex items-center justify-between gap-2 p-2 bg-white border rounded hover:bg-slate-50">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: ponto.cor }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold truncate">{ponto.nome}</div>
                          <div className="text-[10px] text-slate-500">{ponto.tipo}</div>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => {
                            setEditingItem(ponto);
                            setTipoEntidade('ponto');
                            setCurrentMarker(ponto.coordenadas);
                            setFormData({
                              nome: ponto.nome,
                              tipo_ponto: ponto.tipo,
                              observacoes: ponto.observacoes
                            });
                            setCorSelecionada(ponto.cor || CORES_DISPONIVEIS[5]);
                            setIsDrawing(true);
                            toast.info('Clique no mapa para reposicionar o ponto');
                          }}
                        >
                          <Edit className="w-3 h-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-red-600"
                          onClick={() => {
                            if (window.confirm(`Remover ponto ${ponto.nome}?`)) {
                              deletePontoMutation.mutate(ponto.id);
                            }
                          }}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {tipoEntidade === 'area' ? 'Dados da Área' : 'Dados do Ponto de Referência'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {tipoEntidade === 'area' ? (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Nome da Área *</Label>
                  <Input
                    value={formData.nome}
                    onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                    placeholder="PIQUETE 01"
                    className="h-8 text-xs uppercase"
                    style={{ textTransform: 'uppercase' }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Área Total (ha) *</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={formData.area_total}
                    onChange={(e) => setFormData({ ...formData, area_total: e.target.value })}
                    placeholder="0.00"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Capacidade (UA)</Label>
                  <Input
                    type="number"
                    value={formData.capacidade_maxima}
                    onChange={(e) => setFormData({ ...formData, capacidade_maxima: e.target.value })}
                    placeholder="0"
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tipo de Uso</Label>
                  <Input
                    value={formData.tipo_uso}
                    onChange={(e) => setFormData({ ...formData, tipo_uso: e.target.value })}
                    placeholder="PASTAGEM, PLANTIO, ETC"
                    className="h-8 text-xs uppercase"
                    style={{ textTransform: 'uppercase' }}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <Label className="text-xs">Nome do Ponto *</Label>
                  <Input
                    value={formData.nome}
                    onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                    placeholder="COCHO 01"
                    className="h-8 text-xs uppercase"
                    style={{ textTransform: 'uppercase' }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Tipo *</Label>
                  <Select value={formData.tipo_ponto} onValueChange={(v) => setFormData({ ...formData, tipo_ponto: v })}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Selecione o tipo" />
                    </SelectTrigger>
                    <SelectContent>
                      {TIPOS_PONTOS.map(tipo => (
                        <SelectItem key={tipo} value={tipo} className="text-xs">{tipo}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="space-y-1">
              <Label className="text-xs">Observações</Label>
              <Textarea
                value={formData.observacoes}
                onChange={(e) => setFormData({ ...formData, observacoes: e.target.value })}
                placeholder="OBSERVAÇÕES..."
                className="text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
                rows={2}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={resetForm} size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button onClick={handleSave} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                Salvar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}