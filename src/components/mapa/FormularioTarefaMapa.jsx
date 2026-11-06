import React, { useEffect, useMemo, useRef, useState } from "react";
import { listarTodosGrupos, listarTodosTipos, listarUsuarios, listarPermissoes } from "@/services/tarefasMapaService";
import { getCurrentUser } from "@/services/sessionService";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Crosshair, MapPin, ImagePlus, X, WifiOff } from "lucide-react";
import { toast } from "sonner";
import TaskLocationPickerDialog from "./TaskLocationPickerDialog";
import useSetorAreas from "@/hooks/useSetorAreas";
import { getPermissionDisplayName, getUserDisplayName, isExcludedSystemUser } from "@/lib/userDisplayName";
import { canAccessPage, normalizePermissionRecord } from "@/lib/permissions";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import B1Select from "@/components/cadastro/base1/B1Select";
import { LancLoteForm, LancLoteRodape, LL_CTL } from "@/components/lotes/LancamentoLoteUi";
import LancField from "@/components/cadastro/base1/LancField";

/** Campo flutuante Base1 (rótulo dentro) — D-PROD-88. */
const FL = LancField;

export const normalizeTaskPriority = (value) => {
  const normalized = (value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
  if (["alta", "alto", "urgente", "critico", "critica", "crítico", "crítica"].includes(normalized)) return "Alta";
  if (["media", "medio", "média", "médio", "normal"].includes(normalized)) return "Média";
  return "Baixa";
};

const REQUIRED_FIELDS = ["titulo", "grupo_atividade_id", "tipo_tarefa_id", "data_pedido"];

/**
 * Contas oferecidas em Responsável/Solicitante, em ordem de nome de exibição.
 * D-PROD-137 (GET-05): o servidor diz quem pode ser responsável
 * (`responsavel_elegivel`: admin real, `is_admin` ou tela de tarefas).
 * Recalcular aqui sobre a matriz alheia — que só o admin real recebe — deixava
 * a concessão `is_admin` listar só a si mesma. Sem o campo (resposta antiga ou
 * conta sem acesso total, que só recebe a própria conta), segue a regra local.
 * @param {any[]} usuariosSistema @param {any[]} permissoesUsuarios
 */
export const ordenarResponsaveisTarefa = (usuariosSistema, permissoesUsuarios) => {
  const permissoesPorEmail = new Map(
    (permissoesUsuarios || [])
      .map((registro) => normalizePermissionRecord(registro?.data || registro))
      .filter(Boolean)
      .map((permissao) => [permissao.user_email, permissao])
  );
  return (usuariosSistema || [])
    .filter((user) => {
      if (isExcludedSystemUser(user)) return false;
      if (typeof user.responsavel_elegivel === "boolean") return user.responsavel_elegivel;
      return canAccessPage(permissoesPorEmail.get(user.email), "gt-lancamentos", "gestao-tarefas");
    })
    .sort((a, b) =>
      getPermissionDisplayName(permissoesPorEmail.get(a.email), a).localeCompare(
        getPermissionDisplayName(permissoesPorEmail.get(b.email), b),
        "pt-BR",
        { sensitivity: "base" }
      )
    );
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

export default function FormularioTarefaMapa({ tarefa, areaId, areaNome, loteId, loteNome, pontoSuplId, initialCoordinates, initialDraft, onSubmit, onCancel, onRequestSelectLocation, externalSubmitting = false }) {
  const empresaSelecionadaId = useEmpresaSelecionadaId();
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [setorSelecionadoId, setSetorSelecionadoId] = useState("");

  const { setores, areas, getAreasBySetor } = useSetorAreas(empresaSelecionadaId);

  const { data: gruposAtividade = [] } = useQuery({
    queryKey: ["grupos-atividade-mapa-form"],
    queryFn: async () => {
      const all = await listarTodosGrupos();
      return all.filter((grupo) => grupo.ativo !== false);
    },
    initialData: []
  });

  const { data: tiposTarefa = [] } = useQuery({
    queryKey: ["tipos-tarefa-mapa-form"],
    queryFn: async () => {
      const all = await listarTodosTipos();
      return all.filter((tipo) => tipo.ativo !== false);
    },
    initialData: []
  });

  const { data: usuariosSistema = [] } = useQuery({
    queryKey: ["usuarios-tarefa-mapa-form"],
    queryFn: () => listarUsuarios({ order: "nome", limit: 200 }),
    initialData: []
  });

  const { data: usuarioAtual = null } = useQuery({
    queryKey: ["usuario-atual-tarefa-mapa-form"],
    queryFn: () => getCurrentUser(),
    initialData: null
  });

  const { data: permissoesUsuarios = [] } = useQuery({
    queryKey: ["permissoes-usuarios-tarefa-mapa-form"],
    queryFn: () => listarPermissoes(),
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

  const [pendingImageFiles, setPendingImageFiles] = useState([]); // File[] aguardando upload
  const [previewUrls, setPreviewUrls] = useState([]); // URLs de preview local
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);

  const handleImageSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setPendingImageFiles((prev) => [...prev, ...files]);
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviewUrls((prev) => [...prev, ...urls]);
    e.target.value = '';
  };

  const removeNewImage = (index) => {
    URL.revokeObjectURL(previewUrls[index]);
    setPendingImageFiles((prev) => prev.filter((_, i) => i !== index));
    setPreviewUrls((prev) => prev.filter((_, i) => i !== index));
  };

  const removeSavedImage = (url) => {
    setFormData((prev) => ({ ...prev, fotos: (prev.fotos || []).filter((f) => f !== url) }));
  };

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
      coordenadas: source.coordenadas || initialCoordinates || null,
      fotos: source.fotos || []
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

  const usuariosOrdenados = useMemo(
    () => ordenarResponsaveisTarefa(usuariosSistema, permissoesUsuarios),
    [usuariosSistema, permissoesUsuarios]
  );

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
    if (isSubmitting) return;
    if (!validateForm()) return;

    setIsSubmitting(true);
    try {
      onSubmit({
        ...formData,
        titulo: formData.titulo.trim(),
        prioridade: normalizeTaskPriority(formData.prioridade),
        solicitante: formData.solicitante || "",
        responsavel_geral: formData.solicitante || "",
        responsavel_id: formData.responsavel_id || "",
        responsavel: formData.responsavel || ""
      }, pendingImageFiles);
    } finally {
      // Resetar após 2s para evitar que o botão fique bloqueado se o parent não fechar o form
      setTimeout(() => setIsSubmitting(false), 2000);
    }
  };

  return (
    <LancLoteForm onSubmit={handleSubmit} className="overflow-x-hidden" style={{ touchAction: 'pan-y pinch-zoom' }}>
            <FL label="Título da tarefa" required error={errors.titulo} dataField="titulo">
              <Input value={formData.titulo} onChange={(e) => { setErrors((prev) => ({ ...prev, titulo: false })); setFormData((prev) => ({ ...prev, titulo: e.target.value })); }} placeholder="EX: CERCA QUEBRADA NA DIVISA" className="h-7 text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} />
            </FL>

      <div className="mk-ll__grade mk-ll__grade--4">
        <FL label="Fazenda">
          <B1Select value={setorSelecionadoId || ""} onChange={(e) => { const value = e.target.value; const setor = setores.find((item) => item.id === value); setSetorSelecionadoId(value); setFormData((prev) => ({ ...prev, setor_nome: setor?.nome || "", area_id: areaId || loteId ? prev.area_id : "", area_nome: areaId || loteId ? prev.area_nome : "" })); }} disabled={Boolean(areaId || loteId)} className={LL_CTL}>
              {setores.map((setor) => <option key={setor.id} value={setor.id}>{(setor.nome || "").toUpperCase()}</option>)}
          </B1Select>
        </FL>

        {!areaId && !loteId ?
          <FL label="Local / pasto">
            <B1Select value={formData.area_id ?? ""} onChange={(e) => handleAreaChange(e.target.value)} disabled={!setorSelecionadoId} className={LL_CTL}>{areasDoSetor.map((area) => <option key={area.id} value={area.id}>{(area.nome || "").toUpperCase()}</option>)}
            </B1Select>
          </FL> :
          <FL label="Local / pasto">
            <Input value={(formData.area_nome || formData.lote_nome || "").toUpperCase()} readOnly className="h-7 text-xs bg-slate-50 uppercase border-0 shadow-none focus-visible:ring-0" />
          </FL>
        }

        <FL label="Grupo de atividade" required error={errors.grupo_atividade_id} dataField="grupo_atividade_id">
          <B1Select value={formData.grupo_atividade_id ?? ""} onChange={(e) => handleGrupoAtividadeChange(e.target.value)} className={LL_CTL}>{gruposAtividade.map((grupo) => <option key={grupo.id} value={grupo.id}>{(grupo.nome_grupo || "").toUpperCase()}</option>)}
          </B1Select>
        </FL>

        <FL label="Tipo de tarefa" required error={errors.tipo_tarefa_id} dataField="tipo_tarefa_id">
          <B1Select value={formData.tipo_tarefa_id ?? ""} onChange={(e) => handleTipoTarefaChange(e.target.value)} disabled={!formData.grupo_atividade_id} className={LL_CTL}>{tiposTarefaFiltrados.map((tipo) => <option key={tipo.id} value={tipo.id}>{(tipo.nome_tipo || "").toUpperCase()}</option>)}
          </B1Select>
        </FL>

        <FL label="Responsável" dataField="responsavel_id">
          <B1Select value={formData.responsavel_id ?? ""} onChange={(e) => handleResponsavelChange(e.target.value)} className={LL_CTL}>{usuariosOrdenados.map((item) => { const permissao = permissoesUsuarios.find((registro) => (registro.user_email || registro.data?.user_email) === item.email); return <option key={item.id} value={item.id}>{getPermissionDisplayName(permissao?.data || permissao, item).toUpperCase()}</option>; })}
          </B1Select>
        </FL>

        <FL label="Solicitante" dataField="solicitante">
          <B1Select value={formData.solicitante ?? ""} onChange={(e) => handleSolicitanteChange(e.target.value)} className={LL_CTL}>{usuariosOrdenados.map((item) => { const permissao = permissoesUsuarios.find((registro) => (registro.user_email || registro.data?.user_email) === item.email); const nome = getPermissionDisplayName(permissao?.data || permissao, item); return <option key={item.id} value={nome}>{nome.toUpperCase()}</option>; })}
          </B1Select>
        </FL>

        <FL label="Prioridade">
          <B1Select value={formData.prioridade ?? ""} onChange={(e) => { const value = e.target.value; setFormData((prev) => ({ ...prev, prioridade: value })); }} className={LL_CTL}>
              <option value="Baixa">BAIXA</option>
              <option value="Média">MÉDIA</option>
              <option value="Alta">ALTA</option>
          </B1Select>
        </FL>

        <FL label="Status">
          <B1Select value={formData.status ?? ""} onChange={(e) => { const value = e.target.value; setErrors((prev) => ({ ...prev, data_conclusao: false })); setFormData((prev) => ({ ...prev, status: value })); }} className={LL_CTL}>
              <option value="Pendente">PENDENTE</option>
              <option value="Em Andamento">EM ANDAMENTO</option>
              <option value="Concluída">CONCLUÍDA</option>
              <option value="Cancelada">CANCELADA</option>
          </B1Select>
        </FL>
        </div>

        <div className="mk-ll__grade mk-ll__grade--3">
          <FL label="Data do pedido" required error={errors.data_pedido} dataField="data_pedido">
            <Input type="date" value={formData.data_pedido} onChange={(e) => { setErrors((prev) => ({ ...prev, data_pedido: false })); setFormData((prev) => ({ ...prev, data_pedido: e.target.value })); }} className={LL_CTL} />
          </FL>
          <FL label="Prazo previsto">
            <Input type="date" value={formData.data_prevista} onChange={(e) => setFormData((prev) => ({ ...prev, data_prevista: e.target.value }))} className={LL_CTL} />
          </FL>
          <FL label={`Data de conclusão${formData.status === "Concluída" ? "" : ""}`} required={formData.status === "Concluída"} error={errors.data_conclusao} dataField="data_conclusao">
            <Input type="date" value={formData.data_conclusao} onChange={(e) => { setErrors((prev) => ({ ...prev, data_conclusao: false })); setFormData((prev) => ({ ...prev, data_conclusao: e.target.value })); }} className={LL_CTL} />
          </FL>
        </div>

        <div className="mk-ll__grade">
          <FL label="Descrição da tarefa">
            <Textarea value={formData.descricao} onChange={(e) => setFormData((prev) => ({ ...prev, descricao: e.target.value }))} placeholder="DESCREVA O QUE PRECISA SER FEITO" className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} rows={2} />
          </FL>
          <FL label="Observações internas">
            <Textarea value={formData.observacoes} onChange={(e) => setFormData((prev) => ({ ...prev, observacoes: e.target.value }))} placeholder="OBSERVAÇÕES GERAIS..." className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} rows={2} />
          </FL>
        </div>

        <section className="mk-ll__item">
          <header className="mk-ll__item-head"><div className="mk-ll__item-titulo">Local da tarefa no mapa</div></header>
          <div className="space-y-2">
            {(formData.area_nome || formData.lote_nome) && <div className="text-xs text-slate-600"><span className="font-medium">VINCULADO A:</span> {formData.area_nome || formData.lote_nome}</div>}
            {formData.coordenadas ? <div className="text-xs text-slate-600 flex items-center gap-2"><MapPin className="w-3.5 h-3.5" />{formData.coordenadas.lat.toFixed(6)}, {formData.coordenadas.lng.toFixed(6)}</div> : <div className="text-xs text-slate-500">MARQUE O PONTO EXATO NO MAPA PARA FACILITAR A EXECUÇÃO.</div>}
            <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={() => { if (onRequestSelectLocation) { onRequestSelectLocation(formData); return; } setShowLocationPicker(true); }}>
              <Crosshair className="w-3.5 h-3.5" />
              {formData.coordenadas ? "Alterar ponto no mapa" : "Marcar ponto no mapa"}
            </Button>
          </div>
        </section>

        {/* Seção de fotos */}
        <section className="mk-ll__item">
          <div className="mk-ll__item-head justify-between">
            <div className="mk-ll__item-titulo">Fotos da tarefa</div>
            {isOffline && <span className="flex items-center gap-1 text-[10px] text-amber-600"><WifiOff className="w-3 h-3" />Offline — fotos salvas localmente</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Fotos já salvas */}
            {(formData.fotos || []).map((url, idx) => (
              <div key={`saved-${idx}`} className="relative w-16 h-16 rounded-md overflow-hidden border border-slate-300 group">
                <img src={url} alt="" className="w-full h-full object-cover" />
                <button type="button" onClick={() => removeSavedImage(url)} className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
            {/* Novos previews */}
            {previewUrls.map((url, idx) => (
              <div key={`new-${idx}`} className="relative w-16 h-16 rounded-md overflow-hidden border-2 border-emerald-400 group">
                <img src={url} alt="" className="w-full h-full object-cover" />
                <button type="button" onClick={() => removeNewImage(idx)} className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full w-4 h-4 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <X className="w-2.5 h-2.5" />
                </button>
                <div className="absolute bottom-0 left-0 right-0 bg-emerald-500/80 text-white text-[8px] text-center leading-tight py-0.5">NOVA</div>
              </div>
            ))}
            {/* Botão adicionar */}
            <label className="w-16 h-16 rounded-md border-2 border-dashed border-slate-300 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50 transition-colors">
              <ImagePlus className="w-5 h-5 text-slate-400" />
              <span className="text-[9px] text-slate-400 mt-0.5">Adicionar</span>
              <input type="file" accept="image/*" multiple className="hidden" onChange={handleImageSelect} />
            </label>
          </div>
          {pendingImageFiles.length > 0 && (
            <p className="text-[10px] text-emerald-700 pl-1">{pendingImageFiles.length} foto(s) nova(s) {isOffline ? '— serão enviadas ao sincronizar' : '— serão enviadas ao salvar'}</p>
          )}
        </section>

        <LancLoteRodape onCancelar={onCancel} cancelarDesabilitado={isSubmitting || externalSubmitting} textoAcao={tarefa ? "Atualizar" : "Salvar"} textoEnviando="Salvando..." enviando={isSubmitting || externalSubmitting} />

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
    </LancLoteForm>);

}