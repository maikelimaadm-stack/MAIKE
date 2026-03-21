import React, { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import TabelaCategoriasManejo from "@/components/categorias-manejo/TabelaCategoriasManejo";
import FormularioCategoriaManejo from "@/components/categorias-manejo/FormularioCategoriaManejo";
import { ensureDeleteAllowed } from "@/lib/entityDeleteGuards";

const getInitialFormData = () => ({
  nome: "",
  sigla: "",
  especie: "Bovinos",
  sexo: "",
  raca: "",
  idade_minima_meses: "",
  idade_maxima_meses: "",
  categoria_oficial: "",
  ganho_peso_anual_kg: "",
  gmd_janeiro: "",
  gmd_fevereiro: "",
  gmd_marco: "",
  gmd_abril: "",
  gmd_maio: "",
  gmd_junho: "",
  gmd_julho: "",
  gmd_agosto: "",
  gmd_setembro: "",
  gmd_outubro: "",
  gmd_novembro: "",
  gmd_dezembro: ""
});

export default function CategoriasManejo() {
  const empresaSelecionadaId = localStorage.getItem("empresa_selecionada_id");
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showConfigColunas, setShowConfigColunas] = useState(false);
  const [editando, setEditando] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);

  const { data: categorias = [], refetch } = useQuery({
    queryKey: ["categorias-manejo", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CategoriaManejo.list();
      return all.filter((c) => c.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ["configuracao-icones", empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter((i) => i.empresa_id === empresaSelecionadaId && i.tipo_entidade === "Lote" && i.ativo !== false);
    },
    enabled: !!empresaSelecionadaId
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.CategoriaManejo.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categorias-manejo", empresaSelecionadaId] });
      setShowForm(false);
      setEditando(null);
      toast.success("Categoria cadastrada!");
    }
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }) => {
      return await base44.entities.CategoriaManejo.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categorias-manejo", empresaSelecionadaId] });
      setShowForm(false);
      setEditando(null);
      toast.success("Categoria atualizada!");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      await ensureDeleteAllowed(base44, "CategoriaManejo", id);
      return base44.entities.CategoriaManejo.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categorias-manejo", empresaSelecionadaId] });
      toast.success("Categoria excluída!");
    },
    onError: (error) => {
      if (String(error?.message || "").toLowerCase().includes("não é possível excluir")) return;
      toast.error(error.message || "Erro ao excluir.");
    }
  });

  const categoriasOficiaisDisponiveis = useMemo(() => {
    const categoriasPadrao = [
    "Bezerro 0 a 12 meses",
    "Bezerra 0 a 12 meses",
    "Garrote 13 a 24 meses",
    "Novilha 13 a 24 meses",
    "Boi 25 a 36 meses",
    "Vaca 25 a 36 meses",
    "Touro + 36 meses",
    "Vaca + 36 meses"];


    const categoriasIcones = iconesConfig.
    filter((ic) => ic.tipo_entidade === "Lote").
    map((ic) => ic.categoria).
    filter((cat) => cat && cat.toUpperCase() !== "MISTO");

    return [...new Set([...categoriasPadrao, ...categoriasIcones])].sort();
  }, [iconesConfig]);

  const handleEdit = (categoria) => {
    setEditando(categoria);
    setShowForm(true);
  };

  const handleSubmit = (formData) => {
    const data = {
      empresa_id: empresaSelecionadaId,
      nome: formData.nome.toUpperCase(),
      sigla: formData.sigla.toUpperCase(),
      especie: formData.especie,
      sexo: formData.sexo || null,
      raca: formData.raca ? formData.raca.toUpperCase() : null,
      idade_minima_meses: formData.idade_minima_meses ? parseInt(formData.idade_minima_meses) : null,
      idade_maxima_meses: formData.idade_maxima_meses ? parseInt(formData.idade_maxima_meses) : null,
      categoria_oficial: formData.categoria_oficial || null,
      ganho_peso_anual_kg: formData.ganho_peso_anual_kg ? parseFloat(formData.ganho_peso_anual_kg) : null,
      gmd_janeiro: formData.gmd_janeiro ? parseFloat(formData.gmd_janeiro) : null,
      gmd_fevereiro: formData.gmd_fevereiro ? parseFloat(formData.gmd_fevereiro) : null,
      gmd_marco: formData.gmd_marco ? parseFloat(formData.gmd_marco) : null,
      gmd_abril: formData.gmd_abril ? parseFloat(formData.gmd_abril) : null,
      gmd_maio: formData.gmd_maio ? parseFloat(formData.gmd_maio) : null,
      gmd_junho: formData.gmd_junho ? parseFloat(formData.gmd_junho) : null,
      gmd_julho: formData.gmd_julho ? parseFloat(formData.gmd_julho) : null,
      gmd_agosto: formData.gmd_agosto ? parseFloat(formData.gmd_agosto) : null,
      gmd_setembro: formData.gmd_setembro ? parseFloat(formData.gmd_setembro) : null,
      gmd_outubro: formData.gmd_outubro ? parseFloat(formData.gmd_outubro) : null,
      gmd_novembro: formData.gmd_novembro ? parseFloat(formData.gmd_novembro) : null,
      gmd_dezembro: formData.gmd_dezembro ? parseFloat(formData.gmd_dezembro) : null,
      ativo: true
    };

    if (editando) {
      updateMutation.mutate({ id: editando.id, data, oldData: editando });
      return;
    }

    createMutation.mutate(data);
  };

  return (
    <div className="p-4 md:p-6 space-y-4">
      {!showForm && <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2 bg-white rounded px-3 py-2 shadow-sm border-b border-slate-200">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Cadastro de Categorias de Manejo</h1>
          
        </div>
        <div className="flex gap-2 flex-wrap">
          {!showForm &&
          <Button variant="outline" size="icon" onClick={() => setShowConfigColunas(true)} className="h-8 w-8">
              <Settings className="w-4 h-4" />
            </Button>
          }
          <Button variant="outline" size="sm" onClick={() => refetch()} className="h-8 text-xs">
            Atualizar
          </Button>
          {!showForm &&
          <Button onClick={() => {setEditando(null);setShowForm(true);}} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
              Nova Categoria
            </Button>
          }
        </div>
      </div>}

      <AnimatePresence mode="wait">
        {showForm ?
        <FormularioCategoriaManejo
          initialData={editando ? {
            ...getInitialFormData(),
            ...editando,
            idade_minima_meses: editando.idade_minima_meses || "",
            idade_maxima_meses: editando.idade_maxima_meses || "",
            ganho_peso_anual_kg: editando.ganho_peso_anual_kg || "",
            gmd_janeiro: editando.gmd_janeiro || "",
            gmd_fevereiro: editando.gmd_fevereiro || "",
            gmd_marco: editando.gmd_marco || "",
            gmd_abril: editando.gmd_abril || "",
            gmd_maio: editando.gmd_maio || "",
            gmd_junho: editando.gmd_junho || "",
            gmd_julho: editando.gmd_julho || "",
            gmd_agosto: editando.gmd_agosto || "",
            gmd_setembro: editando.gmd_setembro || "",
            gmd_outubro: editando.gmd_outubro || "",
            gmd_novembro: editando.gmd_novembro || "",
            gmd_dezembro: editando.gmd_dezembro || ""
          } : getInitialFormData()}
          isEditing={!!editando}
          onSubmit={handleSubmit}
          onCancel={() => {setShowForm(false);setEditando(null);}}
          categoriasOficiaisDisponiveis={categoriasOficiaisDisponiveis} /> :


        <TabelaCategoriasManejo
          categorias={categorias}
          onEdit={handleEdit}
          onDelete={(id) => setDeleteConfirmId(id)}
          showConfigColunas={showConfigColunas}
          setShowConfigColunas={setShowConfigColunas} />

        }
      </AnimatePresence>

      <ConfirmDialog
        open={!!deleteConfirmId}
        onOpenChange={(open) => !open && setDeleteConfirmId(null)}
        title="Excluir categoria de manejo"
        description="Se esta categoria possuir registros lançados, a exclusão será bloqueada automaticamente."
        onConfirm={() => {
          deleteMutation.mutate(deleteConfirmId);
          setDeleteConfirmId(null);
        }}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive" />
      
    </div>);

}