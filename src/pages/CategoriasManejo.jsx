import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import ConfirmDialog from "@/components/common/ConfirmDialog";
import TabelaCategoriasManejo from "@/components/categorias-manejo/TabelaCategoriasManejo";
import { AnimatePresence } from "framer-motion";

export default function CategoriasManejo() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showForm, setShowForm] = useState(false);
  const [editando, setEditando] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
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

  const { data: categorias = [] } = useQuery({
    queryKey: ['categorias-manejo', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.CategoriaManejo.list();
      return all.filter(c => c.empresa_id === empresaSelecionadaId);
    },
    enabled: !!empresaSelecionadaId,
  });

  const { data: iconesConfig = [] } = useQuery({
    queryKey: ['configuracao-icones', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      return all.filter(i => i.empresa_id === empresaSelecionadaId && i.tipo_entidade === 'Lote' && i.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
  });

  const createMutation = useMutation({
    mutationFn: (data) => base44.entities.CategoriaManejo.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias-manejo'] });
      resetForm();
      toast.success('Categoria cadastrada!');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.CategoriaManejo.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias-manejo'] });
      resetForm();
      toast.success('Categoria atualizada!');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => base44.entities.CategoriaManejo.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categorias-manejo'] });
      toast.success('Categoria excluída!');
    },
  });

  const resetForm = () => {
    setFormData({
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
    setShowForm(false);
    setEditando(null);
  };

  const handleEdit = (cat) => {
    setFormData({
      nome: cat.nome || "",
      sigla: cat.sigla || "",
      especie: cat.especie || "Bovinos",
      sexo: cat.sexo || "",
      raca: cat.raca || "",
      idade_minima_meses: cat.idade_minima_meses || "",
      idade_maxima_meses: cat.idade_maxima_meses || "",
      categoria_oficial: cat.categoria_oficial || "",
      ganho_peso_anual_kg: cat.ganho_peso_anual_kg || "",
      gmd_janeiro: cat.gmd_janeiro || "",
      gmd_fevereiro: cat.gmd_fevereiro || "",
      gmd_marco: cat.gmd_marco || "",
      gmd_abril: cat.gmd_abril || "",
      gmd_maio: cat.gmd_maio || "",
      gmd_junho: cat.gmd_junho || "",
      gmd_julho: cat.gmd_julho || "",
      gmd_agosto: cat.gmd_agosto || "",
      gmd_setembro: cat.gmd_setembro || "",
      gmd_outubro: cat.gmd_outubro || "",
      gmd_novembro: cat.gmd_novembro || "",
      gmd_dezembro: cat.gmd_dezembro || ""
    });
    setEditando(cat);
    setShowForm(true);
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.nome || !formData.sigla) {
      toast.error('Preencha nome e sigla!');
      return;
    }

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
      updateMutation.mutate({ id: editando.id, data });
    } else {
      createMutation.mutate(data);
    }
  };



  // Categorias oficiais padrão do sistema (igual nos parâmetros)
  const CATEGORIAS_OFICIAIS_PADRAO = [
    "Bezerro 0 a 12 meses", 
    "Bezerra 0 a 12 meses", 
    "Garrote 13 a 24 meses", 
    "Novilha 13 a 24 meses", 
    "Boi 25 a 36 meses", 
    "Vaca 25 a 36 meses", 
    "Touro + 36 meses", 
    "Vaca + 36 meses"
  ];
  
  // Pega categorias dos ícones cadastrados + categorias padrão
  const categoriasDoIcones = iconesConfig
    .filter(ic => ic.tipo_entidade === 'Lote')
    .map(ic => ic.categoria)
    .filter(cat => cat && cat.toUpperCase() !== 'MISTO');
  
  const categoriasOficiaisDisponiveis = [
    ...new Set([...CATEGORIAS_OFICIAIS_PADRAO, ...categoriasDoIcones])
  ].sort();

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Categorias de Manejo</h1>
          <p className="text-xs text-slate-600">Crie categorias customizadas vinculadas às categorias oficiais</p>
        </div>
        <Button onClick={() => setShowForm(true)} size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
          Nova Categoria
        </Button>
      </div>

      <AnimatePresence mode="wait">
        {!showForm && (
          <TabelaCategoriasManejo
            categorias={categorias}
            onEdit={handleEdit}
            onDelete={(id) => setDeleteConfirmId(id)}
            iconesConfig={iconesConfig}
          />
        )}
      </AnimatePresence>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando ? 'Editar' : 'Nova'} Categoria de Manejo</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-1">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
            <div className="space-y-1">
              <Label className="text-xs">Nome da Categoria *</Label>
              <Input
                value={formData.nome}
                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                placeholder="Bezerro, Novilha..."
                className="h-8 text-xs uppercase"
                required
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Sigla *</Label>
              <Input
                value={formData.sigla}
                onChange={(e) => setFormData({ ...formData, sigla: e.target.value })}
                placeholder="BEZ, NOV..."
                className="h-8 text-xs uppercase"
                required
                maxLength={10}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Sexo</Label>
              <Select value={formData.sexo} onValueChange={(v) => setFormData({ ...formData, sexo: v })}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Macho" className="text-xs">Macho</SelectItem>
                  <SelectItem value="Fêmea" className="text-xs">Fêmea</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Raça</Label>
              <Input
                value={formData.raca}
                onChange={(e) => setFormData({ ...formData, raca: e.target.value })}
                placeholder="NELORE, ANGUS..."
                className="h-8 text-xs uppercase"
              />
            </div>
          </div>

          <div className="grid grid-cols-4 gap-1">
            <div className="space-y-1">
              <Label className="text-xs">Espécie</Label>
                <Select value={formData.especie} onValueChange={(v) => setFormData({ ...formData, especie: v })}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Bovinos" className="text-xs">Bovinos</SelectItem>
                    <SelectItem value="Ovinos" className="text-xs">Ovinos</SelectItem>
                    <SelectItem value="Suínos" className="text-xs">Suínos</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Idade Mínima (meses)</Label>
                <Input
                  type="number"
                  value={formData.idade_minima_meses}
                  onChange={(e) => setFormData({ ...formData, idade_minima_meses: e.target.value })}
                  placeholder="0"
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Idade Máxima (meses)</Label>
                <Input
                  type="number"
                  value={formData.idade_maxima_meses}
                  onChange={(e) => setFormData({ ...formData, idade_maxima_meses: e.target.value })}
                  placeholder="12"
                  className="h-8 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Categoria Oficial (ícone)</Label>
                <Select 
                  value={formData.categoria_oficial} 
                  onValueChange={(v) => setFormData({ ...formData, categoria_oficial: v })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Opcional" />
                  </SelectTrigger>
                  <SelectContent>
                    {categoriasOficiaisDisponiveis.map(cat => (
                      <SelectItem key={cat} value={cat} className="text-xs">{cat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Ganho de Peso Anual (kg)</Label>
              <Input
                type="number"
                step="0.01"
                value={formData.ganho_peso_anual_kg}
                onChange={(e) => setFormData({ ...formData, ganho_peso_anual_kg: e.target.value })}
                className="h-8 text-xs"
                placeholder="0"
              />
            </div>

            <div className="border-t pt-3">
              <Label className="text-xs font-semibold text-slate-900 mb-3 block">
                Previsão de Ganho de Peso Mensal (GMD em kg)
              </Label>
              <div className="grid grid-cols-6 gap-1">
                {[
                  { label: 'Jan', field: 'gmd_janeiro' },
                  { label: 'Fev', field: 'gmd_fevereiro' },
                  { label: 'Mar', field: 'gmd_marco' },
                  { label: 'Abr', field: 'gmd_abril' },
                  { label: 'Mai', field: 'gmd_maio' },
                  { label: 'Jun', field: 'gmd_junho' },
                  { label: 'Jul', field: 'gmd_julho' },
                  { label: 'Ago', field: 'gmd_agosto' },
                  { label: 'Set', field: 'gmd_setembro' },
                  { label: 'Out', field: 'gmd_outubro' },
                  { label: 'Nov', field: 'gmd_novembro' },
                  { label: 'Dez', field: 'gmd_dezembro' }
                ].map(mes => (
                  <div key={mes.field} className="space-y-1">
                    <Label className="text-xs">{mes.label}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={formData[mes.field]}
                      onChange={(e) => setFormData({ ...formData, [mes.field]: e.target.value })}
                      className="h-8 text-xs"
                      placeholder="GMD"
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t">
              <Button type="button" variant="outline" onClick={resetForm} size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                {editando ? 'Atualizar' : 'Salvar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteConfirmId}
        onOpenChange={(open) => !open && setDeleteConfirmId(null)}
        title="Excluir categoria de manejo"
        description="Se esta categoria possuir registros vinculados, a exclusão será bloqueada automaticamente."
        onConfirm={() => {
          deleteMutation.mutate(deleteConfirmId);
          setDeleteConfirmId(null);
        }}
        confirmText="Excluir"
        cancelText="Cancelar"
        variant="destructive"
      />
    </div>
  );
}