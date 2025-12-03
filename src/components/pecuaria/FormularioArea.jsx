import React, { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export default function FormularioArea({ onSubmit, onCancel, initialData, isEditing }) {
  const [formData, setFormData] = useState(initialData || {
    nome: "",
    tamanho_hectares: "",
    capacidade_maxima: "",
    tipo_pastagem: "",
    observacoes: ""
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

    if (!formData.tamanho_hectares) {
      toast.error('Tamanho é obrigatório!');
      return;
    }

    const data = {
      nome: formData.nome?.toUpperCase(),
      tamanho_hectares: parseFloat(formData.tamanho_hectares) || 0,
      capacidade_maxima: parseFloat(formData.capacidade_maxima) || 0,
      tipo_pastagem: formData.tipo_pastagem?.toUpperCase() || undefined,
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
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Capacidade Máxima (UA)</Label>
                <Input
                  type="number"
                  value={formData.capacidade_maxima}
                  onChange={(e) => handleChange('capacidade_maxima', e.target.value)}
                  placeholder="0"
                  className="h-8 text-xs"
                />
              </div>
            </div>

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