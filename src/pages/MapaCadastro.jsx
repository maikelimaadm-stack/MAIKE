import React, { useState, useRef, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Map, Plus, Navigation, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import TabelaAreasGeo from "../components/mapa/TabelaAreasGeo";
import TabelaPontosGeo from "../components/mapa/TabelaPontosGeo";
import TabelaLinhasGeo from "../components/mapa/TabelaLinhasGeo";
import FormularioArea from "../components/mapa/FormularioArea";
import FormularioPonto from "../components/mapa/FormularioPonto";
import FormularioLinha from "../components/mapa/FormularioLinha";

import MapaDesenho from "../components/mapa/MapaDesenho";
import ImportarGeoJSON from "../components/mapa/ImportarGeoJSON";
import SelecaoAreasMapa from "../components/mapa/SelecaoAreasMapa";

export default function MapaCadastro() {
  const [modo, setModo] = useState('listagem');
  const [tipoDesenho, setTipoDesenho] = useState(null);
  const [usarGPS, setUsarGPS] = useState(false);
  const [itemEditando, setItemEditando] = useState(null);
  const [itemExcluir, setItemExcluir] = useState(null);
  const [showImportarGeoJSON, setShowImportarGeoJSON] = useState(false);
  const [showEditarDetalhesArea, setShowEditarDetalhesArea] = useState(false);
  const [showEditarDetalhesPonto, setShowEditarDetalhesPonto] = useState(false);
  const [showEditarDetalhesLinha, setShowEditarDetalhesLinha] = useState(false);
  const [itemDetalhes, setItemDetalhes] = useState(null);
  const [showSelecaoMapa, setShowSelecaoMapa] = useState(false);

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



  const deleteAreaMutation = useMutation({
    mutationFn: (id) => base44.entities.AreaPastagem.update(id, { ativo: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['areas'] });
      toast.success('Área excluída!');
      setItemExcluir(null);
    },
  });

  const deletePontoMutation = useMutation({
    mutationFn: (id) => base44.entities.PontoReferencia.update(id, { ativo: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pontos'] });
      toast.success('Ponto excluído!');
      setItemExcluir(null);
    },
  });

  const deleteLinhaMutation = useMutation({
    mutationFn: (id) => base44.entities.LinhaGeografica.update(id, { ativo: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linhas'] });
      toast.success('Linha excluída!');
      setItemExcluir(null);
    },
  });



  const handleNovoItem = (tipo, gps = false) => {
    setTipoDesenho(tipo);
    setUsarGPS(gps);
    setItemEditando(null);
    setModo('mapa');
  };

  const handleEditarItem = (item, tipo) => {
    setItemEditando(item);
    setTipoDesenho(tipo);
    setModo('mapa');
  };

  const handleEditarDetalhes = (item, tipo) => {
    setItemDetalhes(item);
    if (tipo === 'area') {
      setShowEditarDetalhesArea(true);
    } else if (tipo === 'ponto') {
      setShowEditarDetalhesPonto(true);
    } else if (tipo === 'linha') {
      setShowEditarDetalhesLinha(true);
    }
  };

  const handleExcluirItem = (item, tipo) => {
    setItemExcluir({ item, tipo });
  };

  const confirmarExclusao = () => {
    if (!itemExcluir) return;
    
    if (itemExcluir.tipo === 'area') {
      deleteAreaMutation.mutate(itemExcluir.item.id);
    } else if (itemExcluir.tipo === 'ponto') {
      deletePontoMutation.mutate(itemExcluir.item.id);
    } else if (itemExcluir.tipo === 'linha') {
      deleteLinhaMutation.mutate(itemExcluir.item.id);
    }
  };

  const handleSalvarMapa = () => {
    setModo('listagem');
    setTipoDesenho(null);
    setUsarGPS(false);
    setItemEditando(null);
  };

  const handleCancelarMapa = () => {
    setModo('listagem');
    setTipoDesenho(null);
    setUsarGPS(false);
    setItemEditando(null);
  };

  if (modo === 'mapa') {
    return (
      <MapaDesenho
        tipoDesenho={tipoDesenho}
        usarGPS={usarGPS}
        itemEditando={itemEditando}
        onSalvar={handleSalvarMapa}
        onCancelar={handleCancelarMapa}
      />
    );
  }

  return (
    <div className="p-6 max-w-screen-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Cadastro de Áreas, Pontos e Linhas</h1>
          <p className="text-sm text-slate-600">Gerencie elementos geográficos da fazenda</p>
        </div>
        <Button
          onClick={() => setShowImportarGeoJSON(true)}
          variant="outline"
          className="gap-2"
        >
          <Upload className="w-4 h-4" />
          Importar GeoJSON
        </Button>
      </div>

      <Tabs defaultValue="areas" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="areas">Áreas</TabsTrigger>
          <TabsTrigger value="pontos">Pontos</TabsTrigger>
          <TabsTrigger value="linhas">Linhas</TabsTrigger>
        </TabsList>

        <TabsContent value="areas" className="space-y-4">
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => handleNovoItem('area', false)}
              variant="outline"
              size="sm"
              className="h-8 text-xs border-emerald-600 text-emerald-600 hover:bg-emerald-50"
            >
              <Map className="w-3.5 h-3.5 mr-2" />
              Desenhar no Mapa
            </Button>
            <Button
              onClick={() => setShowSelecaoMapa(true)}
              variant="outline"
              size="sm"
              className="h-8 text-xs"
            >
              Selecionar no Mapa (Lote)
            </Button>
            <Button
              onClick={() => handleNovoItem('area', true)}
              size="sm"
              className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700"
            >
              <Navigation className="w-3.5 h-3.5 mr-2" />
              Usar GPS
            </Button>
          </div>
          <TabelaAreasGeo
            areas={areas}
            onEdit={(area) => handleEditarItem(area, 'area')}
            onEditDetalhes={(area) => handleEditarDetalhes(area, 'area')}
            onDelete={(area) => handleExcluirItem(area, 'area')}
          />
        </TabsContent>

        <TabsContent value="pontos" className="space-y-4">
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => handleNovoItem('ponto', false)}
              variant="outline"
              className="border-blue-600 text-blue-600 hover:bg-blue-50"
            >
              <Map className="w-4 h-4 mr-2" />
              Marcar no Mapa
            </Button>
            <Button
              onClick={() => handleNovoItem('ponto', true)}
              className="bg-blue-600 hover:bg-blue-700"
            >
              <Navigation className="w-4 h-4 mr-2" />
              Usar GPS
            </Button>
          </div>
          <TabelaPontosGeo
            pontos={pontos}
            onEdit={(ponto) => handleEditarItem(ponto, 'ponto')}
            onEditDetalhes={(ponto) => handleEditarDetalhes(ponto, 'ponto')}
            onDelete={(ponto) => handleExcluirItem(ponto, 'ponto')}
          />
        </TabsContent>

        <TabsContent value="linhas" className="space-y-4">
          <div className="flex justify-end gap-2">
            <Button
              onClick={() => handleNovoItem('linha', false)}
              variant="outline"
              className="border-orange-600 text-orange-600 hover:bg-orange-50"
            >
              <Map className="w-4 h-4 mr-2" />
              Desenhar no Mapa
            </Button>
            <Button
              onClick={() => handleNovoItem('linha', true)}
              className="bg-orange-600 hover:bg-orange-700"
            >
              <Navigation className="w-4 h-4 mr-2" />
              Usar GPS
            </Button>
          </div>
          <TabelaLinhasGeo
            linhas={linhas}
            onEdit={(linha) => handleEditarItem(linha, 'linha')}
            onEditDetalhes={(linha) => handleEditarDetalhes(linha, 'linha')}
            onDelete={(linha) => handleExcluirItem(linha, 'linha')}
          />
        </TabsContent>

      </Tabs>

      <AlertDialog open={!!itemExcluir} onOpenChange={() => setItemExcluir(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir este item? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmarExclusao} className="bg-red-600 hover:bg-red-700">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ImportarGeoJSON 
        open={showImportarGeoJSON} 
        onOpenChange={setShowImportarGeoJSON} 
      />

      {showSelecaoMapa && (
        <SelecaoAreasMapa onClose={()=>{ setShowSelecaoMapa(false); queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'areas' }); }} />
      )}

      {/* Sheet Editar Detalhes Área */}
      <Sheet open={showEditarDetalhesArea} onOpenChange={setShowEditarDetalhesArea}>
        <SheetContent side="right" className="w-[320px] sm:w-[400px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Editar Detalhes da Área</SheetTitle>
          </SheetHeader>
          {itemDetalhes && (
            <FormularioArea
              coordenadas={itemDetalhes.coordenadas?.coords?.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }))}
              item={itemDetalhes}
              onSave={() => {
                setShowEditarDetalhesArea(false);
                setItemDetalhes(null);
                queryClient.invalidateQueries({ queryKey: ['areas'] });
              }}
              onCancel={() => {
                setShowEditarDetalhesArea(false);
                setItemDetalhes(null);
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Sheet Editar Detalhes Ponto */}
      <Sheet open={showEditarDetalhesPonto} onOpenChange={setShowEditarDetalhesPonto}>
        <SheetContent side="right" className="w-[320px] sm:w-[400px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Editar Detalhes do Ponto</SheetTitle>
          </SheetHeader>
          {itemDetalhes && (
            <FormularioPonto
              coordenadas={itemDetalhes.coordenadas}
              item={itemDetalhes}
              onSave={() => {
                setShowEditarDetalhesPonto(false);
                setItemDetalhes(null);
                queryClient.invalidateQueries({ queryKey: ['pontos'] });
              }}
              onCancel={() => {
                setShowEditarDetalhesPonto(false);
                setItemDetalhes(null);
              }}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Sheet Editar Detalhes Linha */}
      <Sheet open={showEditarDetalhesLinha} onOpenChange={setShowEditarDetalhesLinha}>
        <SheetContent side="right" className="w-[320px] sm:w-[400px] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Editar Detalhes da Linha</SheetTitle>
          </SheetHeader>
          {itemDetalhes && (
            <FormularioLinha
              coordenadas={itemDetalhes.coordenadas?.coords?.map(c => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }))}
              item={itemDetalhes}
              onSave={() => {
                setShowEditarDetalhesLinha(false);
                setItemDetalhes(null);
                queryClient.invalidateQueries({ queryKey: ['linhas'] });
              }}
              onCancel={() => {
                setShowEditarDetalhesLinha(false);
                setItemDetalhes(null);
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}