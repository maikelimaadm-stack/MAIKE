import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Image, Upload, Save, X, Edit2, Trash2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const TIPOS_ENTIDADE = [
  { value: "Ponto", label: "Ponto de Referência" },
  { value: "Area", label: "Área/Polígono" },
  { value: "Lote", label: "Lote de Gado" },
  { value: "Linha", label: "Linha/Estrada" }
];

const CATEGORIAS_SUGERIDAS = {
  "Ponto": ["Cocho", "Bebedouro", "Aguada", "Balança", "Curral", "Tronco", "Armazém", "Casa Sede", "Retiro", "Saleiro"],
  "Area": ["Pasto", "Lavoura", "Reserva Legal", "APP", "Curral", "Sede", "Talhão", "Piquete"],
  "Lote": ["Bezerro 0 a 12 meses", "Bezerra 0 a 12 meses", "Garrote 13 a 24 meses", "Novilha 13 a 24 meses", "Boi 25 a 36 meses", "Vaca 25 a 36 meses", "Touro + 36 meses", "Vaca + 36 meses", "MISTO"],
  "Linha": ["Estrada", "Cerca", "Cerca Elétrica", "Rio", "Córrego", "Divisa"]
};

const CORES_PADRAO = [
  "#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#06b6d4", "#84cc16", "#f97316", "#6366f1"
];

