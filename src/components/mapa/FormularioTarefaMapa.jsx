import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MapPin, Crosshair } from "lucide-react";
import { toast } from "sonner";

export const normalizeTaskPriority = (value) => {
  const normalized = (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

  if (["alta", "alto", "urgente", "critico", "critica", "crítico", "crítica"].includes(normalized)) return "Alta";
  if (["media", "medio", "média", "médio", "normal"].includes(normalized)) return "Média";
  return "Baixa";
};

const getAreaCenter = (area) => {
  if (!area?.coordenadas?.coords?.length) return null;
  const lats = area.coordenadas.coords.map((coord) => coord[0] || coord.lat);
  const lngs = area.coordenadas.coords.map((coord) => coord[1] || coord.lng);
  return {
    lat: lats.reduce((sum, item) => sum + item, 0) / lats.length,
    lng: lngs.reduce((sum, item) => sum + item, 0) / lngs.length,
  };
};

export default function FormularioTarefaMapa({
  tarefa,
  areaId,
  areaNome,
  loteId,
  loteNome,
  pontoSuplId,
  initialCoordinates,
  initialDraft,
  onSubmit,
  onCancel,
  onRequestSelectLocation,
}) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");

  const { data: areas = [] } = useQuery({
    queryKey: ["areas-tarefa-mapa", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.AreaPastagem.list();
      return all.filter((area) => area.empresa_id === empresaSelecionadaId && area.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const [formData, setFormData] = useState({
    titulo: "",
    descricao: "",
    tipo: "Manejo",
    prioridade: "Média",
    status: "Pendente",
    data_prevista: "",
    responsavel: "",
    area_id: areaId || "",
    area_nome: areaNome || "",
    lote_id: loteId || "",
    lote_nome: loteNome || "",
    ponto_suplementacao_id: pontoSuplId || "",
    coordenadas: initialCoordinates || null,
  });

  useEffect(() => {
    const source = tarefa || initialDraft || {};
    setFormData({
      titulo: source.titulo || "",
      descricao: source.descricao || "",
      tipo: source.tipo || "Manejo",
      prioridade: normalizeTaskPriority(source.prioridade || "Média"),
      status: source.status || "Pendente",
      data_prevista: source.data_prevista || "",
      responsavel: source.responsavel || "",
      area_id: source.area_id || areaId || "",
      area_nome: source.area_nome || areaNome || "",
      lote_id: source.lote_id || loteId || "",
      lote_nome: source.lote_nome || loteNome || "",
      ponto_suplementacao_id: source.ponto_suplementacao_id || pontoSuplId || "",
      coordenadas: source.coordenadas || initialCoordinates || null,
    });
  }, [tarefa, initialDraft, areaId, areaNome, loteId, loteNome, pontoSuplId, initialCoordinates]);

  const handleAreaChange = (selectedAreaId) => {
    const selectedArea = areas.find((area) => area.id === selectedAreaId);
    const center = getAreaCenter(selectedArea);
    setFormData((prev) => ({
      ...prev,
      area_id: selectedAreaId,
      area_nome: selectedArea?.nome || "",
      coordenadas: prev.coordenadas || center,
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.titulo.trim()) {
      toast.error("Informe o título da tarefa.");
      return;
    }

    onSubmit({
      ...formData,
      titulo: formData.titulo.trim(),
      prioridade: normalizeTaskPriority(formData.prioridade),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-1.5 lg:col-span-2">
          <Label className="text-xs">Título *</Label>
          <Input
            value={formData.titulo}
            onChange={(e) => setFormData((prev) => ({ ...prev, titulo: e.target.value }))}
            placeholder="Ex: Cerca quebrada na lateral"
            className="h-8 text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Tipo</Label>
          <Select value={formData.tipo} onValueChange={(value) => setFormData((prev) => ({ ...prev, tipo: value }))}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Manejo" className="text-xs">Manejo</SelectItem>
              <SelectItem value="Suplementação" className="text-xs">Suplementação</SelectItem>
              <SelectItem value="Manutenção" className="text-xs">Manutenção</SelectItem>
              <SelectItem value="Verificação" className="text-xs">Verificação</SelectItem>
              <SelectItem value="Sanitário" className="text-xs">Sanitário</SelectItem>
              <SelectItem value="Outro" className="text-xs">Outro</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Prioridade</Label>
          <Select value={formData.prioridade} onValueChange={(value) => setFormData((prev) => ({ ...prev, prioridade: value }))}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Baixa" className="text-xs">Baixa</SelectItem>
              <SelectItem value="Média" className="text-xs">Média</SelectItem>
              <SelectItem value="Alta" className="text-xs">Alta</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Data prevista</Label>
          <Input
            type="date"
            value={formData.data_prevista}
            onChange={(e) => setFormData((prev) => ({ ...prev, data_prevista: e.target.value }))}
            className="h-8 text-xs"
          />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Status</Label>
          <Select value={formData.status} onValueChange={(value) => setFormData((prev) => ({ ...prev, status: value }))}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="Pendente" className="text-xs">Pendente</SelectItem>
              <SelectItem value="Em Andamento" className="text-xs">Em Andamento</SelectItem>
              <SelectItem value="Concluída" className="text-xs">Concluída</SelectItem>
              <SelectItem value="Cancelada" className="text-xs">Cancelada</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 lg:col-span-2">
          <Label className="text-xs">Responsável</Label>
          <Input
            value={formData.responsavel}
            onChange={(e) => setFormData((prev) => ({ ...prev, responsavel: e.target.value }))}
            placeholder="Nome do responsável"
            className="h-8 text-xs"
          />
        </div>

        <div className="space-y-1.5 lg:col-span-2">
          <Label className="text-xs">Descrição</Label>
          <Textarea
            value={formData.descricao}
            onChange={(e) => setFormData((prev) => ({ ...prev, descricao: e.target.value }))}
            placeholder="Detalhes do problema ou da atividade"
            className="min-h-[120px] text-xs"
          />
        </div>

        {!areaId && !loteId && (
          <div className="space-y-1.5 lg:col-span-2">
            <Label className="text-xs">Área</Label>
            <Select value={formData.area_id} onValueChange={handleAreaChange}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Selecione uma área" />
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
        )}

        <div className="space-y-1.5 lg:col-span-2">
          <Label className="text-xs">Local do problema no mapa</Label>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
            {(formData.area_nome || formData.lote_nome) && (
              <div className="text-xs text-slate-600">
                <span className="font-medium">Vinculado a:</span> {formData.area_nome || formData.lote_nome}
              </div>
            )}
            {formData.coordenadas ? (
              <div className="text-xs text-slate-600 flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5" />
                {formData.coordenadas.lat.toFixed(6)}, {formData.coordenadas.lng.toFixed(6)}
              </div>
            ) : (
              <div className="text-xs text-slate-500">Nenhum local marcado ainda.</div>
            )}
            {onRequestSelectLocation && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => onRequestSelectLocation(formData)}
              >
                <Crosshair className="w-3.5 h-3.5" />
                {formData.coordenadas ? "Alterar local no mapa" : "Marcar local no mapa"}
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
          {tarefa ? "Salvar" : "Criar tarefa"}
        </Button>
      </div>
    </form>
  );
}