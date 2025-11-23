import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Plus, Trash2, Edit, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function CategoriasManejo() {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [showForm, setShowForm] = useState(false);
  const [editando, setEditando] = useState(null);
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    nome: "",
    sigla: "",
    especie: "Bovinos",
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

    if (!formData.nome || !formData.categoria_oficial) {
      toast.error('Preencha nome e categoria oficial!');
      return;
    }

    const data = {
      empresa_id: empresaSelecionadaId,
      nome: formData.nome.toUpperCase(),
      sigla: formData.sigla.toUpperCase(),
      especie: formData.especie,
      categoria_oficial: formData.categoria_oficial,
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

  const categoriasOficiaisDisponiveis = iconesConfig.map(ic => ic.categoria).filter(Boolean);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Categorias de Manejo</h1>
          <p className="text-xs text-slate-600">Crie categorias customizadas vinculadas às categorias oficiais</p>
        </div>
        <Button onClick={() => setShowForm(true)} size="sm" className="h-8 text-xs">
          <Plus className="w-3.5 h-3.5 mr-1" />
          Nova Categoria
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {categorias.map(cat => {
          const configIcone = iconesConfig.find(ic => ic.categoria === cat.categoria_oficial);
          return (
            <Card key={cat.id} className="hover:shadow-lg transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <div className="text-sm font-bold text-slate-900 mb-1">{cat.nome}</div>
                    <Badge className="text-xs">{cat.especie}</Badge>
                  </div>
                  {configIcone?.icone_url && (
                    <img src={configIcone.icone_url} alt="" className="w-10 h-10 object-contain" />
                  )}
                </div>

                <div className="space-y-2 text-xs mb-3">
                  <div>
                    <span className="text-slate-600">Categoria oficial:</span>
                    <span className="font-semibold text-slate-900 ml-2">{cat.categoria_oficial}</span>
                  </div>
                  {cat.ganho_peso_anual_kg && (
                    <div>
                      <span className="text-slate-600">Ganho anual:</span>
                      <span className="font-semibold text-slate-900 ml-2">{cat.ganho_peso_anual_kg} kg</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-2">
                  <Button 
                    onClick={() => handleEdit(cat)} 
                    variant="outline" 
                    size="sm" 
                    className="h-7 text-xs flex-1"
                  >
                    <Edit className="w-3 h-3 mr-1" />
                    Editar
                  </Button>
                  <Button 
                    onClick={() => {
                      if (window.confirm('Excluir categoria?')) {
                        deleteMutation.mutate(cat.id);
                      }
                    }}
                    variant="outline" 
                    size="sm" 
                    className="h-7 text-xs text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}

        {categorias.length === 0 && (
          <div className="col-span-full text-center py-12 text-slate-500">
            <p className="text-sm">Nenhuma categoria cadastrada</p>
            <p className="text-xs">Clique em "Nova Categoria" para começar</p>
          </div>
        )}
      </div>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando ? 'Editar' : 'Nova'} Categoria de Manejo</DialogTitle>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Nome da Categoria *</Label>
              <Input
                value={formData.nome}
                onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                placeholder="AA, TESTE..."
                className="h-8 text-xs uppercase"
                required
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Sigla *</Label>
              <Input
                value={formData.sigla}
                onChange={(e) => setFormData({ ...formData, sigla: e.target.value })}
                placeholder="AA, TST..."
                className="h-8 text-xs uppercase"
                required
                maxLength={10}
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Espécie *</Label>
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
                <Label className="text-xs">Categoria Oficial *</Label>
                <Select 
                  value={formData.categoria_oficial} 
                  onValueChange={(v) => setFormData({ ...formData, categoria_oficial: v })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
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
              <div className="grid grid-cols-6 gap-3">
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
                <X className="w-3 h-3 mr-1" />
                Cancelar
              </Button>
              <Button type="submit" size="sm" className="h-8 text-xs">
                {editando ? 'Atualizar' : 'Salvar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}