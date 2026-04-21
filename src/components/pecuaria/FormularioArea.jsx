import React, { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";

export default function FormularioArea({ onSubmit, onCancel, initialData, isEditing }) {
  const empresaSelecionadaId = localStorage.getItem('empresa_selecionada_id');
  const [formData, setFormData] = useState(initialData || {
    nome: "",
    setor_id: "",
    setor_nome: "",
    tipo_cultura: "Pastagem",
    tipo_infraestrutura: "",
    tamanho_hectares: "",
    capacidade_maxima: "",
    tipo_pastagem: "",
    observacoes: ""
  });

  const { data: setores = [] } = useQuery({
    queryKey: ['setores-form-area-pecuaria', empresaSelecionadaId],
    queryFn: async () => {
      const all = await base44.entities.Setor.list();
      return all.filter((setor) => setor.empresa_id === empresaSelecionadaId && setor.ativo !== false);
    },
    enabled: !!empresaSelecionadaId,
    initialData: [],
  });

  const handleChange = (field, value) => {
    setFormData({ ...formData, [field]: value });
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    if (!formData.nome?.trim()) {
      toast.error('Nome da área é obrigatório!');
      return;
    }

    if (!formData.setor_id) {
      toast.error('Setor é obrigatório!');
      return;
    }

    if (formData.tipo_cultura !== 'Infraestrutura' && !formData.tamanho_hectares) {
      toast.error('Tamanho é obrigatório!');
      return;
    }

    if (formData.tipo_cultura === 'Infraestrutura' && !formData.tipo_infraestrutura) {
      toast.error('Tipo de infraestrutura é obrigatório!');
      return;
    }

    const data = {
      nome: formData.nome?.toUpperCase(),
      setor_id: formData.setor_id,
      setor_nome: formData.setor_nome,
      tipo_cultura: formData.tipo_cultura,
      tipo_infraestrutura: formData.tipo_cultura === 'Infraestrutura' ? formData.tipo_infraestrutura : undefined,
      tamanho_hectares: formData.tipo_cultura === 'Infraestrutura' ? 0 : parseFloat(formData.tamanho_hectares) || 0,
      capacidade_maxima: formData.tipo_cultura === 'Infraestrutura' ? 0 : parseFloat(formData.capacidade_maxima) || 0,
      tipo_pastagem: formData.tipo_cultura === 'Infraestrutura' ? undefined : formData.tipo_pastagem?.toUpperCase() || undefined,
      observacoes: formData.observacoes?.toUpperCase() || undefined,
      ativo: true
    };

    onSubmit(data);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
    >
      <Card className="shadow-sm border-slate-300 bg-white">
        <CardHeader className="bg-slate-50 border-b border-slate-200 py-3">
          <CardTitle className="text-sm font-semibold text-slate-900">
            {isEditing ? 'Editar Área' : 'Nova Área'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Nome da Área/Piquete *</Label>
                <Input
                  value={formData.nome}
                  onChange={(e) => handleChange('nome', e.target.value)}
                  placeholder="PIQUETE 01"
                  required
                  className="h-8 text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Tipo de Uso *</Label>
                <Select value={formData.tipo_cultura || 'Pastagem'} onValueChange={(value) => setFormData({ ...formData, tipo_cultura: value, tipo_infraestrutura: '', tamanho_hectares: value === 'Infraestrutura' ? '' : formData.tamanho_hectares, capacidade_maxima: value === 'Infraestrutura' ? '' : formData.capacidade_maxima, tipo_pastagem: value === 'Infraestrutura' ? '' : formData.tipo_pastagem })}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Pastagem">Pastagem</SelectItem>
                    <SelectItem value="Agricultura">Agricultura</SelectItem>
                    <SelectItem value="Reserva">Reserva</SelectItem>
                    <SelectItem value="APP">APP</SelectItem>
                    <SelectItem value="Infraestrutura">Infraestrutura</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formData.tipo_cultura !== 'Infraestrutura' && <div className="space-y-1">
                <Label className="text-xs">Tamanho (hectares) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={formData.tamanho_hectares}
                  onChange={(e) => handleChange('tamanho_hectares', e.target.value)}
                  placeholder="0.00"
                  required
                  className="h-8 text-xs"
                />
              </div>}

              {formData.tipo_cultura !== 'Infraestrutura' && <div className="space-y-1">
                <Label className="text-xs">Capacidade Máxima (UA)</Label>
                <Input
                  type="number"
                  value={formData.capacidade_maxima}
                  onChange={(e) => handleChange('capacidade_maxima', e.target.value)}
                  placeholder="0"
                  className="h-8 text-xs"
                />
              </div>}
              </div>

              <div className="space-y-1">
              <Label className="text-xs">Setor *</Label>
              <Select
                value={formData.setor_id || "__none__"}
                onValueChange={(value) => {
                  const setor = setores.find((item) => item.id === value);
                  setFormData({ ...formData, setor_id: value === "__none__" ? "" : value, setor_nome: setor?.nome || "" });
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione o setor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Selecione</SelectItem>
                  {setores.map((setor) => <SelectItem key={setor.id} value={setor.id}>{setor.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              </div>

            {formData.tipo_cultura === 'Infraestrutura' ? (
              <div className="space-y-1">
                <Label className="text-xs">Tipo de Infraestrutura *</Label>
                <Select value={formData.tipo_infraestrutura || '__none__'} onValueChange={(value) => handleChange('tipo_infraestrutura', value === '__none__' ? '' : value)}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Selecione o tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Selecione</SelectItem>
                    <SelectItem value="Curral">Curral</SelectItem>
                    <SelectItem value="Oficina">Oficina</SelectItem>
                    <SelectItem value="Casa">Casa</SelectItem>
                    <SelectItem value="Barracão">Barracão</SelectItem>
                    <SelectItem value="Galpão">Galpão</SelectItem>
                    <SelectItem value="Depósito">Depósito</SelectItem>
                    <SelectItem value="Embarcador">Embarcador</SelectItem>
                    <SelectItem value="Brete">Brete</SelectItem>
                    <SelectItem value="Outro">Outro</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="text-xs">Tipo de Pastagem</Label>
                <Input
                  value={formData.tipo_pastagem}
                  onChange={(e) => handleChange('tipo_pastagem', e.target.value)}
                  placeholder="BRACHIARIA, TIFTON, ETC"
                  className="h-8 text-xs uppercase"
                  style={{ textTransform: 'uppercase' }}
                />
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs">Observações</Label>
              <Textarea
                value={formData.observacoes}
                onChange={(e) => handleChange('observacoes', e.target.value)}
                placeholder="OBSERVAÇÕES..."
                className="text-xs uppercase"
                style={{ textTransform: 'uppercase' }}
                rows={2}
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button type="button" variant="outline" onClick={onCancel} size="sm" className="h-8 text-xs">
                Cancelar
              </Button>
              <Button type="submit" size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-700">
                {isEditing ? 'Atualizar' : 'Salvar'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}