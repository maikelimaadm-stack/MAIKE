import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Crosshair, MapPin } from "lucide-react";
import { toast } from "sonner";
import TaskLocationPickerDialog from "./TaskLocationPickerDialog";
import useSetorAreas from "@/hooks/useSetorAreas";

export const normalizeTaskPriority = (value) => {
  const normalized = (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  if (["alta", "alto", "urgente", "critico", "critica", "crítico", "crítica"].includes(normalized)) return "Alta";
  if (["media", "medio", "média", "médio", "normal"].includes(normalized)) return "Média";
  return "Baixa";
};

const inferirTipoBase = (tipoNome = "", grupoNome = "") => {
  const texto = `${tipoNome} ${grupoNome}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (texto.includes("suplement")) return "Suplementação";
  if (texto.includes("manutenc")) return "Manutenção";
  if (texto.includes("verific")) return "Verificação";
  if (texto.includes("sanit")) return "Sanitário";
  if (texto.includes("manejo")) return "Manejo";
  return "Outro";
};

const getAreaCenter = (area) => {
  if (!area?.coordenadas?.coords?.length) return null;
  const lats = area.coordenadas.coords.map((coord) => coord[0] || coord.lat);
  const lngs = area.coordenadas.coords.map((coord) => coord[1] || coord.lng);
  return {
    lat: lats.reduce((sum, item) => sum + item, 0) / lats.length,
    lng: lngs.reduce((sum, item) => sum + item, 0) / lngs.length
  };
};

export default function FormularioTarefaMapa({ tarefa, areaId, areaNome, loteId, loteNome, pontoSuplId, initialCoordinates, initialDraft, onSubmit, onCancel, onRequestSelectLocation }) {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [setorSelecionadoId, setSetorSelecionadoId] = useState("");

  const { setores, areas, getAreasBySetor } = useSetorAreas(empresaSelecionadaId);

  const { data: tiposTarefa = [] } = useQuery({
    queryKey: ["tipos-tarefa-mapa-form"],
    queryFn: async () => {
      const all = await base44.entities.TipoTarefa.list();
      return all.filter((tipo) => tipo.ativo !== false);
    },
    initialData: []
  });

  const { data: funcionarios = [] } = useQuery({
    queryKey: ["funcionarios-tarefa-mapa-form"],
    queryFn: async () => {
      const all = await base44.entities.Fornecedor.list();
      return all.filter((item) => Array.isArray(item.tipos) && item.tipos.includes("Funcionario"));
    },
    initialData: []
  });


  const [formData, setFormData] = useState({
    id: tarefa?.id || initialDraft?.id || "",
    titulo: "",
    descricao: "",
    tipo: "Manejo",
    tipo_tarefa_id: "",
    tipo_tarefa_nome: "",
    grupo_atividade_id: "",
    grupo_atividade_nome: "",
    solicitante: "",
    data_pedido: "",
    setor_nome: "",
    prioridade: "Média",
    status: "Pendente",
    data_prevista: "",
    responsavel_id: "",
    responsavel: "",
    responsavel_geral: "",
    observacoes: "",
    area_id: areaId || "",
    area_nome: areaNome || "",
    lote_id: loteId || "",
    lote_nome: loteNome || "",
    ponto_suplementacao_id: pontoSuplId || "",
    coordenadas: initialCoordinates || null
  });

  useEffect(() => {
    const source = tarefa || initialDraft || {};
    const areaSelecionada = areas.find((item) => item.id === (source.area_id || areaId || ""));
    setFormData({
      id: source.id || "",
      titulo: source.titulo || "",
      descricao: source.descricao || "",
      tipo: source.tipo || inferirTipoBase(source.tipo_tarefa_nome, source.grupo_atividade_nome),
      tipo_tarefa_id: source.tipo_tarefa_id || "",
      tipo_tarefa_nome: source.tipo_tarefa_nome || "",
      grupo_atividade_id: source.grupo_atividade_id || "",
      grupo_atividade_nome: source.grupo_atividade_nome || "",
      solicitante: source.solicitante || source.responsavel_geral || "",
      data_pedido: source.data_pedido || "",
      setor_nome: source.setor_nome || areaSelecionada?.setor_nome || "",
      prioridade: normalizeTaskPriority(source.prioridade || "Média"),
      status: source.status || "Pendente",
      data_prevista: source.data_prevista || "",
      responsavel_id: source.responsavel_id || "",
      responsavel: source.responsavel || "",
      responsavel_geral: source.responsavel_geral || source.solicitante || "",
      observacoes: source.observacoes || "",
      area_id: source.area_id || areaId || "",
      area_nome: source.area_nome || areaNome || "",
      lote_id: source.lote_id || loteId || "",
      lote_nome: source.lote_nome || loteNome || "",
      ponto_suplementacao_id: source.ponto_suplementacao_id || pontoSuplId || "",
      coordenadas: source.coordenadas || initialCoordinates || null
    });
    setSetorSelecionadoId(areaSelecionada?.setor_id || "");
  }, [tarefa, initialDraft, areaId, areaNome, loteId, loteNome, pontoSuplId, initialCoordinates, areas]);

  useEffect(() => {
    const areaSelecionada = areas.find((item) => item.id === formData.area_id);
    if (!areaSelecionada) return;
    if (setorSelecionadoId !== areaSelecionada.setor_id) {
      setSetorSelecionadoId(areaSelecionada.setor_id || "");
    }
    if (formData.setor_nome !== areaSelecionada.setor_nome) {
      setFormData((prev) => ({ ...prev, setor_nome: areaSelecionada.setor_nome || "" }));
    }
  }, [areas, formData.area_id, formData.setor_nome, setorSelecionadoId]);

  const areasDoSetor = setorSelecionadoId ? getAreasBySetor(setorSelecionadoId) : [];

  const handleAreaChange = (selectedAreaId) => {
    const selectedArea = areas.find((area) => area.id === selectedAreaId);
    const center = getAreaCenter(selectedArea);
    setFormData((prev) => ({ ...prev, area_id: selectedAreaId, area_nome: selectedArea?.nome || "", setor_nome: selectedArea?.setor_nome || prev.setor_nome, coordenadas: center || null }));
  };

  const handleTipoTarefaChange = (selectedTipoId) => {
    const selectedTipo = tiposTarefa.find((tipo) => tipo.id === selectedTipoId);
    setFormData((prev) => ({
      ...prev,
      tipo_tarefa_id: selectedTipoId,
      tipo_tarefa_nome: selectedTipo?.nome_tipo || "",
      grupo_atividade_id: selectedTipo?.grupo_atividade_id || "",
      grupo_atividade_nome: selectedTipo?.grupo_atividade_nome || "",
      tipo: inferirTipoBase(selectedTipo?.nome_tipo, selectedTipo?.grupo_atividade_nome)
    }));
  };

  const handleResponsavelChange = (selectedResponsavelId) => {
    if (selectedResponsavelId === "__sem_responsavel__") {
      setFormData((prev) => ({ ...prev, responsavel_id: "", responsavel: "" }));
      return;
    }
    const responsavel = funcionarios.find((item) => item.id === selectedResponsavelId);
    setFormData((prev) => ({ ...prev, responsavel_id: selectedResponsavelId, responsavel: responsavel?.nome || "" }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!formData.titulo.trim()) {
      toast.error("Informe o título da tarefa.");
      return;
    }
    if (!formData.tipo_tarefa_id) {
      toast.error("Selecione o tipo de tarefa.");
      return;
    }
    onSubmit({
      ...formData,
      titulo: formData.titulo.trim(),
      prioridade: normalizeTaskPriority(formData.prioridade),
      solicitante: formData.solicitante || "",
      responsavel_geral: formData.solicitante || "",
      responsavel_id: formData.responsavel_id || "",
      responsavel: formData.responsavel || ""
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
        <div className="space-y-1.5 lg:col-span-2">
                    <Label className="text-xs">Título *</Label>
          <Input value={formData.titulo} onChange={(e) => setFormData((prev) => ({ ...prev, titulo: e.target.value }))} placeholder="Ex: Cerca quebrada na lateral" className="h-8 text-xs uppercase" />
        </div>

        <div className="space-y-1.5">
<Label className="text-xs">Tipo de tarefa *</Label>
          <Select value={formData.tipo_tarefa_id} onValueChange={handleTipoTarefaChange}>
            <SelectTrigger className="h-8 text-xs uppercase"><SelectValue placeholder="Selecione" /></SelectTrigger>
            <SelectContent>{tiposTarefa.map((tipo) => <SelectItem key={tipo.id} value={tipo.id} className="text-xs uppercase">{tipo.nome_tipo}</SelectItem>)}</SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
                    <Label className="text-xs">Grupo de atividade</Label>
                              <Input value={formData.grupo_atividade_nome} readOnly className="h-8 text-xs bg-slate-50" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Solicitante / Responsável</Label>
                    <Input value={formData.solicitante} onChange={(e) => setFormData((prev) => ({ ...prev, solicitante: e.target.value, responsavel_geral: e.target.value }))} className="h-8 text-xs uppercase" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Data do Pedido</Label>
          <Input type="date" value={formData.data_pedido} onChange={(e) => setFormData((prev) => ({ ...prev, data_pedido: e.target.value }))} className="h-8 text-xs uppercase" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Prazo</Label>
          <Input type="date" value={formData.data_prevista} onChange={(e) => setFormData((prev) => ({ ...prev, data_prevista: e.target.value }))} className="h-8 text-xs uppercase" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Fazenda/Setor</Label>
          <Select value={setorSelecionadoId || "__sem_setor__"} onValueChange={(value) => {
            const setor = setores.find((item) => item.id === value);
            setSetorSelecionadoId(value === "__sem_setor__" ? "" : value);
            setFormData((prev) => ({ ...prev, setor_nome: value === "__sem_setor__" ? "" : setor?.nome || "", area_id: areaId || loteId ? prev.area_id : "", area_nome: areaId || loteId ? prev.area_nome : "" }));
          }} disabled={Boolean(areaId || loteId)}>
            <SelectTrigger className="h-8 text-xs uppercase"><SelectValue placeholder="Selecione o setor" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__sem_setor__" className="text-xs uppercase">Sem setor</SelectItem>
              {setores.map((setor) => <SelectItem key={setor.id} value={setor.id} className="text-xs uppercase">{setor.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {!areaId && !loteId ?
        <div className="space-y-1.5">
            <Label className="text-xs">Área/Local</Label>
            <Select value={formData.area_id} onValueChange={handleAreaChange} disabled={!setorSelecionadoId}>
              <SelectTrigger className="h-8 text-xs uppercase"><SelectValue placeholder={setorSelecionadoId ? "Selecione uma área" : "Selecione o setor primeiro"} /></SelectTrigger>
              <SelectContent>{areasDoSetor.map((area) => <SelectItem key={area.id} value={area.id} className="text-xs uppercase">{area.nome}</SelectItem>)}</SelectContent>
            </Select>
          </div> :

        <div className="space-y-1.5">
            <Label className="text-xs">Área/Local</Label>
            <Input value={formData.area_nome || formData.lote_nome} readOnly className="h-8 text-xs bg-slate-50" />
          </div>
        }

        <div className="space-y-1.5 lg:col-span-2">
          <Label className="text-xs">Descrição da Tarefa</Label>
          <Textarea value={formData.descricao} onChange={(e) => setFormData((prev) => ({ ...prev, descricao: e.target.value }))} placeholder="Detalhes do problema ou da atividade" className="min-h-[120px] text-xs" />
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Responsável execução</Label>
          <Select value={formData.responsavel_id || "__sem_responsavel__"} onValueChange={handleResponsavelChange}>
            <SelectTrigger className="h-8 text-xs uppercase"><SelectValue placeholder="Selecione o responsável" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__sem_responsavel__" className="text-xs uppercase">Sem responsável</SelectItem>
              {funcionarios.map((item) => <SelectItem key={item.id} value={item.id} className="text-xs uppercase">{item.nome}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label className="text-xs">Prioridade</Label>
          <Select value={formData.prioridade} onValueChange={(value) => setFormData((prev) => ({ ...prev, prioridade: value }))}>
            <SelectTrigger className="h-8 text-xs uppercase"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Baixa" className="text-xs uppercase">Baixa</SelectItem>
              <SelectItem value="Média" className="text-xs uppercase">Média</SelectItem>
              <SelectItem value="Alta" className="text-xs uppercase">Alta</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 lg:col-span-2">
          <Label className="text-xs">Observações</Label>
          <Textarea value={formData.observacoes} onChange={(e) => setFormData((prev) => ({ ...prev, observacoes: e.target.value }))} className="min-h-[100px] text-xs" />
        </div>

        <div className="space-y-1.5 lg:col-span-2">
          <Label className="text-xs">Local do problema no mapa</Label>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
            {(formData.area_nome || formData.lote_nome) && <div className="text-xs text-slate-600"><span className="font-medium">Vinculado a:</span> {formData.area_nome || formData.lote_nome}</div>}
            {formData.coordenadas ? <div className="text-xs text-slate-600 flex items-center gap-2"><MapPin className="w-3.5 h-3.5" />{formData.coordenadas.lat.toFixed(6)}, {formData.coordenadas.lng.toFixed(6)}</div> : <div className="text-xs text-slate-500">Nenhum local marcado ainda.</div>}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                if (onRequestSelectLocation) {
                  onRequestSelectLocation(formData);
                  return;
                }
                setShowLocationPicker(true);
              }}>
              
              <Crosshair className="w-3.5 h-3.5" />
              {formData.coordenadas ? "Alterar local no mapa" : "Marcar local no mapa"}
            </Button>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t">
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs uppercase" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">{tarefa ? "Salvar" : "Criar tarefa"}</Button>
      </div>

      {!onRequestSelectLocation &&
      <TaskLocationPickerDialog
        open={showLocationPicker}
        onOpenChange={setShowLocationPicker}
        areas={areas}
        initialCoordinates={formData.coordenadas}
        onSelect={(coords, area) => {
          if (area?.setor_id) {
            setSetorSelecionadoId(area.setor_id);
          }
          setFormData((prev) => ({
            ...prev,
            coordenadas: coords,
            area_id: area?.id || prev.area_id,
            area_nome: area?.nome || prev.area_nome,
            setor_nome: area?.setor_nome || prev.setor_nome
          }));
        }} />

      }
    </form>);

}