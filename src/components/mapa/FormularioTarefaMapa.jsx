import React, { useEffect, useMemo, useRef, useState } from "react";
import { listarTodosTipos, listarUsuarios, listarPermissoes } from "@/services/tarefasMapaService";
import { getCurrentUser } from "@/services/sessionService";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Camera, Crosshair, MapPin, ImagePlus, X, WifiOff } from "lucide-react";
import { toast } from "sonner";
import TaskLocationPickerDialog from "./TaskLocationPickerDialog";
import useSetorAreas from "@/hooks/useSetorAreas";
import { getPermissionDisplayName, getUserDisplayName, isExcludedSystemUser } from "@/lib/userDisplayName";
import { canAccessPage, normalizePermissionRecord } from "@/lib/permissions";
import { useEmpresaSelecionadaId } from "@/hooks/useEmpresaSelecionadaId";
import B1Select from "@/components/cadastro/base1/B1Select";
import { LancLoteForm, LancLoteRodape, LL_CTL } from "@/components/lotes/LancamentoLoteUi";
import LancField from "@/components/cadastro/base1/LancField";
import VisualizadorDeFotos from "@/components/tarefas/VisualizadorDeFotos";
import { ROTULO_FOTO_GUARDADA } from "@/components/tarefas/FotosTarefaGaleria";
import useFotosGuardadasDaTarefa from "@/hooks/useFotosGuardadasDaTarefa";
import { excluirFotoGuardada } from "@/services/fotosDeTarefaAguardandoService";
import { confirmarExclusao } from "@/lib/maikeConfirmar";

/** Campo flutuante Base1 (rótulo dentro) — D-PROD-88. */
const FL = LancField;

export { normalizarPrioridadeTarefa as normalizeTaskPriority } from "@/lib/tarefas/prioridade";
import { normalizarPrioridadeTarefa as normalizeTaskPriority, PRIORIDADES_TAREFA } from "@/lib/tarefas/prioridade";