export default function GerenciadorIcones() {
  const [showDialog, setShowDialog] = useState(false);
  const [editingIcone, setEditingIcone] = useState(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const [formData, setFormData] = useState({
    tipo_entidade: "",
    categoria: "",
    icone_url: "",
    cor_padrao: CORES_PADRAO[0],
    descricao: "",
    categorias_misto: []
  });

  const queryClient = useQueryClient();

  const { data: icones = [] } = useQuery({
    queryKey: ['configuracao-icones-global'],
    queryFn: async () => {
      const all = await base44.entities.ConfiguracaoIcone.list();
      // Ícones são globais - não filtrar por empresa
      return all.filter(i => i.ativo !== false);
    },
  });

  const createIconeMutation = useMutation({
    mutationFn: (data) => base44.entities.ConfiguracaoIcone.create({
      ...data,
      ativo: true
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['configuracao-icones-global'] });
      resetForm();
      toast.success('✅ Ícone cadastrado!');
    }
  });

  const updateIconeMutation = useMutation({
    mutationFn: ({ id, data }) => base44.entities.ConfiguracaoIcone.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['configuracao-icones-global'] });
      resetForm();
      toast.success('✅ Ícone atualizado!');
    }
  });

  const deleteIconeMutation = useMutation({
    mutationFn: (id) => base44.entities.ConfiguracaoIcone.update(id, { ativo: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['configuracao-icones-global'] });
      toast.success('✅ Ícone removido!');
    }
  });

  const resetForm = () => {
    setShowDialog(false);
    setEditingIcone(null);
    setFormData({
      tipo_entidade: "",
      categoria: "",
      icone_url: "",
      sub_icone_url: "",
      cor_padrao: CORES_PADRAO[0],
      descricao: "",
      categorias_misto: []
    });
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingFile(true);
    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setFormData({ ...formData, icone_url: file_url });
      toast.success('✅ Imagem carregada!');
    } catch (error) {
      toast.error('❌ Erro ao carregar imagem');
      console.error(error);
    } finally {
      setUploadingFile(false);
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    
    if (!formData.tipo_entidade || !formData.categoria) {
      toast.error('Preencha tipo e categoria!');
      return;
    }

    const dataToSave = {
      ...formData,
      categoria: formData.categoria.toUpperCase()
    };

    if (editingIcone) {
      updateIconeMutation.mutate({ id: editingIcone.id, data: dataToSave });
    } else {
      createIconeMutation.mutate(dataToSave);
    }
  };

  const handleEdit = (icone) => {
    setEditingIcone(icone);
    setFormData({
      tipo_entidade: icone.tipo_entidade,
      categoria: icone.categoria,
      icone_url: icone.icone_url || "",
      sub_icone_url: icone.sub_icone_url || "",
      cor_padrao: icone.cor_padrao || CORES_PADRAO[0],
      descricao: icone.descricao || "",
      categorias_misto: icone.categorias_misto || []
    });
    setShowDialog(true);
  };

  const iconesPorTipo = icones.reduce((acc, icone) => {
    if (!acc[icone.tipo_entidade]) acc[icone.tipo_entidade] = [];
    acc[icone.tipo_entidade].push(icone);
    return acc;
  }, {});

  return (
    <div className="space-y-3">
      <Card className="shadow-sm">
        <CardHeader className="bg-slate-50 border-b py-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Image className="w-4 h-4" />
              Gerenciamento de Ícones
            </CardTitle>
            <Button
              onClick={() => setShowDialog(true)}
              size="sm"
              className="h-8 gap-1 text-xs bg-emerald-600 hover:bg-emerald-700"
            >
              <Plus className="w-3 h-3" />
              Novo Ícone
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          {TIPOS_ENTIDADE.map(tipo => {
            const iconesDoTipo = iconesPorTipo[tipo.value] || [];
            
            return (
              <div key={tipo.value}>
                <div className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500" />
                  {tipo.label} ({iconesDoTipo.length})
                </div>
                
                {iconesDoTipo.length === 0 ? (
                  <div className="text-xs text-slate-500 italic ml-4">Nenhum ícone cadastrado</div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {iconesDoTipo.map(icone => (
                      <div key={icone.id} className="border rounded p-3 bg-white hover:bg-slate-50 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {icone.icone_url ? (
                              <img src={icone.icone_url} alt={icone.categoria} className="w-8 h-8 object-contain" />
                            ) : (
                              <div 
                                className="w-8 h-8 rounded flex items-center justify-center text-white text-xs font-bold"
                                style={{ backgroundColor: icone.cor_padrao || '#10b981' }}
                              >
                                {icone.categoria.substring(0, 2)}
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-semibold truncate">{icone.categoria}</div>
                              {icone.descricao && (
                                <div className="text-[10px] text-slate-500 truncate">{icone.descricao}</div>
                              )}
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => handleEdit(icone)}
                              className="h-6 w-6 text-blue-600"
                            >
                              <Edit2 className="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (window.confirm(`Remover ícone ${icone.categoria}?`)) {
                                  deleteIconeMutation.mutate(icone.id);
                                }
                              }}
                              className="h-6 w-6 text-red-600"
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {icones.length === 0 && (
            <div className="text-center py-12 text-slate-500">
              <Image className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p className="text-sm">Nenhum ícone cadastrado</p>
              <p className="text-xs">Clique em "Novo Ícone" para começar</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) resetForm(); setShowDialog(open); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {editingIcone ? 'Editar Ícone' : 'Cadastrar Novo Ícone'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label className="text-xs">Tipo de Entidade *</Label>
              <Select
                value={formData.tipo_entidade}
                onValueChange={(v) => setFormData({ ...formData, tipo_entidade: v, categoria: "" })}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione o tipo" />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_ENTIDADE.map(tipo => (
                    <SelectItem key={tipo.value} value={tipo.value} className="text-xs">
                      {tipo.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {formData.tipo_entidade && (
              <div className="space-y-1">
                <Label className="text-xs">Categoria *</Label>
                <Select
                  value={formData.categoria}
                  onValueChange={(v) => setFormData({ ...formData, categoria: v })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione a categoria" />
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIAS_SUGERIDAS[formData.tipo_entidade]?.map(cat => (
                      <SelectItem key={cat} value={cat} className="text-xs">
                        {cat}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={formData.categoria}
                  onChange={(e) => setFormData({ ...formData, categoria: e.target.value })}
                  placeholder="OU DIGITE UMA NOVA CATEGORIA"
                  className="h-8 text-xs uppercase mt-1"
                />
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs">Ícone Principal (Mapa)</Label>
              <div className="flex gap-2">
                <Input
                  type="file"
                  accept="image/*"
                  onChange={handleFileUpload}
                  className="h-8 text-xs"
                  disabled={uploadingFile}
                />
                {uploadingFile && (
                  <div className="text-xs text-slate-500 flex items-center">
                    <Upload className="w-3 h-3 mr-1 animate-pulse" />
                    Enviando...
                  </div>
                )}
              </div>
              {formData.icone_url && (
                <div className="flex items-center gap-2 mt-2">
                  <img src={formData.icone_url} alt="Preview" className="w-10 h-10 object-contain border rounded" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setFormData({ ...formData, icone_url: "" })}
                    className="h-6 w-6 text-red-600"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Sub Ícone (Informações/Detalhes)</Label>
              <div className="flex gap-2">
                <Input
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    setUploadingFile(true);
                    try {
                      const { file_url } = await base44.integrations.Core.UploadFile({ file });
                      setFormData({ ...formData, sub_icone_url: file_url });
                      toast.success('✅ Sub ícone carregado!');
                    } catch (error) {
                      toast.error('❌ Erro ao carregar sub ícone');
                      console.error(error);
                    } finally {
                      setUploadingFile(false);
                    }
                  }}
                  className="h-8 text-xs"
                  disabled={uploadingFile}
                />
              </div>
              {formData.sub_icone_url && (
                <div className="flex items-center gap-2 mt-2">
                  <img src={formData.sub_icone_url} alt="Preview Sub" className="w-10 h-10 object-contain border rounded" />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setFormData({ ...formData, sub_icone_url: "" })}
                    className="h-6 w-6 text-red-600"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Cor Padrão</Label>
              <div className="flex gap-2 items-center">
                <Input
                  type="color"
                  value={formData.cor_padrao}
                  onChange={(e) => setFormData({ ...formData, cor_padrao: e.target.value })}
                  className="h-8 w-20"
                />
                <div className="grid grid-cols-5 gap-1 flex-1">
                  {CORES_PADRAO.map(cor => (
                    <button
                      key={cor}
                      type="button"
                      onClick={() => setFormData({ ...formData, cor_padrao: cor })}
                      className={`w-full h-7 rounded border-2 transition-all ${formData.cor_padrao === cor ? 'border-slate-900 scale-110' : 'border-slate-200'}`}
                      style={{ backgroundColor: cor }}
                    />
                  ))}
                </div>
              </div>
            </div>

            {formData.categoria?.toUpperCase() === 'MISTO' && formData.tipo_entidade === 'Lote' && (
              <div className="space-y-1">
                <Label className="text-xs">Categorias que formam o MISTO *</Label>
                <div className="border rounded p-2 space-y-2 bg-slate-50">
                  <div className="text-[10px] text-slate-600 mb-2">
                    Selecione as categorias que, quando estiverem juntas na mesma área, devem usar este ícone:
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {CATEGORIAS_SUGERIDAS.Lote.filter(cat => cat !== 'MISTO').map(cat => {
                      const isSelected = formData.categorias_misto?.includes(cat);
                      return (
                        <Badge
                          key={cat}
                          variant={isSelected ? 'default' : 'outline'}
                          className={`cursor-pointer text-[10px] ${isSelected ? 'bg-emerald-600' : ''}`}
                          onClick={() => {
                            const current = formData.categorias_misto || [];
                            if (isSelected) {
                              setFormData({ ...formData, categorias_misto: current.filter(c => c !== cat) });
                            } else {
                              setFormData({ ...formData, categorias_misto: [...current, cat] });
                            }
                          }}
                        >
                          {cat}
                        </Badge>
                      );
                    })}
                  </div>
                  {formData.categorias_misto?.length > 0 && (
                    <div className="text-[10px] text-emerald-600 font-semibold mt-2">
                      ✓ {formData.categorias_misto.length} categoria(s) selecionada(s)
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs">Descrição</Label>
              <Textarea
                value={formData.descricao}
                onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                placeholder="DESCRIÇÃO DA CATEGORIA..."
                className="text-xs uppercase"
                rows={2}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={resetForm} size="sm" className="h-8 text-xs">
                <X className="w-3 h-3 mr-1" />
                Cancelar
              </Button>
              <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                <Save className="w-3 h-3 mr-1" />
                Salvar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}