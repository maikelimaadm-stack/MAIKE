import React, { useEffect, useMemo, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Crosshair, MapPin } from "lucide-react";
import { toast } from "sonner";
import TaskLocationPickerDialog from "./TaskLocationPickerDialog";
import useSetorAreas from "@/hooks/useSetorAreas";
import { getPermissionDisplayName, getUserDisplayName, isExcludedSystemUser } from "@/lib/userDisplayName";
import { canAccessPage, normalizePermissionRecord } from "@/lib/permissions";

export const normalizeTaskPriority = (value) => {
  const normalized = (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  if (["alta", "alto", "urgente", "critico", "critica", "crítico", "crítica"].includes(normalized)) return "Alta";
  if (["media", "medio", "média", "médio", "normal"].includes(normalized)) return "Média";
  return "Baixa";
};

const REQUIRED_FIELDS = ["titulo", "grupo_atividade_id", "tipo_tarefa_id", "data_pedido"];

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

  const { data: gruposAtividade = [] } = useQuery({
    queryKey: ["grupos-atividade-mapa-form"],
    queryFn: async () => {
      const all = await base44.entities.GrupoAtividade.list();
      return all.filter((grupo) => grupo.ativo !== false);
    },
    initialData: []
  });

  const { data: tiposTarefa = [] } = useQuery({
    queryKey: ["tipos-tarefa-mapa-form"],
    queryFn: async () => {
      const all = await base44.entities.TipoTarefa.list();
      return all.filter((tipo) => tipo.ativo !== false);
    },
    initialData: []
  });

  const { data: usuariosSistema = [] } = useQuery({
    queryKey: ["usuarios-tarefa-mapa-form"],
    queryFn: () => base44.entities.User.list("nome", 200),
    initialData: []
  });

  const { data: usuarioAtual = null } = useQuery({
    queryKey: ["usuario-atual-tarefa-mapa-form"],
    queryFn: () => base44.auth.me(),
    initialData: null
  });

  const { data: permissoesUsuarios = [] } = useQuery({
    queryKey: ["permissoes-usuarios-tarefa-mapa-form"],
    queryFn: () => base44.entities.Permissao.list(),
    initialData: []
  });

  const nomeUsuarioAtual = useMemo(() => getUserDisplayName(usuarioAtual), [usuarioAtual]);

  // Fill solicitante from current user when empty (lazy, after user loads)
  useEffect(() => {
    if (!nomeUsuarioAtual) return;
    setFormData((prev) => {
      if (prev.solicitante) return prev;
      return { ...prev, solicitante: nomeUsuarioAtual, responsavel_geral: prev.responsavel_geral || nomeUsuarioAtual };
    });
  }, [nomeUsuarioAtual]);

  const [formData, setFormData] = useState(() => {
    const source = tarefa?.data ? { ...tarefa.data, id: tarefa.id } : initialDraft?.data ? { ...initialDraft.data, id: initialDraft.id } : tarefa || initialDraft || {};
    return {
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
      data_prevista: source.data_prevista || "",
      data_conclusao: source.data_conclusao || "",
      setor_nome: source.setor_nome || "",
      prioridade: normalizeTaskPriority(source.prioridade || "M\u00e9dia"),
      status: source.status || "Pendente",
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
    };
  });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    const areaSelecionada = formData.area_id ? areas.find((item) => item.id === formData.area_id) : null;
    const areaPorNome = !areaSelecionada && formData.area_nome ? areas.find((item) => item.nome === formData.area_nome) : null;
    const areaResolvida = areaSelecionada || areaPorNome;

    if (areaResolvida) {
      if (setorSelecionadoId !== (areaResolvida.setor_id || "")) {
        setSetorSelecionadoId(areaResolvida.setor_id || "");
      }

      if (
        formData.area_id !== (areaResolvida.id || "") ||
        formData.area_nome !== (areaResolvida.nome || "") ||
        formData.setor_nome !== (areaResolvida.setor_nome || "")
      ) {
        setFormData((prev) => ({
          ...prev,
          area_id: areaResolvida.id || prev.area_id,
          area_nome: areaResolvida.nome || prev.area_nome,
          setor_nome: areaResolvida.setor_nome || prev.setor_nome
        }));
      }
      return;
    }

    if (!formData.area_id && formData.setor_nome && setores.length && !setorSelecionadoId) {
      const setor = setores.find((item) => item.nome === formData.setor_nome);
      if (setor?.id) {
        setSetorSelecionadoId(setor.id);
      }
    }
  }, [formData.area_id, formData.area_nome, formData.setor_nome, areas, setores, setorSelecionadoId]);

  const areasDoSetor = setorSelecionadoId ? getAreasBySetor(setorSelecionadoId) : [];
  const tiposTarefaFiltrados = formData.grupo_atividade_id ?
  tiposTarefa.filter((tipo) => tipo.grupo_atividade_id === formData.grupo_atividade_id) :
  [];

  useEffect(() => {
    if (!formData.tipo_tarefa_id && formData.tipo_tarefa_nome && tiposTarefa.length) {
      const tipoEncontrado = tiposTarefa.find((tipo) => tipo.nome_tipo === formData.tipo_tarefa_nome);
      if (tipoEncontrado) {
        setFormData((prev) => ({
          ...prev,
          tipo_tarefa_id: tipoEncontrado.id,
          grupo_atividade_id: prev.grupo_atividade_id || tipoEncontrado.grupo_atividade_id || "",
          grupo_atividade_nome: prev.grupo_atividade_nome || tipoEncontrado.grupo_atividade_nome || ""
        }));
      }
    }
  }, [formData.tipo_tarefa_id, formData.tipo_tarefa_nome, tiposTarefa]);

  const usuariosOrdenados = useMemo(() => {
    const permissoesNormalizadas = permissoesUsuarios.
    map((registro) => normalizePermissionRecord(registro?.data || registro)).
    filter(Boolean);

    const permissoesPorEmail = new Map(
      permissoesNormalizadas.map((permissao) => [permissao.user_email, permissao])
    );

    return usuariosSistema.
    filter((user) => {
      if (isExcludedSystemUser(user)) return false;
      const permissao = permissoesPorEmail.get(user.email);
      return canAccessPage(permissao, "gt-lancamentos", "gestao-tarefas");
    }).
    sort((a, b) => {
      const permissaoA = permissoesPorEmail.get(a.email);
      const permissaoB = permissoesPorEmail.get(b.email);
      return getPermissionDisplayName(permissaoA, a).localeCompare(getPermissionDisplayName(permissaoB, b), "pt-BR", { sensitivity: "base" });
    });
  }, [usuariosSistema, permissoesUsuarios]);

  const getFieldClassName = (field, baseClass) => {
    return `${baseClass} ${errors[field] ? "border-red-500 bg-red-50 focus-visible:ring-red-500" : ""}`.trim();
  };

  const validateForm = () => {
    const nextErrors = {};

    REQUIRED_FIELDS.forEach((field) => {
      if (!String(formData?.[field] || "").trim()) {
        nextErrors[field] = true;
      }
    });

    if (formData.status === "Concluída" && !String(formData.data_conclusao || "").trim()) {
      nextErrors.data_conclusao = true;
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length === 0) return true;

    toast.error("PREENCHA OS CAMPOS OBRIGATÓRIOS.");
    const firstField = Object.keys(nextErrors)[0];
    const element = document.querySelector(`[data-field="${firstField}"]`);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    const focusable = element?.querySelector("input, textarea, button, [role='combobox']");
    focusable?.focus?.();
    return false;
  };

  const handleAreaChange = (selectedAreaId) => {
    const selectedArea = areas.find((area) => area.id === selectedAreaId);
    const center = getAreaCenter(selectedArea);
    setFormData((prev) => ({ ...prev, area_id: selectedAreaId, area_nome: selectedArea?.nome || "", setor_nome: selectedArea?.setor_nome || prev.setor_nome, coordenadas: center || null }));
  };

  const handleGrupoAtividadeChange = (selectedGrupoId) => {
    const grupoSelecionado = gruposAtividade.find((grupo) => grupo.id === selectedGrupoId);
    setErrors((prev) => ({ ...prev, grupo_atividade_id: false, tipo_tarefa_id: false }));
    setFormData((prev) => ({
      ...prev,
      grupo_atividade_id: selectedGrupoId,
      grupo_atividade_nome: grupoSelecionado?.nome_grupo || "",
      tipo_tarefa_id: "",
      tipo_tarefa_nome: "",
      tipo: inferirTipoBase("", grupoSelecionado?.nome_grupo || "")
    }));
  };

  const handleTipoTarefaChange = (selectedTipoId) => {
    const selectedTipo = tiposTarefaFiltrados.find((tipo) => tipo.id === selectedTipoId);
    setErrors((prev) => ({ ...prev, tipo_tarefa_id: false }));
    setFormData((prev) => ({
      ...prev,
      tipo_tarefa_id: selectedTipoId,
      tipo_tarefa_nome: selectedTipo?.nome_tipo || "",
      tipo: inferirTipoBase(selectedTipo?.nome_tipo, prev.grupo_atividade_nome || selectedTipo?.grupo_atividade_nome)
    }));
  };

  const handleSolicitanteChange = (selectedSolicitante) => {
    setErrors((prev) => ({ ...prev, solicitante: false }));
    setFormData((prev) => ({ ...prev, solicitante: selectedSolicitante, responsavel_geral: selectedSolicitante }));
  };

  const handleResponsavelChange = (selectedResponsavelId) => {
    const responsavel = usuariosOrdenados.find((item) => item.id === selectedResponsavelId);
    const permissao = permissoesUsuarios.find((item) => (item.user_email || item.data?.user_email) === responsavel?.email);
    setErrors((prev) => ({ ...prev, responsavel_id: false }));
    setFormData((prev) => ({ ...prev, responsavel_id: selectedResponsavelId, responsavel: getPermissionDisplayName(permissao?.data || permissao, responsavel) }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validateForm()) return;

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
    <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
    <form onSubmit={handleSubmit} className="overflow-x-hidden" style={{ overscrollBehavior: 'none', touchAction: 'pan-y pinch-zoom' }}>
      <Card className="shadow-sm border-slate-300">
        <CardHeader className="flex flex-col space-y-1.5 p-6 bg-slate-50 border-b py-1 px-1">
          <CardTitle className="text-sm font-semibold text-slate-700">
            {tarefa ? "Editar Tarefa" : "Lançar Nova Tarefa"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-1">
          <div className="space-y-1">
            <div className="space-y-1">
              <Label className="text-xs">Título da tarefa *</Label>
              <Input
                data-field="titulo"
                value={formData.titulo}
                onChange={(e) => {
                  setErrors((prev) => ({ ...prev, titulo: false }));
                  setFormData((prev) => ({ ...prev, titulo: e.target.value }));
                }}
                placeholder="EX: CERCA QUEBRADA NA DIVISA"
                className={getFieldClassName("titulo", "h-7 text-xs uppercase")}
                style={{ textTransform: "uppercase" }}
              />
            </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-1">
        <div className="space-y-1">
          <Label className="text-xs">Fazenda</Label>
          <Select value={setorSelecionadoId || "__sem_setor__"} onValueChange={(value) => {
              const setor = setores.find((item) => item.id === value);
              setSetorSelecionadoId(value === "__sem_setor__" ? "" : value);
              setFormData((prev) => ({ ...prev, setor_nome: value === "__sem_setor__" ? "" : setor?.nome || "", area_id: areaId || loteId ? prev.area_id : "", area_nome: areaId || loteId ? prev.area_nome : "" }));
            }} disabled={Boolean(areaId || loteId)}>
            <SelectTrigger className="flex w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 h-7 text-xs"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__sem_setor__" className="text-xs">SELECIONE</SelectItem>
              {setores.map((setor) => <SelectItem key={setor.id} value={setor.id} className="text-xs">{(setor.nome || "").toUpperCase()}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {!areaId && !loteId ?
          <div className="space-y-1">
            <Label className="text-xs">Local / pasto</Label>
            <Select value={formData.area_id} onValueChange={handleAreaChange} disabled={!setorSelecionadoId}>
              <SelectTrigger className="flex w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 h-7 text-xs"><SelectValue placeholder={setorSelecionadoId ? "SELECIONE" : "SELECIONE A FAZENDA PRIMEIRO"} /></SelectTrigger>
              <SelectContent>{areasDoSetor.map((area) => <SelectItem key={area.id} value={area.id} className="text-xs">{(area.nome || "").toUpperCase()}</SelectItem>)}</SelectContent>
            </Select>
          </div> :

          <div className="space-y-1">
            <Label className="text-xs">Local / pasto</Label>
            <Input value={(formData.area_nome || formData.lote_nome || "").toUpperCase()} readOnly className="h-7 text-xs bg-slate-50 uppercase" />
          </div>
          }

        <div className="space-y-1">
          <Label className="text-xs">Grupo de atividade *</Label>
          <div data-field="grupo_atividade_id">
            <Select value={formData.grupo_atividade_id} onValueChange={handleGrupoAtividadeChange}>
              <SelectTrigger className="flex w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 h-7 text-xs">
                <SelectValue placeholder="SELECIONE" />
              </SelectTrigger>
              <SelectContent>
                {gruposAtividade.map((grupo) =>
                  <SelectItem key={grupo.id} value={grupo.id} className="text-xs">{(grupo.nome_grupo || "").toUpperCase()}</SelectItem>
                  )}
              </SelectContent>
            </Select>
          </div>
        </div>

        

        <div className="space-y-1">
          <Label className="text-xs">Tipo de tarefa *</Label>
          <div data-field="tipo_tarefa_id">
            <Select value={formData.tipo_tarefa_id} onValueChange={handleTipoTarefaChange} disabled={!formData.grupo_atividade_id}>
              <SelectTrigger className="flex w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 h-7 text-xs">
                <SelectValue placeholder={formData.grupo_atividade_id ? "SELECIONE" : "SELECIONE O GRUPO PRIMEIRO"} />
              </SelectTrigger>
              <SelectContent>
                {tiposTarefaFiltrados.map((tipo) =>
                  <SelectItem key={tipo.id} value={tipo.id} className="text-xs">{(tipo.nome_tipo || "").toUpperCase()}</SelectItem>
                  )}
              </SelectContent>
            </Select>
          </div>
        </div>


        <div className="space-y-1">
          <Label className="text-xs">Responsável</Label>
          <div data-field="responsavel_id">
            <Select value={formData.responsavel_id} onValueChange={handleResponsavelChange}>
              <SelectTrigger className="flex w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 h-7 text-xs"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
              <SelectContent>
                {usuariosOrdenados.map((item) => {
                    const permissao = permissoesUsuarios.find((registro) => (registro.user_email || registro.data?.user_email) === item.email);
                    return <SelectItem key={item.id} value={item.id} className="text-xs">{getPermissionDisplayName(permissao?.data || permissao, item).toUpperCase()}</SelectItem>;
                  })}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Solicitante</Label>
          <div data-field="solicitante">
            <Select value={formData.solicitante} onValueChange={handleSolicitanteChange}>
              <SelectTrigger className="flex w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 h-7 text-xs"><SelectValue placeholder="SELECIONE" /></SelectTrigger>
              <SelectContent>
                {usuariosOrdenados.map((item) => {
                    const permissao = permissoesUsuarios.find((registro) => (registro.user_email || registro.data?.user_email) === item.email);
                    const nome = getPermissionDisplayName(permissao?.data || permissao, item);
                    return <SelectItem key={item.id} value={nome} className="text-xs">{nome.toUpperCase()}</SelectItem>;
                  })}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Prioridade</Label>
          <Select value={formData.prioridade} onValueChange={(value) => setFormData((prev) => ({ ...prev, prioridade: value }))}>
            <SelectTrigger className="flex w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Baixa" className="text-xs">BAIXA</SelectItem>
              <SelectItem value="Média" className="text-xs">MÉDIA</SelectItem>
              <SelectItem value="Alta" className="text-xs">ALTA</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select value={formData.status} onValueChange={(value) => {
              setErrors((prev) => ({ ...prev, data_conclusao: false }));
              setFormData((prev) => ({ ...prev, status: value }));
            }}>
            <SelectTrigger className="flex w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1 h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="Pendente" className="text-xs">PENDENTE</SelectItem>
              <SelectItem value="Em Andamento" className="text-xs">EM ANDAMENTO</SelectItem>
              <SelectItem value="Concluída" className="text-xs">CONCLUÍDA</SelectItem>
              <SelectItem value="Cancelada" className="text-xs">CANCELADA</SelectItem>
            </SelectContent>
          </Select>
        </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-1 pt-1 border-t">
          <div className="space-y-1">
            <Label className="text-xs">Data do pedido *</Label>
            <div data-field="data_pedido">
              <Input type="date" value={formData.data_pedido} onChange={(e) => {
                  setErrors((prev) => ({ ...prev, data_pedido: false }));
                  setFormData((prev) => ({ ...prev, data_pedido: e.target.value }));
                }} className="flex w-full rounded-md border border-input bg-transparent px-3 py-1 shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm h-7 text-xs" />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Prazo previsto</Label>
            <Input
              type="date"
              value={formData.data_prevista}
              onChange={(e) => setFormData((prev) => ({ ...prev, data_prevista: e.target.value }))}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-1 shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm h-7 text-xs"
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Data de conclusão {formData.status === "Concluída" ? "*" : ""}</Label>
            <div data-field="data_conclusao">
              <Input type="date" value={formData.data_conclusao} onChange={(e) => {
                  setErrors((prev) => ({ ...prev, data_conclusao: false }));
                  setFormData((prev) => ({ ...prev, data_conclusao: e.target.value }));
                }} className="flex w-full rounded-md border border-input bg-transparent px-3 py-1 shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm h-7 text-xs" />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-1">
          <div className="space-y-1">
            <Label className="text-xs">Descrição da tarefa</Label>
            <Textarea value={formData.descricao} onChange={(e) => setFormData((prev) => ({ ...prev, descricao: e.target.value }))} placeholder="DESCREVA O QUE PRECISA SER FEITO" className="text-xs uppercase" style={{ textTransform: "uppercase" }} rows={2} />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Observações internas</Label>
            <Textarea value={formData.observacoes} onChange={(e) => setFormData((prev) => ({ ...prev, observacoes: e.target.value }))} placeholder="OBSERVAÇÕES GERAIS..." className="text-xs uppercase" style={{ textTransform: "uppercase" }} rows={2} />
          </div>
        </div>

        <div className="space-y-1 lg:col-span-2">
          <Label className="text-xs">Local da tarefa no mapa</Label>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
            {(formData.area_nome || formData.lote_nome) && <div className="text-xs text-slate-600"><span className="font-medium">VINCULADO A:</span> {formData.area_nome || formData.lote_nome}</div>}
            {formData.coordenadas ? <div className="text-xs text-slate-600 flex items-center gap-2"><MapPin className="w-3.5 h-3.5" />{formData.coordenadas.lat.toFixed(6)}, {formData.coordenadas.lng.toFixed(6)}</div> : <div className="text-xs text-slate-500">MARQUE O PONTO EXATO NO MAPA PARA FACILITAR A EXECUÇÃO.</div>}
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
              {formData.coordenadas ? "Alterar ponto no mapa" : "Marcar ponto no mapa"}
            </Button>
          </div>
        </div>

        <div className="flex flex-col-reverse lg:flex-row justify-end gap-1 pt-1 border-t">
          <Button type="button" variant="outline" onClick={onCancel} size="sm" className="inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground rounded-md px-3 h-7 text-xs">
            Cancelar
          </Button>
          <Button type="submit" size="sm" className="bg-lime-900 text-primary-foreground px-3 text-xs font-medium rounded-md inline-flex items-center justify-center gap-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 shadow h-7 hover:bg-emerald-500">
            {tarefa ? "Atualizar" : "Salvar"}
          </Button>
        </div>
      </div>
        </CardContent>
      </Card>

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
    </form>
    </motion.div>);

}