// D-PROD-320: lançamento simples — só o título é obrigatório. Sem tipo, o servidor usa "SEM TIPO" (o
// administrador troca depois); o grupo vem do tipo; status, datas e quem pediu ficam com o servidor e com os
// eventos dos detalhes da tarefa.
const REQUIRED_FIELDS = ["titulo"];

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

  // D-PROD-324: fotos desta tarefa guardadas no celular (tiradas sem internet), na edição.
  const fotosGuardadas = useFotosGuardadasDaTarefa(tarefa?.id || null);
  const [fotoAberta, setFotoAberta] = useState(/** @type {number | null} */ (null));

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
  // D-PROD-320: todos os tipos de uma vez (o grupo saiu da tela; ele vem do próprio tipo).
  const tiposTarefaOrdenados = useMemo(
    () => [...tiposTarefa].sort((a, b) => String(a.nome_tipo || "").localeCompare(String(b.nome_tipo || ""), "pt-BR", { sensitivity: "base" })),
    [tiposTarefa]
  );

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

  /** Todas as fotos do formulário, na ordem da tela: enviadas, guardadas no celular e novas. */
  const miniaturas = [
    ...(formData.fotos || []).map((url, i) => ({ chave: `salva-${i}-${url}`, url, tipo: "salva", remover: () => removeSavedImage(url) })),
    ...fotosGuardadas.map((g) => ({
      chave: `guardada-${g.chave}`,
      url: g.url,
      tipo: "guardada",
      remover: async () => {
        if (await confirmarExclusao("Excluir esta foto? Ela ainda não foi enviada e sai do celular.")) await excluirFotoGuardada(g.chave);
      },
    })),
    ...previewUrls.map((url, i) => ({ chave: `nova-${i}-${url}`, url, tipo: "nova", remover: () => removeNewImage(i) })),
  ];

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
      // Sem tipo escolhido: não manda o campo (o servidor usa "SEM TIPO"); na edição, o tipo gravado fica.
      const { tipo_tarefa_id: tipoEscolhido, ...semTipo } = formData;
      onSubmit({
        ...semTipo,
        ...(tipoEscolhido ? { tipo_tarefa_id: tipoEscolhido } : {}),
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
        <FL label="Setor">
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
            <Input value={(formData.area_nome || formData.lote_nome || "").toUpperCase()} readOnly className="h-7 text-xs bg-[#FAFCFE] uppercase border-0 shadow-none focus-visible:ring-0" />
          </FL>
        }

        <FL label="Tipo de tarefa (opcional)" dataField="tipo_tarefa_id">
          <B1Select value={formData.tipo_tarefa_id ?? ""} onChange={(e) => handleTipoTarefaChange(e.target.value)} className={LL_CTL}>{tiposTarefaOrdenados.map((tipo) => <option key={tipo.id} value={tipo.id}>{(tipo.nome_tipo || "").toUpperCase()}</option>)}
          </B1Select>
        </FL>

        <FL label="Responsável" dataField="responsavel_id">
          <B1Select value={formData.responsavel_id ?? ""} onChange={(e) => handleResponsavelChange(e.target.value)} className={LL_CTL}>{usuariosOrdenados.map((item) => { const permissao = permissoesUsuarios.find((registro) => (registro.user_email || registro.data?.user_email) === item.email); return <option key={item.id} value={item.id}>{getPermissionDisplayName(permissao?.data || permissao, item).toUpperCase()}</option>; })}
          </B1Select>
        </FL>

        <FL label="Prioridade">
          <B1Select value={formData.prioridade ?? ""} onChange={(e) => { const value = e.target.value; setFormData((prev) => ({ ...prev, prioridade: value })); }} className={LL_CTL}>
              {PRIORIDADES_TAREFA.map((prioridade) => <option key={prioridade} value={prioridade}>{prioridade.toUpperCase()}</option>)}
          </B1Select>
        </FL>

        <FL label="Prazo previsto">
          <Input type="date" value={formData.data_prevista} onChange={(e) => setFormData((prev) => ({ ...prev, data_prevista: e.target.value }))} className={LL_CTL} />
        </FL>
        </div>

        <div className="mk-ll__grade">
          <FL label="Descrição / observações">
            <Textarea value={formData.descricao} onChange={(e) => setFormData((prev) => ({ ...prev, descricao: e.target.value }))} placeholder="O QUE PRECISA SER FEITO, DETALHES…" className="text-xs uppercase border-0 shadow-none focus-visible:ring-0 bg-transparent" style={{ textTransform: "uppercase" }} rows={3} />
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
          {/* D-PROD-324: toda foto abre em tela cheia ao tocar; o ✕ fica sempre visível (no celular não há "passar o
              mouse"); editando, as fotos tiradas sem internet e guardadas no celular aparecem com "Aguardando envio". */}
          <div className="flex flex-wrap gap-2">
            {miniaturas.map((m, idx) => (
              <div key={m.chave} className={`relative w-16 h-16 rounded-md overflow-hidden border ${m.tipo === "nova" ? "border-2 border-emerald-400" : m.tipo === "guardada" ? "border-2 border-amber-400" : "border-slate-300"}`} data-mk-miniatura={m.tipo}>
                <button type="button" onClick={() => setFotoAberta(idx)} aria-label={`Abrir foto ${idx + 1}`} className="w-full h-full">
                  <img src={m.url} alt="" className="w-full h-full object-cover" />
                </button>
                <button type="button" onClick={m.remover} aria-label={`Remover foto ${idx + 1}`} className="absolute top-0.5 right-0.5 bg-black/60 text-white rounded-full w-5 h-5 flex items-center justify-center">
                  <X className="w-3 h-3" />
                </button>
                {m.tipo === "nova" ? <div className="pointer-events-none absolute bottom-0 left-0 right-0 bg-emerald-500/80 text-white text-[8px] text-center leading-tight py-0.5">NOVA</div> : null}
                {m.tipo === "guardada" ? <div className="pointer-events-none absolute bottom-0 left-0 right-0 bg-amber-500/90 text-white text-[7px] text-center leading-tight py-0.5">{ROTULO_FOTO_GUARDADA.toUpperCase()}</div> : null}
              </div>
            ))}
            {/* D-PROD-324: duas opções — tirar a foto na hora (câmera: `capture` abre a câmera do celular direto) ou
                escolher uma já tirada (galeria). */}
            <label className="w-16 h-16 rounded-md border-2 border-dashed border-slate-300 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50 transition-colors" data-mk-foto-camera="">
              <Camera className="w-5 h-5 text-slate-400" />
              <span className="text-[9px] text-slate-400 mt-0.5">Tirar foto</span>
              <input type="file" accept="image/*" capture="environment" className="hidden" aria-label="Tirar foto com a câmera" onChange={handleImageSelect} />
            </label>
            <label className="w-16 h-16 rounded-md border-2 border-dashed border-slate-300 flex flex-col items-center justify-center cursor-pointer hover:border-emerald-400 hover:bg-emerald-50 transition-colors" data-mk-foto-galeria="">
              <ImagePlus className="w-5 h-5 text-slate-400" />
              <span className="text-[9px] text-slate-400 mt-0.5">Galeria</span>
              <input type="file" accept="image/*" multiple className="hidden" aria-label="Escolher fotos da galeria" onChange={handleImageSelect} />
            </label>
          </div>
          <VisualizadorDeFotos
            fotos={miniaturas.map((m) => m.url)}
            legendas={miniaturas.map((m) => (m.tipo === "guardada" ? ROTULO_FOTO_GUARDADA : m.tipo === "nova" ? "Nova (sobe ao salvar)" : null))}
            indice={fotoAberta}
            onMudar={setFotoAberta}
            onFechar={() => setFotoAberta(null)}
          />
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