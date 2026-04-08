import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Upload } from "lucide-react";
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
import { ensureDeleteAllowed } from "@/lib/entityDeleteGuards";

export default function MapaCadastro() {
  const [modo, setModo] = useState("listagem");
  const [abaAtiva, setAbaAtiva] = useState("areas");
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
  const [showConfigAreas, setShowConfigAreas] = useState(false);
  const [showConfigPontos, setShowConfigPontos] = useState(false);
  const [showConfigLinhas, setShowConfigLinhas] = useState(false);

  const queryClient = useQueryClient();
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");

  const { data: areas = [], refetch: refetchAreas } = useQuery({
    queryKey: ["areas", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter((a) => a.empresa_id === empresaSelecionadaId && a.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: pontos = [], refetch: refetchPontos } = useQuery({
    queryKey: ["pontos", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.PontoReferencia.list();
      return all.filter((p) => p.empresa_id === empresaSelecionadaId && p.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: linhas = [], refetch: refetchLinhas } = useQuery({
    queryKey: ["linhas", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.LinhaGeografica.list();
      return all.filter((l) => l.empresa_id === empresaSelecionadaId && l.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const deleteAreaMutation = useMutation({
    mutationFn: async (id) => {
      await ensureDeleteAllowed(base44, "AreaPastagem", id);
      return base44.entities.AreaPastagem.update(id, { ativo: false });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "areas" });
      toast.success("Área excluída!");
      setItemExcluir(null);
    },
    onError: (error) => {
      if (String(error?.message || "").toLowerCase().includes("não é possível excluir")) return;
      toast.error("Erro ao excluir área");
    },
  });

  const deletePontoMutation = useMutation({
    mutationFn: async (id) => {
      const ponto = pontos.find((item) => item.id === id);
      const normalizar = (value = "") => String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();

      // Excluir definitivamente do banco de dados
      await base44.entities.PontoReferencia.delete(id);

      const pontosSuplementacao = await base44.entities.PontoSuplementacao.list();
      const vinculados = pontosSuplementacao.filter((item) =>
        item.empresa_id === empresaSelecionadaId &&
        item.status === "Ativo" &&
        normalizar(item.nome_ponto) === normalizar(ponto?.nome)
      );

      for (const item of vinculados) {
        await base44.entities.PontoSuplementacao.delete(item.id);
      }

      const deposito = vinculados.find((item) => normalizar(item.categoria_ponto) === "DEPOSITO");
      if (deposito) {
        const cochosRelacionados = pontosSuplementacao.filter((item) =>
          item.empresa_id === empresaSelecionadaId &&
          item.status === "Ativo" &&
          item.deposito_origem_id === deposito.id
        );

        for (const cocho of cochosRelacionados) {
          await base44.entities.PontoSuplementacao.update(cocho.id, {
            deposito_origem_id: null,
            deposito_origem_nome: null,
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && ["pontos", "pontos-suplementacao", "pontos-supl", "mapa-pontos", "mapa-pontos-supl"].includes(q.queryKey[0]) });
      toast.success("Ponto excluído!");
      setItemExcluir(null);
      window.dispatchEvent(new CustomEvent("atualizar-mapa"));
    },
    onError: (error) => {
      toast.error(error?.message || "Erro ao excluir ponto");
    },
  });

  const deleteLinhaMutation = useMutation({
    mutationFn: (id) => base44.entities.LinhaGeografica.update(id, { ativo: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === "linhas" });
      toast.success("Linha excluída!");
      setItemExcluir(null);
    },
  });

  const handleNovoItem = (tipo, gps = false) => {
    setTipoDesenho(tipo);
    setUsarGPS(gps);
    setItemEditando(null);
    setModo("mapa");
  };

  const handleEditarItem = (item, tipo) => {
    setItemEditando(item);
    setTipoDesenho(tipo);
    setModo("mapa");
  };

  const handleEditarDetalhes = (item, tipo) => {
    setItemDetalhes(item);
    if (tipo === "area") setShowEditarDetalhesArea(true);
    if (tipo === "ponto") setShowEditarDetalhesPonto(true);
    if (tipo === "linha") setShowEditarDetalhesLinha(true);
  };

  const handleExcluirItem = (item, tipo) => setItemExcluir({ item, tipo });

  const confirmarExclusao = () => {
    if (!itemExcluir) return;
    if (itemExcluir.tipo === "area") deleteAreaMutation.mutate(itemExcluir.item.id);
    if (itemExcluir.tipo === "ponto") deletePontoMutation.mutate(itemExcluir.item.id);
    if (itemExcluir.tipo === "linha") deleteLinhaMutation.mutate(itemExcluir.item.id);
  };

  const handleSalvarMapa = () => {
    setModo("listagem");
    setTipoDesenho(null);
    setUsarGPS(false);
    setItemEditando(null);
  };

  const handleCancelarMapa = () => {
    setModo("listagem");
    setTipoDesenho(null);
    setUsarGPS(false);
    setItemEditando(null);
  };

  const handleRefresh = () => {
    refetchAreas();
    refetchPontos();
    refetchLinhas();
  };

  const handleOpenConfig = () => {
    if (abaAtiva === "areas") setShowConfigAreas(true);
    if (abaAtiva === "pontos") setShowConfigPontos(true);
    if (abaAtiva === "linhas") setShowConfigLinhas(true);
  };

  if (modo === "mapa") {
    return <MapaDesenho tipoDesenho={tipoDesenho} usarGPS={usarGPS} itemEditando={itemEditando} onSalvar={handleSalvarMapa} onCancelar={handleCancelarMapa} />;
  }

  return (
    <div className="p-1 md:p-1 space-y-1">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-1 py-1 shadow-sm border-b border-slate-200">
        <div>
          <h1 className="font-bold text-slate-800">Cadastro de Áreas, Pontos e Linhas</h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="icon" onClick={handleOpenConfig} className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground h-7 w-7">
            <Settings className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={handleRefresh} className="h-7 text-xs">
            Atualizar
          </Button>
          <Button onClick={() => setShowImportarGeoJSON(true)} variant="outline" size="sm" className="h-7 text-xs">
            Importar GeoJSON
          </Button>
          {abaAtiva === "areas" && (
            <>
              <Button onClick={() => handleNovoItem('area', false)} variant="outline" size="sm" className="h-7 text-xs">Desenhar no Mapa</Button>
              <Button onClick={() => setShowSelecaoMapa(true)} variant="outline" size="sm" className="h-7 text-xs">Selecionar no Mapa</Button>
              <Button onClick={() => handleNovoItem('area', true)} size="sm" className="bg-lime-900 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow h-7 hover:bg-emerald-600">Usar GPS</Button>
            </>
          )}
          {abaAtiva === "pontos" && (
            <>
              <Button onClick={() => handleNovoItem('ponto', false)} variant="outline" size="sm" className="h-7 text-xs">Marcar no Mapa</Button>
              <Button onClick={() => handleNovoItem('ponto', true)} size="sm" className="bg-lime-900 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow h-7 hover:bg-emerald-600">Usar GPS</Button>
            </>
          )}
          {abaAtiva === "linhas" && (
            <>
              <Button onClick={() => handleNovoItem('linha', false)} variant="outline" size="sm" className="h-7 text-xs">Desenhar no Mapa</Button>
              <Button onClick={() => handleNovoItem('linha', true)} size="sm" className="bg-lime-900 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow h-7 hover:bg-emerald-600">Usar GPS</Button>
            </>
          )}
        </div>
      </div>

      <Tabs value={abaAtiva} onValueChange={setAbaAtiva} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="areas">Áreas</TabsTrigger>
          <TabsTrigger value="pontos">Pontos</TabsTrigger>
          <TabsTrigger value="linhas">Linhas</TabsTrigger>
        </TabsList>

        <TabsContent value="areas" className="space-y-4">
          <TabelaAreasGeo areas={areas} onEdit={(area) => handleEditarItem(area, 'area')} onEditDetalhes={(area) => handleEditarDetalhes(area, 'area')} onDelete={(area) => handleExcluirItem(area, 'area')} showConfigColunas={showConfigAreas} setShowConfigColunas={setShowConfigAreas} />
        </TabsContent>

        <TabsContent value="pontos" className="space-y-4">
          <TabelaPontosGeo pontos={pontos} onEdit={(ponto) => handleEditarItem(ponto, 'ponto')} onEditDetalhes={(ponto) => handleEditarDetalhes(ponto, 'ponto')} onDelete={(ponto) => handleExcluirItem(ponto, 'ponto')} showConfigColunas={showConfigPontos} setShowConfigColunas={setShowConfigPontos} />
        </TabsContent>

        <TabsContent value="linhas" className="space-y-4">
          <TabelaLinhasGeo linhas={linhas} onEdit={(linha) => handleEditarItem(linha, 'linha')} onEditDetalhes={(linha) => handleEditarDetalhes(linha, 'linha')} onDelete={(linha) => handleExcluirItem(linha, 'linha')} showConfigColunas={showConfigLinhas} setShowConfigColunas={setShowConfigLinhas} />
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

      <ImportarGeoJSON open={showImportarGeoJSON} onOpenChange={setShowImportarGeoJSON} />

      {showSelecaoMapa && <SelecaoAreasMapa onClose={() => { setShowSelecaoMapa(false); queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'areas' }); }} />}

      <Sheet open={showEditarDetalhesArea} onOpenChange={setShowEditarDetalhesArea}>
        <SheetContent side="right" className="w-[320px] sm:w-[400px] overflow-y-auto">
          <SheetHeader><SheetTitle>Editar Detalhes da Área</SheetTitle></SheetHeader>
          {itemDetalhes && <FormularioArea coordenadas={itemDetalhes.coordenadas?.coords?.map((c) => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }))} item={itemDetalhes} onSave={() => { setShowEditarDetalhesArea(false); setItemDetalhes(null); queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'areas' }); }} onCancel={() => { setShowEditarDetalhesArea(false); setItemDetalhes(null); }} />}
        </SheetContent>
      </Sheet>

      <Sheet open={showEditarDetalhesPonto} onOpenChange={setShowEditarDetalhesPonto}>
        <SheetContent side="right" className="w-[320px] sm:w-[400px] overflow-y-auto">
          <SheetHeader><SheetTitle>Editar Detalhes do Ponto</SheetTitle></SheetHeader>
          {itemDetalhes && <FormularioPonto coordenadas={itemDetalhes.coordenadas} item={itemDetalhes} onSave={() => { setShowEditarDetalhesPonto(false); setItemDetalhes(null); queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && ['pontos', 'pontos-suplementacao', 'mapa-pontos', 'mapa-pontos-supl'].includes(q.queryKey[0]) }); window.dispatchEvent(new CustomEvent('atualizar-mapa')); }} onCancel={() => { setShowEditarDetalhesPonto(false); setItemDetalhes(null); }} />}
        </SheetContent>
      </Sheet>

      <Sheet open={showEditarDetalhesLinha} onOpenChange={setShowEditarDetalhesLinha}>
        <SheetContent side="right" className="w-[320px] sm:w-[400px] overflow-y-auto">
          <SheetHeader><SheetTitle>Editar Detalhes da Linha</SheetTitle></SheetHeader>
          {itemDetalhes && <FormularioLinha coordenadas={itemDetalhes.coordenadas?.coords?.map((c) => ({ lat: c[0] || c.lat, lng: c[1] || c.lng }))} item={itemDetalhes} onSave={() => { setShowEditarDetalhesLinha(false); setItemDetalhes(null); queryClient.invalidateQueries({ predicate: (q) => Array.isArray(q.queryKey) && q.queryKey[0] === 'linhas' }); }} onCancel={() => { setShowEditarDetalhesLinha(false); setItemDetalhes(null); }} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}